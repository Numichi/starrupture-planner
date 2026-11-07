---
name: Vue UI
description: Rules for changing Vue components, composables and styles.
applyTo: "src/components/**,src/composables/**,src/App.*,src/main.ts,src/styles/**"
---

# UI (Vue 3)

- **One folder per component** – pure separation of markup, logic and styles:
  `Name/Name.vue` (the `<template>` only, then `<script lang="ts" src="./Name.ts">` and
  `<style lang="scss" scoped src="./Name.scss">`), `Name/Name.ts`
  (`export default defineComponent({ name, components, props, emits, setup })`),
  `Name/Name.scss` (left out when there are no local styles). Do not use `<script setup>`
  (it cannot have a `src`), and keep the template in the `.vue` file (vue-tsc type-checks
  templates only there).
- `setup()` returns exactly what the template uses; props use runtime types with
  `PropType<…>`, emits are validator objects (`emits: { port: (_e: PortDown) => true }`),
  child components are listed in `components: {}`.
- **Templates are plain JavaScript expressions**: no `!`, no `as`, no generics – the
  template compiler cannot know the language of an external script (the build fails).
  Move such logic into a function or computed in the `.ts` file.
- Every `.ts` starts with a JSDoc block (`@component Name`): what it does, which events it
  emits, which business rules it shows. The `.vue` starts with a one-line HTML comment.
- Imports with the `@/` alias (`@/components/…`, `@/engine/…`, `@/composables/…`).
- State: `useProject()` (project + mutation functions, selection, undo), `usePlanner()`
  (data, calculation, display settings) and `useEditorActions()` (chain, balance, upgrade,
  arrange, port picker actions). Rule-bearing changes only through these functions;
  `v-model` only for simple fields. The side panel is a read-only overview: placing and
  linking happens on the canvas (right-click menu, port picker, link drag).
- Numbers: `formatRate`, `formatCount`, `formatPower` (`engine/format.ts`); units:
  `RATE_UNIT_LABEL`, `POWER_UNIT_LABEL` (`config.ts`); sorting / dates with `LOCALE`. Never
  hard-code "/min".
- Graph sizes and port positions come only from `engine/nodeGeometry.ts` (edge routing and
  ELK use it too) – do not compute sizes inside a component.
- **Styles (SCSS)**: colours only via CSS variables (`var(--…)`) defined in
  `src/styles/_tokens.scss` – a new token goes into **both** the `$light` and the `$dark`
  map (the `custom-properties` mixin emits the dark map in both dark selectors). Shared
  panel / editor classes (`.field`, `.segmented`, `.callout`, `.editor-status`, `.meter`…)
  live in `src/styles/_panel.scss`; component styles are scoped in `Name.scss`. No static
  inline styles (`style="…"`); dynamic bindings (`:style="{ width }"`) are fine. Keep the
  cascade order where states override each other (e.g. congested after manual).
- Show a selector (purity, feed rail, etc.) only when there are 2+ options.
- Recipes without cycle time: use `components/missingData.ts › rateNote` for the ⚠ text
  ("no data" / "manual cycle time"); never name a data source in UI text.
- Canvas interaction is centralised in `ProductionGraph/` (pointer state machine: pan,
  box, nodes, link). Node components only render: root `<g>` with `data-node-id`, port rows
  with `data-port-dir` / `data-port-item` emitting `port` on `pointerdown.stop`, edges with
  `data-link-id`. Drags write `dragOffset` (usePlanner) and commit once on pointer up.
  Edge labels are placed together in `ProductionGraph` (`edgePaths.ts › placeLabels`,
  collision-free; fan-out labels on the branches); `GraphEdge` only draws at `labelAt`.
  A link released on empty space opens `PortPicker` with `PickerState.drop` (world point);
  the picker offers only what fits that port, and every `useEditorActions › add*` action
  takes that `drop` and places the new node via `newNodeAt` (its linked port on the point).
  New special node: `ProductionGraph.ts › SPECIAL_KINDS` and `projectStore › editTargetOf`.
  Clicking an edge selects the link and opens `LinkEditor` (`EditTarget` kind `link`); it
  shows the whole rail of the node pair (`PlanRail`) and describes both ends with
  `components/linkEnds.ts › describeEnd`. Storage state texts: `components/storageState.ts`.
  Ctrl+Z / Ctrl+Y are handled before the "typing" check: they undo the project even from
  an editor field (blurring it first), except in search fields; match letters with
  `keyIs` (layout character, physical key only for non-Latin layouts), never with `e.code`
  alone (QWERTZ). Any automatic project write from a watcher must use
  `projectStore › withoutHistory`.
  Ctrl+C / Ctrl+V go through `useEditorActions › copyNodes / pasteNodes` (laid-out
  positions; paste at the snapped pointer world point); skip Ctrl+C when page text is selected.
  Controls inside a node (factory count, `auto`/`manual` pill in `GraphNode`) stop
  `pointerdown` so they never start a drag; the count is edited in place via a
  `foreignObject` text input (Enter / blur commits only if changed, Esc cancels) and written
  with `projectStore › setFactoryCount`.
- Cargo virtual counterpart: the editor shows Off / By rails / Custom for a Dispatcher
  (virtual receiver) and a Receiver (virtual dispatcher); the item is never configured
  there (it comes from the linked material). A new custom rate starts at the rail-based
  limit. Node footers show it via `special.virtual` (`SpecialNode`).
- Edges: ONE `GraphEdge` per rail (node pair) – several items drawn as a comb (stubs in
  the item colour, neutral trunk), the label shows all item icons, the total and the rail
  set. Selection matches any link of the rail (`isSelectedRail`); Delete removes the whole
  rail (`removeRail`). Colours: auto parallel rails amber (`--warn-*`), manual blue
  (`--accent`), only a congested manual rail is red (`--danger`). Manual rail sets are
  edited with `RailSetEditor` (per tier a stepper; at least one rail stays).
- UI text: short, English, telling the user what to do (e.g. "Too little: 1 more mine is
  needed"). Use `role`/`aria-*` for control semantics (e.g. `role="radio"`).
- Wrap browser storage (`localStorage`) reads/writes in `try/catch`; keep the existing
  storage keys (`starrupture-planner.project`, `starrupture-planner.display`) – renaming
  them loses saved data.
