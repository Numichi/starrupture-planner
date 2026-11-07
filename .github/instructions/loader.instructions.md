---
name: Data loader
description: Rules for changing src/data (types.ts, loader.ts).
applyTo: "src/data/**"
---

# `src/data/` – loading and game data types

- `loader.ts` is the only place that knows the YAML. The engine only sees `GameData`.
- **Field-level problem → `r.warn(where, message)`**; the element is skipped, the rest
  keeps working. `LoadError` only for fatal problems (YAML syntax, missing file, missing `files:`).
- Message format: `file › id › location: what is wrong`, in English (it is shown in the
  UI), with a `suggest()` hint for typos (`(did you mean "…"?)`).
- New field: add it to the `checkKeys` list (otherwise it triggers an "unknown field"
  warning), read it with the typed helpers (`r.str`, `r.num` with `{ positive, integer, min, required }`,
  `r.bool`), and add it to `public/data/schema/*.schema.json` and `docs/CONFIGURATION.md`.
- "A number, or one per variant" values: use the existing `rateTable()` helper (see the
  `RateTable` type and `engine/rateTable.ts`); variant names come from the lists in `game.yml`.
- Validate references (item, building, purity, rail) at the right point of the load:
  items are read after buildings, so `mines` item ids are checked afterwards.
- For a removed field, emit a targeted warning that says what to write instead
  (pattern: `OLD_DISPATCHER_KEYS`, the conversion of the old `time` field).
- Document fields in `types.ts` with JSDoc; it is the engine's contract.
