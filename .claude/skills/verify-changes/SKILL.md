---
name: verify-changes
description: Verify changes at the end of a task - format check, lint, typecheck, production build, engine smoke test (data files, start project, flow LP, base plans, positions, chain builder, balancing, ELK layout, rail line capacity, effective output, link rails, copy / paste, even distribution, undo, automatic machine count), and a browser check of the UI when a tool is available. Use after every code or data change, before reporting the work as done (HU - ellenőrzés, teszt).
---

# Verification

The repo has no test framework; these steps are the verification. Run them from the project root.

## 1. Format, lint, typecheck

```bash
npm run verify        # = format:check + lint + typecheck
```

Must pass. Fix formatting with `npm run format` and fixable lint findings with
`npm run lint:fix`. Never silence errors (`any`, `@ts-ignore`, `eslint-disable`) to get there.

## 2. Smoke test (engine, no browser)

```bash
npm run smoke        # = tsx .claude/skills/verify-changes/smoke-test.mts
```

`smoke-test.mts` (in this folder):

1. loads `public/data/` with the real `loader.ts` – **every warning is an error**,
2. checks the icons,
3. reads `start-project.json` (`sanitize.ts`) – it must be a v2 project without warnings,
4. builds the model (no invalid links) and solves the flow LP for all bases,
5. builds each base plan, checks that every node kind has a size (`KIND_SPEC`), that every
   node has a stored position and every edge is routed, and runs the ELK auto layout,
6. builds a chain for every product of the start project and balances the whole project,
7. rail line: a manual v.1 line is capped and reports congestion (`lineDemand`), an auto
   line carries everything (parallel rails), a fixed input count rejects a new item, and an
   old stop-based line is converted to links through the line node,
8. effective output: a short factory runs at its bottleneck ratio, its reduced output is a
   shortage on the next input, only the bottleneck input of a two-input factory is short,
   and unlinked inputs count as supplied,
9. recipes without cycle time (`perCycle`): 0-rate ports, a manual cycle time gives the
   per-minute rate, the chain builder skips them, sanitize keeps valid manual values,
10. link rail: an auto rail picks parallel rails without congestion (`summary.parallel`), a
    manual rail caps the flow, reports congestion (`railDemand`, `needed`) and makes the
    target's input the bottleneck, enough manual capacity is not congested, sanitize
    clamps / drops `Link.rail`, `railDistribution` (even / fill + remainder) and
    `machinesPerRate` (target bottleneck / source max),
11. one rail for several items (rail line → two-input factory, capacity on the total),
    storage balanced / positive (also with a small outgoing rail), and a Dispatcher's
    automatic feed rail following its link's manual rail,
12. copy / paste (`projectStore`): links between the copied nodes (with the manual rail),
    unique names, the Dispatcher–Receiver pair remapped (a Dispatcher alone is unpaired),
    the pasted group at the given point and selected, rail ends not copied,
13. even distribution (`features.flowDistribution: even`): two sources share a consumer
    240 + 240, a source shared by three consumers splits into thirds; the `optimal` switch;
    an old shared rail (`buses`) becomes an auto rail line; mixed manual rail sets and the
    auto rail set are checked in the rail line section,
14. undo / redo (`projectStore`): one step per change; an automatic placement
    (`withoutHistory`) merges into the current step instead of being one,
15. automatic machine count (`Factory.auto`, `buildSizedModel`): an auto factory next to a
    manual one takes the rest of the shared source and rounds up (2.17 → 3), the next auto
    factory follows, the rounding is `partial` (not a shortage), no linked input = the stored
    count, an exact fit stays 100% (`even` and `optimal`), nothing arriving = 1 machine with
    a shortage, sanitize defaults to auto; virtual cargo: an unpaired Receiver / Dispatcher
    computes against its virtual counterpart (by rails and custom rate).

It must end with `RESULT: OK` and exit code 0. The "Products", "Shortages", "Surplus",
"no source for" and "graph warning" lines are informational: check whether they are expected.

If you wrote new calculation logic you may temporarily extend the script with a
targeted case (e.g. modify the project object before `solveFlows`), but keep only
generic checks in the final script.

## 3. Build (for code changes)

```bash
npm run build
```

The build also compiles every template: TypeScript syntax in a template (`!`, `as`) fails
here even when the typecheck passed. No chunk size warning is expected (the limit is 2000 kB in `vite.config.ts`, the bundle is ~1.8 MB); report it if one appears.

## 4. UI (for UI changes)

If you have a browser or Playwright tool:

```bash
npm run dev      # in the background; http://localhost:5173
```

- A fresh browser profile loads the start project (saved projects live in localStorage).
- Check the affected node / editor / panel in both light and dark theme.
- Canvas basics worth a quick pass: right-click place, drag, box select, link drag (onto a
  node and onto empty space), port picker, line click (link window, rail set editor),
  Ctrl+C / Ctrl+V, Ctrl+Z / Ctrl+Y, one line per node pair with several item icons,
  factory count typed in the node (click the number) and the `auto` / `manual` pill,
  the virtual receiver / dispatcher of an unpaired Dispatcher / Receiver (editor + footer).
  Node texts are SVG: read them with `textContent` (Playwright `inner_text` fails on SVG).
- The browser console must be free of errors.
- Stop the server at the end.

If you have no browser tool, tell the user what to check by hand.

## Report

Briefly, in the user's language: which steps ran, their results, and what remains unverified.
Never claim everything works if a step did not run.
