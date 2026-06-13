# plan-grid — replace SPA table grids with CsvGrid

Status: **LANDED (1.0.0a7).** What shipped vs. the plan below:

- **Dep (Decision 1):** `git+https://github.com/mynl/CSV_Viewer.git`, pinned by
  the lockfile to commit `6033b20` = **csv-grid 3.1.0** (the repo moved past the
  3.0.7 the plan named; 3.1.0 is a superset, adding the `maxRows` bounded
  viewport now used by Density). npm rewrites the lock's `resolved` to
  `git+ssh://` regardless of the `git+https` spec — the public repo needs SSH or
  the `url.insteadOf` git config on the VPS build host (noted in CHANGELOG).
- **Density (Decision 2):** took **path A** — `{records}` with the server
  downsample lifted 300 → 2 000, in a 25-row CsvGrid scroll viewport,
  `worker: false`. Path B (`{url}` full-frame + worker) is deferred to the TODO
  backlog; notably Vite already emits a correctly-pathed worker asset, so it's
  reduced to a browser-verify + flag flip.
- **Look (Decision 3):** accepted CsvGrid styling wholesale.
- **Chrome (Decision 4):** split — substantive frames (Describe/Stats/Reins/
  Density) get full chrome; the 3–8 row frames (bs window, pentagon, distortion
  slices) strip search/filter but keep sort.
- **Formats (Decision 5):** explicit per-column `formats` on the Price-stat
  slices (`.1%`, `,d`, `.3f`, `.0%`); auto elsewhere.
- **Dead code:** deleted `actions.js` + `pricing-pane.js` **and** `plot-pane.js`
  (transitively dead — only `actions.js` imported it), plus the stale
  `web/public/index.html` and the `.tbl` styles.

Original scoping doc follows.

---

Status: **draft / scoping**. Target: a later 1.0.0a* bump (own iteration).

Replace every DataFrame grid in the SPA with **CsvGrid** — the embeddable grid
from `mynl/CSV_Viewer` (npm name `csv-grid`, v3.0.7, PyPI `csv-grid` for the
Python emitter; local checkout `C:/s/AI/csv-viewer`). One consistent,
feature-rich grid everywhere, replacing the hand-rolled `renderFrameTable`.

## Why
CsvGrid brings, for free, what our `.tbl` renderer doesn't: click-to-sort,
fzf-style global search, per-column filters (incl. numeric/date `>100`, `10..20`
ranges), type-aware number/date formatting (greater_tables conventions),
expand/width handling, and **Web-Worker parsing + lazy formatting for big
tables** — which directly solves the density-frame sizing problem.

## What CsvGrid is (consumer view)
- Vanilla JS, **zero runtime deps**, self-contained CSS; `dist/` is committed.
- `new CsvGrid(elOrSelector, data, options)`.
- **data**: `{records, columns}` (records = arrays *or* objects), `{csv}`, or
  `{url}`; optional `name`, `headerMode`. null/NaN → blank.
- **options** (all optional, sensible defaults): `globalSearch`,
  `columnFilters`, `sortable`, `statusBar`, `expandButtons` (default true),
  `align` (`'llrcr…'` per column), `formats` (per-column `[,][.N](f|d|%|e|s)`,
  `'year'`, `'eng'`, `null`=auto), `renderCap`, `eagerCells`, `worker`,
  `headerMode`.
- **methods**: `setData(data)` → Promise, `destroy()`.
- **ES use**: `import CsvGrid from 'csv-grid'` + `import 'csv-grid/csv-grid.css'`;
  worker asset at `'csv-grid/worker'`. exports map resolves all of these.

## Data mapping (near drop-in)
Our backend `FrameResponse` is `{columns: [...], rows: [[...]]}` — rows are
arrays. CsvGrid `{records, columns}` takes arrays directly:
```js
new CsvGrid(host, { columns: frame.columns, records: frame.rows }, opts);
```
- `renderFrameTable`'s "first column is the bold left label, rest right via
  `fmt()`" becomes CsvGrid `align` (e.g. `'l' + 'r'.repeat(n-1)`) + `formats`.
- The Price per-stat formats (LR `%`, P `,.0f`/`,d`, PQ `.3f`, ROE `%`) map onto
  CsvGrid `formats` — so the bespoke `PRICE_FMT` helpers in `main.js` can be
  dropped (or kept as explicit `formats` to honor the exact spec).

## Call sites to convert (all `renderFrameTable` users)
`web/src/main.js`: Describe (`pane-desc`), Stats (`pane-stats`), Density
(`pane-density`), bs window (`pane-bswin`), Reins ×3 (`pane-reins`:
reins_describe / reins_stats_df / reins_density_df), Price (pentagon,
`distortion_df`, and the four distortion slices). **Not** converted: Info (a
`<pre>`), Plot (an `<img>`), error / rate-limit cards, the summary line.

**Dead-code cleanup (confirmed):** the legacy `renderTable` is used *only* by
`web/src/actions.js` and `web/src/pricing-pane.js`, and **neither file is
imported by the live entry (`main.js`)** — they're dead modules. So delete
`actions.js` + `pricing-pane.js` wholesale, not just `renderTable`. (Separately,
`web/public/index.html` still carries the old btn-toolbar layout and looks
stale — verify and remove in the same sweep.)

## Integration approach
1. **Dependency source** (decision below): add `csv-grid` and
   `import CsvGrid from 'csv-grid'` + its CSS.
2. **One helper** `renderGrid(frame, opts)` replaces `renderFrameTable`: build a
   host node, `new CsvGrid(host, {columns, records}, opts)`, and **register the
   instance for teardown**.
3. **Lifecycle (the main new plumbing):** `replacePane`/`clearPanes` currently
   just empty the DOM. CsvGrid holds listeners (and a worker if enabled), so we
   must `destroy()` the previous instance before replacing. Keep a
   `paneId → CsvGrid` registry; destroy on re-render and on rebuild.
4. **CSS:** import `csv-grid.css`; it's self-contained but loads alongside
   Bootstrap + `site.css` — scope-check for collisions, set pane height/scroll.
   The dense `.tbl` booktabs look is superseded by CsvGrid's look (that's the
   point), so `.tbl` styles can largely go.
5. **Per-pane options:** tiny frames (describe/stats/pentagon/distortion_df,
   3–8 rows) probably want search/filter/expand **off** (less chrome); the big
   ones (Density, reins density) want them **on**.

## The density opportunity (big win)
Today Density is server-downsampled to ~300 rows with a curated column set.
Two paths with CsvGrid:
- **A:** keep sending `{records}` but raise the cap (CsvGrid lazy-formats).
- **B (recommended):** point Density at the CSV route —
  `new CsvGrid(host, { url: api.frameCsvUrl(id, 'density_df') }, { worker: true })`
  — and let CsvGrid **fetch + worker-parse the full frame**. This removes the
  300-row preview limitation *and* the JSON payload entirely. Requires solving
  worker pathing under Vite (serve `csv-grid.worker.js`, or `worker:false` and
  accept main-thread parse). Note: `frameCsvUrl` + the `/frame/{which}.csv` route
  already exist; the route sets `Content-Disposition: attachment`, which is
  harmless for CsvGrid's fetch-based `{url}` (only matters if you *navigate* to
  the URL).

## Phasing
1. Add the dep + `renderGrid` helper + destroy lifecycle; convert **Describe**
   only as proof (look, scroll, no leaks).
2. Convert the rest (Stats, Reins ×3, Price set, bs window).
3. Density via `{url}` + worker; drop/raise the server downsample (keep the
   `nonzero`/CSV route for the data).
4. Cleanup: retire `renderFrameTable` / `renderTable` / now-dead `fmt` paths;
   reconcile CSS; sanity-check bundle size.

## Decisions needed
1. **Dependency source — DECIDED: (a) git dep.** Use
   `"csv-grid": "github:mynl/CSV_Viewer"` — the VPS pulls it at `npm install`
   (author confirmed an install-time network connection is acceptable). For the
   record, the rejected alternatives: **(b)** vendor the committed `dist/*` into
   `web/vendor/csv-grid/` (offline, but manual version bumps); **(c)** local
   `file:` path (machine-specific, breaks the VPS).
2. **Density:** `{url}` full-frame (best, needs worker pathing) vs `{records}`
   with a higher cap.
3. **Look:** accept CsvGrid styling wholesale, or theme it toward the dense
   archivum look (its CSS is self-contained → themable, extra work).
4. **Chrome on tiny tables:** uniform (search/filter everywhere) vs stripped for
   3-row frames.
5. **Formatting:** CsvGrid auto-format everywhere vs explicit `formats` for the
   Price stats to match the exact spec.

## Interaction with plan-pwa
- **Do this after plan-pwa Phase A** (the prefix removal). Density's `{url}` fetch
  + Vite worker pathing should be exercised against the **final clean origin**
  (`agg.mynl.com`, same-origin `/v1/…`), not the stripped `/Q7M4Z9KP` prefix.
- If plan-pwa Phase B (service worker) has landed, confirm the SW keeps `/v1/*`
  **network-only** so the CSV/density frames this plan fetches are never served
  stale from cache.

## Risks / notes
- **Teardown leaks** if `destroy()` isn't wired (workers + listeners) — the main
  correctness risk.
- **CSS collisions** with Bootstrap (low; CsvGrid is self-contained, but verify).
- **VPS build** must be able to obtain the dep (drives decision 1) — `refresh.sh`
  rebuilds the SPA on the VPS, so a git dep needs network there.
- **Pin** csv-grid 3.0.7; the backend `FrameResponse` is unchanged, so backend
  tests stand; the SPA has no automated tests, so this is eyeball-verified.

## Effort
Phase 1 ~half a day; full conversion incl. density `{url}` + cleanup ~1–2 days.
The backend needs **no changes** for phases 1–2 (frames already serialize as
`{columns, rows}`); phase 3 only reuses the existing CSV route.
