// The relief's clicked-cell reading, under `node --test`.
//
// This moved out of `surface.js` at a131 so it could be tested at all: that
// module imports `theme.js` and so `echarts`, which will not load outside a
// browser without stubs. What it decides is arithmetic and two judgment calls
// about what a number means, both of which have a right answer.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeCellReader } from '../src/charts/cell-reading.js';

/** The usual bivariate case: a log height field off a float32 wire. */
const logged = makeCellReader({
    xName: 'X', yName: 'Y', logZ: true, zMin: -12, digits: 7,
});

test('a linear height field reads the height itself', () => {
    const read = makeCellReader({
        xName: 'A', yName: 'B', logZ: false, zMin: 0, digits: 7,
    });
    const rows = read([10, 20, 0.25]);
    assert.deepEqual(rows.map((r) => r.name), ['A', 'B', 'density']);
    assert.equal(rows[2].value, '2.500000e-1');
});

test('a log height field is raised before it is read', () => {
    // h is the base-10 log, so a drawn -3 is a density of 1e-3. Printing the
    // drawn number would be reporting the encoding rather than the model.
    assert.equal(logged([1, 2, -3])[2].value, '1.000000e-3');
});

test('a cell on the log floor reads as a bound, not as a number', () => {
    // The floor is where the encoding stopped being able to say anything. The
    // model puts nothing there, so `1e-12` would be reporting the floor as data.
    assert.equal(logged([1, 2, -12])[2].value, '< 1e-12');
    assert.equal(logged([1, 2, -13])[2].value, '< 1e-12',
                 'and below it too, not only exactly on it');
});

test('digits is the precision the wire carried, not a house default', () => {
    // The log-quantized encoding recovers about four significant figures, so
    // printing seven would be inventing three of them.
    const coarse = makeCellReader({
        xName: 'X', yName: 'Y', logZ: true, zMin: -12, digits: 4,
        quantized: true,
    });
    assert.equal(coarse([1, 2, -3])[2].value, '1.000e-3');
    assert.equal(logged([1, 2, -3])[2].value, '1.000000e-3');
});

test('a quantized encoding says so, on the density row', () => {
    const coarse = makeCellReader({
        xName: 'X', yName: 'Y', logZ: true, zMin: -12, digits: 4,
        quantized: true,
    });
    assert.equal(coarse([1, 2, -3])[2].hint, 'height is quantized');
    assert.equal(logged([1, 2, -3])[2].hint, undefined,
                 'and an exact one stays quiet');
});

test('no click yet reads as three names with blank values', () => {
    // Placeholders rather than nothing, so the strip holds its height and the
    // chart below it does not jump on the first click.
    const rows = logged(null);
    assert.deepEqual(rows.map((r) => r.name), ['X', 'Y', 'density']);
    assert.deepEqual(rows.map((r) => r.value), ['', '', '']);
});

test('a click that carried no usable point reads as placeholders too', () => {
    // echarts hands back whatever the series row held, so a click off the mesh
    // or on a masked cell can arrive short or non-finite. Neither is a reading.
    for (const bad of [[], [1, 2], [1, 2, NaN], [Infinity, 2, 3], 'nonsense']) {
        assert.deepEqual(logged(bad).map((r) => r.value), ['', '', ''],
                         `${JSON.stringify(bad)} is not a cell`);
    }
});
