// CsvGrid integration: mount the embeddable grid into a pane and keep it
// leak-free.
//
// CsvGrid (mynl/CSV_Viewer) holds DOM listeners, and, when enabled, a Web
// Worker, so a grid must be destroy()ed before its pane is re-rendered or the
// object is rebuilt, or those handles leak. We track every live instance by the
// pane it lives in and tear them down on clear/rebuild. The Price pane stacks
// several grids in one pane, hence paneId -> CsvGrid[]. See dev/done/plan-grid.md.
//
// Worker note: the parse worker is disabled by default here (see mountGrid).
// CsvGrid otherwise resolves its worker from `import.meta.url`, which under our
// Vite build points at the hashed bundle, not a co-located worker file, so the
// main-thread parser is the robust choice until the worker asset is shipped.
// Our frames are small (summary/stats/reins) or server-downsampled (density),
// well under CsvGrid's render cap, so main-thread parsing is imperceptible.

import CsvGrid from 'csv-grid';
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
 *     CsvGrid accepts directly as ``records``).
 * opts : object, optional
 *     CsvGrid options. ``worker`` defaults to ``false`` (see module note) but
 *     can be overridden once a worker asset is served.
 */
export function mountGrid(paneId, host, frame, opts = {}) {
    const { columns = [], rows = [] } = frame || {};
    // The SPA is light-only; CsvGrid otherwise auto-follows the OS via
    // prefers-color-scheme and would render dark on a dark-mode browser,
    // clashing with the rest of the page. Forcing data-theme="light" on the
    // host (CsvGrid adds its .csvgrid class to this element) opts the grid out.
    host.setAttribute('data-theme', 'light');
    // Full chrome by default -- fzf global search, per-column filters, status
    // bar, and the copy / save export controls are all CsvGrid defaults, and they
    // are what make the grid useful (filter to narrow, copy / download to take
    // the data away).
    //
    // Expand/Contract is the exception, and the threshold is 10 columns, not the
    // 6 this shipped with. Below that the table already fits, so the buttons are
    // chrome that does nothing: every frame on the Price tab (the pentagon, the
    // calibrated distortions, each per-stat slice) is under 10 columns wide and
    // carried a pair of dead controls. Callers override via opts.
    const grid = new CsvGrid(host, { columns, records: rows }, {
        worker: false,
        expandButtons: columns.length > 10,
        ...opts,
    });
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
