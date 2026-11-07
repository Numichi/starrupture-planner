---
name: update-docs
description: Update the project documentation (README.md, CONTRIBUTING.md, INSTALL.md, docs/USER-GUIDE.md, docs/ARCHITECTURE.md, docs/GRAPH-ENGINE.md, docs/CONFIGURATION.md, docs/DATA-SOURCES.md, AGENTS.md and agent files) after code or data changes, or write new docs. Use at the end of any change that affects a field, behaviour, command, file structure or business rule (HU - dokumentáció frissítése).
---

# Updating documentation

## Which file covers what

| File | Content | Update when… |
|---|---|---|
| `README.md` | project overview: AI-written notice, features, quick start, data sources, documentation map, tech stack, status | a headline feature, a data source, a doc file, a major tool version changes |
| `CONTRIBUTING.md` | setup, commands, where to change what, repository map, conventions in short, data rules, PR checklist, ideas | a command, a new file/folder, a convention or the PR checklist changes |
| `docs/USER-GUIDE.md` | using the planner: canvas, factories, mines, cargo, storage, rails, rail lines, distribution, errors | any user-visible behaviour, mouse / keyboard interaction, UI label |
| `INSTALL.md` | Node version, commands and flags, code quality commands, production build, web server, GitHub Pages workflow, Docker, troubleshooting | a command, port, dependency, Node version, the Pages workflow or a Docker file changes |
| `docs/ARCHITECTURE.md` | business concepts and rules, layers, state, ids, file map, extension points, limitations | a business rule, new module, new id format, new extension point |
| `docs/GRAPH-ENGINE.md` | model, flow LP, balancing, chain builder, upgrades, base plan, rail lines (capacity, congestion), geometry, positions/edge routing, ELK, line styles, canvas interaction | an LP variable/cost, node kind, edge logic, interaction or layout change |
| `docs/CONFIGURATION.md` | data file fields as tables, allowed values, limits, images, common warnings, `config.ts` | any YAML field, warning text, display size |
| `docs/DATA-SOURCES.md` | data sources (the ONLY place that names them), what may go into the data, recipes without cycle time, items outside production lines | new data source, a recipe gets/loses its cycle time, new game knowledge |
| `AGENTS.md`, `CLAUDE.md`, `.github/**`, `.claude/**`, `docs/AI-AGENTS.md` | agent rules and skills | a hard rule, command or directory structure changes |

The header comments of the data files (`public/data/**/*.yml`) and the JSDoc header
blocks of the source files (`@module` / `@component`) are documentation too: adjust them
when fields or behaviour change.

**Language:** everything is English, project docs and agent files alike
(`.github/instructions/docs.instructions.md`).

## How

1. Collect what changed (field, default, message text, command, file).
2. Take numbers and texts **from the code** (defaults: `loader.ts`, `config.ts`; sizes:
   `nodeGeometry.ts`; messages: the `r.warn` calls and the `warning` texts).
3. Style: references as tables, procedures as numbered lists, commands in code blocks.
4. Check the tables: a `|` inside code in a table cell must be `\|`; every row needs the
   same number of columns. Quick check:

```bash
python3 - <<'PY'
import re, glob
for f in glob.glob('*.md') + glob.glob('docs/*.md') + glob.glob('.github/**/*.md', recursive=True):
    block = False; cols = None
    for n, line in enumerate(open(f, encoding='utf-8'), 1):
        if line.startswith('```'): block = not block; continue
        if block or not line.startswith('|'): cols = None; continue
        s = re.sub(r'`[^`]*`', lambda m: m.group(0).replace('\\|', ''), line).replace('\\|', '')
        c = s.strip().strip('|').count('|') + 1
        if cols is None: cols = c
        elif c != cols: print(f'{f}:{n}: {c} columns, expected {cols}')
PY
```

5. Internal links are relative; section anchors follow GitHub's rule (lowercase,
   spaces → `-`, punctuation removed, accents kept).
