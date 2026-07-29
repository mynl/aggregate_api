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
  `price`, `pricing_at`), DecL helpers (`/v1/decl/complete`, `/lex`,
  `/format`), and the example library read straight from `aggregate`'s recipe
  base (`/v1/examples`, `/v1/examples/heroes`). In-memory LRU cache, build
  timeout, SQLite audit log, CORS. Swagger UI at `/docs`.
- **Frontend** (`web/`): vanilla-JS SPA (Vite, Bootstrap, CodeMirror 6,
  `csv-grid`). A DecL editor with syntax highlighting, autocomplete and history,
  a landing gallery of showcase examples, tabbed risk output, interactive and
  native plots, and a rich parse-error pane.

## Install and run

Requires Python ≥ 3.11, [`uv`](https://docs.astral.sh/uv/), and Node for the web
build. This package depends on a local in-development checkout of `aggregate`;
see `[tool.uv.sources]` in `pyproject.toml`.

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
