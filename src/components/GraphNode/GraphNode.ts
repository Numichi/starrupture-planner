/**
 * @component GraphNode
 *
 * Factory node in the graph.
 *
 * Inputs on the left, outputs on the right, two lines per item:
 *   - top:    the node's flow /min: nominal (machine count × per-machine rate), or, when the
 *             factory can work less, the EFFECTIVE rate (amber),
 *   - bottom: /min per machine; when something is wrong, instead:
 *             on an input "short X" (the bottleneck: the sources could not make it up
 *             either) / "not linked" (assumed supplied) / with an automatic count
 *             "tight −X" (amber): the tight input – the last, partly working machine of the
 *             rounded-up count would need this much more (not a shortage),
 *             on an output "+X surplus" (linked, but not taken) / "output" (unlinked: the
 *             end product); with reduced operation "nom. X".
 *
 * In the middle: the building, the machine count and the power (a fractional machine counts
 * as a whole one). Next to the count the mode: "auto" (from the material reaching the linked
 * inputs: X full + 1 partly working machine) or "manual"; a click toggles it (to manual with
 * the current count). Clicking the count lets you type it (becomes manual; Enter / clicking
 * elsewhere: done, Esc: cancel). These stop `pointerdown`, so they do not start a drag.
 *
 * In the header: ⚠ (amber) when the recipe has no cycle time data – it computes with 0
 * ("no data" on the ports) or with the manual cycle time (`components/missingData.ts`; the
 * explanation is in the tooltip of the mark); "50%" (amber) when the factory only works that
 * much because of its input; ↑ when it has an upgraded or base variant (right-click › Upgrade).
 *
 * Sizes and port (icon) positions are NOT set here but in `engine/nodeGeometry.ts`, because
 * the edges work from there too.
 *
 * Events (handled by ProductionGraph):
 *   - `port`: pointer press on an item row (click: port picker, drag: link to another node),
 *   - `pointerdown` / `contextmenu` on the root `<g>`: selection, drag, menu.
 */
import { computed, defineComponent, nextTick, ref, watch, type PropType } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import type { PortDown } from '@/components/graphEvents'
import { rateNote } from '@/components/missingData'
import { fitText, textWidth } from '@/components/textFit'
import { usePlanner } from '@/composables/usePlanner'
import { EPSILON, RATE_UNIT_LABEL } from '@/config'
import { formatCount, formatPower, formatQuantity, formatRate } from '@/engine/format'
import type { PositionedNode } from '@/engine/layout'
import { NODE, portPosition } from '@/engine/nodeGeometry'
import type { PlanPort } from '@/engine/plan'
import type { CountMode } from '@/engine/projectModel'
import { useProject } from '@/project/projectStore'
import { parseNodeId } from '@/project/types'

/** Item icon size on the port rows, px. */
const ICON = 16

/** Building icon next to the machine count, px (not shown when the image does not load). */
const BUILDING_ICON = 24

/** Gap between the machine count and the auto / manual pill, px. */
const MODE_GAP = 5

/** Maximum width of the count row: when it does not fit with the icon, the icon is dropped. */
const COUNT_ROW_MAX = 110

/** Width of the count input, px. */
const EDIT_WIDTH = 72

/** The lower line of a port row: text and tone. */
interface PortStatus {
  text: string
  tone: '' | 'bad' | 'warn' | 'out'
}

export default defineComponent({
  name: 'GraphNode',

  components: { ItemIcon },

  props: {
    pos: { type: Object as PropType<PositionedNode>, required: true },

    /** Another node is highlighted → this one is fainter. */
    dimmed: { type: Boolean, default: false },

    selected: { type: Boolean, default: false },
    highlighted: { type: Boolean, default: false },
  },

  emits: {
    port: (_e: PortDown) => true,
  },

  setup(props, { emit }) {
    const { index } = usePlanner()
    const { setFactoryCount } = useProject()
    const u = RATE_UNIT_LABEL

    const node = computed(() => props.pos.node)
    const w = computed(() => props.pos.width)
    const h = computed(() => props.pos.height)

    function onPort(dir: 'in' | 'out', item: string, e: PointerEvent) {
      emit('port', { nodeId: node.value.id, dir, item, event: e })
    }

    /** The header shape: rounded top corners, flat bottom. */
    const headerPath = computed(() => {
      const r = 6
      const hh = NODE.headerHeight

      return `M0,${hh} V${r} A${r},${r} 0 0 1 ${r},0 H${w.value - r} A${r},${r} 0 0 1 ${w.value},${r} V${hh} Z`
    })

    const inputRows = computed(() =>
      node.value.inputs.map((p, i) => ({ p, y: portPosition(node.value, 'in', i).y })),
    )
    const outputRows = computed(() =>
      node.value.outputs.map((p, i) => ({ p, y: portPosition(node.value, 'out', i).y })),
    )

    /** The factory works less than its machine count because of its input. */
    const reduced = computed(() => (node.value.utilization ?? 1) < 1 - 1e-6)
    const percent = computed(() => `${Math.round((node.value.utilization ?? 1) * 100)}%`)
    const percentWidth = computed(() => textWidth(percent.value, 10, 700) + 12)

    /** The recipe has no cycle time data (computes with 0, or with a manual cycle time): ⚠ in the header. */
    const note = computed(() => rateNote(node.value.recipe))
    const noData = computed(() => note.value?.kind === 'missing')

    /** The upper line of a port: nominal, or the effective rate with reduced operation; "?" without data. */
    const shownRate = (p: PlanPort) =>
      noData.value
        ? '?'
        : formatRate(reduced.value && p.effective !== undefined ? p.effective : p.rate)

    /** The lower line of a port: the per-machine rate, or the problem. */
    function status(p: PlanPort, dir: 'in' | 'out'): PortStatus {
      if (noData.value) return { text: 'no data', tone: 'warn' }

      if (dir === 'in') {
        if (!p.linked) return { text: 'not linked', tone: 'bad' }
        if (p.gap > EPSILON) return { text: `short ${formatRate(p.gap)}`, tone: 'bad' }

        // Automatic count: the tight input – the last (partly working) machine would need this much more.
        if ((p.partial ?? 0) > EPSILON)
          return { text: `tight −${formatRate(p.partial ?? 0)}`, tone: 'warn' }
      } else {
        if (p.linked && p.gap > EPSILON)
          return { text: `+${formatRate(p.gap)} surplus`, tone: 'warn' }
        if (!p.linked && !reduced.value) return { text: 'output', tone: 'out' }
      }

      if (reduced.value) return { text: `nom. ${formatRate(p.rate)}`, tone: 'warn' }

      return { text: `${formatRate(p.perBuilding ?? 0)} / machine`, tone: '' }
    }

    const buildingIconFailed = ref(false)

    watch(
      () => node.value.building?.icon,
      () => (buildingIconFailed.value = false),
    )

    const countText = computed(() => `${formatCount(node.value.count)}×`)
    const countWidth = computed(() => textWidth(countText.value, 19, 700))

    // --- Machine count mode: automatic / manual (toggled in the box, the number can be typed) ---

    const mode = computed<CountMode>(() => node.value.countMode ?? 'manual')
    const modeText = computed(() => (mode.value === 'manual' ? 'manual' : 'auto'))
    const modeWidth = computed(() => textWidth(modeText.value, 9, 700) + 10)

    const showBuildingIcon = computed(
      () =>
        !!node.value.building?.icon &&
        !buildingIconFailed.value &&
        BUILDING_ICON + 5 + countWidth.value + MODE_GAP + modeWidth.value <= COUNT_ROW_MAX,
    )

    const countRowStart = computed(() => {
      const total =
        (showBuildingIcon.value ? BUILDING_ICON + 5 : 0) +
        countWidth.value +
        MODE_GAP +
        modeWidth.value

      return w.value / 2 - total / 2
    })

    const countX = computed(
      () => countRowStart.value + (showBuildingIcon.value ? BUILDING_ICON + 5 : 0),
    )
    const modeX = computed(() => countX.value + countWidth.value + MODE_GAP)

    const modeTitle = computed(() => {
      switch (mode.value) {
        case 'auto':
          return (
            'Automatic machine count: as many machines as the material reaching the linked inputs feeds ' +
            '(X full machines + 1 partly working one when it is not exact).\nClick: manual (with the current count).'
          )

        case 'auto-fallback':
          return (
            'Automatic, but no linked input to size it from: the typed machine count is used.\n' +
            'Click: manual (with the current count).'
          )

        default:
          return 'Manual machine count: runs with the count you typed.\nClick: automatic (from the material reaching the inputs).'
      }
    })

    const factoryId = computed(() => parseNodeId(node.value.id).id)

    function toggleMode() {
      if (mode.value === 'manual') setFactoryCount(factoryId.value, 'auto')
      else setFactoryCount(factoryId.value, node.value.count)
    }

    // --- Typing the count in the box: click → input; Enter / click elsewhere: manual count; Esc: cancel ---

    const editingCount = ref(false)
    const countInput = ref<HTMLInputElement | null>(null)

    /** The initial value of the input: when nothing was typed, it does not switch to manual. */
    const editStart = ref('')

    async function startEdit() {
      editStart.value = String(Math.round(node.value.count * 1e6) / 1e6)
      editingCount.value = true

      await nextTick()
      countInput.value?.focus()
      countInput.value?.select()
    }

    function commitEdit() {
      if (!editingCount.value) return

      editingCount.value = false

      const text = countInput.value?.value.trim() ?? ''

      if (!text || text === editStart.value) return

      const n = Number(text.replace(',', '.'))

      if (Number.isFinite(n) && n >= 0) setFactoryCount(factoryId.value, n)
    }

    function cancelEdit() {
      editingCount.value = false
    }

    function onCountKey(e: KeyboardEvent) {
      if (e.key === 'Enter') commitEdit()
      else if (e.key === 'Escape') cancelEdit()
      else return

      e.preventDefault()
      e.stopPropagation()
    }

    /** Power; with a fractional count the number of machines to place in brackets (they all consume). */
    const powerText = computed(() => {
      const n = node.value
      const frac = Math.abs(n.count - Math.round(n.count)) > 1e-6

      return `⚡ ${formatPower(n.power)}${frac ? ` (${formatQuantity(n.placed, 'machine')})` : ''}`
    })

    const titleX = computed(() => (note.value ? 26 : 10))

    const titleText = computed(() =>
      fitText(
        node.value.title,
        w.value -
          titleX.value -
          10 -
          (node.value.upgradable ? 16 : 0) -
          (reduced.value ? percentWidth.value + 6 : 0),
        12,
        650,
      ),
    )

    const buildingText = computed(() =>
      fitText(node.value.building?.name ?? '', w.value - 2 * NODE.sideColumnWidth - 8, 10.5),
    )

    const centerY = computed(() => NODE.headerHeight + (h.value - NODE.headerHeight) / 2)
    const shortInputs = computed(() => node.value.inputs.some((p) => p.gap > EPSILON))

    /** Explanation of the percentage: rounding up for an automatic count, too little input for a manual one. */
    const percentTitle = computed(() =>
      mode.value === 'auto'
        ? `Automatic machine count: material for ${formatCount(node.value.effectiveCount ?? 0)} machines arrives, ` +
          `rounded up to ${formatCount(node.value.count)} machines; together they work at ${percent.value} (the last one partly)`
        : `The factory only works at ${percent.value}: one of its linked inputs gets less than it needs`,
    )

    /** X position of the percentage pill in the header. */
    const percentX = computed(
      () => w.value - 10 - (node.value.upgradable ? 16 : 0) - percentWidth.value,
    )

    /** Browser tooltip (mouse over the node): exact numbers. */
    const tooltip = computed(() => {
      const n = node.value
      const name = (id: string) => index.value.item(id).name

      const line = (p: PlanPort, dir: 'in' | 'out') =>
        `  ${name(p.item)}: ${formatRate(p.rate)} ${u} (per machine ${formatRate(p.perBuilding ?? 0)})` +
        (reduced.value && p.effective !== undefined
          ? `, effective ${formatRate(p.effective)}`
          : '') +
        (p.gap > EPSILON
          ? dir === 'in'
            ? ` – short ${formatRate(p.gap)}`
            : ` – left over ${formatRate(p.gap)}`
          : '') +
        ((p.partial ?? 0) > EPSILON
          ? ` – the rounded count would need ${formatRate(p.partial ?? 0)} more`
          : '')

      const modeNote =
        mode.value === 'auto'
          ? ', automatic'
          : mode.value === 'auto-fallback'
            ? ', automatic – nothing to size it from'
            : ', manual'
      const parts = [n.building ? `${n.title} – ${n.building.name}` : n.title]

      parts.push(
        `Machines: ${formatCount(n.count)}${modeNote} (to place: ${n.placed})`,
        `Power: ${formatPower(n.power)}`,
      )

      if (reduced.value) {
        const effective = `Effective: ${formatCount(n.effectiveCount ?? 0)} machines (${percent.value})`

        parts.push(
          mode.value === 'auto'
            ? `${effective} – that much material arrives; the count is rounded up.`
            : `${effective} – its linked input is short, so its output is lower by as much.`,
        )
      }

      if (n.warning) parts.push(`⚠ ${n.warning}`)
      if (note.value) parts.push(`⚠ ${note.value.text}`)
      if (n.inputs.length) parts.push('In:', ...n.inputs.map((p) => line(p, 'in')))
      if (n.outputs.length) parts.push('Out:', ...n.outputs.map((p) => line(p, 'out')))

      parts.push(
        'Click: edit · right-click: menu · item row: link · count: type · auto/manual: toggle',
      )

      return parts.join('\n')
    })

    const rootClass = computed(() => ({
      'node--dimmed': props.dimmed,
      'node--selected': props.selected,
      'node--highlighted': props.highlighted,
      'node--warn': node.value.warning || shortInputs.value,
    }))

    return {
      index,
      node,
      w,
      h,
      onPort,
      headerPath,
      inputRows,
      outputRows,
      reduced,
      percent,
      percentWidth,
      percentX,
      percentTitle,
      note,
      shownRate,
      status,
      buildingIconFailed,
      countText,
      countWidth,
      mode,
      modeText,
      modeWidth,
      showBuildingIcon,
      countRowStart,
      countX,
      modeX,
      modeTitle,
      toggleMode,
      editingCount,
      countInput,
      editStart,
      startEdit,
      commitEdit,
      onCountKey,
      powerText,
      titleX,
      titleText,
      buildingText,
      centerY,
      tooltip,
      rootClass,
      NODE,
      ICON,
      BUILDING_ICON,
      EDIT_WIDTH,
      RATE_UNIT_LABEL,
    }
  },
})
