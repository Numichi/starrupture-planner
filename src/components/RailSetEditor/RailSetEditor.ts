/**
 * @component RailSetEditor
 *
 * Rail set editor – a manual rail: how many rails of each tier (mixed tiers allowed).
 *
 * E.g. 2× v.1 + 1× v.2 + 4× v.3: one row per available tier, with a stepper (0 = none of
 * it). Below: the label of the set and the total capacity. An element without a tier (old,
 * "best available") counts in the row of the best available tier; an element of an
 * unavailable tier is shown in its own row (the calculation uses the best available tier
 * for it) and can be deleted.
 *
 * Event: `update` – the new rail set (only the tiers with a count above 0).
 * Used by LinkEditor (link rail) and RailLineEditor (rail line).
 */
import { computed, defineComponent, type PropType } from 'vue'

import { RATE_UNIT_LABEL } from '@/config'
import type { RailTier } from '@/data/types'
import { formatRate } from '@/engine/format'
import { partsCapacity, partsLabel, resolveParts } from '@/engine/rails'
import type { RailCount } from '@/project/types'

export default defineComponent({
  name: 'RailSetEditor',

  props: {
    rails: { type: Array as PropType<readonly RailCount[]>, required: true },
    available: { type: Array as PropType<readonly RailTier[]>, required: true },
  },

  emits: {
    update: (_rails: RailCount[]) => true,
  },

  setup(props, { emit }) {
    const best = computed(() => props.available[props.available.length - 1]?.name ?? null)

    /** The configured count per tier (an element without a tier goes to the best available one). */
    const counts = computed(() => {
      const map = new Map<string, number>()

      for (const r of props.rails) {
        const name = r.tier ?? best.value

        if (name) map.set(name, (map.get(name) ?? 0) + r.count)
      }

      return map
    })

    /** The configured but unavailable tiers. */
    const unavailable = computed(() =>
      [...counts.value].filter(([name]) => !props.available.some((t) => t.name === name)),
    )

    const resolved = computed(() => resolveParts(props.rails, props.available))
    const capacity = computed(() => partsCapacity(resolved.value.parts))

    /** Sets the count of one tier (0 removes it; at least one rail always stays). */
    function set(name: string, count: number) {
      const map = new Map(counts.value)
      const n = Math.max(0, Math.round(Number(count) || 0))

      if (n > 0) map.set(name, n)
      else map.delete(name)

      // At least one rail stays (switching to automatic is the "Rail: Automatic" button).
      if (!map.size) return

      emit(
        'update',
        [...map].map(([tier, c]) => ({ tier, count: c })),
      )
    }

    /** Can the count of this tier be decreased (not below 0, and not the last single rail)? */
    const canDecrease = (name: string) =>
      !!counts.value.get(name) && !(counts.value.size === 1 && counts.value.get(name) === 1)

    const step = (name: string, by: number) => set(name, (counts.value.get(name) ?? 0) + by)
    const onInput = (name: string, e: Event) =>
      set(name, Number((e.target as HTMLInputElement).value))

    return {
      counts,
      unavailable,
      resolved,
      capacity,
      set,
      canDecrease,
      step,
      onInput,
      formatRate,
      partsLabel,
      RATE_UNIT_LABEL,
    }
  },
})
