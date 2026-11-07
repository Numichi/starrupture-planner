# Installation and running

Four ways, depending on the goal:

| Goal | Needs | Command |
|---|---|---|
| **Development**, data editing with live reload | Node.js | `npm ci` → `npm run dev` |
| **Production build** for your own web server | Node.js (for the build only) | `npm ci` → `npm run build` → upload the `dist/` folder |
| **GitHub Pages**, published automatically on every push to `main` | a GitHub repository | one-time setting, then `git push` (section 6) |
| **Docker**, with one command | Docker + Compose | `docker compose up -d --build` |

The program is a static website: there is no server of its own and no database. The browser
stores the project (localStorage); the game data comes from the YAML files of the `data/`
folder.

---

## 1. Requirements

### Node.js

| | Version |
|---|---|
| **Minimum** | **22.12** (Node 20 has been unsupported since April 2026; Vite 8 itself would still start on 20.19) |
| **Recommended** | the current LTS: **Node 26** (LTS since 28 October 2026), or the still supported **24** / **22** |
| Tested | 22.23 |
| npm | the one installed with Node.js (10+) |

The `engines` field of `package.json` records this too (`>=22.12.0`). With an older Node
npm warns, and the build or the start may fail with an obscure error.

Other: about 130 MB free space for `node_modules`, internet for the first `npm ci` (npm
registry). Browser: a recent Chrome, Edge, Firefox or Safari.

### Installing Node.js

**Windows**: the LTS installer (`.msi`) from [nodejs.org](https://nodejs.org), or:

```powershell
winget install OpenJS.NodeJS.LTS
```

**macOS**: the nodejs.org installer, or with Homebrew: `brew install node`

**Linux** (and any system that needs several Node versions): [nvm](https://github.com/nvm-sh/nvm)

```bash
nvm install --lts
nvm use --lts
```

Check (in a new terminal):

```bash
node -v     # e.g. v26.x or v24.x or v22.12+
npm -v      # 10.x or newer
```

---

## 2. Installing the project

```bash
# in the project folder (next to package.json)
npm ci
```

- `npm ci` – installs exactly the versions of `package-lock.json` (recommended, reproducible).
- `npm install` – when you changed `package.json` (a new package), this updates the lock file too.

---

## 3. Development mode

```bash
npm run dev
```

Open **http://localhost:5173**. Stop: `Ctrl+C`.

In this mode, saving a file under `public/data/` or `public/icons/` makes the browser
recalculate by itself, without a page refresh (the project stays). Code changes show up
immediately too.

Parameters (`npm run` needs `--`, then the Vite options follow):

| Command | Purpose |
|---|---|
| `npm run dev -- --port 3000` | another port |
| `npm run dev -- --host` | reachable from the local network too (e.g. from a phone: `http://<machine IP>:5173`) |
| `npm run dev -- --open` | opens the browser |
| `npm run dev -- --host --port 3000` | can be combined |

When 5173 is taken, Vite picks the next free port by itself and prints it.

### Code quality

| Command | Purpose |
|---|---|
| `npm run typecheck` | type check (vue-tsc), templates included |
| `npm run lint` / `npm run lint:fix` | ESLint (TypeScript, Vue, blank-line layout); `:fix` repairs what it can |
| `npm run format` / `npm run format:check` | Prettier (TypeScript, Vue, SCSS, JSON) |
| `npm run smoke` | engine smoke test (data files, starter project, flow, plans, chain builder, balancing, layout); ends with `RESULT: OK` |
| `npm run verify` | format check, lint and type check together |

The rules are in `eslint.config.js`, `.prettierrc.json` and `.editorconfig`; VS Code picks
them up with the recommended extensions (`.vscode/extensions.json`).

---

## 4. Production build

```bash
npm run typecheck   # type check only (optional, the build runs it too)
npm run build       # type check + build into dist/
npm run preview     # try the finished build: http://localhost:4173
```

`preview` accepts the same options: `npm run preview -- --host --port 8080`.

The content of `dist/` (about 2 MB):

```
dist/
├── index.html
├── assets/        the compiled JS and CSS (with a hash in the file name)
├── data/          the game data – EDITABLE HERE TOO, without a rebuild
└── icons/         the images – replaceable as well
```

---

## 5. Deploying to a web server

Copy the **content** of the `dist/` folder to any static web server (nginx, Apache, IIS,
GitHub Pages, Netlify, the web server of a NAS etc.).

- **It works in a subfolder too** (e.g. `https://example.com/planner/`), no setting needed.
- **It works only through a web server.** Opening `dist/index.html` with a double click
  (`file://`) gives an empty page, because the browser does not allow loading the data files
  that way.
- The server must serve the `.yml` files. Apache and nginx do that by default. **With IIS**
  add the MIME type: `.yml` → `text/yaml` (otherwise 404).
- Changing data in production: edit the `data/*.yml` file on the server, then use the
  **Reload** button in the UI (or refresh the page).

A quick try with a local server, with Node or Python:

```bash
npx serve dist                                   # Node: http://localhost:3000
python -m http.server 8080 --directory dist      # Python: http://localhost:8080 (Windows: py -m …)
```

---

## 6. GitHub Pages

The workflow `.github/workflows/pages.yml` checks, builds and publishes the planner to GitHub
Pages. Nothing has to be built or uploaded by hand.

**One-time setup** (in the GitHub repository):

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main` (or run the workflow by hand: **Actions → GitHub Pages → Run workflow**).
3. The address appears in the run summary and under Settings → Pages:
   `https://<owner>.github.io/<repository>/` (a project site; a custom domain can be set there
   too).

**What the workflow does:**

| Event | Jobs |
|---|---|
| push to `main`, manual run on `main` | *Check and build* → *Deploy to GitHub Pages* |
| pull request | *Check and build* only (nothing is published) |
| manual run on another branch | *Check and build* only |

*Check and build*: `npm ci` → `npm run format:check` → `npm run lint` → `npm run smoke` →
`npm run build` (type check + Vite) → the `dist/` folder is uploaded as the Pages artifact. A
failing check stops the run, so a broken state is never published. *Deploy* publishes the
artifact to the `github-pages` environment; deployments run one after the other and are never
cancelled half-way.

| Setting | Value | Where to change it |
|---|---|---|
| Node.js | 26 (the current LTS) | `NODE_VERSION` in `pages.yml` |
| Published branch | `main` | `on.push.branches` and the `if:` of the deploy job |
| Permissions | build: `contents: read`; deploy: `pages: write`, `id-token: write` | `pages.yml` |
| Action versions | pinned to commit SHAs (release in the comment) | Dependabot proposes updates weekly (`.github/dependabot.yml`), together with the npm packages |

Notes:

- **No base path setting is needed**: the build uses relative paths (`base: './'` in
  `vite.config.ts`), so the app works under `/<repository>/` as well as on a custom domain.
- **The data is part of the site** (`data/*.yml`, `icons/`). To change the published data,
  change `public/data/` and push: the workflow publishes it again. The Pages CDN may serve the
  old files for up to about 10 minutes after a deployment.
- **The project stays in the visitor's browser** (localStorage), like everywhere else; the site
  stores nothing.
- If the deploy job fails with "Ensure GitHub Pages has been enabled", step 1 of the setup is
  missing. If it says the branch is not allowed to deploy, check Settings → Environments →
  `github-pages` → Deployment branches (it should include `main`).

---

## 7. Docker

The image is built in two stages (`Dockerfile`): Node.js compiles the app, then a small
**nginx** image serves it. The running container has no Node.js.

**Needs**: Docker Desktop (Windows, macOS) or Docker Engine + the Compose v2 plugin (Linux).
The command is `docker compose` (with a space); the old `docker-compose` v1 is not
recommended. The build needs internet (Docker Hub: the `node` and `nginx` images; npm
registry).

### Start

```bash
docker compose up -d --build
```

Open **http://localhost:8080**

| Command | Purpose |
|---|---|
| `docker compose up -d --build` | build and start in the background (after code changes too) |
| `docker compose ps` | status (`healthy` means it responds) |
| `docker compose logs -f` | log |
| `docker compose restart` | restart |
| `docker compose down` | stop and remove the container |

### Port

8080 by default. Another port:

```bash
PORT=9000 docker compose up -d                  # Linux, macOS
```

```powershell
$env:PORT=9000; docker compose up -d            # Windows PowerShell
```

Or permanently: create an `.env` file next to `docker-compose.yaml`, with `PORT=9000` in it.

### Editing data files with Docker

`docker-compose.yaml` mounts the `public/data/` and `public/icons/` folders of your machine
into the container read-only. When you change a YAML file or an image there, the **Reload**
button in the UI brings it in – **no rebuild needed**. (Live, automatic reload exists only
in development mode.)

To use the data built into the image (e.g. when you move only the image to another
machine), delete the `volumes:` part of `docker-compose.yaml`.

### Without Compose

```bash
docker build -t gyartas-tervezo .
docker run -d --name gyartas-tervezo -p 8080:80 gyartas-tervezo

# with the data files mounted (Linux/macOS):
docker run -d --name gyartas-tervezo -p 8080:80 \
  -v "$PWD/public/data:/usr/share/nginx/html/data:ro" \
  -v "$PWD/public/icons:/usr/share/nginx/html/icons:ro" \
  gyartas-tervezo
```

### Node.js version for the build

`node:22-alpine` by default (tested with it). Another version:

```bash
docker compose build --build-arg NODE_VERSION=26
docker build --build-arg NODE_VERSION=24 -t gyartas-tervezo .
```

or change the `NODE_VERSION` value in `docker-compose.yaml`.

### Files

| File | What it does |
|---|---|
| `Dockerfile` | build (`npm ci`, `npm run build`) + nginx image |
| `docker-compose.yaml` | port, data mount, automatic restart |
| `docker/nginx.conf` | `.yml` → `text/yaml`; data and images always come fresh (`no-cache`), JS/CSS can be cached for long; gzip |
| `.dockerignore` | `node_modules`, `dist`, `docs` etc. stay out of the build context |

> The project (bases, nodes) is stored in the **browser**, not in the container: every
> browser and user sees their own. Backup: **Export** in the UI.

---

## 8. Updating to a new version

1. In the UI: **Export** – saves the project to JSON (to be safe).
2. If you have your own data under `public/data/`, save it.
3. Unpack the new version, copy your own `public/data/` and `public/icons/` back.
4. `npm ci` (if `package.json` changed), then `npm run dev` or `npm run build`; with Docker:
   `docker compose up -d --build`.
5. If the old project looks odd in the browser: **Import** from the saved file, or **New
   project** (from `start-project.json`).

---

## 9. Troubleshooting

| Symptom | Cause, fix |
|---|---|
| `You are using Node.js … Vite requires Node.js version 20.19+ or 22.12+` or `npm warn EBADENGINE` | Old Node.js: update it (section 1), open a new terminal. |
| Windows PowerShell: `npm.ps1 cannot be loaded because running scripts is disabled` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `cmd`. |
| `npm ci`: `package.json and package-lock.json … are not in sync` | `package.json` changed: `npm install`. |
| `npm ci` network or certificate error on a corporate network | `npm config set proxy http://proxy:port`, `npm config set https-proxy …`; for your own CA `npm config set cafile <path>`. |
| Strange install errors (`EPERM`, `EBUSY`, missing module) | Close VS Code and the running `npm run dev`, delete the `node_modules` folder, `npm ci`. |
| Empty page when opening `dist/index.html` | A web server is needed (section 5), it does not work from `file://`. |
| "The data file cannot be read … file not found" | The `data/` folder is missing on the server, or the server does not serve `.yml` (IIS: MIME type). |
| A data change does not show | In production / Docker: the **Reload** button. In development mode: is `npm run dev` running? |
| Docker: `port is already allocated` | Another port: `PORT=9000 docker compose up -d`. |
| Docker: `toomanyrequests` / the `node` or `nginx` image cannot be pulled | Docker Hub limit or network: `docker login`, or try later. |
| Docker, Linux: `Permission denied` on the mounted folder (SELinux) | In `docker-compose.yaml` use `:ro,z` instead of `:ro`. |
| Docker: the old UI shows after a code change | `docker compose up -d --build` (the `--build` is needed). |

---

## Commands in one place

```bash
npm ci                         # install the dependencies (once, and after an update)
npm run dev                    # development server: http://localhost:5173
npm run dev -- --host          #   … reachable from the local network too
npm run typecheck              # type check
npm run lint                   # ESLint
npm run format                 # Prettier
npm run smoke                  # engine smoke test
npm run verify                 # format check + lint + type check
npm run build                  # production build → dist/
npm run preview                # try the build: http://localhost:4173

docker compose up -d --build   # Docker: build + start → http://localhost:8080
docker compose logs -f         # Docker log
docker compose down            # Docker stop
```
