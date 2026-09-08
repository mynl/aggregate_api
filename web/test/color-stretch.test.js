// The color stretch, under `node --test`.
//
// `dev/plan-color-stretch.md` rules that only the value-to-color mapping ever
// moves: the data, the tooltips and the colorbar's value axis are never
// transformed. What is checked here is the stretch contract that keeps that
// true: the composite ramp is exactly the gamma or log map, endpoints stay
// pinned so the peak and the zero keep their colors, the contour ladder is the
// inverse of the same map, and the resolution order (reader, then document,
// then realization) lands the ruled defaults, gamma on the relief and linear
// on a flat panel.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    STRETCH_DECADES, STRETCH_GAMMA, VIRIDIS, contourLevels, effectiveStretch,
    rampAt, stretchMode, stretchedRamp,
} from '../src/charts/color-stretch.js';

test('linear returns the plain viridis, so switching off is lossless', () => {
    assert.deepEqual(stretchedRamp(null), VIRIDIS);
    assert.deepEqual(stretchedRamp(undefined), VIRIDIS);
    assert.deepEqual(stretchedRamp(1), VIRIDIS);
});

test('rampAt pins the endpoints and interpolates between stops', () => {
    assert.equal(rampAt(VIRIDIS, 0), VIRIDIS[0]);
    assert.equal(rampAt(VIRIDIS, 1), VIRIDIS[VIRIDIS.length - 1]);
    // Out-of-range and non-finite clamp rather than wrap.
    assert.equal(rampAt(VIRIDIS, -3), VIRIDIS[0]);
    assert.equal(rampAt(VIRIDIS, 7), VIRIDIS[VIRIDIS.length - 1]);
    assert.equal(rampAt(VIRIDIS, NaN), VIRIDIS[0]);
    // Halfway between two stops is the channel midpoint, rounded half up:
    // #000000 to #440154 gives #22012a.
    assert.equal(rampAt(['#000000', '#440154'], 0.5), '#22012a');
});

test('the gamma ramp is viridis sampled at u ** gamma, endpoints fixed', () => {
    const gamma = 0.35;
    const ramp = stretchedRamp(gamma);
    assert.equal(ramp.length, 33);
    assert.equal(ramp[0], VIRIDIS[0]);
    assert.equal(ramp[32], VIRIDIS[VIRIDIS.length - 1]);
    // The whole contract: stop i sits at the stretched position, so ECharts
    // spacing the stops evenly over the value range composes to the stretch.
    for (let i = 0; i < 33; i += 1) {
        assert.equal(ramp[i], rampAt(VIRIDIS, (i / 32) ** gamma));
    }
});

test('the log ramp floors at `decades` under the peak and pins the ends', () => {
    const ramp = stretchedRamp('log');
    assert.equal(ramp.length, 33);
    // u = 0 has no logarithm; the floored map sends it to the bottom stop,
    // which is what keeps the exact zeros of an FFT-built joint drawable.
    assert.equal(ramp[0], VIRIDIS[0]);
    assert.equal(ramp[32], VIRIDIS[VIRIDIS.length - 1]);
    for (let i = 1; i < 33; i += 1) {
        const p = Math.max(0, 1 + Math.log10(i / 32) / STRETCH_DECADES);
        assert.equal(ramp[i], rampAt(VIRIDIS, p));
    }
});

/** Float ladders compare to a tolerance: `9 * (1 / 9)` is not exactly 1. */
function close(got, want) {
    assert.equal(got.length, want.length);
    got.forEach((v, k) => assert.ok(Math.abs(v - want[k]) < 1e-12 * Math.max(1, Math.abs(want[k])),
                                    `level ${k}: ${v} != ${want[k]}`));
}

test('linear contour levels reproduce the evenly spaced ladder', () => {
    close(contourLevels(0, 9, 8, null), [1, 2, 3, 4, 5, 6, 7, 8]);
    // A shifted range shifts with it, which is the log-z relief's case.
    close(contourLevels(-6, 0, 2, null), [-4, -2]);
});

test('gamma contour levels are the inverse map, crowded toward the faint end', () => {
    const levels = contourLevels(0, 1, 3, 0.5);
    // u ** (1 / gamma) with gamma 0.5 is u squared: 1/16, 1/4, 9/16.
    close(levels, [1 / 16, 1 / 4, 9 / 16]);
    // Crowded low: every gamma level sits below its linear counterpart, which
    // is what puts the rings where the stretched colors resolve structure.
    const linear = contourLevels(0, 1, 3, null);
    levels.forEach((v, k) => assert.ok(v < linear[k]));
});

test('log contour levels are geometric over the kept decades', () => {
    // Two levels at thirds of the ramp: four and two decades under the peak.
    close(contourLevels(0, 1, 2, 'log'), [1e-4, 1e-2]);
});

test('contour levels stay strictly inside the range, or vanish with it', () => {
    for (const stretch of [null, 0.35, 'log']) {
        const levels = contourLevels(2, 5, 8, stretch);
        assert.equal(levels.length, 8);
        levels.forEach((v, k) => {
            assert.ok(v > 2 && v < 5);
            if (k) assert.ok(v > levels[k - 1]);
        });
    }
    assert.deepEqual(contourLevels(3, 3, 8, 0.35), []);
});

test('the ruled defaults: gamma on the relief, linear on a flat panel', () => {
    assert.equal(effectiveStretch({ relief: true }), STRETCH_GAMMA);
    assert.equal(effectiveStretch({ relief: false }), null);
    assert.equal(effectiveStretch(), null);
});

test('a log z axis suppresses the default and the hint, never the reader', () => {
    // The log reading is itself a stretch of the coloring; stacking gamma on
    // it by default would be a double stretch nobody ruled on.
    assert.equal(effectiveStretch({ relief: true, logZ: true }), null);
    assert.equal(effectiveStretch({ hint: 0.25, logZ: true }), null);
    assert.equal(effectiveStretch({ held: 'gamma', relief: true, logZ: true }),
                 STRETCH_GAMMA);
    assert.equal(effectiveStretch({ held: 'log', logZ: true }), 'log');
});

test('the reader beats the document beats the realization', () => {
    assert.equal(effectiveStretch({ held: 'linear', relief: true }), null);
    assert.equal(effectiveStretch({ held: 'log', hint: 0.25, relief: true }), 'log');
    assert.equal(effectiveStretch({ held: 'gamma' }), STRETCH_GAMMA);
    // The document hint takes a gamma exponent or a mode word.
    assert.equal(effectiveStretch({ hint: 0.25 }), 0.25);
    assert.equal(effectiveStretch({ hint: 'log' }), 'log');
    assert.equal(effectiveStretch({ hint: 'linear', relief: true }), null);
    // An unrecognized hint is ignored rather than trusted.
    assert.equal(effectiveStretch({ hint: 'banana', relief: true }), STRETCH_GAMMA);
    assert.equal(effectiveStretch({ hint: 2.5 }), null);
});

test('stretchMode names the mode the control shows', () => {
    assert.equal(stretchMode(null), 'linear');
    assert.equal(stretchMode(STRETCH_GAMMA), 'gamma');
    assert.equal(stretchMode('log'), 'log');
});
