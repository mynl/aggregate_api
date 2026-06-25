# Changelog

Running release-notes draft for `aggregate_api`. Newest first. The cadence
mirrors the main `aggregate` project: every plan-based change bumps the
`1.0.0a*` version and adds a section here.

## 1.0.0a13

From `dev/plan-user-facing.md` — rework the SPA landing from an internal tool
into an immediate demo, riding the upstream `aggregate` 1.0.0a113 risk frames.

- **New risk-view endpoints.** `GET /v1/objects/{id}/tail_df` (return-period /
  exceedance table — `p · VaR · TVaR · xsVaR · VaR/Mean`) and
  `GET /v1/objects/{id}/validation_df` (the moment-vs-estimate QA table). Both
  are CSV-downloadable via `/frame/{which}.csv`. A `_resolve_frame` helper calls
  `tail_df` when it is a method (Aggregate / Portfolio) and reads it when it is a
  property (BivariateAggregate), so one route covers both.
- **`/summary` now serves the user risk view.** Upstream repurposed `summary_df`
  in place (moments + percentiles, Freq/Sev/Agg), so the existing route changed
  meaning; the old moment-validation payload moved to the new `validation_df`
  route. Docstrings updated; no path change.
- **SPA: "Description to distribution" landing.** Brand title + one-line subhead;
  a hero gallery of four random group-A showcase examples (the set grows — the
  count is not assumed), one of which auto-builds on load so the page lands fully
  populated with zero clicks. Examples load in the new multiline/spread DecL
  layout (now `format_program`'s default).
- **SPA: Overview tab (new default).** Replaces Info as the landing tab: the
  example's `note` as a lead, an interactive density / exceedance chart (uPlot,
  fed from `density_df` with 1-in-100/200/250 markers off `tail_df`), then the
  `summary_df` and `tail_df` exhibits (the 1-in-200 / 1-in-250 capital rows lit,
  `Agg` / `total` emphasized). Degrades gracefully when an object lacks a frame.
  Info / Summary / Validation / Stats / Density / bs-window move under **More ▾**.
  The matplotlib SVG export stays on the **Plot** tab.

## 1.0.0a12

Batch from `dev/plan-misc-03.md` (gather → review → execute).

- **Examples loader follows `aggregate`'s new statement syntax.** DecL programs
  now separate statements with a blank line or a trailing `;` (line breaks
  replaced the old `\` continuation), so the bundled `examples.agg` is
  semicolon-terminated and writes the portfolios across several indented lines.
  The old loader only folded `\`-continuations and only stripped a `note{...}`
  at the very end of a line, so under the new syntax every multi-line `port`
  (section F) and the `bivariate` example (section H) vanished from the dropdown,
  and every `;`-terminated program lost its `note` and carried a stray
  `note{...};` in its decl. The loader now delegates statement splitting to
  `aggregate`'s own `UnderwritingLexer.preprocess` (so the SPA sees exactly the
  statements the default `build` underwriter does) and runs the item/note
  regexes over those clean statements. The item-keyword set is refreshed for the
  current grammar: `bivariate` / `bv` and `clash` added, the view-pair prefixes
  `grossceded` / `grossnet` added alongside `netceded`, and the retired
  `mv` / `multivariate` keywords dropped.
- **Docs:** `examples.py`'s module docstring and comments now name `examples.agg`
  (the file the loader actually reads) and describe the statement model
  (closes `plan-misc-03` item 4).
- **Bivariate objects replace the `multivariate` vocabulary.** `aggregate`
  renamed `MultivariateAggregate` to `BivariateAggregate` and retired the
  `multivariate` / `mv` keywords in favor of `bivariate` / `bv` (plus `clash`
  and the `netceded` / `grossceded` / `grossnet` occurrence view-pairs). The api
  follows suit: `_classify_object` maps `BivariateAggregate` to a new
  `kind="bivariate"` (replacing `"multivariate"`), `BuildResponse.kind`'s
  `Literal` is updated, and the SPA's kind label / timing word / tab-gating /
  density-fetch switch all key off `"bivariate"`. The reporting surface is
  unchanged — info / summary_df / stats_df / density_df / plot work; price /
  reins / bs-window return a clean 400. **Breaking:** clients that special-cased
  `kind == "multivariate"` must switch to `"bivariate"`. *(Rebuild the SPA bundle
  — `scripts/build-web.ps1` — to ship the frontend half.)*
- **`reins_description` reads the library's string attribute.** `aggregate`
  turned `Aggregate.reins_description` from a method into a plain string
  attribute (e.g. *"Ceded to 100% share of 15 xs 5 per occurrence"*). The
  `reins_description` endpoint returned empty text because it only called a
  *callable*; it now reads the string property directly, so the always-visible
  reinsurance blurb renders again.
- **`describe` → `summary` (object moment table).** `aggregate` renamed the
  object-level `describe` property to `summary_df`. The api endpoint is renamed
  `GET /v1/objects/{id}/description` → `GET /v1/objects/{id}/summary`, the CSV
  download token `describe` → `summary` (`/frame/summary.csv`), and the SPA tab
  is relabeled **Describe → Summary** (tab id `desc` → `summary`, pane
  `pane-desc` → `pane-summary`, `api.description` → `api.summary`). **Breaking:**
  the `/description` path and the `describe.csv` download token are gone — use
  `/summary` and `summary.csv`. *(`reins_describe` / `reins_description` are a
  separate reinsurance surface and are unchanged.)*
- **Build-summary validation reads `validation_explanation`.** `aggregate`
  replaced the `explain_validation()` method with a `validation_explanation`
  string property (e.g. *"not unreasonable"* / *"fails sev mean, agg mean"*).
  `_summary_fields` now reads the property, so the build status line's validation
  chip is populated again instead of going blank.
- **`line` → `unit` and pricing-method signatures (full `aggregate` a76–a84
  surface sweep).** Brought the rest of the API into line with the renamed
  library surface:
  - **kappa plot** keyed off the removed `Portfolio.line_names_ex`; now
    `unit_names_ex`. Without this, every per-unit kappa plot 400'd ("kappa plot
    requires a Portfolio") even for a real Portfolio.
  - **`Portfolio.price_ccoc`** signature changed to `price_ccoc(ccoc, *, p)`
    (arg order swapped, `p` keyword-only). The constant-CoC `/pricing_at` path
    called `price_ccoc(p, ccoc)` → `TypeError`/500; now `price_ccoc(ccoc, p=p)`.
  - **`pricing_at` frame index** renamed `line` → `unit` upstream; the per-row
    breakdown is now keyed `unit` (was a hard-coded `index_name="line"`).
  - Confirmed unchanged-and-working against the new surface: `summary_df`,
    `stats_df`, `density_df`, `bs_window_df` / `_bs_window_df`, `agg_m` /
    `agg_cv`, `price_pentagon(*, p, ROE|LR)`, `calibrate_distortions`,
    `analyze_distortions(*, p).pricing_df`, `distortion_df`, `reins_*`, and the
    `exeqa_*` density columns. New tests cover the two previously-untested
    breakages (Portfolio kappa plot, ccoc `/pricing_at`).
  - The transitional `describe`/`explain_validation`/callable-`reins_description`
    fallbacks added earlier this batch are removed — `aggregate` made clean
    breaks (no aliases), so the API matches the single canonical name.
- **`reins_describe` → `reins_summary_df` (aggregate a85).** The last
  `describe`-verb frame property was renamed to join the `_df` family. The api
  follows: the endpoint `GET /v1/objects/{id}/reins_describe` →
  `GET /v1/objects/{id}/reins_summary_df`, the CSV token / `_CSV_FRAMES` entry
  `reins_describe` → `reins_summary_df`, the reinsurance-availability signal in
  the `reins_description` route now reads `reins_summary_df`, and the SPA Reins
  tab's first sub-button is relabeled **"reins describe" → "reins summary"**
  (`data-reins="reins_summary_df"`, `state.reinsWhich` default). **Breaking:**
  the `/reins_describe` path and `reins_describe.csv` token are gone — use
  `reins_summary_df`. The text blurb endpoint `reins_description` (a string
  property) is unchanged, as are `reins_stats_df` / `reins_density_df`. The
  `BivariateAggregate` reporting redesign (a85: rebuilt `summary_df`, slimmed
  `stats_df`, new `dependency_df`) needs no api change — those frames are
  serialized generically. *(SPA bundle rebuilt.)*
- **Infinite-variance builds return 422 (aggregate a87).** Building an
  infinite-variance aggregate (e.g. `pareto` shape ≤ 2) without an explicit `bs`
  now raises `InfiniteVarianceError` (a `ValueError` subclass) instead of
  silently sizing. The build handler's existing `except ValueError` already maps
  it to a 422 carrying the library's "pass an explicit `bs`" message; a
  regression test pins the behavior.
- **Transformer errors now arrive as plain `ValueError` (aggregate a86).** A bad
  distortion kind (and other transformer `ValueError`s) surface directly rather
  than wrapped in Lark's `VisitError`. The build handler's `except ValueError`
  catches them and still returns 422; the `except VisitError` clause is retained
  as defensive cover for any non-`ValueError` transformer exception. (Test
  comment updated; no behavior change.)

## 1.0.0a11

Punch-ups from the a10 demo pass — two small fixes on top of 1.0.0a10.

- **Build-time semantic errors render legibly in the SPA.** The a10 fix returned
  these as a 422 with a *plain-string* `detail` (e.g. *"Unknown distortion kind
  'dualx'; available: …"*), but the error pane only knew how to render the
  `ErrorReport` *dict* shape, so a string fell through to a generic "Request
  failed". The renderer now shows a string `detail` directly. (Frontend only;
  the backend was already correct.)
- **Density binning uses centered "around xᵢ" buckets.** The 2¹¹ binning now
  labels each coarse node at `i·bs'` (0, bs', 2·bs', …) and sums the fine mass
  in the window *centered* on it — node `i` owns `(i·bs' − bs'/2, i·bs' + bs'/2]`
  (so with `bs'=320` the first row is `0` covering `loss ≤ 160`, the second is
  `320` covering `160 < loss ≤ 480`, …). Masses sum; `loss` takes the node
  center; `F`/`S`/`ex***` take the window right edge, so `F` reads as the running
  cumulative and `F[i] − F[i−1] == p_total[i]` exactly (the native coarse-build
  convention). Still exactly 2048 rows; `p_total` sums to ~1. (Replaces the a11
  right-edge labeling shipped earlier in this section.)
- **Density grid shows all 2048 rows.** CsvGrid's default `renderCap` (2,000)
  truncated the binned grid with a "show all" prompt; the Density pane now sets
  `renderCap: 2048` so the full grid renders directly.
- **Examples loader recognizes more object kinds.** The `GET /v1/examples`
  item parser only matched programs starting with `agg` / `sev` / `port` /
  `dist`, so `pnl`, `mv` / `multivariate`, and `netceded agg …` examples never
  surfaced in the dropdown. The item regex now covers those (the `netceded agg
  X.Name …` two-keyword form included). The bundled `spa_examples.agg` was
  reformatted to the `# <Letter>. <Title>` contents + `<Letter>.<Name>`
  convention so the curated set populates the categorized dropdown.

## 1.0.0a10

Assorted playground tweaks (`dev/done/plan-misc-02.md`) — six small fixes
gathered while demoing the playground.

**Backend**

- **Build-time semantic errors now return 422, not 500.** An unknown distortion
  kind (`dist X pd 0.5`, a `ph`→`pd` typo) is raised *inside* the Lark
  transformer and surfaced as a `lark.exceptions.VisitError`, which fell through
  to the catch-all 500. A new `except VisitError` clause unwraps `.orig_exc` and
  returns 422 with the clean message (*"Unknown distortion kind 'pd';
  available: …"*), rendered legibly in the SPA error pane. The catch-all 500 is
  retained for genuine server bugs.
- **`MultivariateAggregate` objects build.** The `multivariate` / `mv` /
  `netceded` DecL keywords now build and cache as `kind="multivariate"` instead
  of being rejected with "api supports … only; got 'multivariateaggregate'".
  They expose the common reporting surface — Info, Describe, Stats, Density (the
  joint-density matrix), and the native Plot. Pricing, reinsurance, and the bs
  window legitimately return a clean 400 (the SPA greys those tabs out — see
  below). `BuildResponse.kind` widened to include `"multivariate"`.
- **Multi-line input builds without `\`.** The build entry collapses newlines,
  tabs, and `\` line-continuations to single spaces before parsing, so a program
  formatted across several indented lines builds (DecL otherwise treats a bare
  newline as a program separator). Applies before the hints scan, cache key, and
  parse, so cache keys become formatting-insensitive and parse-error carets
  reflect the submitted source.
- **Stats / Reins-stats tables omit raw moments.** The displayed `stats_df` and
  `reins_stats_df` drop the `ex1` / `ex2` / `ex3` rows (E[X], E[X²], E[X³]),
  keeping the human-readable `mean` / `cv` / `skew` (and the `meta` block). The
  full-frame CSV download keeps everything.
- **Faithful power-of-two density binning.** The density display reduction was
  even-spaced row sampling (stride-skip), which understated `p_total` by the
  stride factor (summed to ~0.045 instead of 1). Density / reins-density / kappa
  now bin the full grid to a fixed 2¹¹ = 2048 grid-aligned rows — "as if built
  at a coarser `bs`" — summing the mass columns (`p_*`) and right-edging the
  pointwise columns (`loss` / `F` / `S` / `ex***`). `p_total` is now correct
  (sums to ~1). The full-frame CSV download stays exact / unbinned.

**Frontend**

- **Price defaults bumped** to CoC `0.15` (was `0.10`) and LR `0.90` (was
  `0.70`) — LR is the technical premium ratio (no expenses), so 0.9 is the
  natural default. The `p` default (`0.99`) is unchanged.
- **Tabs grey out, never disappear (house rule).** Tabs that don't apply to the
  built object (Price / Reins / bs window for a distortion or multivariate) are
  now *disabled* (greyed, non-interactive) rather than hidden — the menu set
  stays stable. **Behavior change vs 1.0.0a9**, which *hid* those tabs for
  distortions via `d-none`; that path is retrofitted to the grey-out.
- Multivariate gets its own summary / timing label ("Multivariate"), and its
  Density tab renders the full joint-density frame.

## 1.0.0a9

Make the playground less brittle (`dev/done/plan-misc-01.md`) — five small,
related fixes found mostly while exercising the Price tab and `dist …`. Absorbs
plan-0002 **C1** (standalone Distortions) and **D2** (hints log2 cap).

**Backend**

- **Pricing accepts `p = 1` (max).** `PriceRequest.p` and `PricingRequest.p`
  relaxed from `(0, 1)` to `(0, 1]` (`lt=1` → `le=1`). On a *bounded*
  distribution `p=1` resolves to the finite max of support via the lower
  quantile — the motivating use case (bounded distortions). On an unbounded one
  it returns the last grid bucket, so it's grid-dependent there.
- **Standalone `Distortion` objects build.** `dist MYD ph 0.5` (and every other
  `Distortion` subclass) now builds and caches as `kind="distortion"` instead of
  being rejected with "api supports 'agg' and 'port' only". Distortions expose
  the common reporting surface — Info, Describe, Stats, Density (the g-curve over
  x∈[0,1]), and the native Plot all work. Pricing, reinsurance, and the bs window
  legitimately return a clean 400 (the SPA hides those tabs — see below).
- **`log2` cap enforced against `hints{}`.** `AGGAPI_LOG2_CAP` (default 18) was a
  request-only guard; a program could dodge it with an embedded
  `hints{ log2=24 }` clause. A static pre-build scan now folds any `hints{}`
  `log2` into the cap check (effective = max(request, hint)); over-cap → 422
  naming the effective `log2`. `bs` and every other hint pass through untouched —
  the guard only vetoes an over-cap `log2`, it never rewrites the program.

**Frontend**

- **FastAPI 422 validation errors render legibly.** A Pydantic rejection (bad
  `p`, over-cap `log2`, malformed `bs`) used to surface as a bare "HTTP 422"; the
  error pane now maps the `detail` array to `"<field>: <msg>"` (e.g.
  *"p: Input should be less than or equal to 1"*). General — covers every
  validated endpoint.
- **Distortion-aware UI.** Summary line and timing label say "Distortion"; the
  Density tab pulls the whole g-curve frame (no `loss,p_total,F,S` columns to
  request); Price / Reins / bs-window tabs are hidden for a distortion (and
  re-shown for agg / port) so they can't be clicked into a guaranteed 400.
- **csv-grid version in the header.** The top-right line now reads
  `… · api <ver> · grid <ver> · docs · …`. The version is a build-time constant
  (Vite `define` reads `csv-grid`'s `package.json`), not an api/meta field — the
  backend has no knowledge of which `csv-grid` the SPA bundled.

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
