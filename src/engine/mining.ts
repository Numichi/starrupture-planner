/**
 * @module engine/mining
 *
 * Mines – raw material sources.
 *
 * A miner (`buildings/*.yml`, `type: miner`) runs no recipe: it has no inputs, and its
 * `mines:` table says what it mines and how much per minute:
 *
 * ```yaml
 * mines:
 *   titanium_ore: { impure: 60, normal: 120, pure: 240 }   # per purity
 *   helium_3: 240                                          # one purity
 * ```
 *
 * A mine placed in a base (`project/types.ts › Mine`) chooses the item, the deposit purity
 * and the building count, or a custom total output (one node may stand for all such
 * mines). In the calculation the output is a nominal supply (`projectModel.ts › mineOutput`).
 *
 * Why not one building per purity? Purity belongs to the deposit, not to the machine: the
 * same drill produces more on a pure deposit. With separate buildings every upgrade (v.2)
 * would have to be added three times, and the chain builder would always pick the "pure"
 * building as if pure deposits were unlimited.
 */
import type { Building, GameData, Purity } from '../data/types'
import type { Mine } from '../project/types'
import { formatRate } from './format'
import { rateFor, variantsOf } from './rateTable'

/** Miners that mine this item (in data file order). */
export function minersFor(data: GameData, item: string): Building[] {
  return data.buildings.filter((b) => b.type === 'miner' && b.mines && item in b.mines)
}

/** The items some miner provides. */
export function minableItems(data: GameData): Set<string> {
  const set = new Set<string>()

  for (const b of data.buildings) for (const item of Object.keys(b.mines ?? {})) set.add(item)

  return set
}

/**
 * The purities of an item in this building, in game.yml order.
 * Empty when the building gives one number for it (no purity → no selector).
 */
export function puritiesFor(data: GameData, building: Building, item: string | null): Purity[] {
  if (!item) return []

  const keys = variantsOf(building.mines?.[item])

  return data.purities.filter((p) => keys.includes(p.id))
}

/** Purity of a new mine: the game.yml default when the item has it, otherwise the first one. */
export function defaultPurityFor(
  data: GameData,
  building: Building,
  item: string | null,
): string | null {
  const list = puritiesFor(data, building, item)

  if (list.length === 0) return null

  return list.find((p) => p.id === data.defaultPurity)?.id ?? list[0].id
}

/** The rate of a placed mine. */
export interface MineRate {
  /** Items/min per building. */
  perBuilding: number

  /** The purity actually used (null: the item has no purities). */
  purity: string | null

  /** Set when something does not fit (e.g. the building does not mine the item). */
  problem: string | null
}

/** The per-building rate of a placed mine. */
export function mineRate(data: GameData, building: Building, mine: Mine): MineRate {
  if (!mine.item) return { perBuilding: 0, purity: null, problem: 'Choose what it mines' }

  const table = building.mines?.[mine.item]

  if (table === undefined) {
    return { perBuilding: 0, purity: null, problem: `${building.name} does not mine this` }
  }

  const fallback = defaultPurityFor(data, building, mine.item)
  const { rate, variant } = rateFor(table, mine.purity, fallback)
  const problem =
    mine.purity && variant && variant !== mine.purity
      ? 'This purity does not exist here; the default is used'
      : null

  return { perBuilding: rate, purity: variant, problem }
}

/** A short summary for selectors: "Impure 60 · Normal 120 · Pure 240" or "240". */
export function mineRateSummary(data: GameData, building: Building, item: string): string {
  const table = building.mines?.[item]

  if (table === undefined) return '–'

  if (typeof table === 'number') return formatRate(table)

  return puritiesFor(data, building, item)
    .map((p) => `${p.name} ${formatRate(table[p.id])}`)
    .join(' · ')
}
