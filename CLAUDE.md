# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

`aggregate_api` is a FastAPI service and a vanilla-JS single-page web app that
wrap the [`aggregate`](https://github.com/mynl/aggregate) actuarial library.
It exposes `build()`, the live `Aggregate` / `Portfolio` objects, plotting,
pricing, and DecL helpers (completion, lexing, grammar) over HTTP/JSON, and
ships a Bootstrap 5 + CodeMirror 6 DecL playground that talks to that service.

This is a **side project**, released but not staffed. It was originally built
inside the `aggregate` repo, then extracted because it was a distraction from
the core library and should ship separately. The goal here is to keep it alive,
learn from it, and develop it further at a relaxed pace. Published as 1.0.0 on
2026-10-07, alongside the library's 1.0.1.

Author: Stephen J. Mildenhall. Public repo:
https://github.com/mynl/aggregate_api. On PyPI as `aggregate_api`.

## Relationship to `aggregate`

This package **depends on** `aggregate`; it does not vendor it. The api imports:

- `aggregate.build`, the top-level entry point
- `aggregate.parser._PARSER` and `aggregate.parser_errors`, for completion and rich
  parse-error reporting (line/column/caret/suggestions)
- `aggregate.style`, the plot styling context
- the recipe base behind the Examples menu: `Underwriter.recipes` and
  `Underwriter.recipe(name)`, plus `Recipe.seq` (the zero-based order the entry
  was read in, so `recipes.sort_values('seq')` is `library.agg`'s reading order)
  and `Recipe.as_read` (the entry's DecL as its file spells it, which is what
  reaches the editor). Both arrived in `aggregate` 1.0.0a320 and both are
  load bearing here: without `seq` the menu has no order to show, and without
  `as_read` an example that exists to teach `ph 2/3` arrives spelled
  `ph 0.6666666666666666`.

This list is not the whole surface. `V:/worktrees/CLAUDE.md` carries the audited
one, including the three tolerated private names.

`aggregate` **stopped being a path source at 1.0.0 of this package.** Through
`1.0.0a202` it had to be one: `parser_errors` and the rest lived only in the
in-development `1.0.0a` line and PyPI stopped at 0.30.1, so a clone needed
`aggregate_REFACTOR` checked out beside it before `uv sync` could succeed. The
library published 1.0.1 on 2026-10-07 and that ended. There is no
`[tool.uv.sources]` table any more, and a fresh clone syncs with nothing beside
it. The pin is `aggregate>=1.0.1,<2`; `dev/done/plan-1.0.0-release.md` explains
both bounds, and the comment where the table used to sit explains why removing
it was necessary rather than merely tidy.

**Consequence for co-development, and it is easy to trip over.** `uv sync` now
installs the *released* library, so working against the sibling worktree is an
explicit extra step and any `uv sync` silently undoes it. Since 1.9.1 a version
bump runs no sync, so a sync happens only on a **dependency change**, and the
restore follows it:

```
uv pip install -e V:/worktrees/aggregate_REFACTOR     # after a dependency sync
uv pip install -e V:/dev/aggregate-relativity         # the plugin, likewise
uv run --no-sync ...                                  # to work in between
```

`/v1/meta` reports `aggregate_version` as the live `aggregate.__version__`, so
that is where to look when behavior does not match the worktree. This is the
same recipe `greater-tables` has used since a53.

Do **not** copy library internals into this repo; depend on them and, if
something is missing or awkward to import, raise it as an upstream change in
`aggregate`. The two private names (`parser._PARSER`,
`parser_errors._TERMINAL_LABELS`) are why the pin has a ceiling: re-check them
at each library minor rather than trusting the range.

`greater-tables` used to be a path source for the same reason and **is not any
more**: 6.0.0 shipped to PyPI at a53, so it is an ordinary registry dependency
pinned `>=6.0.0`. The floor matters. PyPI also carries 5.3, the previous
generation under the same name, and it has no `build`, `canonical_json` or
`IR_VERSION`, so resolving to it fails at import rather than at install. To
co-develop it for a session, `uv pip install -e c:/s/ai/greatest-tables` after a
sync; the next `uv sync` (a dependency change, never a bump) silently puts the
released build back.

## Commands

Use `uv` for all environment and dependency management. The environment is a
plain `.venv` directory inside the checkout, gitignored, per the dev tree's rule
that build churn lives in the checkout on `V:`. `UV_CACHE_DIR` is `V:\uv\cache`,
on the same volume, so uv's default hardlink mode works and no `UV_LINK_MODE`
setting is needed. To put the environment elsewhere on another machine, set
`UV_PROJECT_ENVIRONMENT`, which uv honors directly and leaves nothing in the
tree for git to pick up.

**`--no-sync`, always, in this checkout.** The co-development installs
(worktree `aggregate`, the relativity plugin) are not in `uv.lock`, and any sync
replaces or removes them. That includes the inexact sync a plain `uv run` does:
a dry run on 2026-10-14 showed it swapping the worktree `aggregate` for the
released 1.0.1. A real sync, for a dependency change, is followed by the restore
under "Relationship to `aggregate`".

`uv sync` also fails with `os error 32` on `Scripts/aggregate-api.exe` while a
server is running, since uv rebuilds the editable package and cannot replace a
locked executable. Stop the server first.

**`uv pip list` can show old versions, and that is harmless.** An editable
install records its version once, at install time, so after a bump the list
lags the source; nothing at runtime reads it, since every reported version is a
live `__version__`. To make the list current, reinstall the editables without
touching dependencies:

```
uv pip install --no-deps -e . -e V:/worktrees/aggregate_REFACTOR -e V:/dev/aggregate-relativity
```

History, so it is not repeated: through a52 `.venv` was a junction to an
environment outside the tree, and git stored it as a `120000` symlink blob
holding the literal Windows path, which dangled on any other machine. The
`.gitignore` pattern is now `.venv` (not `.venv/`, whose trailing slash matches
directories only and so never matched the link).

**Sync environment (with dev extras)**, on a fresh clone or a dependency change
only, then restore the co-development installs:
```
uv sync --extra dev
```

**Run the test suite** (FastAPI `TestClient`, no live server needed):
```
uv run --no-sync pytest
```

**Run the api locally** (`--reload` watches this repo only, so an edit to the
library or the plugin needs a manual restart):
```
uv run --no-sync aggregate-api --port 8001 --reload
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

**Build the Excel add-in** (drops the bundle, with its production manifest, into
`src/aggregate_api/excel_static/`, which the `/excel` mount serves; the
manifest's `<Version>` is `__version__`):
```
.\scripts\build-excel.ps1                          # for https://agg.mynl.com/excel
.\scripts\build-excel.ps1 -Base https://host/excel # another origin
```
Its checks run in `excel/`: `npm test` (node --test over `test/*.test.ts`),
`npm run typecheck`, `npm run lint`. Development against a local server is
`npm start` there; see `excel/README.md`.

**Build the Google Sheets script** (writes `sheets/dist/`: the shared
`excel/src/functions/core.ts` as the `AggCore` global, and `sheets/src/*.ts`
with types stripped; the client version stamped in is `__version__`):
```
cd sheets; npm install; npm run build
```
Its checks run in `sheets/`: `npm test` (builds, then node --test over
`test/*.test.ts`, which load `dist/` in a vm with stub Apps Script services) and
`npm run typecheck`. A change to `core.ts` runs both `excel/` and `sheets/`
checks. `npm run push` (clasp) publishes to the template and is the author's,
like `git push`; see `sheets/README.md`.

**Copies of the Sheets template never update**, so the routes a copy calls are
a contract: `GET /v1/meta`, `POST /v1/objects`, and under
`/v1/objects/{id}/` the `exhibits`, `exhibit/{name}`, `quantiles`, `frames`,
`frame/{which}/shape` and `frame/{which}.csv` routes, plus `GET /v1/examples`.
A change of shape on any of them needs a new route, not an edit.

## Architecture

### Backend: `src/aggregate_api/`

FastAPI application factory pattern. `create_app()` (in `app.py`) is the single
entry point: installs CORS if configured, mounts the `/v1` routers, and serves
the built SPA at `/` when present.

| Module | Role |
|---|---|
| `app.py` | `create_app()` factory; static-file mount for the SPA |
| `apps.py` | other front ends named in `AGGAPI_APPS`, admitted for a mount at `/<name>/` and listed on `/v1/meta` |
| `__main__.py` | `aggregate-api` console script; launches uvicorn |
| `config.py` | `Settings` (pydantic-settings, `AGGAPI_*` env vars) |
| `cors.py` | CORS middleware install for split-origin deploys |
| `cache.py` | in-memory LRU object cache keyed by hash of `(decl, log2, bs)` |
| `capability.py` | what an object can answer, off `available_exhibits` / `available_charts` plus app-leaf flags; rides on the build response |
| `audit.py` | SQLite audit log, one row per build attempt |
| `completion.py` | DecL autocomplete over `aggregate.parser` |
| `examples.py` | categorized example library from `test_suite.agg` |
| `models.py` | Pydantic request/response models (one per endpoint) |
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

**The version scheme changed at 1.0.0.** Through `1.0.0a202` every bump was one
more alpha serial. Released, it is ordinary SemVer per the house rules: a feature
or behavior change takes the minor (1.0.0 to 1.1.0 to 1.2.0), a fix takes the
patch. Do not crawl, and do not go back to serials.

- **Every plan-based change bumps the version.** Any code change executed from a
  `dev/plan-*.md` bumps the version. It is written in **one** place, the literal
  `__version__` in `src/aggregate_api/__init__.py`; `pyproject.toml` reads it
  (`dynamic = ["version"]`) and carries no version line. Pure tidying (file
  moves, comment or doc-only edits with no behavior change) does not bump.
- **Commit each version bump.** Commit the whole batch (source + tests +
  `CHANGELOG.md` + the plan doc + `dev/TODO.md` + `__init__.py` + `uv.lock`)
  in one commit with a **one-line** message. The matching `CHANGELOG.md` section
  is the commit's detailed description, so the subject shouldn't restate it. The
  git-log convention is the bracketed version, which carried 200 commits as
  `[aNN]` and continues as the release number: `[1.1.0] <terse summary>`. The
  built SPA under `src/aggregate_api/static/` is gitignored, so it is never part
  of the commit.
- **A release is more than a bump.** Publishing to PyPI, tagging, and the GitHub
  release are the author's, and `.\scripts\release-check.ps1` is the gate on all
  three: it builds the distributions and runs the suite against the installed
  wheel in a clean environment, which is the only check that sees what an
  installer actually receives. `V:\dev\RELEASE-PROCESS.md` is the checklist.
- **Rebuild the SPA at the bump when `web/` moved.** `.\scripts\build-web.ps1`,
  after the commit. Every gate and harness reads `web/src/` directly, so an
  SPA-only bump can be green everywhere and be invisible in the running app,
  while `/v1/meta` reports the new version anyway, since it reads
  `__version__` live: the About panel then says `a141` over a page that predates
  `a139`. The version is what you read to know which build you are on, so that
  pairing is worse than a plain stale page. Build the artifact, never stage it.
  The same holds for the Excel add-in: `.\scripts\build-excel.ps1` after a bump
  that moved `excel/`, and after any bump that is deployed, since its manifest
  carries the version.
- **One plan doc per step.** Work proceeds from a `dev/plan-NNNN-*.md`. When it
  lands, move it to `dev/done/` and tick the matching `dev/TODO.md` entry.
- **Keep `CHANGELOG.md` current.** Each version bump adds a `## <version>`
  section describing what landed and any breaking changes. Write it at the close
  of the iteration; don't defer.
- **`README.md`** is the stable front page (purpose, install, getting started);
  touch it only when that material changes. It points at `CHANGELOG.md`.
- **`dev/TODO.md`** holds the roadmap and pending ideas. Check it before
  proposing structural changes.

## Deltas from house rules

- **"Bind `127.0.0.1` by default; never `0.0.0.0`."** Excepted for the
  author's own instance on DOOB, which great-servers launches from
  `~/.great-servers/servers.yaml` with `--host 0.0.0.0 --port 19456` and no
  token. The author's ruling (2026-10-14): it must answer on localhost and on
  the VPN address (`10.8.0.8`) at once, and one bind cannot serve both, so the
  wildcard is deliberate and known. Do not flag it. The exception covers that
  launcher entry only: the code's default bind stays `127.0.0.1`, and any other
  deployment follows the house rule.

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
