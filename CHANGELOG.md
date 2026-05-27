# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-20

### Added

#### Core pipeline

- Two-stage mesh-to-STEP conversion: PyMeshLab cleanup followed by pythonocc-core solid export
- Stage 1 repairs non-manifold geometry, merges close vertices, re-orients normals, decimates meshes over 100 000 faces, and applies Laplacian smoothing
- Stage 2 sews the cleaned mesh into a closed shell, promotes it to a solid, runs `ShapeUpgrade_UnifySameDomain` refinement passes, validates with `BRepCheck_Analyzer`, and exports ISO 10303 STEP AP214
- Standalone CLI: `python3 src/mesh_pipeline.py input.stl`

#### Web interface

- Drag-and-drop upload — drop one or more STL / OBJ files to queue them all at once
- Real-time progress feed via server-sent events (SSE), streaming each pipeline stage as it runs
- Interactive Three.js 3D viewer — opens automatically when a job completes; click any finished job card to inspect it
- Per-job download and **Download All** button that zips every completed output in one click
- Dark / light theme toggle, persisted across sessions

#### Backend API

- `POST /api/convert` — accepts multiple files with pre-generated job IDs, enqueues jobs
- `GET /api/jobs/<id>/status` — returns current job status as JSON
- `GET /api/jobs/<id>/download` — streams the STEP file
- `GET /api/events` — SSE stream broadcasting job updates to all connected clients
- `POST /api/jobs/cancel` — cancels all active jobs; called automatically on page unload

#### Infrastructure

- Multi-stage Docker build (`node:26-slim` → `swig-builder` → `occt-builder` → `pythonocc-builder` → `ubuntu:22.04` runtime); build toolchain never reaches the final image
- SWIG 4.4.1, OCCT 7.9.3, and pythonocc-core 7.9.3 all built from source for aarch64 compatibility
- Software OpenGL via Mesa (`LIBGL_ALWAYS_SOFTWARE=1`) for headless / GPU-less environments
- VS Code dev container with Python 3.13 venv, conda-injected pythonocc-core, and auto-starting Flask / TypeScript / SCSS watch tasks
- GitHub Actions workflow publishing multi-platform Docker images to GHCR on release

#### Tests and tooling

- 41 pytest tests covering all Flask routes and pipeline logic (pythonocc-core and pymeshlab fully mocked)
- 139 Jest tests across 6 frontend test files covering all compiled TypeScript modules
- ESLint 9 (flat config, `typescript-eslint`), Stylelint, HTMLHint, and Hadolint linting
- SonarCloud integration via `sonar-project.properties`

[1.0.0]: https://github.com/Toomas633/MeshForge/releases/tag/v1.0.0
