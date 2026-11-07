/**
 * @module components/graphEvents
 *
 * Types of the events between the graph components (handled by ProductionGraph).
 */

/** A pointer press on an item row (port) of a node. */
export interface PortDown {
  nodeId: string

  /** 'in': input (left side), 'out': output (right side). */
  dir: 'in' | 'out'

  item: string
  event: PointerEvent
}

/** What the context menu was opened on. */
export type MenuTarget =
  { type: 'canvas' } | { type: 'node'; nodeId: string } | { type: 'edge'; linkId: string }

/** An open context menu. */
export interface MenuState {
  target: MenuTarget

  /** Where it opens (inside the graph container, px). */
  left: number
  top: number

  /** The click position on the canvas (a placed node goes here). */
  world: { x: number; y: number }
}

/** An open port picker. */
export interface PickerState {
  nodeId: string
  dir: 'in' | 'out'
  item: string
  left: number
  top: number

  /**
   * When the link was dropped on empty canvas: the drop point on the canvas (the linked port
   * of the chosen node goes there) and the port position (the preview line starts there).
   * Absent on a click.
   */
  drop?: { at: { x: number; y: number }; from: { x: number; y: number } }
}
