/**
 * @module project/types
 *
 * Project model – what the PLAYER builds on the canvas (as opposed to the game data).
 *
 * A project consists of bases (folders / groups); every base has its own canvas. Every node
 * on the canvas belongs to the player: placed (right-click), moved, connected and deleted by
 * them. The planner only calculates:
 *
 *   - Factory: one recipe with a machine count. In automatic mode (default) the count comes
 *     from the available material: as many machines as the linked inputs can feed, rounded
 *     up (X full machines + 1 working part-time). In manual mode it runs the typed count
 *     (`count`; fractional allowed: 1.5 = one full + one half-busy machine). Inputs, outputs
 *     and power scale with the count; for power a fractional machine counts as a whole one
 *     (it is placed, it just idles part of the time).
 *   - Mine: mining building × purity × count, or a custom total output (one node may stand
 *     for all such mines).
 *   - Receiver / Dispatcher / storage / rail line (collector): transport.
 *   - Link: a node's output → another node's input, for one item. Material moves only
 *     between linked nodes.
 *
 * Two kinds of connections exist between bases:
 *   - cargo: Dispatcher → Receiver (paired by name), limited by throughput,
 *   - inter-base rail (RailLink): an "outgoing rail" node in the source base and an
 *     "incoming rail" node in the target base; may carry several items.
 *
 * The project is saved in the browser automatically (localStorage) and can be exported to /
 * imported from a JSON file. Old (v1, target-driven) projects are converted by
 * `project/sanitize.ts`.
 */
import type { Objective } from '../engine/chain'

/** Current project file format version. */
export const PROJECT_VERSION = 2

/** The whole project: bases, inter-base rails and settings. */
export interface Project {
  version: number
  name: string
  bases: Base[]

  /** Rails between bases. */
  railLinks: RailLink[]

  settings: ProjectSettings
}

/** Settings that apply to the whole project. */
export interface ProjectSettings {
  /** What "Build chain" minimises when an item has several recipes. */
  objective: Objective

  /** Name of the best available rail tier (null = the best in the data). */
  maxRailName: string | null

  /** Recipe on/off switches for the chain builder (only the differences from the defaults). */
  recipeOverrides: Record<string, boolean>

  /**
   * Cycle times entered by hand (recipe id → seconds) for recipes without a rate in the
   * data. They apply only until the data provides a reliable rate (`engine/missingData.ts`).
   */
  cycleTimes: Record<string, number>
}

/** A point on the canvas (the top-left corner of a node). */
export interface Point {
  x: number
  y: number
}

/** A base / outpost / group with its own canvas. */
export interface Base {
  id: string
  name: string
  factories: Factory[]
  mines: Mine[]
  receivers: Receiver[]
  dispatchers: Dispatcher[]
  storages: Storage[]

  /** Links between the nodes. */
  links: Link[]

  /** Rail lines: drone rails carrying several items with a capacity (nodes on the canvas). */
  railLines: RailLine[]

  /** Node id → position on the canvas. Nodes without a position are placed automatically. */
  positions: Record<string, Point>
}

/** Factory: one recipe variant (recipe + building) with a machine count. */
export interface Factory {
  id: string

  /** Recipe variant id (`data/types.ts › Recipe.id`); it also determines the building. */
  recipe: string

  /**
   * Manual machine count (fractional allowed); multiplies inputs, outputs and power.
   * In automatic mode it only applies when the factory has no linked input (there is
   * nothing to size it from).
   */
  count: number

  /**
   * Automatic machine count (default `true`): the count comes from the material reaching
   * the linked inputs (`engine/flow.ts › autoFactoryCounts`) – as many machines as it
   * feeds, rounded up, at least 1. `false` = `count` applies.
   */
  auto: boolean
}

/**
 * Mine: one mining building on one or more identical deposits, or a node that stands for
 * all such mines (custom output). A SOURCE in its base: it has no inputs.
 */
export interface Mine {
  id: string

  /** Mining building id (type: miner); an upgraded miner is a separate building. */
  building: string

  /** What it mines (from the building's `mines:` table). */
  item: string | null

  /** Deposit purity (a `purities` id of game.yml); null when the item has no purities. */
  purity: string | null

  /** Number of mining buildings (power and cost use it; fractional allowed). */
  count: number

  /**
   * Custom total output in items/min (e.g. several mines of different purity together).
   * null = `count` × the purity rate.
   */
  output: number | null
}

/**
 * Virtual counterpart of an unpaired cargo node, so the node can be calculated on its own:
 * a Dispatcher without a Receiver still takes material ("virtual receiver"), a Receiver
 * without a Dispatcher still gives material ("virtual dispatcher").
 *
 * The item is not configured here: it is the node's own item, which follows its links.
 * The setting is ignored while the node has a real counterpart.
 */
export interface VirtualCargo {
  /**
   * How much the virtual counterpart handles per minute:
   * - `rail`: the building's own limit (Dispatcher: throughput for its feed rail;
   *   Receiver: rail outputs × best available rail, unlimited without rail data),
   * - `custom`: the `rate` below.
   */
  mode: 'rail' | 'custom'

  /** Custom rate in items per minute (used when `mode` is `custom`). */
  rate: number
}

/** Cargo receiver. A SOURCE in its base: it passes on what its Dispatcher(s) send. */
export interface Receiver {
  id: string

  /** Unique name used for pairing (e.g. "R-Titanium Ore"). */
  name: string

  /** Id of a receiver-type building. */
  building: string

  /** The item it provides. It gives nothing until one is chosen (or linked). */
  item: string | null

  /** Virtual dispatcher while the Receiver has no Dispatcher (null = off). */
  virtual: VirtualCargo | null
}

/** Cargo sender. Sends one item to one Receiver, limited by its throughput. */
export interface Dispatcher {
  id: string
  name: string

  /** Id of a dispatcher-type building. */
  building: string

  item: string | null

  /** Target Receiver. Under the 1:1 rule a Receiver has one Dispatcher, under N:1 several. */
  receiverId: string | null

  /** Rail tier feeding it (determines the throughput); null = the best available. */
  feedRail: string | null

  /** Virtual receiver while the Dispatcher is not paired (null = off). */
  virtual: VirtualCargo | null
}

/**
 * Storage: one item, `count` storage buildings chained (a stack). With an outgoing link it
 * is a pass-through buffer; without one it is a sink (it fills up).
 */
export interface Storage {
  id: string
  name: string
  building: string
  item: string | null
  count: number
}

/**
 * Link: output of node `from` → input of node `to`, for one item.
 *
 * Rail: a drone rail carries several items, so all links between the same two nodes (one
 * per item) run on ONE rail (`linkRailKey`). The capacity applies to their total, and the
 * graph draws them as one line (item icons side by side, the total). Example: the branch
 * rail from a rail line to a factory carries every item the factory gets from there.
 */
export interface Link {
  id: string

  /** Node id (e.g. `fac:…`, `mine:…`, `recv:…`, `line:…`, `railin:…`). */
  from: string
  to: string

  item: string

  /**
   * Manual rail: which rails are built, as a count per tier (mixed allowed, e.g. 2× v.1 +
   * 1× v.2 + 4× v.3). Absent (or empty) = automatic: the planner chooses (as many of the
   * best tier as run full, the smallest sufficient tier for the rest) and does not limit.
   * Manual: the capacity (sum of the rails) limits all items of the rail together; what does
   * not fit never reaches the consumer (congestion, red). All links of one rail share the
   * same setting (`projectStore › setLinkRail`); if they differ, the first link's applies.
   */
  rail?: RailCount[] | null
}

/** Rail key: all links between the same two nodes run on one rail. */
export function linkRailKey(link: { from: string; to: string }): string {
  return `${link.from}>${link.to}`
}

/** One entry of a manual rail set: this many rails of this tier. */
export interface RailCount {
  /** Rail tier name; null = the best available. */
  tier: string | null

  /** Count (whole number ≥ 1). */
  count: number
}

/**
 * Rail line: a drone rail (or several in parallel) carrying several items – a collector:
 * several sources feed it, several consumers take from it. On the canvas it is a node:
 * inputs on the left (one row per item), the same items come out on the right. The capacity
 * applies to the TOTAL flow (the sum of all items).
 *
 *   - `auto` mode: the planner chooses (as many of the best tier as run full, the smallest
 *     sufficient tier for the rest) and does not limit,
 *   - `manual` mode: the total capacity of the configured rail set (count per tier, mixed
 *     allowed). What does not fit never reaches the consumers: congestion.
 */
export interface RailLine {
  id: string
  name: string
  mode: 'auto' | 'manual'

  /** Manual mode: the rails as a count per tier (e.g. 2× v.1 + 4× v.3). */
  rails: RailCount[]

  /**
   * Number of inputs (items). null = dynamic: as many as there are linked items, plus one
   * free row. A number: at most this many items.
   */
  slots: number | null
}

/** A rail from one base to another. May carry several items. */
export interface RailLink {
  id: string
  name: string
  from: string
  to: string
  items: string[]
}

// ============================================================================
// Node ids – saved projects (links, positions) refer to them, so they MUST NOT change.
// ============================================================================

/** Builds the canvas node id of an entity (persisted in links and positions). */
export const nodeIds = {
  factory: (id: string) => `fac:${id}`,
  mine: (id: string) => `mine:${id}`,
  receiver: (id: string) => `recv:${id}`,
  dispatcher: (id: string) => `disp:${id}`,
  storage: (id: string) => `store:${id}`,
  railIn: (linkId: string) => `railin:${linkId}`,
  railOut: (linkId: string) => `railout:${linkId}`,
  line: (id: string) => `line:${id}`,
}

/** Splits a node id into its kind prefix and the entity id. */
export function parseNodeId(nodeId: string): { prefix: string; id: string } {
  const i = nodeId.indexOf(':')

  return i < 0
    ? { prefix: nodeId, id: '' }
    : { prefix: nodeId.slice(0, i), id: nodeId.slice(i + 1) }
}

/** A short unique id for new elements. */
export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

/** A new, empty base. */
export function emptyBase(name: string): Base {
  return {
    id: newId('base'),
    name,
    factories: [],
    mines: [],
    receivers: [],
    dispatchers: [],
    storages: [],
    links: [],
    railLines: [],
    positions: {},
  }
}

/** Default project settings. */
export function defaultSettings(): ProjectSettings {
  return {
    objective: 'buildings',
    maxRailName: null,
    recipeOverrides: {},
    cycleTimes: {},
  }
}
