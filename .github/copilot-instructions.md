# Copilot – short rules

The full rulebook is `AGENTS.md` (Copilot agent mode loads it too); area rules live in
`.github/instructions/`. This short list is also used by Copilot code review.

- Reply in the user's language (usually Hungarian). Everything in the repository is
  English: identifiers, comments, UI text, docs.
- Vue 3 + TypeScript + Vite; no Pinia, router or UI library; no React.
- Components: one folder per component – `X.vue` (template only) + `X.ts`
  (`defineComponent`) + `X.scss` (scoped). No TypeScript syntax in templates.
- Styles are SCSS; colours only as CSS variables from `src/styles/_tokens.scss` (add a new
  token to both the `$light` and the `$dark` map).
- Game data only in `public/data/*.yml`; every quantity is **items per minute per building**.
- `src/engine/` never imports Vue; game rules are passed in as parameters.
- Project changes go through the functions in `src/project/projectStore.ts`.
- Persisted ids (graph node ids, recipe ids, YAML ids, localStorage keys) must not change
  without a migration.
- New YAML field: `types.ts` + `loader.ts` (`checkKeys`!) + `schema/*.json` + `docs/CONFIGURATION.md`.
- New graph node kind: a row in `nodeGeometry.ts › KIND_SPEC` is mandatory.
- JSDoc on every module / component and on exported functions; airy layout (ESLint).
- CI (`.github/workflows/pages.yml`): actions pinned to commit SHAs, least-privilege
  permissions, steps call the npm scripts.
- Verify: `npm run verify` (format + lint + typecheck), `npm run build`, `npm run smoke`.
