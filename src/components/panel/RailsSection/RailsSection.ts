/**
 * @component RailsSection
 *
 * Drone rails in the active base:
 *   - the best available rail tier (e.g. v.1 / v.2 / v.3): nothing better is chosen,
 *   - rail segments per tier (per link – one rail between two nodes – and per inter-base
 *     rail; with parallel rails the count),
 *   - where one rail is not enough (several parallel ones are needed: information), and the
 *     congested manual rails (rail line, link: the configured set is too small – an error).
 *
 * Rail lines (collectors) are placed on the canvas with right-click.
 */
import { computed, defineComponent } from 'vue'

import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import { formatRate } from '@/engine/format'
import { useProject } from '@/project/projectStore'

export default defineComponent({
  name: 'RailsSection',

  setup() {
    const { project } = useProject()
    const { gameData, plan, activeBase } = usePlanner()

    const settings = computed(() => project.value.settings)
    const summary = computed(() => plan.value.summary)
    const selectedRail = computed(
      () => settings.value.maxRailName ?? gameData.value.rails.at(-1)?.name ?? null,
    )

    /** "2 rail lines, 1 link" – what is congested. */
    const congestedText = computed(() => {
      const s = summary.value
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

      return [
        s.congestedLines ? plural(s.congestedLines, 'rail line') : '',
        s.congestedLinks ? plural(s.congestedLinks, 'link') : '',
      ]
        .filter(Boolean)
        .join(', ')
    })

    return {
      gameData,
      activeBase,
      settings,
      summary,
      selectedRail,
      congestedText,
      formatRate,
      RATE_UNIT_LABEL,
    }
  },
})
