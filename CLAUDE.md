# CLAUDE.md

The project rules live in AGENTS.md (shared with GitHub Copilot) and are imported here:

@AGENTS.md

## Claude Code specifics

- **Area rules:** Copilot loads `.github/instructions/*.instructions.md` automatically; you
  do not. Before editing files in an area, read the matching file (table in the
  "Area rules" section of AGENTS.md).
- **Skills:** under `.claude/skills/`; load them on your own when the description fits,
  or the user invokes them as `/add-game-data` etc.
- **Permissions:** `.claude/settings.json` pre-approves the verification commands
  (typecheck, lint, format, verify, build, smoke test); no need to ask for those.
- Start the dev server (`npm run dev`) in the background and stop it when you are done.
- Personal, unversioned notes belong in `CLAUDE.local.md` (add it to `.gitignore`).
