# Contributing

Thanks for helping. This guide is for people who write a pull request **by hand**. The project
was written by an AI (see the [README](README.md)), but nothing in it needs an AI to change: the
rules below are the same ones the agents follow ([AGENTS.md](AGENTS.md)).

## 1. Set up

```bash
npm ci                 # Node.js 22.12+ (26 LTS recommended), npm 10+
npm run dev            # http://localhost:5173 – code and data changes reload live
```

Recommended VS Code extensions are listed in `.vscode/extensions.json` (Vue, YAML, ESLint,
Prettier); with them, Prettier formats on save and ESLint fixes what it can. More: [INSTALL.md](INSTALL.md).

## 2. Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server with live data reload |
| `npm run typecheck` | vue-tsc (TypeScript and the templates) |
| `npm run lint` / `npm run lint:fix` | ESLint (TypeScript, Vue, blank-line layout) |
| `npm run format` / `npm run format:check` | Prettier (TypeScript, Vue, SCSS, JSON) |
| `npm run smoke` | engine smoke test: data files, starter project, flow LP, plans, chain builder, balancing, layout… – must end with `RESULT: OK` |
| `npm run verify` | `format:check` + `lint` + `typecheck` |
| `npm run build` | type check + production build (also compiles every template) |

There is no unit test framework on purpose; the smoke test, the type check, lint and the build
are the verification.

## 3. Where to change what

| Change | Where | Read first |
|---|---|---|
| an item, recipe, building, mine, rail tier, purity, icon | `public/data/**/*.yml`, `public/icons/` – no code | [CONFIGURATION.md](docs/CONFIGURATION.md), [DATA-SOURCES.md](docs/DATA-SOURCES.md), `.claude/skills/add-game-data/SKILL.md` |
| a new **field** in the data files | `src/data/types.ts`, `src/data/loader.ts` (+ `checkKeys`), `public/data/schema/*.json`, `docs/CONFIGURATION.md` | [ARCHITECTURE.md › Extension points](docs/ARCHITECTURE.md#5-extension-points) |
| a new building **type** or canvas node kind | every layer | `.claude/skills/add-building-type/SKILL.md` |
| a game rule that changes with patches | a switch under `features:` in `game.yml` | `.claude/skills/add-game-rule-switch/SKILL.md` |
| the calculation (flow, balancing, chain, rails) | `src/engine/` (plain TypeScript, no Vue) | [GRAPH-ENGINE.md](docs/GRAPH-ENGINE.md) |
| the saved project (a new field, migration) | `src/project/` | `.github/instructions/project-model.instructions.md` |
| the UI | `src/components/<Name>/`, `src/composables/`, `src/styles/` | [ARCHITECTURE.md › Code conventions](docs/ARCHITECTURE.md#4-code-conventions), `.github/instructions/vue-ui.instructions.md` |
| documentation | `README.md`, `INSTALL.md`, `CONTRIBUTING.md`, `docs/` | `.claude/skills/update-docs/SKILL.md` |

The `.github/instructions/*.instructions.md` files hold the detailed rules per area; they are
short and worth reading before you touch that area.

## 4. Repository map

Every Vue component has its own folder with three files – pure separation of markup, logic and
styles:

```
ComponentName/
├── ComponentName.vue    the template (HTML) only, plus <script src> and <style src>
├── ComponentName.ts     the logic: defineComponent({ props, emits, setup }) – JSDoc on top
└── ComponentName.scss   the scoped styles (left out when the component has none)
```

```
src/
├── config.ts                 labels (/min, MW), LOCALE, power rounding (fractional machine = whole), tolerances
├── main.ts                   entry point: mounts App, loads styles/main.scss
├── App.vue / App.ts / App.scss   main layout
├── styles/
│   ├── main.scss             global stylesheet entry (imports the partials)
│   ├── _tokens.scss          colour tokens as Sass maps → CSS custom properties (light + dark theme)
│   ├── _base.scss            box model, page frame, typography, focus ring
│   └── _panel.scss           shared classes of the side panel and the editors (buttons, fields, callouts, meter)
├── data/
│   ├── types.ts              internal game data model (what the engine works with)
│   └── loader.ts             YAML → internal model, validation, inherited recipe variants (inheritRecipes)
├── project/                  the player's model (not game data)
│   ├── types.ts              project: bases, nodes (factory, mine, cargo, storage, rail line), links (manual rail set), positions, virtual cargo
│   ├── projectStore.ts       state and every change (place, link, delete, move), undo, saving
│   └── sanitize.ts           reading a project (save, import, starter file) with validation, converting old (v1) projects
├── engine/                   the calculation engine. Plain TypeScript, runs without Vue.
│   ├── gameIndex.ts          id → object lookup, per-minute recipe rates (× speed)
│   ├── projectModel.ts       project → model: nominal ports, links, transfers; cargo rule (1:1 / N:1); virtual cargo; buildSizedModel: with the automatic factory counts
│   ├── rateTable.ts          "a single number, or per variant" values (purity, rail tier)
│   ├── mining.ts             mines: what they mine, purities, rate per building
│   ├── cargo.ts              Dispatcher throughput by feed rail
│   ├── missingData.ts        recipes without a rate: applying the manual cycle times (applyCycleTimes)
│   ├── flow.ts               flow for all bases: even distribution (max-min, with LPs) or LP optimum; effective count, bottleneck; automatic count; balancing; virtual cargo
│   ├── chain.ts              Build chain: recipe choice (LP) and the factories and mines to place
│   ├── flows.ts              the links of the chain: which producer feeds which consumer
│   ├── upgrades.ts           upgrade / downgrade: building variants for the same product
│   ├── plan.ts               per base: nodes, ports (shortage, surplus), edges, summary
│   ├── nodeGeometry.ts       node sizes and port positions (shared by edges and drawing)
│   ├── rails.ts              drone rails: automatic rail set, manual (mixed) rail set and congestion, distribution across rails
│   ├── layout.ts             positions on the canvas, edge routes; automatic layout (ELK)
│   ├── edgePaths.ts          line styles: square / rounded / curved; label placement
│   └── format.ts             number formatting
├── composables/
│   ├── usePlanner.ts         data loading and the calculation pipeline (model → flow → base plans → drawing)
│   ├── useEditorActions.ts   composite actions: chain, balance, upgrade, arrange, port picker, copy / paste
│   └── usePanZoom.ts         zoom and pan on the canvas
└── components/
    ├── SidePanel/            side panel, assembled from the panel/ sections
    ├── panel/                BaseList, SummarySection, NodesSection, RailsSection, MissingDataSection, SettingsSection
    ├── ProductionGraph/      the canvas: selection, drag, link drag, right-click, keys
    ├── ContextMenu/          right-click menu: place with search, node and link actions
    ├── EntityEditor/         editor: factory (auto / manual count, count ↔ output), mine (custom output), cargo (virtual counterpart), storage, rails
    ├── PortPicker/           click an item row / drop a link on empty canvas: what supplies it / what uses it
    ├── GraphNode/            factory node (shortage / surplus, effective rate and % on the ports; typed count, auto / manual pill)
    ├── SpecialNode/          mine, Receiver, Dispatcher, storage, incoming / outgoing inter-base rail
    ├── LineNode/             rail line: inputs → the same out, total flow / capacity, congestion
    ├── RailLineEditor/       rail line editor: automatic / manual (mixed rail set), number of inputs
    ├── RailSetEditor/        manual rail set: a count per tier (e.g. 2× v.1 + v.3)
    ├── LinkEditor/           link window (click a line): the rail's items, rail (auto / manual), distribution, machines per rail
    ├── UpgradeButtons/       upgrade buttons (always shown; disabled with a note when there is no v.2)
    ├── GraphEdge/            one line (a rail between two nodes, possibly several items: comb, icons, sum) and its label
    ├── ItemIcon/             item icon (image, or a coloured circle when missing / broken)
    ├── graphEvents.ts        event types between the graph components
    ├── notice.ts             short notification at the bottom of the canvas
    ├── linkEnds.ts           what sets the pace at the two ends of a rail (link window)
    ├── storageState.ts       storage state texts (balanced / positive / sink)
    ├── missingData.ts        "no data" / "manual cycle time" texts (⚠)
    └── textFit.ts            truncating long names with "…" in the nodes (measured width)
public/
├── data/                     GAME DATA: game.yml (entry), buildings/*.yml, items/*.yml, start-project.json, schema/
└── icons/                    items/, buildings/, unassigned/ (images without data yet)
docs/                         USER-GUIDE, CONFIGURATION, DATA-SOURCES, ARCHITECTURE, GRAPH-ENGINE, AI-AGENTS
.claude/skills/verify-changes/smoke-test.mts   the engine smoke test (npm run smoke)
vite.config.ts                also holds the live data reload watcher and the `@/` alias
eslint.config.js, .prettierrc.json, .prettierignore, .editorconfig   code style (docs/ARCHITECTURE.md › Code conventions)
Dockerfile, docker-compose.yaml, docker/nginx.conf   Docker image: build + nginx (INSTALL.md)
AGENTS.md, CLAUDE.md, .github/, .claude/, .vscode/   AI agent rules, skills, editor settings (docs/AI-AGENTS.md)
```

The calculation pipeline:

```
public/data/*.yml                    project (nodes, machine counts, links, positions)
        │                                     │
        ▼  loader.ts                          │
        └──────────────┬──────────────────────┘
                       ▼  projectModel.ts  nominal inputs and outputs, links, cargo / rail transfers, virtual cargo;
                       │                   automatic factory counts from the available material (flow.ts)
                       ▼  flow.ts          flow on the links (even distribution with LPs, or LP optimum)
                       ▼  plan.ts          per base: nodes + ports (shortage, surplus) + edges,
                       │                   rail tier (rails.ts), rail line (lineRail), summary
                       ▼  layout.ts        the stored positions + line routes (one line per node pair; ELK only for arranging)
                       ▼  edgePaths.ts     SVG path in the chosen line style
```

## 5. Conventions in short

The full list: [ARCHITECTURE.md › Code conventions](docs/ARCHITECTURE.md#4-code-conventions).

- **English everywhere** – identifiers, comments, UI text, warnings, docs, YAML comments. Game
  names exactly as in the game.
- **Game data never in the code.** Every quantity is items per minute per building.
- **`src/engine/` never imports Vue**; project changes go through `src/project/projectStore.ts`.
- **Components:** `Name.vue` (template only) + `Name.ts` (`defineComponent`) + `Name.scss`
  (scoped). No `<script setup>`, no TypeScript syntax in templates (`!`, `as` – the build
  fails), no static inline styles, imports with the `@/` alias.
- **Styles:** colours only as CSS variables from `src/styles/_tokens.scss` – a new colour goes
  into both the `$light` and the `$dark` map.
- **Comments:** a JSDoc block at the top of every module / component (purpose and business
  rules), JSDoc on exported functions; comments explain *why*.
- **Persisted identifiers** (graph node ids, recipe ids, YAML ids, the localStorage keys) do
  not change without a migration in `src/project/sanitize.ts`.
- **No new npm dependency** without discussing it first in the PR.
- Leave `dist/`, `node_modules/` and `package-lock.json` alone (the lock file changes only
  through `npm install`).

## 6. Game data rules

- Only certain data; never invent a value. Convert cycle data to items per minute
  (`amount × 60 / seconds`) and keep the original in a YAML comment.
- Mark uncertain values in the YAML: `# NOT VERIFIED: …` / `# ASSUMPTION: …`.
- Name a source only in `docs/DATA-SOURCES.md`, never in YAML, code or UI.
- A recipe without a known cycle time goes in as `perCycle` (no rate).
- Do not add items or recipes from a source that disagrees with the existing data.

## 7. Before you open a pull request

1. `npm run verify` passes (format, lint, type check).
2. `npm run build` passes.
3. `npm run smoke` ends with `RESULT: OK` (mandatory for data changes).
4. For UI changes you tried it in the browser, in the light and the dark theme: right-click
   placing, dragging, box select, link drag, the port picker, the editor you touched.
5. The related documentation is updated (which file covers what: the table in section 3).
6. The PR description says **what** changed, **why**, and **how you verified it** (commands,
   what you clicked). One topic per PR.

GitHub Actions (`.github/workflows/pages.yml`) runs steps 1–3 on every pull request (format
check, lint, smoke test, build with the type check) and shows the result on the PR; after the
merge to `main` the same workflow publishes the site to GitHub Pages. Dependabot opens weekly
update PRs for the actions and the npm packages (`.github/dependabot.yml`); they go through the
same checks.

## 8. Ideas

- **Overview of all bases** on one graph, with the cargo pairs and rails between them
  (`basePlans` already computes every base).
- **A new line style:** `src/engine/edgePaths.ts`, described at the top of the file.
- **A new optimisation goal for Build chain** (e.g. fewest raw materials): `src/engine/chain.ts` → `weight`.
- **Large graphs (hundreds of machines):** run ELK in a Web Worker (`elkjs/lib/elk-worker.js`).
- **Drone Request Priority** (Low / Med / High per building), once its behaviour is known.
- **Desktop app:** the finished web app can be packaged with Tauri without code changes.
