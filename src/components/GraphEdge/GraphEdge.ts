/**
 * @component GraphEdge
 *
 * One line (drone rail) in the graph, with its label – one rail between two nodes.
 *
 * The links between the same two nodes (one per item) run on ONE rail, so they are one
 * line: with several items a "comb" next to the ports (one stub per item, in the item's
 * colour) gathers them onto the shared segment (`engine/layout.ts › positionGraph`). The
 * label shows the item icons side by side, the total flow (/min) and the rail (e.g. "v.1",
 * "v.1 + v.3"). How much of which item: tooltip, and the link window (LinkEditor).
 *
 * The shape of the line comes from `engine/edgePaths.ts` (square / rounded / curved), its
 * colour and width from the display settings (with several items the shared segment is
 * neutral). The label position is given by ProductionGraph (`edgePaths.ts › placeLabels`:
 * all labels together, without overlaps; at a fork on the target side).
 *
 * Rail marking:
 *   - automatic, one rail is enough: grey "v.2",
 *   - automatic, several parallel ones needed: amber "3× v.3" / "v.1 + v.3" (not an error, a hint),
 *   - manual (`Link.rail`): blue-framed "2× v.1 + v.3",
 *   - manual and it cannot carry the demand (congestion): the line and the label are red.
 *
 * Click: select (Delete: removes the whole rail) and the link window (LinkEditor: items,
 * rails, distribution, manual rail); right-click: menu – ProductionGraph handles these via
 * `data-link-id`. A line without flow is thin and dashed.
 */
import { computed, defineComponent, type PropType } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import {
  LABEL_HEIGHT,
  LABEL_ICON_GAP,
  edgePath,
  labelBoxWidth,
  labelPosition,
} from '@/engine/edgePaths'
import { formatRate } from '@/engine/format'
import type { Point, PositionedEdge } from '@/engine/layout'
import { partsLabel, railLabel } from '@/engine/rails'

/** Icon size on the label, px. */
const ICON = 14

export default defineComponent({
  name: 'GraphEdge',

  components: { ItemIcon },

  props: {
    pos: { type: Object as PropType<PositionedEdge>, required: true },

    /**
     * What to draw: the line or the label. The graph renders the edges twice (first every
     * line, then every label), so the labels are always above the lines.
     */
    part: { type: String as PropType<'line' | 'label'>, required: true },

    /** The largest rate of the graph – for the proportional width. */
    maxRate: { type: Number, required: true },

    /** The label position (ProductionGraph places all of them together, without overlaps). */
    labelAt: { type: Object as PropType<Point>, default: undefined },

    dimmed: { type: Boolean, default: false },
    highlighted: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
  },

  setup(props) {
    const { index, display } = usePlanner()

    /** The items of the rail (in link order). */
    const items = computed(() => props.pos.edges.map((e) => index.value.item(e.item)))
    const rail = computed(() => props.pos.edge.rail)

    /** A manual rail that cannot carry the demand: red. */
    const congested = computed(() => !!rail.value?.congested)

    /** An automatic rail that needs several parallel ones: amber marking. */
    const multi = computed(() => !!rail.value && rail.value.mode === 'auto' && rail.value.count > 1)

    const manual = computed(() => rail.value?.mode === 'manual')
    const d = computed(() => edgePath(props.pos.points, display.lineStyle))

    /** The stubs of the comb (several items): square, in the item's colour. */
    const stubs = computed(() =>
      props.pos.stubs.map((s, i) => ({
        key: i,
        d: edgePath(s.points, 'orthogonal'),
        color: index.value.item(s.item).color,
      })),
    )

    const label = computed(() => props.labelAt ?? labelPosition(props.pos.points))
    const rate = computed(() => props.pos.rate)
    const text = computed(() => formatRate(rate.value))
    const badge = computed(() => (display.showRails && rail.value ? railLabel(rail.value) : ''))
    const idle = computed(() => rate.value <= 1e-6)

    const strokeWidth = computed(() => {
      if (idle.value) return 1.5
      if (!display.proportionalWidth || props.maxRate <= 0) return 2

      // Square-root scale: small flows stay visible, large ones do not get huge.
      return 1.5 + 5 * Math.sqrt(rate.value / props.maxRate)
    })

    const stubWidth = computed(() => Math.max(1.5, Math.min(strokeWidth.value, 3)))

    const stroke = computed(() => {
      if (congested.value) return 'var(--danger)'
      if (!display.coloredEdges || items.value.length > 1) return 'var(--edge)'

      return items.value[0].color
    })

    /** Stroke of one comb stub. */
    const stubStroke = (color: string) => {
      if (congested.value) return 'var(--danger)'

      return display.coloredEdges ? color : 'var(--edge)'
    }

    const tooltip = computed(() => {
      const u = RATE_UNIT_LABEL
      const lines =
        props.pos.edges.length > 1
          ? [
              `One rail, ${props.pos.edges.length} items: ${text.value} ${u} in total`,
              ...props.pos.edges.map(
                (e) => `  ${index.value.item(e.item).name}: ${formatRate(e.rate)}`,
              ),
            ]
          : [`${items.value[0].name}: ${text.value} ${u}`]
      const r = rail.value
      const e = props.pos.edge

      if (r) {
        if (r.congested) {
          lines.push(
            `CONGESTION: ${formatRate(e.demand)} would pass, the configured ${railLabel(r)} only lets ` +
              `${formatRate(r.capacity)} through. ${partsLabel(r.needed)} would be needed.`,
          )
        } else if (r.mode === 'manual') {
          lines.push(
            `Manual rail: ${railLabel(r)} = ${formatRate(r.capacity)} ${u}, load ${Math.round(r.load * 100)}%`,
          )
        } else if (r.count > 1) {
          lines.push(
            `One rail is not enough: ${railLabel(r)} is needed (${formatRate(r.capacity)} ${u}), or split the flow.`,
          )
        } else {
          lines.push(
            `Rail: ${r.tier.name} (${formatRate(r.tier.capacity)} ${u}), load ${Math.round(r.load * 100)}%`,
          )
        }
      }

      if (idle.value)
        lines.push(
          'Nothing moves on it (the source has no free output, or the target requests nothing).',
        )

      lines.push(
        'Click: details (items, rails, distribution, manual rail) · Delete: remove the rail · right-click: menu',
      )

      return lines.join('\n')
    })

    // Size of the label box (an estimate, the same one the placement uses).
    const size = computed(() => labelBoxWidth(text.value, badge.value, items.value.length))
    const textWidth = computed(() => size.value.textWidth)
    const badgeWidth = computed(() => size.value.badgeWidth)
    const labelWidth = computed(() => size.value.width)
    const textX = computed(() => 4 + size.value.iconsWidth + 4)

    /** Centre x of the i-th item icon on the label. */
    const iconX = (i: number) => 4 + ICON / 2 + i * (ICON + LABEL_ICON_GAP)

    const lineClass = computed(() => ({
      'edge--dimmed': props.dimmed,
      'edge--highlighted': props.highlighted || props.selected,
      'edge--selected': props.selected,
      'edge--congested': congested.value,
      'edge--idle': idle.value,
    }))

    const labelClass = computed(() => ({
      'edge--dimmed': props.dimmed,
      'edge--congested': congested.value,
      'edge--multi': multi.value,
      'edge--manual': manual.value,
      'edge--selected': props.selected,
    }))

    return {
      items,
      d,
      stubs,
      label,
      text,
      badge,
      strokeWidth,
      stubWidth,
      stroke,
      stubStroke,
      tooltip,
      textWidth,
      badgeWidth,
      labelWidth,
      textX,
      iconX,
      lineClass,
      labelClass,
      ICON,
      LABEL_HEIGHT,
    }
  },
})
