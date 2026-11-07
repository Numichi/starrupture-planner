/**
 * @module composables/usePanZoom
 *
 * Zooming and panning on the SVG canvas, without an external library.
 *
 *   - mouse wheel: zoom around the cursor (two-finger scroll on a touchpad: pan)
 *   - `panBy()`: shifts the view (ProductionGraph calls it while dragging with the right /
 *     middle button, or with Space + left button)
 *   - `toWorld()`: screen point → canvas coordinate (placing, selection)
 *   - `fitTo()`: fits the whole content into the view
 *
 * Usage in a component:
 * ```ts
 * const svgEl = ref<SVGSVGElement | null>(null)
 * const pz = usePanZoom(svgEl)
 * // <svg ref="svgEl" @wheel.prevent="pz.onWheel"> <g :transform="pz.transform.value"> … </g>
 * ```
 */
import { computed, ref, type Ref } from 'vue'

/** Smallest zoom factor. */
const MIN_SCALE = 0.1

/** Largest zoom factor. */
const MAX_SCALE = 3

/** Pan / zoom state of one SVG element. */
export function usePanZoom(svgEl: Ref<SVGSVGElement | null>) {
  const scale = ref(1)
  const tx = ref(0)
  const ty = ref(0)

  const transform = computed(() => `translate(${tx.value},${ty.value}) scale(${scale.value})`)

  /** Zooms by `factor` so that the screen point (cx, cy) stays in place. */
  function zoomAt(factor: number, cx: number, cy: number) {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value * factor))
    const k = next / scale.value

    tx.value = cx - (cx - tx.value) * k
    ty.value = cy - (cy - ty.value) * k
    scale.value = next
  }

  function onWheel(e: WheelEvent) {
    const rect = svgEl.value?.getBoundingClientRect()

    if (!rect) return

    // Two-finger touchpad scroll (horizontal component, without Ctrl): pan.
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.5 && Math.abs(e.deltaX) > 0

    if (!e.ctrlKey && horizontal && e.deltaMode === 0) {
      panBy(-e.deltaX, -e.deltaY)

      return
    }

    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
  }

  function panBy(dx: number, dy: number) {
    tx.value += dx
    ty.value += dy
  }

  /** Screen (client) point → canvas coordinate. */
  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgEl.value?.getBoundingClientRect()
    const x = clientX - (rect?.left ?? 0)
    const y = clientY - (rect?.top ?? 0)

    return { x: (x - tx.value) / scale.value, y: (y - ty.value) / scale.value }
  }

  /** Centres the given content (in canvas coordinates) and zooms it into the view. */
  function fitTo(bounds: { x: number; y: number; width: number; height: number }) {
    const rect = svgEl.value?.getBoundingClientRect()

    if (!rect || !bounds.width || !bounds.height) return

    const s = Math.min(rect.width / bounds.width, rect.height / bounds.height, 1)

    scale.value = Math.max(MIN_SCALE, s)
    tx.value = (rect.width - bounds.width * scale.value) / 2 - bounds.x * scale.value
    ty.value = (rect.height - bounds.height * scale.value) / 2 - bounds.y * scale.value
  }

  /** Puts the content point (x, y) into the centre of the view (at least at `minScale`). */
  function centerOn(x: number, y: number, minScale = 0.8) {
    const rect = svgEl.value?.getBoundingClientRect()

    if (!rect) return

    scale.value = Math.max(scale.value, minScale)
    tx.value = rect.width / 2 - x * scale.value
    ty.value = rect.height / 2 - y * scale.value
  }

  /** Zooms around the centre of the view. */
  function zoomBy(factor: number) {
    const rect = svgEl.value?.getBoundingClientRect()

    if (rect) zoomAt(factor, rect.width / 2, rect.height / 2)
  }

  return { scale, tx, ty, transform, onWheel, panBy, toWorld, fitTo, zoomBy, centerOn }
}
