/**
 * @module engine/flows
 *
 * Flow allocation for the links created by "Build chain".
 *
 * The chain LP (`chain.ts`) only says how much of an item is made and consumed in total.
 * For the links it must also be decided WHICH producer feeds WHICH consumer. This module
 * does that, for one item.
 *
 * Greedy method: it walks producers and consumers in order and always moves as much as
 * possible. It creates few edges (at most producers + consumers − 1). For a proportional
 * split (everyone gets a little from everyone), change it here.
 */
import { EPSILON } from '../config'

/** One end of an allocated flow: a node port and its amount. */
export interface FlowEndpoint {
  nodeId: string
  portId: string
  amount: number
}

/** An allocated flow from a producer to a consumer. */
export interface Flow {
  from: FlowEndpoint
  to: FlowEndpoint
  amount: number
}

/**
 * Allocates producer amounts to consumer amounts greedily.
 *
 * @returns the flows; their total is min(Σ producers, Σ consumers)
 */
export function allocateFlows(producers: FlowEndpoint[], consumers: FlowEndpoint[]): Flow[] {
  const flows: Flow[] = []
  const prodLeft = producers.map((p) => p.amount)
  const consLeft = consumers.map((c) => c.amount)
  let i = 0
  let j = 0

  while (i < producers.length && j < consumers.length) {
    const amount = Math.min(prodLeft[i], consLeft[j])

    if (amount > EPSILON) flows.push({ from: producers[i], to: consumers[j], amount })

    prodLeft[i] -= amount
    consLeft[j] -= amount

    if (prodLeft[i] <= EPSILON) i++
    if (consLeft[j] <= EPSILON) j++
  }

  return flows
}
