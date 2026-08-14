// The program history walk, under `node --test`.
//
// `history.js` holds one module-level state object, loaded from localStorage at
// import and falling back to an empty walk when there is no browser, so these
// tests share it and run in sequence. `node --test` gives the file its own
// process, so nothing else sees what they record.
//
// The case worth naming is the first press. `cursor === -1` says no walk is in
// progress, and that is two different places: the editor is holding the program
// that was just built, or it is holding something typed since. Reading it as one
// place made the opening Ctrl+Up hand back the text already on screen, a
// keystroke that visibly did nothing.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { next, position, prev, record, resetCursor } from '../src/history.js';

const A = 'agg A 1 claim dsev [1]';
const B = 'agg B 1 claim dsev [2]';
const C = 'agg C 1 claim dsev [3]';

test('seeding: the newest program is first', () => {
    record(C);
    record(B);
    record(A);
    assert.deepEqual(position(), { m: 1, n: 3 });
});

test('the first press back moves off the program on screen', () => {
    // A is what the last build recorded and what the editor is showing, so the
    // step back is to B, and the readout says the second of three.
    assert.equal(prev(A), B);
    assert.deepEqual(position(), { m: 2, n: 3 });
});

test('the walk continues one entry at a time and stops at the oldest', () => {
    assert.equal(prev(B), C);
    assert.deepEqual(position(), { m: 3, n: 3 });
    assert.equal(prev(C), null, 'nothing behind the oldest entry');
    assert.deepEqual(position(), { m: 3, n: 3 }, 'a refused step does not move');
});

test('forward retraces the same stops and lands back on the newest', () => {
    assert.equal(next(), B);
    assert.equal(next(), A);
    assert.deepEqual(position(), { m: 1, n: 3 });
    assert.equal(next(), null, 'nothing newer than the newest entry');
});

test('with text typed since, the newest entry is a real destination', () => {
    // The walk has not been where the editor is, so nothing is skipped: this is
    // the shell's behavior with a half-typed line.
    resetCursor();
    assert.equal(prev('agg Untitled 1 claim dsev [4]'), A);
    assert.deepEqual(position(), { m: 1, n: 3 });
});

test('an empty current is text the walk has not visited', () => {
    // The default argument must not read as "showing the newest": a caller that
    // passes nothing gets the newest entry, which is the old behavior and the
    // right one when the editor has been cleared.
    resetCursor();
    assert.equal(prev(), A);
});
