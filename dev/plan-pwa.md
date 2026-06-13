# plan-pwa — installable PWA + retire the obscured prefix

Status: **in progress** (1.0.0a6). **Phase B (PWA code) landed** — manifest
completed, `web/public/sw.js` added + registered in `main.js`, `theme-color`
meta, `build-web.ps1` usage trimmed. **Phase A (retire the prefix) is the
pending VPS cutover** — DNS `agg.mynl.com` + the three Caddyfile edits +
`refresh.sh`/`build-web.sh` dropping `-ApiBase`, then the `human-hints.md`
runbook rewrite (held until the cutover is live so the doc never describes a
non-live state). No backend code changes.

Two coupled goals:
1. **Decommission the `/Q7M4Z9KP` security-by-obscurity prefix** (Phase A). It's
   the root cause of the PWA path headaches and is "messing other things up."
2. **Finish the install-as-PWA** (Phase B): complete the manifest, add a service
   worker, ship the nice phone icon / standalone launch.

They're sequenced A→B on purpose: B is *clean* only once the app lives at a real
origin instead of a stripped subpath.

---

## Phase A — retire the obscured prefix

### Why obscurity has to go
A PWA's `start_url`, `scope`, manifest icon paths, and the **service-worker
scope** are all origin-relative and must match the URL the *browser* sees. Today
the browser sees `www.mynl.com/Q7M4Z9KP/` while Caddy `handle_path` strips the
prefix and the backend serves at `/`. That mismatch:
- makes the manifest's root-absolute icons (`/android-chrome-192x192.png`)
  resolve to `www.mynl.com/android-chrome-…` — **wrong path, already 404 on the
  public URL**;
- caps a service worker's scope at the path it's served from, so a non-root
  deploy can never cleanly control `/`.
A non-root *subpath* has this problem whether or not it's obscured — so the fix
isn't "a prettier prefix," it's **no prefix**.

### Where it lives publicly — CONFIRMED: `agg.mynl.com`
A dedicated subdomain (root of its own origin) is the only option that makes the
PWA truly clean: `start_url: "/"`, `scope: "/"`, icons at `/…`, SW scope `/`, API
same-origin → **no `-ApiBase` needed at all**. Caddy auto-provisions TLS for the
new name (port 443 is already open for the other subdomains). The author will
add the DNS record. (Rejected alternatives: a clean path `www.mynl.com/aggregate/`
keeps the subpath, so the manifest/SW scope pain remains — half a fix; serving at
`www.mynl.com/` root — that domain hosts other content.)

### Preserve the "no public Swagger" feature explicitly
Today `/docs` is unreachable publicly only as a **side effect** of the prefix
strip (`handle_path` strips `/Q7M4Z9KP`, FastAPI emits a root-relative
`/openapi.json`, it 404s). Removing the prefix removes that accident — so the
docs would become public again unless we block them on purpose. The SPA needs
`/v1/*`, but not the explorer. Add an explicit Caddy block for
`/docs`, `/redoc`, `/openapi.json`. (The VPN route `:19456` keeps full `/docs`.)

> Honest caveat: dropping obscurity means `/v1/*` is discoverable from the SPA's
> own network calls — anyone watching DevTools sees the endpoints. That's fine:
> the **rate limiter is the real protection**, and it becomes *more* important
> now, not less. Keep it (and consider tightening `events`).

### Caddy changes (server-side; `Caddyfile` is not in this repo)
Three edits to `/etc/caddy/Caddyfile`. These are written against the live config
(reload is `sudo systemctl restart caddy`; validate/format commands are in the
file header). The build's rate-limit zone names are reused, so this is a **move,
not a duplicate** — the old `www.mynl.com` route must be deleted in the same edit
or the zone names collide.

**1. Add a new `agg.mynl.com` site block** (carries over the hardening headers,
the 1 MB body cap, and the current 5/min rate limit from the old route; adds the
explicit `/docs` block; folds in the friendly-429 handler):
```caddy
agg.mynl.com {
    # aggregate_api — public route on its own subdomain (replaces the old
    # obscured /Q7M4Z9KP path on www.mynl.com). The SPA is now built
    # same-origin (no -ApiBase / no VITE_API_BASE_URL), so it calls /v1/...
    # directly and there is no prefix to strip.
    route {
        header {
            X-Robots-Tag   "noindex, nofollow, noarchive, nosnippet, noimageindex"
            Referrer-Policy "no-referrer"
        }

        request_body {
            max_size 1MB
        }

        # Keep the interactive API explorer private. This used to happen by
        # accident (handle_path stripped the prefix and FastAPI's root-relative
        # /openapi.json 404'd); now it's explicit. The SPA only needs /v1/*.
        @apidocs path /docs /docs/* /redoc /redoc/* /openapi.json
        respond @apidocs 404

        # Rate-limit ONLY the expensive build (POST /v1/objects). No handle_path
        # strip anymore, so match the real public path directly (the old
        # "bare path" gotcha is gone).
        @build {
            method POST
            path   /v1/objects
        }
        rate_limit @build {
            zone aggregate_build_minute_by_ip {
                key         {remote_host}
                events      5
                window      1m
                ipv6_prefix 64
            }
            zone aggregate_build_hour_by_ip {
                key         {remote_host}
                events      100
                window      1h
                ipv6_prefix 64
            }
            log_key
        }

        reverse_proxy 127.0.0.1:8001
    }

    # Friendly body when the build rate-limit (429) trips. The SPA renders its
    # own card; this is what curl / direct callers see.
    handle_errors {
        @ratelimited expression {http.error.status_code} == 429
        header @ratelimited Content-Type "application/json; charset=utf-8"
        respond @ratelimited 429 {
            body `{"detail":"We're glad you're enjoying aggregate! It's a shared, free resource, so builds are gently rate-limited to keep it snappy for everyone. Please pause a moment and try again — or run it locally (open source): https://github.com/mynl/aggregate"}`
        }
    }
}
```

**2. Shrink the `www.mynl.com` block** back to just its own site — delete the
`redir /Q7M4Z9KP …`, the whole `handle_path /Q7M4Z9KP/* { … }`, and the now-orphan
`handle_errors` (429 handling moved to `agg.mynl.com`). The `handle { … }` wrapper
can collapse to a bare `reverse_proxy`:
```caddy
www.mynl.com {
    reverse_proxy 127.0.0.1:8010
}
```

**3. Simplify the VPN block `http://10.8.0.1:19456`** — its `handle_path
/Q7M4Z9KP/*` existed only to make a prefix-built SPA work over the VPN. Same-origin
builds don't prefix, so it's dead:
```caddy
http://10.8.0.1:19456 {
    # aggregate_api VPN route — unlimited, full /docs. Same-origin now; the old
    # /Q7M4Z9KP handle_path is gone.
    bind 10.8.0.1
    reverse_proxy 127.0.0.1:8001
}
```

Then: `caddy fmt --overwrite /etc/caddy/Caddyfile`,
`sudo caddy validate --config /etc/caddy/Caddyfile`, `sudo systemctl restart caddy`.

### Build-invocation change (the "no `-ApiBase`" win)
The SPA currently builds with `-ApiBase /Q7M4Z9KP` so every `fetch()` is
prefixed. Same-origin subdomain ⇒ **build with no `-ApiBase` at all** →
`fetch('/v1/…')`. Edit the VPS `build-web.sh` / `refresh.sh` to call the build
**without** the flag. `VITE_API_BASE_URL` returns to empty. (`build-web.ps1`
needs no code change — just stop passing the arg — but trim its `/Q7M4Z9KP`
example comments while we're there.)

### Server-side rebuild recipe (Phase A)
1. **DNS:** add an `A` record `agg.mynl.com` → the VPS public IP (same IP as the
   other `*.mynl.com` names). Wait for propagation before reloading Caddy so the
   automatic-HTTPS cert (ACME, needs the name to resolve + ports 80/443 open) can
   be issued.
2. **Caddy:** apply the three edits above (add `agg.mynl.com`, shrink
   `www.mynl.com`, simplify the VPN block). `caddy fmt --overwrite` →
   `sudo caddy validate --config /etc/caddy/Caddyfile` →
   `sudo systemctl restart caddy`.
3. **Build:** the VPS rebuild invokes the SPA build with the obscured prefix
   (`build-web.sh /Q7M4Z9KP`, per the old `www.mynl.com` comment). Drop the
   argument so the build is **same-origin** (no `VITE_API_BASE_URL`) — edit
   `refresh.sh` / `build-web.sh` to call it with no prefix, then run `refresh.sh`
   (git pull → `uv sync --frozen --extra dev` → rebuild SPA → restart api). The
   bundle now fetches same-origin `/v1/…`.
4. **Restart** the api (nohup, or `systemctl restart` once the unit lands).
5. **Verify:** `https://agg.mynl.com/` loads the SPA and builds work (valid TLS);
   `https://agg.mynl.com/docs` returns 404; the VPN route
   `http://10.8.0.1:19456/docs` still works; a tight `POST /v1/objects` loop 429s
   after ~5/min; `https://www.mynl.com/Q7M4Z9KP/` no longer resolves to the app.

### Docs to update (human-hints.md)
- `-ApiBase` section: it's no longer needed for the VPS; note same-origin.
- Rate-limiting section: drop the **"bare path" gotcha** (no strip anymore — the
  matcher is the real `/v1/objects`); keep budgets + friendly-429.
- The **"`/docs` is intentionally broken"** note: rewrite — docs are now blocked
  *explicitly* in Caddy (`respond @apidocs 404`), not by a strip side effect.
- Deploy/refresh section: reflect the subdomain + no-`-ApiBase` build.

---

## Phase B — finish the installable PWA

Groundwork already on disk (`web/public/`): full icon set (192, 512,
apple-touch-180, favicons), a `site.webmanifest`, and the head links in
`web/index.html`. Two gaps remain.

### 1. Complete the manifest (`web/public/site.webmanifest`)
Currently: empty `name`/`short_name`, **no `start_url`/`scope`**, no maskable
purpose, stock white `theme_color`. Fill in:
```json
{
  "name": "aggregate DecL playground",
  "short_name": "aggregate",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "<match the site header color in site.css>",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```
With the subdomain, the root-absolute icon `src` values are finally correct.
Add `<meta name="theme-color" content="…">` to `web/index.html`'s head to match.

### 2. Service worker (the only thing blocking "Install")
Chrome won't offer Install without a registered SW that has a `fetch` handler.

**Key framing:** a build *requires* the backend (you can't compute an Aggregate
offline), so **full offline is pointless** — the SW only needs to (a) exist with
a fetch handler so the app is installable, and (b) cache the app *shell* for fast
launches. It must **not** cache `/v1/*** (dynamic; includes the CSV/density
routes plan-grid will lean on).

Recommended: a **small hand-rolled SW** (`web/public/sw.js`, copied verbatim to
the build root → served at `/sw.js`, scope `/`), in keeping with the project's
"explicit recipes over magic" rule:
- **`/v1/*` → network-only** (never cached).
- **navigation (HTML) → network-first**, fall back to cached shell — so a
  redeploy is picked up immediately (index.html is unhashed).
- **hashed assets (js/css/icons) → cache-first** — Vite content-hashes
  filenames, so a new build = new URLs; an `activate` handler deletes old
  caches keyed by a `CACHE_VERSION` bumped each release.
- Register in `web/src/main.js`: `navigator.serviceWorker.register('/sw.js')`
  (guard for support; only in production build).

Alternative: **`vite-plugin-pwa`** (`registerType: 'autoUpdate'`,
`generateSW`) — robust, auto-precache + auto-update, but it's the "magic"
auto-generation the project usually avoids, and adds a build-time dep. Pick the
hand-rolled SW unless its maintenance proves annoying.

### 3. Verify installability
Chrome DevTools → Application → Manifest (no errors, icons resolve) and Service
Workers (active, controlling). Run the Lighthouse "Installable" check. On a
phone: Add to Home Screen → launches standalone with the big icon. HTTPS is
satisfied by the subdomain's auto-TLS (localhost is exempt for dev).

### Phase B risks
- **Stale bundle after redeploy** — the classic SW footgun. Mitigated by
  network-first navigation + versioned cache + old-cache cleanup on `activate`.
  If it still sticks, bump `CACHE_VERSION` and hard-reload once.
- **Caching `/v1/*`** would serve stale builds/frames — explicitly excluded
  (network-only). Cross-check this when plan-grid's density `{url}` lands.

---

## Pended (separate, longer-term) — `.agg` OS file association
Out of scope for this plan; tracked in `dev/TODO.md` backlog. Sketch for when we
revisit:
- An *installed* PWA can register `file_handlers` in the manifest (associate
  `.agg` / `text/plain`) and receive opens via the `launchQueue`
  (`window.launchQueue.setConsumer(...)`), reading the `FileSystemFileHandle`
  into the editor (`editor.setText`).
- **Chromium-desktop only**, requires the PWA installed + HTTPS, and the value is
  theoretical until there's a reason to double-click a `.agg` into the app.
- On-ramp: a plain in-page **"Open file"** button (`<input type="file">` →
  `editor.setText`) gives the same gesture everywhere with none of the OS
  complexity — a natural small add (candidate for `plan-ui-enhancements-01`), and
  the function the file-handler would later call into.

---

## Impact on the other queued plans
- **plan-ui-enhancements-01** — *synergistic, no conflict.* The 16px-input fix
  matters *more* in an installed standalone window (no browser zoom chrome).
  Optional add: the "Open file" button as the `.agg` on-ramp.
- **plan-help** — *low impact.* The fair-use/429 note stays valid (rate limiting
  is now the primary guard). Optional once PWA lands: a one-line "Install this
  app" hint in the help panel.
- **plan-grid** — *do it AFTER Phase A.* Its density `{url}` fetch + Vite worker
  pathing should be exercised against the **final clean origin**, not the
  stripped prefix. And the SW (Phase B) must keep `/v1/*` network-only so grid's
  CSV/density frames are never served stale.

## Effort
- Phase A: ~half a day (mostly DNS propagation + Caddy verify + a refresh).
- Phase B: ~half a day incl. the SW + install verification.
- No backend changes; one version bump for the pair.
