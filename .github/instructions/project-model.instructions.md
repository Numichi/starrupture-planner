---
name: Project model
description: Rules for changing src/project (project types, store, sanitize).
applyTo: "src/project/**"
---

# `src/project/` – the player's project

- **`types.ts`**: a new field goes into the type AND into the `emptyBase()` /
  `defaultSettings()` defaults.
- **`sanitize.ts`**: read every field leniently (missing → default, invalid element
  skipped + warning). Old saves lack new fields – that is not an error.
- **`projectStore.ts`**: every mutation lives here as a function (`addX(baseId, …, at?)`,
  `updateX`, `findX`, `addLink`, `removeLink`, `removeNodes`, `moveNodes`, `setPositions`,
  `setCounts`) and is added to the object returned by `useProject()`. The rules live here:
  - cargo pairing: `pair()` – under the 1:1 rule it overrides the Receiver's previous Dispatcher,
  - `addLink` adopts the item on item-less nodes (dispatcher, storage, receiver) and adds it
    to a rail link's `items`,
  - `removeNodes` cleans up references (links, rail line stop `nodeId`, positions,
    pairings; a rail end removes the whole `RailLink`),
  - undo/redo works on JSON snapshots of the project – keep the project plain JSON.
    Automatic changes the app makes on its own (auto-placing nodes without a position,
    the v1 migration) go through `withoutHistory(fn)`: they merge into the current
    snapshot instead of being a step – otherwise undo would be redone at once and stick.
    `restore` keeps the editor open while its target still exists.
- Operations that need game data or the calculation (chain, balance, upgrade, arrange)
  belong in `composables/useEditorActions.ts`, not in the store.
- Extend the `EditTarget` union and `editTargetOf()` for a new editable element.
- Ids: `newId('prefix')`. Node ids (`nodeIds`: `fac:<id>`, `mine:<id>`…) are stored in
  links and positions – do not change their format. Old stop-based rail lines (`stops`)
  are converted in `sanitize.ts › convertStops` (links through the line node).
- `Link.rail` (optional `RailCount[]` = `[{ tier, count }]`, mixed tiers, absent = automatic):
  one rail per node pair (`linkRailKey`), so `setLinkRail` writes the same set on every link
  between the same two nodes (`cleanRails`: count ≥ 1, merged tiers), `removeRail` deletes
  all links of a rail (one drawn line), and `addLink` copies a sibling's manual rail.
  `RailLine.rails` is the same kind of set (manual mode). Sanitize (`railCounts`) accepts the
  old `{ tier, count }` object and the old line `tier` + `parallel`, drops invalid values,
  and migrates the removed `buses` (shared rails) to auto rail lines (`bus:<id>` →
  `line:<id>` in links and positions).
- Copy / paste: `copyNodes(baseId, ids, positions?)` keeps an in-memory `clipboard` (deep
  clones, only links between copied nodes; rail ends skipped), `pasteNodes(baseId, at?)`
  makes new ids and names (`copyName`), keeps a Dispatcher's pair only if its Receiver was
  copied too, offsets positions and selects the new nodes.
- `Factory.auto` (default true; sanitize: missing → true): the count comes from the inputs;
  `count` is the manual value (also the fallback when there is no linked input).
  `setFactoryCount(id, n | 'auto')`: a number switches to manual with that count (no-op when
  unchanged, so no empty undo step); `'auto'` switches back. `addFactory(…, auto = true)`.
- `Dispatcher.virtual` / `Receiver.virtual` (`VirtualCargo | null`: `{ mode: 'rail' | 'custom', rate }`):
  the virtual counterpart of an unpaired cargo node; `addDispatcher` / `addReceiver` start with
  `null`, sanitize reads it leniently (`virtualCargo`), the editor writes it with
  `updateDispatcher` / `updateReceiver`. The item is never part of it.
- `settings.cycleTimes` (recipe id → seconds): manual cycle times for recipes without a rate
  in the data (`perCycle`); set via `setCycleTime`, sanitized to positive numbers only.
- Default names (bases, nodes, copies) are English. The project is saved under the
  localStorage key `starrupture-planner.project` (renaming it loses saved projects; the
  format version is `Project.version` inside the JSON).
- The store does not import calculations from the engine; it receives game rules from outside (`setCargoRules`).
- `PROJECT_VERSION` is 2. v1 projects: `sanitize.ts` returns `legacy` (targets, auto
  mines); `useEditorActions.ts › migrateLegacy` builds the factories after data load.
