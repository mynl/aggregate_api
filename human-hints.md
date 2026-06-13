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
uv run aggregate-api --port 8001 --host 10.8.0.1        # vps 
```

With `0.0.0.0`, others reach it at `http://192.168.4.43:8001/`. Only do this on a
trusted network — there's no auth on the api.

## The web build

"Web build" = running Vite (the JS bundler) via npm. One command:

```powershell
.\scripts\build-web.ps1
```

It does two things: `npm install` (when `node_modules` is missing *or* older than
`package.json`/`package-lock.json` — so a newly added dep auto-installs), then
`npm run build` → `vite build`, which bundles `web/src/` into
`src/aggregate_api/static/`.

### `-ApiBase` — nobody needs it now (same-origin everywhere)

`-ApiBase` (→ `VITE_API_BASE_URL`) bakes a prefix onto every `fetch()`. Since the
2026-06-13 cutover to the `agg.mynl.com` subdomain, **both** local and VPS builds
are same-origin, so the flag is vestigial — build with no args:

```powershell
.\scripts\build-web.ps1                              # fetch('/v1/...')  ← always
.\scripts\build-web.ps1 -ApiBase https://api.host    # only if the api ever moves to a separate host
```

(History: the VPS used to serve under an obscured `www.mynl.com/Q7M4Z9KP/` subpath
and built with `-ApiBase /Q7M4Z9KP`. That's gone — see "Public route" below.)

Quickest PC loop: `build-web.ps1` (no args) → `uv run aggregate-api --port 8001
--reload` → browse `http://localhost:8001/`. Re-run the build after web edits
(`--reload` watches Python only). For pure UI churn, prefer the Vite dev server
below — no rebuild step.

### Icons / favicons / logo

Source of truth is **`web/public/`** — Vite copies it verbatim to the output
root. The build runs with `emptyOutDir`, so it **wipes `static/` and recopies
from `web/public/` every time**:

```
web/public/*  ──(vite build)──▶  src/aggregate_api/static/*  ──▶ browser
   ^ edit here                       ^ generated, wiped each build (don't edit)
```

To change an icon: replace the file in `web/public/` keeping the **same name**
(names are referenced in `web/index.html` and `web/public/site.webmanifest`):
`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`,
`logo.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png`. Then
rebuild.

Still stale after rebuild+deploy? It's **browser favicon caching** — these names
don't change between builds (unlike hashed `assets/index-*.js`), so the browser
reuses them by URL. Empty-cache-hard-reload, or check incognito. To tell browser
cache from a bad build, hit the file directly (e.g.
`http://10.8.0.1:19456/favicon-32x32.png`): new icon there but old in the tab =
browser cache; old icon there = the build/copy didn't take (confirm you edited
`web/public/`).

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

## Running on the Linux VPS

Topology — one backend, two Caddy front doors; the browser only ever talks to Caddy:

```
public  ──HTTPS──▶ Caddy agg.mynl.com:443  ─┐
                   (rate-limited, no /docs)  ├─▶ app 127.0.0.1:8001
Windows ──VPN───▶ Caddy 10.8.0.1:19456     ─┘   (private backend)
                   (unlimited, full /docs)
```

### Setup, in order

**1. Venv on Python 3.13.** The VPS defaults to 3.14, too new for the pinned
deps (pydantic crashes at import with a `prefer_fwd_module` / `_eval_type`
error). The project targets 3.11–3.13:

```bash
uv python install 3.13
uv venv --python 3.13
uv sync --extra dev
```

(`../aggregate_REFACTOR` must exist next to the repo — `pyproject.toml` pins the
`aggregate` editable source to that relative path.)

**2. Build the SPA bundle.** The built bundle (`static/index.html` + `assets/`)
is **gitignored**, so a clone/pull does NOT bring it — without it, `/` returns
`{"detail":"Not Found"}`. Build it on the VPS:

The VPS has no npm by default. Install Node with **nvm** (per-user, no root),
then build in place:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc          # reload so `nvm` is on PATH
nvm install --lts         # Vite 5 needs Node 18+; LTS is fine
cd ~/hacking/aggregate_api/web && npm install && npm run build   # → ../src/aggregate_api/static/
```

(Distro alternative: `sudo apt install nodejs npm`, but apt's Node is often too
old for Vite. Or, to avoid Node entirely, `scp` the built `index.html` + `assets/`
from a machine that already built them.)

**3. Run the app** bound to loopback (build first, start second — the `/` mount
is decided at startup):

```bash
uv run aggregate-api --port 8001 --host 127.0.0.1
```

Keep it alive past the SSH session with `nohup ... &` (or a systemd unit).

**4. Caddy block** — reload after editing (`sudo systemctl reload caddy`):

```caddyfile
http://10.8.0.1:19456 {
    bind 10.8.0.1
    # aggregate_api server
    reverse_proxy 127.0.0.1:8001
}
```

**5. Open the firewall port.** New ports are blocked by ufw until allowed —
this is the step that's easy to forget:

```bash
sudo ufw allow 19456/tcp
```

Then browse **http://10.8.0.1:19456/** from Windows (never the app's `:8001`).

### Troubleshooting — test the chain inside-out

```bash
# A. app up?            (on VPS)
curl -s http://127.0.0.1:8001/v1/health
# B. Caddy serving it?  (on VPS)
curl -s http://10.8.0.1:19456/v1/health
# C. who's listening?
ss -ltnp | grep -E ':(8001|19456)'
sudo ufw status
```

- **A fails** → app not running (foreground `uv run` dies on shell close → use `nohup`).
- **A ok, B fails** → Caddy block not loaded: `sudo caddy validate --config /etc/caddy/Caddyfile` then reload.
- **A+B ok on VPS, Windows fails** → firewall: `sudo ufw allow 19456/tcp`.
  Cross-check by opening a known-good port from Windows (e.g. `http://10.8.0.1:8300/`).
- **`/` gives `{"detail":"Not Found"}`** → SPA bundle missing (step 2); rebuild, restart app.

### Facts to remember
- App on `127.0.0.1:8001` is reachable only from the VPS itself; Caddy is the
  only door. 8001 is just a free local port — if it's taken (`address already in
  use`), pick another and change the `reverse_proxy` target to match.
- `bind 10.8.0.1` keeps the listener on the VPN interface (else 19456 opens
  publicly too). `http://` tells Caddy not to attempt TLS (can't, for a bare IP).
- One blanket `reverse_proxy` covers `/`, `/v1/*`, `/docs`, assets — same-origin,
  no CORS.

### Public route (`agg.mynl.com`)

Since 2026-06-13 the app is **also** public at `https://agg.mynl.com/` — its own
subdomain, root origin, auto-TLS from Caddy. This replaced the old obscured
`www.mynl.com/Q7M4Z9KP/` subpath (which broke the PWA: a stripped subpath can't
host a root `start_url` / `scope` / service-worker scope). Same backend
(`127.0.0.1:8001`) as the VPN route; the difference is all in Caddy. Three blocks
in `/etc/caddy/Caddyfile`:

- **`agg.mynl.com`** — `reverse_proxy 127.0.0.1:8001` inside a `route` that:
  hardens headers (`X-Robots-Tag`, `Referrer-Policy`), caps the body at 1 MB,
  **blocks the API explorer explicitly** (`@apidocs path /docs /docs/* /redoc …
  /openapi.json` → `respond @apidocs 404`), and rate-limits the build (below).
- **`www.mynl.com`** — shrunk back to a bare `reverse_proxy 127.0.0.1:8010` (its
  own content); the `/Q7M4Z9KP` redir + `handle_path` block were deleted.
- **VPN `:19456`** — simplified to a bare `reverse_proxy` (its old
  `handle_path /Q7M4Z9KP/*` was only there to make a prefix-built SPA work).

Reload: `caddy fmt --overwrite /etc/caddy/Caddyfile` → `sudo caddy validate
--config /etc/caddy/Caddyfile` → `sudo systemctl restart caddy`.

### Rate limiting (public `agg.mynl.com` route only)

The VPN route (`:19456`) is unlimited. The **public** route caps abuse via
Caddy's `rate_limit` module (the "special caddy install").

- **Only the build is capped.** A matcher limits `POST /v1/objects` (the one
  endpoint with real compute behind the semaphore + 10s timeout). Static assets
  and cheap GETs (`meta`, `examples`, `info`, `density`, …) are unlimited — so
  page loads and tab clicks never 429. Match the **real** path `/v1/objects`
  directly — same-origin now, there is no prefix to strip or account for.
- **Budgets:** per-IP `events 5 window 1m` + `100/1h`, keyed `{remote_host}`
  with `ipv6_prefix 64`. uvicorn logs the real client IP (proxy headers), so the
  key is per-visitor — *unless* a CDN sits in front, then key off
  `{http.request.header.CF-Connecting-IP}`. Obscurity is gone, so this limiter is
  now the **primary** abuse guard — tune `events` down to throttle harder.
- **Why a matcher matters:** without one the limiter counts *every* request; one
  page load is ~14 requests (html + js + css + 2 fonts + favicons + `meta`), so a
  small budget drains on load and 429s the fonts/favicons. (This bit us under the
  old route — fixed by matching only the build.)
- **Friendly 429:** Caddy `handle_errors` returns a JSON `detail` message for
  curl/direct callers; the SPA special-cases `status === 429` and renders a card
  (`error-pane.js` `renderRateLimit`, honoring `Retry-After`).
- **Verify scope:** a tight loop of `POST /v1/objects` should go `200…` then
  `429` after ~5/min; a loop on `/v1/health` stays all `200`. If builds never
  429, the config isn't live (validate + reload).
- **`/docs` is blocked on the public route — on purpose, explicitly.**
  `https://agg.mynl.com/docs` 404s because Caddy `respond @apidocs 404` rejects
  it (no longer an accident of prefix-stripping). External visitors get the SPA,
  not the interactive API explorer. `/docs` still works over the VPN
  (`http://10.8.0.1:19456/docs`).

### Curated Examples list

The Examples dropdown is fetched at runtime from `GET /v1/examples` (parsed from
an `.agg` file), so it's **not** baked into the SPA bundle — change the file,
restart the api, refresh the browser. Source precedence:
`AGGAPI_EXAMPLES_FILE` (a curated file anywhere on disk) → bundled
`aggregate/agg/spa_examples.agg`. Format: a `# A. Title` contents block plus
`agg A.Name …` item lines (optional trailing `note{…}`).
```powershell
$env:AGGAPI_EXAMPLES_FILE = "T:\tmp\silly-examples.agg" 
uv run aggregate-api --port 8001
```

### VPS refresh: `uv.lock` blocks `git pull`

If a refresh fails with *"Your local changes to the following files would be
overwritten by merge: uv.lock … Aborting"* — that does **not** mean `uv.lock`
should be gitignored. Keep it tracked so the VPS installs the same resolved
environment as the dev box. Something on the VPS (usually `uv sync`) re-resolved
the lock. Inspect, then discard just that file and pull:

```bash
git diff -- uv.lock
git restore uv.lock
git pull --ff-only
```

Make refresh install *from* the lock instead of updating it:

```bash
( cd "$AGG_DIR" && uv sync --frozen --extra dev )
( cd "$API_DIR" && uv sync --frozen --extra dev )
```

Lock updates should happen intentionally on Windows, get committed, then pulled
by the VPS.

### Later: run as a systemd service

Current relaunch is `nohup` to `~/aggapi.log` (fine while watching logs in dev).
When ready to make it durable (auto-restart, starts on boot), drop a unit at
`/etc/systemd/system/aggregate-api.service`:

```ini
[Unit]
Description=aggregate_api (FastAPI/uvicorn)
After=network.target

[Service]
Type=simple
User=steve
WorkingDirectory=/home/steve/hacking/aggregate_api
ExecStart=/home/steve/.local/bin/uv run aggregate-api --host 127.0.0.1 --port 8001
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

(`ExecStart` path: check with `which uv`.) Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aggregate-api    # start + run on boot
sudo systemctl restart aggregate-api         # after a deploy
journalctl -u aggregate-api -f               # watch logs (replaces tail -f)
```

With this in place, `refresh.sh` swaps its `pkill`/`nohup` block for a single
`sudo systemctl restart aggregate-api`.

## Upstream (`aggregate`) — not fixable here

Some things live in the `aggregate` library (the editable `../aggregate_REFACTOR`
checkout), not this repo — fix them there, then `uv sync`:
- **Plot / matplotlib styling** (plan-0002 **E**): the off-brand
  blue-background, serif-font plots come from `aggregate.mplstyle`. Restyling to
  match the site is an *upstream* edit (a draft sits over the file awaiting
  Jupyter review); nothing in `aggregate_api` controls it.
- **Parser internals** the api leans on (`parser_errors`, `parser._PARSER`):
  bugs in DecL completion / error reports are upstream too.

## Session log

Running tab of what we've done (newest last).

### 2026-06-09 — first VPS deploy over the VPN
- Executed `plan-0001` (standalone bootstrap → 1.0.0a2); suite green on Windows.
- VPS hit the Python-3.14 pydantic crash → rebuilt the venv on 3.13.
- Stood up Caddy reverse proxy: `http://10.8.0.1:19456` → `127.0.0.1:8001`.
- Couldn't reach it from Windows → **ufw was blocking the new port**;
  `sudo ufw allow 19456/tcp` fixed it.
- `/` returned `{"detail":"Not Found"}` → the SPA bundle is gitignored and
  wasn't on the VPS. Chose to **build on the VPS**: installed Node via nvm, then
  `npm install && npm run build` in `web/`. SPA serving; Swagger at `/docs`.
- Wrote a one-stop **`refresh.sh`** (lives in the VPS parent dir, `~/hacking/`):
  git-pull both repos → `uv sync` both → rebuild SPA → kill+relaunch the app via
  `nohup` → print `aggregate` / `aggregate_api` versions. Sources nvm so npm is
  on PATH. `AGG_DIR` must match the `../aggregate_REFACTOR` pin in the api's
  `pyproject.toml` (satisfied by a `aggregate_REFACTOR → aggregate` symlink).
  Written to the VPS parent dir; `chmod +x ~/hacking/refresh.sh` to run.
  Sticking with `nohup` + log-watching for now (not near prod); systemd unit
  documented above for later.
- `refresh.sh` hit `build-web.sh: Permission denied` — the script's exec bit
  isn't set on checkout. Permanent fix: `refresh.sh` calls it as
  `bash ./scripts/build-web.sh` (no exec bit needed, survives fresh clones).
- **Up and running on the VPS** — full chain working: refresh → SPA serving at
  `http://10.8.0.1:19456/`, Swagger at `/docs`.
- Note on versions: `aggregate.__version__` reflects the *installed* package
  metadata, not the working-tree source — pulling a bump needs `uv sync` (or
  `uv run`, which auto-syncs) before `__version__` updates. And `git status`
  doesn't contact the remote: `git fetch`/`pull` first or its "up to date" is
  stale.

### 2026-06-13 — public subdomain cutover + PWA
- Retired the obscured `www.mynl.com/Q7M4Z9KP/` subpath; the app is now public at
  `https://agg.mynl.com/` (own origin, auto-TLS), built **same-origin** (no
  `-ApiBase`). Caddy: new `agg.mynl.com` block (hardening + 1 MB cap + explicit
  `/docs` 404 + build rate-limit 5/min·100/h), shrunk `www.mynl.com`, simplified
  the VPN `:19456` block. Dropped the `-ApiBase` arg from `refresh.sh`.
- This unblocked the installable **PWA** (manifest + `sw.js`, shipped in a6): a
  root origin is required for a clean `start_url` / `scope` / service-worker
  scope. Closed `plan-pwa`.
