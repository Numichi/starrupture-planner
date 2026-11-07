/**
 * @module composables/useEditorActions
 *
 * Editor actions that need the game data and the calculation as well.
 *
 * The project store handles the simple changes (place, link, delete, move). This module
 * holds the composite ones that work from the model and the flow:
 *
 *   - adding a producer / consumer to a port (port picker): the new factory covers the
 *     shortage / the surplus and is linked right away; it goes next to the clicked node,
 *     or – when the link was dropped on empty canvas – so that its linked port lands on
 *     the drop point,
 *   - Build chain: the whole supply chain of an input (or of all inputs of a factory) down
 *     to the raw materials (`engine/chain.ts`),
 *   - Balance: machine counts computed from the linked demand (`engine/flow.ts`),
 *   - upgrade / downgrade (`engine/upgrades.ts`),
 *   - automatic layout (`engine/layout.ts`, ELK),
 *   - copy / paste (with the positions seen on the canvas; the store does the work),
 *   - building the factories from the targets of an old (v1) project.
 */
import { watch } from 'vue'

import { EPSILON, RATE_UNIT_LABEL } from '../config'
import { planChain, type ChainDemand, type ChainSource } from '../engine/chain'
import { isChainEnd, solveFlows } from '../engine/flow'
import { formatRate } from '../engine/format'
import { autoLayout, type PositionedNode } from '../engine/layout'
import { defaultPurityFor, minersFor, puritiesFor } from '../engine/mining'
import { nodeSize, portPosition } from '../engine/nodeGeometry'
import type { PlanNode } from '../engine/plan'
import {
  canAcceptInput,
  canProvideOutput,
  factoryPorts,
  lineHasFreeSlot,
  type ModelNode,
} from '../engine/projectModel'
import type { UpgradeOption } from '../engine/upgrades'
import { useProject } from '../project/projectStore'
import { nodeIds, parseNodeId, type Point } from '../project/types'
import { usePlanner } from './usePlanner'

const planner = usePlanner()
const store = useProject()
const { index, model, layout, plan, display, chainRecipes, gameData, loadState, buildingsOfType } =
  planner
const { project, activeBaseId } = store

/** Space between the columns of a placed chain, px. */
const COLUMN_GAP = 120

/** A new node is placed this far from the clicked one, px. */
const SIDE_GAP = 110

/** A user-facing result message of an action. */
export interface ActionMessage {
  text: string
  tone: 'ok' | 'bad'
}

function positioned(nodeId: string): PositionedNode | undefined {
  return layout.value.nodes.find((n) => n.node.id === nodeId)
}

/** Vertical position of a port on the canvas (per `nodeGeometry`). */
function portY(n: PositionedNode, dir: 'in' | 'out', item: string): number {
  const list = dir === 'in' ? n.node.inputs : n.node.outputs
  const index = Math.max(
    0,
    list.findIndex((p) => p.item === item),
  )

  return n.y + portPosition(n.node, dir, index).y
}

/** Size of a new node before it exists (for placing chains). */
function estimateSize(kind: PlanNode['kind'], ins: number, outs: number) {
  return nodeSize({ kind, inputs: new Array(ins), outputs: new Array(outs) })
}

// ============================================================================
// Placing with right-click
// ============================================================================

/** Selects the new node and opens its editor. */
function afterPlace(nodeId: string) {
  store.select([nodeId])
  store.editing.value = store.editTargetOf(nodeId)
}

function placeFactory(recipeId: string, at: Point, count = 1) {
  const f = store.addFactory(activeBaseId.value, recipeId, count, at)

  if (f) afterPlace(nodeIds.factory(f.id))
}

function placeMine(buildingId: string, item: string, at: Point) {
  const b = index.value.building(buildingId)
  const purity = defaultPurityFor(gameData.value, b, item)
  const m = store.addMine(
    activeBaseId.value,
    { building: buildingId, item, purity, count: 1, output: null },
    at,
  )

  if (m) afterPlace(nodeIds.mine(m.id))
}

type SpecialKind = 'receiver' | 'dispatcher' | 'storage' | 'railLine'

function placeSpecial(kind: SpecialKind, at: Point) {
  const baseId = activeBaseId.value
  let nodeId: string | null = null

  if (kind === 'receiver') {
    const b = buildingsOfType('receiver')[0]
    const r = b && store.addReceiver(baseId, b.id, null, at)

    if (r) nodeId = nodeIds.receiver(r.id)
  } else if (kind === 'dispatcher') {
    const b = buildingsOfType('dispatcher')[0]
    const d = b && store.addDispatcher(baseId, b.id, null, at)

    if (d) nodeId = nodeIds.dispatcher(d.id)
  } else if (kind === 'storage') {
    const b = buildingsOfType('storage')[0]
    const s = b && store.addStorage(baseId, b.id, null, at)

    if (s) nodeId = nodeIds.storage(s.id)
  } else if (kind === 'railLine') {
    const l = store.addRailLine(baseId, at)

    if (l) nodeId = nodeIds.line(l.id)
  }

  if (nodeId) afterPlace(nodeId)
}

/** Inter-base rail from this base to another (outgoing node here, incoming node there). */
function placeRailLink(toBaseId: string, at: Point) {
  const l = store.addRailLink(activeBaseId.value, toBaseId, at)

  if (l) afterPlace(nodeIds.railOut(l.id))
}

// ============================================================================
// Links
// ============================================================================

/**
 * A link between two nodes for one item. Without an item: the first output of the source
 * that the target accepts. From a rail line into a factory it also links the machine's
 * other, still unlinked items the line carries (one rail carries everything between two
 * nodes: one line on the graph).
 *
 * @returns an error message, or null on success
 */
function connect(fromId: string, toId: string, item?: string): string | null {
  const from = model.value.nodes.get(fromId)
  const to = model.value.nodes.get(toId)

  if (!from || !to) return 'Unknown node.'
  if (fromId === toId) return 'A node cannot be linked to itself.'

  const candidates = item ? [item] : from.outputs.map((p) => p.item)
  const chosen = candidates.find((i) => canProvideOutput(from, i) && canAcceptInput(to, i))

  if (!chosen) {
    const full = [to, from].find((n) => n.kind === 'line' && !lineHasFreeSlot(n))

    if (full)
      return `${full.title}: every input is taken. Increase the input count, or make it dynamic.`

    const what = item ? index.value.item(item).name : 'any of its outputs'

    return `${to.title} does not accept this: ${what}.`
  }

  store.addLink(activeBaseId.value, fromId, toId, chosen)

  // From a rail line (collector) into a factory: one rail carries the machine's other
  // requested items as well, when the line carries them and that input is not linked yet.
  if (from.kind === 'line' && to.kind === 'factory') {
    const linked = new Set(model.value.links.filter((l) => l.to === toId).map((l) => l.item))

    for (const p of to.inputs) {
      if (p.item === chosen || linked.has(p.item) || !from.outputs.some((o) => o.item === p.item))
        continue

      store.addLink(activeBaseId.value, fromId, toId, p.item)
    }
  }

  return null
}

// ============================================================================
// Port picker: adding a producer / consumer
// ============================================================================

/** How much is missing on an input / left over on an output (from the plan). */
function portGap(nodeId: string, dir: 'in' | 'out', item: string): number {
  const n = plan.value.nodes.find((x) => x.id === nodeId)
  const p = (dir === 'in' ? n?.inputs : n?.outputs)?.find((x) => x.item === item)

  return p?.gap ?? 0
}

/**
 * Top-left corner of the new node.
 *   - with `drop` (the link was dropped on empty canvas): so that the port to link lands
 *     exactly on the drop point;
 *   - otherwise next to the clicked node (producer to the left, consumer to the right), at
 *     the height of the linked port.
 *
 * @param side the side of the NEW node to link ('out': producer, 'in': consumer)
 */
function newNodeAt(
  anchorId: string,
  item: string,
  kind: PlanNode['kind'],
  ins: number,
  outs: number,
  side: 'in' | 'out',
  portIndex: number,
  drop?: Point,
): Point | null {
  const sized = { kind, inputs: new Array(ins), outputs: new Array(outs) }
  const port = portPosition(sized, side, Math.max(0, portIndex))

  if (drop) return { x: drop.x - port.x, y: drop.y - port.y }

  const anchor = positioned(anchorId)

  if (!anchor) return null

  const size = nodeSize(sized)
  // Height of the clicked port: the node's input for a producer, its output for a consumer.
  const y = portY(anchor, side === 'out' ? 'in' : 'out', item) - port.y

  return side === 'out'
    ? { x: anchor.x - size.width - SIDE_GAP, y }
    : { x: anchor.x + anchor.width + SIDE_GAP, y }
}

/**
 * A new factory for the shortage of an input (or one machine), linked.
 *
 * @param drop when the link was dropped on empty canvas: its output goes there
 */
function addProducerFactory(nodeId: string, item: string, recipeId: string, drop?: Point) {
  const r = index.value.recipe(recipeId)

  if (!r) return

  const ports = factoryPorts(r, index.value.building(r.building), 1)
  const idx = ports.outputs.findIndex((p) => p.item === item)
  const per = ports.outputs[idx]?.perBuilding ?? 0
  const gap = portGap(nodeId, 'in', item)
  const count = per > 0 && gap > EPSILON ? gap / per : 1
  const at = newNodeAt(
    nodeId,
    item,
    'factory',
    ports.inputs.length,
    ports.outputs.length,
    'out',
    idx,
    drop,
  )

  if (!at) return

  const f = store.addFactory(activeBaseId.value, r.id, count, at)

  if (!f) return

  store.addLink(activeBaseId.value, nodeIds.factory(f.id), nodeId, item)
  store.select([nodeIds.factory(f.id)])
}

/** A new mine for the shortage of an input, linked. */
function addProducerMine(nodeId: string, item: string, buildingId: string, drop?: Point) {
  const b = index.value.building(buildingId)
  const purity = defaultPurityFor(gameData.value, b, item)
  const table = b.mines?.[item]
  const per =
    typeof table === 'number' ? table : table ? (table[purity ?? ''] ?? Object.values(table)[0]) : 0
  const gap = portGap(nodeId, 'in', item)
  const count = per > 0 && gap > EPSILON ? gap / per : 1
  const at = newNodeAt(nodeId, item, 'mine', 0, 1, 'out', 0, drop)

  if (!at) return

  const m = store.addMine(
    activeBaseId.value,
    { building: buildingId, item, purity, count, output: null },
    at,
  )

  if (!m) return

  store.addLink(activeBaseId.value, nodeIds.mine(m.id), nodeId, item)
  store.select([nodeIds.mine(m.id)])
}

/** A new Receiver for this item, linked (pairing happens in the editor). */
function addProducerReceiver(nodeId: string, item: string, drop?: Point) {
  const b = buildingsOfType('receiver')[0]
  const at = b && newNodeAt(nodeId, item, 'receiver', 0, 1, 'out', 0, drop)

  if (!b || !at) return

  const r = store.addReceiver(activeBaseId.value, b.id, item, at)

  if (!r) return

  store.addLink(activeBaseId.value, nodeIds.receiver(r.id), nodeId, item)
  afterPlace(nodeIds.receiver(r.id))
}

/** A new rail line (collector) that gives this item to the input (its input is linked later). */
function addProducerLine(nodeId: string, item: string, drop?: Point) {
  const at = newNodeAt(nodeId, item, 'line', 1, 1, 'out', 0, drop)

  if (!at) return

  const l = store.addRailLine(activeBaseId.value, at)

  if (!l) return

  const node = nodeIds.line(l.id)

  store.addLink(activeBaseId.value, node, nodeId, item)
  afterPlace(node)
}

/**
 * A new inter-base rail from ANOTHER base to here: its incoming node goes in front of the
 * input, linked. The outgoing node in the other base gets a position automatically; it is
 * linked there.
 */
function addProducerRailLink(nodeId: string, item: string, fromBaseId: string, drop?: Point) {
  const at = newNodeAt(nodeId, item, 'railIn', 0, 1, 'out', 0, drop)
  const l = at && store.addRailLink(fromBaseId, activeBaseId.value)

  if (!at || !l) return

  const inId = nodeIds.railIn(l.id)

  store.setPositions(activeBaseId.value, { [inId]: at })
  store.addLink(activeBaseId.value, inId, nodeId, item)
  afterPlace(inId)
}

/**
 * A new consumer factory for an output, linked.
 *
 * @param count machine count; null = as many as use up the remainder (surplus / product)
 * @param drop  when the link was dropped on empty canvas: its input goes there
 */
function addConsumerFactory(
  nodeId: string,
  item: string,
  recipeId: string,
  count: number | null,
  drop?: Point,
) {
  const r = index.value.recipe(recipeId)

  if (!r) return

  const ports = factoryPorts(r, index.value.building(r.building), 1)
  const idx = ports.inputs.findIndex((p) => p.item === item)
  const per = ports.inputs[idx]?.perBuilding ?? 0
  const gap = portGap(nodeId, 'out', item)
  const n = count ?? (per > 0 && gap > EPSILON ? gap / per : 1)
  const at = newNodeAt(
    nodeId,
    item,
    'factory',
    ports.inputs.length,
    ports.outputs.length,
    'in',
    idx,
    drop,
  )

  if (!at) return

  // A given machine count: manual; covering the surplus: automatic (sized from its input).
  const f = store.addFactory(activeBaseId.value, r.id, n, at, count === null)

  if (!f) return

  store.addLink(activeBaseId.value, nodeId, nodeIds.factory(f.id), item)
  store.select([nodeIds.factory(f.id)])
}

/** A new Dispatcher / storage / rail line for an output, linked. */
function addConsumerSpecial(
  nodeId: string,
  item: string,
  kind: 'dispatcher' | 'storage' | 'line',
  drop?: Point,
) {
  const at = newNodeAt(nodeId, item, kind, 1, kind === 'dispatcher' ? 0 : 1, 'in', 0, drop)

  if (!at) return

  const baseId = activeBaseId.value
  let id: string | null = null

  if (kind === 'dispatcher') {
    const b = buildingsOfType('dispatcher')[0]
    const d = b && store.addDispatcher(baseId, b.id, item, at)

    if (d) id = nodeIds.dispatcher(d.id)
  } else if (kind === 'storage') {
    const b = buildingsOfType('storage')[0]
    const s = b && store.addStorage(baseId, b.id, item, at)

    if (s) id = nodeIds.storage(s.id)
  } else {
    const l = store.addRailLine(baseId, at)

    if (l) id = nodeIds.line(l.id)
  }

  if (!id) return

  store.addLink(baseId, nodeId, id, item)
  afterPlace(id)
}

/**
 * A new inter-base rail from this base to another, linked to the output (the incoming node
 * in the target base gets a position automatically).
 */
function addConsumerRailLink(nodeId: string, item: string, toBaseId: string, drop?: Point) {
  const at = newNodeAt(nodeId, item, 'railOut', 1, 0, 'in', 0, drop)
  const l = at && store.addRailLink(activeBaseId.value, toBaseId, at)

  if (!l) return

  const outId = nodeIds.railOut(l.id)

  store.addLink(activeBaseId.value, nodeId, outId, item)
  afterPlace(outId)
}

// ============================================================================
// Build chain
// ============================================================================

/** Free sources of a base for the chain: surplus / unlinked output, Receiver, incoming rail. */
function freeSources(baseId: string, exclude: ReadonlySet<string>): ChainSource[] {
  const list: ChainSource[] = []
  const p = planner.basePlans.value.get(baseId)

  for (const n of p?.nodes ?? []) {
    if (exclude.has(n.id)) continue

    if (n.kind === 'factory' || n.kind === 'mine') {
      for (const port of n.outputs) {
        if (port.gap > EPSILON) list.push({ nodeId: n.id, item: port.item, rate: port.gap })
      }
    } else if (n.kind === 'receiver' || n.kind === 'railIn') {
      for (const port of n.outputs) list.push({ nodeId: n.id, item: port.item, rate: Infinity })
    } else if (
      n.special?.type === 'storage' &&
      n.special.state === 'positive' &&
      n.special.storage.item
    ) {
      // A pass-through storage where the excess accumulates: that can be passed on too.
      list.push({ nodeId: n.id, item: n.special.storage.item, rate: n.special.excess })
    }
  }

  return list
}

/** Result of a chain build. */
export interface ChainReport {
  placed: number

  /** What nothing can supply (no recipe, mine or source). */
  missing: { item: string; rate: number }[]
}

/**
 * The message of a chain build. When a missing item has a recipe whose cycle time is
 * unknown, that is said separately (the cycle time can be entered manually).
 */
function chainMessage(r: ChainReport): ActionMessage {
  if (!r.placed && !r.missing.length)
    return { text: 'Nothing to build: every input is supplied.', tone: 'ok' }

  const noData = (item: string) =>
    gameData.value.recipes.some((x) => x.product === item && x.rateFrom === 'missing')
  const fmt = (m: { item: string; rate: number }) =>
    `${index.value.item(m.item).name} ${formatRate(m.rate)}${RATE_UNIT_LABEL}`
  const none = r.missing.filter((m) => !noData(m.item)).map(fmt)
  const unknown = r.missing.filter((m) => noData(m.item)).map(fmt)
  let text = `Chain built: ${r.placed} new node${r.placed === 1 ? '' : 's'}.`

  if (none.length) text += `\nNo source (neither recipe nor mine): ${none.join(', ')}`

  if (unknown.length) {
    text += `\nThe cycle time of its recipe is unknown (can be entered under Missing data): ${unknown.join(', ')}`
  }

  return { text, tone: r.missing.length ? 'bad' : 'ok' }
}

/**
 * Builds the chain for the missing inputs of a factory (or for one item). The new nodes go
 * to the left, in columns; the chain is linked all the way.
 *
 * @param drop when the link was dropped on empty canvas: the right edge of the first column
 *             and the middle of the chain go there (otherwise left of the factory, centred)
 */
function buildChain(nodeId: string, item?: string, drop?: Point): ChainReport {
  const node = plan.value.nodes.find((n) => n.id === nodeId)
  const target = positioned(nodeId)

  if (!node || !target) return { placed: 0, missing: [] }

  // Only a factory input has a nominal demand; the shortage is what the chain covers.
  const demands: ChainDemand[] = node.inputs
    .filter((p) => (!item || p.item === item) && p.gap > EPSILON)
    .map((p) => ({ item: p.item, rate: p.gap, consumer: nodeId }))

  return applyChain(activeBaseId.value, demands, { anchor: target, drop })
}

/**
 * Places a chain: factories, mines, links. `anchor`: the position of the consumer node (the
 * chain goes to its left, in columns); without it the automatic layout takes care of the
 * positions.
 */
function applyChain(
  baseId: string,
  demands: ChainDemand[],
  opts: { anchor?: PositionedNode; drop?: Point; sources?: ChainSource[] } = {},
): ChainReport {
  if (!demands.length) return { placed: 0, missing: [] }

  const exclude = new Set(demands.map((d) => d.consumer).filter((x): x is string => !!x))
  const chain = planChain(index.value, demands, {
    enabledRecipes: chainRecipes.value,
    objective: project.value.settings.objective,
    sources: opts.sources ?? freeSources(baseId, exclude),
  })

  if (chain.status !== 'optimal')
    return { placed: 0, missing: demands.map((d) => ({ item: d.item, rate: d.rate })) }

  // Placement: column = depth, stacked within a column, centred on the consumer.
  const sizes = new Map<string, { width: number; height: number }>()

  for (const f of chain.factories) {
    const ports = factoryPorts(f.recipe, index.value.building(f.recipe.building), 1)

    sizes.set(f.key, estimateSize('factory', ports.inputs.length, ports.outputs.length))
  }

  for (const m of chain.mines) sizes.set(m.key, estimateSize('mine', 0, 1))

  const at = new Map<string, Point>()
  const anchor = opts.anchor

  if (anchor) {
    const columns = new Map<number, string[]>()

    for (const key of sizes.keys()) {
      const d = Math.max(1, chain.depth.get(key) ?? 1)

      columns.set(d, [...(columns.get(d) ?? []), key])
    }

    const colWidth = Math.max(...[...sizes.values()].map((s) => s.width), 236) + COLUMN_GAP
    const centerY = opts.drop ? opts.drop.y : anchor.y + anchor.height / 2
    const firstRight = opts.drop ? opts.drop.x : anchor.x - COLUMN_GAP

    for (const [d, keys] of columns) {
      const total =
        keys.reduce((a, k) => a + sizes.get(k)!.height, 0) + (keys.length - 1) * display.nodeSpacing
      const right = firstRight - (d - 1) * colWidth
      let y = centerY - total / 2

      for (const k of keys) {
        const s = sizes.get(k)!

        at.set(k, { x: right - s.width, y })
        y += s.height + display.nodeSpacing
      }
    }
  }

  const ids = new Map<string, string>()

  for (const f of chain.factories) {
    const created = store.addFactory(baseId, f.recipe.id, f.count, at.get(f.key))

    if (created) ids.set(f.key, nodeIds.factory(created.id))
  }

  for (const m of chain.mines) {
    const mine = {
      building: m.building.id,
      item: m.item,
      purity: m.purity,
      count: m.count,
      output: null,
    }
    const created = store.addMine(baseId, mine, at.get(m.key))

    if (created) ids.set(m.key, nodeIds.mine(created.id))
  }

  for (const l of chain.links) {
    const from = ids.get(l.from) ?? l.from
    const to = ids.get(l.to) ?? l.to

    if (from.startsWith('new:') || to.startsWith('new:')) continue

    store.addLink(baseId, from, to, l.item)
  }

  if (baseId === activeBaseId.value) store.select([...ids.values()])

  return { placed: ids.size, missing: chain.missing.map(({ item, rate }) => ({ item, rate })) }
}

// ============================================================================
// Balance
// ============================================================================

/** Result of balancing. */
export interface BalanceReport {
  changed: number

  /** What is still missing after balancing (unlinked input, too little from a fixed mine). */
  shortages: { title: string; item: string; rate: number }[]
}

/**
 * Computes machine counts: the given nodes (by default every factory and mine of the base)
 * run with as many machines as their linked consumers need. The ends of the chain (whose
 * output is not linked) and mines with a custom output stay as they are: those are the
 * player's goals.
 *
 * Automatic factory: adjustable in the calculation (the demand passes through it down to
 * the mines), but its machine count is not written – it follows the new counts of its
 * sources by itself. Exception: when there is nothing to size it from ('auto-fallback'),
 * the typed count applies, and that is set.
 *
 * @param options.toManual the automatic factories of the scope switch to manual first
 *   (balancing one factory: its consumer demand should become its count, not the material
 *   reaching its inputs)
 */
function balance(scope?: readonly string[], options: { toManual?: boolean } = {}): BalanceReport {
  if (options.toManual && scope) {
    for (const nodeId of scope) {
      const { prefix, id } = parseNodeId(nodeId)
      const count = model.value.nodes.get(nodeId)?.count

      if (prefix === 'fac' && store.findFactory(id)?.factory.auto && count !== undefined) {
        store.setFactoryCount(id, count)
      }
    }
  }

  const m = model.value
  const inScope = (n: ModelNode) =>
    (scope ? scope.includes(n.id) : n.baseId === activeBaseId.value) &&
    (n.kind === 'factory' || n.kind === 'mine')
  const adjustable = new Set(
    [...m.nodes.values()].filter((n) => inScope(n) && !isChainEnd(m, n)).map((n) => n.id),
  )

  if (adjustable.size === 0) return { changed: 0, shortages: [] }

  const result = solveFlows(m, adjustable)

  if (result.status !== 'optimal') return { changed: 0, shortages: [] }

  let changed = 0
  const counts = new Map<string, number>()

  for (const [id, c] of result.counts) {
    // The typed count of an automatic factory sized from its inputs does not matter: it is
    // not written (it follows the new counts of its sources by itself).
    if (m.nodes.get(id)?.countMode === 'auto') continue

    const before = m.nodes.get(id)?.count ?? 0

    if (Math.abs(before - c) > 1e-4) changed++

    counts.set(id, c)
  }

  store.setCounts(counts)

  // What is still missing afterwards (with the real flow: too little source, too small
  // throughput, unlinked input).
  const shortages: BalanceReport['shortages'] = []

  for (const p of planner.basePlans.value.values()) {
    for (const s of p.summary.shortages) {
      if (adjustable.has(s.nodeId)) shortages.push({ title: s.title, item: s.item, rate: s.rate })
    }
  }

  return { changed, shortages }
}

// ============================================================================
// Upgrade
// ============================================================================

/** Switches a factory / mine to an upgraded or base variant. Links that no longer fit are removed. */
function upgrade(nodeId: string, option: UpgradeOption) {
  const { prefix, id } = parseNodeId(nodeId)
  const baseId = activeBaseId.value

  if (prefix === 'fac' && option.recipe) {
    const ports = factoryPorts(option.recipe, option.building, 1)

    store.updateFactory(id, { recipe: option.recipe.id })
    store.removeLinksOf(baseId, nodeId, (l) =>
      l.to === nodeId
        ? !ports.inputs.some((p) => p.item === l.item)
        : !ports.outputs.some((p) => p.item === l.item),
    )
  } else if (prefix === 'mine') {
    const mine = store.findMine(id)?.mine

    if (!mine) return

    const keep =
      mine.purity &&
      puritiesFor(gameData.value, option.building, mine.item).some((p) => p.id === mine.purity)
    const purity = keep ? mine.purity : defaultPurityFor(gameData.value, option.building, mine.item)

    store.updateMine(id, { building: option.building.id, purity })
  }
}

// ============================================================================
// Automatic layout
// ============================================================================

/** ELK layout of the selected nodes (their top-left corner stays), or of the whole base. */
async function arrange(ids?: readonly string[]) {
  const baseId = activeBaseId.value
  const all = plan.value.nodes
  const nodes = ids?.length ? all.filter((n) => ids.includes(n.id)) : all

  if (!nodes.length) return

  const current = layout.value.nodes.filter((n) => nodes.some((x) => x.id === n.node.id))
  const origin = ids?.length
    ? { x: Math.min(...current.map((n) => n.x)), y: Math.min(...current.map((n) => n.y)) }
    : { x: 40, y: 40 }
  const positions = await autoLayout(nodes, plan.value.edges, display, origin)

  if (baseId === activeBaseId.value) store.setPositions(baseId, positions)
}

// ============================================================================
// Copy / paste
// ============================================================================

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Copies the nodes to the clipboard (with the links between them), at their positions on the canvas. */
function copyNodes(ids: readonly string[]): ActionMessage | null {
  if (!ids.length) return null

  const positions = new Map(layout.value.nodes.map((n) => [n.node.id, { x: n.x, y: n.y }]))
  const r = store.copyNodes(activeBaseId.value, ids, positions)
  const skipped = r.skipped ? `\nInter-base rail ends cannot be copied (${r.skipped} skipped).` : ''

  if (!r.nodes) return { text: 'Nothing to copy.' + skipped, tone: 'bad' }

  const links = r.links ? ` (${plural(r.links, 'link')})` : ''

  return { text: `${plural(r.nodes, 'node')} copied${links}. Paste: Ctrl+V.${skipped}`, tone: 'ok' }
}

/** Pastes the clipboard into the active base; the new nodes stay selected. */
function pasteNodes(at?: Point): ActionMessage | null {
  if (!store.clipboard.value)
    return { text: 'The clipboard is empty: select nodes first, then Ctrl+C.', tone: 'bad' }

  const r = store.pasteNodes(activeBaseId.value, at)

  if (!r.ids.length) return null

  const links = r.links ? ` (${plural(r.links, 'link')})` : ''

  return { text: `${plural(r.ids.length, 'node')} pasted${links}.`, tone: 'ok' }
}

// ============================================================================
// Old (v1) project: building the factories from the targets
// ============================================================================

/**
 * Builds a chain from the old targets (using the base's mines, Receivers and incoming
 * rails), links the Dispatchers and outgoing rails to the producers, and finally balances
 * the automatic mines.
 */
function migrateLegacy() {
  const legacy = store.pendingLegacy.value

  if (!legacy) return

  store.clearLegacy()

  for (const base of project.value.bases) {
    const targets = legacy.targets.get(base.id) ?? []

    // Sources: in the old model whatever came into the base (Receiver, incoming rail) or the mines.
    const sources: ChainSource[] = []

    for (const r of base.receivers) {
      if (r.item) sources.push({ nodeId: nodeIds.receiver(r.id), item: r.item, rate: Infinity })
    }

    for (const l of project.value.railLinks) {
      if (l.to !== base.id || l.from === base.id) continue

      for (const i of l.items)
        sources.push({ nodeId: nodeIds.railIn(l.id), item: i, rate: Infinity })
    }

    for (const mine of base.mines) {
      if (mine.item)
        sources.push({ nodeId: nodeIds.mine(mine.id), item: mine.item, rate: Infinity })
    }

    if (targets.length) {
      const demands = targets.map((t) => ({ item: t.item, rate: t.rate, consumer: null }))

      applyChain(base.id, demands, { sources })
    }

    // Producers per item (new factories and mines), to link the Dispatchers, storages and outgoing rails.
    const producersOf = (item: string) => [
      ...base.mines.filter((m) => m.item === item).map((m) => nodeIds.mine(m.id)),
      ...base.factories
        .filter((f) => index.value.recipe(f.recipe)?.product === item)
        .map((f) => nodeIds.factory(f.id)),
      ...base.receivers.filter((r) => r.item === item).map((r) => nodeIds.receiver(r.id)),
    ]

    for (const d of base.dispatchers) {
      if (!d.item) continue

      for (const p of producersOf(d.item)) {
        if (!p.startsWith('recv:')) store.addLink(base.id, p, nodeIds.dispatcher(d.id), d.item)
      }
    }

    for (const s of base.storages) {
      if (!s.item) continue

      for (const p of producersOf(s.item)) store.addLink(base.id, p, nodeIds.storage(s.id), s.item)
    }

    for (const l of project.value.railLinks) {
      if (l.from !== base.id || l.to === base.id) continue

      for (const i of l.items) {
        for (const p of producersOf(i)) store.addLink(base.id, p, nodeIds.railOut(l.id), i)
      }
    }
  }

  // The machine counts of the automatic mines (and of the new factories) from the linked demand.
  const ids = new Set<string>(
    project.value.bases.flatMap((b) => b.factories.map((f) => nodeIds.factory(f.id))),
  )

  for (const id of legacy.autoMines) ids.add(nodeIds.mine(id))

  balance([...ids])
  store.select([])
}

watch(
  [() => store.pendingLegacy.value, loadState],
  ([legacy, state]) => {
    // Part of loading, not an undoable step.
    if (legacy && state === 'ready') store.withoutHistory(migrateLegacy)
  },
  { immediate: true },
)

// ============================================================================
// Placing a mine for an item (the common case: the first non-upgraded mine)
// ============================================================================

function defaultMinerFor(item: string) {
  const list = minersFor(gameData.value, item)

  return list.find((b) => !b.upgradeOf) ?? list[0] ?? null
}

/** The editor actions (module-level state shared with {@link usePlanner}). */
export function useEditorActions() {
  return {
    placeFactory,
    placeMine,
    placeSpecial,
    placeRailLink,
    connect,
    addProducerFactory,
    addProducerMine,
    addProducerReceiver,
    addProducerLine,
    addProducerRailLink,
    addConsumerFactory,
    addConsumerSpecial,
    addConsumerRailLink,
    buildChain,
    chainMessage,
    balance,
    upgrade,
    arrange,
    defaultMinerFor,
    copyNodes,
    pasteNodes,
  }
}
