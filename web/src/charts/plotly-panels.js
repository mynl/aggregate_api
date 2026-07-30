// The two-panel exhibit, drawn by Plotly instead of ECharts.
//
// An evaluation spike, not a second production renderer. It exists so the two
// libraries can be compared on the same book with the same decisions behind
// them, which is the only way to tell whether the exhibits underwhelm because
// of the library or because of the chart design. See `engine.js`.
//
// **Every decision comes from `twoPanelData`**: which curves, over which window,
// on which scales, which verticals are marked and which way their labels open.
// Nothing here re-derives any of it. If this file started picking its own
// x-window or its own log floor the comparison would be between two different
// charts, which would answer nothing.
//
// Plotly ships as a prebuilt bundle behind a dynamic import, exactly as
// `echarts-gl` does in surface.js, so a visitor who never flips the switch never
// downloads it.
//
// The bundle is **gl2d**, not basic, and the reason is `scattergl`. The basic
// bundle registers bar, pie and scatter only, and its `scatter` is the SVG
// renderer. Since a27 the exhibits carry every grid point, so a portfolio is
// half a dozen curves of 2**16 points; asking SVG to draw that would make
// Plotly look bad for a reason that has nothing to do with how it draws, and
// the comparison would be worthless. ECharts renders to canvas, so WebGL is the
// like-for-like choice.
//
// The cost is 524 kB gzipped against the eager ECharts chunk's 198 kB. Real,
// but it lands on nobody who leaves the default alone. If Plotly wins, a custom
// build registering only `scatter` and `scattergl` would cut it well below
// gl2d, which also carries parcoords and splom that nothing here uses.

import { fmt } from '../utils/format.js';
import { seriesColor, lineWidth, fade, logMin, LOG_FLOOR } from './theme.js';

let Plotly = null;

/**
 * Fetch the Plotly bundle, once.
 *
 * Returns
 * -------
 * bool
 *     Whether Plotly is available. False leaves the caller on ECharts rather
 *     than on an empty pane.
 */
export async function loadPlotly() {
    if (Plotly) return true;
    try {
        const mod = await import('plotly.js-gl2d-dist-min');
        Plotly = mod.default || mod;
        return Boolean(Plotly && Plotly.newPlot);
    } catch {
        return false;                // offline, blocked, or a failed chunk
    }
}

/** True once the bundle has landed, read synchronously by a pure build. */
export function plotlyLoaded() {
    return Boolean(Plotly);
}

// Plotly positions panels as fractions of the plot area rather than in pixels,
// so the box's pixel geometry is converted rather than reinvented. Same
// rectangle, expressed the way this library wants it.
function domains(box) {
    const { grids, hostHeight } = box;
    const [a, b] = grids;
    const w = a.left + a.width + (b.left - a.left - a.width) + b.width + 40;
    const sideBySide = b.left > a.left + a.width - 1;
    if (sideBySide) {
        return {
            sideBySide: true,
            x1: [a.left / w, (a.left + a.width) / w],
            x2: [b.left / w, (b.left + b.width) / w],
            y1: [1 - (a.top + a.height) / hostHeight, 1 - a.top / hostHeight],
            y2: [1 - (b.top + b.height) / hostHeight, 1 - b.top / hostHeight],
        };
    }
    const span = a.left + a.width + 40;
    return {
        sideBySide: false,
        x1: [a.left / span, (a.left + a.width) / span],
        x2: [a.left / span, (a.left + a.width) / span],
        y1: [1 - (a.top + a.height) / hostHeight, 1 - a.top / hostHeight],
        y2: [1 - (b.top + b.height) / hostHeight, 1 - b.top / hostHeight],
    };
}

/**
 * A vertical reference line plus its label, as a Plotly shape and annotation.
 *
 * ECharts draws these as a `markLine` on a series; Plotly has no such thing, so
 * they become a layout shape spanning the panel's y-domain and an annotation
 * pinned to its top. The label sits **inside** the panel and opens away from the
 * line, matching the a28 decision that fixed labels colliding with the title.
 */
function verticalMark(ref, xref, yref) {
    const faint = Boolean(ref.faint);
    return {
        shape: {
            type: 'line', xref, yref: `${yref} domain`,
            x0: ref.x, x1: ref.x, y0: 0, y1: 1,
            line: {
                color: '#6c757d', width: 1, dash: 'dash',
            },
            opacity: faint ? 0.45 : 0.75,
            layer: 'below',
        },
        annotation: {
            xref, yref: `${yref} domain`,
            x: ref.x, y: 1, yanchor: 'top',
            xanchor: ref.align === 'left' ? 'left' : 'right',
            xshift: ref.align === 'left' ? 4 : -4,
            text: ref.name, showarrow: false,
            font: { size: 10, color: '#6c757d' },
        },
    };
}

/**
 * Largest density value above the log floor, for the log axis top.
 *
 * A loop rather than `Math.max(...arr)`: the spread form passes every element as
 * an argument, and a portfolio carries 2**16 points per unit across half a dozen
 * units, which is a RangeError rather than a slow path.
 */
function massMax(series) {
    let hi = 0;
    for (const s of series) {
        for (const v of s.mass) if (v > hi) hi = v;
    }
    return hi > LOG_FLOOR ? hi : logMin() * 10;
}

/** The tail panel's y values, already floored and mode-switched upstream. */
function tailTrace(name, loss, tailProb, i, asRP, solo) {
    const color = seriesColor(i);
    const xs = [];
    const ys = [];
    for (let k = 0; k < loss.length; k++) {
        const p = tailProb[k];
        // The same LOG_FLOOR gate `rightPairs` applies: a survival built by
        // `1 - cumsum` carries floating-point dust below 1e-15, which on a log
        // axis draws as a ragged fringe that reads as tail.
        if (!(p > LOG_FLOOR) || !Number.isFinite(p)) { xs.push(null); ys.push(null); continue; }
        xs.push(loss[k]);
        ys.push(asRP ? 1 / p : p);
    }
    return {
        name, x: xs, y: ys,
        type: 'scattergl', mode: 'lines',
        xaxis: 'x2', yaxis: 'y2',
        line: { color, width: lineWidth() },
        legendgroup: name,
        // One legend entry per unit, not two. Plotly toggles per trace, so the
        // tail trace joins its density trace's group and stays out of the
        // legend; clicking the unit then hides it in both panels at once, which
        // is what the ECharts legend does natively.
        showlegend: false,
        hovertemplate: `%{y:.3e}<extra>${name}</extra>`,
        connectgaps: false,
    };
}

/** The density panel's trace: steps, filled when it is the only curve. */
function densityTrace(name, loss, mass, i, solo, logY) {
    const color = seriesColor(i);
    const ys = logY ? mass.map((v) => (v > LOG_FLOOR ? v : null)) : mass;
    return {
        name, x: loss, y: ys,
        type: 'scattergl', mode: 'lines',
        xaxis: 'x', yaxis: 'y',
        // `hvh` is Plotly's centered step, the same shape as matplotlib's
        // `drawstyle='steps-mid'` and ECharts' `step: 'middle'`. Every value in
        // the frame is the mass in one bucket, so joining two with a slope draws
        // probability at values between grid points that carry none.
        line: { color, width: lineWidth(), shape: 'hvh' },
        // No fill under a log axis: the shaded region would run to the axis
        // floor rather than to zero, which is a different and false area.
        fill: (solo && !logY) ? 'tozeroy' : 'none',
        fillcolor: fade(color, 0.10),
        legendgroup: name,
        showlegend: !solo,
        hovertemplate: `%{y:.3e}<extra>${name}</extra>`,
        connectgaps: false,
    };
}

/**
 * Assemble the Plotly figure from the shared two-panel bundle.
 *
 * Parameters
 * ----------
 * d : object
 *     The `twoPanelData` result. Read, never recomputed.
 *
 * Returns
 * -------
 * {data, layout, config}
 */
export function plotlyFigure(d) {
    const {
        loss, series, box, solo, asRP, logRight, twin, window, sLo, sHi,
        densRefs, tailRefs, densityTitle, densityName, tailNames, tailTitle,
        logY,
    } = d;
    const dom = domains(box);

    const data = [
        ...series.map((s, i) => densityTrace(s.name, loss, s.mass, i, solo, logY)),
        ...series.map((s, i) => tailTrace(s.name, loss, s.tailProb, i, asRP, solo)),
    ];

    const shapes = [];
    const annotations = [];
    for (const r of densRefs) {
        const { shape, annotation } = verticalMark(r, 'x', 'y');
        shapes.push(shape);
        annotations.push(annotation);
    }
    for (const r of tailRefs) {
        const { shape, annotation } = verticalMark(r, 'x2', 'y2');
        shapes.push(shape);
        annotations.push(annotation);
    }

    // Panel titles, positioned where ECharts puts them: left-aligned over the
    // panel, just above its top edge.
    for (const [text, xd, yd] of [[densityTitle, dom.x1, dom.y1],
                                  [tailTitle, dom.x2, dom.y2]]) {
        annotations.push({
            xref: 'paper', yref: 'paper', x: xd[0], y: yd[1] + 0.045,
            xanchor: 'left', yanchor: 'bottom', text, showarrow: false,
            font: { size: 12, color: '#212529', family: 'inherit' },
        });
    }

    const axisBase = {
        showline: true, linecolor: '#dee2e6', zeroline: false,
        gridcolor: '#f1f3f5', tickfont: { size: 10, color: '#6c757d' },
        titlefont: { size: 11, color: '#6c757d' },
        automargin: false,
    };

    // Plotly log axes take their `range` in **exponents**, not values. Handing
    // it 1e-15 where it wants -15 silently collapses the axis, and it is the one
    // mapping in this file that would otherwise look right in code and wrong on
    // screen.
    const logRange = (lo, hi) => [Math.log10(lo), Math.log10(hi)];

    const layout = {
        height: box.hostHeight,
        margin: { l: 0, r: 0, t: 0, b: 0 },
        paper_bgcolor: '#fff',
        plot_bgcolor: '#fff',
        showlegend: !solo,
        legend: {
            orientation: 'h', x: 0, y: -0.02, yanchor: 'top',
            font: { size: 11, color: '#495057' },
        },
        hovermode: 'x unified',
        shapes,
        annotations,
        xaxis: {
            ...axisBase, domain: dom.x1, anchor: 'y', title: { text: 'loss' },
            ...(window ? { range: window } : {}),
            tickformat: null, hoverformat: '.4g',
        },
        yaxis: {
            ...axisBase, domain: dom.y1, anchor: 'x',
            title: { text: densityName },
            ...(logY ? { type: 'log', range: logRange(logMin(), massMax(series)) }
                     : { rangemode: 'tozero' }),
            exponentformat: 'e',
        },
        // Loss on x in BOTH panels, always. The tail panel is the same book seen
        // through its tail rather than a transposed picture of it.
        xaxis2: {
            ...axisBase, domain: dom.x2, anchor: 'y2', title: { text: 'loss' },
            ...(window ? { range: window } : {}),
            hoverformat: '.4g',
            // Stacked: the two panels share the loss axis, so dragging one
            // pans the other, which is what the linked ECharts dataZoom does.
            ...(dom.sideBySide ? {} : { matches: 'x' }),
        },
        yaxis2: {
            ...axisBase, domain: dom.y2, anchor: 'x2',
            title: { text: asRP ? tailNames[1] : tailNames[0] },
            ...(logRight
                ? { type: 'log',
                    range: asRP ? logRange(1 / sHi, 1 / sLo) : logRange(sLo, sHi) }
                : { range: asRP ? [1 / sHi, 1 / sLo] : [0, sHi] }),
            exponentformat: 'e',
        },
    };

    if (twin) {
        // The reciprocal reading on the right of the tail panel. `autorange:
        // 'reversed'` is Plotly's `inverse`: it puts 1-in-1 opposite S = 1, so
        // T = 1/S holds gridline for gridline rather than approximately.
        layout.yaxis3 = {
            ...axisBase,
            domain: dom.y2, anchor: dom.sideBySide ? 'x2' : 'x2',
            overlaying: 'y2', side: 'right',
            title: { text: asRP ? tailNames[0] : tailNames[1] },
            type: 'log',
            range: asRP ? logRange(sLo, sHi) : logRange(1 / sHi, 1 / sLo),
            autorange: 'reversed',
            showgrid: false, exponentformat: 'e',
        };
    }

    return {
        data,
        layout,
        config: {
            displaylogo: false,
            responsive: false,          // the host is sized by the layout box
            // The house toolbar: keep zoom and reset, drop the rest. Plotly's
            // full modebar is eleven buttons, most of which do nothing useful
            // for a density.
            modeBarButtonsToRemove: [
                'select2d', 'lasso2d', 'autoScale2d', 'toggleSpikelines',
                'hoverClosestCartesian', 'hoverCompareCartesian', 'zoom2d',
            ],
            scrollZoom: true,
        },
    };
}

/**
 * Draw a figure into `host` and hand back the same handle shape the ECharts
 * mount returns, so the caller does not care which engine it got.
 */
export async function mountPlotly(host, figure) {
    await Plotly.newPlot(host, figure.data, figure.layout, figure.config);
    return {
        async update(next) {
            await Plotly.react(host, next.data, next.layout, next.config);
        },
        dispose() {
            try { Plotly.purge(host); } catch { /* already gone */ }
        },
    };
}
