// The color stretch: gamma and log remapping of the shared viridis ramp.
//
// A joint density's range is the product of two marginal ranges, so it spans
// many decades, and a linear color map spends its whole ramp on the peak: the
// body of the distribution lands in the bottom percent of the ramp and renders
// as one undifferentiated dark field. The stretch fixes the *coloring* only.
// The density values, the tooltips and the colorbar's value axis are never
// transformed; the mapping from value to color is.
//
// ECharts has no analogue of a matplotlib `Normalize`, so the stretch is
// realized entirely as a precomputed ramp: a dense stop list sampled from the
// interpolated viridis at stretched positions and fed to `inRange.color`.
// ECharts spaces the stops evenly over the value range, so the composite
// mapping is exactly the stretch, and the colorbar shows true values on its
// axis against a visibly warped ramp, which is the honest presentation: the
// bar itself documents the nonlinearity.
//
// A leaf module on purpose, like `cell-reading.js`: no DOM, no echarts, so the
// node test runner can exercise it directly. `theme.js` re-exports `VIRIDIS`
// from here, so the ramp still exists in exactly one place.
// See `dev/plan-color-stretch.md`.

/**
 * Viridis, the ramp both readings of a z grid are drawn in.
 *
 * Shared by the relief and the flat image because they are two drawings of one
 * grid, and a reader who flips between them is entitled to see the same color
 * mean the same height. It is not the house ramp: that one runs white to a
 * single hue, and under a shaded surface the lit and unlit faces of one height
 * then read as two different values. Perceptually uniform and colorblind safe
 * are the usual arguments and they hold here too.
 */
export const VIRIDIS = ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'];

/**
 * The default gamma exponent, and the joint surface's default stretch.
 *
 * On log axes the gamma map is linear with slope gamma, so gamma stretching is
 * contrast reduction by that factor in log space: roughly 1 / gamma times more
 * decades of support become visible. 0.35 is the field-tested value from the
 * `aggregate` art renders.
 */
export const STRETCH_GAMMA = 0.35;

/**
 * Decades of support the log stretch keeps below the peak.
 *
 * The log map needs a floor because every compactly supported density is full
 * of exact zeros and FFT fuzz, and `log(0)` has nowhere to go. Values more
 * than this many decades under the peak take the bottom of the ramp.
 */
export const STRETCH_DECADES = 6;

// Stops in a stretched ramp. Dense enough that the piecewise-linear
// interpolation between evenly spaced stops tracks the warp; the plan's
// ruling, and ample because the six-stop viridis is itself smooth.
const STRETCH_STOPS = 33;

/**
 * A color off an evenly spaced hex ramp, at `t` in [0, 1], as hex.
 *
 * Parameters
 * ----------
 * stops : Array
 *     Hex stops, `['#440154', ...]`, evenly spaced.
 * t : float
 *     Clamped to [0, 1].
 *
 * Returns
 * -------
 * str
 *     `#rrggbb`. Interpolated per channel in sRGB, which is what ECharts does
 *     between the stops it is handed, so sampling here and interpolating there
 *     agree.
 */
export function rampAt(stops, t) {
    const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(u));
    const f = u - i;
    const rgb = (hex) => {
        const v = parseInt(String(hex).replace('#', ''), 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    };
    const a = rgb(stops[i]);
    const b = rgb(stops[i + 1]);
    const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
    return `#${[0, 1, 2].map((k) => hex2(a[k] + (b[k] - a[k]) * f)).join('')}`;
}

/**
 * Where a stretched ramp samples the base ramp, for a stop at fraction `u`.
 *
 * The forward map of the stretch: `u ** gamma` for gamma, a floored log map
 * for `'log'`, identity for linear. Endpoints are fixed under every stretch,
 * so the peak and the zero keep their colors and only what is between moves.
 */
function stretchAt(u, stretch, decades) {
    if (stretch === 'log') {
        return u <= 0 ? 0 : Math.max(0, 1 + Math.log10(u) / decades);
    }
    if (typeof stretch === 'number') return u ** stretch;
    return u;
}

/**
 * The inverse of the stretch: which value fraction lands at ramp fraction `u`.
 *
 * Contour levels are placed equally spaced in *stretched* space, so the
 * contours and the colors agree about where the visual structure is. That
 * means running the color map backwards: the level for ramp fraction `u` sits
 * at `u ** (1 / gamma)` of the value range for gamma, and geometrically for
 * log.
 */
function stretchInverse(u, stretch, decades) {
    if (stretch === 'log') return 10 ** (decades * (u - 1));
    if (typeof stretch === 'number') return u ** (1 / stretch);
    return u;
}

/**
 * The color stops for a stretch, ready for `inRange.color`.
 *
 * Parameters
 * ----------
 * stretch : null, float, or 'log'
 *     `null` for linear, a gamma exponent in (0, 1) for the gamma stretch, or
 *     `'log'` for the floored log stretch.
 * options : object
 *     `stops`, the stop count for a stretched ramp, and `decades`, how many
 *     decades below the peak the log stretch keeps.
 *
 * Returns
 * -------
 * Array
 *     Hex stops for ECharts to space evenly over the value range. Linear
 *     returns the plain six-stop viridis, so switching a stretch on and back
 *     off is lossless.
 */
export function stretchedRamp(stretch, { stops = STRETCH_STOPS,
                                         decades = STRETCH_DECADES } = {}) {
    if (stretch === null || stretch === undefined || stretch === 1) {
        return VIRIDIS.slice();
    }
    const out = new Array(stops);
    for (let i = 0; i < stops; i++) {
        out[i] = rampAt(VIRIDIS, stretchAt(i / (stops - 1), stretch, decades));
    }
    return out;
}

/**
 * Contour levels matched to the active stretch.
 *
 * Parameters
 * ----------
 * zMin, zMax : float
 *     The drawn value range, the same two numbers the visualMap is given.
 * count : int
 *     Interior levels wanted; endpoints are never levels.
 * stretch : null, float, or 'log'
 *     As `stretchedRamp`.
 * options : object
 *     `decades`, as `stretchedRamp`.
 *
 * Returns
 * -------
 * Array
 *     `count` strictly increasing levels in (zMin, zMax). Linear reproduces
 *     the evenly spaced ladder the charts drew before the stretch existed.
 */
export function contourLevels(zMin, zMax, count, stretch = null,
                              { decades = STRETCH_DECADES } = {}) {
    const range = zMax - zMin;
    if (!(range > 0) || !(count > 0)) return [];
    const out = new Array(count);
    for (let k = 1; k <= count; k++) {
        out[k - 1] = zMin + range * stretchInverse(k / (count + 1), stretch, decades);
    }
    return out;
}

/** A held or hinted stretch, normalized to `null`, a gamma in (0, 1), or 'log'. */
function normalStretch(value) {
    if (value === 'linear') return null;
    if (value === 'gamma') return STRETCH_GAMMA;
    if (value === 'log') return 'log';
    if (typeof value === 'number' && value > 0 && value < 1) return value;
    if (value === 1) return null;
    return undefined;
}

/**
 * Resolve which stretch a grid panel draws with.
 *
 * Parameters
 * ----------
 * context : object
 *     `held`, the reader's per-panel choice (`'linear'`, `'gamma'`, `'log'`,
 *     or null for no choice); `hint`, the document's optional per-panel
 *     `stretch` field (same values, or a gamma exponent); `relief`, whether
 *     the panel is realized as the 3-D surface; `logZ`, whether the drawn z is
 *     already on log.
 *
 * Returns
 * -------
 * null, float, or 'log'
 *     What `stretchedRamp` and `contourLevels` take.
 *
 * Notes
 * -----
 * The order is the reader, then the document, then the realization. The
 * relief defaults to gamma because the joint surface is a density and the
 * linear reading of one is nearly useless; a flat panel defaults to linear
 * because its z is not always a density (kappa and quantile surfaces flow
 * through the same panel kind) and a silent nonlinear default there would
 * mislead. When the z axis is already on log the default drops back to
 * linear: the log reading is itself the stretch of the coloring, and stacking
 * gamma on top of it by default would be a double stretch nobody ruled on. An
 * explicit choice by the reader is honored regardless.
 */
export function effectiveStretch({ held = null, hint = null,
                                   relief = false, logZ = false } = {}) {
    const chosen = normalStretch(held);
    if (chosen !== undefined && held !== null && held !== undefined) return chosen;
    if (logZ) return null;
    const hinted = normalStretch(hint);
    if (hinted !== undefined && hint !== null && hint !== undefined) return hinted;
    return relief ? STRETCH_GAMMA : null;
}

/** The mode name a stretch value reads as, for the control's label. */
export function stretchMode(stretch) {
    if (stretch === 'log') return 'log';
    if (typeof stretch === 'number' && stretch > 0 && stretch < 1) return 'gamma';
    return 'linear';
}
