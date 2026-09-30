// The 'matrix' panel kind, under `node --test`.
//
// Chart IR version 4 (`aggregate 1.0.0a379`) added `ChartSeries.matrix` and a
// panel whose content is named categorical rows against named categorical
// columns. This covers the translation of one against a hand-written document,
// so the cases a real page rarely shows at once (a row read in the opposite
// direction, a cell with no value, a matrix with no diverging center) are all
// present together.
//
// The colors are the part worth pinning hardest. A reader can check a printed
// number against the table it came from; nobody can check by eye that a row
// declared with polarity -1 is colored the other way, and that is exactly the
// claim `row_polarity` makes.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// The chart modules are browser code: zrender sniffs the environment at import
// time, so the stub carries that much and the import is deferred until it is in
// place. Nothing here renders.
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

const { chartdocToEcharts, bandLayout, CHART_IR_VERSION } =
    await import('../src/charts/chartdoc-to-echarts.js');

/** The relativity page, cut to two positions and two readings. */
function doc(matrix = {}) {
    return {
        ir_version: 4,
        name: 'relativity',
        title: 'Relativity',
        axes: [
            { id: 'x', label: 'reading', kind: 'category', scales: ['linear'] },
            { id: 'y', label: 'position', kind: 'category', scales: ['linear'] },
            { id: 'z', label: 'multiple of the gross book', scales: ['linear'] },
        ],
        panels: [{ id: 'm', kind: 'matrix', kinds: ['matrix'],
                   x_axis: 'x', y_axis: 'y', z_axis: 'z' }],
        series: [{
            name: 'relativity', role: 'identity', panel_id: 'm', support: 'atomic',
            matrix: {
                rows: ['gross book', 'QS'],
                columns: ['gini ph', 'margin'],
                values: [[1.0, 1.0], [1.6, 0.4]],
                annotations: [['0.209', '7.3%'], ['0.314', '2.9%']],
                center: 1.0,
                neutral: 0.05,
                // The book row reads the other way: pricing above the
                // reference is an improvement for it and not for the QS.
                row_polarity: [-1, 1],
                row_groups: ['book', 'aggregate'],
                column_groups: ['family', 'point'],
                ...matrix,
            },
        }],
    };
}

/** Realize the page, with the matrix fields overridden. */
const option = (matrix = {}) => chartdocToEcharts(doc(matrix), {});

/** The heatmap series the matrix panel produced. */
function cells(opt) {
    const series = (opt.series || []).find((s) => s.type === 'heatmap');
    return series ? series.data : [];
}

/** rgb triple out of an `rgb(r,g,b)` string. */
function rgb(css) {
    return css.match(/\d+/g).map(Number);
}

// --- the version gate --------------------------------------------------------

test('the adapter reads version 4, so the library at a379 still draws', () => {
    // The gate is one-sided: a *later* version is refused, an earlier one is
    // not. Pinning 3 here after the library moved to 4 would have blanked every
    // chart in the app, not only the matrix.
    assert.equal(CHART_IR_VERSION, 4);
    assert.ok(option(), 'a version 4 document must realize');
});

test('an older document still draws', () => {
    assert.ok(chartdocToEcharts({ ...doc(), ir_version: 3 }, {}) !== null);
});

// --- structure ---------------------------------------------------------------

test('the axes are categories carrying the row and column names', () => {
    const opt = option();
    const x = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
    const y = Array.isArray(opt.yAxis) ? opt.yAxis[0] : opt.yAxis;
    assert.equal(x.type, 'category');
    assert.equal(y.type, 'category');
    assert.ok(x.data.includes('gini ph') && x.data.includes('margin'));
    assert.ok(y.data.includes('gross book') && y.data.includes('QS'));
});

test('rows read top to bottom, the order the document lists them in', () => {
    const opt = option();
    const y = Array.isArray(opt.yAxis) ? opt.yAxis[0] : opt.yAxis;
    assert.equal(y.inverse, true);
});

test('a band gap is a blank category, not a coordinate offset', () => {
    // ECharts spaces categories evenly, so the only honest way to open a gap is
    // an empty category that carries no cell.
    const opt = option();
    const x = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
    assert.deepEqual(x.data, ['gini ph', '', 'margin']);
    // and every cell still lands on a real category
    for (const cell of cells(opt)) assert.notEqual(x.data[cell.value[0]], '');
});

test('bandLayout inserts one blank per band boundary', () => {
    assert.deepEqual(bandLayout(['a', 'b', 'c'], ['f', 'f', 'p']),
                     { display: ['a', 'b', '', 'c'], at: [0, 1, 3] });
    assert.deepEqual(bandLayout(['a', 'b'], []),
                     { display: ['a', 'b'], at: [0, 1] });
});

test('a cell carries its raw value and its annotation', () => {
    const data = cells(option());
    assert.equal(data.length, 4);
    const qsMargin = data.find((d) => d.value[2] === 0.4);
    assert.equal(qsMargin.annotation, '2.9%');
});

test('a missing cell produces no data point at all', () => {
    const opt = option({ values: [[1.0, null], [1.6, 0.4]] });
    assert.equal(cells(opt).length, 3);
});

// --- the colors, which are the claim a reader cannot check ------------------

test('polarity flips which direction is colored favorably', () => {
    // 1.6 on the QS row is paying above the book: unfavorable, so red. The same
    // 1.6 on a book row would be an improvement: favorable, so green. One
    // matrix, two directions, and nothing in the numbers says so.
    // Found by value, not by row index: `row_groups` inserts a blank row
    // between the bands, so the QS row does not sit where it was listed.
    const at16 = (opt) => rgb(cells(opt)
        .find((d) => d.value[2] === 1.6).itemStyle.color);

    const unfavorable = at16(option());
    assert.ok(unfavorable[0] > unfavorable[1], 'above center on a +1 row is red');

    const favorable = at16(option({ row_polarity: [-1, -1] }));
    assert.ok(favorable[1] > favorable[0], 'above center on a -1 row is green');
});

test('a cell inside the neutral band takes the neutral color', () => {
    // Every gross book cell is exactly at the center, so it carries no signal
    // and must not be shaded as though it did.
    const neutral = cells(option())
        .filter((d) => d.value[1] === 0)
        .map((d) => d.itemStyle.color);
    assert.equal(new Set(neutral).size, 1);
    assert.deepEqual(rgb(neutral[0]), [240, 239, 236]);
});

test('the band is a hard stop rather than a gradient through the center', () => {
    // Two cells at different departures, both inside the band, must be the same
    // color; a gradient would make them differ and would show the reader a
    // signal the document said was not there.
    const opt = option({
        values: [[1.0, 1.04], [1.6, 0.4]], neutral: 0.05, row_polarity: [1, 1],
    });
    const inside = cells(opt).filter((d) => d.value[1] === 0)
        .map((d) => d.itemStyle.color);
    assert.equal(new Set(inside).size, 1, 'the band is not flat');
});

test('no center means no diverging color', () => {
    const opt = option({ center: null });
    for (const cell of cells(opt)) {
        assert.deepEqual(rgb(cell.itemStyle.color), [240, 239, 236]);
    }
});

test('dark cells take white text', () => {
    // The deepest red and green are unreadable in ink, and the usual 0.5
    // luminance threshold leaves the mid greens unreadable either way.
    const deep = cells(option({ values: [[1.0, 1.0], [12.0, 0.4]] }))
        .find((d) => d.value[2] === 12.0);
    assert.equal(deep.label.color, '#ffffff');
});

// --- the text ----------------------------------------------------------------

test('a number is printed with a minus sign, never a hyphen', () => {
    const opt = option({ values: [[1.0, 1.0], [-2.5, 0.4]],
                         annotations: [['0.209', '7.3%'], ['-1.4%', '2.9%']] });
    const series = opt.series.find((s) => s.type === 'heatmap');
    const cell = cells(opt).find((d) => d.value[2] === -2.5);
    const text = series.label.formatter({ value: cell.value, data: cell });
    assert.ok(text.includes('−2.50×'), text);
    assert.ok(text.includes('(−1.4%)'), text);
    assert.ok(!text.includes('-'), 'a hyphen reached a number');
});

test('a cell with no annotation prints one line', () => {
    const opt = option({ annotations: [] });
    const series = opt.series.find((s) => s.type === 'heatmap');
    const cell = cells(opt)[0];
    const text = series.label.formatter({ value: cell.value, data: cell });
    assert.ok(!text.includes('\n'), text);
});

// --- a ratio that crossed zero -----------------------------------------------

test('a ratio through zero is dropped from the color, not from the page', () => {
    // A negative multiple is off the scale, not far along it. Colored, -9.3
    // would be the deepest favorable cell on the page, saying the layer is nine
    // times better than the book when the quantity merely changed sign.
    const opt = option({ values: [[1.0, 1.0], [-9.3, 0.4]] });
    const cell = cells(opt).find((d) => d.value[2] === -9.3);
    assert.ok(cell, 'the number must still be on the page');
    assert.deepEqual(rgb(cell.itemStyle.color), [240, 239, 236]);
});

test('a center of zero keeps both directions', () => {
    // Differences rather than ratios: a negative is a real reading and colors.
    // Polarity held at +1 so this isolates the center, not the flip.
    const opt = option({ center: 0, neutral: 0, row_polarity: [1, 1],
                         values: [[-2, 2], [1, -1]] });
    const down = rgb(cells(opt).find((d) => d.value[2] === -2).itemStyle.color);
    const up = rgb(cells(opt).find((d) => d.value[2] === 2).itemStyle.color);
    assert.notDeepEqual(down, up);
    assert.ok(down[1] > down[0], 'below a zero center is favorable');
});
