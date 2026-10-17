// The All rows view of a density table: how much of the frame to load.
//
// A density frame is `2**log2` rows by a width that grows with the number of
// units (13 + 10n for a portfolio), so a whole frame can far exceed what a
// browser tab should hold: ten units at log2 18 is 113 columns by 262,144 rows,
// about 30M cells and 600 MB of CSV. The budget below is the author's ruling
// (2026-10-17): under it, All rows loads every column of every row; over it,
// every row of the Display grid's few columns, with a line saying so and a link
// to the whole `.csv`. At that size the frame belongs in Python and `aggregate`.
//
// Pure, so it tests under `node --test` without a DOM. See
// `dev/done/plan-fast-frames.md`, `[lab-all-rows]`.

/** Cells (rows times columns) All rows will put in one grid. */
export const ALL_ROWS_CELL_BUDGET = 3_500_000;

/** The `localStorage` key of the page-wide All rows preference. */
export const DENSITY_ROWS_KEY = 'aggapi.densityRows';

/**
 * Read the All rows preference: `'all'` or `'display'`, the default.
 *
 * A page-wide preference like Tables and Perspective, persisted so a reader who
 * wants every row sets it once. Display grid is the default because on the
 * public server a whole portfolio frame is a multi-megabyte download. Anything
 * stored that is not `'all'` (an old key, a hand edit) reads as the default.
 *
 * @param {{getItem: function(string): (string|null)}} storage `localStorage`,
 *     or a stub under test. A storage that throws (private mode) reads as the
 *     default too.
 * @returns {'all'|'display'}
 */
export function readDensityRows(storage) {
    try { return storage.getItem(DENSITY_ROWS_KEY) === 'all' ? 'all' : 'display'; }
    catch { return 'display'; }
}

/**
 * Persist the All rows preference, silently when the storage refuses.
 *
 * @param {{setItem: function(string, string)}} storage `localStorage`, or a stub.
 * @param {'all'|'display'} value the view to keep.
 */
export function writeDensityRows(storage, value) {
    try { storage.setItem(DENSITY_ROWS_KEY, value === 'all' ? 'all' : 'display'); }
    catch { /* private mode: the choice lasts the page */ }
}

/**
 * The one muted line shown while the grid fetches a whole frame.
 *
 * From the shape already in hand, so the reader knows what is coming before a
 * byte of it has arrived.
 *
 * @param {{rows: number, columns: number}} shape what `frame/{which}/shape` said.
 * @returns {string}
 */
export function loadingLine(shape) {
    const rows = Number(shape && shape.rows) || 0;
    const columns = Number(shape && shape.columns) || 0;
    return `Loading ${rows.toLocaleString('en-US')} rows by ${columns.toLocaleString('en-US')} columns…`;
}

function millions(n) {
    return `${(n / 1e6).toFixed(1)}M`;
}

/**
 * Decide what All rows loads for a frame of the given shape.
 *
 * @param {{rows: number, columns: number}} shape what `frame/{which}/shape` said.
 * @param {string[]} fallbackColumns the columns to keep when over budget.
 * @param {number} [budget] cells; `ALL_ROWS_CELL_BUDGET` unless a test says otherwise.
 * @returns {{whole: boolean, cells: number, columns: (string[]|null), note: string}}
 *     `whole` when every column fits; otherwise `columns` is the subset to ask
 *     for and `note` is the sentence to put above the grid.
 */
export function allRowsPlan(shape, fallbackColumns, budget = ALL_ROWS_CELL_BUDGET) {
    const rows = Number(shape && shape.rows) || 0;
    const columns = Number(shape && shape.columns) || 0;
    const cells = rows * columns;
    if (cells <= budget) return { whole: true, cells, columns: null, note: '' };
    const kept = fallbackColumns.length;
    const note = `${columns} columns by ${rows.toLocaleString('en-US')} rows is `
        + `${millions(cells)} cells, over this table's ${millions(budget)} budget, `
        + `so it shows ${kept} column${kept === 1 ? '' : 's'} on every row. For the `
        + 'whole frame, download the .csv or work with it in Python through aggregate.';
    return { whole: false, cells, columns: fallbackColumns, note };
}

/**
 * The `.csv` download URL for a frame, as the grid fetches it.
 *
 * A grid's `{url}` load is a plain `fetch` that no header can be attached to,
 * so the session rides as a query parameter, which is what the server's
 * `session` parameter exists for.
 *
 * @param {string} base the API base, `''` for same-origin.
 * @param {string} id the object id.
 * @param {string} which the frame name.
 * @param {(string[]|null)} cols a column subset, or null for the whole frame.
 * @param {string} session the session id.
 * @returns {string} the URL.
 */
export function frameCsvUrl(base, id, which, cols, session) {
    let url = `${base}/v1/objects/${encodeURIComponent(id)}/frame/${encodeURIComponent(which)}.csv`
        + `?session=${encodeURIComponent(session)}`;
    if (cols && cols.length) url += `&cols=${encodeURIComponent(cols.join(','))}`;
    return url;
}
