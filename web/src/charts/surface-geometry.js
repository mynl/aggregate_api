// Geometry over a decoded surface grid: the window, the sampler, the lines
// drawn across the field, and the rule that decides how tall a wall curve gets
// to be.
//
// The second leaf module of `dev/plan-3d-plot.md`, and a leaf for the same
// reason as `surface-grid.js`: everything here is arithmetic over a plain
// object, so `node --test` can hold it down. Section 8.2 names exactly these as
// the SPA's test targets ("window arithmetic, level lines on rectangular grids,
// the fit rule, mesh continuity"), because they are geometry and geometry does
// not survive a rewrite unless something checks it.
//
// The one thing NOT in here is kappa, and its absence is deliberate: whether
// the app computes the conditional means or is served them is section 4.2.1,
// open with the author. What is here is the drawing, which is the app's under
// either answer.

import { coordX, coordY, densityAt } from './surface-grid.js';

/**
 * The index range of the quantile window inside the grid.
 *
 * Parameters
 * ----------
 * g : object
 *     A decoded grid.
 *
 * Returns
 * -------
 * object
 *     `{i0, i1, j0, j1}`, inclusive index bounds, clamped to the grid.
 *
 * Notes
 * -----
 * The whole grid when the document declares no window, which is both the right
 * default and the honest one: a document that says nothing about a window is
 * one whose grid *is* the window. Bounds are read in data coordinates and
 * turned into indices here rather than being carried as indices, because the
 * document states them in the units its axes are labeled in, and an index is
 * only meaningful against a lattice the consumer has already decoded.
 */
export function windowRange(g) {
    const whole = { i0: 0, i1: g.nx - 1, j0: 0, j1: g.ny - 1 };
    const w = g.quantileWindow;
    if (!w) return whole;
    // Outward: floor the low edge and ceil the high one, so the window never
    // crops a cell it partly covers. A window that rounded inward would drop a
    // cell of the tail at every depth, which is the end of the axis where the
    // interesting mass is.
    const span = (bounds, origin, step, count) => {
        if (!Array.isArray(bounds) || bounds.length < 2) return [0, count - 1];
        const clamp = (v) => Math.max(0, Math.min(count - 1, v));
        const a = clamp(Math.floor((Math.min(bounds[0], bounds[1]) - origin) / step));
        const b = clamp(Math.ceil((Math.max(bounds[0], bounds[1]) - origin) / step));
        return [a, b];
    };
    const [i0, i1] = span(w.x, g.x0, g.dx, g.nx);
    const [j0, j1] = span(w.y, g.y0, g.dy, g.ny);
    return { i0, i1, j0, j1 };
}

/**
 * A bilinear reader of the density field, in data coordinates.
 *
 * Returns a function of `(x, y)`. Outside the grid it clamps to the edge cell
 * rather than returning null, which is what a line crossing the boundary wants:
 * the caller has already clipped the line to the box, and a null in the middle
 * of a polyline is a hole in a curve that is continuous.
 *
 * Division by a constant step, which is sound only because the lattice form
 * makes a non-uniform grid inexpressible. This is the interpolation section
 * 2.2.1 is about.
 */
export function sampler(g) {
    return (xv, yv) => {
        const ux = (xv - g.x0) / g.dx;
        const uy = (yv - g.y0) / g.dy;
        const c = Math.max(0, Math.min(g.nx - 2, Math.floor(ux)));
        const r = Math.max(0, Math.min(g.ny - 2, Math.floor(uy)));
        const fx = Math.min(1, Math.max(0, ux - c));
        const fy = Math.min(1, Math.max(0, uy - r));
        return densityAt(g, c, r) * (1 - fx) * (1 - fy)
            + densityAt(g, c + 1, r) * fx * (1 - fy)
            + densityAt(g, c, r + 1) * (1 - fx) * fy
            + densityAt(g, c + 1, r + 1) * fx * fy;
    };
}

/**
 * One line of constant total, clipped to the box.
 *
 * Parameters
 * ----------
 * g : object
 *     A decoded grid.
 * level : float
 *     The value of `x + y`, or of `x - y` when `anti` is false.
 * options : object
 *     `anti` (default true) and `count`, how many points to put along it.
 *
 * Returns
 * -------
 * Array
 *     `[x, y, density]` triples, evenly spaced in x, or empty when the line
 *     misses the box entirely.
 *
 * Notes
 * -----
 * The line of constant total is the one the whole chart is about: it is the
 * event kappa conditions on. It does **not** follow grid edges once the two
 * axes have different bucket sizes, which is why it is sampled rather than
 * walked, and why the mesh that matches it is one series per rung rather than
 * one polyline.
 *
 * The x interval where both coordinates are inside the box is the intersection
 * of two ranges and nothing more, because the other coordinate is monotone in x
 * either way. Ported from the prototype's `levelLine`.
 */
export function levelLine(g, level, { anti = true, count = 64 } = {}) {
    const xLo = coordX(g, 0);
    const xHi = coordX(g, g.nx - 1);
    const yLo = coordY(g, 0);
    const yHi = coordY(g, g.ny - 1);
    const yOf = (xv) => (anti ? level - xv : xv - level);
    const a = anti ? level - yHi : yLo + level;
    const b = anti ? level - yLo : yHi + level;
    const lo = Math.max(xLo, Math.min(a, b));
    const hi = Math.min(xHi, Math.max(a, b));
    if (!(hi > lo) || count < 2) return [];
    const at = sampler(g);
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const xv = lo + ((hi - lo) * i) / (count - 1);
        const yv = yOf(xv);
        out.push([xv, yv, at(xv, yv)]);
    }
    return out;
}

/**
 * The grid row nearest a y coordinate, as a curve over x.
 *
 * The shape of `f(x, y0)`, which is the conditional `f(x | Y = y0)` up to the
 * constant `f_Y(y0)`. Drawn against the marginal on the same wall, the gap
 * between the two curves is the dependence, so the normalizer matters and is
 * the caller's to supply: dividing by a marginal integrated off a windowed
 * joint is the arithmetic 4.2.1 is about.
 *
 * A row rather than an interpolation between rows. The cut is placed by a click
 * that already snapped to a cell, and interpolating between two rows would draw
 * a curve the model never says anything about.
 */
export function rowAt(g, yValue) {
    const j = Math.max(0, Math.min(g.ny - 1, Math.round((yValue - g.y0) / g.dy)));
    const values = new Float64Array(g.nx);
    for (let i = 0; i < g.nx; i += 1) values[i] = densityAt(g, i, j);
    return { index: j, at: coordY(g, j), values };
}

/** The grid column nearest an x coordinate, as a curve over y. See :func:`rowAt`. */
export function columnAt(g, xValue) {
    const i = Math.max(0, Math.min(g.nx - 1, Math.round((xValue - g.x0) / g.dx)));
    const values = new Float64Array(g.ny);
    for (let j = 0; j < g.ny; j += 1) values[j] = densityAt(g, i, j);
    return { index: i, at: coordX(g, i), values };
}

/**
 * One vertical scale for both walls, and the cap that keeps the smaller
 * curve legible.
 *
 * Parameters
 * ----------
 * peakX, peakY : float
 *     The tallest value each wall has to draw.
 * cap : float
 *     How many times shorter the smaller curve may be drawn before the scale
 *     stops honoring the ratio. 8 by default.
 *
 * Returns
 * -------
 * object
 *     `{scale, clipped}`. Multiply a value by `scale` for a wall of height 1;
 *     `clipped` says the taller curve now runs off the top.
 *
 * Notes
 * -----
 * One scale for **both** walls, not one each. Scaling each marginal to its own
 * peak draws them at identical heights every time, whatever the two
 * distributions are, and a reader takes equal heights to mean something. Both
 * axes are losses in the same currency, so the two densities are directly
 * comparable and the height difference is information.
 *
 * The cap is the exception that keeps that from being useless. Past a factor of
 * eight the smaller curve is a line on the floor, which says nothing, so it is
 * given an eighth of the wall and the larger one runs off the top and is
 * clipped against the lid. A curve visibly leaving the box says "taller than
 * fits"; a curve lying on the floor says nothing at all.
 */
export function wallScale(peakX, peakY, cap = 8) {
    const big = Math.max(peakX, peakY);
    const small = Math.min(peakX, peakY);
    if (!(big > 0)) return { scale: 1, clipped: false };
    if (!(small > 0) || big / small <= cap) return { scale: 1 / big, clipped: false };
    return { scale: 1 / (cap * small), clipped: true };
}

/**
 * The mean of a set of values against their coordinates, weighted by them.
 *
 * Generic, and used for whatever the caller is entitled to compute: the mean of
 * a curve it holds in full. Whether the chart's *marks* come from this or from
 * the document is section 4.2.1, open. On a cut that runs off the window, this
 * is the wrong tool and the served number is the right one.
 */
export function weightedMean(coords, weights) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < weights.length; i += 1) {
        num += coords[i] * weights[i];
        den += weights[i];
    }
    return den > 0 ? num / den : NaN;
}
