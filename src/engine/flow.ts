/**
 * @module engine/flow
 *
 * Flow on the links – "how much material moves over each link?"
 *
 * Nodes produce and request what their machine counts say (nominal rates,
 * `projectModel.ts`). Material moves only over links. One linear program (LP, `yalps`)
 * covers ALL bases, so cargo and inter-base rails are part of it.
 *
 * THE MODEL (flow mode)
 * ```
 * Variables:  f|<link>      flow on a link (≥ 0)
 *             t|<transfer>  material of a cargo pair / inter-base rail (≥ 0)
 *             x|<factory>   EFFECTIVE machine count: what it can actually work (0 … count)
 *             v|<node>      virtual cargo counterpart of an unpaired Dispatcher / Receiver
 * Constraints:
 *   factory output:          Σ outgoing f ≤ per-machine × x      (the rest is surplus)
 *   factory linked input:    Σ incoming f = per-machine × x      (takes what it processes)
 *   factory unlinked input:  none – assumed supplied, just not linked yet
 *   mine output:             Σ outgoing f ≤ nominal production
 *   rail line, per item:     Σ in = Σ out; manual mode: Σ all incoming ≤ capacity
 *   manual rail (node pair): Σ over the rail's links ≤ tier × count (Link.rail; one rail
 *                            carries every item between the same two nodes)
 *   storage, pass-through:   Σ in = Σ out + k   (k ≥ 0: the excess accumulates – "positive")
 *   storage, sink:           none (everything fits, it fills up)
 *   Dispatcher:              Σ in = t sent to its pair, t ≤ throughput
 *                            (unpaired with a virtual receiver: Σ in = v, v ≤ capacity)
 *   Receiver:                Σ out = t received from its Dispatchers (≤ rail output limit)
 *                            (no Dispatcher, virtual dispatcher: Σ out = v, v ≤ capacity)
 *   inter-base rail:         outgoing side Σ in = t, incoming side Σ out = t
 * Objective ('optimal' distribution): as much as possible reaches factory inputs (what
 *   stays in storage is worth half), factories work as much as they can (x), with a tiny
 *   cost on every flow (no needless circulation).
 * ```
 *
 * DISTRIBUTION (`features.flowDistribution` in game.yml, {@link FlowOptions}):
 *   - `even` (default): EVEN – consumers request from the network and everyone serves
 *     them, without priority: a source splits its output equally between the requesters, a
 *     consumer gets equally from its sources, and surplus (what someone does not request)
 *     goes to the others. Mathematically: a max-min fair allocation of the link flows by
 *     "progressive filling": the flows of all open links rise together (t) until one gets
 *     stuck (its source runs out, its consumer is full, the rail is full) – stuck links
 *     stay at the level, the others keep rising ({@link solveFair}). Same constraints as
 *     above, only the objective differs. Example: two smelters → one factory: 240 + 240
 *     (not 480 + 0); with a1,a2 → b1, a2 → b2, a2,a3 → b3 the output of a2 splits in thirds
 *     and b2 falls behind. The rule is experience-based and unconfirmed, hence a switch.
 *   - `optimal`: the objective above (LP optimum, the original calculation).
 *
 * AUTOMATIC MACHINE COUNT ({@link autoFactoryCounts}, when the model is built): automatic
 * factories get as many machines as the material reaching their linked inputs feeds (with
 * the same distribution), rounded up; the flow is then computed with that count.
 *
 * EFFECTIVE OUTPUT: when a factory's linked input gets less than it needs, the factory only
 * works at the ratio of its tightest input (x < count): its output drops accordingly, which
 * becomes a shortage on the next factory's input. It also takes only that much from its
 * other inputs. Which input is the bottleneck is told by `supplyGap`: an input's shortage =
 * what is missing to the nominal rate and its sources (with their free production) could not
 * make up either.
 *
 * STORAGE: passes on what it gets, when it is taken; what does not move on (the consumer
 * does not request it, or the outgoing rail is smaller) accumulates (`k`, the storage is
 * "positive"). Factories are served first (1); what stays in storage is worth 0.5, like what
 * goes into a sink. While balancing a pass-through storage has Σ in = Σ out (demand pulls
 * production, nothing accumulates).
 *
 * CONGESTION: when a manual rail line or a manual rail (node pair) is full (its flow reaches
 * its capacity), a second calculation without the manual rail limits tells how much would
 * pass (`lineDemand`, `railDemand`). When that exceeds the capacity, the rail congests: the
 * consumers get less than they request. On a rail line the capacity is then split between
 * the items in proportion to their demand (a third calculation with per-item limits) –
 * otherwise the LP might give it all to one item. (Even distribution does not need this:
 * the items share the capacity equally anyway.)
 *
 * BALANCE mode (`adjustable`): the counts of the given factories and mines are variables
 * too, pulled by consumer demand: a count is what the linked consumers need. For that,
 * non-adjustable sources (fixed mine, fixed factory, Receiver, incoming rail) may give more
 * "virtually", and neither cargo throughput nor manual rail capacities (rail line, link)
 * limit – the real shortage (congestion) shows up afterwards in flow mode at the
 * bottleneck. The objective: no shortage (a thousand times more expensive on a linked
 * input), no surplus on linked outputs, virtual supply costs something, and as few machines
 * as possible.
 */
import { solve, type Constraint } from 'yalps'

import { EPSILON } from '../config'
import type { ModelNode, ProjectModel } from './projectModel'

/** The result of a flow calculation. */
export interface FlowResult {
  status: 'optimal' | 'error'
  message?: string

  /** Link id → flow (items/min). */
  linkFlow: Map<string, number>

  /** Transfer id → flow. */
  transfer: Map<string, number>

  /** Port key (`portKey`) → the total actual flow coming in / going out. */
  portFlow: Map<string, number>

  /** Balancing: node id → the new machine count. */
  counts: Map<string, number>

  /**
   * Saturated manual rail line (node id) → what would pass without a limit. Only the full
   * manual lines are included.
   */
  lineDemand: Map<string, number>

  /**
   * Saturated manual rail (`ModelRail.key`) → what would pass without a limit (all its items
   * together). Only the full manual rails are included.
   */
  railDemand: Map<string, number>

  /** Flow mode: factory id → effective machine count (what it can actually work). */
  activity: Map<string, number>

  /**
   * Flow mode: linked factory input (port key) → the missing SUPPLY: what is missing to the
   * nominal rate and the free production of its sources would not make up. 0 (or absent):
   * not a bottleneck – less arrives only because the factory works less due to another input.
   */
  supplyGap: Map<string, number>

  /**
   * Unpaired Dispatcher / Receiver with a virtual counterpart (node id) → what the virtual
   * counterpart takes (Dispatcher) or gives (Receiver), items/min.
   */
  virtual: Map<string, number>
}

/** Key of a node port: `<node>|in|<item>` / `<node>|out|<item>`. */
export const portKey = (nodeId: string, dir: 'in' | 'out', item: string) =>
  `${nodeId}|${dir}|${item}`

/** A number as shown to the user: floating-point noise removed. */
const clean = (v: number) => (Math.abs(v) < EPSILON ? 0 : Math.round(v * 1e6) / 1e6)

/** Shortage penalty: a thousand times higher on a linked input, so shortages move to the start of the chain. */
const SHORT_LINKED = 1e6
const SHORT_UNLINKED = 1e3

/** Surplus penalty on a linked output (balancing). */
const SURPLUS = 10

/** "Price" of one machine while balancing: fewer machines are better. */
const COUNT_COST = 0.01

/** Balancing: price per unit of "virtual" extra supply of a non-adjustable source (dearer than growing an adjustable producer). */
const VIRTUAL = 1

/** Price of flows and transfers: tiny, only to avoid needless circulation. */
const FLOW_COST = 1e-4

/** Value of one machine of work: a factory works as much as it can (also with unlinked inputs). */
const ACTIVITY = 1e-3

/** Value per unit of what stays in storage (sink, or excess of a pass-through storage). */
const STORED = 0.5

/** The total flow of a rail (all its links / items together). */
export function railTotal(
  flow: Pick<FlowResult, 'linkFlow'>,
  rail: { links: readonly string[] },
): number {
  return rail.links.reduce((a, id) => a + (flow.linkFlow.get(id) ?? 0), 0)
}

/** Calculation options (from the game rule switches, `features` in game.yml). */
export interface FlowOptions {
  /** `even`: even (max-min fair) distribution; `optimal`: LP optimum (the original calculation). */
  distribution: 'even' | 'optimal'
}

/**
 * The flow on every link.
 *
 * @param adjustable balancing: the adjustable factories / mines (always the LP optimum then)
 * @param options    the distribution rule
 */
export function solveFlows(
  model: ProjectModel,
  adjustable: ReadonlySet<string> = new Set(),
  options: FlowOptions = { distribution: 'even' },
): FlowResult {
  if (adjustable.size === 0 && options.distribution === 'even') return solveEven(model)

  const result = solveOnce(model, adjustable, true)

  if (adjustable.size > 0 || result.status !== 'optimal') return result

  result.supplyGap = supplyGaps(model, result)

  const saturated = [...model.nodes.values()].filter(
    (n) =>
      n.kind === 'line' &&
      n.capacity != null &&
      lineTotal(result, n) >= n.capacity - lineTolerance(n.capacity),
  )
  const fullRails = [...model.rails.values()].filter(
    (r) => r.capacity !== null && railTotal(result, r) >= r.capacity - lineTolerance(r.capacity),
  )

  if (!saturated.length && !fullRails.length) return result

  const free = solveOnce(model, adjustable, false)

  if (free.status !== 'optimal') return result

  // Congested lines: the capacity is split per item in proportion to the demand.
  const shares = new Map<string, number>()
  const demand = new Map<string, number>()

  for (const n of saturated) {
    const total = lineTotal(free, n)

    demand.set(n.id, total)

    if (total <= n.capacity! + lineTolerance(n.capacity!)) continue

    for (const p of n.inputs) {
      const d = free.portFlow.get(portKey(n.id, 'in', p.item)) ?? 0

      shares.set(`${n.id}|${p.item}`, (n.capacity! * d) / total)
    }
  }

  const shared = shares.size ? solveOnce(model, adjustable, true, shares) : result
  const final = shared.status === 'optimal' ? shared : result

  for (const [id, v] of demand) final.lineDemand.set(id, v)
  for (const r of fullRails) final.railDemand.set(r.key, railTotal(free, r))

  final.supplyGap = supplyGaps(model, final)

  return final
}

/** The total flow of a rail line (all incoming items together). */
export function lineTotal(flow: Pick<FlowResult, 'portFlow'>, node: ModelNode): number {
  return node.inputs.reduce(
    (a, p) => a + (flow.portFlow.get(portKey(node.id, 'in', p.item)) ?? 0),
    0,
  )
}

/** Anything above capacity + this is congestion (floating-point noise is not). */
export const lineTolerance = (capacity: number) => Math.max(1e-3, capacity * 1e-6)

// ============================================================================
// The linear program
// ============================================================================

/** The LP: variables (with their coefficients) and constraints; the objective is each variable's `value`. */
interface Lp {
  variables: Map<string, Record<string, number>>
  constraints: Map<string, Constraint>
  balance: boolean
}

/**
 * Builds the LP (the model above).
 *
 * @param lineCaps whether manual rail capacities (rail line, link) limit (switched off to measure congestion)
 * @param itemCaps per-item limit on a congested rail line: `<node>|<item>` → items/min
 */
function buildLp(
  model: ProjectModel,
  adjustable: ReadonlySet<string>,
  lineCaps: boolean,
  itemCaps: ReadonlyMap<string, number> = new Map(),
): Lp {
  const balance = adjustable.size > 0
  const variables = new Map<string, Record<string, number>>()
  const constraints = new Map<string, Constraint>()

  const coef = (name: string): Record<string, number> => {
    let c = variables.get(name)

    if (!c) {
      c = {}
      variables.set(name, c)
    }

    return c
  }

  const addTo = (v: string, row: string, value: number) => {
    const c = coef(v)

    c[row] = (c[row] ?? 0) + value
  }

  // Links per node.
  const outLinks = new Map<string, typeof model.links>()
  const inLinks = new Map<string, typeof model.links>()

  for (const l of model.links) {
    outLinks.set(l.from, [...(outLinks.get(l.from) ?? []), l])
    inLinks.set(l.to, [...(inLinks.get(l.to) ?? []), l])
  }

  const linksOf = (map: Map<string, typeof model.links>, node: string, item: string) =>
    (map.get(node) ?? []).filter((l) => l.item === item)

  /**
   * Virtual counterpart of an unpaired cargo node: variable `v|<node>` on the node's balance
   * row (Σ links − Σ transfers − v = 0), capped at `capacity` (null = no cap). The cap also
   * holds while balancing: it is the counterpart's defining limit.
   */
  const addVirtualCargo = (nodeId: string, row: string, capacity: number | null, value: number) => {
    const v = `v|${nodeId}`

    addTo(v, row, -1)
    coef(v).value = value

    if (capacity !== null) {
      addTo(v, `vc|${nodeId}`, 1)
      constraints.set(`vc|${nodeId}`, { max: Math.max(0, capacity) })
    }
  }

  // Every link is a variable.
  for (const l of model.links) {
    const to = model.nodes.get(l.to)!
    const c = coef(`f|${l.id}`)
    // Value: reaching a factory input (1), a storage sink (0.5). Balancing: shortage penalties drive it.
    let value = -FLOW_COST

    if (!balance) {
      if (to.kind === 'factory') value += 1
      else if (to.kind === 'storage' && !outLinks.get(to.id)?.length) value += STORED
    } else {
      value = FLOW_COST
    }

    c.value = value

    // Manual rail: all links (items) of the rail together at most the capacity (tier × count).
    const rail = model.rails.get(l.rail)

    if (rail && rail.capacity !== null && lineCaps && !balance) {
      c[`lkc|${rail.key}`] = 1
      constraints.set(`lkc|${rail.key}`, { max: rail.capacity })
    }
  }

  const isProducer = (n: ModelNode) => n.kind === 'factory' || n.kind === 'mine'

  for (const n of model.nodes.values()) {
    // Flow mode: a factory's effective machine count (x) ties its inputs and outputs together.
    if (!balance && n.kind === 'factory') {
      const x = `x|${n.id}`

      coef(x).value = ACTIVITY
      addTo(x, `xc|${n.id}`, 1)
      constraints.set(`xc|${n.id}`, { max: Math.max(0, n.count) })

      for (const p of n.outputs) {
        const links = linksOf(outLinks, n.id, p.item)

        if (!links.length) continue

        const row = `o|${portKey(n.id, 'out', p.item)}`

        for (const l of links) addTo(`f|${l.id}`, row, 1)

        addTo(x, row, -(p.perBuilding ?? 0))
        constraints.set(row, { max: 0 })
      }

      for (const p of n.inputs) {
        const links = linksOf(inLinks, n.id, p.item)

        if (!links.length) continue // unlinked: assumed supplied

        const row = `i|${portKey(n.id, 'in', p.item)}`

        for (const l of links) addTo(`f|${l.id}`, row, 1)

        addTo(x, row, -(p.perBuilding ?? 0))
        constraints.set(row, { equal: 0 })
      }

      continue
    }

    if (isProducer(n)) {
      addProducerRows(n)
      continue
    }

    // Manual rail line: the total flow (all items together) at most the capacity.
    if (n.kind === 'line' && lineCaps && !balance && n.capacity != null) {
      for (const l of inLinks.get(n.id) ?? []) {
        addTo(`f|${l.id}`, `lc|${n.id}`, 1)

        const cap = itemCaps.get(`${n.id}|${l.item}`)

        if (cap !== undefined) {
          addTo(`f|${l.id}`, `lci|${n.id}|${l.item}`, 1)
          constraints.set(`lci|${n.id}|${l.item}`, { max: cap })
        }
      }

      constraints.set(`lc|${n.id}`, { max: n.capacity })
    }

    switch (n.kind) {
      case 'line': // per item Σ in = Σ out
      case 'storage': {
        const sink = n.kind === 'storage' && !outLinks.get(n.id)?.length

        if (sink) break

        for (const p of n.inputs) {
          const row = `p|${n.id}|${p.item}`

          for (const l of linksOf(inLinks, n.id, p.item)) addTo(`f|${l.id}`, row, 1)
          for (const l of linksOf(outLinks, n.id, p.item)) addTo(`f|${l.id}`, row, -1)

          // Pass-through storage: what does not move on accumulates (positive); worth as much as a sink.
          if (n.kind === 'storage' && !balance) {
            addTo(`k|${row}`, row, -1)
            coef(`k|${row}`).value = STORED
          }

          constraints.set(row, { equal: 0 })
        }

        break
      }

      case 'dispatcher': {
        const row = `d|${n.id}`

        for (const l of inLinks.get(n.id) ?? []) addTo(`f|${l.id}`, row, 1)

        // Virtual receiver (unpaired Dispatcher): takes what arrives, up to its capacity.
        // In 'optimal' mode it is worth as much as a factory input (it is consumed elsewhere).
        if (n.virtualCargo)
          addVirtualCargo(n.id, row, n.virtualCargo.capacity, balance ? FLOW_COST : 1 - FLOW_COST)

        constraints.set(row, { equal: 0 })
        break
      }

      case 'receiver': {
        const row = `r|${n.id}`
        const limited = !balance && n.outputLimit !== null && n.outputLimit !== undefined

        for (const l of outLinks.get(n.id) ?? []) {
          addTo(`f|${l.id}`, row, 1)

          if (limited) addTo(`f|${l.id}`, `rl|${n.id}`, 1)
        }

        if (balance && outLinks.get(n.id)?.length) {
          addTo(`w|${row}`, row, -1)
          coef(`w|${row}`).value = VIRTUAL
        }

        // Virtual dispatcher (Receiver without a Dispatcher): gives up to its capacity.
        if (n.virtualCargo)
          addVirtualCargo(n.id, row, n.virtualCargo.capacity, balance ? FLOW_COST : -FLOW_COST)

        constraints.set(row, { equal: 0 })

        if (limited) constraints.set(`rl|${n.id}`, { max: n.outputLimit! })

        break
      }

      case 'railOut':
        for (const p of n.inputs) {
          const row = `ro|${n.id}|${p.item}`

          for (const l of linksOf(inLinks, n.id, p.item)) addTo(`f|${l.id}`, row, 1)

          constraints.set(row, { equal: 0 })
        }

        break

      case 'railIn':
        for (const p of n.outputs) {
          const row = `ri|${n.id}|${p.item}`
          const links = linksOf(outLinks, n.id, p.item)

          for (const l of links) addTo(`f|${l.id}`, row, 1)

          if (balance && links.length) {
            addTo(`w|${row}`, row, -1)
            coef(`w|${row}`).value = VIRTUAL
          }

          constraints.set(row, { equal: 0 })
        }

        break
    }
  }

  // Transfers: the sending side's row gets −t, the receiving side's row −t (Σ f = t at both ends).
  for (const t of model.transfers) {
    const v = `t|${t.id}`
    const c = coef(v)

    c.value = balance ? FLOW_COST : -FLOW_COST

    if (t.kind === 'cargo') {
      addTo(v, `d|${t.from}`, -1)
      addTo(v, `r|${t.to}`, -1)
    } else {
      addTo(v, `ro|${t.from}|${t.item}`, -1)
      addTo(v, `ri|${t.to}|${t.item}`, -1)
    }

    // While balancing the throughput does not limit (sizing follows the demand).
    if (t.capacity !== undefined && !balance) {
      addTo(v, `tc|${t.id}`, 1)
      constraints.set(`tc|${t.id}`, { max: t.capacity })
    }
  }

  // Constraints no variable refers to (e.g. a Dispatcher without links) are dropped.
  const used = new Set<string>()

  for (const c of variables.values()) for (const row of Object.keys(c)) used.add(row)
  for (const row of [...constraints.keys()]) if (!used.has(row)) constraints.delete(row)

  return { variables, constraints, balance }

  /** Rows of a producer (mine, or a factory while balancing) – adjustable or fixed. */
  function addProducerRows(n: ModelNode) {
    const adj = adjustable.has(n.id)
    const countVar = `c|${n.id}`

    if (adj) coef(countVar).value = COUNT_COST

    // Outputs.
    for (const p of n.outputs) {
      const row = `o|${portKey(n.id, 'out', p.item)}`
      const links = linksOf(outLinks, n.id, p.item)

      for (const l of links) addTo(`f|${l.id}`, row, 1)

      const per = p.perBuilding ?? 0

      if (adj) {
        // Σ f − c × per-machine ≤ 0; surplus on a linked output is penalised.
        addTo(countVar, row, -per)

        if (links.length && balance) {
          addTo(`u|${row}`, row, 1)
          coef(`u|${row}`).value = SURPLUS
          constraints.set(row, { equal: 0 })
        } else {
          constraints.set(row, { max: 0 })
        }
      } else if (links.length) {
        if (balance) {
          // Fixed producer: surplus is penalised, and for sizing it may give more virtually.
          addTo(`u|${row}`, row, 1)
          coef(`u|${row}`).value = SURPLUS
          addTo(`w|${row}`, row, -1)
          coef(`w|${row}`).value = VIRTUAL
          constraints.set(row, { equal: p.nominal ?? 0 })
        } else {
          constraints.set(row, { max: p.nominal ?? 0 })
        }
      }
    }

    // Inputs.
    for (const p of n.inputs) {
      const row = `i|${portKey(n.id, 'in', p.item)}`
      const links = linksOf(inLinks, n.id, p.item)

      for (const l of links) addTo(`f|${l.id}`, row, 1)

      const per = p.perBuilding ?? 0

      if (balance) {
        // Σ f + shortage = demand (shortage is expensive).
        addTo(`s|${row}`, row, 1)
        coef(`s|${row}`).value = links.length ? SHORT_LINKED : SHORT_UNLINKED

        if (adj) {
          addTo(countVar, row, -per)
          constraints.set(row, { equal: 0 })
        } else {
          constraints.set(row, { equal: p.nominal ?? 0 })
        }
      } else if (links.length) {
        constraints.set(row, { max: p.nominal ?? 0 })
      }
    }
  }
}

const emptyResult = (): FlowResult => ({
  status: 'optimal',
  linkFlow: new Map(),
  transfer: new Map(),
  portFlow: new Map(),
  counts: new Map(),
  lineDemand: new Map(),
  railDemand: new Map(),
  activity: new Map(),
  supplyGap: new Map(),
  virtual: new Map(),
})

/** One LP solution ('optimal' distribution, balancing, and the unlimited estimate of congestion). */
function solveOnce(
  model: ProjectModel,
  adjustable: ReadonlySet<string>,
  lineCaps: boolean,
  itemCaps: ReadonlyMap<string, number> = new Map(),
): FlowResult {
  const lp = buildLp(model, adjustable, lineCaps, itemCaps)

  if (lp.variables.size === 0) return emptyResult()

  const solution = solve({
    direction: lp.balance ? 'minimize' : 'maximize',
    objective: 'value',
    constraints: lp.constraints,
    variables: lp.variables,
  })

  if (solution.status !== 'optimal') {
    return {
      ...emptyResult(),
      status: 'error',
      message: `The flow calculation failed (${solution.status}).`,
    }
  }

  return readResult(model, adjustable, lp.balance, new Map(solution.variables))
}

/** The result from an LP solution (flows, transfers, counts, effective machine counts). */
function readResult(
  model: ProjectModel,
  adjustable: ReadonlySet<string>,
  balance: boolean,
  values: ReadonlyMap<string, number>,
): FlowResult {
  const result = emptyResult()

  for (const l of model.links) {
    const v = clean(values.get(`f|${l.id}`) ?? 0)
    const outKey = portKey(l.from, 'out', l.item)
    const inKey = portKey(l.to, 'in', l.item)

    result.linkFlow.set(l.id, v)
    result.portFlow.set(outKey, (result.portFlow.get(outKey) ?? 0) + v)
    result.portFlow.set(inKey, (result.portFlow.get(inKey) ?? 0) + v)
  }

  for (const t of model.transfers) result.transfer.set(t.id, clean(values.get(`t|${t.id}`) ?? 0))

  for (const n of model.nodes.values()) {
    if (n.virtualCargo) result.virtual.set(n.id, clean(values.get(`v|${n.id}`) ?? 0))
  }

  for (const id of adjustable) result.counts.set(id, clean(values.get(`c|${id}`) ?? 0))

  if (!balance) {
    for (const n of model.nodes.values()) {
      if (n.kind === 'factory') result.activity.set(n.id, clean(values.get(`x|${n.id}`) ?? 0))
    }
  }

  return result
}

// ============================================================================
// Even distribution (max-min fair, progressive filling)
// ============================================================================

/** Filling step: a link must be able to grow by this much not to count as stuck. */
const FAIR_STEP = 1e-3

/** Tolerance of a frozen flow (items/min): floating-point noise between rounds must not make the LP infeasible. */
const fairTolerance = (v: number) => Math.max(1e-9, Math.abs(v) * 1e-10)

/** A copy of the LP (including the variables' coefficients), so a round can add constraints. */
function cloneLp(lp: Lp): Lp {
  const variables = new Map<string, Record<string, number>>()

  for (const [k, c] of lp.variables) variables.set(k, { ...c })

  return { variables, constraints: new Map(lp.constraints), balance: lp.balance }
}

/**
 * Even distribution: max-min fair link flows by progressive filling. Per round:
 *   1. every open link ≥ t, the frozen ones at their frozen value: the highest possible t
 *      (the common level),
 *   2. which open links cannot grow above t (all at once by a small step: max Σ e,
 *      e ≤ FAIR_STEP) – those that cannot and are at the level are stuck: frozen,
 * until every link is frozen. Finally one LP with the frozen flows (effective machine
 * counts of factories, excess of storages, transfers).
 *
 * Independent sub-networks (not touching by link or transfer) are solved separately:
 * smaller LPs, fewer rounds.
 *
 * @returns null when something fails (e.g. a cyclic, unbounded flow)
 */
function solveFair(model: ProjectModel, lineCaps: boolean): FlowResult | null {
  const result = emptyResult()

  for (const part of components(model)) {
    const r = solveFairPart(part, lineCaps)

    if (!r) return null

    for (const key of ['linkFlow', 'transfer', 'portFlow', 'activity', 'virtual'] as const) {
      for (const [k, v] of r[key]) result[key].set(k, v)
    }
  }

  return result
}

/** The independent parts of the model: nodes connected by links and transfers. */
function components(model: ProjectModel): ProjectModel[] {
  const parent = new Map<string, string>()

  const root = (id: string): string => {
    let r = id

    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!

    parent.set(id, r)

    return r
  }

  const join = (a: string, b: string) => {
    const ra = root(a)
    const rb = root(b)

    if (ra !== rb) parent.set(ra, rb)
  }

  for (const id of model.nodes.keys()) parent.set(id, id)
  for (const l of model.links) join(l.from, l.to)
  for (const t of model.transfers) join(t.from, t.to)

  const groups = new Map<string, Set<string>>()

  for (const id of model.nodes.keys()) {
    const r = root(id)
    const g = groups.get(r)

    if (g) g.add(id)
    else groups.set(r, new Set([id]))
  }

  return [...groups.values()].map((ids) => ({
    nodes: new Map([...model.nodes].filter(([id]) => ids.has(id))),
    byBase: new Map(),
    links: model.links.filter((l) => ids.has(l.from)),
    rails: new Map([...model.rails].filter(([, r]) => ids.has(r.from))),
    transfers: model.transfers.filter((t) => ids.has(t.from)),
    invalidLinks: new Map(),
    flowHint: model.flowHint,
  }))
}

/** Even distribution of one independent part (see {@link solveFair}). */
function solveFairPart(model: ProjectModel, lineCaps: boolean): FlowResult | null {
  const lp = buildLp(model, new Set(), lineCaps)

  if (lp.variables.size === 0) return emptyResult()

  const ids = model.links.map((l) => l.id)
  const frozen = new Map<string, number>()

  const fix = (m: Lp, tolerance = fairTolerance) => {
    for (const [id, v] of frozen) {
      const c = m.variables.get(`f|${id}`)

      if (!c) continue

      c[`fx|${id}`] = 1
      // A narrow band instead of exact equality: floating-point noise must not make the next round infeasible.
      m.constraints.set(`fx|${id}`, { min: v - tolerance(v), max: v + tolerance(v) })
    }
  }

  /**
   * Final LP with the frozen flows: effective machine counts, storage excess, transfers.
   * The link flows are the frozen values (not the value within the band).
   */
  const finish = (tolerance = fairTolerance): FlowResult | null => {
    const mf = cloneLp(lp)

    fix(mf, tolerance)

    const sf = solve({
      direction: 'maximize',
      objective: 'value',
      constraints: mf.constraints,
      variables: mf.variables,
    })

    if (sf.status !== 'optimal') return null

    const values = new Map(sf.variables)

    for (const [id, v] of frozen) values.set(`f|${id}`, v)

    return readResult(model, new Set(), false, values)
  }

  // The automatic sizing already computed this flow (`ProjectModel.flowHint`, at display
  // precision): when it is still feasible, it is the result (no rounds needed).
  const hint = model.flowHint

  if (lineCaps && hint && ids.every((id) => hint.has(id))) {
    for (const id of ids) frozen.set(id, hint.get(id)!)

    const r = finish((v) => Math.max(1e-6, Math.abs(v) * 1e-7))

    if (r) return r

    frozen.clear()
  }

  let prev = -1

  for (let round = 0; frozen.size < ids.length && round <= ids.length + 2; round++) {
    const open = ids.filter((id) => !frozen.has(id))

    // 1. The common level (t) as high as possible.
    const m1 = cloneLp(lp)

    fix(m1)

    const T: Record<string, number> = { fair: 1 }

    for (const id of open) {
      const c = m1.variables.get(`f|${id}`)

      if (!c) continue

      c[`fl|${id}`] = 1
      T[`fl|${id}`] = -1
      m1.constraints.set(`fl|${id}`, { min: 0 })
    }

    m1.variables.set('T', T)

    const s1 = solve({
      direction: 'maximize',
      objective: 'fair',
      constraints: m1.constraints,
      variables: m1.variables,
    })

    if (s1.status !== 'optimal') return null

    const t = Math.max(0, s1.result)
    const v1 = new Map(s1.variables)

    // 2. Which links can still rise above the level (all at once, by a small step)?
    const m2 = cloneLp(lp)

    fix(m2)

    for (const id of open) {
      const c = m2.variables.get(`f|${id}`)

      if (!c) continue

      c[`fl|${id}`] = 1
      m2.variables.set(`e|${id}`, { fair: 1, [`fl|${id}`]: -1, [`eb|${id}`]: 1 })
      m2.constraints.set(`fl|${id}`, { min: t - fairTolerance(t) })
      m2.constraints.set(`eb|${id}`, { max: FAIR_STEP })
    }

    const s2 = solve({
      direction: 'maximize',
      objective: 'fair',
      constraints: m2.constraints,
      variables: m2.variables,
    })

    if (s2.status !== 'optimal') return null

    const v2 = new Map(s2.variables)
    const tol = Math.max(1e-6, t * 1e-6)
    let progress = false

    for (const id of open) {
      if ((v2.get(`e|${id}`) ?? 0) >= FAIR_STEP / 2) continue

      const v = v1.get(`f|${id}`) ?? 0

      if (v > t + Math.max(FAIR_STEP, tol)) continue // stuck, but above the level (bound by others): later

      // Frozen at its round-1 solution value (≈ t): that point is jointly feasible with the
      // other frozen links; rounding to exactly t could make the next round infeasible for
      // coupled links (e.g. the inputs of one factory).
      frozen.set(id, Math.max(t, v))
      progress = true
    }

    // Safety net: without freezing or rising, freeze the open links at their current values.
    if (!progress && t <= prev + tol) for (const id of open) frozen.set(id, v1.get(`f|${id}`) ?? 0)

    prev = t
  }

  if (frozen.size < ids.length) return null

  return finish()
}

/**
 * Even distribution with the full calculation: on congestion the unlimited demand (also
 * even), and the bottlenecks. When the even calculation fails, the LP optimum (with a note).
 */
function solveEven(model: ProjectModel): FlowResult {
  const result = solveFair(model, true)

  if (!result) {
    const fallback = solveFlows(model, new Set(), { distribution: 'optimal' })

    return {
      ...fallback,
      message:
        fallback.message ??
        'The even distribution cannot be calculated (cyclic flow?); the optimal distribution is shown.',
    }
  }

  result.supplyGap = supplyGaps(model, result)

  const saturated = [...model.nodes.values()].filter(
    (n) =>
      n.kind === 'line' &&
      n.capacity != null &&
      lineTotal(result, n) >= n.capacity - lineTolerance(n.capacity),
  )
  const fullRails = [...model.rails.values()].filter(
    (r) => r.capacity !== null && railTotal(result, r) >= r.capacity - lineTolerance(r.capacity),
  )

  if (!saturated.length && !fullRails.length) return result

  const free = solveFair(model, false)

  if (!free) return result

  for (const n of saturated) result.lineDemand.set(n.id, lineTotal(free, n))
  for (const r of fullRails) result.railDemand.set(r.key, railTotal(free, r))

  return result
}

// ============================================================================
// Automatic machine count (from the material reaching the linked inputs)
// ============================================================================

/** While sizing, an automatic factory has at most this many machines (reaching it: a cyclic, unbounded supply). */
const AUTO_CAP = 1e4

/** This much more does not start a new machine (floating-point noise and the filling step must not round up). */
const AUTO_TOLERANCE = 1e-3

/**
 * AUTOMATIC MACHINE COUNT: the count of automatic factories (`Factory.auto`) from the
 * material reaching their linked inputs – "as many machines as the available material feeds".
 *
 * Calculation: the counts of all automatic factories are "unlimited" at once (`AUTO_CAP`),
 * and the flow is computed as usual (even distribution: a factory gets the share of its
 * sources' output that an even split gives it next to the other consumers; `optimal`: LP
 * optimum). From the machines it can work this way (effective count, x) the count is x
 * rounded up: X full machines + 1 part-time machine when it is not exact; at least 1 (a
 * placed factory stays visible even when it gets nothing – so does its shortage). Rounding
 * up does not change the flow (the factory gets the same amount anyway).
 *
 * Not included (the typed count is used): manual factories; automatic factories without a
 * rated linked input (nothing to size from: an unlinked input is "supplied"); and when the
 * sizing would be unbounded (cyclic chain).
 *
 * @returns `counts`: node id → machine count (whole number ≥ 1); `flowHint`: with the even
 *          distribution, the sizing's flow (link id → flow; `ProjectModel.flowHint`)
 */
export function autoFactoryCounts(
  model: ProjectModel,
  options: FlowOptions = { distribution: 'even' },
): { counts: Map<string, number>; flowHint?: Map<string, number> } {
  const linkedItems = new Map<string, Set<string>>()

  for (const l of model.links) {
    const set = linkedItems.get(l.to) ?? new Set<string>()

    set.add(l.item)
    linkedItems.set(l.to, set)
  }

  const auto = new Set<string>()

  for (const n of model.nodes.values()) {
    if (n.ref.type !== 'factory' || !n.ref.factory.auto) continue

    const items = linkedItems.get(n.id)

    if (items && n.inputs.some((p) => items.has(p.item) && (p.perBuilding ?? 0) > 0)) auto.add(n.id)
  }

  const counts = new Map<string, number>()

  if (!auto.size) return { counts }

  const open: ProjectModel = {
    ...model,
    flowHint: undefined,
    nodes: new Map(
      [...model.nodes].map(([id, n]) => [id, auto.has(id) ? { ...n, count: AUTO_CAP } : n]),
    ),
  }
  const activity = new Map<string, number>()
  let flowHint: Map<string, number> | undefined

  if (options.distribution === 'even') {
    flowHint = new Map()

    // Only the independent parts that contain an automatic factory.
    for (const part of components(open)) {
      if (![...part.nodes.keys()].some((id) => auto.has(id))) continue

      const fair = solveFairPart(part, true)
      const r = fair ?? solveOnce(part, new Set(), true)

      for (const [k, v] of r.activity) activity.set(k, v)

      if (fair) for (const [k, v] of fair.linkFlow) flowHint.set(k, v)
    }
  } else {
    for (const [k, v] of solveOnce(open, new Set(), true).activity) activity.set(k, v)
  }

  for (const id of auto) {
    const x = activity.get(id)

    if (x === undefined || x >= AUTO_CAP / 2) continue

    counts.set(id, Math.max(1, Math.ceil(x - AUTO_TOLERANCE)))
  }

  return { counts, flowHint }
}

// ============================================================================
// Bottlenecks
// ============================================================================

/**
 * Bottleneck: how much SUPPLY is missing on the linked factory inputs.
 *
 * When an input gets less than nominal, its sources are checked (backwards over its links,
 * through pass-through nodes – rail line, storage, cargo, inter-base rail): could their
 * free production (effective production − what is taken) make it up? What would not arrive
 * even then is the shortage. An estimate: when several consumers share a source's free
 * production, each of them sees all of it.
 */
function supplyGaps(model: ProjectModel, flow: FlowResult): Map<string, number> {
  const gaps = new Map<string, number>()
  const inLinks = new Map<string, typeof model.links>()

  for (const l of model.links) inLinks.set(l.to, [...(inLinks.get(l.to) ?? []), l])

  const linksIn = (node: string, item: string) =>
    (inLinks.get(node) ?? []).filter((l) => l.item === item)

  /** What could still come over a link: the source's free supply, for a manual rail at most its free capacity (all items). */
  const viaLink = (l: (typeof model.links)[number], item: string): number => {
    const rail = model.rails.get(l.rail)
    const room =
      rail && rail.capacity !== null ? Math.max(0, rail.capacity - railTotal(flow, rail)) : Infinity

    return room > 0 ? Math.min(room, spare(l.from, item)) : 0
  }

  const pf = (node: string, dir: 'in' | 'out', item: string) =>
    flow.portFlow.get(portKey(node, dir, item)) ?? 0
  const transfersTo = (node: string, item: string) =>
    model.transfers.filter((t) => t.to === node && t.item === item)

  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  /** Free supply on a node's output (what it could still give of this item). */
  const spare = (nodeId: string, item: string): number => {
    const key = `${nodeId}|${item}`
    const known = memo.get(key)

    if (known !== undefined) return known

    if (visiting.has(key)) return 0 // cycle: not counted twice

    visiting.add(key)

    const n = model.nodes.get(nodeId)
    let v = 0
    const upstream = (node: string) => linksIn(node, item).reduce((a, l) => a + viaLink(l, item), 0)

    switch (n?.kind) {
      case 'factory': {
        const p = n.outputs.find((x) => x.item === item)
        const made = p ? (p.perBuilding ?? 0) * (flow.activity.get(n.id) ?? n.count) : 0

        v = made - pf(n.id, 'out', item)
        break
      }

      case 'mine': {
        const p = n.outputs.find((x) => x.item === item)

        v = (p?.nominal ?? 0) - pf(n.id, 'out', item)
        break
      }

      case 'storage':
        // The accumulating excess (in − out) could be given too, plus what its sources could still give.
        v = upstream(n.id) + Math.max(0, pf(n.id, 'in', item) - pf(n.id, 'out', item))
        break

      case 'line':
        v = upstream(n.id)

        if (n.capacity != null) v = Math.min(v, n.capacity - lineTotal(flow, n))

        break

      case 'receiver': {
        for (const t of transfersTo(n.id, item)) {
          const room =
            t.capacity !== undefined ? t.capacity - (flow.transfer.get(t.id) ?? 0) : Infinity

          v += Math.min(room, upstream(t.from))
        }

        // The virtual dispatcher could still give the rest of its capacity.
        if (n.virtualCargo) {
          const cap = n.virtualCargo.capacity ?? Infinity

          v += Math.max(0, cap - (flow.virtual.get(n.id) ?? 0))
        }

        if (n.outputLimit != null) {
          v = Math.min(
            v,
            n.outputLimit - n.outputs.reduce((a, p) => a + pf(n.id, 'out', p.item), 0),
          )
        }

        break
      }

      case 'railIn':
        for (const t of transfersTo(n.id, item)) v += upstream(t.from)

        break
    }

    v = Math.max(0, v)
    visiting.delete(key)
    memo.set(key, v)

    return v
  }

  for (const n of model.nodes.values()) {
    if (n.kind !== 'factory') continue

    for (const p of n.inputs) {
      const links = linksIn(n.id, p.item)

      if (!links.length || p.nominal === null) continue

      const deficit = p.nominal - pf(n.id, 'in', p.item)

      if (deficit <= Math.max(1e-3, p.nominal * 1e-6)) continue

      const available = links.reduce((a, l) => a + viaLink(l, p.item), 0)

      gaps.set(portKey(n.id, 'in', p.item), clean(Math.max(0, deficit - available)))
    }
  }

  return gaps
}

/**
 * Nodes that stay fixed while balancing: those from which no material reaches a consumer
 * (unlinked outputs, or links only into storage sinks) – the ends of the chain, the
 * player's goals – and mines with a custom output.
 */
export function isChainEnd(model: ProjectModel, node: ModelNode): boolean {
  if (node.ref.type === 'mine' && node.ref.mine.output !== null) return true

  const outs = model.links.filter((l) => l.from === node.id)

  if (outs.length === 0) return true

  return outs.every((l) => {
    const to = model.nodes.get(l.to)

    return to?.kind === 'storage' && !model.links.some((x) => x.from === to.id)
  })
}
