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

## Running on the Linux VPS (over the VPN)

Topology — two listeners, browser only ever talks to Caddy:

```
Windows ──VPN──▶ Caddy 10.8.0.1:19456 ──▶ app 127.0.0.1:8001
                 (VPN front door)          (private backend)
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
