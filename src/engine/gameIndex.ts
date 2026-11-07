/**
 * @module engine/gameIndex
 *
 * Fast lookup over the game data.
 *
 * Builds id → object maps from the loaded arrays, so the code does not have to `.find()`
 * everywhere. An unknown id does not throw: a grey "?" placeholder is returned (the loader
 * reports the actual error).
 */
import type { Building, GameData, Item, Recipe } from '../data/types'

/** Id-based access to the loaded game data. */
export interface GameIndex {
  data: GameData
  item(id: string): Item
  building(id: string): Building
  recipe(id: string): Recipe | undefined
  hasItem(id: string): boolean
  hasBuilding(id: string): boolean

  /** Name of a deposit purity (the id itself when unknown). */
  purityName(id: string): string
}

/** Creates the lookup for a data set. */
export function createGameIndex(data: GameData): GameIndex {
  const items = new Map(data.items.map((i) => [i.id, i]))
  const buildings = new Map(data.buildings.map((b) => [b.id, b]))
  const recipes = new Map(data.recipes.map((r) => [r.id, r]))
  const purities = new Map(data.purities.map((p) => [p.id, p.name]))

  return {
    data,
    item: (id) => items.get(id) ?? { id, name: `? ${id}`, color: '#888888', short: '?' },
    building: (id) =>
      buildings.get(id) ?? { id, name: `? ${id}`, type: 'production', power: 0, speed: 1 },
    recipe: (id) => recipes.get(id),
    hasItem: (id) => items.has(id),
    hasBuilding: (id) => buildings.has(id),
    purityName: (id) => purities.get(id) ?? id,
  }
}

/**
 * NET rates of a recipe for one building, in items/min. Positive = produced, negative =
 * consumed.
 *
 * The data already holds per-minute values; only the building's speed multiplier is
 * applied. Example: Smelter, input { titanium_ore: 60 }, output 60 →
 * { titanium_ore: -60, titanium_bar: +60 }; in a speed-1.5 building ±90.
 *
 * An item that is both an input and an output (e.g. a catalyst that comes back) is merged
 * into one net value, which is simpler for the calculation and the graph.
 */
export function netRatesPerBuilding(recipe: Recipe, building: Building): Map<string, number> {
  const net = new Map<string, number>()

  for (const { item, amount } of recipe.outputs)
    net.set(item, (net.get(item) ?? 0) + amount * building.speed)

  for (const { item, amount } of recipe.inputs)
    net.set(item, (net.get(item) ?? 0) - amount * building.speed)

  return net
}

/**
 * Safety net: the chain builder only uses valid recipes. The loader already filters out
 * broken recipes; this covers data from other sources. A recipe without a rate (no data
 * and no manual cycle time) is not usable.
 */
export function isRecipeUsable(r: Recipe, hasBuilding: (id: string) => boolean): boolean {
  return hasBuilding(r.building) && r.outputs.length > 0 && r.rateFrom !== 'missing'
}
