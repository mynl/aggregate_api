# human-hints.md

My crib sheet for `aggregate_api`. Short notes to self.

## How a batch of tweaks ships: gather → review → execute

Working style for the `plan-misc-*` batches. Instead of one plan per tweak,
collect related small changes in a single *gathering* plan, then build them as
one versioned batch:

1. **Gather.** Discuss tweaks one at a time; each gets a spec appended to the
   open `dev/plan-misc-NN.md` (Problem / fix / files-to-touch, like the items in
   plan-misc-01). Plan stays `Status: gathering`. No code yet.
2. **Review.** When the list is big enough to be worth a build, read the whole
   plan top-to-bottom as a final sanity pass — drop/merge items, confirm scope,
   pick the version. Flip to `Status: final`.
3. **(Compact.)** Usually `/compact` here: the gather discussion is all on disk
   in the plan, so the chat context is disposable.
4. **Execute.** Build the whole batch on one "go" — one version bump
   (`1.0.0a*`), one CHANGELOG section, move the plan to `dev/done/` with a
   landing note. (Same close-out as the standing release rules in CLAUDE.md.)

`plan-misc-01` ran exactly this loop (p=1 / friendly 422s / standalone
Distortions / hints log2 cap / grid version → a9). `plan-misc-02` is the current
open gathering plan.

## The two folders

`web/src/` is the **source** I edit (the `.js` files). `src/aggregate_api/static/`
is the **built output**. The build reads the first and writes the second. There
is no `static/` under `web/`.

## Running the app

One FastAPI process serves both the UI and the api, same origin:

```powershell
uv run aggregate-api --port 8001
```

The `$env:UV_LINK_MODE = "copy"` line that used to head this block is gone: the
venv is a junction to `V:\dev\venvs\aggregate_api` and the uv cache is on the
same volume, so hardlinking works and the override does nothing.

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

> **`greater-tables` blocks a VPS deploy right now (a34).** The static-table
> engine is pinned to a **Windows path** (`c:/s/ai/greatest-tables`) that does
> not exist on the VPS, so `uv sync` cannot resolve it there. Worse, the obvious
> fix is a trap: PyPI's `greater-tables` **5.3 is the previous generation** and
> shares the `greater_tables` import name, so installing it resolves without
> error and then the app dies at import (5.3 has no `build`, `canonical_json` or
> `IR_VERSION`). It publishes as **6.0**; pin that explicitly when it lands,
> since pip ignores pre-releases unless asked:
>
> ```bash
> uv add "greater-tables==6.0.0rc1"     # or later; do NOT take plain 5.3
> ```
>
> `uv run pytest tests/test_meta.py -k generation` asserts the right one is
> installed. Until 6.0 is on PyPI, the table path cannot deploy.

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
- **One worker, and it is load bearing since a110.** The session forks, the
  session registry and the object cache are all in-process memory, so running
  uvicorn with two workers shards them silently: the same browser gets a
  different recipe base depending on which worker answers. Nothing errors; the
  answers just stop being consistent. If throughput ever needs more than one
  process, the cache has to move out first.

### Sessions

Since a110 every browser tab carries a session id (`X-Aggregate-Session`, minted
into `sessionStorage` as `<utc timestamp>-<uuid4>`) and the server keeps that
session its own forked recipe base. So two people on `agg.mynl.com` can both
declare `agg Line` and neither one's program means the other's.

**It is a namespace, not a credential.** Anyone holding your id gets your
objects. That is exactly why the app needs no login: it separates people who are
not trying to reach each other. Do not put anything behind it that would matter
if it leaked.

**A session is one tab and nothing persists.** A reload keeps it, a new tab
mints a fresh one, and a server restart ends every one of them. The way to keep
work is the `.agg` download.

Knobs: `AGGAPI_SESSION_MAX` (500 forks) and `AGGAPI_SESSION_TTL_S` (eight hours
idle). A fork costs microseconds and a few hundred kilobytes, so the count is
deliberately generous and the TTL is what bounds memory. Headerless clients
(`curl`, the test suite) share one anonymous session, which is the old
process-wide behavior, kept so nothing that worked stopped working.

Whether the rule is working is one column in the audit log: `key_scope` says
`shared` for a build the whole room can reuse and `session` for one keyed
privately. Nearly all `session` in a demo would mean it is qualifying programs
that did not need it, and the room is paying for builds it could have shared.

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

### Status page (`/v1/status`, private, three layers)

An operator's page at `http://10.8.0.1:19456/v1/status/page` over the VPN,
backed by JSON at `/v1/status`: versions loaded, live session forks and what
they built, cache hit rates, build latency off the audit log, whether the
shared-against-session cache rule is behaving, and process memory and CPU. Read
only; nothing under `/v1/status` builds, evicts or clears anything.

**The trap that shapes it.** Both front doors `reverse_proxy 127.0.0.1:8001`,
so `request.client.host` is `127.0.0.1` for a public visitor exactly as much as
for a VPN one. A gate written as "allow if the peer is loopback" would test
green on the laptop, test green over the VPN, and publish the page to the whole
internet. So the gate reads `X-Forwarded-For` instead, and reads the **last**
element: Caddy appends what it observed, so a visitor who sends
`X-Forwarded-For: 10.8.0.2` arrives as `10.8.0.2, <their real address>`, and
reading the first element hands them the page. See `src/aggregate_api/net.py`.

**The single-hop assumption is load bearing.** Reading the last element is
correct for exactly one trusted proxy, which is this topology. Put a second
proxy in front (a CDN, another Caddy) and that index is wrong and the gate
opens. Nothing in the app can detect it: a change to the topology is a change to
`net.py`.

The same fix corrects a long-standing audit bug. `_client_ip` read the peer and
nothing else, so every production row recorded `ip = '127.0.0.1'`, the
`builds_ip` index indexed one value, and `AuditLog.by_ip` could not answer the
question it exists for. Rows written before a112 are not retroactively
meaningful.

**Layer one, the Caddy edit (the only one required).** Add the prefix to the
existing `@apidocs` matcher on the `agg.mynl.com` block, beside `/docs` and
`/openapi.json`:

```caddyfile
@apidocs path /docs /docs/* /redoc /redoc/* /openapi.json /v1/status /v1/status/*
respond @apidocs 404
```

One prefix covers both routes and every future status route, which is why they
live under `/v1` together: a matcher with a gap in it is the likeliest way this
layer fails. The VPN block is untouched.

**Layer two, `AGGAPI_PRIVATE_CIDRS`**, defaulting to
`127.0.0.0/8, ::1, 10.8.0.0/24`. Set it if the VPN subnet ever moves. A
malformed entry raises rather than silently allowing less.

**Layer three, off by default.** `AGGAPI_STATUS_REQUIRE_ZONE_HEADER=true` makes
the app additionally demand `X-Aggapi-Zone: private`, which the VPN block would
set (`header_up X-Aggapi-Zone private`) and the public block would strip
(`header_up -X-Aggapi-Zone`). It is the only layer that survives a mistake in
the CIDR list. Left off because it couples the app to a Caddyfile edit and fails
closed but confusingly: the page simply stops working.

**Install line.** The resource panel wants `psutil`, an optional extra:

```
uv sync --extra status
```

Without it the page still works and falls back to `/proc` and stdlib, and says
which source it used. Fields that cannot be filled read "unavailable" with the
reason, never zero.

**Verify, and verify the refusal as well as the answer:**

```bash
# From Windows on the VPN: the page answers.
curl -so /dev/null -w '%{http_code}\n' http://10.8.0.1:19456/v1/status     # 200

# From anywhere outside: Caddy 404s before the app is reached.
curl -so /dev/null -w '%{http_code}\n' https://agg.mynl.com/v1/status      # 404

# And the app refuses on its own, with layer one bypassed. Run on the VPS,
# forging the header a public visitor's request would carry.
curl -so /dev/null -w '%{http_code}\n' \
  -H 'X-Forwarded-For: 203.0.113.7' http://127.0.0.1:8001/v1/status        # 404
```

The third is the one worth running after any Caddy change: the first two pass
whenever layer one is intact, and only the third says layer two is still there.

`AGGAPI_STATUS_REFRESH_S` (default 10) sets the page's auto-refresh cadence; the
page has its own pause control.

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

#### Building Caddy with the rate-limit module

`rate_limit` is not in stock Caddy — it needs a custom build. That is what
"the special caddy install" means. `scripts/setup-caddy-ratelimit.sh` does the
whole thing: installs `xcaddy` via `go install` if needed, builds Caddy with
`github.com/mholt/caddy-ratelimit`, checks `http.handlers.rate_limit` is present,
validates the Caddyfile with the new binary, backs up the old one, stops the
service, installs, restarts, and smoke-tests.

```bash
sudo apt install -y golang-go        # if Go is missing
cd ~/hacking/aggregate_api
bash ./scripts/setup-caddy-ratelimit.sh
```

Overrides:

```bash
CADDYFILE=/path/to/Caddyfile bash ./scripts/setup-caddy-ratelimit.sh
CADDY_BIN=/usr/bin/caddy bash ./scripts/setup-caddy-ratelimit.sh
SMOKE_URL=https://agg.mynl.com/v1/health bash ./scripts/setup-caddy-ratelimit.sh
RUN_RATE_LIMIT_TEST=1 bash ./scripts/setup-caddy-ratelimit.sh
```

`RUN_RATE_LIMIT_TEST=1` deliberately sends enough requests to trigger a 429,
which spends your own IP's minute bucket. Use it only when you can wait a minute.

**An `apt upgrade` can overwrite the custom binary with stock Caddy**, silently
removing the limiter. After any upgrade:

```bash
caddy list-modules | grep rate_limit          # gone? rerun the script
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

#### Request body cap

Caddy's `request_body { max_size 1MB }` returns a 413 above the cap, which keeps
a giant POST from reaching the build path at all. Check it with:

```bash
python3 - <<'PY' | curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST --data-binary @- https://agg.mynl.com/v1/objects
print("x" * 1100000)
PY
```

Expected: `413`.

#### Discouraging indexing

`X-Robots-Tag "noindex, nofollow, noarchive, nosnippet, noimageindex"` on the
route, plus a `robots.txt` that disallows everything:

```caddyfile
handle /robots.txt {
    header Content-Type text/plain
    respond "User-agent: *\nDisallow: /\n" 200
}
```

Neither stops a bot that ignores robots rules. The rate limiter is the guard
that actually holds.

### Curated Examples list

The Examples dropdown is fetched at runtime from `GET /v1/examples` (parsed from
an `.agg` file), so it's **not** baked into the SPA bundle: change the file,
restart the api, refresh the browser. Source precedence: `--library` /
`AGGAPI_LIBRARY` (a curated file anywhere on disk), then bundled
`aggregate/agg/library.agg`.

Since a109 the setting points the **whole process** at that file, not just the
menu: every build and the `.agg` download resolve against it too, so an entry
may name a sibling. `AGGAPI_EXAMPLES_FILE` is the old name for it, accepted for
one release and warning when used.

**A short library is the fast way to review.** The flag is the one to reach for:

```powershell
uv run aggregate-api --port 8001 --library T:\tmp\short.agg
```

It resolves the path, checks it, and **exits if it is wrong**. The env var
warns and silently falls back to the full library instead, which is right for a
stale setting on a server and wrong for something typed on purpose. Both end up
in the same place; the flag just refuses to lie about it.

```powershell
$env:AGGAPI_LIBRARY = "T:\tmp\short.agg"           # same thing, no path check
```

**Format** is `library.agg`'s own, so copy an entry out of it rather than
inventing one. Names are descriptive and globally unique; the old `A.` / `B.`
filing prefixes are gone and `tags{}` does the grouping. A program can span
lines, and the trailer follows it indented:

```
agg TinyDice dfreq [1] dsev [1:6]
  note{One fair die.}
  tags{topic:discrete role:hero}
```

`topic:` drives the dropdown's groups, `role:hero` puts an entry in the landing
gallery. An entry with no `topic:` lands in an "other" group; one that fails to
resolve is skipped with a warning rather than blanking the menu, so check the
server log if something you expected is missing.

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

## Design work: the mockup loop

How the a47 shell redesign was actually done, and worth repeating. The `hacks/`
folder is gitignored, so everything here is throwaway by construction.

1. **One self-contained HTML per round**, `hacks/mockup-NN.html`. Bootstrap and
   its icons from the CDN, everything else inline. Opens over `file://` or off a
   `python -m http.server` when the browser is on another machine.
2. **Real data, not lorem.** Build one object of each kind against the running
   api, capture the capability blocks, and drive the mockup's greying from
   those. The Summary and Tail numbers in mockup-10 are a real `BasicBook`
   build. A mockup that lies about its content produces decisions that do not
   survive contact with the app.
3. **A black scaffolding bar of selectors, top right.** Deliberately ugly so it
   never gets ported. Every open question is a dropdown, so options are compared
   by flipping rather than by diffing two files in two windows. Object, so the
   greying can be seen under load, is the one that stays useful longest.
4. **Killing a selector is how a decision gets recorded.** Once something is
   chosen it gets baked into the CSS and its dropdown is deleted. The file
   converges on being the spec, and what remains on the bar is exactly what is
   still open.
5. **Present three concepts, not one.** Then refine the winner. Two of the three
   in round one were dropped outright, which is the point of building three.

### Filling the capability matrix

Do not hand-write "what applies where". Build one object per kind against the
live api, then run the capability blocks through the *real* `web/src/nav.js`
rules with a throwaway node script (import it as a `file:///` URL on Windows or
node rejects the drive letter). The table and the code then cannot disagree.
Done this way at a46, the result matched the hand-written plan cell for cell.

## Revealed design preferences

Standing preferences, from the a47 round. Apply without re-asking.

- **Clean, few boxes.** Hierarchy comes from type size and whitespace, not from
  containers. A box has to earn its place.
- **One idea per line.** A bold title followed by its gloss on one line beats a
  heading over a separate hint line. Never two elements saying the same word at
  two different sizes and two different alignments.
- **Explanatory text goes below the thing it qualifies**, never to its right.
  To the right it reads as another item in the row it sits in.
- **Fixed menus.** The menu set never changes shape. Non-applicable items grey
  out, never hide. Greyed items say *why* on hover, in the reader's terms; live
  items do not, because they already carry their own explanation.
- **The accent means selected, and nothing else.** Spending it on a Build button
  as well made the eye meet it three times down the page with no relation
  between the three. Build carries no color; it holds primacy by weight and
  position.
- **Decoration that carries no information gets cut**, even when it looks nice.
  The accent rule over the exhibit title went for exactly this reason.
- **Real tab shapes over underlines**, and *every* tab drawn rather than only
  the active one, so the strip reads as a strip whichever tab you are standing
  on. Content aligns to the first tab's **label**, not to its box edge.
- **One measure for all prose.** In `rem`, not `ch`: different elements sit at
  different font sizes and `ch` would give them different right edges.
- **State needs more than hue.** Validation tints the whole status strip as well
  as coloring the verdict, so a warning cannot be missed and a scarlet failure
  is never mistaken for the brick red of a selected tab.
- **Tie colors that mean the same thing.** One green in the app, shared by the
  clean validation verdict and the editor's string tokens, rather than two that
  differ by a few points and look like a mistake. The accent is the house red
  that already marked inline `code` and the parse-error caret.
  *Checked at execution, and worth knowing:* the editor colors numbers **copper**
  `#b87333`, and a DecL object name is plain text, because `decl-mode.js` emits
  keyword / atom / number / string / comment / bracket and a name is none of
  them. The mockup faked a red object name; the app has none.
- **No serif.** Tried on the display level, rejected outright.
- **Press ramp** (pure black through true neutrals) over Bootstrap's greys.
- Status strip wraps, never overflows.

## Where color actually lives (before restyling anything)

`site.css` holds 56 hex literals, 21 distinct, and only **7** of them are in the
`:root` block. `#374151` alone appears 9 times as a body-text slate that is not
a token at all. Tokenize first, restyle second, or it is a hunt.

Three color sources sit **outside** `site.css` and will not follow a change to
it:

- **`gt.css`**, the static booktabs table look. Fetched at runtime from
  `/v1/assets/gt.css` (`web/src/tables.js`), served out of the `greater_tables`
  *package*. Override from `site.css` (mind the specificity: gt.css writes
  `.gt.gt td`, so a bare `.gt-host td` loses) or fix upstream.
- **`csv-grid.css`**, the interactive table view, imported from the npm package
  in `web/src/grid.js`.
- **`web/src/charts/theme.js`**, the ECharts palette, as JS constants and
  currently Bootstrap's own (`#0d6efd`, `#198754`, `#dc3545`, …).

Good news on structure: restyling the group tabs is **CSS only**. The shipped
`nav nav-pills out-tabs` markup with `data-bs-toggle="pill"` can be drawn as
folder tabs without touching the Bootstrap Tab plugin, the panes, or the
capability gating (`main.js` couples to the plugin in three places: the
`getOrCreateInstance().show()` call, the `shown.bs.tab` listener, and the
`.disabled` toggle in `applyCapabilityGating`).

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
