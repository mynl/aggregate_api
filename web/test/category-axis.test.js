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
        // `role: 'base'` is what declares the two halves; without it the wash
        // is correctly absent, which is what the companion case below checks.
        marks: [{ panel_id: 'spectrum', orient: 'h', at: 1.0,
                  label: 'gross book', role: 'base', faint: true }],
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

// --- families, direct labels and the base wash -------------------------------

const { documentLayout, groupStyles } =
    await import('../src/charts/chartdoc-to-echarts.js');

/** The spectrum with three families, as the plugin emits it. */
function grouped() {
    const mk = (name, group, y) => ({
        name, role: 'ceded', panel_id: 'spectrum', support: 'atomic',
        group, x: [0, 1, 2], y,
    });
    const d = doc();
    d.series = [
        mk('gross book', 'reference books', [1, 1, 1]),
        mk('final net', 'reference books', [2, 2.1, 2.2]),
        mk('500x500', 'occurrence', [1.5, 1.55, 1.58]),
        mk('1x1', 'occurrence', [1.08, 1.12, 1.16]),
        mk('QS', 'aggregate', [0.05, 0.05, 0.04]),
    ];
    return d;
}

const linesOf = (opt) => opt.series.filter((s) => s.type === 'line');

test('one color family per group, assigned in order of appearance', () => {
    // The renderer has no business knowing that 'occurrence' means anything in
    // particular. The document says which series are kin; the first family that
    // appears gets the first ramp.
    const styles = groupStyles(grouped().series);
    const hue = (name) => styles[name].color;
    assert.notEqual(hue('gross book'), hue('500x500'));
    assert.notEqual(hue('500x500'), hue('QS'));
    // kin share a hue and differ in shade
    assert.notEqual(hue('gross book'), hue('final net'));
});

test('a family tells its members apart by shape as well as by shade', () => {
    const styles = groupStyles(grouped().series);
    assert.notEqual(styles['gross book'].symbol, styles['final net'].symbol);
    // and the first member of each family starts the symbol run again
    assert.equal(styles['gross book'].symbol, styles['500x500'].symbol);
});

test('a family of one is left on its base color', () => {
    const styles = groupStyles(grouped().series);
    assert.match(styles.QS.color, /^#|^rgb/);
});

test('a series with no group keeps the house assignment', () => {
    assert.deepEqual(groupStyles(doc().series), {});
});

test('a grouped ordinal panel labels its lines directly and drops the legend', () => {
    // The legend is what a reader serves worst here: eight names in a box to be
    // matched back to eight lines by color. `endLabel` plus `labelLayout`
    // shift-on-overlap does what the reference hand-rolled with a packing solve.
    const opt = chartdocToEcharts(grouped(), {});
    const lines = linesOf(opt);
    assert.ok(lines.length >= 5);
    for (const s of lines) {
        assert.equal(s.endLabel.show, true);
        assert.equal(s.labelLayout.moveOverlap, 'shiftY');
        assert.equal(s.labelLine.show, true);
    }
    assert.deepEqual(opt.legend.data, []);
});

test('an ungrouped panel keeps its legend', () => {
    const opt = chartdocToEcharts(doc(), {});
    assert.ok(opt.legend.data.length > 0);
    for (const s of linesOf(opt)) assert.equal(s.endLabel, undefined);
});

test('a base mark washes the halves either side of it', () => {
    const opt = chartdocToEcharts(grouped(), {});
    const area = opt.series.find((s) => s.markArea);
    assert.ok(area, 'the wash is drawn');
    const [above, below] = area.markArea.data;
    assert.equal(above[0].yAxis, 1.0);
    assert.equal(above[1].yAxis, 'max');
    assert.equal(below[0].yAxis, 'min');
    assert.equal(below[1].yAxis, 1.0);
    // dearer above, cheaper below: a price statement, never a verdict
    assert.notEqual(above[0].itemStyle.color, below[0].itemStyle.color);
});

test('a mark with no base role draws no wash', () => {
    const d = grouped();
    d.marks = [{ ...d.marks[0], role: 'mean' }];
    assert.equal(chartdocToEcharts(d, {}).series.find((s) => s.markArea),
                 undefined);
});

test('a four-point ordinal panel does not take the whole width', () => {
    // Four points stretched across the pane is white space with ink in the
    // corners, and it flattens the slope the panel is read for.
    const wide = documentLayout(grouped(), 1200);
    assert.ok(wide.grids[0].width < 600, wide.grids[0].width);
    assert.ok(wide.grids[0].width >= 360, wide.grids[0].width);
});

test('a value-axis panel is unaffected by the ordinal ceiling', () => {
    const d = grouped();
    d.axes = d.axes.map((a) => (a.id === 'family'
        ? { id: 'family', label: 'x', scales: ['linear'] } : a));
    const lay = documentLayout(d, 1200);
    assert.ok(lay.grids[0].width > 600, lay.grids[0].width);
});

// --- an explicitly untitled panel --------------------------------------------

/** The spectrum with the panel title set to whatever is passed. */
function titled(panelTitle) {
    const d = doc();
    d.title = 'Distortion spectrum: Capstone, gross base';
    d.panels = [{ ...d.panels[0], title: panelTitle }];
    return d;
}

test('an empty panel title draws no title', () => {
    // `''` is a panel saying it has none, and it is the only way to say so.
    // Testing truthiness collapsed it with null and fell through to the
    // document, so an emitter that set `''` got back the heading it was
    // dropping. `doc.title` cannot just be cleared instead: a saved PNG takes
    // its file name from it.
    const opt = chartdocToEcharts(titled(''), {});
    assert.ok(opt, 'the document still realizes');
    const text = JSON.stringify(opt.title || []);
    assert.ok(!text.includes('Distortion spectrum'), text);
});

test('no panel title still inherits the document title', () => {
    const opt = chartdocToEcharts(titled(null), {});
    const text = JSON.stringify(opt.title || []);
    assert.ok(text.includes('Distortion spectrum'), text);
});

test('a panel title still wins over the document', () => {
    const opt = chartdocToEcharts(titled('Its own heading'), {});
    const text = JSON.stringify(opt.title || []);
    assert.ok(text.includes('Its own heading'), text);
    assert.ok(!text.includes('Distortion spectrum'), text);
});
