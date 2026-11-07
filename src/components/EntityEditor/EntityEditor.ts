/**
 * @component EntityEditor
 *
 * Editor – factory, mine, Receiver, Dispatcher, storage, inter-base rail, rail line, link.
 *
 * Opens on the right of the graph when a node is clicked (on the graph or in the panel
 * list). Every change applies immediately and the graph recalculates. The rail line editor
 * is a separate component (RailLineEditor), so is the link window (click on an edge: rails,
 * distribution, manual rail: LinkEditor).
 *
 *   Factory:  recipe (the recipes of the same product, also on upgraded buildings), machine
 *             count ↔ output /min (one is computed from the other; fractions allowed, for
 *             power a fractional machine counts as a whole one), automatic / manual count,
 *             balance to the linked demand, Upgrade button (UpgradeButtons: always shown;
 *             disabled with a note when there is no upgraded variant).
 *   Mine:     item, mine building (the upgraded one too), purity (only when there are
 *             several), building count, and a manually given total output (one node can
 *             stand for all such mines of yours), Upgrade button.
 *   Cargo:    a Dispatcher sends to one Receiver. A Receiver has one Dispatcher by default
 *             (1:1, as in the game: a new pairing overrides the old one); with
 *             `features.cargoManyToOne: true` in game.yml several (N:1). An unpaired
 *             Dispatcher / Receiver can calculate against a virtual counterpart (off / by
 *             rails / custom rate); the item comes from the linked material.
 */
import { computed, defineComponent, onBeforeUnmount, onMounted, ref } from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import LinkEditor from '@/components/LinkEditor/LinkEditor.vue'
import RailLineEditor from '@/components/RailLineEditor/RailLineEditor.vue'
import UpgradeButtons from '@/components/UpgradeButtons/UpgradeButtons.vue'
import { perCycleText, rateNote } from '@/components/missingData'
import { useNotice } from '@/components/notice'
import { storageState } from '@/components/storageState'
import { useEditorActions } from '@/composables/useEditorActions'
import { usePlanner } from '@/composables/usePlanner'
import { EPSILON, RATE_UNIT_LABEL } from '@/config'
import type { Building, Item, Recipe } from '@/data/types'
import { formatCount, formatPower, formatQuantity, formatRate } from '@/engine/format'
import { defaultPurityFor, minableItems, minersFor, puritiesFor } from '@/engine/mining'
import type { PlanPort } from '@/engine/plan'
import { attachedFeedRail, dispatcherRate } from '@/engine/projectModel'
import { railLabel } from '@/engine/rails'
import { rateFor } from '@/engine/rateTable'
import { upgradeOptions, type UpgradeOption } from '@/engine/upgrades'
import { useProject } from '@/project/projectStore'
import { nodeIds, type Dispatcher, type VirtualCargo } from '@/project/types'

/** Editor titles per edited kind. */
const TITLES: Record<string, string> = {
  factory: 'Factory',
  mine: 'Mine',
  receiver: 'Receiver',
  dispatcher: 'Dispatcher',
  storage: 'Storage',
  railLink: 'Inter-base rail',
  railLine: 'Rail line',
  link: 'Link',
}

/** Default custom rate of a new virtual counterpart without a rail-based limit, items/min. */
const DEFAULT_VIRTUAL_RATE = 60

/** An item list in two groups: the suggested ones first, then the rest. */
interface ItemGroups {
  preferred: Item[]
  rest: Item[]
}

const NO_ITEMS: ItemGroups = { preferred: [], rest: [] }

export default defineComponent({
  name: 'EntityEditor',

  components: { ItemIcon, LinkEditor, RailLineEditor, UpgradeButtons },

  setup() {
    const store = useProject()
    const {
      project,
      editing,
      findFactory,
      findMine,
      findReceiver,
      findDispatcher,
      findStorage,
      dispatchersOf,
      baseById,
      updateMine,
      updateReceiver,
      updateDispatcher,
      pair,
      updateStorage,
      updateRailLink,
      goTo,
    } = store
    const {
      index,
      selectableItems,
      buildingsOfType,
      basePlans,
      consumedItems,
      producedItems,
      gameData,
      availableRails,
      cargoRules,
    } = usePlanner()
    const actions = useEditorActions()
    const { notify } = useNotice()

    /** Whether N:1 (several Dispatchers per Receiver) is switched on in game.yml. */
    const manyToOne = computed(() => cargoRules.value.manyToOne)

    const close = () => (editing.value = null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()

    onMounted(() => window.addEventListener('keydown', onKey))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

    const itemName = (id: string | null) => (id ? index.value.item(id).name : '')
    const val = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value
    const numVal = (e: Event) => Number(val(e).replace(',', '.'))
    const checked = (e: Event) => (e.target as HTMLInputElement).checked

    /** A node from the plan of its base. */
    const planNode = (baseId: string, nodeId: string) =>
      basePlans.value.get(baseId)?.nodes.find((n) => n.id === nodeId)

    /** The item list in two groups: the suggested ones first, then the rest. */
    function splitItems(preferred: Set<string>): ItemGroups {
      const all = selectableItems.value

      return {
        preferred: all.filter((i) => preferred.has(i.id)),
        rest: all.filter((i) => !preferred.has(i.id)),
      }
    }

    function remove(baseId: string, nodeId: string) {
      store.removeNodes(baseId, [nodeId])
      close()
    }

    // ==========================================================================
    // Factory
    // ==========================================================================

    const factory = computed(() =>
      editing.value?.kind === 'factory' ? findFactory(editing.value.id) : null,
    )
    const factoryRecipe = computed(() =>
      factory.value ? index.value.recipe(factory.value.factory.recipe) : undefined,
    )
    const factoryNode = computed(() =>
      factory.value
        ? planNode(factory.value.base.id, nodeIds.factory(factory.value.factory.id))
        : undefined,
    )

    /** The recipes of the same product (in any building). */
    const sameProduct = computed<Recipe[]>(() => {
      const r = factoryRecipe.value

      return r ? gameData.value.recipes.filter((x) => x.product === r.product) : []
    })

    const mainOutput = computed(() => factoryNode.value?.outputs[0])
    const perMachine = computed(() => mainOutput.value?.perBuilding ?? 0)

    /** The shown machine count: the computed one in automatic mode, the typed one in manual mode. */
    const shownCount = computed(() => factoryNode.value?.count ?? factory.value?.factory.count ?? 0)

    /** The shown main output /min (rounded for the input field). */
    const shownOutput = computed(
      () => Math.round(shownCount.value * perMachine.value * 1000) / 1000,
    )

    /** Typing a machine count: it becomes manual (from automatic too). */
    function setFactoryCount(n: number) {
      if (factory.value && Number.isFinite(n) && n >= 0)
        store.setFactoryCount(factory.value.factory.id, n)
    }

    /** Automatic / manual; switching to manual keeps the count shown now. */
    function setFactoryAuto(auto: boolean) {
      if (!factory.value) return

      store.setFactoryCount(factory.value.factory.id, auto ? 'auto' : shownCount.value)
    }

    function setFactoryOutput(rate: number) {
      if (perMachine.value > 0 && Number.isFinite(rate) && rate >= 0)
        setFactoryCount(rate / perMachine.value)
    }

    function setFactoryRecipe(id: string) {
      const f = factory.value
      const r = index.value.recipe(id)

      if (!f || !r) return

      actions.upgrade(nodeIds.factory(f.factory.id), {
        building: index.value.building(r.building),
        direction: 'up',
        recipe: r,
      })
    }

    /**
     * Balances this factory: the machine count from the demand of its linked CONSUMERS (not
     * from its inputs, as the automatic mode does). So an automatic factory switches to
     * manual first.
     */
    function balanceFactory() {
      const f = factory.value

      if (!f) return

      const wasAuto = f.factory.auto
      const r = actions.balance([nodeIds.factory(f.factory.id)], { toManual: true })
      const switched = wasAuto
        ? ' The factory now has a manual machine count (automatic would size it from its inputs).'
        : ''
      const result = r.changed
        ? 'Machine count balanced to the linked demand.'
        : 'Nothing to balance (the output is not linked to a consumer, or it is exact already).'

      notify(result + switched)
    }

    function chainFactory() {
      const f = factory.value

      if (!f) return

      const m = actions.chainMessage(actions.buildChain(nodeIds.factory(f.factory.id)))

      notify(m.text, m.tone, 6000)
    }

    const factoryShort = computed(
      () => factoryNode.value?.inputs.some((p) => p.gap > EPSILON) ?? false,
    )

    /** The recipe has no cycle time data (computes with 0 or with a manual cycle time). */
    const factoryNote = computed(() => rateNote(factoryRecipe.value))

    /** The factory works less because of its input (effective output). */
    const factoryReduced = computed(() => (factoryNode.value?.utilization ?? 1) < 1 - 1e-6)
    const factoryPercent = computed(
      () => `${Math.round((factoryNode.value?.utilization ?? 1) * 100)}%`,
    )

    /** Note of an input row: unlinked / bottleneck / takes less only. */
    function inputNote(p: PlanPort): string {
      if (!p.linked) return ' – not linked (assumed supplied)'
      if (p.gap > 0.001) return ` – short ${formatRate(p.gap)} (bottleneck)`

      if ((p.partial ?? 0) > 0.001) {
        return ` – the tight input: the rounded count would need ${formatRate(p.partial ?? 0)} more`
      }

      if (factoryReduced.value)
        return ` – takes no more, because the factory only works at ${factoryPercent.value}`

      return ''
    }

    /** Note of an output row: unlinked / surplus. */
    function outputNote(p: PlanPort): string {
      if (!p.linked) return ' – output (not linked)'
      if (p.gap > 0.001) return ` – ${formatRate(p.gap)} surplus`

      return ''
    }

    /** Upgrade / downgrade: the recipes of the upgraded (v.2) or the base building for the same product. */
    const factoryUpgrades = computed(() => {
      const r = factoryRecipe.value

      return r ? upgradeOptions(index.value, r.building, r.product, 'recipe') : []
    })

    function upgradeFactory(o: UpgradeOption) {
      if (factory.value) actions.upgrade(nodeIds.factory(factory.value.factory.id), o)
    }

    /** The manual cycle time of the recipe (missing data). */
    const factoryCycleTime = computed(() =>
      factoryRecipe.value ? project.value.settings.cycleTimes[factoryRecipe.value.id] : undefined,
    )

    function setFactoryCycleTime(e: Event | null) {
      if (factoryRecipe.value)
        store.setCycleTime(factoryRecipe.value.id, e ? numVal(e) || null : null)
    }

    // ==========================================================================
    // Mine
    // ==========================================================================

    const mine = computed(() =>
      editing.value?.kind === 'mine' ? findMine(editing.value.id) : null,
    )
    const mineBuilding = computed(() =>
      mine.value ? index.value.building(mine.value.mine.building) : null,
    )
    const mineNode = computed(() =>
      mine.value ? planNode(mine.value.base.id, nodeIds.mine(mine.value.mine.id)) : undefined,
    )
    const mineInfo = computed(() =>
      mineNode.value?.special?.type === 'mine' ? mineNode.value.special : null,
    )

    /** Minable items; the ones requested in this base first. */
    const mineItems = computed<ItemGroups>(() => {
      if (!mine.value) return NO_ITEMS

      const minable = minableItems(gameData.value)
      const split = splitItems(consumedItems(mine.value.base.id))

      return {
        preferred: split.preferred.filter((i) => minable.has(i.id)),
        rest: split.rest.filter((i) => minable.has(i.id)),
      }
    })

    /** Buildings that mine the chosen item (the upgraded ones too). */
    const mineBuildings = computed<Building[]>(() => {
      const m = mine.value?.mine

      if (!m) return []

      return m.item ? minersFor(gameData.value, m.item) : buildingsOfType('miner')
    })

    /** The purities of the item at this building. A picker only when there is more than one. */
    const minePurities = computed(() =>
      mine.value && mineBuilding.value
        ? puritiesFor(gameData.value, mineBuilding.value, mine.value.mine.item)
        : [],
    )

    function mineBuildingRate(b: Building): string {
      const m = mine.value?.mine

      if (!m?.item) return ''

      const table = b.mines?.[m.item]

      if (table === undefined) return ''

      const rate = rateFor(table, m.purity, defaultPurityFor(gameData.value, b, m.item)).rate

      return `${formatRate(rate)} ${RATE_UNIT_LABEL}`
    }

    /** The rate of one purity at the current mine building. */
    const purityRate = (purityId: string) =>
      formatRate(rateFor(mineBuilding.value?.mines?.[mine.value?.mine.item ?? ''], purityId).rate)

    /** Changing the item: when the building cannot mine it, switches to the first that can; the purity is reset. */
    function setMineItem(item: string | null) {
      const m = mine.value?.mine

      if (!m) return

      let building = index.value.building(m.building)

      if (item && !(building.mines && item in building.mines)) {
        const miners = minersFor(gameData.value, item)

        building = miners.find((b) => !b.upgradeOf) ?? miners[0] ?? building
      }

      const keep =
        item &&
        m.purity &&
        puritiesFor(gameData.value, building, item).some((p) => p.id === m.purity)

      // Another item: its old links no longer fit.
      store.removeLinksOf(mine.value!.base.id, nodeIds.mine(m.id), (l) => l.item !== item)
      updateMine(m.id, {
        item,
        building: building.id,
        purity: keep ? m.purity : defaultPurityFor(gameData.value, building, item),
      })
    }

    function setMineBuilding(id: string) {
      const m = mine.value?.mine

      if (!m) return

      const b = index.value.building(id)
      const keep = m.purity && puritiesFor(gameData.value, b, m.item).some((p) => p.id === m.purity)

      updateMine(m.id, {
        building: id,
        purity: keep ? m.purity : defaultPurityFor(gameData.value, b, m.item),
      })
    }

    const customOutput = computed(
      () => mine.value?.mine.output !== null && mine.value?.mine.output !== undefined,
    )

    /** The total output shown in the input field (the custom one, or the computed one). */
    const mineOutputValue = computed(() =>
      customOutput.value
        ? mine.value?.mine.output
        : Math.round((mineInfo.value?.total ?? 0) * 1000) / 1000,
    )

    function toggleCustomOutput(on: boolean) {
      const m = mine.value?.mine

      if (!m) return

      updateMine(m.id, { output: on ? Math.round((mineInfo.value?.total ?? 0) * 100) / 100 : null })
    }

    function setMineCount(e: Event) {
      if (mine.value) updateMine(mine.value.mine.id, { count: Math.max(0, numVal(e) || 0) })
    }

    function setMineOutput(e: Event) {
      if (mine.value) updateMine(mine.value.mine.id, { output: Math.max(0, numVal(e) || 0) })
    }

    function balanceMine() {
      const m = mine.value

      if (!m) return

      const r = actions.balance([nodeIds.mine(m.mine.id)])

      notify(r.changed ? 'Mine count balanced to the linked demand.' : 'Nothing to balance.')
    }

    const mineUpgrades = computed(() =>
      mine.value?.mine.item
        ? upgradeOptions(index.value, mine.value.mine.building, mine.value.mine.item, 'mine')
        : [],
    )

    function upgradeMine(o: UpgradeOption) {
      if (mine.value) actions.upgrade(nodeIds.mine(mine.value.mine.id), o)
    }

    // ==========================================================================
    // Receiver
    // ==========================================================================

    const receiver = computed(() =>
      editing.value?.kind === 'receiver' ? findReceiver(editing.value.id) : null,
    )
    const recvNode = computed(() =>
      receiver.value
        ? planNode(receiver.value.base.id, nodeIds.receiver(receiver.value.receiver.id))
        : undefined,
    )

    /** What the Receiver gets: from its Dispatchers plus from its virtual dispatcher. */
    const received = computed(() =>
      recvNode.value?.special?.type === 'receiver'
        ? recvNode.value.special.received + (recvNode.value.special.virtual?.flow ?? 0)
        : 0,
    )

    /** Virtual dispatcher of the open Receiver as calculated (null = off or paired). */
    const recvVirtual = computed(() =>
      recvNode.value?.special?.type === 'receiver' ? recvNode.value.special.virtual : null,
    )

    /** The Receiver's rail-based limit (rail outputs × best rail); null = unlimited. */
    const recvRailLimit = computed(() =>
      recvNode.value?.special?.type === 'receiver' ? recvNode.value.special.outputLimit : null,
    )

    /**
     * The Dispatchers of the Receiver. With the 1:1 rule at most one counts (the first); when
     * old data has several, the others are "overridden" (they do not send).
     */
    const receiverDispatchers = computed(() =>
      (receiver.value ? dispatchersOf(receiver.value.receiver.id) : []).map((x, i) => ({
        ...x,
        overridden: !manyToOne.value && i > 0,
      })),
    )

    const rateOf = (d: Dispatcher) =>
      dispatcherRate(index.value, project.value, d, availableRails.value).rate

    const receiverCapacity = computed(() =>
      receiverDispatchers.value
        .filter((x) => !x.overridden)
        .reduce((a, x) => a + rateOf(x.dispatcher), 0),
    )

    /** What its linked consumers would request from it (from their shortage). */
    const receiverDemand = computed(() => {
      const r = receiver.value

      if (!r) return 0

      const id = nodeIds.receiver(r.receiver.id)
      const p = basePlans.value.get(r.base.id)
      let need = received.value

      for (const e of p?.edges ?? []) {
        if (e.from !== id) continue

        const to = p!.nodes.find((n) => n.id === e.to)

        need += to?.inputs.find((x) => x.item === e.item)?.gap ?? 0
      }

      return need
    })

    const receiverItems = computed<ItemGroups>(() => {
      if (!receiver.value) return NO_ITEMS

      const needed = consumedItems(receiver.value.base.id)

      if (receiver.value.receiver.item) needed.add(receiver.value.receiver.item)

      return splitItems(needed)
    })

    const dispatcherOptions = computed(() => {
      const r = receiver.value?.receiver

      if (!r) return []

      return project.value.bases.flatMap((b) =>
        b.dispatchers
          .filter((d) => d.receiverId !== r.id && (!d.item || !r.item || d.item === r.item))
          .map((d) => ({
            d,
            base: b,
            current: d.receiverId ? (findReceiver(d.receiverId)?.receiver.name ?? null) : null,
          })),
      )
    })

    /** Placeholder of the "add Dispatcher" picker. */
    const addDispatcherLabel = computed(() => {
      if (manyToOne.value) return '+ Assign a Dispatcher…'

      return receiverDispatchers.value.length
        ? 'Another Dispatcher (overrides the current one)…'
        : '+ Set a Dispatcher…'
    })

    /** The "add Dispatcher" picker: pairs the chosen one and resets the picker. */
    function addDispatcher(e: Event) {
      const select = e.target as HTMLSelectElement

      if (select.value && receiver.value) pair(select.value, receiver.value.receiver.id)

      select.value = ''
    }

    function setReceiverItem(item: string | null) {
      const r = receiver.value

      if (!r) return

      store.removeLinksOf(r.base.id, nodeIds.receiver(r.receiver.id), (l) => l.item !== item)
      updateReceiver(r.receiver.id, { item })
    }

    /** What the virtual dispatcher gives at most, as text. */
    const recvVirtualLimitText = computed(() => {
      if (receiver.value?.receiver.virtual?.mode === 'custom') return 'up to the custom rate'
      if (recvRailLimit.value === null) return 'unlimited (no rail data)'

      return `up to its rail outputs × best rail, ${formatRate(recvRailLimit.value)} ${RATE_UNIT_LABEL}`
    })

    // ==========================================================================
    // Dispatcher
    // ==========================================================================

    const dispatcher = computed(() =>
      editing.value?.kind === 'dispatcher' ? findDispatcher(editing.value.id) : null,
    )
    const dispatcherReceiver = computed(() =>
      dispatcher.value?.dispatcher.receiverId
        ? findReceiver(dispatcher.value.dispatcher.receiverId)
        : null,
    )
    const dispatcherInfo = computed(() =>
      dispatcher.value
        ? dispatcherRate(
            index.value,
            project.value,
            dispatcher.value.dispatcher,
            availableRails.value,
          )
        : null,
    )

    /** The manual rail tier of the incoming link (the automatic feed rail uses it), or null. */
    const attachedFeed = computed(() =>
      dispatcher.value
        ? attachedFeedRail(project.value, dispatcher.value.dispatcher, availableRails.value)
        : null,
    )

    const feedRate = (rail: string) =>
      dispatcher.value
        ? rateFor(index.value.building(dispatcher.value.dispatcher.building).throughput, rail).rate
        : 0

    /** Label of the automatic feed rail option. */
    const autoFeedLabel = computed(() =>
      attachedFeed.value
        ? `the manual rail of the incoming link (${attachedFeed.value})`
        : `best available (${dispatcherInfo.value?.feedOptions.at(-1) ?? '–'})`,
    )

    const dispNode = computed(() =>
      dispatcher.value
        ? planNode(dispatcher.value.base.id, nodeIds.dispatcher(dispatcher.value.dispatcher.id))
        : undefined,
    )

    /** Virtual receiver of the open Dispatcher as calculated (null = off or paired). */
    const dispVirtual = computed(() =>
      dispNode.value?.special?.type === 'dispatcher' ? dispNode.value.special.virtual : null,
    )

    const sent = computed(() =>
      dispNode.value?.special?.type === 'dispatcher' ? dispNode.value.special.sent : 0,
    )

    const siblingCount = computed(() =>
      dispatcher.value?.dispatcher.receiverId
        ? dispatchersOf(dispatcher.value.dispatcher.receiverId).length
        : 0,
    )

    const dispatcherItems = computed<ItemGroups>(() =>
      dispatcher.value ? splitItems(producedItems(dispatcher.value.base.id)) : NO_ITEMS,
    )

    const showAllReceivers = ref(false)

    const receiverOptions = computed(() => {
      const d = dispatcher.value?.dispatcher

      if (!d) return []

      return project.value.bases.flatMap((b) =>
        b.receivers
          .filter(
            (r) =>
              showAllReceivers.value ||
              !d.item ||
              !r.item ||
              r.item === d.item ||
              r.id === d.receiverId,
          )
          .map((r) => ({
            r,
            base: b,
            others: dispatchersOf(r.id)
              .filter((x) => x.dispatcher.id !== d.id)
              .map((x) => x.dispatcher.name),
          })),
      )
    })

    /** The suffix of a Receiver option: who else sends to it. */
    function receiverOptionNote(others: string[]): string {
      if (!others.length) return ''

      return manyToOne.value
        ? ` · ${others.length} Dispatchers already send`
        : ` · overrides: ${others.join(', ')}`
    }

    /** What the virtual receiver takes at most, as text. */
    const dispVirtualLimitText = computed(() =>
      dispatcher.value?.dispatcher.virtual?.mode === 'custom'
        ? 'up to the custom rate'
        : `up to its throughput, ${formatRate(dispatcherInfo.value?.rate ?? 0)} ${RATE_UNIT_LABEL}`,
    )

    /**
     * Turns the virtual counterpart of the open Receiver / Dispatcher off, or sets its mode.
     * A new custom rate starts at the rail-based limit, so switching modes keeps the number.
     */
    function setVirtual(kind: 'receiver' | 'dispatcher', mode: VirtualCargo['mode'] | null) {
      const current =
        kind === 'receiver'
          ? receiver.value?.receiver.virtual
          : dispatcher.value?.dispatcher.virtual
      const railRate =
        kind === 'receiver' ? (recvRailLimit.value ?? 0) : (dispatcherInfo.value?.rate ?? 0)
      const virtual: VirtualCargo | null = mode
        ? { mode, rate: current?.rate || railRate || DEFAULT_VIRTUAL_RATE }
        : null

      if (kind === 'receiver' && receiver.value)
        updateReceiver(receiver.value.receiver.id, { virtual })
      if (kind === 'dispatcher' && dispatcher.value)
        updateDispatcher(dispatcher.value.dispatcher.id, { virtual })
    }

    /** Sets the custom rate of the open node's virtual counterpart (items/min, ≥ 0). */
    function setVirtualRate(kind: 'receiver' | 'dispatcher', rate: number) {
      if (!Number.isFinite(rate) || rate < 0) return

      const virtual: VirtualCargo = { mode: 'custom', rate }

      if (kind === 'receiver' && receiver.value)
        updateReceiver(receiver.value.receiver.id, { virtual })
      if (kind === 'dispatcher' && dispatcher.value)
        updateDispatcher(dispatcher.value.dispatcher.id, { virtual })
    }

    function setDispatcherItem(item: string | null) {
      const d = dispatcher.value

      if (!d) return

      store.removeLinksOf(d.base.id, nodeIds.dispatcher(d.dispatcher.id), (l) => l.item !== item)
      updateDispatcher(d.dispatcher.id, { item })
    }

    // ==========================================================================
    // Storage
    // ==========================================================================

    const storage = computed(() =>
      editing.value?.kind === 'storage' ? findStorage(editing.value.id) : null,
    )
    const storageNode = computed(() =>
      storage.value
        ? planNode(storage.value.base.id, nodeIds.storage(storage.value.storage.id))
        : undefined,
    )
    const storageInfo = computed(() =>
      storageNode.value?.special?.type === 'storage' ? storageNode.value.special : null,
    )
    const storageText = computed(() => (storageInfo.value ? storageState(storageInfo.value) : null))

    const storageItems = computed<ItemGroups>(() => {
      if (!storage.value) return NO_ITEMS

      const id = storage.value.base.id

      return splitItems(new Set([...consumedItems(id), ...producedItems(id)]))
    })

    function setStorageItem(item: string | null) {
      const s = storage.value

      if (!s) return

      store.removeLinksOf(s.base.id, nodeIds.storage(s.storage.id), (l) => l.item !== item)
      updateStorage(s.storage.id, { item })
    }

    function setStorageCount(e: Event) {
      if (storage.value)
        updateStorage(storage.value.storage.id, {
          count: Math.max(1, Math.round(Number(val(e)) || 1)),
        })
    }

    // ==========================================================================
    // Inter-base rail
    // ==========================================================================

    const link = computed(() =>
      editing.value?.kind === 'railLink'
        ? (project.value.railLinks.find((l) => l.id === editing.value!.id) ?? null)
        : null,
    )
    const linkNode = computed(() =>
      link.value ? planNode(link.value.from, nodeIds.railOut(link.value.id)) : undefined,
    )

    const linkItems = computed<ItemGroups>(() =>
      link.value
        ? splitItems(new Set([...consumedItems(link.value.to), ...producedItems(link.value.from)]))
        : NO_ITEMS,
    )

    function toggleLinkItem(item: string, on: boolean) {
      const l = link.value

      if (!l) return

      updateRailLink(l.id, { items: on ? [...l.items, item] : l.items.filter((x) => x !== item) })
    }

    /** The bases a rail end can be moved to (not the other end's base). */
    const otherBasesThan = (id: string) => project.value.bases.filter((x) => x.id !== id)

    const baseName = (id: string) => baseById(id)?.name ?? '?'

    return {
      // shared
      store,
      project,
      editing,
      index,
      buildingsOfType,
      manyToOne,
      close,
      itemName,
      val,
      numVal,
      checked,
      remove,
      goTo,
      pair,
      nodeIds,
      TITLES,

      // factory
      factory,
      factoryRecipe,
      factoryNode,
      sameProduct,
      perMachine,
      shownCount,
      shownOutput,
      setFactoryCount,
      setFactoryAuto,
      setFactoryOutput,
      setFactoryRecipe,
      balanceFactory,
      chainFactory,
      factoryShort,
      factoryNote,
      factoryReduced,
      factoryPercent,
      inputNote,
      outputNote,
      factoryUpgrades,
      upgradeFactory,
      factoryCycleTime,
      setFactoryCycleTime,

      // mine
      mine,
      mineBuilding,
      mineNode,
      mineInfo,
      mineItems,
      mineBuildings,
      minePurities,
      mineBuildingRate,
      purityRate,
      setMineItem,
      setMineBuilding,
      customOutput,
      mineOutputValue,
      toggleCustomOutput,
      setMineCount,
      setMineOutput,
      balanceMine,
      mineUpgrades,
      upgradeMine,
      updateMine,

      // receiver
      receiver,
      received,
      recvVirtual,
      receiverDispatchers,
      rateOf,
      receiverCapacity,
      receiverDemand,
      receiverItems,
      dispatcherOptions,
      addDispatcherLabel,
      addDispatcher,
      setReceiverItem,
      recvVirtualLimitText,
      updateReceiver,

      // dispatcher
      dispatcher,
      dispatcherReceiver,
      dispatcherInfo,
      feedRate,
      autoFeedLabel,
      dispNode,
      dispVirtual,
      sent,
      siblingCount,
      dispatcherItems,
      showAllReceivers,
      receiverOptions,
      receiverOptionNote,
      dispVirtualLimitText,
      setVirtual,
      setVirtualRate,
      setDispatcherItem,
      updateDispatcher,

      // storage
      storage,
      storageInfo,
      storageText,
      storageItems,
      setStorageItem,
      setStorageCount,
      updateStorage,

      // inter-base rail
      link,
      linkNode,
      linkItems,
      toggleLinkItem,
      otherBasesThan,
      baseName,
      updateRailLink,

      // formatting
      perCycleText,
      formatCount,
      formatPower,
      formatQuantity,
      formatRate,
      railLabel,
      RATE_UNIT_LABEL,
    }
  },
})
