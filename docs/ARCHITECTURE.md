# Architecture – developer guide

This guide shows **how things work and how they fit together**, from the business (game)
side and the technical side. It does not explain how Vue, Vite, TypeScript, ELK or yalps
work in general, only how the program uses them.

Related documents:

- [USER-GUIDE.md](USER-GUIDE.md) – how the planner is used (what the user sees)
- [GRAPH-ENGINE.md](GRAPH-ENGINE.md) – the calculation and the graph, step by step
- [CONFIGURATION.md](CONFIGURATION.md) – the fields of the data files, value sets, limits, images
- [CONTRIBUTING.md](../CONTRIBUTING.md) – setup, repository map and the checklist for a pull request

---

## 1. What the program does

A production chain editor for StarRupture. The player builds the factory on a canvas,
split into **bases** (a node editor): places factories, mines, Receivers, Dispatchers,
storages and rail lines (collectors), and joins them with **explicit links**. From this the
program computes:

- how much material moves over each link, where there is a **shortage** (too little
  arrives, or it is not linked) and a **surplus** (it is not taken),
- the **power demand** per base and for the whole project (a fractional machine counts as a
  whole one),
- the **minimum build cost** (of the buildings; without rails),
- which drone rail is needed between two nodes (one rail, possibly with several items) and
  per rail line.

Helper actions: **Build chain** (the whole supply chain of a missing input down to the raw
materials), **Balance** (the exact machine counts for the linked demand), **Upgrade**
(switching a factory / mine to its v.2 variant), automatic layout.

It has two independent inputs:

| Input | Who writes it | Where | When it changes |
|---|---|---|---|
| **Game data** – items, recipes, buildings, rails, purities | the maintainer, by hand | `public/data/` (`game.yml`, `buildings/*.yml`, `items/*.yml`) | when the game changes (patch) |
| **Project** – bases, nodes, machine counts, links, positions | the player, on the canvas | browser localStorage, JSON export | while planning, continuously |

This separation is the core principle: **replacing the game data needs no code**, and the
project survives data changes (an unknown id does not crash the program, it only warns).

**Source of the game data:** the MetaForge StarRupture pages (October–November 2026), with
English names exactly as in the game. Only part of it is there, and it will grow; uncertain
values are marked with a YAML comment ("NOT VERIFIED", "ASSUMPTION"). What is known only by
name and output (e.g. generators) is added, but not wired in. The sources and the missing
data: `DATA-SOURCES.md` (the data files never name a source). Quartz Ore is needed only for
building upgrades, Data Point only for unlocks: neither takes part in production.

**Missing data (cycle time).** When only the per-cycle quantities of a recipe are known (YAML
`perCycle`), the program never invents a rate: the recipe is `rateFrom: 'missing'`, the
factory has its ports, but with a rate of 0 (a shortage at the next factory), "Build chain"
does not use it, and the UI shows ⚠ "no data" (there will be none until the next data
update). Meanwhile the player may enter the cycle time manually; it lives in the project
(`settings.cycleTimes`, export / import), and `usePlanner` applies it to the loaded data
(`engine/missingData.ts › applyCycleTimes`, `rateFrom: 'user'`, ⚠ "manual cycle time"). Once
the data gets a certain rate, the manual value no longer applies.

---

## 2. Business concepts and their relations

### 2.1 Game data (what the game provides)

```
                        ┌──────────────┐
                        │   Building   │  type: production | miner | storage | dispatcher | receiver
                        │              │  power, cost, speed, upgradeOf, inheritRecipes
                        └──────┬───────┘
              runs             │                mines (mines: table)
     ┌─────────────────────────┼─────────────────────────┐
     ▼                         │                         ▼
┌──────────┐  input/output     │                   ┌───────────┐
│  Recipe  │ ───────────────▶ Item ◀────────────── │  Purity   │  (the key of the table)
│          │   items/min                           └───────────┘
└──────────┘
                ┌──────────┐                      ┌────────────┐
                │ RailTier │  (v.1/v.2/v.3)  ◀─── │ Dispatcher │ throughput: per rail tier
                │          │  items/min, cost     │  building  │
                └──────────┘                      └────────────┘
```

| Concept | Business meaning | Relations |
|---|---|---|
| **Item** | Anything that moves in the chain: ore, intermediate, end product, byproduct. | Inputs/outputs of recipes, products of mines. |
| **Recipe** | One kind of production of one building. Every value is **items/min for one machine**. | Belongs to one building; has one main product (`product`), may have byproducts. |
| **Building** | A kind of machine. `type` decides its role. | Production: runs recipes. Mine: gives material. Special: stores / sends / receives. |
| **Upgraded building** | The v.2 is a separate building with an `upgradeOf` reference. | The StarRupture v.2 production buildings have their own recipe lists; a placed factory node can be switched to it (for the same product). With `inheritRecipes: true` it also runs every recipe of the base building with the `speed` multiplier. No locking. |
| **Purity** | The purity of the mine node (deposit): Impure / Normal / Pure. | The keys of the mine's `mines:` table. Not every item has all of them. |
| **Build cost** (`cost`) | The materials needed to place one building. | The summary multiplies it by the number of buildings to place. The cost of a rail piece (`rails[].cost`) is information only. |
| **RailTier** | Drone rail throughput in items/min. | Per rail (between two nodes) and per rail line an automatic rail set, or a manual, mixed one (e.g. 2× v.1 + v.3); the Dispatcher throughput may depend on it. |
| **Features** (game rule switches) | Patch-dependent or uncertain behaviour: cargo 1:1 or N:1, even or optimal distribution. | The engine knows both variants, `game.yml` picks one. |

### 2.2 Project (what the player builds)

```
Project (version 2)
 ├── settings          Build chain: optimisation goal, recipes on/off; best available rail; manual cycle times
 ├── bases[]           bases (folders), each with its own canvas
 │    ├── factories[]      factories: recipe variant + machine count (fractions allowed) + auto (default true: the count comes from the inputs)
 │    ├── mines[]          mines: building, item, purity, building count, custom output (or null)
 │    ├── receivers[]      cargo receivers – source: what their Dispatchers send; virtual: virtual dispatcher (or null)
 │    ├── dispatchers[]    cargo senders – receiverId → one Receiver; virtual: virtual receiver (or null)
 │    ├── storages[]       storages – pass-through (gives as much as it gets; the excess accumulates), or sink
 │    ├── links[]          links: from node → to node, one item; rail: manual rail set [{ tier, count }] (mixed allowed) or absent = automatic
 │    ├── railLines[]      rail lines (collectors): several sources and items on one rail; mode auto / manual, rails (manual set), slots
 │    └── positions{}      node id → position on the canvas
 └── railLinks[]       inter-base rails: from base → to base, several items
```

### 2.3 Business rules (the engine implements these)

**Unit.** Every quantity is items/min for one building, as the game shows it. There is no
cycle time and no time-unit conversion.

**Machine count: automatic (default) or manual.** A factory node runs at most with its
machine count (a multiplier for the inputs, the outputs and the power).

- **Automatic** (`Factory.auto`, the default; a saved factory without the `auto` field is
  automatic too): the count comes from the available raw material (from the supply side):
  as many machines as the material reaching the linked inputs feeds, rounded up – X full + 1
  partly working one when it is not exact; at least 1. How much reaches it is decided by
  the same distribution as the flow (even: its equal share of a shared source, plus the
  unused surplus of the others). The next automatic factory follows the same way, in one
  pass. The "shortage" caused by the rounding (the last machine works partly) is **not a
  shortage**: the tight input carries `partial`, amber, not listed among the shortages; when
  nothing reaches it, that is a shortage. Without a linked input with a rate (or in a cyclic
  chain whose sizing would be unbounded) the typed `count` applies ("auto-fallback").
- **Manual**: as many as you type (fractions allowed).

In the box the count can be typed (it switches to manual), and one click toggles auto ↔
manual (to manual with the current number). The exact counts for the consumer demand are
computed by **Balance**, on request (that is the pull direction; the automatic count is the
push).

**Effective output.** When a linked input of a factory gets less than nominal, the factory
works only at the ratio of its tightest input (effective count < count): its output is lower
by as much, which is a shortage on the next factory's input – the shortage cascades down the
chain. It takes only that much from its other inputs too. An input shortage is only the
**bottleneck**: what is missing to the nominal rate and the free production of its sources
could not make up either (an estimate: when several consumers share the free production of a
source, each of them sees all of it). An **unlinked input is assumed to be supplied** (it is
just not linked yet): it does not reduce the output, but it is marked "not linked". Power and
the machines to place come from the configured count (the machine is placed, even if it does
not work fully).

**Material moves only over links.** One output can be linked to several consumers, one input
to several producers. The flow is computed for all bases together (independent sub-networks
separately).

**Distribution: even, no priority** (`features.flowDistribution: even`, the default). A
consumer requests from the network, and everyone linked serves it: a source splits its output
equally between the requesters, a consumer gets equally from its sources, and the surplus
(what someone does not request, or cannot take) goes to the others – a max-min fair allocation
of the link flows. E.g. two smelters → one factory: 240 + 240 (not 480 + 0); a1,a2 → b1,
a2 → b2, a2,a3 → b3: the output of a2 splits in thirds, b2 falls behind. A storage requests the
same way (factories have no precedence). The rule is experience-based, not confirmed; with
`optimal` the old calculation applies: as much as possible reaches the factory inputs, the
rest goes into storage (sink, or as the excess of a pass-through storage). The game's Drone
Request Priority (Low / Med / High) is not modelled yet.

- *Shortage*: on a factory input the nominal demand − what actually arrives. For an unlinked
  input the whole demand.
- *Surplus*: on a linked output the nominal production − what is taken.
- *End product*: an unlinked output, or what goes into storage and stays there (sink, or the
  excess of a pass-through storage).

**Mines.**

- A mine is a source: it has no input. Output = building count × the rate of the purity, or
  the manually entered **custom output** (one node can stand for all such mines).
- The purity belongs to the mine node, not to the machine – so there is no separate building
  per purity (see the header of `engine/mining.ts`).

**Power and count.** The number of placed machines per node is the machine count rounded up
(1.5 → 2): **a fractional machine is a whole one**, because it is placed, it just does not
work at full power. Power, the number of buildings to place and the build cost come from it.

**Cargo (Dispatcher → Receiver).**

- Link the producers to the Dispatcher's input, and the consumers from the Receiver's output.
  Pairing is by name, in the editor (no line joins them).
- **1:1** by default: a Receiver can have one Dispatcher; a new pairing overrides the old one
  (the game's "override" behaviour). With `features.cargoManyToOne: true` N:1.
- The pace is set by the tighter of the cargo throughput and the capacity of the attached
  rail. The Dispatcher's feed rail (for the throughput): the chosen one (`feedRail`); when
  automatic, the tier of the incoming link's manual rail (`attachedFeedRail`); otherwise the
  best available one.
- The transfer is at most the Dispatcher's throughput (`throughput`, by feed rail); a
  Receiver's output is at most `railOutputs` × the best available rail.
- A pair within the same base works too.
- **Virtual counterpart** (`VirtualCargo`, `Dispatcher.virtual`, `Receiver.virtual`): an
  unpaired Dispatcher (no Receiver, not overridden) can send to a *virtual receiver*, and a
  Receiver without a Dispatcher can receive from a *virtual dispatcher*, so they compute
  without the other side. Modes: `rail` (fixed by the rails: the Dispatcher throughput by
  feed rail, or the Receiver's `railOutputs` × best rail; unlimited when there is no rail
  data) or `custom` (a typed rate). The item is not configured: it is the node's item, from
  the linked material. It applies only while the node is unpaired; once paired, the real
  transfer replaces it.

**Inter-base rail.** An outgoing node in the source base, an incoming node in the target base;
it can carry several items, dragging a link adds the item to its list. Its capacity does not
limit the calculation, only the rail tier is shown.

**Transport within a base.**

- Every link runs on a drone rail, and **one rail carries several items**: the links between
  the same two nodes (one per item) are one rail, one line on the graph (the item icons, the
  sum), and the capacity counts their sum (e.g. the rail branching from a rail line to a
  factory carries every item the factory gets from there). The manual setting belongs to all
  links of the rail. **Automatic** (default): when one rail is enough, the smallest tier that
  carries it; when even the best available does not, as many of it as go full, and the
  smallest tier that carries the remainder ("v.1 + v.3", amber – not an error, it does not
  limit). **Manual** (`Link.rail`: a rail set with a count per tier, mixed allowed, in the
  link window): the capacity (the sum) is a limit; when the receiver would request more
  (according to the calculation without the limit), **congestion** (red line and label), and
  the receiving factory works at the ratio of its tight input. With enough manual capacity
  (it may be more than needed) there is no red.
- The link window (click on an edge) computes the distribution across parallel rails (even /
  fill + remainder) and the number of source and receiving machines per rail (in proportion to
  the rail's flow; for a receiver the tightest of its items on the rail decides, for a source
  as many machines as produce every item). For a non-machine end it shows what sets the pace:
  storage state, cargo throughput vs. rail (or the virtual counterpart), the items of the branch
  rail.
- Rail line (a node, a collector – it also replaces the removed shared rail): several sources,
  several items on one rail; per item in = out, the number of inputs is dynamic or fixed. The
  capacity counts the **total** flow (the sum of the items). In automatic mode the rail set
  follows the flow (it does not limit); in manual mode the sum of the configured, possibly
  mixed rail set is the limit; when the consumers would request more (according to the
  calculation without the limit), **congestion**: the items share the capacity equally (in
  proportion to their demand with the optimal distribution), the shortage shows at the
  consumers. The links into and out of (branching from) a rail line are rails too, one per node
  pair, with several items.
- Storage: with an outgoing link it is pass-through – it gives as much as it gets; when more
  goes in than out (the consumer requests no more, or the outgoing rail is smaller) it is
  **positive**: the excess accumulates in it (with the optimal distribution it is worth half of
  what reaches a factory, so the factories are served first; with the even distribution the
  storage requests like the factories); in = out: **balanced**. Without an outgoing link it is
  a sink. While balancing, a pass-through storage keeps in = out (it does not accumulate).

**Balance.** One LP where the machine counts of the selected factories and mines are variables
too, pulled by the consumer demand. These stay fixed: the end of the chain (whose output is not
linked, or only goes into storage – the player's goal) and a custom-output mine. Non-adjustable
sources (fixed mine, Receiver, incoming rail) may give more "virtually" for the sizing, and
neither the cargo throughput nor the manual rail capacities limit: so the counts follow the
demand, and the real shortage then shows at the bottleneck (e.g. at the raw material). Goal: no
shortage, no surplus on linked outputs, and as few machines as possible. An automatic factory is
adjustable in the calculation (the demand passes through it down to the mines), but its count is
not written: it follows the new counts of its sources by itself (the count of a factory with
nothing to size from is written, since it applies). Balancing one factory (editor, node menu)
switches it to manual first.

**Build chain.** For a missing input of a factory (or for the targets of an old project) a
recipe-choosing LP: from the enabled recipes, with base buildings (the recipe of an upgraded
building costs a thousand times more), using the free sources of the base (surplus, Receiver,
incoming rail) first, placing a mine for the raw material. Optimisation goal: *fewest buildings*
or *lowest power*. The placed nodes are linked, their counts are exact.

**Copy / paste.** The selected nodes (Ctrl+C) go to the clipboard with the links between them
(in memory; with their positions as seen on the canvas). Pasting (Ctrl+V, at the mouse position,
or shifted) gives new ids and names; a Dispatcher keeps its pair only when its Receiver came
along (otherwise, with the 1:1 rule, it would take the original's pair); inter-base rail ends
cannot be copied. The pasted nodes stay selected.

**Upgrade.** A factory node can be switched to the upgraded (or base) variant of its building,
to a recipe making the same product. The count and the links stay; the link of an item the new
recipe does not use is deleted. The Upgrade button (editor, right-click menu) is always shown for
factories and mines; when there is no upgraded variant it is disabled with a note ("This factory
(…) has no upgraded variant").

---

## 3. Technical structure

### 3.1 Layers

```
public/data/*.yml ─┐
                   ▼
        ┌─────────────────────┐        ┌────────────────────────────┐
        │ data/   (loading)   │        │ project/  (project state)  │
        │ loader.ts → GameData│        │ projectStore, sanitize     │
        └──────────┬──────────┘        └─────────────┬──────────────┘
                   │                                 │
                   ▼                                 ▼
        ┌─────────────────────────────────────────────────────────┐
        │ engine/   plain TypeScript, no Vue                      │
        │ projectModel → flow → plan (+ rails, mining, cargo,     │
        │ upgrades) → nodeGeometry → layout → edgePaths;          │
        │ chain (Build chain)                                     │
        └──────────────────────────┬──────────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────────┐
        │ composables/  usePlanner (calculation pipeline),        │
        │               useEditorActions (composite actions)      │
        └──────────────────────────┬──────────────────────────────┘
                                   ▼
        ┌─────────────────────────────────────────────────────────┐
        │ components/   canvas, menu, port picker, editor,        │
        │               panel (overview)                          │
        └─────────────────────────────────────────────────────────┘
```

**Dependency rules** (worth keeping):

- `engine/` imports neither Vue nor components. Its input is `GameData` / `GameIndex` and the
  `Project`, its output plain objects. So it runs (and is tested) from Node (tsx).
- `engine/` uses only types and the id builder `nodeIds` from `project/types.ts`, never the store.
- Components reach the state through `usePlanner()`, `useProject()` and `useEditorActions()`,
  and change it with their functions. They write directly (`v-model`) only simple fields:
  display settings, project settings, opening the editor (`editing`), selection. Anything that
  carries a rule (pairing, deletion with clean-up, linking with item adoption) lives in the store.
- `config.ts` is the only shared constants module (labels, tolerances, power rounding).

### 3.2 State

There is no Pinia: there are **module-level singletons**, created when the module loads; every
component sees the same.

| Module | What it holds | Note |
|---|---|---|
| `project/projectStore.ts` | `project`, `activeBaseId`, `editing`, `selection`, `selectedLink`, `focus`, `clipboard` (copy, memory only), undo | Every change goes through it. Saving: `localStorage['starrupture-planner.project']`, debounced by 300 ms. Undo: JSON snapshots of the project (merged per 250 ms, 60 steps); the program's automatic changes (placing nodes without a position, converting an old project) are not separate steps (`withoutHistory`), otherwise they would happen again right after an undo. After an undo the editor stays open if the element still exists. |
| `composables/usePlanner.ts` | `gameData`, load state, `display` settings, the calculation pipeline, `dragOffset` | Display: `localStorage['starrupture-planner.display']`. |
| `composables/useEditorActions.ts` | (no state) | Chain, balance, upgrade, arrange, port picker actions, copy / paste; converting an old project after loading. |
| `components/notice.ts` | the current short notification | |

Renaming the localStorage keys would lose the saved projects and settings, so they are part
of the persisted identifiers (3.6). The format version lives inside the project JSON
(`Project.version`), not in the key.

The feedback between the store and the planner: the planner sets the store's cargo rule from the
`game.yml` switch (`setCargoRules`), and lays out nodes without a position automatically
(`setPositions`).

### 3.3 Calculation pipeline (`usePlanner.ts`)

```
gameData ──▶ index (GameIndex)
                │
project ────────┼──▶ model      = buildSizedModel(...)       ← nominal ports, links, transfers, auto counts
                │        │
                │        ▼
                │     flow       = solveFlows(model)         ← ONE LP, all bases
                │        │
                │        ▼
                └──▶ basePlans  = Map<base id, buildBasePlan(...)>   ← for every base (for the summary)
                         │
                         ▼
                     plan        = the active base's
                         │
                         ▼
                     layout      = positionGraph(plan, positions, dragOffset)   ← edge routes
```

- Every step is `computed`. Node **positions are not an input** of the model and the flow, so
  dragging recomputes only the `layout`; while dragging the positions live in `dragOffset`, they
  reach the project only at the end of the drag.
- When a node has no position (an old project, an incoming rail created from another base), a
  `watch` runs an automatic layout (ELK, asynchronous) and stores it.
- Details: [GRAPH-ENGINE.md](GRAPH-ENGINE.md).

### 3.4 Data loading and live reload

1. `loadGameData()` fetches `data/game.yml`, then the other file names from it, in parallel.
2. It validates and normalises: unknown field, misspelt id (with a Levenshtein suggestion),
   wrong type. A field-level error → a **warning**, the element is skipped, the rest works. A
   YAML syntax error or a missing file → **LoadError**, the previous data stays.
3. It flattens the recipes written per item into a list, and creates recipe variants for the
   upgraded buildings with `inheritRecipes: true` (`<recipe id>@<building id>`). The build costs
   (`cost`) are resolved after the items are loaded.
4. Icons are checked in the background (HEAD requests), so the graph shows meanwhile.

In development mode the `gameDataWatcher` plugin of `vite.config.ts` watches the `public/data/`
and `public/icons/` folders and sends a `game-data-changed` event; the planner then reloads
without a page refresh (the project stays). In a production build the `dist/data/` files are
editable, and the "Reload" button reads them.

After the first successful load `initProject()` decides: the saved project from the browser, or
the `startProject` file of `game.yml`, or an empty base with the `defaultTargets` (a chain is built
from them, like for an old project).

### 3.5 Reading projects, old projects, saving

- From any source (localStorage, import, starter file) `sanitizeProject()` reads: lenient, it
  fills in missing fields, skips broken elements with a warning; it removes links and positions
  that point to non-existent nodes.
- **Old rail line (with stops):** sanitize converts it: whatever link ran along the line (the
  producer's stop before the consumer's) becomes producer → rail line → consumer; the junctions
  between lines disappear, the configured tier becomes manual mode.
- **Old (v1, target-driven) project:** sanitize returns the targets and the mines with an
  automatic count (`legacy`). After loading, `useEditorActions` builds the factories from the
  targets with a chain (using the base's mines, Receivers and incoming rails as sources), links
  the Dispatchers, storages and outgoing rails to their producers, and balances the counts. The
  shared-rail routes disappear.
- Export: the project JSON as is. Import: the same, back.

### 3.6 Identifiers the saved project relies on

These appear in the project JSON, so **changing them breaks old projects**:

| What | Format | Referenced by |
|---|---|---|
| Node | `fac:<id>`, `mine:<id>`, `recv:<id>`, `disp:<id>`, `store:<id>`, `railin:<rail id>`, `railout:<rail id>`, `line:<id>` (`project/types.ts › nodeIds`) | links (`Link.from/to`), positions (`Base.positions`) |
| Recipe variant | the YAML `id:` (`<item>_<building>`), with `inheritRecipes` `<id>@<building>` | `Factory.recipe` |
| Logical recipe id | the YAML `id:`; without it the first recipe = item id, the others `<item>_2`… | `settings.recipeOverrides` |
| Item / building / purity id | the YAML key | every project field |
| Browser storage keys | `starrupture-planner.project` (the project), `starrupture-planner.display` (display settings) | `projectStore.ts`, `usePlanner.ts` – renaming them loses the saved data |

Internal (not saved) ids: port `<node>|in|<item>` / `|out|` (`flow.ts › portKey`); LP variables
`f|<link>`, `t|<transfer>`, `x|<factory>`, `v|<node>`, `c|<node>`; transfers `c:<dispatcher>`
(cargo) and `l:<rail>:<item>` (inter-base rail).

### 3.7 File map with responsibilities

| File | Responsibility | Business rule living here |
|---|---|---|
| `data/types.ts` | Game data types | – |
| `data/loader.ts` | YAML → GameData, validation | field names, value sets, converting the old `time` format, `inheritRecipes` inheritance, `cost` resolution |
| `project/types.ts` | Project types, node ids, `emptyBase`, `defaultSettings` | – |
| `project/projectStore.ts` | State, every change, undo, saving, copy / paste | 1:1 override, link → item adoption, clean-up on delete (links, positions, pairings), new ids and names on paste, the pair kept only with its copied Receiver |
| `project/sanitize.ts` | Reading a project, preparing the v1 conversion | defaults, lenient `virtual` reading |
| `engine/gameIndex.ts` | id → object, net recipe rate | rate × building speed |
| `engine/rateTable.ts` | "A single number or per variant" values | a picker only with 2+ variants |
| `engine/mining.ts` | Mine rate, purities, default purity | purity ↔ mine node |
| `engine/cargo.ts` | Dispatcher throughput, Receiver output limit | throughput by feed rail |
| `engine/projectModel.ts` | Project → model: nominal ports, links (manual rail capacity), transfers, cargo pairs, virtual cargo; `buildSizedModel` (with the computed counts of the automatic factories) | 1:1 / N:1, count × rate, automatic / manual count, custom mine output, what a node accepts, a link through a rail line has no rail limit of its own, virtual counterpart only when unpaired |
| `engine/flow.ts` | Flow: even distribution (progressive filling with LPs, per sub-network) or LP optimum; automatic count (`autoFactoryCounts`); balancing (counts as variables); virtual cargo variables | automatic: from the material reaching the inputs, rounded up, min. 1; even: max-min fair; optimal: factory inputs first, storage after; chain end fixed; manual rail (rail line, rail between two nodes) limit and congestion |
| `engine/chain.ts` | Build chain: recipe-choosing LP, nodes to place | base buildings preferred, existing sources preferred, a mine for the raw material |
| `engine/flows.ts` | The links of the chain (greedy split) | few links |
| `engine/upgrades.ts` | Upgrade / downgrade options | the same product / item |
| `engine/plan.ts` | Base graph: nodes, ports, edges, summary; `buildCostOf()` | shortage, surplus, end product, power (fractional machine = whole), build cost, rail tier per edge |
| `engine/rails.ts` | Rail set choice, manual (mixed) rail set, distribution | the smallest fitting tier, the best ones full + a smaller one for the rest (not an error), manual rail congestion, even / fill + remainder distribution, machines per rail |
| `engine/nodeGeometry.ts` | Node size, port positions | – |
| `engine/layout.ts` | Positions, edge routes, ELK automatic layout | – |
| `engine/edgePaths.ts` | Line styles as SVG paths, label placement | – |
| `composables/usePlanner.ts` | Loading, calculation pipeline, `projectSummary`, laying out nodes without a position | recipe enabling (for the chain) |
| `composables/useEditorActions.ts` | Place, link, port picker actions, chain, balance, upgrade, arrange, copy / paste (with the positions seen on the canvas), v1 conversion | the size and position of a new node next to the clicked one, or its linked port at the drop point (`newNodeAt`) |
| `components/ProductionGraph/` | Canvas: selection, drag, link drag, menus, keys | – |
| `components/ContextMenu/`, `components/PortPicker/` | Right-click menu; item row menu (on click, or for a link dropped on empty canvas only the fitting options, with search) | – |
| `components/EntityEditor/` | Editor: factory, mine, Receiver, Dispatcher (virtual counterpart), storage, inter-base rail; `RailLineEditor/` (rail line), `LinkEditor/` (rail between two nodes: items, rail, distribution), `RailSetEditor/` (manual rail set) | factory: count ↔ output |
| `components/panel/*/` | Side panel: overview | `SummarySection`: power, buildings, cost, end products, shortages, surplus |
| `components/*Node/`, `components/GraphEdge/` | Node and edge drawing | – |
| `components/textFit.ts` | Text width measurement (canvas), "…" truncation | long English names in fixed-width nodes |
| `styles/` | Global SCSS: tokens (light / dark), base, shared panel classes | – |

---

## 4. Code conventions

The repository is meant to read well for a newcomer on GitHub.

**Language.** Everything is English: identifiers, comments, UI text, documentation, data file
comments. Game names stay exactly as in the game.

**Component structure – pure separation.** Every component has its own folder:

```
src/components/GraphNode/
├── GraphNode.vue     <template> only, then <script lang="ts" src="./GraphNode.ts"> and
│                     <style lang="scss" scoped src="./GraphNode.scss">
├── GraphNode.ts      export default defineComponent({ name, components, props, emits, setup })
└── GraphNode.scss    scoped styles (left out when the component has none)
```

- The template stays in the `.vue` file because `vue-tsc` type-checks templates only there.
- `setup()` returns exactly what the template uses (refs, computeds, functions, constants such
  as `RATE_UNIT_LABEL`); everything else stays private to the closure.
- Props are declared with runtime types and `PropType<…>`; emits as validator objects
  (`emits: { port: (_e: PortDown) => true }`).
- **Templates are plain JavaScript expressions** – no TypeScript syntax (`!`, `as`), because the
  template compiler does not know the language of an external script. Move such logic into a
  small function or computed in the `.ts` file.
- No static inline styles: classes in the `.scss` file. Dynamic values (`:style="{ width }"`)
  are fine.
- Imports use the `@/` alias (`@/components/…`, `@/engine/…`); the engine itself keeps relative
  imports so it runs from Node without the alias.

**Styles (SCSS).** Global styles live in `src/styles/` (`main.scss` → `_tokens.scss`,
`_base.scss`, `_panel.scss`). Colours are **only** CSS custom properties defined from the
`$light` / `$dark` Sass maps of `_tokens.scss`; the `custom-properties` mixin emits the dark map
in both dark selectors (`prefers-color-scheme` and `[data-theme='dark']`). A new colour goes into
both maps. Component styles are scoped and may nest, use `&` modifiers, mixins and variables;
keep the cascade order where states override each other (e.g. a congested badge after the
manual one).

**Comments.** Every module and component starts with a JSDoc block (`@module` / `@component`)
that explains its purpose and the business rules it implements; exported functions and
non-obvious internal ones have JSDoc too. Comments say *why*, not *what*.

**Layout ("airy" code).** Enforced by ESLint (`@stylistic/padding-line-between-statements`): a
blank line before every `return`, after a group of declarations, and around multi-line blocks.
Prettier owns the rest of the formatting (`.prettierrc.json`: no semicolons, single quotes,
100 columns, 110 for `.vue`).

**Commands.** `npm run lint` / `lint:fix`, `npm run format` / `format:check`, `npm run verify`
(format check + lint + type check), `npm run smoke` (engine smoke test with tsx). The game data
(`public/`), the Markdown files and the Docker files are not formatted by Prettier (they are
formatted by hand).

**Tool versions.** The dependencies follow their latest releases (`npm outdated` shows what is
behind), with two deliberate exceptions:

- **TypeScript stays on 6.0.** TypeScript 7 (the native compiler) has no programmatic API yet,
  so vue-tsc cannot check `.vue` files with it and typescript-eslint does not accept it (peer
  range `<6.1`); both wait for the API planned for TypeScript 7.1. TypeScript 6 deprecates
  `baseUrl`, so `tsconfig.json` has `paths` only (resolved relative to the file).
- **`overrides.minimatch`** in `package.json` pins the patched `minimatch` 11 for ESLint and
  typescript-eslint (their own range still allows a version with a known denial-of-service
  advisory). Remove the override once they depend on a patched version (`npm audit` is clean
  without it).

Dependabot (`.github/dependabot.yml`) proposes the npm and GitHub Actions updates weekly
(minor and patch updates grouped; TypeScript majors ignored for the reason above), and the
GitHub Pages workflow checks every proposal (format, lint, smoke test, build).

---

## 5. Extension points

| Task | Places involved |
|---|---|
| **New field in the data** (e.g. heat output) | `data/types.ts` → `data/loader.ts` (reading + the `checkKeys` list) → `public/data/schema/*.json` → use (e.g. `plan.ts` summary, a node component) |
| **New building type** (`type`) | `BuildingType` + `BUILDING_TYPES` (loader) → project entity (`project/types.ts` + `nodeIds`, store: `addX`, `removeNodes`, `editTargetOf`, sanitize) → model (`projectModel.ts`: ports) → flow (`flow.ts`: the node's constraints) → node (`plan.ts`) → see "new node kind" → placing in `ContextMenu/`, editor |
| **New node kind** | `NodeKind` + `SpecialInfo` (`projectModel.ts`, `plan.ts`) → `KIND_SPEC` (`nodeGeometry.ts`, mandatory) → drawing (`SpecialNode/` or a new component folder, with `data-node-id` and `data-port-*` attributes) → `ProductionGraph/` → colour token in `styles/_tokens.scss` (both maps) |
| **New game rule switch** | `GameFeatures` (`data/types.ts`) → loader `features` part → `game.schema.json` → use; when it affects a store rule, follow `setCargoRules` |
| **New optimisation goal for the chain** | `Objective` and `weight` (`chain.ts`) → `ProjectSettings` → Settings panel |
| **New line style** | `edgePaths.ts` (`LineStyle`, `LINE_STYLES`, `edgePath`); the panel makes a button automatically |
| **New editor action** | if it changes only the project: `projectStore.ts`; if it needs the calculation: `useEditorActions.ts`; in the menu: `ContextMenu/` |
| **Other unit labels, locale** | `config.ts` (`RATE_UNIT_LABEL`, `POWER_UNIT_LABEL`, `LOCALE`) |

---

## 6. Known limits and assumptions

- **Flow distribution:** the even distribution (max-min fair) is an experience-based rule, not
  confirmed; the game's Drone Request Priority (Low / Med / High) is not modelled.
  `features.flowDistribution: optimal`: the LP optimum (as much as possible into the factories).
  Balance always sizes with the optimal distribution; the automatic count with the configured one.
- **Automatic machine count:** it sizes from the supply side (as much material as reaches the
  factory). On a shared source an automatic factory takes its equal share from the others too
  (from manual ones as well), as it would request in the game under the even distribution; if it
  should only take the surplus, make it manual. In a cyclic chain (where the sizing would be
  unbounded) the typed count is used.
- **Virtual cargo:** it models the missing counterpart at its capacity; it does not simulate the
  other base (no shortage or congestion appears on the virtual side).
- **Rail line routing:** the rail line is a collector node; the game's actual drone routing
  (which source feeds which consumer) is unknown.
- **Power:** the placed machines (rounded up) count with full power; the game's idle consumption
  is unknown (`config.ts › POWER_USES_ROUNDED_COUNT`).
- **Inter-base rail** capacity does not limit the calculation, it is only shown.
- **Build cost** excludes rails, and covers only the buildings that have a `cost`.
- **Game data** is incomplete: generators and several production buildings have no recipes; some
  values are assumptions (e.g. Ore Excavator v.2 Impure/Pure, Sulfur Extractor, Cargo Dispatcher
  power) – marked in the YAML.
- **Edge routes** are simple (orthogonal with a bend in the middle, backwards edges go around
  below); for a dense graph "Automatic layout" (ELK) gives a tidy picture.
- **Performance:** every change recomputes the model and the LP (not the positions); ELK runs on
  the main thread. For hundreds of nodes it is worth moving it into a Web Worker.
- **Tests:** there is no automated test suite in the repository; the smoke test
  (`.claude/skills/verify-changes/smoke-test.mts`, `npm run smoke`) checks the engine from Node.
