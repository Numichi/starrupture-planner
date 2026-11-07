/**
 * @module engine/rails
 *
 * Drone rail capacity.
 *
 * Every link (one rail between two nodes, possibly with several items) and every rail line
 * is a drone rail. This module decides which rails a flow needs and whether a manually
 * configured rail set is enough.
 *
 * Pull system: a consumer requests what it needs. When the request exceeds what the rail
 * lets through, the rail congests. Therefore:
 *   - automatic rail: when one rail is enough, the smallest tier that carries it; when even
 *     the best AVAILABLE tier is not enough, as many of it as run full, and the smallest
 *     sufficient tier for the rest (e.g. 600 /min: v.3 + v.1). Not an error, only a hint:
 *     more rails must be built,
 *   - manual rail (link: `Link.rail`, rail line: mode `manual`): the total capacity of the
 *     configured set – count per tier, mixed allowed (e.g. 2× v.1 + v.2 + 4× v.3). A higher
 *     demand means congestion: that is the error (red).
 *
 * Distribution (`railDistribution`): how the flow is shared between parallel rails (evenly
 * loaded, or rails full + the rest on one rail), and how many source and target machines
 * belong to each rail.
 *
 * The tiers come from the `rails:` section of game.yml; the UI selects the best tier that is
 * already available.
 */
import { EPSILON } from '../config'
import type { RailTier } from '../data/types'

/** An entry of a manual rail set (`project/types.ts › RailCount`); tier null = the best available. */
export interface RailCountSetting {
  tier: string | null
  count: number
}

/** A rail tier and its count in a rail set. */
export interface RailPart {
  tier: RailTier
  count: number
}

/** The rail of a link or a rail line. */
export interface RailChoice {
  /** `auto`: chosen by the planner; `manual`: configured by hand. */
  mode: 'auto' | 'manual'

  /** The rails per tier, in ascending capacity order (e.g. 2× v.1 + 4× v.3). */
  parts: RailPart[]

  /** The best tier in the set. */
  tier: RailTier

  /** Total number of rails. */
  count: number

  /** Total capacity: the sum of the rails' capacities. */
  capacity: number

  /** Load: flow / capacity (0–1). */
  load: number

  /** Manual rail: the demand exceeds what it lets through → congestion (red). Always false for auto. */
  congested: boolean

  /** The rail set enough for the demand (the automatic choice); for a congested manual rail, the suggestion. */
  needed: RailPart[]

  /** Manual rail: a chosen tier is not available (the best available is used instead). */
  tierUnavailable: boolean
}

/** Anything above capacity + this is congestion (floating-point noise is not). */
export const railTolerance = (capacity: number) => Math.max(1e-3, capacity * 1e-6)

const sortParts = (parts: RailPart[]) => parts.sort((a, b) => a.tier.capacity - b.tier.capacity)

/** The capacity of a rail set. */
export function partsCapacity(parts: readonly RailPart[]): number {
  return parts.reduce((a, p) => a + p.tier.capacity * p.count, 0)
}

/**
 * The automatic rail set for a flow: one rail of the smallest sufficient tier when one is
 * enough; otherwise as many of the best available tier as run full, and the smallest
 * sufficient tier for the rest. Empty when there is no flow.
 */
export function autoParts(rate: number, available: readonly RailTier[]): RailPart[] {
  if (available.length === 0 || rate <= EPSILON) return []

  const fitting = (r: number) => available.find((t) => t.capacity + EPSILON >= r)
  const one = fitting(rate)

  if (one) return [{ tier: one, count: 1 }]

  const best = available[available.length - 1]
  const full = Math.floor((rate + EPSILON) / best.capacity)
  const rest = rate - full * best.capacity

  if (rest <= EPSILON) return [{ tier: best, count: full }]

  const small = fitting(rest) ?? best

  if (small === best) return [{ tier: best, count: full + 1 }]

  return sortParts([
    { tier: small, count: 1 },
    { tier: best, count: full },
  ])
}

/**
 * Resolves a manual rail set: tier names → tiers (an unavailable or unset tier becomes the
 * best available one), equal tiers merged.
 */
export function resolveParts(
  setting: readonly RailCountSetting[],
  available: readonly RailTier[],
): { parts: RailPart[]; unavailable: boolean } {
  const parts: RailPart[] = []
  let unavailable = false

  if (available.length === 0) return { parts, unavailable }

  const best = available[available.length - 1]

  for (const s of setting) {
    const count = Math.max(0, Math.round(s.count))

    if (!count) continue

    const chosen = s.tier ? available.find((t) => t.name === s.tier) : undefined

    if (s.tier && !chosen) unavailable = true

    const tier = chosen ?? best
    const same = parts.find((p) => p.tier === tier)

    if (same) same.count += count
    else parts.push({ tier, count })
  }

  return { parts: sortParts(parts), unavailable }
}

/** The capacity of a manual rail set, or null without rail data / for an empty set. */
export function manualRailCapacity(
  setting: readonly RailCountSetting[],
  available: readonly RailTier[],
): number | null {
  const { parts } = resolveParts(setting, available)

  return parts.length ? partsCapacity(parts) : null
}

/** Builds a {@link RailChoice} from a rail set. */
function choice(
  mode: 'auto' | 'manual',
  parts: RailPart[],
  rate: number,
  want: number,
  available: readonly RailTier[],
  unavailable = false,
): RailChoice {
  const capacity = partsCapacity(parts)

  return {
    mode,
    parts,
    tier: parts[parts.length - 1].tier,
    count: parts.reduce((a, p) => a + p.count, 0),
    capacity,
    load: capacity > 0 ? rate / capacity : 0,
    congested: mode === 'manual' && want > capacity + railTolerance(capacity),
    needed: autoParts(want, available),
    tierUnavailable: unavailable,
  }
}

/**
 * The automatic rail for a flow (null without flow or rail data).
 *
 * @param available the available tiers in ascending capacity order
 */
export function chooseRail(rate: number, available: readonly RailTier[]): RailChoice | null {
  const parts = autoParts(rate, available)

  return parts.length ? choice('auto', parts, rate, rate, available) : null
}

/**
 * The rail of a link (the rail between two nodes).
 *
 * @param setting manual rail set, or null / empty = automatic
 * @param rate    the actual flow (all items together)
 * @param demand  what would pass without a limit (manual: for congestion; ≥ rate)
 */
export function linkRail(
  setting: readonly RailCountSetting[] | null | undefined,
  rate: number,
  demand: number,
  available: readonly RailTier[],
): RailChoice | null {
  if (!setting?.length) return chooseRail(rate, available)

  const { parts, unavailable } = resolveParts(setting, available)

  if (!parts.length) return chooseRail(rate, available)

  return choice('manual', parts, rate, Math.max(rate, demand), available, unavailable)
}

/** Label of a rail set in ascending capacity order: "v.2", "2× v.1 + v.2 + 4× v.3". */
export function partsLabel(parts: readonly RailPart[]): string {
  return parts.map((p) => (p.count > 1 ? `${p.count}× ${p.tier.name}` : p.tier.name)).join(' + ')
}

/** Short label of a rail: "v.2", "3× v.3", "v.1 + v.3". */
export function railLabel(c: Pick<RailChoice, 'parts'>): string {
  return partsLabel(c.parts)
}

// ============================================================================
// Distribution between parallel rails
// ============================================================================

/** One rail in a distribution. */
export interface RailShare {
  /** Flow on this rail (items/min, all its items together). */
  rate: number

  /** Load: rate / the rail's capacity. */
  load: number

  /** Source machines belonging to this rail (exact, fractional; null: the source is not a machine). */
  sources: number | null

  /** Target machines served by this rail (exact, fractional; null: the target is not a machine). */
  targets: number | null
}

/** One variant of a distribution: equal rails merged (`rails` rails of this tier). */
export interface RailSplit {
  groups: { rails: number; tier: RailTier; share: RailShare }[]
}

/** How a flow is spread over the rails of a set. */
export interface RailDistribution {
  /** The distributed flow (manual congestion: the demand on the suggested rails). */
  rate: number

  /** Number of rails. */
  rails: number

  /** Total capacity of the rails. */
  capacity: number

  /** Load balanced: every rail equally loaded (proportional to capacity for mixed tiers). */
  even: RailSplit

  /** Full + rest: rails (largest first) run full, the rest on one rail (the smallest that carries it). */
  fill: RailSplit
}

/**
 * Distributes the flow between the rails, and tells how many source and target machines
 * belong to each rail. The machine count is proportional to the rail's flow: a rail carrying
 * x of the flow serves x of the machines (the item ratio is the same on every rail). See
 * {@link machinesPerRate}.
 *
 * @param rate           the flow to distribute (all items of the rail)
 * @param parts          the rails per tier
 * @param sourcesPerRate source machines per unit (1 /min) of rail flow (null: not a machine)
 * @param targetsPerRate target machines per unit of rail flow (null: not a machine)
 */
export function railDistribution(
  rate: number,
  parts: readonly RailPart[],
  sourcesPerRate: number | null,
  targetsPerRate: number | null,
): RailDistribution {
  const capacity = partsCapacity(parts)

  const share = (r: number, tier: RailTier): RailShare => ({
    rate: r,
    load: tier.capacity > 0 ? r / tier.capacity : 0,
    sources: sourcesPerRate !== null ? r * sourcesPerRate : null,
    targets: targetsPerRate !== null ? r * targetsPerRate : null,
  })

  const ordered = [...parts].sort((a, b) => b.tier.capacity - a.tier.capacity)

  // Even: every rail equally loaded (it gets a share proportional to its capacity).
  const even: RailSplit = {
    groups: ordered.map((p) => ({
      rails: p.count,
      tier: p.tier,
      share: share(capacity > 0 ? (rate * p.tier.capacity) / capacity : 0, p.tier),
    })),
  }

  // Full + rest: the largest rails run full; the rest goes to the smallest free rail that carries it.
  const single = ordered.flatMap((p) =>
    Array.from({ length: p.count }, () => ({ tier: p.tier, rate: 0 })),
  )
  let rest = rate

  for (const r of single) {
    if (rest + EPSILON < r.tier.capacity) continue

    r.rate = r.tier.capacity
    rest -= r.tier.capacity
  }

  if (rest > EPSILON) {
    const free = single.filter((r) => r.rate === 0)
    const target = [...free].reverse().find((r) => r.tier.capacity + EPSILON >= rest) ?? free[0]

    if (target) target.rate = rest
  }

  const fill: RailSplit = { groups: [] }

  for (const r of single) {
    const last = fill.groups[fill.groups.length - 1]

    if (last && last.tier === r.tier && Math.abs(last.share.rate - r.rate) < 1e-9) last.rails++
    else fill.groups.push({ rails: 1, tier: r.tier, share: share(r.rate, r.tier) })
  }

  // Empty rails last.
  fill.groups.sort((a, b) => (a.share.rate > 0 ? 0 : 1) - (b.share.rate > 0 ? 0 : 1))

  return { rate, rails: single.length, capacity, even, fill }
}

// ============================================================================
// Rail lines
// ============================================================================

/** Rail setting of a rail line (part of `project/types.ts › RailLine`). */
export interface LineRailSetting {
  mode: 'auto' | 'manual'
  rails: readonly RailCountSetting[]
}

/** Capacity of a manual rail line: the sum of the rail set (null for auto: no limit). */
export function manualLineCapacity(
  setting: LineRailSetting,
  available: readonly RailTier[],
): number | null {
  return setting.mode === 'manual' ? manualRailCapacity(setting.rails, available) : null
}

/**
 * The rail of a rail line: automatically the rail set chosen for the total flow (the
 * smallest tier without flow), manually the configured rail set.
 *
 * @param total  the line's total flow (all items together)
 * @param demand what would pass without a limit (manual: for congestion; ≥ total)
 */
export function lineRail(
  setting: LineRailSetting,
  total: number,
  demand: number,
  available: readonly RailTier[],
): RailChoice | null {
  if (available.length === 0) return null

  if (setting.mode === 'manual') {
    const { parts, unavailable } = resolveParts(setting.rails, available)

    if (parts.length)
      return choice('manual', parts, total, Math.max(total, demand), available, unavailable)
  }

  const parts = autoParts(total, available)

  return choice(
    'auto',
    parts.length ? parts : [{ tier: available[0], count: 1 }],
    total,
    total,
    available,
  )
}

/** One item on a rail: how much runs, and what one machine gives / requests of it. */
export interface RailItemFlow {
  item: string

  /** The flow of this item on the rail. */
  rate: number

  /** One machine's rate of this item (source: output, target: input); 0 / null: not a machine. */
  perMachine: number | null
}

/**
 * How many machines belong to one unit (1 /min) of a multi-item rail's flow, and which
 * item is the bottleneck:
 *   - target: the machines the rail actually serves = the tightest of the machine's
 *     requested items (minimum of flow / per-machine demand),
 *   - source: the machines needed to produce every item (the maximum).
 * With one item: flow / per-machine rate.
 *
 * @returns null when the end is not a machine or there is no flow
 */
export function machinesPerRate(
  items: readonly RailItemFlow[],
  side: 'source' | 'target',
): { perRate: number; machines: number; bottleneck: string | null; even: boolean } | null {
  const total = items.reduce((a, x) => a + x.rate, 0)
  const counted = items.filter((x) => x.perMachine && x.perMachine > EPSILON)

  if (total <= EPSILON || !counted.length) return null

  const ratios = counted.map((x) => ({ item: x.item, machines: x.rate / x.perMachine! }))
  const pick = ratios.reduce((a, b) =>
    side === 'target' ? (b.machines < a.machines ? b : a) : b.machines > a.machines ? b : a,
  )
  const even = ratios.every(
    (r) => Math.abs(r.machines - pick.machines) <= Math.max(1e-6, pick.machines * 1e-6),
  )

  return {
    perRate: pick.machines / total,
    machines: pick.machines,
    bottleneck: ratios.length > 1 ? pick.item : null,
    even,
  }
}
