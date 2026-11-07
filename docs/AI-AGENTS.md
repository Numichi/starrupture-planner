# AI agent setup (Claude Code, GitHub Copilot)

This package gives AI agents running in VS Code (and on the command line) the project
rules, area-specific guidance and step-by-step procedures for common tasks.

All agent files are in English, like the rest of the project (UI text, code comments,
`docs/`). The agents are told to reply in the language the user writes in (the maintainer
usually writes Hungarian).

## What lives where, and who reads it

| File | Purpose | Claude Code | Copilot (VS Code agent, cloud agent, CLI) |
|---|---|---|---|
| `AGENTS.md` | **the shared rulebook**: stack, commands, hard rules, glossary, definition of done | imported by `CLAUDE.md` | automatically |
| `CLAUDE.md` | `@AGENTS.md` import + a few Claude-specific notes | automatically | disabled in VS Code (see below) |
| `.github/copilot-instructions.md` | short list, also used by Copilot code review | – | automatically |
| `.github/instructions/*.instructions.md` | area rules (by `applyTo` file pattern) | reads before editing (asked to by `CLAUDE.md`) | automatically when a matching file is edited |
| `.claude/skills/*/SKILL.md` | step-by-step tasks | automatically / `/name` | automatically / `/name` (Copilot also reads `.claude/skills/`) |
| `.claude/settings.json` | Claude Code: pre-approved verification commands (typecheck, lint, format, verify, build, smoke test) | yes | – |
| `.vscode/settings.json` | VS Code: enables the instruction files; Prettier on save, ESLint fixes | – | yes |
| `.vscode/extensions.json` | recommended extensions (YAML, Vue, ESLint, Prettier) | – | – |

**Single source of truth:** each rule lives in one place. General rule → `AGENTS.md`;
tied to a file type → `.github/instructions/`; procedure ("how do I add…") → skill.
Detailed documentation stays in `docs/`; the agent files link to it.

## Skills

| Skill | When | Manual call |
|---|---|---|
| `add-game-data` | add an item, recipe, building, build cost, mine, v.2 upgrade, purity, rail, Dispatcher, icon | `/add-game-data` |
| `add-building-type` | a new building type / canvas node kind across all layers | `/add-building-type` |
| `add-game-rule-switch` | a patch-dependent game rule behind a switch (`game.yml › features`) | `/add-game-rule-switch` |
| `verify-changes` | at the end of a task: format, lint, typecheck, build, smoke test, UI | `/verify-changes` |
| `update-docs` | which document covers what and what to update | `/update-docs` |

Agents also load them on their own when a request matches the description. The
descriptions contain Hungarian keywords too, so Hungarian prompts (e.g. "vedd fel a
titánércet tiszta és normál lelőhellyel") trigger them as well.

### Smoke test

Next to the `verify-changes` skill there is a runnable script that checks the engine
without a browser: it loads the data files (every warning counts as an error), reads the
start project (it must be the current v2 format), solves the flow LP, builds the base
plans (sizes, positions, edge routing, ELK), builds a chain for every product and
balances the whole project.

```bash
npm run smoke
```

You can use it yourself after editing data: it ends with `RESULT: OK`, or prints the
problem with file › location precision. (`tsx` is a dev dependency, so it runs offline
after `npm ci`.)

## Installing into the project

1. Extract the zip into the project **root** (next to `package.json`, `src/`).
   If you already have a `.vscode/settings.json`, merge the two files by hand.
2. Add the personal, unversioned files to `.gitignore`:

   ```
   CLAUDE.local.md
   .claude/settings.local.json
   ```

3. VS Code: install the recommended extensions (offered in the bottom-right corner),
   then reload the window so Copilot picks up the instructions.
4. Check: in Copilot Chat agent mode ask "Which rules apply when editing public/data?" –
   the answer should come from `game-data.instructions.md`. In Claude Code, `/memory`
   shows the loaded `CLAUDE.md` and `AGENTS.md`.

## VS Code settings (`.vscode/settings.json`)

| Setting | Value | Why |
|---|---|---|
| `chat.useAgentsMdFile` | `true` | load `AGENTS.md` |
| `github.copilot.chat.codeGeneration.useInstructionFiles` | `true` | `.github/copilot-instructions.md` and `*.instructions.md` |
| `chat.includeApplyingInstructions` | `true` | attach matching area rules automatically |
| `chat.useClaudeMdFile` | `false` | `CLAUDE.md` is for Claude Code; Copilot gets everything from `AGENTS.md`, so it is not loaded twice |

## Maintenance

- New hard rule → "Hard rules" in `AGENTS.md`; if it matters for code review, add a line
  to `.github/copilot-instructions.md` too.
- New area (e.g. `src/workers/`) → a new `.github/instructions/<name>.instructions.md`
  with an `applyTo` pattern, plus a row in the "Area rules" table of `AGENTS.md`.
- New recurring task → a new skill: `.claude/skills/<name>/SKILL.md`. `name` is
  lowercase letters, digits and hyphens (max 64 characters) and **must match the folder
  name**; `description` says what it does and when to use it (max 1024 characters).
  VS Code silently skips a skill with an invalid name.
- When a rule changes in the code (new folder, new command), update the agent files as
  well – the `update-docs` skill asks for this too.
