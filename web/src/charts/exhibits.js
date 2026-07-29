// The Overview exhibit: one chart specification per first-class citizen.
//
// The shape for anything with a loss distribution is two linked panels:
//
//   density (what it looks like)      EP curve (what it costs)
//   x = loss, linear, cropped         x = return period, log
//   y = probability mass              y = loss
//
// The EP panel is the one an insurance reader looks at first, which is why it
// gets equal billing rather than living behind a toggle: the capital anchors
// (1-in-100 / 200 / 250) are points *on* the curve instead of dashed lines
// floating over a density, and a portfolio becomes one curve per unit against
// the total, which is the diversification story stated in a picture.
//
// Both panels are drawn from the same row array, so a point's index means the
// same thing in each. That is what lets the cursor link exactly: hovering a
// loss on the left highlights its return period on the right, because they are
// literally the same grid bucket seen two ways. Series dropped from the EP
// panel (S = 0 out in the numerical noise) are emitted as `null` rather than
// omitted, so the indices stay aligned and ECharts draws a clean trailing gap.
//
// A kind with no loss distribution gets its own single-panel exhibit: a
// distortion its g-curve against the diagonal, a bivariate its joint density as
// a heatmap. The registry is total over the six kinds, so the Overview always
// lands on something rather than reporting that it has nothing to draw.

import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import { echarts, baseOption, axisStyle, seriesColor, fade, lineWidth, houseStyle }
    from './theme.js';

// Return periods flagged on the EP curve: the capital anchors first.
const ANCHORS = [100, 200, 250];

// The EP x-axis runs from an annual event out to 1-in-100,000. Past that the
// survival function is FFT noise, not tail, and plotting it would invite
// reading precision that is not there.
const T_MIN = 1;
const T_MAX = 1e5;

// Side-by-side needs room for two readable axes; below this the panels stack.
const WIDE_PX = 720;

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

// ---- series builders --------------------------------------------------

/**
 * The EP series: `[return period, loss]` per row, `null` where undefined.
 *
 * Parameters
 * ----------
 * loss : number[]
 * tailProb : number[]
 *     Exceedance probability per row. `S` for a loss distribution; `F` for a
 *     signed P&L, where the bad tail is the low end.
 *
 * Returns
 * -------
 * Array<[number, number]|null>
 *     Index-aligned with `loss`, so a dataIndex means the same row in either
 *     panel. A probability of zero or one falls outside the plotted window and
 *     becomes `null` rather than being dropped.
 */
function epPairs(loss, tailProb) {
    return loss.map((x, i) => {
        const p = tailProb[i];
        if (!(p > 0) || !Number.isFinite(p)) return null;
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
 * origin. Drag still zooms past the crop; the EP panel is where the tail is
 * meant to be read anyway. Returns null (auto-fit) when there is no usable cdf.
 */
function densityWindow(loss, cdf) {
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
    return {
        name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: loss.map((x, k) => [x, mass[k]]),
        showSymbol: false,
        lineStyle: { width: lineWidth(), color },
        itemStyle: { color },
        areaStyle: solo ? { color: fade(color, 0.10) } : undefined,
        emphasis: { focus: 'series' },
    };
}

/** One EP line, on the right-hand panel. */
function epSeries(name, loss, tailProb, i) {
    const color = seriesColor(i);
    return {
        name,
        type: 'line',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: epPairs(loss, tailProb),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: lineWidth(), color },
        itemStyle: { color },
        emphasis: { focus: 'series' },
    };
}

/**
 * Capital-anchor markers for the EP panel, read from `tail_df`.
 *
 * Taken from `tail_df` rather than off the plotted curve because that frame is
 * the library's own quantile function at those return periods, while the curve
 * is a binned display grid. Where they differ the library is right.
 */
function anchorMarkPoints(tail) {
    if (!tail || !tail.rows) return undefined;
    const at = indexer(tail);
    const iT = at('T');
    const iVaR = at('VaR');
    const iUnit = at('unit');
    if (iT < 0 || iVaR < 0) return undefined;
    const data = [];
    for (const r of tail.rows) {
        if (iUnit >= 0 && String(r[iUnit]) !== 'total') continue;
        const T = Number(r[iT]);
        if (!ANCHORS.includes(T)) continue;
        data.push({
            coord: [T, Number(r[iVaR])],
            value: `1-in-${T}`,
            name: `1-in-${T}`,
        });
    }
    if (!data.length) return undefined;
    return {
        symbol: 'circle',
        symbolSize: 7,
        label: {
            show: true, position: 'right', fontSize: 10,
            color: houseStyle().text_color,
            formatter: (p) => p.name,
        },
        itemStyle: { color: houseStyle().text_color, opacity: 0.75 },
        emphasis: { disabled: true },
        data,
    };
}

// ---- the two-panel option ---------------------------------------------

/**
 * Assemble the two-panel option from per-series density and EP definitions.
 *
 * Series in the two panels share a `name`, which is what makes one legend entry
 * toggle a unit in both panels at once.
 */
function twoPanel({ loss, cdf, series, tail, wide, epLabel = 'loss' }) {
    const solo = series.length === 1;
    const density = series.map((s, i) => densitySeries(s.name, loss, s.mass, i, solo));
    const ep = series.map((s, i) => epSeries(s.name, loss, s.tailProb, i));
    const anchors = anchorMarkPoints(tail);
    if (anchors && ep.length) ep[ep.length - 1].markPoint = anchors;

    const window = densityWindow(loss, cdf);
    const grids = wide
        ? [{ left: 48, right: '54%', top: 28, bottom: 62 },
           { left: '52%', right: 24, top: 28, bottom: 62 }]
        : [{ left: 56, right: 20, top: 28, height: 150 },
           { left: 56, right: 20, top: 232, height: 150 }];

    return {
        ...baseOption(),
        grid: grids,
        title: [
            { text: 'Density', left: wide ? '14%' : 56, top: 2,
              textStyle: { fontSize: 12, fontWeight: 600 } },
            { text: 'Exceedance probability', left: wide ? '62%' : 56,
              top: wide ? 2 : 206, textStyle: { fontSize: 12, fontWeight: 600 } },
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
            axisStyle({
                gridIndex: 1, type: 'log', logBase: 10, name: 'return period',
                min: T_MIN, max: T_MAX,
                axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                             formatter: (v) => (v >= 1000 ? `${v / 1000}k` : String(v)) },
            }),
        ],
        yAxis: [
            axisStyle({
                gridIndex: 0, type: 'value', name: 'density', scale: true,
                axisLabel: { fontSize: 10, color: '#6c757d',
                             formatter: (v) => (v ? v.toExponential(0) : '0') },
            }),
            axisStyle({
                gridIndex: 1, type: 'value', name: epLabel, scale: true,
                axisLabel: { fontSize: 10, color: '#6c757d',
                             formatter: (v) => fmt(v) },
            }),
        ],
        dataZoom: [
            { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
            { type: 'inside', xAxisIndex: 1, filterMode: 'none' },
        ],
        tooltip: {
            ...baseOption().tooltip,
            formatter: (params) => {
                const rows = (Array.isArray(params) ? params : [params])
                    .filter((p) => p.value != null && Array.isArray(p.value));
                if (!rows.length) return '';
                const first = rows[0];
                const isEp = first.axisIndex === 1 || first.seriesIndex >= density.length;
                const head = isEp
                    ? `1-in-${fmt(first.value[0])}`
                    : `loss ${fmt(first.value[0])}`;
                const body = rows.map((p) => {
                    const v = isEp ? fmt(p.value[1]) : p.value[1].toExponential(2);
                    return `${p.marker}${p.seriesName} <b>${v}</b>`;
                }).join('<br>');
                return `${head}<br>${body}`;
            },
        },
        series: [...density, ...ep],
    };
}

// ---- per-kind exhibits ------------------------------------------------
//
// Each entry is {fetch, build}. `fetch` gathers the frames (and may return null
// to mean "nothing to draw here"); `build` turns them into an ECharts option.

const EXHIBITS = {
    agg: {
        async fetch(id) {
            const [density, tail] = await Promise.all([
                api.density_df(id, { cols: 'loss,p_total,F,S' }),
                api.tail_df(id).catch(() => null),
            ]);
            return { density, tail };
        },
        build({ density, tail }, { name, wide }) {
            const loss = col(density, 'loss');
            const mass = col(density, 'p_total');
            const S = col(density, 'S');
            if (!loss || !mass || !S) return null;
            return twoPanel({
                loss, cdf: col(density, 'F'), tail, wide,
                series: [{ name: name || 'aggregate', mass, tailProb: S }],
            });
        },
    },

    port: {
        async fetch(id) {
            const [units, tail] = await Promise.all([
                api.unit_density_df(id),
                api.tail_df(id).catch(() => null),
            ]);
            return { units, tail };
        },
        build({ units, tail }, { wide }) {
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
            return twoPanel({ loss, cdf: col(units, 'F'), tail, wide, series });
        },
    },

    sev: {
        async fetch(id) {
            return { density: await api.density_df(id) };
        },
        build({ density }, { name, wide }) {
            const loss = col(density, 'loss');
            const pdf = col(density, 'pdf');
            const S = col(density, 'S');
            if (!loss || !pdf || !S) return null;
            const option = twoPanel({
                loss, cdf: col(density, 'F'), tail: null, wide,
                series: [{ name: name || 'severity', mass: pdf, tailProb: S }],
            });
            // A severity is a density ordinate, not a mass, and its support is
            // routinely unbounded. Say so on the axis rather than letting the
            // reader assume the aggregate's semantics.
            option.yAxis[0].name = 'pdf';
            option.title[0].text = 'Severity density';
            return option;
        },
    },

    pnl: {
        async fetch(id) {
            return { density: await api.density_df(id, { cols: 'loss,p_total,F,S' }) };
        },
        build({ density }, { name, wide }) {
            const loss = col(density, 'loss');
            const mass = col(density, 'p_total');
            const F = col(density, 'F');
            if (!loss || !mass || !F) return null;
            // A P&L outcome axis is signed and the bad tail is the LOW end, so
            // the return period runs off F, not S: a 1-in-200 year is the
            // outcome only 1/200 of years fall below, not above.
            const option = twoPanel({
                loss, cdf: F, tail: null, wide, epLabel: 'outcome',
                series: [{ name: name || 'P&L', mass, tailProb: F }],
            });
            option.title[1].text = 'Downside return period';
            option.series[0].markLine = {
                symbol: 'none', silent: true,
                label: { show: true, formatter: 'break even', fontSize: 10,
                         position: 'insideEndTop', color: '#6c757d' },
                lineStyle: { color: '#6c757d', type: 'dashed', width: 1 },
                data: [{ xAxis: 0 }],
            };
            return option;
        },
    },

    distortion: {
        async fetch(id) {
            return { curve: await api.density_df(id) };
        },
        build({ curve }) {
            const x = col(curve, 'x');
            const g = col(curve, 'g');
            if (!x || !g) return null;
            const color = seriesColor(0);
            return {
                ...baseOption(),
                grid: { left: 52, right: 24, top: 28, bottom: 52 },
                title: [{ text: 'Distortion g(s)', left: 52, top: 2,
                          textStyle: { fontSize: 12, fontWeight: 600 } }],
                legend: { ...baseOption().legend, data: ['g(s)', 'identity'] },
                xAxis: axisStyle({ type: 'value', name: 's', min: 0, max: 1 }),
                yAxis: axisStyle({ type: 'value', name: 'g(s)', min: 0, max: 1 }),
                series: [
                    {
                        name: 'g(s)', type: 'line', showSymbol: false,
                        data: x.map((v, i) => [v, g[i]]),
                        lineStyle: { width: lineWidth() + 0.4, color },
                        itemStyle: { color },
                        // The load is the area between g and the diagonal. Fill
                        // to the identity line so it is the visible quantity.
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
        build({ joint, stats }) {
            const grid = heatmapData(joint, axisNames(joint, stats));
            if (!grid) return null;
            const s = houseStyle();
            return {
                ...baseOption(),
                grid: { left: 64, right: 76, top: 28, bottom: 52 },
                title: [{ text: `Joint density: ${grid.xName} vs ${grid.yName}`,
                          left: 64, top: 2,
                          textStyle: { fontSize: 12, fontWeight: 600 } }],
                legend: { show: false },
                xAxis: axisStyle({
                    type: 'category', name: grid.xName, data: grid.xs,
                    splitLine: { show: false },
                    axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                                 formatter: (v) => fmt(Number(v)) },
                }),
                yAxis: axisStyle({
                    type: 'category', name: grid.yName, data: grid.ys,
                    nameGap: 44,
                    splitLine: { show: false },
                    axisLabel: { fontSize: 10, color: '#6c757d', hideOverlap: true,
                                 formatter: (v) => fmt(Number(v)) },
                }),
                visualMap: {
                    min: 0, max: grid.max, right: 8, top: 'middle', calculable: true,
                    itemHeight: 110, textStyle: { fontSize: 10, color: '#6c757d' },
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

// ---- mount ------------------------------------------------------------

/**
 * Fetch and draw the Overview exhibit for a built object.
 *
 * Parameters
 * ----------
 * host : HTMLElement
 *     Mount point, already attached so ECharts can size to it.
 * state : {id, kind, name}
 *
 * Returns
 * -------
 * Promise<object|null>
 *     A handle with `dispose()`, or null when this kind has nothing to draw or
 *     the frames it needs are unavailable.
 */
export async function mountExhibit(host, state) {
    const spec = EXHIBITS[state.kind];
    if (!spec) return null;

    let data;
    try {
        data = await spec.fetch(state.id);
    } catch {
        return null;                     // a frame this kind lacks; not an error
    }

    const wideNow = () => (host.clientWidth || 0) >= WIDE_PX;
    let wide = wideNow();
    const option = spec.build(data, { ...state, wide });
    if (!option) return null;

    host.style.height = `${chartHeight(wide, option)}px`;
    const chart = echarts.init(host, null, { renderer: 'canvas' });
    chart.setOption(option);
    linkPanels(chart, option);

    // Re-lay out on resize, and rebuild across the stacked/side-by-side
    // breakpoint since that changes the grid count's geometry, not just its size.
    const ro = new ResizeObserver(() => {
        const nowWide = wideNow();
        if (nowWide !== wide) {
            wide = nowWide;
            const next = spec.build(data, { ...state, wide });
            if (next) {
                host.style.height = `${chartHeight(wide, next)}px`;
                chart.setOption(next, true);
                linkPanels(chart, next);
            }
        }
        chart.resize();
    });
    ro.observe(host);

    return {
        dispose() {
            try { ro.disconnect(); } catch { /* already gone */ }
            try { chart.dispose(); } catch { /* already gone */ }
        },
    };
}

/** Exhibit height: side-by-side is one band, stacked needs two. */
function chartHeight(wide, option) {
    const panels = Array.isArray(option.grid) ? option.grid.length : 1;
    if (panels < 2) return 300;
    return wide ? 320 : 420;
}

/**
 * Link the cursor across the two panels.
 *
 * Both panels are built from the same row array, so a dataIndex identifies the
 * same grid bucket in either. Hovering the density therefore highlights the
 * matching point on the EP curve and vice versa: not an approximation, the same
 * bucket read two ways. A single-panel exhibit is left alone.
 */
function linkPanels(chart, option) {
    const total = (option.series || []).length;
    if (total < 2 || !Array.isArray(option.grid) || option.grid.length < 2) return;
    // twoPanel emits every density series then every EP series, so the two
    // halves are the same series in the same order and the offset is constant.
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
