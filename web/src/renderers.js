// Convert api responses to DOM nodes (Bootstrap-styled).
//
// Each renderer returns a single root node; the caller drops it into
// the output region (#output). No string concatenation -- everything
// goes through el() so values get text-escaped automatically.

import { el } from './utils/dom.js';
import { fmt, isNumeric } from './utils/format.js';

/**
 * Render a FrameResponse {columns, rows} as a Bootstrap table.
 *
 * Numeric cells get text-end font-monospace; string headers keep
 * their original capitalization (these tend to be `loss`,
 * `p_total`, etc., which we don't want to title-case).
 */
export function renderTable(frame, opts = {}) {
    const { columns = [], rows = [] } = frame || {};
    const { caption } = opts;

    const thead = el('thead', {},
        el('tr', {}, columns.map(c => el('th', {
            scope: 'col',
            className: 'small text-muted',
        }, c))),
    );

    const tbody = el('tbody', {}, rows.map(row =>
        el('tr', {}, row.map(cell => {
            const numeric = isNumeric(cell);
            return el('td', {
                className: numeric ? 'text-end font-monospace' : '',
            }, fmt(cell));
        })),
    ));

    const table = el('table', {
        className: 'table table-sm table-hover align-middle agg-table',
    });
    if (caption) {
        table.appendChild(el('caption', { className: 'small text-muted' }, caption));
    }
    table.appendChild(thead);
    table.appendChild(tbody);

    // The wrapper gives a horizontal scroll on narrow viewports
    // (Bootstrap idiom for wide tables).
    return el('div', { className: 'table-responsive' }, table,
        el('div', { className: 'small text-muted mt-1' },
            `${rows.length.toLocaleString()} rows × ${columns.length} cols`),
    );
}

/**
 * Render a FrameResponse as the dense "booktabs" table used by the
 * redesigned playground (`.tbl`): horizontal rules only, tabular
 * numerics, the first column treated as the row label (left-aligned,
 * bold) and the rest right-aligned through fmt().
 *
 * Returns the bare ``<table class="tbl">`` -- callers drop it straight
 * into a tab pane. ``.tbl`` is ``display:block; overflow-x:auto`` so it
 * scrolls horizontally on narrow viewports without a wrapper.
 */
export function renderFrameTable(frame, opts = {}) {
    const { columns = [], rows = [] } = frame || {};
    // Optional per-cell formatter for the non-label columns (the first column
    // is the row label and always uses the default fmt). Lets the Price tab
    // render LR as a percent, P as a thousands-grouped integer, etc.
    const cellFmt = opts.format || fmt;

    const thead = el('thead', {},
        el('tr', {}, columns.map((c, i) =>
            el('th', { className: i === 0 ? 'lbl' : '' }, c))),
    );
    const tbody = el('tbody', {}, rows.map(row =>
        el('tr', {}, row.map((cell, i) =>
            el('td', { className: i === 0 ? 'lbl' : '' },
                i === 0 ? fmt(cell) : cellFmt(cell)))),
    ));
    return el('table', { className: 'tbl' }, thead, tbody);
}

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
 * Render the BuildResponse summary line (id, kind, name, cached,
 * elapsed_ms). Shown briefly above #output after each build so the
 * user knows which object the action buttons act on.
 */
export function renderBuildBanner(payload) {
    const status = payload.cached
        ? el('span', { className: 'badge text-bg-light' }, 'cached')
        : el('span', { className: 'badge text-bg-success' }, 'fresh');

    const warnings = (payload.warnings || []).map(w =>
        el('div', { className: 'text-warning small' }, `⚠ ${w}`));

    return el('div', { className: 'agg-build-banner mb-3' },
        el('div', { className: 'd-flex align-items-center gap-3 flex-wrap' },
            el('strong', {}, payload.name || '(unnamed)'),
            el('span', { className: 'text-muted small' }, `${payload.kind} · id ${payload.id}`),
            status,
            el('span', { className: 'text-muted small' }, `${payload.elapsed_ms} ms`),
        ),
        ...warnings,
    );
}
