# Plan: serve the Excel add-in from agg.mynl.com

Minor bump. Follows `plan-excel-core.md`.

## Goal

Excel on the web, Windows desktop and Mac desktop all load the add-in from
`https://agg.mynl.com/excel/` and call the API on that same origin.

## Why the public origin

- **Excel on the web cannot reach a local server.** It loads an add-in in a
  frame inside Microsoft's page. Since Chrome and Edge 142, Local Network
  Access blocks a frame's requests to localhost or to a private address (a VPN
  address included) unless the parent page grants
  `allow="local-network-access"`, and only Microsoft controls that page.
  `OfficeDev/office-js#6281` was closed as completed on 2025-12-23; users
  reported the permission still missing in Outlook on the web in January 2026.
  A public HTTPS origin never meets that rule.
- **Same origin as the API** means no CORS, no mixed content, and an add-in
  whose version is always the server's, the same advantage the SPA has.
- Excel on iPad has no custom functions and is out.

## Change

**[mount]** `app.py` mounts `/excel` from `src/aggregate_api/excel_static/`,
**before** the `/` mount (Starlette matches mounts in order, and `/` with
`html=True` would answer `/excel/...` with the SPA). A separate directory so the
SPA's build can never delete it. Responses carry `Cache-Control: no-cache`
(Office caches add-in files hard; a small `StaticFiles` subclass), so a deploy
is picked up when the workbook reopens. Conditional on the directory existing,
like the SPA mount; the first deploy therefore needs one restart.
`excel_static/` is gitignored, like `static/`.

**[build]** `scripts/build-excel.ps1` and `scripts/build-excel.sh`, shaped like
`build-web.ps1`: install npm dependencies when stale, build with an empty API
base (same origin), output into `excel_static/` by a path derived from the
script's location. The build writes the production `manifest.xml` into the
bundle: every URL under a base given as a parameter (default
`https://agg.mynl.com/excel`), and `<Version>` taken from `__version__` in
`src/aggregate_api/__init__.py`, padded to four parts (1.15.0 becomes
1.15.0.0).

**[distribution]** The manifest is served at
`https://agg.mynl.com/excel/manifest.xml`. Excel on the web: Home, Add-ins,
More add-ins, Upload My Add-in. Desktop: the same upload in current Microsoft
365 builds, or a shared-folder catalog. `excel/README.md` gives both.

**[caddy] What the author changes in the `agg.mynl.com` block:**

1. Routing: nothing. `reverse_proxy 127.0.0.1:8001` already carries `/excel/*`.
2. Framing: nothing, as long as no `X-Frame-Options` or CSP `frame-ancestors`
   header is added for `/excel/*`. Excel on the web frames the add-in. Today the
   block sets only `X-Robots-Tag` and `Referrer-Policy`, which are fine.
3. TLS and CORS: nothing. Caddy's automatic certificate is what Office
   requires, and one origin needs no CORS.
4. Rate limits, lowered now the talk is over. The per-session zone already
   suits Excel, because the add-in sends one session id per workbook:

```
zone aggregate_build_minute_by_session {     # unchanged
    key    {http.request.header.X-Aggregate-Session}
    events 30
    window 1m
}
zone aggregate_build_minute_by_ip {
    key         {remote_host}
    events      120                          # was 300
    window      1m
    ipv6_prefix 64
}
zone aggregate_build_hour_by_ip {
    key         {remote_host}
    events      1200                         # was 3000
    window      1h
    ipv6_prefix 64
}
```

5. The `handle_errors` 429 body stays; the add-in shows a short message of its
   own.

**[instance]** On the public instance set `AGGAPI_CACHE_MAX=100` wherever its
environment is configured. The talk hit the 50-entry cap with 99 evictions, and
workbooks add entries. Entries run up to a few MB each (DOOB's status page
estimated 4 MB for one Capstone entry), so check the host's memory.

**[deploy]** On the Linux host, the same way the SPA is deployed: update the
checkout, run `scripts/build-excel.sh`, restart the service the first time.

## Files

- `src/aggregate_api/app.py`: the `/excel` mount and its cache header.
- `scripts/build-excel.ps1`, `scripts/build-excel.sh` (new).
- `excel/`: production manifest template and the build's output path.
- `.gitignore`: `src/aggregate_api/excel_static/`.
- `excel/README.md`: installing from agg.mynl.com.
- `CLAUDE.md`: the Excel build step beside the SPA's.

## Acceptance

- `https://agg.mynl.com/excel/manifest.xml` serves, with `Cache-Control:
  no-cache` on everything under `/excel/`.
- Sideloaded from that manifest, the `plan-excel-core.md` acceptance list passes
  against agg.mynl.com in Excel on the web (Edge and Chrome) and in Windows
  desktop Excel; on Mac desktop if one is at hand.
- `=AGG.VERSION()` matches `https://agg.mynl.com/v1/meta`.
- After a deploy that bumps the version, reopening the workbook shows the new
  version.
- The Caddy limits above are live, and a burst past 30 builds a minute from one
  workbook slows rather than fails (the add-in's retry).

## Not in scope

- A manifest for people running their own server on localhost (desktop only,
  since the web cannot reach localhost). Later, if anyone asks.
- AppSource listing.

## Execution log

Executed 2026-10-16 as **1.17.0**, after `plan-excel-core.md` (1.16.0).

**What was verified here, and what is owed.** Verified: both build scripts produce `src/aggregate_api/excel_static/` with the production manifest (`<Id>` the production one, `<Version>1.16.0.0</Version>` before the bump, every URL under `https://agg.mynl.com/excel`, no `localhost` anywhere, `-Base` honored with or without a trailing slash); a live scratch server serves every file under `/excel/` with `Cache-Control: no-cache`, a missing file there is a JSON 404 rather than the SPA, and `/` still serves the SPA; `tests/test_excel_mount.py`. **Owed, by the author:** [caddy] the two lowered limits, [instance] `AGGAPI_CACHE_MAX=100` (check the host's memory), [deploy] update the checkout, `scripts/build-excel.sh`, restart once; then the whole Acceptance list against agg.mynl.com, which no local check can reach.

Divergences, each recorded as it was made:

1. **[build] The production manifest is written by `excel/webpack.config.js`**, not by the scripts, so the `.ps1` and the `.sh` share one implementation. The scripts pass the base as `AGG_ADDIN_BASE` and the output path as `--output-path`. The transform fails the build if the development manifest stops containing what it rewrites (`https://localhost:3000`, the development id, `<Version>1.0.0.0</Version>`), rather than shipping a half-rewritten manifest.
2. **[build] The production manifest has its own add-in id** (`2ec476d0-...`), so the development add-in and the agg.mynl.com one can be loaded side by side without one replacing the other. Its leading comment is rewritten too; left alone it described a development server at agg.mynl.com.
3. **[mount] Not gated on `serve_spa`.** The mount exists when the directory does, as the plan says; a `--headless` server still serves `/excel` if it was built. `_resolve_excel_dir()` is a module function so the tests can point it at a temporary bundle; there is no new setting.
4. **[mount] `excel_static/` is not in the wheel**, by construction (`package_data` globs only `static/`) and on purpose: its manifest names one deployment.
5. **[distribution] Upload My Add-in takes a file**, so `excel/README.md` says to download the manifest first, and gives the shared-folder catalog route for older desktop builds.
6. **`scripts/build-excel.sh` is committed executable**, unlike `build-web.sh`, so the `./scripts/...` usage line works as written.
7. **`CLAUDE.md`** gains the build step beside the SPA's, and the bump rule that the Excel bundle is rebuilt after a bump that moved `excel/` or is deployed, since the manifest carries the version.
8. **The control list** `T:/worktrees/dev-files.md` does not exist; no row updated.
