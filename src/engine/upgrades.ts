/**
 * @module engine/upgrades
 *
 * Upgrades: switching a placed factory or mine to its upgraded (v.2) or base variant.
 *
 * The building chain comes from the `upgradeOf` field of the data (e.g. Furnace v.2 →
 * Furnace). StarRupture v.2 buildings have their own recipe lists, so for a factory the
 * candidates are the recipes of the upgraded building that make the SAME product (e.g.
 * Glass: glass_furnace → glass_furnace_v2, or the Goethite variant). For a mine it is the
 * upgraded miner, if it mines the same item. The node keeps its machine count and links
 * (links of items that no longer fit are removed); its rates become the new building's.
 */
import type { Building, Recipe } from '../data/types'
import type { GameIndex } from './gameIndex'

/** One possible switch of a node to another building. */
export interface UpgradeOption {
  building: Building

  /** `up`: upgrade; `down`: back to the base variant. */
  direction: 'up' | 'down'

  /** Factory: the recipe to use on the new building. */
  recipe?: Recipe
}

/** The upgrades of a building (direct and further levels) and its ancestors. */
function relatives(index: GameIndex, buildingId: string): { up: Building[]; down: Building[] } {
  const all = index.data.buildings
  const up: Building[] = []
  const queue = [buildingId]
  const seen = new Set(queue)

  while (queue.length) {
    const id = queue.shift()!

    for (const b of all) {
      if (b.upgradeOf === id && !seen.has(b.id)) {
        seen.add(b.id)
        up.push(b)
        queue.push(b.id)
      }
    }
  }

  const down: Building[] = []
  let cur = index.building(buildingId).upgradeOf

  while (cur && !seen.has(cur) && index.hasBuilding(cur)) {
    seen.add(cur)
    down.push(index.building(cur))
    cur = index.building(cur).upgradeOf
  }

  return { up, down }
}

/**
 * The upgrade (and downgrade) options of a node.
 *
 * @param item factory: the recipe's product; mine: the mined item
 * @param mode `recipe` for a factory, `mine` for a mine
 */
export function upgradeOptions(
  index: GameIndex,
  buildingId: string,
  item: string,
  mode: 'recipe' | 'mine',
): UpgradeOption[] {
  const { up, down } = relatives(index, buildingId)
  const list: UpgradeOption[] = []

  const add = (b: Building, direction: 'up' | 'down') => {
    if (mode === 'mine') {
      if (b.type === 'miner' && b.mines && item in b.mines) list.push({ building: b, direction })

      return
    }

    for (const r of index.data.recipes) {
      if (r.building === b.id && r.product === item)
        list.push({ building: b, direction, recipe: r })
    }
  }

  up.forEach((b) => add(b, 'up'))
  down.forEach((b) => add(b, 'down'))

  return list
}
