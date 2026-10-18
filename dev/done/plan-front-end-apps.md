# Plan: serve other front ends ("apps") from aggregate-api

**Status: ruled 2026-10-18, ready to execute on the author's go.** Tracked as `[Front-End-Apps]` in `dev/TODO.md`. Paired with `V:/dev/aggregate-asp/dev/plan-serve-from-aggregate-api.md`, aSP's half. Each repo's plan states its own side, and this side lands first. The author ruled on 2026-10-18 that both land ahead of `[Sheets-Template]`.

## Rulings, 2026-10-18

The choices below are decisions, not proposals.

- **The Apps group sits above Help** in the hamburger menu ([apps-menu]).
- **A bad `AGGAPI_APPS` entry is skipped with a WARNING and the server starts anyway**, the plugins' rule ([apps-module]).
- **The All rows menu item is shortened** to the label *All rows* over the muted line *scroll to read* ([all-rows-label]). The author's ask, folded into this plan's bump.

## Goal

aggregate-api (aLL) serves other front ends from their own repositories, each at `/<name>/` on the same origin as the API. The first is aSP, the agg Structure Pentagon (`V:/dev/aggregate-asp`), at `https://agg.mynl.com/asp/`. Adding an app means adding one `name=folder` entry to `AGGAPI_APPS` and restarting: no rebuild, and no change to aLL's code. The playground's menu lists whatever apps are mounted, so the site itself shows that one engine has several front ends. That illustration is half the point; the other half is that aSP is useful in its own right.

## Background, for a reader without context

- **What aLL serves today.** The API under `/v1`, Swagger at `/docs`, the Excel add-in at `/excel` (built by `scripts/build-excel.ps1` into `src/aggregate_api/excel_static/`, served with `Cache-Control: no-cache` by `_NoCacheStaticFiles` in `app.py`), and the playground SPA at `/` (built from `web/` into `src/aggregate_api/static/`). Starlette matches mounts in order, and `/` with `html=True` answers anything unmatched, so every other mount goes before it (`app.py`, around line 212).
- **What aSP is.** A static single-page app with no build step: `index.html`, `style.css`, `config.js`, `js/*.js` as ES modules, favicons and a logo, every path relative. Every number comes from aLL over `/v1`. Today it runs on its own static server (`serve.ps1`, port 8300) and finds the API at the page's host on port 19456, which needs `AGGAPI_CORS_ORIGINS` set on aLL. Its half of this work makes it same origin by default.
- **The parallel with plugins.** aLL already has extensions: `aggregate.plugins`, Python packages found through entry points, admitted by `AGGAPI_PLUGINS_ALLOW`, reported on `/v1/meta` (`_load_plugins` in `app.py`, `_plugin_manifest` in `routes/meta.py`). Plugins extend the engine. Apps extend the front: static files, admitted by a mapping. In both, the deployment declares what it trusts.

## The change

### [apps-setting] `AGGAPI_APPS`

`config.py` gains `apps_raw: str = Field(default="", validation_alias="AGGAPI_APPS")` and a property `apps -> list[tuple[str, str]]`, in the pattern of `cors_origins` and `plugins_allow`: comma-separated `name=folder` pairs, whitespace trimmed, empty means none. For example:

```
AGGAPI_APPS=asp=V:/dev/aggregate-asp
AGGAPI_APPS=asp=/srv/aggregate-asp, demo=/srv/agg-demo
```

An environment variable, because a folder is a machine-specific location, and the dev tree's rule puts those in the environment. A folder whose path contains a comma cannot be named; the README says so.

### [apps-module] `src/aggregate_api/apps.py` (new)

- `App`, a frozen dataclass: `name`, `title`, `description`, `directory`.
- `discover(pairs, reserved) -> list[App]`. For each pair, in order:
  - the name must match `^[a-z][a-z0-9-]{0,31}$`, which also rules out every file name with a dot;
  - the name must not be reserved: `v1`, `excel`, `docs`, `redoc`, `assets`, `dev`, `static`, plus every top-level entry in the SPA bundle directory when it exists;
  - the name must not repeat an earlier one;
  - the folder must exist and hold `index.html`;
  - `app.json` in the folder is optional: `{"title": "...", "description": "..."}`, both optional strings. The title defaults to the name, and the description to empty. A file that does not parse is treated as absent.
- **A rejected entry is logged at WARNING and skipped, and the server always starts.** That is the plugins' rule ("one broken experiment must not take the server down"). The log line names the entry and the reason. Nothing about a rejection reaches `/v1/meta`, which is public and would otherwise publish folder paths.

### [mount] `app.py`

After the `/excel` mount and before `/`: for each discovered app, `app.mount(f"/{name}", _NoCacheStaticFiles(directory=..., html=True), name=f"app-{name}")`. Store the list on `app.state.apps`. As with `/excel`, not gated on `serve_spa`, so a `--headless` server still serves its apps. `no-cache` means an edit to an app's files shows on the next reload without a restart. `html=True` serves `index.html` at `/<name>/`, and Starlette redirects `/<name>` to `/<name>/`, which the relative paths inside the app need.

### [meta] `/v1/meta` lists the apps

`MetaResponse` gains `apps: list[AppInfo] = []`, where `AppInfo` is `name`, `title`, `description` and `url` (`/<name>/`), never the folder. `meta()` takes the `Request` to read `request.app.state.apps`. It stays `async def` with no dependency, for the reason its docstring gives.

### [apps-menu] the playground's Apps menu

`web/index.html` gains an **Apps** group in the hamburger menu, above Help: a header, one item per app, and a divider, all hidden when `meta.apps` is empty. Each item is a link to the app's `url` in the same tab, with the title as the label and the description as the muted second line, which is the form the Tables items already use. Rendered by a pure function in a new `web/src/apps-menu.js`, called from the meta handler in `main.js` beside `installPlugins` (around line 5337).

### [service-worker] stop the playground's worker caching other front ends

`web/public/sw.js` serves every same-origin GET outside `/v1/` cache-first, and its scope is the whole origin. aSP's files are not content-hashed (`js/main.js` is `js/main.js` in every version), so in any browser that has opened the playground, the worker would pin the first aSP it ever saw. `no-cache` cannot help, because the worker answers before the HTTP cache is consulted. The same holds for `/excel/` in a browser where the playground's worker controls it.

- The worker handles only the SPA's own paths: a top-level file (`/index.html`, `/lite.html`, the icons, `/site.webmanifest`), `/` itself, and `/assets/*`. Everything else passes through, `/v1/` included. The rule is a named function, `isShellPath(pathname)`, so it can be tested.
- `CACHE_VERSION` moves from `agg-pwa-v2` to `agg-pwa-v3`, so a returning browser drops whatever the old rule cached.

### [all-rows-label] shorten the All rows menu item

Unrelated to apps, and carried here because it is one string. In `web/index.html` (around line 143), the Tables group's checked item reads **All rows in density tables** over the muted line *every row of density_df, scroll to read*. It becomes **All rows** over *scroll to read*. Nothing else changes: the `data-density-rows` attribute, the Ctrl+Shift+A shortcut, and the shortcut's line in the keyboard help (which still says what the toggle covers). No test reads either string.

### [docs]

- `README.md`: a short "Serving other front ends" subsection after "Running headless", covering `AGGAPI_APPS`, `app.json`, the name rules, restart to add, reload to update.
- `CLAUDE.md`: an `apps.py` row in the backend module table.
- `CHANGELOG.md`, `dev/TODO.md`, `__init__.py`.

## Trust, noted

An app runs on the playground's origin. Its scripts can call `/v1` as the visitor and can read the playground's `localStorage` and `sessionStorage`, which hold preferences and a session id, nothing secret. So an app is fully trusted, exactly like a plugin, and `AGGAPI_APPS` should name only the author's own repositories. The README says so in one line.

## Costs, noted, not addressed here

aSP builds on every settled edit, two POSTs when only the reinsurance changes (its client caches the bare build by program text), and pulls a structure chart document of about 790 KB at log2 16 (`aggregate-asp/dev/TODO.md`, [Grid-Validation]). On the public server that means more cache entries, so more evictions of the playground's and the spreadsheets' objects (the public `/v1/meta` reports `cache_max` 50; `[Excel-Store]` owes the move to 100), and more bandwidth. Every client rebuilds what it loses, so nothing breaks. Watch `/v1/status` after the launch, and raise the cache size if evictions climb.

## Files

- `src/aggregate_api/config.py`: `apps_raw`, `apps`
- `src/aggregate_api/apps.py`: new
- `src/aggregate_api/app.py`: the mounts, `app.state.apps`
- `src/aggregate_api/models.py`: `AppInfo`, `MetaResponse.apps`
- `src/aggregate_api/routes/meta.py`: `apps` on meta
- `web/index.html`, `web/src/apps-menu.js` (new), `web/src/main.js`: the Apps menu; `web/index.html` also carries [all-rows-label]
- `web/public/sw.js`: `isShellPath`, `CACHE_VERSION`
- `tests/test_apps_mount.py` (new), `web/test/apps-menu.test.js` (new), `web/test/service-worker.test.js` (new)
- `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `dev/TODO.md`, `src/aggregate_api/__init__.py`

## Tests

`tests/test_apps_mount.py`, in the shape of `tests/test_excel_mount.py`: a stand-in app in `tmp_path` (an `index.html`, a `js/main.js`, an `app.json`), `AGGAPI_APPS` and `AGGAPI_AUDIT_DB` set by `monkeypatch`, `get_settings.cache_clear()` around it.

1. `/demo/` serves `index.html`, and `/demo/js/main.js` serves, both with `Cache-Control: no-cache`.
2. `/demo` redirects to `/demo/`.
3. A missing file under `/demo/` is a 404, not the SPA.
4. `/v1/meta` lists `{name, title, description, url}` from `app.json`; with no `app.json`, the title is the name. No field holds the folder path.
5. Skipped, server still up, a WARNING logged (`caplog`), and absent from meta: a reserved name (`v1`), a bad name (`My App`), a duplicate, a missing folder, a folder without `index.html`, a malformed pair (`asp`, no `=`).
6. With `AGGAPI_APPS` unset, meta's `apps` is `[]` and no `app-` route exists.

`web/test/apps-menu.test.js`: the renderer gives one link per app with title and description, escapes both, and gives nothing for an empty list. `web/test/service-worker.test.js`: loads `sw.js` into a `node:vm` context with a stub `self`, and checks that `isShellPath` admits `/`, `/index.html`, `/favicon.ico` and `/assets/index-abc.js`, and refuses `/v1/meta`, `/asp/`, `/asp/js/main.js` and `/excel/manifest.xml`.

## Acceptance

- `uv run --no-sync pytest` and `cd web; npm test` pass.
- Locally, against a scratch server (`AGGAPI_AUDIT_DB` pointed at scratch) with `AGGAPI_APPS=asp=V:/dev/aggregate-asp`: `/asp/` loads aSP, the playground's menu shows Apps with aSP in it, and the link opens it. Until aSP's half lands, aSP looks for the API on port 19456, so pass `?api=` with the server's own origin to see it compute.
- The Tables group's item reads **All rows** over *scroll to read*, and still toggles both density tables.
- In a browser that already had the playground's old worker: after one visit to the playground, `/asp/` is served from the network (DevTools, Network, not "from ServiceWorker").
- On agg.mynl.com, after the author's deploy and aSP's half: `https://agg.mynl.com/asp/` works end to end, and `curl -I https://agg.mynl.com/asp` redirects to an `https://agg.mynl.com/asp/` location (the proxy headers carry the scheme and host through).

## Deploy (the author's)

- **DOOB.** In the great-servers entry in `~/.great-servers/servers.yaml`, add `AGGAPI_APPS: asp=V:/dev/aggregate-asp` to the environment, rebuild the SPA (`.\scripts\build-web.ps1`) and restart. aSP is then at `http://10.8.0.8:19456/asp/`, and its own server on 8300 and the CORS setting for it are no longer needed.
- **The public host.** Clone `aggregate-asp` beside the `aggregate-api` checkout, add `AGGAPI_APPS=asp=<that folder>` to the service's environment, update the aLL checkout, run `scripts/build-web.sh`, and restart. Later aSP deploys are a `git pull` in its checkout.
- **Caddy: nothing.** The block already proxies every path to aLL, sets no framing headers, and keys the per-session limit on `X-Aggregate-Session`, which aSP's half starts sending.

## Version

A feature, so a minor: **1.27.0**, one commit, `[1.27.0] serve front-end apps named in AGGAPI_APPS, with an Apps menu`. The SPA moved, so `.\scripts\build-web.ps1` runs after the commit.

## Alternatives considered

- **Caddy serves the folder** (`handle_path /asp/* { root ...; file_server }`). No aLL code, but only on the public host. DOOB would keep the separate server and CORS, and the playground could not list the apps.
- **Entry points, like plugins.** aSP has no Python, so it would need packaging solely to ship static files. Ceremony for no gain.
- **Copying aSP into this repo**, as `excel/` is. It would couple the two release cycles and break aSP's own rule that the only boundary is HTTP.
- **A JSON mapping in the variable.** Quoting JSON inside YAML and service files is error prone; `name=folder` pairs match the other list settings.

## Later, not this plan

- The front-ends gallery on `help.html` (playground, Excel add-in, Sheets template, aSP), when `[Excel-Store]`'s [store-pages] writes that page.
- An icon per app in `app.json`, if the menu wants one.

## Execution log

Executed 2026-10-18 as **1.27.0**, one commit, against `1.26.1` (`ffcf65a`), `aggregate` 1.5.2 from the worktree.

### Divergences

- **[mount] `/<name>` does not redirect by itself; an explicit redirect route does it.** The plan says Starlette redirects `/<name>` to `/<name>/`. It does only when no route matches, and the SPA's `/` mount matches every path, so with the bundle present (production, and this checkout) `/demo` was a plain 404. Probed at review with two bare `StaticFiles` mounts: 307 without the SPA mount, 404 with it. Each app therefore gets a `GET /<name>` route, registered before `/`, answering 307 with a **relative** `Location: /<name>/` that keeps the query string, so `/asp?api=...` arrives at `/asp/?api=...`. Relative rather than absolute, so the scheme and host behind a proxy cannot be got wrong; on agg.mynl.com `curl -I .../asp` shows `location: /asp/`, which resolves to the acceptance's `https://agg.mynl.com/asp/`. Test 2 stands as written and passes with or without the bundle.
- **[service-worker] `/openapi.json` is not a shell path.** The plan's "a top-level file" would admit it, since it is a dotted name at the root, and the worker would then serve Swagger a cache-first schema from whichever process it first saw. `isShellPath` excludes it by name; the test refuses it and `/docs` along with the plan's list.
- **No `dev-files.md` row.** The project's execute-plan skill names `V:/worktrees/dev-files.md` as the control list; the file does not exist on DOOB. Nothing to update.

### Verification

- `uv run --no-sync pytest`: 636 passed (`tests/test_apps_mount.py` 12 of them, the plan's six cases plus manifest variants, a headless server, and the bundle's reserved entries). `cd web; npm test`: 329 passed (`apps-menu.test.js` 4, `service-worker.test.js` 4, the latter also driving the fetch listener for a pass-through and pinning `agg-pwa-v3`).
- Scratch server, `AGGAPI_APPS="asp=V:/dev/aggregate-asp, v1=V:/dev/aggregate-asp"`, scratch `AGGAPI_AUDIT_DB`: `/asp` 307 to `/asp/` (and `/asp?api=http://x` to `/asp/?api=http://x`); `/asp/` 200 with `no-cache`; `/asp/js/api-adapter.js` 200; `/asp/nope.js` 404; meta `apps` is `[{"name":"asp","title":"asp","description":"","url":"/asp/"}]` (title is the name until aSP's half adds `app.json`); the log carries `app 'v1=V:/dev/aggregate-asp' skipped: the name is reserved by this server`.
- Left for the author's tire kicking, being browser checks: the Apps menu in the rebuilt page and its link, the All rows label, and `/asp/` arriving from the network rather than the old worker after one visit to the playground.
