// The two exponent units of `exact_tail`, under `node --test`.
//
// `aggregate` 1.5.0 added the axis units `log10_density` and
// `log10_probability`, whose values are base-10 exponents, for the nttagg's
// exact chart. Three things are pinned here. The probability an exponent stands
// for is printed without ever forming `10 ** v`, which underflows to zero long
// before the deep tail this chart exists to show. The mass panel is markers
// only, since its omitted buckets are exact zeros a line would bridge. And the
// ticks print the exponent itself, ungrouped. Plan
// `dev/plan-1.13.0-exact-tail-leaf.md`.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { log10ProbabilityText } from '../src/utils/format.js';

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

test('an exponent reads as the probability it stands for', () => {
    assert.equal(log10ProbabilityText(-400), '1.000e-400');
    assert.equal(log10ProbabilityText(-467.7), '1.995e-468');
    assert.equal(log10ProbabilityText(-0.30103), '5.000e-1');
});

test('the mantissa carries instead of printing ten', () => {
    // 10 ** 0.99999 is 9.99977, which rounds to 10.000 at three digits.
    assert.equal(log10ProbabilityText(-400.00001), '1.000e-400');
});

test('a missing exponent prints nothing', () => {
    assert.equal(log10ProbabilityText(null), '');
    assert.equal(log10ProbabilityText(Number.NaN), '');
});

/** The shape of an `exact_tail` document: mass over survival, gaps omitted. */
function exactTail() {
    return {
        ir_version: 4,
        name: 'exact_tail',
        title: 'G',
        axes: [
            { id: 'outcome', label: 'Loss', unit: 'currency', scale: 'linear',
              scales: ['linear', 'log'], suggested_range: [0, 10],
              full_range: [0, 15] },
            { id: 'log10_mass', label: 'log10 probability mass',
              unit: 'log10_density', scale: 'linear', scales: ['linear'],
              suggested_range: [-1200, 0] },
            { id: 'log10_survival', label: 'log10 exceedance probability',
              unit: 'log10_probability', scale: 'linear', scales: ['linear'],
              suggested_range: [-1200, 0] },
        ],
        panels: [
            { id: 'mass', kind: 'xy', kinds: ['xy'], x_axis: 'outcome',
              y_axis: 'log10_mass', read_axis: 'x',
              title: 'Exact probability mass' },
            { id: 'survival', kind: 'xy', kinds: ['xy'], x_axis: 'outcome',
              y_axis: 'log10_survival', read_axis: 'x',
              title: 'Exact survival function' },
        ],
        series: [
            // Support 2, 4, 5, 7, 10: buckets 3, 6, 8 and 9 are exact zeros.
            { name: 'Exact', role: 'density', panel_id: 'mass', support: 'atomic',
              x: [2, 4, 5, 7, 10], y: [-0.6, -0.9, -0.6, -400, -1200] },
            { name: 'Exact', role: 'survival', panel_id: 'survival',
              support: 'atomic', x_lattice: [0, 1, 10],
              y: [0, 0, -0.12, -0.12, -0.2, -0.43, -0.43, -0.9, -0.9, -0.9] },
        ],
        marks: [],
    };
}

const named = (opt, name) => opt.series.filter((s) => s.name === name);

test('the mass panel is markers only, and the survival a right-continuous step', () => {
    const opt = chartdocToEcharts(exactTail(), {});
    const [mass, survival] = named(opt, 'Exact');
    assert.equal(mass.yAxisIndex, 0);
    assert.equal(mass.showSymbol, true);
    assert.equal(mass.lineStyle.width, 0);
    assert.equal(mass.step, undefined);
    assert.equal(mass.connectNulls, false);
    assert.equal(survival.yAxisIndex, 1);
    assert.equal(survival.step, 'end');
});

test('both y axes tick the exponent itself, ungrouped', () => {
    const opt = chartdocToEcharts(exactTail(), {});
    for (const k of [0, 1]) {
        const format = opt.yAxis[k].axisLabel.formatter;
        assert.equal(format(-400), '-400');
        assert.equal(format(-1200), '-1200');
        assert.equal(format(-467.5), '-467.5');
    }
});
