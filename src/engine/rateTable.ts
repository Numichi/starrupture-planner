/**
 * @module engine/rateTable
 *
 * Rate tables: "one number, or one number per variant".
 *
 * The YAML uses the same shape in two places (`data/types.ts › RateTable`):
 *   - miners (`mines:`): per item, by deposit purity
 *       titanium_ore: { impure: 60, normal: 120, pure: 240 }
 *       helium_3: 240                      ← no purity, no selector
 *   - Dispatchers (`throughput:`): by feed rail tier
 *       throughput: { v.1: 100, v.2: 171.4, v.3: 266.7 }
 *       throughput: 150                    ← independent of the rail
 *
 * UI rule: a selector is only needed when there is more than one variant.
 */
import type { RateTable } from '../data/types'

/** The variants of a table (empty for a single number). */
export function variantsOf(table: RateTable | undefined): string[] {
  return table === undefined || typeof table === 'number' ? [] : Object.keys(table)
}

/** Whether there is something to choose (several variants). */
export function hasChoice(table: RateTable | undefined): boolean {
  return variantsOf(table).length > 1
}

/**
 * The value of one variant. For a single number the variant does not matter; for an
 * unknown variant `fallback` is used, and if that is missing too, the first value.
 *
 * @returns the rate and the variant actually used (null for a single number)
 */
export function rateFor(
  table: RateTable | undefined,
  variant: string | null,
  fallback: string | null = null,
): { rate: number; variant: string | null } {
  if (table === undefined) return { rate: 0, variant: null }

  if (typeof table === 'number') return { rate: table, variant: null }

  for (const v of [variant, fallback, Object.keys(table)[0]]) {
    if (v !== null && v !== undefined && v in table) return { rate: table[v], variant: v }
  }

  return { rate: 0, variant: null }
}

/** The largest value of the table (e.g. for a short summary in a list). */
export function maxRate(table: RateTable | undefined): number {
  if (table === undefined) return 0

  return typeof table === 'number' ? table : Math.max(0, ...Object.values(table))
}
