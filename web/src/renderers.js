// Convert api responses to DOM nodes (Bootstrap-styled).
//
// Tabular responses are now rendered by CsvGrid (see grid.js); what remains
// here is the Info pane, whose payload is plain pre-formatted text rather than
// a frame. Each renderer returns a single root node that the caller drops into
// an output pane. Values go through el() so they are text-escaped.

import { el } from './utils/dom.js';

/**
 * Render the InfoResponse {info: string} as a <pre> block. The api
 * ships the multi-line Aggregate.info / Portfolio.info verbatim;
 * users expect to see it the same way they'd see it in Jupyter.
 */
export function renderInfo(payload) {
    const text = (payload && payload.info) || '';
    return el('pre', { className: 'info' }, text);
}
