// The Overview exhibit: one chart specification per first-class citizen.
//
// The shape for anything with a loss distribution is two linked panels:
//
//   density (what it looks like)      exceedance (what it costs)
//   x = loss, linear, cropped         x = loss, the same window
//   y = probability mass              y = exceedance probability, log
//
// Both panels read left to right in loss, which is the orientation an insurance
// reader already has in their head. The transposed form (loss against return
// period) is a toggle rather than the default: it answers "what is the 1-in-200
// number" directly, but it makes you re-orient to get there. With exceedance on
// a log y-axis, a second axis on the right of that panel reads the same curve as
// a return period, so 1e-5 and 1-in-100,000 are the same gridline and neither
// question needs a transpose.
//
// Both panels are drawn from the same row array, so a point's index means the
// same thing in each. That is what lets the cursor link exactly: hovering a
// loss on the left highlights the same loss on the right, because they are
// literally the same grid bucket seen two ways. Points the right panel cannot
// show are emitted as `null` rather than omitted, so the indices stay aligned
// and ECharts draws a clean trailing gap.
//
// A kind with no loss distribution gets its own single-panel exhibit, and those
// are drawn **square**: a distortion's g(s) lives on the unit square, so
// stretching it wide misrepresents concavity, which is the only thing anyone
// looks at a distortion to see. The bivariate heatmap is square for the same
// reason, that a 1000-by-300 joint density lies about where the mass sits.
//
// Every other panel is drawn at the **house aspect**, `FIG_W / FIG_H` from
// `aggregate.constants`, served alongside the colors on /v1/meta/style. The
// panels here and the matplotlib ones on the Plot tab are then the same shape as
// well as the same palette, which is most of what makes two renderers read as
// one instrument.
//
// The registry is total over the six kinds, so the Overview always lands on
// something rather than reporting that it has nothing to draw.

import { api } from '../api.js';
import { el, empty } from '../utils/dom.js';
import { fmt } from '../utils/format.js';
import {
    echarts, baseOption, axisStyle, seriesColor, fade, lineWidth, houseStyle,
    logMin, LOG_FLOOR,
} from './theme.js';
import { loadSurface, surfaceGrid, surfaceOption } from './surface.js';

// Set once `loadSurface()` has resolved. Read synchronously inside a `build()`,
// which must stay pure, so the async part happens in the mount and this is the
// flag it leaves behind. False means the flat heatmap, which is also the answer
// when WebGL is unavailable or the chunk failed to load.
let surfaceReady = false;

// Return periods marked on the tail panel. **Two**, not three: 1-in-100 and
// 1-in-250 sit far enough apart to label, and adding 1-in-200 between them put
// three labels in a space that fits two. The pair still spans the regulatory
// range (Solvency II reads 1-in-200, the US 1-in-250), and the tooltip gives any
// other return period on demand.
//
// The first label is right-aligned to its line and the second left-aligned, so
// they open away from each other and cannot collide even when the two lines are
// close.
const ANCHORS = [100, 250];

// The anchor carried onto the density panel as a reference line. One, not two:
// the point there is to say where capital sits, and a second dashed vertical
// says it again.
const REF_ANCHOR = 200;

// The return-period window runs from an annual event out to 1-in-100,000. Past
// that the survival function is FFT noise rather than tail, and plotting it
// would invite reading precision that is not there.
const T_MIN = 1;
const T_MAX = 1e5;

// Side-by-side needs room for two readable axes; below this the panels stack.
const WIDE_PX = 720;

// ---- panel geometry, in CSS pixels -------------------------------------
//
// Every number here is chrome around the plot area: the plot area itself is
// sized from the host width and the house aspect, never hardcoded. That is the
// whole point, since a hardcoded height is what made the stacked layout come out
// at roughly 3.5:1 against a house ratio of 1.43:1.

const AXIS_LEFT = 58;      // y-axis name + tick labels
const AXIS_BOTTOM = 46;    // x-axis name + tick labels
const PAD_RIGHT = 18;
const PAD_TOP = 26;        // the panel title strip
const GAP_X = 76;          // between side-by-side panels: the right one's axis
const GAP_Y = 30;          // between stacked panels, on top of AXIS_BOTTOM
const LEGEND_H = 24;
const RP_AXIS = 52;        // the return-period twin on the right of panel 2

// Clamps on the computed plot-area height. The aspect rules between them; these
// stop a very wide window from producing a panel taller than the viewport and a
// very narrow one from producing a letterbox.
const PANEL_MIN_H = 130;
const PANEL_MAX_H = 380;

// The target panel shape, **width to total vertical footprint**: the plot area
// plus the title strip above it and the axis below it, which is what the panel
// occupies on the page.
//
// a26 applied the house `FIG_W / FIG_H` (3.5 / 2.45, so 4:2.8) to the plot area
// alone, and the chrome then made the *footprint* about 4:3.8. That is what read
// as too tall. Measuring the footprint is also the fairer comparison with
// matplotlib, where `FIG_W x FIG_H` is the whole figure including its margins,
// not the axes box.
//
// 4:3.25 is the author's number. The house figure ratio is 4:2.8 if a closer
// match to the Plot tab is ever wanted; one constant, and `aspect()` from the
// style endpoint is still there to supply it.
const PANEL_ASPECT = 4 / 3.25;

// Bounds on the square plot area used by the single-panel exhibits.
const SQUARE_MIN = 240;
const SQUARE_MAX = 420;

// The density is drawn as steps, always. `step: 'middle'` is matplotlib's
// `drawstyle='steps-mid'`: the value holds across a bucket centered on its grid
// point, which is what a discretized density *is*. Every value in the frame is
// the mass in one bucket, not a sample of a smooth curve, so joining two of them
// with a slope draws probability at values between grid points that carry none.
//
// This used to be conditional, on a count of nonzero points, which was a guess
// at "is this discrete". The guess is unnecessary: steps are correct for the
// coarse case and correct for the fine case, where at 2**16 points a bucket is
// sub-pixel and steps and lines are indistinguishable anyway. A condition that
// can only be wrong in one direction should not be a condition.

// ---- view state -------------------------------------------------------
//
// Sticky per browser, like the Static | Interactive table toggle: a chosen view
// survives a rebuild and a reload, so you are not re-clicking log-y every time
// you press Build.

// Bumped from v1: the default orientation changed (survival, not the transpose)
// and a second log-y toggle arrived, so a stored v1 state would restore a view
// nobody chose. A fresh key retires it without a migration.
const VIEW_KEY = 'aggapi.exhibitView.v2';

const VIEW_DEFAULTS = {
    logY: false,        // density panel: linear or log mass
    epMode: 'survival', // right panel: 'survival' (S vs loss) or 'rp' (the transpose)
    rightLogY: true,    // right panel: log or linear y
    xFull: false,       // density x: cropped to q(0.001)..q(0.999), or the full grid
    refLines: true,     // mean and the 1-in-200 anchor, drawn on both panels
    surface3d: true,    // bivariate: 3-D relief, or the flat heatmap
    logZ: true,         // bivariate surface: log or linear height
};

let view = (() => {
    try {
        return { ...VIEW_DEFAULTS, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
    } catch {
        return { ...VIEW_DEFAULTS };
    }
})();

function setView(patch) {
    view = { ...view, ...patch };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* private mode */ }
}

// What each toggle says, and how to read its pressed state. A spec declares the
// subset it honors, so a distortion never shows a log-y button that does
// nothing.
//
// `logY` and `rightLogY` are the same word twice on purpose: they are the same
// operation applied to two different panels, and the reader tells them apart by
// which panel the button sits over, not by a longer label.
const CONTROLS = {
    logY: {
        label: 'log y',
        title: 'Log density: where a heavy tail becomes readable',
    },
    xFull: {
        label: 'full x',
        title: 'Show the whole grid, not just q(0.001) to q(0.999)',
    },
    refLines: {
        label: 'reference lines',
        title: 'Mean and the 1-in-200 anchor, on both panels',
    },
    epMode: {
        label: 'return period',
        title: 'Transpose: loss against return period, rather than exceedance '
            + 'against loss',
        on: () => view.epMode === 'rp',
        toggle: () => ({ epMode: view.epMode === 'rp' ? 'survival' : 'rp' }),
    },
    rightLogY: {
        label: 'log y',
        title: 'Log axis on the exceedance panel; also carries the '
            + 'return-period scale',
    },
    surface3d: {
        label: '3D surface',
        title: 'Render the joint density in relief. Drag to rotate, scroll to '
            + 'zoom. Dependence is a ridge off the diagonal, which a flat map '
            + 'can only imply',
    },
    logZ: {
        label: 'log height',
        title: 'Log height scale. A joint density spans four or five orders of '
            + 'magnitude, so on a linear axis everything but the mode is floor',
    },
};

// Which panel each control drives. Rendered in this order with a rule between
// the groups, so a button sits over the panel it changes rather than in one
// undifferentiated row where the reader has to try each to find out.
const CONTROL_GROUPS = [
    { key: 'left', controls: ['logY', 'xFull'] },
    { key: 'both', controls: ['refLines', 'surface3d', 'logZ'] },
    { key: 'right', controls: ['epMode', 'rightLogY'] },
];

// ---- frame helpers ----------------------------------------------------

/** Build a name -> column-index lookup over a {columns, rows} frame. */
function indexer(frame) {
    const cols = (frame && frame.columns) || [];
    return (name) => cols.indexOf(name);
}

/** A frame column as a Number array, or null when the column is absent. */
function col(frame, name) {
    const i = indexer(frame)(name);
    if (i < 0 || !frame.rows) return null;
    return frame.rows.map((r) => Number(r[i]));
}

/** Column names matching `prefix`, with the prefix stripped. */
function suffixes(frame, prefix) {
    return ((frame && frame.columns) || [])
        .filter((c) => c.startsWith(prefix))
        .map((c) => c.slice(prefix.length));
}

/** The `VaR` at return period `T` for the total, from a tail_df payload. */
function varAt(tail, T) {
    if (!tail || !tail.rows) return null;
    const at = indexer(tail);
    const iT = at('T');
    const iVaR = at('VaR');
    const iUnit = at('unit');
    if (iT < 0 || iVaR < 0) return null;
    for (const r of tail.rows) {
        if (iUnit >= 0 && String(r[iUnit]) !== 'total') continue;
        if (Number(r[iT]) === T) return Number(r[iVaR]);
    }
    return null;
}

// ---- series builders --------------------------------------------------

/**
 * Right-panel points, index-aligned with `loss`.
 *
 * Loss is the x value in **both** modes; only y changes, between `S(x)` and its
 * reciprocal as a return period. Same curve, two readings, never a transpose: a
 * reader following a loss across the two panels should not have to swap axes to
 * do it. A probability outside the plotted window becomes `null` rather than
 * being dropped, so a dataIndex still identifies the same grid bucket in both
 * panels.
 *
 * Parameters
 * ----------
 * loss : number[]
 * tailProb : number[]
 *     Survival probability per row. `S` for a loss distribution; `F` for a
 *     signed P&L, where the bad tail is the low end.
 * mode : {'rp', 'survival'}
 */
function rightPairs(loss, tailProb, mode) {
    return loss.map((x, i) => {
        const p = tailProb[i];
        // LOG_FLOOR, not zero: a survival built by `1 - cumsum` over thousands
        // of terms carries floating-point dust below 1e-15, and on a log axis
        // that dust draws as a ragged fringe that reads as tail.
        if (!(p > LOG_FLOOR) || !Number.isFinite(p)) return null;
        if (mode !== 'rp') return [x, p];
        const T = 1 / p;
        if (!(T >= T_MIN) || T > T_MAX) return null;
        return [x, T];
    });
}

/**
 * The survival-axis window, `[lo, 1]`, as whole decades.
 *
 * Fixing the axis at `[1/T_MAX, 1]` would be simpler but wastes the panel on a
 * light-tailed book: three dice have a minimum survival near 5e-3, so two and a
 * half decades would draw empty. Rounding the observed minimum down to a decade
 * keeps the gridlines on round numbers, which is what makes the return-period
 * twin legible.
 */
function survivalRange(series) {
    let lo = 1;
    for (const s of series) {
        for (const p of s.tailProb) {
            if (p > LOG_FLOOR && p < lo) lo = p;
        }
    }
    lo = Math.max(1 / T_MAX, lo);
    return [10 ** Math.floor(Math.log10(lo)), 1];
}

/**
 * Crop the density x-axis to roughly q(0.001) to q(0.999), mirroring
 * `Aggregate._limits`.
 *
 * A heavy tail otherwise squashes all the visible mass into a sliver at the
 * origin. Returns null (auto-fit) when there is no usable cdf, or when the
 * `full x` toggle is on, in which case the whole grid is deliberately shown.
 */
function densityWindow(loss, cdf) {
    if (view.xFull) return null;
    if (!cdf || cdf.length !== loss.length || loss.length < 2) return null;
    const n = loss.length;
    let hi = loss[n - 1];
    for (let i = 0; i < n; i++) { if (cdf[i] >= 0.999) { hi = loss[i]; break; } }
    const signed = loss[0] < 0;
    let lo = signed ? loss[0] : Math.min(0, loss[0]);
    if (signed) {
        for (let i = 0; i < n; i++) { if (cdf[i] >= 0.001) { lo = loss[i]; break; } }
    }
    if (!(hi > lo)) return null;
    const pad = 0.02 * (hi - lo);
    return [lo - pad, hi + pad];
}

/** One density line, filled under the curve when it is the only one. */
function densitySeries(name, loss, mass, i, solo) {
    const color = seriesColor(i);
    // A log axis cannot place zero, and the tail of a discretized density is
    // full of exact zeros and of FFT dust below 1e-15. Emit both as gaps rather
    // than letting ECharts drop them silently or clamp them onto the axis floor.
    const y = view.logY ? mass.map((v) => (v > LOG_FLOOR ? v : null)) : mass;
    return {
        name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        step: 'middle',
        data: loss.map((x, k) => (y[k] == null ? null : [x, y[k]])),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: lineWidth(), color },
        itemStyle: { color },
        // No fill under a log axis: the shaded region would run to the axis
        // floor rather than to zero, which is a different (and false) area.
        areaStyle: (solo && !view.logY) ? { color: fade(color, 0.10) } : undefined,
        emphasis: { focus: 'series' },
    };
}

/** One right-panel line. */
function rightSeries(name, loss, tailProb, i) {
    const color = seriesColor(i);
    return {
        name,
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: rightPairs(loss, tailProb, view.epMode),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: lineWidth(), color },
        itemStyle: { color },
        emphasis: { focus: 'series' },
    };
}

/** A return period as a reader says it: `1-in-200`, never `1-in-200.0000003`. */
function returnPeriod(T) {
    return T >= 10 ? String(Math.round(T)) : T.toFixed(1);
}

/**
 * Capital-anchor lines for the right panel, read from `tail_df`.
 *
 * Dashed verticals at each anchor's VaR, labeled at the top, not plotted points.
 * A point has to sit exactly on the drawn curve to look right, and it cannot:
 * the anchor is the library's own quantile function while the curve is a plotted
 * grid, so the marker landed slightly off the line every time. A vertical says
 * "the 1-in-200 loss is here", which is a statement about the x-axis and reads
 * correctly regardless.
 *
 * `tail_df` stays the source for the same reason as before: where it and the
 * plotted curve differ, the library is right.
 */
function anchorLines(tail) {
    if (!tail || !tail.rows) return [];
    const at = indexer(tail);
    const iT = at('T');
    const iVaR = at('VaR');
    const iUnit = at('unit');
    if (iT < 0 || iVaR < 0) return [];
    const found = new Map();
    for (const r of tail.rows) {
        if (iUnit >= 0 && String(r[iUnit]) !== 'total') continue;
        const T = Number(r[iT]);
        if (!ANCHORS.includes(T)) continue;
        // Both modes now put loss on x, so an anchor is a vertical at its VaR
        // in either. The return period only names the line.
        const x = Number(r[iVaR]);
        if (Number.isFinite(x)) found.set(T, x);
    }
    // Ordered by ANCHORS, not by frame order, so "first" and "second" mean the
    // same thing every time and the label sides stay put.
    return ANCHORS.filter((T) => found.has(T)).map((T, i) => ({
        xAxis: found.get(T),
        name: `1-in-${returnPeriod(T)}`,
        lineStyle: { color: '#6c757d', type: 'dashed', width: 1, opacity: 0.45 },
        label: {
            // Inside the plot at the top, not above it: `position: 'end'` put
            // the text over the panel's upper edge, where it collided with the
            // title. For a vertical markLine, "end" is the top.
            position: 'insideEndTop',
            // First anchor's text runs left of its line, second's runs right, so
            // two labels near each other open in opposite directions.
            align: i === 0 ? 'right' : 'left',
            padding: i === 0 ? [0, 5, 0, 0] : [0, 0, 0, 5],
        },
    }));
}

/**
 * A dashed reference line. Entries may override `lineStyle` and `label` per
 * item, which is how the faint capital anchors and the solid-weight mean share
 * one markLine and still place their labels differently.
 *
 * Labels sit **inside** the plot at the top. Outside (`position: 'end'`) put
 * them over the panel's upper edge, on top of the title.
 */
function refLine(entries) {
    if (!entries.length) return undefined;
    return {
        symbol: 'none',
        silent: true,
        label: {
            show: true, fontSize: 10, color: '#6c757d',
            position: 'insideEndTop', distance: 3, formatter: (p) => p.name,
        },
        lineStyle: { color: '#6c757d', type: 'dashed', width: 1 },
        data: entries,
    };
}

// ---- the two-panel option ---------------------------------------------

/**
 * Panel geometry, sized so each panel's **footprint** is at `PANEL_ASPECT`.
 *
 * The width falls out of the host and the chrome. The height then comes from the
 * footprint target with the per-panel chrome (title strip plus axis) taken back
 * out, so what holds the ratio is the space the panel occupies rather than the
 * plot rectangle inside it.
 *
 * Exported because the mount reserves the host height from it **before** the
 * data arrives. A chart that sizes itself on arrival makes the page jump, and
 * everything below it move, at the exact moment the reader started looking.
 *
 * Parameters
 * ----------
 * width : number
 *     Host width in CSS pixels. Zero (not yet laid out) falls back to a sane
 *     default rather than collapsing the panel.
 * wide : bool
 *     Side by side, or stacked.
 * twin : bool
 *     Whether the tail panel carries its twin axis, which needs its own strip of
 *     right-hand margin.
 *
 * Returns
 * -------
 * {grids, panelW, panelH, height}
 *     `grids` are two ECharts grid objects with numeric geometry, `height` the
 *     host height the whole thing needs.
 */
export function panelGeometry(width, wide, twin = true) {
    const w = width || 900;
    const rightPad = PAD_RIGHT + (twin ? RP_AXIS : 0);
    const panelW = wide
        ? Math.max(160, (w - AXIS_LEFT - GAP_X - rightPad) / 2)
        : Math.max(200, w - AXIS_LEFT - rightPad);
    // Vertical chrome that belongs to one panel and sits inside its footprint.
    const chrome = PAD_TOP + AXIS_BOTTOM;
    const panelH = Math.max(PANEL_MIN_H,
        Math.min(PANEL_MAX_H, panelW / PANEL_ASPECT - chrome));

    const grids = wide
        ? [{ left: AXIS_LEFT, top: PAD_TOP, width: panelW, height: panelH },
           { left: AXIS_LEFT + panelW + GAP_X, top: PAD_TOP,
             width: panelW, height: panelH }]
        : [{ left: AXIS_LEFT, top: PAD_TOP, width: panelW, height: panelH },
           { left: AXIS_LEFT, top: PAD_TOP + panelH + AXIS_BOTTOM + GAP_Y,
             width: panelW, height: panelH }];
    const bottom = Math.max(...grids.map((g) => g.top + g.height));
    return {
        grids, panelW, panelH,
        // What `PANEL_ASPECT` is measured against, carried out so a test can
        // check the ratio that was actually targeted rather than re-deriving it
        // from constants it would have to duplicate.
        footprint: chrome + panelH,
        height: bottom + AXIS_BOTTOM + LEGEND_H,
    };
}

export { PANEL_ASPECT };

/**
 * The host height a two-panel exhibit will need at this width.
 *
 * Called before the fetch so the space is already reserved. It assumes the twin
 * axis, which is the default view; being 52 px out on a non-default toggle is
 * invisible next to the jump this exists to prevent.
 */
export function reservedHeight(width) {
    return Math.round(panelGeometry(width, (width || 0) >= WIDE_PX, true).height);
}

/**
 * Assemble the two-panel option from per-series density and right-panel data.
 *
 * Series in the two panels share a `name`, which is what makes one legend entry
 * toggle a unit in both panels at once.
 */
function twoPanel({
    loss, cdf, series, tail, wide, width, mean, zeroLine,
}) {
    const solo = series.length === 1;
    const asRP = view.epMode === 'rp';
    const logRight = Boolean(view.rightLogY);
    // The twin axis only lines up against a log primary: T = 1/p is log-linear
    // in p, so on a linear axis the two scales would not correspond and the twin
    // would be decoration that lies.
    const twin = logRight;

    const density = series.map((s, i) => densitySeries(s.name, loss, s.mass, i, solo));
    const right = series.map((s, i) => rightSeries(s.name, loss, s.tailProb, i));

    // Reference lines go on the first series of each panel, so they draw once.
    // Both panels are on the loss axis, so every one of them is a vertical.
    const dens = [];
    const rightRefs = anchorLines(tail);
    if (zeroLine != null) dens.push({ xAxis: zeroLine, name: 'break even' });
    if (view.refLines) {
        const anchorVaR = varAt(tail, REF_ANCHOR);
        if (Number.isFinite(mean)) {
            dens.push({ xAxis: mean, name: 'mean' });
            rightRefs.push({ xAxis: mean, name: 'mean' });
        }
        if (Number.isFinite(anchorVaR)) {
            dens.push({ xAxis: anchorVaR, name: `1-in-${REF_ANCHOR}` });
        }
    }
    if (dens.length) density[0].markLine = refLine(dens);
    if (rightRefs.length && right.length) right[0].markLine = refLine(rightRefs);

    const window = densityWindow(loss, cdf);
    const { grids, height, footprint } = panelGeometry(width, wide, twin);
    const [sLo, sHi] = survivalRange(series);

    // Loss on x in BOTH panels, always. The right panel is the same book seen
    // through its tail rather than a transposed picture of it, so the two read
    // as one exhibit and the eye never has to swap axes to follow a loss across.
    const rightX = axisStyle({
        gridIndex: 1, type: 'value', name: 'loss', scale: true,
        min: window ? window[0] : 'dataMin',
        max: window ? window[1] : 'dataMax',
        axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                     formatter: (v) => fmt(v) },
    });

    // The toggle changes the y-axis only: S(x), or its reciprocal as a return
    // period. Same curve, two readings, and whichever is not primary is the
    // twin on the right, so both are always legible.
    const survivalAxis = (extra = {}) => axisStyle({
        gridIndex: 1, name: 'S(x)',
        ...(logRight ? { type: 'log', logBase: 10, min: sLo, max: sHi }
                     : { type: 'value', min: 0, max: sHi }),
        axisLabel: { fontSize: 10, color: '#6c757d',
                     formatter: (v) => (v >= 0.01 ? String(v) : v.toExponential(0)) },
        ...extra,
    });
    const returnAxis = (extra = {}) => axisStyle({
        gridIndex: 1, name: 'return period', nameGap: 34,
        ...(logRight ? { type: 'log', logBase: 10, min: 1 / sHi, max: 1 / sLo }
                     : { type: 'value', min: 1 / sHi, max: 1 / sLo }),
        axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                     formatter: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k`
                                                  : returnPeriod(v)) },
        ...extra,
    });

    const yAxes = [
        axisStyle({
            gridIndex: 0, type: view.logY ? 'log' : 'value',
            name: view.logY ? 'log density' : 'density', scale: true,
            ...(view.logY ? { min: logMin() } : {}),
            axisLabel: { fontSize: 10, color: '#6c757d',
                         formatter: (v) => (v ? v.toExponential(0) : '0') },
        }),
        asRP ? returnAxis() : survivalAxis(),
    ];
    if (twin) {
        // `inverse` on the return-period side puts 1-in-1 at the top against
        // S = 1, and both axes span the same whole decades, so T = 1/S holds
        // gridline for gridline rather than approximately.
        yAxes.push(asRP
            ? survivalAxis({ position: 'right', inverse: true,
                             splitLine: { show: false } })
            : returnAxis({ position: 'right', inverse: true,
                           splitLine: { show: false } }));
    }

    const option = {
        ...baseOption(),
        grid: grids,
        title: [
            { text: 'Density', left: grids[0].left, top: grids[0].top - 24,
              textStyle: { fontSize: 12, fontWeight: 600 } },
            // "Survival", not "EP curve": EP is a term of art in catastrophe
            // modeling (OEP / AEP, occurrence and aggregate exceedance
            // probability) and this is neither. It is S(x) = P(X > x).
            { text: asRP ? 'Return period' : 'Survival',
              left: grids[1].left, top: grids[1].top - 24,
              textStyle: { fontSize: 12, fontWeight: 600 } },
        ],
        legend: { ...baseOption().legend, show: !solo, data: series.map((s) => s.name) },
        xAxis: [
            axisStyle({
                gridIndex: 0, type: 'value', name: 'loss', scale: true,
                min: window ? window[0] : 'dataMin',
                max: window ? window[1] : 'dataMax',
                axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                             formatter: (v) => fmt(v) },
            }),
            rightX,
        ],
        yAxis: yAxes,
        // filterMode 'filter' drops out-of-window points from the axis extent
        // calculation, so the y-axis rescales to what is actually visible.
        // Without it, zooming into a tail zooms into a flat strip near zero.
        dataZoom: [
            { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
            { type: 'inside', xAxisIndex: 1, filterMode: 'filter' },
        ],
        tooltip: {
            ...baseOption().tooltip,
            // Cross, not a bare vertical: on the exceedance panel the y value
            // *is* the answer, so a horizontal tracking line reading it off the
            // axis is worth as much as the vertical one reading the loss.
            axisPointer: {
                type: 'cross',
                lineStyle: { color: '#adb5bd', width: 1, type: 'dashed' },
                crossStyle: { color: '#adb5bd', width: 1, type: 'dashed' },
                label: { show: false },
            },
            formatter: (params) => {
                const rows = (Array.isArray(params) ? params : [params])
                    .filter((p) => Array.isArray(p.value));
                if (!rows.length) return '';
                const first = rows[0];
                const onRight = first.seriesIndex >= density.length;
                // Loss on x in both panels now, so the head is the same
                // sentence wherever the cursor is.
                const head = `loss ${fmt(first.value[0])}`;
                const body = rows.map((p) => {
                    const v = onRight ? tailText(p.value[1], asRP)
                                      : p.value[1].toExponential(2);
                    return `${p.marker}${p.seriesName} <b>${v}</b>`;
                }).join('<br>');
                return `${head}<br>${body}`;
            },
        },
        series: [...density, ...right],
    };
    // Not ECharts keys: the mount reads `hostHeight` back so the geometry is
    // computed once and in one place, and the smoke test reads `panelFootprint`
    // to check the shape the layout was aiming for.
    option.hostHeight = height;
    option.panelFootprint = footprint;
    return option;
}

/**
 * The right panel's value, said both ways.
 *
 * Whichever of `S(x)` and the return period is on the axis, the tooltip gives
 * the other in parentheses. They are reciprocals, so showing one alone makes the
 * reader do arithmetic to answer the question they actually had.
 */
function tailText(value, asRP) {
    return asRP
        ? `1-in-${returnPeriod(value)} (S = ${(1 / value).toExponential(2)})`
        : `${value.toExponential(2)} (1-in-${returnPeriod(1 / value)})`;
}

/** Grid, title and host height for a square single-panel exhibit. */
function squareLayout(width, { left = 56, rightPad = 28 } = {}) {
    const side = Math.max(SQUARE_MIN,
        Math.min(SQUARE_MAX, (width || SQUARE_MAX) - left - rightPad));
    return { side, left, top: PAD_TOP, bottom: 52 };
}

// ---- per-kind exhibits ------------------------------------------------
//
// Each entry is {controls, fetch, build}. `fetch` gathers the frames; `build`
// turns them into an ECharts option and is pure, so the node smoke test can
// exercise it without a DOM. `controls` names the toggles the exhibit honors,
// so a distortion never offers a log-y button that would do nothing.

const TWO_PANEL_CONTROLS = ['logY', 'xFull', 'refLines', 'epMode', 'rightLogY'];

const EXHIBITS = {
    agg: {
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            const [density, tail] = await Promise.all([
                api.density_df(id, { cols: 'loss,p_total,F,S' }),
                api.tail_df(id).catch(() => null),
            ]);
            return { density, tail };
        },
        build({ density, tail }, { name, wide, width, mean }) {
            const loss = col(density, 'loss');
            const mass = col(density, 'p_total');
            const S = col(density, 'S');
            if (!loss || !mass || !S) return null;
            return twoPanel({
                loss, cdf: col(density, 'F'), tail, wide, width, mean,
                series: [{ name: name || 'aggregate', mass, tailProb: S }],
            });
        },
    },

    port: {
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            const [units, tail] = await Promise.all([
                api.unit_density_df(id),
                api.tail_df(id).catch(() => null),
            ]);
            return { units, tail };
        },
        build({ units, tail }, { wide, width, mean }) {
            const loss = col(units, 'loss');
            if (!loss) return null;
            // Units first, total last, so the total draws on top of them and
            // takes the anchor markers.
            const names = suffixes(units, 'p_').filter((n) => n !== 'total');
            const series = names.map((n) => ({
                name: n, mass: col(units, `p_${n}`), tailProb: col(units, `S_${n}`),
            })).filter((s) => s.mass && s.tailProb);
            const total = col(units, 'p_total');
            const totalS = col(units, 'S');
            if (total && totalS) series.push({ name: 'total', mass: total, tailProb: totalS });
            if (!series.length) return null;
            return twoPanel({ loss, cdf: col(units, 'F'), tail, wide, width, mean, series });
        },
    },

    sev: {
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            return { density: await api.density_df(id) };
        },
        build({ density }, { name, wide, width, mean }) {
            const loss = col(density, 'loss');
            const pdf = col(density, 'pdf');
            const S = col(density, 'S');
            if (!loss || !pdf || !S) return null;
            const option = twoPanel({
                loss, cdf: col(density, 'F'), tail: null, wide, width, mean,
                series: [{ name: name || 'severity', mass: pdf, tailProb: S }],
            });
            // A severity is a density ordinate, not a mass, and its support is
            // routinely unbounded. Say so on the axis rather than letting the
            // reader assume the aggregate's semantics.
            option.yAxis[0].name = view.logY ? 'log pdf' : 'pdf';
            option.title[0].text = 'Severity density';
            return option;
        },
    },

    pnl: {
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            return { density: await api.density_df(id, { cols: 'loss,p_total,F,S' }) };
        },
        build({ density }, { name, wide, width, mean }) {
            const loss = col(density, 'loss');
            const mass = col(density, 'p_total');
            const F = col(density, 'F');
            if (!loss || !mass || !F) return null;
            // A P&L outcome axis is signed and the bad tail is the LOW end, so
            // the return period runs off F, not S: a 1-in-200 year is the
            // outcome only 1/200 of years fall below, not above.
            const option = twoPanel({
                loss, cdf: F, tail: null, wide, width, mean, zeroLine: 0,
                series: [{ name: name || 'P&L', mass, tailProb: F }],
            });
            option.title[1].text = view.epMode === 'rp'
                ? 'Downside return period' : 'Downside probability';
            option.yAxis[1].name = view.epMode === 'rp' ? 'return period' : 'F(x)';
            return option;
        },
    },

    distortion: {
        controls: [],
        async fetch(id) {
            return { curve: await api.density_df(id) };
        },
        build({ curve }, { width }) {
            const x = col(curve, 'x');
            const g = col(curve, 'g');
            if (!x || !g) return null;
            const color = seriesColor(0);
            // Square, and both axes on [0, 1]: g(s) lives on the unit square and
            // the only thing anyone reads off it is concavity, which a stretched
            // aspect ratio misrepresents. This is `aspect='equal'`.
            const { side, left, top, bottom } = squareLayout(width);
            return {
                ...baseOption(),
                grid: { left, top, width: side, height: side },
                title: [{ text: 'Distortion g(s)', left, top: 2,
                          textStyle: { fontSize: 12, fontWeight: 600 } }],
                legend: { ...baseOption().legend, data: ['g(s)', 'identity'],
                          bottom: Math.max(0, bottom - 46) },
                xAxis: axisStyle({ type: 'value', name: 's', min: 0, max: 1 }),
                yAxis: axisStyle({ type: 'value', name: 'g(s)', min: 0, max: 1 }),
                series: [
                    {
                        name: 'g(s)', type: 'line', showSymbol: false,
                        data: x.map((v, i) => [v, g[i]]),
                        lineStyle: { width: lineWidth() + 0.4, color },
                        itemStyle: { color },
                        // The load is the area between g and the diagonal. Fill
                        // to the axis so it is the visible quantity.
                        areaStyle: { color: fade(color, 0.12), origin: 'start' },
                    },
                    {
                        name: 'identity', type: 'line', showSymbol: false,
                        data: [[0, 0], [1, 1]],
                        lineStyle: { width: 1, type: 'dashed', color: '#6c757d' },
                        itemStyle: { color: '#6c757d' },
                    },
                ],
                tooltip: {
                    ...baseOption().tooltip,
                    formatter: (ps) => {
                        const p = (Array.isArray(ps) ? ps : [ps])[0];
                        if (!p || !Array.isArray(p.value)) return '';
                        const s = p.value[0];
                        const gs = p.value[1];
                        return `s ${s.toFixed(3)}<br>g(s) <b>${gs.toFixed(4)}</b>`
                            + `<br>load <b>${(gs - s).toFixed(4)}</b>`;
                    },
                },
            };
        },
    },

    bvagg: {
        // The bivariate is the one kind whose exhibit is a 3-D surface, so it
        // gets its own controls: which renderer, and how the height is scaled.
        controls: ['surface3d', 'logZ'],
        async fetch(id) {
            // `view: 'joint'` is explicit: density_df answers a bivariate with
            // its two marginals by default, because that is what a *table* of
            // one should say. The heatmap is the one consumer that wants the
            // whole matrix.
            //
            // stats_df carries both component names as its value columns. The
            // joint frame only names axis 0 (its first column); axis 1 arrives
            // as bare grid values for column headers, so its name is not
            // recoverable from that payload alone.
            const [joint, stats] = await Promise.all([
                api.density_df(id, { view: 'joint' }),
                api.stats_df(id).catch(() => null),
            ]);
            return { joint, stats };
        },
        build({ joint, stats }, { width }) {
            const [xName, yName] = axisNames(joint, stats);
            // 3-D when the renderer is loaded and asked for; the flat heatmap
            // otherwise, so a WebGL-less browser or a failed chunk still lands
            // on a picture rather than an empty pane.
            if (view.surface3d && surfaceReady) {
                const grid = surfaceGrid(joint);
                if (grid) {
                    const { side } = squareLayout(width, { left: 20, rightPad: 90 });
                    const option = surfaceOption(grid, {
                        xName, yName, logZ: Boolean(view.logZ), side,
                    });
                    // The mount reads this back for the host height; a surface is
                    // square like the heatmap it replaces.
                    option.hostHeight = side + 60;
                    return option;
                }
            }
            const grid = heatmapData(joint, [xName, yName]);
            if (!grid) return null;
            const s = houseStyle();
            // Square for the same reason as the distortion: a joint density
            // stretched wide lies about where the mass sits. The right pad
            // leaves room for the colorbar.
            const { side, left, top } = squareLayout(width, { left: 64, rightPad: 96 });
            return {
                ...baseOption(),
                grid: { left, top, width: side, height: side },
                title: [{ text: `Joint density: ${grid.xName} vs ${grid.yName}`,
                          left, top: 2,
                          textStyle: { fontSize: 12, fontWeight: 600 } }],
                legend: { show: false },
                xAxis: axisStyle({
                    type: 'category', name: grid.xName, data: grid.xs,
                    splitLine: { show: false },
                    axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                                 formatter: (v) => fmt(Number(v)) },
                }),
                yAxis: axisStyle({
                    type: 'category', name: grid.yName, data: grid.ys, nameGap: 46,
                    splitLine: { show: false },
                    axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                                 formatter: (v) => fmt(Number(v)) },
                }),
                visualMap: {
                    min: 0, max: grid.max, left: left + side + 24, top: top + 10,
                    calculable: true, itemHeight: Math.max(90, side - 60),
                    textStyle: { fontSize: 10, color: '#6c757d' },
                    // Sequential, light to the primary color: a joint density is
                    // one-directional, so a diverging ramp would imply a
                    // midpoint that does not exist.
                    inRange: { color: ['#ffffff', fade(s.colors[0], 0.45), s.colors[0]] },
                    formatter: (v) => (v ? Number(v).toExponential(1) : '0'),
                },
                tooltip: {
                    ...baseOption().tooltip,
                    trigger: 'item',
                    formatter: (p) => `${grid.xName} ${fmt(Number(grid.xs[p.value[0]]))}`
                        + `<br>${grid.yName} ${fmt(Number(grid.ys[p.value[1]]))}`
                        + `<br>density <b>${Number(p.value[2]).toExponential(3)}</b>`,
                },
                series: [{
                    name: 'joint density', type: 'heatmap', data: grid.cells,
                    progressive: 4000, emphasis: { disabled: true },
                }],
            };
        },
    },
};

// The registry, exported for the node smoke test in dev/. `build()` is pure, so
// a test can assemble every kind's option and inspect it without a DOM.
export { EXHIBITS };

// ---- reinsurance exhibit ----------------------------------------------
//
// Not in EXHIBITS: it is keyed by tab, not by object kind, and it is the same
// two-panel instrument pointed at three views of one book rather than at units
// of a portfolio.

/**
 * What `reins_density_df` actually holds, as three selectable triples.
 *
 * The frame is not "gross, ceded, net". It is three separate gross / ceded / net
 * readings taken at different points in the program, and which one you want is a
 * real question that the exhibit should ask rather than answer silently:
 *
 * * **occurrence**, the severity views, what one claim looks like either side of
 *   the per-occurrence cover;
 * * **after occurrence**, the aggregate of each of those severity views, so
 *   `gross` here is the true gross aggregate;
 * * **after aggregate**, the aggregate cover's own subject / ceded / net, where
 *   the subject is what the occurrence program left behind.
 *
 * The last triple's first column is the library's `p_agg_subject`, and it is
 * labeled `subject` rather than `gross` for the reason its own docstring gives:
 * it equals the true gross only when there is no occurrence cover. Calling it
 * gross would quietly understate the cession whenever both stages are present.
 */
const REINS_VIEWS = {
    sev: {
        label: 'occurrence',
        title: 'Severity: one claim, gross / ceded / net of the occurrence cover',
        columns: [['p_sev_gross', 'gross'], ['p_sev_ceded', 'ceded'],
                  ['p_sev_net', 'net']],
    },
    occ: {
        label: 'after occurrence',
        title: 'Aggregate of each severity view; gross here is the true gross '
            + 'aggregate',
        columns: [['p_agg_gross', 'gross'], ['p_agg_ceded_occ', 'ceded'],
                  ['p_agg_net_occ', 'net']],
    },
    agg: {
        label: 'after aggregate',
        title: 'The aggregate cover: its subject (net of the occurrence '
            + 'program), what it cedes, and the final net',
        columns: [['p_agg_subject', 'subject'], ['p_agg_ceded', 'ceded'],
                  ['p_agg_net', 'net']],
    },
};

// Which of the three curves are drawn. Gross (or subject) first so a cession
// reads as something taken out of it, and so `net` draws on top where the two
// nearly coincide.
const REINS_PARTS = ['gross', 'ceded', 'net'];

// Sticky per browser, like the exhibit view toggles.
const REINS_KEY = 'aggapi.reinsView';
const REINS_DEFAULTS = { which: 'occ', parts: REINS_PARTS };

let reinsView = (() => {
    try {
        return { ...REINS_DEFAULTS,
                 ...JSON.parse(localStorage.getItem(REINS_KEY) || '{}') };
    } catch {
        return { ...REINS_DEFAULTS };
    }
})();

function setReinsView(patch) {
    reinsView = { ...reinsView, ...patch };
    try { localStorage.setItem(REINS_KEY, JSON.stringify(reinsView)); }
    catch { /* private mode */ }
}

/**
 * The selected triple from a `reins_density_df` payload, as plottable series.
 *
 * Exported for the offline smoke test, which checks the derived survivals
 * without needing a DOM.
 *
 * Parameters
 * ----------
 * frame : {columns, rows}
 * which : {'sev', 'occ', 'agg'}, optional
 *     Which triple. Defaults to the sticky selection.
 * parts : string[], optional
 *     Which of the three to include, by label.
 *
 * Notes
 * -----
 * The frame carries the masses but no survival column, so `S` is accumulated
 * here. That is exact rather than an approximation: each column is a probability
 * mass function over the same grid and sums to one, so `1 - cumsum` *is* its
 * survival function.
 */
export function reinsSeries(frame, which = reinsView.which, parts = reinsView.parts) {
    const spec = REINS_VIEWS[which] || REINS_VIEWS.occ;
    const keep = new Set(parts && parts.length ? parts : REINS_PARTS);
    const series = [];
    for (const [column, label] of spec.columns) {
        // `subject` answers to the `gross` button: it is that slot in the triple,
        // and a reader picking "gross" on the aggregate stage means "the thing
        // the cession comes out of".
        if (!keep.has(label) && !(label === 'subject' && keep.has('gross'))) continue;
        const mass = col(frame, column);
        if (!mass) continue;
        let acc = 0;
        // Clamped at zero: accumulating thousands of floats to 1 overshoots by a
        // few parts in 1e15, and a survival of -3.6e-15 is not a number to hand
        // a log axis.
        const tailProb = mass.map((v) => {
            acc += (v || 0);
            return Math.max(0, 1 - acc);
        });
        series.push({ name: label, mass, tailProb });
    }
    return series;
}

/** Which triples the frame can actually answer, so a control never lies. */
function reinsAvailable(frame) {
    const cols = new Set((frame && frame.columns) || []);
    return Object.entries(REINS_VIEWS)
        .filter(([, spec]) => spec.columns.some(([c]) => cols.has(c)))
        .map(([key]) => key);
}

/**
 * Mount the reinsurance exhibit: a selectable gross / ceded / net triple.
 *
 * Parameters
 * ----------
 * container : HTMLElement
 * frame : {columns, rows}
 *     A `reins_density_df` payload, already binned to the display grid.
 *
 * Returns
 * -------
 * object or null
 *     A handle with `dispose()`, or null when the frame carries none of the
 *     triples.
 */
export function mountReinsExhibit(container, frame) {
    const loss = col(frame, 'loss');
    if (!loss) return null;
    const available = reinsAvailable(frame);
    if (!available.length) return null;
    if (!available.includes(reinsView.which)) setReinsView({ which: available[0] });

    empty(container);
    const tools = el('div', { className: 'exhibit-controls' });
    const host = el('div', { className: 'exhibit-canvas' });
    container.appendChild(tools);
    container.appendChild(host);
    host.style.height = `${reservedHeight(host.clientWidth || 0)}px`;

    const isWide = () => (host.clientWidth || 0) >= WIDE_PX;

    function renderTools() {
        empty(tools);
        tools.appendChild(choiceGroup(
            'basis',
            available.map((k) => [k, REINS_VIEWS[k].label, REINS_VIEWS[k].title]),
            (v) => v === reinsView.which,
            (v) => { setReinsView({ which: v }); renderTools(); redraw(); },
        ));
        tools.appendChild(choiceGroup(
            'show',
            REINS_PARTS.map((p) => [p, p, `Draw the ${p} curve`]),
            (v) => reinsView.parts.includes(v),
            (v) => {
                const next = reinsView.parts.includes(v)
                    ? reinsView.parts.filter((x) => x !== v)
                    : REINS_PARTS.filter((x) => x === v || reinsView.parts.includes(x));
                // Never leave the panel empty: the last curve stays lit.
                if (!next.length) return;
                setReinsView({ parts: next });
                renderTools();
                redraw();
            },
        ));
        const viewControls = renderControls(
            ['logY', 'xFull', 'epMode', 'rightLogY'], false, () => redraw());
        for (const g of [...viewControls.children]) tools.appendChild(g);
    }

    function buildOption() {
        const series = reinsSeries(frame);
        if (!series.length) return null;
        // The first series carries the cdf for the x-window. It is the widest of
        // the triple (a cession is bounded above by what it comes out of), so
        // cropping to it keeps all of them on screen.
        let acc = 0;
        const cdf = series[0].mass.map((v) => (acc += (v || 0)));
        return twoPanel({
            loss, cdf, series, tail: null,
            wide: isWide(), width: host.clientWidth || 0,
        });
    }

    let option = buildOption();
    if (!option) { empty(container); return null; }
    renderTools();
    host.style.height = `${chartHeight(option)}px`;
    const chart = echarts.init(host, null, { renderer: 'canvas' });
    chart.setOption(option);
    linkPanels(chart, option);

    function redraw() {
        const next = buildOption();
        if (!next) return;
        option = next;
        host.style.height = `${chartHeight(option)}px`;
        chart.setOption(option, true);
        chart.resize();
        linkPanels(chart, option);
    }

    let lastWide = isWide();
    let lastWidth = host.clientWidth || 0;
    const ro = new ResizeObserver(() => {
        const nowWide = isWide();
        const nowWidth = host.clientWidth || 0;
        const changed = nowWide !== lastWide || Math.abs(nowWidth - lastWidth) > 8;
        lastWide = nowWide;
        lastWidth = nowWidth;
        if (changed) redraw(); else chart.resize();
    });
    ro.observe(host);

    return {
        dispose() {
            try { ro.disconnect(); } catch { /* already gone */ }
            try { chart.dispose(); } catch { /* already gone */ }
        },
    };
}

/**
 * The two component names for a bivariate, `[axis0, axis1]`.
 *
 * Axis 0 names itself: it is the joint frame's first column. Axis 1 does not,
 * because its grid *values* are the remaining column headers, so it is read off
 * `stats_df`, whose value columns are the two components in order. Falls back to
 * positional labels when that frame is unavailable, so a missing name costs a
 * label rather than the chart.
 */
function axisNames(joint, stats) {
    const first = ((joint && joint.columns) || [])[0] || 'axis 1';
    const statCols = (stats && stats.columns) || [];
    // stats_df leads with its index levels (basis, stat); the components follow.
    const components = statCols.filter((c) => c !== 'basis' && c !== 'stat');
    const second = components.find((c) => c !== first) || 'axis 2';
    return [first, second];
}

/**
 * Reduce a bivariate joint-density frame to a drawable heatmap grid.
 *
 * The frame is the raw joint matrix: first column the axis-0 grid, remaining
 * column *names* the axis-1 grid. That is up to 2**16 cells, which draws but
 * reads as mud, so it is block-summed down to at most CELLS per side. Summing
 * (not sampling) is what keeps the picture a density: dropping cells would
 * silently discard mass and lighten the tail.
 */
function heatmapData(frame, [xName, yName] = ['axis 1', 'axis 2'], CELLS = 96) {
    const cols = (frame && frame.columns) || [];
    if (cols.length < 2 || !frame.rows || !frame.rows.length) return null;
    const yValues = cols.slice(1).map(Number);
    const xValues = frame.rows.map((r) => Number(r[0]));
    const nx = xValues.length;
    const ny = yValues.length;
    const bx = Math.max(1, Math.ceil(nx / CELLS));
    const by = Math.max(1, Math.ceil(ny / CELLS));
    const ox = Math.ceil(nx / bx);
    const oy = Math.ceil(ny / by);

    const acc = new Float64Array(ox * oy);
    for (let i = 0; i < nx; i++) {
        const row = frame.rows[i];
        const ii = Math.floor(i / bx);
        for (let j = 0; j < ny; j++) {
            const v = Number(row[j + 1]);
            if (Number.isFinite(v)) acc[ii * oy + Math.floor(j / by)] += v;
        }
    }
    // Block right edges, matching the server's density binning convention.
    const xs = Array.from({ length: ox }, (_, i) => xValues[Math.min((i + 1) * bx - 1, nx - 1)]);
    const ys = Array.from({ length: oy }, (_, j) => yValues[Math.min((j + 1) * by - 1, ny - 1)]);

    const cells = [];
    let max = 0;
    for (let i = 0; i < ox; i++) {
        for (let j = 0; j < oy; j++) {
            const v = acc[i * oy + j];
            if (v > max) max = v;
            if (v > 0) cells.push([i, j, v]);
        }
    }
    if (!cells.length) return null;
    return { xs, ys, cells, max, xName, yName };
}

// ---- controls ---------------------------------------------------------

/** One pressed-state toggle button, wired to the sticky view state. */
function toggleButton(key, onChange) {
    const spec = CONTROLS[key];
    const isOn = spec.on || (() => Boolean(view[key]));
    const btn = el('button', {
        type: 'button',
        className: `exhibit-toggle${isOn() ? ' active' : ''}`,
        title: spec.title,
        onClick: () => {
            setView(spec.toggle ? spec.toggle() : { [key]: !view[key] });
            btn.classList.toggle('active', isOn());
            onChange();
        },
    }, spec.label);
    return btn;
}

/**
 * The toggle row, grouped by the panel each control drives.
 *
 * Three groups with a rule between them: density controls, the shared reference
 * lines, then the exceedance-panel controls. When the panels are side by side
 * the third group is pushed into the right half, so every button sits over the
 * panel it changes. In a single flat row the reader has to click each one to
 * discover what it touches.
 *
 * Parameters
 * ----------
 * names : string[]
 *     The controls this exhibit honors. Groups with nothing left after
 *     filtering are dropped, along with their separator.
 * wide : bool
 *     Side-by-side layout, which is when the split is worth making.
 * onChange : function
 */
function renderControls(names, wide, onChange) {
    const honored = new Set(names);
    const row = el('div', {
        className: `exhibit-controls${wide ? ' exhibit-controls-split' : ''}`,
    });
    const groups = CONTROL_GROUPS
        .map((g) => ({ ...g, controls: g.controls.filter((k) => honored.has(k)) }))
        .filter((g) => g.controls.length);
    for (const g of groups) {
        const box = el('div', { className: `exhibit-group exhibit-group-${g.key}` });
        for (const key of g.controls) box.appendChild(toggleButton(key, onChange));
        row.appendChild(box);
    }
    return row;
}

/**
 * A labeled row of mutually exclusive (or multi-select) buttons.
 *
 * The Reins exhibit's controls are choices over the frame's own columns rather
 * than view toggles, so they carry their labels: "basis" and "stage" name what
 * is being chosen, which a bare pair of buttons would not.
 *
 * Parameters
 * ----------
 * label : string
 * options : Array<[value, text, title]>
 * selected : function
 *     `(value) => bool`, so this serves both the single-choice rows and the
 *     multi-select gross / ceded / net row.
 * onPick : function
 */
function choiceGroup(label, options, selected, onPick) {
    const box = el('div', { className: 'exhibit-group' });
    box.appendChild(el('span', { className: 'exhibit-group-label' }, label));
    for (const [value, text, title] of options) {
        box.appendChild(el('button', {
            type: 'button',
            className: `exhibit-toggle${selected(value) ? ' active' : ''}`,
            title: title || '',
            onClick: () => onPick(value),
        }, text));
    }
    return box;
}

// ---- mount ------------------------------------------------------------

/**
 * Fetch and draw the Overview exhibit for a built object.
 *
 * Parameters
 * ----------
 * container : HTMLElement
 *     Already attached, so the chart can size to it. The control row and the
 *     canvas are both created inside it, keeping every chart concern here
 *     rather than split across main.js.
 * state : {id, kind, name, mean}
 *
 * Returns
 * -------
 * Promise<object|null>
 *     A handle with `dispose()`, or null when this kind has nothing to draw or
 *     the frames it needs are unavailable.
 */
export async function mountExhibit(container, state) {
    const spec = EXHIBITS[state.kind];
    if (!spec) return null;

    // Build the frame and reserve its height FIRST, before the fetch. A density
    // payload is a couple of hundred kilobytes and takes a moment; a chart that
    // sizes itself on arrival shoves everything below it down the page at the
    // moment the reader has started reading. Reserving costs nothing and the
    // number is exact, since the geometry is a function of the width.
    empty(container);
    const controls = spec.controls || [];
    const tools = el('div');
    const host = el('div', { className: 'exhibit-canvas' });
    container.appendChild(tools);
    container.appendChild(host);
    host.style.height = `${reservedHeight(host.clientWidth || 0)}px`;

    // The 3-D chunk, if this exhibit can use one, in parallel with the data.
    const needs3d = controls.includes('surface3d') && view.surface3d;
    let data;
    try {
        const [payload, ready] = await Promise.all([
            spec.fetch(state.id),
            needs3d ? loadSurface() : Promise.resolve(false),
        ]);
        data = payload;
        if (ready) surfaceReady = true;
    } catch {
        empty(container);
        return null;                     // a frame this kind lacks; not an error
    }

    const opts = () => ({
        ...state,
        wide: (host.clientWidth || 0) >= WIDE_PX,
        width: host.clientWidth || 0,
    });

    // The control row splits across the two panels only when they sit side by
    // side, so it is re-rendered when the layout breakpoint moves.
    function renderTools() {
        empty(tools);
        if (!controls.length) return;
        tools.appendChild(renderControls(controls, opts().wide, () => onToggle()));
    }

    let option = spec.build(data, opts());
    if (!option) { empty(container); return null; }
    renderTools();

    host.style.height = `${chartHeight(option)}px`;
    const chart = echarts.init(host, null, { renderer: 'canvas' });
    chart.setOption(option);
    linkPanels(chart, option);

    // Turning the 3-D view on for the first time has to fetch the renderer, so a
    // toggle is not always a synchronous redraw. Mounting with it already off is
    // the case that gets here: `loadSurface()` was skipped, and without this the
    // button would appear to do nothing.
    async function onToggle() {
        if (view.surface3d && controls.includes('surface3d') && !surfaceReady) {
            if (await loadSurface()) surfaceReady = true;
        }
        redraw();
    }

    // `notMerge` on every redraw: a toggle can change an axis *type*
    // (value -> log) and swap which series carry markLines, and a merged
    // setOption would leave the old ones behind. A 2-D to 3-D switch changes
    // more than that, so the instance is disposed and rebuilt: ECharts cannot
    // migrate a `grid` option to a `grid3D` one in place.
    let is3d = Boolean(option.grid3D);
    let chartRef = chart;
    function redraw() {
        const next = spec.build(data, opts());
        if (!next) return;
        option = next;
        const next3d = Boolean(option.grid3D);
        host.style.height = `${chartHeight(option)}px`;
        if (next3d !== is3d) {
            is3d = next3d;
            try { chartRef.dispose(); } catch { /* already gone */ }
            chartRef = echarts.init(host, null, { renderer: 'canvas' });
        }
        chartRef.setOption(option, true);
        chartRef.resize();
        linkPanels(chartRef, option);
    }

    // Rebuild on resize, always: every panel is now sized from the host width so
    // it can hold the house aspect, which a bare `chart.resize()` (stretching
    // the old geometry) would not do.
    let lastWide = opts().wide;
    let lastWidth = opts().width;
    const ro = new ResizeObserver(() => {
        const now = opts();
        const breakpointCrossed = now.wide !== lastWide;
        const resized = Math.abs(now.width - lastWidth) > 8;
        lastWide = now.wide;
        lastWidth = now.width;
        if (breakpointCrossed) renderTools();
        if (breakpointCrossed || resized) redraw();
    });
    ro.observe(host);

    return {
        dispose() {
            try { ro.disconnect(); } catch { /* already gone */ }
            // `chartRef`, not `chart`: a 2-D to 3-D switch replaces the instance,
            // and disposing the original would leak the live one's canvas.
            try { chartRef.dispose(); } catch { /* already gone */ }
        },
    };
}

/**
 * Host height for an option.
 *
 * `twoPanel` computes it alongside the grid geometry and hands it over on
 * `hostHeight`, so the aspect calculation lives in exactly one place. A square
 * exhibit sizes to its own side.
 */
function chartHeight(option) {
    if (typeof option.hostHeight === 'number') return Math.round(option.hostHeight);
    const grids = Array.isArray(option.grid) ? option.grid : [option.grid];
    const g = grids[0] || {};
    if (typeof g.height === 'number') return g.height + (g.top || 0) + 52;
    return 300;
}

/**
 * Link the cursor across the two panels.
 *
 * Both panels are built from the same row array, so a dataIndex identifies the
 * same grid bucket in either. Hovering the density therefore highlights the
 * matching point on the right-hand curve and vice versa: not an approximation,
 * the same bucket read two ways. A single-panel exhibit is left alone.
 */
function linkPanels(chart, option) {
    const total = (option.series || []).length;
    if (total < 2 || !Array.isArray(option.grid) || option.grid.length < 2) return;
    // twoPanel emits every density series then every right-panel series, so the
    // two halves are the same series in the same order and the offset is fixed.
    const half = total / 2;

    // The mirrored dispatch re-enters this handler; the guard stops the two
    // panels highlighting each other forever.
    let mirroring = false;
    chart.off('highlight');
    chart.on('highlight', (event) => {
        if (mirroring) return;
        const { seriesIndex, dataIndex } = event;
        if (seriesIndex == null || dataIndex == null) return;
        const mirror = seriesIndex < half ? seriesIndex + half : seriesIndex - half;
        mirroring = true;
        try {
            chart.dispatchAction({ type: 'highlight', seriesIndex: mirror, dataIndex });
        } finally {
            mirroring = false;
        }
    });
}
