/**
 * @module engine/chain
 *
 * "Build chain" – the complete supply chain of a demand, down to the raw materials.
 *
 * Input: what is needed (item + items/min, and which node input to link it to), and what
 * the base's existing free sources can give. Output: factories and mines to place with
 * their machine counts, and the links between them – the store places the nodes from it.
 *
 * Recipe selection is a linear program (LP, `yalps`):
 *
 * ```
 * Variables:  r|<recipe>   machines running the recipe
 *             m|<item>     mines providing the raw material (the miner is the first
 *                          non-upgraded miner of the item in the data file)
 *             e|<source>   what an existing source gives (up to its free capacity)
 *             i|<item>     what nothing provides (shortage, very expensive)
 * Per item:   Σ production − Σ consumption ≥ demand
 * Objective:  fewest buildings, or least power (project setting).
 * ```
 *
 * An existing source is nearly free, so it is used first. Recipes of upgraded (v.2)
 * buildings are much more expensive, so they only enter the chain when the base building
 * cannot do it: upgrades are chosen per node by the player.
 *
 * Links: per item, producers are allocated greedily to consumers (few links, `flows.ts`).
 */
import { solve, type Coefficients, type Constraint } from 'yalps'

import { EPSILON, IMPORT_PENALTY } from '../config'
import type { Building, Recipe } from '../data/types'
import { allocateFlows } from './flows'
import { isRecipeUsable, netRatesPerBuilding, type GameIndex } from './gameIndex'
import { defaultPurityFor, minersFor } from './mining'
import { rateFor } from './rateTable'

/** What recipe selection minimises. */
export type Objective = 'buildings' | 'power'

/** One demand of the chain. */
export interface ChainDemand {
  item: string
  rate: number

  /** The consumer node to link to; null: the end of the chain (the product itself is the goal). */
  consumer: string | null
}

/** An existing free source in the base (e.g. a Receiver, a mine with surplus). */
export interface ChainSource {
  nodeId: string
  item: string

  /** What it can still give (items/min); Infinity = unlimited. */
  rate: number
}

/** Options of {@link planChain}. */
export interface ChainOptions {
  /** Ids of the enabled recipe variants (others are not used). */
  enabledRecipes: ReadonlySet<string>

  objective: Objective
  sources?: readonly ChainSource[]
}

/** The planned chain. */
export interface ChainPlan {
  status: 'optimal' | 'error'
  message?: string

  /** Factories to place. `key` is the temporary id of the new node. */
  factories: { key: string; recipe: Recipe; count: number }[]

  mines: { key: string; building: Building; item: string; purity: string | null; count: number }[]

  /** Links: `from` / `to` is the key of a new node or the id of an existing node. */
  links: { from: string; to: string; item: string }[]

  /** What nothing can provide (no recipe, no miner, no existing source). */
  missing: { item: string; rate: number; consumer: string | null }[]

  /** "Depth" of the new nodes: steps away from the consumer (used for placement). */
  depth: Map<string, number>
}

const factoryKey = (recipeId: string) => `new:fac:${recipeId}`
const mineKey = (item: string) => `new:mine:${item}`

/** Recipes of upgraded buildings cost this many times more (used only as a last resort). */
const UPGRADE_PENALTY = 1000

/** Cost of one building in the objective. */
function weight(building: Building, objective: Objective): number {
  const base = objective === 'power' ? Math.max(building.power, 0) + 0.01 : 1

  return building.upgradeOf ? base * UPGRADE_PENALTY : base
}

/** The miner for an item: the first non-upgraded one, or the first one. */
function minerFor(
  index: GameIndex,
  item: string,
): { building: Building; purity: string | null; perBuilding: number } | null {
  const miners = minersFor(index.data, item)
  const building = miners.find((b) => !b.upgradeOf) ?? miners[0]

  if (!building) return null

  const purity = defaultPurityFor(index.data, building, item)
  const perBuilding = rateFor(building.mines?.[item], purity).rate

  return perBuilding > 0 ? { building, purity, perBuilding } : null
}

/**
 * Plans the supply chain of the demands.
 *
 * @param demands what is needed and where to link it
 * @param options enabled recipes, objective and existing free sources
 * @returns the nodes to place, their links, what is missing, and placement depths
 */
export function planChain(
  index: GameIndex,
  demands: readonly ChainDemand[],
  options: ChainOptions,
): ChainPlan {
  const empty: ChainPlan = {
    status: 'optimal',
    factories: [],
    mines: [],
    links: [],
    missing: [],
    depth: new Map(),
  }
  const wanted = demands.filter((d) => d.rate > EPSILON && index.hasItem(d.item))

  if (wanted.length === 0) return empty

  const variables = new Map<string, Coefficients>()
  const constraints = new Map<string, Constraint>()
  const row = (item: string) => `b|${item}`
  const items = new Set<string>()
  const producible = new Set<string>()

  const recipes = index.data.recipes.filter(
    (r) => isRecipeUsable(r, index.hasBuilding) && options.enabledRecipes.has(r.id),
  )

  for (const r of recipes) {
    const building = index.building(r.building)
    const c: Record<string, number> = { cost: weight(building, options.objective) }

    for (const [item, rate] of netRatesPerBuilding(r, building)) {
      c[row(item)] = rate
      items.add(item)

      if (rate > 0) producible.add(item)
    }

    variables.set(`r|${r.id}`, c)
  }

  // Miners for every minable item that is used or demanded.
  const minerOf = new Map<string, NonNullable<ReturnType<typeof minerFor>>>()

  for (const item of new Set([...items, ...wanted.map((d) => d.item)])) {
    const m = minerFor(index, item)

    if (!m) continue

    minerOf.set(item, m)
    variables.set(`m|${item}`, {
      cost: weight(m.building, options.objective),
      [row(item)]: m.perBuilding,
    })
    items.add(item)
  }

  // Existing sources: nearly free, up to their free capacity.
  const sources = (options.sources ?? []).filter((s) => s.rate > EPSILON)

  sources.forEach((s, i) => {
    const c: Record<string, number> = { cost: 1e-6, [row(s.item)]: 1 }

    if (Number.isFinite(s.rate)) {
      c[`cap|e${i}`] = 1
      constraints.set(`cap|e${i}`, { max: s.rate })
    }

    variables.set(`e|${i}`, c)
    items.add(s.item)
  })

  const demandRate = new Map<string, number>()

  for (const d of wanted) {
    demandRate.set(d.item, (demandRate.get(d.item) ?? 0) + d.rate)
    items.add(d.item)
  }

  for (const item of items) {
    // A producible / minable item is a thousand times more expensive to import: the
    // shortage surfaces at the raw material.
    const cost = producible.has(item) || minerOf.has(item) ? IMPORT_PENALTY * 1000 : IMPORT_PENALTY

    variables.set(`i|${item}`, { cost, [row(item)]: 1 })
    constraints.set(row(item), { min: demandRate.get(item) ?? 0 })
  }

  const solution = solve({ direction: 'minimize', objective: 'cost', constraints, variables })

  if (solution.status !== 'optimal') {
    return {
      ...empty,
      status: 'error',
      message: `The chain cannot be calculated (${solution.status}).`,
    }
  }

  // --- Result: nodes to place ---
  const plan: ChainPlan = { ...empty, depth: new Map() }
  const values = new Map(solution.variables)

  type End = { nodeId: string; portId: string; amount: number }

  const producers = new Map<string, End[]>()
  const consumers = new Map<string, End[]>()

  const push = (map: Map<string, End[]>, item: string, nodeId: string, amount: number) => {
    if (amount <= EPSILON) return

    map.set(item, [...(map.get(item) ?? []), { nodeId, portId: item, amount }])
  }

  for (const r of recipes) {
    const count = values.get(`r|${r.id}`) ?? 0

    if (count <= EPSILON) continue

    const key = factoryKey(r.id)

    plan.factories.push({ key, recipe: r, count: Math.round(count * 1e6) / 1e6 })

    for (const [item, rate] of netRatesPerBuilding(r, index.building(r.building))) {
      if (rate > 0) push(producers, item, key, rate * count)
      else push(consumers, item, key, -rate * count)
    }
  }

  for (const [item, m] of minerOf) {
    const count = values.get(`m|${item}`) ?? 0

    if (count <= EPSILON) continue

    const key = mineKey(item)

    plan.mines.push({
      key,
      building: m.building,
      item,
      purity: m.purity,
      count: Math.round(count * 1e6) / 1e6,
    })
    push(producers, item, key, m.perBuilding * count)
  }

  sources.forEach((s, i) => push(producers, s.item, s.nodeId, values.get(`e|${i}`) ?? 0))

  for (const d of wanted) if (d.consumer) push(consumers, d.item, d.consumer, d.rate)

  for (const item of items) {
    const missing = values.get(`i|${item}`) ?? 0

    if (missing > EPSILON) {
      const d = wanted.find((x) => x.item === item)

      plan.missing.push({ item, rate: missing, consumer: d?.consumer ?? null })
    }
  }

  // --- Links per item: producers allocated greedily to consumers ---
  const seen = new Set<string>()

  for (const [item, cons] of consumers) {
    for (const f of allocateFlows(producers.get(item) ?? [], cons)) {
      const key = `${f.from.nodeId}>${f.to.nodeId}>${item}`

      if (seen.has(key) || f.from.nodeId === f.to.nodeId) continue

      seen.add(key)
      plan.links.push({ from: f.from.nodeId, to: f.to.nodeId, item })
    }
  }

  // --- Depth: backwards from the consumer (longest path, bounded against cycles) ---
  const isNew = (id: string) => id.startsWith('new:')

  for (const f of plan.factories) plan.depth.set(f.key, 0)
  for (const m of plan.mines) plan.depth.set(m.key, 0)

  const newCount = plan.depth.size

  for (let round = 0; round < newCount + 1; round++) {
    let changed = false

    for (const l of plan.links) {
      if (!isNew(l.from)) continue

      const below = isNew(l.to) ? (plan.depth.get(l.to) ?? 0) + 1 : 1

      if (below > (plan.depth.get(l.from) ?? 0) && below <= newCount + 1) {
        plan.depth.set(l.from, below)
        changed = true
      }
    }

    if (!changed) break
  }

  return plan
}
