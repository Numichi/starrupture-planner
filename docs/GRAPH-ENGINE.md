# Graph engine – overview

How the project (bases, nodes, machine counts, links, positions) becomes a graph full of
numbers on the screen, and how the helper actions of the editor work. The whole path:

```
Project + GameData
      │
      ▼  projectModel.ts   model: nominal ports of the nodes, links, cargo / rail transfers, virtual cargo
      ▼  flow.ts           ONE linear program for all bases → flow per link, transfers
      │                    (+ for a congested manual rail line the unlimited demand, proportional split)
      ▼  plan.ts           per base: nodes + ports (shortage, surplus) + edges + summary
      │                    (rails.ts: rail tier, rail line)
      ▼  nodeGeometry.ts   node size and port positions
      ▼  layout.ts         the stored positions + edge routes; ELK only for the automatic layout
      ▼  edgePaths.ts      line style → SVG path
      ▼  ProductionGraph/ + *Node/ + GraphEdge/   drawing, editing

Helper actions: chain.ts (Build chain), flow.ts in balance mode, upgrades.ts (Upgrade)
```

The model, the flow and the base plans (`basePlans`) are built for every base (the summary
needs them), the drawing only for the active base. Every step is a Vue `computed`, so it re-runs
by itself when any input changes. Node **positions** affect the drawing only.

---

## 1. Model (`projectModel.ts › buildModel`)

Every node gets ports (a port = the input or output of one item):

| Node | Ports | Nominal rate (`nominal`) |
|---|---|---|
| factory (`fac:`) | the net inputs and outputs of the recipe (catalysts merged), main product first | count × per-machine rate (× building `speed`); for an automatic factory the computed count (2.0) |
| mine (`mine:`) | out: the mined item | custom output, or building count × the rate of the purity |
| Receiver (`recv:`) | out: the chosen item | – (the received transfer) |
| Dispatcher (`disp:`) | in: its item | – (what it sends) |
| storage (`store:`) | in + out: its item | – |
| rail line (`line:`, collector) | in + out: the items of its links, in link order | – (in manual mode `capacity` = the sum of the rail set) |
| outgoing / incoming inter-base rail (`railout:` / `railin:`) | in / out: the items of the rail | – |

**Recipe without a rate** (YAML `perCycle`, no cycle time data): the factory has its ports, but
with a rate of 0 (`factoryPorts`), so it does not produce, and the next factory gets a shortage;
Build chain does not use it (`gameIndex › isRecipeUsable`). `usePlanner` applies the cycle times
entered in the project (`settings.cycleTimes`) to the data before the model
(`missingData.ts › applyCycleTimes`): items/min = per cycle × 60 / seconds.

**Links:** the `links` list of the base, when both ends exist in this base, the source has such
an output and the target such an input; otherwise `invalidLinks` (not counted).

**Rails** (`ProjectModel.rails`, `ModelRail`): a drone rail carries several items, so the links
between the same two nodes (one per item) are **one rail** (`project/types.ts › linkRailKey` =
`<from>><to>`; `ModelLink.rail`). The rail setting is the `Link.rail` of the first of its links
(the store writes the same to all of them); manual: `capacity` = the sum of the rail set
(`Link.rail` = `[{ tier, count }]`, mixed allowed; `rails.ts › manualRailCapacity`), automatic:
`null`. The links into and branching from a rail line are rails too: e.g. the rail line →
factory rail carries every item the factory gets from there. The old shared rail (`bus:`) was
removed: on loading it becomes an automatic rail line (`sanitize.ts`).

**Transfers:** cargo pair (Dispatcher → Receiver, `c:<dispatcher>`, upper bound: the throughput)
and inter-base rail per item (`l:<rail>:<item>`, without a bound). The list of cargo pairs is
filtered by the game rule (with 1:1 only the first Dispatcher per Receiver). The Dispatcher
throughput depends on the feed rail tier (`dispatcherRate`): the chosen `feedRail`; when
automatic (`null`), the tier of the incoming link's manual rail (`attachedFeedRail`, the best of
several); otherwise the best available. `fromLink` marks when it comes from the link's rail.

**Virtual cargo** (`applyVirtualCargo`, `ModelNode.virtualCargo`): an unpaired cargo node with a
`virtual` setting gets a virtual counterpart – a Dispatcher without a Receiver (and not
overridden by the 1:1 rule) a *virtual receiver*, a Receiver without Dispatchers a *virtual
dispatcher*. It applies only when the node has an item (from its links). Capacity: mode `rail` →
the Dispatcher's throughput (`dispatcherRate(...).rate`) / the Receiver's output limit
(`railOutputs` × best rail; `null` = unlimited); mode `custom` → the typed rate.

## 2. Flow (`flow.ts › solveFlows`)

LPs with the `yalps` library, for all bases together. Two distributions (`FlowOptions`,
`game.yml › features.flowDistribution`):

- **`even` (default): even, no priority** – a max-min fair allocation of the link flows
  (`solveFair`, per sub-network: parts not touching by link or transfer are computed separately).
  **Progressive filling**, per round:
  1. every open link ≥ t (the frozen ones at their frozen value), maximise t;
  2. which open links can rise above t, all at once by a small step (`e ≤ 0.001`, maximise Σ e);
     those that cannot and are at the level are stuck (their source ran out, their consumer is
     full, the rail is full): frozen at their value in the step-1 solution (≈ t; that point is
     jointly feasible – rounding to exactly t could make the next round infeasible for coupled
     links, e.g. in a ring of chained factories), with a relative band of 10⁻¹⁰ against
     floating-point noise;
  3. until every link is frozen; finally one LP with the frozen flows (`x`, `k`, `t`, `v`).
  When the model has a `flowHint` (the automatic sizing already computed the same, section 2.0),
  it tries that first: when feasible, that is the result, without rounds. Same constraints as
  below, only the objective differs. Result: a source splits its output equally between the
  requesters, a consumer gets equally from its sources, the surplus goes to the others (two
  smelters → one factory: 240 + 240; a1,a2 → b1, a2 → b2, a2,a3 → b3: a2 splits in thirds). When
  it cannot be computed (e.g. a cyclic, unbounded flow), the `optimal` result is shown, with a
  message. About 100 ms for 260 links.
- **`optimal`**: a single LP, with the objective below (the original calculation).

**Variables:** `f|<link>` (flow), `t|<transfer>`, `x|<factory>` (effective count, 0 … count),
`v|<node>` (virtual cargo counterpart).

**Constraints:**

```
factory output:             Σ outgoing f ≤ per-machine × x
factory linked input:       Σ incoming f = per-machine × x      (takes what it processes)
factory unlinked input:     none (assumed supplied)
mine output:                Σ outgoing f ≤ nominal production
rail line, per item:        Σ in = Σ out;  manual mode: Σ all incoming ≤ capacity
manual rail (node pair):    Σ f on the rail's links ≤ the sum of the rail set   (row: lkc|<rail key>)
pass-through storage:       Σ in = Σ out + k     (k ≥ 0: the excess accumulating in it, "positive")
sink storage:               none (everything fits)
Dispatcher:                 Σ in − t − v = 0,       t ≤ throughput,  v ≤ virtual capacity
Receiver:                   Σ out − Σ t − v = 0,    Σ out ≤ rail outputs × best rail,  v ≤ virtual capacity
outgoing / incoming rail:   Σ in − t = 0  /  Σ out − t = 0   (per item)
```

**Objective (`optimal`, maximised):** every unit reaching a factory input is worth 1; what stays
in storage (goes into a sink, or the excess `k` of a pass-through storage) 0.5 – so the factories
are served first, and a storage passes on what it gets, the excess accumulating in it; one
machine of work (x) is worth 0.001 (the factory works as much as it can, with unlinked inputs
too); every flow and transfer costs 0.0001 (no needless circulation). A virtual receiver is worth
almost as much as a factory input (its material is consumed elsewhere); a virtual dispatcher
costs like a transfer.

**Effective output:** a factory's `x` is the ratio of its tightest linked input (when everything
arrives, `x` = count). Its output is per-machine × `x`, so after a short factory the next
factory's input is short too. **Bottleneck** (`supplyGaps`): on a linked factory input the
shortage = nominal − incoming − the free supply of its sources (backwards over its links – on a
manual rail at most the rail's free capacity (with all its items) –, through rail lines (with
manual capacity), storages (the accumulating excess too), cargo (with throughput, plus the free
capacity of a virtual dispatcher), inter-base rails; for a factory effective production − taken,
for a mine nominal − taken). When it is 0, the input gets less only because the factory works
less due to another input. An estimate: several consumers each see the full free supply of a
source.

**Result:** `linkFlow` (link → flow), `transfer`, `portFlow` (port → total incoming / outgoing),
`activity` (factory → effective count), `supplyGap` (linked factory input → missing supply),
`virtual` (cargo node → what its virtual counterpart takes / gives), `lineDemand` (full manual
rail line → what would pass without a limit; congestion and proportional split: 5.4),
`railDemand` (full manual rail – rail key → what would pass without a limit, all its items
together; 5.3). Noise below 10⁻⁶ is zeroed. When there is a full manual rail (rail line or link),
a second calculation (with the same distribution) without the manual rail limits gives
`lineDemand` / `railDemand`. While balancing the manual rail capacities do not limit, and a
pass-through storage keeps in = out (it does not accumulate).

### 2.0 Automatic machine count (`autoFactoryCounts`, `projectModel.ts › buildSizedModel`)

The counts of the automatic factories (`Factory.auto`, the default) come from the supply, before
the flow:

1. the model with the typed counts (`buildModel`);
2. sizable automatic factory: it has a linked input with a rate (an unlinked input "is supplied",
   nothing to size from). Their counts are "unlimited" at once (`AUTO_CAP` = 10,000), and the flow
   is computed with the configured distribution (with `even` only the sub-networks containing such
   a factory); the effective count `x` = what the material reaching the inputs feeds;
3. count = `max(1, ⌈x − 0.001⌉)` (X full + 1 partly working; the 0.001 is against noise); when `x`
   reaches half the cap (a cyclic chain), there is no sizing;
4. the model again with the computed counts (`buildModel(…, autoCounts)`; `ModelNode.countMode`:
   `manual` / `auto` / `auto-fallback`), and with the even distribution the flow of step 2 as a
   `flowHint`: rounding up does not limit, so the distribution is the same (the max-min fair
   allocation is unique and stays within the narrower range), the flow calculation only checks it.

The plan (`plan.ts`) reports what is missing on the tight linked input of an `auto` factory
because of the rounding as `partial` (the `gap` is 0, it is not a shortage); when the factory gets
nothing (`x` ≈ 0), that stays a shortage. While balancing an `auto` factory is adjustable (the
demand passes through it down to the mines), but its count is not written
(`useEditorActions › balance`). Time: the sizing costs about one even calculation (160 links in
one connected ring: ~230 ms in total; the flow ~5 ms thanks to the `flowHint`).

### 2.1 Balance (`solveFlows(model, adjustable)`)

The same LP, but the counts of the given factories and mines (`c|<node>`) are variables too, and
the **consumer demand pulls** them: minimise

```
factory input:        Σ f + s = c × per-machine demand            s: shortage
adjustable output:    Σ f + u = c × per-machine production         u: surplus (on a linked output only)
fixed source:         Σ f + u − w = nominal   (fixed factory / mine)   w: "virtual" extra
Receiver, incoming rail:  Σ out − t − w = 0
objective:  10⁶ · s (linked input) + 10³ · s (unlinked) + 10 · u + 1 · w + 0.01 · c + 0.0001 · f
```

The non-adjustable sources (fixed mine, fixed factory, Receiver, incoming rail) may give more
virtually for the sizing, and the cargo throughput does not limit either: so every adjustable
count becomes what its consumers need, even when the source is short. The real shortage then
shows in flow mode at the bottleneck (e.g. "Titanium Bar: too little Titanium Ore arrives" when
the Receiver has no Dispatcher). Growing an adjustable producer is cheaper than the virtual extra,
so where possible the start of the chain grows. A virtual cargo counterpart keeps its capacity
while balancing (it is its defining limit).

Fixed (`isChainEnd`): a node without an outgoing link, or with links only into storage (the end of
the chain, the player's goal), and a custom-output mine. It works across several bases (with the
cargo and rail transfers).

**Small example.** A Titanium Bar factory (Smelter, 60 ore → 60 bars per machine), count fixed at
1.5 (the end of the chain). An Ore Excavator (Titanium Ore, Normal, 120 /min per building) is
linked to its input:

```
c_mine × 120  ≥  1.5 × 60 = 90   →   c_mine = 0.75
```

If the mine had a fixed custom output of 60, a shortage of 30 would remain on the factory's input,
and balancing reports it.

## 3. Build chain (`chain.ts › planChain`)

Input: the demands (item, rate, which node's input), the free sources of the base (surplus,
unlinked output; Receivers and incoming rails taken as unlimited), the enabled recipes and the
optimisation goal. A recipe-choosing LP:

```
variables:  r|recipe (count), m|item (mine: the first non-upgraded mine building,
            default purity), e|source (≤ free rate), i|item (shortage)
per item:   Σ production − Σ consumption ≥ demand
objective:  Σ weight × (r, m) + 10⁻⁶ × e + penalty × i
            weight: fewest buildings → 1; lowest power → power + 0.01;
                    upgraded building ×1000 (only as a last resort)
            penalty: 10⁶, or 10⁹ when a recipe or mine exists for it (the shortage should show at the raw material)
```

The positive `r` / `m` values become factories and mines (exact counts). The links per item: the
producers are split greedily among the consumers (`flows.ts › allocateFlows`, few links). The
**depth** (how many steps from the consumer, longest path) gives the column: the new nodes go to
the left of the consumer, stacked per column.

## 4. Upgrade (`upgrades.ts › upgradeOptions`)

Up the building's `upgradeOf` chain (upgrades, every level) and down (ancestors). For a factory
the options are every recipe of the new building with the same main product; for a mine the new
mine, when it mines the same item. When switching, the count stays; the links of items that no
longer fit are deleted (`useEditorActions.ts › upgrade`).

## 5. Base plan (`plan.ts › buildBasePlan`)

The drawable graph of one base, from the model and the flow.

### 5.1 Ports

Every port has: `rate` (nominal for a factory or mine; the flow for a pass-through node), `flow`
(what actually arrives / leaves), `gap` and `linked`; a factory also has `effective` (per-machine
× effective count):

- linked factory input: `gap` = the bottleneck shortage (`flow.ts › supplyGap`); unlinked input:
  `gap` = nominal ("not linked", Build chain builds for it),
- factory output: `gap` = effective − flow (surplus on a linked output, the product on an unlinked
  one),
- mine output: `gap` = nominal − flow,
- on the tight linked input of a factory with an automatic count (`countMode: 'auto'`) the part
  missing because of the rounding is `partial` (the `gap` is 0): not a shortage, amber "tight −X"
  in the box; when the factory gets nothing, it stays a shortage,
- tiny differences from rounding the count (< 0.001 /min) do not count.

### 5.2 Nodes

| Kind (`kind`) | Extra data (`special`) | Warning |
|---|---|---|
| `factory` | – (`recipe`, `building`, `upgradable`, `effectiveCount`, `utilization`, `countMode`) | the recipe is no longer in the data; more inputs than `maxInputs` |
| `mine` | purity, per-machine rate, total, taken | the mine does not mine the item |
| `receiver` | pairs, received amount, output limit, `virtual` (virtual dispatcher: mode, capacity, flow) | no item / no Dispatcher (suppressed with a virtual dispatcher) |
| `dispatcher` | pair, sent, throughput, `virtual` (virtual receiver: mode, capacity, flow) | no item / not paired (suppressed with a virtual receiver) / overridden in 1:1 |
| `storage` | capacity, in / out, excess (`excess`), state (`balanced` / `positive` / `sink`), time until full, whether the outgoing manual rail is full | no item |
| `railIn`, `railOut` | other base, total (for the rail tier) | no item |
| `line` | rail line: total flow, unlimited demand, rail (`rails.ts › lineRail`), congestion; `freeRows` (free inputs) | congestion; more items than inputs |

Pieces to place (`placed`) = the count rounded up; **power** = `placed` × the building's power
(`config.ts › POWER_USES_ROUNDED_COUNT`; a fractional machine is a whole one). A Receiver's output
rate = received + virtual flow.

### 5.3 Edges

Every valid link is an edge with its flow and its **rail**. There is one rail per node pair
(`ProductionPlan.linkRails`, `PlanRail`: its links / items, `total` = Σ flow, `demand`, `choice`);
the edge has `railKey`, `railTotal`, `railItems`, `demand` and the rail `rail` (`RailChoice`,
`rails.ts › linkRail`) – the edges on the same rail all show the same, and the summary counts the
rail once.

A `RailChoice` is a **rail set**: `parts` (count per tier, in increasing capacity order), `tier`
(the best), `count` (all rails), `capacity` (the sum), `load`, `congested`, `needed` (an automatic
set enough for the demand). Label: `railLabel` / `partsLabel`, e.g. "2× v.1 + v.2 + 4× v.3".

- **automatic** (no `Link.rail`; `chooseRail` / `autoParts`): when one rail is enough, the smallest
  tier with capacity ≥ the flow; otherwise as many of the best available as go full, and the
  smallest tier that carries the remainder (600: v.3 + v.1). Not an error: the label is amber, the
  line is not red; `summary.parallel` counts it.
- **manual** (`Link.rail` = `[{ tier, count }, …]`, mixed allowed): `capacity` = the sum; the flow
  can be at most that (LP, for all its items together). `demand` = the unlimited flow
  (`railDemand` when full; otherwise the flow). `congested` = `demand` > `capacity` (+ tolerance):
  red line and label; `needed` = which rails would be needed. When the capacity is enough (it may be
  more), no red. `summary.congestedLinks` counts it.

An automatic rail without flow has no rail (dashed line). The links into and branching from a
rail line are rails too (one per node pair, with several items).

**Drawing** (`layout.ts › positionGraph`, `GraphEdge/`): **one line** per rail (`PositionedEdge`:
`edges` – the rail's edges per item, `rate` – the sum, `points`, `stubs`). With several items there
is a comb point next to each end (10 px from the ports) in the middle of the port rows; the shared
segment runs between them, and one stub per item (in the item's colour) leads to the ports ("comb").
The label shows the item icons side by side (`labelBoxWidth(…, icons)`), the sum and the rail. For
label placement the shared start / end point counts as a fork.

**Distribution** (`rails.ts › railDistribution(rate, parts, …)`, the link window, `LinkEditor/`):
the rail's flow across the parallel rails *evenly* (every rail equally loaded: it gets in
proportion to its capacity), or *fill + remainder* (full from the largest rails, the remainder on
the smallest free rail that carries it, the rest empty). The machine count per rail is
proportional to the rail's flow (`machinesPerRate`; the same item ratio on every rail): for a
**receiving** machine the tightest of its items on the rail decides (min(flow / per-machine
demand) – the bottleneck; the rail serves that many machines), for a **source** as many machines
as produce every item (max). For a congested manual rail it distributes the demand over the
`needed` rails.

**The ends of the rail** (`components/linkEnds.ts › describeEnd`): machine (count, bottleneck),
storage (gives as much as it gets; balanced / positive, `storageState.ts`), cargo (Receiver: the
tightest of the Dispatchers' throughput, the Receiver's output limit and the rail's manual
capacity sets the pace, or the virtual dispatcher when unpaired; Dispatcher: throughput vs. the
rail, plus the virtual receiver), rail line (the items of the branch rail), inter-base rail
(total). A non-machine end has no machine count.

### 5.4 Rail line (`line`)

A collector: a drone rail (or several parallel ones, with mixed tiers) carrying several items from
several sources; a node on the canvas. It also replaces the old shared rail (`bus:`).

1. **Ports** (`projectModel.ts`): its items come from the linked links, in link order; input =
   output, in the same row. With a fixed input count (`slots`) a full line accepts no new item
   (`lineHasFreeSlot`, `canAcceptInput`).
2. **LP** (`flow.ts`): per item Σ in = Σ out. In manual mode Σ all incoming ≤ capacity
   (`ModelNode.capacity` = the sum of the `RailLine.rails` rail set, `rails.ts › manualLineCapacity`).
3. **Congestion**: when a manual line is full, a second calculation without the manual rail limits
   says how much would pass (`FlowResult.lineDemand`). With the even distribution the items share
   the capacity equally anyway; with `optimal` a third LP splits it per item in proportion to the
   demand (otherwise the LP might give it all to one item). While balancing the capacity does not
   limit.
4. **Rail** (`rails.ts › lineRail`, `RailChoice`): automatically a rail set chosen for the total
   flow (`autoParts`; without flow the smallest tier). In manual mode the configured rail set;
   `needed` = the set enough for the demand. The summary shows the line's rail set; the congestion
   separately (`summary.congested`).

### 5.5 Summary

- Buildings per type: exact (fractional) number, "to place" (rounded up per node, added up), power.
- Build cost (`buildCost`): per building type the "to place" count × the building's `cost`, added up
  per item (`buildCostOf()`); rails are not included. Buildings without a `cost` go to the
  `unknownCost` list.
- `shortages` (on a factory / mine input, linked or not), `products` (unlinked output, going into
  storage), `surplus` (the remainder of a linked output).
- Whole project: the `projectSummary` of `usePlanner` adds up the buildings of every base.
- Rail segments per tier (with parallel rails the count; a manual rail even without flow),
  `parallel` (automatic rails needing several parallel ones – information), `congested` =
  `congestedLines` + `congestedLinks` (congested manual rails – an error).

## 6. Geometry (`nodeGeometry.ts`)

The **only** place that decides the node size and the port positions. The edge routes, ELK and the
drawing components all work from it, so a line always ends exactly in the icon.

```
┌──────────── header 26 px ────────────┐
│ padding 8                             │
│ item rows: rows × rowHeight,          │   inputs on the left edge,
│   vertically centred                  │   outputs on the right edge
│ footer: footerLines × 16 px           │
│ padding 8                             │
└───────────────────────────────────────┘
```

Per kind (`KIND_SPEC`) the width, row height, minimum body height and number of footer lines:
factory 280 px with 30 px rows; mine / Receiver / Dispatcher / storage 236 px with two footer
lines; inter-base rail 224 px; rail line 264 px with 28 px rows and two footer lines (total flow /
capacity, state); below the ports come the empty rows of the free inputs (`freeRows`), and the
ports then align to the top. **A new node kind must get a row here.**

## 7. Positions and edge routes (`layout.ts`)

- **`positionGraph(plan, positions, offset)`**: the nodes go to their positions stored in the
  project (while dragging, the selected ones shifted by `offset`). A node without a position goes
  temporarily below the others, in a row, and into the `missing` list.
- **Edges (`routeEdge`)**: output (right edge) → input (left edge), with orthogonal bend points.
  When the target is to the right: horizontally out, vertically half-way between the two,
  horizontally in. When to the left (backwards): out to the right by 22 px, down below both nodes,
  to the left, up to the target's height, in.
- **Bounding box** (`bounds`): Fit zooms to it.
- **`autoLayout()`** (ELK, `layered`, left to right, `FIXED_POS` ports): for nodes without a
  position (an old project, an incoming rail created from another base – `usePlanner` runs it
  automatically and stores the result) and for the "Automatic layout" menu item (the base or the
  selection; the selection keeps its top-left corner). Mines and incoming rails go to the first
  layer, outgoing rails to the last; cycles are broken `GREEDY`; unconnected parts are stacked.
  Spacing: from the Settings panel.

## 8. Line style (`edgePaths.ts`)

All three styles work from the same points; only the corners differ.

| Style | How |
|---|---|
| Square | the points joined with straight lines |
| Rounded | a small quadratic arc per corner (radius ≤ 10 px and ≤ half of the neighbouring segments) |
| Curved | every vertical "step" becomes an S-shaped cubic Bézier, starting and ending with a horizontal tangent (it reaches out at most 90 px) |

**Labels** (`edgePaths.ts › placeLabels`, called by `ProductionGraph`): all edge labels are placed
together, so they do not overlap. Candidate positions per edge: horizontal segments (at a fork –
several edges from the same port – the target-side ones first, because on the shared first segment
they would all overlap; at a merge the source-side ones; otherwise the longest), per segment the
middle, the thirds, towards the ends, avoiding the curved parts of the corners; finally the middle
of the vertical segments. Greedy: the first position that collides neither with a placed label nor
with a node; when there is none, the one with the least overlap. The label width is an estimate
(`labelBoxWidth`), and the drawing uses the same.

## 9. Drawing and editing (`ProductionGraph/`)

Drawing order (SVG, bottom to top): grid → edge lines → cargo pair markers → edge labels → nodes →
selection box / dragged link.

| Node kind | Component |
|---|---|
| `factory` | `GraphNode/` |
| `mine`, `receiver`, `dispatcher`, `storage`, `railIn`, `railOut` | `SpecialNode/` |
| `line` | `LineNode/` |

The components put `data-node-id` on the root `<g>`, `data-port-dir` / `data-port-item` on the
item rows, and `data-link-id` on the edges: from these the canvas knows what was clicked and where
a dragged link was dropped (`elementFromPoint`).

| Mouse / key | What it does |
|---|---|
| left button on a node | select (Shift / Ctrl: add / remove), drag to move (the selection together, snapped to the grid); click: editor |
| left button on a factory's count / its `auto`–`manual` pill | type the count in the box (`foreignObject` input; Enter / click elsewhere: manual count, Esc: cancel; nothing typed: no switch) / toggle auto ↔ manual (to manual with the current number; `projectStore › setFactoryCount`). These stop `pointerdown`: they do not start a drag |
| left button on empty canvas | selection box (by intersection); click: clear the selection |
| left button on an item row | click: port picker (`PortPicker/`); drag onto a node: link (`useEditorActions › connect`, checks that it accepts); drag onto empty canvas: port picker with the drop point (`PickerState.drop`), see below |
| left button on a line | selects the rail (between two nodes, possibly several items) and opens its window (`LinkEditor/`: items, rail, manual rail set, distribution) |
| right button | on release, if it did not move: menu (`ContextMenu/`: canvas / node / several selected / edge); dragged: pans the view |
| middle button, Space + left button | pans the view |
| wheel | zoom around the cursor (horizontal touchpad scroll: pan) |
| Delete / Backspace | deletes the selected nodes (with their links) or the selected line – every item of the rail (`projectStore › removeRail`) |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | undo / redo (project snapshots, `projectStore › undo / redo`). Everywhere, in the editor fields too (the focused field loses focus first, so a half-typed value is committed and undone too); only in search fields (`type="search"`) it belongs to the text. The letter is the layout's character (`keyIs`; on a Hungarian QWERTZ the key labelled Z too), AltGr is not a command |
| Ctrl+A, Esc | select all; clear the selection and close the menus |
| Ctrl+C / Ctrl+V | copies the selected nodes with the links between them (`useEditorActions › copyNodes`, with the positions seen on the canvas; `projectStore › copyNodes`); pastes at the mouse position (snapped to the grid), or without the mouse shifted (`pasteNodes`). The pasted nodes stay selected. When text is selected on the page, Ctrl+C belongs to the text |

- **Link onto empty canvas**: the picker offers only what fits the port's direction and item
  (input: what makes it / mine / chain / Receiver / rail line / rail from another base; output:
  what uses it / Dispatcher / storage / rail line / rail to another base; the existing nodes at the
  end). The drop point snaps to the grid, and within 2 grid steps of the port height it is aligned
  with it (`dropPoint`). The `add*` actions with a `drop` parameter place the new node so that its
  linked port (`nodeGeometry › portPosition`) lands exactly there (`useEditorActions › newNodeAt`);
  for a chain the right edge and the middle of the first column go there. While the picker is open,
  a dashed line and a circle mark the spot; dragged from an input the picker opens to the left.
- **Labels**: SVG text does not wrap, so the components truncate the names with `textFit.ts ›
  fitText()` ("…"); the full name stays in the `<title>` tooltip.
- **Line** (one rail, possibly several items): width on a square-root scale (1.5 + 5·√(the rail's
  flow / the largest)), colour = the item's colour (with several items the shared segment is
  neutral, the stubs keep the item colours), without flow thin and dashed. Rail label: automatic
  single rail grey, automatic several rails amber ("3× v.3", "v.1 + v.3"), manual blue-framed; for a
  congested manual rail the line is red and dashed, the label red.
- **Link dragged from a rail line into a factory** (`useEditorActions › connect`): it also links the
  machine's other, still unlinked items the line carries – one rail carries everything.
- **Hover**: the node and its edges are highlighted, the rest dimmed; for a cargo pair the pair is
  highlighted too (when in the same base). Clicking the name of a pair in another base → jump.
- **View**: zoom 10–300%. On a base change the whole content goes into the view once; on a jump the
  target node is centred and highlighted for 2.5 s.
- **Notification** (`notice.ts`): the results of Build chain, Balance and a failed link appear at
  the bottom of the canvas for a few seconds.

## 10. Performance

- Any change recomputes the model, the LP and the plans; positions are not inputs, so dragging
  refreshes only the drawing and the edge routes.
- LP size: links + transfers variables – milliseconds at the current sizes. The even distribution
  solves two LPs per round (per sub-network); the automatic count is one more such calculation,
  but the flow then uses the `flowHint` (2.0).
- ELK runs only for the automatic layout, on the main thread; for hundreds of nodes it is worth
  moving it into a Web Worker.
