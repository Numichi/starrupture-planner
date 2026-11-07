# AGENTS.md – instructions for AI coding agents

This file is for every AI agent working in this repository (GitHub Copilot agent mode,
Copilot cloud agent, Claude Code via `CLAUDE.md`, Codex, etc.). The detailed human
documentation lives in `docs/`; this file is the concise rulebook.

**Language:** reply to the user in the language they write in (the maintainer usually
writes Hungarian). **Everything in the repository is English**: identifiers, code comments,
UI text, warnings, YAML comments and documentation. **Game names** in the data (items,
buildings, purities, rail tiers) are written **exactly as in the game**. Keep it that way.

---

## The project in one sentence

A browser-based production chain **node editor** for the game StarRupture: the player
splits the factory into bases, places factories, mines, cargo, storages and rail lines
on a canvas (right-click), connects them with explicit links and moves them freely; the
app computes the flow on every link, shortages and surplus, power demand (a fractional
machine counts as a whole one), minimum build cost (buildings only – rails depend on the
layout) and required drone rail tiers. Helpers: "Build chain" (the whole supply chain down
to raw materials), automatic factory machine count (default: sized from the material
reaching the linked inputs, rounded up; type a number in the node or toggle auto / manual
there), "Balance" (exact machine counts from demand), upgrade a placed node to its v.2
building (the Upgrade button is always shown; disabled with a note when there is no
upgraded variant), rail lines (collectors: several sources and items on one drone rail,
total throughput vs. a rail set, auto or manual with congestion), one rail per node pair
(one drawn line with several items; auto rail set or a manual mixed set like 2× v.1 + v.3;
click a line for items, distribution across rails, machines per rail), even flow
distribution between sources and consumers (no priority; switchable), a virtual counterpart
for unpaired cargo nodes (a Dispatcher without a Receiver / a Receiver without a Dispatcher
computes by rails or a custom rate), copy / paste of nodes with their links (Ctrl+C /
Ctrl+V), ELK auto layout.

**Stack:** Vue 3.5 (`defineComponent` with external `.ts` / `.scss` per component),
TypeScript 6.0 (vue-tsc; TypeScript 7 is not usable yet – vue-tsc and typescript-eslint need
its API, planned for 7.1), Vite 8, SCSS (`sass`), ELK.js (auto layout), yalps (linear
programming), yaml; ESLint 10 + typescript-eslint, Prettier 3; tsx for the smoke test. There is **no** Pinia, router, UI library, backend or database. Do not suggest or
use React.

## Commands

```bash
npm ci                         # install dependencies (Node.js >= 22.12)
npm run dev                    # dev server, http://localhost:5173
npm run typecheck              # vue-tsc (templates included); required after every code change
npm run lint                   # ESLint (lint:fix repairs what it can)
npm run format                 # Prettier (format:check only checks)
npm run verify                 # format:check + lint + typecheck
npm run build                  # typecheck + production build into dist/ (also compiles every template)
npm run smoke                  # engine smoke test via tsx (data, start project, flow LP, plans, chain, balance, ELK)
docker compose up -d --build   # Docker: http://localhost:8080 (leave the Docker files alone unless asked)
```

There is **no** automated test suite (Vitest etc.); the smoke test, the typecheck, lint and
the build are the verification. Do not introduce a test framework unless asked.

## Layout

```
public/data/          GAME DATA as YAML: game.yml (entry point, lists the files), buildings/*.yml
                      (extraction, production, logistics, power), items/*.yml (by category),
                      start-project.json, schema/
public/icons/         128×128 PNG images: items/<id>.png, buildings/<id>.png, unassigned/ (no data yet)
src/config.ts         labels (/min, MW), LOCALE (en-US), tolerances, power rounding, chain penalty
src/main.ts           entry: mounts App, imports styles/main.scss
src/App.vue|.ts|.scss main layout
src/styles/           global SCSS: main.scss → _tokens.scss (colour maps → CSS variables, light + dark),
                      _base.scss, _panel.scss (shared panel / editor classes)
src/data/             types.ts (game data types), loader.ts (YAML → GameData, validation)
src/project/          types.ts (the player's project, node ids), projectStore.ts (state + ALL mutations, undo), sanitize.ts (+ v1 migration prep)
src/engine/           pure TypeScript calculation engine – NO Vue
src/composables/      usePlanner.ts (loading + calculation pipeline), useEditorActions.ts (chain, balance,
                      upgrade, arrange, port picker actions, v1 migration), usePanZoom.ts
src/components/       one FOLDER per component: Name/Name.vue (template) + Name.ts (logic) + Name.scss
                      (scoped styles). ProductionGraph (canvas interaction), ContextMenu, PortPicker,
                      EntityEditor, LinkEditor, RailLineEditor, RailSetEditor, *Node, GraphEdge, ItemIcon,
                      UpgradeButtons, SidePanel; panel/*/ = read-only overview sections; plain helpers
                      next to them: graphEvents.ts, notice.ts, linkEnds.ts, storageState.ts, missingData.ts, textFit.ts
docs/                 USER-GUIDE.md, ARCHITECTURE.md, GRAPH-ENGINE.md, CONFIGURATION.md, DATA-SOURCES.md, AI-AGENTS.md
README.md             project overview (AI-written notice, data sources, documentation map)
CONTRIBUTING.md, INSTALL.md   manual PR guide; installation
eslint.config.js, .prettierrc.json, .prettierignore, .editorconfig   code style
.github/workflows/pages.yml   CI + GitHub Pages: format:check, lint, smoke, build on every PR and push;
                      deploy from main. Actions pinned to commit SHAs; .github/dependabot.yml updates them
```

Calculation pipeline: `loader` → `projectModel.buildSizedModel` (`buildModel`: nominal ports =
machine count × rate, links, cargo/rail transfers, virtual cargo; auto factories sized first by
`flow.autoFactoryCounts`) → `flow.solveFlows` (ONE LP for all bases: flow per link)
→ `plan.buildBasePlan` (nodes, ports with gap, edges, summary) → `layout.positionGraph`
(stored positions + edge routing; ELK `autoLayout` only for missing positions / "arrange")
→ `edgePaths` → components. Node positions are NOT an input of the model or the LP.
Details: `docs/GRAPH-ENGINE.md`.

---

## Hard rules

1. **Game data is not in the code.** Item, recipe, building, rail and purity values live
   only in `public/data/` (YAML). Write code only for a new *kind of field* or new *behaviour*.
2. **Every quantity is items per minute, per building.** There is no cycle time (`time`)
   and no time-unit conversion. A building's `speed` multiplies a recipe's per-minute values.
   A node runs at most at its machine count. A factory is **automatic by default**
   (`Factory.auto`, missing field = true): its count = ⌈what the material reaching its linked
   inputs can feed⌉ (min 1; same distribution as the flow; `flow.autoFactoryCounts`,
   `ModelNode.countMode`), the rounding is not a shortage (`PlanPort.partial`); with no linked
   input it uses the stored `count` ('auto-fallback'). Manual = the typed count (fractional
   allowed). Mines and other counts change only by the player or "Balance". A factory whose
   linked input gets less than nominal runs at the bottleneck ratio (effective count
   `x|<factory>` in the flow LP, `PlanNode.utilization`); its output drops, which becomes a
   shortage on the next input. Unlinked inputs count as supplied. Power and
   placed buildings use the rounded-up count per node (`POWER_USES_ROUNDED_COUNT`).
3. **`src/engine/` never imports Vue** (no components, no store). Its input is
   `GameData`/`GameIndex` + `Project`, its output plain objects. Game rules are passed in
   as parameters (see `CargoRules`), never read from global state. The engine keeps relative
   imports (it runs from Node via tsx without the `@/` alias).
4. **Project changes go through the functions in `projectStore.ts`**, which hold the rules
   (e.g. the cargo 1:1 override in `pair()`). Components write only simple fields directly (`v-model`).
5. **Persisted identifiers are stable.** Saved projects reference them; change them only
   with a migration in `sanitize.ts`:
   - node ids (`project/types.ts › nodeIds`): `fac:<id>`, `mine:<id>`, `recv:<id>`, `disp:<id>`,
     `store:<id>`, `railin:<railLink id>`, `railout:<railLink id>`, `line:<id>` (the removed
     `bus:<id>` is migrated to `line:<id>` in `sanitize.ts`) –
     stored in `Link.from/to` and `Base.positions`,
   - recipe ids: the YAML `id:` (in the data: `<item>_<building>`, e.g. `titanium_bar_smelter`);
     without `id:` the first recipe = item id, others `<item>_2`…; on an `inheritRecipes`
     upgrade the variant is `<id>@<building>`,
   - item, building and purity ids in the YAML,
   - the localStorage keys `starrupture-planner.project` / `starrupture-planner.display`
     (renaming them loses the saved data).
6. **Data file errors do not throw.** For field-level problems the loader calls
   `Reporter.warn` (file › location: message, in English) and skips the element.
   `LoadError` is only for fatal cases (YAML syntax, missing file). For a new field, also
   extend the `checkKeys` list.
7. **A new YAML field touches 4 places:** `src/data/types.ts`, `src/data/loader.ts`
   (parsing + `checkKeys`), `public/data/schema/*.schema.json`, `docs/CONFIGURATION.md`.
8. **A new project field touches 3 places:** `src/project/types.ts` (+ `emptyBase` /
   `defaultSettings`), `src/project/sanitize.ts` (lenient default), `projectStore.ts` operations.
   `PROJECT_VERSION` is 2; v1 (target-driven) projects are converted on load
   (`sanitize.ts › legacy` + `useEditorActions.ts › migrateLegacy`).
9. **A new graph node kind** must get a row in `nodeGeometry.ts › KIND_SPEC` (otherwise it
   has no size), and its component must set `data-node-id` on the root `<g>` and
   `data-port-dir` / `data-port-item` on port rows (the canvas hit-tests with these).
   Full checklist: the `add-building-type` skill.
10. **Patch-dependent game rules become switches** under `features:` in `game.yml`; the old
    behaviour stays and no data is lost (pattern: `cargoManyToOne`). Skill: `add-game-rule-switch`.
11. **UI structure:** one folder per component (`Name.vue` template only + `Name.ts`
    `defineComponent` + `Name.scss` scoped); no `<script setup>`, no TypeScript syntax in
    templates (`!`, `as` – the build fails), no static inline styles. Colours are CSS
    variables defined only in `src/styles/_tokens.scss` – a new token goes into **both** the
    `$light` and the `$dark` map. Number formatting comes from `engine/format.ts`, unit labels
    and `LOCALE` from `config.ts`. Imports in the UI use the `@/` alias.
12. **Code style:** every module / component starts with a JSDoc block (`@module` /
    `@component`) explaining its purpose and business rules; exported functions have JSDoc;
    comments say *why*. Airy layout (blank line before `return`, after declarations, around
    blocks) is enforced by ESLint; Prettier owns formatting. `npm run verify` must pass.
13. **New dependencies** (npm packages) only when asked. Never edit `dist/`, `node_modules/`
    or `package-lock.json` by hand. Leave the Docker files (`Dockerfile`, `docker-compose.yaml`,
    `docker/`, `.dockerignore`) alone unless asked.
14. **The game data is real but incomplete.** It comes from MetaForge
    (metaforge.app/starrupture, Oct–Nov 2026) and will grow. Never invent game values: take
    them from the user or a source they name, convert cycle data to items/min, and mark
    anything uncertain in a YAML comment ("NOT VERIFIED" / "ASSUMPTION"). Buildings or items
    without a counterpart yet (e.g. generators) are added but not wired; a recipe without
    cycle time is added as `perCycle` (no rate, manual cycle time in the project).
15. **Documentation changes together with the code** (skill: `update-docs`).

## Domain glossary (UI term ↔ code)

| UI | Code | Essence |
|---|---|---|
| base | `Base` | own canvas: nodes, links, positions |
| factory, machine count | `Factory` (`fac:`) | one recipe variant × count (multiplier for in/out/power) |
| automatic / manual machine count | `Factory.auto`, `flow.ts › autoFactoryCounts`, `projectModel.ts › buildSizedModel`, `ModelNode.countMode` (`manual` / `auto` / `auto-fallback`), `PlanPort.partial`, `ProjectModel.flowHint`, `projectStore › setFactoryCount` | auto (default, also for saved factories without the field): count = max(1, ⌈x⌉), x = what reaches the linked inputs with the factory uncapped (same distribution as the flow; X full + 1 partial); the next auto factory follows; rounding is `partial` (amber "tight −X"), not a shortage; no linked input → stored `count`. In the node: click the count to type (→ manual), click the `auto`/`manual` pill to toggle (→ manual keeps the shown count). Balancing leaves auto factories' counts alone; balancing ONE factory switches it to manual |
| link | `Link` | from node output → to node input, one item; material flows only along links |
| link rail, rail set: automatic / manual, congestion | `Link.rail` (`RailCount[]` = `[{tier, count}]`, mixed tiers; absent = auto), `linkRailKey`, `ModelRail`, `PlanRail`, `RailChoice.parts`, `rails.ts › linkRail / autoParts / partsLabel` | ONE rail per node pair: all links between the same two nodes (one per item) share it and are drawn as ONE line (item icons + total; `layout.ts` comb stubs), capacity on the total; auto: one rail if it fits, else best tiers full + the smallest tier for the rest ("v.1 + v.3", amber, NOT an error); manual (same set on all links of the rail, e.g. 2× v.1 + v.2 + 4× v.3): the sum caps the total (`flow.ts` rail cap row, `railDemand`), red only when the demand exceeds it |
| link window, distribution | `LinkEditor/`, `linkEnds.ts`, `rails.ts › railDistribution / machinesPerRate` | click an edge: the rail's items, rail settings, what limits each end (machine: count, target = bottleneck of its items on this rail; storage: state; cargo: throughput vs. rail, or the virtual counterpart; rail line: branch rail), even (load balanced) and fill + remainder split, machines per rail |
| copy / paste | `projectStore › copyNodes / pasteNodes`, `useEditorActions › copyNodes / pasteNodes` | Ctrl+C / Ctrl+V: selected nodes with the links between them, new ids and names, pasted nodes stay selected |
| mine, purity | `Mine`, `type: miner`, `Purity` | source; count × purity rate, or custom `output` |
| recipe | `Recipe` | per-minute values, `product` = main output |
| shortage / surplus / end product | port `gap` | input: missing supply at the bottleneck (`flow.ts › supplyGap`; unlinked = nominal) / unconsumed linked output (of the effective output) / unlinked output or storage sink |
| effective output | port `effective`, `PlanNode.utilization` | what a short factory really makes: per-building rate × effective count |
| no data (cycle time) / manual cycle time | `Recipe.perCycle`, `rateFrom: 'missing' \| 'user'`, `settings.cycleTimes` | recipe without known cycle time: 0 rate + ⚠; the user's cycle time applies until the data has one (panel "Missing data") |
| Build chain / Balance / Upgrade | `chain.ts` / `flow.ts` (adjustable) / `upgrades.ts` | build supply chain / compute counts / switch to v.2 building |
| even distribution (no priority) | `features.flowDistribution` (`even` default / `optimal`), `flow.ts › solveFair` | consumers request from the network and every linked source serves them: max-min fair link flows by progressive filling (LPs per connected part); two sources → one consumer split 240 + 240; a source shared by 3 consumers splits in thirds. Experience-based, unconfirmed → switch; `optimal` = the old LP optimum. Drone Request Priority (Low/Med/High) is not modelled |
| Receiver / Dispatcher | `Receiver`, `Dispatcher` | cargo; 1:1 by default (`features.cargoManyToOne`); pace = min(cargo throughput, attached rail); automatic feed rail (`feedRail: null`) = the incoming link's manual rail tier (`attachedFeedRail`), else the best available |
| virtual receiver / virtual dispatcher (Off / By rails / Custom) | `VirtualCargo` (`{ mode: 'rail' \| 'custom', rate }`), `Dispatcher.virtual`, `Receiver.virtual`, `projectModel.ts › applyVirtualCargo`, `ModelNode.virtualCargo`, LP `v\|<node>` + cap `vc\|<node>`, `FlowResult.virtual`, `PlanVirtualCargo` (`special.virtual`) | an unpaired Dispatcher (no Receiver, not overridden) sends to a virtual receiver, a Receiver without Dispatchers receives from a virtual dispatcher, so each computes without the other side; capacity `rail` = the Dispatcher throughput (by feed rail) / the Receiver's `railOutputs` × best rail (null = unlimited), `custom` = the typed rate (a new one starts at the rail value); the item is NOT configured – it is the node's item from the linked material; ignored once paired |
| storage, balanced / positive | `Storage`, storage `SpecialInfo.state`, `storageState.ts` | gives on what it gets; pass-through: in = out + k (k ≥ 0 accumulates, "positive", e.g. the outgoing rail is smaller; in `optimal` mode worth 0.5 like a sink, so factories are served first; in `even` mode it requests like any consumer); no outgoing link = sink; balancing keeps in = out |
| rail line, collector | `RailLine` (`line:`) | one rail (set) carrying several items from several sources: inputs left, the same items out right; capacity on the TOTAL; `auto` (auto rail set) or `manual` (`rails`: mixed rail set caps the flow → congestion, `flow.ts › lineDemand`); `slots` = fixed input count or null (dynamic). Dragging a line output onto a factory also links the factory's other unlinked inputs the line carries. The old "shared rail" (`Bus`) was removed and migrates to an auto rail line |
| inter-base rail | `RailLink` | `railout:` node in the source base, `railin:` in the target base; several items |

**Game knowledge the data cannot show** (keep it in mind for data and features):

- **Quartz Ore** is only for building upgrades (Development Station); it takes no part in
  production lines – an item without recipe or mine, never a recipe input.
- **Data Point** = broken found parts from alien test analysis, spent only on unlocks
  (Recipe Station recipes, Development Station building upgrades). Neither producible nor
  usable in production, so it is not an item in the data (only in unlock-cost comments).
- **Sources** (`docs/DATA-SOURCES.md` – the only place that names them; no source names in
  YAML, code or UI): MetaForge is primary; on conflict our data wins. Values from other
  sources are **not** mixed into the data. A recipe whose cycle time is unknown goes in as
  `perCycle` (per-cycle quantities, no rate): it computes with 0, the chain builder skips
  it, the UI shows ⚠ "no data" (no data until the next data update). The user may enter
  a cycle time meanwhile (`settings.cycleTimes`, saved with the project, export/import);
  it applies only while the data has no rate (`engine/missingData.ts › applyCycleTimes`).
  Do not add new items or recipes from a differing source (it complicates debugging).

Business rules in detail: `docs/ARCHITECTURE.md` section 2.3. The key ones: factories are
auto-sized from their inputs by default (manual on request); nodes run at their machine
count unless a linked input is short (then at the bottleneck ratio, and the shortage
cascades downstream); flow only along links (even distribution by default: max-min fair, no
priority; `optimal`: one LP, factory inputs first, storage sinks second); balancing keeps
chain ends (no outgoing link) and custom-output mines fixed and pushes shortages to the
start of the chain (×1000 penalty on linked inputs); the chain builder prefers existing free
sources and base-tier buildings (upgrade recipes ×1000). Code conventions:
`docs/ARCHITECTURE.md` section 4.

## Area rules

Detailed, file-type specific rules: `.github/instructions/*.instructions.md` (Copilot
loads them automatically; other agents read the relevant one before editing):

| Area | File |
|---|---|
| `public/data/**`, `public/icons/**` | `.github/instructions/game-data.instructions.md` |
| `src/data/**` | `.github/instructions/loader.instructions.md` |
| `src/project/**` | `.github/instructions/project-model.instructions.md` |
| `src/engine/**` | `.github/instructions/engine.instructions.md` |
| `src/components/**`, `src/composables/**`, `src/App.*`, `src/styles/**` | `.github/instructions/vue-ui.instructions.md` |
| `**/*.md` | `.github/instructions/docs.instructions.md` |
| `.github/workflows/**`, `.github/dependabot.yml` | `.github/instructions/ci.instructions.md` |

## Skills (`.claude/skills/`)

Read by Claude Code and by GitHub Copilot (VS Code agent mode, cloud agent, CLI).

| Skill | When |
|---|---|
| `add-game-data` | add or change an item, recipe, building, build cost, mine, v.2 upgrade, Dispatcher, rail tier, purity, icon |
| `add-building-type` | a new building **type** or canvas node kind across all layers |
| `add-game-rule-switch` | a game rule that changes with patches, behind a switch |
| `verify-changes` | at the end of every task: format, lint, typecheck, build, smoke test, UI |
| `update-docs` | which document to update, and how |

## Definition of done

- `npm run verify` passes (format check, lint, typecheck), and if code changed, `npm run build` too
  (the GitHub Pages workflow runs the same checks and blocks a broken deploy).
- The smoke test ends with `RESULT: OK` (mandatory for data changes).
- For UI changes you checked the browser if you have a tool for it (right-click place,
  drag, box select, link drag, port picker); if not, say so.
- Related documentation is updated.
- Your reply states briefly what changed, what you verified and what is still open.
