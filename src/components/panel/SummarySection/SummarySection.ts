/**
 * @component SummarySection
 *
 * Summary of the active base: power demand, buildings, minimum build cost, end products,
 * shortages, factories whose recipe has no cycle time data (they compute with 0 or with a
 * manual cycle time), surplus; below it the whole project.
 *
 * Power demand: every node counts its placed machines (a fractional machine is a whole one,
 * since it is placed, it just does not work at full power).
 *
 * Build cost: the buildings to place (rounded up) × the cost per building (buildings/*.yml
 * `cost`). "Minimum", because rails are not included: their length depends on the layout,
 * which is the player's decision. The price of the rail pieces (game.yml `rails › cost`) is
 * shown for information.
 */
import { computed, defineComponent } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import { rateNote } from '@/components/missingData'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import type { ItemQuantity } from '@/data/types'
import { formatCount, formatPower, formatRate } from '@/engine/format'
import { useProject } from '@/project/projectStore'

export default defineComponent({
  name: 'SummarySection',

  components: { ItemIcon },

  setup() {
    const { plan, index, projectSummary, availableRails } = usePlanner()
    const store = useProject()
    const { project } = store

    const summary = computed(() => plan.value.summary)
    const multiBase = computed(() => project.value.bases.length > 1)

    /** "3 Titanium Bar + 2 Wire" – a list of quantities as text. */
    const costText = (list: ItemQuantity[]) =>
      list.map((c) => `${formatCount(c.quantity)} ${index.value.item(c.item).name}`).join(' + ')

    /** Price of the rail pieces, e.g. "v.1: 1 Basic Building Material". */
    const railCosts = computed(() =>
      availableRails.value
        .filter((t) => t.cost?.length)
        .map((t) => `${t.name}: ${costText(t.cost!)}`)
        .join(' · '),
    )

    /** Factories whose recipe has no cycle time data (they compute with 0 or a manual cycle time). */
    const noData = computed(() =>
      plan.value.nodes.flatMap((n) => {
        const note = rateNote(n.recipe)

        return note ? [{ node: n, note }] : []
      }),
    )

    /** Jumps to a node of the active base. */
    const goTo = (nodeId: string) => store.goTo(store.activeBaseId.value, nodeId)

    return {
      plan,
      index,
      project,
      projectSummary,
      summary,
      multiBase,
      railCosts,
      noData,
      goTo,
      formatCount,
      formatPower,
      formatRate,
      RATE_UNIT_LABEL,
    }
  },
})
