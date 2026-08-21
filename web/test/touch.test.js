// `touchPoint`, the pure half of the touch coordinate shim, under `node --test`.
//
// The listener half needs a DOM and gets none, which is why the arithmetic was
// split out: it is the part that can be wrong quietly. A rectangle with a
// non-zero origin is the case that matters, since a chart canvas is never at
// the top left of the page and an implementation that forgot the offset would
// pass a test that put it there.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { touchPoint } from '../src/charts/touch.js';

test('a rectangle at the origin passes the client point straight through', () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 };
    assert.deepEqual(touchPoint(rect, { clientX: 120, clientY: 75 }), { x: 120, y: 75 });
});

test('a rectangle down the page subtracts its own origin', () => {
    // The real case: a chart canvas below the editor and the tab strips.
    const rect = { left: 32, top: 640, width: 800, height: 480 };
    assert.deepEqual(touchPoint(rect, { clientX: 232, clientY: 700 }), { x: 200, y: 60 });
});

test('a touch outside the rectangle reads negative rather than clamping', () => {
    // Deliberate: `LayerGL.pickObject` treats these as viewport coordinates and
    // picks nothing when they fall outside, which is the right answer. Clamping
    // would invent a pick on the edge of the canvas from a touch that missed it.
    const rect = { left: 100, top: 200, width: 300, height: 200 };
    assert.deepEqual(touchPoint(rect, { clientX: 40, clientY: 180 }), { x: -60, y: -20 });
});
