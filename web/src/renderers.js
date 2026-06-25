// Convert api responses to DOM nodes (Bootstrap-styled).
//
// Tabular responses are now rendered by CsvGrid (see grid.js); what remains
// here is the Info pane, whose payload is plain pre-formatted text rather than
// a frame. Each renderer returns a single root node that the caller drops into
// an output pane. Values go through el() so they are text-escaped.

import { el } from './utils/dom.js';
import { fmt, isNumeric } from './utils/format.js';

/**
 * Render the InfoResponse {info: string} as a <pre> block. The api
 * ships the multi-line Aggregate.info / Portfolio.info verbatim;
 * users expect to see it the same way they'd see it in Jupyter.
 */
export function renderInfo(payload) {
    const text = (payload && payload.info) || '';
    return el('pre', { className: 'info' }, text);
}

/**
 * Render a small {columns, rows} frame as a styled "exhibit" table.
 *
 * Used by the Overview tab for the summary_df and tail_df risk views --
 * both are small (3-11 rows), so a hand-built table (vs the virtualized
 * CsvGrid) lets us format numbers, blank NaN cells, highlight chosen rows,
 * and caption the exhibit. Numeric cells go through fmt() (NaN -> blank, so
 * the by-design empty CV / Freq-percentile cells render clean).
 *
 * Parameters
 * ----------
 * frame : {columns: string[], rows: any[][]}
 *     The api FrameResponse payload.
 * opts : object, optional
 *     title : str       -- section heading above the table.
 *     caption : str     -- muted footnote below the table.
 *     highlight : (rowObj) => bool
 *         Predicate over a {col: value} view of each row; matched rows get
 *         the ``exhibit-row-hi`` class (e.g. the 1-in-200 / 1-in-250 lines).
 *     emphasize : (rowObj) => bool
 *         Predicate for bold rows (e.g. the Agg / total "what's my number").
 *
 * Returns
 * -------
 * HTMLElement
 */
export function renderExhibit(frame, opts = {}) {
    const { columns = [], rows = [] } = frame || {};
    const { title, caption, highlight, emphasize } = opts;
    const wrap = el('div', { className: 'exhibit' });
    if (title) wrap.appendChild(el('h6', { className: 'exhibit-title' }, title));

    const thead = el('thead', {}, el('tr', {},
        ...columns.map((c) => el('th', { className: isNumericCol(rows, columns.indexOf(c)) ? 'num' : '' }, c))));
    const body = el('tbody');
    for (const row of rows) {
        const rowObj = Object.fromEntries(columns.map((c, i) => [c, row[i]]));
        const tr = el('tr', {});
        if (highlight && highlight(rowObj)) tr.classList.add('exhibit-row-hi');
        if (emphasize && emphasize(rowObj)) tr.classList.add('exhibit-row-em');
        row.forEach((v, i) => {
            const numeric = isNumeric(v) || typeof v === 'number';
            tr.appendChild(el('td', { className: numeric ? 'num' : '' }, fmt(v)));
        });
        body.appendChild(tr);
    }
    wrap.appendChild(el('table', { className: 'table table-sm exhibit-table' }, thead, body));
    if (caption) wrap.appendChild(el('div', { className: 'exhibit-caption' }, caption));
    return wrap;
}

/** True if most values in column `idx` are numeric (drives right-align). */
function isNumericCol(rows, idx) {
    if (idx < 0 || !rows.length) return false;
    let n = 0;
    for (const r of rows) if (isNumeric(r[idx]) || typeof r[idx] === 'number') n++;
    return n >= rows.length / 2;
}
