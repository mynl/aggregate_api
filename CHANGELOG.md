# Changelog

Running release-notes draft for `aggregate_api`. Newest first. The cadence
mirrors the main `aggregate` project: every plan-based change bumps the
`1.0.0a*` version and adds a section here.

## 1.0.0a2

Bootstrap the standalone package (`dev/plan-0001-bootstrap-standalone.md`). The
1.0.0a1 verbatim copy now imports, runs under uvicorn, serves the SPA, and
passes the suite.

- Wired the `aggregate` dependency to a local editable checkout
  (`[tool.uv.sources]` → `../aggregate_REFACTOR`), where the `parser_errors` /
  `parser._PARSER` internals the api needs live.
- Rewrote the `aggregate.api` → `aggregate_api` self-references: the uvicorn
  target in `__main__.py`, the OpenAPI `version` in `app.py`, the test imports
  (`conftest.py`, `test_objects.py`, `test_cors.py`), and cosmetic docstrings /
  comments across the package.
- **Version reporting:** `GET /v1/health` and `GET /v1/meta` (and the OpenAPI
  `version` field) now report the api's own version, plus a new
  `aggregate_version` field carrying the wrapped library version.
  `HealthResponse` / `MetaResponse` gained the `aggregate_version` field.
- Pointed the web build output at the renamed package: `web/package.json`,
  `web/vite.config.js`, and the `scripts/build-web.{ps1,sh}` headers now target
  `src/aggregate_api/static/`.
- **Parse-error path fix:** tracked an upstream `aggregate` change — a DecL parse
  failure now attaches its structured `ErrorReport` as `exc.report` and raises
  with `from None` (empty `__cause__`) rather than chaining the Lark
  `UnexpectedInput`. `routes/objects.py` now recognizes a parse error by either
  convention, so parse errors again audit as `parse_error` and return HTTP 422
  with the structured report (was misclassifying them as `build_error` with a
  flat string body).

## 1.0.0a1

Initial extraction and scaffolding.

- Extracted the FastAPI service and web SPA verbatim from the `aggregate` repo
  (last good state: commit `6f828ce`, before the `473bcd8` deletion) into a
  standalone project.
  - Python backend: `src/aggregate_api/` (was `src/aggregate/api/`) and its
    `routes/` + committed `static/` icons.
  - Web SPA: `web/` (Vite + Bootstrap 5 + CodeMirror 6), verbatim.
  - Tests: `tests/` (was `tests/api/`), verbatim.
  - Build scripts: `scripts/build-web.{ps1,sh}`, verbatim.
- Added project scaffolding: `pyproject.toml` (package `aggregate_api`, console
  script `aggregate-api`, `aggregate` as a dependency), `.gitignore`,
  `README.md`, `CLAUDE.md`, this `CHANGELOG.md`, and `dev/TODO.md`.

**Not yet runnable.** This release is a faithful copy in the new layout; the
package directory was renamed to `aggregate_api` but file *contents* are
unchanged, so internal `aggregate.api` self-references and the web build's
output path still point at the old location. `dev/plan-0001-bootstrap-standalone.md`
makes it import, run, and pass tests (→ 1.0.0a2).
