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
    LOG_FLOOR, axisStyle, baseOption, fade, houseStyle, lineWidth, seriesColor,
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

const AXIS_LEFT = 58;      // y-axis name + tick labels
const AXIS_BOTTOM = 46;    // x-axis name + tick labels
const PAD_RIGHT = 18;
const PAD_TOP = 26;        // the panel title strip
const GAP_X = 76;          // between side-by-side panels: the right one's axis
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
    for (const p of panels) for (const k of p.kinds || [p.kind]) kinds.add(k);
    return {
        log: axes.some((a) => drawn.has(a.id) && (a.scales || []).length > 1),
        fullRange: axes.some((a) => drawn.has(a.id) && Array.isArray(a.full_range)),
        // A paired axis is named by no panel by construction, so the pairing is
        // read off the axis rather than off what is drawn.
        returnPeriod: axes.some((a) => a.reciprocal_of),
        invert: panels.some((p) => p.invertible),
        kinds: kinds.size > 1 ? [...kinds] : [],
    };
}

/**
 * Which realization each panel takes.
 *
 * An explicit request wins where the panel declares it and is ignored where it
 * does not, because silently drawing something else is the failure the
 * capability declaration exists to prevent. `_chartdoc._realization`, with one
 * difference: a grid panel with no declared alternative falls to 'heatmap'
 * here rather than to its declared 'surface'.
 *
 * That last is the author's interim ruling of 2026-08-09, while the final 3-D
 * design is worked out separately: the flat reading of the grid is what the
 * app draws for now. It is also the only realization a machine without WebGL
 * has. When `chart_joint_surface` declares `kinds` the ruling collapses into
 * the declaration and this special case goes.
 */
function realization(panel, requested) {
    const kinds = panel.kinds || [panel.kind];
    if (requested && kinds.includes(requested)) return requested;
    if (requested === 'heatmap' && panel.kind === 'surface') return 'heatmap';
    if (panel.kind === 'surface' && !requested) return 'heatmap';
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
 * One ECharts axis option from a `ChartAxis`.
 *
 * Reads `scale` through a default, never directly: the canonical form omits a
 * field sitting at its default, so an axis drawn on linear carries no `scale`
 * key at all.
 *
 * The end labels are suppressed on every value axis. A window's endpoints are
 * exact rather than round, so they print with more decimals than their
 * neighbors and look silly beside them, and they carry nothing the neighbors
 * do not. `showMinLabel` / `showMaxLabel` drop exactly those two and leave the
 * ticks in place.
 */
function axisOption(axis, gridIndex, { scale, window, floor, formatter }) {
    const isLog = scale === 'log';
    let [min, max] = window || [];
    if (isLog && min != null && min <= 0) min = floor == null ? undefined : floor;
    return axisStyle({
        type: isLog ? 'log' : 'value',
        ...(isLog ? { logBase: 10 } : {}),
        name: axis.label || '',
        gridIndex,
        ...(min == null ? {} : { min }),
        ...(max == null ? {} : { max }),
        axisLabel: {
            fontSize: 10,
            color: '#6c757d',
            hideOverlap: true,
            showMinLabel: false,
            showMaxLabel: false,
            formatter,
        },
    });
}

/** The tick formatter for an axis, by what it measures. */
function labelFormatter(axis, scale) {
    if (axis.unit === 'probability') {
        return (v) => (v >= 0.01 || v === 0 ? String(v) : Number(v).toExponential(0));
    }
    if (axis.unit === 'return_period') return (v) => compactPeriod(v);
    if (axis.unit === 'density' || scale === 'log') {
        return (v) => (v ? Number(v).toExponential(0) : '0');
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
    // the axis it sits on, so exchanged axes exchange it too.
    const marks = [];
    for (const m of doc.marks || []) {
        if (m.panel_id !== panel.id) continue;
        const orient = inverted ? (m.orient === 'v' ? 'h' : 'v') : m.orient;
        const how = orient === 'v' ? xMap : yMap;
        let at = m.at;
        if (how) {
            [at] = returnPeriods([at], how);
            if (at == null) continue;
        }
        marks.push(markLineEntry(m, orient, at, marks.length));
    }
    if (marks.length && series.length) series[0].markLine = markLine(marks);

    const xFormatter = labelFormatter(xAxis, xScale);
    const yFormatter = labelFormatter(yAxis, yScale);
    return {
        series,
        legend,
        xAxis: axisOption(xAxis, i, {
            scale: xScale, window: xOnly, floor: xFloor, formatter: xFormatter,
        }),
        yAxis: axisOption(yAxis, i, {
            scale: yScale, window: yWindow, floor: yFloor, formatter: yFormatter,
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
 * what it reads, not which way its text runs. Marks alternate sides so a pair
 * of capital anchors near each other opens away from each other rather than
 * printing on top of one another.
 */
function markLineEntry(m, orient, at, index) {
    const align = index % 2 === 0 ? 'right' : 'left';
    return {
        [orient === 'v' ? 'xAxis' : 'yAxis']: at,
        name: m.label || '',
        lineStyle: {
            color: '#6c757d',
            type: 'dashed',
            width: 1,
            opacity: m.faint ? 0.45 : 1,
        },
        label: {
            // Inside the plot at the top, not above it: for a vertical
            // markLine "end" is the top, and outside it collides with the
            // panel title.
            position: orient === 'v' ? 'insideEndTop' : 'insideStartTop',
            align: orient === 'v' ? align : 'left',
            padding: align === 'right' ? [0, 5, 0, 0] : [0, 0, 0, 5],
        },
    };
}

/** The shared markLine chrome for one panel's entries. */
function markLine(entries) {
    return {
        symbol: 'none',
        silent: true,
        label: {
            show: true, fontSize: 10, color: '#6c757d', distance: 3,
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
 * ECharts draws a heatmap over category axes, so the grid's cell centers are
 * the categories and a cell is `[column, row, value]`. The values are display
 * cell masses, block-summed mass-preservingly upstream, so nothing is reduced
 * here.
 *
 * A log reading of the z axis draws `log10` of each cell, floored one decade
 * under the smallest mass actually present. A zero cell rests on the floor
 * rather than punching a hole: an FFT-built joint is full of exact zeros, and
 * as holes the field arrives moth-eaten.
 */
function heatmapPanel(doc, panel, i, axes, view, box) {
    const s = (doc.series || []).find((v) => v.panel_id === panel.id && v.surface);
    if (!s) return null;
    const { x, y, z } = s.surface;
    const zAxis = axes[panel.z_axis] || {};
    const useLog = axisScale(zAxis, view.log) === 'log';
    const floor = decadeFloor(z) || LOG_FLOOR;

    let max = -Infinity;
    const cells = [];
    for (let r = 0; r < y.length; r++) {
        for (let c = 0; c < x.length; c++) {
            const v = z[r][c];
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
    return {
        series: [{
            type: 'heatmap', name: s.name, data: cells,
            xAxisIndex: i, yAxisIndex: i,
            progressive: 4000, emphasis: { disabled: true },
        }],
        legend: [],
        xAxis: axisStyle({
            type: 'category', gridIndex: i, name: (axes[panel.x_axis] || {}).label || '',
            data: x, splitLine: { show: false }, axisLabel: label,
        }),
        yAxis: axisStyle({
            type: 'category', gridIndex: i, name: (axes[panel.y_axis] || {}).label || '',
            data: y, nameGap: 46, splitLine: { show: false }, axisLabel: label,
        }),
        visualMap: {
            min, max: Number.isFinite(max) ? max : min + 1, seriesIndex: null,
            calculable: true,
            left: box.left + box.width + 24,
            top: box.top + 10,
            itemHeight: Math.max(90, box.height - 60),
            textStyle: { fontSize: 10, color: '#6c757d' },
            // Sequential, white to the primary: a density is one-directional,
            // so a diverging ramp would imply a midpoint that does not exist.
            inRange: { color: ['#ffffff', fade(st.colors[0], 0.45), st.colors[0]] },
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
        legend: { ...baseOption().legend, show: legend.length > 1, data: legend },
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
            // Cross, not a bare vertical: on a Lee panel the y value *is* the
            // answer, so a horizontal tracking line reading it off the axis is
            // worth as much as the vertical one reading the probability.
            axisPointer: {
                type: 'cross',
                lineStyle: { color: '#adb5bd', width: 1, type: 'dashed' },
                crossStyle: { color: '#adb5bd', width: 1, type: 'dashed' },
                label: { show: false },
            },
            formatter: (params) => tooltipText(params, seriesPanel, realizedPanels),
        };
        // The same reading as data, for a caller that would rather write it
        // into the page than let a box follow the cursor. Not an ECharts key.
        base.readout = (params) => readoutModel(params, seriesPanel, realizedPanels);
    }

    const option = merge(base, resolveOverrides(opts.overrides, { doc, view, box }));
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

/** The 3-D path: one 'surface' panel, the bivariate joint in relief. */
function surfaceOption(doc, opts, view) {
    const panel = (doc && doc.panels && doc.panels[0]) || null;
    if (!panel) return null;
    const axes = Object.fromEntries((doc.axes || []).map((a) => [a.id, a]));
    const series = (doc.series || []).find((s) => s.surface);
    if (!series) return null;
    const { x, y, z } = series.surface;

    // Whether a log height is meaningful is the Z AXIS's declaration, as the
    // scales it admits. A singleton `scales` means the axis has one honest
    // reading and the control does not apply.
    const useLog = axisScale(axes[panel.z_axis] || {}, view.log) === 'log';
    const { max, min } = zRange(z);
    const zMin = useLog ? Math.floor(Math.log10(min)) : 0;
    const zMax = useLog ? Math.ceil(Math.log10(max)) : max;

    // Flat vertex list + dataShape, never the parametric form: the two axes
    // have their own grids (independently built components routinely land on
    // different bucket sizes), so there is no single step describing both.
    // `z[r][c]` sits at `(x[c], y[r])` per the SurfaceData contract.
    //
    // On the log view a zero cell rests exactly on the floor, one decade under
    // the smallest mass present, never a hole: an FFT-built joint is full of
    // exact zeros and as holes the mesh arrives moth-eaten.
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
    const box = documentLayout(doc, opts.width);

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
    const ctx = { doc, view, box, xName, yName, zName, logZ: useLog, zMin, zMax,
                  side: box.panelW };
    const option = merge(base, resolveOverrides(opts.overrides, ctx));
    option.hostHeight = box.hostHeight;
    option.is3d = true;
    option.readings = readings(doc);
    return option;
}
