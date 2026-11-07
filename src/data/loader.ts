/**
 * @module data/loader
 *
 * Loads the game data: `public/data/*.yml` → internal {@link GameData} model.
 *
 * This module connects the hand-edited data files to the engine. When the game gets a new
 * item, recipe or building, only the YAML files and icons change – neither this module nor
 * the engine.
 *
 * Steps:
 *   1. fetch `data/game.yml` and learn which other files to load,
 *   2. parse them (YAML; YAML also accepts JSON),
 *   3. validate everything and report problems with FILE NAME and LOCATION
 *      (e.g. `items/materials.yml › titanium_rod › recipe 1: unknown building`),
 *   4. turn the per-item recipe lists into one flat recipe list,
 *   5. create recipe variants for upgraded buildings (`upgradeOf` + `inheritRecipes`).
 *
 * Every quantity is items per minute per building (recipes, mines, Dispatchers, rails).
 *
 * Error handling:
 *   - YAML syntax error or missing file → {@link LoadError}; the UI keeps the previous data
 *     and shows the error,
 *   - field-level problem (e.g. a misspelled id) → warning; the faulty element is skipped,
 *     everything else works.
 */
import { parse, YAMLParseError } from 'yaml'

import { MAX_RECIPE_INPUTS } from '../config'
import type {
  Building,
  BuildingType,
  GameData,
  GameFeatures,
  Item,
  ItemAmount,
  ItemQuantity,
  Purity,
  RailTier,
  RateTable,
  Recipe,
  TargetSpec,
} from './types'

/** Base path of the app (dev: `/`, build: `./`). Optional chaining keeps it loadable outside Vite (tests). */
const BASE = import.meta.env?.BASE_URL ?? '/'

/** Folder of the data files inside `public/`. */
const DATA_DIR = 'data/'

/** Folder of the icons inside `public/`. `icon:` fields are relative to it. */
const ICON_DIR = 'icons/'

/** Entry file inside {@link DATA_DIR}. */
const GAME_FILE = 'game.yml'

/** Fatal error: nothing can be loaded from these files. */
export class LoadError extends Error {}

/** Result of {@link loadGameData}: the data plus the non-fatal warnings. */
export interface LoadResult {
  data: GameData
  warnings: string[]
}

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

const BUILDING_TYPES: BuildingType[] = ['production', 'miner', 'storage', 'dispatcher', 'receiver']

/** Old Dispatcher fields (stack + send time formula); today `throughput:` gives items/min directly. */
const OLD_DISPATCHER_KEYS = ['stackSize', 'sendTime', 'parallelLoading', 'bandwidth']

// ============================================================================
// Entry point
// ============================================================================

/**
 * Loads and validates all game data files.
 *
 * @param version Increases with every load; added to icon URLs so the browser does not show
 *                a cached old image.
 * @returns the game data and the list of warnings
 * @throws {LoadError} on a missing file or a YAML syntax error
 */
export async function loadGameData(version = 0): Promise<LoadResult> {
  const r = new Reporter()

  // --- 1. game.yml ---
  const game = await fetchFile(GAME_FILE)

  if (!isObj(game)) throw new LoadError(`${GAME_FILE}: empty file or invalid structure`)

  r.checkKeys(
    game,
    [
      'title',
      'subtitle',
      'files',
      'rails',
      'purities',
      'features',
      'defaultTargets',
      'startProject',
    ],
    GAME_FILE,
  )

  const files = game.files

  if (!isObj(files)) {
    throw new LoadError(
      `${GAME_FILE}: the "files:" section is missing (buildings and items file lists)`,
    )
  }

  const buildingFiles = stringList(files.buildings, `${GAME_FILE} › files.buildings`)
  const itemFiles = stringList(files.items, `${GAME_FILE} › files.items`)

  // --- 2. all other files, in parallel ---
  const [buildingDocs, itemDocs] = await Promise.all([
    Promise.all(buildingFiles.map(async (f) => [f, await fetchFile(f)] as const)),
    Promise.all(itemFiles.map(async (f) => [f, await fetchFile(f)] as const)),
  ])

  const icon = (path: string | undefined) => iconUrl(path, version)

  /**
   * Build costs (`{ item_id: pieces }`): items are only known later, so the raw values are
   * collected here and validated after the items are read (see below).
   */
  const pendingCosts: { where: string; raw: unknown; set: (cost: ItemQuantity[]) => void }[] = []

  // --- rail tiers and deposit purities (buildings refer to them) ---
  const rails = readRails(game, r, pendingCosts)
  const { purities, defaultPurity } = readPurities(game, r)

  /**
   * Reads an items-per-minute value: a number, or a `{ variant: number }` table
   * (`data/types.ts › RateTable`).
   *
   * @param allowed the allowed variants (e.g. purity ids, rail names)
   * @param what    name of the variant kind in messages ("purity", "rail")
   */
  const rateTable = (
    v: unknown,
    where: string,
    allowed: string[],
    what: string,
  ): RateTable | undefined => {
    if (typeof v === 'number') {
      if (v > 0) return v

      r.warn(where, 'must be a positive number')

      return undefined
    }

    if (!isObj(v)) {
      r.warn(where, `expected a number or a { ${what}: number } table (got ${JSON.stringify(v)})`)

      return undefined
    }

    const table: Record<string, number> = {}

    for (const [key, rate] of Object.entries(v)) {
      if (!allowed.includes(key)) {
        const list = allowed.length
          ? `allowed: ${allowed.join(', ')}`
          : `game.yml defines no ${what}`

        r.warn(where, `unknown ${what} "${key}"${suggest(key, allowed)} (${list})`)
      } else if (typeof rate !== 'number' || !(rate > 0)) {
        r.warn(where, `"${key}": must be a positive number (got ${JSON.stringify(rate)})`)
      } else {
        table[key] = rate
      }
    }

    // Keep the order of game.yml (worst to best), not the order written in the file.
    const ordered = Object.fromEntries(allowed.filter((k) => k in table).map((k) => [k, table[k]]))

    return Object.keys(ordered).length ? ordered : undefined
  }

  // --- 3. buildings ---
  const buildings = new Map<string, Building>()
  const buildingSource = new Map<string, string>()

  for (const [file, doc] of buildingDocs) {
    if (doc == null) continue // empty file

    if (!isObj(doc)) {
      r.warn(file, 'expected entries starting with "building_id:"')
      continue
    }

    for (const [id, raw] of Object.entries(doc)) {
      const where = `${file} › ${id}`

      if (!r.checkId(id, where)) continue

      if (buildings.has(id)) {
        r.warn(where, `this id is already defined in ${buildingSource.get(id)}; skipped`)
        continue
      }

      if (!isObj(raw)) {
        r.warn(where, 'empty entry; skipped')
        continue
      }

      const oldKeys = OLD_DISPATCHER_KEYS.filter((k) => k in raw)

      if (oldKeys.length) {
        r.warn(
          where,
          `${oldKeys.join(', ')}: these fields no longer exist; throughput: gives items/min, ` +
            'e.g. throughput: { v.1: 100, v.2: 171.4 }',
        )
      }

      // Locking was removed: every building is available, upgrades are chosen per node.
      if ('locked' in raw)
        r.warn(
          where,
          'locked: this field no longer exists (every building is available); remove it',
        )

      r.checkKeys(
        raw,
        [
          'name',
          'type',
          'power',
          'speed',
          'icon',
          'maxInputs',
          'upgradeOf',
          'inheritRecipes',
          'cost',
          'locked',
          'mines',
          'capacity',
          'throughput',
          'railOutputs',
          ...oldKeys,
        ],
        where,
      )

      const typeRaw = r.str(raw, 'type', where) ?? 'production'
      const type = BUILDING_TYPES.includes(typeRaw as BuildingType)
        ? (typeRaw as BuildingType)
        : 'production'

      if (type !== typeRaw)
        r.warn(where, `type: "${typeRaw}" is unknown; allowed: ${BUILDING_TYPES.join(', ')}`)

      const capacity = r.num(raw, 'capacity', where, {
        positive: true,
        required: type === 'storage',
      })

      // Dispatcher throughput: one number, or per rail tier.
      let throughput: RateTable | undefined

      if (raw.throughput !== undefined) {
        throughput = rateTable(
          raw.throughput,
          `${where} › throughput`,
          rails.map((t) => t.name),
          'rail',
        )
      } else if (type === 'dispatcher') {
        r.warn(
          where,
          'the "throughput" field (items/min) is missing; until it is set, the Dispatcher sends nothing',
        )
      }

      // Miner: items/min per item, one number or per purity. Item ids are validated after
      // the items are read (see below).
      let mines: Record<string, RateTable> | undefined

      if (raw.mines !== undefined) {
        if (!isObj(raw.mines)) {
          r.warn(
            where,
            'mines: expected { item_id: items/min } or { item_id: { purity: items/min } }',
          )
        } else {
          mines = {}

          for (const [itemId, table] of Object.entries(raw.mines)) {
            const t = rateTable(
              table,
              `${where} › mines › ${itemId}`,
              purities.map((p) => p.id),
              'purity',
            )

            if (t !== undefined) mines[itemId] = t
          }
        }
      }

      if (type === 'miner' && !mines)
        r.warn(where, 'a miner (type: miner) without a "mines:" table mines nothing')
      if (type !== 'miner' && mines) r.warn(where, 'mines: only used by miners (type: miner)')

      buildings.set(id, {
        id,
        type,
        capacity,
        throughput,
        mines: type === 'miner' ? (mines ?? {}) : undefined,
        railOutputs: r.num(raw, 'railOutputs', where, { integer: true, min: 1 }),
        name: r.str(raw, 'name', where, true) ?? id,
        power: r.num(raw, 'power', where, { required: true }) ?? 0,
        speed: r.num(raw, 'speed', where, { positive: true }) ?? 1,
        icon: icon(r.str(raw, 'icon', where)),
        upgradeOf: r.str(raw, 'upgradeOf', where),
        inheritRecipes: r.bool(raw, 'inheritRecipes', where) ?? false,
        maxInputs: r.num(raw, 'maxInputs', where, { integer: true, min: 0 }),
      })
      buildingSource.set(id, file)

      if (raw.cost !== undefined) {
        const b = buildings.get(id)!

        pendingCosts.push({ where: `${where} › cost`, raw: raw.cost, set: (c) => (b.cost = c) })
      }

      if (raw.inheritRecipes === true && !raw.upgradeOf) {
        r.warn(
          where,
          'inheritRecipes: only meaningful together with upgradeOf (whose recipes to inherit)',
        )
      }
    }
  }

  validateUpgradeChains(buildings, buildingSource, r)

  /**
   * Buildings that can run the recipes of `base`: the base itself plus its upgrades with
   * `inheritRecipes: true` (at every step of the chain). The base building comes first.
   */
  const capableBuildings = (base: string): Building[] => {
    const result: Building[] = []

    for (const b of buildings.values()) {
      const parent = (p: Building) =>
        p.inheritRecipes && p.upgradeOf ? buildings.get(p.upgradeOf) : undefined

      for (let p: Building | undefined = b; p; p = parent(p)) {
        if (p.id === base) {
          result.push(b)
          break
        }
      }
    }

    return result.sort((a, b) => (a.id === base ? -1 : b.id === base ? 1 : 0))
  }

  // --- 4. items, pass 1: base data (so recipes may refer to items of any file) ---
  const items = new Map<string, Item>()
  const itemSource = new Map<string, string>()
  const itemRecipes: { file: string; item: Item; recipes: unknown }[] = []

  for (const [file, doc] of itemDocs) {
    if (doc == null) continue

    if (!isObj(doc)) {
      r.warn(file, 'expected entries starting with "item_id:"')
      continue
    }

    for (const [id, raw] of Object.entries(doc)) {
      const where = `${file} › ${id}`

      if (!r.checkId(id, where)) continue

      if (items.has(id)) {
        r.warn(where, `this id is already defined in ${itemSource.get(id)}; skipped`)
        continue
      }

      if (!isObj(raw)) {
        r.warn(where, 'empty entry; at least the name field is required')
        continue
      }

      r.checkKeys(raw, ['name', 'icon', 'color', 'short', 'recipes'], where)

      let color = r.str(raw, 'color', where)

      if ('color' in raw && raw.color === null) {
        r.warn(
          where,
          `color: empty. Quote the value: color: '#a07f66' (otherwise # starts a comment)`,
        )
      }

      if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) {
        r.warn(where, `color: "${color}" is not an #rrggbb colour`)
        color = undefined
      }

      let short = r.str(raw, 'short', where)

      if (short && short.length > 3) {
        r.warn(where, 'short: at most 3 characters fit in the circle')
        short = short.slice(0, 3)
      }

      const item: Item = {
        id,
        name: r.str(raw, 'name', where, true) ?? id,
        color: color ?? colorFromId(id),
        icon: icon(r.str(raw, 'icon', where)),
        short,
      }

      items.set(id, item)
      itemSource.set(id, file)
      itemRecipes.push({ file, item, recipes: raw.recipes })
    }
  }

  // Mines: do they mine existing items?
  for (const b of buildings.values()) {
    for (const itemId of Object.keys(b.mines ?? {})) {
      if (items.has(itemId)) continue

      r.warn(
        `${buildingSource.get(b.id)} › ${b.id} › mines`,
        `unknown item "${itemId}"${suggest(itemId, items.keys())}`,
      )
      delete b.mines![itemId]
    }
  }

  // Build costs: { item_id: pieces } with existing items.
  for (const { where, raw, set } of pendingCosts) {
    if (!isObj(raw)) {
      r.warn(where, 'expected { item_id: pieces, ... }')
      continue
    }

    const list: ItemQuantity[] = []

    for (const [itemId, qty] of Object.entries(raw)) {
      if (!items.has(itemId)) {
        r.warn(where, `unknown item "${itemId}"${suggest(itemId, items.keys())}`)
      } else if (typeof qty !== 'number' || !(qty > 0)) {
        r.warn(where, `"${itemId}": must be a positive number (got ${JSON.stringify(qty)})`)
      } else {
        list.push({ item: itemId, quantity: qty })
      }
    }

    set(list)
  }

  // --- 5. items, pass 2: recipes ---
  const recipes: Recipe[] = []
  const usedRecipeIds = new Set<string>()

  /** Reads an `{ item_id: amount }` map; null when any entry is invalid. */
  const amountList = (o: Obj, key: string, where: string): ItemAmount[] | null => {
    const v = o[key]

    if (v === undefined || v === null) return []

    if (!isObj(v)) {
      r.warn(where, `${key}: expected { item_id: amount, ... }`)

      return null
    }

    let ok = true
    const list: ItemAmount[] = []

    for (const [itemId, amount] of Object.entries(v)) {
      if (!items.has(itemId)) {
        r.warn(where, `${key}: unknown item "${itemId}"${suggest(itemId, items.keys())}`)
        ok = false
      } else if (typeof amount !== 'number' || !(amount > 0)) {
        r.warn(
          where,
          `${key}: the amount of "${itemId}" must be a positive number (got ${JSON.stringify(amount)})`,
        )
        ok = false
      } else {
        list.push({ item: itemId, amount })
      }
    }

    return ok ? list : null
  }

  for (const { file, item, recipes: rawList } of itemRecipes) {
    if (rawList === undefined || rawList === null) continue // no recipe (e.g. a by-product)

    if (!Array.isArray(rawList)) {
      r.warn(`${file} › ${item.id}`, 'recipes: expected a list (every recipe starts with "- ")')
      continue
    }

    rawList.forEach((raw: unknown, i) => {
      const where = `${file} › ${item.id} › recipe ${i + 1}`

      if (!isObj(raw)) {
        r.warn(where, 'empty recipe; skipped')

        return
      }

      r.checkKeys(
        raw,
        [
          'id',
          'name',
          'building',
          'time',
          'input',
          'output',
          'byproducts',
          'alternate',
          'perCycle',
        ],
        where,
      )

      // Every value is items/min for ONE building (at speed 1):
      //   input  – consumed per minute (absent → a recipe without inputs)
      //   output – main product made per minute
      const buildingId = r.str(raw, 'building', where, true)

      // Missing rate: only per-cycle quantities are known (perCycle), not the cycle time.
      let perCycle: Recipe['perCycle']

      if (raw.perCycle !== undefined && raw.output !== undefined) {
        r.warn(where, 'perCycle and output together: output (items/min) wins, perCycle is ignored')
      } else if (raw.perCycle !== undefined) {
        const pc = raw.perCycle
        const pcWhere = `${where} › perCycle`

        if (isObj(pc)) {
          r.checkKeys(pc, ['input', 'output', 'byproducts'], pcWhere)

          const ins = amountList(pc, 'input', pcWhere)
          const out = r.num(pc, 'output', pcWhere, { required: true, positive: true })
          const by = amountList(pc, 'byproducts', pcWhere)

          if (ins && by && out !== undefined) {
            perCycle = { inputs: ins, outputs: [{ item: item.id, amount: out }, ...by] }
          }
        } else {
          r.warn(pcWhere, 'expected an object: { input: {…}, output: N }')
        }

        if (!perCycle) {
          r.warn(where, 'the recipe is skipped because of the error above')

          return
        }
      }

      let inputs = perCycle
        ? perCycle.inputs.map((x) => ({ item: x.item, amount: 0 }))
        : amountList(raw, 'input', where)
      let output = perCycle ? 0 : r.num(raw, 'output', where, { required: true, positive: true })
      let byproducts = perCycle
        ? perCycle.outputs.slice(1).map((x) => ({ item: x.item, amount: 0 }))
        : amountList(raw, 'byproducts', where)

      // Old format (cycle time + per-cycle amounts): convert, and say what to write instead.
      const time = r.num(raw, 'time', where, { positive: true })

      if (time !== undefined && output !== undefined && inputs && byproducts) {
        const perMin = (x: number) => Math.round((x * 60 * 1000) / time) / 1000

        inputs = inputs.map((x) => ({ item: x.item, amount: perMin(x.amount) }))
        byproducts = byproducts.map((x) => ({ item: x.item, amount: perMin(x.amount) }))
        output = perMin(output)

        const obj = (list: ItemAmount[]) =>
          `{ ${list.map((x) => `${x.item}: ${x.amount}`).join(', ')} }`

        r.warn(
          where,
          'time: this field no longer exists, every value is items/min. Converted; write it as: ' +
            [
              inputs.length ? `input: ${obj(inputs)}` : '',
              `output: ${output}`,
              byproducts.length ? `byproducts: ${obj(byproducts)}` : '',
            ]
              .filter(Boolean)
              .join(', '),
        )
      }

      if (buildingId && !buildings.has(buildingId)) {
        r.warn(where, `unknown building "${buildingId}"${suggest(buildingId, buildings.keys())}`)
      }

      let building = buildingId ? buildings.get(buildingId) : undefined

      if (building && building.type !== 'production') {
        const hint =
          building.type === 'miner'
            ? '; a miner lists what it mines in the "mines:" table of buildings/*.yml'
            : ''

        r.warn(
          where,
          `${building.name} is not a production building (${building.type}) and cannot run recipes${hint}`,
        )
        building = undefined
      }

      if (!building || output === undefined || inputs === null || byproducts === null) {
        r.warn(where, 'the recipe is skipped because of the error above')

        return
      }

      const maxInputs = building.maxInputs ?? MAX_RECIPE_INPUTS

      if (inputs.length > maxInputs) {
        r.warn(where, `${inputs.length} inputs, but ${building.name} supports at most ${maxInputs}`)
      }

      let id = r.str(raw, 'id', where) ?? (i === 0 ? item.id : `${item.id}_${i + 1}`)

      if (usedRecipeIds.has(id)) {
        r.warn(where, `the recipe id "${id}" is already taken; renamed`)

        let n = 2

        while (usedRecipeIds.has(`${id}_${n}`)) n++
        id = `${id}_${n}`
      }

      usedRecipeIds.add(id)

      const base: Omit<Recipe, 'id' | 'building'> = {
        baseRecipe: id,
        product: item.id,
        name: r.str(raw, 'name', where) ?? item.name,
        inputs,
        outputs: [{ item: item.id, amount: output }, ...byproducts],
        disabledByDefault: r.bool(raw, 'alternate', where) ?? false,
      }

      if (perCycle) {
        base.perCycle = perCycle
        base.rateFrom = 'missing'
      }

      // One variant for every building that can run it (base + upgrades).
      for (const b of capableBuildings(building.id)) {
        recipes.push({ ...base, id: b.id === building.id ? id : `${id}@${b.id}`, building: b.id })
      }
    })
  }

  // --- 6. game rule switches and default targets ---
  const features = readFeatures(game, r)
  const defaultTargets = readDefaultTargets(game, r, items)

  // --- 7. start project (optional) ---
  let startProject: unknown = null
  const startFile = r.str(game, 'startProject', GAME_FILE)

  if (startFile) {
    try {
      startProject = await fetchFile(startFile)
    } catch (e) {
      r.warn(GAME_FILE, `startProject: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    data: {
      title: r.str(game, 'title', GAME_FILE) ?? 'Production Planner',
      subtitle: r.str(game, 'subtitle', GAME_FILE) ?? '',
      items: [...items.values()],
      buildings: [...buildings.values()],
      recipes,
      rails,
      purities,
      defaultPurity: defaultPurity ?? purities[0]?.id ?? null,
      features,
      defaultTargets,
      startProject,
    },
    warnings: r.warnings,
  }
}

/**
 * Checks that the configured icon files exist.
 *
 * Runs separately after loading, so the graph can render meanwhile. A missing image falls
 * back to the coloured circle in the UI; this only produces warnings.
 *
 * @returns one warning per missing icon
 */
export async function checkIcons(data: GameData): Promise<string[]> {
  const entries = [
    ...data.items.map((i) => ({ url: i.icon, owner: `item: ${i.id}` })),
    ...data.buildings.map((b) => ({ url: b.icon, owner: `building: ${b.id}` })),
  ].filter((e): e is { url: string; owner: string } => !!e.url)

  const results = await Promise.all(
    entries.map(async ({ url, owner }) => {
      try {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
        const type = res.headers.get('content-type') ?? ''

        if (res.ok && type.startsWith('image/')) return null
      } catch {
        // A network error counts as missing.
      }

      return `Missing icon: icons/${displayIconPath(url)} (${owner})`
    }),
  )

  return results.filter((x): x is string => x !== null)
}

// ============================================================================
// Section readers of game.yml
// ============================================================================

/** Reads the drone rail tiers (`rails:`), sorted by ascending capacity. */
function readRails(
  game: Obj,
  r: Reporter,
  pendingCosts: { where: string; raw: unknown; set: (cost: ItemQuantity[]) => void }[],
): RailTier[] {
  const rails: RailTier[] = []

  if (game.rails === undefined) return rails

  if (!Array.isArray(game.rails)) {
    r.warn(GAME_FILE, 'rails: expected a list (- name: v.1 / capacity: 120)')

    return rails
  }

  game.rails.forEach((t: unknown, i) => {
    const where = `${GAME_FILE} › rails ${i + 1}`

    if (!isObj(t)) return r.warn(where, 'expected { name, capacity }')

    r.checkKeys(t, ['name', 'capacity', 'cost'], where)

    const name = r.str(t, 'name', where, true)
    const capacity = r.num(t, 'capacity', where, { required: true, positive: true })

    if (name && capacity !== undefined) {
      const tier: RailTier = { name, capacity }

      if (t.cost !== undefined) {
        pendingCosts.push({ where: `${where} cost`, raw: t.cost, set: (c) => (tier.cost = c) })
      }

      rails.push(tier)
    }
  })

  return rails.sort((a, b) => a.capacity - b.capacity)
}

/** Reads the deposit purities (`purities:`) and the default one. */
function readPurities(
  game: Obj,
  r: Reporter,
): { purities: Purity[]; defaultPurity: string | null } {
  const purities: Purity[] = []
  let defaultPurity: string | null = null

  if (game.purities === undefined || game.purities === null) return { purities, defaultPurity }

  if (!Array.isArray(game.purities)) {
    r.warn(GAME_FILE, 'purities: expected a list (- id: normal / name: Normal)')

    return { purities, defaultPurity }
  }

  for (const [i, p] of (game.purities as unknown[]).entries()) {
    const where = `${GAME_FILE} › purities ${i + 1}`

    if (!isObj(p)) {
      r.warn(where, 'expected { id, name }')
      continue
    }

    r.checkKeys(p, ['id', 'name', 'default'], where)

    const id = r.str(p, 'id', where, true)

    if (!id || !r.checkId(id, where)) continue

    if (purities.some((x) => x.id === id)) {
      r.warn(where, `"${id}" is already defined; skipped`)
      continue
    }

    purities.push({ id, name: r.str(p, 'name', where) ?? id })

    if (r.bool(p, 'default', where)) defaultPurity = id
  }

  return { purities, defaultPurity }
}

/** Reads the game rule switches (`features:`); missing switches keep their defaults. */
function readFeatures(game: Obj, r: Reporter): GameFeatures {
  const features: GameFeatures = { cargoManyToOne: false, flowDistribution: 'even' }

  if (game.features === undefined || game.features === null) return features

  if (!isObj(game.features)) {
    r.warn(GAME_FILE, 'features: expected "switch: value" entries')

    return features
  }

  const where = `${GAME_FILE} › features`

  r.checkKeys(game.features, Object.keys(features), where)
  features.cargoManyToOne =
    r.bool(game.features, 'cargoManyToOne', where) ?? features.cargoManyToOne

  const dist = r.str(game.features, 'flowDistribution', where)

  if (dist === 'even' || dist === 'optimal') {
    features.flowDistribution = dist
  } else if (dist !== undefined) {
    r.warn(where, `flowDistribution: must be "even" or "optimal", not "${dist}"; using "even"`)
  }

  return features
}

/** Reads the default production targets (`defaultTargets:`). */
function readDefaultTargets(
  game: Obj,
  r: Reporter,
  items: ReadonlyMap<string, Item>,
): TargetSpec[] {
  const targets: TargetSpec[] = []

  if (game.defaultTargets === undefined) return targets

  if (!Array.isArray(game.defaultTargets)) {
    r.warn(GAME_FILE, 'defaultTargets: expected a list')

    return targets
  }

  game.defaultTargets.forEach((t: unknown, i) => {
    const where = `${GAME_FILE} › defaultTargets ${i + 1}`

    if (!isObj(t)) return r.warn(where, 'expected { item, rate }')

    const item = r.str(t, 'item', where, true)
    const rate = r.num(t, 'rate', where, { required: true, positive: true })

    if (item && !items.has(item))
      r.warn(where, `unknown item "${item}"${suggest(item, items.keys())}`)
    else if (item && rate !== undefined) targets.push({ item, rate })
  })

  return targets
}

/**
 * Validates `upgradeOf`: it must point to an existing building and must not form a cycle.
 * Invalid references are removed (with a warning).
 */
function validateUpgradeChains(
  buildings: ReadonlyMap<string, Building>,
  buildingSource: ReadonlyMap<string, string>,
  r: Reporter,
): void {
  for (const b of buildings.values()) {
    if (!b.upgradeOf) continue

    const where = `${buildingSource.get(b.id)} › ${b.id}`

    if (!buildings.has(b.upgradeOf)) {
      r.warn(
        where,
        `upgradeOf: unknown building "${b.upgradeOf}"${suggest(b.upgradeOf, buildings.keys())}`,
      )
      b.upgradeOf = undefined
      continue
    }

    const seen = new Set([b.id])

    for (
      let p = buildings.get(b.upgradeOf);
      p;
      p = p.upgradeOf ? buildings.get(p.upgradeOf) : undefined
    ) {
      if (seen.has(p.id)) {
        r.warn(where, 'upgradeOf: forms a cycle (A → B → A); the reference is ignored')
        b.upgradeOf = undefined
        break
      }

      seen.add(p.id)
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Fetches and parses one data file. */
async function fetchFile(path: string): Promise<unknown> {
  const url = BASE + DATA_DIR + path
  let text: string

  try {
    const res = await fetch(url, { cache: 'no-store' })

    // The Vite dev server answers a missing file with index.html; treat that as missing too.
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) {
      throw new LoadError(`${path}: file not found (public/${DATA_DIR}${path})`)
    }

    text = await res.text()
  } catch (e) {
    if (e instanceof LoadError) throw e

    throw new LoadError(`${path}: download failed (${e})`)
  }

  try {
    return parse(text)
  } catch (e) {
    const detail =
      e instanceof YAMLParseError ? e.message.split('\n')[0].replace(/:$/, '') : String(e)

    throw new LoadError(`${path}: YAML error – ${detail}`)
  }
}

/** A list of file names; anything else is fatal. */
function stringList(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new LoadError(`${where}: expected a list of file names, e.g. "- items/raw.yml"`)
  }

  return v
}

/** Full icon URL with a cache-busting version; absolute and data URLs are kept as they are. */
function iconUrl(path: string | undefined, version: number): string | undefined {
  if (!path) return undefined

  if (/^(https?:|data:|\/)/.test(path)) return path

  return `${BASE}${ICON_DIR}${path}?v=${version}`
}

/** The icon path as written in the data (for messages). */
function displayIconPath(url: string): string {
  return url.replace(BASE + ICON_DIR, '').replace(/\?v=\d+$/, '')
}

/** A stable, well-visible colour generated from the id (when the data sets none). */
function colorFromId(id: string): string {
  let h = 0

  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0

  return hslToHex(h % 360, 55, 52)
}

/** HSL (degrees, percent, percent) → `#rrggbb`. */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100

  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))

  return (
    '#' +
    [f(0), f(8), f(4)]
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

/** "Did you mean …?" suggestion for a misspelled id (at most 3 characters different). */
function suggest(wrong: string, candidates: Iterable<string>): string {
  let best = ''
  let bestDist = 4

  for (const c of candidates) {
    const d = levenshtein(wrong.toLowerCase(), c.toLowerCase())

    if (d < bestDist) {
      best = c
      bestDist = d
    }
  }

  return best ? ` (did you mean "${best}"?)` : ''
}

/** Edit distance between two strings. */
function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)

  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]

    row[0] = i

    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]

      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }

  return row[b.length]
}

/** Collects warnings and reads typed fields in one place. */
class Reporter {
  warnings: string[] = []

  /** Records a warning at `where` (file › location). */
  warn(where: string, message: string): void {
    this.warnings.push(`${where}: ${message}`)
  }

  /** Validates an id: letters, digits, `_` and `-`, not starting with a digit. */
  checkId(id: string, where: string): boolean {
    if (ID_PATTERN.test(id)) return true

    this.warn(
      where,
      'an id may only contain letters, digits, _ and -, and must not start with a digit; skipped',
    )

    return false
  }

  /** Reports misspelled field names (e.g. "bulding"). */
  checkKeys(o: Obj, allowed: string[], where: string): void {
    for (const key of Object.keys(o)) {
      if (!allowed.includes(key)) this.warn(where, `unknown field "${key}"${suggest(key, allowed)}`)
    }
  }

  /** Reads a string field (numbers are accepted and stringified). */
  str(o: Obj, key: string, where: string, required = false): string | undefined {
    const v = o[key]

    if (v === undefined || v === null) {
      if (required) this.warn(where, `the "${key}" field is missing`)

      return undefined
    }

    if (typeof v === 'number') return String(v)

    if (typeof v !== 'string') {
      this.warn(where, `${key}: expected text`)

      return undefined
    }

    return v
  }

  /** Reads a numeric field with optional constraints. */
  num(
    o: Obj,
    key: string,
    where: string,
    opts: { required?: boolean; positive?: boolean; integer?: boolean; min?: number } = {},
  ): number | undefined {
    const v = o[key]

    if (v === undefined || v === null) {
      if (opts.required) this.warn(where, `the "${key}" field is missing`)

      return undefined
    }

    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.warn(where, `${key}: expected a number (got ${JSON.stringify(v)})`)

      return undefined
    }

    if (opts.positive && !(v > 0)) {
      this.warn(where, `${key}: must be a positive number`)

      return undefined
    }

    if (opts.integer && !Number.isInteger(v)) {
      this.warn(where, `${key}: must be a whole number`)

      return undefined
    }

    if (opts.min !== undefined && v < opts.min) {
      this.warn(where, `${key}: must be at least ${opts.min}`)

      return undefined
    }

    return v
  }

  /** Reads a boolean field. */
  bool(o: Obj, key: string, where: string): boolean | undefined {
    const v = o[key]

    if (v === undefined || v === null) return undefined

    if (typeof v !== 'boolean') {
      this.warn(where, `${key}: must be true or false`)

      return undefined
    }

    return v
  }
}
