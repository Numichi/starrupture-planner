/**
 * @module engine/cargo
 *
 * Cargo throughput – how much a Dispatcher moves per minute.
 *
 * The value lives in `buildings/*.yml`, in items/min (`throughput:`):
 *
 * ```yaml
 * throughput: 150                                  # always 150
 * throughput: { v.1: 100, v.2: 171.4, v.3: 266.7 } # by feed rail tier
 * ```
 *
 * In the game a Dispatcher first fills a stack from its feed rail and then sends it
 * (~10 s), so a faster rail moves more. The table holds the measured values; the planner
 * does not derive them. If a patch makes it independent of the rail, one number is enough
 * and the feed rail selector disappears from the editor.
 */
import type { Building, RailTier } from '../data/types'
import { rateFor, variantsOf } from './rateTable'

/** Throughput of a Dispatcher with the feed rail used for it. */
export interface DispatcherRate {
  /** Throughput in items/min. */
  rate: number

  /** Name of the feed rail used (null: the throughput does not depend on the rail). */
  feedRail: string | null

  /** The selectable feed rails (empty: no selector). */
  feedOptions: string[]
}

/**
 * Throughput of a Dispatcher.
 *
 * @param feedRail  name of the chosen feed rail; null = the best available
 * @param available the available rail tiers in ascending order (the best up to the "Best available rail" setting)
 */
export function dispatcherThroughput(
  building: Building,
  feedRail: string | null,
  available: readonly RailTier[],
): DispatcherRate {
  const table = building.throughput
  const inTable = variantsOf(table)

  if (inTable.length === 0)
    return { rate: rateFor(table, null).rate, feedRail: null, feedOptions: [] }

  // Selectable: the available rails that have a value (all table entries without rail data).
  const options = available.length
    ? available.map((t) => t.name).filter((n) => inTable.includes(n))
    : inTable
  const best = options.at(-1) ?? inTable.at(-1)!
  const chosen = feedRail && options.includes(feedRail) ? feedRail : best

  return { rate: rateFor(table, chosen).rate, feedRail: chosen, feedOptions: options }
}

/**
 * The largest output of a Receiver: rail outputs × best available rail.
 *
 * @returns null when unknown (no rail data or no `railOutputs`)
 */
export function receiverOutputLimit(
  building: Building,
  available: readonly RailTier[],
): number | null {
  const best = available[available.length - 1]

  if (!best || !building.railOutputs) return null

  return building.railOutputs * best.capacity
}
