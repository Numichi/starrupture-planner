/**
 * @module engine/layout
 *
 * Layout – node positions on the canvas and edge routes.
 *
 * Node positions are decided by the PLAYER (dragging) and stored in the project
 * (`Base.positions`). This module does two things:
 *
 *   1. {@link positionGraph}: puts the plan's nodes at their stored positions and routes
 *      the edges from port to port (orthogonal bend points; the line STYLE comes from
 *      `edgePaths.ts`). All links between the same two nodes (one rail, several items) are
 *      ONE line: at each end a "comb" (a short stub per item) gathers them onto the shared
 *      segment. A node without a position is temporarily placed next to the others and
 *      listed in `missing`.
 *
 *   2. {@link autoLayout}: automatic layout with ELK.js (Eclipse Layout Kernel, "layered"
 *      algorithm, left to right: raw material → end product). It runs when nodes have no
 *      position yet (e.g. an old project) or when "Arrange" is requested. The project
 *      stores the result; afterwards the nodes move freely.
 *
 * All ELK options: https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html
 */
import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api'
import ELK from 'elkjs/lib/elk.bundled.js'

import { nodeSize, portPosition } from './nodeGeometry'
import type { PlanEdge, PlanNode, ProductionPlan } from './plan'

/** Spacing of the automatic layout. */
export interface LayoutOptions {
  /** Horizontal distance between two layers (columns), px. */
  layerSpacing: number

  /** Vertical distance between two nodes within a layer, px. */
  nodeSpacing: number
}

/** A point in canvas coordinates. */
export interface Point {
  x: number
  y: number
}

/** A plan node with its box on the canvas. */
export interface PositionedNode {
  node: PlanNode
  x: number
  y: number
  width: number
  height: number
}

/**
 * One drawn line: a rail between two nodes (with one or more items).
 * With several items the shared segment (`points`) runs between the comb points next to
 * the ports, and stubs (`stubs`) lead from the comb points to the ports.
 */
export interface PositionedEdge {
  /** The edge of the first link (id, rail, ends); all edges of the rail: `edges`. */
  edge: PlanEdge

  /** The edges running on the rail, one per item (in link order). */
  edges: PlanEdge[]

  /** Total flow of the rail (all items together). */
  rate: number

  /** Start point, orthogonal bend points, end point – in absolute coordinates. */
  points: Point[]

  /** Several items: per item the stub from its port to the shared segment (source and target side). */
  stubs: { item: string; points: Point[] }[]
}

/** The positioned graph of one base. */
export interface GraphLayout {
  nodes: PositionedNode[]
  edges: PositionedEdge[]

  /** Bounding rectangle of the content. */
  bounds: { x: number; y: number; width: number; height: number }

  /** Nodes without a stored position. */
  missing: string[]
}

/** An edge leaves / enters a port horizontally over this distance, px. */
const STUB = 22

/** For a multi-item rail the comb is this far from the node edge, px. */
const COMB = 10

/** An edge running backwards passes below the nodes with this clearance, px. */
const DETOUR = 26

/**
 * The plan at its stored positions, with edge routes.
 *
 * @param positions node id → top-left corner
 * @param offset    while dragging: these nodes are drawn shifted by the offset
 */
export function positionGraph(
  plan: ProductionPlan,
  positions: Readonly<Record<string, Point>>,
  offset?: { ids: ReadonlySet<string>; dx: number; dy: number },
): GraphLayout {
  const nodes: PositionedNode[] = []
  const missing: string[] = []

  for (const node of plan.nodes) {
    const size = nodeSize(node)
    const p = positions[node.id]

    if (!p) missing.push(node.id)

    const moved = p && offset?.ids.has(node.id)

    nodes.push({
      node,
      x: (p?.x ?? 0) + (moved ? offset!.dx : 0),
      y: (p?.y ?? 0) + (moved ? offset!.dy : 0),
      ...size,
    })
  }

  // Nodes without a position go temporarily below the others, in one row.
  if (missing.length) {
    const placed = nodes.filter((n) => positions[n.node.id])
    const bottom = placed.length ? Math.max(...placed.map((n) => n.y + n.height)) + 60 : 40
    let x = placed.length ? Math.min(...placed.map((n) => n.x)) : 40

    for (const n of nodes) {
      if (positions[n.node.id]) continue

      n.x = x
      n.y = bottom
      x += n.width + 40
    }
  }

  const byId = new Map(nodes.map((n) => [n.node.id, n]))

  // One line per rail (node pair).
  const rails = new Map<string, PlanEdge[]>()

  for (const e of plan.edges) {
    const list = rails.get(e.railKey)

    if (list) list.push(e)
    else rails.set(e.railKey, [e])
  }

  const edges: PositionedEdge[] = []

  for (const list of rails.values()) {
    const a = byId.get(list[0].from)
    const b = byId.get(list[0].to)

    if (!a || !b) continue

    // The two port positions per item.
    const ends = list.flatMap((edge) => {
      const ai = a.node.outputs.findIndex((p) => p.id === edge.fromPort)
      const bi = b.node.inputs.findIndex((p) => p.id === edge.toPort)

      if (ai < 0 || bi < 0) return []

      const pa = portPosition(a.node, 'out', ai)
      const pb = portPosition(b.node, 'in', bi)

      return [
        { edge, from: { x: a.x + pa.x, y: a.y + pa.y }, to: { x: b.x + pb.x, y: b.y + pb.y } },
      ]
    })

    if (!ends.length) continue

    const rate = ends.reduce((sum, x) => sum + x.edge.rate, 0)

    if (ends.length === 1) {
      edges.push({
        edge: ends[0].edge,
        edges: [ends[0].edge],
        rate,
        points: routeEdge(ends[0].from, ends[0].to, a, b),
        stubs: [],
      })
      continue
    }

    // Several items: a comb point next to the ports, centred on the port rows; one shared segment from there.
    const mid = (ys: number[]) => (Math.min(...ys) + Math.max(...ys)) / 2
    const fromX = ends[0].from.x + COMB
    const toX = ends[0].to.x - COMB
    const start = { x: fromX, y: mid(ends.map((x) => x.from.y)) }
    const end = { x: toX, y: mid(ends.map((x) => x.to.y)) }
    const stubs = ends.flatMap((x) => [
      { item: x.edge.item, points: [x.from, { x: fromX, y: x.from.y }, start] },
      { item: x.edge.item, points: [end, { x: toX, y: x.to.y }, x.to] },
    ])

    edges.push({
      edge: ends[0].edge,
      edges: ends.map((x) => x.edge),
      rate,
      points: routeEdge(start, end, a, b),
      stubs,
    })
  }

  return { nodes, edges, bounds: boundsOf(nodes, edges), missing }
}

/** Bounding box of nodes and edges, with a 40 px margin. */
function boundsOf(nodes: readonly PositionedNode[], edges: readonly PositionedEdge[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }

  for (const e of edges) {
    for (const p of [...e.points, ...e.stubs.flatMap((s) => s.points)]) {
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  }

  return nodes.length
    ? { x: minX - 40, y: minY - 40, width: maxX - minX + 80, height: maxY - minY + 80 }
    : { x: 0, y: 0, width: 0, height: 0 }
}

type Box = { x: number; y: number; width: number; height: number }

/**
 * Route of an edge from an output (right side) to an input (left side), with orthogonal
 * bend points:
 *   - forwards (the target is to the right): horizontally out, vertically half-way between
 *     the two nodes, horizontally in,
 *   - backwards (a cycle, or the target is to the left): out to the right, down below both
 *     nodes, to the left, up to the target's height, in.
 */
export function routeEdge(from: Point, to: Point, a: Box, b: Box): Point[] {
  if (to.x - from.x >= 2 * STUB) {
    if (Math.abs(from.y - to.y) < 0.5) return [from, to]

    const midX = (from.x + to.x) / 2

    return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to]
  }

  const x1 = from.x + STUB
  const x2 = to.x - STUB
  const below = Math.max(a.y + a.height, b.y + b.height) + DETOUR

  return [
    from,
    { x: x1, y: from.y },
    { x: x1, y: below },
    { x: x2, y: below },
    { x: x2, y: to.y },
    to,
  ]
}

// One instance is enough. elk.bundled runs on the main thread; with hundreds of nodes a
// Web Worker may be worth it (see README).
const elk = new ELK()

/** A plan node as an ELK node with fixed port positions. */
function toElkNode(node: PlanNode): ElkNode {
  const size = nodeSize(node)
  const ports: ElkPort[] = [
    ...node.inputs.map((p, i) => ({ id: p.id, side: 'WEST', ...portPosition(node, 'in', i) })),
    ...node.outputs.map((p, i) => ({ id: p.id, side: 'EAST', ...portPosition(node, 'out', i) })),
  ].map(({ id, side, x, y }) => ({
    id,
    x,
    y,
    width: 0,
    height: 0,
    layoutOptions: { 'elk.port.side': side },
  }))

  const layoutOptions: Record<string, string> = {
    // Ports stay exactly where nodeGeometry.ts puts them.
    'elk.portConstraints': 'FIXED_POS',
  }

  // The "border" of the base: outgoing inter-base rails go to the right edge, mines and
  // incoming inter-base rails to the left edge.
  if (node.kind === 'railOut') layoutOptions['elk.layered.layering.layerConstraint'] = 'LAST'
  else if (node.kind === 'mine' || node.kind === 'railIn')
    layoutOptions['elk.layered.layering.layerConstraint'] = 'FIRST'

  return { id: node.id, ...size, ports, layoutOptions }
}

/**
 * Automatic layout of the given nodes (with the edges between them).
 *
 * @param origin top-left corner of the laid-out group
 * @returns node id → top-left corner
 */
export async function autoLayout(
  nodes: readonly PlanNode[],
  edges: readonly PlanEdge[],
  options: LayoutOptions,
  origin: Point = { x: 40, y: 40 },
): Promise<Map<string, Point>> {
  const ids = new Set(nodes.map((n) => n.id))
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing),
      'elk.spacing.nodeNode': String(options.nodeSpacing),
      'elk.spacing.edgeEdge': '22',
      'elk.spacing.edgeNode': '20',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      // Node placement within a layer: balanced, few bends.
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      // Keep the node order where possible → a more predictable picture.
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      // Unconnected parts are stacked below each other.
      'elk.separateConnectedComponents': 'true',
    },
    children: nodes.map(toElkNode),
    edges: edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e): ElkExtendedEdge => ({ id: e.id, sources: [e.fromPort], targets: [e.toPort] })),
  }

  const result = await elk.layout(graph)
  const out = new Map<string, Point>()

  for (const c of result.children ?? []) {
    out.set(c.id, { x: Math.round(origin.x + (c.x ?? 0)), y: Math.round(origin.y + (c.y ?? 0)) })
  }

  return out
}
