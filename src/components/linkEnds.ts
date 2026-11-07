/**
 * @module components/linkEnds
 *
 * The ends of the link window – what sets the pace at the two ends of a rail, and how many
 * machines belong to one rail (LinkEditor).
 *
 *   - factory, mine: machines per rail in proportion to the rail's flow
 *     (`rails.ts › machinesPerRate`). For a receiving factory the tightest of the items
 *     arriving on the rail decides (the bottleneck): the rail serves that many machines.
 *     For a source: as many machines as it takes to produce every item.
 *   - storage: gives as much as it gets; its state is balanced, positive (accumulating) or
 *     sink (`storageState.ts`).
 *   - cargo (Receiver, Dispatcher): the pace is set by the tighter of the cargo throughput
 *     and the capacity of the attached rail; an unpaired one may have a virtual counterpart.
 *   - rail line (collector): the branch rail carries several items at once; on the machine
 *     side the bottleneck of the machine's requested items decides.
 *   - inter-base rail: whatever comes from / goes to the other base.
 */
import { EPSILON, RATE_UNIT_LABEL } from '../config'
import { formatQuantity, formatRate } from '../engine/format'
import type { PlanNode, PlanRail, PlanVirtualCargo, ProductionPlan } from '../engine/plan'
import { machinesPerRate, railLabel, type RailChoice } from '../engine/rails'
import { storageState } from './storageState'

/** One line of an end description. */
export interface EndLine {
  text: string
  tone?: 'warn' | 'bad' | 'ok'
}

/** The description of one end of a rail. */
export interface EndView {
  /** The node kind in the UI (e.g. "Factory", "Storage"). */
  kind: string

  title: string
  lines: EndLine[]

  /**
   * Machines per unit (1 /min) of rail flow: the rail's flow × this = machine count.
   * null: the end is not a machine (no machine count column).
   */
  perRate: number | null
}

/** Everything {@link describeEnd} needs. */
export interface EndContext {
  node: PlanNode
  side: 'source' | 'target'
  rail: PlanRail

  /** The flow on the rail, per item. */
  flows: readonly { item: string; rate: number }[]

  choice: RailChoice | null

  /** The plans of all bases (the cargo pair may be in another base). */
  plans: ReadonlyMap<string, ProductionPlan>

  itemName: (id: string) => string
}

const u = RATE_UNIT_LABEL

/** Display names of the node kinds. */
const KIND: Record<string, string> = {
  factory: 'Factory',
  mine: 'Mine',
  receiver: 'Receiver (cargo)',
  dispatcher: 'Dispatcher (cargo)',
  storage: 'Storage',
  line: 'Rail line',
  railIn: 'Incoming inter-base rail',
  railOut: 'Outgoing inter-base rail',
}

/** Name of the "this rail" limit (also used to pick the warning tone). */
const THIS_RAIL = 'this rail'

/** "This rail" text and manual capacity (null for auto: it does not limit). */
function railCap(choice: RailChoice | null): { text: string; cap: number | null } {
  if (!choice) return { text: 'no rail data', cap: null }

  if (choice.mode === 'manual') {
    return {
      text: `${railLabel(choice)} = ${formatRate(choice.capacity)} ${u} (manual)`,
      cap: choice.capacity,
    }
  }

  return {
    text: `${railLabel(choice)}, automatic (as many rails as needed: does not limit)`,
    cap: null,
  }
}

/** The tightest of the limits, with its name. */
function tightest(
  limits: { name: string; value: number | null }[],
): { name: string; value: number } | null {
  let best: { name: string; value: number } | null = null

  for (const l of limits) {
    if (l.value !== null && (!best || l.value < best.value - EPSILON))
      best = { name: l.name, value: l.value }
  }

  return best
}

/** "… of at most X /min" / ", unlimited." for a virtual cargo counterpart. */
const virtualCap = (v: PlanVirtualCargo) =>
  v.capacity === null ? ', unlimited.' : ` of at most ${formatRate(v.capacity)} ${u}.`

/** Describes one end of a rail for the link window. */
export function describeEnd(c: EndContext): EndView {
  const { node, side, flows, choice } = c
  const view: EndView = {
    kind: KIND[node.kind] ?? node.kind,
    title: node.title,
    lines: [],
    perRate: null,
  }
  const total = flows.reduce((a, f) => a + f.rate, 0)
  const multi = flows.length > 1
  const names = flows.map((f) => c.itemName(f.item)).join(', ')

  switch (node.kind) {
    case 'factory':
    case 'mine': {
      const ports = side === 'source' ? node.outputs : node.inputs
      const items = flows.map((f) => ({
        item: f.item,
        rate: f.rate,
        perMachine: ports.find((p) => p.item === f.item)?.perBuilding ?? null,
      }))
      const per = items
        .map((x) => `${multi ? c.itemName(x.item) + ' ' : ''}${formatRate(x.perMachine ?? 0)}`)
        .join(' + ')

      view.lines.push({
        text: `Set to ${formatQuantity(node.count, 'machine')} · ${per} ${u}/machine ${side === 'source' ? 'output' : 'demand'}`,
      })

      const m = machinesPerRate(items, side)

      if (!m) break

      view.perRate = m.perRate

      if (side === 'target') {
        view.lines.push({ text: `This rail serves ${formatQuantity(m.machines, 'machine')}.` })

        if (m.bottleneck && !m.even) {
          view.lines.push({
            text: `Bottleneck: ${c.itemName(m.bottleneck)} (of the machine's requested items, the least of this arrives).`,
            tone: 'warn',
          })
        } else if (multi) {
          view.lines.push({
            text: `One rail carries the machine's ${flows.length} items (${names}), in proportion to the demand.`,
          })
        }

        // The machine's other inputs arrive on another rail (or are not linked).
        const others = node.inputs
          .filter((p) => !flows.some((f) => f.item === p.item))
          .map((p) => c.itemName(p.item))

        if (others.length) {
          view.lines.push({
            text: `Its other items (${others.join(', ')}) arrive on another rail, or are not linked.`,
          })
        }
      } else {
        view.lines.push({
          text: `This rail carries the production of ${formatQuantity(m.machines, 'machine')}.`,
        })
      }

      break
    }

    case 'storage': {
      const x = node.special?.type === 'storage' ? node.special : null

      if (!x) break

      const st = storageState(x)

      view.lines.push({
        text: side === 'source' ? 'Gives as much as it gets.' : 'Takes everything that arrives.',
      })
      view.lines.push({ text: st.long, tone: st.tone ?? undefined })
      break
    }

    case 'receiver': {
      const x = node.special?.type === 'receiver' ? node.special : null

      if (!x) break

      // Cargo: the throughput of the Dispatchers (from the plan of the other base).
      let cargo = 0

      for (const p of x.pairs) {
        const d = c.plans.get(p.baseId)?.nodes.find((n) => n.id === p.nodeId)

        if (d?.special?.type === 'dispatcher') cargo += d.special.throughput
      }

      const r = railCap(choice)

      view.lines.push({
        text: `Cargo: ${formatRate(x.received)} ${u} arrives; Dispatcher throughput ${formatRate(cargo)} ${u}.`,
      })

      if (x.outputLimit !== null) {
        view.lines.push({
          text: `The Receiver's output is at most ${formatRate(x.outputLimit)} ${u}.`,
        })
      }

      view.lines.push({ text: `This rail: ${r.text}.` })

      const t = tightest([
        { name: 'the cargo throughput', value: x.pairs.length ? cargo : null },
        { name: "the Receiver's output", value: x.outputLimit },
        { name: THIS_RAIL, value: r.cap },
      ])

      if (!x.pairs.length && x.virtual) {
        view.lines.push({
          text: `Virtual dispatcher (no Dispatcher paired): gives ${formatRate(x.virtual.flow)} ${u}${virtualCap(x.virtual)}`,
        })
      } else if (!x.pairs.length) {
        view.lines.push({ text: 'No Dispatcher: nothing arrives.', tone: 'bad' })
      } else if (t) {
        view.lines.push({
          text: `The pace is set by ${t.name}: at most ${formatRate(t.value)} ${u}.`,
          tone: t.name === THIS_RAIL ? 'warn' : undefined,
        })

        if (total < t.value - Math.max(1e-3, t.value * 1e-6)) {
          view.lines.push({
            text: 'Less moves now: the consumer does not request more, or no more arrives in the Dispatcher.',
          })
        }
      }

      break
    }

    case 'dispatcher': {
      const x = node.special?.type === 'dispatcher' ? node.special : null

      if (!x) break

      const r = railCap(choice)
      const feed = x.rateInfo.feedRail
        ? ` (feed rail: ${x.rateInfo.feedRail}${x.rateInfo.fromLink ? ", from the link's manual rail" : ''})`
        : ''

      view.lines.push({
        text: `Cargo throughput: ${formatRate(x.throughput)} ${u}${feed}; sends ${formatRate(x.sent)} ${u}.`,
      })

      if (x.virtual) {
        view.lines.push({
          text: `Virtual receiver (not paired): takes ${formatRate(x.virtual.flow)} ${u}${virtualCap(x.virtual)}`,
        })
      }

      view.lines.push({ text: `This rail: ${r.text}.` })

      const t = tightest([
        { name: 'the cargo throughput', value: x.throughput },
        { name: THIS_RAIL, value: r.cap },
      ])

      if (t) {
        view.lines.push({
          text: `The pace is set by ${t.name}: at most ${formatRate(t.value)} ${u}.`,
          tone: t.name === THIS_RAIL ? 'warn' : undefined,
        })
      }

      if (node.warning) view.lines.push({ text: node.warning, tone: 'bad' })

      break
    }

    case 'line': {
      if (side === 'source') {
        view.lines.push({
          text: multi
            ? `The branch rail from the rail line carries several items at once: ${flows.length} items here (${names}), ${formatRate(total)} ${u} in total.`
            : 'Branch rail from the rail line (it can carry several items; one item goes here now).',
        })
        view.lines.push({
          text: "The machine count comes from the bottleneck of the receiving machine's requested items.",
        })
      } else {
        view.lines.push({
          text: `Rail into the rail line (collector): ${multi ? `${flows.length} items (${names})` : 'one item'}, ${formatRate(total)} ${u} in total.`,
        })
      }

      if (node.special?.type === 'line' && node.special.congested) {
        view.lines.push({
          text: 'The rail line is congested (its manual capacity is too small).',
          tone: 'bad',
        })
      }

      break
    }

    case 'railIn':
    case 'railOut': {
      const x = node.special?.type === node.kind ? node.special : null

      if (x && (x.type === 'railIn' || x.type === 'railOut')) {
        view.lines.push({
          text: `${x.type === 'railIn' ? 'Comes from' : 'Goes to'}: ${x.otherBaseName} · ${formatRate(x.total)} ${u} in total.`,
        })
      }

      break
    }
  }

  return view
}
