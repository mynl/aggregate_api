# Changelog

Running release-notes draft for `aggregate_api`. Newest first. The cadence
mirrors the main `aggregate` project: every plan-based change bumps the
`1.0.0a*` version and adds a section here.

## 1.0.0a8

CsvGrid polish (follow-up to a7). No backend changes.

- **Force grids to light mode.** CsvGrid auto-follows the OS via
  `prefers-color-scheme`, so on a dark-mode browser the grids rendered dark while
  the (light-only) SPA around them stayed light. `mountGrid` now sets
  `data-theme="light"` on every grid host to opt out. A real SPA-wide dark mode
  is intentionally out of scope (it would also need dark plots — a whole thing).
- **Describe loses its per-column filter row** (kept the global fzf search bar):
  the frame is narrow enough that the column filters were just noise.

## 1.0.0a7

Adopt **CsvGrid** for every table in the SPA (`dev/done/plan-grid.md`). No
backend changes — the `FrameResponse` `{columns, rows}` shape is unchanged and
maps straight onto CsvGrid `records`.

**Frontend — one grid everywhere**

- **All output tables now render through CsvGrid** (`mynl/CSV_Viewer`, git
  dependency) instead of the hand-rolled `.tbl` renderer: Describe, Stats,
  Density, bs window, the three Reins frames, and the Price set (pentagon,
  calibrated distortions, and the LR/P/PQ/ROE distortion slices). Substantive
  frames get click-to-sort, fzf-style global search, and per-column filters;
  the small 3–8 row frames (bs window, pentagon, distortion slices) keep sort
  but strip the search/filter chrome. The Price-stat slices keep their exact
  formatting via CsvGrid per-column `formats` (`.1%`, `,d`, `.3f`, `.0%`).
- **Density preview lifted** from 300 to 2 000 server-downsampled rows, shown in
  a bounded 25-row scroll viewport (CsvGrid lazy-formats and caps the DOM at its
  render cap). Full-frame `{url}` + worker parsing remains a future option — the
  Vite build already emits a correctly-pathed worker asset; we ship with
  `worker: false` for determinism until it is browser-verified.
- **Teardown lifecycle** (`web/src/grid.js`): CsvGrid instances are tracked per
  pane and `destroy()`ed on re-render and on rebuild, so listeners (and any
  future worker) don't leak.
- **Dead code removed:** `web/src/actions.js`, `pricing-pane.js`, `plot-pane.js`
  (an unimported pre-redesign action layer), the `renderTable` /
  `renderFrameTable` / `renderBuildBanner` renderers, the dense `.tbl` styles,
  and the stale pre-redesign `web/public/index.html`.

**Deployment note**

- The new `csv-grid` git dependency is fetched at `npm install`. npm rewrites
  the lockfile's `resolved` URL to `git+ssh://` regardless of the `git+https`
  spec; the repo is public, so the VPS build host needs either GitHub SSH access
  or `git config --global url."https://github.com/".insteadOf "git@github.com:"`.
  Pinned to commit `6033b20` (csv-grid 3.1.0) via the lockfile.

## 1.0.0a6

Installable PWA (`dev/plan-pwa.md`, Phase B). No backend changes.

**Frontend — PWA**

- **Completed the web app manifest** (`web/public/site.webmanifest`): real
  `name` / `short_name` / `description`, `start_url` and `scope` of `/`,
  `display: standalone`, and a white `theme_color` matching the header (also
  added as `<meta name="theme-color">`). Icons kept `purpose: "any"` — the logo
  runs edge-to-edge with no maskable safe zone, so claiming `maskable` would crop
  it on Android; a padded maskable variant is future polish.
- **Service worker** (`web/public/sw.js`, served at `/sw.js`, scope `/`):
  deliberately minimal — it exists to make the SPA installable and to speed
  repeat loads, not for offline use (a build requires the backend). `/v1/*` is
  **never** cached (network-only); HTML navigations are network-first (so a
  redeploy is picked up); content-hashed assets are cache-first; old caches are
  purged on `activate`. Registered from `main.js` in the **production bundle
  only** (so it never intercepts the Vite dev server) and only in a secure
  context.

**Deployment — retire the `/Q7M4Z9KP` obscured prefix (Phase A, operational)**

- The PWA is only clean at an origin **root**, so the deploy moves off the
  obscured `www.mynl.com/Q7M4Z9KP/` subpath to a dedicated **`agg.mynl.com`**
  subdomain (same-origin api, so the SPA builds with **no** `-ApiBase`). The
  prefix strip used to hide `/docs` by accident; the new Caddy block does it
  **explicitly** (`respond /docs … 404`) while keeping `/v1/*` open and the
  build rate-limit in place. Full DNS + Caddy + `refresh.sh` cutover steps are in
  `dev/plan-pwa.md`; these are server-side and applied at deploy. `build-web.ps1`
  usage notes trimmed to the same-origin default.
  - **Sequencing:** do the subdomain cutover **before** deploying this bundle —
    under the old `/Q7M4Z9KP/` subpath the manifest `start_url`/`scope` and the
    `/sw.js` registration resolve to the wrong path and the PWA simply won't
    activate (no breakage, just inert). It works at `localhost` root today.

## 1.0.0a5

Two small, client-only SPA additions (`dev/plan-help.md`,
`dev/plan-ui-enhancements-01.md`). No backend changes.

**In-SPA help (plan-help)**

- **Always-visible `?` in the header** (after `docs · github`) opens a right-side
  Bootstrap **offcanvas** quick-help panel: a one-line intro, a paste-ready
  example with a **Load it** button (drops it into the editor via the same
  `format_program`-normalized path as the Examples dropdown), the key bindings
  (incl. `↑↓` history and `Alt+↑↓` examples), a one-line guide to the Build /
  Examples / log2 / bs controls and every output tab, doc links, and the
  fair-use note tying into the rate-limit card. Static content; only **Load it**
  is interactive (closes the panel and refocuses the editor).

**Phone-friendly form inputs (plan-ui-enhancements-01)**

- **No iOS zoom-on-focus:** the Price form inputs (`#price-p`,
  `#price-target-val`) and the custom-bs input (`#bs-custom`) bump to 16px on
  phones (≤575.98px) so focusing them no longer magnifies the layout. Desktop
  keeps the tighter `.78rem`.
- **No AutoFill bar:** those inputs get `autocomplete="off"` (and
  `autocorrect`/`autocapitalize="off"` on the text `#bs-custom`) to suppress the
  iOS key/credit-card accessory bar. `#bs-custom` keeps `type="text"` (it accepts
  fractions like `1/64`) and intentionally takes **no** `inputmode` so the `/`
  key stays available.

## 1.0.0a4

In progress (`dev/plan-0002.md`). Iterating on the SPA via
`hacks/mockup-08.html`, then porting agreed changes here.

**Frontend — layout (plan-0002 step 1)**

- **Tab bar reorg:** the output tabs are now `Info · Describe · Plot · Price ·
  Reins · More`, where **More** is a dropdown holding `Stats · Density ·
  (reserved)`. Stats moved off the top row to bound its width; a new **Density**
  tab is stubbed (a placeholder pane; wired to `density_df` in step 2). The tab
  wiring in `main.js` now selects triggers by `[data-tab]` rather than
  `.nav-link` so the dropdown items lazy-load like the top-level pills.
- **Phone-fit button row:** on extra-small screens the live `log2` / `bs`
  values and the *Examples* label collapse (icon/label only); the values still
  show from ≥sm and inside the dropdowns.

**Frontend — editor + data panes (plan-0002 step 2)**

- **Editor selection fixed:** dropped `drawSelection()` in favor of the
  browser's native selection. The opaque active-line highlight was painted over
  drawSelection's (behind-the-text) selection layer, so double-click-word and
  shift-arrow selections were invisible; native selection paints on top.
- **Real kill/yank:** CM's bundled `emacsStyleKeymap` binds Ctrl-K to a
  delete-only command and leaves Ctrl-Y unbound. Added a small kill-ring so
  Ctrl-K stores (line-end or active selection) and Ctrl-Y yanks.
- **↑/↓ history:** plain Up/Down now navigate build history at the buffer edges
  (and no longer reset the history cursor), matching the feedback-line hint;
  Ctrl-↑/↓ still work mid-buffer.
- **Density pane** (under **More**): wired to `density_df` with the SPA default
  `loss · p_total · F · S`, `nonzero` (p_total>0) filter, and a ~300-row
  downsample; full frame via the CSV button.
- **bs window pane** (under **More**): the bucket/window estimator summary
  (`_bs_window_df`), with the `selected` row marking the chosen grid.
- **Example standardization:** picking an Example now runs it through
  `format_program` (new `POST /v1/decl/format`) so the editor shows canonical
  DecL; the raw text shows instantly and is replaced when the format returns.
- **Friendly rate-limit card:** a build that hits the public demo's per-IP
  build cap (HTTP 429) now shows a warm "shared, free resource" card (with a
  Retry-After hint and a "run it locally" link) instead of a raw error.
  `ApiError` carries `retryAfter`; the card lives in `error-pane.js`.

**Backend (plan-0002 step 2)**

- `GET /v1/objects/{id}/density_df` gains a `nonzero` flag (drop zero-mass rows
  before slicing).
- `GET /v1/objects/{id}/bs_window_df` — new; serves the private `_bs_window_df`
  frame (400 when absent, e.g. on a Portfolio). Added to the `/frame/*.csv` map.
- `POST /v1/decl/format` — new; canonicalizes a DecL program via
  `aggregate.decl_writer.format_program`, echoing the input unchanged on any
  parse/format failure (best-effort, never 500s).
- **Curated Examples via env:** `AGGAPI_EXAMPLES_FILE` points the Examples
  dropdown at a custom `.agg` file (same `# A. Title` + `agg A.Name …` format),
  falling back to the bundled `spa_examples.agg`. Runtime-fetched, so swapping
  the file needs only a server restart — no SPA rebuild.

**Price tab (plan-0002 step 3)**

- New `POST /v1/objects/{id}/price` — `price_pentagon(p, ROE=coc | LR=lr)`
  returns the one-row `[L, M, P, Q, a, LR, PQ, ROE]` completion for an
  Aggregate *or* Portfolio. For a Portfolio it also calibrates distortions to
  the pentagon's CoC at the same `p` and runs `analyze_distortions(p)`,
  surfacing the `LR / P / PQ / ROE` slices of `pricing_df` (per distortion ×
  unit + total). Skipped distortions (e.g. mass/ccoc on an unbounded
  portfolio) come back as `warnings`, not errors.
- The **Price** tab is now a live form (p + CoC/LR), replacing the
  placeholder. The pentagon renders for any object; Portfolios additionally
  show the calibrated-distortions detail (`distortion_df`, one row per
  ccoc/ph/wang/dual/tvar) directly below the pentagon, then the four stacked
  distortion tables, formatted per stat (LR/ROE as percents, P
  thousands-grouped, PQ to 3 dp). `renderFrameTable` gained an optional
  per-cell formatter. `/price` is intentionally not rate-limited.

**Build summary (plan-0002 step 3)**

- The summary line now shows the **resolved bucket size** —
  `name · kind · bs = 1/64 · mean … · CV …` (sub-unit bs rendered as a
  power-of-two fraction). `BuildResponse` carries `bs` (the library's auto-pick
  when the request said "auto").
- A **timing sub-line** under the summary: `Calculated aggregate in 0.000
  seconds` (or "Loaded … from cache"), from the existing `elapsed_ms`.

**Frontend — mobile (plan-0002 step 2)**

- **No more iOS zoom-on-tap:** the editor text is bumped to 16px on phones
  (≤575px) so Safari stops magnifying the page when the editor is focused;
  desktop keeps 14px.
- **Tab row fits a phone:** the output pills get tighter padding on ≤575px so
  `Info · Describe · Plot · Price · Reins · More` stays on one line.
- **Editor floor of ~3 lines:** the editor never shrinks below ~3 text lines
  (`min-height: 4.5em`, font-relative) and grows with content as before.
- **No iOS AutoFill bar:** the editor's contenteditable is marked
  `autocomplete/autocorrect/autocapitalize=off, spellcheck=false`, which (on
  iPhone) suppresses the Passwords/Payment accessory bar above the keyboard and
  stops autocorrect mangling DecL keywords.
- **Undisclosed example browsing:** **Alt-↑/↓** steps through the whole example
  library into the editor (format-standardized, wrap-around), seeded from
  `/v1/examples` — separate from build history, not shown in the UI.

## 1.0.0a3

SPA editor fix and look-and-feel redesign (`dev/plan-ui-enhancements.md`). The
DecL playground now mirrors the **archivum** visual language (one UI font,
dense booktabs tables, blue accent, sticky header) and a `nav-pills` tabbed
output. Backend grows native plotting and per-tab data endpoints.

**Frontend**

- **Tamed autocomplete:** completion is now manual-trigger only
  (`activateOnTyping: false`); the per-keystroke `/v1/decl/complete` round-trip
  is gone (`completion.js` only calls the network on an explicit Ctrl-Space).
  This restores smooth typing, selection, and clipboard behavior.
- **Emacs editing keys:** optional `emacsStyleKeymap` (Ctrl-A/E/K/Y/N/P/F/B/D)
  behind a feedback-line switch, swapped at runtime via a CM6 `Compartment` and
  persisted in `localStorage`.
- **Redesign:** rebuilt `index.html` + `styles/site.css` from
  `hacks/mockup-07.html` — header with logo + versions, rounded editor box with
  focus glow and clear-X, mono feedback line, `Build / Examples / log2 / bs`
  button row, a one-line **build summary** (`name · kind · mean · CV ·
  validation`, overflow-only ⌄ expander), and the `Info · Describe · Plot ·
  Stats · Reins · Price · More` tab bar. Tabs fetch their data lazily and cache
  per built object. Price / More are placeholders.

**Backend**

- **Native plot:** `GET /v1/objects/{id}/plot` defaults to `kind=native`,
  rendering the object's own multi-panel `.plot()` figure (captured from
  `obj.figure`). The legacy `density|cdf|qq|kappa` single-panel renderers are
  retained for backward compatibility.
- **Reinsurance endpoints:** `reins_description` (text block, `available` flag),
  `reins_describe`, `reins_stats_df`, and `reins_density_df` (the density frame
  is filtered to `p_total > 0` then downsampled to ~20 rows for preview). All
  getattr-gated → a clean 400 ("no reinsurance on this object") rather than 500.
- **CSV download:** `GET /v1/objects/{id}/frame/{which}.csv` returns the full
  frame (describe / stats_df / density_df / reins_*) for "save the real data".
- **Build summary fields:** `BuildResponse` now carries `mean`, `cv`, and
  `validation` (from `agg_m` / `agg_cv` / `explain_validation()`) for the SPA's
  one-line summary.

**Notes**

- The "sev stats" sub-button was dropped: no clean `sev_stat_df` accessor exists
  upstream; the Stats tab shows `stats_df` (which already carries the Freq / Sev
  / Agg breakdown). Revisit if a dedicated severity-stats view is wanted.
- The SPA bundle now vendors Bootstrap Icons via npm (no runtime CDN).

## 1.0.0a2

Bootstrap the standalone package (`dev/plan-0001-bootstrap-standalone.md`). The
1.0.0a1 verbatim copy now imports, runs under uvicorn, serves the SPA, and
passes the suite.

- Wired the `aggregate` dependency to a local editable checkout
  (`[tool.uv.sources]` → `../aggregate_REFACTOR`), where the `parser_errors` /
  `parser._PARSER` internals the api needs live.
- Rewrote the `aggregate.api` → `aggregate_api` self-references: the uvicorn
  target in `__main__.py`, the OpenAPI `version` in `app.py`, the test imports
  (`conftest.py`, `test_objects.py`, `test_cors.py`), and cosmetic docstrings /
  comments across the package.
- **Version reporting:** `GET /v1/health` and `GET /v1/meta` (and the OpenAPI
  `version` field) now report the api's own version, plus a new
  `aggregate_version` field carrying the wrapped library version.
  `HealthResponse` / `MetaResponse` gained the `aggregate_version` field.
- Pointed the web build output at the renamed package: `web/package.json`,
  `web/vite.config.js`, and the `scripts/build-web.{ps1,sh}` headers now target
  `src/aggregate_api/static/`.
- **Parse-error path fix:** tracked an upstream `aggregate` change — a DecL parse
  failure now attaches its structured `ErrorReport` as `exc.report` and raises
  with `from None` (empty `__cause__`) rather than chaining the Lark
  `UnexpectedInput`. `routes/objects.py` now recognizes a parse error by either
  convention, so parse errors again audit as `parse_error` and return HTTP 422
  with the structured report (was misclassifying them as `build_error` with a
  flat string body).

## 1.0.0a1

Initial extraction and scaffolding.

- Extracted the FastAPI service and web SPA verbatim from the `aggregate` repo
  (last good state: commit `6f828ce`, before the `473bcd8` deletion) into a
  standalone project.
  - Python backend: `src/aggregate_api/` (was `src/aggregate/api/`) and its
    `routes/` + committed `static/` icons.
  - Web SPA: `web/` (Vite + Bootstrap 5 + CodeMirror 6), verbatim.
  - Tests: `tests/` (was `tests/api/`), verbatim.
  - Build scripts: `scripts/build-web.{ps1,sh}`, verbatim.
- Added project scaffolding: `pyproject.toml` (package `aggregate_api`, console
  script `aggregate-api`, `aggregate` as a dependency), `.gitignore`,
  `README.md`, `CLAUDE.md`, this `CHANGELOG.md`, and `dev/TODO.md`.

**Not yet runnable.** This release is a faithful copy in the new layout; the
package directory was renamed to `aggregate_api` but file *contents* are
unchanged, so internal `aggregate.api` self-references and the web build's
output path still point at the old location. `dev/plan-0001-bootstrap-standalone.md`
makes it import, run, and pass tests (→ 1.0.0a2).
