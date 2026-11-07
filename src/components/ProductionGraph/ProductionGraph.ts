/**
 * @component ProductionGraph
 *
 * The graph canvas (of the active base) – the node editor.
 *
 * Drawing order (SVG, bottom to top): grid → edge lines → cargo pair markers → edge labels
 * → nodes → selection box / dragged link. Node positions live in the project
 * (`Base.positions`); edge routes come from `engine/layout.ts`.
 *
 * Mouse:
 *   left button on a node        select (Shift/Ctrl: add / remove) and move (selected nodes
 *                                move together); click: editor
 *   left button on empty canvas  selection box; click: clear the selection
 *   left button on an item row   click: port picker (what supplies it / what uses it);
 *                                drag onto another node: link;
 *                                drag onto empty canvas: port picker with only the fitting
 *                                options, the chosen one is placed there, linked
 *   left button on an edge       selects the link and opens its window (rails, distribution
 *                                across parallel rails, manual rail setting)
 *   right button                 menu (canvas: place; node, edge: actions);
 *                                dragging with the right or middle button: pan the view
 *   Space + left drag            pan the view
 *   wheel                        zoom
 *
 * Keys: Delete removes; Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) undo / redo – in the editor fields
 * too (only search fields keep it for their text) –; Ctrl+A selects all; Esc; Ctrl+C /
 * Ctrl+V copy the selected nodes (with the links between them) and paste them at the mouse
 * position; the pasted nodes stay selected.
 */
import { computed, defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import ContextMenu from '@/components/ContextMenu/ContextMenu.vue'
import GraphEdge from '@/components/GraphEdge/GraphEdge.vue'
import GraphNode from '@/components/GraphNode/GraphNode.vue'
import LineNode from '@/components/LineNode/LineNode.vue'
import PortPicker from '@/components/PortPicker/PortPicker.vue'
import SpecialNode from '@/components/SpecialNode/SpecialNode.vue'
import type { MenuState, MenuTarget, PickerState, PortDown } from '@/components/graphEvents'
import { useNotice } from '@/components/notice'
import { useEditorActions } from '@/composables/useEditorActions'
import { usePanZoom } from '@/composables/usePanZoom'
import { usePlanner } from '@/composables/usePlanner'
import { labelBoxWidth, placeLabels } from '@/engine/edgePaths'
import { formatRate } from '@/engine/format'
import type { Point, PositionedEdge } from '@/engine/layout'
import { portPosition } from '@/engine/nodeGeometry'
import type { PlanNode } from '@/engine/plan'
import { railLabel } from '@/engine/rails'
import { useProject } from '@/project/projectStore'

/** Node kinds drawn by SpecialNode. */
const SPECIAL_KINDS = new Set(['mine', 'receiver', 'dispatcher', 'storage', 'railIn', 'railOut'])

/** Below this movement (px) it is a click, above it a drag. */
const DRAG_THRESHOLD = 4

/** Grid for dragging (px, canvas coordinates). */
const GRID = 12

/** How long a node stays highlighted after a jump, ms. */
const FLASH_MS = 2500

/** Popup sizes (for keeping them inside the graph), px. */
const MENU_SIZE = { width: 320, height: 420 }
const PICKER_SIZE = { width: 360, height: 460 }

/** The pointer interaction in progress. */
type Drag =
  | { kind: 'pan'; last: Point; start: Point; moved: boolean; menu: MenuTarget | null }
  | {
      kind: 'box'
      start: Point
      current: Point
      startClient: Point
      additive: boolean
      moved: boolean
    }
  | {
      kind: 'nodes'
      startClient: Point
      ids: string[]
      nodeId: string
      additive: boolean
      moved: boolean
      anchor: Point
    }
  | {
      kind: 'link'
      startClient: Point
      nodeId: string
      dir: 'in' | 'out'
      item: string
      from: Point
      current: Point
      moved: boolean
    }

const client = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY })
const far = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) >= DRAG_THRESHOLD

/** What the pointer event hit: a node, an edge or the canvas (via `data-node-id` / `data-link-id`). */
function targetOf(e: Event): MenuTarget {
  const el = e.target as Element
  const node = el.closest?.('[data-node-id]')

  if (node) return { type: 'node', nodeId: node.getAttribute('data-node-id')! }

  const link = el.closest?.('[data-link-id]')

  if (link) return { type: 'edge', linkId: link.getAttribute('data-link-id')! }

  return { type: 'canvas' }
}

/** Cubic preview path of a dragged link (always drawn from output to input). */
function linkPath(dir: 'in' | 'out', port: Point, end: Point) {
  const [a, b] = dir === 'out' ? [port, end] : [end, port]
  const mid = (a.x + b.x) / 2

  return `M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`
}

// ---------- Keyboard helpers ----------

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null

  return (
    !!t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  )
}

/** A search field (port picker, context menu): Ctrl+Z stays with its typed text. */
function isSearchField(e: KeyboardEvent) {
  const t = e.target as HTMLInputElement | null

  return t?.tagName === 'INPUT' && t.type === 'search'
}

/**
 * Which letter key: the character of the layout (on a Hungarian QWERTZ the key labelled Z
 * is 'z' too); when it is not a Latin letter (e.g. a Cyrillic layout), the physical key.
 */
function keyIs(e: KeyboardEvent, letter: string) {
  const k = e.key.toLowerCase()

  return /^[a-z]$/.test(k) ? k === letter : e.code === `Key${letter.toUpperCase()}`
}

/** Whether text is selected on the page (then Ctrl+C belongs to the text, not to the nodes). */
function hasTextSelection() {
  return !!window.getSelection()?.toString()
}

export default defineComponent({
  name: 'ProductionGraph',

  components: { ContextMenu, GraphEdge, GraphNode, LineNode, PortPicker, SpecialNode },

  setup() {
    const { layout, statusMessage, loadState, loadError, display, dragOffset } = usePlanner()
    const store = useProject()
    const { editing, focus, activeBaseId, selection, selectedLink, goTo, canUndo, canRedo } = store
    const actions = useEditorActions()
    const { notice, notify } = useNotice()

    const svgEl = ref<SVGSVGElement | null>(null)
    const rootEl = ref<HTMLDivElement | null>(null)
    const pz = usePanZoom(svgEl)

    const maxRate = computed(() => Math.max(0, ...layout.value.edges.map((e) => e.rate)))

    /**
     * The positions of the edge labels: all together, so they do not overlap (e.g. the labels
     * of branches from one output to several consumers go after the fork, on the branches).
     */
    const labelPositions = computed(() =>
      placeLabels(
        layout.value.edges.map((e) => {
          const badge = display.showRails && e.edge.rail ? railLabel(e.edge.rail) : ''
          const first = e.points[0]
          const last = e.points[e.points.length - 1]

          return {
            id: e.edge.id,
            points: e.points,
            width: labelBoxWidth(formatRate(e.rate), badge, e.edges.length).width,

            // Lines leaving from / arriving at the same point (port or comb point).
            fromPort: `${first.x},${first.y}`,
            toPort: `${last.x},${last.y}`,
          }
        }),
        layout.value.nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
        display.lineStyle,
      ),
    )

    const selectedSet = computed(() => new Set(selection.value))

    // ==========================================================================
    // Highlight under the mouse, cargo pair markers
    // ==========================================================================

    const hovered = ref<string | null>(null)

    /** The node highlighted for a few seconds after a jump. */
    const flashed = ref<string | null>(null)

    function pairNodeIds(n: PlanNode | undefined): string[] {
      const s = n?.special

      if (s?.type === 'receiver') return s.pairs.filter((p) => p.sameBase).map((p) => p.nodeId)
      if (s?.type === 'dispatcher' && s.pair?.sameBase) return [s.pair.nodeId]

      return []
    }

    const hoveredNode = computed(() => layout.value.nodes.find((n) => n.node.id === hovered.value))
    const hoveredPairs = computed(() => new Set(pairNodeIds(hoveredNode.value?.node)))

    const connectedEdges = computed(() => {
      const id = hovered.value

      if (!id) return null

      return new Set(
        layout.value.edges
          .filter((e) => e.edge.from === id || e.edge.to === id)
          .map((e) => e.edge.id),
      )
    })

    const connectedNodes = computed(() => {
      const id = hovered.value

      if (!id) return null

      const set = new Set([id])

      for (const e of layout.value.edges) {
        if (e.edge.from === id) set.add(e.edge.to)
        if (e.edge.to === id) set.add(e.edge.from)
      }

      hoveredPairs.value.forEach((p) => set.add(p))

      return set
    })

    /** Whether the selected link runs on this rail (line). */
    const isSelectedRail = (e: PositionedEdge) =>
      !!selectedLink.value && e.edges.some((x) => x.linkId === selectedLink.value)

    const edgeDimmed = (id: string) =>
      connectedEdges.value !== null && !connectedEdges.value.has(id)
    const nodeDimmed = (id: string) =>
      connectedNodes.value !== null && !connectedNodes.value.has(id)
    const edgeHighlighted = (id: string) => !!connectedEdges.value?.has(id)

    const pairMarkers = computed(() => {
      const a = hoveredNode.value

      if (!a) return []

      return layout.value.nodes
        .filter((b) => hoveredPairs.value.has(b.node.id))
        .map((b) => ({
          id: b.node.id,
          x1: a.x + a.width / 2,
          y1: a.y + a.height / 2,
          x2: b.x + b.width / 2,
          y2: b.y + b.height / 2,
        }))
    })

    // ==========================================================================
    // Pointer: pan, selection, drag, link, menu
    // ==========================================================================

    const drag = ref<Drag | null>(null)
    const spaceDown = ref(false)
    const menu = ref<MenuState | null>(null)
    const picker = ref<PickerState | null>(null)

    function capture(e: PointerEvent) {
      try {
        svgEl.value?.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer may already be gone: nothing to capture */
      }
    }

    function closePopups() {
      menu.value = null
      picker.value = null
    }

    function onPointerDown(e: PointerEvent) {
      closePopups()

      if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceDown.value)) {
        const menuTarget = e.button === 2 ? targetOf(e) : null

        drag.value = {
          kind: 'pan',
          last: client(e),
          start: client(e),
          moved: false,
          menu: menuTarget,
        }
        capture(e)
        e.preventDefault()

        return
      }

      if (e.button !== 0) return

      const t = targetOf(e)

      if (t.type === 'edge') {
        // Link: select it (Delete removes it) and open its window (rails, distribution, manual rail).
        selection.value = []
        selectedLink.value = t.linkId
        editing.value = { kind: 'link', id: t.linkId, baseId: activeBaseId.value }

        return
      }

      if (t.type === 'node') {
        const additive = e.shiftKey || e.ctrlKey || e.metaKey
        const wasSelected = selectedSet.value.has(t.nodeId)

        if (!wasSelected) store.select([t.nodeId], additive)

        // The selected nodes move together; when this one was not selected, only it (or with Shift, with the others).
        const ids = selection.value.includes(t.nodeId) ? selection.value : [t.nodeId]
        const n = layout.value.nodes.find((x) => x.node.id === t.nodeId)

        drag.value = {
          kind: 'nodes',
          startClient: client(e),
          ids: [...ids],
          nodeId: t.nodeId,
          additive: additive && wasSelected,
          moved: false,
          anchor: { x: n?.x ?? 0, y: n?.y ?? 0 },
        }
        capture(e)

        return
      }

      const w = pz.toWorld(e.clientX, e.clientY)

      drag.value = {
        kind: 'box',
        start: w,
        current: w,
        startClient: client(e),
        additive: e.shiftKey || e.ctrlKey || e.metaKey,
        moved: false,
      }
      capture(e)
    }

    /** Press on an item row: click = port picker, drag = link. */
    function onPortDown(p: PortDown) {
      const e = p.event

      if (e.button !== 0 || spaceDown.value) {
        onPointerDown(e)

        return
      }

      closePopups()

      const n = layout.value.nodes.find((x) => x.node.id === p.nodeId)

      if (!n) return

      const list = p.dir === 'in' ? n.node.inputs : n.node.outputs
      const i = Math.max(
        0,
        list.findIndex((x) => x.item === p.item),
      )
      const pp = portPosition(n.node, p.dir, i)
      const from = { x: n.x + pp.x, y: n.y + pp.y }

      drag.value = {
        kind: 'link',
        startClient: client(e),
        nodeId: p.nodeId,
        dir: p.dir,
        item: p.item,
        from,
        current: from,
        moved: false,
      }
      capture(e)
    }

    function snap(v: number) {
      return display.snapToGrid ? Math.round(v / GRID) * GRID : v
    }

    /** The last pointer position on the canvas (a paste goes there); null when it is off the canvas. */
    const pointerWorld = ref<Point | null>(null)

    function onPointerMove(e: PointerEvent) {
      pointerWorld.value = pz.toWorld(e.clientX, e.clientY)

      const d = drag.value

      if (!d) {
        const t = targetOf(e)

        hovered.value = t.type === 'node' ? t.nodeId : null

        return
      }

      switch (d.kind) {
        case 'pan': {
          if (!d.moved && !far(d.start, client(e))) return

          d.moved = true
          pz.panBy(e.clientX - d.last.x, e.clientY - d.last.y)
          d.last = client(e)
          break
        }

        case 'box':
          if (!d.moved && !far(d.startClient, client(e))) return

          d.moved = true
          d.current = pz.toWorld(e.clientX, e.clientY)
          break

        case 'nodes': {
          if (!d.moved && !far(d.startClient, client(e))) return

          d.moved = true
          hovered.value = null

          const rawDx = (e.clientX - d.startClient.x) / pz.scale.value
          const rawDy = (e.clientY - d.startClient.y) / pz.scale.value
          // The grabbed node snaps to the grid, the others move by the same amount.
          const dx = snap(d.anchor.x + rawDx) - d.anchor.x
          const dy = snap(d.anchor.y + rawDy) - d.anchor.y

          dragOffset.value = { ids: new Set(d.ids), dx, dy }
          break
        }

        case 'link':
          if (!d.moved && !far(d.startClient, client(e))) return

          d.moved = true
          d.current = pz.toWorld(e.clientX, e.clientY)
          break
      }
    }

    function onPointerUp(e: PointerEvent) {
      const d = drag.value

      drag.value = null

      try {
        svgEl.value?.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured: nothing to release */
      }

      if (!d) return

      switch (d.kind) {
        case 'pan':
          if (!d.moved && d.menu) openMenu(d.menu, e)

          break

        case 'box': {
          if (!d.moved) {
            store.select([])
            selectedLink.value = null
            editing.value = null
            break
          }

          const x1 = Math.min(d.start.x, d.current.x)
          const x2 = Math.max(d.start.x, d.current.x)
          const y1 = Math.min(d.start.y, d.current.y)
          const y2 = Math.max(d.start.y, d.current.y)
          const hit = layout.value.nodes
            .filter((n) => n.x < x2 && n.x + n.width > x1 && n.y < y2 && n.y + n.height > y1)
            .map((n) => n.node.id)

          store.select(hit, d.additive)

          if (selection.value.length !== 1) editing.value = null

          break
        }

        case 'nodes': {
          const off = dragOffset.value

          dragOffset.value = null

          if (d.moved && off) {
            store.moveNodes(activeBaseId.value, d.ids, off.dx, off.dy)
            break
          }

          // Click: selection (Shift/Ctrl: removes an already selected node) and the editor.
          if (d.additive) {
            selection.value = selection.value.filter((x) => x !== d.nodeId)
          } else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
            store.select([d.nodeId])
            editing.value = store.editTargetOf(d.nodeId)
          }

          break
        }

        case 'link': {
          if (!d.moved) {
            openPicker(d.nodeId, d.dir, d.item, e)
            break
          }

          const el = document.elementFromPoint(e.clientX, e.clientY)
          const targetId = el?.closest('[data-node-id]')?.getAttribute('data-node-id')

          if (targetId === d.nodeId) break

          if (!targetId) {
            // Dropped on empty canvas: the picker offers what fits here, and places it there.
            const at = dropPoint(d.from, pz.toWorld(e.clientX, e.clientY))

            openPicker(d.nodeId, d.dir, d.item, e, { at, from: d.from })
            break
          }

          const error =
            d.dir === 'out'
              ? actions.connect(d.nodeId, targetId, d.item)
              : actions.connect(targetId, d.nodeId, d.item)

          if (error) notify(error, 'bad')

          break
        }
      }
    }

    function onPointerCancel() {
      drag.value = null
      dragOffset.value = null
    }

    function onPointerLeave() {
      if (!drag.value) hovered.value = null

      pointerWorld.value = null
    }

    /** The selection box (in canvas coordinates). */
    const boxRect = computed(() => {
      const d = drag.value

      if (d?.kind !== 'box' || !d.moved) return null

      return {
        x: Math.min(d.start.x, d.current.x),
        y: Math.min(d.start.y, d.current.y),
        width: Math.abs(d.current.x - d.start.x),
        height: Math.abs(d.current.y - d.start.y),
      }
    })

    /** The line of the dragged link. */
    const linkLine = computed(() => {
      const d = drag.value

      if (d?.kind !== 'link' || !d.moved) return null

      return linkPath(d.dir, d.from, d.current)
    })

    /** A link dropped on empty canvas: the line stays while the picker is open. */
    const pendingLink = computed(() => {
      const p = picker.value

      return p?.drop ? { d: linkPath(p.dir, p.drop.from, p.drop.at), at: p.drop.at } : null
    })

    /** Where the port of the new node goes: snapped to the grid, and when close, at the port height (straight line). */
    function dropPoint(port: Point, at: Point): Point {
      return { x: snap(at.x), y: Math.abs(at.y - port.y) < 2 * GRID ? port.y : snap(at.y) }
    }

    // ==========================================================================
    // Menu and port picker
    // ==========================================================================

    /** @param leftOf open to the left of the point (by default to the right, downwards) */
    function popupPosition(
      e: { clientX: number; clientY: number },
      width: number,
      height: number,
      leftOf = false,
    ) {
      const rect = rootEl.value!.getBoundingClientRect()
      const x = e.clientX - rect.left

      return {
        left: Math.max(8, Math.min(leftOf ? x - width - 4 : x + 4, rect.width - width - 8)),
        top: Math.max(8, Math.min(e.clientY - rect.top + 4, rect.height - height - 8)),
      }
    }

    function openMenu(target: MenuTarget, e: PointerEvent) {
      if (!rootEl.value) return

      if (target.type === 'node' && !selectedSet.value.has(target.nodeId))
        store.select([target.nodeId])
      if (target.type === 'edge') selectedLink.value = target.linkId

      menu.value = {
        target,
        ...popupPosition(e, MENU_SIZE.width, MENU_SIZE.height),
        world: pz.toWorld(e.clientX, e.clientY),
      }
    }

    /** A new picker (another port or another drop point) = a new component, with a clean search. */
    const pickerKey = computed(() => {
      const p = picker.value

      return p
        ? [p.nodeId, p.dir, p.item, p.drop ? `${p.drop.at.x},${p.drop.at.y}` : ''].join('|')
        : ''
    })

    function openPicker(
      nodeId: string,
      dir: 'in' | 'out',
      item: string,
      e: PointerEvent,
      drop?: PickerState['drop'],
    ) {
      if (!rootEl.value) return

      editing.value = null

      // Dragged from an input it opens to the left, so it does not cover the node it came from.
      const position = popupPosition(
        e,
        PICKER_SIZE.width,
        PICKER_SIZE.height,
        !!drop && dir === 'in',
      )

      picker.value = { nodeId, dir, item, ...position, drop }
    }

    // ==========================================================================
    // Keys
    // ==========================================================================

    /**
     * Undo / redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Cmd on a Mac). Works everywhere, in the
     * editor fields too (the field values live in the project, the project snapshots are
     * restored), except in search fields. A half-typed field value is committed first (the
     * field loses focus), and the undo undoes that too.
     */
    function undoRedo(e: KeyboardEvent, redo: boolean) {
      e.preventDefault()

      const el = document.activeElement
      const isField =
        el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)

      if (isField && el !== document.body) el.blur()

      closePopups()

      if (redo) store.redo()
      else store.undo()
    }

    function onKeyDown(e: KeyboardEvent) {
      // AltGr (Ctrl+Alt on Windows) is not a command.
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey

      if (mod && (keyIs(e, 'z') || keyIs(e, 'y')) && !isSearchField(e)) {
        undoRedo(e, keyIs(e, 'y') || e.shiftKey)

        return
      }

      if (isTyping(e)) return

      if (e.code === 'Space') {
        spaceDown.value = true
        e.preventDefault()
      } else if (mod && keyIs(e, 'c') && !hasTextSelection()) {
        if (!selection.value.length) return

        e.preventDefault()

        const m = actions.copyNodes(selection.value)

        if (m) notify(m.text, m.tone)
      } else if (mod && keyIs(e, 'v')) {
        e.preventDefault()
        closePopups()

        const p = pointerWorld.value
        const m = actions.pasteNodes(p ? { x: snap(p.x), y: snap(p.y) } : undefined)

        if (m) notify(m.text, m.tone)
      } else if (mod && keyIs(e, 'a')) {
        e.preventDefault()
        store.select(layout.value.nodes.map((n) => n.node.id))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLink.value) {
          // A line is one rail: all its items are deleted.
          store.removeRail(activeBaseId.value, selectedLink.value)
        } else if (selection.value.length) {
          store.removeNodes(activeBaseId.value, [...selection.value])
        }
      } else if (e.key === 'Escape') {
        closePopups()
        store.select([])
        selectedLink.value = null
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') spaceDown.value = false
    }

    onMounted(() => {
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
    })

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    })

    // ==========================================================================
    // View: fit on base change, jump to a node
    // ==========================================================================

    let fittedBase = ''
    let flashTimer: ReturnType<typeof setTimeout> | undefined

    function fit() {
      pz.fitTo(layout.value.bounds)
    }

    watch([layout, focus], async ([l]) => {
      if (!l.nodes.length) return

      // On a new base (or the first drawing) the whole content goes into the view once.
      if (fittedBase !== activeBaseId.value && !l.missing.length) {
        fittedBase = activeBaseId.value
        await nextTick()
        fit()
      }

      const f = focus.value

      if (!f || f.baseId !== activeBaseId.value) return

      const target = l.nodes.find((n) => n.node.id === f.nodeId)

      if (!target) return

      await nextTick()
      pz.centerOn(target.x + target.width / 2, target.y + target.height / 2)
      flashed.value = target.node.id
      focus.value = null
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => (flashed.value = null), FLASH_MS)
    })

    watch(activeBaseId, () => {
      hovered.value = null
      closePopups()
    })

    const zoomPercent = computed(() => `${Math.round(pz.scale.value * 100)}%`)
    const showHelp = ref(false)

    const cursorClass = computed(() => {
      const d = drag.value

      if (d?.kind === 'pan') return 'graph-svg--panning'
      if (spaceDown.value) return 'graph-svg--pan-ready'
      if (d?.kind === 'link') return 'graph-svg--linking'

      return ''
    })

    return {
      // state
      layout,
      statusMessage,
      loadState,
      loadError,
      notice,
      canUndo,
      canRedo,
      svgEl,
      rootEl,
      maxRate,
      labelPositions,
      selectedSet,
      flashed,
      hoveredPairs,
      pairMarkers,
      menu,
      picker,
      pickerKey,
      boxRect,
      linkLine,
      pendingLink,
      zoomPercent,
      showHelp,
      cursorClass,

      // view
      transform: pz.transform,
      onWheel: pz.onWheel,
      zoomBy: pz.zoomBy,
      fit,

      // queries
      isSelectedRail,
      edgeDimmed,
      edgeHighlighted,
      nodeDimmed,

      // events
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onPortDown,
      goTo,
      undo: store.undo,
      redo: store.redo,
      SPECIAL_KINDS,
    }
  },
})
