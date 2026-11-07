---
name: CI and GitHub Pages
description: Rules for the GitHub Actions workflow and the Dependabot configuration.
applyTo: ".github/workflows/**,.github/dependabot.yml"
---

# CI and GitHub Pages

- `.github/workflows/pages.yml` is the only workflow: on pull requests it checks and builds,
  on `main` (push or manual run) it also deploys `dist/` to GitHub Pages. Document every
  change in `INSTALL.md › GitHub Pages`.
- The steps call the npm scripts (`format:check`, `lint`, `smoke`, `build`), never inline
  copies of their commands – a new check goes into `package.json` first.
- **Pin every action to a full commit SHA** with the release in a comment
  (`uses: actions/checkout@<sha> # v7.0.1`); Dependabot updates both. Find the SHA of a tag
  with `git ls-remote https://github.com/<owner>/<action> refs/tags/<tag> "refs/tags/<tag>^{}"`
  (the `^{}` line is the commit of an annotated tag).
- **Least privilege:** the workflow default is `contents: read`; only the deploy job has
  `pages: write` and `id-token: write`. Checkout uses `persist-credentials: false`. No secrets
  are needed; do not add any.
- Deployments must not be cancelled half-way (`concurrency: github-pages`,
  `cancel-in-progress: false`); pull request runs may be cancelled by a newer push.
- No base-path configuration: the build is relative (`vite.config.ts › base: './'`).
- The Node.js version is `NODE_VERSION` (the current LTS); keep it within
  `package.json › engines`.
- Validate before committing: `actionlint` (with shellcheck) and the JSON schemas
  (`check-jsonschema --builtin-schema vendor.github-workflows` / `vendor.dependabot`).
- Dependabot ignores TypeScript majors (TypeScript 7 is not usable with vue-tsc /
  typescript-eslint yet, see `docs/ARCHITECTURE.md › Tool versions`); remove the ignore when
  that changes.
