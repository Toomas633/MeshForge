# Development Guide

## Prerequisites

| Tool    | Version | Notes                                              |
| ------- | ------- | -------------------------------------------------- |
| Docker  | 24+     | Required for the dev container                     |
| VS Code | Latest  | With the **Dev Containers** extension              |
| Node.js | 18+     | Only needed for manual setup outside the container |
| Python  | 3.13    | Only needed for manual setup outside the container |

The recommended workflow is the **VS Code dev container** — it provisions everything automatically.

## Dev Container Setup (Recommended)

1. Install the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension.
2. Open the repository in VS Code and choose **Reopen in Container** when prompted.
3. `postCreateCommand` runs automatically:
   - Creates a Python 3.13 venv at `/workspace/.venv`
   - Installs Python deps from `requirements.lock` (pip) and injects pythonocc-core from conda via a `.pth` file (no aarch64 PyPI wheel exists)
   - Runs `npm install` and compiles TypeScript (`npm run build`)
4. Three background tasks start automatically:
   - **Start App** — `flask run --debug --host=0.0.0.0 --port=5000`
   - **Watch TS** — `npm run watch:ts`
   - **Watch SCSS** — `npx sass --watch src/styles/style.scss:static/style.css ...`
5. Port 5000 is forwarded and opens in your browser.

## Manual Local Setup

> pythonocc-core has no PyPI wheel for aarch64. On Apple Silicon or ARM Linux, use the dev container instead.

```bash
# Python
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.lock

# Node
npm install
npm run build
npx sass src/styles/style.scss:static/style.css --style=expanded --no-source-map

# Run
FLASK_APP=src/app.py flask run --debug --host=0.0.0.0 --port=5000
```

## Project Structure

```
src/
  app.py                Flask backend (REST API + SSE)
  mesh_pipeline.py      Conversion pipeline (also usable as a CLI)
  index.html            App shell
  main.ts               UI bootstrap, DOM refs, file management
  three-global.d.ts     Ambient types for CDN Three.js globals
  assets/
    favicon.svg         App favicon
  styles/
    style.scss          Main entry point (compiled to static/style.css)
    variables.scss      CSS custom properties and SCSS variables
    mixins.scss         Reusable SCSS mixins
    light.scss          Light theme overrides
  types/types.ts        Shared TypeScript interfaces
  utils/utils.ts        fmtSize(), escHtml()
  features/
    mesh-preview.ts     2D thumbnail renderer + STL/OBJ parsers
    viewer.ts           Three.js 3D viewer
    jobs.ts             Job card DOM management
    sse.ts              SSE connection and update handling
static/                 Compiled JS/CSS (build output, git-ignored)
tests/
  test_app.py           Flask backend tests (pytest)
  test_mesh_pipeline.py Pipeline logic tests (pytest, OCC/pymeshlab mocked)
  frontend/
    utils.test.js       Jest tests — fmtSize(), escHtml()
    mesh_preview.test.js Jest tests — STL/OBJ parsers, subsampleFlat()
    jobs.test.js        Jest tests — job/batch card DOM management
    main.test.js        Jest tests — main UI bootstrap and file management
    sse.test.js         Jest tests — SSE connection handling
    viewer.test.js      Jest tests — Three.js viewer
conftest.py             Stubs mesh_pipeline so OCC is never imported in tests
```

## Architecture Notes

### Backend (`src/app.py`)

- Flask 3 app with a single global job store (`dict` + `threading.Lock`).
- Jobs run serially on a `queue.Queue` consumed by one background worker thread.
- Progress is broadcast to all SSE clients via per-client `queue.Queue` instances.
- `JOBS_DIR` defaults to `<project-root>/jobs/` (one subdirectory per job id, each with `input/` and `output/`).

### Frontend (TypeScript, no bundler)

- All `.ts` files compile to `static/` as **global scripts** — no `import`/`export`, no bundler.
- Script load order in `index.html` is significant.
- Three.js is loaded from CDN; ambient types live in `src/three-global.d.ts`.

### Pipeline (`src/mesh_pipeline.py`)

Callable as a library (`run_pipeline(input_file, output_dir, log)`) or directly from the CLI:

```bash
python3 src/mesh_pipeline.py input.stl
```

Key constants at the top of the file:

| Constant            | Default  | Purpose                                 |
| ------------------- | -------- | --------------------------------------- |
| `TOLERANCE`         | `0.01`   | BRepBuilderAPI_Sewing tolerance (mm)    |
| `REFINE_PASSES`     | `3`      | ShapeUpgrade_UnifySameDomain iterations |
| `TARGET_FACE_COUNT` | `100000` | Decimation threshold                    |
| `MERGE_THRESHOLD`   | `0.0001` | Vertex merge percentage                 |

## Running Tests

### Python

```bash
python -m pytest                                                      # all tests
python -m pytest -v                                                   # verbose
python -m pytest --cov=app --cov=mesh_pipeline --cov-report=term-missing  # with coverage
```

`conftest.py` stubs `mesh_pipeline` in `sys.modules` before any import, so pythonocc-core is never loaded during the test suite. `pytest.ini` sets `pythonpath = src` so `import app` resolves to `src/app.py`.

### Frontend

```bash
npm test                  # all tests
npm run test:coverage     # with coverage report
npx jest --watch          # watch mode
```

Tests load compiled output from `static/` into a `node:vm` context because the TypeScript source uses no `import`/`export`.

## Linting

```bash
npm run lint              # run all four linters
npm run lint:ts           # ESLint — src/**/*.ts, tests/frontend/**/*.js, jest.config.js, jest-global-script-transform.cjs
npm run lint:scss         # Stylelint — src/**/*.scss
npm run lint:html         # HTMLHint — src/**/*.html
npm run lint:docker       # Hadolint — Dockerfile, Dockerfile.base, .devcontainer/Dockerfile
```

| Tool                         | Config              | Scope                                                 |
| ---------------------------- | ------------------- | ----------------------------------------------------- |
| ESLint 9 + typescript-eslint | `eslint.config.mjs` | TypeScript source + JS test files                     |
| Stylelint                    | `.stylelintrc.json` | SCSS                                                  |
| HTMLHint                     | `.htmlhintrc`       | HTML                                                  |
| Hadolint                     | `.hadolint.yaml`    | Dockerfile, Dockerfile.base, .devcontainer/Dockerfile |

## Building the Frontend

```bash
npm run build                                                              # TypeScript → static/
npx sass src/styles/style.scss:static/style.css --style=expanded --no-source-map  # SCSS → static/style.css
```

The `static/` directory is git-ignored — it is pure build output.

## Docker

```bash
# Build
docker build -t meshforge .

# Run (ephemeral jobs)
docker run --rm -p 5000:5000 meshforge

# Run (persistent jobs volume)
docker run --rm -p 5000:5000 -v meshforge_jobs:/app/jobs meshforge
```

The Dockerfile uses a multi-stage build: a `node:26-slim` stage compiles the TypeScript and SCSS, then the compiled output is copied into the `ubuntu:22.04` runtime stage. This keeps Node.js out of the final image.

Software OpenGL is forced via `LIBGL_ALWAYS_SOFTWARE=1` so pymeshlab works in headless environments without a GPU.

## CI / CD

`.github/workflows/docker-publish.yml` builds and pushes to GHCR on every published GitHub release. The image is tagged with the semver release tag and `latest`.

## Contributing

1. Fork the repository and create a feature branch.
2. Make your changes — keep each commit focused and the tests green.
3. Run `npm run lint` and `python -m pytest` before opening a pull request.
4. Open a pull request against `main` with a clear description of what changed and why.

### Adding a new API route

- Add the route handler in `src/app.py`.
- Add corresponding tests in `tests/test_app.py` using the `client` fixture.

### Modifying the pipeline

- All pipeline logic lives in `src/mesh_pipeline.py`.
- Verify any new pymeshlab filter names with `ms.print_filter_list()` — filter names change between releases.
- The OCC pipeline never runs in tests; `conftest.py` stubs the whole module.

### Modifying the frontend

- Edit `.ts` files in `src/` — the Watch TS task recompiles on save.
- Edit files under `src/styles/` — the Watch SCSS task recompiles on save.
- There is no hot-reload; refresh the browser after each change.
- Add Jest tests for any new pure logic in `tests/frontend/`.
