/**
 * @component ContextMenu
 *
 * Right-click menu on the canvas.
 *
 *   Canvas:  place at the click position. Search (item, recipe, building name), or browse:
 *            Factory › building › recipe, Mine › item, Receiver, Dispatcher, Storage,
 *            Rail line, Inter-base rail › target base. Below: balance, arrange, select.
 *   Node:    edit, upgrade / downgrade (always shown for a factory or mine; disabled with a
 *            note when there is no upgraded variant), build chain (when an input is
 *            missing), balance the machine count, delete links, delete. With several
 *            selected: together.
 *   Edge:    delete the link, select both ends.
 */
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  type PropType,
} from 'vue'

import ItemIcon from '@/components/ItemIcon/ItemIcon.vue'
import type { MenuState } from '@/components/graphEvents'
import { rateNote } from '@/components/missingData'
import { useNotice } from '@/components/notice'
import {
  useEditorActions,
  type BalanceReport,
  type ChainReport,
} from '@/composables/useEditorActions'
import { usePlanner } from '@/composables/usePlanner'
import { EPSILON, LOCALE, RATE_UNIT_LABEL } from '@/config'
import type { Building, Recipe } from '@/data/types'
import { formatQuantity, formatRate } from '@/engine/format'
import type { PlanNode } from '@/engine/plan'
import { upgradeOptions, type UpgradeOption } from '@/engine/upgrades'
import { useProject } from '@/project/projectStore'
import { linkRailKey, parseNodeId } from '@/project/types'

type SpecialKind = 'receiver' | 'dispatcher' | 'storage' | 'railLine'

/** The special nodes offered for placing. */
const SPECIALS: { kind: SpecialKind; label: string; hint: string; words: string }[] = [
  { kind: 'receiver', label: 'Receiver', hint: 'cargo receiver (source)', words: 'receiver cargo' },
  { kind: 'dispatcher', label: 'Dispatcher', hint: 'cargo sender', words: 'dispatcher cargo' },
  { kind: 'storage', label: 'Storage', hint: 'buffer or sink', words: 'storage depot' },
  {
    kind: 'railLine',
    label: 'Rail line',
    hint: 'collector: several sources and items on one rail',
    words: 'rail line collector shared distributor drone parallel',
  },
]

/** Browsing state of the canvas menu. */
type MenuView =
  | { type: 'root' }
  | { type: 'factories' }
  | { type: 'building'; building: Building }
  | { type: 'mines' }
  | { type: 'railLink' }

/** Lower case, without diacritics. */
const norm = (s: string) => s.toLocaleLowerCase(LOCALE).normalize('NFD').replace(/[̀-ͯ]/g, '')

/** How many shortages a balance message lists at most. */
const MAX_LISTED_SHORTAGES = 4

export default defineComponent({
  name: 'ContextMenu',

  components: { ItemIcon },

  props: {
    menu: { type: Object as PropType<MenuState>, required: true },
  },

  emits: {
    close: () => true,
    fit: () => true,
  },

  setup(props, { emit }) {
    const { index, gameData, plan, layout, activeBase } = usePlanner()
    const store = useProject()
    const actions = useEditorActions()
    const { notify } = useNotice()

    const at = computed(() => props.menu.world)
    const done = () => emit('close')
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done()

    onMounted(() => window.addEventListener('keydown', onKey))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

    const multiBase = computed(() => store.project.value.bases.length > 1)
    const hasClipboard = computed(() => !!store.clipboard.value)

    // ==========================================================================
    // Canvas: placing
    // ==========================================================================

    const query = ref('')
    const searchEl = ref<HTMLInputElement | null>(null)

    onMounted(async () => {
      await nextTick()
      searchEl.value?.focus()
    })

    /** Browsing: root, the recipes of one building, mines, inter-base rail target. */
    const view = ref<MenuView>({ type: 'root' })

    const productionBuildings = computed(() =>
      gameData.value.buildings.filter(
        (b) => b.type === 'production' && gameData.value.recipes.some((r) => r.building === b.id),
      ),
    )

    const recipesOf = (b: Building) => gameData.value.recipes.filter((r) => r.building === b.id)

    const mineOptions = computed(() =>
      gameData.value.buildings
        .filter((b) => b.type === 'miner')
        .flatMap((b) => Object.keys(b.mines ?? {}).map((item) => ({ building: b, item }))),
    )

    const otherBases = computed(() =>
      store.project.value.bases.filter((b) => b.id !== store.activeBaseId.value),
    )

    /** Short recipe description: inputs → outputs per machine. */
    function io(r: Recipe) {
      const speed = index.value.building(r.building).speed

      return {
        ins: r.inputs.map((x) => ({ item: index.value.item(x.item), rate: x.amount * speed })),
        outs: r.outputs.map((x) => ({ item: index.value.item(x.item), rate: x.amount * speed })),
      }
    }

    const results = computed(() => {
      const q = norm(query.value.trim())

      if (!q) return null

      const words = q.split(/\s+/)

      const match = (text: string) => {
        const t = norm(text)

        return words.every((w) => t.includes(w))
      }

      const recipes = gameData.value.recipes
        .filter((r) =>
          match(
            `${r.name} ${index.value.item(r.product).name} ${index.value.building(r.building).name}`,
          ),
        )
        .slice(0, 30)
      const mines = mineOptions.value
        .filter((m) => match(`${index.value.item(m.item).name} ${m.building.name} mine`))
        .slice(0, 12)
      const specials = SPECIALS.filter((s) => match(`${s.label} ${s.words}`))

      return { recipes, mines, specials }
    })

    function placeRecipe(r: Recipe) {
      actions.placeFactory(r.id, at.value)
      done()
    }

    function placeMine(b: Building, item: string) {
      actions.placeMine(b.id, item, at.value)
      done()
    }

    function placeSpecial(kind: SpecialKind) {
      actions.placeSpecial(kind, at.value)
      done()
    }

    function placeRailLink(toBaseId: string) {
      actions.placeRailLink(toBaseId, at.value)
      done()
    }

    /** Enter in the search: places the first hit. */
    function onSearchEnter() {
      const r = results.value

      if (!r) return

      if (r.recipes[0]) placeRecipe(r.recipes[0])
      else if (r.mines[0]) placeMine(r.mines[0].building, r.mines[0].item)
      else if (r.specials[0]) placeSpecial(r.specials[0].kind)
    }

    // ==========================================================================
    // Node
    // ==========================================================================

    const targetNodeId = computed(() =>
      props.menu.target.type === 'node' ? props.menu.target.nodeId : null,
    )

    /** Several selected nodes together (when the menu opened on a selected node). */
    const multi = computed(() =>
      targetNodeId.value &&
      store.selection.value.length > 1 &&
      store.selection.value.includes(targetNodeId.value)
        ? store.selection.value
        : null,
    )

    const node = computed(() => plan.value.nodes.find((n) => n.id === targetNodeId.value))

    const upgrades = computed<UpgradeOption[]>(() => {
      const n = node.value

      if (!n) return []

      if (n.kind === 'factory' && n.recipe) {
        return upgradeOptions(index.value, n.recipe.building, n.recipe.product, 'recipe')
      }

      if (n.special?.type === 'mine' && n.special.mine.item) {
        return upgradeOptions(index.value, n.special.mine.building, n.special.mine.item, 'mine')
      }

      return []
    })

    /** Factory / mine: whether an upgraded variant exists (otherwise the item is disabled, with a note). */
    const canUpgrade = computed(() => node.value?.kind === 'factory' || node.value?.kind === 'mine')

    const noUpgradeNote = computed(() => {
      if (upgrades.value.some((o) => o.direction === 'up')) return ''

      const what = node.value?.kind === 'mine' ? 'mine' : 'factory'

      return upgrades.value.length
        ? 'this is already the upgraded variant'
        : `this ${what} has no upgraded variant`
    })

    const shortInputs = computed(
      () => node.value?.kind === 'factory' && node.value.inputs.some((p) => p.gap > EPSILON),
    )

    const hasLinks = computed(
      () =>
        !!activeBase.value?.links.some(
          (l) => l.from === targetNodeId.value || l.to === targetNodeId.value,
        ),
    )

    function edit() {
      if (targetNodeId.value) store.editing.value = store.editTargetOf(targetNodeId.value)

      done()
    }

    function doUpgrade(o: UpgradeOption) {
      if (targetNodeId.value) actions.upgrade(targetNodeId.value, o)

      done()
    }

    function chainReport(r: ChainReport) {
      const m = actions.chainMessage(r)

      notify(m.text, m.tone, 6000)
    }

    function chain() {
      if (targetNodeId.value) chainReport(actions.buildChain(targetNodeId.value))

      done()
    }

    function balanceReport(r: BalanceReport) {
      const short = r.shortages.map(
        (s) => `${s.title}: ${index.value.item(s.item).name} ${formatRate(s.rate)}`,
      )
      const more = short.length > MAX_LISTED_SHORTAGES ? '…' : ''
      const still = short.length
        ? `\nStill missing: ${short.slice(0, MAX_LISTED_SHORTAGES).join('; ')}${more}`
        : ''

      notify(
        `Balance: the machine count of ${r.changed} node${r.changed === 1 ? '' : 's'} changed.${still}`,
        short.length ? 'bad' : 'ok',
        6000,
      )
    }

    /** Factory: automatic ↔ manual machine count (to manual with the current count). */
    function toggleCountMode(n: PlanNode) {
      const { id } = parseNodeId(n.id)

      store.setFactoryCount(id, n.countMode === 'manual' ? 'auto' : n.count)
      done()
    }

    /**
     * @param toManual the automatic factories switch to manual first (balancing one factory to
     *                 its consumer demand)
     */
    function balanceNodes(ids?: readonly string[], toManual = false) {
      balanceReport(actions.balance(ids, { toManual }))
      done()
    }

    function removeLinksOfNode() {
      if (targetNodeId.value) store.removeLinksOf(store.activeBaseId.value, targetNodeId.value)

      done()
    }

    function removeSelected(ids: readonly string[]) {
      store.removeNodes(store.activeBaseId.value, [...ids])
      done()
    }

    async function arrange(ids?: readonly string[]) {
      done()
      await actions.arrange(ids)

      if (!ids) emit('fit')
    }

    function selectAll() {
      store.select(layout.value.nodes.map((n) => n.node.id))
      done()
    }

    function fit() {
      emit('fit')
      done()
    }

    const canDelete = computed(() => targetNodeId.value !== null)

    function copy(ids: readonly string[]) {
      const m = actions.copyNodes(ids)

      if (m) notify(m.text, m.tone)

      done()
    }

    /** Paste at the right-click position. */
    function paste() {
      const m = actions.pasteNodes(at.value)

      if (m) notify(m.text, m.tone)

      done()
    }

    /** The factories and mines of every base (to balance the whole project). */
    const allProducers = computed(() =>
      store.project.value.bases.flatMap((b) => [
        ...b.factories.map((f) => `fac:${f.id}`),
        ...b.mines.map((m) => `mine:${m.id}`),
      ]),
    )

    const nodeKindLabel = computed(() => {
      const k = node.value?.kind

      if (k === 'factory') return 'Factory'
      if (k === 'mine') return 'Mine'
      if (k === 'line') return 'Rail line'

      return node.value?.title ?? ''
    })

    /** "Balance the machine count" note: an automatic factory switches to manual. */
    const balanceNote = computed(() =>
      node.value?.countMode && node.value.countMode !== 'manual' ? ' (switches to manual)' : '',
    )

    // ==========================================================================
    // Edge
    // ==========================================================================

    const link = computed(() => {
      const target = props.menu.target

      return target.type === 'edge'
        ? activeBase.value?.links.find((l) => l.id === target.linkId)
        : undefined
    })

    /** The items of the rail (all links between the two nodes). */
    const railLinks = computed(() => {
      const l = link.value

      return l
        ? (activeBase.value?.links ?? []).filter((x) => linkRailKey(x) === linkRailKey(l))
        : []
    })

    /** Deletes the whole rail (one line on the graph: all its items). */
    function removeLink() {
      if (link.value) store.removeRail(store.activeBaseId.value, link.value.id)

      done()
    }

    function openLink() {
      if (link.value)
        store.editing.value = { kind: 'link', id: link.value.id, baseId: store.activeBaseId.value }

      done()
    }

    function selectEnds() {
      if (link.value) store.select([link.value.from, link.value.to])

      done()
    }

    const nodeTitle = (id: string) =>
      plan.value.nodes.find((n) => n.id === id)?.title ?? parseNodeId(id).id
    const menuStyle = computed(() => ({ left: `${props.menu.left}px`, top: `${props.menu.top}px` }))

    return {
      index,
      done,
      multiBase,
      hasClipboard,
      query,
      searchEl,
      view,
      productionBuildings,
      recipesOf,
      mineOptions,
      otherBases,
      io,
      results,
      placeRecipe,
      placeMine,
      placeSpecial,
      placeRailLink,
      onSearchEnter,
      multi,
      node,
      upgrades,
      canUpgrade,
      noUpgradeNote,
      shortInputs,
      hasLinks,
      edit,
      doUpgrade,
      chain,
      toggleCountMode,
      balanceNodes,
      removeLinksOfNode,
      removeSelected,
      arrange,
      selectAll,
      fit,
      canDelete,
      copy,
      paste,
      allProducers,
      nodeKindLabel,
      balanceNote,
      link,
      railLinks,
      removeLink,
      openLink,
      selectEnds,
      nodeTitle,
      menuStyle,
      rateNote,
      formatQuantity,
      formatRate,
      SPECIALS,
      RATE_UNIT_LABEL,
    }
  },
})
