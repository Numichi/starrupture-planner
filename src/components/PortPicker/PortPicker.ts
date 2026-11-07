/**
 * @component PortPicker
 *
 * Port picker – opens on the graph when an item row is clicked, or when a link is dropped
 * on empty canvas.
 *
 * For an input (WHAT SUPPLIES IT?):
 *   - its existing links (deletable),
 *   - Build chain down to the raw materials (for a factory, when something is missing),
 *   - a mine (for a raw material), a new factory from the recipes (with as many machines as
 *     cover the shortage),
 *   - Receiver, rail line (collector), inter-base rail from another base,
 *   - linking from an existing node that has such an output.
 *
 * For an output (WHAT USES IT?):
 *   - its existing links,
 *   - a new factory from the recipes that use this item: with as many machines as take the
 *     remainder, or as many as you enter,
 *   - Dispatcher, storage, rail line (collector), inter-base rail to another base,
 *   - linking into an existing consumer.
 *
 * Only what fits here is listed; the search filters further (Enter: the first hit). On a
 * click the new node goes next to the clicked one; for a link dropped on empty canvas it
 * goes where it was dropped (its linked port lands there).
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
import type { PickerState } from '@/components/graphEvents'
import { perCycleText, rateNote } from '@/components/missingData'
import { useNotice } from '@/components/notice'
import { useEditorActions } from '@/composables/useEditorActions'
import { usePlanner } from '@/composables/usePlanner'
import { EPSILON, RATE_UNIT_LABEL } from '@/config'
import type { Recipe } from '@/data/types'
import { formatQuantity, formatRate } from '@/engine/format'
import { mineRateSummary, minersFor } from '@/engine/mining'
import { canAcceptInput, canProvideOutput, factoryPorts } from '@/engine/projectModel'
import { useProject } from '@/project/projectStore'

/** Lower case, without diacritics (so "cafe" also finds "café"). */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** An existing node the port can be linked with. */
interface Candidate {
  id: string
  title: string
  kind: string
  note: string
}

/** A transport option (Receiver, Dispatcher, storage, rail line, inter-base rail). */
interface TransportOption {
  key: string
  label: string

  /** Search keywords. */
  text: string

  run: () => void
}

export default defineComponent({
  name: 'PortPicker',

  components: { ItemIcon },

  props: {
    state: { type: Object as PropType<PickerState>, required: true },
  },

  emits: {
    close: () => true,
  },

  setup(props, { emit }) {
    const { index, gameData, plan, model, isRecipeEnabled } = usePlanner()
    const store = useProject()
    const actions = useEditorActions()
    const { notify } = useNotice()

    const item = computed(() => index.value.item(props.state.item))
    const isInput = computed(() => props.state.dir === 'in')

    /** A link dropped on empty canvas: the linked port of the new node goes here. */
    const drop = computed(() => props.state.drop?.at)

    const node = computed(() => plan.value.nodes.find((n) => n.id === props.state.nodeId))
    const port = computed(() =>
      (isInput.value ? node.value?.inputs : node.value?.outputs)?.find(
        (p) => p.item === props.state.item,
      ),
    )
    const gap = computed(() => port.value?.gap ?? 0)

    const rootEl = ref<HTMLElement | null>(null)
    const searchEl = ref<HTMLInputElement | null>(null)

    const done = () => emit('close')
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done()

    onMounted(() => {
      window.addEventListener('keydown', onKey)
      nextTick(() => searchEl.value?.focus({ preventScroll: true }))
    })

    onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

    const title = (id: string) => plan.value.nodes.find((n) => n.id === id)?.title ?? id

    // --- Search ---

    const query = ref('')
    const words = computed(() => norm(query.value).split(/\s+/).filter(Boolean))

    /** Whether every searched word is in the text. */
    const hit = (text: string) => words.value.every((w) => norm(text).includes(w))

    /** Enter: the first visible option. */
    function pickFirst() {
      rootEl.value?.querySelector<HTMLButtonElement>('[data-option]')?.click()
    }

    // --- Existing links on this port (not needed for a drop on empty canvas) ---

    /** The links of the active base on this port. */
    const portLinks = computed(() =>
      (store.activeBase()?.links ?? []).filter(
        (l) =>
          l.item === props.state.item &&
          (isInput.value ? l.to === props.state.nodeId : l.from === props.state.nodeId),
      ),
    )

    const links = computed(() => (drop.value ? [] : portLinks.value))

    const linkFlow = (id: string) =>
      plan.value.edges.filter((e) => e.linkId === id).reduce((a, e) => Math.max(a, e.rate), 0)

    const removeLink = (id: string) => store.removeLink(store.activeBaseId.value, id)

    // --- Existing nodes it can be linked with ---

    const candidates = computed(() => {
      const linked = new Set(portLinks.value.map((l) => (isInput.value ? l.from : l.to)))
      const list: Candidate[] = []

      for (const m of model.value.byBase.get(store.activeBaseId.value) ?? []) {
        if (m.id === props.state.nodeId || linked.has(m.id)) continue

        const ok = isInput.value
          ? m.outputs.some((p) => p.item === props.state.item) &&
            canProvideOutput(m, props.state.item)
          : m.inputs.some((p) => p.item === props.state.item) && canAcceptInput(m, props.state.item)

        if (!ok || !hit(m.title)) continue

        const pn = plan.value.nodes.find((n) => n.id === m.id)
        const p = (isInput.value ? pn?.outputs : pn?.inputs)?.find(
          (x) => x.item === props.state.item,
        )
        const note =
          p && p.gap > EPSILON
            ? isInput.value
              ? `free ${formatRate(p.gap)}`
              : `missing ${formatRate(p.gap)}`
            : ''

        list.push({ id: m.id, title: m.title, kind: m.kind, note })
      }

      return list
    })

    function connectTo(id: string) {
      const { nodeId, item: it } = props.state
      const error = isInput.value
        ? actions.connect(id, nodeId, it)
        : actions.connect(nodeId, id, it)

      if (error) notify(error, 'bad')

      done()
    }

    // --- New factory ---

    /** Short in → out summary per machine. */
    function io(r: Recipe) {
      const ports = factoryPorts(r, index.value.building(r.building), 1)

      return {
        ins: ports.inputs.map((p) => ({
          item: index.value.item(p.item),
          rate: p.perBuilding ?? 0,
        })),
        outs: ports.outputs.map((p) => ({
          item: index.value.item(p.item),
          rate: p.perBuilding ?? 0,
        })),
      }
    }

    type RecipeOption = {
      recipe: Recipe
      per: number
      enabled: boolean
      io: ReturnType<typeof io>
      text: string
    }

    /** Recipe variants that make this item (input) / use it (output). */
    const allRecipes = computed<RecipeOption[]>(() => {
      const list: RecipeOption[] = []

      for (const r of gameData.value.recipes) {
        const ports = factoryPorts(r, index.value.building(r.building), 1)
        const p = (isInput.value ? ports.outputs : ports.inputs).find(
          (x) => x.item === props.state.item,
        )

        if (!p) continue

        const x = io(r)
        const text = [
          r.name,
          index.value.building(r.building).name,
          ...x.ins.map((i) => i.item.name),
          ...x.outs.map((o) => o.item.name),
        ].join(' ')

        list.push({ recipe: r, per: p.perBuilding ?? 0, enabled: isRecipeEnabled(r), io: x, text })
      }

      // First the ones making it as their main product, the enabled ones, the base buildings.
      const isUpgrade = (r: Recipe) => Number(!!index.value.building(r.building).upgradeOf)

      return list.sort(
        (a, b) =>
          Number(b.recipe.product === props.state.item) -
            Number(a.recipe.product === props.state.item) ||
          Number(b.enabled) - Number(a.enabled) ||
          isUpgrade(a.recipe) - isUpgrade(b.recipe),
      )
    })

    const recipes = computed(() => allRecipes.value.filter((o) => hit(o.text)))

    /** For an output: how many machines (the remainder, or a typed count). */
    const amountMode = ref<'gap' | 'machines'>(gap.value > EPSILON ? 'gap' : 'machines')
    const machines = ref(1)

    function countFor(per: number): number {
      if (isInput.value || amountMode.value === 'gap')
        return per > 0 && gap.value > EPSILON ? gap.value / per : 1

      return Math.max(0, machines.value)
    }

    function chooseRecipe(r: Recipe) {
      const { nodeId, item: it } = props.state

      if (isInput.value) {
        actions.addProducerFactory(nodeId, it, r.id, drop.value)
      } else {
        const count =
          amountMode.value === 'gap' && gap.value > EPSILON ? null : Math.max(0, machines.value)

        actions.addConsumerFactory(nodeId, it, r.id, count, drop.value)
      }

      done()
    }

    // --- Mine (for an input of a raw material) ---

    const allMiners = computed(() =>
      isInput.value ? minersFor(gameData.value, props.state.item) : [],
    )
    const miners = computed(() => allMiners.value.filter((b) => hit(`${b.name} mine`)))

    function chooseMine(buildingId: string) {
      actions.addProducerMine(props.state.nodeId, props.state.item, buildingId, drop.value)
      done()
    }

    // --- Transport: Receiver / Dispatcher, storage, rail line, inter-base rail ---

    const otherBases = computed(() =>
      store.project.value.bases.filter((b) => b.id !== store.activeBaseId.value),
    )

    const transport = computed(() => {
      const nodeId = props.state.nodeId
      const it = props.state.item
      const at = drop.value

      const list: TransportOption[] = isInput.value
        ? [
            {
              key: 'recv',
              label: '+ Receiver',
              text: 'receiver cargo',
              run: () => actions.addProducerReceiver(nodeId, it, at),
            },
            {
              key: 'line',
              label: '+ Rail line',
              text: 'rail line collector drone rail',
              run: () => actions.addProducerLine(nodeId, it, at),
            },
            ...otherBases.value.map((b) => ({
              key: `rail:${b.id}`,
              label: `+ Rail from: ${b.name}`,
              text: `inter-base rail ${b.name}`,
              run: () => actions.addProducerRailLink(nodeId, it, b.id, at),
            })),
          ]
        : [
            {
              key: 'disp',
              label: '+ Dispatcher',
              text: 'dispatcher cargo',
              run: () => actions.addConsumerSpecial(nodeId, it, 'dispatcher', at),
            },
            {
              key: 'store',
              label: '+ Storage',
              text: 'storage',
              run: () => actions.addConsumerSpecial(nodeId, it, 'storage', at),
            },
            {
              key: 'line',
              label: '+ Rail line',
              text: 'rail line collector drone rail',
              run: () => actions.addConsumerSpecial(nodeId, it, 'line', at),
            },
            ...otherBases.value.map((b) => ({
              key: `rail:${b.id}`,
              label: `+ Rail to: ${b.name}`,
              text: `inter-base rail ${b.name}`,
              run: () => actions.addConsumerRailLink(nodeId, it, b.id, at),
            })),
          ]

      return list.filter((t) => hit(`${t.label} ${t.text}`))
    })

    function chooseTransport(t: TransportOption) {
      t.run()
      done()
    }

    // --- Build chain ---

    const canChain = computed(
      () =>
        isInput.value &&
        node.value?.kind === 'factory' &&
        gap.value > EPSILON &&
        hit('build chain'),
    )

    function chain() {
      const m = actions.chainMessage(
        actions.buildChain(props.state.nodeId, props.state.item, drop.value),
      )

      notify(m.text, m.tone, 6000)
      done()
    }

    const nothingFound = computed(
      () =>
        words.value.length > 0 &&
        !canChain.value &&
        !candidates.value.length &&
        !recipes.value.length &&
        !miners.value.length &&
        !transport.value.length,
    )

    const subtitle = computed(() => {
      if (drop.value) return isInput.value ? 'New source here' : 'New consumer here'

      return isInput.value ? 'What supplies it?' : 'What uses it?'
    })

    const itemName = (i: string) => index.value.item(i).name
    const pickerStyle = computed(() => ({
      left: `${props.state.left}px`,
      top: `${props.state.top}px`,
    }))

    return {
      index,
      gameData,
      item,
      isInput,
      drop,
      port,
      gap,
      rootEl,
      searchEl,
      done,
      title,
      query,
      words,
      pickFirst,
      links,
      linkFlow,
      removeLink,
      candidates,
      connectTo,
      allRecipes,
      recipes,
      amountMode,
      machines,
      countFor,
      chooseRecipe,
      allMiners,
      miners,
      chooseMine,
      transport,
      chooseTransport,
      canChain,
      chain,
      nothingFound,
      subtitle,
      itemName,
      pickerStyle,
      rateNote,
      perCycleText,
      mineRateSummary,
      formatQuantity,
      formatRate,
      RATE_UNIT_LABEL,
    }
  },
})
