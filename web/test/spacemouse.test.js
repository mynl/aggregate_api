// The device layer's parse and normalize, under `node --test`.
//
// Reports are built by hand here rather than captured, because the author's
// unit has not been read yet (`dev/plan-spacemouse.md` phase 2 findings, open).
// Both documented layouts are exercised, which is what the parser does, and
// the probe page writes real reports in this exact form: `id N: aa bb cc ...`.
// Confirming the layout is then a matter of pasting them in.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalize, parseReport } from '../src/spacemouse.js';

/** A report body, from bytes. WebHID strips the report id, and so does this. */
const body = (...bytes) => new DataView(Uint8Array.from(bytes).buffer);

/** Little endian int16 pairs, the way every candidate layout carries an axis. */
const le = (v) => [v & 0xff, (v >> 8) & 0xff];

test('report 1 alone is the three translations', () => {
    const view = body(...le(100), ...le(-100), ...le(350));
    assert.deepEqual(parseReport(1, view), { axes: { tx: 100, ty: -100, tz: 350 } });
});

test('report 2 is the three rotations', () => {
    const view = body(...le(-7), ...le(0), ...le(348));
    assert.deepEqual(parseReport(2, view), { axes: { rx: -7, ry: 0, rz: 348 } });
});

test('a twelve byte report 1 is all six, which is the other layout', () => {
    // Some firmware sends one combined report under id 1 instead of two. The
    // report's own length chooses, so both units work with no setting.
    const view = body(...le(1), ...le(2), ...le(3), ...le(-1), ...le(-2), ...le(-3));
    assert.deepEqual(parseReport(1, view),
                     { axes: { tx: 1, ty: 2, tz: 3, rx: -1, ry: -2, rz: -3 } });
    // Id 0 is the no-report-ids enumeration, where a combined packet is the
    // only thing it can be.
    assert.deepEqual(parseReport(0, view).axes.rz, -3);
});

test('report 3 is the button mask, however many bytes it takes', () => {
    assert.deepEqual(parseReport(3, body(0x01)), { buttons: 1 });
    assert.deepEqual(parseReport(3, body(0x02)), { buttons: 2 });
    assert.deepEqual(parseReport(3, body(0x03)), { buttons: 3 });
    // Two bytes, little endian, so a unit with more buttons reads the same way.
    assert.deepEqual(parseReport(3, body(0x00, 0x01)), { buttons: 256 });
});

test('a report this does not know is dropped rather than guessed at', () => {
    // The battery report is the common case, and it is not an error: it is a
    // report about something else.
    assert.equal(parseReport(23, body(0x64)), null);
    assert.equal(parseReport(1, body()), null);
    assert.equal(parseReport(1, body(0x01)), null);
});

test('normalize reaches one at full deflection and zero inside the deadzone', () => {
    const how = { scale: 350, deadzone: 0.05 };
    const at = (raw) => normalize({ tx: raw }, how).tx;
    assert.equal(at(350), 1);
    assert.equal(at(-350), -1);
    // Past the stop, still one: a puck pressed hard is at full travel, not
    // beyond it.
    assert.equal(at(700), 1);
    assert.equal(at(0), 0);
    assert.equal(at(17), 0);
    // Rescaled past the deadzone rather than clipped, so the first movement
    // out of it is slow. Clipped, the axis would jump to 0.05 the moment it
    // was crossed, which reads as a dead control that then lurches.
    assert.ok(Math.abs(at(0.06 * 350) - (0.01 / 0.95)) < 1e-9);
    assert.ok(Math.abs(at(175) - (0.45 / 0.95)) < 1e-9);
});

test('normalize answers on all six axes, whatever arrived', () => {
    const out = normalize({ rz: 350 }, { scale: 350, deadzone: 0 });
    assert.deepEqual(Object.keys(out).sort(), ['rx', 'ry', 'rz', 'tx', 'ty', 'tz']);
    assert.equal(out.rz, 1);
    assert.equal(out.tx, 0);
});
