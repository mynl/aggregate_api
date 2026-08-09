// ChartDoc (the aggregate library's chart IR) to an ECharts option.
//
// One generic walker plus a small per-chart override dict. The document
// carries every semantic decision, made upstream in the library emitter:
// which series, on which axes, at which scales, and any display reduction
// (already applied, so a z grid arrives display sized and mass preserving).
// This module carries none of that. It translates vocabulary, merges the
// chart's renderer-specific chrome, and stops: a need the document cannot
// express is a schema change upstream, never a client-side patch.
//
// Panel kinds realized today: 'surface' (the pilot, dev/plan-chart-ir.md in
// the library repo). The two-panel xy family joins as its conversions land.

import {
    LOG_FLOOR, axisStyle, baseOption, fade, lineWidth, seriesColor,
} from './theme.js';

/**
 * Merge an override dict over a base option, one nested level deep.
 *
 * Per top-level key: plain objects merge shallowly (override keys win);
 * arrays merge element-wise the same way, so `series: [{shading}]` chrome
 * decorates the base's mesh entry instead of replacing it; anything else
 * replaces. Enough for chrome dicts (visualMap, grid3D, tooltip) to dress a
 * semantic skeleton without clobbering its data.
 */
function merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        const b = out[k];
        if (Array.isArray(b) && Array.isArray(v)) {
            const merged = b.map((item, i) => (
                item && v[i] && typeof item === 'object' && typeof v[i] === 'object'
                    ? { ...item, ...v[i] } : (v[i] === undefined ? item : v[i])));
            for (let i = b.length; i < v.length; i++) merged.push(v[i]);
            out[k] = merged;
        } else if (b && v && typeof b === 'object' && typeof v === 'object'
                   && !Array.isArray(b) && !Array.isArray(v)) {
            out[k] = { ...b, ...v };
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * The z range actually present in a grid, ignoring float dust.
 *
 * `min` is the smallest value above `LOG_FLOOR` (the log floor wants one
 * decade under the smallest mass actually present, not under arithmetic
 * noise); `max` is the plain maximum.
 */
function zRange(z) {
    let max = 0;
    let min = Infinity;
    for (const row of z) {
        for (const v of row) {
            if (v > max) max = v;
            if (v > LOG_FLOOR && v < min) min = v;
        }
    }
    return { max, min: Number.isFinite(min) ? min : LOG_FLOOR };
}

/**
 * Assemble the ECharts option for a chart document.
 *
 * Pure, so the node smoke test can exercise it without a DOM or WebGL.
 *
 * Parameters
 * ----------
 * doc : object
 *     A ChartDoc canonical dict (`GET /v1/objects/{id}/chart/{name}`).
 * opts : object
 *     `logZ` — log height/color on the z grid; honored only when the
 *     document declares `meta.z_log_ok`, because whether a log reading is
 *     meaningful is the emitter's call, not view state's.
 *     `overrides` — the per-chart chrome: a dict, or a function of the
 *     adapter's context `{xName, yName, zName, logZ, zMin, zMax}` returning
 *     one, merged over the semantic skeleton one nested level deep.
 *
 * Returns
 * -------
 * object or null
 *     The ECharts option, or null when the document carries no realizable
 *     panel.
 */
export function chartdocToEcharts(doc, opts = {}) {
    const panels = (doc && doc.panels) || [];
    if (!panels.length) return null;
    // The bifurcation, split by RENDERER CAPABILITY rather than by panel kind.
    // A heatmap is a 2-D drawing of the same grid a surface draws in relief, so
    // a kind-based split would file it with the surface and it belongs here.
    // One entry point, two paths, and no shared realization code below the
    // split: only the panel walk, `merge`, and the axis helpers both sides read.
    if (panels.some((p) => p.kind === 'surface')) return surfaceOption(doc, opts);
    return xyOption(doc, opts);
}

/**
 * Expand a coordinate that may be a lattice into a plain array.
 *
 * IR version 2 lets a series carry a coordinate as `(start, step, count)`
 * rather than spelling every value out, which is most of the payload for a
 * curve over an even grid. A reader that ignores the field sees a series with
 * no coordinates at all and draws nothing, which is why the version moved.
 *
 * `chart_agg` and `chart_reins` both use it, so this is not an optimization to
 * get to later: it is the difference between those charts drawing and drawing
 * empty.
 */
function coords(series, key) {
    const plain = series[key];
    if (Array.isArray(plain)) return plain;
    const lat = series[`${key}_lattice`];
    if (!lat) return null;
    const [start, step, count] = lat;
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = start + i * step;
    return out;
}

/**
 * One ECharts axis option from a `ChartAxis`.
 *
 * Reads `scale` through a default, never directly: the canonical form omits a
 * field sitting at its default, so an axis drawn on linear carries no `scale`
 * key at all and `axis.scale` is undefined rather than `'linear'`.
 *
 * `suggested_range` is honored as the initial window, which is what the
 * document says it is: the emitter's own crop, computed from the data. The
 * alternative reading, the full extent, arrives as `full_range` and is a
 * control rather than a default, so it is not read here.
 */
function axisOption(axis, gridIndex) {
    const a = axis || {};
    const scale = a.scale || 'linear';
    const opt = {
        type: scale === 'log' ? 'log' : 'value',
        name: a.label || '',
        gridIndex,
        ...axisStyle(),
    };
    const range = a.suggested_range;
    if (Array.isArray(range) && range.length === 2) {
        [opt.min, opt.max] = range;
    }
    return opt;
}

/**
 * The 2-D path: `xy` panels, one grid each.
 *
 * Realized today: multi-panel layout, axes with their declared scale and
 * window, line series from explicit or lattice coordinates, and the `y2` band.
 * Not yet: marks, the atomic support ladder, and the per-axis reading toggles.
 * A document asking for one of those still draws, without it, rather than
 * failing; each is its own item in `dev/plan-plot-ir-api.md`.
 */
function xyOption(doc, { overrides = null } = {}) {
    const panels = doc.panels || [];
    const axes = Object.fromEntries((doc.axes || []).map((a) => [a.id, a]));
    const byPanel = new Map(panels.map((p, i) => [p.id, i]));

    const grid = [];
    const xAxis = [];
    const yAxis = [];
    panels.forEach((panel, i) => {
        grid.push({ containLabel: true });
        xAxis.push(axisOption(axes[panel.x_axis], i));
        yAxis.push(axisOption(axes[panel.y_axis], i));
    });

    const series = [];
    for (const s of doc.series || []) {
        const i = byPanel.get(s.panel_id);
        if (i === undefined) continue;
        const x = coords(s, 'x');
        const y = coords(s, 'y');
        if (!x || !y) continue;
        const color = seriesColor(series.length);
        const base = {
            type: 'line',
            name: s.name,
            xAxisIndex: i,
            yAxisIndex: i,
            symbol: 'none',
            lineStyle: { width: lineWidth(), color },
            itemStyle: { color },
            data: x.map((xv, k) => [xv, y[k]]),
        };
        const y2 = coords(s, 'y2');
        if (!y2) {
            series.push(base);
            continue;
        }
        // A band, drawn as the lower bound plus the gap above it, stacked. The
        // two share one x array by construction, so stacking by data index is
        // exact rather than approximate. Both bounding lines stay visible: the
        // fill says "somewhere in here" and the edges say where the limits are.
        // Keyed by PANEL as well as by name. The envelope draws a band called
        // "Envelope" on both of its panels, and a stack name is global across
        // the series list, so keying on the name alone would invite ECharts to
        // combine two bands that live on different grids.
        const stack = `band-${i}-${s.name}`;
        series.push(
            { ...base, stack, areaStyle: { opacity: 0 } },
            {
                ...base,
                name: `${s.name} (upper)`,
                stack,
                data: x.map((xv, k) => [xv, y2[k] - y[k]]),
                areaStyle: { color: fade(color, 0.18) },
                lineStyle: { width: 0 },
                // The stacked half carries a delta, not a value, so it must not
                // answer a hover: the number would be the gap and read as the
                // bound. The lower series and the visible edges do the talking.
                tooltip: { show: false },
                silent: true,
            },
        );
    }

    const equalAspect = panels.some((p) => p.aspect === 'equal');
    const base = merge(baseOption(), {
        grid, xAxis, yAxis, series,
        // An equal-aspect panel is a statement about the drawing (a unit square
        // is square), so the renderer owns it; the document only declares it.
        ...(equalAspect ? { aspect: 'equal' } : {}),
    });
    const ctx = { panels, axes, equalAspect };
    const over = typeof overrides === 'function' ? overrides(ctx) : overrides;
    return merge(base, over);
}

/** The 3-D path: one `surface` panel, the bivariate joint. */
function surfaceOption(doc, { logZ = false, overrides = null } = {}) {
    const panel = (doc && doc.panels && doc.panels[0]) || null;
    if (!panel || panel.kind !== 'surface') return null;
    const axes = Object.fromEntries((doc.axes || []).map((a) => [a.id, a]));
    const series = (doc.series || []).find((s) => s.surface);
    if (!series) return null;
    const { x, y, z } = series.surface;

    // Whether a log height is meaningful is the Z AXIS's declaration, as the
    // scales it admits. It was `meta.z_log_ok` in the surface pilot, and the
    // library generalized that into `ChartAxis.scales` for every axis; the flag
    // is gone, so reading it here silently pinned the surface to linear however
    // the toggle was set. A singleton `scales` means the axis has one honest
    // reading and the control does not apply.
    const zScales = (axes[panel.z_axis] || {}).scales || [];
    const useLog = Boolean(logZ) && zScales.includes('log');
    const { max, min } = zRange(z);
    const zMin = useLog ? Math.floor(Math.log10(min)) : 0;
    const zMax = useLog ? Math.ceil(Math.log10(max)) : max;

    // Flat vertex list + dataShape, never the parametric form: the two axes
    // have their own grids (independently built components routinely land on
    // different bucket sizes), so there is no single step describing both.
    // `z[r][c]` sits at `(x[c], y[r])` per the SurfaceData contract.
    //
    // On the log view a zero cell rests exactly on the floor, one decade
    // under the smallest mass present, never a hole: an FFT-built joint is
    // full of exact zeros and as holes the mesh arrives moth-eaten.
    const data = [];
    for (let c = 0; c < x.length; c++) {
        for (let r = 0; r < y.length; r++) {
            const v = z[r][c];
            const height = useLog
                ? (v > LOG_FLOOR ? Math.max(zMin, Math.log10(v)) : zMin)
                : v;
            data.push([x[c], y[r], height]);
        }
    }

    const xName = (axes[panel.x_axis] || {}).label || 'x';
    const yName = (axes[panel.y_axis] || {}).label || 'y';
    const zLabel = (axes[panel.z_axis] || {}).label || 'z';
    const zName = useLog ? `log ${zLabel}` : zLabel;

    const base = {
        xAxis3D: { type: 'value', name: xName },
        yAxis3D: { type: 'value', name: yName },
        zAxis3D: { type: 'value', name: zName, min: zMin, max: zMax },
        // min/max/dimension are semantic (color encodes the same variable as
        // the height); the ramp and placement arrive with the override.
        visualMap: { min: zMin, max: zMax, dimension: 2, seriesIndex: 0 },
        series: [{
            type: 'surface',
            name: series.name,
            dataShape: [x.length, y.length],
            data,
        }],
    };
    const ctx = { xName, yName, zName, logZ: useLog, zMin, zMax };
    const over = typeof overrides === 'function' ? overrides(ctx) : overrides;
    return merge(base, over);
}
