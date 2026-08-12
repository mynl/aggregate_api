// ChartDoc (the aggregate library's chart IR) to an ECharts option.
//
// One generic walker plus a small per-chart override dict. The document
// carries every semantic decision, made upstream in the library emitter:
// which series, on which axes, at which scales, which readings the reader may
// choose, and any display reduction (already applied, so a z grid arrives
// display sized and mass preserving). This module carries none of that. It
// translates vocabulary, decides realization, merges renderer chrome, and
// stops: a need the document cannot express is a schema change upstream,
// never a client-side patch.
//
// The reference implementation is the library's own matplotlib renderer,
// `aggregate/plots/_chartdoc.py`. Where a decision is *semantic* the two must
// agree, so the ladder, the windows, the paired readings and the equal-aspect
// rule are all ports of what it does, and its docstrings are the authority.
// Where a decision is *realization* the two differ freely: this one zooms, so
// it has no pixel rung, and it draws a joint density flat rather than as a
// projection.

import { fmt } from '../utils/format.js';
import {
    coordX, coordY, decodeSurfaceGrid, densityAt, findSurfaceSeries, xCoords,
    yCoords, zExtent,
} from './surface-grid.js';
import {
    columnAt, contourPaths, diagonalSegment, interpAt, levelLine, rowAt,
    wallScale, weightedMean,
} from './surface-geometry.js';
import {
    LOG_FLOOR, VIRIDIS, axisStyle, baseOption, fade, houseStyle, lineWidth,
    seriesColor,
} from './theme.js';

/**
 * The IR version this adapter was written against.
 *
 * Read rather than assumed. The library's rule is that the version moves only
 * when a reader ignoring what it does not know would draw something *wrong*,
 * so a document from a later version is refused by name instead of drawn
 * plausibly and incorrectly. Version 2 is the lattice payload: an older reader
 * sees a series with no coordinates and draws an empty panel.
 */
export const CHART_IR_VERSION = 2;

// ---- the drawing ladder ------------------------------------------------
//
// Ported from `_chartdoc._draw_atomic`, minus its pixel rung. What the x
// values *are* is a fact about the law and arrives as `ChartSeries.support`;
// how much room each atom gets is a fact about the drawing and is counted
// here, in atoms **in view**, so a zoom re-evaluates it.
//
// The library's third rung drops to a plain line under three pixels per atom.
// That is right for a static figure, where sub-pixel steps and a line are the
// same pixels, and wrong here for two reasons: this chart zooms, so pixels per
// atom is a property of a gesture that has not happened yet, and `sampling:
// 'minmax'` already reduces a path to two points per pixel column before it is
// built, so steps and a line cost the same order either way.
const LOLLIPOP_ATOMS = 40;

// `sampling: 'minmax'` keeps the extremes of each pixel column, so a spike one
// bucket wide survives the reduction. Only for a gap-free series: the sampler
// has no null handling and closes the gaps it is meant to preserve.
const SAMPLING = 'minmax';

// Largest return period drawn when the document declares no window for its
// paired reading. `_chartdoc.MAX_RETURN_PERIOD`, and the same reasoning: the
// quantile function saturates at the end of its grid, where T diverges.
const MAX_RETURN_PERIOD = 1e9;

// Where on the house ramp a value-carrying family starts. The ramp runs from
// white and a white curve is not drawn at all, so the family uses the visible
// part of it. `_chartdoc.VALUE_RAMP_FLOOR`.
const VALUE_RAMP_FLOOR = 0.3;

// ---- panel geometry, in CSS pixels -------------------------------------
//
// Panel arrangement is the renderer's job: the document hands over panels in a
// sensible order and says nothing about rows and columns. Every number here is
// chrome around a plot area whose own size comes from the host width and the
// house aspect, never hardcoded.

// y-axis name + tick labels. 58 through a66, which fitted a `nameGap` of 26 and
// the labels ECharts happened to choose. On the round lattice of a67 a density
// axis prints `2.5e-4` where it used to print `2e-4`, and the wider label ran
// under the rotated axis name. The name moves out to 46 (what the heatmap panel
// already used) and this makes room for it.
const AXIS_LEFT = 64;
const AXIS_BOTTOM = 46;    // x-axis name + tick labels
const PAD_RIGHT = 18;
const PAD_TOP = 26;        // the panel title strip
// Between side-by-side panels: the right one's axis furniture lives here, so it
// tracks `nameGap`. 76 through a66 for a gap of 26; +20 with the name, so the
// right panel's rotated label keeps the same clearance from the left panel's
// plot area as it always had.
const GAP_X = 96;
const GAP_Y = 30;          // between stacked panels, on top of AXIS_BOTTOM
const LEGEND_H = 24;

// Clamps on the computed plot-area height. The aspect rules between them.
const PANEL_MIN_H = 130;
const PANEL_MAX_H = 380;

// The target panel shape, width to total vertical footprint: the plot area
// plus the title strip above it and the axis below. 4:3.25 is the author's
// number; the house figure ratio is 4:2.8 if a closer match to matplotlib is
// ever wanted.
export const PANEL_ASPECT = 4 / 3.25;

// Side-by-side needs room for two readable axes; below this panels stack.
export const WIDE_PX = 720;

// Bounds on the square plot area an equal-aspect panel is drawn at.
const SQUARE_MIN = 240;
const SQUARE_MAX = 420;

// Extra right margin on a grid panel, for its colorbar.
const COLORBAR_W = 78;

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
 * Expand a coordinate that may be a lattice into a plain array.
 *
 * IR version 2 lets a series carry a coordinate as `(start, step, count)`
 * rather than spelling every value out, which is most of the payload for a
 * curve over an even grid. `start + step * i` is the arithmetic the grid was
 * built with, so the values round-trip exactly.
 *
 * A reader that ignores the field sees a series with no coordinates at all and
 * draws nothing, which is why the version moved; both charts on the app's
 * critical path use it.
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
 * Return periods from the probabilities on a paired axis.
 *
 * `T = 1 / v` under the 'reciprocal' map, `T = 1 / (1 - v)` under
 * 'complement'. The quantile function saturates at its far end, where T
 * diverges, so a non-finite or non-positive result becomes a gap: the curve
 * stops where the grid stops knowing rather than running out to an invented
 * bound. `_chartdoc._return_periods`.
 */
function returnPeriods(values, how) {
    return values.map((v) => {
        if (v == null) return null;
        const t = how === 'complement' ? 1 / (1 - v) : 1 / v;
        return (Number.isFinite(t) && t > 0) ? t : null;
    });
}

/**
 * The decade at or under the smallest value worth drawing, or null.
 *
 * A log view of a window whose declared low end is zero needs a bottom, and
 * the honest one is a round decade under the smallest thing actually drawn:
 * gridlines land on powers of ten, which is how a log axis is read, and
 * nothing real is cropped. Values at or under `LOG_FLOOR` are arithmetic noise
 * rather than a tail. `_chartdoc._decade_floor`.
 */
function decadeFloor(series) {
    let min = Infinity;
    for (const values of series) {
        for (const v of values) {
            if (v != null && Number.isFinite(v) && v > LOG_FLOOR && v < min) min = v;
        }
    }
    return Number.isFinite(min) ? 10 ** Math.floor(Math.log10(min)) : null;
}

/** The finite extent of a set of coordinate arrays, or null. */
function extentOf(series) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const values of series) {
        for (const v of values) {
            if (v == null || !Number.isFinite(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** The scale this axis is drawn on: its default, or its log reading. */
function axisScale(axis, log) {
    const scales = axis.scales || [axis.scale || 'linear'];
    return (log && scales.includes('log')) ? 'log' : (axis.scale || 'linear');
}

/**
 * The window this axis is drawn in: its suggestion, or its full extent.
 *
 * An axis offers the zoom-out only by carrying `full_range`; where it does
 * not, the switch finds nothing to act on and the suggestion stands, because
 * a chart whose window is its meaning has no other reading.
 */
function axisWindow(axis, full) {
    if (full && Array.isArray(axis.full_range)) return axis.full_range;
    return Array.isArray(axis.suggested_range) ? axis.suggested_range : null;
}

/** The paired return-period axis for `axisId`, if the document has one. */
function pairedReading(doc, axisId) {
    return (doc.axes || []).find((a) => a.reciprocal_of === axisId) || null;
}

/**
 * One window for both axes of an equal-aspect panel.
 *
 * Equal aspect with two different ranges is a square box drawn over a
 * rectangle of data, and it misreads: on a panel whose axes measure the same
 * thing, a 45 degree line has to *be* at 45 degrees. The top is the higher of
 * the two so nothing declared is cropped; the bottom is where the data
 * actually starts, because a loss window anchored at zero opens with an empty
 * corner otherwise. `_chartdoc._square_window`.
 */
function squareWindow(xWindow, yWindow, allX, allY) {
    const windows = [xWindow, yWindow].filter(Boolean);
    if (!windows.length) return null;
    const seen = extentOf([...allX, ...allY]);
    let lo = Math.min(...windows.map((w) => w[0]));
    if (seen) lo = Math.max(lo, seen[0]);
    const hi = Math.max(...windows.map((w) => w[1]));
    return hi > lo ? [lo, hi] : windows[0];
}

/**
 * What readings a document offers, which is what the control strip surfaces.
 *
 * A control appears if **any** axis or panel declares the reading, and acts on
 * **every** one that does. That is the library renderer's rule too
 * (`plot_chartdoc`'s four switches), so one instrument reads the same way in
 * both renderers rather than the app inventing a per-axis patchwork.
 *
 * Parameters
 * ----------
 * doc : object
 *     A ChartDoc canonical dict.
 *
 * Returns
 * -------
 * object
 *     `{log, fullRange, returnPeriod, invert, kinds}`. The first four are
 *     booleans saying whether to offer the switch; `kinds` is the set of panel
 *     realizations the document declares beyond one, empty when there is no
 *     choice to make.
 */
export function readings(doc) {
    const axes = (doc && doc.axes) || [];
    const panels = (doc && doc.panels) || [];
    const drawn = new Set(panels.flatMap((p) => [p.x_axis, p.y_axis, p.z_axis]));
    const kinds = new Set();
    for (const p of panels) {
        for (const k of p.kinds || [p.kind]) kinds.add(k);
        // A surface can also be read flat, because those are two drawings of
        // one grid and this renderer has both. That is renderer capability
        // rather than a claim about the document, which is why it is added
        // here and not read off the panel: `realization` already honors a
        // request for either, and without this the control strip offers no way
        // to make one. Not the converse: a panel declared 'heatmap' gets no
        // 3-D button, because `realization` would decline the request and a
        // control that does nothing is worse than no control.
        if (p.kind === 'surface') kinds.add('heatmap');
    }
    return {
        log: axes.some((a) => drawn.has(a.id) && (a.scales || []).length > 1),
        fullRange: axes.some((a) => drawn.has(a.id) && Array.isArray(a.full_range)),
        // A paired axis is named by no panel by construction, so the pairing is
        // read off the axis rather than off what is drawn.
        returnPeriod: axes.some((a) => a.reciprocal_of),
        invert: panels.some((p) => p.invertible),
        // Not a *reading* in the sense the other four are: the document does not
        // declare that its marks can be turned off, they are simply data it
        // publishes. It rides here anyway because this is what the control strip
        // is built from, and the honest gate is the same shape as the others,
        // offer the button when there is something for it to act on. The strip
        // lost this control entirely in the a62 rewrite, which is the whole of
        // punch item G3's "we've lost the annotations option".
        marks: ((doc && doc.marks) || []).length > 0,
        kinds: kinds.size > 1 ? [...kinds] : [],
    };
}

/**
 * Which realization each panel takes.
 *
 * An explicit request wins where the panel declares it and is ignored where it
 * does not, because silently drawing something else is the failure the
 * capability declaration exists to prevent. `_chartdoc._realization`.
 *
 * A grid panel used to fall to 'heatmap' with nothing requested, which was the
 * author's interim ruling of 2026-08-09 while the 3-D design was unsettled.
 * **Lifted 2026-08-12**, now that `dev/plan-3d-plot.md` is in flight: a panel
 * the document declares as a surface draws as a surface. The flat reading
 * stays reachable, because a heatmap is the same grid drawn the other way and
 * the renderer can do both, and it is still what a machine without WebGL gets,
 * by the fallback in `mount.js:build`.
 */
function realization(panel, requested) {
    const kinds = panel.kinds || [panel.kind];
    if (requested && kinds.includes(requested)) return requested;
    if (requested === 'heatmap' && panel.kind === 'surface') return 'heatmap';
    return panel.kind;
}

/**
 * Grid boxes for `count` panels at `width`, plus the host height they need.
 *
 * Panels sit side by side when the host is wide enough for two readable axes
 * and stack when it is not, which generalizes the app's existing breakpoint
 * from "two panels or one" to any count: at most two per row when wide, one
 * per row when narrow. Square panels are sized to their own bound rather than
 * to the house aspect, because equal aspect is a statement about the drawing.
 *
 * Exported because the mount reserves the host height from it, and because the
 * node smoke test asserts the shape without a DOM.
 *
 * Parameters
 * ----------
 * count : number
 *     Panels to place. Zero is treated as one, so a caller reserving space
 *     before it has a document still gets a sane box.
 * square : bool
 *     Every panel is equal aspect, so each is drawn as a square.
 * width : number
 *     Host width in CSS pixels. Zero (not yet laid out) falls back to a
 *     default rather than collapsing the panel.
 * rightPad : number
 *     Extra right margin, for a grid panel's colorbar.
 *
 * Returns
 * -------
 * {grids, wide, panelW, panelH, footprint, hostHeight}
 */
export function panelLayout(count, square, width, rightPad = 0) {
    const n = Math.max(1, count || 1);
    const w = width || 900;
    const wide = w >= WIDE_PX;
    const perRow = wide ? Math.min(2, n) : 1;
    const rows = Math.ceil(n / perRow);
    const pad = PAD_RIGHT + rightPad;
    const panelW = Math.max(wide ? 160 : 200,
        (w - AXIS_LEFT - (perRow - 1) * GAP_X - pad) / perRow);
    // Vertical chrome belonging to one panel, inside its footprint.
    const chrome = PAD_TOP + AXIS_BOTTOM;
    const panelH = square
        ? Math.max(SQUARE_MIN, Math.min(SQUARE_MAX, panelW))
        : Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, panelW / PANEL_ASPECT - chrome));
    // A square is as wide as it is tall, so a clamped height narrows the box.
    const boxW = square ? panelH : panelW;

    const grids = [];
    for (let i = 0; i < n; i++) {
        const r = Math.floor(i / perRow);
        const c = i % perRow;
        grids.push({
            left: AXIS_LEFT + c * (boxW + GAP_X),
            top: PAD_TOP + r * (panelH + AXIS_BOTTOM + GAP_Y),
            width: boxW,
            height: panelH,
        });
    }
    const bottom = Math.max(...grids.map((g) => g.top + g.height));
    return {
        grids,
        wide,
        panelW: boxW,
        panelH,
        footprint: chrome + panelH,
        hostHeight: Math.round(bottom + AXIS_BOTTOM + LEGEND_H),
    };
}

/**
 * The layout a document will be drawn at.
 *
 * A thin read of the document over `panelLayout`: panel count, whether every
 * panel is equal aspect, and whether any is a grid panel needing a colorbar.
 */
export function documentLayout(doc, width) {
    const panels = (doc && doc.panels) || [];
    const square = panels.length > 0 && panels.every((p) => p.aspect === 'equal');
    const grid = panels.some((p) => p.kind !== 'xy');
    return panelLayout(panels.length, square, width, grid ? COLORBAR_W : 0);
}

// ---- the 2-D path ------------------------------------------------------

/** How many of `x` fall inside `window`. The count the ladder turns on. */
function atomsInView(x, window) {
    if (!window) return x.length;
    let seen = 0;
    for (const v of x) { if (v != null && v >= window[0] && v <= window[1]) seen++; }
    return seen;
}

/**
 * Which drawing an atomic series takes, from the **axes** rather than the role.
 *
 * A reinsurance series is called gross or ceded in every panel it appears in,
 * and only the axes know that one panel carries mass, another accumulated
 * probability, and a third that same probability read back to an outcome. So
 * the ladder reads units. `_chartdoc._draw_atomic`, and the three cases are
 * its three:
 *
 *   probability on y   a cumulative, right-continuous: it takes a value at
 *                      every x, not only at the atoms, so it skips the stem
 *                      rung however few atoms there are
 *   probability on x   that same cumulative read the other way round, so the
 *                      sideways step is left-continuous: it rises *before* its
 *                      atom where F steps after it
 *   density on y       a mass, which lives *at* its atom: stems while there is
 *                      room to see them, steps centered on the grid point once
 *                      there is not
 *
 * @returns {'stem'|'step-mid'|'step-pre'|'step-post'|'line'}
 */
function drawingFor(support, xAxis, yAxis, seen) {
    if (support === 'continuous') return 'line';
    if (yAxis.unit === 'probability') return 'step-post';
    if (xAxis.unit === 'probability' || xAxis.unit === 'return_period') return 'step-pre';
    if (yAxis.unit === 'density' && seen <= LOLLIPOP_ATOMS) return 'stem';
    return 'step-mid';
}

const STEP_KEY = { 'step-pre': 'start', 'step-mid': 'middle', 'step-post': 'end' };

/** True when no entry is a gap, so `sampling` may reduce the path. */
function gapFree(values) {
    for (const v of values) if (v == null) return false;
    return true;
}

/** The house sequential ramp at `t` in [0, 1]: white to the primary color. */
function rampColor(t) {
    const hex = String(houseStyle().colors[0]).replace('#', '');
    if (hex.length !== 6) return houseStyle().colors[0];
    const n = parseInt(hex, 16);
    const mix = (c) => Math.round(255 + (c - 255) * Math.max(0, Math.min(1, t)));
    return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/**
 * Which cells of a category axis carry a label, and what it says.
 *
 * A heatmap needs category axes, so `realizeGrid` hands ECharts the whole array
 * of cell centers as `data`. Left to itself a category axis then labels **as
 * many cells as fit without colliding**, which is a legibility rule and not a
 * reading rule, and it produced this, measured on one joint density:
 *
 * | axis | labels | length |
 * |---|--:|--:|
 * | x | 13 | 610 px |
 * | y | 26 | 370 px |
 *
 * Four times the density on the shorter axis of the same picture, and neither
 * lattice round, because the labels land on cell centers: 300, 1,900, 3,500
 * against 60, 860, 1,660. The author's report, 2026-08-10, and the same
 * complaint as the value axes above wearing different clothes.
 *
 * So the labeled cells are chosen rather than left to fit: a round step off the
 * same 1 / 2 / 5 ladder, then the cell nearest each multiple of it. Both axes
 * ask for the same count, so both get one whatever their length.
 *
 * **The label names the multiple, not the cell.** They differ by at most half a
 * cell, and a heatmap axis is a binned axis, where naming the round value the
 * bin sits under is what every binned axis does. Printing the cell center
 * instead would put the count right and leave 1,987 on the axis, which is the
 * half of the complaint that is about roundness.
 *
 * @param {Array<number|string>} values cell centers, ascending and evenly
 *   spaced (they are a grid).
 * @param {number} target roughly how many labels to place.
 * @returns {object} `axisLabel` fragment: an `interval` predicate and a
 *   `formatter`, or an empty object when the axis is too short to thin.
 */
function categoryTicks(values, target = 7) {
    const n = values.length;
    if (n <= target) return {};
    const lo = Number(values[0]);
    const hi = Number(values[n - 1]);
    const step = niceStep((hi - lo) / target);
    if (!step || !Number.isFinite(lo) || !Number.isFinite(hi)) return {};
    // Cells are evenly spaced, so the index of the cell nearest a value is
    // arithmetic rather than a search: one pass over the multiples, not one
    // pass over the grid per multiple.
    const at = new Map();
    for (let t = Math.ceil(lo / step) * step; t <= hi + step / 2; t += step) {
        const idx = Math.round(((t - lo) / (hi - lo)) * (n - 1));
        if (idx >= 0 && idx < n) at.set(idx, t);
    }
    return {
        interval: (index) => at.has(index),
        formatter: (_v, index) => fmt(at.get(index)),
    };
}

/**
 * The 1 / 2 / 5 step at or just above `raw`, the standard nice-number ladder.
 *
 * @param {number} raw the step a naive division asks for.
 * @returns {number} the round step to use instead.
 */
function niceStep(raw) {
    if (!(raw > 0) || !Number.isFinite(raw)) return null;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    if (norm <= 1) return mag;
    if (norm <= 2) return 2 * mag;
    if (norm <= 5) return 5 * mag;
    return 10 * mag;
}

/**
 * A window widened to round numbers, with the step that divides it.
 *
 * @returns {{min: number, max: number, interval: number}|null} null when the
 *   window is degenerate or already spans nothing.
 */
function niceWindow(min, max, target = 5) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null;
    const interval = niceStep((max - min) / target);
    if (!interval) return null;
    return {
        min: Math.floor(min / interval) * interval,
        max: Math.ceil(max / interval) * interval,
        interval,
    };
}

/**
 * One ECharts axis option from a `ChartAxis`.
 *
 * Reads `scale` through a default, never directly: the canonical form omits a
 * field sitting at its default, so an axis drawn on linear carries no `scale`
 * key at all.
 *
 * **The ticks sit on a round lattice, and that is why the end labels are back.**
 * a62 answered "the odd tick on the left scale" by hiding the two end labels
 * with `showMinLabel` / `showMaxLabel`, on the reading that a window's endpoints
 * are exact rather than round and so print with more decimals than their
 * neighbors. Both halves of that were wrong. It hid the ends of an axis whose
 * ends *are* round, so a distortion drawn on [0, 1] lost its 0 and its 1. And it
 * left the interior labels alone, which are equally unround: pinning both `min`
 * and `max` to raw window values defeats ECharts' own nice-number algorithm,
 * because the interval then has to divide an exact span and comes out as
 * 3,463.93.
 *
 * The author's rule, 2026-08-10: "are the max and min in the grid of the other
 * ticks? 0, .25, .5, .75, 1 is good. 0.03132, .25, .5, .75, 1 is not." Rounding
 * the window outward and setting the interval satisfies it by construction, so
 * every label including the ends is on the lattice and none of them has to be
 * hidden. The plotted range grows to the next round number, which is what
 * matplotlib does and what makes its axes readable.
 *
 * **A log axis gets the same treatment on its own lattice, which is decades.**
 * "ECharts handles it" was the first cut of this and it is not true: given an
 * exact min and max it labels the ends exactly, so a log loss axis ran
 * `1e-1, 1e+0, 1e+1, 1e+2, 1e+3, 8.8e+3`, five decades and then whatever the
 * data happened to reach. Snapping both ends to whole powers of ten puts every
 * label on the lattice for the same reason the linear case does.
 *
 * **Clamped to `full_range` before it is rounded, and the order matters.** A
 * suggested window carries the library's own padding around the data, so an
 * outcome axis whose data starts at zero arrives as `[-173.18, 8832.18]`.
 * Rounding that outward turns 173 units of padding into a 2,000 unit margin of
 * empty axis below zero, labeled `-2,000`, on a quantity that cannot be
 * negative. Clamping to the axis's own full extent first drops the padding that
 * reaches outside what the quantity can be, and rounding the clamped range then
 * lands on zero. Rounding first and clamping after would leave the min off the
 * lattice again, which is the whole thing this is for.
 */
function axisOption(axis, gridIndex, { scale, window, floor, formatter, nameGap }) {
    const isLog = scale === 'log';
    let [min, max] = window || [];
    if (isLog && min != null && min <= 0) min = floor == null ? undefined : floor;
    const extent = Array.isArray(axis.full_range) ? axis.full_range : null;
    if (extent && min != null && max != null) {
        // A log axis takes the upper clamp only: `full_range` routinely starts
        // at zero, which has no position on a log scale, and the floor above
        // has already settled the bottom end.
        if (!isLog) min = Math.max(min, extent[0]);
        max = Math.min(max, extent[1]);
    }
    let nice = null;
    if (min != null && max != null) {
        if (isLog) {
            if (min > 0 && max > min) {
                min = 10 ** Math.floor(Math.log10(min));
                max = 10 ** Math.ceil(Math.log10(max));
            }
        } else {
            nice = niceWindow(min, max);
            if (nice) ({ min, max } = nice);
        }
    }
    return axisStyle({
        type: isLog ? 'log' : 'value',
        ...(isLog ? { logBase: 10 } : {}),
        name: axis.label || '',
        gridIndex,
        ...(nameGap == null ? {} : { nameGap }),
        ...(min == null ? {} : { min }),
        ...(max == null ? {} : { max }),
        ...(nice ? { interval: nice.interval } : {}),
        axisLabel: {
            fontSize: 10,
            color: '#6c757d',
            hideOverlap: true,
            formatter,
        },
    });
}

/**
 * An exponential with a mantissa digit only where one is needed.
 *
 * `1e-4` and `1.5e-4`, never `1.0e-4`, and never `1e-4` twice for two different
 * ticks. One significant figure was enough while the ticks fell wherever
 * ECharts put them; it is not enough on a lattice stepping by half a decade,
 * where a 5e-5 interval prints 1e-4, 1.5e-4, 2e-4 and one digit collapses the
 * middle one onto a neighbor. That showed up as a density axis reading
 * `0, 5e-5, 1e-4, 1e-4, 2e-4, 3e-4`, two pairs of identical labels on six
 * distinct gridlines.
 */
function expLabel(v) {
    return Number(v).toExponential(1).replace(/\.0e/, 'e');
}

/** The tick formatter for an axis, by what it measures. */
function labelFormatter(axis, scale) {
    if (axis.unit === 'probability') {
        return (v) => (v >= 0.01 || v === 0 ? String(v) : expLabel(v));
    }
    if (axis.unit === 'return_period') return (v) => compactPeriod(v);
    if (axis.unit === 'density' || scale === 'log') {
        return (v) => (v ? expLabel(v) : '0');
    }
    return (v) => fmt(v);
}

// Suffixes for `compactPeriod`, largest first so the first match wins.
const PERIOD_SCALES = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

/** A return period short enough to sit on an axis: `250`, `10k`, `2.5M`, `1B`. */
function compactPeriod(T) {
    if (!Number.isFinite(T)) return '';
    for (const [scale, suffix] of PERIOD_SCALES) {
        if (T >= scale) {
            const v = T / scale;
            return `${v >= 10 ? Math.round(v) : Number(v.toFixed(1))}${suffix}`;
        }
    }
    return T >= 10 ? String(Math.round(T)) : Number(T).toFixed(1);
}

/**
 * The axes one panel is drawn against, after the declared readings apply.
 *
 * Two changes of coordinates, in the order the library renderer applies them.
 * A paired return-period reading substitutes the axis and records the map its
 * values go through; inverting exchanges the two axes, which is what turns a
 * quantile function into the distribution function it inverts.
 */
function panelAxes(doc, panel, axes, view) {
    let xAxis = axes[panel.x_axis];
    let yAxis = axes[panel.y_axis];
    let xMap = null;
    let yMap = null;
    if (view.returnPeriod) {
        const how = (doc.meta || {}).return_period_map || 'reciprocal';
        const px = pairedReading(doc, panel.x_axis);
        if (px) { xAxis = px; xMap = how; }
        const py = pairedReading(doc, panel.y_axis);
        if (py) { yAxis = py; yMap = how; }
    }
    const inverted = Boolean(view.invert) && Boolean(panel.invertible);
    if (inverted) {
        [xAxis, yAxis] = [yAxis, xAxis];
        [xMap, yMap] = [yMap, xMap];
    }
    return { xAxis, yAxis, xMap, yMap, inverted };
}

/**
 * Realize one 'xy' panel: its series, its marks, and the two axis options.
 *
 * Everything below the coordinate exchange reads the *axes* rather than the
 * panel, so inverting is the only thing that has to happen: the ladder picks a
 * right-continuous step where it was picking a left-continuous one, the
 * windows and labels follow their axes, and a paired reading rides along on
 * whichever axis it was attached to.
 */
function xyPanel(doc, panel, i, axes, view, zoom, ctx) {
    const { xAxis, yAxis, xMap, yMap, inverted } = panelAxes(doc, panel, axes, view);
    const members = (doc.series || []).filter((s) => s.panel_id === panel.id);

    const map = (values, how) => (how ? returnPeriods(values, how) : values);
    const drawn = [];
    for (const s of members) {
        const rawX = coords(s, 'x');
        const rawY = coords(s, 'y');
        if (!rawX || !rawY) continue;
        // The document's x and y, mapped; the exchange happens after, so a
        // band's second edge stays with the coordinate it is an edge of.
        const px = map(rawX, inverted ? yMap : xMap);
        const py = map(rawY, inverted ? xMap : yMap);
        const p2 = s.y2 ? map(s.y2, inverted ? xMap : yMap) : null;
        drawn.push(inverted ? { s, x: py, y: px, y2: p2 } : { s, x: px, y: py, y2: p2 });
    }
    const allX = drawn.map((d) => d.x);
    const allY = drawn.map((d) => d.y);

    const declaredX = axisWindow(xAxis, view.fullRange);
    let xWindow = declaredX || extentOf(allX) || [0, 1];
    if (xMap && !declaredX) xWindow = [xWindow[0], Math.min(xWindow[1], MAX_RETURN_PERIOD)];
    // A paired reading re-slices the panel: the deep tail a return-period axis
    // exists to show sits far outside the window computed for the probability
    // reading, so the companion axis follows the data instead.
    let yWindow = yMap ? null : axisWindow(yAxis, view.fullRange);
    let xOnly = xMap ? null : xWindow;
    const xScale = axisScale(xAxis, view.log);
    const yScale = axisScale(yAxis, view.log);
    if (panel.aspect === 'equal' && xScale === yScale) {
        xOnly = squareWindow(xOnly, yWindow, allX, allY);
        yWindow = xOnly;
    }

    // The rung is one answer for the whole panel, not one per series: they
    // share a grid and a window, so they would all reach the same one, and a
    // panel drawing one unit as stems and another as steps would read as two
    // different kinds of thing.
    const atomGrid = (drawn.find(({ s }) => s.support !== 'continuous') || drawn[0] || {}).x || [];
    const seen = atomsInView(atomGrid, xWindow);
    const valued = members.filter((s) => s.value != null).map((s) => s.value);
    const valueLo = valued.length ? Math.min(...valued) : 0;
    const valueHi = valued.length ? Math.max(...valued) : 1;
    const valueAt = (v) => (valueHi > valueLo ? (v - valueLo) / (valueHi - valueLo) : 0.5);

    // Computed once and shared: the axis option puts it under a log window
    // whose declared low end is zero, and a stem has to start on the same line
    // or it runs off the bottom of the panel it is drawn in.
    const xFloor = decadeFloor(allX);
    const yFloor = decadeFloor(allY);

    const series = [];
    const legend = [];
    for (const { s, x, y, y2 } of drawn) {
        const color = s.value != null
            ? rampColor(VALUE_RAMP_FLOOR + (1 - VALUE_RAMP_FLOOR) * valueAt(s.value))
            : seriesColor(ctx.colorOf(s.name));
        // A log axis cannot place a zero, and the tail of a discretized density
        // is full of exact zeros and of FFT dust below LOG_FLOOR. Both become
        // gaps rather than being clamped onto the axis floor, which would draw
        // a fringe of arithmetic noise exactly where a reader expects a tail.
        const hide = (values, scale) => (scale === 'log'
            ? values.map((v) => (v != null && v > LOG_FLOOR ? v : null)) : values);
        const px = hide(x, xScale);
        const py = hide(y, yScale);
        const points = px.map((xv, k) => (xv == null || py[k] == null ? null : [xv, py[k]]));

        if (s.role === 'identity') {
            // The reference diagonal: neutral, thin, never in the legend. The
            // area between a distortion and it is the load, which is what the
            // panel is read for, so it must not compete with the curve.
            series.push({
                type: 'line', name: s.name, xAxisIndex: i, yAxisIndex: i,
                data: points, showSymbol: false, silent: true, z: 1,
                lineStyle: { width: 1, type: 'dashed', color: '#6c757d' },
                itemStyle: { color: '#6c757d' },
                tooltip: { show: false },
            });
            continue;
        }

        if (y2) {
            // A band is the region between two edges of one coordinate: the
            // series *is* the region, which is what an envelope means, rather
            // than two curves a reader has to associate. Drawn as the lower
            // edge plus the gap above it, stacked, which is exact because the
            // two share one x array by construction.
            //
            // Keyed by PANEL as well as by name: a stack name is global across
            // the series list, so keying on the name alone would invite ECharts
            // to combine two bands that live on different grids.
            const stack = `band-${panel.id}-${s.name}`;
            const upper = hide(y2, yScale);
            const base = {
                type: 'line', name: s.name, xAxisIndex: i, yAxisIndex: i,
                symbol: 'none', lineStyle: { width: 0.8, color }, itemStyle: { color },
            };
            series.push(
                { ...base, stack, data: points, areaStyle: { opacity: 0 } },
                {
                    ...base,
                    name: `${s.name} (upper)`,
                    stack,
                    data: px.map((xv, k) => (xv == null || py[k] == null || upper[k] == null
                        ? null : [xv, upper[k] - py[k]])),
                    areaStyle: { color: fade(color, 0.18) },
                    // The stacked half carries a delta, not a value, so it must
                    // not answer a hover: the number would be the gap and read
                    // as the bound.
                    tooltip: { show: false },
                    silent: true,
                },
            );
            legend.push(s.name);
            continue;
        }

        const style = drawingFor(s.support, xAxis, yAxis, seen);
        if (style === 'stem') {
            // Two ECharts series sharing one name, so one legend entry toggles
            // both: the stems, and the dots on their ends. Both are `type:
            // 'line'`, so nothing beyond `LineChart` has to be registered.
            //
            // The base a stem runs from. Zero on a linear axis, which is what
            // a mass is measured against; on a log axis, where zero has no
            // position, the same floor the axis itself took, so the stems
            // stand on the bottom gridline rather than running off under it.
            const base = yScale === 'log'
                ? (yWindow && yWindow[0] > 0 ? yWindow[0] : (yFloor ?? LOG_FLOOR))
                : 0;
            const stems = [];
            for (const p of points) {
                if (!p) continue;
                stems.push([p[0], base], [p[0], p[1]], null);
            }
            series.push(
                {
                    type: 'line', name: s.name, xAxisIndex: i, yAxisIndex: i,
                    data: stems, showSymbol: false, connectNulls: false, silent: true,
                    lineStyle: { width: 1, color, opacity: 0.55 },
                    itemStyle: { color }, z: 2,
                },
                {
                    type: 'line', name: s.name, xAxisIndex: i, yAxisIndex: i,
                    data: points, showSymbol: true, symbolSize: 5, connectNulls: false,
                    lineStyle: { width: 0 }, itemStyle: { color },
                    emphasis: { focus: 'series' }, z: 3,
                },
            );
            legend.push(s.name);
            continue;
        }

        series.push({
            type: 'line',
            name: s.name,
            xAxisIndex: i,
            yAxisIndex: i,
            ...(STEP_KEY[style] ? { step: STEP_KEY[style] } : {}),
            data: points,
            sampling: gapFree(points) ? SAMPLING : undefined,
            showSymbol: false,
            connectNulls: false,
            lineStyle: {
                width: s.value != null ? 0.75 : lineWidth(),
                opacity: s.value != null ? 0.55 : 1,
                color,
            },
            itemStyle: { color },
            emphasis: { focus: 'series' },
        });
        // One of a family labeled by a number rather than by a name stays out
        // of the legend: forty entries would be forty names nobody asked for,
        // and the number is already encoded on the ramp.
        if (s.value == null) legend.push(s.name);
    }

    // Marks last, on the panel's first series, so they draw once. A mark names
    // the axis it sits on, so exchanged axes exchange it too. Suppressed whole
    // when the reader turns the reference lines off.
    const placed = [];
    for (const m of view.refLines === false ? [] : doc.marks || []) {
        if (m.panel_id !== panel.id) continue;
        const orient = inverted ? (m.orient === 'v' ? 'h' : 'v') : m.orient;
        const how = orient === 'v' ? xMap : yMap;
        let at = m.at;
        if (how) {
            [at] = returnPeriods([at], how);
            if (at == null) continue;
        }
        placed.push({ m, orient, at });
    }
    // **Which side each label takes, by where the mark is and not by its order
    // in the document.** The author's rule is mean and 1-in-100 to the left of
    // their lines, the capital anchor to the right, so the two do not print on
    // top of each other. Expressed as "the outermost mark opens outward": the
    // largest `at` on a panel takes the right, every other takes the left. a62
    // alternated on `index % 2`, which happens to give the same answer for two
    // marks in document order and an arbitrary one for any other number, and is
    // why the item came back.
    const rightmost = placed.reduce(
        (best, p, i) => (p.orient === 'v' && (best < 0 || p.at > placed[best].at) ? i : best),
        -1,
    );
    const marks = placed.map((p, i) => markLineEntry(p.m, p.orient, p.at, i === rightmost));
    if (marks.length && series.length) series[0].markLine = markLine(marks);

    const xFormatter = labelFormatter(xAxis, xScale);
    const yFormatter = labelFormatter(yAxis, yScale);
    return {
        series,
        legend,
        xAxis: axisOption(xAxis, i, {
            scale: xScale, window: xOnly, floor: xFloor, formatter: xFormatter,
        }),
        // The y name clears its own tick labels: they run out from the axis
        // line toward it, and `2.5e-4` is wider than the 26 the shared default
        // reserves. 46 is what the heatmap panel already uses, so both kinds of
        // panel now hold their name at the same distance.
        yAxis: axisOption(yAxis, i, {
            scale: yScale, window: yWindow, floor: yFloor, formatter: yFormatter,
            nameGap: 46,
        }),
        // Which axis the reader interrogates, per grid. A density is read by
        // loss; a Lee panel is read at a chosen probability and answers with an
        // outcome, and hunting along the curve for it is work the axis can do.
        readAxis: inverted ? (panel.read_axis === 'y' ? 'x' : 'y') : (panel.read_axis || 'x'),
        title: panelTitle(doc, panel, inverted),
        xWindow: xOnly,
        // What the mount's zoom listener needs to tell a gesture that changes
        // the picture from one that only moves it, without rebuilding the
        // option per wheel notch to find out.
        atomGrid,
        rung: drawn.length
            ? { support: drawn[0].s.support, xAxis, yAxis,
                drawnAs: drawingFor(drawn[0].s.support, xAxis, yAxis, seen) }
            : null,
        // The zoom the reader is holding, converted back into the percentages
        // dataZoom speaks in, so a rebuild restores it rather than undoing it.
        zoom: zoomExtent(zoom, xOnly),
        xUnit: xAxis.unit,
        yUnit: yAxis.unit,
        xName: xAxis.label,
        yName: yAxis.label,
    };
}

/** The panel's heading; exchanged axes draw a different picture, so it is renamed. */
function panelTitle(doc, panel, inverted) {
    const own = panel.title || doc.title || '';
    if (!inverted) return own;
    return panel.inverse_title || (own ? `${own}, inverted` : 'Inverted');
}

/**
 * One mark as a markLine entry.
 *
 * The label side is the renderer's: the document says where a mark sits and
 * what it reads, not which way its text runs.
 *
 * **A vertical mark's label runs vertically**, down from the top of the plot,
 * which is the author's layout and also the only one that fits: a horizontal
 * `1-in-200` beside a line two thirds of the way along a density is a word laid
 * across the curve it is annotating.
 *
 * Getting the side right under `rotate: 90` is the fiddly part, and it is worth
 * writing down because it reads backwards. Rotation is counterclockwise, so the
 * text's own +x axis points **up** the screen and its +y points **left**.
 * Therefore, anchored at the top of the line:
 *
 * * `align: 'right'` puts the text's end at the anchor, so it hangs **down**
 *   from the top of the plot, which is the "aligned up to the top" in the ask.
 * * `verticalAlign` is what puts the label to one side of its line or the
 *   other, which is not a thing anyone guesses, and the sense is the opposite
 *   of the one the geometry suggests: **`'top'` draws to the right of the line
 *   and `'bottom'` to the left**. Established by looking at it, after the
 *   derivation from the rotation direction gave the answer backwards and put
 *   `1-in-200` on the wrong side of its own line.
 *
 * `distance` is left at zero on the shared chrome for the same reason: it acts
 * along the rotated frame and moving a label with it lands somewhere unrelated
 * to the side it was meant to shift. Padding does the clearance instead.
 *
 * @param {boolean} right whether this mark's label opens to the right of its
 *   line. One per panel, the outermost; see the caller.
 */
function markLineEntry(m, orient, at, right) {
    const line = {
        color: '#6c757d',
        type: 'dashed',
        width: 1,
        opacity: m.faint ? 0.45 : 1,
    };
    if (orient !== 'v') {
        // A horizontal mark's label reads horizontally: there is no curve for it
        // to lie across and no pair of them to collide.
        return {
            yAxis: at,
            name: m.label || '',
            lineStyle: line,
            label: { position: 'insideStartTop', align: 'left', padding: [0, 0, 0, 5] },
        };
    }
    return {
        xAxis: at,
        name: m.label || '',
        lineStyle: line,
        label: {
            // Inside the plot at the top, not above it: for a vertical markLine
            // "end" is the top, and outside it collides with the panel title.
            // This is the "1-in-200 renders above the plot" of the punch list.
            position: 'insideEndTop',
            rotate: 90,
            align: 'right',
            verticalAlign: right ? 'top' : 'bottom',
            padding: [0, 4, 0, 4],
        },
    };
}

/** The shared markLine chrome for one panel's entries. */
function markLine(entries) {
    return {
        symbol: 'none',
        silent: true,
        label: {
            // `distance: 0`: see `markLineEntry`. It offsets along the rotated
            // text frame, so any non-zero value moves a vertical label in a
            // direction unrelated to the side it was placed on.
            show: true, fontSize: 10, color: '#6c757d', distance: 0,
            formatter: (p) => p.name,
        },
        lineStyle: { color: '#6c757d', type: 'dashed', width: 1 },
        data: entries,
    };
}

/** A held zoom in loss units, as the percentages dataZoom speaks in. */
function zoomExtent(zoom, window) {
    if (!zoom || !window || !(window[1] > window[0])) return {};
    const span = window[1] - window[0];
    return {
        start: (100 * (zoom[0] - window[0])) / span,
        end: (100 * (zoom[1] - window[0])) / span,
    };
}

/**
 * Realize one grid panel flat: the z grid as a heatmap.
 *
 * ECharts draws a heatmap over category axes, so the grid's coordinates are
 * the categories and a cell is `[column, row, value]`. The values are
 * densities: the wire carries mass per display cell, block-summed
 * mass-preservingly upstream, and `decodeSurfaceGrid` divides by the cell area
 * once so this and the 3-D path read the same units off one decode.
 *
 * A log reading of the z axis draws `log10` of each cell, floored one decade
 * under the smallest density actually present. A zero cell rests on the floor
 * rather than punching a hole: an FFT-built joint is full of exact zeros, and
 * as holes the field arrives moth-eaten.
 */
function heatmapPanel(doc, panel, i, axes, view, box) {
    const s = findSurfaceSeries(doc, panel.id);
    if (!s) return null;
    const g = decodeSurfaceGrid(s.surface);
    const x = xCoords(g);
    const y = yCoords(g);
    const zAxis = axes[panel.z_axis] || {};
    const useLog = axisScale(zAxis, view.log) === 'log';
    const floor = decadeFloor([g.z]) || LOG_FLOOR;

    let max = -Infinity;
    const cells = [];
    for (let r = 0; r < g.ny; r++) {
        for (let c = 0; c < g.nx; c++) {
            const v = g.z[r * g.nx + c];
            const h = useLog ? Math.log10(Math.max(v, floor)) : v;
            if (h > max) max = h;
            cells.push([c, r, h]);
        }
    }
    const min = useLog ? Math.log10(floor) : 0;
    const st = houseStyle();
    const label = {
        fontSize: 10, color: '#6c757d', hideOverlap: true,
        formatter: (v) => fmt(Number(v)),
    };
    const zLabel = zAxis.label || 'z';
    const xTicks = categoryTicks(x);
    const yTicks = categoryTicks(y);
    // Contours over the image, at the same eight levels the relief draws, so
    // the two readings of one grid are the same drawing seen twice. The axes
    // here are categories, so a path in data coordinates becomes one in
    // fractional cell indices, which is what a category axis takes.
    const toI = (v) => (v - g.x0) / g.dx;
    const toJ = (v) => (v - g.y0) / g.dy;
    const heightAt = (ci, rj) => {
        const value = g.z[rj * g.nx + ci];
        return useLog ? Math.log10(Math.max(value, floor)) : value;
    };
    const lines = [];
    const top = Number.isFinite(max) ? max : min + 1;
    for (let level = 1; level <= SURFACE_CONTOUR_LEVELS; level++) {
        const at = min + ((top - min) * level) / (SURFACE_CONTOUR_LEVELS + 1);
        for (const path of contourPaths(g, at, heightAt)) {
            if (lines.length >= SURFACE_CONTOUR_CAP) break;
            lines.push({
                type: 'line', name: 'contour', silent: true,
                xAxisIndex: i, yAxisIndex: i,
                showSymbol: false, smooth: false,
                data: path.map((p) => [toI(p[0]), toJ(p[1])]),
                lineStyle: { color: SURFACE_CONTOUR_COLOR,
                             width: SURFACE_CONTOUR_WIDTH,
                             opacity: SURFACE_CONTOUR_OPACITY },
                tooltip: { show: false },
            });
        }
    }
    return {
        // The image first, because the panel's visualMap addresses its first
        // series and must color the cells rather than the contours over them.
        series: [{
            type: 'heatmap', name: s.name, data: cells,
            xAxisIndex: i, yAxisIndex: i,
            progressive: 4000, emphasis: { disabled: true },
        }, ...lines],
        legend: [],
        xAxis: axisStyle({
            type: 'category', gridIndex: i, name: (axes[panel.x_axis] || {}).label || '',
            data: x, splitLine: { show: false },
            axisLabel: { ...label, ...xTicks },
        }),
        yAxis: axisStyle({
            type: 'category', gridIndex: i, name: (axes[panel.y_axis] || {}).label || '',
            data: y, nameGap: 46, splitLine: { show: false },
            axisLabel: { ...label, ...yTicks },
        }),
        visualMap: {
            min, max: Number.isFinite(max) ? max : min + 1, seriesIndex: null,
            calculable: true,
            left: box.left + box.width + 24,
            top: box.top + 10,
            itemHeight: Math.max(90, box.height - 60),
            textStyle: { fontSize: 10, color: '#6c757d' },
            // The same ramp the relief uses, because these are two drawings of
            // one grid and a reader flipping between them is entitled to see
            // one color mean one height.
            inRange: { color: VIRIDIS },
            formatter: (v) => (useLog ? `1e${Math.round(v)}`
                : (v ? Number(v).toExponential(1) : '0')),
        },
        tooltip: {
            trigger: 'item',
            formatter: (p) => {
                const v = useLog ? 10 ** p.value[2] : p.value[2];
                const shown = (useLog && p.value[2] <= min)
                    ? `&lt; ${floor.toExponential(0)}` : Number(v).toExponential(3);
                return `${fmt(Number(x[p.value[0]]))}, ${fmt(Number(y[p.value[1]]))}`
                    + `<br>${zLabel} <b>${shown}</b>`;
            },
        },
        readAxis: 'x',
        title: panelTitle(doc, panel, false),
        xWindow: null,
        zoom: {},
    };
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
 *     `view` -- which declared reading is on screen:
 *     `{log, fullRange, returnPeriod, invert, kind}`. Each acts on every axis
 *     or panel that declares it and is ignored everywhere else, so a document
 *     with nothing to say about a reading draws identically either way.
 *     `width` -- host width in CSS pixels, which the layout is computed from.
 *     `zoom` -- the window the reader is holding on the shared x axis, in data
 *     units, so a rebuild restores the gesture rather than undoing it.
 *     `overrides` -- per-chart chrome: a dict, or a function of the adapter's
 *     context returning one, merged over the semantic skeleton one nested
 *     level deep.
 *
 * Returns
 * -------
 * object or null
 *     The ECharts option, or null when the document carries no realizable
 *     panel. Carries a few non-ECharts keys the mount reads: `hostHeight`,
 *     `panelFootprint`, `lossWindow`, `atomsSeen`, `is3d`.
 */
export function chartdocToEcharts(doc, opts = {}) {
    const panels = (doc && doc.panels) || [];
    if (!panels.length) return null;
    if (doc.ir_version > CHART_IR_VERSION) return null;
    const view = { log: false, fullRange: false, returnPeriod: false,
                   invert: false, kind: null, ...(opts.view || {}) };
    const realized = panels.map((p) => realization(p, view.kind));
    // The bifurcation, split by RENDERER CAPABILITY rather than by panel kind.
    // A heatmap is a 2-D drawing of the same grid a surface draws in relief, so
    // a kind-based split would file it with the surface and it belongs here.
    // One entry point, two paths, and no shared realization code below the
    // split: only the panel walk, `merge`, and the axis helpers both sides read.
    if (realized.some((k) => k === 'surface')) return surfaceOption(doc, opts, view);
    return xyOption(doc, opts, view, realized);
}

/** The 2-D path: 'xy' and flat grid panels, one ECharts grid each. */
function xyOption(doc, opts, view, realized) {
    const panels = doc.panels || [];
    const axes = Object.fromEntries((doc.axes || []).map((a) => [a.id, a]));
    const box = documentLayout(doc, opts.width);

    // One color per series NAME, across every panel. Series in different panels
    // sharing a name are the same entity seen twice, so they must be the same
    // color and share one legend entry; the emission-order arithmetic this
    // replaces broke the moment a panel carried a different number of series
    // than its neighbor.
    const order = [];
    const colorOf = (name) => {
        let at = order.indexOf(name);
        if (at < 0) { at = order.length; order.push(name); }
        return at;
    };
    const ctx = { colorOf };

    const realizedPanels = panels.map((panel, i) => (
        realized[i] === 'xy'
            ? xyPanel(doc, panel, i, axes, view, opts.zoom, ctx)
            : heatmapPanel(doc, panel, i, axes, view, box.grids[i])
    )).filter(Boolean);
    if (!realizedPanels.length) return null;

    // The flat series list, plus which panel each entry came from. The tooltip
    // reads the second to find out how to word itself, and a grid panel's
    // visualMap needs the flat index of its own mesh.
    const series = [];
    const seriesPanel = [];
    realizedPanels.forEach((p, i) => {
        p.firstSeries = series.length;
        for (const s of p.series) { series.push(s); seriesPanel.push(i); }
    });
    const legend = [...new Set(realizedPanels.flatMap((p) => p.legend))];
    // The legend as the page will draw it: a name and the color it is drawn in.
    // Derived here rather than pushed alongside the names at each of the three
    // `legend.push` sites, so there is one place that knows a legend entry is a
    // name plus a swatch. A stem is two ECharts series under one name and the
    // first carries the color, which is why this takes the first match.
    const legendItems = legend.map((name) => {
        const s = series.find((entry) => entry.name === name);
        return { name, color: (s && s.itemStyle && s.itemStyle.color) || '#6c757d' };
    });

    // Panels naming the same axis id share it: that is what makes a density
    // and its tail one reading of one book rather than two pictures that
    // happen to sit side by side, and a window set on it moves both. The
    // sharing is by **id**, not by orientation, because the same axis is
    // routinely x in one panel and y in the next: an aggregate's outcome axis
    // runs across the density and up the Lee diagram, and zooming the loss on
    // one has to move the loss on the other.
    //
    // An equal-aspect panel does not join in and takes no zoom of its own. Its
    // window is settled by its own squareness, and a zoom that moved one axis
    // and not the other would break the 45 degree reading the panel exists for.
    const zoomable = panels
        .map((p, i) => ({ p, i }))
        .filter(({ p, i }) => realized[i] === 'xy' && p.aspect !== 'equal');
    const groups = new Map();
    for (const { p, i } of zoomable) {
        for (const [role, id] of [['x', p.x_axis], ['y', p.y_axis]]) {
            if (!groups.has(id)) groups.set(id, { x: [], y: [] });
            groups.get(id)[role].push(i);
        }
    }
    const dataZoom = [];
    for (const roles of groups.values()) {
        // Anchored on a drawn x: a reader zooms along the axis they are reading
        // across, and an axis that is only ever a y here has no gesture of its
        // own to answer.
        if (!roles.x.length) continue;
        const held = realizedPanels[roles.x[0]].zoom;
        // filterMode 'filter' drops out-of-window points from the extent
        // calculation, so the other axis rescales to what is visible. Without
        // it, zooming into a tail zooms into a flat strip near zero.
        dataZoom.push({
            type: 'inside', filterMode: 'filter',
            xAxisIndex: roles.x,
            ...(roles.y.length ? { yAxisIndex: roles.y } : {}),
            ...held,
        });
    }

    const base = merge(baseOption(), {
        grid: box.grids.map((g, i) => ({
            ...g,
            containLabel: false,
            tooltip: { axisPointer: { axis: (realizedPanels[i] || {}).readAxis || 'x' } },
        })),
        title: realizedPanels.map((p, i) => ({
            text: p.title, left: box.grids[i].left, top: box.grids[i].top - 24,
            textStyle: { fontSize: 12, fontWeight: 600 },
        })).filter((t) => t.text),
        xAxis: realizedPanels.map((p) => p.xAxis),
        yAxis: realizedPanels.map((p) => p.yAxis),
        // Declared and never drawn. The component has to exist, because it is
        // what owns series selection and what `legendToggleSelect` addresses,
        // and the page draws its own legend instead: the mount's strip carries
        // the names, the swatches **and** the values under the cursor, which is
        // the one thing ECharts' own legend cannot be made to do.
        legend: { ...baseOption().legend, show: false, data: legend },
        series,
        ...(dataZoom.length ? { dataZoom } : {}),
    });

    // A grid panel brings its own visualMap and item tooltip, which are chrome
    // rather than semantics but cannot be expressed per panel in a shared
    // option, so they are lifted here.
    const grids = realizedPanels.filter((p) => p.visualMap);
    if (grids.length) {
        base.visualMap = grids.map((p) => ({ ...p.visualMap, seriesIndex: p.firstSeries }));
        base.tooltip = { ...base.tooltip, ...grids[0].tooltip };
    } else {
        base.tooltip = {
            ...base.tooltip,
            // **One line, not a cross.** a50 chose `'cross'` reasoning that on a
            // Lee panel the y value is the answer, so a horizontal tracking line
            // reading it off the axis is worth as much as the vertical one. True
            // as far as it goes, and the author's ruling is that the second line
            // is clutter either way: the panel already declares which coordinate
            // it is interrogated on, `grid[i].tooltip.axisPointer.axis` above
            // sets the pointer to it per panel, and the strip prints the reading
            // in words. So the line that tracks is the one the panel is read by,
            // and there is no second line to work out the meaning of.
            axisPointer: {
                type: 'line',
                lineStyle: { color: '#adb5bd', width: 1, type: 'dashed' },
                label: { show: false },
            },
            formatter: (params) => tooltipText(params, seriesPanel, realizedPanels),
        };
        // The same reading as data, for a caller that would rather write it
        // into the page than let a box follow the cursor. Not an ECharts key.
        base.readout = (params) => readoutModel(params, seriesPanel, realizedPanels);
    }

    const option = merge(base, resolveOverrides(opts.overrides, { doc, view, box }));
    // What the page's own legend is built from. Empty on a grid panel, which
    // has no series to name and keeps ECharts' item tooltip.
    option.legendItems = grids.length ? [] : legendItems;
    option.hostHeight = box.hostHeight;
    option.panelFootprint = box.footprint;
    option.is3d = false;
    // What the mount's zoom listener reads: the shared window, the grid the
    // atom count was taken over, and the rung it produced.
    const first = realizedPanels.find((p) => p.xWindow && p.rung) || {};
    option.lossWindow = first.xWindow || null;
    option.lossGrid = first.atomGrid || null;
    option.rung = first.rung || null;
    option.readings = readings(doc);
    return option;
}

/** One number, said the way its axis measures things. */
function readValue(v, unit) {
    if (v == null) return '';
    if (unit === 'probability') return Number(v).toExponential(3);
    if (unit === 'return_period') return `1-in-${compactPeriod(v)}`;
    if (unit === 'density') return Number(v).toExponential(3);
    return fmt(v);
}

/**
 * What the cursor is over, as data rather than as markup.
 *
 * Pure, and the same answer whether the renderer puts it in a floating box or
 * writes it into the page. That split is the point: `dev/plan-plot-ir-api.md`
 * 7.4 replaces the box that follows the cursor with a fixed strip in ordinary
 * page text, and the mount does the writing, so this stays testable.
 *
 * The head names the coordinate the panel is **interrogated on**, which is not
 * the same axis in every panel: a density is read by loss and a Lee diagram at
 * a chosen probability, so one "loss ..." head would be wrong on half the
 * chart. Named rather than bare for the same reason.
 *
 * Returns
 * -------
 * object or null
 *     `{head, rows: [{color, name, value}]}`, or null with nothing under the
 *     cursor.
 */
function readoutModel(params, seriesPanel, panels) {
    const rows = (Array.isArray(params) ? params : [params])
        .filter((p) => Array.isArray(p.value) && p.value[1] != null);
    if (!rows.length) return null;
    const panel = panels[seriesPanel[rows[0].seriesIndex]] || {};
    const readY = panel.readAxis === 'y';
    const head = readY
        ? `${panel.yName || ''} ${readValue(rows[0].value[1], panel.yUnit)}`.trim()
        : `${panel.xName || ''} ${readValue(rows[0].value[0], panel.xUnit)}`.trim();
    return {
        head,
        rows: rows.map((p) => ({
            color: (p.color && String(p.color)) || '#6c757d',
            name: p.seriesName,
            value: readValue(readY ? p.value[0] : p.value[1],
                             readY ? panel.xUnit : panel.yUnit),
        })),
    };
}

/** The same reading as ECharts' own tooltip markup, for the floating box. */
function tooltipText(params, seriesPanel, panels) {
    const model = readoutModel(params, seriesPanel, panels);
    if (!model) return '';
    const body = model.rows
        .map((r, i) => `${(Array.isArray(params) ? params : [params])[i].marker}`
            + `${r.name} <b>${r.value}</b>`)
        .join('<br>');
    return `${model.head}<br>${body}`;
}

/**
 * The rung the ladder would land on if the reader zoomed to `window`.
 *
 * A wheel gesture fires continuously and rebuilding the option per notch would
 * be a rebuild per frame, so the mount asks this instead and redraws only when
 * the answer has actually changed. It is the same count over the same grid the
 * build used, which is why it lives here rather than being re-derived there.
 *
 * Parameters
 * ----------
 * option : object
 *     A built option, carrying `lossGrid` and `rung`.
 * window : Array<number> or null
 *     The window in data units, or null for the whole extent.
 *
 * Returns
 * -------
 * string or null
 *     The drawing the panel would take, or null when the chart has no atomic
 *     series and so no ladder to climb.
 */
export function rungAt(option, window) {
    if (!option || !option.lossGrid || !option.rung) return null;
    const { support, xAxis, yAxis } = option.rung;
    return drawingFor(support, xAxis, yAxis, atomsInView(option.lossGrid, window));
}

/** Resolve the per-chart chrome, which may be a dict or a function of context. */
function resolveOverrides(overrides, ctx) {
    return typeof overrides === 'function' ? overrides(ctx) : overrides;
}

// ---- the relief, as the prototype settled it ---------------------------
//
// Every constant below is the `app` preset of
// `dev/prototypes/joint-surface/surface-lab.html`, which is the state the
// author picked after looking at the four real surfaces. Copied rather than
// reinterpreted: the lab is the reference implementation and the numbers in it
// were arrived at by looking, so a value invented here would be a second
// opinion about a question already answered.

/** How many decades under the peak a log height reaches before it floors.
 *
 * A stated depth, not wherever the data stops. A joint lognormal runs twelve
 * decades from its mode to its corner, and on a log axis that spends most of
 * the box on mass nobody will ever look at, which is its own way of pressing
 * the interesting part flat. */
const SURFACE_DECADES = 8;

/** The base, pushed below the data as a fraction of the drawn range.
 *
 * Two things follow. The box gets a visible bottom, which it never had. And
 * the floor's picture slides down the screen relative to the surface's, so a
 * band of it clears the silhouette along the near edges and the image
 * underneath becomes visible instead of being an opaque lid's worth of wasted
 * work. */
const SURFACE_BASE_DROP = 0.45;

/**
 * How much taller the relief's host is than a flat square panel's.
 *
 * The 3-D box spends height on perspective and on the base drop before it
 * spends any on the surface, so at the flat panel's size the picture is all
 * chrome. This is the one place the app sizes a chart by what it is rather
 * than by the document's aspect, and it is a drawing decision, not a semantic
 * one.
 */
const SURFACE_HOST_SCALE = 1.4;
const SURFACE_HOST_MAX = 760;

/** The floor image's opacity, and the target cells per axis it is decimated to. */
const SURFACE_FLOOR_OPACITY = 0.5;
const SURFACE_FLOOR_CELLS = 90;

/** Every sixth mesh line, lifted a hair off the skin so it is not z-fighting.
 *
 * The mesh is real `line3D` geometry rather than the surface's built-in
 * `wireframe`, and that is not a preference. The built-in one is drawn inside
 * the surface's fragment shader, which mixes the line color into the color and
 * leaves the alpha alone, so it inherits the skin's opacity; and it traces the
 * data mesh, so at ninety cells a side it is a solid block of ink with no way
 * to thin it. `line3D` has its own color, width, opacity and spacing. */
const SURFACE_MESH_COARSE = 6;
const SURFACE_MESH_LIFT = 0.0018;

/** A hair: what anything standing just clear of something else gets. */
const SURFACE_HAIR = 0.004;

/**
 * The z axis box, snapped so its ticks are round numbers.
 *
 * The data bounds are whatever the density happens to reach, and an axis drawn
 * between two of those subdivides into five more of them: an axis labeled
 * -1.188e-6, -0.283e-6, 0.622e-6 is printing arithmetic. Snapping both ends to
 * multiples of a nice step makes every tick between them round as well, and
 * costs only a little empty box at the top and bottom, where there is nothing
 * to see anyway. The absolute height of a density is not the reading here; the
 * shape is.
 *
 * The *data* floor and ceiling are untouched: they still set the color scale,
 * the log clamp and where the floor image stands. Only the drawn box moves.
 */
function niceBox(lo, hi) {
    const span = hi - lo;
    if (!(span > 0) || !Number.isFinite(span)) return { min: lo, max: hi };
    const step = niceStep(span / 5) || span / 5;
    return {
        min: Math.floor(lo / step) * step,
        max: Math.ceil(hi / step) * step,
    };
}

/** The ink of the things drawn over the surface, from the same preset. */
const SURFACE_MESH_COLOR = '#f8f9fa';
const SURFACE_MESH_WIDTH = 0.9;
const SURFACE_MESH_OPACITY = 0.5;
const SURFACE_FLOOR_INK = '#e9ecef';
const SURFACE_MARGINAL_COLOR = '#6c757d';
// White, not the prototype's gray. Viridis runs dark purple to yellow, and a
// mid gray reads on neither end; on the floor image it disappears entirely.
const SURFACE_CONTOUR_COLOR = '#ffffff';
const SURFACE_CONTOUR_WIDTH = 1.4;
const SURFACE_CONTOUR_OPACITY = 0.85;

/** How many contour levels, and the cap on the polylines they may emit. */
const SURFACE_CONTOUR_LEVELS = 8;
const SURFACE_CONTOUR_CAP = 160;

/** How much of the drawn height the taller wall curve is scaled to fill. */
const SURFACE_MARGINAL_SCALE = 0.55;

/**
 * Every k-th line of the grid, as one connected polyline per family.
 *
 * A `line3D` series is a single polyline, so the selected rows are walked
 * boustrophedon and the turn at the end of a row traces the boundary column
 * point by point instead of cutting straight across it. Every segment that
 * comes out is a real edge of the mesh, so this is a wireframe rather than a
 * wireframe plus a set of chords through the surface.
 */
function meshPolylines(g, k, at) {
    const every = (count) => {
        const idx = [];
        for (let i = 0; i < count; i += k) idx.push(i);
        if (idx[idx.length - 1] !== count - 1) idx.push(count - 1);
        return idx;
    };
    const rows = [];
    every(g.ny).forEach((r, i, all) => {
        const fwd = i % 2 === 0;
        for (let j = 0; j < g.nx; j++) rows.push(at(fwd ? j : g.nx - 1 - j, r));
        if (i < all.length - 1) {
            const edge = fwd ? g.nx - 1 : 0;
            for (let rr = r + 1; rr < all[i + 1]; rr++) rows.push(at(edge, rr));
        }
    });
    const cols = [];
    every(g.nx).forEach((c, i, all) => {
        const fwd = i % 2 === 0;
        for (let j = 0; j < g.ny; j++) cols.push(at(c, fwd ? j : g.ny - 1 - j));
        if (i < all.length - 1) {
            const edge = fwd ? g.ny - 1 : 0;
            for (let cc = c + 1; cc < all[i + 1]; cc++) cols.push(at(cc, edge));
        }
    });
    return [rows, cols];
}

/** The three cuts, colored so a curve on a wall says which cut it came from. */
const CUT_COLORS = { x: '#dc3545', y: '#0d6efd', s: '#198754' };

/**
 * The cuts, their conditionals on the walls, and the marks on those.
 *
 * Parameters
 * ----------
 * g : object
 *     The decoded grid.
 * ctx : object
 *     Everything the surface already computed: `height`, the box heights, the
 *     wall positions, the wall scale `k`, and `dataMax`, the joint's own peak.
 * view : object
 *     Reads `cut` ('none' | 'components' | 'total' | 'all') and the three
 *     positions `cutX`, `cutY`, `cutS`, each a fraction of its own range.
 *     Three rather than one because a click places a cut where the reader
 *     pointed, which is two independent coordinates; the walk drives all three
 *     from the diagonal, which is what keeps them crossing at one point.
 *
 * Returns
 * -------
 * object
 *     `{series, readout}`. `readout` is the fixed strip's rows, the numbers the
 *     cut is standing on, and is empty when no cut is asked for.
 *
 * Notes
 * -----
 * Two marks are the content of this whole chart. On a component cut, holding x
 * leaves a distribution in y and the mark is `E[Y | X = x]` standing on the
 * curve it is the mean of. On the total cut the pair is kappa, drawn against
 * the even split, and the gap between the filled dot and the hollow ring is how
 * far from even the split of a total is, drawn rather than subtracted.
 *
 * Every mark is emitted with empty data rather than omitted when it falls
 * outside the box. An incremental update merges by id and can change a series
 * that is there but cannot remove one that has gone, so dropping it leaves the
 * last dot stuck where it was.
 */
function cutSeries(g, ctx, view) {
    const mode = view.cut || 'none';
    if (mode === 'none') return { series: [], readout: [] };
    const { height, zMax, floorH, hair, xWall, yWall, k, dataMax,
            xName, yName, digits } = ctx;
    const out = [];
    // Two groups, so the strip reads left to right in the order a reader asks
    // the questions in: where the cut is, then what it leaves.
    const where = [];
    const leaves = [];
    const shown = (v) => (Number.isFinite(v) ? fmt(v) : '');
    const shownZ = (v) => (Number.isFinite(v)
        ? Number(v).toExponential(Math.max(1, digits - 3)) : '');
    const onWall = (v) => Math.min(zMax, Math.max(floorH, height(v)));
    const frac = (value, fallback) => (Number.isFinite(value)
        ? Math.min(1, Math.max(0, value)) : fallback);
    const along = (lo, hi, f) => lo + (hi - lo) * f;
    const heldX = along(coordX(g, 0), coordX(g, g.nx - 1), frac(view.cutX, 0.5));
    const heldY = along(coordY(g, 0), coordY(g, g.ny - 1), frac(view.cutY, 0.5));
    const total = along(coordX(g, 0) + coordY(g, 0),
                        coordX(g, g.nx - 1) + coordY(g, g.ny - 1),
                        frac(view.cutS, 0.5));

    // A conditional is put on the marginal's scale on purpose: both are
    // densities in the same variable, so their heights are comparable and the
    // gap between them is the lesson. The trouble is that a conditional can
    // legitimately be far taller: given the total, x is confined to [0, s] and
    // the density there is roughly 1 / s, which at small s dwarfs anything the
    // marginal does. So the shared scale is kept whenever it fits and the curve
    // is shrunk by the least factor that brings it inside otherwise.
    const fit = (vals) => {
        let peak = 0;
        for (const value of vals) if (value > peak) peak = value;
        const room = dataMax * 0.98;
        return peak > room ? room / peak : 1;
    };
    const scaled = (vals) => {
        const f = fit(vals);
        return f === 1 ? vals : vals.map((value) => value * f);
    };

    /** A stem to the floor and a dot on the curve, at `at`. */
    const markMean = (tag, color, along, coords, vals, at) => {
        const lo = Math.min(coords[0], coords[coords.length - 1]);
        const hi = Math.max(coords[0], coords[coords.length - 1]);
        const live = Number.isFinite(at) && at >= lo && at <= hi;
        const top = live ? onWall(interpAt(coords, vals, at)) : 0;
        const point = (z) => (along === 'x' ? [at, yWall, z] : [xWall, at, z]);
        out.push({
            id: `mean-${tag}`, type: 'line3D', name: `mean of ${tag}`,
            data: live ? [point(floorH), point(top)] : [],
            lineStyle: { color, width: 1.2, opacity: 0.55 }, silent: true,
        }, {
            id: `meandot-${tag}`, type: 'scatter3D', name: `mean of ${tag}`,
            symbolSize: 9, data: live ? [point(top)] : [],
            itemStyle: { color, opacity: 1, borderColor: '#ffffff', borderWidth: 1 },
            silent: true,
        });
    };

    if (mode === 'components' || mode === 'all') {
        // Holding x leaves a distribution in y, and the mirror. The cut is
        // named by what is held, the mean by what is left.
        const held = [
            { tag: 'x', color: CUT_COLORS.x, alongY: true,
              curve: columnAt(g, heldX), coords: yCoords(g), step: g.dy },
            { tag: 'y', color: CUT_COLORS.y, alongY: false,
              curve: rowAt(g, heldY), coords: xCoords(g), step: g.dx },
        ];
        for (const a of held) {
            const raw = Array.from(a.curve.values);
            const mass = raw.reduce((s, value) => s + value, 0) * a.step;
            // Renormalized, the cut is a conditional density in the same units
            // as the marginal beside it, so it takes that wall's scale.
            const wall = scaled(raw.map((value) => (value / (mass || 1)) * k));
            const mu = weightedMean(a.coords, raw);
            out.push({
                id: `cond-${a.tag}`, type: 'line3D',
                name: `conditional given ${a.tag}`,
                data: a.alongY
                    ? a.coords.map((c, r) => [xWall, c, onWall(wall[r])])
                    : a.coords.map((c, i) => [c, yWall, onWall(wall[i])]),
                lineStyle: { color: a.color, width: 2.4, opacity: 1 }, silent: true,
            }, {
                // The cut itself, lying on the surface, and its foot on the
                // floor. On its own the curve on the skin reads as a stripe of
                // color rather than as a position; the trace gives it a foot.
                id: `cut-${a.tag}`, type: 'line3D', name: `cut at ${a.tag}`,
                data: a.alongY
                    ? a.coords.map((c, r) => [a.curve.at, c,
                                              Math.min(zMax, height(raw[r]) + hair)])
                    : a.coords.map((c, i) => [c, a.curve.at,
                                              Math.min(zMax, height(raw[i]) + hair)]),
                lineStyle: { color: a.color, width: 2.4, opacity: 1 }, silent: true,
            }, {
                id: `trace-${a.tag}`, type: 'line3D', name: `trace at ${a.tag}`,
                data: a.alongY
                    ? [[a.curve.at, coordY(g, 0), floorH + hair],
                       [a.curve.at, coordY(g, g.ny - 1), floorH + hair]]
                    : [[coordX(g, 0), a.curve.at, floorH + hair],
                       [coordX(g, g.nx - 1), a.curve.at, floorH + hair]],
                lineStyle: { color: a.color, width: 1.6, opacity: 0.85 }, silent: true,
            });
            markMean(a.tag, a.color, a.alongY ? 'y' : 'x', a.coords, wall, mu);
            where.push({
                name: a.alongY ? xName : yName,
                color: a.color,
                value: shown(a.curve.at),
            });
            // Named by what is left, not by what is held: fixing x leaves a
            // distribution in y, so this is the mean of y.
            leaves.push({
                name: `mean ${a.alongY ? yName : xName}`,
                color: a.color,
                value: shown(mu),
            });
        }
        // The joint density where the two component cuts cross, which is the z
        // the reader is pointing at when they click.
        const at = densityAt(g,
            Math.max(0, Math.min(g.nx - 1, Math.round((heldX - g.x0) / g.dx))),
            Math.max(0, Math.min(g.ny - 1, Math.round((heldY - g.y0) / g.dy))));
        where.push({ name: 'x + y', color: '#6c757d', value: shown(heldX + heldY) },
                   { name: 'density', color: '#6c757d', value: shownZ(at) });
    }

    if (mode === 'total' || mode === 'all') {
        // The line of constant total, sampled across the whole grid rather than
        // across the part in view, because the mass off the picture is what
        // decides how the total splits.
        const color = CUT_COLORS.s;
        const path = levelLine(g, total, { count: Math.max(g.nx, g.ny) });
        if (path.length >= 2) {
            const xs = path.map((p) => p[0]);
            const ys = path.map((p) => p[1]);
            const zs = path.map((p) => p[2]);
            // The path's own spacing, not the grid's: the line is cut into
            // `count` points across whatever interval it occupies, which is
            // shorter than the x axis except corner to corner, and taking the
            // grid step here inflates the conditional most at the short cuts.
            const step = xs.length > 1 ? Math.abs(xs[1] - xs[0]) : 1;
            const mass = zs.reduce((s, value) => s + value, 0) * step;
            const norm = () => zs.map((value) => (value / (mass || 1)) * k);
            const wallX = scaled(norm());
            const wallY = scaled(norm());
            // Along the anti-diagonal the joint is a function of x alone, and
            // of y alone, because y = s - x. So one curve read against the x
            // marginal is f(x | S = s) and the other is f(y | S = s), and the
            // pair is how the total splits given its size.
            out.push({
                id: 'cond-s-x', type: 'line3D', name: 'x given the total',
                data: path.map((p, i) => [p[0], yWall, onWall(wallX[i])]),
                lineStyle: { color, width: 2.4, opacity: 1 }, silent: true,
            }, {
                id: 'cond-s-y', type: 'line3D', name: 'y given the total',
                data: path.map((p, i) => [xWall, p[1], onWall(wallY[i])]),
                lineStyle: { color, width: 2.4, opacity: 1 }, silent: true,
            }, {
                id: 'cut-s', type: 'line3D', name: 'cut at the total',
                data: path.map((p) => [p[0], p[1], Math.min(zMax, height(p[2]) + hair)]),
                lineStyle: { color, width: 2.4, opacity: 1 }, silent: true,
            }, {
                id: 'trace-s', type: 'line3D', name: 'trace at the total',
                data: [[xs[0], ys[0], floorH + hair],
                       [xs[xs.length - 1], ys[ys.length - 1], floorH + hair]],
                lineStyle: { color, width: 1.6, opacity: 0.85 }, silent: true,
            });

            // kappa, on the two curves it is the mean of. k1 + k2 = s holds
            // exactly rather than approximately, because every point of the
            // path has x + y = s, so the two means are weighted averages of
            // numbers summing to s under the same weights.
            const k1 = weightedMean(xs, zs);
            const k2 = weightedMean(ys, zs);
            markMean('s-x', color, 'x', xs, wallX, k1);
            markMean('s-y', color, 'y', ys, wallY, k2);

            const inBox = (a, b) => a >= coordX(g, 0) && a <= coordX(g, g.nx - 1)
                && b >= coordY(g, 0) && b <= coordY(g, g.ny - 1);
            const onCut = (a) => Math.min(zMax, height(interpAt(xs, zs, a)) + hair * 2);
            const half = (xs[0] + ys[0]) / 2;
            out.push({
                id: 'kappa-point', type: 'scatter3D', name: 'kappa',
                symbolSize: 11,
                data: inBox(k1, k2) ? [[k1, k2, onCut(k1)]] : [],
                itemStyle: { color, opacity: 1, borderColor: '#ffffff', borderWidth: 1.5 },
                silent: true,
            }, {
                // Where the cut crosses y = x: on the diagonal by construction
                // and on the cut by construction, so it is the fixed thing
                // kappa is read against. On an exchangeable pair the two sit on
                // top of each other at every total, which is the cleanest
                // statement of what exchangeable means.
                id: 'even-split', type: 'scatter3D', name: 'even split',
                symbolSize: 9,
                data: inBox(half, half) ? [[half, half, onCut(half)]] : [],
                itemStyle: { color: 'rgba(0,0,0,0)', borderColor: color, borderWidth: 1.6 },
                silent: true,
            });
            where.push({ name: 'total cut', color, value: shown(xs[0] + ys[0]) });
            leaves.push({ name: `kappa ${xName}`, color, value: shown(k1) },
                        { name: `kappa ${yName}`, color, value: shown(k2) },
                        { name: 'even split', color, value: shown(half) });
        }
    }
    return { series: out, readout: [...where, ...leaves] };
}

/**
 * The cut series and their readout, for a rebuild that is only the cuts.
 *
 * The walk moves a cut twenty times a second, and rebuilding the whole option
 * for each of those means decoding the grid, rebuilding a hundred thousand
 * surface vertices and handing echarts a new scene to swallow, which is far
 * more work than moving three lines and is why the walk crawled. The context
 * the surface already computed rides on the option so this can rebuild the few
 * series that actually moved and merge them by id.
 *
 * Parameters
 * ----------
 * option : object
 *     A built surface option, carrying `cutContext`.
 * view : object
 *     The current view.
 *
 * Returns
 * -------
 * object or null
 *     `{series, readout}`, or null for an option that is not a surface.
 */
export function surfaceCuts(option, view) {
    const held = option && option.cutContext;
    if (!held) return null;
    return cutSeries(held.grid, held.ctx, view);
}

/** The 3-D path: one 'surface' panel, the bivariate joint in relief. */
function surfaceOption(doc, opts, view) {
    const panel = (doc && doc.panels && doc.panels[0]) || null;
    if (!panel) return null;
    const axes = Object.fromEntries((doc.axes || []).map((a) => [a.id, a]));
    const series = findSurfaceSeries(doc);
    if (!series) return null;
    const g = decodeSurfaceGrid(series.surface);

    // Whether a log height is meaningful is the Z AXIS's declaration, as the
    // scales it admits. A singleton `scales` means the axis has one honest
    // reading and the control does not apply.
    const useLog = axisScale(axes[panel.z_axis] || {}, view.log) === 'log';
    const { max, min } = zExtent(g, LOG_FLOOR);
    const zMax = useLog ? Math.ceil(Math.log10(max)) : max;
    const zMin = useLog
        ? Math.max(Math.floor(Math.log10(min)), zMax - SURFACE_DECADES)
        : 0;

    // The drawn range, and the two heights that stand below the data. The data
    // floor stays `zMin` and keeps its jobs, the color scale and the log clamp;
    // only the axis minimum and the things standing on it move down.
    const range = zMax - zMin || 1;
    const hair = range * SURFACE_HAIR;
    const zBase = zMin - range * SURFACE_BASE_DROP;
    // Half a hair, because the grid3D draws its own bottom plane at exactly the
    // axis minimum and two coplanar opaque surfaces fight.
    const floorH = zBase + hair * 0.5;

    // On the log view a zero cell rests exactly on the floor, `SURFACE_DECADES`
    // under the peak, never a hole: an FFT-built joint is full of exact zeros
    // and as holes the mesh arrives moth-eaten.
    const height = (v) => (useLog
        ? (v > LOG_FLOOR ? Math.max(zMin, Math.log10(v)) : zMin)
        : v);

    // Flat vertex list + dataShape, never the parametric form: the two axes
    // have their own grids (independently built components routinely land on
    // different bucket sizes), so there is no single step describing both.
    // The decoded grid is row major over (y, x), so cell `(c, r)` sits at
    // `(coordX(c), coordY(r))`.
    const data = [];
    for (let c = 0; c < g.nx; c++) {
        for (let r = 0; r < g.ny; r++) {
            data.push([coordX(g, c), coordY(g, r), height(g.z[r * g.nx + c])]);
        }
    }

    // The mesh, lifted a hair and capped so the lift cannot push a vertex
    // through the lid at the peak, where the surface is already at the top.
    const lift = range * SURFACE_MESH_LIFT;
    const meshAt = (c, r) => [coordX(g, c), coordY(g, r),
                              Math.min(zMax, height(g.z[r * g.nx + c]) + lift)];
    const [meshRows, meshCols] = meshPolylines(g, SURFACE_MESH_COARSE, meshAt);

    // The floor image: the same grid laid flat at the base, carrying its real
    // height in a fourth column so a second visualMap can color by it. The
    // dimensions are declared rather than inferred, which is what guarantees
    // echarts keeps that column around for `dimension: 3` to reach.
    //
    // On by default and continuous rather than stepped. A density covers its
    // whole domain, so the interesting part of the base is pressed flat against
    // the floor and the image is the only thing that says what is down there.
    const step = Math.max(1, Math.round(Math.max(g.nx, g.ny) / SURFACE_FLOOR_CELLS));
    const floorX = [];
    const floorY = [];
    for (let c = 0; c < g.nx; c += step) floorX.push(c);
    for (let r = 0; r < g.ny; r += step) floorY.push(r);
    const floorData = [];
    for (const c of floorX) {
        for (const r of floorY) {
            floorData.push([coordX(g, c), coordY(g, r), floorH,
                            height(g.z[r * g.nx + c])]);
        }
    }

    const xName = (axes[panel.x_axis] || {}).label || 'x';
    const yName = (axes[panel.y_axis] || {}).label || 'y';
    const zLabel = (axes[panel.z_axis] || {}).label || 'z';
    const zName = useLog ? `log ${zLabel}` : zLabel;
    const box = documentLayout(doc, opts.width);

    // The series, in build order, because the two visualMaps address the
    // surface and the floor by index and everything after them is optional.
    // Only the skin's chrome arrives through the override, at index 0; the
    // rest carry their style here, since a positional merge onto a list whose
    // length depends on which controls are on is a bug waiting for the first
    // reader who turns one off.
    const mesh = view.mesh !== false;
    const drawnSeries = [{
        type: 'surface',
        name: series.name,
        dataShape: [g.nx, g.ny],
        data,
    }];
    if (mesh) {
        for (const [name, points] of [['mesh along x', meshRows],
                                      ['mesh along y', meshCols]]) {
            drawnSeries.push({
                type: 'line3D',
                name,
                data: points,
                lineStyle: { color: SURFACE_MESH_COLOR, width: SURFACE_MESH_WIDTH,
                             opacity: SURFACE_MESH_OPACITY },
                silent: true,
            });
        }
    }
    const floorIdx = drawnSeries.length;
    drawnSeries.push({
        type: 'surface',
        name: 'floor',
        dimensions: ['x', 'y', 'z', 'height'],
        dataShape: [floorX.length, floorY.length],
        data: floorData,
        shading: 'color',
        itemStyle: { color: SURFACE_FLOOR_INK, opacity: SURFACE_FLOOR_OPACITY },
        wireframe: { show: false },
        silent: true,
    });

    // The wall curves. The marginals are the one thing this view can show that
    // a heat map cannot: read off a wall they are the two aggregate
    // distributions on their own. They are the library's exact marginals, off
    // the object rather than integrated from the reduced and windowed joint,
    // and they arrive as mass per display cell, so the division by the step is
    // what makes them densities comparable with each other.
    //
    // Stood a hair off the wall rather than on it. Exactly on it, a wall curve
    // is coplanar with the plane grid3D draws there, and a `line3D` is built as
    // a view-facing quad with real width, so half its geometry sits behind the
    // wall and is occluded; which half wins depends on the view direction, so
    // the curve stipples and flickers as the camera swings.
    const wallInsetX = (coordX(g, g.nx - 1) - coordX(g, 0)) * SURFACE_HAIR;
    const wallInsetY = (coordY(g, g.ny - 1) - coordY(g, 0)) * SURFACE_HAIR;
    const xWall = coordX(g, 0) + wallInsetX;
    const yWall = coordY(g, 0) + wallInsetY;
    // The wall scale, shared by the marginals and by any conditional drawn
    // beside them, which is what makes that comparison fair.
    let wallK = 1;
    if (g.marginals) {
        const peak = (a) => Math.max(...Array.from(a, Math.abs)) || 1;
        const px = peak(Array.from(g.marginals.x || [1], (m) => m / g.dx));
        const py = peak(Array.from(g.marginals.y || [1], (m) => m / g.dy));
        wallK = max * SURFACE_MARGINAL_SCALE * wallScale(px, py).scale;
    }
    if (view.marginals && g.marginals) {
        const mx = Array.from(g.marginals.x || [], (m) => m / g.dx);
        const my = Array.from(g.marginals.y || [], (m) => m / g.dy);
        // One vertical scale for both walls, with the eight-fold cap: see
        // `wallScale`. The reference is the taller curve, and the whole pair is
        // drawn at a stated fraction of the box so it reads as an inset rather
        // than as a competing surface.
        const k = wallK;
        // Anything on a wall is scaled independently of the surface, so it can
        // land outside the box at either end: a marginal is near zero at the
        // edges of its support and a tight one peaks above the joint's own
        // maximum. echarts-gl does not clip to the box, so unclamped these
        // render as lines hanging in space below the floor or above the lid.
        const onWall = (v) => Math.min(zMax, Math.max(floorH, height(v)));
        const style = { color: SURFACE_MARGINAL_COLOR, width: 2, opacity: 0.95 };
        drawnSeries.push({
            type: 'line3D',
            name: `marginal in ${xName}`,
            data: mx.map((v, c) => [coordX(g, c), yWall, onWall(v * k)]),
            lineStyle: style,
            silent: true,
        }, {
            type: 'line3D',
            name: `marginal in ${yName}`,
            data: my.map((v, r) => [xWall, coordY(g, r), onWall(v * k)]),
            lineStyle: style,
            silent: true,
        });
    }

    // The contours, on the surface and on the floor image at one set of
    // levels, which is what makes the two read as one drawing. A contour at
    // level L lies on the surface at height L by construction, so "on the
    // surface" needs no projection, only a hair of lift to keep it off the skin
    // it is lying on.
    if (view.contours) {
        const heightAt = (i, j) => height(g.z[j * g.nx + i]);
        let emitted = 0;
        for (let i = 1; i <= SURFACE_CONTOUR_LEVELS && emitted < SURFACE_CONTOUR_CAP; i++) {
            const level = zMin + (range * i) / (SURFACE_CONTOUR_LEVELS + 1);
            for (const path of contourPaths(g, level, heightAt)) {
                if (emitted >= SURFACE_CONTOUR_CAP) break;
                for (const at of [level, floorH]) {
                    emitted += 1;
                    drawnSeries.push({
                        type: 'line3D',
                        name: 'contour',
                        data: path.map((p) => [p[0], p[1], at + hair]),
                        lineStyle: { color: SURFACE_CONTOUR_COLOR,
                                     width: SURFACE_CONTOUR_WIDTH,
                                     opacity: SURFACE_CONTOUR_OPACITY },
                        silent: true,
                    });
                }
            }
        }
    }

    const cutContext = {
        height, zMax, floorH, hair, xWall, yWall, k: wallK, dataMax: max,
        xName, yName, digits: g.digits,
    };
    const cuts = cutSeries(g, cutContext, view);
    drawnSeries.push(...cuts.series);

    // Grid lines on the three walls: chrome in the ordinary sense, but the
    // control that turns them off is the reader's, so the flag is read here.
    const wallGrid = { splitLine: { show: view.wallGrid !== false } };
    const base = {
        xAxis3D: { type: 'value', name: xName, ...wallGrid },
        yAxis3D: { type: 'value', name: yName, ...wallGrid },
        // The axis reaches down past the dropped base so the box has a bottom
        // to stand the floor image on, and both ends snap to round numbers so
        // the ticks between them are round too. The data still lives between
        // zMin and zMax.
        zAxis3D: {
            type: 'value', name: zName, ...niceBox(zBase, zMax), ...wallGrid,
        },
        // Two maps, both semantic: color encodes the same variable as the
        // height, on the surface through its z and on the floor through the
        // fourth column it carries. The ramp and the placement arrive with the
        // override, and only the first draws a colorbar.
        visualMap: [
            { min: zMin, max: zMax, dimension: 2, seriesIndex: 0 },
            { min: zMin, max: zMax, dimension: 3, seriesIndex: floorIdx, show: false },
        ],
        series: drawnSeries,
    };
    // `grid` and `digits` ride in the context so the chrome can read the height
    // to the precision the encoding actually carried: seven figures on float32,
    // four on the log-quantized form, and a tooltip that says so.
    // The relief gets a taller host than the flat panel it shares a layout
    // with, and the colorbar is sized from that rather than from the square.
    const hostHeight = Math.min(SURFACE_HOST_MAX,
                                Math.round(box.hostHeight * SURFACE_HOST_SCALE));
    const ctx = { doc, view, box, xName, yName, zName, logZ: useLog, zMin, zMax,
                  grid: g, digits: g.digits, quantized: g.quantized,
                  camera: opts.camera || null,
                  hostHeight, side: box.panelW };
    const option = merge(base, resolveOverrides(opts.overrides, ctx));
    option.hostHeight = hostHeight;
    option.is3d = true;
    // What the cut is standing on, for the fixed strip above the chart, and
    // enough context for the mount to rebuild the cuts alone while the walk
    // runs. Both ride on the option because the mount holds the last one it
    // drew and neither wants the grid decoded a second time.
    option.cutReadout = cuts.readout;
    option.cutContext = { grid: g, ctx: cutContext };
    // The box in data coordinates, so the mount can turn a click into cut
    // positions and walk them without decoding the grid a second time.
    option.surfaceBox = {
        x: [coordX(g, 0), coordX(g, g.nx - 1)],
        y: [coordY(g, 0), coordY(g, g.ny - 1)],
    };
    option.readings = readings(doc);
    return option;
}
