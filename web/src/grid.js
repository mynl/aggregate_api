// CsvGrid integration: mount the embeddable grid into a pane and keep it
// leak-free.
//
// CsvGrid (mynl/CSV_Viewer) holds DOM listeners — and, when enabled, a Web
// Worker — so a grid must be destroy()ed before its pane is re-rendered or the
// object is rebuilt, or those handles leak. We track every live instance by the
// pane it lives in and tear them down on clear/rebuild. The Price pane stacks
// several grids in one pane, hence paneId -> CsvGrid[]. See dev/done/plan-grid.md.
//
// Worker note: the parse worker is disabled by default here (see mountGrid).
// CsvGrid otherwise resolves its worker from `import.meta.url`, which under our
// Vite build points at the hashed bundle, not a co-located worker file — so the
// main-thread parser is the robust choice until the worker asset is shipped.
// Our frames are small (describe/stats/reins) or server-downsampled (density),
// well under CsvGrid's render cap, so main-thread parsing is imperceptible.

import CsvGrid from 'csv-grid';
import 'csv-grid/csv-grid.css';

// paneId -> CsvGrid[]
const registry = new Map();

/**
 * Destroy and forget every CsvGrid mounted in `paneId`. A no-op when the pane
 * holds no grids, so it is safe to call before any render.
 */
export function clearGrids(paneId) {
    const grids = registry.get(paneId);
    if (!grids) return;
    for (const g of grids) {
        try { g.destroy(); } catch { /* already torn down */ }
    }
    registry.delete(paneId);
}

/** Destroy every live grid across all panes (used on rebuild / clearPanes). */
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
    const grid = new CsvGrid(host, { columns, records: rows }, { worker: false, ...opts });
    const grids = registry.get(paneId) || [];
    grids.push(grid);
    registry.set(paneId, grids);
    return grid;
}
