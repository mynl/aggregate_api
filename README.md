# aggregate_api

A FastAPI service and a single-page web playground for the
[`aggregate`](https://github.com/mynl/aggregate) actuarial library.

`aggregate_api` puts `build()` — DecL parsing, FFT-based compound distributions,
plotting, and risk pricing — behind an HTTP/JSON api, and ships a Bootstrap 5 +
CodeMirror 6 DecL playground that runs against it. A single `aggregate-api`
process serves both the web UI (at `/`) and the JSON endpoints (under `/v1`)
same-origin.

> **Status:** private side project, early alpha. Extracted from the `aggregate`
> repo so the library can ship without it. See [CHANGELOG.md](CHANGELOG.md) for
> what has landed and [dev/TODO.md](dev/TODO.md) for the roadmap.

## What's inside

- **Backend** (`src/aggregate_api/`) — FastAPI app: object lifecycle
  (`POST /v1/objects` to build/cache, then `info`, `description`, `stats_df`,
  `density_df`, `plot`, `kappa`, `pricing_at`), DecL helpers
  (`/v1/decl/complete`, `/lex`, `/grammar`), and an example library from
  `test_suite.agg`. In-memory LRU cache, build timeout, SQLite audit log, CORS.
  Swagger UI at `/docs`.
- **Frontend** (`web/`) — vanilla-JS SPA (Vite + Bootstrap + CodeMirror 6): a
  DecL editor with syntax highlighting, autocomplete, history, an action
  toolbar, inline plots, and a rich parse-error pane.

## Install & run

Requires Python ≥ 3.11, [`uv`](https://docs.astral.sh/uv/), and (for the web
build) Node. This package depends on a local in-development checkout of
`aggregate` — see `[tool.uv.sources]` in `pyproject.toml`.

```
uv sync --extra dev
uv run aggregate-api --port 8001 --reload
```

Then open http://127.0.0.1:8001/ for the playground, or
http://127.0.0.1:8001/docs for the api.

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
