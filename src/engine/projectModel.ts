/**
 * @module engine/projectModel
 *
 * Project → calculation model.
 *
 * Turns the project (nodes and links of the bases, cargo pairs, inter-base rails) into a
 * simple model that the flow calculation (`flow.ts`) and the graph plan (`plan.ts`) work
 * with:
 *   - nodes with ports: a port is one item's input or output; for factories and mines with
 *     the NOMINAL rate (machine count × per-machine rate); automatic factories use their
 *     calculated count ({@link buildSizedModel}),
 *   - links (from the project's `links`, without the invalid ones),
 *   - rails: all links between the same two nodes (one per item) run on ONE drone rail
 *     (`ModelRail`); a manual rail's capacity applies to their total,
 *   - transfers: cargo pairs (Dispatcher → Receiver) and inter-base rails per item,
 *   - virtual cargo counterparts of unpaired Dispatchers / Receivers (`ModelNode.virtualCargo`).
 *
 * CARGO: a Dispatcher sends to one Receiver. How many Dispatchers a Receiver may have is a
 * game rule (`features.cargoManyToOne` in game.yml, here: {@link CargoRules}):
 *   - 1:1 (default, current game behaviour): only the first Dispatcher per Receiver counts;
 *     the others are "overridden" (`overriddenDispatchers`) and send nothing,
 *   - N:1: all count, their throughputs add up.
 * A cargo pair within one base works too (local transport). A Dispatcher's throughput
 * depends on its feed rail tier: the chosen one (`feedRail`), or when automatic, the tier
 * of the manual rail of its incoming link (`attachedFeedRail`), otherwise the best available.
 */
import { EPSILON } from '../config'
import type { Building, RailTier, Recipe } from '../data/types'
import type {
  Base,
  Dispatcher,
  Factory,
  Mine,
  Project,
  RailCount,
  RailLine,
  Receiver,
  Storage,
  VirtualCargo,
} from '../project/types'
import { linkRailKey, nodeIds } from '../project/types'
import { dispatcherThroughput, receiverOutputLimit } from './cargo'
import { autoFactoryCounts, type FlowOptions } from './flow'
import { netRatesPerBuilding, type GameIndex } from './gameIndex'
import { mineRate } from './mining'
import { manualLineCapacity, manualRailCapacity } from './rails'

/** Node kinds. The graph picks the node component by kind. */
export type NodeKind =
  | 'factory' // one recipe with a machine count
  | 'mine' // source
  | 'receiver' // cargo receiver: source (what its Dispatchers send)
  | 'dispatcher' // cargo sender: its input goes to its pair
  | 'storage' // pass-through buffer, or sink
  | 'railIn' // incoming inter-base rail: source
  | 'railOut' // outgoing inter-base rail: consumer
  | 'line' // rail line: several items on one rail, with a capacity

/** Resolved virtual counterpart of an unpaired cargo node (`ModelNode.virtualCargo`). */
export interface ModelVirtualCargo {
  /** `rail`: limit from the building and rails; `custom`: the user's rate. */
  mode: VirtualCargo['mode']

  /** Upper bound in items/min; null = unlimited (Receiver without rail data). */
  capacity: number | null
}

/** Machine count mode of a factory (`ModelNode.countMode`). */
export type CountMode = 'manual' | 'auto' | 'auto-fallback'

/** One item port of a node. */
export interface ModelPort {
  item: string

  /**
   * Nominal rate in items/min: for factories and mines machine count × per-machine rate
   * (what it makes / requests). Null for pass-through nodes: the flow decides.
   */
  nominal: number | null

  /** Per-machine rate (factory, mine). */
  perBuilding?: number
}

/** The project entity behind a model node. */
export type NodeRef =
  | { type: 'factory'; factory: Factory }
  | { type: 'mine'; mine: Mine; purity: string | null; perBuilding: number }
  | { type: 'receiver'; receiver: Receiver }
  | { type: 'dispatcher'; dispatcher: Dispatcher }
  | { type: 'storage'; storage: Storage }
  | { type: 'railIn' | 'railOut'; linkId: string }
  | { type: 'line'; line: RailLine }

/** A node of the calculation model. */
export interface ModelNode {
  id: string
  baseId: string
  kind: NodeKind
  title: string
  building?: Building
  recipe?: Recipe

  /** Machine count (factory, mine), stack size for storages; 1 otherwise. Automatic factory: the calculated one. */
  count: number

  /**
   * Machine count mode of a factory: `manual` = the typed count; `auto` = calculated from
   * the material reaching the linked inputs (`flow.ts › autoFactoryCounts`); `auto-fallback`
   * = automatic, but there is nothing to size from (no linked input, no rate), so the typed
   * count is used.
   */
  countMode?: CountMode

  inputs: ModelPort[]
  outputs: ModelPort[]
  ref: NodeRef

  /**
   * Unpaired Dispatcher / Receiver with a virtual counterpart (`VirtualCargo`): the node
   * takes (Dispatcher) or gives (Receiver) its item on its own, up to `capacity` items/min
   * (null = unlimited). Absent when the node has a real counterpart or the setting is off.
   */
  virtualCargo?: ModelVirtualCargo

  /** Receiver: upper bound of the output (rail outputs × best rail), when known. */
  outputLimit?: number | null

  /** Manual rail line: upper bound of the total flow. Null for an automatic line. */
  capacity?: number | null

  /** Set when something is wrong (e.g. the recipe no longer exists in the data). */
  problem?: string
}

/** A valid link of the model. */
export interface ModelLink {
  id: string
  baseId: string
  from: string
  to: string
  item: string

  /** The rail it runs on (`ModelRail.key`): links between the same two nodes share one rail. */
  rail: string
}

/**
 * A drone rail between two nodes: every link between them (one per item) runs on it. For a
 * manual rail (`Link.rail`) the capacity limits their total.
 */
export interface ModelRail {
  key: string
  baseId: string
  from: string
  to: string

  /** Ids of the links on the rail (in link order). */
  links: string[]

  /** Manual setting (of the first configured link of the rail), or null = automatic. */
  setting: RailCount[] | null

  /** Capacity of a manual rail, or null = automatic (no limit). */
  capacity: number | null
}

/** A transfer between two nodes (possibly in two bases). */
export interface ModelTransfer {
  id: string
  kind: 'cargo' | 'rail'

  /** Sending node (Dispatcher or outgoing rail) and receiving node (Receiver or incoming rail). */
  from: string
  to: string

  item: string

  /** Upper bound (cargo: the Dispatcher's throughput). None for rails (informational only). */
  capacity?: number
}

/** The complete calculation model of a project. */
export interface ProjectModel {
  nodes: Map<string, ModelNode>
  byBase: Map<string, ModelNode[]>
  links: ModelLink[]

  /** Rails (key: `linkRailKey`) – groups of links per node pair. */
  rails: Map<string, ModelRail>

  transfers: ModelTransfer[]

  /** Invalid links (link id → reason). They are ignored. */
  invalidLinks: Map<string, string>

  /**
   * The even flow of the automatic sizing (link id → items/min), set by
   * {@link buildSizedModel}. With the calculated counts the even distribution is the same
   * (rounding up does not limit), so the flow calculation verifies and reuses it instead of
   * recomputing it round by round (`flow.ts › solveFairPart`).
   */
  flowHint?: ReadonlyMap<string, number>
}

/** Cargo transfer id of a Dispatcher. */
export const cargoTransferId = (dispatcherId: string) => `c:${dispatcherId}`

/** Inter-base rail transfer id of one item. */
export const railTransferId = (linkId: string, item: string) => `l:${linkId}:${item}`

/** Cargo pairing rule (`features.cargoManyToOne` in game.yml). */
export interface CargoRules {
  /** `true`: a Receiver may have several Dispatchers (N:1); `false`: 1:1. */
  manyToOne: boolean
}

/** An effective cargo pairing. */
export interface CargoLink {
  dispatcher: Dispatcher
  dispatcherBase: Base
  receiver: Receiver
  receiverBase: Base
}

/** Every paired Dispatcher with its Receiver, by the rule (without the overridden ones). */
export function cargoLinks(project: Project, rules: CargoRules): CargoLink[] {
  return collectLinks(project, rules).active
}

/**
 * Under the 1:1 rule: the Dispatchers whose Receiver was already claimed by an earlier
 * Dispatcher (e.g. from an old project saved under N:1).
 *
 * @returns Dispatcher id → the pairing that actually uses the Receiver
 */
export function overriddenDispatchers(project: Project, rules: CargoRules): Map<string, CargoLink> {
  return collectLinks(project, rules).overridden
}

function collectLinks(project: Project, rules: CargoRules) {
  const receivers = new Map<string, { receiver: Receiver; base: Base }>()

  for (const base of project.bases)
    for (const r of base.receivers) receivers.set(r.id, { receiver: r, base })

  const active: CargoLink[] = []
  const overridden = new Map<string, CargoLink>()
  const claimed = new Map<string, CargoLink>() // receiver id → the first (valid) pairing

  for (const base of project.bases) {
    for (const d of base.dispatchers) {
      const target = d.receiverId ? receivers.get(d.receiverId) : undefined

      if (!target) continue

      const link = {
        dispatcher: d,
        dispatcherBase: base,
        receiver: target.receiver,
        receiverBase: target.base,
      }
      const first = claimed.get(target.receiver.id)

      if (first && !rules.manyToOne) {
        overridden.set(d.id, first)
        continue
      }

      if (!first) claimed.set(target.receiver.id, link)

      active.push(link)
    }
  }

  return { active, overridden }
}

/** Receiver id → its Dispatchers (at most one under the 1:1 rule). */
export function dispatchersByReceiver(
  project: Project,
  rules: CargoRules,
): Map<string, CargoLink[]> {
  const map = new Map<string, CargoLink[]>()

  for (const link of cargoLinks(project, rules)) {
    const list = map.get(link.receiver.id) ?? []

    list.push(link)
    map.set(link.receiver.id, list)
  }

  return map
}

/**
 * The tier of the manual rail of the links entering a Dispatcher (the best of several),
 * or null when there is none (automatic rail, or "best available" tier).
 */
export function attachedFeedRail(
  project: Project,
  d: Dispatcher,
  rails: readonly RailTier[],
): string | null {
  const id = nodeIds.dispatcher(d.id)
  const base = project.bases.find((b) => b.dispatchers.some((x) => x.id === d.id))
  let best: RailTier | null = null

  for (const l of base?.links ?? []) {
    if (l.to !== id || !l.rail?.length) continue

    for (const r of l.rail) {
      // A rail without a tier (best available) is the best available tier.
      const tier = r.tier ? rails.find((t) => t.name === r.tier) : rails[rails.length - 1]

      if (tier && (!best || tier.capacity > best.capacity)) best = tier
    }
  }

  return best?.name ?? null
}

/**
 * Throughput of a Dispatcher. The feed rail: the chosen one (`feedRail`); when automatic,
 * the tier of the manual rail of its incoming link; otherwise the best available.
 * `fromLink`: the feed rail comes from the link's manual rail.
 */
export function dispatcherRate(
  index: GameIndex,
  project: Project,
  d: Dispatcher,
  rails: readonly RailTier[],
) {
  const attached = d.feedRail ? null : attachedFeedRail(project, d, rails)
  const info = dispatcherThroughput(index.building(d.building), d.feedRail ?? attached, rails)

  return { ...info, fromLink: !!attached && info.feedRail === attached }
}

/**
 * Ports of a factory: net rate per machine × machine count (catalysts are merged).
 *
 * A recipe with a missing rate (no data, `engine/missingData.ts`) keeps its ports with a
 * rate of 0: the factory produces nothing until it has a cycle time.
 */
export function factoryPorts(
  recipe: Recipe,
  building: Building,
  count: number,
): { inputs: ModelPort[]; outputs: ModelPort[] } {
  if (recipe.rateFrom === 'missing' && recipe.perCycle) {
    const zero = (item: string): ModelPort => ({ item, nominal: 0, perBuilding: 0 })

    return {
      inputs: recipe.perCycle.inputs.map((x) => zero(x.item)),
      outputs: recipe.perCycle.outputs.map((x) => zero(x.item)),
    }
  }

  const net = netRatesPerBuilding(recipe, building)
  const order = [...new Set([...recipe.inputs, ...recipe.outputs].map((x) => x.item))]
  const inputs: ModelPort[] = []
  const outputs: ModelPort[] = []

  for (const item of order) {
    const v = net.get(item) ?? 0

    if (v < -EPSILON) inputs.push({ item, nominal: -v * count, perBuilding: -v })
    else if (v > EPSILON) outputs.push({ item, nominal: v * count, perBuilding: v })
  }

  // The main product is the first output.
  outputs.sort((a, b) => Number(b.item === recipe.product) - Number(a.item === recipe.product))

  return { inputs, outputs }
}

/** Per-building rate and total output of a mine (custom, or count × rate). */
export function mineOutput(index: GameIndex, mine: Mine) {
  const building = index.building(mine.building)
  const rate = mineRate(index.data, building, mine)
  const total = mine.output !== null ? mine.output : mine.count * rate.perBuilding

  return { building, ...rate, total }
}

/**
 * Builds the model of a project.
 *
 * @param rails      the available rail tiers (Dispatcher throughput, Receiver output limit)
 * @param autoCounts calculated counts of automatic factories (node id → count,
 *                   `flow.ts › autoFactoryCounts`); factories not in it use their typed count
 *                   (`auto-fallback`)
 */
export function buildModel(
  index: GameIndex,
  project: Project,
  rails: readonly RailTier[],
  rules: CargoRules,
  autoCounts?: ReadonlyMap<string, number>,
): ProjectModel {
  const nodes = new Map<string, ModelNode>()
  const byBase = new Map<string, ModelNode[]>()

  const add = (n: ModelNode) => {
    nodes.set(n.id, n)
    byBase.get(n.baseId)!.push(n)
  }

  for (const base of project.bases) {
    byBase.set(base.id, [])
    addBaseNodes(index, base, rails, autoCounts, add)
  }

  // Inter-base rails: outgoing in the source base, incoming in the target base.
  for (const link of project.railLinks) {
    if (link.from === link.to || !byBase.has(link.from) || !byBase.has(link.to)) continue

    const ports = link.items.map((item) => ({ item, nominal: null }))

    add({
      id: nodeIds.railOut(link.id),
      baseId: link.from,
      kind: 'railOut',
      title: link.name,
      count: 0,
      inputs: ports,
      outputs: [],
      ref: { type: 'railOut', linkId: link.id },
    })
    add({
      id: nodeIds.railIn(link.id),
      baseId: link.to,
      kind: 'railIn',
      title: link.name,
      count: 0,
      inputs: [],
      outputs: ports.map((p) => ({ ...p })),
      ref: { type: 'railIn', linkId: link.id },
    })
  }

  const { links, railMap, invalidLinks } = collectModelLinks(project, nodes, rails)

  // Transfers: cargo pairs and inter-base rails.
  const transfers: ModelTransfer[] = []
  const pairs = cargoLinks(project, rules)

  applyVirtualCargo(index, project, rails, rules, pairs, nodes)

  for (const c of pairs) {
    const item = c.receiver.item ?? c.dispatcher.item

    if (!item || (c.dispatcher.item && c.dispatcher.item !== item)) continue

    transfers.push({
      id: cargoTransferId(c.dispatcher.id),
      kind: 'cargo',
      from: nodeIds.dispatcher(c.dispatcher.id),
      to: nodeIds.receiver(c.receiver.id),
      item,
      capacity: dispatcherRate(index, project, c.dispatcher, rails).rate,
    })
  }

  for (const link of project.railLinks) {
    if (!nodes.has(nodeIds.railOut(link.id))) continue

    for (const item of link.items) {
      transfers.push({
        id: railTransferId(link.id, item),
        kind: 'rail',
        from: nodeIds.railOut(link.id),
        to: nodeIds.railIn(link.id),
        item,
      })
    }
  }

  return { nodes, byBase, links, rails: railMap, transfers, invalidLinks }
}

/** Adds the model nodes of one base (everything except inter-base rail ends). */
function addBaseNodes(
  index: GameIndex,
  base: Base,
  rails: readonly RailTier[],
  autoCounts: ReadonlyMap<string, number> | undefined,
  add: (n: ModelNode) => void,
): void {
  for (const f of base.factories) {
    const recipe = index.recipe(f.recipe)
    const id = nodeIds.factory(f.id)
    const auto = f.auto ? autoCounts?.get(id) : undefined
    const count = auto ?? f.count
    const countMode: CountMode = !f.auto ? 'manual' : auto !== undefined ? 'auto' : 'auto-fallback'

    if (!recipe) {
      add({
        id,
        baseId: base.id,
        kind: 'factory',
        title: `? ${f.recipe}`,
        count,
        countMode,
        inputs: [],
        outputs: [],
        ref: { type: 'factory', factory: f },
        problem: 'This recipe no longer exists in the data',
      })
      continue
    }

    const building = index.building(recipe.building)

    add({
      id,
      baseId: base.id,
      kind: 'factory',
      title: recipe.name,
      building,
      recipe,
      count,
      countMode,
      ...factoryPorts(recipe, building, count),
      ref: { type: 'factory', factory: f },
    })
  }

  for (const m of base.mines) {
    const out = mineOutput(index, m)
    const produces = m.item && (out.perBuilding > 0 || m.output !== null)

    add({
      id: nodeIds.mine(m.id),
      baseId: base.id,
      kind: 'mine',
      title: m.item ? index.item(m.item).name : out.building.name,
      building: out.building,
      count: m.count,
      inputs: [],
      outputs: produces
        ? [{ item: m.item!, nominal: out.total, perBuilding: out.perBuilding }]
        : [],
      ref: { type: 'mine', mine: m, purity: out.purity, perBuilding: out.perBuilding },
      problem: out.problem ?? undefined,
    })
  }

  for (const r of base.receivers) {
    const building = index.building(r.building)

    add({
      id: nodeIds.receiver(r.id),
      baseId: base.id,
      kind: 'receiver',
      title: r.name,
      building,
      count: 1,
      inputs: [],
      outputs: r.item ? [{ item: r.item, nominal: null }] : [],
      ref: { type: 'receiver', receiver: r },
      outputLimit: receiverOutputLimit(building, rails),
    })
  }

  for (const d of base.dispatchers) {
    add({
      id: nodeIds.dispatcher(d.id),
      baseId: base.id,
      kind: 'dispatcher',
      title: d.name,
      building: index.building(d.building),
      count: 1,
      inputs: d.item ? [{ item: d.item, nominal: null }] : [],
      outputs: [],
      ref: { type: 'dispatcher', dispatcher: d },
    })
  }

  for (const s of base.storages) {
    const ports = s.item ? [{ item: s.item, nominal: null }] : []

    add({
      id: nodeIds.storage(s.id),
      baseId: base.id,
      kind: 'storage',
      title: s.name,
      building: index.building(s.building),
      count: s.count,
      inputs: ports,
      outputs: ports.map((p) => ({ ...p })),
      ref: { type: 'storage', storage: s },
    })
  }

  // Rail line: its items in link order (input = output, in the same row).
  for (const line of base.railLines) {
    const id = nodeIds.line(line.id)
    const items = [
      ...new Set(base.links.filter((l) => l.to === id || l.from === id).map((l) => l.item)),
    ]

    add({
      id,
      baseId: base.id,
      kind: 'line',
      title: line.name,
      count: 0,
      inputs: items.map((item) => ({ item, nominal: null })),
      outputs: items.map((item) => ({ item, nominal: null })),
      ref: { type: 'line', line },
      capacity: manualLineCapacity(line, rails),
    })
  }
}

/**
 * Validates the links (only within a base, between existing ports) and groups them into
 * rails: all links between the same two nodes run on one rail (several items on one rail).
 */
function collectModelLinks(
  project: Project,
  nodes: ReadonlyMap<string, ModelNode>,
  rails: readonly RailTier[],
) {
  const links: ModelLink[] = []
  const railMap = new Map<string, ModelRail>()
  const invalidLinks = new Map<string, string>()

  for (const base of project.bases) {
    for (const l of base.links) {
      const from = nodes.get(l.from)
      const to = nodes.get(l.to)
      let problem: string | null = null

      if (!from || !to || from.baseId !== base.id || to.baseId !== base.id) {
        problem = 'the node does not exist in this base'
      } else if (!from.outputs.some((p) => p.item === l.item)) {
        problem = `${from.title} does not provide this item`
      } else if (!to.inputs.some((p) => p.item === l.item)) {
        problem = `${to.title} does not accept this item`
      } else if (l.from === l.to) {
        problem = 'points to itself'
      }

      if (problem) {
        invalidLinks.set(l.id, problem)
        continue
      }

      const key = linkRailKey(l)
      let rail = railMap.get(key)

      if (!rail) {
        rail = {
          key,
          baseId: base.id,
          from: l.from,
          to: l.to,
          links: [],
          setting: null,
          capacity: null,
        }
        railMap.set(key, rail)
      }

      rail.links.push(l.id)

      if (!rail.setting && l.rail?.length) {
        rail.setting = l.rail
        rail.capacity = manualRailCapacity(l.rail, rails)
      }

      links.push({ id: l.id, baseId: base.id, from: l.from, to: l.to, item: l.item, rail: key })
    }
  }

  return { links, railMap, invalidLinks }
}

/**
 * Resolves the virtual counterparts of unpaired cargo nodes (`VirtualCargo`) onto their
 * model nodes (`ModelNode.virtualCargo`).
 *
 * A node qualifies when the setting is on, it has an item, and it has no real counterpart:
 * a Dispatcher that is neither paired nor overridden by the 1:1 rule (an overridden one
 * targets a Receiver on purpose, it just does not send), and a Receiver without any
 * Dispatcher.
 *
 * Capacity in `rail` mode: the Dispatcher's throughput for its feed rail
 * (`dispatcherRate`), or the Receiver's output limit (rail outputs × best rail; unlimited
 * without rail data). In `custom` mode: the user's rate.
 */
function applyVirtualCargo(
  index: GameIndex,
  project: Project,
  rails: readonly RailTier[],
  rules: CargoRules,
  pairs: readonly CargoLink[],
  nodes: ReadonlyMap<string, ModelNode>,
): void {
  const pairedDispatchers = new Set(pairs.map((c) => c.dispatcher.id))
  const pairedReceivers = new Set(pairs.map((c) => c.receiver.id))
  const overridden = overriddenDispatchers(project, rules)

  for (const base of project.bases) {
    for (const d of base.dispatchers) {
      const node = nodes.get(nodeIds.dispatcher(d.id))
      const unpaired = !pairedDispatchers.has(d.id) && !overridden.has(d.id)

      if (!node || !d.virtual || !d.item || !unpaired) continue

      node.virtualCargo = {
        mode: d.virtual.mode,
        capacity:
          d.virtual.mode === 'custom'
            ? d.virtual.rate
            : dispatcherRate(index, project, d, rails).rate,
      }
    }

    for (const r of base.receivers) {
      const node = nodes.get(nodeIds.receiver(r.id))

      if (!node || !r.virtual || !r.item || pairedReceivers.has(r.id)) continue

      node.virtualCargo = {
        mode: r.virtual.mode,
        capacity: r.virtual.mode === 'custom' ? r.virtual.rate : (node.outputLimit ?? null),
      }
    }
  }
}

/**
 * The model with the calculated counts of the automatic factories (the flow, the plan and
 * balancing all work with it).
 *
 * Two steps: sizing from the model built with the typed counts (`flow.ts ›
 * autoFactoryCounts`), then the model again with the calculated counts (when there is an
 * automatic factory that can be sized).
 */
export function buildSizedModel(
  index: GameIndex,
  project: Project,
  rails: readonly RailTier[],
  rules: CargoRules,
  options?: FlowOptions,
): ProjectModel {
  const plain = buildModel(index, project, rails, rules)
  const { counts, flowHint } = autoFactoryCounts(plain, options)

  if (!counts.size) return plain

  return { ...buildModel(index, project, rails, rules, counts), flowHint }
}

/** Rail line: whether it still has a free input for a new item. */
export function lineHasFreeSlot(node: ModelNode): boolean {
  return (
    node.ref.type === 'line' &&
    (node.ref.line.slots === null || node.inputs.length < node.ref.line.slots)
  )
}

/** Whether the node accepts (or can be set up to accept) an item on its input. */
export function canAcceptInput(node: ModelNode, item: string): boolean {
  if (node.inputs.some((p) => p.item === item)) return true

  switch (node.kind) {
    case 'line':
      return lineHasFreeSlot(node)
    case 'railOut':
      return true
    case 'dispatcher':
    case 'storage':
      return node.inputs.length === 0 // no item yet: the link sets it
    default:
      return false
  }
}

/** Whether the node provides (or can be set up to provide) an item on its output. */
export function canProvideOutput(node: ModelNode, item: string): boolean {
  if (node.outputs.some((p) => p.item === item)) return true

  switch (node.kind) {
    case 'line':
      return lineHasFreeSlot(node)
    case 'receiver':
    case 'storage':
      return node.outputs.length === 0
    default:
      return false
  }
}
