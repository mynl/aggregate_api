// The horizontal extent of a drawing, under `node --test`.
//
// What the block below the canvas is placed against, from a165: the figure
// box's width, the legend's indent, and the left edge every panel group is
// aligned on. It is arithmetic over `panelLayout`'s grids, so it is the one
// piece of the arrangement that can be asserted without a browser; the rest of
// `renderControls` is a walk in the running app.
//
// The rule being asserted is that axis furniture is excluded at both ends. The
// left edge is the first plot area rather than zero, so nothing drawn against
// this sits under the y-axis tick labels, and by the same argument the right
// edge is the last plot area rather than the colorbar beyond it.
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

const { drawnExtent, hostExtent, documentLayout, panelLayout } =
    await import('../src/charts/chartdoc-to-echarts.js');

// `AXIS_LEFT` and `PAD_RIGHT` are module private, so they are restated here as
// the numbers the assertions are written against. A change to either should
// break this file, which is the point: the block under the canvas is placed on
// them.
const AXIS_LEFT = 64;
const PAD_RIGHT = 18;

/** A two panel document: an `agg`'s density beside its Lee diagram. */
const PAIR = {
    ir_version: 3,
    panels: [{ id: 'density', kind: 'xy' }, { id: 'lee', kind: 'xy' }],
    axes: [],
};

/** A joint severity: one equal-aspect grid panel, which brings a colorbar. */
const JOINT = {
    ir_version: 3,
    panels: [{ id: 'joint', kind: 'surface', aspect: 'equal' }],
    axes: [],
};

test('the extent starts at the first plot area, not at the host edge', () => {
    const box = documentLayout(PAIR, 980);
    const extent = drawnExtent(box);
    assert.equal(extent.left, AXIS_LEFT);
    assert.equal(extent.left, box.grids[0].left);
});

test('the extent ends at the last plot area, not at the host edge', () => {
    const box = documentLayout(PAIR, 980);
    const last = box.grids[box.grids.length - 1];
    assert.equal(drawnExtent(box).width, last.left + last.width - AXIS_LEFT);
});

test('a colorbar is outside the extent, being the panel\'s own value axis', () => {
    const box = documentLayout(JOINT, 980);
    const extent = drawnExtent(box);
    // The square clamps well inside a wide host, and the colorbar sits in the
    // right pad beyond it. Both are excluded: the box stops at the picture.
    assert.equal(extent.width, box.grids[0].width);
    assert.ok(extent.left + extent.width < 980 - PAD_RIGHT,
              'the extent must stop short of the reserved colorbar');
});

test('stacked, every panel shares one column, so the extent is one panel wide', () => {
    const box = documentLayout(PAIR, 390);
    assert.ok(!box.wide, 'a 390px host stacks');
    const extent = drawnExtent(box);
    assert.equal(extent.left, box.grids[0].left);
    assert.equal(extent.width, box.grids[0].width);
});

test('a tower spans from the first strip to the last curve', () => {
    // Three panels at 1:2:2 by ratio, which is the case equal shares could not
    // approximate: the columns are not evenly spaced and the extent is the
    // whole run of them.
    const doc = {
        ir_version: 3,
        panels: [{ id: 'gross', kind: 'tower' },
                 { id: 'ceded', kind: 'xy' },
                 { id: 'net', kind: 'xy' }],
        axes: [],
    };
    const box = documentLayout(doc, 1100);
    const extent = drawnExtent(box);
    const last = box.grids[2];
    assert.equal(extent.left, box.grids[0].left);
    assert.equal(extent.width, last.left + last.width - box.grids[0].left);
    assert.ok(box.grids[1].width > box.grids[0].width,
              'the curve panels are wider than the tower strip');
});

test('an empty layout still answers, at the axis margin and no width', () => {
    assert.deepEqual(drawnExtent({ grids: [] }), { left: AXIS_LEFT, width: 0 });
    assert.deepEqual(drawnExtent(null), { left: AXIS_LEFT, width: 0 });
});

test('a drawing that fills its host takes the host less the same margins', () => {
    // The relief: `grid3D` is given no left or width, so the scene fills the
    // canvas and there is no grid to read. The extent is the host less the
    // furniture a plot area would have left at either end, which keeps the
    // block under the drawing on one left edge whichever way it is realized.
    assert.deepEqual(hostExtent(980),
                     { left: AXIS_LEFT, width: 980 - AXIS_LEFT - PAD_RIGHT });
    assert.equal(hostExtent(980).left, drawnExtent(documentLayout(JOINT, 980)).left);
});

test('a host too narrow to hold its own margins gives no width, never a negative', () => {
    assert.equal(hostExtent(40).width, 0);
});

test('the layout reserves no band for the legend the page draws itself', () => {
    // `hostHeight` carried a dead `LEGEND_H = 24` through a164, for an ECharts
    // legend declared `show: false` since a63. Below the drawing that band was
    // the gap between the x-axis labels and the legend, so it came out.
    const box = panelLayout(1, false, 980);
    const g = box.grids[0];
    assert.equal(box.hostHeight, Math.round(g.top + g.height + 46));
});
