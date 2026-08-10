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

/**
 * Whether a document is the whole frame rather than the first `MAX_ROWS` of it.
 *
 * The server truncates instead of failing, and says so in the document's notes.
 * That is the right behavior for a direct request and the wrong thing to render
 * silently, so callers use this to fall back to fetching the full frame and
 * handing it to the grid. Nothing shows 500 of 900 rows without saying so.
 */
export function docTruncated(doc) {
    return Boolean(doc && (doc.notes || []).some((n) => /^Showing first /.test(n)));
}

/**
 * One number with every digit that means anything, as `%.15g` writes it.
 *
 * 15, not 17. Seventeen significant digits is what round-trips a double exactly
 * and it is the wrong answer here: it prints the float's dust, so a mean the
 * model computed as 1234.5 reads `1234.5000000000002` and the reader learns
 * about IEEE 754 rather than about their book. 15 is the most a double carries
 * reliably.
 */
function fullPrecision(value) {
    if (!Number.isFinite(value)) return String(value);
    if (value === 0) return '0';
    let s = value.toPrecision(15);
    if (!s.includes('e')) s = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
    return s;
}

/**
 * The same document with every number printed at full precision.
 *
 * **Client side, and that is the point.** Full precision was a server round trip
 * from a59 to a67: the api rebuilt the document with the per-column formats
 * dropped, because the exhibit route served documents that had thrown their
 * numbers away and there was nothing local to reprint. Since the library ships
 * `include_raw` on every served block (`aggregate` 1.0.0a246) every document the
 * app holds carries the exact value beside the formatted string, so this is a
 * rewrite of what is already in hand. The preference costs no fetch, applies to
 * both routes by one mechanism, and takes effect on the flip rather than on the
 * next build.
 *
 * Only cells whose raw value **is a number** are touched. Raw travels as a
 * string on object-dtype columns, so the coercion is what selects them, and
 * booleans are excluded explicitly: `Number(true)` is 1, and rewriting `True` to
 * `1` would be losing a reading rather than sharpening one.
 *
 * Returns a copy. The original is what the interactive grid derives from and
 * what the walker draws at house precision, and both have to survive a flip
 * back.
 */
export function atFullPrecision(doc) {
    if (!doc || !Array.isArray(doc.body)) return doc;
    const redo = (cell) => {
        if (!cell || typeof cell !== 'object' || !('raw' in cell)) return cell;
        const { raw } = cell;
        if (typeof raw === 'boolean' || raw === null || raw === '') return cell;
        const n = Number(raw);
        if (!Number.isFinite(n)) return cell;
        return { ...cell, text: fullPrecision(n) };
    };
    return {
        ...doc,
        body: doc.body.map((row) => ({ ...row, cells: (row.cells || []).map(redo) })),
        ...(Array.isArray(doc.foot)
            ? { foot: doc.foot.map((row) => ({ ...row, cells: (row.cells || []).map(redo) })) }
            : {}),
    };
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

/**
 * Turn a table document into CsvGrid's input, so one fetch feeds both views.
 *
 * `irToGridInput` ships in the same package as the walker. It un-sparsifies the
 * stub (values repeat down their rowspan), joins multi-level names with ' / ',
 * emits the **raw** values rather than the formatted text, and maps the IR's
 * resolved formats into the grid's own format-spec language. So the grid sorts
 * and filters on real numbers, and the two views cannot disagree about what a
 * cell says: they are reading the same bytes.
 *
 * Hierarchy, row flags and foot rows are dropped, by design. None of them
 * survives a sort, which is what the interactive view is for.
 *
 * Returns
 * -------
 * Promise<object|null>
 *     `{frame: {columns, rows}, formats, align}`, or null if the module could
 *     not be loaded, which is the caller's cue to fetch the plain frame.
 */
export async function irToGrid(doc) {
    try {
        const walker = await loadWalker();
        // `irToGridInput` throws rather than degrading: on a wrong `ir_version`,
        // and on any data column built without a raw value. Both are our bug to
        // fix rather than the reader's to look at, so this reports null and the
        // caller shows what it can.
        const g = walker.irToGridInput(doc);
        return {
            frame: { columns: g.columns, rows: g.records },
            formats: g.formats,
            align: g.align,
        };
    } catch (err) {
        console.error('[tables] could not derive grid input from the document', err);
        return null;
    }
}
