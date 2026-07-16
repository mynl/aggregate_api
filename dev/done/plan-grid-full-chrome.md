# plan-grid-full-chrome — make the CsvGrid actually useful

Status: **done (1.0.0a16).**

Target: **1.0.0a16** (one bump).

## Why

Feedback: the grids shipped with too little turned on to be useful. To be worth
having, every grid needs the fzf global search, the per-column filter boxes, and
**copy / download** — filtering to narrow, copy/save to take the data away. The
Expand/Contract control only earns its space on wide tables. And the custom
per-tab "csv" download buttons dotted around the app should go — the grid is the
single export path.

## The blocker (and fix)

The app was pinned to **csv-grid 3.1.0** (commit `6033b20`), which **predates the
copy/save export controls entirely** — there was nothing to enable. csv-grid
**3.9.0** (commit `01a9773`) adds them via a default-on `exportButtons` option
(a "copy" and a "save" control in the toolbar), plus row selection. So this batch
**bumps csv-grid 3.1.0 → 3.9.0**.

The bump had to pin the **exact commit** in `web/package.json`
(`github:mynl/CSV_Viewer#01a9773…`, was a bare `git+https://…` URL). With the
bare URL, `npm install` kept re-resolving from npm's cache to the *old* 6033b20
and silently reverting the build to 3.1.0. Pinning the commit makes the build
deterministic. (The lockfile still records `git+ssh://` — npm rewrites it — so a
deploy host needs GitHub SSH or the documented
`git config --global url."https://github.com/".insteadOf "git@github.com:"`; see
CHANGELOG a7.)

## What landed

- **csv-grid 3.1.0 → 3.9.0** (pinned commit; `web/package.json` + lockfile). API
  is source-compatible (`new CsvGrid(host, {columns, records}, opts)`, `destroy()`
  unchanged), so `grid.js` needed no structural change.
- **Full chrome is the default** (`grid.js`): fzf `globalSearch`, `columnFilters`,
  `statusBar`, and the `exportButtons` (copy / save) are all CsvGrid defaults —
  the app no longer strips them. The `GRID_PLAIN` preset (which turned them off
  for small frames) is gone; every grid gets the full set.
- **Expand/Contract is conditional on width** (`grid.js`): `expandButtons` shows
  only from **6 columns** up (`columns.length >= 6`), omitted below that. Callers
  can override.
- **Custom per-tab CSV buttons removed** (`index.html`, `main.js`): the
  `data-csv` buttons (summary / validation / stats / density / bs-window) and the
  reins `#reins-csv` button are gone — CsvGrid's own copy / save handles it. The
  unused `api.frameCsvUrl` helper is removed. The **Info-text copy**
  (`data-copy`) and the **Plot SVG download** (`data-plot-download`) stay — they
  aren't table exports. The backend `/frame/{which}.csv` endpoints remain for
  full-frame API access.

## Caveat (flagged to the author)

CsvGrid's save/copy exports the **displayed** data. For **density** (binned to a
2¹¹ display grid) and **stats** (raw `ex1/ex2/ex3` moments dropped) that is *not*
the full/exact frame the old `data-csv` buttons downloaded. Full data is still
available from the `/frame/{which}.csv` endpoints; if a full-frame UI export is
wanted back, restore those two buttons or feed the grids the full frame.

## Files

`web/package.json` + `web/package-lock.json` (dep bump), `web/src/grid.js`
(defaults + conditional expand), `web/src/main.js` (drop `GRID_PLAIN`, remove csv
handlers), `web/index.html` (remove csv buttons, density caption), `web/src/api.js`
(drop `frameCsvUrl`). SPA bundle rebuilt (`scripts/build-web.ps1`). No backend
change.

## Verified

SPA builds; the bundle carries csv-grid 3.9.0 (`exportButtons` /
`_buildExportControl` / `getSelection` present, header reads "grid 3.9.0"). The
grid API (`destroy`, `setData`, `records`/`columns`) is unchanged, so teardown
still works. **Author to eyeball in-browser** (an 8-version bump): the export
controls render, filters/search work, Expand shows only on wide tables.
