// Stack and Round, the Quick Re row's Tower arithmetic, under `node --test`.
//
// `web/src/tower.js` is pure arithmetic with no DOM and no fetch, which is why
// it is its own module rather than three more functions in `main.js`: `main.js`
// reaches for the document at import time and cannot be loaded here at all.
//
// What the tests are actually protecting. The snap is measured in log space, so
// 1,300 goes to 1,500 and not to 1,000, and a linear nearest would get that
// wrong in a way nobody would notice reading a program. The `* 1.5` floor under
// the stacking step is the termination guarantee, so a run that stops advancing
// is an infinite loop and not a cosmetic defect. And the ladder climbs, which is
// the 2026-10-06 reversal of the sibling experiment it was ported from: that one
// walked the share down.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateTower, shareLadder, snap125 } from '../src/tower.js';

test('snap125 lands on the quote-sheet grid', () => {
    assert.equal(snap125(1000), 1000);
    assert.equal(snap125(2500), 2500);
    assert.equal(snap125(7500), 7500);
    // Every decade carries the same grid.
    assert.equal(snap125(0.25), 0.25);
    assert.equal(snap125(2.5e7), 2.5e7);
});

test('snap125 measures nearest in log space, not on the line', () => {
    // 1,300 is 300 above 1,000 and 200 below 1,500 on the line, so a linear
    // nearest says 1,500 too. 1,200 is where they part: 200 above 1,000 and
    // 300 below 1,500 linearly, but the ratios are 1.20 and 1.25, so log space
    // keeps it at 1,000 and the line would not.
    assert.equal(snap125(1300), 1500);
    assert.equal(snap125(1200), 1000);
    // Same reading one decade up, and the other way round: 1,234,567 is 234,567
    // above 1,000,000 and 265,433 below 1,500,000, so the line says 1,000,000.
    // The ratios are 1.235 and 1.215, so log space says 1,500,000. Either way
    // 1,234,567 is not a layer bound and the answer is.
    assert.equal(snap125(1234567), 1.5e6);
});

test('snap125 has nothing below the ground', () => {
    assert.equal(snap125(0), 0);
    assert.equal(snap125(-500), 0);
});

test('generateTower stacks a wide span into readable layers', () => {
    const layers = generateTower(1000, 50000);
    assert.ok(layers.length >= 3 && layers.length <= 8,
        `expected a handful of layers, got ${layers.length}`);
    // Contiguous, bottom up, and starting where the snap put the attachment.
    assert.equal(layers[0].attach, 1000);
    for (let i = 1; i < layers.length; i++) {
        assert.equal(layers[i].attach, layers[i - 1].attach + layers[i - 1].limit);
        assert.ok(layers[i].limit > 0, 'every layer has width');
    }
    // Every bound is a quote-sheet number, which is the whole point.
    for (const layer of layers) {
        assert.equal(snap125(layer.attach), layer.attach);
    }
    // The top reaches the detachment or the first round number above it.
    const top = layers[layers.length - 1];
    assert.ok(top.attach + top.limit >= 50000);
});

test('generateTower runs a ground-up stack from zero', () => {
    const layers = generateTower(0, 10000);
    assert.equal(layers[0].attach, 0);
    assert.ok(layers.length > 1, 'ground up still has layers, not one slab');
    const top = layers[layers.length - 1];
    assert.ok(top.attach + top.limit >= 10000);
});

test('generateTower yields nothing when the snap carries the bottom over the top', () => {
    // attach 2,240 snaps to 2,500, which is already above a detachment of
    // 2,350, so there is no stack to lay out. `composeTower` writes the span as
    // one layer there; the generator says so by returning nothing rather than
    // by inventing a bound.
    assert.deepEqual(generateTower(2240, 2350), []);
});

test('generateTower always advances and always terminates', () => {
    // The `* 1.5` floor under the snapped step is what guarantees this: without
    // it a snap could return the bound it was handed and the loop would spin.
    // A span of fourteen decades is well past any cap.
    for (const [attach, detach] of [[1, 1e15], [3, 7], [1e-3, 1e3], [0, 1]]) {
        const layers = generateTower(attach, detach);
        assert.ok(layers.length <= 9, 'the bound cap holds');
        for (const layer of layers) assert.ok(layer.limit > 0);
    }
});

test('shareLadder climbs from the box to 95 percent', () => {
    const ladder = shareLadder(0.6, 5);
    assert.equal(ladder.length, 5);
    assert.equal(ladder[0], 0.6, 'the box places the bottom layer exactly');
    assert.equal(ladder[4], 0.95, 'and the top reaches the ladder top');
    for (let i = 1; i < ladder.length; i++) {
        assert.ok(ladder[i] >= ladder[i - 1],
            'shares never fall as the attachment rises');
    }
});

test('shareLadder holds a share already above the ladder top', () => {
    const ladder = shareLadder(0.98, 4);
    assert.deepEqual(ladder, [0.98, 0.98, 0.98, 0.98]);
});

test('shareLadder places a whole program whole', () => {
    assert.deepEqual(shareLadder(1, 3), [1, 1, 1]);
});

test('shareLadder leaves one layer as the box typed it', () => {
    // The single layer is the bottom layer. Raising it to 95% because it is
    // also the top would overrule the box.
    assert.deepEqual(shareLadder(0.4, 1), [0.4]);
    assert.deepEqual(shareLadder(0.4, 0), []);
});

test('shareLadder stays monotone through the rounding', () => {
    // Interpolated values are rounded to the whole percent, which can in
    // principle step one a fraction of a point below the one under it. The
    // clamp is what stops that reaching a program.
    for (let pct = 5; pct <= 100; pct++) {
        for (let n = 2; n <= 9; n++) {
            const ladder = shareLadder(pct / 100, n);
            for (let i = 1; i < n; i++) {
                assert.ok(ladder[i] >= ladder[i - 1],
                    `share ${pct}% over ${n} layers fell at ${i}`);
            }
            assert.equal(ladder[0], pct / 100);
            assert.ok(ladder[n - 1] <= 1, 'nothing places over 100%');
        }
    }
});
