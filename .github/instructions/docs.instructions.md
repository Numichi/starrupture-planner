---
name: Documentation
description: Rules for writing Markdown documentation (README, INSTALL, docs/, agent files).
applyTo: "**/*.md"
---

# Documentation

Which file covers what, and when to update it: the `update-docs` skill.

- **Language:** everything is **English** – project documentation (`README.md`,
  `CONTRIBUTING.md`, `INSTALL.md`, `docs/*.md`) and agent files (`AGENTS.md`, `CLAUDE.md`, `.github/**`,
  `.claude/**`). Factual, second person ("you"), short sentences.
- References (fields, commands, files) as tables; procedures as numbered lists; commands
  and file excerpts in code blocks.
- Numbers and names come from the code (sizes, defaults, message texts) – never invent them.
- Data sources are named only in `docs/DATA-SOURCES.md` (and the other `.md` files) –
  never in YAML, code or UI.
- Escape `|` inside code spans in table cells: `` `r\|base\|recipe` ``.
- Internal links are relative (`docs/CONFIGURATION.md`, `#section-anchor`).
- Markdown is formatted by hand (Prettier ignores `*.md`).
- Keep agent files concise; details stay in `docs/` and are linked from there.
