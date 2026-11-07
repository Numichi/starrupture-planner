---
name: Calculation engine
description: Rules for changing src/engine (model, flow LP, balancing, chain builder, base plan, rail lines, layout).
applyTo: "src/engine/**"
---

# `src/engine/` – calculation engine

Overview: `docs/GRAPH-ENGINE.md`. Every module starts with an `@module` JSDoc block that
explains its business rules; keep it current when the behaviour changes.

- **Pure TypeScript, no Vue.** No `vue` import, no store import (only types and the
  `nodeIds` helper from `project/types.ts`). Every function computes output from input
  without side effects. Game rules arrive as parameters (`CargoRules`), never as globals.
- **Unit: items per minute.** Recipe net rate: `gameIndex.ts › netRatesPerBuilding`
  (× building `speed`). Number formatting only in the UI (`format.ts`).
- **Missing rate (`missingData.ts`)**: a recipe without cycle time (`perCycle`, `rateFrom:
  'missing'`) keeps its ports with 0 rate (`factoryPorts`), is not usable by the chain builder
  (`isRecipeUsable`), and `applyCycleTimes` turns the project's manual cycle times into
  per-minute rates (`rateFrom: 'user'`) before the index is built (in `usePlanner`).
- **Model (`projectModel.ts`)**: ports with `nominal` = machine count × per-building rate
  (factory, mine) or `null` (pass-through: receiver, dispatcher, storage, rail line, rail ends).
  Invalid links go to `invalidLinks` and are ignored, never thrown. The app uses
  `buildSizedModel`: `buildModel` with the stored counts → `flow.ts › autoFactoryCounts`
  (auto factories with a rated linked input are uncapped (`AUTO_CAP`), the flow runs with the
  configured distribution, count = max(1, ⌈x − 0.001⌉); x near the cap = cyclic → no sizing)
  → `buildModel(…, autoCounts)` with `countMode` and, for `even`, `flowHint` (the sizing's
  link flows; `solveFairPart` tries them first – the max-min fair result is unchanged by the
  rounded-up caps – and falls back to the rounds if infeasible).
- **Flow LP (`flow.ts`)**: variables `f|<link>`, `t|<transfer>`; in flow mode `x|<factory>`
  (effective machine count ≤ count; linked inputs `= per × x`, outputs `≤ per × x`,
  unlinked inputs unconstrained = assumed supplied; small reward per unit of x), and
  `supplyGaps` afterwards (bottleneck: deficit minus the spare supply of the sources).
  Fair rounds freeze a blocked link at its round-1 solution value (≈ t, jointly feasible)
  within a 1e-10 relative band, never at exactly t (coupled links, e.g. chained factories in
  a ring, would become infeasible); the final LP's link values are snapped to the frozen
  ones. In
  balance mode also
  `c|<node>`, `s|<row>` (shortage), `u|<row>` (surplus); `|` is the separator, so ids must
  not contain it. Flow mode maximises delivery to factory inputs (storage sinks half
  value); balance mode is demand-driven: it minimises shortages (linked inputs ×1000),
  surplus on linked outputs, "virtual" extra supply `w|` at non-adjustable sources (fixed
  producers, receivers, rail-in; cargo capacity ignored) and machine counts – so counts
  follow demand and real shortages show up afterwards in flow mode. Chain ends
  (`isChainEnd`) and custom-output mines stay fixed.
- **Chain builder (`chain.ts`)**: recipe-selection LP; existing free sources nearly free,
  upgrade buildings ×1000, missing items `IMPORT_PENALTY` (×1000 if producible) so
  shortages surface at the raw material. Mines use the first non-upgrade miner.
- **Plan (`plan.ts`)**: ports carry `rate` (nominal), `flow`, `gap`, `linked`, and on
  factories `effective`; factory input gap = bottleneck supply gap (unlinked = nominal),
  output gap = effective − flow; gaps below 0.001/min are noise. An `auto`-sized factory
  that receives something reports its linked input gap as `partial` (rounding of the last
  machine, not a shortage) and `gap` 0. Power = `powerCount(count)` × building power (rounded up per node).
  New node kind: `NodeKind` (projectModel), `SpecialInfo`, `nodeGeometry.ts › KIND_SPEC`
  (mandatory; `freeRows` for empty rows under the ports), a layer constraint in
  `layout.ts › toElkNode` if it belongs at the edge of the base.
- **Layout (`layout.ts`)**: positions come from the project; `routeEdge` draws
  orthogonal edges port to port; ONE drawn line per rail (node pair): `PositionedEdge.edges`
  (one per item), `rate` (sum), `points` (trunk between comb points beside the ports),
  `stubs` (per item, port → comb point); ELK (`autoLayout`) only places nodes without a
  position or on the explicit "arrange" action.
- **Even distribution (`flow.ts › solveFair`, `features.flowDistribution: even`, default)**:
  max-min fair link flows by progressive filling on the SAME LP (`buildLp`), per connected
  part (`components`): round = LP1 max t with open links ≥ t (frozen ones fixed), LP2 max Σ e
  (e ≤ FAIR_STEP) to find blocked links, freeze blocked links at t; a final LP with all
  link flows fixed gives x, k, transfers. On failure `solveEven` falls back to `optimal`
  with a message. Balancing always uses the LP optimum. Keep `buildLp` the single source
  of the constraints.
- **Node warnings** (`warning`) are short English sentences that tell the user what to do.
- Compare floats with `EPSILON` (`config.ts`); "is anything left" with a relative tolerance.
- Rail line (`line` node, collector): per item in = out; a manual line caps the TOTAL inflow
  (the sum of its rail set `RailLine.rails`). Congestion needs the uncapped demand: a
  re-solve without manual caps only when a manual line is saturated (`lineDemand`); in
  `optimal` mode the capacity is then shared in proportion to demand (in `even` mode the
  fair split already shares it). Balancing ignores line capacity (like cargo throughput).
  The old shared rail (`bus`) no longer exists (migrated to rail lines in `sanitize.ts`).
- Link rails (`rails.ts`): one drone rail per node pair (`linkRailKey` = `<from>><to>`,
  `ModelRail` / `PlanRail`): all links between the same two nodes share it, capacity on
  the total – including the links into and out of rail lines (branches). A `RailChoice` is
  a rail SET (`parts`: tier × count ascending, `count` total, `capacity` sum, `needed`).
  `linkRail` – auto (`chooseRail` / `autoParts`: one rail if it fits, else best tiers full
  + the smallest tier for the rest; information, `summary.parallel`, never red) or manual
  (the first `Link.rail` = `RailCount[]`, mixed tiers → `ModelRail.capacity` = the sum, LP
  row `lkc|<rail key>` over all its links; the uncapped re-solve gives `railDemand`; `congested` only when demand > capacity →
  `summary.congestedLinks`). `supplyGaps` limits upstream spare by a manual rail's free
  capacity. `railDistribution(rate, parts, …)` = even (load proportional to capacity) and
  fill + remainder split; machines per rail via
  `machinesPerRate` (target: bottleneck = min over its items of rate / per-machine need;
  source: max).
- Storage: pass-through row `Σ in − Σ out − k = 0` with `k|…` (accumulation, value 0.5 like a
  sink in the optimal objective) in flow mode – it gives on what it gets and the rest accumulates ("positive");
  balance mode keeps in = out. Plan: `state` balanced / positive / sink, `excess`,
  `fullInMinutes`, `outRailFull`; the excess counts as a product and as a chain source.
- Cargo: `dispatcherRate(index, project, d, rails)` – the automatic feed rail follows the
  incoming link's manual rail tier (`attachedFeedRail`, `fromLink`).
- Virtual cargo (`VirtualCargo`, `projectModel.ts › applyVirtualCargo`): an unpaired
  Dispatcher (no Receiver, not overridden) / a Receiver without Dispatchers with a
  `virtual` setting and an item gets `ModelNode.virtualCargo` (capacity: `rail` = the
  dispatcher throughput / the receiver `outputLimit`, `null` = unlimited; `custom` = rate).
  The LP adds `v|<node>` with −1 on the node's balance row (`d|` / `r|`) and a cap row
  `vc|<node>` that also holds while balancing; `FlowResult.virtual` reports it,
  `supplyGaps` counts a virtual dispatcher's free room, `plan.ts` exposes `special.virtual`
  and suppresses the "no pair" warnings.
- After significant changes run `npm run smoke`.
