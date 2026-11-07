---
name: Game data (YAML)
description: Rules for editing the YAML/JSON data files in public/data and the icons in public/icons.
applyTo: "public/data/**,public/icons/**"
---

# Editing game data

Field reference: `docs/CONFIGURATION.md`. Step by step: the `add-game-data` skill.

- **Files:** `game.yml` is the entry point and lists every data file under `files:`.
  Buildings are in `buildings/{extraction,production,logistics,power}.yml`, items in
  `items/*.yml` by category. A new category file must be added to `files:`.
- **Every value is items per minute, per building** (recipe `input`/`output`/`byproducts`,
  mine `mines`, Dispatcher `throughput`, rail `capacity`). There is no `time` field.
  Source data given as a cycle ("x2 / 3 s") is converted: `items × 60 / seconds` (= 40).
- **Ids**: `^[A-Za-z_][A-Za-z0-9_-]*$` – no accents or spaces, must not start with a digit.
  Convention: the game name in snake_case (`Helium-3 Extractor` → `helium_3_extractor`,
  `Furnace v.2` → `furnace_v2`). Never rename an existing id (saved projects reference
  it); change `name` instead.
- **Recipe ids** are explicit: `<item>_<building>` (`titanium_bar_smelter`); a second
  recipe in the same building gets a distinguishing suffix and a `name`
  (`glass_furnace_v2_goethite`, `name: Glass (Goethite)`).
- **`name` is English, exactly as in the game** (items, buildings, purities, rails). The
  UI and the YAML comments are English too.
- Decimal **point** (`171.4`). Quote colours: `color: '#a07f66'`. Indent with 2 spaces.
- **Raw materials have no recipe**: a mine building's (`type: miner`) `mines:` table
  provides them. List only the purities that exist in the game; a single purity is a plain number.
  Purity rates are not a fixed multiplier: Ore Excavator v.1 is 60 / 120 / 240, but v.2 is
  180 / 300 / 480 – always enter the real value per purity, never derive it from Normal.
- Purity ids come from `game.yml › purities` (impure / normal / pure), rail names from
  `game.yml › rails` (`v.1`, `v.2`, `v.3`; the Dispatcher `throughput` table refers to
  them, case-sensitive).
- **Build cost:** `cost: { item_id: count }` per building (MetaForge "How to Build"); the
  summary multiplies it by the number of buildings to place. A rail tier's `cost` is
  informational only (rail length depends on the layout).
- **Upgrades (v.2):** a separate building with `upgradeOf: <base>`; a placed node of the
  base building can be switched to it on the canvas. There is no `locked` field (the loader
  warns). StarRupture v.2 buildings have **their own recipe lists**: add
  those recipes to the items with `building: <v.2 id>`. Use `inheritRecipes: true` + `speed`
  only if the upgrade really runs all of the base building's recipes faster.
  Upgraded **mine**: `upgradeOf` + its own complete `mines` table.
- A recipe's building must be of type `production`. A building may exist without recipes
  (listed, not wired); a generator has negative `power` and is not wired yet.
- **Sources:** listed only in `docs/DATA-SOURCES.md` – never name a source site in YAML,
  code or UI text. Only confirmed data goes into the files; on conflict the existing data
  wins. Do not mix values from another source into a recipe, and do not add items or
  recipes from a differing source. **Unknown cycle time:** add the recipe as
  `perCycle: { input: {…}, output: N }` (per-cycle quantities, no `input`/`output` per
  minute) with the comment "No cycle time data: …"; the UI shows ⚠ and the user
  can enter the cycle time in the project. When the cycle time becomes known, convert it to
  `input`/`output` per minute and remove `perCycle`; update the list in `DATA-SOURCES.md`.
- **Not part of production lines:** Quartz Ore is only for building upgrades
  (Development Station) – it stays an item without recipe or mine and is never a recipe
  input. Data Point (broken found parts from alien test analysis) is only spent on
  unlocks (Recipe Station, Development Station): neither producible nor an input, so it is
  **not** an item – it appears only in unlock-cost comments.
- The order of `items/*.yml` files and entries also influences the graph layout.
- Long names are truncated with "…" on graph nodes (full name in the tooltip), so
  there is no hard limit except `short` (max 3). Keep purity ≤ 12 and rail ≤ 4 characters.
- Icons: path relative to `public/icons/`; square PNG, 128×128, transparent background,
  file name `<id>.png`. MetaForge file names (`T_…_Icon.png`) do not always match the game
  name – use only mappings confirmed by a page. Unmatched images wait in `icons/unassigned/`.
- Uncertain values get a YAML comment: `# NOT VERIFIED: …` / `# ASSUMPTION: …`.
  Never invent values.
- `start-project.json` is plain JSON (no comments); it references graph node ids.
- Verify: `npm run smoke` must pass without warnings.
