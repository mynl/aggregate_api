// CsvGrid integration: mount the embeddable grid into a pane and keep it
// leak-free.
//
// CsvGrid (mynl/CSV_Viewer) holds DOM listeners, and, when enabled, a Web
// Worker, so a grid must be destroy()ed before its pane is re-rendered or the
// object is rebuilt, or those handles leak. We track every live instance by the
// pane it lives in and tear them down on clear/rebuild. The Price pane stacks
// several grids in one pane, hence paneId -> CsvGrid[]. See dev/done/plan-grid.md.
//
// Worker note: CsvGrid parses CSV text of 1 MB or more in a Web Worker, which
// it finds relative to its own `import.meta.url`. Under the Vite build that is
// the hashed bundle, where no worker file sits, so through 1.17 the worker was
// off and every grid parsed on the main thread. The `?url` import below has
// Vite copy `csv-grid.worker.js` as a hashed asset and hands its address to
// every grid. Only a `{csv}` or `{url}` load reaches the worker; a grid fed
// `{records}`, which is every table but All rows, is built on the main thread
// as before.

import CsvGrid from 'csv-grid';
import workerUrl from 'csv-grid/worker?url';
import 'csv-grid/csv-grid.css';

// paneId -> handles[], where a handle is anything with destroy(). CsvGrid
// instances and IR tables (tables.js) both qualify and both live here.
//
// One registry rather than one per renderer, deliberately: `clearGrids` is
// already called from every place a pane is rebuilt, so a second registry would
// mean auditing those call sites again and getting one wrong. Anything mounted
// into a pane registers here and is torn down by the same sweep.
const registry = new Map();

/**
 * Register a teardown handle against a pane.
 *
 * Parameters
 * ----------
 * paneId : str
 *     The output pane the handle belongs to.
 * handle : object
 *     Anything exposing ``destroy()``.
 */
export function registerPaneTeardown(paneId, handle) {
    if (!registry.has(paneId)) registry.set(paneId, []);
    registry.get(paneId).push(handle);
}

/**
 * Destroy and forget everything mounted in `paneId`. A no-op when the pane
 * holds nothing, so it is safe to call before any render.
 */
export function clearGrids(paneId) {
    const handles = registry.get(paneId);
    if (!handles) return;
    for (const h of handles) {
        try { h.destroy(); } catch { /* already torn down */ }
    }
    registry.delete(paneId);
}

/** Destroy everything live across all panes (used on rebuild / clearPanes). */
export function destroyAllGrids() {
    for (const paneId of [...registry.keys()]) clearGrids(paneId);
}

/**
 * Mount a FrameResponse ``{columns, rows}`` as a CsvGrid inside `host`,
 * registering it under `paneId` for later teardown.
 *
 * Parameters
 * ----------
 * paneId : str
 *     The output pane id the grid belongs to; teardown is keyed on it.
 * host : HTMLElement
 *     The mount point. Must already be attached to the document so CsvGrid can
 *     measure column widths at construction.
 * frame : object
 *     ``{columns: [...], rows: [[...]]}`` from the api (rows are arrays, which
 *     CsvGrid accepts directly as ``records``), or ``{url, name}`` for a CSV
 *     the grid fetches and parses itself, in its worker (the All rows view).
 * opts : object, optional
 *     CsvGrid options. ``worker`` is the bundled worker's URL (see module
 *     note); a caller can still pass ``false``.
 *
 * Returns
 * -------
 * CsvGrid
 *     The grid, with ``loaded`` set to the promise its data load returns.
 */
export function mountGrid(paneId, host, frame, opts = {}) {
    const { columns = [], rows = [], url = null, name = '' } = frame || {};
    const data = url ? { url, name } : { columns, records: rows };
    // The SPA is light-only; CsvGrid otherwise auto-follows the OS via
    // prefers-color-scheme and would render dark on a dark-mode browser,
    // clashing with the rest of the page. Forcing data-theme="light" on the
    // host (CsvGrid adds its .csvgrid class to this element) opts the grid out.
    host.setAttribute('data-theme', 'light');
    // Full chrome by default: fzf global search, per-column filters, status bar,
    // and the copy / save export controls are all CsvGrid defaults, and they are
    // what make the grid useful (filter to narrow, copy / download to take the
    // data away).
    //
    // Expand/Contract is off, always. It was `columns.length > 10` through a68,
    // on the reasoning that a narrow table already fits so the buttons would be
    // chrome that does nothing. What that produced is worse than either answer
    // on its own: Reinsurance Summary is 11 columns and grew the pair, Pricing
    // is under 10 and did not, so the same widget wore two different toolbars on
    // two tabs of one page and the reader had to notice a column count to
    // predict which. The author's call is one toolbar everywhere. Callers can
    // still override via opts, and nothing does.
    const grid = new CsvGrid(host, null, {
        worker: workerUrl,
        expandButtons: false,
        ...opts,
    });
    // The constructor would call `setData` itself and drop the promise. Calling
    // it here keeps the promise, which settles when the grid is installed in the
    // host, or when a `{url}` fetch or parse fails and the grid has shown its
    // own error box. The All rows view holds a "Loading" line up until then.
    // Either way the promise is the caller's to await; an unawaited rejection
    // is already swallowed by csv-grid.
    grid.loaded = grid.setData(data);
    unformattedExport(host);
    registerPaneTeardown(paneId, grid);
    return grid;
}

/**
 * Default Copy and Save to the raw values rather than the rendered text.
 *
 * A grid is where you go to take numbers away, and a copied `17,319.66` has to
 * be cleaned by hand before anything can compute with it, where the exact value
 * was sitting right there. The author's call, Round 5 item 20, and it applies to
 * **both** export controls: a Copy that differs from a Save is a surprise nobody
 * asked for.
 *
 * Reaching into the widget's DOM, which is not how this should be done. CsvGrid
 * 3.9.0 builds the "Formatted values" checkbox with `checked = true` hard coded
 * and reads it live at export time, so there is no constructor option to pass
 * and no export default to set. Both controls are built by `_buildScaffold` in
 * the constructor, so they are present by the time this runs. An
 * `exportValues: 'raw' | 'formatted'` option is asked for upstream; the day it
 * lands this function deletes and the option takes its place.
 */
function unformattedExport(host) {
    for (const box of host.querySelectorAll('.csvgrid-export-formatted')) {
        box.checked = false;
    }
}
