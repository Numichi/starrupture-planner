/**
 * @component LinkEditor
 *
 * Link window (click on an edge).
 *
 * One RAIL between two nodes: the links between the same two nodes (one per item) run on
 * one rail – ONE line on the graph (item icons and the total) – and the capacity counts the
 * total. E.g. the rail branching from a rail line to a factory carries every item the
 * factory gets from there. Shown here:
 *   - the items of the rail: how much of each (an item can be taken off the rail),
 *   - the flow, and for a congested manual rail the demand,
 *   - rail: automatic (the program chooses: the smallest tier that carries it; when even the
 *     best does not, parallel rails) or manual (rail set: a count per tier, mixed –
 *     RailSetEditor; when it cannot carry the demand, congestion – red); the setting
 *     belongs to every link of the rail,
 *   - the two ends: what sets the pace (`linkEnds.ts`): machine (count, the bottleneck of
 *     the receiver's items), storage (balanced / positive), cargo (throughput or the rail,
 *     whichever is tighter), rail line (collector),
 *   - distribution across the parallel rails, two ways:
 *       even (load balanced): the same on every rail,
 *       fill + remainder: the rails full, the remainder on the last one,
 *     and how many source and receiving machines belong to each rail (machine ends only).
 *
 * The calculation: `engine/rails.ts` (linkRail, railDistribution, machinesPerRate),
 * `engine/flow.ts` (manual rail cap, railDemand). Loaded by EntityEditor.
 */
import { computed, defineComponent } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import RailSetEditor from '@/components/RailSetEditor/RailSetEditor.vue'
import { describeEnd, type EndView } from '@/components/linkEnds'
import { usePlanner } from '@/composables/usePlanner'
import { RATE_UNIT_LABEL } from '@/config'
import { formatCount, formatRate } from '@/engine/format'
import {
  partsLabel,
  railDistribution,
  railLabel,
  type RailPart,
  type RailShare,
  type RailSplit,
} from '@/engine/rails'
import { useProject } from '@/project/projectStore'
import type { RailCount } from '@/project/types'

/** Rail set (`RailChoice.parts`) → setting (tier name × count). */
const toCounts = (parts: readonly RailPart[]): RailCount[] =>
  parts.map((p) => ({ tier: p.tier.name, count: p.count }))

/** One way of distributing the flow across the rails. */
interface SplitView {
  key: string
  title: string
  hint: string
  split: RailSplit
}

const MANUAL_HINT =
  'Manual: the total capacity of the configured rails is the limit (for all items of the rail together). ' +
  'What does not fit does not reach the receiver (congestion, red). When it is enough it is not red, even if it ' +
  'is more than needed.'

const AUTO_HINT =
  'Automatic: the smallest tier that carries it; when even the best available does not, as many of it as go full, ' +
  'and the smallest that carries the remainder. It does not limit.'

export default defineComponent({
  name: 'LinkEditor',

  components: { ItemIcon, RailSetEditor },

  props: {
    baseId: { type: String, required: true },
    linkId: { type: String, required: true },
  },

  setup(props) {
    const store = useProject()
    const { basePlans, index, availableRails } = usePlanner()

    const link = computed(
      () => store.baseById(props.baseId)?.links.find((l) => l.id === props.linkId) ?? null,
    )
    const plan = computed(() => basePlans.value.get(props.baseId))
    const edge = computed(() => plan.value?.edges.find((e) => e.linkId === props.linkId) ?? null)

    /** The rail (all links between the two nodes). */
    const railInfo = computed(() =>
      edge.value
        ? (plan.value?.linkRails.find((r) => r.key === edge.value!.railKey) ?? null)
        : null,
    )

    const nodeOf = (id: string | undefined) =>
      id ? plan.value?.nodes.find((n) => n.id === id) : undefined
    const fromNode = computed(() => nodeOf(link.value?.from))
    const toNode = computed(() => nodeOf(link.value?.to))
    const item = computed(() => (link.value ? index.value.item(link.value.item) : null))
    const rail = computed(() => railInfo.value?.choice ?? null)
    const manual = computed(() => !!link.value?.rail)
    const itemName = (id: string) => index.value.item(id).name

    /** The items on the rail and their flow (in link order). */
    const flows = computed(() =>
      (railInfo.value?.links ?? []).map((id) => {
        const e = plan.value?.edges.find((x) => x.linkId === id)

        return { linkId: id, item: e?.item ?? '', rate: e?.rate ?? 0 }
      }),
    )

    const total = computed(() => railInfo.value?.total ?? edge.value?.rate ?? 0)
    const demand = computed(() => railInfo.value?.demand ?? total.value)

    /** Switching to manual starts from the current automatic choice (without flow: one best rail). */
    function setMode(mode: 'auto' | 'manual') {
      if (!link.value || manual.value === (mode === 'manual')) return

      if (mode === 'auto') {
        store.setLinkRail(props.baseId, props.linkId, null)

        return
      }

      const r = rail.value
      const best = availableRails.value.at(-1)

      store.setLinkRail(
        props.baseId,
        props.linkId,
        r ? toCounts(r.parts) : [{ tier: best?.name ?? null, count: 1 }],
      )
    }

    function setRails(rails: RailCount[]) {
      store.setLinkRail(props.baseId, props.linkId, rails)
    }

    // --------------------------------------------------------------------------
    // The two ends: what sets the pace, machine count (linkEnds.ts)
    // --------------------------------------------------------------------------

    function end(side: 'source' | 'target'): EndView | null {
      const node = side === 'source' ? fromNode.value : toNode.value
      const r = railInfo.value

      if (!node || !r) return null

      return describeEnd({
        node,
        side,
        rail: r,
        flows: flows.value,
        choice: rail.value,
        plans: basePlans.value,
        itemName,
      })
    }

    const source = computed(() => end('source'))
    const target = computed(() => end('target'))

    /**
     * The distribution: the actual flow on the configured / chosen rails. For a congested
     * manual rail the DEMAND on the number of rails that would be needed (worth building).
     */
    const distribution = computed(() => {
      const r = rail.value

      if (!r) return null

      const rate = r.congested ? demand.value : total.value

      if (rate <= 0) return null

      const parts = r.congested ? r.needed : r.parts

      return railDistribution(
        rate,
        parts,
        source.value?.perRate ?? null,
        target.value?.perRate ?? null,
      )
    })

    /** Machine count: exact, and when fractional also rounded up ("18.67 → 19"). */
    function machines(n: number | null): string {
      if (n === null) return '–'

      const up = Math.ceil(n - 1e-6)

      return Math.abs(n - Math.round(n)) < 1e-6
        ? formatCount(Math.round(n))
        : `${formatCount(n)} → ${up}`
    }

    const pct = (load: number) => `${Math.round(load * 100)}%`

    const splits = computed<SplitView[]>(() => {
      const d = distribution.value

      if (!d) return []

      const list: SplitView[] = [
        {
          key: 'even',
          title: 'Even distribution (load balanced)',
          split: d.even,
          hint: 'The same on every rail: the rails are loaded equally, none of them runs full.',
        },
      ]

      if (d.rails > 1) {
        list.push({
          key: 'fill',
          title: 'Fill + remainder',
          split: d.fill,
          hint: 'The rails run full, the remainder goes on the last one (fewer rails to extend when the flow grows).',
        })
      }

      return list
    })

    const rowLabel = (rails: number, tier: string, share: RailShare) => {
      if (share.rate <= 0) return `${rails}× ${tier}: empty`

      return rails > 1 ? `${rails}× ${tier}, each` : `1× ${tier}`
    }

    const showSources = computed(() => source.value?.perRate != null)
    const showTargets = computed(() => target.value?.perRate != null)

    /** The items of the rail (icons in the header). */
    const railItems = computed(() => flows.value.map((f) => index.value.item(f.item)))

    /** Share of one item in the total flow, percent. */
    const share = (rate: number) => (total.value > 0 ? Math.round((rate / total.value) * 100) : 0)

    /** Parallel rails needed in auto mode. */
    const scaled = computed(() => rail.value?.mode === 'auto' && rail.value.count > 1)

    /** Fill of the load meter (the demand when congested). */
    const meterWidth = computed(() => {
      const r = rail.value

      if (!r) return '0%'

      return `${Math.min(100, ((r.congested ? demand.value : total.value) / r.capacity) * 100)}%`
    })

    const modeHint = computed(() => (manual.value ? MANUAL_HINT : AUTO_HINT))

    function selectEnds() {
      if (link.value) store.select([link.value.from, link.value.to])
    }

    /** Takes one item off the rail (only that link is deleted). */
    function removeItem(linkId: string) {
      const rest = flows.value.find((f) => f.linkId !== linkId)

      store.removeLink(props.baseId, linkId)

      // When this was the open link, the window stays open with another item of the rail.
      if (rest && linkId === props.linkId)
        store.editing.value = { kind: 'link', id: rest.linkId, baseId: props.baseId }
    }

    /** Deletes the whole rail (all its items: one line on the graph). */
    function removeAll() {
      store.removeRail(props.baseId, props.linkId)
    }

    return {
      index,
      availableRails,
      link,
      fromNode,
      toNode,
      item,
      rail,
      manual,
      itemName,
      flows,
      total,
      demand,
      setMode,
      setRails,
      toCounts,
      source,
      target,
      distribution,
      machines,
      pct,
      splits,
      rowLabel,
      showSources,
      showTargets,
      railItems,
      share,
      scaled,
      meterWidth,
      modeHint,
      selectEnds,
      removeItem,
      removeAll,
      formatRate,
      partsLabel,
      railLabel,
      RATE_UNIT_LABEL,
    }
  },
})
