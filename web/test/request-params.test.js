// The chart request parameters, under `node --test`.
//
// These exist because the decision they cover was untestable when it lived
// against DOM state, and it broke every 2-D chart in the app for want of three
// lines that could have been checked here. `dev/plan-plot-2d-fix.md` F3.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    chartParamsFor, migrateChartView, windowsWith,
} from '../src/charts/request-params.js';

test('a view holding no windows asks for nothing', () => {
    assert.deepEqual(chartParamsFor({ windows: {} }, 'agg'), {});
    // The library's default is always a valid request, so a view that is
    // missing the map, or is not there at all, is not an error.
    assert.deepEqual(chartParamsFor({}, 'agg'), {});
    assert.deepEqual(chartParamsFor(null, 'agg'), {});
});

test('a window rides only on the chart it was set on', () => {
    // The whole bug, in one assertion: a depth turned on the surface must not
    // reach `port`, whose emitter takes none of the grid options and answers
    // 422 to any of them.
    const view = { windows: { joint_surface: 8 } };
    assert.deepEqual(chartParamsFor(view, 'joint_surface'), { window: 8 });
    for (const chart of ['agg', 'port', 'severity', 'distortion', 'reins']) {
        assert.deepEqual(chartParamsFor(view, chart), {});
    }
});

test('zero is a depth, not an absence', () => {
    // 0 keeps the whole grid, which is a thing a reader can mean, so the test
    // is finiteness. A truthiness test would silently drop it.
    assert.deepEqual(chartParamsFor({ windows: { joint_surface: 0 } }, 'joint_surface'),
                     { window: 0 });
});

test('a null or a non-number in the map asks for nothing', () => {
    for (const held of [null, undefined, NaN, Infinity, '8']) {
        assert.deepEqual(chartParamsFor({ windows: { joint_surface: held } }, 'joint_surface'),
                         {});
    }
});

test('setting a depth leaves the other charts alone', () => {
    const windows = { joint_surface: 8 };
    const next = windowsWith(windows, 'other_grid', 6);
    assert.deepEqual(next, { joint_surface: 8, other_grid: 6 });
    assert.deepEqual(windows, { joint_surface: 8 });   // not mutated
});

test('auto deletes the key rather than storing a null', () => {
    assert.deepEqual(windowsWith({ joint_surface: 8 }, 'joint_surface', null), {});
    assert.deepEqual(windowsWith(null, 'joint_surface', null), {});
});

test('the v3 migration drops the flat window and keeps the readings', () => {
    const stored = { log: true, kind: 'surface', cut: 'total', window: 8 };
    assert.deepEqual(migrateChartView(stored),
                     { log: true, kind: 'surface', cut: 'total' });
    // The v3 entry itself is untouched: the caller drops the key.
    assert.equal(stored.window, 8);
});

test('a corrupt v3 entry migrates to nothing rather than throwing', () => {
    for (const stored of [null, undefined, 7, 'log', [1, 2]]) {
        assert.deepEqual(migrateChartView(stored), {});
    }
});
