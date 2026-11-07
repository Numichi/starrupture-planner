/**
 * @module engine/plan
 *
 * Base plan – the drawable graph of one base, from the model and the flow.
 *
 * Input: game data + project + model (`projectModel.ts`) + flow (`flow.ts`).
 * Output: {@link ProductionPlan}:
 *   - nodes: factories, mines, Receivers / Dispatchers, storages, rail lines, incoming /
 *     outgoing inter-base rails,
 *   - ports on every node (a port is one item's input or output) with the nominal rate,
 *     the actual incoming / outgoing flow and the shortage / remainder,
 *   - edges: the links with their flow and drone rail; all links between the same two
 *     nodes run on ONE rail (`linkRails`: several items on one rail, capacity on the total;
 *     e.g. the branch rail from a rail line to a factory carries every item the factory
 *     gets from there),
 *   - summary: buildings, power, minimum build cost, shortages, end products, surplus, rails.
 *
 * Coordinates are NOT decided here: node positions are in the project (`Base.positions`),
 * edge routes are computed by `layout.ts`.
 */
import { EPSILON, POWER_USES_ROUNDED_COUNT } from '../config'
import type { Building, ItemQuantity, RailTier, Recipe } from '../data/types'
import type {
  Dispatcher,
  Mine,
  Project,
  RailLine,
  RailLink,
  Receiver,
  Storage,
} from '../project/types'
import { nodeIds } from '../project/types'
import type { DispatcherRate } from './cargo'
import { lineTolerance, portKey, railTotal, type FlowResult } from './flow'
import { formatRate } from './format'
import type { GameIndex } from './gameIndex'
import {
  cargoTransferId,
  dispatcherRate,
  dispatchersByReceiver,
  overriddenDispatchers,
  railTransferId,
  type CargoLink,
  type CargoRules,
  type CountMode,
  type ModelNode,
  type NodeKind,
  type ProjectModel,
} from './projectModel'
import { chooseRail, lineRail, linkRail, type RailChoice } from './rails'
import { upgradeOptions } from './upgrades'

/** Node kinds of the plan (same as the model's). */
export type PlanNodeKind = NodeKind

/** One item port of a plan node. */
export interface PlanPort {
  /** Port key (`flow.ts › portKey`): `<node>|in|<item>` / `|out|`. */
  id: string

  item: string

  /** Factory and mine: the nominal rate (count × rate); pass-through nodes: the flow. */
  rate: number

  /**
   * Factory: the EFFECTIVE rate = effective machine count × per-machine rate. When a linked
   * input makes the factory work less, it is below the nominal rate (output: what is made;
   * input: what it takes).
   */
  effective?: number

  /** Factory, mine: the rate of one machine. */
  perBuilding?: number

  /** The actual flow coming in / going out over the links. */
  flow: number

  /**
   * Input: what is missing from the nominal rate and the sources could not make up (the
   * bottleneck; for an unlinked input the full nominal rate). Output: what remains of the
   * effective production (linked output: surplus; unlinked: the product itself).
   * 0 for pass-through nodes.
   */
  gap: number

  /**
   * On the tight linked input of an automatically sized factory: what the rounded-up
   * count does not get (the last, part-time machine) and the sources would not give
   * either. Not a shortage – `gap` is 0 then. Only when the factory gets something (getting
   * nothing is a shortage).
   */
  partial?: number

  /** Whether the port has a link. */
  linked: boolean
}

/** Virtual counterpart of an unpaired cargo node as shown in the plan. */
export interface PlanVirtualCargo {
  /** `rail`: limit from the building and rails; `custom`: the user's rate. */
  mode: 'rail' | 'custom'

  /** Upper bound in items/min; null = unlimited. */
  capacity: number | null

  /** What the virtual counterpart takes (Dispatcher) or gives (Receiver), items/min. */
  flow: number
}

/** The other side of a cargo pairing (possibly in another base). */
export interface PairInfo {
  id: string
  name: string
  baseId: string
  baseName: string

  /** Node id of the pair in the graph of its own base. */
  nodeId: string

  sameBase: boolean
}

/** Extra data of the special nodes (the component formats it). */
export type SpecialInfo =
  | {
      type: 'mine'
      mine: Mine

      /** Name of the purity used (null: the item has no purities, or custom output). */
      purityName: string | null

      /** Items/min per building. */
      perBuilding: number

      /** Total output (nominal). */
      total: number

      /** The part taken away by links. */
      used: number
    }
  | {
      type: 'receiver'
      receiver: Receiver

      /** Its Dispatchers (N:1: may be several). */
      pairs: PairInfo[]

      received: number

      /** Upper bound of the output (rail outputs × best rail), when known. */
      outputLimit: number | null

      /** Virtual dispatcher while unpaired (null = off or paired). */
      virtual: PlanVirtualCargo | null
    }
  | {
      type: 'dispatcher'
      dispatcher: Dispatcher
      pair: PairInfo | null
      sent: number

      /** Throughput, items/min (`engine/cargo.ts`). */
      throughput: number

      /** Throughput and feed rail; `fromLink`: the feed rail comes from the incoming link's manual rail. */
      rateInfo: DispatcherRate & { fromLink: boolean }

      /** How many Dispatchers send to the same Receiver (including this one). */
      siblings: number

      /** Virtual receiver while unpaired (null = off or paired). */
      virtual: PlanVirtualCargo | null
    }
  | {
      type: 'storage'
      storage: Storage
      unitCapacity: number
      capacity: number
      inflow: number

      /** `true`: no outgoing link, a sink (it fills up). */
      sink: boolean

      /** What moves on (pass-through storage). */
      outflow: number

      /** What accumulates: in − out (a sink: the whole inflow). */
      excess: number

      /**
       * State: `balanced` = gives what it gets; `positive` = more goes in than out (the
       * excess accumulates); `sink` = no outgoing link (it fills up).
       */
      state: 'balanced' | 'positive' | 'sink'

      /** Minutes until full (when it accumulates and the capacity is known); otherwise null. */
      fullInMinutes: number | null

      /** The outgoing manual rail is full: that is why nothing more moves on. */
      outRailFull: boolean
    }
  | {
      type: 'railIn' | 'railOut'
      link: RailLink
      otherBaseId: string
      otherBaseName: string
      total: number
    }
  | {
      type: 'line'
      line: RailLine

      /** Total flow (all items together). */
      total: number

      /** What would pass without a limit (manual mode when full; otherwise = total). */
      demand: number

      rail: RailChoice | null

      /** Manual mode: more is requested than the rail lets through. */
      congested: boolean
    }

/** A node of the base plan. */
export interface PlanNode {
  id: string
  kind: PlanNodeKind
  title: string
  recipe?: Recipe
  building?: Building

  /** Machine count (factory, mine), stack for storages; 0 for virtual nodes. Automatic factory: the calculated one. */
  count: number

  /** Factory: the count mode (manual / automatic / automatic without anything to size from). */
  countMode?: CountMode

  /** Buildings to place (rounded up). */
  placed: number

  /** Total power draw (a fractional machine counts as a whole one). */
  power: number

  inputs: PlanPort[]
  outputs: PlanPort[]

  /** Rail for the total flow (rail line, inter-base rail). */
  rail?: RailChoice | null

  special?: SpecialInfo

  /** Red warning on the node. */
  warning?: string

  /** Number of footer lines, when it differs from the kind's default. */
  footerLines?: number

  /** Empty item rows below the ports (free inputs of a rail line). */
  freeRows?: number

  /** Whether it has an upgraded or base variant (factory, mine). */
  upgradable?: boolean

  /** Factory: effective machine count (what it can actually work, given its inputs). */
  effectiveCount?: number

  /** Factory: utilisation, effective / set count (0–1). */
  utilization?: number
}

/**
 * A drone rail between two nodes: every link between them (one per item) runs on it, the
 * capacity applies to the total.
 */
export interface PlanRail {
  /** `ModelRail.key` (`project/types.ts › linkRailKey`). */
  key: string

  from: string
  to: string

  /** The links on the rail (one per item). */
  links: string[]

  items: string[]

  /** Total flow (all items together). */
  total: number

  /** What would pass without a limit (manual rail when full; otherwise = total). */
  demand: number

  /** The rail: automatic or manual (null: no rail data, or automatic without flow). */
  choice: RailChoice | null
}

/** An edge of the plan (one link). */
export interface PlanEdge {
  id: string

  /** Id of the project link (Link). */
  linkId: string

  from: string
  fromPort: string
  to: string
  toPort: string
  item: string
  rate: number

  /**
   * The link's drone rail (the rail between the two nodes, `PlanRail.choice`): automatic
   * (tier × count needed) or manual (`Link.rail`; `congested` when it cannot carry the
   * demand). Null: no rail data, or no flow (automatic).
   */
  rail: RailChoice | null

  /** Rail key (`PlanRail.key`): shared by the links between the same two nodes. */
  railKey: string

  /** Total flow of the rail (all its items). */
  railTotal: number

  /** Number of items on this rail. */
  railItems: number

  /** What would pass on the rail without a limit (manual rail when full; otherwise = railTotal). */
  demand: number
}

/** An item with a rate. */
export interface ItemRate {
  item: string
  rate: number
}

/** A shortage on a node input. */
export interface Shortage {
  nodeId: string
  title: string
  item: string
  rate: number

  /** `true`: linked but too little arrives; `false`: not linked. */
  linked: boolean
}

/** Building totals of the plan. */
export interface BuildingSummary {
  building: Building

  /** Exact (fractional) building count. */
  count: number

  /** Rounded up per node and summed: what has to be placed. */
  roundedCount: number

  power: number
}

/** Rail segments needed per tier. */
export interface RailSummary {
  tier: RailTier

  /** Number of rail segments of this tier. */
  lines: number
}

/** Options of {@link buildBasePlan}. */
export interface PlanOptions {
  /** Cargo pairing rule (1:1 or N:1, game.yml features). */
  cargo: CargoRules

  /** The available rail tiers in ascending capacity order. */
  rails: readonly RailTier[]
}

/** The plan of one base. */
export interface ProductionPlan {
  status: 'optimal' | 'empty' | 'error'
  message?: string
  nodes: PlanNode[]
  edges: PlanEdge[]

  /** The rails of the links (one per node pair, with several items). */
  linkRails: PlanRail[]

  summary: {
    buildings: BuildingSummary[]
    totalCount: number
    totalRounded: number
    totalPower: number

    /** Shortages on factory inputs (linked but too little, or unlinked). */
    shortages: Shortage[]

    /** End products: unlinked outputs, and what goes into storage (sinks). */
    products: ItemRate[]

    /** Surplus: production remaining on a linked output. */
    surplus: ItemRate[]

    rails: RailSummary[]

    /** Automatic rails that need parallel rails (one rail is not enough; a hint, not an error). */
    parallel: number

    /** Congested manual rails (rail line + link): the configured capacity is below the demand. */
    congested: number

    /** Of these: congested rail lines. */
    congestedLines: number

    /** Of these: congested manual rails between two nodes (link rails). */
    congestedLinks: number

    /**
     * Minimum build cost: buildings to place (rounded up) × cost per building. Rails are not
     * included (their length depends on the layout).
     */
    buildCost: ItemQuantity[]

    /** Buildings in the plan without a cost (so `buildCost` is incomplete). */
    unknownCost: Building[]
  }
}

/**
 * A shortage / remainder when significant: tiny differences from rounding and floating-point
 * arithmetic (e.g. 0.0004 /min) are not shortages.
 */
function significant(diff: number, nominal: number): number {
  return diff > Math.max(1e-3, Math.abs(nominal) * 1e-6) ? diff : 0
}

/** Rounds up, ignoring floating-point noise (20.0000001). */
export function roundUpCount(count: number): number {
  return Math.max(0, Math.ceil(count - 1e-6))
}

/** Building count used for power: a fractional machine counts as a whole one (placed, just idle). */
export function powerCount(count: number): number {
  return POWER_USES_ROUNDED_COUNT ? roundUpCount(count) : count
}

/**
 * Builds the drawable plan of one base.
 *
 * @param model the sized model of the whole project
 * @param flow  the flow result of the whole project
 */
export function buildBasePlan(
  index: GameIndex,
  project: Project,
  model: ProjectModel,
  flow: FlowResult,
  baseId: string,
  options: PlanOptions,
): ProductionPlan {
  const base = project.bases.find((b) => b.id === baseId)

  if (!base) return emptyPlan('error', 'Unknown base.')

  const baseName = (id: string) => project.bases.find((b) => b.id === id)?.name ?? '?'
  const rails = options.rails
  const modelNodes = model.byBase.get(baseId) ?? []
  const links = model.links.filter((l) => l.baseId === baseId)
  const linkedPorts = new Set<string>()

  for (const l of links) {
    linkedPorts.add(portKey(l.from, 'out', l.item))
    linkedPorts.add(portKey(l.to, 'in', l.item))
  }

  const pf = (key: string) => flow.portFlow.get(key) ?? 0
  const hasOutLinks = (id: string) => links.some((l) => l.from === id)

  // --- Cargo pairs ---
  const byReceiver = dispatchersByReceiver(project, options.cargo)
  const overridden = overriddenDispatchers(project, options.cargo)
  const allCargo = [...byReceiver.values()].flat()

  /** The virtual counterpart of an unpaired cargo node with its calculated flow. */
  const virtualInfo = (m: ModelNode): PlanVirtualCargo | null =>
    m.virtualCargo ? { ...m.virtualCargo, flow: flow.virtual.get(m.id) ?? 0 } : null

  const pairInfo = (l: CargoLink, side: 'dispatcher' | 'receiver'): PairInfo =>
    side === 'dispatcher'
      ? {
          id: l.dispatcher.id,
          name: l.dispatcher.name,
          baseId: l.dispatcherBase.id,
          baseName: l.dispatcherBase.name,
          nodeId: nodeIds.dispatcher(l.dispatcher.id),
          sameBase: l.dispatcherBase.id === baseId,
        }
      : {
          id: l.receiver.id,
          name: l.receiver.name,
          baseId: l.receiverBase.id,
          baseName: l.receiverBase.name,
          nodeId: nodeIds.receiver(l.receiver.id),
          sameBase: l.receiverBase.id === baseId,
        }

  // --- Rails: one per node pair, with all links (items) between them ---
  const linkRails: PlanRail[] = []
  const linkById = new Map(links.map((l) => [l.id, l]))

  for (const r of model.rails.values()) {
    if (r.baseId !== baseId) continue

    const total = railTotal(flow, r)
    const demand = Math.max(total, flow.railDemand.get(r.key) ?? total)

    linkRails.push({
      key: r.key,
      from: r.from,
      to: r.to,
      links: [...r.links],
      items: r.links.map((id) => linkById.get(id)?.item ?? ''),
      total,
      demand,
      choice: linkRail(r.setting, total, demand, rails),
    })
  }

  const railByKey = new Map(linkRails.map((r) => [r.key, r]))

  /** Whether a node's outgoing manual rail is full (so nothing more moves on). */
  const outRailFull = (nodeId: string) =>
    linkRails.some(
      (r) =>
        r.from === nodeId &&
        r.choice?.mode === 'manual' &&
        r.total >= r.choice.capacity - lineTolerance(r.choice.capacity),
    )

  /** The ports of a model node with flows, gaps and (factories) effective rates. */
  function ports(m: ModelNode, dir: 'in' | 'out'): PlanPort[] {
    const active = m.kind === 'factory' ? (flow.activity.get(m.id) ?? m.count) : null
    // Automatic count: the "shortage" from rounding up is not a shortage (when anything arrives at all).
    const autoSized = m.countMode === 'auto' && (active ?? 0) > 1e-6

    return (dir === 'in' ? m.inputs : m.outputs).map((p) => {
      const id = portKey(m.id, dir, p.item)
      const f = pf(id)
      const nominal = p.nominal
      const linked = linkedPorts.has(id)
      const port: PlanPort = {
        id,
        item: p.item,
        rate: nominal ?? f,
        perBuilding: p.perBuilding,
        flow: f,
        gap: nominal === null ? 0 : significant(nominal - f, nominal),
        linked,
      }

      if (active !== null && nominal !== null) {
        // Factory: effective rate; an input's gap is the bottleneck (`flow.ts › supplyGap`),
        // an output's remainder is relative to the effective production.
        const effective = (p.perBuilding ?? 0) * active

        port.effective = effective

        if (dir === 'in')
          port.gap = linked ? significant(flow.supplyGap.get(id) ?? 0, nominal) : nominal
        else port.gap = significant(effective - f, effective)

        if (dir === 'in' && linked && autoSized) {
          // On the tight input (where the sources would not give more): the part missing because of rounding.
          port.partial = port.gap
          port.gap = 0
        }
      }

      return port
    })
  }

  /** One model node → plan node (with its kind-specific data and warnings). */
  function planNode(m: ModelNode): PlanNode {
    const inputs = ports(m, 'in')
    const outputs = ports(m, 'out')
    const building = m.building
    const count = m.count
    const node: PlanNode = {
      id: m.id,
      kind: m.kind,
      title: m.title,
      recipe: m.recipe,
      building,
      count,
      countMode: m.countMode,
      placed: 0,
      power: 0,
      inputs,
      outputs,
      warning: m.problem,
    }
    const ref = m.ref

    switch (ref.type) {
      case 'factory': {
        node.placed = roundUpCount(count)
        node.power = powerCount(count) * (building?.power ?? 0)
        node.effectiveCount = flow.activity.get(m.id) ?? count
        node.utilization = count > 0 ? Math.min(1, node.effectiveCount / count) : 1
        node.upgradable =
          !!m.recipe &&
          upgradeOptions(index, m.recipe.building, m.recipe.product, 'recipe').length > 0

        const max = building?.maxInputs

        if (!node.warning && m.recipe && max !== undefined && inputs.length > max) {
          node.warning = `More inputs (${inputs.length}) than the building supports (${max})`
        }

        break
      }

      case 'mine': {
        node.placed = roundUpCount(count)
        node.power = powerCount(count) * (building?.power ?? 0)
        node.upgradable =
          !!ref.mine.item &&
          upgradeOptions(index, ref.mine.building, ref.mine.item, 'mine').length > 0
        node.special = {
          type: 'mine',
          mine: ref.mine,
          purityName: ref.purity && ref.mine.output === null ? index.purityName(ref.purity) : null,
          perBuilding: ref.perBuilding,
          total: outputs[0]?.rate ?? 0,
          used: outputs[0]?.flow ?? 0,
        }
        break
      }

      case 'receiver': {
        const r = ref.receiver
        const pairs = (byReceiver.get(r.id) ?? []).map((l) => pairInfo(l, 'dispatcher'))
        const received = pairs.reduce(
          (a, p) => a + (flow.transfer.get(cargoTransferId(p.id)) ?? 0),
          0,
        )
        const virtual = virtualInfo(m)

        node.placed = 1
        node.power = building?.power ?? 0

        for (const p of outputs) p.rate = received + (virtual?.flow ?? 0)

        node.special = {
          type: 'receiver',
          receiver: r,
          pairs,
          received,
          outputLimit: m.outputLimit ?? null,
          virtual,
        }

        if (!r.item) node.warning = 'Choose which item it provides'
        else if (!pairs.length && !virtual) node.warning = 'No Dispatcher'

        break
      }

      case 'dispatcher': {
        const d = ref.dispatcher
        const link = allCargo.find((l) => l.dispatcher.id === d.id)
        const takenBy = overridden.get(d.id)
        const pair = link
          ? pairInfo(link, 'receiver')
          : takenBy
            ? pairInfo(takenBy, 'receiver')
            : null
        const rateInfo = dispatcherRate(index, project, d, rails)
        const sent = flow.transfer.get(cargoTransferId(d.id)) ?? 0

        node.placed = 1
        node.power = building?.power ?? 0
        node.special = {
          type: 'dispatcher',
          dispatcher: d,
          pair,
          sent,
          throughput: rateInfo.rate,
          rateInfo,
          siblings: link ? (byReceiver.get(link.receiver.id)?.length ?? 1) : 0,
          virtual: virtualInfo(m),
        }

        if (!d.item) node.warning = 'Choose an item, or link a producer'
        else if (takenBy)
          node.warning = `1:1: ${takenBy.dispatcher.name} already uses the Receiver; this one sends nothing`
        else if (!pair && !m.virtualCargo) node.warning = 'Not paired; sends nothing'

        break
      }

      case 'storage': {
        const s = ref.storage
        const unitCapacity = building?.capacity ?? 0
        const inflow = inputs[0]?.flow ?? 0
        const outflow = outputs[0]?.flow ?? 0
        const sink = !hasOutLinks(m.id)
        const excess = sink ? inflow : significant(inflow - outflow, inflow)
        const capacity = unitCapacity * s.count

        node.placed = s.count
        node.power = s.count * (building?.power ?? 0)
        node.special = {
          type: 'storage',
          storage: s,
          unitCapacity,
          capacity,
          inflow,
          sink,
          outflow: sink ? 0 : outflow,
          excess,
          state: sink ? 'sink' : excess > EPSILON ? 'positive' : 'balanced',
          fullInMinutes: excess > EPSILON && capacity > 0 ? capacity / excess : null,
          outRailFull: !sink && outRailFull(m.id),
        }

        if (!s.item) node.warning = 'Choose an item, or link a producer'

        break
      }

      case 'line': {
        const line = ref.line
        const total = inputs.reduce((a, p) => a + p.flow, 0)
        const demand = Math.max(total, flow.lineDemand.get(m.id) ?? total)
        const rail = lineRail(line, total, demand, rails)
        const congested = !!rail?.congested

        node.special = { type: 'line', line, total, demand, rail, congested }

        // The rail in the summary: the rail set (congestion is counted separately).
        if (rail && (total > EPSILON || rail.mode === 'manual')) node.rail = rail

        node.freeRows = line.slots === null ? 1 : Math.max(0, line.slots - inputs.length)

        if (congested && rail) {
          node.warning = `Congestion: ${formatRate(demand)} would pass, the rail allows ${formatRate(rail.capacity)}`
        } else if (line.slots !== null && inputs.length > line.slots) {
          node.warning = `More items (${inputs.length}) than inputs (${line.slots})`
        }

        break
      }

      case 'railIn':
      case 'railOut': {
        const link = project.railLinks.find((l) => l.id === ref.linkId)!
        const list = ref.type === 'railOut' ? inputs : outputs

        for (const p of list) p.rate = flow.transfer.get(railTransferId(link.id, p.item)) ?? 0

        const total = list.reduce((a, p) => a + p.rate, 0)
        const other = ref.type === 'railOut' ? link.to : link.from

        node.rail = chooseRail(total, rails)
        node.special = {
          type: ref.type,
          link,
          otherBaseId: other,
          otherBaseName: baseName(other),
          total,
        }

        if (!link.items.length) node.warning = 'No item selected'

        break
      }
    }

    return node
  }

  const nodes: PlanNode[] = modelNodes.map(planNode)

  // --- Edges: the links, with their rail data ---
  const edges: PlanEdge[] = links.map((l) => {
    const rate = flow.linkFlow.get(l.id) ?? 0
    const r = railByKey.get(l.rail)

    return {
      id: l.id,
      linkId: l.id,
      from: l.from,
      fromPort: portKey(l.from, 'out', l.item),
      to: l.to,
      toPort: portKey(l.to, 'in', l.item),
      item: l.item,
      rate,
      rail: r?.choice ?? null,
      railKey: l.rail,
      railTotal: r?.total ?? rate,
      railItems: r?.links.length ?? 1,
      demand: r?.demand ?? rate,
    }
  })

  return {
    status: flow.status === 'error' ? 'error' : nodes.length === 0 ? 'empty' : 'optimal',
    message:
      flow.status === 'error'
        ? flow.message
        : nodes.length === 0
          ? 'Empty base.\nRight-click the canvas to place a factory, mine, Receiver or another element.'
          : undefined,
    nodes,
    edges,
    linkRails,
    summary: summarize(index, nodes, linkRails, rails),
  }
}

/** The summary of a base plan: buildings, power, build cost, shortages, products, rails. */
function summarize(
  index: GameIndex,
  nodes: readonly PlanNode[],
  linkRails: readonly PlanRail[],
  rails: readonly RailTier[],
): ProductionPlan['summary'] {
  // Rails per tier.
  const railLines = new Map<string, RailSummary>()
  let parallel = 0

  const countRail = (choice: RailChoice | null | undefined) => {
    if (!choice) return

    const s = railLines.get(choice.tier.name) ?? { tier: choice.tier, lines: 0 }

    s.lines += choice.count
    railLines.set(choice.tier.name, s)

    if (choice.mode === 'auto' && choice.count > 1) parallel++
  }

  linkRails.forEach((r) => countRail(r.choice))
  nodes.forEach((n) => countRail(n.rail))

  const congestedLinks = linkRails.filter((r) => r.choice?.congested).length
  const congestedLines = nodes.filter(
    (n) => n.special?.type === 'line' && n.special.congested,
  ).length

  // Buildings.
  const byBuilding = new Map<string, BuildingSummary>()

  for (const n of nodes) {
    if (!n.building || n.placed <= 0) continue

    const s = byBuilding.get(n.building.id) ?? {
      building: n.building,
      count: 0,
      roundedCount: 0,
      power: 0,
    }

    s.count += n.count
    s.roundedCount += n.placed
    s.power += n.power
    byBuilding.set(n.building.id, s)
  }

  const buildings = [...byBuilding.values()]
  const { buildCost, unknownCost } = buildCostOf(
    buildings,
    index.data.items.map((i) => i.id),
  )

  // Shortages, products, surplus.
  const shortages: Shortage[] = []
  const products = new Map<string, number>()
  const surplus = new Map<string, number>()

  const addTo = (map: Map<string, number>, item: string, v: number) =>
    map.set(item, (map.get(item) ?? 0) + v)

  for (const n of nodes) {
    if (n.kind === 'factory' || n.kind === 'mine') {
      for (const p of n.inputs) {
        if (p.gap > EPSILON)
          shortages.push({
            nodeId: n.id,
            title: n.title,
            item: p.item,
            rate: p.gap,
            linked: p.linked,
          })
      }

      for (const p of n.outputs) {
        if (p.gap <= EPSILON) continue

        addTo(p.linked ? surplus : products, p.item, p.gap)
      }
    }

    // Goes into storage and stays there: a sink, or the excess of a pass-through storage (positive).
    if (n.special?.type === 'storage' && n.special.storage.item && n.special.excess > EPSILON) {
      addTo(products, n.special.storage.item, n.special.excess)
    }
  }

  const order = index.data.items.map((i) => i.id)
  const sorted = (m: Map<string, number>) =>
    [...m]
      .map(([item, rate]) => ({ item, rate }))
      .sort((a, b) => order.indexOf(a.item) - order.indexOf(b.item))

  return {
    buildings,
    totalCount: buildings.reduce((a, b) => a + b.count, 0),
    totalRounded: buildings.reduce((a, b) => a + b.roundedCount, 0),
    totalPower: buildings.reduce((a, b) => a + b.power, 0),
    shortages,
    products: sorted(products),
    surplus: sorted(surplus),
    rails: rails.map((tier) => railLines.get(tier.name)).filter((s): s is RailSummary => !!s),
    parallel,
    congested: congestedLines + congestedLinks,
    congestedLines,
    congestedLinks,
    buildCost,
    unknownCost,
  }
}

/**
 * Build cost from the building summary: buildings to place × cost, summed per item, in the
 * data file's item order. Buildings without a cost are listed separately.
 */
export function buildCostOf(
  buildings: readonly BuildingSummary[],
  itemOrder: readonly string[],
): { buildCost: ItemQuantity[]; unknownCost: Building[] } {
  const total = new Map<string, number>()
  const unknownCost: Building[] = []

  for (const s of buildings) {
    if (s.roundedCount <= 0) continue

    if (!s.building.cost?.length) {
      unknownCost.push(s.building)
      continue
    }

    for (const c of s.building.cost)
      total.set(c.item, (total.get(c.item) ?? 0) + c.quantity * s.roundedCount)
  }

  const order = (id: string) => {
    const i = itemOrder.indexOf(id)

    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }

  const buildCost = [...total]
    .map(([item, quantity]) => ({ item, quantity }))
    .sort((a, b) => order(a.item) - order(b.item))

  return { buildCost, unknownCost }
}

/** An empty plan with a status and an optional message. */
export function emptyPlan(status: ProductionPlan['status'], message?: string): ProductionPlan {
  return {
    status,
    message,
    nodes: [],
    edges: [],
    linkRails: [],
    summary: {
      buildings: [],
      totalCount: 0,
      totalRounded: 0,
      totalPower: 0,
      shortages: [],
      products: [],
      surplus: [],
      rails: [],
      parallel: 0,
      congested: 0,
      congestedLines: 0,
      congestedLinks: 0,
      buildCost: [],
      unknownCost: [],
    },
  }
}
