# Plan 1.12.0: full precision shows raw values on the large-frame grids

[Full-Precision-Grids]. The version is a placeholder: 1.10.0 and 1.11.0 are
claimed by `dev/plan-1.10.0-deep-link-view.md`, so take the **next free minor
at execution time**. Line numbers below are as of 1.9.1 and will drift once the
deep-link plan lands; the function names are the anchors.

## Goal

The page-wide table preference has three values: static, static at full
precision, interactive. Full precision currently applies only to document
tables. Make it also apply to the grids that show a bare frame (More ▸ Density,
Reinsurance ▸ Density and the fallbacks below) by switching CsvGrid to its
`raw` display mode, which prints every digit of each value instead of the
automatic format. Static and interactive keep the automatic format. **The
default does not change.**

A second, smaller goal: on those grids a change of table view adjusts the live
grid instead of rebuilding it, so sort, filters, search and scroll survive
Ctrl+Shift+U.

Decided with the author on 2026-10-14.

## Current behavior

**The preference.** `_tableView` (`web/src/main.js:2050`) holds `'static'`,
`'precise'` or `'interactive'`, sticky in `localStorage` under
`aggapi.tableView`. It is set from the header menu (`index.html:116-124`,
`data-table-view` buttons, wired at `main.js:2269`) and cycled by Ctrl+Shift+U
(`cycleTableView`, `main.js:2214-2228`, ring `static → precise → interactive`).
`setTableView` (`main.js:2135`) stores it and calls `notifyTableListeners`
(`main.js:2079`), which runs every function a pane registered through
`onTableViewChange(key, fn, node)` (`main.js:2069`) and drops those whose node
has left the page.

**Two kinds of table source.** `mountTable(paneId, host, source, gridOpts)`
(`main.js:2303`) takes either `{doc}` (a table document: static walker or grid)
or `{frame}` (plain `{columns, rows}`, grid only). The frame branch is

```js
if (!doc) {                          // bulk path, unchanged
    asGrid(frame, gridOpts);
    return;
}
```

and never reads `_tableView`. `asGrid` calls `mountGrid` (`web/src/grid.js:80`),
which builds the `CsvGrid`, registers it for teardown and **returns it**
(`grid.js:107`); `asGrid` discards the return value.

**The frame-only call sites**, all of them:

- `replacePaneTable` (`main.js:2662`). With a `bulk` fetcher the source is
  always a frame. Without one it fetches a document and falls back to a frame
  when the document is truncated (`docTruncated`) or the fetch fails. Callers:
  `more:density` (`main.js:1641`, options `{ maxRows: 25, renderCap: 8192 }`)
  and `loadReinsFrame` for Reinsurance ▸ Density (`main.js:3450`, options
  `{ renderCap: 8192 }`). Both pass a `bulk` fetcher.
- `renderBoundsTable` (`main.js:4213`): `{frame: payload.table}` when the
  response carries no document (`ir.table` absent).

Every other `mountTable` call passes `{doc}` (`main.js:2593`, `3363`, `3811`).

**What a keystroke does to a frame-only pane today.** Both call sites register
their whole `draw` closure (`main.js:2686`, `4243`). Each press of
Ctrl+Shift+U runs `draw`, which calls `replacePane` (destroying the grid) and
mounts a new one from the frame already held. Nothing visible changes, and the
reader's sort, column filters, search text and scroll position are thrown away.

**CsvGrid, as pinned** (`csv-grid` 3.10.1, `github:mynl/CSV_Viewer#07310c0`,
the same commit as `V:\dev\csv-viewer` HEAD; source `src/grid/grid.js`):

- The constructor accepts `displayMode: 'auto' | 'raw'`, default `'auto'`.
- `setDisplayMode(mode)` (`grid.js:674`, present in `node_modules/csv-grid/dist/csv-grid.es.js:1012`)
  does no re-parse. It resets only the formatted-text cache and the search
  index, re-measures column widths for the new text, and calls `refresh()`
  (`rebuildView`, `renderBody`, `renderStatus`). It does **not** touch
  `sortCol` / `sortDir` / `sortedOrder`, the column filters, the global search
  text, the header row (so filter inputs keep their text) or `this.selected`
  (repainted after `renderBody`). The scroll viewport is the same element, so
  the vertical position holds. The search index is rebuilt eagerly when
  `rows × cols ≤ eagerCells` (262,144); a display-grid density is at most
  8,192 rows by about six columns, so it always is. Column widths are
  re-measured, so a column the reader dragged wider snaps back to fit.
  Accepted.
- **Raw mode on `{records}` input.** `normalizeRecords` (`util.js:290`)
  stringifies each value with `String(v)` (null and NaN become blank), then
  infers column types from those strings. `formatCell` (`util.js:183`) returns
  that string verbatim in raw mode. So a raw cell is JavaScript's shortest
  round-trip form of the double the api sent (`65336`, `0.9999999999998224`,
  `1.7763568394002505e-13`). Type inference runs regardless of the lens, so
  numeric columns stay right-aligned and sort numerically on `col.values`, and
  the column filters evaluate as before.
- The api sends unrounded floats: `serializers.py` rounds no values (its only
  `np.round` picks downsample indices), so raw really is every digit.
- The **Inferred / Raw** switch described in the csv-viewer README belongs to
  the CSV Viewer *app* (`src/app/app.js`), not to the embeddable grid. aLL has
  no such control, which is why this plan routes the lens through the existing
  table preference.

**Not affected.** The phone page (`lite.js`) mounts no grids. The deep-link
plan (`plan-1.10.0-deep-link-view.md`) adds `view=<group>:<leaf>` navigation
and does not read or write the table view, so the two do not interact beyond
both editing `main.js`.

## Change

All in `web/src/main.js` plus wording in `web/index.html`. No backend change,
no change to `grid.js`.

**[lens-mapping]** Beside `isStatic` (`main.js:2025`):

```js
/** The CsvGrid lens for a frame-only grid: full precision reads raw. */
function gridDisplayMode(mode) { return mode === 'precise' ? 'raw' : 'auto'; }

/**
 * What a table pane registers for a view change: an in-place lens change when
 * it holds a frame-only grid, else its full redraw.
 */
function tableViewRedraw(grid, draw) {
    return grid ? () => grid.setDisplayMode(gridDisplayMode(_tableView)) : draw;
}
```

Both names checked against `web/src`: no collisions.

**[mount-in-lens]** In `mountTable`, `asGrid` returns what `mountGrid` returns
(`null` when the host has left the page), and the frame branch mounts in the
current lens and returns the grid:

```js
if (!doc) {                          // bulk path
    return asGrid(frame, { displayMode: gridDisplayMode(_tableView), ...gridOpts });
}
```

Caller options still win, as on the document path; no caller passes
`displayMode`. The document path keeps returning `undefined`: its grid mounts
asynchronously, and a document table *must* rebuild on a view change because
static and interactive are different renderers. Update the `mountTable`
docstring with a **Returns** section saying exactly that.

**[in-place-listener]** At both frame-capable call sites, register through the
helper:

```js
// replacePaneTable, inside draw
const grid = mountTable(paneId, host, source, opts);
onTableViewChange(paneId, tableViewRedraw(grid, draw), root);

// renderBoundsTable, inside draw
const grid = mountTable(paneId, host,
    ir.table ? { doc: ir.table } : { frame: payload.table },
    { ...GRID_FULL, maxRows: 30 });
onTableViewChange(paneId, tableViewRedraw(grid, draw), root);
```

A document source, or a grid that failed to mount, falls through to `draw`
exactly as today. Lifetimes need nothing new: when the pane is replaced, `root`
leaves the page and `notifyTableListeners` drops the listener before it can
touch the destroyed grid; a perspective flip goes through `refetchTables`,
which clears the panes and the listeners and remounts in the current lens; a
fresh page load with `precise` stored mounts raw from the start.

**[wording]** User-visible text and the comments that describe the three
readings:

- `index.html:121`, the menu hint under "Static, full precision": from
  `all digits` to `all digits, grids too`.
- `index.html:863-866`, the help line on Tables: add one sentence, "The
  density grids are always interactive; under full precision they show every
  digit of each value instead of the automatic format."
- `index.html:95-115`, the menu's HTML comment. Rewrite it: two of its claims
  are already stale (it says full precision "costs a fetch", which ended when
  documents began carrying raw values, see `main.js:2140-2146`; and it says the
  Overview carries a second affordance for the preference, but the menu and the
  keystroke are the only callers of `setTableView`). Say instead that full
  precision is client side for documents and sets the frame-only grids to raw.
- `main.js:2016-2022` ("How tables render") and the Ctrl+Shift+U docblock
  (`main.js:2173-2186`): one sentence each, that full precision also switches
  the frame-only grids to raw, in place.
- `main.js:2331` ("full precision is a static-view question only"): qualify it
  to document tables.

## Files

- `web/src/main.js`: [lens-mapping], [mount-in-lens], [in-place-listener],
  comment updates.
- `web/index.html`: menu hint, menu comment, help line.
- `src/aggregate_api/__init__.py`: version bump.
- `CHANGELOG.md`: new section.
- `dev/TODO.md`: no entry exists for this; none needed.

## Acceptance check

Gates (regression only; nothing here is reachable from them):

- `cd web; npm test` passes.
- `uv run pytest` passes.

No new automated test. `main.js` touches the DOM on import, so the node
harness tests only pure modules (`nav.js`, `examples.js`, `charts/*`), and the
one pure line here, `gridDisplayMode`, is a lookup a test would only restate.
The behavior is checked in the running app (Vite dev server, or the built SPA
after `.\scripts\build-web.ps1`):

1. Tables = Static. Build the landing book. Open More ▸ Density: the
   automatic format (`65,336.00`, `1000m` and the like).
2. In DevTools: `window.__g = document.querySelector('#pane-more .csvgrid')`.
   Sort `p_total` descending, type `>1000` in the `loss` filter, type a term in
   the search box, scroll the grid a few rows.
3. Ctrl+Shift+U (to full precision). The menu ticks "Static, full precision".
   The same rows, sort arrow, filter text, search text and scroll position;
   cells now show raw digits (`65336`, `0.9999999999998224`,
   `1.7763568394002505e-13`), numbers still right-aligned.
   `__g.isConnected === true` (the grid was not rebuilt).
4. Ctrl+Shift+U twice more (interactive, then static): automatic format both
   times, sort and filters still in place, `__g.isConnected` still `true`.
5. Select full precision and reload: Density opens raw.
6. Reinsurance ▸ Density on a reinsured example: steps 3 and 4 hold there.
7. Overview ▸ Summary (a document table) still cycles static, static at full
   precision, interactive exactly as before.
8. On a Density grid in raw mode, Copy and Save still export the values
   (the export choice is independent of the lens).
9. Rebuild the SPA after the commit (`.\scripts\build-web.ps1`) and confirm
   About reports the new version over the new bundle.

## Out of scope

- **csv-grid automatic-format bugs** seen on a plain `agg` Density grid. Both
  belong to `V:\dev\csv-viewer`; raw display is a workaround, not the fix.
  - `F` shows `1000m` for a value just under 1: the milli band rounds to three
    figures without carrying up, so `999.9999…m` prints as `1000m` instead of
    `1.00`.
  - `S` shows `0.000178n` for 1.78e-13: the SI ladder clamps at `n` instead of
    falling back to exponent form below it.
- Raw mode on a **document** grid. Under full precision a document table is the
  static walker; the grid appears there only if the walker fails, and that
  error path keeps the document's formats.
- A per-table or per-grid raw switch. The lens rides the one page-wide
  preference by the author's decision.

## CHANGELOG and version

One bump, one commit, per `CLAUDE.md` Release & housekeeping. Version in
`src/aggregate_api/__init__.py` only. Section, one paragraph:

```
## 1.12.0

[Full-Precision-Grids] **Full precision shows raw values on the density grids.** Plan `dev/plan-1.12.0-raw-display-large-grids.md`. More ▸ Density, Reinsurance ▸ Density and any table that falls back to a bare frame switch to CsvGrid's raw display under Static, full precision (menu or Ctrl+Shift+U), and back to the automatic format under the other two. The grid changes in place, so sort, filters, search and scroll survive the keystroke. The default is unchanged.
```

Commit subject: `[1.12.0] full precision shows raw values on the density grids`
(substitute the actual version). Rebuild the SPA after the commit; never stage
`static/`.

## Execution log

Executed 2026-10-14 as **1.12.0**, one step, one commit. Gates: `cd web; npm test` 302 passed; `uv run --no-sync pytest` 522 passed.

Divergences, all small:

- **Line numbers.** Every anchor had drifted (1.10.0 and 1.11.0 landed first); the function names held and every claim about the code checked out, including `setDisplayMode` in the pinned `csv-grid` bundle.
- **A third stale comment.** Besides the menu's HTML comment, `syncPreferenceMenu` in `main.js` repeated the claim that the Overview carries a second affordance for Tables. Corrected the same way: the menu and Ctrl+Shift+U are the only setters.
- **`tableViewRedraw` got a NumPy docstring** (Parameters, Returns, Notes) rather than the plan's one-line comment, per the docstring rule.
- **CHANGELOG** written as a lede and four bullets, matching the sections around it, rather than the plan's single paragraph; it also points at the plan's `dev/done/` path.
- **pytest ran with `--no-sync`**, per `CLAUDE.md`; the plan's `uv run pytest` would have swapped the worktree `aggregate` for the released build.
- **No control list row.** `T:/worktrees/dev-files.md` does not exist, so there was nothing to update.
- **Acceptance steps 1 to 9 are in the running app** and were not driven in this session; the SPA was rebuilt after the commit.
