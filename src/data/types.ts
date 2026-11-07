/**
 * @module data/types
 *
 * Internal game data model – what the calculation engine (`src/engine`) works with.
 *
 * This model is never written by hand: `loader.ts` builds it from the YAML/JSON files in
 * `public/data/`. The file format is optimised for editing (each item lists its recipes);
 * this model is optimised for calculation (a flat recipe list).
 *
 * Adding a new property from the game (e.g. heat output):
 *   1. add the field here,
 *   2. parse it in `loader.ts` (and add it to the `checkKeys` list),
 *   3. add it to `public/data/schema/*.json` (editor completion),
 *   4. document it in `docs/CONFIGURATION.md`,
 *   5. use it where needed (e.g. `components/GraphNode/GraphNode.ts`).
 */

/** An item: a raw material, an intermediate or a product. */
export interface Item {
  id: string
  name: string

  /** Colour of links and of the fallback icon. Always set by the loader. */
  color: string

  /** Resolved image URL (the loader returns the full path). */
  icon?: string

  /** 1–3 letters shown in the coloured circle when the image is missing or fails to load. */
  short?: string
}

/**
 * An items-per-minute value: one number, or one number per variant.
 *
 * ```
 * 120                          → always 120
 * { normal: 120, pure: 240 }   → by the chosen variant
 * ```
 *
 * For mines the variant is the deposit purity, for Dispatchers the feed rail tier.
 * With a single value the UI shows no selector. Helpers: `engine/rateTable.ts`.
 */
export type RateTable = number | Record<string, number>

/**
 * Building kinds:
 * - `production` – runs recipes (default),
 * - `miner`      – mine: no inputs, produces by its `mines` table,
 * - `storage`    – stores one item (`capacity` pieces),
 * - `dispatcher` – cargo sender, sends to one Receiver (`throughput` items/min),
 * - `receiver`   – cargo receiver, receives from one Dispatcher (1:1; N:1 only with the
 *                  `features.cargoManyToOne` switch in `game.yml`).
 */
export type BuildingType = 'production' | 'miner' | 'storage' | 'dispatcher' | 'receiver'

/** A building / machine. An upgraded variant (v.2) is a separate Building. */
export interface Building {
  id: string
  name: string
  type: BuildingType

  /** Power draw per building in MW (negative = generates). */
  power: number

  /** Speed multiplier applied to recipes; 1 = base speed. */
  speed: number

  icon?: string

  /** For an upgraded variant: the id of the base building (shown with ↑). */
  upgradeOf?: string

  /**
   * `true`: the building also runs every recipe of its base building (`upgradeOf`), scaled
   * by `speed`. Defaults to `false`, because in StarRupture v.2 buildings have their own
   * recipe list.
   */
  inheritRecipes?: boolean

  /** Build cost per building (pieces, not per minute). */
  cost?: ItemQuantity[]

  /** Maximum number of recipe inputs (validation only). */
  maxInputs?: number

  /** Miner: item id → items/min, per purity or as one number. */
  mines?: Record<string, RateTable>

  /** Storage: pieces that fit in one storage building. */
  capacity?: number

  /** Dispatcher: throughput in items/min, per rail tier or as one number. */
  throughput?: RateTable

  /** Receiver: number of rail outputs (limits the outgoing flow). */
  railOutputs?: number
}

/** Purity (quality) of a mining deposit, e.g. Impure / Normal / Pure (`purities` in `game.yml`). */
export interface Purity {
  id: string
  name: string
}

/** A quantity of an item (e.g. build cost) – a count, not a rate. */
export interface ItemQuantity {
  item: string
  quantity: number
}

/** One input or output of a recipe. */
export interface ItemAmount {
  item: string

  /** Items per minute, per building, at speed 1. */
  amount: number
}

/**
 * A recipe in ONE specific building.
 *
 * When several buildings can run a recipe (base + upgraded), the loader creates one Recipe
 * per building; they share `baseRecipe`. The UI groups by `baseRecipe`; a factory node runs
 * one specific variant (upgrading switches between variants).
 */
export interface Recipe {
  /** Unique id per variant (e.g. `titanium_bar_smelter`; inherited: `…@<building id>`). */
  id: string

  /** Id of the logical recipe, independent of the variant. */
  baseRecipe: string

  /** Main product (the item under which the recipe is listed in the data file). */
  product: string

  name: string
  building: string

  /** Inputs and outputs in items/min per building (at speed 1). */
  inputs: ItemAmount[]
  outputs: ItemAmount[]

  /** `true` = alternate recipe, disabled by default (`alternate: true` in the file). */
  disabledByDefault?: boolean

  /**
   * MISSING RATE: the data only has per-cycle quantities, the cycle time is unknown
   * (`perCycle` in the file). Until the project sets a cycle time by hand
   * (`engine/missingData.ts › applyCycleTimes`), `inputs` / `outputs` are 0
   * (`rateFrom: 'missing'`).
   */
  perCycle?: { inputs: ItemAmount[]; outputs: ItemAmount[] }

  /**
   * Where the per-minute rate comes from. Absent: from the data (reliable).
   * `missing`: no data, the recipe computes with 0. `user`: from the cycle time the user
   * entered in the project (`cycleTime`).
   */
  rateFrom?: 'missing' | 'user'

  /** Cycle time entered by the user, in seconds (when `rateFrom` is `user`). */
  cycleTime?: number
}

/** A drone rail tier (e.g. v.1 = 120 items/min). */
export interface RailTier {
  name: string

  /** Throughput in items/min. */
  capacity: number

  /** Build cost per rail segment (informational: rail length depends on the layout). */
  cost?: ItemQuantity[]
}

/** A production target: item + desired rate. */
export interface TargetSpec {
  item: string
  rate: number
}

/**
 * Game rule switches (`features:` in `game.yml`): behaviour that may change with a game
 * patch. The code supports both variants of each rule.
 */
export interface GameFeatures {
  /**
   * `false` (default, current game behaviour): a Receiver has one Dispatcher; setting a new
   * one overrides the old one. `true`: a Receiver may have several Dispatchers (N:1).
   */
  cargoManyToOne: boolean

  /**
   * How a source's output is shared between its consumers, and a consumer's demand between
   * its sources (`engine/flow.ts`):
   * - `even` (default, observed in the game – UNCONFIRMED): consumers request from the
   *   network and every linked source serves them. A source splits its output equally
   *   between the requesters, a consumer requests equally from its sources, and surplus
   *   goes to the others (max-min fair allocation). Two smelters → one factory: 240 + 240,
   *   not 480 + 0.
   * - `optimal`: as much as possible reaches the factories (LP optimum, the original
   *   calculation): the planner routes "smartly" so nobody is short where avoidable.
   */
  flowDistribution: 'even' | 'optimal'
}

/** The complete, loaded game data. */
export interface GameData {
  title: string
  subtitle: string
  items: Item[]
  buildings: Building[]
  recipes: Recipe[]

  /** Rail tiers in ascending capacity order. Empty = no rail validation. */
  rails: RailTier[]

  /** Mining deposit purities, from worst to best. */
  purities: Purity[]

  /** Default purity id for a new mine (when the item has purities). */
  defaultPurity: string | null

  /** Game rule switches. */
  features: GameFeatures

  defaultTargets: TargetSpec[]

  /**
   * Raw content of the start project (the file named by `startProject:` in `game.yml`),
   * if any. `project/projectStore.ts` validates it and turns it into a project.
   */
  startProject: unknown
}
