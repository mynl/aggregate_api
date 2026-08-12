// The camera integrator, under `node --test`.
//
// Everything here is the arithmetic between a puck and a camera, which is why
// `surface-nav.js` imports nothing: the shaping curve, the pan basis, one step
// of the camera, and the loop driven through injected hooks. The browser half
// is exercised through the probe page and by hand, per
// `dev/plan-spacemouse.md` phase 3.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    NAV_DEFAULTS, cameraStep, createSurfaceNav, dominantOnly, panBasis, shape,
} from '../src/charts/surface-nav.js';

const ZERO = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
const axes = (patch) => ({ ...ZERO, ...patch });
const CAMERA = { alpha: 24, beta: 40, distance: 190, center: [0, 0, 0] };

test('the shaping curve holds both ends and softens the middle', () => {
    // Full deflection is 1 whatever the curve, which is what lets every gain
    // be read as "per second at full travel".
    assert.equal(shape(1, 0), 1);
    assert.equal(shape(1, 1), 1);
    assert.equal(shape(-1, 0.6), -1);
    assert.equal(shape(0, 0.6), 0);
    assert.equal(shape(0.5, 0), 0.5);
    assert.equal(shape(0.5, 1), 0.125);
    // Between the two, and monotone: a small deflection is finer than linear.
    assert.ok(shape(0.5, 0.6) < 0.5 && shape(0.5, 0.6) > 0.125);
});

test('the dominant axis option leaves exactly one axis alive', () => {
    const out = dominantOnly(axes({ tx: 0.6, rz: -0.3, ty: 0.2 }));
    assert.equal(out.tx, 0.6);
    assert.equal(out.rz, 0);
    assert.equal(out.ty, 0);
    // Signs do not decide it, size does.
    assert.equal(dominantOnly(axes({ tx: 0.2, rz: -0.9 })).rz, -0.9);
});

test('the pan basis is orthonormal at every angle', () => {
    for (const [alpha, beta] of [[0, 0], [24, 40], [-35, 210], [90, 137], [-90, -12]]) {
        const { right, up } = panBasis(alpha, beta);
        const dot = right[0] * up[0] + right[1] * up[1] + right[2] * up[2];
        assert.ok(Math.abs(dot) < 1e-12, `right and up should be perpendicular at ${alpha}, ${beta}`);
        assert.ok(Math.abs(Math.hypot(...right) - 1) < 1e-12);
        assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-12);
    }
    // Face on, screen right is the box's x and screen up is its vertical,
    // which is the y of the grid3D's world space rather than the data's z.
    // `|| 0` because a rounded negative zero is not deep equal to zero.
    const whole = (v) => Math.round(v) || 0;
    const face = panBasis(0, 0);
    assert.deepEqual(face.right.map(whole), [1, 0, 0]);
    assert.deepEqual(face.up.map(whole), [0, 1, 0]);
    // Swung a quarter turn, screen right is the depth axis.
    const side = panBasis(0, 90);
    assert.deepEqual(side.right.map(whole), [0, 0, -1]);
});

test('a centered puck moves nothing at all', () => {
    // Not an optimization: writing an unchanged camera every frame is exactly
    // what fights a reader who is dragging with the mouse.
    assert.equal(cameraStep(CAMERA, axes({}), NAV_DEFAULTS, 1 / 60), null);
    assert.equal(cameraStep(null, axes({ rz: 1 }), NAV_DEFAULTS, 1 / 60), null);
    assert.equal(cameraStep({ beta: 1 }, axes({ rz: 1 }), NAV_DEFAULTS, 1 / 60), null);
});

test('twist orbits and tilt raises, in degrees a second at full travel', () => {
    const twist = cameraStep(CAMERA, axes({ rz: 1 }), NAV_DEFAULTS, 1);
    assert.ok(Math.abs(twist.beta - (40 + NAV_DEFAULTS.orbit)) < 1e-9);
    assert.equal(twist.alpha, undefined);   // nothing else moved, nothing else written
    const tilt = cameraStep(CAMERA, axes({ rx: 0.5 }), NAV_DEFAULTS, 1);
    assert.ok(tilt.alpha > 24 && tilt.alpha < 24 + NAV_DEFAULTS.elevate);
    // Elevation is clamped where echarts-gl clamps it, so the camera cannot
    // be driven through the pole and come out reversed.
    assert.equal(cameraStep(CAMERA, axes({ rx: 1 }), NAV_DEFAULTS, 5).alpha, 90);
    assert.equal(cameraStep(CAMERA, axes({ rx: -1 }), NAV_DEFAULTS, 5).alpha, -90);
});

test('zoom is multiplicative and clamped to the control it drives', () => {
    // The same fraction of where you are, at any distance: additive zoom
    // crawls when far out and slams into the surface when close in.
    const inward = cameraStep(CAMERA, axes({ ty: 1 }), NAV_DEFAULTS, 1);
    assert.ok(Math.abs(inward.distance - 190 * Math.exp(-NAV_DEFAULTS.zoom)) < 1e-9);
    const far = cameraStep({ ...CAMERA, distance: 380 }, axes({ ty: -1 }), NAV_DEFAULTS, 1);
    assert.equal(far.distance, 400);
    const near = cameraStep({ ...CAMERA, distance: 45 }, axes({ ty: 1 }), NAV_DEFAULTS, 1);
    assert.equal(near.distance, 40);
});

test('pan is camera relative, scaled by distance, and follows the hand', () => {
    const facing = { alpha: 0, beta: 0, distance: 200, center: [0, 0, 0] };
    const step = 200 * NAV_DEFAULTS.pan;
    const right = cameraStep(facing, axes({ tx: 1 }), NAV_DEFAULTS, 1);
    // The target goes left when the cap goes right, which is what makes the
    // surface follow the hand rather than slide away from it.
    assert.ok(Math.abs(right.center[0] + step) < 1e-9);
    assert.equal(right.center[1], 0);
    // The vertical is the other sign, because the device's is: it reports a
    // press as positive TZ, so a press has to raise the target, which sends
    // the picture down with the hand. Measured on the author's unit at a90,
    // after a88 shipped it backwards.
    const press = cameraStep(facing, axes({ tz: 1 }), NAV_DEFAULTS, 1);
    assert.ok(Math.abs(press.center[1] - step) < 1e-9);
    const lift = cameraStep(facing, axes({ tz: -1 }), NAV_DEFAULTS, 1);
    assert.ok(Math.abs(lift.center[1] + step) < 1e-9);
    // Swung round, the same slide moves the target along a different box axis:
    // the basis is the camera's, not the data's.
    const swung = cameraStep({ ...facing, beta: 90 }, axes({ tx: 1 }), NAV_DEFAULTS, 1);
    assert.ok(Math.abs(swung.center[0]) < 1e-9);
    assert.ok(Math.abs(swung.center[2] - step) < 1e-9);
    // A camera that has already been panned is added to, not replaced.
    const held = cameraStep({ ...facing, center: [10, 0, 0] }, axes({ tx: 1 }), NAV_DEFAULTS, 1);
    assert.ok(Math.abs(held.center[0] - (10 - step)) < 1e-9);
});

test('invert flags and the dominant option act before anything else', () => {
    const flipped = cameraStep(CAMERA, axes({ rz: 1 }),
                               { ...NAV_DEFAULTS, invert: { rz: true } }, 1);
    assert.ok(Math.abs(flipped.beta - (40 - NAV_DEFAULTS.orbit)) < 1e-9);
    // With the dominant option on, a slightly twisted push is a push.
    const soup = cameraStep(CAMERA, axes({ ty: 0.8, rz: 0.2 }),
                            { ...NAV_DEFAULTS, dominant: true }, 1);
    assert.equal(soup.beta, undefined);
    assert.ok(soup.distance < 190);
});

test('the loop runs while deflected and stops the moment it is let go', () => {
    let camera = { ...CAMERA };
    const written = [];
    const nav = createSurfaceNav({
        read: () => camera,
        write: (patch) => { written.push(patch); camera = { ...camera, ...patch }; },
    });
    const t0 = performance.now();
    nav.input({ axes: axes({ rz: 1 }), buttons: 0, pressed: 0, released: 0 });
    assert.equal(nav.running, true);
    assert.equal(nav.tick(t0 + 16), true);
    assert.equal(written.length, 1);
    assert.ok(camera.beta > 40);

    // Let go: the axes arrive zeroed, and the next tick stops the loop rather
    // than writing a camera nobody asked to move.
    nav.input({ axes: axes({}), buttons: 0, pressed: 0, released: 0 });
    assert.equal(nav.tick(t0 + 32), false);
    assert.equal(nav.running, false);
    assert.equal(written.length, 1);
    nav.dispose();
});

test('a puck that stops talking is a puck that was let go', () => {
    // The release report is the one that must not be lost, so silence is read
    // as centered. A camera that drifts on after the hand comes off is the
    // worst failure this can have.
    let written = 0;
    const nav = createSurfaceNav({ read: () => ({ ...CAMERA }), write: () => { written += 1; } });
    const t0 = performance.now();
    nav.input({ axes: axes({ rz: 1 }), buttons: 0, pressed: 0, released: 0 });
    assert.equal(nav.tick(t0 + 400), false);
    assert.equal(written, 0);
    assert.equal(nav.running, false);
    nav.dispose();
});

test('the buttons reset the view and swap the projection, on the press', () => {
    const seen = [];
    let projection = 'perspective';
    const nav = createSurfaceNav({
        read: () => ({ ...CAMERA, projection }),
        write: () => {},
        reset: () => seen.push('reset'),
        setProjection: (next) => { projection = next; seen.push(next); },
    });
    nav.input({ axes: axes({}), buttons: 1, pressed: 1, released: 0 });
    nav.input({ axes: axes({}), buttons: 2, pressed: 2, released: 1 });
    nav.input({ axes: axes({}), buttons: 2, pressed: 2, released: 0 });
    assert.deepEqual(seen, ['reset', 'orthographic', 'perspective']);
    // Nothing was deflected, so nothing was scheduled.
    assert.equal(nav.running, false);
    nav.dispose();
});

test('the loop is harmless while there is nothing to drive', () => {
    // The flat reading is on screen, or the chart has been disposed: the axes
    // still arrive and nothing is written.
    let written = 0;
    const nav = createSurfaceNav({ read: () => null, write: () => { written += 1; } });
    const t0 = performance.now();
    nav.input({ axes: axes({ tx: 1 }), buttons: 0, pressed: 0, released: 0 });
    assert.equal(nav.tick(t0 + 16), true);
    assert.equal(written, 0);
    nav.dispose();
});
