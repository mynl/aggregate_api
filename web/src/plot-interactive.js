// Interactive density + exceedance plot for the Overview tab (uPlot).
//
// The front-page "wow": a zero-server-render exhibit fed straight from the
// density_df JSON (loss, p_total, F, S). Two y-scales share one x (loss):
// the aggregate density on the left, the exceedance probability S = 1 - F on
// the right. A cursor crosshair reads loss <-> exceedance; vertical markers
// flag the 1-in-100 / 200 / 250 return periods (VaR from tail_df).
//
// Publication-quality export stays on the Plot tab (server matplotlib SVG);
// this is the live, on-page reading instrument.

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { el } from './utils/dom.js';
import { fmt } from './utils/format.js';

// Return periods to flag on the density axis (the capital anchors first).
const MARKER_PERIODS = [100, 200, 250];

/**
 * Mount an interactive density / exceedance chart into `host`.
 *
 * Parameters
 * ----------
 * host : HTMLElement
 *     Mount point (already attached, so uPlot can size to its width).
 * density : {columns, rows}
 *     density_df payload; needs `loss` plus `p_total` and/or `F` / `S`.
 * tail : {columns, rows} or null
 *     tail_df payload; supplies VaR at the marker return periods. Optional --
 *     without it the markers are simply omitted.
 *
 * Returns
 * -------
 * uPlot or null
 *     The chart instance, or null when the frame lacks a usable loss axis
 *     (the caller treats null as "nothing to draw" and moves on).
 */
export function mountInteractivePlot(host, density, tail) {
    const col = colIndexer(density);
    const iLoss = col('loss');
    if (iLoss < 0 || !density.rows || !density.rows.length) return null;

    const loss = density.rows.map((r) => Number(r[iLoss]));
    const dens = column(density, 'p_total');
    // Cumulative F(loss), reused for the exceedance series and the x-window.
    const cdf = cumulativeF(density);
    // Exceedance S = 1 - F; prefer an explicit S column, else derive from F.
    let surv = column(density, 'S');
    if (!surv) surv = cdf ? cdf.map((v) => 1 - v) : null;

    const series = [{}];          // x (loss) -- no style
    const data = [loss];
    // Crop the x-axis to a sensible density window (mirrors aggregate's
    // Aggregate._limits / q(0.999)) so a heavy tail doesn't squash the visible
    // mass into a sliver. Drag still zooms; auto-fit when there's no cdf to crop.
    // NB: a deliberate one-off -- computed here from the F we already ship rather
    // than round-tripping the library. Not a pattern to extend; prefer
    // server/library-provided values elsewhere.
    const scales = { x: { time: false } };
    const xr = densityXRange(loss, cdf);
    if (xr) scales.x.range = xr;
    if (dens) {
        series.push({
            label: 'density', scale: 'd', stroke: '#0d6efd', width: 1.5,
            fill: 'rgba(13,110,253,0.10)', points: { show: false },
        });
        data.push(dens.map(Number));
        scales.d = { auto: true };
    }
    if (surv) {
        series.push({
            label: 'exceedance', scale: 's', stroke: '#dc3545', width: 1.5,
            points: { show: false },
            value: (_u, v) => (v == null ? '' : fmt(v)),
        });
        data.push(surv.map(Number));
        scales.s = { range: [0, 1] };
    }
    if (data.length === 1) return null;   // neither density nor exceedance

    const markers = tail ? tailMarkers(tail) : [];

    const opts = {
        width: host.clientWidth || 720,
        height: 300,
        scales,
        legend: { live: true },
        cursor: { y: false, drag: { x: true, y: false } },
        series,
        axes: [
            { label: 'loss', values: (_u, vs) => vs.map(fmt) },
            { scale: 'd', label: 'density', values: (_u, vs) => vs.map((v) => v.toExponential(1)) },
            { scale: 's', label: 'exceedance', side: 1, grid: { show: false },
              values: (_u, vs) => vs.map((v) => v.toFixed(2)) },
        ],
        hooks: { draw: [(u) => drawMarkers(u, markers)] },
    };

    const chart = new uPlot(opts, data, host);
    // Reflow to the container width on resize (uPlot doesn't auto-track).
    const ro = new ResizeObserver(() => {
        const w = host.clientWidth;
        if (w && Math.abs(w - chart.width) > 1) chart.setSize({ width: w, height: 300 });
    });
    ro.observe(host);
    chart._ro = ro;               // kept so a future teardown can disconnect
    return chart;
}

/** Draw the legend chip for the return-period markers below a chart. */
export function markerLegend(tail) {
    const markers = tail ? tailMarkers(tail) : [];
    if (!markers.length) return null;
    const bits = markers.map((m) =>
        el('span', { className: 'marker-chip' }, `1-in-${m.T}: ${fmt(m.var)}`));
    return el('div', { className: 'marker-legend' }, ...bits);
}

// ---- helpers ----------------------------------------------------------

/** Vertical dashed lines + labels at each marker's VaR x-position. */
function drawMarkers(u, markers) {
    if (!markers.length) return;
    const { ctx } = u;
    const top = u.bbox.top;
    const bot = u.bbox.top + u.bbox.height;
    ctx.save();
    ctx.strokeStyle = 'rgba(33,37,41,0.45)';
    ctx.fillStyle = '#212529';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const m of markers) {
        const x = u.valToPos(m.var, 'x', true);
        if (!Number.isFinite(x) || x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bot);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillText(`1-in-${m.T}`, x, top - 2);
        ctx.setLineDash([4, 3]);
    }
    ctx.restore();
}

/** Extract {T, p, var} markers for MARKER_PERIODS from a tail_df frame. */
function tailMarkers(tail) {
    const col = colIndexer(tail);
    const iT = col('T');
    const iVaR = col('VaR');
    const iUnit = col('unit');     // portfolio tail_df: keep only the total
    if (iT < 0 || iVaR < 0 || !tail.rows) return [];
    const out = [];
    for (const r of tail.rows) {
        if (iUnit >= 0 && String(r[iUnit]) !== 'total') continue;
        const T = Number(r[iT]);
        if (MARKER_PERIODS.includes(T)) out.push({ T, var: Number(r[iVaR]) });
    }
    return out.sort((a, b) => a.T - b.T);
}

/** Cumulative F(loss): prefer the F column, else 1 - S, else cumsum(p_total). */
function cumulativeF(density) {
    const F = column(density, 'F');
    if (F) return F.map(Number);
    const S = column(density, 'S');
    if (S) return S.map((v) => 1 - Number(v));
    const p = column(density, 'p_total');
    if (!p) return null;
    let acc = 0;
    return p.map((v) => (acc += Number(v)));
}

/**
 * A sensible density x-window, mirroring aggregate's `Aggregate._limits`: crop
 * to roughly q(0.001)..q(0.999) with 2% padding. A non-negative loss grid
 * anchors the left edge at 0; a signed P&L grid uses the low quantile. Returns
 * null (uPlot auto-fit) when there's no usable cdf or the window is degenerate.
 */
function densityXRange(loss, cdf) {
    if (!cdf || cdf.length !== loss.length || loss.length < 2) return null;
    const n = loss.length;
    let hi = Number(loss[n - 1]);
    for (let i = 0; i < n; i++) { if (cdf[i] >= 0.999) { hi = Number(loss[i]); break; } }
    const signed = Number(loss[0]) < 0;
    let lo = signed ? Number(loss[0]) : Math.min(0, Number(loss[0]));
    if (signed) {
        for (let i = 0; i < n; i++) { if (cdf[i] >= 0.001) { lo = Number(loss[i]); break; } }
    }
    if (!(hi > lo)) return null;
    const pad = 0.02 * (hi - lo);
    return [lo - pad, hi + pad];
}

/** Build a name -> column-index lookup over a {columns} frame. */
function colIndexer(frame) {
    const cols = (frame && frame.columns) || [];
    return (name) => cols.indexOf(name);
}

/** Return a frame column as a raw array, or null when absent. */
function column(frame, name) {
    const i = colIndexer(frame)(name);
    if (i < 0) return null;
    return frame.rows.map((r) => r[i]);
}
