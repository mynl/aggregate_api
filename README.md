# aggregate_api

**aggregate Loss Library** (aLL): a FastAPI service and a single-page web app for
the [`aggregate`](https://github.com/mynl/aggregate) actuarial library.
*Description to distribution.*

`aggregate_api` is the package; **aggregate Loss Library** is the app it serves.
It puts `build()` behind an HTTP/JSON api (DecL parsing, FFT-based compound
distributions, plotting, and risk pricing) and ships a Bootstrap 5 and
CodeMirror 6 DecL workbench that runs against it. A single `aggregate-api`
process serves both the web UI (at `/`) and the JSON endpoints (under `/v1`)
same-origin.

> **Status:** private side project, early alpha. Extracted from the `aggregate`
> repo so the library can ship without it. See [CHANGELOG.md](CHANGELOG.md) for
> what has landed and [dev/TODO.md](dev/TODO.md) for the roadmap.

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

## Install and run

Requires Python ≥ 3.13, [`uv`](https://docs.astral.sh/uv/), and Node for the web
build.

**Two dependencies are local checkouts**, not PyPI installs, and both are wired
through `[tool.uv.sources]` in `pyproject.toml`: `aggregate` (the api uses
`1.0.0a` internals that are not published) and `greater-tables` (the table
engine, publishing as 6.0).

> **Watch out for `greater-tables`.** The name is currently two different
> packages. PyPI's `greater-tables` 5.3 is the previous generation and shares the
> `greater_tables` import name, so a plain `pip install greater-tables` gets the
> wrong one and the service dies at import. `uv sync` reads the path source and
> does the right thing. Once 6.0 is published, pin it explicitly: pip ignores
> pre-releases unless asked. `tests/test_meta.py` asserts the right generation is
> installed.

```
uv sync --extra dev
uv run aggregate-api --port 8001 --reload
```

Then open http://127.0.0.1:8001/ for the app, or http://127.0.0.1:8001/docs for
the api.

Build the web bundle (served by the backend at `/`):

```
.\scripts\build-web.ps1      # Windows
./scripts/build-web.sh       # Unix
```

Run the tests:

```
uv run pytest
```

## License

BSD 3-Clause. See [LICENSE](LICENSE).
