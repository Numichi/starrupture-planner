/**
 * @module engine/edgePaths
 *
 * Line styles and edge label placement.
 *
 * The router gives every edge an orthogonal list of bend points (e.g. → ↓ →). This module
 * turns it into an SVG path description (the `d` attribute) in the chosen style. All styles
 * work from the same points, so the lines run in the same place and only the corners
 * differ; switching the style needs no new layout.
 *
 * Adding a style:
 *   1. add its name to `LineStyle` and to `LINE_STYLES`,
 *   2. add a branch to `edgePath`.
 * The settings panel creates a button from `LINE_STYLES` automatically.
 */
import type { Point } from './layout'

/** Available line styles. */
export type LineStyle = 'orthogonal' | 'rounded' | 'curved'

/** Line styles with their UI labels. */
export const LINE_STYLES: { value: LineStyle; label: string }[] = [
  { value: 'orthogonal', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'curved', label: 'Curved' },
]

/** Corner radius of the rounded style, px. */
const CORNER_RADIUS = 10

/** In the curved style the curve reaches at most this far horizontally from the turn, px. */
const CURVE_REACH = 90

const fmt = (p: Point) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`

const isVertical = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5

const isHorizontal = (a: Point, b: Point) => Math.abs(a.y - b.y) < 0.5

/** The SVG path of an edge in the given style. */
export function edgePath(points: Point[], style: LineStyle): string {
  if (points.length < 2) return ''

  switch (style) {
    case 'orthogonal':
      return 'M' + points.map(fmt).join(' L')
    case 'rounded':
      return roundedPath(points)
    case 'curved':
      return curvedPath(points)
  }
}

/** An orthogonal path with small arcs in the corners. */
function roundedPath(pts: Point[]): string {
  let d = `M${fmt(pts[0])}`

  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const corner = pts[i]
    const next = pts[i + 1]
    const lenIn = Math.hypot(corner.x - prev.x, corner.y - prev.y)
    const lenOut = Math.hypot(next.x - corner.x, next.y - corner.y)
    // The radius may not exceed half of the adjacent segments.
    const r = Math.min(CORNER_RADIUS, lenIn / 2, lenOut / 2)
    const before = {
      x: corner.x - ((corner.x - prev.x) / lenIn) * r,
      y: corner.y - ((corner.y - prev.y) / lenIn) * r,
    }
    const after = {
      x: corner.x + ((next.x - corner.x) / lenOut) * r,
      y: corner.y + ((next.y - corner.y) / lenOut) * r,
    }

    d += ` L${fmt(before)} Q${fmt(corner)} ${fmt(after)}`
  }

  return d + ` L${fmt(pts[pts.length - 1])}`
}

/**
 * A curved path: every vertical "step" becomes an S-shaped cubic Bézier curve that starts
 * and ends horizontally. For an edge running backwards (a cycle) this gives a U-turn.
 */
function curvedPath(pts: Point[]): string {
  const last = pts.length - 1
  // Which segment becomes a curve: vertical, with a horizontal continuation at both ends.
  const curved = pts.map((p, i) => i > 0 && i + 1 < last && isVertical(p, pts[i + 1]))

  let d = `M${fmt(pts[0])}`

  for (let i = 0; i < last; i++) {
    const a = pts[i]
    const b = pts[i + 1]

    if (curved[i]) {
      const prev = pts[i - 1]
      const next = pts[i + 2]
      const reachIn = Math.min(Math.abs(a.x - prev.x) / 2, CURVE_REACH)
      const reachOut = Math.min(Math.abs(next.x - b.x) / 2, CURVE_REACH)
      const start = { x: a.x - Math.sign(a.x - prev.x) * reachIn, y: a.y }
      const end = { x: b.x + Math.sign(next.x - b.x) * reachOut, y: b.y }

      // Control points in the two corners → horizontal tangents at both ends of the curve.
      d += ` L${fmt(start)} C${fmt(a)} ${fmt(b)} ${fmt(end)}`
    } else if (!curved[i + 1]) {
      // When the next segment is a curve, it draws the line up to its own start.
      d += ` L${fmt(b)}`
    }
  }

  return d
}

/**
 * Fallback label position of a single edge (when there is no joint placement): the middle
 * of the longest horizontal segment, which is on the line in every style.
 */
export function labelPosition(pts: Point[]): Point {
  let best: Point | null = null
  let bestLen = -1

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]

    if (!isHorizontal(a, b)) continue

    const len = Math.abs(b.x - a.x)

    if (len > bestLen) {
      bestLen = len
      best = { x: (a.x + b.x) / 2, y: a.y }
    }
  }

  if (best) return best

  // Fallback: the middle between the first and the last point.
  const a = pts[0]
  const b = pts[pts.length - 1]

  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

// ============================================================================
// Collision-free label placement
// ============================================================================

/** Height of the label box, px. */
export const LABEL_HEIGHT = 18

const LABEL_ICON = 14

/** Gap between the item icons of a multi-item label, px. */
export const LABEL_ICON_GAP = 2

/**
 * Width of a label box (estimate: an 11 px digit ≈ 6.6 px, a 9.5 px badge letter ≈ 6 px).
 * `GraphEdge` uses the same function, so drawing and collision checks agree on the size.
 *
 * @param icons number of item icons in front (a rail with several items: side by side)
 */
export function labelBoxWidth(
  text: string,
  badge: string,
  icons = 1,
): { width: number; textWidth: number; badgeWidth: number; iconsWidth: number } {
  const textWidth = text.length * 6.6
  const badgeWidth = badge ? badge.length * 6 + 10 : 0
  const iconsWidth = icons * LABEL_ICON + (icons - 1) * LABEL_ICON_GAP

  return {
    width: 4 + iconsWidth + 4 + textWidth + (badge ? 5 + badgeWidth + 3 : 7),
    textWidth,
    badgeWidth,
    iconsWidth,
  }
}

/** One edge whose label is to be placed. */
export interface LabelRequest {
  id: string
  points: Point[]

  /** Width of the label box. */
  width: number

  /**
   * Where it starts / ends (port or comb point key): labels of edges with a common start
   * are moved to the branching part.
   */
  fromPort: string
  toPort: string
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

/**
 * Places the labels of all edges at once so they do not overlap.
 *
 * Candidate positions per edge, in this order:
 *   - when several edges leave the SAME port (fan-out), they would overlap on the shared
 *     first segment: the horizontal segments near the target come first; when several
 *     edges enter the same port (fan-in), those near the source; otherwise the longest
 *     horizontal segment,
 *   - per segment its middle, then its quarters and fifths (away from the corners, so the
 *     label stays on the line in the curved style too),
 *   - finally the middles of the vertical segments (the S-curve passes there as well).
 *
 * Greedy: per edge the first candidate that collides neither with the labels placed so
 * far nor with the nodes; when there is none, the one with the smallest overlap.
 *
 * @param obstacles the node rectangles
 * @param style     the line style (in the curved style no label goes on the curve before a corner)
 * @returns edge id → centre of the label
 */
export function placeLabels(
  edges: readonly LabelRequest[],
  obstacles: readonly Rect[],
  style: LineStyle,
): Map<string, Point> {
  const fromCount = new Map<string, number>()
  const toCount = new Map<string, number>()

  for (const e of edges) {
    fromCount.set(e.fromPort, (fromCount.get(e.fromPort) ?? 0) + 1)
    toCount.set(e.toPort, (toCount.get(e.toPort) ?? 0) + 1)
  }

  const placed: Rect[] = []
  const result = new Map<string, Point>()

  const box = (p: Point, w: number): Rect => ({
    x: p.x - w / 2 - 3,
    y: p.y - LABEL_HEIGHT / 2 - 2,
    width: w + 6,
    height: LABEL_HEIGHT + 4,
  })

  for (const e of edges) {
    const pts = e.points

    if (pts.length < 2) continue

    const last = pts.length - 1
    // Horizontal segments in the chosen order.
    const horizontal: number[] = []

    for (let i = 0; i < last; i++) {
      if (isHorizontal(pts[i], pts[i + 1]) && Math.abs(pts[i + 1].x - pts[i].x) > 1)
        horizontal.push(i)
    }

    const len = (i: number) => Math.abs(pts[i + 1].x - pts[i].x)

    if ((fromCount.get(e.fromPort) ?? 0) > 1) horizontal.reverse()
    else if ((toCount.get(e.toPort) ?? 0) <= 1) horizontal.sort((a, b) => len(b) - len(a))

    const candidates: Point[] = []

    for (const i of horizontal) {
      const a = pts[i]
      const b = pts[i + 1]
      const dir = Math.sign(b.x - a.x) || 1
      const L = len(i)
      // Before a corner the line is curved (curved style); at the end points (ports) it is not.
      const reach =
        style === 'curved' ? Math.min(L / 2, CURVE_REACH) : style === 'rounded' ? CORNER_RADIUS : 0
      const startPad = (i === 0 ? 6 : reach) + e.width / 2
      const endPad = (i + 1 === last ? 6 : reach) + e.width / 2
      const lo = startPad
      const hi = L - endPad
      const fractions = [0.5, 0.3, 0.7, 0.15, 0.85]

      for (const f of hi > lo ? fractions : [0.5]) {
        const t = hi > lo ? lo + (hi - lo) * f : L / 2

        candidates.push({ x: a.x + dir * t, y: a.y })
      }
    }

    for (let i = 0; i < last; i++) {
      if (isVertical(pts[i], pts[i + 1]))
        candidates.push({ x: pts[i].x, y: (pts[i].y + pts[i + 1].y) / 2 })
    }

    if (!candidates.length) candidates.push(labelPosition(pts))

    let best = candidates[0]
    let bestCost = Infinity

    for (const c of candidates) {
      const r = box(c, e.width)
      let cost = 0

      for (const p of placed) cost += overlap(r, p)
      for (const o of obstacles) cost += overlap(r, o)

      if (cost < bestCost) {
        best = c
        bestCost = cost

        if (cost === 0) break
      }
    }

    placed.push(box(best, e.width))
    result.set(e.id, best)
  }

  return result
}
