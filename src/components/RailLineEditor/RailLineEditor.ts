/**
 * @component RailLineEditor
 *
 * Rail line editor – the settings of one rail line (several items on one drone rail):
 *   - name,
 *   - sizing: automatic (the program picks a rail set for the flow) or manual (you give the
 *     count per tier, mixed tiers allowed – e.g. 2× v.1 + 4× v.3; what does not fit is
 *     congestion),
 *   - inputs: dynamic (as many as linked items, + one free) or a fixed count,
 *   - state: total flow / capacity, the flow and share per item, and on congestion the
 *     required rail with a quick fix.
 *
 * The calculation: `engine/flow.ts` (capacity, congestion), `engine/rails.ts` (lineRail).
 * Loaded by EntityEditor.
 */
import { computed, defineComponent } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import RailSetEditor from '@/components/RailSetEditor/RailSetEditor.vue'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import { formatRate } from '@/engine/format'
import { partsLabel, railLabel } from '@/engine/rails'
import { useProject } from '@/project/projectStore'
import { nodeIds, type RailCount } from '@/project/types'

/** Rail set (`RailChoice.parts`) → setting (tier name × count). */
const toCounts = (parts: readonly { tier: { name: string }; count: number }[]): RailCount[] =>
  parts.map((p) => ({ tier: p.tier.name, count: p.count }))

export default defineComponent({
  name: 'RailLineEditor',

  components: { ItemIcon, RailSetEditor },

  props: {
    baseId: { type: String, required: true },
    lineId: { type: String, required: true },
  },

  setup(props) {
    const { baseById, updateRailLine, removeNodes } = useProject()
    const { basePlans, index, availableRails } = usePlanner()

    const line = computed(
      () => baseById(props.baseId)?.railLines.find((l) => l.id === props.lineId) ?? null,
    )
    const node = computed(() =>
      basePlans.value.get(props.baseId)?.nodes.find((n) => n.id === nodeIds.line(props.lineId)),
    )
    const info = computed(() => (node.value?.special?.type === 'line' ? node.value.special : null))
    const rail = computed(() => info.value?.rail ?? null)

    const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value
    const update = (patch: Parameters<typeof updateRailLine>[2]) =>
      updateRailLine(props.baseId, props.lineId, patch)

    /** Switching to manual starts from the current automatic choice. */
    function setMode(mode: 'auto' | 'manual') {
      if (!line.value || line.value.mode === mode) return

      if (mode === 'manual' && rail.value) update({ mode, rails: toCounts(rail.value.parts) })
      else update({ mode })
    }

    const items = computed(() =>
      (node.value?.inputs ?? []).map((p) => ({
        id: p.item,
        item: index.value.item(p.item),
        flow: p.flow,
        share: info.value && info.value.total > 0 ? p.flow / info.value.total : 0,
      })),
    )

    const slotsText = computed(() => {
      const l = line.value

      if (!l) return ''

      const used = items.value.length

      return l.slots === null ? `${used} items, + 1 free row` : `${used} / ${l.slots} used`
    })

    /** Several parallel rails needed in auto mode. */
    const scaled = computed(() => rail.value?.mode === 'auto' && rail.value.count > 1)

    /** Fill of the load meter, percent (the demand when congested). */
    const meterWidth = computed(() => {
      const i = info.value
      const r = rail.value

      if (!i || !r) return '0%'

      return `${Math.min(100, ((i.congested ? i.demand : i.total) / r.capacity) * 100)}%`
    })

    function confirmRemove() {
      if (line.value && confirm(`Delete the rail line "${line.value.name}"?`)) {
        removeNodes(props.baseId, [nodeIds.line(props.lineId)])
      }
    }

    /** Fixed input count: at least 1, at least the linked items. */
    const fixedSlots = computed(() => Math.max(1, items.value.length))

    const setRails = (rails: RailCount[]) => update({ rails })
    const setName = (e: Event) => update({ name: val(e) })
    const setSlots = (e: Event) => update({ slots: Number(val(e)) })

    return {
      line,
      node,
      info,
      rail,
      availableRails,
      update,
      setMode,
      setRails,
      setName,
      setSlots,
      fixedSlots,
      toCounts,
      items,
      slotsText,
      scaled,
      meterWidth,
      confirmRemove,
      formatRate,
      partsLabel,
      railLabel,
      RATE_UNIT_LABEL,
    }
  },
})
