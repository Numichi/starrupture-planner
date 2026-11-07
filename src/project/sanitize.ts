/**
 * @module project/sanitize
 *
 * Project reading: unknown JSON → valid {@link Project}.
 *
 * Runs whenever a project is loaded: from the browser's storage, from an imported file, or
 * from the `startProject:` file of `game.yml`. It is lenient: missing fields get defaults,
 * invalid elements are skipped, and every skip is returned as a warning.
 *
 * Migrations:
 *   - OLD (v1) PROJECT (target-driven: targets, automatic counts, shared-rail routes):
 *     mines, Receivers, Dispatchers, storages, rail lines and inter-base rails are kept;
 *     the count of an automatic-count mine later comes from balancing (`legacy.autoMines`);
 *     factories are rebuilt from the targets (`legacy.targets`) with the "Build chain" logic
 *     in `useEditorActions › migrateLegacy` (that needs the game data, so not here); the
 *     shared-rail routes (routing, railGroups) and manual recipe choice are dropped.
 *   - OLD (stop-based) RAIL LINE: a rail line used to be a one-way sequence of stops, and a
 *     link ran on it when both ends were attached to stops (producer before consumer). Now
 *     the rail line is a node: such a link becomes producer → rail line → consumer
 *     (`convertStops`). Joins between lines are dropped; links that only ran through them
 *     stay direct. A configured rail tier becomes manual mode.
 *   - SHARED RAIL (`buses`, removed): becomes an automatic rail line (same behaviour: per
 *     item in = out, no limit); `bus:<id>` references (links, positions) become `line:<id>`.
 *   - OLD RAIL SETTING: a link's `rail: { tier, count }` and a rail line's `tier` + `parallel`
 *     become a rail set (`[{ tier, count }]`).
 *   - Missing newer fields get their defaults: `Factory.auto` → `true`, cargo `virtual` → off.
 */
import type { TargetSpec } from '../data/types'
import {
  PROJECT_VERSION,
  defaultSettings,
  emptyBase,
  newId,
  nodeIds,
  type Base,
  type Dispatcher,
  type Factory,
  type Link,
  type Mine,
  type Point,
  type Project,
  type RailCount,
  type RailLine,
  type RailLink,
  type Receiver,
  type Storage,
  type VirtualCargo,
} from './types'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() ? v : fallback

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * Reads a cargo node's virtual counterpart leniently.
 * Anything that is not an object means "off"; an unknown mode falls back to `rail`, and an
 * invalid custom rate to 0.
 */
function virtualCargo(v: unknown): VirtualCargo | null {
  if (!isObj(v)) return null

  const rate = Number(v.rate)

  return {
    mode: v.mode === 'custom' ? 'custom' : 'rail',
    rate: Number.isFinite(rate) && rate > 0 ? rate : 0,
  }
}

/**
 * Reads a manual rail set: `[{ tier, count }, …]` (count per tier, mixed allowed).
 *
 * The old form, a single `{ tier, count }` object, is accepted too. Equal tiers are merged;
 * an empty or invalid set means automatic (`null`).
 */
export function railCounts(v: unknown): RailCount[] | null {
  const entries = Array.isArray(v) ? v.filter(isObj) : isObj(v) ? [v] : []
  const out: RailCount[] = []

  for (const e of entries) {
    const count = Math.round(num(e.count, 1))

    if (count < 1) continue

    const tier = strOrNull(e.tier)
    const same = out.find((x) => x.tier === tier)

    if (same) same.count += count
    else out.push({ tier, count })
  }

  return out.length ? out : null
}

/** Data carried over from an old (v1) project that still needs processing. */
export interface LegacyData {
  /** Base id → the old targets. Factories are rebuilt from them. */
  targets: Map<string, TargetSpec[]>

  /** Old automatic-count mines (their count comes from balancing). */
  autoMines: Set<string>
}

/** Result of {@link sanitizeProject}. */
export interface SanitizeResult {
  project: Project
  warnings: string[]

  /** Only for an old (v1) project. */
  legacy: LegacyData | null
}

/**
 * Turns unknown JSON into a valid project.
 *
 * @param raw parsed JSON (browser storage, imported file or start project)
 * @returns the project, the warnings about skipped / converted data and the legacy data
 */
export function sanitizeProject(raw: unknown): SanitizeResult {
  const warnings: string[] = []

  if (!isObj(raw)) {
    return {
      project: {
        version: PROJECT_VERSION,
        name: 'Project',
        bases: [],
        railLinks: [],
        settings: defaultSettings(),
      },
      warnings: ['The project file is empty or not an object.'],
      legacy: null,
    }
  }

  const isLegacy = num(raw.version, 1) < 2
  const legacy: LegacyData | null = isLegacy ? { targets: new Map(), autoMines: new Set() } : null

  const bases: Base[] = []

  for (const b of list(raw.bases)) {
    if (!isObj(b)) continue

    bases.push(readBase(b, bases.length, isLegacy, legacy, warnings))
  }

  const railLinks = readRailLinks(raw, bases, warnings)

  // Pairing check: the target Receiver must exist.
  const receiverIds = new Set(bases.flatMap((b) => b.receivers.map((r) => r.id)))

  for (const d of bases.flatMap((b) => b.dispatchers)) {
    if (d.receiverId && !receiverIds.has(d.receiverId)) {
      warnings.push(`The target Receiver of "${d.name}" does not exist; the pairing was removed.`)
      d.receiverId = null
    }
  }

  // Node references: links and positions only to existing nodes.
  for (const base of bases) {
    const valid = baseNodeIds(base, railLinks)
    const before = base.links.length

    base.links = base.links.filter((l) => valid.has(l.from) && valid.has(l.to) && l.from !== l.to)

    if (base.links.length < before) {
      warnings.push(
        `"${base.name}": ${before - base.links.length} link(s) pointed to missing nodes and were removed.`,
      )
    }

    for (const id of Object.keys(base.positions)) if (!valid.has(id)) delete base.positions[id]
  }

  return {
    project: {
      version: PROJECT_VERSION,
      name: str(raw.name, 'Project'),
      bases,
      railLinks,
      settings: readSettings(raw),
    },
    warnings,
    legacy,
  }
}

/** Every node id of a base (including inter-base rail ends and rail lines). */
export function baseNodeIds(base: Base, railLinks: readonly RailLink[]): Set<string> {
  const ids = new Set<string>([
    ...base.factories.map((f) => nodeIds.factory(f.id)),
    ...base.mines.map((m) => nodeIds.mine(m.id)),
    ...base.receivers.map((r) => nodeIds.receiver(r.id)),
    ...base.dispatchers.map((d) => nodeIds.dispatcher(d.id)),
    ...base.storages.map((s) => nodeIds.storage(s.id)),
    ...base.railLines.map((l) => nodeIds.line(l.id)),
  ])

  for (const l of railLinks) {
    if (l.from === base.id && l.to !== base.id) ids.add(nodeIds.railOut(l.id))
    if (l.to === base.id && l.from !== base.id) ids.add(nodeIds.railIn(l.id))
  }

  return ids
}

// ============================================================================
// Section readers
// ============================================================================

/** Reads one base with all its nodes, links and positions (including migrations). */
function readBase(
  b: Obj,
  index: number,
  isLegacy: boolean,
  legacy: LegacyData | null,
  warnings: string[],
): Base {
  const base = emptyBase(str(b.name, `Base ${index + 1}`))

  base.id = str(b.id, base.id)

  base.factories = list(b.factories)
    .filter(isObj)
    .flatMap((f): Factory[] => {
      const recipe = strOrNull(f.recipe)

      // A missing `auto` (older save) means automatic, the default.
      return recipe
        ? [
            {
              id: str(f.id, newId('fac')),
              recipe,
              count: Math.max(0, num(f.count, 1)),
              auto: f.auto !== false,
            },
          ]
        : []
    })

  base.mines = list(b.mines)
    .filter(isObj)
    .map((m): Mine => {
      const id = str(m.id, newId('mine'))
      // v1: a null (or missing) count meant automatic → balancing sets it.
      const auto = isLegacy && !(typeof m.count === 'number' && m.count >= 1)

      if (auto) legacy!.autoMines.add(id)

      return {
        id,
        building: str(m.building, ''),
        item: strOrNull(m.item),
        purity: strOrNull(m.purity),
        count: auto ? 1 : Math.max(0, num(m.count, 1)),
        output: typeof m.output === 'number' && m.output >= 0 ? m.output : null,
      }
    })

  base.receivers = list(b.receivers)
    .filter(isObj)
    .map((r, i): Receiver => ({
      id: str(r.id, newId('rcv')),
      name: str(r.name, `Receiver ${i + 1}`),
      building: str(r.building, ''),
      item: strOrNull(r.item),
      virtual: virtualCargo(r.virtual),
    }))

  base.dispatchers = list(b.dispatchers)
    .filter(isObj)
    .map((d, i): Dispatcher => ({
      id: str(d.id, newId('dsp')),
      name: str(d.name, `Dispatcher ${i + 1}`),
      building: str(d.building, ''),
      item: strOrNull(d.item),
      receiverId: strOrNull(d.receiverId),
      feedRail: strOrNull(d.feedRail),
      virtual: virtualCargo(d.virtual),
    }))

  base.storages = list(b.storages)
    .filter(isObj)
    .map((s, i): Storage => ({
      id: str(s.id, newId('sto')),
      name: str(s.name, `Storage ${i + 1}`),
      building: str(s.building, ''),
      item: strOrNull(s.item),
      count: Math.max(1, Math.round(num(s.count, 1))),
    }))

  // Stops of old rail lines: line id → the stops' nodes in order.
  const oldStops = new Map<string, (string | null)[]>()
  let oldJoins = false

  base.railLines = list(b.railLines)
    .filter(isObj)
    .map((l, i): RailLine => {
      const id = str(l.id, newId('line'))
      const tier = strOrNull(l.tier)

      if (Array.isArray(l.stops)) {
        const stops = l.stops.filter(isObj)

        oldStops.set(
          id,
          stops.map((x) => strOrNull(x.nodeId)),
        )
        oldJoins ||= stops.some((x) => strOrNull(x.joinStopId))
      }

      return {
        id,
        name: str(l.name, `Rail line ${i + 1}`),
        // Old line: a configured tier became manual mode, automatic stayed automatic.
        mode: l.mode === 'manual' || l.mode === 'auto' ? l.mode : tier ? 'manual' : 'auto',
        // Rail set; the old form is one tier × a parallel count (tier, parallel).
        rails: railCounts(l.rails) ?? [
          { tier, count: Math.max(1, Math.round(num(l.parallel, 1))) },
        ],
        slots: typeof l.slots === 'number' && l.slots >= 1 ? Math.round(l.slots) : null,
      }
    })

  // The shared rail (bus) was removed: it becomes an automatic rail line (same behaviour:
  // per item in = out, no limit); its links and position move over.
  const busIds = new Map<string, string>()

  for (const [i, g] of list(b.buses).filter(isObj).entries()) {
    let id = str(g.id, newId('line'))

    if (base.railLines.some((l) => l.id === id)) id = newId('line')

    busIds.set(`bus:${str(g.id, '')}`, nodeIds.line(id))
    base.railLines.push({
      id,
      name: str(g.name, `Shared rail ${i + 1}`),
      mode: 'auto',
      rails: [{ tier: null, count: 1 }],
      slots: null,
    })
  }

  base.links = list(b.links)
    .filter(isObj)
    .flatMap((l): Link[] => {
      const from = strOrNull(l.from)
      const to = strOrNull(l.to)
      const item = strOrNull(l.item)

      if (!from || !to || !item) return []

      const link: Link = {
        id: str(l.id, newId('lnk')),
        from: busIds.get(from) ?? from,
        to: busIds.get(to) ?? to,
        item,
      }
      const rail = railCounts(l.rail)

      if (rail) link.rail = rail

      return [link]
    })

  if (busIds.size) {
    warnings.push(
      `"${base.name}": the shared rail was removed; ${busIds.size} shared rail(s) became automatic rail lines ` +
        '(same behaviour, their links were kept).',
    )
  }

  if (oldStops.size) {
    const converted = convertStops(base, oldStops)

    warnings.push(
      `"${base.name}": a rail line is now a node (inputs on the left, the same items on the right). ` +
        (converted
          ? `${converted} link(s) from the old stops now run through the rail line.`
          : 'The old stops were removed; link the line.') +
        (oldJoins ? ' Joins between lines were removed: links through them stayed direct.' : ''),
    )
  }

  if (isObj(b.positions)) {
    for (const [id, p] of Object.entries(b.positions)) {
      const valid =
        isObj(p) &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)

      if (valid)
        base.positions[busIds.get(id) ?? id] = {
          x: p.x as number,
          y: p.y as number,
        } satisfies Point
    }
  }

  if (isLegacy) {
    const targets = list(b.targets)
      .filter(isObj)
      .map((t) => ({ item: str(t.item, ''), rate: num(t.rate, 0) }))
      .filter((t) => t.item && t.rate > 0)

    if (targets.length) legacy!.targets.set(base.id, targets)

    if (list(b.railGroups).length || (isObj(b.routing) && Object.keys(b.routing).length)) {
      warnings.push(
        `"${base.name}": the old shared rail settings were removed; place a rail line with right-click.`,
      )
    }
  }

  return base
}

/** Reads the inter-base rails; rails pointing to unknown bases are skipped. */
function readRailLinks(raw: Obj, bases: readonly Base[], warnings: string[]): RailLink[] {
  const baseIds = new Set(bases.map((b) => b.id))
  const railLinks: RailLink[] = []

  for (const l of list(raw.railLinks)) {
    if (!isObj(l)) continue

    const link: RailLink = {
      id: str(l.id, newId('rl')),
      name: str(l.name, `Inter-base rail ${railLinks.length + 1}`),
      from: str(l.from, ''),
      to: str(l.to, ''),
      items: list(l.items).filter((x): x is string => typeof x === 'string'),
    }

    if (!baseIds.has(link.from) || !baseIds.has(link.to)) {
      warnings.push(`The rail "${link.name}" points to an unknown base; skipped.`)
      continue
    }

    railLinks.push(link)
  }

  return railLinks
}

/** Reads the project settings; invalid values keep their defaults. */
function readSettings(raw: Obj) {
  const s = isObj(raw.settings) ? raw.settings : {}
  const settings = defaultSettings()

  if (s.objective === 'buildings' || s.objective === 'power') settings.objective = s.objective

  settings.maxRailName = strOrNull(s.maxRailName)

  if (isObj(s.recipeOverrides)) {
    for (const [id, v] of Object.entries(s.recipeOverrides)) {
      if (typeof v === 'boolean') settings.recipeOverrides[id] = v
    }
  }

  if (isObj(s.cycleTimes)) {
    for (const [id, v] of Object.entries(s.cycleTimes)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) settings.cycleTimes[id] = v
    }
  }

  return settings
}

/**
 * Old (stop-based) rail line → links through the line node.
 *
 * A link ran on a line when its producer was attached at an earlier stop than its consumer
 * (the rail is one-way). Such a link A → B becomes A → rail line and rail line → B (linked
 * once per item).
 *
 * @returns how many links now run through a rail line
 */
function convertStops(base: Base, stops: ReadonlyMap<string, (string | null)[]>): number {
  let converted = 0
  const links: Link[] = []

  const add = (from: string, to: string, item: string) => {
    if (!links.some((l) => l.from === from && l.to === to && l.item === item)) {
      links.push({ id: newId('lnk'), from, to, item })
    }
  }

  for (const l of base.links) {
    const line = [...stops].find(([, nodes]) => {
      const first = nodes.indexOf(l.from)

      return first >= 0 && nodes.lastIndexOf(l.to) > first
    })

    if (!line) {
      links.push(l)
      continue
    }

    const lineNode = nodeIds.line(line[0])

    add(l.from, lineNode, l.item)
    add(lineNode, l.to, l.item)
    converted++
  }

  base.links = links

  return converted
}
