// The 'tower' panel kind, under `node --test`.
//
// Chart IR version 3 (`aggregate 1.0.0a349`) added `ChartDoc.blocks` and a
// panel whose content is blocks rather than series: a reinsurance program as a
// band of labeled rectangles over a quantity axis. This covers the translation
// of one, against a hand-written document rather than a captured one, so the
// cases a real program rarely produces all in the same picture (every block
// role, an open top, a block with no name) are all present at once.
//
// `dev/scripts/smoke-charts.mjs` is the other half and exercises the emitted
// article; it cannot assert coordinates, because it replays whatever the
// library last emitted. This asserts them.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// The chart modules are browser code: zrender sniffs the environment at import
// time and reads `document.documentElement.style`, so the stub carries that
// much and the import is deferred until it is in place. Nothing here renders.
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

const { chartdocToEcharts, documentLayout, readings } =
    await import('../src/charts/chartdoc-to-echarts.js');

// One occurrence tower with its Lee curve, and an aggregate tower: the shape
// `chart_structure` emits under `lee=True`, cut down to what is asserted.
// Every block role appears, the top layer is unlimited, and the placed layer
// has a co-participation block beside it.
const DOC = {
    ir_version: 3,
    name: 'structure',
    title: 'T: reinsurance structure',
    meta: { return_period_map: 'complement', stages: ['occ', 'agg'] },
    axes: [
        // Both scales since the library's a352: a balanced program is layered
        // in a roughly geometric progression and reads as equal bands on log,
        // which is the answer to a layer drawn as an unreadable sliver.
        { id: 'occ_loss', label: 'Loss per claim', unit: 'currency',
          scales: ['linear', 'log'],
          suggested_range: [0, 100], full_range: [0, 100] },
        { id: 'occ_place', label: 'Placement', unit: 'ratio',
          scales: ['linear'], suggested_range: [0, 1], full_range: [0, 1] },
        { id: 'occ_p', label: 'Non-exceeding probability', unit: 'probability',
          scales: ['linear'], suggested_range: [0, 1] },
        { id: 'agg_loss', label: 'Aggregate loss', unit: 'currency',
          scales: ['linear', 'log'],
          suggested_range: [0, 400], full_range: [0, 800] },
        { id: 'agg_place', label: 'Placement', unit: 'ratio',
          scales: ['linear'], suggested_range: [0, 1], full_range: [0, 1] },
    ],
    panels: [
        { id: 'occ', kind: 'tower', kinds: ['tower'], title: 'Per occurrence',
          read_axis: 'y', x_axis: 'occ_place', y_axis: 'occ_loss' },
        { id: 'occ_lee', kind: 'xy', kinds: ['xy'], title: 'Per occurrence, quantile',
          read_axis: 'y', x_axis: 'occ_p', y_axis: 'occ_loss' },
        { id: 'agg', kind: 'tower', kinds: ['tower'], title: 'In the aggregate',
          read_axis: 'y', x_axis: 'agg_place', y_axis: 'agg_loss' },
    ],
    series: [
        // The curve runs three decades under the program's own breaks, which
        // is what a quantile curve on a loss axis does and what makes the
        // pooled floor worth asserting: taken on its own this panel would
        // floor at 0.01 and open two empty decades under the tower beside it.
        { name: 'Gross claim', panel_id: 'occ_lee', role: 'gross',
          support: 'continuous', x: [0, 0.3, 0.5, 0.9, 0.99],
          y: [0, 0.05, 10, 40, 90] },
    ],
    blocks: [
        { panel_id: 'occ', role: 'retention', x0: 0, x1: 1, y0: 0, y1: 10,
          label: 'Retained', label_lines: ['10 xs 0'] },
        { panel_id: 'occ', role: 'layer', x0: 0, x1: 0.6, y0: 10, y1: 30,
          label: '20 xs 10', label_lines: ['premium 4.0', 'el 3.0'] },
        { panel_id: 'occ', role: 'co_participation', x0: 0.6, x1: 1,
          y0: 10, y1: 30, label: '', label_lines: [] },
        { panel_id: 'occ', role: 'gap', x0: 0, x1: 1, y0: 30, y1: 40,
          label: 'Uncovered', label_lines: [] },
        { panel_id: 'occ', role: 'layer', x0: 0, x1: 1, y0: 40, y1: 100,
          label: 'inf xs 40', label_lines: ['el 1.0'], open_top: true },
        { panel_id: 'agg', role: 'gross', x0: 0, x1: 1, y0: 0, y1: 400,
          label: 'Subject', label_lines: ['mean 120'] },
    ],
    marks: [
        { panel_id: 'occ', orient: 'h', at: 10, label: '10' },
        { panel_id: 'occ', orient: 'h', at: 30, label: '30' },
        { panel_id: 'occ', orient: 'h', at: 40, label: '40' },
        { panel_id: 'occ_lee', orient: 'h', at: 10, label: '10', faint: true },
        // An aggregate cover written `400 xs 0` attaches at zero, which has no
        // position on a log axis.
        { panel_id: 'agg', orient: 'h', at: 0, label: '0' },
        { panel_id: 'agg', orient: 'h', at: 400, label: '400' },
    ],
    tex: {},
};

/** The realized option at a wide host, which is where towers lay out in a row. */
function built(doc = DOC, view = undefined) {
    return chartdocToEcharts(doc, { width: 1200, ...(view ? { view } : {}) });
}

/** The custom series drawing `panel`'s blocks. */
function towerSeries(option, at) {
    return option.series.find((s) => s.type === 'custom' && s.xAxisIndex === at);
}

/**
 * One block's rendered group, in a pixel frame this test controls.
 *
 * `sx` is the pixel width of the whole placement axis and `sy` the pixels per
 * unit of loss, measured down the screen from 400, which is the sense a real
 * `api.coord` answers in. Shrinking either is how the label arithmetic is put
 * under pressure.
 */
function drawBlock(series, k, { sx = 200, sy = 3 } = {}) {
    return series.renderItem(
        { dataIndex: k },
        { coord: ([x, y]) => [x * sx, 400 - y * sy] },
    );
}

test('a tower panel realizes its blocks as one custom series', () => {
    const option = built();
    assert.equal(option.grid.length, 3);
    assert.equal(option.xAxis.length, 3);
    const occ = towerSeries(option, 0);
    assert.ok(occ, 'the occurrence tower drew a series');
    // Five blocks on that panel, one datum each, carrying the two corners.
    assert.equal(occ.data.length, 5);
    assert.deepEqual(occ.data[1], [0, 10, 0.6, 30]);
    // The Lee panel between them is an ordinary curve and needs no tower work.
    assert.ok(option.series.some((s) => s.type === 'line' && s.name === 'Gross claim'));
});

test('a block draws as a filled rectangle at its own coordinates', () => {
    const occ = towerSeries(built(), 0);
    const group = drawBlock(occ, 1);
    const rect = group.children[0].shape;
    // x0 = 0 and x1 = 0.6 of 200 pixels; y from 10 to 30 at 3 pixels a unit,
    // measured downward, so the top of the band is the smaller pixel value.
    assert.deepEqual(rect, { x: 0, y: 310, width: 120, height: 60 });
    assert.ok(group.children[0].style.fill.startsWith('rgba('),
              'a placed layer is filled');
});

test('an open-top block is torn across the top, not closed', () => {
    const occ = towerSeries(built(), 0);
    // The ring walks top left, down, across the bottom and back up to the top
    // right. A closed block joins straight back to where it started.
    const shut = drawBlock(occ, 0).children[1].shape.points;
    assert.equal(shut.length, 5);
    assert.deepEqual(shut[4], shut[0]);
    // An unlimited one walks a sawtooth back instead: it ends in the same
    // place, so the band still reads as a band, but the edge says the contract
    // continues past the frame rather than asserting a ceiling.
    const open = drawBlock(occ, 4).children[1].shape.points;
    assert.ok(open.length > shut.length, 'the torn edge adds vertices');
    assert.deepEqual(open[open.length - 1], open[0]);
    const top = open[0][1];
    const tear = open.slice(4).map((p) => p[1]);
    assert.ok(tear.some((v) => v !== top), 'the teeth leave the top line');
    assert.ok(tear.some((v) => v === top), 'and return to it');
});

test('a gap is an absence: no fill, a dashed edge', () => {
    const occ = towerSeries(built(), 0);
    const gap = drawBlock(occ, 3);
    assert.equal(gap.children[0].style.fill, 'none');
    assert.ok(Array.isArray(gap.children[1].style.lineDash));
    // And a layer beside it is solid, so the dash means something.
    assert.equal(drawBlock(occ, 1).children[1].style.lineDash, null);
});

test('a block label stack is drawn centered, and only what fits', () => {
    const occ = towerSeries(built(), 0);
    const text = (group) => group.children.find((c) => c.type === 'text');
    const roomy = text(drawBlock(occ, 1));
    assert.deepEqual(roomy.style.text.split('\n'),
                     ['20 xs 10', 'premium 4.0', 'el 3.0']);
    assert.equal(roomy.style.textAlign, 'center');
    assert.equal(roomy.style.x, 60);
    // Squeezed down to one row of height, the terms go and the name stays: a
    // block cut short loses its least important line, never an arbitrary one.
    assert.equal(text(drawBlock(occ, 1, { sy: 0.8 })).style.text, '20 xs 10');
    // Squeezed across, nothing draws at all. The headline names the block, so
    // an annotation floating in an unnamed rectangle is worse than a blank one.
    assert.equal(text(drawBlock(occ, 1, { sx: 30 })), undefined);
    // Which is also what an unnamed block gets, at any size.
    assert.equal(text(drawBlock(occ, 2)), undefined);
});

test('the tooltip keeps the whole stack whatever the rectangle had room for', () => {
    const occ = towerSeries(built(), 0);
    assert.equal(occ.tooltip.trigger, 'item');
    const shown = occ.tooltip.formatter({ dataIndex: 1 });
    for (const line of ['20 xs 10', 'premium 4.0', 'el 3.0']) {
        assert.ok(shown.includes(line), `tooltip carries ${line}`);
    }
});

test('a tower is read at its breaks: the marks become the quantity ticks', () => {
    const option = built();
    assert.deepEqual(option.yAxis[0].axisLabel.customValues, [10, 30, 40]);
    assert.equal(option.yAxis[0].axisLabel.formatter(30), '30');
    // An explicit tick list and an interval are two answers to one question.
    assert.equal(option.yAxis[0].interval, undefined);
    // The Lee panel's own mark stays a reference line, drawn faint.
    const lee = option.series.find((s) => s.markLine);
    assert.equal(lee.markLine.data.length, 1);
    assert.ok(lee.markLine.data[0].lineStyle.opacity < 1);
    // Reference lines off takes the ticks with it, the same button acting on
    // the same document content.
    const bare = built(DOC, { panels: { occ: { refLines: false } } });
    assert.equal(bare.yAxis[0].axisLabel.customValues, undefined);
});

test('the placement axis carries no reading, so it carries no ticks', () => {
    const option = built();
    assert.equal(option.xAxis[0].name, '');
    assert.equal(option.xAxis[0].axisLabel.show, false);
    assert.equal(option.xAxis[0].min, 0);
    assert.equal(option.xAxis[0].max, 1);
    // A tower is interrogated per block, not along an axis.
    assert.equal(option.grid[0].tooltip.trigger, 'item');
    assert.equal(option.grid[1].tooltip.trigger, undefined);
});

test('a tower document lays out in one row, the strips narrow', () => {
    const box = documentLayout(DOC, 1200);
    assert.equal(new Set(box.grids.map((g) => g.top)).size, 1, 'one row');
    // 1:2, a tower against the curve beside it.
    assert.ok(Math.abs(box.grids[1].width / box.grids[0].width - 2) < 1e-9);
    assert.equal(box.grids[2].width, box.grids[0].width);
    // Left to right in document order, never overlapping, inside the host.
    assert.ok(box.grids[0].left < box.grids[1].left);
    assert.ok(box.grids[1].left >= box.grids[0].left + box.grids[0].width);
    assert.ok(box.grids[2].left + box.grids[2].width <= 1200);
    // Taller than the house landscape cell: a tower is read up the page.
    assert.ok(box.panelH > 250);
    // Under the breakpoint every layout stacks, towers with it.
    assert.equal(new Set(documentLayout(DOC, 420).grids.map((g) => g.left)).size, 1);
});

test('the zoom out is offered where it opens something and not otherwise', () => {
    const offered = readings(DOC).panels;
    // The occurrence axes declare the window they are already drawn in.
    assert.equal(offered[0].fullRange, false);
    // The aggregate loss axis declares twice the suggested top, so it does.
    assert.equal(offered[2].fullRange, true);
    // The companion beside the tower offers nothing at all, so its `marks` is
    // false however many marks it carries. See the shared-axis test below.
    assert.deepEqual(offered.map((p) => p.marks), [true, false, true]);
    assert.deepEqual(readings(DOC).kinds, []);
});

test('the quantity reading belongs to the axis, not to the panel', () => {
    // The tower, the slab and the curve beside them name one loss axis and are
    // one picture, so the switch is offered once and acts on all of them. Two
    // switches, or one acting on its own panel, would draw the same loss at two
    // heights, which is the whole reason the boundary rules carry across.
    const offered = readings(DOC).panels;
    assert.deepEqual(offered.map((p) => p.logY), [true, false, true]);
    assert.deepEqual(offered.map((p) => p.id), ['occ', 'occ_lee', 'agg']);

    const on = built(DOC, { panels: { occ: { logY: true } } });
    assert.equal(on.yAxis[0].type, 'log', 'the tower it was pressed on');
    assert.equal(on.yAxis[1].type, 'log', 'the curve sharing its axis');
    // And no further: the aggregate stage is a different quantity on a
    // different axis and stays where it was.
    assert.equal(on.yAxis[2].type, 'value');
});

test('one decade floor per axis, taken from the blocks', () => {
    const on = built(DOC, { panels: { occ: { logY: true } } });
    // The occurrence blocks' smallest positive coordinate is 10, so the floor
    // is the decade strictly under it. Strictly, or a gross slab whose only
    // positive coordinate is a round decade collapses to the top of the frame.
    assert.equal(on.yAxis[0].min, 1);
    // The curve reaches 0.05 and would floor at 0.01 left to itself, which
    // would open two empty decades under the tower and squeeze the bands back
    // into the slivers the log reading exists to cure. It takes the tower's.
    assert.equal(on.yAxis[1].min, 1);
});

test('a boundary at zero is dropped from a log axis, not placed', () => {
    const ticks = (view) => built(DOC, view).yAxis[2].axisLabel.customValues;
    assert.deepEqual(ticks(), [0, 400]);
    assert.deepEqual(ticks({ panels: { agg: { logY: true } } }), [400]);
});

test('a band running from zero starts at the floor on a log axis', () => {
    const on = built(DOC, { panels: { occ: { logY: true } } });
    const occ = towerSeries(on, 0);
    // The retention runs 0 to 10. Drawn from zero it would be sent to minus
    // infinity, so it starts on the floor the axis ends at instead.
    const seen = [];
    occ.renderItem({ dataIndex: 0 }, { coord: ([, y]) => { seen.push(y); return [0, y]; } });
    assert.deepEqual(seen, [1, 10]);
    // And the block is still drawn, rather than skipped as wholly submerged.
    assert.ok(occ.renderItem({ dataIndex: 0 }, { coord: (p) => p }));
});

test('an ir_version 3 document with no blocks still translates', () => {
    // The pin moved to 3 for the tower; every chart that shipped before it is
    // now stamped 3 as well and must draw exactly as it did.
    const plain = {
        ...DOC,
        panels: DOC.panels.filter((p) => p.kind === 'xy'),
        blocks: undefined,
        marks: DOC.marks.filter((m) => m.panel_id === 'occ_lee'),
    };
    const option = chartdocToEcharts(plain, { width: 1200 });
    assert.ok(option, 'a blockless document realizes');
    assert.equal(option.grid.length, 1);
    assert.equal(option.series.length, 1);
    assert.equal(option.series[0].type, 'line');
});

test('a document from a later version is refused rather than half drawn', () => {
    assert.equal(chartdocToEcharts({ ...DOC, ir_version: 4 }, { width: 1200 }), null);
});
