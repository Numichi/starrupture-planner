/**
 * @component LineNode
 *
 * Rail line node – a collector: several sources and items on one drone rail (or on several
 * parallel ones, with mixed tiers).
 *
 *   - header: name, the rail set (e.g. "2× v.1 + v.3") and the mode (auto / manual),
 *   - item rows: the left half is the input, the right half the output (the same item passes
 *     through), with the flow; below them the free inputs (one when dynamic, the rest when
 *     fixed): drag a link onto them (or anywhere on the node),
 *   - footer: the TOTAL flow (all items together) against the capacity, with a bar, and the
 *     state: in auto mode the chosen rail (when even the best is not enough on one rail,
 *     parallel ones are needed), in manual mode the free capacity or the congestion (red:
 *     more is requested than the rail lets through).
 *
 * Left half of an item row: input, right half: output (`port` event).
 * The calculation: `engine/flow.ts` (capacity, congestion), `engine/plan.ts`, `engine/rails.ts`.
 */
import { computed, defineComponent, type PropType } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import type { PortDown } from '@/components/graphEvents'
import { fitText, textWidth } from '@/components/textFit'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import { formatRate } from '@/engine/format'
import type { PositionedNode } from '@/engine/layout'
import { NODE, footerLineY, portPosition } from '@/engine/nodeGeometry'
import { partsLabel, railLabel } from '@/engine/rails'

/** Height of an item row, px. */
const ROW_HEIGHT = 28

/** Width of the load bar in the footer, px. */
const BAR_WIDTH = 84

/** Footer state line: text and tone ('' = neutral). */
interface LineStatus {
  text: string
  tone: '' | 'warn' | 'bad'
}

export default defineComponent({
  name: 'LineNode',

  components: { ItemIcon },

  props: {
    pos: { type: Object as PropType<PositionedNode>, required: true },
    dimmed: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
    highlighted: { type: Boolean, default: false },
  },

  emits: {
    port: (_e: PortDown) => true,
  },

  setup(props, { emit }) {
    const { index } = usePlanner()

    const node = computed(() => props.pos.node)
    const info = computed(() => (node.value.special?.type === 'line' ? node.value.special : null))
    const rail = computed(() => info.value?.rail ?? null)
    const w = computed(() => props.pos.width)
    const h = computed(() => props.pos.height)
    const congested = computed(() => !!info.value?.congested)

    /** In auto mode one rail is not enough: parallel rails are needed. */
    const scaled = computed(() => rail.value?.mode === 'auto' && rail.value.count > 1)

    const rows = computed(() =>
      node.value.inputs.map((p, i) => ({
        p,
        y: portPosition(node.value, 'in', i).y,
        item: index.value.item(p.item),
      })),
    )

    const freeRows = computed(() =>
      Array.from(
        { length: node.value.freeRows ?? 0 },
        (_, k) => portPosition(node.value, 'in', node.value.inputs.length + k).y,
      ),
    )

    const badge = computed(() =>
      rail.value
        ? `${railLabel(rail.value)} · ${rail.value.mode === 'auto' ? 'auto' : 'manual'}`
        : '',
    )
    const badgeWidth = computed(() => textWidth(badge.value, 9.5, 700) + 14)
    const titleText = computed(() =>
      fitText(
        `⇉ ${node.value.title}`,
        w.value - 20 - (badge.value ? badgeWidth.value + 8 : 0),
        12,
        650,
      ),
    )

    const rowName = (name: string, rate: number) =>
      fitText(name, w.value - 40 - textWidth(formatRate(rate), 11, 600) - 20, 11.5)

    // Footer: total flow / capacity, bar, state.
    const total = computed(() => info.value?.total ?? 0)
    const capacity = computed(() => rail.value?.capacity ?? 0)

    /** What the footer shows as the flow: the demand when congested, otherwise the total. */
    const shownTotal = computed(() =>
      congested.value && info.value ? info.value.demand : total.value,
    )

    const fill = computed(() =>
      capacity.value ? Math.min(1, shownTotal.value / capacity.value) : 0,
    )
    const barX = computed(() => w.value - 96)

    const status = computed<LineStatus>(() => {
      const i = info.value
      const r = rail.value

      if (!i || !r) return { text: 'no rail data', tone: '' }

      if (i.congested) {
        return {
          text: `Congestion: ${formatRate(i.demand)} would pass, ${partsLabel(r.needed)} is needed`,
          tone: 'bad',
        }
      }

      if (r.mode === 'auto') {
        if (total.value <= 0) return { text: 'auto: follows the flow', tone: '' }

        return r.count > 1
          ? { text: `auto: ${railLabel(r)} needed (${r.count} parallel rails)`, tone: 'warn' }
          : { text: `auto: ${r.tier.name} is enough (${Math.round(r.load * 100)}%)`, tone: '' }
      }

      return {
        text: `manual: ${formatRate(Math.max(0, r.capacity - total.value))} ${RATE_UNIT_LABEL} free`,
        tone: '',
      }
    })

    const statusText = computed(() => fitText(status.value.text, w.value - 20, 10.5))

    function onPort(dir: 'in' | 'out', item: string, e: PointerEvent) {
      emit('port', { nodeId: node.value.id, dir, item, event: e })
    }

    const tooltip = computed(() => {
      const u = RATE_UNIT_LABEL
      const i = info.value
      const r = rail.value
      const lines = [`Rail line: ${node.value.title}`]

      if (r) {
        lines.push(
          `Rail: ${railLabel(r)} = ${formatRate(r.capacity)} ${u} (${r.mode === 'auto' ? 'automatic' : 'manual'})`,
          `Total flow: ${formatRate(total.value)} ${u} (${Math.round(r.load * 100)}%)`,
        )
      }

      for (const row of rows.value) lines.push(`  ${row.item.name}: ${formatRate(row.p.flow)}`)

      if (i?.congested && r) {
        lines.push(
          `CONGESTION: ${formatRate(i.demand)} would pass, the rail lets ${formatRate(r.capacity)} through. ` +
            `${partsLabel(r.needed)} would be needed.`,
        )
      }

      if (node.value.warning && !i?.congested) lines.push(node.value.warning)

      lines.push('Drag a link from a producer (left) or to a consumer (right). Click: settings.')

      return lines.join('\n')
    })

    const rootClass = computed(() => ({
      'line-node--dimmed': props.dimmed,
      'line-node--selected': props.selected || props.highlighted,
      'line-node--bad': congested.value || !!node.value.warning,
    }))

    /** The header shape: rounded top corners, flat bottom. */
    const headerPath = computed(
      () =>
        `M0,${NODE.headerHeight} V8 A8,8 0 0 1 8,0 H${w.value - 8} A8,8 0 0 1 ${w.value},8 V${NODE.headerHeight} Z`,
    )

    return {
      node,
      info,
      w,
      h,
      congested,
      scaled,
      rows,
      freeRows,
      badge,
      badgeWidth,
      titleText,
      rowName,
      shownTotal,
      capacity,
      fill,
      barX,
      status,
      statusText,
      onPort,
      tooltip,
      rootClass,
      headerPath,
      footerLineY,
      formatRate,
      NODE,
      ROW_HEIGHT,
      BAR_WIDTH,
      RATE_UNIT_LABEL,
    }
  },
})
