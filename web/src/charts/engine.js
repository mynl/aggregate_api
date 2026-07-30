// Which chart library draws the exhibits.
//
// This exists to settle a question rather than to ship a feature. The author is
// not sold on ECharts (recorded at a28), and the honest difficulty is that most
// of what went wrong across a26 to a29 was a design error on our side rather
// than something ECharts did: the wrong rectangle measured, the wrong default
// orientation, binned data, conditional steps, labels over the title, and a
// reservation aimed at the wrong layout. Those are not arguments for or against
// a library. A side by side on identical data is the only way to separate the
// two questions, so both renderers read the same `twoPanelData` bundle and
// differ only in how they draw it.
//
// Scope is deliberately small: `agg` and `port`, line graphs, no surfaces. On
// every other kind the Plotly button greys out rather than disappearing, per
// the house rule that a control is never hidden.
//
// If Plotly wins, the next step is to lift the shared bundle into a real
// intermediate representation and make `to-echarts` / `to-plotly` proper
// adapters. If it loses, this module and `plotly-panels.js` come out and
// nothing else moves.

const KEY = 'aggapi.chartEngine';

export const ENGINES = ['echarts', 'plotly'];

/**
 * Kinds the Plotly path covers.
 *
 * The two-panel exhibits the author looks at most. A distortion's g-curve and
 * the bivariate surface are out of scope for the spike: the first would add a
 * fill-between mapping and the second is not a line graph at all.
 */
export const PLOTLY_KINDS = new Set(['agg', 'port']);

let current = (() => {
    try {
        const stored = localStorage.getItem(KEY);
        return ENGINES.includes(stored) ? stored : 'echarts';
    } catch {
        return 'echarts';           // private mode
    }
})();

/** The chosen engine, `'echarts'` or `'plotly'`. */
export function engine() {
    return current;
}

/** Choose an engine, sticky per browser. Unknown values fall back to ECharts. */
export function setEngine(next) {
    current = ENGINES.includes(next) ? next : 'echarts';
    try { localStorage.setItem(KEY, current); } catch { /* private mode */ }
    return current;
}

/** True when `kind` can be drawn by the chosen engine's Plotly path. */
export function plotlyCovers(kind) {
    return PLOTLY_KINDS.has(kind);
}
