# Copilot Instructions — MeshForge

## Project Overview

**MeshForge** is a web application that converts mesh files (STL, OBJ) into clean STEP solids.

It has three layers:

1. **Flask web server** (`src/app.py`) — REST API + SSE job streaming, serves the frontend.
2. **Mesh pipeline** (`src/mesh_pipeline.py`) — two-stage conversion: PyMeshLab cleanup → pythonocc-core solid export.
3. **TypeScript/SCSS frontend** (`src/`) — Three.js 3D viewer, drag-and-drop file upload, real-time job progress via SSE.

## Directory Structure

```
requirements.in         Python deps (source) — re-pin with pip-compile
requirements.lock       Pinned Python deps (generated)
package.json            Node.js devDeps: typescript, sass, prettier, eslint, jest
tsconfig.json           TypeScript config (rootDir: src, outDir: static)
pytest.ini              pytest config (testpaths=tests, pythonpath=src)
conftest.py             Stubs mesh_pipeline before import (keeps tests OCC-free)
jest.config.js          Jest config (testEnvironment: node, coverage from static/)
jest-global-script-transform.cjs  Jest transform for global-script compiled JS
sonar-project.properties  SonarQube project config
DEVELOPMENT.md          Local/manual setup guide
Dockerfile.base         Base image build (SWIG + OCCT + pythonocc)
src/
  app.py                Flask backend
  mesh_pipeline.py      Conversion pipeline (CLI-usable too)
  index.html            App shell — served directly by Flask from src/
  main.ts               DOM refs, file management UI, modal, bootstrap
  three-global.d.ts     Ambient type declarations for CDN Three.js globals
  assets/
    favicon.svg         App favicon
  styles/
    style.scss          Main entry point (compiled to static/style.css)
    variables.scss      CSS custom properties and SCSS variables
    mixins.scss         Reusable SCSS mixins
    light.scss          Light theme overrides
  types/
    types.ts            TypeScript interfaces (Job, SseMessage, Viewer, Triangle)
  utils/
    utils.ts            fmtSize(), escHtml()
  features/
    mesh-preview.ts     2D canvas thumbnail renderer + STL/OBJ parsers
    viewer.ts           Three.js 3D viewer (WebGL)
    jobs.ts             Job/batch card DOM management
    sse.ts              SSE connection and job update handling
static/                 Compiled JS/CSS — build output only, not committed
jobs/                   Per-job working directories (created at runtime)
tests/
  test_app.py           21 pytest tests covering all Flask routes
  test_mesh_pipeline.py 20 pytest tests for pipeline logic (OCC/pymeshlab mocked)
  frontend/
    utils.test.js       Jest tests for fmtSize() and escHtml()
    mesh_preview.test.js Jest tests for STL/OBJ parsers and subsampleFlat()
    jobs.test.js        Jest tests for job/batch card DOM management
    main.test.js        Jest tests for main UI bootstrap and file management
    sse.test.js         Jest tests for SSE connection handling
    viewer.test.js      Jest tests for Three.js viewer
```

## Runtime Environment

### Flask dev server (local / dev container)

```bash
flask run --debug --host=0.0.0.0 --port=5000
```

Environment variables: `FLASK_APP=src/app.py`, `LD_LIBRARY_PATH=/opt/conda/lib` (dev container only).

### Docker

```bash
docker build -t meshforge .
docker run --rm -p 5000:5000 meshforge
# With persistent job storage:
docker run --rm -p 5000:5000 -v meshforge_jobs:/app/jobs meshforge
```

### CLI pipeline (standalone)

```bash
python3 src/mesh_pipeline.py input.stl
```

## Frontend Build

TypeScript and SCSS are compiled to `static/`. There is **no module bundler** — all `.ts` files compile as global scripts sharing one namespace. Script load order in `index.html` matters.

```bash
npm run build             # tsc → static/
npx sass src/styles/style.scss:static/style.css --style=expanded --no-source-map
```

Watch tasks (VS Code tasks.json / devcontainer auto-start):

- `Watch TS` — `npm run watch:ts` (`tsc --watch`)
- `Watch SCSS` — `npx sass --watch src/styles/style.scss:static/style.css ...`

`static/` is gitignored (pure build output).

## Flask API

| Method | Route                     | Purpose                                            |
| ------ | ------------------------- | -------------------------------------------------- |
| `GET`  | `/`                       | Serves `src/index.html`                            |
| `POST` | `/api/convert`            | Accepts `files[]` + `job_ids[]`, enqueues jobs     |
| `GET`  | `/api/jobs/<id>/status`   | Returns job status JSON                            |
| `GET`  | `/api/jobs/<id>/download` | Streams STEP file download                         |
| `GET`  | `/api/events`             | SSE stream of job updates                          |
| `POST` | `/api/jobs/cancel`        | Cancels all active jobs (called on `beforeunload`) |

Jobs run serially on a background thread via `queue.Queue`. SSE broadcasts updates to all connected clients.

## Pipeline Constants (`src/mesh_pipeline.py`)

| Constant            | Default  | Purpose                                            |
| ------------------- | -------- | -------------------------------------------------- |
| `TOLERANCE`         | `0.01`   | Sewing tolerance in mm for `BRepBuilderAPI_Sewing` |
| `REFINE_PASSES`     | `3`      | Number of `ShapeUpgrade_UnifySameDomain` passes    |
| `TARGET_FACE_COUNT` | `100000` | Max faces before decimation is applied             |
| `MERGE_THRESHOLD`   | `0.0001` | `PercentageValue` for merging close vertices       |

## Pipeline Stages

### Stage 1 — PyMeshLab Cleanup

- Remove duplicate vertices/faces, unreferenced vertices
- Repair non-manifold edges and vertices
- Merge close vertices, remove null faces
- Re-orient normals coherently
- Decimate if face count exceeds `TARGET_FACE_COUNT`
- Apply one pass of Laplacian smoothing
- Save cleaned mesh as `<base>_cleaned.stl`

### Stage 2 — pythonocc-core Solid Conversion

- Read cleaned STL via `OCC.Extend.DataExchange.read_stl_file`
- Sew faces into a closed shell via `BRepBuilderAPI_Sewing`
- Build solid from shell via `BRepBuilderAPI_MakeSolid`
- Fix orientation via `ShapeFix_Solid`
- Run `REFINE_PASSES` rounds of `ShapeUpgrade_UnifySameDomain`
- Validate geometry with `BRepCheck_Analyzer`
- Export to `<base>.step` via `write_step_file`

## Coding Conventions

### Python

- `src/mesh_pipeline.py` stays a single file unless it grows significantly.
- Constants at the top — no inline magic numbers.
- Progress headers use the `=== BANNER ===` style.
- Prefer `pymeshlab` for mesh ops; use `OCC.*` only for solid/STEP work.
- Verify pymeshlab filter names against `ms.print_filter_list()`.

### TypeScript

- No module system (`import`/`export` not used) — all globals.
- `strict: true`, `target: ES2021`.
- Avoid type assertions where TypeScript can infer. Use `as T` only for genuine narrowing (e.g. `as HTMLCanvasElement`). Use null guards with early returns instead of `!`.
- Prefer `replaceAll()` over `replace()` with global regex.
- Prettier (`.prettierrc`) is configured; format-on-save is active.

## Testing

### Python (pytest)

```bash
python -m pytest                                                    # run all tests
python -m pytest --cov=app --cov=mesh_pipeline --cov-report=term-missing
```

- `conftest.py` at the project root stubs `mesh_pipeline` in `sys.modules` before any test import so pythonocc-core (OCC.\*) is never loaded during the test suite.
- `pytest.ini` sets `testpaths = tests` and `pythonpath = src` so `import app` resolves to `src/app.py`.
- Tests live in `tests/test_app.py` — 21 tests covering all Flask routes using `pytest` fixtures and Flask's test client.
- `tests/test_mesh_pipeline.py` — 20 tests for pipeline logic with OCC/pymeshlab mocked.

### Frontend (Jest)

```bash
npm test                       # run all tests
npm run test:coverage
```

- Jest runs against compiled output in `static/` (not TypeScript source directly).
- Since TypeScript files use no `import`/`export`, tests load compiled `.js` via `node:vm` context isolation.
- Tests live in `tests/frontend/` — 6 test files, 139 tests total: `utils.test.js`, `mesh_preview.test.js`, `jobs.test.js`, `main.test.js`, `sse.test.js`, `viewer.test.js`.
- `jest.config.js` sets `testEnvironment: 'node'` and collects coverage from `static/main.js`, `static/utils/utils.js`, and all files under `static/features/`.

## Linting and Code Quality

```bash
npm run lint          # all linters
npm run lint:ts       # ESLint — src/**/*.ts, tests/frontend/**/*.js, jest.config.js, jest-global-script-transform.cjs
npm run lint:scss     # Stylelint — src/**/*.scss
npm run lint:html     # HTMLHint — src/**/*.html
npm run lint:docker   # Hadolint — Dockerfile, Dockerfile.base, .devcontainer/Dockerfile
```

| Tool      | Config              | Notes                                                        |
| --------- | ------------------- | ------------------------------------------------------------ |
| ESLint 9  | `eslint.config.mjs` | Flat config; `typescript-eslint` recommended + custom rules  |
| Stylelint | `.stylelintrc.json` | `stylelint-config-standard-scss`; vendor-prefix rules off    |
| HTMLHint  | `.htmlhintrc`       | Standard rules                                               |
| Hadolint  | `.hadolint.yaml`    | `ignored: [DL3008, DL3042]`; key is `ignored:` not `ignore:` |

## Docker Design

| Decision                                                                                  | Reason                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 5-stage build (node:26-slim, swig-builder, occt-builder, pythonocc-builder, ubuntu:22.04) | Build toolchain never reaches the runtime image               |
| SWIG 4.4.1 built from source                                                              | Ubuntu 22.04 ships SWIG 4.0.2; pythonocc-core requires 4.2.1+ |
| OCCT 7.9.3 built from source (`BUILD_MODULE_Draw=OFF`)                                    | No pre-built aarch64 packages; Draw harness not needed        |
| pythonocc-core 7.9.3 built from source (`PYTHONOCC_WRAP_VISU=OFF`)                        | No aarch64 PyPI wheel; Three.js handles 3D rendering          |
| `CMAKE_INSTALL_RPATH=/opt/occt/lib`                                                       | Embeds OCCT lib path in pythonocc .so RPATH at build time     |
| `/opt/pythonocc` on sys.path via `occ.pth`                                                | OCC package at `/opt/pythonocc/OCC/` without conda            |
| `libosmesa6` + `libgl1` + `libfreetype6`                                                  | Software OpenGL + font rendering — no GPU required            |
| `LIBGL_ALWAYS_SOFTWARE=1`                                                                 | Forces Mesa software renderer in headless environments        |
| `jobs/` created at build time, mountable as volume                                        | Runtime data; mount with `-v` for persistence                 |
| Port 5000 exposed                                                                         | Flask default                                                 |

## Dev Container

`.devcontainer/` — VS Code Dev Containers / GitHub Codespaces.

| Decision                                           | Reason                                   |
| -------------------------------------------------- | ---------------------------------------- |
| Python 3.13 venv at `/workspace/.venv`             | Isolates pip deps; Pylance pointed at it |
| pythonocc-core via conda `.pth` injection          | No aarch64 PyPI wheel available          |
| `postCreateCommand` runs `npm install` + `npx tsc` | Frontend ready on first open             |
| Three background tasks auto-start                  | Flask, Watch TS, Watch SCSS              |
| Port 5000 forwarded, opens browser                 | Instant dev access                       |

### Opening in VS Code

1. Install the **Dev Containers** extension.
2. Open the repo and choose **Reopen in Container**.
3. `postCreateCommand` runs automatically — Python deps, Node deps, and initial TypeScript compile complete before the window is ready.
