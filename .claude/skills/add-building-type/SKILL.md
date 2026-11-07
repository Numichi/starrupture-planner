---
name: add-building-type
description: Introduce a new building TYPE or a new canvas node kind across all layers - data file, loader, project model, store, flow LP, base plan, geometry, layout, node component, placement menu, editor, panel, styles, docs. Use when the game adds a building that is not production, miner, storage, Dispatcher or Receiver (e.g. generator, splitter, gate), or when the canvas needs a new kind of node (HU - új épület fajta, új csomópont).
---

# New building type / node kind

This is code work across several layers. **Reference implementations: the mine
(`miner` / `mine:`) for a source and the storage (`storage` / `store:`) for a
pass-through** – search for them in the files below and follow the same pattern. Read
first: `docs/ARCHITECTURE.md` (sections 2.3, 3 and 4), `docs/GRAPH-ENGINE.md`.

## 0. Design (agree with the user if anything is unclear)

- What does it mean in the game? Source, consumer, pass-through, or indicator only?
- **How does it behave in the flow LP?** Producer with nominal ports (machine count ×
  rate), pass-through (in = out), sink, or no flow at all.
- What building data goes into the YAML (fields; is "a number or one per variant" needed)?
- What does the player configure on a placed instance (project fields)? Count/multiplier?
- Can it attach to rail lines? Does it belong at the edge of the base (first / last ELK layer)?

## 1. Game data layer

1. `src/data/types.ts`: `BuildingType` union + new `Building` fields (JSDoc).
2. `src/data/loader.ts`: `BUILDING_TYPES`, the building `checkKeys` list, parsing and
   validating the fields (`r.num`, `rateTable()`), reference checks, warnings (English).
3. `public/data/schema/buildings.schema.json`: `type` enum + new fields.
4. `public/data/buildings/<category>.yml`: a sample building (with `power` and `cost`), the
   type described in the header comment. Common fields (`power`, `cost`, `icon`) need no new
   code: if the node has `building` + `placed`/`power` in `plan.ts`, power demand and build
   cost (`buildCostOf`) include it automatically.

## 2. Project layer

5. `src/project/types.ts`: entity interface + field on `Base` + `emptyBase()` + a `nodeIds` helper.
6. `src/project/sanitize.ts`: lenient parsing, and `baseNodeIds()` (valid node ids).
7. `src/project/projectStore.ts`: `addX(baseId, …, at?)` (stores the position), `updateX`,
   `findX`, a `removeNodes` branch, `adoptItem` if it can take the item of its first link,
   `editTargetOf` + `EditTarget`, and export via `useProject()`.

## 3. Engine

8. `src/engine/projectModel.ts`: `NodeKind`, `NodeRef`, the node with its ports in
   `buildModel`, and `canAcceptInput` / `canProvideOutput` if it accepts new items.
9. `src/engine/flow.ts`: its constraints (producer rows, pass-through equality, sink, or
   transfer rows). Put calculation helpers in their own file (pattern: `mining.ts`).
10. `src/engine/plan.ts`: a `planNode` branch (`placed`, `power`, `special`, an English
    `warning`), a `SpecialInfo` variant.
11. `src/engine/nodeGeometry.ts › KIND_SPEC`: **mandatory** row (width, row height, footer lines).
12. `src/engine/layout.ts › toElkNode`: layer constraint if it belongs at the edge of the base.

## 4. UI

13. Rendering: `src/components/SpecialNode/` (`SpecialNode.ts › KIND_LABEL`, `linkLine`,
    `statusLine`, `tooltip`; header colour class in `SpecialNode.scss`) or a new component
    folder (`Name/Name.vue` template + `Name.ts` `defineComponent` + `Name.scss`). Root `<g>` must have
    `data-node-id`; port rows `data-port-dir`, `data-port-item` and emit `port` on `pointerdown.stop`.
14. `src/components/ProductionGraph/`: `ProductionGraph.ts › SPECIAL_KINDS` (or a new
    component branch in `ProductionGraph.vue`).
15. Placement: `src/components/ContextMenu/ContextMenu.ts` (`SPECIALS` list or a submenu) and
    `src/composables/useEditorActions.ts › placeSpecial`; if it fits a port click,
    `PortPicker/PortPicker.ts` (`transport` list) + an `addProducerX` / `addConsumerX` action that
    takes the optional `drop` point and places through `newNodeAt` (so a link dropped on
    empty space puts the new node's port there).
16. `src/components/EntityEditor/`: an editor section in the template + its logic and the
    `TITLES` map in `EntityEditor.ts`.
17. Panel overview: `src/components/panel/NodesSection/NodesSection.ts › GROUPS` and `meta()`.
18. `src/styles/_tokens.scss`: header colour token in **both** the `$light` and the `$dark`
    map.

All UI text is English; templates contain no TypeScript syntax.

## 5. Sample data and docs

19. `public/data/start-project.json`: one instance so the sample shows it (build it in the
    app and export, so it has a position).
20. Documentation (`update-docs` skill): `docs/ARCHITECTURE.md` (concepts, file map,
    ids), `docs/GRAPH-ENGINE.md` (model and node tables), `docs/CONFIGURATION.md` (fields,
    type table, start project ids), `docs/USER-GUIDE.md` (special buildings table, how to use
    it), `CONTRIBUTING.md` (repository map, when a new component folder is added).

## 6. Verify

`verify-changes` skill: typecheck, build, smoke test (it reports a missing `KIND_SPEC` or a
missing position), and in the browser: place it with right-click, connect it by dragging,
it opens the editor, it is readable in the dark theme.
