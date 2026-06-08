# plan-0001 — bootstrap the standalone package

**Target version:** 1.0.0a2
**Status:** not started
**Goal:** turn the verbatim extraction (1.0.0a1) into a package that imports,
runs under uvicorn, serves the SPA, and passes `uv run pytest` — under the new
name `aggregate_api`.

## Context

The code was copied faithfully from `aggregate` commit `6f828ce` (the state
just before the `473bcd8` deletion). The directory was renamed
`src/aggregate/api/` → `src/aggregate_api/` and `tests/api/` → `tests/`, but
**file contents are unchanged**. Relative imports (`from .config`, `from .routes
import ...`) already work under any package name; only a small set of *absolute*
self-references and the web build's output path still point at the old location.
This plan rewrites those, wires the `aggregate` dependency, and gets to green.

`aggregate.parser_errors` (imported by `completion.py` and `routes/decl.py`)
exists only in the in-development `aggregate` `1.0.0a` line, not on PyPI. So this
plan also pins the dependency to a local editable checkout.

## Steps

### 1. Wire the `aggregate` dependency source

- Decide the canonical local checkout path for `aggregate` on this machine
  (candidates: the main checkout, or a worktree such as
  `../aggregate_REFACTOR`, which is where `parser_errors` currently lives —
  confirm it's there: `aggregate.parser_errors` and `aggregate.parser._PARSER`).
- Uncomment and set `[tool.uv.sources]` in `pyproject.toml`:
  ```toml
  [tool.uv.sources]
  aggregate = { path = "<chosen path>", editable = true }
  ```
- `$env:UV_LINK_MODE = "copy"; uv sync --extra dev` and confirm it resolves.
- Verify the needed symbols import:
  `uv run python -c "from aggregate import build; from aggregate.parser import _PARSER; from aggregate import parser_errors, style; print('ok')"`

### 2. Rewrite Python self-references `aggregate.api` → `aggregate_api`

Functional (must change):

- `src/aggregate_api/__main__.py` — the uvicorn target string
  `"aggregate.api.app:create_app"` → `"aggregate_api.app:create_app"`.
- `src/aggregate_api/app.py` — `_pkg_version("aggregate")` for the FastAPI
  `version=` field: decide whether the OpenAPI version should report the api's
  own version (`aggregate_api`) or the underlying library. Recommend
  `_pkg_version("aggregate_api")`.
- `src/aggregate_api/routes/meta.py` — two `_pkg_version("aggregate")` calls in
  the health/meta payloads. Recommend reporting **both** versions (api +
  library) and updating the response model in `models.py` accordingly. (If that
  grows scope, keep it minimal here and log the richer version idea in TODO.)
- `tests/conftest.py`, `tests/test_objects.py`, `tests/test_cors.py` — the
  `from aggregate.api.app import create_app` imports → `from aggregate_api.app`.

Cosmetic (docstrings/comments referencing `aggregate.api` or `aggregate/api`):
`__init__.py`, `__main__.py`, `app.py`, `examples.py`, `serializers.py`,
`audit.py`. Update for accuracy; no behavior change.

### 3. Point the web build at the new static dir

- `web/package.json` — `build` script `--outDir ../src/aggregate/api/static` →
  `../src/aggregate_api/static`.
- `web/vite.config.js` — `build.outDir` and the explanatory comments.
- `scripts/build-web.ps1` / `scripts/build-web.sh` — header comments.

### 4. Confirm static-file resolution

- `app.py:_resolve_static_dir` uses `Path(__file__).parent / "static"`, which
  already follows the renamed package. Confirm the committed icons resolve and
  that a missing SPA bundle degrades to api-only (no crash).

### 5. Green the suite and a smoke run

- `uv run pytest` — all `tests/` pass.
- `uv run aggregate-api --port 8001` — `GET /v1/healthz` (or the meta route) and
  `/docs` respond.
- Build the SPA (`.\scripts\build-web.ps1`), reload, confirm `/` serves the
  playground and a `POST /v1/objects` from it builds an object.

### 6. Close out

- Bump `pyproject.toml` to `1.0.0a2`.
- Add the `## 1.0.0a2` section to `CHANGELOG.md`.
- Tick plan-0001 in `dev/TODO.md`; move this file to `dev/done/`.
- (Author commits.)

## Out of scope (deferred to later plans / TODO)

- CI, packaging the wheel with a rebuilt SPA, auth, the richer version-reporting
  exhibit, frontend feature work. See `dev/TODO.md`.

## Notes / decisions to confirm with the author

- Editable `aggregate` path (Step 1) — machine-specific; the author picks it.
- Whether `meta` reports one version or both (Step 2).
