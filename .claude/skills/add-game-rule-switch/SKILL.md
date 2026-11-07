---
name: add-game-rule-switch
description: Add a patch-dependent game rule as a switch under features in game.yml, keeping both behaviours and never losing data (pattern - cargoManyToOne, 1:1 vs N:1 cargo). Use when the user says the game behaves differently from the app, or a behaviour must become toggleable (HU - játékszabály, kapcsoló, patch után másképp működik).
---

# Game rule switch

Principle: the game may change with each patch, so the app knows **both** behaviours and
`game.yml` selects one. Switching never deletes data: the part that no longer applies
stays and is only marked as "not counted". Pattern: `features.cargoManyToOne` – search
for `cargoManyToOne`, `CargoRules`, `manyToOne`, `setCargoRules`.

## Steps

1. **Type** – `src/data/types.ts › GameFeatures`: a new `boolean` (or narrow union)
   field; the JSDoc explains both values and which one is the game's current behaviour.
2. **Loading** – `src/data/loader.ts`: add it to the `features` defaults object with the
   default (the game's current behaviour), read it with `r.bool(...) ?? default`.
   `checkKeys` uses `Object.keys(features)`, so the new key is allowed automatically.
3. **Schema** – `public/data/schema/game.schema.json › features.properties`: type,
   `default`, description.
4. **game.yml** – under `features:` a comment (what both values mean) + the value.
5. **Engine** – pass the rule in **as a parameter** (e.g. an `XRules` interface like
   `CargoRules`); in `usePlanner.ts` derive it as a `computed` from
   `gameData.value.features` and pass it on (`buildModel`, `buildBasePlan` `PlanOptions`,
   etc.). The engine never reads global state.
6. **Store** – if the rule also affects an editing operation (e.g. override), add a setter
   like `setCargoRules` that `usePlanner` calls from a `watch`.
7. **Old data** – mark the part that no longer applies, do not delete it (pattern:
   `overriddenDispatchers`, "overridden, does not send"). `sanitize.ts` must not enforce the rule.
8. **UI** – `src/components/panel/SettingsSection/` › Game rules: one row with the
   current value; editor labels and hints adapt to the rule (English text).
9. **Docs** – `docs/ARCHITECTURE.md` (business rules), `docs/CONFIGURATION.md`
   (`game.yml` table), `docs/USER-GUIDE.md` if it describes the behaviour.

## Verify

- `verify-changes` skill with both values: switch it in `game.yml`, run the smoke test,
  then restore the game's current behaviour.
- With the dev server running, editing the switch takes effect live on save – check it
  if you have a browser tool.
