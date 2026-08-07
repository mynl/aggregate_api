# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

`aggregate_api` is a FastAPI service and a vanilla-JS single-page web app that
wrap the [`aggregate`](https://github.com/mynl/aggregate) actuarial library.
It exposes `build()`, the live `Aggregate` / `Portfolio` objects, plotting,
pricing, and DecL helpers (completion, lexing, grammar) over HTTP/JSON, and
ships a Bootstrap 5 + CodeMirror 6 DecL playground that talks to that service.

This is a **private side project**. It was originally built inside the
`aggregate` repo, then extracted because it was a distraction from the core
library and should ship separately. The goal here is to keep it alive, learn
from it, and develop it further at a relaxed pace.

Author: Stephen J. Mildenhall. Private repo: https://github.com/mynl/aggregate_api.

## Relationship to `aggregate`

This package **depends on** `aggregate`; it does not vendor it. The api imports:

- `aggregate.build`, the top-level entry point
- `aggregate.parser._PARSER` and `aggregate.parser_errors`, for completion and rich
  parse-error reporting (line/column/caret/suggestions)
- `aggregate.style`, the plot styling context

`aggregate.parser_errors` is recent and lives only in the in-development
`1.0.0a` line (PyPI stops at 0.30.1). So `aggregate` is the one dependency that
**must** be an editable path source: a clone of this repo needs
`aggregate_REFACTOR` checked out beside it before `uv sync` can succeed. See
`[tool.uv.sources]` in `pyproject.toml` and
`dev/done/plan-0001-bootstrap-standalone.md`. Do **not** copy library internals into
this repo; depend on them and, if something is missing or awkward to import,
raise it as an upstream change in `aggregate`.

`greater-tables` used to be a path source for the same reason and **is not any
more**: 6.0.0 shipped to PyPI at a53, so it is an ordinary registry dependency
pinned `>=6.0.0`. The floor matters. PyPI also carries 5.3, the previous
generation under the same name, and it has no `build`, `canonical_json` or
`IR_VERSION`, so resolving to it fails at import rather than at install. To
co-develop it for a session, `uv pip install -e c:/s/ai/greatest-tables` after a
sync; the next `uv sync` silently puts the released build back, which matters
because every version bump runs one.

## Commands

Use `uv` for all environment and dependency management. No `UV_LINK_MODE`
setting is needed: the repo's `.venv` is a junction to `V:\dev\venvs\aggregate_api`
and `UV_CACHE_DIR` is `V:\uv\cache`, so cache and environment sit on one volume
and uv's default hardlink mode works. The old `$env:UV_LINK_MODE = "copy"`
instruction dates from when the environment really lived under `T:` and
hardlinks could not reach it.

Two traps the junction sets, both worth knowing before diagnosing anything here.
`sys.prefix` reports the `T:` path, because it resolves *through* the junction,
so the environment looks like it never moved. And `uv sync` fails with
`os error 32` on `Scripts/aggregate-api.exe` while a server is running, since
uv rebuilds the editable package and cannot replace a locked executable. Stop
the server, or use `uv run --no-sync` when only source has changed, which is
always enough for an editable install.

A third trap, now closed. The junction was **committed**, through a52: git saw
it as a symlink and stored a `120000` blob holding the literal Windows path, so
checking the repo out anywhere else (a Linux box, most obviously) produced a
dangling `.venv`. `.gitignore` had said `.venv/`, and a trailing slash matches
directories only, so the pattern never applied to it. It is untracked now and
the pattern is `.venv`, which matches a directory, a file and a link alike.
Note that ignoring a path does nothing about one already tracked; that took
`git rm --cached .venv`, which leaves the junction on disk.

The junction itself is a local convenience and nothing in the repo depends on
it. To put the environment elsewhere on another machine, set
`UV_PROJECT_ENVIRONMENT`, which uv honors directly and leaves nothing in the
tree for git to pick up.

**Sync environment (with dev extras):**
```
uv sync --extra dev
```

**Run the test suite** (FastAPI `TestClient`, no live server needed):
```
uv run pytest
```

**Run the api locally:**
```
uv run aggregate-api --port 8001 --reload
```
Swagger UI at `/docs`, OpenAPI at `/openapi.json`, routes under `/v1`.

**Build the web SPA** (drops the bundle into `src/aggregate_api/static/`, which
the FastAPI `StaticFiles` mount serves at `/`):
```
.\scripts\build-web.ps1            # Windows, same-origin
.\scripts\build-web.ps1 -ApiBase https://api.host   # split-origin
```
Or run the Vite dev server with hot reload (proxies `/v1` to `:8000`):
```
cd web; npm install; npm run dev
```

## Architecture

### Backend: `src/aggregate_api/`

FastAPI application factory pattern. `create_app()` (in `app.py`) is the single
entry point: installs CORS if configured, mounts the `/v1` routers, and serves
the built SPA at `/` when present.

| Module | Role |
|---|---|
| `app.py` | `create_app()` factory; static-file mount for the SPA |
| `__main__.py` | `aggregate-api` console script; launches uvicorn |
| `config.py` | `Settings` (pydantic-settings, `AGGAPI_*` env vars) |
| `cors.py` | CORS middleware install for split-origin deploys |
| `cache.py` | in-memory LRU object cache keyed by hash of `(decl, log2, bs)` |
| `capability.py` | what an object can answer, off `available_exhibits` / `available_charts` plus app-leaf flags; rides on the build response |
| `audit.py` | SQLite audit log, one row per build attempt |
| `completion.py` | DecL autocomplete over `aggregate.parser` |
| `examples.py` | categorized example library from `test_suite.agg` |
| `models.py` | Pydantic request/response models (one per endpoint) |
| `plotting.py` | SVG/PNG plot rendering via `aggregate.style.context` |
| `pricing.py` | distortion / constant-CoC pricing |
| `serializers.py` | DataFrame → JSON (`FrameResponse`) |
| `routes/` | `meta`, `objects`, `decl`, `examples` APIRouters, mounted `/v1` |

Build pipeline guards: log2 cap (HTTP 422 over the limit), a build semaphore
plus wall-clock timeout (default 10 s). Parse failures return HTTP 422 with the
`aggregate.parser_errors` `ErrorReport` dict so the SPA can render a rich error
pane.

### Frontend: `web/`

Vanilla JS, no framework. Vite 5 build, Bootstrap 5.3, CodeMirror 6, `csv-grid`
for every table. Entry `web/src/main.js`, which wires the editor
(`editor.js`, `decl-mode.js`, `completion.js`), the fetch layer (`api.js`), the
output panes (`renderers.js`, `error-pane.js`, `grid.js`), the interactive
Overview chart, the examples menu (`examples.js`) and history. The build output
lands in the backend's `static/` dir so a single `aggregate-api` process serves
UI and api same-origin.

## Naming conventions

Follow the upstream `aggregate` convention: subclasses use the `Base<Kind>`
prefix form (e.g. `DistortionTVaR`, not `TVaRDistortion`). Lean toward full
words for new identifiers; house abbreviations are fine where already
established.

## Documentation and docstrings

NumPy-style docstrings (Parameters / Returns / Notes) on all new and modified
functions. For non-trivial logic explain the *why* in Notes. US spelling
throughout (prose, docstrings, comments, identifiers, so "behavior", "color").

### No dashes as punctuation. Ever.

Adopted verbatim from the `aggregate` house rule. Not the em dash `—`, not the
ASCII double `--`, not a spaced hyphen ` - `. The dash-as-aside is the single
loudest AI tell in prose, and the author does not write that way. It applies
everywhere text is authored: UI strings, docstrings, comments, `CHANGELOG.md`,
`dev/` plans, commit subjects, and replies in the terminal.

Rewrite instead of substituting. A dash is almost always doing a job that a
comma, a colon, parentheses, or a full stop does better:

- aside or gloss, use commas or parentheses: ~~`the count is an output -- not an input`~~ to `the count is an output, not an input`
- explanation or expansion, use a colon: ~~`one frame -- identity first`~~ to `one frame: identity first`
- a second thought, use a second sentence: ~~`it works -- but watch the tail`~~ to `it works. Watch the tail.`

Still fine, because these are not punctuation: hyphenated compounds
(`loss-ratio`, `first-class`), negative numbers, ranges written with `to`,
command-line flags (`--all-extras`), CSS custom properties
(`--bs-btn-font-size`), and `--` inside code or DecL.

This is an **authoring** rule: it binds every string you write or touch. The
pre-existing internal docstrings and comments still carry roughly 190 legacy
` -- ` glosses, and those are cleaned as their file is next edited rather than
in one mechanical sweep that would bury real diffs.

## Release & housekeeping workflow

These are standing rules, to follow without being re-asked. The cadence
mirrors the main `aggregate` project.

- **Every plan-based change bumps the version.** Any code change executed from a
  `dev/plan-*.md` bumps the `1.0.0a*` version in `pyproject.toml`. Pure tidying
  (file moves, comment/doc-only edits with no behavior change) does not.
- **Commit each version bump.** When a plan-based change bumps the `1.0.0a*`
  version, commit the whole batch (source + tests + `CHANGELOG.md` + the plan doc
  + `dev/TODO.md` + `pyproject.toml` + `uv.lock`) in one commit with a **one-line**
  message. The matching `CHANGELOG.md` section is the commit's detailed
  description, so the subject shouldn't restate it. Match the git-log convention:
  `[aNN] <terse summary>`. The built SPA under `src/aggregate_api/static/` is
  gitignored (rebuilt at deploy), so it is never part of the commit.
- **One plan doc per step.** Work proceeds from a `dev/plan-NNNN-*.md`. When it
  lands, move it to `dev/done/` and tick the matching `dev/TODO.md` entry.
- **Re-sync after a version bump, or `/v1/meta` lies.** `version` is read with
  `importlib.metadata.version`, which returns what was recorded when the
  editable install was built, not what `pyproject.toml` says now. Bump the
  version and the running server keeps reporting the old one in `/v1/health`,
  `/v1/meta` and the About panel. `uv sync --extra dev` re-records it. The same
  trap applies to `aggregate_version` when the sibling checkout moves.
- **Keep `CHANGELOG.md` current.** Each version bump adds a `## <version>`
  section describing what landed and any breaking changes. Write it at the close
  of the iteration; don't defer.
- **`README.md`** is the stable front page (purpose, install, getting started);
  touch it only when that material changes. It points at `CHANGELOG.md`.
- **`dev/TODO.md`** holds the roadmap and pending ideas. Check it before
  proposing structural changes.

## Working with the author

- Commit **version-bump batches** (see Release & housekeeping) with a one-line
  message. The author handles all other commits, so don't commit doc-only or
  in-progress work unless asked. To check status, read the git log; if an
  expected commit is missing, mention it.
- Diagnose / design / propose before editing source or tests. Don't change code
  until told to proceed ("go ahead"). "Can you see the issue?" means explain,
  not fix.
- Environment is **PowerShell on Windows**. No `awk`/`sed`/`head`/`tail` (even
  via the Bash tool). Use `rg` + Read/Edit/Write.
- Prefer explicit, documented recipes over magic / auto-install behavior.
- Keep rendered output tight, with no gratuitous blank lines in blocks.
