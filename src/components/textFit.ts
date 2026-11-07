/**
 * @module components/textFit
 *
 * Fitting text into the SVG nodes.
 *
 * SVG text does not wrap, and the nodes have a fixed width (`engine/nodeGeometry.ts`). The
 * English game names can be long ("Intermediate Building Material"), so whatever does not
 * fit is truncated with "…"; the full name stays in the node tooltip (`<title>`).
 *
 * The browser measures the width (canvas `measureText`) with the UI font, so it is exact.
 * Without a browser (e.g. from a test) it estimates.
 */

let ctx: CanvasRenderingContext2D | null | undefined
let family = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const cache = new Map<string, number>()

/** The shared measuring context (created lazily; null without a DOM). */
function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx

  try {
    ctx = document.createElement('canvas').getContext('2d')

    const cssFont = getComputedStyle(document.documentElement).getPropertyValue('--font').trim()

    if (cssFont) family = cssFont
  } catch {
    ctx = null
  }

  return ctx
}

/** The width of a text in pixels, at the given font size and weight. */
export function textWidth(text: string, fontSize: number, weight = 400): number {
  const key = `${weight}|${fontSize}|${text}`
  const hit = cache.get(key)

  if (hit !== undefined) return hit

  const c = context()
  let width: number

  if (c) {
    c.font = `${weight} ${fontSize}px ${family}`
    width = c.measureText(text).width
  } else {
    width = text.length * fontSize * (weight >= 600 ? 0.56 : 0.52)
  }

  cache.set(key, width)

  return width
}

/** The text, truncated with "…" when it is wider than `maxWidth` (binary search on the length). */
export function fitText(text: string, maxWidth: number, fontSize: number, weight = 400): string {
  if (maxWidth <= 0) return ''
  if (textWidth(text, fontSize, weight) <= maxWidth) return text

  let lo = 0
  let hi = text.length - 1

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)

    if (textWidth(text.slice(0, mid).trimEnd() + '…', fontSize, weight) <= maxWidth) lo = mid
    else hi = mid - 1
  }

  return lo > 0 ? text.slice(0, lo).trimEnd() + '…' : '…'
}
