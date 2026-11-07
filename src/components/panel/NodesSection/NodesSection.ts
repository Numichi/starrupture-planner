/**
 * @component NodesSection
 *
 * Nodes of the active base (overview only).
 *
 * The placed nodes per kind – factories, mines, Receivers, Dispatchers, storages, inter-base
 * rails, rail lines – each with a short state. Clicking a row jumps to it on the graph,
 * selects it and opens the editor. Placing happens on the canvas (right-click); there is no
 * "+" button here.
 */
import { computed, defineComponent } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import { storageState } from '@/components/storageState'
import { usePlanner } from '@/composables/usePlanner'
import { EPSILON, RATE_UNIT_LABEL } from '@/config'
import { formatCount, formatRate } from '@/engine/format'
import type { PlanNode } from '@/engine/plan'
import { railLabel } from '@/engine/rails'
import { useProject } from '@/project/projectStore'

/** The groups of the list, in display order. */
const GROUPS: { kind: PlanNode['kind']; label: string }[] = [
  { kind: 'factory', label: 'Factories' },
  { kind: 'mine', label: 'Mines' },
  { kind: 'receiver', label: 'Receivers' },
  { kind: 'dispatcher', label: 'Dispatchers' },
  { kind: 'storage', label: 'Storages' },
  { kind: 'railIn', label: 'Incoming inter-base rails' },
  { kind: 'railOut', label: 'Outgoing inter-base rails' },
  { kind: 'line', label: 'Rail lines' },
]

/** The short state at the end of a row. */
interface RowMeta {
  text: string
  bad: boolean
}

export default defineComponent({
  name: 'NodesSection',

  components: { ItemIcon },

  setup() {
    const store = useProject()
    const { activeBaseId, selection } = store
    const { plan, index, activeBase } = usePlanner()

    const groups = computed(() =>
      GROUPS.map((g) => ({
        ...g,
        nodes: plan.value.nodes.filter((n) => n.kind === g.kind),
      })).filter((g) => g.nodes.length),
    )

    /** The icon of a row: the product for a factory, the first item elsewhere. */
    function iconItem(n: PlanNode): string | null {
      if (n.recipe) return n.recipe.product

      return (n.outputs[0] ?? n.inputs[0])?.item ?? null
    }

    /** The icon item of a row (null: no icon). */
    function rowIcon(n: PlanNode) {
      const id = iconItem(n)

      return id ? index.value.item(id) : null
    }

    /** The short state at the end of a row. */
    function meta(n: PlanNode): RowMeta {
      const short = n.inputs.filter((p) => p.gap > EPSILON)

      if (n.warning) return { text: n.warning, bad: true }

      switch (n.kind) {
        case 'factory': {
          // Reduced operation: the effective output and the utilisation.
          const util = n.utilization ?? 1
          const out = n.outputs[0]
          const pct = util < 1 - 1e-6 ? ` (${Math.round(util * 100)}%)` : ''
          // Automatic machine count: "auto" next to the number.
          const count = `${formatCount(n.count)}×${n.countMode && n.countMode !== 'manual' ? ' auto' : ''}`

          if (short.length) {
            const missing = short.map((p) => index.value.item(p.item).name).join(', ')

            return { text: `${count}${pct} · short: ${missing}`, bad: true }
          }

          return {
            text: `${count} · ${formatRate(out?.effective ?? out?.rate ?? 0)}${RATE_UNIT_LABEL}${pct}`,
            bad: false,
          }
        }

        case 'mine': {
          const s = n.special?.type === 'mine' ? n.special : null

          return {
            text: `${formatCount(n.count)}× · ${formatRate(s?.used ?? 0)} / ${formatRate(s?.total ?? 0)}`,
            bad: false,
          }
        }

        case 'receiver':
          return {
            text: `gets ${formatRate(n.special?.type === 'receiver' ? n.special.received : 0)}`,
            bad: false,
          }

        case 'dispatcher':
          return {
            text: `sends ${formatRate(n.special?.type === 'dispatcher' ? n.special.sent : 0)}`,
            bad: false,
          }

        case 'storage': {
          const x = n.special?.type === 'storage' ? n.special : null

          return { text: x ? storageState(x).short : '', bad: false }
        }

        case 'railIn':
        case 'railOut': {
          const total = n.special && 'total' in n.special ? n.special.total : 0

          return {
            text: `${formatRate(total)}${n.rail ? ' · ' + railLabel(n.rail) : ''}`,
            bad: false,
          }
        }

        case 'line': {
          const l = n.special?.type === 'line' ? n.special : null

          if (!l) return { text: '', bad: false }

          const cap = l.rail ? ` / ${formatRate(l.rail.capacity)} · ${railLabel(l.rail)}` : ''

          return {
            text: `${formatRate(l.total)}${cap}${l.congested ? ' · congested' : ''}`,
            bad: l.congested,
          }
        }
      }
    }

    /** Jumps to the node, selects it and opens its editor. */
    function open(n: PlanNode) {
      store.goTo(activeBaseId.value, n.id)
      store.editing.value = store.editTargetOf(n.id)
    }

    return { activeBase, selection, groups, rowIcon, meta, open }
  },
})
