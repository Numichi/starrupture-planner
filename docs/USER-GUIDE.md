# User guide

How to use the planner: placing and linking nodes on the canvas, what the numbers on the
nodes and lines mean, and the rules of the game the calculation follows. Installation:
[INSTALL.md](../INSTALL.md); the data files: [CONFIGURATION.md](CONFIGURATION.md).

Every quantity is **items per minute**, per building, as the game shows it.

Contents: [Canvas](#the-canvas-place-link-move) · [Factories](#factory-machine-count-power) ·
[Mines](#mines-raw-material-sources) · [Special buildings](#special-buildings-buildingsyml-type-field) ·
[Cargo](#cargo-dispatcher--receiver) · [Storage](#storage) · [Inter-base rail](#inter-base-rail) ·
[Rail line](#rail-line-collector-several-sources-several-items-on-one-rail) ·
[Drone rails](#drone-rails-one-rail-between-two-nodes) ·
[Distribution](#distribution-between-sources-and-consumers-no-priority) ·
[Adding an item](#adding-a-new-item-step-by-step) · [Errors](#errors) ·
[Editor completion](#editor-completion-vs-code) · [Production build](#production-build)

## The canvas: place, link, move

Every node on the canvas is yours: you place it, link it, move it and delete it. The side
panel is an overview only (bases, summary, node list, settings).

| What | How |
|---|---|
| **Place** | Right-click the empty canvas → search (item, recipe or building name, Enter: the first hit), or browse: *Factory › building › recipe*, *Mine › item*, Receiver, Dispatcher, Storage, Rail line, Inter-base rail › target base. The node goes to the click position. |
| **Link** | Drag an item row (output) of a node onto another node (or the other way: an input onto a producer). Material moves only between linked nodes. |
| **Link onto empty canvas** | When you drop a dragged link on empty canvas, the picker opens there **with only what fits**: for an output the recipes that use this item, Dispatcher, storage, rail line, rail to another base; for an input the recipes that make it, mine, **Build chain**, Receiver, rail line, rail from another base. The chosen element goes where you dropped it (its linked item row lands exactly there; when close, in line with the source), already linked. |
| **What supplies it? / What uses it?** | Click an item row. For an input: link from an existing node, **Build chain**, a new factory from the recipes (with as many machines as cover the shortage), mine, Receiver, rail line, inter-base rail. For an output: every recipe that uses this item (with as many machines as take the remainder, or as many as you enter), Dispatcher, storage, rail line, inter-base rail. The new node goes next to the clicked one, linked. The picker has a **search** at the top (recipe, building, item name; diacritics optional), Enter: the first hit. |
| **Select, move** | Left-drag on empty canvas: selection box. Drag a node: move (the selected nodes move together). Shift / Ctrl + click: add / remove. Ctrl+A: all. |
| **Copy, paste** | Ctrl+C: copies the selected nodes **with the links between them** (manual rail settings included). Ctrl+V: pastes at the mouse position (the top-left corner of the group goes there); without the mouse next to the original, shifted. The pasted nodes **stay selected**, so they can be moved right away; clicking empty canvas clears the selection. Right-click: *Copy* (on a node) / *Paste here* (on the canvas). New ids, new names (`R-Titanium` → `R-Titanium (2)`); a Dispatcher keeps its pair only when its Receiver was copied with it. Inter-base rail ends cannot be copied. Pasting into another base works too. |
| **Link window** | Click a line (one rail between two nodes, possibly with several items): the flow per item, the rail, **distribution across parallel rails** and the **manual rail** setting with mixed tiers (see below: *Drone rails*). Delete: removes the whole rail. |
| **Delete** | Delete (the selected nodes with their links, or the selected link). Right-click › Delete. |
| **Undo** | Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z; Cmd on a Mac), and the ↶ ↷ buttons top right. Every project change: place, move, delete, link, paste, machine count, rail setting, rename… (60 steps). **It works in the editor fields too** (e.g. in the machine count field: the field value is restored, the editor stays open); only the search fields undo their typed text. The program's own automatic placement (e.g. the position of an incoming rail created in another base) is not a separate step. |
| **View** | Wheel: zoom. Right or middle drag, or Space + left drag: pan. The Fit button: the whole base into the view. |
| **Edit** | Click a node: the editor on the right (machine count, recipe, purity, custom output, pairing…). |
| **Node menu** | Right-click a node: upgrade / downgrade (e.g. Furnace → Furnace v.2), Build chain, balance the machine count, automatic / manual machine count, delete links, delete. With several selected: balance, arrange, delete together. |
| **Count in the box** | Factory: click the machine count and type (it becomes manual; Enter / click elsewhere: done, Esc: cancel), or click the `auto` / `manual` pill next to it (toggle). See: *Factory: machine count, power*. |

## Factory: machine count, power

A factory node = one recipe on one building, with a machine count. The count multiplies the
inputs, the outputs and the power. **For power a fractional machine counts as a whole one**
(it is placed, it just does not work at full power); the same goes for the buildings to
place and the build cost.

**Automatic machine count (the default).** The count comes from the available raw
material: as many machines as the material reaching the linked inputs feeds, **rounded
up** – when it is not exact, X full machines + 1 partly working one (e.g. 130 ore, 60 per
machine → 2.17 machines' worth → **3 machines**, at 72%). More material: it grows; less: it
shrinks; the next automatic factory follows the same way. How much material reaches it is
decided by the even distribution (see below: *Distribution…*): its equal share of a shared
source next to the other consumers, plus what the others do not request. At least 1
machine stays (when nothing reaches it, its shortage shows). The "shortage" caused by the
rounding is not a shortage: the tight input shows an amber `tight −50` (the last machine
would need this much more), never red. When the factory has no linked input, there is
nothing to size it from: the typed count is used (dashed "auto").

**Manual machine count:** runs with the count you type (fractions allowed: 1.5 = one full
and one half-working machine).

**In the box, on the graph** (few clicks):

| What | How |
|---|---|
| type a number | click the machine count (e.g. `3×`): an input opens; Enter or click elsewhere: done (it becomes manual), Esc: cancel |
| auto ↔ manual | click the `auto` / `manual` pill next to the number; switching to manual keeps the current number |
| from the menu | right-click the factory › *Automatic machine count* / *Manual machine count* |

The editor (click the factory) has the same: *Machine count: Automatic / Manual*, below it the
number and the output /min (typing switches to manual). In a saved project the old
factories become automatic too (their typed count stays: it applies when you switch to
manual in the editor, or when they have no linked input).

The ports of the node show what is wrong: on an input **short** (linked, but too little
arrives) or **not linked**, on an output **surplus** (linked, but not taken) or **output**
(unlinked: this is the end product).

**Effective output.** When a linked input of a factory gets less than it needs, the
official /min no longer applies: the factory only works at the ratio of its tightest input.
The header then shows an amber **%** (e.g. `50%`), the ports show the effective rate
(amber) with the nominal one below (`nom. 60`). The output is lower by as much, so the
**next factory's input becomes short** – the shortage cascades down the chain. It takes
only that much from its other inputs too; only the **bottleneck** shows as a shortage (what
the sources could not make up either), the other sources keep a surplus. An **unlinked
input is assumed to be supplied** (it is just not linked yet): it does not reduce the
output.

**⚠ No data (cycle time).** For some recipes only the ingredients are known, not the cycle
time. The factory header then shows an amber ⚠, the ports "?/min · no data", and the
factory computes with 0 (a shortage at the next factory); "Build chain" does not use them.
There will be no data until the next data update, but **you can enter the cycle time
manually**: in the factory editor, or in the **Missing data** part of the side panel. The
manual value is saved with the project (and exported with it), and it is used until there is
certain data (the ⚠ then shows "manual cycle time"). List and background:
[DATA-SOURCES.md](DATA-SOURCES.md).

- **Balance** (right-click on the canvas or on a node, or in the editor): computes the exact
  machine counts for the linked demand (from the consumers' side – the reverse of the
  automatic count). The ends of the chain (whose output is not linked, or only goes into
  storage) and the custom-output mines stay as they are: those are your goals. Automatic
  factories stay automatic: they follow the new counts of the mines by themselves.
  Balancing **one factory** (in the editor, or right-click › Balance machine count) makes it
  manual, with its consumer demand. With several bases the "whole project" variant also
  balances across cargo and inter-base rails.
- **Build chain**: places the whole supply chain down to the raw materials for the missing
  inputs of a factory (or for one input) – factories and mines, linked. It picks the recipe
  according to the Settings (fewest buildings / lowest power, from the enabled recipes only),
  with base buildings; it uses the free sources of the base (surplus, Receiver, incoming
  rail) first.
- **Upgrade**: a placed factory can be switched to the upgraded building (or back), for the
  same product. The StarRupture v.2 buildings have their own recipes (e.g. Glass in the
  Furnace v.2: a different ratio, or the Goethite variant): the menu offers these. The
  machine count and the links stay, the rates become the new building's. Buildings need no
  "locking": everything is available.

## Mines (raw material sources)

A mine is a node without inputs. You set (in the editor):

- **what it mines** and **which mine building** (the upgraded mine, e.g. Ore Excavator v.2,
  is a separate building; right-click › Upgrade works too),
- **the purity of the mine node** (Impure / Normal / Pure). **There is a picker only when the
  item has several purities at this mine**,
- the **building count** (a multiplier, fractions allowed),
- or a **custom output**: one node can stand for all such mines of yours (e.g. 2 Pure + 3
  Normal = 840 /min, 5 buildings) – fewer nodes. Power and cost still come from the building
  count.

**Why not a separate building per purity?** The purity belongs to the mine node, not to the
machine: the same drill produces more on a pure node. So: mine building (+ the upgraded
variant as a separate building), and the purity is a setting of the placed mine.

## Special buildings (`buildings/*.yml`, `type:` field)

| type | Purpose | Extra field |
|---|---|---|
| `miner` | Mine: no input, mines according to its table | `mines`: items/min per item, per purity or a single number |
| `storage` | Storage, one kind of item. Several chained in a row (stack) add up their capacity. | `capacity`: pieces / storage |
| `dispatcher` | Cargo sender: sends one item to one Receiver | `throughput`: items/min, per rail tier or a single number |
| `receiver` | Cargo receiver: receives from one Dispatcher (1:1; N:1 with the switch) | `railOutputs`: number of rail outputs |

**"A single number, or per variant"**: a mine and a Dispatcher are given the same way. A
single number means no picker in the UI; a table means a picker:

```yaml
ore_excavator:
  name: Ore Excavator
  type: miner
  power: 5
  cost: { basic_building_material: 80 }
  mines:
    titanium_ore: { impure: 60, normal: 120, pure: 240 }   # per purity (game.yml purities)

helium_3_extractor:
  name: Helium-3 Extractor
  type: miner
  power: 15
  cost: { basic_building_material: 250 }
  mines:
    helium_3: 240                                          # one purity → no picker

cargo_dispatcher:
  name: Cargo Dispatcher
  type: dispatcher
  power: 40
  throughput: { v.1: 100, v.2: 171.4, v.3: 266.7 }         # per feed rail (game.yml rails)
  # throughput: 150                                        # when it does not depend on the rail → no rail picker
```

The purities are in `game.yml` (`purities:`, from the weaker to the better; `default: true`
is the default of a new mine). The Dispatcher throughput depends on the feed rail in the
game because it first fills a stack of 100 and only then sends (~10 s); the measured values
go into the table, the program does not compute them.

## Cargo: Dispatcher → Receiver

- Link the Dispatcher to the producers (input), the Receiver to the consumers (output). Pair
  the two by name in the editor; no line joins the pair. A Receiver passes on as much as its
  Dispatcher(s) send (at most their throughput) and its linked consumers take.
- Pairing is **1:1** by default, as in the game now: a Receiver can have one Dispatcher;
  setting another one overrides the old one.
- **Switch:** if a patch lets several Dispatchers send to one Receiver, set
  `features: cargoManyToOne: true` in `game.yml` (N:1, the throughputs add up).
- Mouse over the node: when the pair is in the same base, it is highlighted. When it is in
  another base, clicking the pair's name jumps the view there.
- A Receiver's output is at most `railOutputs` × the best rail (e.g. 2 × 480 = 960 /min).
- **The pace is set by the tighter of the cargo throughput and the capacity of the attached
  rail** (the link window says which). When the incoming link of a Dispatcher has a manual
  rail and the Dispatcher's feed rail is *automatic*, the throughput uses that tier (e.g. a
  v.1 rail → the v.1 throughput).
- A pair within the same base works too.
- **Virtual counterpart (calculate without pairing).** A Dispatcher does not need a Receiver,
  and a Receiver does not need a Dispatcher, to see how much material they would move. In the
  editor:
  - Dispatcher › *Virtual receiver*: **Off / By rails / Custom**. It takes what the linked
    producers give, as if a Receiver took it.
  - Receiver › *Virtual dispatcher*: **Off / By rails / Custom**. It gives the item as if a
    Dispatcher sent it, as much as the linked consumers request.
  - *By rails* = fixed by the rails: the Dispatcher's throughput (by its feed rail), or the
    Receiver's rail outputs × the best rail. *Custom* = a rate you type (it starts at the
    rail-based value).
  - The item is not configured: it comes from the linked material (the node's item).
  - It applies only while the node is unpaired; the node footer shows it
    (`→ virtual receiver · by rails 266.7 /min`, `takes 120 / 266.7 (45%)`).

## Storage

One kind of item, `count` pieces chained in a row (stack), the capacity adds up.

- **Pass-through** (it has an outgoing link): **it gives as much as it gets**, when it is
  taken. Two states:
  - *balanced*: in = out;
  - *positive*: more goes in than out – the excess accumulates in it (the consumers do not
    request more, **or the capacity of the outgoing rail is below the inflow**). The node
    shows `positive: +300 /min · full in ≈ 1.33 min`.
- **Sink** (no outgoing link): everything stays inside, it fills up.
- The factories are served first: the source puts into the storage only what the factories do
  not need. The excess staying in the storage appears in the *End product* list ("goes into
  storage"). Build chain can use the excess of a positive storage as a source.

## Inter-base rail

Right-click › Inter-base rail › target base. The active base gets an "Outgoing rail" node,
the target base an "Incoming rail" node; it can carry several items. Link the producers to
the outgoing node (the linked item joins the rail's list), and the consumers from the
incoming one. The required rail tier applies to the sum of the items.

## Rail line (collector: several sources, several items on one rail)

The StarRupture drone rail carries several items. The **rail line** (right-click › Rail
line, or drop a link on empty canvas › + Rail line) models this, and it is also a
**collector**: several sources fill it, several consumers take from it (it replaces the old
"Shared rail" – saved shared rails became automatic rail lines, their links stayed).

```
source A ─┐                          ┌─▶ consumer X
source B ─┼─▶ [ Rail line: Ti, W, … ] ┼─▶ consumer Y
source C ─┘                          └─▶ consumer Z
```

- **Inputs on the left**, one row per item; **the same items come out on the right**. Drag a
  link onto it from a producer, and link on from its right side to the consumers. When you
  drag one item of the rail line onto a factory, it **also links the machine's other,
  still unlinked items** the line carries: one rail carries everything into the machine.
- **Number of inputs**: *dynamic* (as many as linked items, and there is always one free
  row), or a *fixed* count (when full, no new item can be linked).
- **The capacity counts the total flow** (the sum of all items), because that grows fast –
  even beyond the capacity of the best (v.3) rail.
- **Automatic sizing**: when one rail is enough, the smallest tier that carries it; when even
  the best available does not, as many of it as go full, and the smallest tier that carries
  the remainder (e.g. 600 /min: `v.1 + v.3`, amber). It does not limit.
- **Manual sizing**: the rails **as a count per tier, mixed allowed** (e.g. 2× v.1 + 1× v.2 +
  4× v.3); the capacity is the sum of the rails. This is the limit: when the consumers would
  request more than the rail lets through, **congestion** (red): the node and the editor show
  how much would pass and which rails would be needed (one click sets them). The consumers
  show a shortage.
- The footer bar shows the load (total flow / capacity).

## Drone rails (one rail between two nodes)

Every link runs on a drone rail, and **one rail carries several items**: the links between
the same two nodes (one per item) run **on one rail**, and the graph shows **one line**: the
label shows the item icons side by side and the sum (e.g. ⟨W⟩⟨Ti⟩ `60 v.1` when 30 + 30
moves). Next to the ports a small "comb" gathers the per-item stubs (in the item's colour).
How much of which: hover the line, or open the link window. The capacity counts the sum.
The rail on the label:

| Label | Meaning |
|---|---|
| `v.2` (grey) | automatic: the smallest tier that carries it |
| `3× v.3`, `v.1 + v.3` (amber) | automatic: even the best available rail cannot carry it alone, **several parallel rails are needed**. Not an error (not red), just a hint: more rails to place |
| `2× v.1 + v.3` (blue frame) | **manual**: you set it (a count per tier) |
| red line and label | manual, and it **cannot carry the demand** (congestion): e.g. 3× v.3 would be needed, but 2× v.1 is set. When it is enough (e.g. 10× v.2), it is not red, even if it is more than needed |

**Link window** (click the line), so the graph stays uncluttered:

- the items of the rail: **how much of each** (an item can be taken off the rail with ×),
  the flow, the rail (capacity), the load;
- **rail setting** (for every item of the rail): *automatic* or *manual*: **a count per tier,
  mixed allowed** (v.1 / v.2 / v.3 with steppers). In manual mode this is the limit: what does
  not fit does not reach the receiver (the receiving factory works at the ratio of its tight
  input), and the window says which rails would be needed (one click sets them);
- **distribution across the rails**, two ways:
  - *even (load balanced)*: every rail is loaded equally (e.g. 1680 /min on 4 equal rails:
    420 – 420 – 420 – 420; with mixed tiers in proportion to the capacity),
  - *fill + remainder*: the rails (from the largest) run full, the remainder on one rail,
- **how many source and receiving machines** to build per rail (exact, and rounded up). E.g.
  the output of 56 Smelters on 3 rails: how many smelters and how many receiving machines go
  on one rail so it does not clog. For a congested manual rail it uses the demand, with the
  rails that would be needed;
- **the two ends of the rail**: what sets the pace:

| End | What it shows |
|---|---|
| factory, mine | machines per rail; for a receiving machine **the tightest of the items arriving on the rail** decides (bottleneck): the rail serves that many machines |
| storage | gives as much as it gets; *balanced* or *positive* (the excess accumulates, e.g. because the outgoing rail is smaller) |
| Receiver, Dispatcher (cargo) | the cargo throughput, the Receiver's output limit and this rail's capacity (for a manual rail): the tightest sets the pace; an unpaired one shows its virtual counterpart |
| rail line | the branch rail carries several items; the machine count comes from the bottleneck of the receiving machine's requested items |
| inter-base rail | how much comes from / goes to the other base |

  A non-machine end has no machine count column in the table.

The side panel sets the best tier already available. The rail line counts its total flow
(all its items); the links branching off it, and going into it, are rails too (one per node
pair).

## Distribution between sources and consumers (no priority)

A consumer machine requests material from the network, and **everyone linked serves it**: a
source splits its output **equally** between the requesters, a consumer gets equally from
its sources, and the surplus (what someone does not request) goes to the others.

- Two smelters (8×, 480 /min) → one rod factory (480 demand): **240 + 240**, not 480 + 0.
- Three sources (a1, a2, a3) and three consumers (b1, b2, b3), links a1,a2 → b1, a2 → b2,
  a2,a3 → b3: the output of a2 **splits in thirds**, b2 falls behind (it only gets a2/3),
  b1 and b3 make it up from their other source.

Mathematically a max-min fair allocation (progressive filling). **The rule is based on
experience and not confirmed**, so it is a switch: `features.flowDistribution: optimal` in
`game.yml` brings back the old calculation (as much as possible reaches the factories, with
"smart" routing). *Balance* sizes the machine counts with the optimal distribution; with the
even distribution a shortage may remain where several consumers share a source. The
**automatic machine count**, however, sizes with this distribution: an automatic factory gets
as many machines as its equal share (and the unused surplus of the others) feeds.

The game's **Drone Request Priority** setting (Low / Med / High per building) is not modelled
yet: there is no public description of how it works (likely: a higher priority request is
served earlier).

## Adding a new item, step by step

1. Copy the image: `public/icons/items/<item id>.png` (the MetaForge `T_…_Icon.png` images
   are fine; if it is already in `icons/unassigned/`, move it from there)
2. Add the entry to the matching category file (`items/*.yml`), `icon: items/<item id>.png`
3. Save. Done.

## Errors

Every error is shown with the file name and location at the bottom of the side panel, e.g.:

```
items/materials.yml › titanium_sheet › recipe 1: input: unknown item "titanium_bat" (did you mean "titanium_bar"?)
```

- A misspelt id, an unknown field, a wrong type: a warning, the broken recipe is skipped,
  the rest works.
- A missing icon file: a warning; an item gets a coloured circle instead of the image, a
  building only its name.
- A YAML syntax error (e.g. wrong indentation): a red banner with the line number, the graph
  keeps the previous data.

## Editor completion (VS Code)

Install the **YAML** extension (Red Hat). The first line of the files refers to the
`schema/` folder, so the editor suggests field names, shows descriptions and underlines
typos. The recommended extensions (YAML, Vue, ESLint, Prettier) are listed in
`.vscode/extensions.json`.

## Production build

After `npm run build` the `dist/data/` and `dist/icons/` folders stay editable. You can
change the data without a new build; afterwards the "Reload" button or a page refresh loads
it.
