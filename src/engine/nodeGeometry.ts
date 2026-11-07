/**
 * @module engine/nodeGeometry
 *
 * Node sizes and port positions.
 *
 * This is the ONLY place where node sizes and port (input / output point) positions are
 * decided. It is used by:
 *   - `edgePaths.ts`: edges start and end at the port positions,
 *   - `layout.ts`: the auto layout (ELK) gets the box sizes from here,
 *   - the node components (GraphNode, SpecialNode, LineNode): they draw the item icons at
 *     the same positions.
 * So an edge always ends exactly at its item icon.
 *
 * Every node has the same structure:
 *
 * ```
 * ┌──────────── header (headerHeight) ─────────────┐
 * │ padding                                        │
 * │ body: item rows (rowHeight), centred           │
 * │ footer: extra lines, e.g. pairing, status      │
 * │ padding                                        │
 * └────────────────────────────────────────────────┘
 * ```
 */
import type { PlanNodeKind } from './plan'

/** What sizing needs from a node (a PlanNode, or a node not placed yet). */
export interface SizedNode {
  kind: PlanNodeKind
  inputs: readonly unknown[]
  outputs: readonly unknown[]
  footerLines?: number

  /** Empty item rows below the ports (free inputs of a rail line). */
  freeRows?: number
}

/** Shared node dimensions in px. */
export const NODE = {
  /** Height of the header (name). */
  headerHeight: 26,

  /** Vertical inner margin below the header and at the bottom of the box. */
  padding: 8,

  /** Width of the left / right item column of a recipe node. */
  sideColumnWidth: 96,

  /** Height of one footer text line. */
  footerLine: 16,
} as const

/** Dimensions of one node kind. */
interface KindSpec {
  width: number

  /** Height of one item row (also the distance between ports). */
  rowHeight: number

  /** Minimum body height. */
  minBody: number

  /** Number of footer lines. */
  footerLines: number
}

/** Dimensions per node kind. A new kind needs a row here. */
export const KIND_SPEC: Record<PlanNodeKind, KindSpec> = {
  factory: { width: 280, rowHeight: 30, minBody: 64, footerLines: 0 },
  mine: { width: 236, rowHeight: 30, minBody: 30, footerLines: 2 },
  receiver: { width: 236, rowHeight: 30, minBody: 30, footerLines: 2 },
  dispatcher: { width: 236, rowHeight: 30, minBody: 30, footerLines: 2 },
  storage: { width: 236, rowHeight: 30, minBody: 30, footerLines: 2 },
  railIn: { width: 224, rowHeight: 26, minBody: 26, footerLines: 1 },
  railOut: { width: 224, rowHeight: 26, minBody: 26, footerLines: 1 },
  // Rail line: footer = total flow / capacity, and the status (congestion).
  line: { width: 264, rowHeight: 28, minBody: 28, footerLines: 2 },
}

/** A box size in px. */
export interface Size {
  width: number
  height: number
}

function bodyContentHeight(node: SizedNode): number {
  const spec = KIND_SPEC[node.kind]
  const rows = Math.max(Math.max(node.inputs.length, node.outputs.length) + (node.freeRows ?? 0), 1)

  return Math.max(rows * spec.rowHeight, spec.minBody)
}

/** Number of footer lines: the node's own value, or the kind's default. */
function footerCount(node: SizedNode): number {
  return node.footerLines ?? KIND_SPEC[node.kind].footerLines
}

/** The full size of a node box. */
export function nodeSize(node: SizedNode): Size {
  const spec = KIND_SPEC[node.kind]

  return {
    width: spec.width,
    height:
      NODE.headerHeight +
      2 * NODE.padding +
      bodyContentHeight(node) +
      footerCount(node) * NODE.footerLine,
  }
}

/** Centre (y) of a footer line, relative to the top of the node. */
export function footerLineY(node: SizedNode, line: number): number {
  return (
    NODE.headerHeight +
    NODE.padding +
    bodyContentHeight(node) +
    line * NODE.footerLine +
    NODE.footerLine / 2
  )
}

/**
 * Centre of a port inside the node (relative to the top-left corner).
 *
 * Inputs are on the left edge, outputs on the right edge, in a vertically centred column.
 * Free rows (`freeRows`) come below the ports: `index` may exceed the port count (the k-th
 * free row is count + k).
 */
export function portPosition(
  node: SizedNode,
  side: 'in' | 'out',
  index: number,
): { x: number; y: number } {
  const spec = KIND_SPEC[node.kind]
  const count = side === 'in' ? node.inputs.length : node.outputs.length
  const columnTop =
    NODE.headerHeight +
    NODE.padding +
    (bodyContentHeight(node) - (count + (node.freeRows ?? 0)) * spec.rowHeight) / 2

  return {
    x: side === 'in' ? 0 : spec.width,
    y: columnTop + index * spec.rowHeight + spec.rowHeight / 2,
  }
}
