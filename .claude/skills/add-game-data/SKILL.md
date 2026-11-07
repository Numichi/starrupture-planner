---
name: add-game-data
description: Add or change game data in the public/data YAML files - a new item, recipe, alternate recipe, building, build cost, upgraded (v.2) building or mine, mine purity, Dispatcher throughput, drone rail tier, or icon. Use when the user enters StarRupture data (e.g. from MetaForge pages), changes values after a patch, or asks to add a material, building or mine (HU - anyag, recept, épület, építési költség, bánya, minőség, sín, ikon felvétele).
---

# Adding or changing game data

This needs **no code**. If the requested data would need a new *field* (e.g. heat
output), this is not the right skill: ask, then follow "Extension points" in
`docs/ARCHITECTURE.md`.

Field reference: `docs/CONFIGURATION.md`. Rules: `.github/instructions/game-data.instructions.md`.

## 0. Clarify

- Every value is **items per minute, per building**. MetaForge gives cycle data
  ("x2 / 3 s"): convert it with `items × 60 / seconds` (= 40) and show the conversion.
  Keep the original as a YAML comment (`# Furnace: x2 / 3 s`).
- For mines: which item, which purities exist in the game, and the rate for each.
  MetaForge gives one rate: that is the **Normal** deposit. Impure / Pure are not a fixed
  multiplier (Ore Excavator v.2: 180 / 300 / 480) – ask for the real values, never derive them.
- If a value is missing, ask; never invent game values. If the user wants it anyway,
  mark it in a comment (`# ASSUMPTION: …` / `# NOT VERIFIED: …`).
- **Sources:** named only in `docs/DATA-SOURCES.md` (never in YAML, code or UI). Only
  confirmed data; on conflict ours wins; nothing mixed in from another source, no new
  items/recipes from a differing source.
- **Recipe with unknown cycle time:** `perCycle: { input: {…}, output: N }` instead of
  `input`/`output` (per-cycle quantities), comment "No cycle time data: …". It computes
  with 0 and shows ⚠; the user may enter a cycle time in the project. Add it to the list in
  `docs/DATA-SOURCES.md`; when the cycle time is known, convert to per-minute values.
- **Not production items:** Quartz Ore (building upgrades only, no recipe/mine, never an
  input) and Data Point (unlock currency from alien test analysis – not an item at all).
- `name` is **English, exactly as in the game**; ids are the name in snake_case.

## 1. What to do, case by case

| Task | Where | What |
|---|---|---|
| New raw material | `items/ores-and-ingots.yml` (or the fitting category) | `id: { name, icon?, color: '#rrggbb', short? }`, **no recipe** |
| …and the mine for it | `buildings/extraction.yml`, the mine's `mines:` table | `new_id: 240` or `{ impure: 60, normal: 120, pure: 240 }` |
| New produced item | the fitting `items/*.yml` | `recipes: - id: <item>_<building>, building, input: {…}, output: N` |
| Second recipe, same building | the same item | distinguishing id suffix + `name: Item (Variant)` |
| Alternate recipe (off by default) | the same item | `alternate: true`, `name` |
| New production building | `buildings/production.yml` | `name`, `power` (Power draw), `cost` (How to Build), `maxInputs` (Inputs), `icon` |
| Upgraded production building (v.2) | `buildings/production.yml` | `upgradeOf: <base>`, `power`, `cost`; its **own recipes** on the items (`building: <v.2 id>`). Only if it runs the base recipes faster: `inheritRecipes: true` + `speed`. There is no `locked` field any more (placed nodes are upgraded on the canvas) |
| New mine building | `buildings/extraction.yml` | `type: miner`, `power`, `cost`, `mines: {…}` |
| Upgraded mine | `buildings/extraction.yml` | `type: miner`, `upgradeOf`, its **own complete** `mines` table |
| Building known only by name/power | the fitting `buildings/*.yml` | `name`, `power` (negative = generator); listed, not wired |
| Build cost | the building | `cost: { basic_building_material: 80 }` |
| New purity | `game.yml › purities` | `- id, name`, ordered weakest to best; `default: true` on at most one |
| New rail tier | `game.yml › rails` | `- name, capacity, cost?`; also add it to **every** Dispatcher `throughput` table |
| Dispatcher throughput | `buildings/logistics.yml` | `throughput: 150` or `{ v.1: …, v.2: …, v.3: … }` |
| Icon | `public/icons/items/<id>.png` or `buildings/<id>.png` | 128×128 PNG + `icon: items/<id>.png`; check `icons/unassigned/` first |

An id may appear only once (items across all item files, buildings across all building files).
A new category file must be listed in `game.yml › files`.

## 2. Example

```yaml
# items/ores-and-ingots.yml – raw material, no recipe (already in the data, waiting for its mine)
quartz_ore:
  name: Quartz Ore
  icon: items/quartz_ore.png
  color: '#6ab0b0'

# buildings/extraction.yml – into the mine's table
ore_excavator:
  mines:
    quartz_ore: { normal: 120, pure: 240 }   # no impure deposit → not selectable

# items/materials.yml – produced item (MetaForge: Furnace x2 / 3 s → 40/min)
glass:
  name: Glass
  recipes:
    - id: glass_furnace
      building: furnace
      input: { helium_3: 20, calcium_powder: 40 }
      output: 40
      # Furnace: x2 / 3 s
```

Icons: MetaForge file names (`T_…_Icon.png`) are not always the game name (e.g.
`T_Coil_Icon` = Inductor); use a mapping only if a page confirms it. Resize to 128×128.

## 3. Verify (mandatory)

```bash
npm run smoke
```

- It must end with `RESULT: OK`; fix every `ERROR: data file: …` line (file › id › location).
- The smoke test also builds a chain for every product of the start project; a "no source
  for … (info)" line means an item has neither a recipe nor a mine yet.
- With the dev server running, the warnings also appear at the bottom of the left panel;
  to try a new recipe, right-click the canvas, search for it and use "Build chain".

## 4. Report back

Briefly, in the user's language: what you added, where, with which values (and how you
converted them), what is marked as assumption/unverified, and the smoke test result.
