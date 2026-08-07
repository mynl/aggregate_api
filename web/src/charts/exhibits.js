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
// number" directly, but it makes you re-orient to get there.
//
// The toggle picks one reading. Through a49 the panel also carried a second
// y-axis on its right showing whichever reading was not picked, on the argument
// that then neither question needs a transpose. What that actually did was
// leave the toggle deciding nothing, ask the reader which of two scales they
// were reading, and, because the axis reserved margin only when log y was on,
// make pressing log y on the right panel resize the left one.
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
    logMin, LOG_FLOOR, loadStyle,
} from './theme.js';
import { loadSurface, surfaceOverrides } from './surface.js';
import { chartdocToEcharts } from './chartdoc-to-echarts.js';

// Set once `loadSurface()` has resolved. Read synchronously inside a `build()`,
// which must stay pure, so the async part happens in the mount and this is the
// flag it leaves behind. False means the flat heatmap, which is also the answer
// when WebGL is unavailable or the chunk failed to load.
let surfaceReady = false;

// The capital anchors, marked on **both** panels and governed by the reference
// lines toggle along with the mean.
//
// 1-in-100 and 1-in-200, which is q(0.99) and q(0.995). It was 100 and 250
// through a49, on the argument that the wider pair leaves room for two labels;
// but the reader asking for a reference line is asking where capital sits, and
// in this book that is Solvency II's 1-in-200. 1-in-250 is on the default
// ladder and one hover away in the tooltip, and the return-period table beside
// the chart emphasizes both.
//
// Two, not three, and never more: `anchorMarks` alternates the label side so
// the pair opens away from each other, which works for two lines and not for a
// third between them. Both are on the library's DEFAULT_RETURN_PERIODS, so the
// rows are there to read.
const ANCHORS = [100, 200];

// The return-period window runs from an annual event out to 1-in-1 billion.
//
// It was 1-in-100,000 through a36, which cut the curve off while it still had
// shape left to show. 1e9 is the author's number and it is well past any capital
// anchor anyone reads, while staying clear of the depth where a survival built by
// `1 - cumsum` is reporting its own arithmetic error rather than a tail.
// `LOG_FLOOR` is the guard against that, and it is unchanged.
const T_MIN = 1;
const T_MAX = 1e9;

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

// Vertical chrome around a square plot area: the title strip above it, and the
// axis plus legend below. One constant for all three square exhibits.
//
// Before a29 nobody wrote this down. The distortion and heatmap set no host
// height at all and fell through a `grid.height + grid.top + 52` guess in the
// mount, while the surface declared `side + 60`. Two formulas for the same
// square, so flipping the 3-D toggle resized the box by 18 px on top of
// everything else. Declaring it once also means `reservedHeight` can compute the
// box before any data arrives and get the same answer the build will.
const SQUARE_CHROME = PAD_TOP + 52;

// ---- how a density is drawn -------------------------------------------
//
// The library's ladder, not one of our own. `aggregate/charts/ir.py:88-102`
// states it renderer-agnostically and `aggregate/plots/_chartdoc.py:41,46,67-104`
// implements it for matplotlib with these same two constants. Reproduced here
// so the interactive exhibit and the server-rendered figure make the same
// choice on the same book, which is most of what makes two renderers read as
// one instrument.
//
// What the x values *are* comes first, and it is a fact about the law rather
// than about the drawing:
//
//   atomic      the points carry the whole distribution and there is nothing
//               between them. A discretized aggregate **is** the distribution,
//               not an approximation to some continuous ideal, so this is the
//               normal case here
//   continuous  the points are samples of a function that exists everywhere
//               between them: a frozen severity's pdf, a distortion's g(s)
//
// A continuous series is a plain line at any density, and none of what follows
// applies to it. Drawing a sampled ordinate as steps claims the value holds
// across a bucket, and for a pdf there is no bucket.
//
// An atomic series takes one of two drawings, by how much room each atom gets:
//
//   <= 40 atoms in view    a stem to the value with a dot on the end. A mass
//                          lives *at* its atom, and where the atoms are far
//                          enough apart to see, that is what to draw
//   otherwise              steps centered on the grid point, matplotlib's
//                          `steps-mid`. The point of them is the sharp vertical
//                          jump where a line would draw a slope the law does
//                          not have
//
// Counted in atoms **in view**, so a zoom is judged on what it shows: this is
// what makes the lollipop reachable on an ordinary book rather than only on a
// natively tiny one.
//
// **There is deliberately no pixel rung.** The library's ladder has a third
// one, dropping to a plain line under three pixels per atom, and a50 copied it.
// That was the wrong import. It is sound for `plot_chartdoc`, which draws a
// static figure where sub-pixel steps and a line are the same pixels, and it is
// wrong here for two reasons. The rung needs between 41 and 141 visible atoms
// on a 424px panel, which no real book hits, so steps went from always to never
// and the app drew every density as a line. And this chart zooms, so "how many
// pixels does an atom get" is not a property of the data at all, it is a
// property of a gesture that has not happened yet.
//
// `sampling: 'minmax'` already bounds what steps cost: it reduces to two points
// per device pixel column before the path is built, so a 65,536 point step
// series and a 65,536 point line series build paths of the same order.
const LOLLIPOP_ATOMS = 40;

/**
 * How many of `loss` fall inside `window`.
 *
 * The count the ladder turns on. Linear rather than a binary search because the
 * grid is sorted but the caller is not required to guarantee it, and this runs
 * once per draw rather than per point.
 */
function atomsInView(loss, window) {
    if (!window) return loss.length;
    let seen = 0;
    for (const x of loss) { if (x >= window[0] && x <= window[1]) seen++; }
    return seen;
}

/**
 * Which drawing this panel's series take.
 *
 * One answer for the whole panel, not one per series: every series shares the
 * grid and the window, so they would all reach the same answer, and a panel
 * drawing one unit as stems and another as steps would read as two different
 * kinds of thing.
 *
 * @param {number} seen atoms inside the visible window.
 * @param {string} support `'atomic'` (default) or `'continuous'`.
 * @returns {'stem'|'step'|'line'}
 */
function densityStyle(seen, support) {
    if (support === 'continuous') return 'line';
    return seen <= LOLLIPOP_ATOMS ? 'stem' : 'step';
}

/**
 * The same question for a cumulative axis: F, S, or a return period.
 *
 * Two rungs, not three. A cumulative takes a value at every x rather than only
 * at the atoms, so the stem rung does not apply to it however far apart they
 * are, and the honest drawing is a right-continuous step that jumps at the atom
 * however few there are. That is the library's own split, at
 * `_chartdoc.py:93-96`, and it is why this is a separate function rather than
 * an argument to the one above.
 *
 * @returns {'step-post'|'line'}
 */
function cumulativeStyle(support) {
    return support === 'continuous' ? 'line' : 'step-post';
}

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
    refLines: true,     // mean, 1-in-100 and 1-in-200, drawn on both panels
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
        title: 'Show the whole grid on both panels, not just q(0.001) to '
            + 'q(0.999)',
    },
    refLines: {
        label: 'reference lines',
        title: 'Mean, 1-in-100 and 1-in-200, on both panels',
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
        title: 'Log axis on the exceedance panel, where a survival curve '
            + 'spends most of its range',
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
// `xFull` sits in the middle group because it drives both panels: the two share
// one x window by construction (see `densityWindow`), so the button that widens
// it widens both. It sat over the density panel through a36, which said it was a
// density control, and that was the wrong claim.
const CONTROL_GROUPS = [
    { key: 'left', controls: ['logY'] },
    { key: 'both', controls: ['xFull', 'refLines', 'surface3d', 'logZ'] },
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
 * light-tailed book: three dice have a minimum survival near 5e-3, so with
 * `T_MAX` at 1e9 more than six decades would draw empty. Rounding the observed
 * minimum down to a decade keeps the gridlines on round numbers, so both
 * readings of the axis, S and 1/S, land on values worth labeling.
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
 * The x window **both** panels are drawn on: roughly q(0.001) to q(0.999),
 * mirroring `Aggregate._limits`, or the whole grid under `full x`.
 *
 * A heavy tail otherwise squashes all the visible mass into a sliver at the
 * origin.
 *
 * Notes
 * -----
 * Always an explicit pair, never null-for-auto-fit. That is what fixes the
 * `full x` bug: `null` left both axes on `dataMin` / `dataMax`, and the two
 * panels do not hold the same data. `rightPairs` emits a whole `null` entry
 * rather than `[x, null]` wherever the tail probability leaves the plotted
 * range, ECharts drops null entries from an axis extent, and so the tail panel's
 * `dataMax` was the last loss carrying a survival while the density panel's was
 * the end of the grid. The two stopped sharing an axis at exactly the moment the
 * reader pressed the button that says show me the whole thing.
 *
 * Returns null only when there is no window to compute at all (an empty or
 * degenerate loss grid), which the caller treats as auto-fit for both panels
 * alike.
 */
function densityWindow(loss, cdf) {
    if (!loss || loss.length < 2) return null;
    const n = loss.length;
    // No cdf is treated as `full x`: it is the same question (which slice of the
    // grid) with the same answer available (all of it), so it takes the same
    // path rather than a separate fallback.
    const whole = view.xFull || !cdf || cdf.length !== n;
    let hi = loss[n - 1];
    let lo = loss[0];
    if (!whole) {
        for (let i = 0; i < n; i++) { if (cdf[i] >= 0.999) { hi = loss[i]; break; } }
        const signed = lo < 0;
        lo = signed ? loss[0] : Math.min(0, loss[0]);
        if (signed) {
            for (let i = 0; i < n; i++) { if (cdf[i] >= 0.001) { lo = loss[i]; break; } }
        }
    }
    if (!(hi > lo)) return null;
    // The same 2% either side in both modes, so pressing `full x` widens the
    // window without also changing how the curve is inset in it.
    const pad = 0.02 * (hi - lo);
    return [lo - pad, hi + pad];
}

/**
 * Whether ECharts' `minmax` sampler is safe on a value array.
 *
 * `minmaxDownSample` seeds a frame's running min and max from the frame's
 * **first** point, and every comparison against NaN is false, so a frame whose
 * first point is a gap keeps that gap as both its min and its max and the rest
 * of the frame is discarded. Trailing gaps are harmless, since a frame wholly
 * inside them should draw as a gap anyway. An *interior* gap is not: it would
 * silently delete a frame's worth of real curve.
 *
 * So: gaps allowed at the end, nowhere else. The linear density has none at all,
 * a survival's gaps are the trailing block past the log floor, and the log
 * density of a discrete book is gaps all the way through, which is the one case
 * this turns the sampler off for.
 */
function gapFree(values) {
    let last = values.length - 1;
    while (last >= 0 && values[last] == null) last--;
    for (let i = 0; i < last; i++) { if (values[i] == null) return false; }
    return true;
}

// Why every series below asks for `sampling: 'minmax'`.
//
// ECharts' own culling, in `drawSegment` (echarts/lib/chart/line/poly.js), skips
// any segment under sqrt(0.5) px **and does not advance `prevX` when it does**,
// so a point is emitted only once it is ~0.7 px from the last point actually
// emitted. At 2**16 grid points across a ~400 px panel a bucket is about 0.006
// px wide, so what survives that filter is whichever points happened to fall on
// the right side of an accumulating threshold: peaks are dropped, and an atom
// carrying real mass can disappear entirely.
//
// `sampling: 'minmax'` reduces to the smallest and the largest value per device
// pixel column before the path is built. The peak is preserved rather than
// averaged away or culled, which matters because these peaks are atoms. It also
// runs *after* the dataZoom filter, so zooming in drops the visible count and
// the full grid comes back.
//
// Through a49 this comment was about steps specifically: the risers leaned,
// because the culling ate the horizontal moves that made them vertical. That is
// still true of the step rung. It is no longer the main case, since at 2**16
// points the ladder above draws a plain line, which is where the peak-dropping
// half of the argument does the work.
const SAMPLING = 'minmax';

/**
 * One density series, as one or two ECharts series.
 *
 * Two for the stem drawing: the stems and the dots on their ends. They share a
 * `name`, so they share one legend entry and toggle together, and so they match
 * the single right-panel series of the same name, which is what links the two
 * panels on one legend click.
 *
 * Both are `type: 'line'`, so nothing beyond `LineChart` has to be registered
 * in `theme.js`. The stems are a line whose data runs base, value, gap per atom
 * and therefore draws as disconnected verticals; the dots are a line with a
 * zero-width stroke and its symbols shown, which is a scatter by another name.
 *
 * @param {'stem'|'step'|'line'} style from `densityStyle`, one per panel.
 * @returns {object[]} one or two series.
 */
function densitySeries(name, loss, mass, i, solo, style = 'step') {
    const color = seriesColor(i);
    // A log axis cannot place zero, and the tail of a discretized density is
    // full of exact zeros and of FFT dust below 1e-15. Emit both as gaps rather
    // than letting ECharts drop them silently or clamp them onto the axis floor.
    const y = view.logY ? mass.map((v) => (v > LOG_FLOOR ? v : null)) : mass;
    const points = loss.map((x, k) => (y[k] == null ? null : [x, y[k]]));

    if (style === 'stem') {
        // The base a stem runs from. Zero on a linear axis, which is what a
        // mass is measured against; on a log axis, where zero has no position,
        // the axis floor, which is where matplotlib's `vlines` ends up clipped
        // to as well. Either way the stem's *top* is the value, and the value
        // is what is being read.
        const base = view.logY ? logMin() : 0;
        const stems = [];
        for (const p of points) {
            if (!p) continue;
            stems.push([p[0], base], [p[0], p[1]], null);
        }
        return [
            {
                name,
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: stems,
                showSymbol: false,
                connectNulls: false,
                // No `sampling` here: the whole point of this rung is that
                // there are few enough atoms to draw each one, and a per-pixel
                // reduction would merge the base and the peak of a stem.
                lineStyle: { width: 1, color, opacity: 0.55 },
                itemStyle: { color },
                silent: true,
                z: 2,
            },
            {
                name,
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: points,
                showSymbol: true,
                symbolSize: 5,
                connectNulls: false,
                lineStyle: { width: 0 },
                itemStyle: { color },
                emphasis: { focus: 'series' },
                z: 3,
            },
        ];
    }

    return [{
        name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        ...(style === 'step' ? { step: 'middle' } : {}),
        data: points,
        sampling: gapFree(y) ? SAMPLING : undefined,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: lineWidth(), color },
        itemStyle: { color },
        // No fill under a log axis: the shaded region would run to the axis
        // floor rather than to zero, which is a different (and false) area.
        areaStyle: (solo && !view.logY) ? { color: fade(color, 0.10) } : undefined,
        emphasis: { focus: 'series' },
    }];
}

/**
 * One right-panel series: S against loss, or its reciprocal as a return period.
 *
 * Stepped since a53, and it never was before: this function carried no `step`
 * at all, so a survival curve over a discretized law drew as a polyline sloping
 * between atoms, which is a value the law does not take.
 *
 * `step: 'end'` is ECharts' spelling of matplotlib's `steps-post`: hold at
 * `y_i` across the interval and jump at `x_{i+1}`. That is what a cumulative
 * does. Not `'middle'`, which is the density's style and would put the jump
 * half a bucket before the atom that causes it.
 *
 * @param {'step-post'|'line'} style from `cumulativeStyle`.
 */
function rightSeries(name, loss, tailProb, i, style = 'step-post') {
    const color = seriesColor(i);
    const data = rightPairs(loss, tailProb, view.epMode);
    return {
        name,
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        ...(style === 'step-post' ? { step: 'end' } : {}),
        data,
        sampling: gapFree(data) ? SAMPLING : undefined,
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

// Suffixes for `compactPeriod`, largest first so the first match wins.
const PERIOD_SCALES = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

/**
 * A return period short enough to sit on an axis: `250`, `10k`, `2.5M`, `1B`.
 *
 * `T_MAX` is 1e9, so the exact form is now up to ten digits and neither the axis
 * labels nor the tooltip can carry it: `1-in-3184000000` is a number nobody
 * reads. The log axis ticks land on decades, which is what makes a single
 * suffixed digit lossless where it matters.
 *
 * `returnPeriod` stays exact and keeps its one job, naming the capital anchors,
 * where 1-in-250 rounded to anything is the wrong number.
 */
function compactPeriod(T) {
    if (!Number.isFinite(T)) return '';
    for (const [scale, suffix] of PERIOD_SCALES) {
        if (T >= scale) {
            const v = T / scale;
            return `${v >= 10 ? Math.round(v) : Number(v.toFixed(1))}${suffix}`;
        }
    }
    return returnPeriod(T);
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
function anchorMarks(tail) {
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
        x: found.get(T),
        name: `1-in-${returnPeriod(T)}`,
        faint: true,
        // First anchor's text runs left of its line, second's runs right, so two
        // labels near each other open in opposite directions.
        align: i === 0 ? 'right' : 'left',
    }));
}

/** One neutral mark, styled as an ECharts markLine entry. */
function anchorLineStyle(m) {
    return {
        xAxis: m.x,
        name: m.name,
        lineStyle: { color: '#6c757d', type: 'dashed', width: 1, opacity: 0.45 },
        label: {
            // Inside the plot at the top, not above it: `position: 'end'` put
            // the text over the panel's upper edge, where it collided with the
            // title. For a vertical markLine, "end" is the top.
            position: 'insideEndTop',
            align: m.align,
            padding: m.align === 'right' ? [0, 5, 0, 0] : [0, 0, 0, 5],
        },
    };
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
 *
 * Returns
 * -------
 * {grids, panelW, panelH, height}
 *     `grids` are two ECharts grid objects with numeric geometry, `height` the
 *     host height the whole thing needs.
 *
 * Notes
 * -----
 * There was a third parameter through a49, `twin`, saying whether the tail
 * panel carried a return-period axis on its right and so needed 52px of margin
 * reserved for it. The twin axis is gone (see `twoPanelData`), and with it the
 * one thing that made this geometry depend on a *view* toggle: pressing log y on
 * the right panel changed the space left over, which the two panels split, so
 * the LEFT panel resized. Nothing here reads `view` now.
 */
export function panelGeometry(width, wide) {
    const w = width || 900;
    const rightPad = PAD_RIGHT;
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
 * The host height `kind` will need at this width, before any data has arrived.
 *
 * Dispatches through the kind's own `layout`, which is the same function the
 * build draws from, so the reserved box is the box the chart lands in rather
 * than an estimate of it.
 *
 * Parameters
 * ----------
 * width : number
 *     Host width in CSS pixels.
 * kind : str, optional
 *     A key of `EXHIBITS`. Anything else, including the reinsurance exhibit's
 *     `'reins'`, falls back to the two-panel box, which is what those draw.
 *
 * Returns
 * -------
 * number
 *     Host height in CSS pixels.
 */
export function reservedHeight(width, kind) {
    const layout = (kind && EXHIBITS[kind] && EXHIBITS[kind].layout) || twoPanelBox;
    return layout(width).hostHeight;
}

/**
 * Assemble the two-panel option from per-series density and right-panel data.
 *
 * Series in the two panels share a `name`, which is what makes one legend entry
 * toggle a unit in both panels at once.
 */
/**
 * Every decision the two-panel exhibit makes, before any renderer touches it.
 *
 * Which curves, over which x-window, on which scales, with which verticals
 * marked and which way their labels open. All of it is a statement about the
 * *data*, not about a charting library, so it lives here rather than inside an
 * ECharts option literal. That split is what made the a30 renderer comparison
 * possible; it earns its keep either way, because these are the decisions worth
 * reading and reviewing on their own.
 *
 * Returns
 * -------
 * object
 *     `series` as given, plus `solo`, `asRP`, `logRight`, the density `window`,
 *     the survival range `sLo`/`sHi`, and `densRefs` / `tailRefs`, each a list
 *     of `{x, name, faint?, align?}` verticals.
 */
function twoPanelData({
    loss, cdf, series, tail, box, mean, zeroLine, support, zoom,
    densityTitle, densityName, tailTitles, tailNames,
}) {
    const asRP = view.epMode === 'rp';
    const logRight = Boolean(view.rightLogY);

    // Both panels are on the loss axis, so every reference is a vertical.
    //
    // The toggle governs all of them, on both panels, which is what its label
    // says and what it did not do through a49: the anchors were computed out
    // here, outside the guard, so `reference lines` turned off the mean and the
    // density panel's single anchor and left the tail panel's two lit. The mean
    // and the anchors are the same kind of mark and answer to the same switch.
    //
    // The break-even line is not one of them. It is a P&L's zero, a fact about
    // where the axis changes sign rather than a reference the reader chose to
    // add, so it stays whatever the toggle says.
    const densRefs = [];
    const tailRefs = [];
    if (zeroLine != null) densRefs.push({ x: zeroLine, name: 'break even' });
    if (view.refLines) {
        const anchors = anchorMarks(tail);
        densRefs.push(...anchors);
        tailRefs.push(...anchors);
        if (Number.isFinite(mean)) {
            densRefs.push({ x: mean, name: 'mean' });
            tailRefs.push({ x: mean, name: 'mean' });
        }
    }
    const [sLo, sHi] = survivalRange(series);
    // Labels resolved here, not patched onto a built option afterward. A
    // severity is a density ordinate rather than a mass and a P&L's bad tail is
    // its low end, so both rename the axes; doing that by mutating the ECharts
    // option meant the wording lived in a place only one renderer could read.
    // "Survival", not "EP curve": EP is a term of art in catastrophe modeling
    // (OEP / AEP) and this is neither. It is S(x) = P(X > x).
    const titles = tailTitles || ['Survival', 'Return period'];
    const names = tailNames || ['S(x)', 'return period'];
    const window = densityWindow(loss, cdf);
    // The count the ladder turns on, taken from the **zoom** where there is one
    // and the crop otherwise. That is the whole of what makes lollipops
    // reachable by zooming: `window` is fixed for the life of the object, so a
    // style computed from it can only ever answer for a book that was already
    // small. `zoom` is not used for the axis extent, only for this: dataZoom
    // owns the visible range, and writing it back onto `min` / `max` would have
    // the redraw fight the gesture that triggered it.
    const seen = atomsInView(loss, zoom || window);
    return {
        loss, series, box, mean,
        solo: series.length === 1,
        asRP, logRight,
        logY: Boolean(view.logY),
        window,
        atomsSeen: seen,
        // Carried so the zoom listener can re-judge the rung from a count,
        // without building an option to find out what it would have been.
        supportKind: support || 'atomic',
        // Chosen once for the whole panel. A decision about the data and the
        // room it has, so it belongs here with the rest of them rather than
        // inside the option literal.
        densityStyle: densityStyle(seen, support),
        cumulativeStyle: cumulativeStyle(support),
        sLo, sHi, densRefs, tailRefs,
        densityTitle: densityTitle || 'Density',
        densityName: view.logY ? `log ${densityName || 'density'}`
                               : (densityName || 'density'),
        // Still a pair: `asRP` picks which one names the single tail y axis.
        tailNames: names,
        tailTitle: asRP ? titles[1] : titles[0],
    };
}

/**
 * Which axis each panel is read off, declared per grid.
 *
 * The density panel is read by loss, as any density is. The tail panel is read
 * the other way round: pick a survival and get the loss. `S(x)` is monotone
 * decreasing in loss and the return period monotone increasing, so "at
 * S = 0.005, what loss?" has exactly one answer, that answer is the VaR, and it
 * is the number the reader came for. Hunting along a curve for it is work the
 * axis can do. The same gesture on a density is ill posed, because a horizontal
 * line crosses it twice, so that panel keeps loss.
 *
 * Per **grid**, not per axis, and that distinction is the whole trick. Each grid
 * is its own coordinate system and ECharts reads `tooltip` off the coordinate
 * system's model before falling back to the global one, so two grids in one
 * chart can be read two ways. The per-axis `axisPointer.triggerTooltip` looks
 * like the obvious knob and is inert here: under `axisPointer.type: 'cross'`
 * ECharts passes the flag in explicitly from the tooltip pass, so the axis's own
 * value is never consulted (`modelHelper.js`, `saveTooltipAxisInfo`).
 *
 * Snapping comes for free: a base axis with `triggerTooltip` gets `snap` forced
 * on even though it is a value axis, so the pointer lands on grid points rather
 * than sliding between them and reporting a loss that is not in the book.
 */
const PANEL_READ_AXIS = ['x', 'y'];

function twoPanel(args) {
    const {
        loss, series, box, solo, asRP, logRight, window, sLo, sHi,
        densRefs, tailRefs, densityTitle, densityName, tailNames, tailTitle,
        densityStyle: drawAs, cumulativeStyle: drawTailAs, atomsSeen, supportKind,
    } = twoPanelData(args);

    // flatMap, because the stem drawing is two ECharts series (the stems and
    // the dots on their ends) sharing one name and therefore one legend entry.
    const density = series.flatMap(
        (s, i) => densitySeries(s.name, loss, s.mass, i, solo, drawAs));
    const right = series.map(
        (s, i) => rightSeries(s.name, loss, s.tailProb, i, drawTailAs));

    // Reference lines go on the first series of each panel, so they draw once.
    //
    // One mapping for both panels. The density panel used to take a plainer one
    // that dropped `faint` and `align`, which was invisible while it carried a
    // single anchor and became the 1-in-200 label sitting on top of its own rule
    // the moment it carried two. A mark knows how it wants to be drawn; which
    // panel it lands on does not change that.
    const markOf = (r) => (r.faint ? anchorLineStyle(r) : { xAxis: r.x, name: r.name });
    const dens = densRefs.map(markOf);
    const rightRefs = tailRefs.map(markOf);
    if (dens.length) density[0].markLine = refLine(dens);
    if (rightRefs.length && right.length) right[0].markLine = refLine(rightRefs);

    // The box was computed by the spec's `layout()` before the fetch and is
    // handed in, not recomputed. It is now a function of the host width alone,
    // so a reservation and its build cannot disagree whatever the toggles say.
    const { grids, hostHeight, footprint } = box;

    // The x-axis label formatter, shared by both panels.
    //
    // ECharts always draws a tick at an explicit `min` and `max`, and ours are
    // not round numbers: `densityWindow` pads the crop by two percent either
    // side, so the endpoints are arbitrary reals and `fmt` printed them at six
    // significant figures. Every chart had a 7,238.94 at one end and a
    // 91,447.2 at the other, wider than every other label and saying nothing:
    // the window is a viewport, not a number anyone reads off.
    //
    // Suppressed rather than rounded away. Rounding the window to nice numbers
    // would move the crop, which is a decision about what the reader sees, to
    // make a label look better. The window stays exactly where it was and the
    // two labels that name its edges do not print.
    //
    // Compared with the same tolerance ECharts used to place them, so a value
    // that arrives back through the formatter as a float a few ulps off its
    // own endpoint is still recognized.
    const atEdge = (v) => window
        && (Math.abs(v - window[0]) <= 1e-9 * Math.abs(window[0])
            || Math.abs(v - window[1]) <= 1e-9 * Math.abs(window[1]));
    const lossLabel = { fontSize: 10, color: '#6c757d', hideOverlap: true,
                        formatter: (v) => (atEdge(v) ? '' : fmt(v)) };

    // Loss on x in BOTH panels, always. The right panel is the same book seen
    // through its tail rather than a transposed picture of it, so the two read
    // as one exhibit and the eye never has to swap axes to follow a loss across.
    const rightX = axisStyle({
        gridIndex: 1, type: 'value', name: 'loss', scale: true,
        min: window ? window[0] : 'dataMin',
        max: window ? window[1] : 'dataMax',
        axisLabel: lossLabel,
    });

    // The toggle changes the y-axis only: S(x), or its reciprocal as a return
    // period. Same curve, two readings, and the toggle picks one. Both were
    // drawn at once through a49, the unpicked one as a twin on the right, which
    // left the toggle with nothing to decide. Each builder took an `extra`
    // argument whose only caller was the twin, and it went with it.
    const survivalAxis = () => axisStyle({
        gridIndex: 1, name: tailNames[0],
        ...(logRight ? { type: 'log', logBase: 10, min: sLo, max: sHi }
                     : { type: 'value', min: 0, max: sHi }),
        axisLabel: { fontSize: 10, color: '#6c757d',
                     formatter: (v) => (v >= 0.01 ? String(v) : v.toExponential(0)) },
    });
    const returnAxis = () => axisStyle({
        gridIndex: 1, name: tailNames[1], nameGap: 34,
        ...(logRight ? { type: 'log', logBase: 10, min: 1 / sHi, max: 1 / sLo }
                     : { type: 'value', min: 1 / sHi, max: 1 / sLo }),
        axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                     formatter: (v) => compactPeriod(v) },
    });

    // Two y axes, one per panel, and no twin.
    //
    // The tail panel used to carry a second axis on its right reading the same
    // curve the other way round, S against return period. That is exactly what
    // the `return period` toggle is for: offering both at once is the toggle
    // answering its own question, so the reader has to work out which of two
    // scales they are reading rather than choosing one. It also cost 52px of
    // reserved margin whose presence depended on `rightLogY`, and since the two
    // panels split what is left, pressing log y on the right panel resized the
    // left one. Deleting the axis is what fixes that, not a geometry change.
    const yAxes = [
        axisStyle({
            gridIndex: 0, type: view.logY ? 'log' : 'value',
            name: densityName, scale: true,
            ...(view.logY ? { min: logMin() } : {}),
            axisLabel: { fontSize: 10, color: '#6c757d',
                         formatter: (v) => (v ? v.toExponential(0) : '0') },
        }),
        asRP ? returnAxis() : survivalAxis(),
    ];

    // The held zoom, as the percentages dataZoom speaks in. Absent when the
    // reader has not zoomed, which leaves the component at its own full-range
    // default rather than pinning it to 0 and 100.
    const zoomExtent = (args.zoom && window && window[1] > window[0])
        ? {
            start: (100 * (args.zoom[0] - window[0])) / (window[1] - window[0]),
            end: (100 * (args.zoom[1] - window[0])) / (window[1] - window[0]),
        }
        : {};

    const option = {
        ...baseOption(),
        // Geometry from the box, plus the one thing that differs between the two
        // panels: which axis the reader interrogates. See PANEL_READ_AXIS.
        grid: grids.map((g, i) => ({
            ...g,
            tooltip: { axisPointer: { axis: PANEL_READ_AXIS[i] } },
        })),
        title: [
            { text: densityTitle, left: grids[0].left, top: grids[0].top - 24,
              textStyle: { fontSize: 12, fontWeight: 600 } },
            { text: tailTitle, left: grids[1].left, top: grids[1].top - 24,
              textStyle: { fontSize: 12, fontWeight: 600 } },
        ],
        legend: { ...baseOption().legend, show: !solo, data: series.map((s) => s.name) },
        xAxis: [
            axisStyle({
                gridIndex: 0, type: 'value', name: 'loss', scale: true,
                min: window ? window[0] : 'dataMin',
                max: window ? window[1] : 'dataMax',
                axisLabel: lossLabel,
            }),
            rightX,
        ],
        yAxis: yAxes,
        // filterMode 'filter' drops out-of-window points from the axis extent
        // calculation, so the y-axis rescales to what is actually visible.
        // Without it, zooming into a tail zooms into a flat strip near zero.
        // `start` / `end` are carried explicitly, as percentages of the axis
        // extent, so a rebuild restores the zoom the reader is holding.
        // `renderer.update` replaces the option rather than merging it, and a
        // dataZoom with no start / end resets to the full range: without this,
        // the redraw that a zoom triggers would undo that same zoom. `args.zoom`
        // is in loss units and `window` is the axis extent, so the conversion
        // is exact.
        dataZoom: [
            { type: 'inside', xAxisIndex: 0, filterMode: 'filter', ...zoomExtent },
            { type: 'inside', xAxisIndex: 1, filterMode: 'filter', ...zoomExtent },
        ],
        tooltip: {
            ...baseOption().tooltip,
            // Cross, not a bare vertical: on the tail panel the y value *is* the
            // answer, so a horizontal tracking line reading it off the axis is
            // worth as much as the vertical one reading the loss. Which of the
            // two the panel actually answers with is set per grid, above.
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
    // Not ECharts keys: carried through so the smoke test can read the shape the
    // layout was aiming for, and can assert that what the build produced is the
    // height that was reserved. `densityDrawnAs` joined them at a50, because the
    // rung of the ladder a panel landed on is now a decision worth asserting and
    // it cannot be recovered from the series without guessing.
    option.hostHeight = hostHeight;
    option.panelFootprint = footprint;
    option.densityDrawnAs = drawAs;
    option.cumulativeDrawnAs = drawTailAs;
    // What the rung was chosen from, so the zoom listener can tell whether a
    // gesture has actually changed the answer without rebuilding to find out.
    option.atomsSeen = atomsSeen;
    option.lossWindow = window;
    option.lossGrid = loss;
    option.supportKind = supportKind;
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
        ? `1-in-${compactPeriod(value)} (S = ${(1 / value).toExponential(2)})`
        : `${value.toExponential(2)} (1-in-${compactPeriod(1 / value)})`;
}

/** Grid, title and host height for a square single-panel exhibit. */
function squareLayout(width, { left = 56, rightPad = 28 } = {}) {
    const side = Math.max(SQUARE_MIN,
        Math.min(SQUARE_MAX, (width || SQUARE_MAX) - left - rightPad));
    return { side, left, top: PAD_TOP, bottom: 52 };
}

// ---- the layout box ----------------------------------------------------
//
// One number, computed once. Each exhibit declares a `layout(width)` returning
// the geometry it will draw into, including the host height it needs. The mount
// calls it **before** the fetch to reserve the space and hand the skeleton its
// shape, then passes the same box into `build()`, which never recomputes.
//
// The bug this retires: `reservedHeight` used to take only a width and always
// return the two-panel geometry, so a distortion reserved 347 px and rendered
// 498, and a bivariate on a narrow screen reserved 730 and rendered 480. The
// page jumped by 133 to 252 px on every one of those loads. Reservation and
// build now cannot disagree, because there is only one of them.

/** The two-panel box: four kinds plus the reinsurance exhibit. */
function twoPanelBox(width) {
    // A function of the width alone since a50. It used to read `view.rightLogY`
    // too, because that decided whether the tail panel reserved a strip for its
    // return-period twin; the twin is gone and the geometry is back to being
    // about the page rather than about which toggles are pressed.
    const g = panelGeometry(width, (width || 0) >= WIDE_PX);
    return { ...g, twoPanel: true, hostHeight: Math.round(g.height) };
}

/** The square box, for the exhibits with no loss axis to run left to right. */
function squareBox(width, pads) {
    const s = squareLayout(width, pads);
    return { ...s, twoPanel: false, hostHeight: Math.round(s.side + SQUARE_CHROME) };
}

// The bivariate's pads, one set for both its renderers. The heatmap needs the
// wider of the two (a colorbar on the right, a y-axis name gap on the left), so
// they are its numbers and the surface draws at the same side.
//
// Deliberately NOT per renderer. Sizing the surface from its own narrower pads
// gave it a larger `side` on a narrow screen, and since `surfaceReady` only
// turns true once the lazy chunk has landed, the box was reserved as a heatmap
// and rendered as a surface: 478 reserved, 498 drawn. A layout that depends on
// async state cannot be reserved ahead of that state resolving, so this one
// depends on none.
const BVAGG_PADS = { left: 64, rightPad: 96 };

// ---- per-kind exhibits ------------------------------------------------
//
// Each entry is {layout, controls, fetch, build}. `layout` gives the geometry
// and host height for a width, and is called before the fetch so the space can
// be reserved and the skeleton drawn at the right shape. `fetch` gathers the
// frames. `build` turns the box and the frames into an ECharts option and is
// pure, so the node smoke test can exercise it without a DOM. `controls` names
// the toggles the exhibit honors, so a distortion never offers a log-y button
// that would do nothing.
//
// `build` takes its geometry from `opts.box`, the same object `layout` returned,
// and never derives it again. That is the whole point: the reserved height and
// the rendered height are one number.

const TWO_PANEL_CONTROLS = ['logY', 'xFull', 'refLines', 'epMode', 'rightLogY'];

// ---- two-panel argument builders --------------------------------------
//
// Column picking, one function per kind, kept out of `build` so the smoke test
// can call it without a DOM. Each returns the argument object `twoPanelData`
// reads, or null when the frame lacks what the exhibit needs.

function aggPanelArgs({ density, tail }, { name, box, mean }) {
    const loss = col(density, 'loss');
    const mass = col(density, 'p_total');
    const S = col(density, 'S');
    if (!loss || !mass || !S) return null;
    return {
        loss, cdf: col(density, 'F'), tail, box, mean,
        series: [{ name: name || 'aggregate', mass, tailProb: S }],
    };
}

function portPanelArgs({ units, tail }, { box, mean }) {
    const loss = col(units, 'loss');
    if (!loss) return null;
    // Units first, total last, so the total draws on top of them and takes the
    // anchor markers.
    const names = suffixes(units, 'p_').filter((n) => n !== 'total');
    const series = names.map((n) => ({
        name: n, mass: col(units, `p_${n}`), tailProb: col(units, `S_${n}`),
    })).filter((s) => s.mass && s.tailProb);
    const total = col(units, 'p_total');
    const totalS = col(units, 'S');
    if (total && totalS) series.push({ name: 'total', mass: total, tailProb: totalS });
    if (!series.length) return null;
    return { loss, cdf: col(units, 'F'), tail, box, mean, series };
}

function sevPanelArgs({ density }, { name, box, mean }) {
    const loss = col(density, 'loss');
    const pdf = col(density, 'pdf');
    const S = col(density, 'S');
    if (!loss || !pdf || !S) return null;
    return {
        loss, cdf: col(density, 'F'), tail: null, box, mean,
        series: [{ name: name || 'severity', mass: pdf, tailProb: S }],
        // A severity is a density ordinate, not a mass, and its support is
        // routinely unbounded. Say so rather than letting the reader assume the
        // aggregate's semantics.
        densityTitle: 'Severity density',
        densityName: 'pdf',
        // The one panel in the app whose x values are samples of a function
        // rather than the whole of it, so it draws as a continuous line at any
        // density. Steps would claim the value holds across a bucket, and a pdf
        // has no bucket: `f(x)` is the ordinate at `x` and it is different at
        // every point between two grid points. It has been drawn as steps since
        // the exhibit landed, because one shared `densitySeries` applied the
        // aggregate's reasoning to every kind that passed through it.
        support: 'continuous',
    };
}

function pnlPanelArgs({ density }, { name, box, mean }) {
    const loss = col(density, 'loss');
    const mass = col(density, 'p_total');
    const F = col(density, 'F');
    if (!loss || !mass || !F) return null;
    // A P&L outcome axis is signed and the bad tail is the LOW end, so the
    // return period runs off F, not S: a 1-in-200 year is the outcome only
    // 1/200 of years fall below, not above.
    return {
        loss, cdf: F, tail: null, box, mean, zeroLine: 0,
        series: [{ name: name || 'P&L', mass, tailProb: F }],
        tailTitles: ['Downside probability', 'Downside return period'],
        tailNames: ['F(x)', 'return period'],
    };
}

/**
 * Wrap an argument builder as an ECharts `build`.
 *
 * `zoom` is injected here rather than threaded through each `panelArgs`. It is
 * a fact about the viewport, not about the object, and none of the four
 * builders has any use for it: they pick columns.
 */
const echartsBuild = (panelArgs) => (data, opts) => {
    const args = panelArgs(data, opts);
    return args && twoPanel({ ...args, zoom: opts.zoom });
};

const EXHIBITS = {
    agg: {
        layout: twoPanelBox,
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            const [density, tail] = await Promise.all([
                api.density_df(id, { cols: 'loss,p_total,F,S' }),
                api.tail_df(id).catch(() => null),
            ]);
            return { density, tail };
        },
        panelArgs: aggPanelArgs,
        build: echartsBuild(aggPanelArgs),
    },

    port: {
        layout: twoPanelBox,
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            const [units, tail] = await Promise.all([
                api.unit_density_df(id),
                api.tail_df(id).catch(() => null),
            ]);
            return { units, tail };
        },
        panelArgs: portPanelArgs,
        build: echartsBuild(portPanelArgs),
    },

    sev: {
        layout: twoPanelBox,
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            return { density: await api.density_df(id) };
        },
        panelArgs: sevPanelArgs,
        build: echartsBuild(sevPanelArgs),
    },

    pnl: {
        layout: twoPanelBox,
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            return { density: await api.density_df(id, { cols: 'loss,p_total,F,S' }) };
        },
        panelArgs: pnlPanelArgs,
        build: echartsBuild(pnlPanelArgs),
    },

    distortion: {
        layout: (width) => squareBox(width),
        controls: [],
        async fetch(id) {
            return { curve: await api.density_df(id) };
        },
        build({ curve }, { box }) {
            const x = col(curve, 'x');
            const g = col(curve, 'g');
            if (!x || !g) return null;
            const color = seriesColor(0);
            // Square, and both axes on [0, 1]: g(s) lives on the unit square and
            // the only thing anyone reads off it is concavity, which a stretched
            // aspect ratio misrepresents. This is `aspect='equal'`.
            const { side, left, top, bottom, hostHeight } = box;
            return {
                ...baseOption(),
                hostHeight,
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
        // Square either way, and the *same* square either way, so flipping the
        // 3-D toggle changes what is drawn without moving anything on the page.
        layout: (width) => squareBox(width, BVAGG_PADS),
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
            // recoverable from that payload alone. The chart document has
            // neither problem: the library emitter ships both resolved labels
            // and block-sums the display grid upstream, so the surface payload
            // is display sized however fine the model grid is. The joint frame
            // stays fetched for the heatmap, which converts in its own pass
            // (dev/plan-chart-ir.md, conversion order).
            const [joint, stats, surfaceDoc] = await Promise.all([
                api.density_df(id, { view: 'joint' }),
                api.stats_df(id).catch(() => null),
                api.chartDoc(id, 'joint_surface').catch(() => null),
            ]);
            return { joint, stats, surfaceDoc };
        },
        build({ joint, stats, surfaceDoc }, { box }) {
            const [xName, yName] = axisNames(joint, stats);
            const { side, left, top, hostHeight } = box;
            // 3-D when the renderer is loaded, asked for, and the document
            // arrived; the flat heatmap otherwise, so a WebGL-less browser, a
            // failed chunk, or a failed fetch still lands on a picture rather
            // than an empty pane.
            if (view.surface3d && surfaceReady && surfaceDoc) {
                const option = chartdocToEcharts(surfaceDoc, {
                    logZ: Boolean(view.logZ),
                    overrides: (ctx) => surfaceOverrides({ ...ctx, side }),
                });
                if (option) {
                    option.hostHeight = hostHeight;
                    return option;
                }
            }
            const grid = heatmapData(joint, [xName, yName]);
            if (!grid) return null;
            const s = houseStyle();
            // Square for the same reason as the distortion: a joint density
            // stretched wide lies about where the mass sits. The right pad
            // leaves room for the colorbar.
            return {
                ...baseOption(),
                hostHeight,
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

// The chart decisions, separated from the ECharts option they end up in and
// exported for the smoke test, which reads them directly.
export { twoPanelData };

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
    // Its own node, created once. `renderTools` runs again on every toggle, so
    // a rubric inserted as a sibling of `tools` would stack a copy per press.
    const rubric = el('p', { className: 'exhibit-rubric' });
    const host = el('div', { className: 'exhibit-canvas' });
    container.appendChild(tools);
    container.appendChild(rubric);
    container.appendChild(host);

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
        renderRubric();
    }

    /**
     * What the basis buttons are actually choosing, in a line under them.
     *
     * The frame is not "gross, ceded, net". It is three separate gross / ceded
     * / net readings taken at different points in the program, and which one
     * you want is a real question. Through a51 the answer existed only as a
     * native `title` on each button, which arrives after a second's hover and
     * is invisible to anyone who does not think to hover.
     *
     * The `subject` wrinkle is spelled out because it is a trap: on the third
     * triple the first column is what the occurrence program *left*, not the
     * true gross, and reading it as gross understates the cession whenever both
     * stages are present.
     */
    function renderRubric() {
        empty(rubric);
        const bit = (label, text) => {
            rubric.appendChild(el('b', {}, label));
            rubric.appendChild(document.createTextNode(` ${text}`));
        };
        const parts = [];
        if (available.includes('sev')) {
            parts.push(['occurrence', 'one claim, either side of the per-occurrence cover.']);
        }
        if (available.includes('occ')) {
            parts.push(['after occurrence',
                        'the aggregate of each of those, so gross here is the true gross.']);
        }
        if (available.includes('agg')) {
            parts.push(['after aggregate',
                        'the aggregate cover, whose first column is its subject, what the '
                        + 'occurrence program left, and not the gross.']);
        }
        parts.forEach(([label, text], i) => {
            if (i) rubric.appendChild(document.createTextNode(' '));
            bit(label, text);
        });
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
            loss, cdf, series, tail: null, box: twoPanelBox(host.clientWidth || 0),
        });
    }

    let option = buildOption();
    if (!option) { empty(container); return null; }
    renderTools();
    empty(host);
    host.style.height = `${option.hostHeight}px`;
    const chart = echarts.init(host, null, { renderer: 'canvas' });
    chart.setOption(option);
    linkPanels(chart, option);

    function redraw() {
        const next = buildOption();
        if (!next) return;
        option = next;
        host.style.height = `${option.hostHeight}px`;
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
// The words the skeleton puts above each panel. Presentational only: these
// mirror the titles the builds set, and a drift here costs a moment of wrong
// label rather than a wrong shape. Kept in one place instead of threaded through
// six specs for that reason.
const tailTitle = () => (view.epMode === 'rp' ? 'Return period' : 'Survival');
const SKELETON_TITLES = {
    agg: () => ['Density', tailTitle()],
    port: () => ['Density', tailTitle()],
    sev: () => ['Severity density', tailTitle()],
    pnl: () => ['Density', view.epMode === 'rp'
        ? 'Downside return period' : 'Downside probability'],
    distortion: () => ['Distortion g(s)'],
    bvagg: () => ['Joint density'],
    reins: () => ['Density', tailTitle()],
};

/**
 * Fill `host` with the exhibit's outline, at its final size, before the fetch.
 *
 * The panels are positioned at the exact grid geometry the chart will use and
 * the titles sit where the chart will put its own, so the arriving chart lands
 * on top of its own outline instead of replacing a differently shaped block. A
 * reserved but empty box says nothing; this says a graph is coming, and where.
 *
 * Parameters
 * ----------
 * host : HTMLElement
 *     The chart's mount point. Emptied, sized and given a positioning context.
 * kind : str
 *     A key of `EXHIBITS`, or `'reins'`.
 * width : number
 *     Host width in CSS pixels.
 *
 * Returns
 * -------
 * object
 *     The layout box, so a caller that already needed it does not compute it
 *     twice.
 */
export function showPlaceholder(host, kind, width) {
    const spec = EXHIBITS[kind];
    const box = (spec && spec.layout ? spec.layout : twoPanelBox)(width);
    empty(host);
    host.style.position = 'relative';
    host.style.height = `${box.hostHeight}px`;

    const titles = (SKELETON_TITLES[kind] || SKELETON_TITLES.agg)();
    const panels = box.twoPanel
        ? box.grids.map((g) => ({ ...g }))
        : [{ left: box.left, top: box.top, width: box.side, height: box.side }];

    const skin = el('div', { className: 'exhibit-skeleton' });
    panels.forEach((p, i) => {
        if (titles[i]) {
            skin.appendChild(el('div', {
                className: 'exhibit-skeleton-title',
                style: `left:${p.left}px; top:${p.top - 24}px`,
            }, titles[i]));
        }
        skin.appendChild(el('div', {
            className: 'exhibit-skeleton-panel',
            style: `left:${p.left}px; top:${p.top}px;`
                 + `width:${p.width}px; height:${p.height}px`,
        }, el('i', { className: 'bi bi-graph-up', 'aria-hidden': 'true' })));
    });
    host.appendChild(skin);
    return box;
}

export async function mountExhibit(container, state) {
    const spec = EXHIBITS[state.kind];
    if (!spec) return null;

    // Draw the outline FIRST, at its final size, before anything is fetched. A
    // density payload is a couple of hundred kilobytes and the style endpoint is
    // its own round trip; a chart that sizes itself on arrival shoves everything
    // below it down the page at the moment the reader has started reading. The
    // number is exact rather than an estimate, because `spec.layout` is the same
    // function the build takes its geometry from.
    empty(container);
    const controls = spec.controls || [];
    const tools = el('div');
    const host = el('div', { className: 'exhibit-canvas' });
    container.appendChild(tools);
    container.appendChild(host);
    showPlaceholder(host, state.kind, host.clientWidth || 0);

    // `box` comes from the spec's own layout, so what the build draws into is
    // what was reserved. Recomputed per call because a resize changes it.
    // The loss window the reader is currently zoomed into, or null for none.
    // Read by the draw so the atom count, and therefore the drawing, follows
    // the gesture. See the `dataZoom` wiring below.
    let zoom = null;

    const opts = () => {
        const width = host.clientWidth || 0;
        return {
            ...state,
            wide: width >= WIDE_PX,
            width,
            zoom,
            box: spec.layout(width),
        };
    };

    // The control row splits across the two panels only when they sit side by
    // side, so it is re-rendered when the layout breakpoint moves.
    function renderTools() {
        empty(tools);
        tools.appendChild(
            renderControls(controls, opts().wide, () => onToggle()));
    }

    // Declared before the controls are wired, not beside the chart it guards: the
    // buttons below can fire during the fetch, and a `let` declared further down
    // would be in its temporal dead zone when `redraw` read it.
    let ready = false;

    // Drawn now, not after the data lands. The controls depend on the width and
    // the spec, never on the payload, so rendering them up front means the strip
    // above the chart is already the height it will keep. Rendering them late
    // reserved the chart perfectly and then pushed it down by a button row
    // anyway. `redraw` no-ops until there is something to draw, so a toggle
    // pressed mid-fetch just records the view and is picked up on arrival.
    renderTools();

    // The 3-D chunk, if this exhibit can use one, and the house colors, both in
    // parallel with the data. `loadStyle` lives here rather than at the call site
    // so its round trip happens behind the skeleton too.
    const needs3d = controls.includes('surface3d') && view.surface3d;
    let data;
    try {
        const [payload, loaded] = await Promise.all([
            spec.fetch(state.id),
            needs3d ? loadSurface() : Promise.resolve(false),
            loadStyle().catch(() => null),   // colors are a bonus, not a blocker
        ]);
        data = payload;
        if (loaded) surfaceReady = true;
    } catch {
        empty(container);
        return null;                     // a frame this kind lacks; not an error
    }

    // The live renderer: `{update(), dispose()}`.
    let renderer = null;

    // What the last draw settled on, so the zoom listener can tell a gesture
    // that changes the picture from one that only moves it.
    let drawn = null;

    function draw() {
        const next = spec.build(data, opts());
        if (!next) return false;
        drawn = next;
        // Same height the skeleton was already holding, so nothing moves.
        host.style.height = `${next.hostHeight}px`;
        if (!renderer) {
            // `empty` clears the skeleton, which the chart would otherwise draw
            // over rather than replace.
            empty(host);
            renderer = echartsRenderer(host, next);
            wireZoom();
            return true;
        }
        renderer.update(next);
        return true;
    }

    /**
     * Redraw when a zoom changes which rung of the ladder applies.
     *
     * The half of the drawing rule that was never built. `dataZoom` was in the
     * option from the start and nothing listened to it, so zooming into a
     * handful of atoms left them drawn as whatever the full crop had decided:
     * the lollipop was only ever reachable on a book that was small to begin
     * with, which is not what it is for.
     *
     * Guarded twice, because a wheel gesture fires this continuously. The rung
     * has to actually change, and rebuilding an option per wheel notch would
     * be an option rebuild per frame otherwise. `renderer.update` then replaces
     * the option, and `twoPanel` writes the held zoom back into the new
     * dataZoom config so the gesture survives its own consequence.
     */
    function wireZoom() {
        const chart = renderer && renderer.chart;
        if (!chart || !drawn || !drawn.lossWindow) return;
        chart.on('dataZoom', () => {
            const w = drawn && drawn.lossWindow;
            if (!w || !(w[1] > w[0])) return;
            // Read back off the chart rather than out of the event: an `inside`
            // dataZoom reports a batch on some gestures and bare start / end on
            // others, and the component's own state is the one that is always
            // current.
            const dz = (chart.getOption().dataZoom || [])[0];
            if (!dz || dz.start == null) return;
            const span = w[1] - w[0];
            const full = dz.start <= 0 && dz.end >= 100;
            const next = full ? null : [w[0] + (span * dz.start) / 100,
                                        w[0] + (span * dz.end) / 100];
            // The rung, from a count rather than from a trial build. Building
            // the option to find out would be the per-frame rebuild this guard
            // exists to prevent.
            const rung = densityStyle(
                atomsInView(drawn.lossGrid, next), drawn.supportKind);
            zoom = next;
            if (rung === drawn.densityDrawnAs) return;
            const redrawn = spec.build(data, opts());
            if (!redrawn) return;
            drawn = redrawn;
            host.style.height = `${redrawn.hostHeight}px`;
            renderer.update(redrawn);
        });
    }

    if (!draw()) { empty(container); return null; }

    // Turning the 3-D view on for the first time has to fetch its renderer, so a
    // toggle is not always a synchronous redraw.
    async function onToggle() {
        if (view.surface3d && controls.includes('surface3d') && !surfaceReady) {
            if (await loadSurface()) surfaceReady = true;
        }
        redraw();
    }

    ready = true;
    function redraw() {
        if (!ready) return;
        draw();
    }

    // Rebuild on resize, always: every panel is sized from the host width so it
    // can hold the house aspect, which a bare `resize()` (stretching the old
    // geometry) would not do.
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
            ready = false;
            try { ro.disconnect(); } catch { /* already gone */ }
            if (renderer) renderer.dispose();
        },
    };
}

/**
 * The ECharts lifecycle, as a renderer handle.
 *
 * `notMerge` on every update: a toggle can change an axis *type* (value to log)
 * and swap which series carry markLines, and a merged `setOption` would leave
 * the old ones behind. A 2-D to 3-D switch changes more than that, so the
 * instance is disposed and rebuilt, because ECharts cannot migrate a `grid`
 * option to a `grid3D` one in place.
 */
function echartsRenderer(host, option) {
    let is3d = Boolean(option.grid3D);
    let chart = echarts.init(host, null, { renderer: 'canvas' });
    chart.setOption(option);
    linkPanels(chart, option);
    return {
        engine: 'echarts',
        // Exposed for the zoom listener, which has to subscribe to the live
        // instance and read its dataZoom state back. A getter rather than a
        // field because `update` replaces the instance when the 3-D toggle
        // flips, and a captured reference would go stale on that path.
        get chart() { return chart; },
        update(next) {
            const next3d = Boolean(next.grid3D);
            if (next3d !== is3d) {
                is3d = next3d;
                try { chart.dispose(); } catch { /* already gone */ }
                chart = echarts.init(host, null, { renderer: 'canvas' });
            }
            chart.setOption(next, true);
            chart.resize();
            linkPanels(chart, next);
        },
        dispose() {
            try { chart.dispose(); } catch { /* already gone */ }
        },
    };
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
