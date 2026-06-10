
The SPA is **served by the same FastAPI process** at `/`, and it talks to the api via `fetch('/v1/...')` on the same origin. If you double-click `index.html` (a `file://` URL), those fetches have nowhere to go and the page won't work.

## Run it (single process serves both)

```powershell
$env:UV_LINK_MODE = "copy"
uv run aggregate-api --port 8001
```

Then in the browser:
- **Playground (SPA):** http://127.0.0.1:8001/
- **Swagger UI:** http://127.0.0.1:8001/docs
- **Health:** http://127.0.0.1:8001/v1/health

That works because you built the SPA earlier — the bundle is sitting in `src/aggregate_api/static/`, and `create_app()` mounts it at `/`. One process, same origin, no CORS needed.

Add `--reload` if you're editing Python and want auto-restart:
```powershell
uv run aggregate-api --port 8001 --reload
```

## If you're editing the *frontend* (hot reload)

Then you run two processes — Vite for the UI, uvicorn for the api — and browse to Vite:

```powershell
# terminal 1 — backend on :8000 (the dev proxy target)
uv run aggregate-api --port 8000

# terminal 2
cd web; npm run dev
```

Browse to **http://localhost:5173/** — Vite serves the SPA with hot reload and proxies `/v1/*` to `:8000` (configured in `web/vite.config.js`). You don't need to rebuild the bundle while doing this.

## Rule of thumb
- **Just using it / backend work** → `uv run aggregate-api`, browse the server's port. Rebuild the SPA (`.\scripts\build-web.ps1`) only when frontend source changes.
- **Frontend work** → Vite dev server + a backend, browse `:5173`.

Either way: always reach the SPA through an `http://…` URL from a server, never `file://`.


---

## VPS refresh: `uv.lock` blocks `git pull`

If refresh fails with:

```text
error: Your local changes to the following files would be overwritten by merge:
        uv.lock
Please commit your changes or stash them before you merge.
Aborting
```

that does **not** mean `uv.lock` should be ignored. Keep `uv.lock` tracked in
git so the VPS installs the same resolved environment as the dev machine.

What happened: something on the VPS modified the tracked lock file, usually
`uv sync` resolving/updating it. Inspect first:

```bash
cd ~/hacking/aggregate_api
git diff -- uv.lock
```

If it is just an unwanted VPS-local lock change, discard only that file:

```bash
git restore uv.lock
git pull --ff-only
```

Then make the deploy/refresh script install from the existing lock instead of
updating it:

```bash
( cd "$AGG_DIR" && uv sync --frozen --extra dev )
( cd "$API_DIR" && uv sync --frozen --extra dev )
```

Lock updates should happen intentionally on Windows, get committed, then be
pulled by the VPS.


---

Two readings — I'll cover both, since the order matters.

**To restart Claude Code in the new project** (do this first):

Open a PowerShell terminal in the new repo and launch Claude there:
```
cd T:\worktrees\aggregate_api
claude
```
Then tell it: *"execute dev/plan-0001-bootstrap-standalone.md"*. That plan is written to be self-contained — it'll pick up the context from `CLAUDE.md` and the plan doc.

**To actually run the app** — not yet. The `1.0.0a1` state is a faithful copy, deliberately **not runnable** (internal `aggregate.api` references still point at the old location, and the `aggregate` dependency isn't wired). `uv sync` / `uv run aggregate-api` will fail today.

plan-0001 fixes exactly that (→ `1.0.0a2`). **Once it's done**, firing it up is:
```
$env:UV_LINK_MODE = "copy"
uv sync --extra dev
uv run aggregate-api --port 8001 --reload
```
- Playground: http://127.0.0.1:8001/ (after building the SPA with `.\scripts\build-web.ps1`)
- API docs: http://127.0.0.1:8001/docs

The one thing plan-0001 needs *from you* is the local `aggregate` checkout path for the editable dependency — because `parser_errors` only exists on your REFACTOR branch right now, not on PyPI. The new Claude will ask, or you can tell it up front to use `../aggregate_REFACTOR`.

So: restart Claude in the new dir → run plan-0001 → then fire up the server.
