// The composed coordinate maps, under `node --test`.
//
// These exist because the arithmetic they cover is the whole of the reflected
// reading, and it was untestable while it lived in `chartdoc-to-echarts.js`,
// which will not import outside a browser. `dev/plan-chart-reflect.md` A5.
//
// The case worth naming: reflecting the coordinate and exchanging 'complement'
// with 'reciprocal' are two spellings of one operation, so a renderer that
// does both cancels itself and the reflection silently stops acting wherever
// the return period is on. The last test here is the guard against exactly
// that, and it would have caught it on paper.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readingMap, returnPeriods } from '../src/charts/reading-map.js';

/** Values close enough, elementwise, nulls matching. */
function near(got, want, msg) {
    assert.equal(got.length, want.length, msg);
    got.forEach((v, i) => {
        if (want[i] == null || v == null) return assert.equal(v, want[i], msg);
        return assert.ok(Math.abs(v - want[i]) < 1e-12, `${msg}: ${v} vs ${want[i]}`);
    });
}

test('neither reading is the identity function, it is null', () => {
    // The caller still has to tell "a map is active" from "no map", because
    // two behaviors in the panel realizer are specific to a diverging T.
    assert.equal(readingMap(false, null), null);
    assert.ok(typeof readingMap(true, null) === 'function');
    assert.ok(typeof readingMap(false, 'complement') === 'function');
});

test('a reflection mirrors the values and keeps the gaps', () => {
    const map = readingMap(true, null);
    near(map([0, 0.25, 0.5, 0.995, 1]), [1, 0.75, 0.5, 0.005, 0], 'mirrored');
    assert.deepEqual(map([null]), [null]);
    // Order is untouched: the step drawing is defined on the order of the
    // points given, so the ladder mirrors with the curve for free.
    assert.equal(map([0, 1])[0], 1);
});

test('a return period alone is the document map, unchanged', () => {
    const complement = readingMap(false, 'complement');
    const reciprocal = readingMap(false, 'reciprocal');
    near(complement([0.99, 0.995]), [100, 200], 'complement');
    near(reciprocal([0.01, 0.005]), [100, 200], 'reciprocal');
    // Still the same function the adapter used before it was composed.
    near(complement([0.99]), returnPeriods([0.99], 'complement'), 'unchanged');
});

test('a diverging or degenerate period becomes a gap', () => {
    const complement = readingMap(false, 'complement');
    assert.deepEqual(complement([1]), [null]);      // T is infinite
    assert.deepEqual(complement([null]), [null]);
    assert.deepEqual(readingMap(false, 'reciprocal')([0]), [null]);
    // And through a reflection, which is how the far end of a Lee panel
    // arrives once it is mirrored.
    assert.deepEqual(readingMap(true, 'reciprocal')([1]), [null]);
});

test('reflect opens out the other end of a loss chart', () => {
    // `agg`: the map is 'complement', so the period alone diverges as p
    // approaches 1 and stretches the right end of the curve. Reflected, it
    // diverges as p approaches 0 and stretches the left.
    const alone = readingMap(false, 'complement');
    const both = readingMap(true, 'complement');
    near(alone([0.99]), [100], 'right end');
    near(both([0.99]), [1 / 0.99], 'left end');
    near(both([0.01]), [100], 'left end, deep');
});

test('reflect swaps the shortfall for the upside on a payoff', () => {
    // `pnl`: the map is 'reciprocal' because the adverse tail is the low one,
    // so the period alone reads the shortfall. Reflected it reads the upside,
    // which is the picture unreachable any other way.
    const alone = readingMap(false, 'reciprocal');
    const both = readingMap(true, 'reciprocal');
    near(alone([0.01]), [100], 'shortfall');
    near(both([0.99]), [100], 'upside');
});

test('the two readings never draw the same curve', () => {
    // The regression guard. A composition that cancels is the bug, and it
    // presents as `reflect` quietly doing nothing once `return period` is on.
    const ps = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
    for (const how of ['complement', 'reciprocal']) {
        const alone = readingMap(false, how)(ps);
        const both = readingMap(true, how)(ps);
        assert.notDeepEqual(both, alone, `${how} cancels`);
    }
});
