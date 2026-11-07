# Configuration guide

What goes where, which values a field accepts, what the limits are, and which images you can use.
All game data lives in the `public/data/` folder, the images in `public/icons/`; changing them
**needs no code change**.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) (how it works), [GRAPH-ENGINE.md](GRAPH-ENGINE.md)
(the calculation).

**Data source:** the current data comes from the MetaForge StarRupture pages
(metaforge.app/starrupture, October–November 2026), with English names exactly as in the game. The
data is still incomplete and growing; anything uncertain is marked in a YAML comment ("NOT
VERIFIED", "ASSUMPTION").

---

## 0. In short

```
public/
├── data/
│   ├── game.yml              ENTRY FILE: file list, rail tiers, mine purities, switches, starter project
│   ├── buildings/*.yml       buildings per category: extraction, production, logistics, power
│   ├── items/*.yml           items with their recipes, per category (any number of files)
│   ├── start-project.json    starter (sample) project
│   └── schema/*.json         editor completion (VS Code YAML extension)
└── icons/
    ├── items/                item images (<item id>.png)
    ├── buildings/            building images (<building id>.png)
    └── unassigned/           images without data yet (original MetaForge file names)
```

- **The unit everywhere: items/min**, for one building (recipe, mine, Dispatcher, rail). Power:
  MW / building.
- **Editing during development** (`npm run dev`): after saving, the browser recalculates by
  itself, without a page refresh; the project stays.
- **In a production build**: the `dist/data/` and `dist/icons/` folders are editable; then use the
  "Reload" button of the side panel or refresh the page.
- Any data file may be `.json` instead of `.yml`, with the same structure.
- **A new category file** (e.g. `buildings/defence.yml`): create it and add it to the `files:` list
  of `game.yml`. Ids are unique regardless of the files.
- VS Code + the **YAML** extension (Red Hat): the first line of the files points to the schema, so
  you get field name completion, descriptions and error marks while typing.

---

## 1. General rules

### 1.1 Identifier (id)

The id of every item, building, purity (and optionally recipe):

| Rule | |
|---|---|
| Allowed characters | English letters `A–Z a–z`, digits `0–9`, underscore `_`, hyphen `-` |
| May start with | a letter or `_` (**not** a digit or a hyphen) |
| Accents, spaces, dots | **not** allowed |
| Case | matters (`Titanium_ore` ≠ `titanium_ore`) |
| Length | no limit; ≤ 30 characters recommended, `lower_case_with_underscores` |
| Uniqueness | items across all item files, buildings across all building files; a second occurrence is skipped (with a warning) |

Good: `titanium_ore`, `helium_3`, `furnace_v2`, `storage_depot_v1`. Bad: `titánérc`, `3d_part`,
`titanium ore`, `furnace.v2`, `-x`.

In the existing data: the id is the game name in lower case with underscores (`Helium-3 Extractor`
→ `helium_3_extractor`, `Furnace v.2` → `furnace_v2`); a recipe id is `<item>_<building>`
(`titanium_bar_smelter`), and a second recipe in the same building gets a distinguishing word
(`chemicals_furnace_v2_goethite`).

> Saved projects reference the ids (nodes, mines, switches). **After a rename the element shows as
> "? id" in an old project.** Rather change the `name`.

### 1.2 Numbers

- Decimal **point**: `171.4` (`171,4` becomes text, with an "expected a number" warning).
- Rates, capacities: positive numbers (> 0). Power may be 0 or negative (a producing building).
- The UI shows at most 2 decimals, in the format of `config.ts › LOCALE` (`171.4`, `1,600`).

### 1.3 Texts (`name`, `title` etc.)

UTF-8, any character works. The StarRupture item and building names are **in English**, exactly as
in the game; the UI text is English too. **There is a hard length limit only on the `short` field**
(3 characters). The graph nodes have a fixed width: whatever does not fit is truncated with "…" (the
full name stays in the tooltip) – see [section 7](#7-display-length-limits).

### 1.4 YAML pitfalls

| Mistake | Correct |
|---|---|
| A tab in the indentation | spaces only (2 per level) |
| `color: #a07f66` → empty, because `#` starts a comment | `color: '#a07f66'` |
| A colon in the text: `name: Rail v.2: fast` | `name: 'Rail v.2: fast'` |
| `171,4` | `171.4` |

### 1.5 Error handling

- **Field-level error** (misspelt id, unknown field, wrong type): a warning at the bottom of the
  side panel and in the browser console, with the file name and location; the element is skipped,
  the rest works. For a typo it also suggests: `(did you mean "titanium_bar"?)`.
- **YAML syntax error / missing file**: a red banner above the graph, the program keeps running with
  the previous data.

---

## 2. `game.yml` – the entry file

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `title` | text | – | `Production Planner` | The title of the side panel (≤ 25 characters recommended). |
| `subtitle` | text | – | empty | Below the title, next to the project name. |
| `files.buildings` | list of file names | **yes** | – | Building files relative to the `data/` folder. |
| `files.items` | list of file names | **yes** | – | Item files. **The order matters**: the graph layout and the lists roughly follow it. |
| `rails` | list | – | no rails | Drone rail tiers, see below. When empty, there is no rail check and no Dispatcher rail picker. |
| `purities` | list | – | no purities | Mine node purities, see below. |
| `features.cargoManyToOne` | `true` / `false` | – | `false` | `false`: a Receiver can have one Dispatcher, a new pairing overrides the old one (the game's current behaviour). `true`: several Dispatchers may send to one Receiver. |
| `features.flowDistribution` | `even` / `optimal` | – | `even` | Distribution between sources and consumers. `even`: even, no priority (a consumer requests from the network, everyone serves it; a source splits its output equally, the surplus goes to the others) – experience-based, not confirmed. `optimal`: as much as possible reaches the factories (the old calculation). |
| `startProject` | file name | – | – | Starter project (JSON). Loaded only when the browser has no saved project, or on "New project". |
| `defaultTargets` | list | – | – | `- item: <item id>` / `rate: <items/min>`. Only **without** a `startProject`: one base starts, and a chain is built for these targets. |

### `rails` – drone rail tiers

```yaml
rails:
  - name: v.1                             # text, ≤ 4 characters recommended (shown on edge labels)
    capacity: 120                         # items/min, > 0
    cost: { basic_building_material: 1 }  # the price of one rail piece (optional)
  - name: v.2
    capacity: 240
    cost: { basic_building_material: 10 }
```

- The order does not matter: the program sorts by increasing capacity.
- `name` is free text here, but the Dispatcher `throughput` table refers to **exactly this name**
  (case matters).
- The UI sets which tier is the best already available; higher ones are not used.
- `capacity` applies to every drone rail: a rail between two nodes (possibly with several items)
  and a rail line; the total flow (the sum of the items) counts. When even the best available is not
  enough, parallel rails are needed automatically (as many of the best as go full, the smallest that
  carries the remainder, e.g. "v.1 + v.3", information); for a manual rail (a rail set on a link or a
  rail line: a count per tier, mixed allowed) too little capacity is reported as congestion.
- `cost` (`{ item_id: amount }`): the build cost of one rail piece. **Information only** (shown
  below the Summary): the length of the rails depends on the layout, so they are not part of the
  build cost summary.

### `purities` – mine node purities

```yaml
purities:
  - id: impure          # id rule (1.1); the mine table refers to it
    name: Impure        # shown in the UI (≤ 12 characters recommended)
  - id: normal
    name: Normal
    default: true       # a new mine starts with it (when the item has it)
  - id: pure
    name: Pure
```

- **Order: from the weaker to the better.** The picker buttons and the tables appear in this order.
- When none is marked `default: true`, the first one is the default.
- Without a `purities` part, mines can only give one number per item.

---

## 3. `buildings/*.yml` – buildings

The key is the building id. `type` decides what it is for; some fields only matter for certain
types. Files: `extraction.yml` (mines), `production.yml` (production buildings), `logistics.yml`
(cargo, storage, Orbital Cargo Launcher), `power.yml` (generators, negative `power`; not wired into
the planner yet). A building may have only a name and power (no recipes, no cost): it is added, but
does not appear in plans until it has more.

### 3.1 Common fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | text | **yes** | the id | Display name, in English, exactly as in the game. |
| `type` | `production` · `miner` · `storage` · `dispatcher` · `receiver` | – | `production` | The role of the building. An unknown value → a warning, treated as `production`. |
| `power` | number (MW) | **yes** | 0 | Power per building. Negative = produces. |
| `icon` | image path | – | none | See [section 6](#6-images-icons). Without it only the name shows. |
| `upgradeOf` | building id | – | – | Upgraded variant (↑): a node of the base building on the canvas can be upgraded to it (right-click › Upgrade), and back. It may be a chain (v.3 → v.2 → v.1). An unknown id or a cycle → a warning, ignored. It does **not** inherit recipes by itself (see `inheritRecipes`). There is no locking (`locked`): every building is available. |
| `inheritRecipes` | `true` / `false` | – | `false` | `true`: also runs every recipe of the `upgradeOf` building, with the `speed` multiplier. The StarRupture v.2 buildings have their own recipe lists, so it is `false` there (the v.2 recipes are added separately at the items). |
| `cost` | `{ item_id: amount }` | – | none | Build cost of one building. The Summary computes the minimum build cost from it; when missing, it shows "No cost given". |

### 3.2 Fields per type

| Field | For type | Type | Required | Default | Description |
|---|---|---|---|---|---|
| `speed` | `production` | number > 0 | – | 1 | Multiplier of the recipe /min values (also for recipes inherited with `inheritRecipes`). |
| `maxInputs` | `production` | integer ≥ 0 | – | 4 | How many recipe inputs it supports. Validation only: exceeding it → a warning, the recipe stays. |
| `mines` | `miner` | table | **yes** | – | What it mines, items/min. See 3.3. |
| `capacity` | `storage` | number > 0 | **yes** | – | How many pieces fit in one storage. |
| `throughput` | `dispatcher` | number or table | **yes** | – | Throughput in items/min. See 3.4. When missing, the Dispatcher sends nothing. |
| `railOutputs` | `receiver` | integer ≥ 1 | – | no limit | Number of rail outputs; a Receiver's output is at most `railOutputs` × the best available rail (also the "by rails" capacity of a virtual dispatcher). |

For other types these fields have no effect (`mines` on a non-miner gives a warning). The old
Dispatcher fields (`stackSize`, `sendTime`, `parallelLoading`, `bandwidth`) were removed and give a
warning.

### 3.3 Mine (`type: miner`)

```yaml
ore_excavator:
  name: Ore Excavator
  type: miner
  power: 5
  icon: buildings/ore_excavator.png
  cost: { basic_building_material: 80 }
  mines:
    titanium_ore: { impure: 60, normal: 120, pure: 240 }   # per purity
    wolfram_ore: { impure: 60, normal: 120, pure: 240 }

ore_excavator_v2:
  name: Ore Excavator v.2
  type: miner
  upgradeOf: ore_excavator      # the mine node can be upgraded to it; the table is not inherited
  power: 30
  cost: { intermediate_building_material: 120 }
  mines:
    titanium_ore: { impure: 180, normal: 300, pure: 480 }

helium_3_extractor:
  name: Helium-3 Extractor
  type: miner
  power: 15
  mines:
    helium_3: 240               # one value: no purity, no picker
```

MetaForge gives one rate for a mine (e.g. Ore Excavator 120/min): that is the **Normal** deposit.
For v.1 the Impure / Pure values are ×0.5 / ×2 according to another source (see
`DATA-SOURCES.md`); for v.2 the multiplier is **not** that (180 / 300 / 480): always write the real
value per purity, never compute it with a multiplier.

- The table key is an **item id** (an existing item), the value items/min for one building.
- In a per-purity table the keys are the `purities` ids of `game.yml`; **write only those that exist
  for that item in the game** – the UI offers only these.
- **The purity picker** appears in the mine editor only when the item has at least 2 purities at
  this building. With one purity it states which one; with a single number nothing.
- The upgraded mine is a separate building, **with its own full table** (unlike production buildings
  there is no `speed` inheritance).
- A mined item (raw material) should have no recipe; the mine gives it.

### 3.4 Dispatcher (`type: dispatcher`)

```yaml
cargo_dispatcher:
  name: Cargo Dispatcher
  type: dispatcher
  power: 40
  throughput: { v.1: 100, v.2: 171.4, v.3: 266.7 }   # by feed rail tier
# throughput: 150                                    # when it does not depend on the rail
```

- Table key: the **name** of a `rails` tier of `game.yml`. An unknown name → a warning, skipped.
- **The feed rail picker** appears in the editor only when at least 2 rail tiers are available that
  are also in the table. A single number means no picker.
- Default (the "Automatic" value of the picker): when the Dispatcher's incoming link has a manual
  rail, its tier; otherwise the best available rail that is in the table.
- When a new rail tier (e.g. v.4) is introduced, add it to the Dispatcher tables too.
- The throughput is also the "by rails" capacity of the Dispatcher's virtual receiver.

### 3.5 Other examples

```yaml
furnace:
  name: Furnace
  power: 20
  icon: buildings/furnace.png
  maxInputs: 3
  cost: { basic_building_material: 200 }

furnace_v2:
  name: Furnace v.2
  upgradeOf: furnace            # the Furnace node can be upgraded to it; its own recipes are at the items
  power: 50
  maxInputs: 4
  cost: { basic_building_material: 450 }

storage_depot_v1:
  name: Storage Depot v.1
  type: storage
  capacity: 400
  power: 5
  cost: { basic_building_material: 100 }

cargo_receiver:
  name: Cargo Receiver
  type: receiver
  railOutputs: 2
  power: 40
  cost: { intermediate_building_material: 80 }

wind_turbine_v1:                # name and power only: added, but not wired in
  name: Wind Turbine v.1
  power: -1200
```

---

## 4. `items/*.yml` – items and recipes

### 4.1 Item

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| (key) | id | **yes** | – | The item id (1.1). |
| `name` | text | **yes** | the id | Display name, in English, exactly as in the game (on the graph a long name is shortened with "…", see 7.). |
| `icon` | image path | – | coloured circle | See 6. |
| `color` | `'#rrggbb'` quoted | – | generated from the id | The colour of the lines and of the fallback circle. A wrong format → a warning, a generated colour. |
| `short` | text, **at most 3 characters** | – | the first 2 letters of the name | The label in the coloured circle when there is no image or it does not load. Longer → truncated, with a warning. 1–2 characters look best. |
| `recipes` | list | – | none | How it is made. No recipe: a raw material (a mine gives it), a byproduct, or an external source. |

### 4.1.1 Items that take no part in production

- **Quartz Ore**: needed only for building upgrades (Development Station); it takes no part in
  production. It is added (image, name), but it has no recipe and no mine, and it cannot be a recipe
  input.
- **Data Point**: broken parts found in alien test analysis. Used only for unlocks (Recipe Station,
  Development Station); neither producible nor an input. So it is not added as an item, it only
  appears in the unlock-cost comments.

### Sources and missing data

The sources and the rule: `DATA-SOURCES.md`. In short: only certain data goes into the data files,
and a data file never names a source. When the cycle time of a recipe is unknown, it goes in as
`perCycle` (see below), and the player can enter it manually.

### 4.2 Recipe

Every value is **items/min, for one machine, at speed 1** – as the game shows it.

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `building` | building id | **yes** | – | A `production` building. A mine or special building → the recipe is skipped. |
| `output` | number > 0 | **yes** | – | How much of **this** item (the one the recipe is listed under) it makes per minute. |
| `input` | `{ item_id: number }` | – | no inputs | How much it consumes per minute. Number of inputs ≤ the building's `maxInputs` (validation). |
| `byproducts` | `{ item_id: number }` | – | – | Byproducts per minute. A separate output on the factory node; when not linked, it shows as an end product. |
| `name` | text | – | the item name | The recipe name (factory node header; ≤ 32 characters recommended). |
| `alternate` | `true` / `false` | – | `false` | `true`: an alternative recipe; "Build chain" does not use it by default (Settings › Recipes for the chain). It can always be placed manually. |
| `perCycle` | `{ input: {…}, output: N, byproducts?: {…} }` | instead of `output` | – | **When the cycle time is unknown**: the per-cycle quantities. Then there is no `input` / `output` (items/min): the recipe has no rate, the factory computes with 0, "Build chain" does not use it, and the UI shows ⚠ "no data". The player can enter the cycle time manually in the project (side panel › Missing data, or the factory editor); until there is certain data it is used: items/min = per cycle × 60 / cycle time. Once the cycle time is known, rewrite it in the `input` / `output` form and delete `perCycle`. |
| `id` | id | – | see below | The recipe id. Recommended (`<item>_<building>`): enabling / disabling and the manual choice refer to it, so the order of the recipes can change freely. |

```yaml
glass:
  name: Glass
  icon: items/glass.png
  color: '#656e6b'
  short: Gl
  recipes:
    # Unlock at the Recipe Station: Helium-3 x2500, Calcium Powder x600, Data Point x400
    - id: glass_furnace
      building: furnace
      input: { helium_3: 20, calcium_powder: 40 }
      output: 40
      # Furnace: x2 / 3 s
    - id: glass_furnace_v2              # the v.2's own recipe (it does not inherit the Furnace one)
      building: furnace_v2
      input: { helium_3: 40, calcium_powder: 60 }
      output: 80
    - id: glass_furnace_v2_goethite
      name: Glass (Goethite)            # a second recipe in the same building: a distinguishing name
      building: furnace_v2
      input: { pressurized_helium: 20, calcite_sheets: 20, goethite_ingot: 20 }
      output: 320
```

- **Conversion** from the MetaForge cycle data: amount × 60 / cycle time (s). E.g. "x2 / 3 s" →
  40/min. In the existing data the comment shows the original cycle data and the Recipe Station
  unlock cost.
- **Automatic recipe id** (without `id`): the first recipe of the item = the item id, the others
  `<item>_2`, `<item>_3`… For a recipe inherited with `inheritRecipes` the program creates a variant
  by itself (`<recipe id>@<building id>`).
- **When the rate is unknown** (e.g. MetaForge gives no cycle time), use the `perCycle` form (see
  `heat_shield`).
- **Several recipes for one item** = alternatives. Any of them can be placed on the canvas; "Build
  chain" picks from the enabled ones by the optimisation goal (fewest buildings / lowest power), with
  base buildings.
- **Old format** (`time:` + per-cycle amounts): the loader converts it to per minute and prints the
  values to write in the warning. The schema already marks this field as an error.

---

## 5. "A single number, or per variant" – the shared pattern

The `mines` values of a mine and the Dispatcher `throughput` work the same way:

| Form | Meaning | In the UI |
|---|---|---|
| `240` | always this much | no picker |
| `{ normal: 120 }` | one variant | no picker, it states which one |
| `{ normal: 120, pure: 240 }` | per variant | a picker with the variants |

The order within the table does not matter: the UI follows the order of `game.yml` (`purities` for
purities, `rails` for rails).

---

## 6. Images (icons)

### 6.1 Where and how

- Item: `public/icons/items/<item id>.png`, building: `public/icons/buildings/<building id>.png` (the
  folder structure and the naming are a recommendation, not mandatory).
- The `icon:` field is relative to the `public/icons/` folder: `icon: items/titanium_ore.png`.
- The MetaForge images (`T_…_Icon.png`, 256–1024 px) were scaled down to 128×128 for the project.
  **The file name is not always the game name** (e.g. `T_Syringe_Icon` = Applicator, `T_Coil_Icon` =
  Inductor, `T_Explosive_Icon` = Chemicals) – the pairing comes from the MetaForge pages.
- `icons/unassigned/`: the submitted images without data yet (original file names). When the data of
  an item or building arrives, move its image from here and rename it to the id.
- A full URL (`https://…`), a path starting with `/` or a `data:` URI also works, used as is. **A
  local file is recommended**: the load-time check often cannot reach an external URL (CORS) and
  warns "Missing icon".
- File name: lower case, without accents and spaces (`titanium_ore.png`). On a production server
  (Linux, GitHub Pages) case matters.

### 6.2 Format

| Format | Recommendation |
|---|---|
| **SVG** | **Best**: sharp at every zoom level, small. It needs a `viewBox` attribute (otherwise it does not scale well). |
| PNG, WebP | Good; with a transparent background. |
| JPEG | Works, but without transparency (a white box on the dark theme). |
| GIF, AVIF | Works when the browser supports it. |

The server must serve it with an `image/…` content type (Vite and the usual web servers do);
otherwise a "Missing icon" warning appears.

### 6.3 Size

Displayed sizes (CSS pixels):

| Where | Item icon | Building icon |
|---|---|---|
| Graph node rows | 16 px | – |
| Edge label | 14 px | – |
| Middle of a factory node | – | 24 px |
| Special node header (mine, Dispatcher…) | – | 16 px |
| Side panel, menus, pickers | 12–20 px | 18 px (right-click › Factory) |

The graph zooms up to 300%, and on a high-resolution (2×) display that is twice as many pixels, so:

| | Recommended source size | File size |
|---|---|---|
| Item icon | SVG, or **at least 64×64 px** PNG/WebP (96×96 ideal) | ≤ 20–30 kB |
| Building icon | SVG, or **at least 128×128 px** PNG/WebP | ≤ 50 kB |

- A **square** image. A non-square one is fitted proportionally, centred (with empty bands).
- There is no hard file size limit, but every icon is checked and loaded at start-up; many large
  images slow the start.
- The program notices an image change (on reload it adds a version to the URL), no need to clear the
  browser cache.

### 6.4 When the image is missing or broken

- Item: a coloured circle with the `color`, the `short` (or the first 2 letters of the name) in it,
  automatically with dark or light text so it stays readable.
- Building: no icon, only the name.
- A "Missing icon: icons/… (item: id)" warning at the bottom of the side panel.

---

## 7. Display length limits

The graph nodes have a fixed width, and the labels do not wrap. **Whatever does not fit is shortened
with "…"**, and the full name stays in the node's tooltip (mouse over it); the browser measures the
width with the actual font (`src/components/textFit.ts`). So the long English names of the game (e.g.
"Intermediate Building Material") can be used.

This much fits without shortening (12 px bold ≈ 6.3 px/character, 11.5 px ≈ 5.8 px, 10.5 px ≈ 5.3 px;
a bit more with the Windows Segoe UI font):

| Label | Where it is narrowest | About this many characters fit |
|---|---|---|
| Item `name` | Rail line row (264 px wide node, with the rate next to it) | 24–28 |
| Item `name` | Mine, Receiver, Dispatcher, storage node header and row | 19–22 |
| Recipe `name` | Factory node header (less with the ↑ upgrade mark) | 36–40 |
| Building `name` | Middle of a factory node, between the two rate columns | 15 |
| Purity `name` | Mine editor buttons (3 buttons in a row) | 12 (recommended max., no shortening here) |
| Rail `name` | Edge label badge, "2× v.3" | 4 (recommended max., no shortening here) |
| `short` | Coloured circle | **3 (hard limit)**, 1–2 recommended |
| `title` | Side panel title | 25 |

The panel lists and the editor pickers wrap or truncate with "…". On the rail line node the program
truncates long item and line names to the available width (…); the full name stays in the tooltip.

---

## 8. `start-project.json` – starter project

The same format as Export (`"version": 2`). **Recommended method**: build it on the canvas,
"Export", and copy the downloaded file here – so the node positions are included too. When written
by hand the program is lenient: it fills missing fields with defaults, skips broken elements with a
warning, and lays out nodes without a position automatically.

The `//` comments in the example are only for explanation – the real file is plain JSON, without
comments. `settings.recipeOverrides` (recipes on / off for the chain: id → `true`/`false`) and
`settings.cycleTimes` (manually entered cycle times for recipes without a rate: recipe id → seconds)
can be left out.

```jsonc
{
  "version": 2,
  "name": "Sample project",
  "bases": [
    {
      "id": "base_main",                    // any unique text
      "name": "Main Base",
      "factories": [{ "id": "fac_bar", "recipe": "titanium_bar_smelter", "count": 1.111111 }],
      "mines":     [{ "id": "mine_helium", "building": "helium_3_extractor", "item": "helium_3", "purity": null, "count": 1, "output": null }],
      "receivers": [{ "id": "rcv_titanium", "name": "R-Titanium Ore", "building": "cargo_receiver", "item": "titanium_ore" }],
      "dispatchers": [],
      "storages":  [{ "id": "sto_stator", "name": "Stator Storage", "building": "storage_depot_v1", "item": "stator", "count": 1 }],
      "links": [
        { "id": "lnk_1", "from": "recv:rcv_titanium", "to": "fac:fac_bar", "item": "titanium_ore" }
      ],
      "railLines": [],
      "positions": { "fac:fac_bar": { "x": 560, "y": 400 }, "recv:rcv_titanium": { "x": 40, "y": 400 } }
    }
  ],
  "railLinks": [{ "id": "lnk_ore", "name": "Ore Rail", "from": "base_outpost", "to": "base_main", "items": ["calcium_ore"] }],
  "settings": { "objective": "buildings", "maxRailName": null }
}
```

| Element | Fields and values |
|---|---|
| factory (`factories`) | `recipe`: recipe variant id (it also gives the building) · `count`: manual count ≥ 0, fractions allowed · `auto`: `true` (the default, also when missing) = the count comes from the material reaching the linked inputs, rounded up (`count` applies only when it has no linked input); `false` = the `count` |
| mine (`mines`) | `building`: mine building id · `item`: item id · `purity`: purity id or `null` (when the item has none) · `count`: building count ≥ 0 · `output`: custom total output /min, or `null` = count × the purity rate |
| Receiver | `building`, `item`, `virtual` (optional): virtual dispatcher, `{ "mode": "rail" \| "custom", "rate": 120 }` or `null` = off. Applies only while no Dispatcher is paired; `rail` = `railOutputs` × best rail, `custom` = `rate` (items/min) |
| Dispatcher | `building`, `item`, `receiverId`: Receiver id or `null`, `feedRail`: rail name or `null` = automatic (the tier of the incoming link's manual rail, otherwise the best available), `virtual` (optional): virtual receiver, same shape as above; applies only while unpaired; `rail` = the throughput by feed rail |
| storage | `count`: number chained in a row, ≥ 1 |
| link (`links`) | `from` / `to`: node id (see below) · `item`: item id · `rail` (optional): manual rail set, a count per tier, mixed allowed: `[{ "tier": "v.1", "count": 2 }, { "tier": "v.3", "count": 1 }]` (`tier`: rail name, or `null` = the best available; `count` ≥ 1). Missing = automatic. The links between the same two nodes run on one rail (several items, one line on the graph), their setting is shared (on a mismatch the first configured one applies). The old `{ "tier", "count" }` form becomes a one-element list on loading. |
| rail line (`railLines`) | `mode`: `auto` (the program sizes it) or `manual` · `rails`: in manual mode the rail set (like the `rail` field of a link) · `slots`: number of inputs ≥ 1, or `null` = dynamic. The old `tier` + `parallel` fields become `rails` on loading; the program converts an old rail line with stops (`stops`). |
| shared rail (`buses`, removed) | Becomes an automatic rail line on loading (it works the same), the `bus:<id>` references change to `line:<id>`. |
| `positions` | node id → `{ x, y }` (the top-left corner on the canvas) |
| `settings.objective` | for Build chain: `buildings` (fewest buildings) · `power` (lowest power) |
| `settings.maxRailName` | the name of the best available rail, or `null` = the best in the data |

**Node ids** (the links and positions refer to them): `fac:<factory id>`, `mine:<mine id>`,
`recv:<Receiver id>`, `disp:<Dispatcher id>`, `store:<storage id>`, `railout:<inter-base rail id>`
(in the source base), `railin:<inter-base rail id>` (in the target base), `line:<rail line id>`.

**Old (v1) project** (`targets`, `routing`, `railGroups`, `recipeChoice`, automatic mines): converted
on loading – factories are built from the targets (Build chain), the mine counts are balanced, the
shared-rail routes disappear.

---

## 9. Program-level settings (`src/config.ts`)

Rarely needed, but it is just changing a value:

| Constant | Default | Effect |
|---|---|---|
| `RATE_UNIT_LABEL` | `'/min'` | The label of the rates (text only, no conversion). |
| `POWER_UNIT_LABEL` | `'MW'` | The label of the power. |
| `LOCALE` | `'en-US'` | Number formatting (decimal separator, thousands separator) and sorting. |
| `MAX_RECIPE_INPUTS` | `4` | The default `maxInputs` when a building does not give one. |
| `POWER_USES_ROUNDED_COUNT` | `true` | Power uses the rounded-up count per node (a fractional machine is a whole one). `false`: proportionally. |
| `IMPORT_PENALTY` | `1e6` | "Build chain": the "price" of an item without a source in the recipe choice. Do not lower it near the cost of the recipes. |
| `EPSILON` | `1e-7` | Numbers below this count as zero. |

---

## 10. Common tasks

**A new raw material with a mine** (e.g. Quartz Ore, once the extractor data is known)

1. Image: `public/icons/items/quartz_ore.png` (the item is already added, with an image)
2. Item (`items/ores-and-ingots.yml`), without a recipe: `quartz_ore: { name: Quartz Ore, icon: items/quartz_ore.png }`
3. In the `mines:` table of the mine building (`buildings/extraction.yml`): `quartz_ore: { normal: 120, pure: 240 }`
4. If a new purity is needed, add it to the `purities` list of `game.yml` first.

**A new produced item**: an item entry in the matching category file + a `recipes` list (`id`,
`building`, `input`, `output` /min); the input items must exist.

**A new building from a MetaForge page**: `name`, `power` ("Power draw"), `cost` ("How to Build"),
`maxInputs` ("Inputs"), `icon`; its recipes (the "… Recipes" table) at the items, `building: <id>`,
with the cycle data converted to /min.

**Upgraded production building (v.2)**: a new building with `upgradeOf: <base id>`, its own `power`,
`cost`; the v.2 recipes at the items, `building: <v.2 id>`. If in the game it runs the base recipes
faster: `inheritRecipes: true` + `speed`.

**Upgraded mine (v.2)**: a new `type: miner` building with `upgradeOf` and **its own full `mines`
table**.

**A new rail tier**: `game.yml` `rails` + the new name in every Dispatcher `throughput` table.

**N:1 cargo instead of 1:1 after a patch**: `game.yml` › `features: cargoManyToOne: true`.

**The old (optimal) distribution back** (as much as possible reaches the factories, instead of even):
`game.yml` › `features: flowDistribution: optimal`.

---

## 11. Warnings and what they mean

| Message (excerpt) | What to do |
|---|---|
| `unknown field "bulding" (did you mean "building"?)` | A misspelt field name. |
| `unknown item "titanium_bat"` / `unknown building "…"` | A misspelt or missing id. |
| `an id may only contain letters, digits, _ and -, and must not start with a digit` | The id has an accent, a space, or starts with a digit. |
| `color: empty. Quote the value: color: '#a07f66'` | `color: '#rrggbb'` |
| `short: at most 3 characters fit in the circle` | Shorten it. |
| `time: this field no longer exists, every value is items/min. Converted; write it as: …` | The old recipe format; copy in the printed values. |
| `unknown purity "pur" … (allowed: impure, normal, pure)` | A misspelt purity id in the mine table. |
| `unknown rail "v.5" … (allowed: v.1, v.2, v.3)` | A rail name in the Dispatcher table that does not exist. |
| `inheritRecipes: only meaningful together with upgradeOf` | Say which building's recipes to inherit, or delete the field. |
| `… › cost: unknown item "…"` | A misspelt or not yet added item in the build cost. |
| `a miner (type: miner) without a "mines:" table mines nothing` | Say what it mines. |
| `the "throughput" field (items/min) is missing` | The Dispatcher sends nothing until it is given. |
| `… is not a production building (miner) and cannot run recipes` | For a raw material do not write a recipe; add it to the mine's `mines:` table. |
| `… inputs, but X supports at most N` | The building's `maxInputs` is too small, or it is the wrong building. |
| `upgradeOf: forms a cycle` | An A → B → A reference; fix the chain. |
| `stackSize, sendTime…: these fields no longer exist` | An old Dispatcher; rewrite it as `throughput:`. |
| `locked: this field no longer exists (every building is available)` | Delete the line: the upgrade is chosen per node. |
| `Missing icon: icons/… (item: id)` | A wrong path or file name (case matters!). |
| Red banner: `…: YAML error – …` | Indentation, quotes, colon; the line number is in the message. |
