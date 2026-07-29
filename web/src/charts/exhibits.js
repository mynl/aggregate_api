// The Overview exhibit: one chart specification per first-class citizen.
//
// The shape for anything with a loss distribution is two linked panels:
//
//   density (what it looks like)      exceedance (what it costs)
//   x = loss, linear, cropped         x = return period, log
//   y = probability mass              y = loss
//
// The right-hand panel is the one an insurance reader looks at first, which is
// why it gets equal billing rather than living behind a toggle: the capital
// anchors (1-in-100 / 200 / 250) are points *on* the curve instead of dashed
// lines floating over a density, and a portfolio becomes one curve per unit
// against the total, which is the diversification story stated in a picture.
//
// Both panels are drawn from the same row array, so a point's index means the
// same thing in each. That is what lets the cursor link exactly: hovering a
// loss on the left highlights its return period on the right, because they are
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
// The registry is total over the six kinds, so the Overview always lands on
// something rather than reporting that it has nothing to draw.

import { api } from '../api.js';
import { el, empty } from '../utils/dom.js';
import { fmt } from '../utils/format.js';
import { echarts, baseOption, axisStyle, seriesColor, fade, lineWidth, houseStyle }
    from './theme.js';

// Return periods flagged on the exceedance curve: the capital anchors first.
const ANCHORS = [100, 200, 250];

// The anchor carried onto the density panel as a reference line. One, not three:
// the point is to say where capital sits, and three dashed verticals over a
// density say nothing three times.
const REF_ANCHOR = 200;

// The return-period window runs from an annual event out to 1-in-100,000. Past
// that the survival function is FFT noise rather than tail, and plotting it
// would invite reading precision that is not there.
const T_MIN = 1;
const T_MAX = 1e5;

// Side-by-side needs room for two readable axes; below this the panels stack.
const WIDE_PX = 720;

// Bounds on the square plot area used by the single-panel exhibits.
const SQUARE_MIN = 240;
const SQUARE_MAX = 420;

// At or below this many points carrying mass, the density is drawn as steps
// rather than as a line: `drawstyle='steps-mid'` in matplotlib terms. A
// discrete book (`dfreq [3] dsev [1:6]`, bs = 1) puts mass on 16 integers, and
// joining those with a sloped line draws probability where there is none. The
// threshold is generous because the failure is one-sided: steps are honest for
// a coarse continuous grid too, whereas a line over a lattice is a lie.
const STEP_MAX_POINTS = 256;

// ---- view state -------------------------------------------------------
//
// Sticky per browser, like the Static | Interactive table toggle: a chosen view
// survives a rebuild and a reload, so you are not re-clicking log-y every time
// you press Build.

const VIEW_KEY = 'aggapi.exhibitView';

const VIEW_DEFAULTS = {
    logY: false,        // density panel: linear or log mass
    epMode: 'rp',       // right panel: 'rp' (loss vs return period) or 'survival'
    xFull: false,       // density x: cropped to q(0.001)..q(0.999), or the full grid
    refLines: true,     // mean and the 1-in-200 anchor, drawn on both panels
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

// What each toggle says and which exhibits it applies to. A spec declares the
// subset it honors, so a distortion never shows a log-y button that does
// nothing.
const CONTROLS = {
    logY: { label: 'log y', title: 'Log density: where a heavy tail becomes readable' },
    epMode: { label: 'survival', title: 'Swap return period for survival, S against loss' },
    xFull: { label: 'full x', title: 'Show the whole grid, not just q(0.001) to q(0.999)' },
    refLines: { label: 'reference lines', title: 'Mean and the 1-in-200 anchor' },
};

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
 * In `rp` mode a point is `[return period, loss]`; in `survival` mode it is
 * `[loss, exceedance]`. Same numbers either way, transposed, which is the whole
 * content of the toggle. A probability outside the plotted window becomes
 * `null` rather than being dropped, so a dataIndex still identifies the same
 * grid bucket in both panels.
 *
 * Parameters
 * ----------
 * loss : number[]
 * tailProb : number[]
 *     Exceedance probability per row. `S` for a loss distribution; `F` for a
 *     signed P&L, where the bad tail is the low end.
 * mode : {'rp', 'survival'}
 */
function rightPairs(loss, tailProb, mode) {
    return loss.map((x, i) => {
        const p = tailProb[i];
        if (!(p > 0) || !Number.isFinite(p)) return null;
        if (mode === 'survival') return [x, p];
        const T = 1 / p;
        if (!(T >= T_MIN) || T > T_MAX) return null;
        return [T, x];
    });
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

/**
 * Should this series be drawn as steps rather than as a line?
 *
 * True when the mass sits on few enough points that the grid is a lattice, not
 * a sampled curve. See :data:`STEP_MAX_POINTS`.
 */
function isStepped(mass) {
    let n = 0;
    for (const v of mass) {
        if (v > 0 && ++n > STEP_MAX_POINTS) return false;
    }
    return n > 0;
}

/** One density line, filled under the curve when it is the only one. */
function densitySeries(name, loss, mass, i, solo) {
    const color = seriesColor(i);
    // A log axis cannot place zero, and the tail of a discretized density is
    // full of exact zeros. Emit them as gaps rather than letting ECharts drop
    // them silently or clamp them onto the axis floor.
    const y = view.logY ? mass.map((v) => (v > 0 ? v : null)) : mass;
    return {
        name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        // `step: 'middle'` is matplotlib's `drawstyle='steps-mid'`: the value
        // holds across a bucket centred on its grid point. For a discrete book
        // that is what the distribution *is*; a sloped line between atoms draws
        // probability at values that cannot occur.
        step: isStepped(mass) ? 'middle' : false,
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
 * Dashed verticals with the label at the top, not plotted points. A point has
 * to sit exactly on the drawn curve to look right, and it cannot: the curve is
 * a binned display grid while the anchor is the library's own quantile function
 * at that return period, so the marker landed slightly off the line every time.
 * A vertical line says "this return period is here on the x-axis", which is
 * true of the axis rather than of the curve, and reads correctly however coarse
 * the grid is.
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
    const out = [];
    for (const r of tail.rows) {
        if (iUnit >= 0 && String(r[iUnit]) !== 'total') continue;
        const T = Number(r[iT]);
        if (!ANCHORS.includes(T)) continue;
        // In rp mode the x-axis is the return period; in survival mode it is
        // loss, so the same anchor sits at its VaR.
        const x = view.epMode === 'survival' ? Number(r[iVaR]) : T;
        if (!Number.isFinite(x)) continue;
        out.push({
            xAxis: x,
            name: `1-in-${returnPeriod(T)}`,
            lineStyle: { color: '#6c757d', type: 'dashed', width: 1, opacity: 0.45 },
        });
    }
    return out;
}

/**
 * A dashed reference line. Entries may override `lineStyle` per item, which is
 * how the faint capital anchors and the solid-weight mean share one markLine.
 */
function refLine(entries) {
    if (!entries.length) return undefined;
    return {
        symbol: 'none',
        silent: true,
        label: {
            show: true, fontSize: 10, color: '#6c757d',
            position: 'end', distance: 4, formatter: (p) => p.name,
        },
        lineStyle: { color: '#6c757d', type: 'dashed', width: 1 },
        data: entries,
    };
}

// ---- the two-panel option ---------------------------------------------

/**
 * Assemble the two-panel option from per-series density and right-panel data.
 *
 * Series in the two panels share a `name`, which is what makes one legend entry
 * toggle a unit in both panels at once.
 */
function twoPanel({ loss, cdf, series, tail, wide, mean, rightLabel = 'loss', zeroLine }) {
    const solo = series.length === 1;
    const survival = view.epMode === 'survival';
    const density = series.map((s, i) => densitySeries(s.name, loss, s.mass, i, solo));
    const right = series.map((s, i) => rightSeries(s.name, loss, s.tailProb, i));

    // Reference lines go on the first series of each panel, so they draw once.
    // The capital anchors are always drawn on the right panel (they are what
    // that panel is for); the mean and break-even lines follow the toggle.
    const dens = [];
    const rightRefs = anchorLines(tail);
    if (zeroLine != null) dens.push({ xAxis: zeroLine, name: 'break even' });
    if (view.refLines) {
        const anchorVaR = varAt(tail, REF_ANCHOR);
        if (Number.isFinite(mean)) {
            dens.push({ xAxis: mean, name: 'mean' });
            // In rp mode loss is the y-axis, in survival mode the x-axis.
            rightRefs.push(survival ? { xAxis: mean, name: 'mean' }
                                    : { yAxis: mean, name: 'mean' });
        }
        if (Number.isFinite(anchorVaR)) {
            dens.push({ xAxis: anchorVaR, name: `1-in-${REF_ANCHOR}` });
        }
    }
    if (dens.length) density[0].markLine = refLine(dens);
    if (rightRefs.length && right.length) right[0].markLine = refLine(rightRefs);

    const window = densityWindow(loss, cdf);
    const grids = wide
        ? [{ left: 52, right: '54%', top: 28, bottom: 62 },
           { left: '52%', right: 28, top: 28, bottom: 62 }]
        : [{ left: 58, right: 24, top: 28, height: 150 },
           { left: 58, right: 24, top: 232, height: 150 }];

    // In survival mode the right panel shares the density's loss axis, so it
    // takes the same window: the two panels then read as one picture.
    const rightX = survival
        ? axisStyle({
            gridIndex: 1, type: 'value', name: 'loss', scale: true,
            min: window ? window[0] : 'dataMin',
            max: window ? window[1] : 'dataMax',
            axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                         formatter: (v) => fmt(v) },
        })
        : axisStyle({
            gridIndex: 1, type: 'log', logBase: 10, name: 'return period',
            min: T_MIN, max: T_MAX,
            axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                         formatter: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k`
                                                      : returnPeriod(v)) },
        });

    const rightY = survival
        ? axisStyle({
            gridIndex: 1, type: 'log', logBase: 10, name: 'exceedance', scale: true,
            axisLabel: { fontSize: 10, color: '#6c757d',
                         formatter: (v) => (v >= 0.01 ? String(v) : v.toExponential(0)) },
        })
        : axisStyle({
            gridIndex: 1, type: 'value', name: rightLabel, scale: true,
            axisLabel: { fontSize: 10, color: '#6c757d', formatter: (v) => fmt(v) },
        });

    return {
        ...baseOption(),
        grid: grids,
        title: [
            { text: 'Density', left: wide ? 52 : 58, top: 2,
              textStyle: { fontSize: 12, fontWeight: 600 } },
            { text: survival ? 'Survival' : 'Exceedance probability',
              left: wide ? '52%' : 58, top: wide ? 2 : 206,
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
        yAxis: [
            axisStyle({
                gridIndex: 0, type: view.logY ? 'log' : 'value',
                name: view.logY ? 'log density' : 'density', scale: true,
                axisLabel: { fontSize: 10, color: '#6c757d',
                             formatter: (v) => (v ? v.toExponential(0) : '0') },
            }),
            rightY,
        ],
        // filterMode 'filter' drops out-of-window points from the axis extent
        // calculation, so the y-axis rescales to what is actually visible.
        // Without it, zooming into a tail zooms into a flat strip near zero.
        dataZoom: [
            { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
            { type: 'inside', xAxisIndex: 1, filterMode: 'filter' },
        ],
        tooltip: {
            ...baseOption().tooltip,
            formatter: (params) => {
                const rows = (Array.isArray(params) ? params : [params])
                    .filter((p) => Array.isArray(p.value));
                if (!rows.length) return '';
                const first = rows[0];
                const onRight = first.seriesIndex >= density.length;
                const head = (onRight && !survival)
                    ? `1-in-${returnPeriod(first.value[0])}`
                    : `loss ${fmt(first.value[0])}`;
                const body = rows.map((p) => {
                    const v = onRight
                        ? (survival ? p.value[1].toExponential(2) : fmt(p.value[1]))
                        : p.value[1].toExponential(2);
                    return `${p.marker}${p.seriesName} <b>${v}</b>`;
                }).join('<br>');
                return `${head}<br>${body}`;
            },
        },
        series: [...density, ...right],
    };
}

/** Grid, title and host height for a square single-panel exhibit. */
function squareLayout(width, { left = 56, rightPad = 28 } = {}) {
    const side = Math.max(SQUARE_MIN,
        Math.min(SQUARE_MAX, (width || SQUARE_MAX) - left - rightPad));
    return { side, left, top: 28, bottom: 52 };
}

// ---- per-kind exhibits ------------------------------------------------
//
// Each entry is {controls, fetch, build}. `fetch` gathers the frames; `build`
// turns them into an ECharts option and is pure, so the node smoke test can
// exercise it without a DOM. `controls` names the toggles the exhibit honors,
// so a distortion never offers a log-y button that would do nothing.

const TWO_PANEL_CONTROLS = ['logY', 'epMode', 'xFull', 'refLines'];

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
        build({ density, tail }, { name, wide, mean }) {
            const loss = col(density, 'loss');
            const mass = col(density, 'p_total');
            const S = col(density, 'S');
            if (!loss || !mass || !S) return null;
            return twoPanel({
                loss, cdf: col(density, 'F'), tail, wide, mean,
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
        build({ units, tail }, { wide, mean }) {
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
            return twoPanel({ loss, cdf: col(units, 'F'), tail, wide, mean, series });
        },
    },

    sev: {
        controls: TWO_PANEL_CONTROLS,
        async fetch(id) {
            return { density: await api.density_df(id) };
        },
        build({ density }, { name, wide, mean }) {
            const loss = col(density, 'loss');
            const pdf = col(density, 'pdf');
            const S = col(density, 'S');
            if (!loss || !pdf || !S) return null;
            const option = twoPanel({
                loss, cdf: col(density, 'F'), tail: null, wide, mean,
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
        build({ density }, { name, wide, mean }) {
            const loss = col(density, 'loss');
            const mass = col(density, 'p_total');
            const F = col(density, 'F');
            if (!loss || !mass || !F) return null;
            // A P&L outcome axis is signed and the bad tail is the LOW end, so
            // the return period runs off F, not S: a 1-in-200 year is the
            // outcome only 1/200 of years fall below, not above.
            const option = twoPanel({
                loss, cdf: F, tail: null, wide, mean, rightLabel: 'outcome', zeroLine: 0,
                series: [{ name: name || 'P&L', mass, tailProb: F }],
            });
            option.title[1].text = view.epMode === 'survival'
                ? 'Downside probability' : 'Downside return period';
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
        controls: [],
        async fetch(id) {
            // stats_df carries both component names as its value columns. The
            // joint frame only names axis 0 (its first column); axis 1 arrives
            // as bare grid values for column headers, so its name is not
            // recoverable from that payload alone.
            const [joint, stats] = await Promise.all([
                api.density_df(id),
                api.stats_df(id).catch(() => null),
            ]);
            return { joint, stats };
        },
        build({ joint, stats }, { width }) {
            const grid = heatmapData(joint, axisNames(joint, stats));
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

// The three aggregate bases in `reins_density_df` worth drawing together.
// Gross first so the cession reads as something taken out of it, and so `net`
// draws on top where the two nearly coincide.
const REINS_BASES = [
    ['p_agg_gross', 'gross'],
    ['p_agg_ceded', 'ceded'],
    ['p_agg_net', 'net'],
];

/**
 * The gross / ceded / net series from a `reins_density_df` payload.
 *
 * Exported for the offline smoke test, which checks the derived survivals
 * without needing a DOM.
 *
 * Notes
 * -----
 * The frame carries the masses but no survival column, so `S` is accumulated
 * here. That is exact rather than an approximation: each `p_agg_*` column is a
 * probability mass function over the same grid and sums to one, so `1 - cumsum`
 * *is* its survival function.
 */
export function reinsSeries(frame) {
    const series = [];
    for (const [column, label] of REINS_BASES) {
        const mass = col(frame, column);
        if (!mass) continue;
        let acc = 0;
        // Clamped at zero: accumulating 2,048 floats to 1 overshoots by a few
        // parts in 1e15, and a survival of -3.6e-15 is not a number to hand a
        // log axis.
        const tailProb = mass.map((v) => {
            acc += (v || 0);
            return Math.max(0, 1 - acc);
        });
        series.push({ name: label, mass, tailProb });
    }
    return series;
}

/**
 * Mount the gross / ceded / net exhibit for a reinsured object.
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
 *     aggregate bases (a severity-only cession, say).
 */
export function mountReinsExhibit(container, frame) {
    const loss = col(frame, 'loss');
    if (!loss) return null;
    const series = reinsSeries(frame);
    if (!series || !series.length) return null;

    empty(container);
    const controls = ['logY', 'epMode', 'xFull'];
    container.appendChild(renderControls(controls, () => redraw()));
    const host = el('div', { className: 'exhibit-canvas' });
    container.appendChild(host);

    // The gross basis carries the cdf for the x-window: it is the widest of
    // the three, so cropping to it keeps all of them on screen.
    const cdf = series[0].mass.map(((acc) => (v) => (acc += (v || 0)))(0));

    const buildOption = () => twoPanel({
        loss, cdf, series, tail: null,
        wide: (host.clientWidth || 0) >= WIDE_PX,
    });

    let option = buildOption();
    host.style.height = `${chartHeight(option)}px`;
    const chart = echarts.init(host, null, { renderer: 'canvas' });
    chart.setOption(option);
    linkPanels(chart, option);

    function redraw() {
        option = buildOption();
        host.style.height = `${chartHeight(option)}px`;
        chart.setOption(option, true);
        chart.resize();
        linkPanels(chart, option);
    }

    let lastWide = (host.clientWidth || 0) >= WIDE_PX;
    const ro = new ResizeObserver(() => {
        const nowWide = (host.clientWidth || 0) >= WIDE_PX;
        if (nowWide !== lastWide) { lastWide = nowWide; redraw(); } else chart.resize();
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

/** The toggle row: one pressed-state button per control the exhibit honors. */
function renderControls(names, onChange) {
    const row = el('div', { className: 'exhibit-controls' });
    for (const key of names) {
        const spec = CONTROLS[key];
        if (!spec) continue;
        const on = key === 'epMode' ? view.epMode === 'survival' : Boolean(view[key]);
        const btn = el('button', {
            type: 'button',
            className: `exhibit-toggle${on ? ' active' : ''}`,
            title: spec.title,
            onClick: () => {
                const next = key === 'epMode'
                    ? { epMode: view.epMode === 'survival' ? 'rp' : 'survival' }
                    : { [key]: !view[key] };
                setView(next);
                const nowOn = key === 'epMode'
                    ? view.epMode === 'survival' : Boolean(view[key]);
                btn.classList.toggle('active', nowOn);
                onChange();
            },
        }, spec.label);
        row.appendChild(btn);
    }
    return row;
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

    let data;
    try {
        data = await spec.fetch(state.id);
    } catch {
        return null;                     // a frame this kind lacks; not an error
    }

    empty(container);
    const controls = spec.controls || [];
    const host = el('div', { className: 'exhibit-canvas' });
    // Controls first so the chart measures against its final width.
    if (controls.length) container.appendChild(renderControls(controls, () => redraw()));
    container.appendChild(host);

    const opts = () => ({
        ...state,
        wide: (host.clientWidth || 0) >= WIDE_PX,
        width: host.clientWidth || 0,
    });

    let option = spec.build(data, opts());
    if (!option) { empty(container); return null; }

    host.style.height = `${chartHeight(option)}px`;
    const chart = echarts.init(host, null, { renderer: 'canvas' });
    chart.setOption(option);
    linkPanels(chart, option);

    // `notMerge` on every redraw: a toggle can change an axis *type*
    // (value -> log) and swap which series carry markLines, and a merged
    // setOption would leave the old ones behind.
    function redraw() {
        const next = spec.build(data, opts());
        if (!next) return;
        option = next;
        host.style.height = `${chartHeight(option)}px`;
        chart.setOption(option, true);
        chart.resize();
        linkPanels(chart, option);
    }

    // Rebuild on resize: the stacked / side-by-side breakpoint changes the grid
    // geometry, and the square exhibits size their plot area from the width.
    let lastWide = opts().wide;
    let lastWidth = opts().width;
    const ro = new ResizeObserver(() => {
        const now = opts();
        const breakpointCrossed = now.wide !== lastWide;
        const resized = Math.abs(now.width - lastWidth) > 8;
        lastWide = now.wide;
        lastWidth = now.width;
        if (breakpointCrossed || (resized && controls.length === 0)) redraw();
        else chart.resize();
    });
    ro.observe(host);

    return {
        dispose() {
            try { ro.disconnect(); } catch { /* already gone */ }
            try { chart.dispose(); } catch { /* already gone */ }
        },
    };
}

/** Host height: two panels stack on narrow, a square exhibit sizes to its side. */
function chartHeight(option) {
    const grids = Array.isArray(option.grid) ? option.grid : [option.grid];
    if (grids.length >= 2) {
        // Stacked panels declare an explicit `top`; side-by-side ones do not.
        return grids[1].top ? 420 : 320;
    }
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
