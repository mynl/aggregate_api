// An ordinal x axis under `node --test`: the distortion spectrum's shape.
//
// Chart IR `ChartAxis.categories` (aggregate `1.0.0a381`) names the positions of
// a category axis, which an `xy` panel has nowhere else to put. Two things
// follow and both are pinned here: the ticks read the names rather than 0, 1, 2,
// and a series across them is drawn as a trend rather than as a staircase.
//
// The staircase is the one worth a test. `support: 'atomic'` is true of these
// series, there really is nothing between two distortion families, and the
// reading that follows from it everywhere else in the app is a step. A step here
// would assert that the value holds across the gap between `ph` and `wang`, and
// there is no gap for it to hold over.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

const styleStub = new Proxy({}, { get: () => '', set: () => true });
globalThis.window = globalThis;
globalThis.document = {
    documentElement: { style: styleStub },
    createElement: () => ({ style: {}, getContext: () => null }),
    addEventListener() {},
};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { chartdocToEcharts } =
    await import('../src/charts/chartdoc-to-echarts.js');

/** The spectrum, cut to two positions over three families. */
function doc(xAxis = {}) {
    return {
        ir_version: 4,
        name: 'relativity_spectrum',
        title: 'Distortion spectrum',
        axes: [
            { id: 'family', label: 'distortion family', kind: 'category',
              categories: ['ph', 'wang', 'dual'], scales: ['linear'], ...xAxis },
            { id: 'multiple', label: 'multiple of the gross book',
              scale: 'log', scales: ['log', 'linear'] },
        ],
        panels: [{ id: 'spectrum', kind: 'xy', kinds: ['xy'],
                   x_axis: 'family', y_axis: 'multiple', read_axis: 'x' }],
        series: [
            { name: 'gross book', role: 'gross', panel_id: 'spectrum',
              support: 'atomic', x: [0, 1, 2], y: [1, 1, 1] },
            { name: '500x500', role: 'ceded', panel_id: 'spectrum',
              support: 'atomic', x: [0, 1, 2], y: [1.5, 1.55, 1.58] },
        ],
        marks: [{ panel_id: 'spectrum', orient: 'h', at: 1.0,
                  label: 'gross book', faint: true }],
    };
}

const xAxisOf = (opt) => (Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis);

test('the ticks are the category names, not their indices', () => {
    const x = xAxisOf(chartdocToEcharts(doc(), {}));
    assert.equal(x.type, 'category');
    assert.deepEqual(x.data, ['ph', 'wang', 'dual']);
});

test('the axis keeps its own name above the names of its positions', () => {
    assert.equal(xAxisOf(chartdocToEcharts(doc(), {})).name,
                 'distortion family');
});

test('an atomic series on an ordinal axis is a trend, not a staircase', () => {
    // A step would say the value holds between two named families. Nothing
    // lives between them for it to hold over.
    const opt = chartdocToEcharts(doc(), {});
    const lines = opt.series.filter((s) => s.type === 'line');
    assert.ok(lines.length >= 2, 'both positions draw');
    for (const s of lines) assert.equal(s.step, undefined);
});

test('a category axis with no names still draws, ticked by index', () => {
    // The field did not move CHART_IR_VERSION precisely so this stays true: an
    // older reader draws the right picture, plainer, rather than refusing it.
    const bare = doc({ categories: undefined });
    delete bare.axes[0].categories;
    const opt = chartdocToEcharts(bare, {});
    assert.ok(opt, 'the document still realizes');
    assert.notEqual(xAxisOf(opt).type, undefined);
});

test('the y axis keeps its log reading', () => {
    const opt = chartdocToEcharts(doc(), {});
    const y = Array.isArray(opt.yAxis) ? opt.yAxis[0] : opt.yAxis;
    assert.equal(y.type, 'log');
});
