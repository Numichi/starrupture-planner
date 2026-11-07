/**
 * @module composables/usePlanner
 *
 * Data loading and the calculation pipeline.
 *
 * The player's model (bases, nodes, links) lives in `project/projectStore.ts`. This module
 * loads the game data and derives everything the UI shows from the project. Every step
 * re-runs automatically when its input changes:
 *
 * ```
 *   public/data/*.yml ──▶ loadGameData() (data/loader.ts) ──▶ gameData
 *                                                               │
 *   project (nodes, machine counts, links, cargo) ──────────────┤
 *                                                               ▼
 *        buildSizedModel() (engine/projectModel.ts) nominal inputs and outputs;
 *                          automatic factories sized from the available material
 *        solveFlows()      (engine/flow.ts)   one LP: flow on the links
 *        buildBasePlan()   (engine/plan.ts)   one graph per base ──▶ summary
 *        positionGraph()   (engine/layout.ts) the active base, at the stored positions
 *                                                               ▼
 *                                                       ProductionGraph
 * ```
 *
 * Node positions are not part of the calculation: dragging only refreshes the drawing.
 *
 * The state is module-level (a singleton shared by every component that calls
 * {@link usePlanner}); there is no store library.
 */
import { computed, reactive, ref, shallowRef, watch } from 'vue'

import { LOCALE } from '../config'
import { checkIcons, loadGameData } from '../data/loader'
import type { Building, GameData, Recipe } from '../data/types'
import type { LineStyle } from '../engine/edgePaths'
import { solveFlows, type FlowOptions } from '../engine/flow'
import { createGameIndex } from '../engine/gameIndex'
import { autoLayout, positionGraph } from '../engine/layout'
import { applyCycleTimes } from '../engine/missingData'
import {
  buildBasePlan,
  buildCostOf,
  emptyPlan,
  type BuildingSummary,
  type ProductionPlan,
} from '../engine/plan'
import { buildSizedModel } from '../engine/projectModel'
import { initProject, useProject } from '../project/projectStore'

/** Display settings – set in the "Display" panel, remembered by the browser. */
export interface DisplaySettings {
  lineStyle: LineStyle

  /** Lines take the colour of their item (otherwise a single colour). */
  coloredEdges: boolean

  /** Line width is proportional to the flow. */
  proportionalWidth: boolean

  /** Automatic layout: distance between columns. */
  layerSpacing: number

  /** Automatic layout: distance between nodes. */
  nodeSpacing: number

  /** Line labels also show the required rail tier (e.g. v.1 / v.2 / v.3). */
  showRails: boolean

  /** Dragged nodes snap to the grid. */
  snapToGrid: boolean
}

/** One logical recipe for the recipe list of the UI (its variants run in different buildings). */
export interface RecipeGroup {
  id: string
  recipe: Recipe
  buildings: Building[]
}

/** Placeholder until the first load finishes. */
const EMPTY_DATA: GameData = {
  title: 'Production Planner',
  subtitle: '',
  items: [],
  buildings: [],
  recipes: [],
  rails: [],
  purities: [],
  defaultPurity: null,
  features: { cargoManyToOne: false, flowDistribution: 'even' },
  defaultTargets: [],
  startProject: null,
}

const { project, activeBaseId, setCargoRules, setPositions, withoutHistory } = useProject()

// ============================================================================
// Game data loading
// ============================================================================

/** The loaded data, as it is in the files. */
const rawData = shallowRef<GameData>(EMPTY_DATA)

/**
 * The data used for the calculation: the loaded data, completed with the cycle times the
 * player entered in the project (for recipes that have no rate yet).
 */
const gameData = computed(() => applyCycleTimes(rawData.value, project.value.settings.cycleTimes))

/** 'loading': the first load is running; 'ready': data is available; 'error': even the first load failed. */
const loadState = ref<'loading' | 'ready' | 'error'>('loading')

/** The fatal error of the last load (e.g. a YAML syntax error). The previous data stays meanwhile. */
const loadError = ref<string | null>(null)

/** Non-fatal problems in the data files (misspelt id, missing icon etc.). */
const dataWarnings = ref<string[]>([])

const loadedAt = ref<Date | null>(null)

/** Increments per load: a slower, older load must not overwrite a newer one. */
let loadVersion = 0

/** (Re)loads the game data; keeps the previous data on a fatal error. */
async function reloadData() {
  const version = ++loadVersion

  try {
    const { data, warnings } = await loadGameData(version)

    if (version !== loadVersion) return // a newer load started meanwhile

    rawData.value = data
    dataWarnings.value = warnings
    loadError.value = null
    loadState.value = 'ready'
    loadedAt.value = new Date()

    initProject(data) // does something only the first time

    if (warnings.length) console.warn('[data files]\n' + warnings.join('\n'))

    // Icons are checked in the background; the graph is visible meanwhile.
    const iconWarnings = await checkIcons(data)

    if (version === loadVersion && iconWarnings.length) {
      dataWarnings.value = [...dataWarnings.value, ...iconWarnings]
    }
  } catch (err) {
    if (version !== loadVersion) return

    console.error(err)
    loadError.value = err instanceof Error ? err.message : String(err)

    if (loadState.value !== 'ready') loadState.value = 'error'
  }
}

// In development `vite.config.ts` signals when a data file or icon changed: the data is
// reloaded without a page refresh, the project stays.
if (import.meta.hot) {
  import.meta.hot.on('game-data-changed', () => reloadData())
}

const index = computed(() => createGameIndex(gameData.value))

/**
 * Cargo pairing rule from the `features.cargoManyToOne` switch of game.yml. The project
 * store gets it too: with the 1:1 rule a new pairing overrides the old one.
 */
const cargoRules = computed(() => ({ manyToOne: gameData.value.features.cargoManyToOne }))

watch(cargoRules, (rules) => setCargoRules(rules), { immediate: true })

/** The items offered in pickers, alphabetically. */
const selectableItems = computed(() =>
  [...gameData.value.items].sort((a, b) => a.name.localeCompare(b.name, LOCALE)),
)

/** Buildings of one type (for the editor lists). */
const buildingsOfType = (type: Building['type']) =>
  gameData.value.buildings.filter((b) => b.type === type)

// ============================================================================
// Enabling / disabling recipes ("Build chain" only picks from the enabled ones)
// ============================================================================

const isRecipeEnabled = (r: Recipe) =>
  project.value.settings.recipeOverrides[r.baseRecipe] ?? !r.disabledByDefault

function toggleRecipe(r: Recipe) {
  project.value.settings.recipeOverrides[r.baseRecipe] = !isRecipeEnabled(r)
}

/** Recipes for the UI, one row per logical recipe (variants together). */
const recipeGroups = computed<RecipeGroup[]>(() => {
  const groups = new Map<string, RecipeGroup>()

  for (const r of gameData.value.recipes) {
    const g = groups.get(r.baseRecipe) ?? { id: r.baseRecipe, recipe: r, buildings: [] }

    g.buildings.push(index.value.building(r.building))
    groups.set(r.baseRecipe, g)
  }

  return [...groups.values()]
})

/** Recipe variants for the chain builder: the enabled ones that have a rate (a recipe without a rate is never used). */
const chainRecipes = computed(
  () =>
    new Set(
      gameData.value.recipes
        .filter((r) => isRecipeEnabled(r) && r.rateFrom !== 'missing')
        .map((r) => r.id),
    ),
)

// ============================================================================
// Display (remembered by the browser)
// ============================================================================

/** localStorage key of the display settings (persisted: changing it resets them). */
const DISPLAY_KEY = 'starrupture-planner.display'

const display = reactive<DisplaySettings>({
  lineStyle: 'curved',
  coloredEdges: true,
  proportionalWidth: true,
  layerSpacing: 110,
  nodeSpacing: 36,
  showRails: true,
  snapToGrid: true,
})

try {
  Object.assign(display, JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? '{}'))
} catch {
  /* no saved settings (or storage unavailable) */
}

watch(display, () => {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(display))
  } catch {
    /* storage unavailable: the settings simply are not remembered */
  }
})

// ============================================================================
// Calculation
// ============================================================================

const activeBase = computed(() => project.value.bases.find((b) => b.id === activeBaseId.value))

/** The available rail tiers (up to the selected best one). */
const availableRails = computed(() => {
  const all = gameData.value.rails
  const maxIndex = all.findIndex((t) => t.name === project.value.settings.maxRailName)

  return maxIndex === -1 ? all : all.slice(0, maxIndex + 1)
})

/** Distribution: even (default) or LP optimum (`features.flowDistribution` in game.yml). */
const flowOptions = computed<FlowOptions>(() => ({
  distribution: gameData.value.features.flowDistribution,
}))

// --- 1. Model: nominal inputs and outputs of the nodes, links, transfers ---
// The automatic factories are sized from the available material (engine/flow.ts › autoFactoryCounts).
const model = computed(() =>
  buildSizedModel(
    index.value,
    project.value,
    availableRails.value,
    cargoRules.value,
    flowOptions.value,
  ),
)

// --- 2. One LP for all bases: flow on the links ---
const flow = computed(() => solveFlows(model.value, new Set(), flowOptions.value))

// --- 3. One graph per base (the summary needs all of them) ---
const basePlans = computed(() => {
  const plans = new Map<string, ProductionPlan>()
  const options = { rails: availableRails.value, cargo: cargoRules.value }

  for (const base of project.value.bases) {
    plans.set(
      base.id,
      buildBasePlan(index.value, project.value, model.value, flow.value, base.id, options),
    )
  }

  return plans
})

const EMPTY_PLAN = emptyPlan('empty')

/** The plan of the active base. */
const plan = computed(() => basePlans.value.get(activeBaseId.value) ?? EMPTY_PLAN)

/**
 * The whole project (all bases together): power demand, buildings to place and the minimum
 * build cost. Rails are not included (their cost depends on the layout).
 */
const projectSummary = computed(() => {
  const byBuilding = new Map<string, BuildingSummary>()
  let totalPower = 0

  for (const p of basePlans.value.values()) {
    totalPower += p.summary.totalPower

    for (const b of p.summary.buildings) {
      const s = byBuilding.get(b.building.id) ?? {
        building: b.building,
        count: 0,
        roundedCount: 0,
        power: 0,
      }

      s.count += b.count
      s.roundedCount += b.roundedCount
      s.power += b.power
      byBuilding.set(b.building.id, s)
    }
  }

  const buildings = [...byBuilding.values()]

  return {
    totalPower,
    totalRounded: buildings.reduce((a, b) => a + b.roundedCount, 0),
    buildings,
    ...buildCostOf(
      buildings,
      gameData.value.items.map((i) => i.id),
    ),
  }
})

/** The items the factories of a base consume (hint for the item pickers). */
function consumedItems(baseId: string): Set<string> {
  const set = new Set<string>()

  for (const n of basePlans.value.get(baseId)?.nodes ?? []) {
    if (n.kind === 'factory') for (const port of n.inputs) set.add(port.item)
  }

  return set
}

/** The items produced in a base (hint for the item pickers). */
function producedItems(baseId: string): Set<string> {
  const set = new Set<string>()

  for (const n of basePlans.value.get(baseId)?.nodes ?? []) {
    if (n.kind === 'factory' || n.kind === 'mine' || n.kind === 'receiver' || n.kind === 'railIn') {
      for (const port of n.outputs) set.add(port.item)
    }
  }

  return set
}

// --- 4. Drawing: the stored positions, shifted while dragging ---

/** While dragging: these nodes are shown shifted by the offset (the project gets it at the end). */
const dragOffset = shallowRef<{ ids: ReadonlySet<string>; dx: number; dy: number } | null>(null)

const layout = computed(() =>
  positionGraph(plan.value, activeBase.value?.positions ?? {}, dragOffset.value ?? undefined),
)

// Nodes without a position (old project, an incoming rail created from another base) are
// laid out automatically and their positions go into the project. This is not a separate
// undo step (withoutHistory): otherwise it would happen again right after Ctrl+Z.
let placing = false

watch(
  () => layout.value.missing.join('|'),
  async (key) => {
    if (!key || placing) return

    const baseId = activeBaseId.value
    const l = layout.value
    const missing = new Set(l.missing)
    const allMissing = missing.size === l.nodes.length

    placing = true

    try {
      const nodes = plan.value.nodes.filter((n) => allMissing || missing.has(n.id))
      const placed = l.nodes.filter((n) => !missing.has(n.node.id))
      const origin =
        allMissing || !placed.length
          ? { x: 40, y: 40 }
          : {
              x: Math.min(...placed.map((n) => n.x)),
              y: Math.max(...placed.map((n) => n.y + n.height)) + 80,
            }
      const positions = await autoLayout(nodes, plan.value.edges, display, origin)

      if (baseId === activeBaseId.value) withoutHistory(() => setPositions(baseId, positions))
    } catch (err) {
      console.error(err)
    } finally {
      placing = false
    }
  },
  { immediate: true },
)

/** The text shown in place of the graph (if any). */
const statusMessage = computed<string | null>(() => {
  if (loadState.value === 'loading') return 'Loading data…'
  if (loadState.value === 'error') return `The data could not be loaded.\n${loadError.value}`
  if (plan.value.status !== 'optimal') return plan.value.message ?? null

  return null
})

// Start-up
reloadData()

/** The shared planner state and the derived calculation results. */
export function usePlanner() {
  return {
    // data
    gameData,
    rawData,
    index,
    cargoRules,
    flowOptions,
    loadState,
    loadError,
    dataWarnings,
    loadedAt,
    reloadData,
    selectableItems,
    recipeGroups,
    buildingsOfType,

    // recipes
    isRecipeEnabled,
    toggleRecipe,
    chainRecipes,

    // display
    display,
    dragOffset,

    // calculation
    activeBase,
    availableRails,
    model,
    flow,
    basePlans,
    plan,
    projectSummary,
    layout,
    statusMessage,
    consumedItems,
    producedItems,
  }
}
