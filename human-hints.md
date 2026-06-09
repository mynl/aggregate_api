# human-hints.md

My crib sheet for `aggregate_api`. Short notes to self.

## The two folders

`web/src/` is the **source** I edit (the `.js` files). `src/aggregate_api/static/`
is the **built output**. The build reads the first and writes the second. There
is no `static/` under `web/`.

## Running the app

One FastAPI process serves both the UI and the api, same origin:

```powershell
$env:UV_LINK_MODE = "copy"
uv run aggregate-api --port 8001
```

Then browse to it (don't open the HTML as a `file://`):
- SPA playground: http://127.0.0.1:8001/
- Swagger UI: http://127.0.0.1:8001/docs
- Health: http://127.0.0.1:8001/v1/health

The SPA only shows up at `/` if `static/` has been built (see below). Without it,
the api still runs and `/` just 404s. Add `--reload` for Python auto-restart.

### Binding to other addresses

Default bind is `127.0.0.1` (localhost only — nothing else on the network can
reach it). Use `--host` to widen that:

```powershell
uv run aggregate-api --port 8001 --host 192.168.4.43   # this machine's LAN IP only
uv run aggregate-api --port 8001 --host 0.0.0.0         # all interfaces (whole LAN)
```

With `0.0.0.0`, others reach it at `http://192.168.4.43:8001/`. Only do this on a
trusted network — there's no auth on the api.

## The web build

"Web build" = running Vite (the JS bundler) via npm. One command:

```powershell
.\scripts\build-web.ps1
```

It does two things: `npm install` (first time only — pulls Vite, Bootstrap,
CodeMirror into `web/node_modules/`), then `npm run build` → `vite build`, which
bundles `web/src/` into `src/aggregate_api/static/`.

## Packaging is two stages, in order

1. **Frontend:** `.\scripts\build-web.ps1` fills `src/aggregate_api/static/`.
2. **Backend:** `uv build` packages the Python + that `static/` into the wheel
   (declared via `package-data` in `pyproject.toml`).

The bundle must exist *before* the wheel build, or the wheel ships with no UI.
A plain `uv build` does NOT run stage 1 for me — that's still the manual step.

## Frontend hot-reload (editing the UI)

Run two processes and browse to Vite (not the FastAPI port):

```powershell
uv run aggregate-api --port 8000   # terminal 1 (proxy target)
cd web; npm run dev                # terminal 2
```

Browse http://localhost:5173/ — Vite hot-reloads and proxies `/v1/*` to `:8000`.
No rebuild needed while doing this.
