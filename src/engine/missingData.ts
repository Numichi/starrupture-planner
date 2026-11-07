/**
 * @module engine/missingData
 *
 * Missing data: recipes without a cycle time.
 *
 * When only the per-cycle quantities of a recipe are known and its cycle time is not (YAML
 * `perCycle`), the data does NOT invent a value: the recipe has `rateFrom: 'missing'`, its
 * amounts are 0, and its factory computes with 0 (⚠ on the graph).
 *
 * Until the data is updated, the user may enter the cycle time by hand. It is stored in the
 * project (`settings.cycleTimes`: recipe id → seconds) and travels with export and import.
 * This module applies the manual values to the recipes:
 * per minute = per cycle × 60 / cycle time, with `rateFrom: 'user'`. Once the data gets a
 * reliable rate (the recipe is no longer `perCycle`), the manual value no longer applies
 * (the settings show it as "data available").
 */
import type { GameData, ItemAmount, Recipe } from '../data/types'

/**
 * Applies the manual cycle times to the recipes without a rate.
 *
 * @returns the same object when nothing changes (keeps reactivity cheap)
 */
export function applyCycleTimes(
  data: GameData,
  cycleTimes: Readonly<Record<string, number>>,
): GameData {
  let changed = false

  const recipes = data.recipes.map((r) => {
    const t = r.perCycle ? cycleTimes[r.id] : undefined

    if (!r.perCycle || !(t !== undefined && t > 0)) return r

    changed = true

    const perMin = (list: ItemAmount[]) =>
      list.map((x) => ({ item: x.item, amount: (x.amount * 60) / t }))

    return {
      ...r,
      inputs: perMin(r.perCycle.inputs),
      outputs: perMin(r.perCycle.outputs),
      rateFrom: 'user' as const,
      cycleTime: t,
    }
  })

  return changed ? { ...data, recipes } : data
}

/** The recipes without a rate in the data (no cycle time). */
export function recipesWithoutRate(data: GameData): Recipe[] {
  return data.recipes.filter((r) => r.perCycle)
}
