# aggregate_api

**aggregate Loss Lab** (aLL): a FastAPI service and a single-page web app for
the [`aggregate`](https://github.com/mynl/aggregate) actuarial library.
*Description to distribution.*

`aggregate_api` is the package; **aggregate Loss Lab** is the app it serves.
It puts `build()` behind an HTTP/JSON api (DecL parsing, FFT-based compound
distributions, plotting, and risk pricing) and ships a Bootstrap 5 and
CodeMirror 6 DecL workbench that runs against it. A single `aggregate-api`
process serves both the web UI (at `/`) and the JSON endpoints (under `/v1`)
same-origin.

> **Status:** 1.0.0, the first public release. Extracted from the `aggregate`
> repo so the library can ship without it. The package is installable and
> supported; the `/v1` surface is not yet a frozen interface, and the caveat at
> the end of [Running headless](#running-headless) says why. See
> [CHANGELOG.md](CHANGELOG.md) for what has landed and
> [dev/TODO.md](dev/TODO.md) for the roadmap.

## What's inside

- **Backend** (`src/aggregate_api/`): FastAPI app. Object lifecycle
  (`POST /v1/objects` to build and cache, then `info`, `meta`, `summary`,
  `tail_df`, `validation_df`, `stats_df`, `density_df`, `plot`, `kappa`,
  `price`, `pricing_at`, plus `frame/{which}` in CSV or table-document form),
  DecL helpers (`/v1/decl/complete`, `/lex`,
  `/format`), and the example library read straight from `aggregate`'s recipe
  base (`/v1/examples`, `/v1/examples/heroes`). In-memory LRU cache, build
  timeout, SQLite audit log, CORS. Swagger UI at `/docs`.
- **Frontend** (`web/`): vanilla-JS SPA (Vite, Bootstrap, CodeMirror 6,
  `csv-grid`). A DecL editor with syntax highlighting, autocomplete and history,
  a landing gallery of showcase examples, tabbed risk output, interactive and
  native plots, and a rich parse-error pane.
- **Excel add-in** (`excel/`): custom functions that put the API in worksheet
  cells. `=AGG.BUILD(decl)` returns a handle; `=AGG.EXHIBIT(handle, "summary")`
  and `=AGG.Q(handle, p)` spill values from it. See
  [excel/README.md](excel/README.md).

### Tables: one payload, two renderers

Every table under 500 rows is fetched once, as a **table document**: versioned
JSON carrying semantics only (dtypes, resolved formats, hierarchy, spans, flags)
and no widths or CSS. Both views render from that one document, so they cannot
disagree about a number:

- **Static** is `greater_tables`' own JS walker, which draws a book-quality table
  (sparsified row index, spanned headers, partial rules). The walker and its
  stylesheet are served straight out of the installed Python package at
  `/v1/assets/`, so the renderer and the documents it renders can never version
  skew.
- **Interactive** is `csv-grid`, fed by `irToGridInput(doc)`: sort, per-column
  filter, fzf search, copy and save.

Which one you get is a page-wide preference in the header menu. Large frames (the
densities) skip the document entirely and go to the grid, which is the honest
instrument for them.

## Install

Requires Python ≥ 3.13. Nothing else: `aggregate` ≥ 1.0.1 and
`greater-tables` ≥ 6.0.0 come from PyPI with it.

```
pip install aggregate_api
aggregate-api --port 8001
```

Then open http://127.0.0.1:8001/ for the app, or http://127.0.0.1:8001/docs for
the api.

> **Install the wheel, not the repository.** The web bundle is 2.5 MB of
> generated Vite output and is deliberately not in git, so it reaches you in the
> built distribution and only there. `pip install git+https://github.com/mynl/aggregate_api`
> installs a working api whose `/` returns 404, which is a reasonable thing to
> want if you are putting your own front end in front of the engine, and a
> baffling one otherwise. The wheel and sdist are also attached to each
> [GitHub release](https://github.com/mynl/aggregate_api/releases).

One footnote, which the pins above handle for you and which bites anyone
installing the table engine on its own: PyPI's `greater-tables` 5.3 is a
previous generation sharing the `greater_tables` import name, so a bare
`pip install greater-tables` can get a package with no `build`, `canonical_json`
or `IR_VERSION`, which fails at import rather than at install. This package pins
`>=6.0.0` and `tests/test_meta.py` asserts the right generation is present.

## Develop

Needs [`uv`](https://docs.astral.sh/uv/) and Node for the web build. A fresh
clone syncs with nothing checked out beside it.

```
git clone https://github.com/mynl/aggregate_api
cd aggregate_api
uv sync --extra dev
.\scripts\build-web.ps1          # Windows; ./scripts/build-web.sh on Unix
uv run aggregate-api --port 8001 --reload
```

`build-web` drops the bundle into `src/aggregate_api/static/`, which the FastAPI
`StaticFiles` mount serves at `/`. Until it has run once, `/` has nothing to
serve. For hot reload with a Vite dev server proxying `/v1` to `:8000`, use
`cd web; npm install; npm run dev` instead.

To develop against a local checkout of `aggregate` or `greater-tables` rather
than the released build, install it editable over the synced environment:

```
uv pip install -e ../aggregate               # or wherever the checkout is
```

The next `uv sync` silently reinstalls the released build, so `uv run --no-sync`
is the way to work in between.

Run the tests. There are two suites and both are the gate:

```
uv run pytest           # 490 tests, FastAPI TestClient, no live server needed
cd web; npm test        # 277 tests, node --test over web/test/
```

Rehearse a release, which is a stronger check than either suite because it
builds the distributions and runs everything against the installed wheel in a
clean environment:

```
.\scripts\release-check.ps1
```

### Running headless

One process serves both halves: the routers mount under `/v1`, and the built web
bundle is mounted at `/`. To run the engine alone, behind somebody else's front
end, say so:

```
uv run aggregate-api --headless           # or AGGAPI_SERVE_SPA=0
```

`/v1`, `/docs` and `/openapi.json` all stay; only `/` stops answering. A front
end on another origin also wants `AGGAPI_CORS_ORIGINS`, comma separated:

```
AGGAPI_CORS_ORIGINS=https://your.app uv run aggregate-api --headless
```

`/openapi.json` is the contract. Note that the `/v1` surface is pre-1.0 and its
shape follows what the bundled web app needs, so treat it as a moving target
rather than a stable interface for now.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
