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

import { LOG_FLOOR } from './theme.js';

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
export function chartdocToEcharts(doc, { logZ = false, overrides = null } = {}) {
    const panel = (doc && doc.panels && doc.panels[0]) || null;
    if (!panel || panel.kind !== 'surface') return null;
    const axes = Object.fromEntries((doc.axes || []).map((a) => [a.id, a]));
    const series = (doc.series || []).find((s) => s.surface);
    if (!series) return null;
    const { x, y, z } = series.surface;

    const useLog = Boolean(logZ) && Boolean((doc.meta || {}).z_log_ok);
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
