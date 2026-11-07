/**
 * @component MissingDataSection
 *
 * Missing data – recipes that have no cycle time in the data.
 *
 * The data only has the per-cycle quantities (YAML `perCycle`); the program never invents a
 * value, the factory computes with 0. Until the data is updated, the cycle time can be
 * entered here (or in the factory editor): it is saved with the project
 * (`settings.cycleTimes`) and travels with export / import. Once the data gets a certain
 * value, the manual value no longer applies: it is listed as "data available" and can be
 * deleted.
 *
 * The calculation: `engine/missingData.ts`.
 */
import { computed, defineComponent } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import { perCycleText } from '@/components/missingData'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import { formatRate } from '@/engine/format'
import { recipesWithoutRate } from '@/engine/missingData'
import { useProject } from '@/project/projectStore'

export default defineComponent({
  name: 'MissingDataSection',

  components: { ItemIcon },

  setup() {
    const store = useProject()
    const { project } = store
    const { rawData, index } = usePlanner()

    const cycleTimes = computed(() => project.value.settings.cycleTimes)
    const missing = computed(() => recipesWithoutRate(rawData.value))

    /** Manual values that are no longer needed: the recipe got data, or the recipe no longer exists. */
    const stale = computed(() => {
      const ids = new Set(missing.value.map((r) => r.id))

      return Object.keys(cycleTimes.value)
        .filter((id) => !ids.has(id))
        .map((id) => ({ id, recipe: rawData.value.recipes.find((r) => r.id === id) }))
    })

    /** Recipes still without a manual cycle time. */
    const unsetCount = computed(() => missing.value.filter((r) => !cycleTimes.value[r.id]).length)

    const name = (i: string) => index.value.item(i).name

    /** Output per minute and machine with the manual cycle time (null: none entered). */
    const outputPerMin = (id: string, amount: number) => {
      const t = cycleTimes.value[id]

      return t ? formatRate((amount * 60) / t) : null
    }

    /** Stores the typed cycle time (empty or 0 clears it). */
    function setCycleTime(id: string, e: Event) {
      store.setCycleTime(id, Number((e.target as HTMLInputElement).value) || null)
    }

    const clearCycleTime = (id: string) => store.setCycleTime(id, null)

    return {
      index,
      cycleTimes,
      missing,
      stale,
      unsetCount,
      name,
      outputPerMin,
      setCycleTime,
      clearCycleTime,
      perCycleText,
      RATE_UNIT_LABEL,
    }
  },
})
