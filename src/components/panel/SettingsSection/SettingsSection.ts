/**
 * @component SettingsSection
 *
 * Settings (for the whole project): display, the recipe choice of "Build chain"
 * (optimisation, recipes on / off), game rules, data file errors. Buildings need no locking:
 * the upgrade is chosen per node (right-click › Upgrade).
 */
import { computed, defineComponent } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import type { Recipe } from '@/data/types'
import { LINE_STYLES } from '@/engine/edgePaths'
import { formatRate } from '@/engine/format'
import { useProject } from '@/project/projectStore'

/** Tooltips of the distribution rule. */
const DISTRIBUTION_HINT = {
  even:
    'Consumers request from the network and everyone serves them: a source splits its output equally, ' +
    'the surplus goes to the others. An experience-based rule, not confirmed.',
  optimal: 'As much as possible reaches the factories (the program routes it cleverly).',
} as const

export default defineComponent({
  name: 'SettingsSection',

  components: { ItemIcon },

  setup() {
    const { project } = useProject()
    const {
      index,
      display,
      recipeGroups,
      dataWarnings,
      loadError,
      isRecipeEnabled,
      toggleRecipe,
      cargoRules,
      flowOptions,
    } = usePlanner()

    const settings = computed(() => project.value.settings)
    const enabledRecipeCount = computed(
      () => recipeGroups.value.filter((g) => isRecipeEnabled(g.recipe)).length,
    )
    const distributionHint = computed(() => DISTRIBUTION_HINT[flowOptions.value.distribution])

    /** Per-machine /min value of a recipe in its base building (the data is /min already, × building speed). */
    function perMinute(r: Recipe, amount: number): number {
      return amount * index.value.building(r.building).speed
    }

    return {
      index,
      display,
      recipeGroups,
      dataWarnings,
      loadError,
      isRecipeEnabled,
      toggleRecipe,
      cargoRules,
      flowOptions,
      settings,
      enabledRecipeCount,
      distributionHint,
      perMinute,
      formatRate,
      LINE_STYLES,
      RATE_UNIT_LABEL,
    }
  },
})
