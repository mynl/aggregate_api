// The `data-why` footnote's viewport clamp, under `node --test`.
//
// Only `tipShift` is covered, which is the whole of what the module decides:
// `mountTips` creates a node, listens on the document and writes two lengths,
// and testing that would be testing the DOM. The arithmetic is what has a right
// and a wrong answer.
//
// Every case below calls `tipShift` with two arguments and therefore against the
// 230px cap, which is what the CSS-only version could assume and all it could
// assume. The mount measures the live box and passes its real width as a third,
// covered by the two cases at the foot of the file.
//
// The rectangles below are the real cases. Reinsurance's Plot leaf is the first
// button in its row, the row starts at the content's left edge, and the button
// is about 45px wide, which is the overhang the item was reported for.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tipShift } from '../src/utils/tip.js';

/** A DOMRect's worth of what `tipShift` reads. */
const rect = (left, width) => ({ left, width });

test('a button in the middle of a wide window is not shifted', () => {
    // Centered at 600 in a 1200px window: the box spans 485 to 715, clear of
    // both margins, so the CSS centering is already right and nothing is written.
    assert.equal(tipShift(rect(577, 46), 1200), 0);
});

test('the first leaf in a row is pushed right off the left edge', () => {
    // The reported case. Centered at 38, so a 230px box would start at -77 and
    // the first words would be off screen. 8px of margin means it has to move
    // 85px right.
    assert.equal(tipShift(rect(15, 46), 1200), 85);
});

test('a leaf at the right edge is pulled left by the mirror amount', () => {
    // Centered at 1162 in a 1200px window: the box would end at 1277, which is
    // 85px past the 1192 the margin leaves.
    assert.equal(tipShift(rect(1139, 46), 1200), -85);
});

test('the shift is the least that works, so the box stops at the margin', () => {
    // Overhanging by exactly 1px moves by exactly 1px. A clamp that snapped to
    // the edge would jump a nearly-fitting footnote for no reason.
    assert.equal(tipShift(rect(99, 46), 1200), 1);
});

test('a window narrower than the box pins it to the left edge', () => {
    // 200px of window cannot hold a 230px box, so both corrections fire and the
    // left one lands last. Left is where the text starts, which is the half
    // worth keeping.
    const shift = tipShift(rect(80, 40), 200);
    const boxLeft = (80 + 40 / 2) - 230 / 2 + shift;
    assert.equal(boxLeft, 8, 'pinned to the margin, not to the right edge');
});

test('a measured box narrower than the cap is shifted less, or not at all', () => {
    // The same anchor as the reported case, but the footnote is short and the
    // box really 90px wide rather than the 230 the cap allows. Centered at 38 it
    // starts at -7, so it needs 15px, not the 85 the cap-only reading demanded.
    // Overshooting was safe and is now unnecessary: a real node can be measured.
    assert.equal(tipShift(rect(15, 46), 1200, 90), 15);
    // Narrower still and it fits where it is, so nothing is written.
    assert.equal(tipShift(rect(15, 46), 1200, 46), 0);
});

test('an anchor mid row is clear on a wide window and clips on a narrow one', () => {
    // Why `:first-child` / `:last-child` anchoring was rejected. This button is
    // neither end of its row, so an end-of-row rule would never touch it, and it
    // is perfectly fine until the window narrows.
    assert.equal(tipShift(rect(300, 46), 1200), 0);
    assert.equal(tipShift(rect(300, 46), 400), -46, 'the same button, clipped');
});
