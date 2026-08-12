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
 * Marching squares over one level of a height field, sewn into polylines.
 *
 * Parameters
 * ----------
 * g : object
 *     A decoded grid, read for its lattice.
 * level : float
 *     The height to trace.
 * heightAt : function
 *     `(i, j)` to the drawn height of that cell, so the caller decides whether
 *     the contour is of the density or of its log. A contour of `log f` at
 *     level L is the same curve as a contour of `f` at `10 ** L`, but tracing
 *     the drawn height is what makes the line lie *on* the drawn surface.
 *
 * Returns
 * -------
 * Array
 *     Polylines, each an array of `[x, y]` pairs in data coordinates. Loose
 *     segments are chained because a `line3D` series is one polyline and
 *     marching squares produces an unordered heap of two-point pieces.
 *
 * Notes
 * -----
 * The two saddle cases are resolved on the average of the four corners rather
 * than picked arbitrarily, which is what keeps a contour from crossing itself
 * where two modes nearly touch. Ported from the prototype's `isoSegments` and
 * `chainSegments`.
 */
export function contourPaths(g, level, heightAt) {
    const segs = [];
    const cut = (va, vb, pa, pb) => {
        const t = (level - va) / (vb - va);
        return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])];
    };
    for (let j = 0; j < g.ny - 1; j += 1) {
        for (let i = 0; i < g.nx - 1; i += 1) {
            const v = [heightAt(i, j), heightAt(i + 1, j),
                       heightAt(i + 1, j + 1), heightAt(i, j + 1)];
            const p = [[coordX(g, i), coordY(g, j)], [coordX(g, i + 1), coordY(g, j)],
                       [coordX(g, i + 1), coordY(g, j + 1)], [coordX(g, i), coordY(g, j + 1)]];
            let idx = 0;
            for (let k = 0; k < 4; k += 1) if (v[k] > level) idx |= (1 << k);
            if (idx === 0 || idx === 15) continue;
            const e = [];
            for (let k = 0; k < 4; k += 1) {
                const a = k;
                const b = (k + 1) % 4;
                e[k] = ((v[a] > level) !== (v[b] > level)) ? cut(v[a], v[b], p[a], p[b]) : null;
            }
            const join = (a, b) => { if (e[a] && e[b]) segs.push([e[a], e[b]]); };
            switch (idx) {
            case 1: case 14: join(3, 0); break;
            case 2: case 13: join(0, 1); break;
            case 4: case 11: join(1, 2); break;
            case 8: case 7: join(2, 3); break;
            case 3: case 12: join(3, 1); break;
            case 6: case 9: join(0, 2); break;
            case 5: case 10: {
                const centerAbove = (v[0] + v[1] + v[2] + v[3]) / 4 > level;
                if (((idx & 1) !== 0) === centerAbove) { join(0, 1); join(2, 3); }
                else { join(3, 0); join(1, 2); }
                break;
            }
            default: break;
            }
        }
    }
    return chain(segs, Math.min(Math.abs(g.dx), Math.abs(g.dy)) * 1e-4 || 1e-9);
}

/** Sew loose two-point segments into polylines, joining ends within `tol`. */
function chain(segs, tol) {
    const key = (p) => `${Math.round(p[0] / tol)}:${Math.round(p[1] / tol)}`;
    const at = new Map();
    segs.forEach((s, i) => {
        for (const p of s) {
            const k = key(p);
            if (!at.has(k)) at.set(k, []);
            at.get(k).push(i);
        }
    });
    const used = new Array(segs.length).fill(false);
    const out = [];
    const grow = (path, takeEnd) => {
        for (let guard = 0; guard < segs.length; guard += 1) {
            const tip = takeEnd ? path[path.length - 1] : path[0];
            const k = key(tip);
            const j = (at.get(k) || []).find((i) => !used[i]);
            if (j == null) return;
            used[j] = true;
            const other = key(segs[j][0]) === k ? segs[j][1] : segs[j][0];
            if (takeEnd) path.push(other); else path.unshift(other);
        }
    };
    for (let i = 0; i < segs.length; i += 1) {
        if (used[i]) continue;
        used[i] = true;
        const path = [segs[i][0], segs[i][1]];
        grow(path, true);
        grow(path, false);
        if (path.length >= 3) out.push(path);
    }
    return out;
}

/**
 * Linear interpolation of a curve given as coordinates and values.
 *
 * Used to stand a mark on the curve it is the mean of: the mean lands between
 * two drawn points nearly always, and putting the dot on the nearer one moves
 * it by up to half a cell, which on a coarse grid is visible and is a lie about
 * where the mean is.
 */
export function interpAt(coords, vals, at) {
    const n = coords.length;
    if (!n) return NaN;
    const rising = coords[n - 1] >= coords[0];
    const lo = rising ? coords[0] : coords[n - 1];
    const hi = rising ? coords[n - 1] : coords[0];
    if (!(at >= lo && at <= hi)) return NaN;
    for (let i = 0; i < n - 1; i += 1) {
        const a = coords[i];
        const b = coords[i + 1];
        if ((at >= a && at <= b) || (at <= a && at >= b)) {
            const t = b === a ? 0 : (at - a) / (b - a);
            return vals[i] + t * (vals[i + 1] - vals[i]);
        }
    }
    return vals[n - 1];
}

/**
 * The segment of the line `y = x` that lies inside the grid's box.
 *
 * The walk is parameterized on this and not by a shared fraction of each axis.
 * Setting each cut to the same fraction of its own range does not put the three
 * through one point, because the two axes cover different intervals and the
 * total is parameterized by a third range again: three cuts that are supposed
 * to cross at the point being walked to, drifting apart. Take `v` here and hold
 * x at `v`, y at `v`, and the total at `2v`.
 *
 * Returns `null` when the two axes do not overlap at all, which is legitimate:
 * one of the test surfaces is signed and another starts at 48.
 */
export function diagonalSegment(g) {
    const lo = Math.max(coordX(g, 0), coordY(g, 0));
    const hi = Math.min(coordX(g, g.nx - 1), coordY(g, g.ny - 1));
    return hi > lo ? { lo, hi } : null;
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
