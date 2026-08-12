// The drawing geometry, under `node --test`.
//
// The invariants `dev/plan-3d-plot.md` section 8.2 sends to the SPA, minus the
// two that depend on who owns kappa (section 4.2.1, open). What is checked here
// is what the app draws under either answer: where the window falls, that the
// sampler is linear on a rectangular grid with wildly different bucket sizes,
// that a level line really is a level line, and that the fit rule flattens
// nothing when it is on and something when it is off.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeSurfaceGrid } from '../src/charts/surface-grid.js';
import {
    columnAt, contourPaths, diagonalSegment, interpAt, levelLine, rowAt, sampler,
    wallScale, weightedMean, windowRange,
} from '../src/charts/surface-geometry.js';

/**
 * A grid whose two axes have wildly different bucket sizes.
 *
 * Deliberately 5 by 4 with `dx = 2` against `dy = 500`: the plan's fifth closed
 * decision is that the axes may differ in length and step independently, and
 * one of the four real test surfaces is 64 wide against 128 deep with a 256:1
 * bucket ratio. A square fixture would pass tests a rectangular one fails.
 */
function grid(fill) {
    const nx = 5;
    const ny = 4;
    const data = [];
    for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) data.push(fill(i, j));
    }
    return decodeSurfaceGrid({
        x0: 0, dx: 2, nx, y0: 1000, dy: 500, ny,
        z_block: { dtype: 'json', order: 'yx', data },
    });
}

/** Masses that make the density exactly `i + 10 * j` after the area divide. */
const RAMP = (cellArea) => (i, j) => (i + 10 * j) * cellArea;

test('with no declared window the whole grid is the window', () => {
    const g = grid(RAMP(1000));
    assert.deepEqual(windowRange(g), { i0: 0, i1: 4, j0: 0, j1: 3 });
});

test('a declared window becomes indices, rounded outward and clamped', () => {
    const g = grid(RAMP(1000));
    g.quantileWindow = { p: 4, x: [3, 7], y: [1600, 2400], kept: 0.9999 };
    // x: 3 falls inside cell 1 (which starts at 2) and 7 inside cell 3, and
    // both are kept whole. A window that rounded inward would drop the cell it
    // only partly covers, which at the top of an axis is the tail.
    assert.deepEqual(windowRange(g), { i0: 1, i1: 4, j0: 1, j1: 3 });
    // Bounds outside the grid clamp rather than throwing: a window wider than
    // the emitted grid is a window on the whole of it.
    g.quantileWindow = { x: [-1e9, 1e9], y: [-1e9, 1e9] };
    assert.deepEqual(windowRange(g), { i0: 0, i1: 4, j0: 0, j1: 3 });
});

test('the sampler is exact on lattice points and linear between them', () => {
    const g = grid(RAMP(1000));
    const at = sampler(g);
    // Exact where the field is defined.
    assert.equal(at(0, 1000), 0);
    assert.equal(at(4, 1000), 2);
    assert.equal(at(0, 1500), 10);
    // Halfway along each axis, on a grid whose steps differ by 250 to 1.
    assert.equal(at(1, 1000), 0.5);
    assert.equal(at(0, 1250), 5);
    assert.equal(at(1, 1250), 5.5);
    // Outside, it clamps to the edge cell rather than returning null: the
    // caller has clipped the line already, and a null mid-polyline is a hole
    // in a curve that is continuous.
    assert.equal(at(-100, 1000), 0);
    assert.equal(at(1e6, 1e6), at(8, 2500));
});

test('a level line really is a level line, on a 250 to 1 bucket ratio', () => {
    const g = grid(RAMP(1000));
    // The total ranges over [0 + 1000, 8 + 2500], so this one crosses the box.
    const line = levelLine(g, 2000, { count: 21 });
    assert.ok(line.length === 21);
    for (const [x, y] of line) {
        assert.ok(Math.abs(x + y - 2000) < 1e-9, `${x} + ${y}`);
        assert.ok(x >= 0 && x <= 8, `x ${x} outside the box`);
        assert.ok(y >= 1000 && y <= 2500, `y ${y} outside the box`);
    }
    // Evenly spaced in x, which is what makes it drawable as a polyline.
    const step = line[1][0] - line[0][0];
    for (let i = 2; i < line.length; i += 1) {
        assert.ok(Math.abs((line[i][0] - line[i - 1][0]) - step) < 1e-9);
    }
    // The main diagonal family, constant x - y, is the partner and is clipped
    // the same way.
    const anti = levelLine(g, -1500, { anti: false, count: 8 });
    for (const [x, y] of anti) assert.ok(Math.abs(x - y + 1500) < 1e-9);
});

test('a level line that misses the box is empty, not a stray segment', () => {
    const g = grid(RAMP(1000));
    assert.deepEqual(levelLine(g, 1e6, { count: 16 }), []);
    assert.deepEqual(levelLine(g, -1e6, { count: 16 }), []);
    assert.deepEqual(levelLine(g, 2000, { count: 1 }), []);
});

test('a cut is a grid row or column, snapped, never an interpolation', () => {
    const g = grid(RAMP(1000));
    const row = rowAt(g, 1600);
    assert.equal(row.index, 1);
    assert.equal(row.at, 1500);
    assert.deepEqual(Array.from(row.values), [10, 11, 12, 13, 14]);
    const col = columnAt(g, 5.4);
    assert.equal(col.index, 3);
    assert.equal(col.at, 6);
    assert.deepEqual(Array.from(col.values), [3, 13, 23, 33]);
    // Off the end, both clamp to the edge rather than reading past it.
    assert.equal(rowAt(g, -1e9).index, 0);
    assert.equal(columnAt(g, 1e9).index, 4);
});

test('the fit rule flattens nothing when it fires and something when it does not', () => {
    // Comparable peaks: one scale, the ratio honored, nothing clipped.
    const fair = wallScale(2, 1);
    assert.equal(fair.clipped, false);
    assert.equal(fair.scale, 0.5);
    assert.equal(1 * fair.scale, 0.5, 'the smaller curve keeps its true height');
    // The Indep case: peaks 13.3 apart, so the cap fires. The smaller curve
    // gets an eighth of the wall and the taller one runs off the top.
    const capped = wallScale(13.3, 1);
    assert.equal(capped.clipped, true);
    assert.ok(Math.abs(1 * capped.scale - 0.125) < 1e-12);
    assert.ok(13.3 * capped.scale > 1, 'the taller curve should leave the box');
    // Exactly at the cap it does not fire, so the rule has a side.
    assert.equal(wallScale(8, 1).clipped, false);
    assert.equal(wallScale(8.0001, 1).clipped, true);
    // Degenerate walls do not divide by zero.
    assert.equal(wallScale(0, 0).scale, 1);
    assert.equal(wallScale(3, 0).clipped, false);
});

test('a contour lies at its level, and closes around a peak', () => {
    const g = grid(RAMP(1000));
    const at = (i, j) => i + 10 * j;
    // A plane: the contour is one open path crossing the box, and every vertex
    // sits at the level by construction of the interpolation.
    const [path] = contourPaths(g, 15.5, at);
    assert.ok(path && path.length >= 2);
    for (const [x, y] of path) {
        const value = (x - g.x0) / g.dx + 10 * ((y - g.y0) / g.dy);
        assert.ok(Math.abs(value - 15.5) < 1e-9, `${x}, ${y} reads ${value}`);
    }
    // A single interior peak: the contour under it closes, so its first and
    // last vertex are the same point.
    // Strictly interior, so the ring has somewhere to close: a plateau that
    // reached the edge of the grid would leave an open path instead, which is
    // correct and is not what this case is testing.
    const peak = grid(() => 0);
    const bump = (i, j) => ((i === 2 && j === 1) ? 10
        : ((i >= 1 && i <= 3 && j >= 1 && j <= 2) ? 4 : 0));
    const rings = contourPaths(peak, 2, bump);
    assert.equal(rings.length, 1);
    const ring = rings[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
    // Levels nothing reaches produce nothing rather than a degenerate path.
    assert.deepEqual(contourPaths(g, 1e9, at), []);
});

test('a mark stands on the curve, between its drawn points', () => {
    // Putting the dot on the nearer drawn point instead moves it by up to half
    // a cell, which on a coarse grid is a visible lie about where the mean is.
    assert.equal(interpAt([0, 10], [0, 100], 2.5), 25);
    assert.equal(interpAt([0, 10, 20], [0, 100, 0], 15), 50);
    // A descending coordinate is the mirror curve on the other wall.
    assert.equal(interpAt([20, 10, 0], [0, 100, 0], 15), 50);
    // Outside the curve there is nothing to stand on, and NaN is what the
    // caller checks to emit the mark empty rather than clamped to the edge.
    assert.ok(Number.isNaN(interpAt([0, 10], [0, 100], 11)));
    assert.ok(Number.isNaN(interpAt([], [], 1)));
});

test('the walk runs on the diagonal, not on a shared fraction', () => {
    const g = grid(RAMP(1000));
    // x covers [0, 8] and y covers [1000, 2500], which do not overlap, so
    // there is no segment of y = x inside this box at all and the caller falls
    // back rather than walking a line that is not there.
    assert.equal(diagonalSegment(g), null);
    // A box the diagonal does cross: the segment is the overlap of the two
    // axis ranges, which is what makes one parameter put all three cuts
    // through one point.
    const square = decodeSurfaceGrid({
        x0: 0, dx: 10, nx: 11, y0: 40, dy: 10, ny: 11,
        z_block: { dtype: 'json', order: 'yx', data: new Array(121).fill(1) },
    });
    assert.deepEqual(diagonalSegment(square), { lo: 40, hi: 100 });
});

test('a weighted mean is the mean of the curve it is given', () => {
    assert.equal(weightedMean([1, 2, 3], [0, 1, 0]), 2);
    assert.equal(weightedMean([0, 10], [1, 1]), 5);
    assert.equal(weightedMean([0, 10], [3, 1]), 2.5);
    assert.ok(Number.isNaN(weightedMean([1, 2], [0, 0])));
});
