// The surface decode, under `node --test`.
//
// The first tests the SPA has ever had, and the reason is `dev/plan-3d-plot.md`
// section 8.3: six of that plan's invariants are geometry, and geometry does
// not survive a rewrite unless something checks it. The runner is node's own,
// so this costs one line in `package.json` and no dependency; the condition is
// that what is tested imports cleanly in node, which is why `surface-grid.js`
// is a leaf module and the adapter that draws with it is not tested here.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    centerX, centerY, coordX, coordY, decodeSurfaceGrid, findSurfaceSeries,
    xCoords, yCoords, zExtent,
} from '../src/charts/surface-grid.js';

/** Base64 of a typed array's bytes, which is what the emitter writes. */
function b64(typed) {
    return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)
        .toString('base64');
}

/** A 3 by 2 grid of masses, row major over (y, x), summing to 1. */
const MASS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.25];

/** The lattice those masses live on: dx 2, dy 10, so a cell area of 20. */
const LATTICE = { x0: 0, dx: 2, nx: 3, y0: 100, dy: 10, ny: 2 };

test('the legacy array form decodes, and the values become density', () => {
    const g = decodeSurfaceGrid({
        x: [0, 2, 4],
        y: [100, 110],
        z: [[0.05, 0.10, 0.15], [0.20, 0.25, 0.25]],
    });
    assert.equal(g.nx, 3);
    assert.equal(g.ny, 2);
    assert.equal(g.dx, 2);
    assert.equal(g.dy, 10);
    assert.equal(g.cellArea, 20);
    // Mass is what the wire carries and what the reduction preserves; density
    // is what everything downstream reads, and the division happens once.
    assert.ok(Math.abs(g.totalMass - 1) < 1e-12);
    assert.ok(Math.abs(g.z[0] - 0.05 / 20) < 1e-15);
    assert.ok(Math.abs(g.z[5] - 0.25 / 20) < 1e-15);
});

test('float32 round trips to seven figures', () => {
    const g = decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'f32b64', order: 'yx', data: b64(Float32Array.from(MASS)) },
    });
    assert.equal(g.dtype, 'f32b64');
    assert.equal(g.digits, 7);
    assert.equal(g.quantized, false);
    MASS.forEach((m, i) => {
        const density = m / 20;
        assert.ok(Math.abs(g.z[i] - density) / density < 1e-7,
                  `cell ${i}: ${g.z[i]} against ${density}`);
    });
});

test('float64 round trips exactly', () => {
    const g = decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'f64b64', order: 'yx', data: b64(Float64Array.from(MASS)) },
    });
    assert.equal(g.digits, 15);
    MASS.forEach((m, i) => assert.equal(g.z[i], m / 20));
});

test('the log-quantized form round trips to its declared 2.1e-4', () => {
    // The emitter's arithmetic, inverted: code = round((log10(v / peak) +
    // decades) / decades * 65535). Written out rather than imported because
    // this test is the contract's other end, and a shared helper would let
    // both ends be wrong together.
    const peak = Math.max(...MASS);
    const decades = 12;
    const codes = Uint16Array.from(MASS.map((v) => {
        const rel = Math.log10(v / peak);
        return Math.max(0, Math.min(65535,
            Math.round(((rel + decades) / decades) * 65535)));
    }));
    const g = decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'u16log12b64', order: 'yx', data: b64(codes), peak, decades },
    });
    assert.equal(g.digits, 4);
    assert.equal(g.quantized, true);
    MASS.forEach((m, i) => {
        const density = m / 20;
        assert.ok(Math.abs(g.z[i] - density) / density < 2.1e-4,
                  `cell ${i}: ${g.z[i]} against ${density}`);
    });
});

test('the json block decodes nested and flat alike', () => {
    const nested = decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'json', order: 'yx', data: [MASS.slice(0, 3), MASS.slice(3)] },
    });
    const flat = decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'json', order: 'yx', data: MASS },
    });
    assert.deepEqual(Array.from(nested.z), Array.from(flat.z));
});

test('an xy-ordered block is transposed once, at the decode', () => {
    // The same six masses stored column major. Exactly one orientation exists
    // below the decode, so nothing downstream carries an order flag.
    const columnMajor = [MASS[0], MASS[3], MASS[1], MASS[4], MASS[2], MASS[5]];
    const g = decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'f64b64', order: 'xy', data: b64(Float64Array.from(columnMajor)) },
    });
    assert.deepEqual(Array.from(g.z), MASS.map((m) => m / 20));
});

test('the declared lattice wins over the phase one arrays beside it', () => {
    // Phase one emits both. The arrays here are deliberately wrong, so a
    // decode that preferred them would be visible rather than merely equal.
    const g = decodeSurfaceGrid({
        ...LATTICE,
        x: [9, 9, 9],
        y: [9, 9],
        z: [[9, 9, 9], [9, 9, 9]],
        z_block: { dtype: 'f64b64', order: 'yx', data: b64(Float64Array.from(MASS)) },
    });
    assert.equal(g.x0, 0);
    assert.equal(g.dx, 2);
    assert.deepEqual(Array.from(g.z), MASS.map((m) => m / 20));
});

test('an encoded object found under z is accepted, as 2.4.1 allows', () => {
    const g = decodeSurfaceGrid({
        ...LATTICE,
        z: { dtype: 'f64b64', order: 'yx', data: b64(Float64Array.from(MASS)) },
    });
    assert.deepEqual(Array.from(g.z), MASS.map((m) => m / 20));
});

test('a grid that does not match its lattice throws rather than draws', () => {
    assert.throws(() => decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'f64b64', order: 'yx', data: b64(Float64Array.from([1, 2, 3])) },
    }), /3 values for a 3 by 2 grid/);
    assert.throws(() => decodeSurfaceGrid({ z: [[1, 2]] }), /no x lattice/);
    assert.throws(() => decodeSurfaceGrid({
        ...LATTICE, z_block: { dtype: 'f80b64', data: 'AA==' },
    }), /unknown surface dtype/);
});

test('edge says what a coordinate names, and centers follow it', () => {
    const left = decodeSurfaceGrid({
        ...LATTICE, edge: 'left',
        z_block: { dtype: 'f64b64', data: b64(Float64Array.from(MASS)) },
    });
    const mid = decodeSurfaceGrid({
        ...LATTICE, edge: 'mid',
        z_block: { dtype: 'f64b64', data: b64(Float64Array.from(MASS)) },
    });
    // The coordinate itself is what the document said, either way.
    assert.equal(coordX(left, 1), 2);
    assert.equal(coordX(mid, 1), 2);
    // The center is half a step up from a left edge and is the coordinate
    // itself from a midpoint. This is the arithmetic every mean is taken
    // against, and getting it wrong is a bias of half a bucket.
    assert.equal(centerX(left, 1), 3);
    assert.equal(centerX(mid, 1), 2);
    assert.equal(centerY(left, 0), 105);
    assert.equal(centerY(mid, 0), 100);
    // A document that says nothing is read as left edges, the convention the
    // fine lattice is already in.
    assert.equal(decodeSurfaceGrid({ ...LATTICE, z_block: {
        dtype: 'f64b64', data: b64(Float64Array.from(MASS)) } }).edge, 'left');
});

test('the coordinate arrays a category axis wants are the lattice, walked', () => {
    const g = decodeSurfaceGrid({
        ...LATTICE, z_block: { dtype: 'f64b64', data: b64(Float64Array.from(MASS)) },
    });
    assert.deepEqual(xCoords(g), [0, 2, 4]);
    assert.deepEqual(yCoords(g), [100, 110]);
    assert.equal(coordY(g, 1), 110);
});

test('the drawn extent ignores dust but keeps the smallest real value', () => {
    const g = decodeSurfaceGrid({
        ...LATTICE,
        z_block: { dtype: 'f64b64', data: b64(Float64Array.from(
            [0, 1e-18, 0.2, 0.3, 0.25, 0.25])) },
    });
    // Densities, so each is the mass over the cell area of 20.
    const extent = zExtent(g, 1e-15);
    assert.ok(Math.abs(extent.max - 0.3 / 20) < 1e-15);
    assert.ok(Math.abs(extent.min - 0.2 / 20) < 1e-15);
    // With no floor the dust is the minimum, which is why the caller passes one.
    assert.ok(zExtent(g).min < 1e-18);
});

test('the surface series is found by panel, or by being the only one', () => {
    const doc = { series: [
        { name: 'curve', panel_id: 'a' },
        { name: 'joint', panel_id: 'b', surface: { ...LATTICE } },
    ] };
    assert.equal(findSurfaceSeries(doc).name, 'joint');
    assert.equal(findSurfaceSeries(doc, 'b').name, 'joint');
    assert.equal(findSurfaceSeries(doc, 'a'), null);
    assert.equal(findSurfaceSeries({}), null);
});

test('both drawing paths read the grid through the one decode', () => {
    // Plan 8.1, "SPA 4.1": one shared helper serves `surfaceOption` and
    // `heatmapPanel`, and neither destructures `series.surface` itself. Two
    // readers of one wire format drift, and this is the only cheap way to say
    // so about a module that cannot be imported outside a browser.
    const adapter = readFileSync(
        fileURLToPath(new URL('../src/charts/chartdoc-to-echarts.js', import.meta.url)),
        'utf8');
    const decodes = adapter.match(/decodeSurfaceGrid\(/g) || [];
    assert.equal(decodes.length, 2, 'the two call sites, and only those');
    assert.equal(/=\s*\w+\.surface\b/.test(adapter), false,
                 'the adapter destructures series.surface somewhere');
});
