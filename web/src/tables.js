// Static tables: render a table document (the IR) client side.
//
// The server hands over a semantic document rather than markup -- dtypes,
// resolved formats, hierarchy, spans, break depths, flags, and no widths and no
// CSS. This module loads the walker that turns one into DOM, and mounts it.
//
// The walker is served from `/v1/assets/`, out of the same installed
// `greater_tables` that emitted the document. That is the point of not
// bundling a copy: one install ships both halves, so the renderer and the
// document cannot version skew. It is fetched lazily, on the first static table
// the session draws, so a user who lives in the interactive grid never pays for
// it.
//
// Scope: the walker never sorts, filters or virtualizes, by design. A table
// worth sorting is the interactive grid's, which is also what the row-count gate
// in main.js says.

import { registerPaneTeardown } from './grid.js';

const ASSET_BASE = '/v1/assets';

/** Row ceiling for the static view. Mirrors `tables.MAX_ROWS` on the server. */
export const STATIC_MAX_ROWS = 500;

/**
 * Whether a frame is small enough to read as a static table.
 *
 * Gated on the row count rather than on a list of frame names: the density
 * frames are what motivated it, but anything that grows past a few hundred rows
 * stops being a reading experience and starts being data to filter, which is
 * the grid's job. One rule, nothing to keep in sync.
 */
export function staticOk(frame) {
    const n = frame && frame.rows ? frame.rows.length : 0;
    return n > 0 && n <= STATIC_MAX_ROWS;
}

let walkerPromise = null;

/** Add the walker's stylesheet once, pointing at the served copy. */
function ensureStyles() {
    const href = `${ASSET_BASE}/gt.css`;
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

/**
 * Load the walker module, once per page.
 *
 * `@vite-ignore` because the specifier is a runtime URL on our own origin, not
 * a bundled dependency: Vite must leave it alone and let the browser fetch it.
 * The dev server proxies `/v1` to the api, so this resolves in both dev and the
 * built SPA.
 */
export function loadWalker() {
    if (!walkerPromise) {
        ensureStyles();
        walkerPromise = import(/* @vite-ignore */ `${ASSET_BASE}/gt-render.esm.js`)
            .catch((err) => { walkerPromise = null; throw err; });
    }
    return walkerPromise;
}

/**
 * Render a table document into `host`.
 *
 * Parameters
 * ----------
 * paneId : str
 *     Output pane, for teardown. The handle joins the same registry CsvGrid
 *     uses, so the existing `clearGrids` sweep destroys it.
 * host : HTMLElement
 *     Mount point.
 * doc : object
 *     The `ir_version` 1 table document.
 *
 * Returns
 * -------
 * Promise<object|null>
 *     The walker handle, or null if the walker could not be loaded. Callers
 *     fall back to the grid on null rather than showing an empty pane.
 *
 * Notes
 * -----
 * `allowHtml: true` is safe in the narrow sense that matters: the only cells
 * carrying the html flag are ones our own server marked, from frames our own
 * service built. Nothing user-authored reaches a cell.
 */
export async function mountIrTable(paneId, host, doc) {
    let walker;
    try {
        walker = await loadWalker();
    } catch {
        return null;               // caller falls back to the grid
    }
    const handle = walker.renderTable(doc, { mount: host, allowHtml: true });
    registerPaneTeardown(paneId, handle);
    return handle;
}
