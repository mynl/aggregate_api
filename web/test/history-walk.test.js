// The program history walk, under `node --test`.
//
// `history.js` holds one module-level state object, loaded from localStorage at
// import and falling back to an empty walk when there is no browser, so these
// tests share it and run in sequence. `node --test` gives the file its own
// process, so nothing else sees what they record. The cap tests at the bottom
// fill that shared store, which is why they are last.
//
// There is no localStorage here at all, so every `save` throws. That is a case
// the module is written for rather than one these tests work around: a refused
// write retries on a copy and adopts it only if it lands, so the in-memory walk
// survives a browser with storage switched off exactly as it survives node.
//
// The case worth naming is the first press. `cursor === -1` says no walk is in
// progress, and that is two different places: the editor is holding the program
// that was just built, or it is holding something typed since. Reading it as one
// place made the opening step back hand over the text already on screen, a
// press that visibly did nothing.
//
// The `clear` test is last for the same reason, from the other end: it empties
// the shared store outright, so anything after it would start from nothing.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canNext, canPrev, clear, next, position, prev, record,
         resetCursor } from '../src/history.js';

const A = 'agg A 1 claim dsev [1]';
const B = 'agg B 1 claim dsev [2]';
const C = 'agg C 1 claim dsev [3]';

test('seeding: the newest program carries the highest number', () => {
    record(C);
    record(B);
    record(A);
    // Counting up, JupyterLab style, settled 2026-08-21 together with the cap
    // raise that licensed it. It read `{m: 1, n: 3}` through a115.
    assert.deepEqual(position(), { m: 3, n: 3 });
});

test('the first press back moves off the program on screen', () => {
    // A is what the last build recorded and what the editor is showing, so the
    // step back is to B. The readout happens to be the same either way round at
    // the middle of three, which is why this number did not change with the
    // direction: 3 - 1 back is 2, and 1 + 1 forward was 2 as well.
    assert.equal(prev(A), B);
    assert.deepEqual(position(), { m: 2, n: 3 });
});

test('the walk continues one entry at a time and stops at the oldest', () => {
    assert.equal(prev(B), C);
    assert.deepEqual(position(), { m: 1, n: 3 }, 'the oldest entry is 1');
    assert.equal(canPrev(C), false, 'and the step-back button greys there');
    assert.equal(prev(C), null, 'nothing behind the oldest entry');
    assert.deepEqual(position(), { m: 1, n: 3 }, 'a refused step does not move');
});

test('forward retraces the same stops and lands back on the newest', () => {
    assert.equal(next(), B);
    assert.equal(next(), A);
    assert.deepEqual(position(), { m: 3, n: 3 });
    assert.equal(canNext(), false, 'nothing newer, and the button says so');
    assert.equal(next(), null, 'nothing newer than the newest entry');
});

test('with text typed since, the newest entry is a real destination', () => {
    // The walk has not been where the editor is, so nothing is skipped: this is
    // the shell's behavior with a half-typed line.
    resetCursor();
    assert.equal(prev('agg Untitled 1 claim dsev [4]'), A);
    assert.deepEqual(position(), { m: 3, n: 3 });
});

test('the draft that was typed comes back on the way forward', () => {
    // Straight on from the press above, which stashed it. One step forward off
    // the newest entry hands it back, and the readout blanks: a draft is not an
    // entry, so it has no number.
    assert.equal(canNext(), true, 'the draft is somewhere newer to go');
    assert.equal(next(), 'agg Untitled 1 claim dsev [4]');
    assert.deepEqual(position(), { m: 0, n: 3 });
    assert.equal(canNext(), false, 'and nothing is newer than the draft');
    assert.equal(next(), null);
});

test('a step back out of the draft lands on the newest entry', () => {
    // Not on the second newest. The draft is not a position in the list, so
    // stepping off it is a first step, not a continuation.
    assert.equal(canPrev(''), true);
    assert.equal(prev(''), A);
    assert.deepEqual(position(), { m: 3, n: 3 });
});

test('the draft is held, not spent, so it can be walked back to', () => {
    assert.equal(next(), 'agg Untitled 1 claim dsev [4]');
    resetCursor();
});

test('an edit clears the stash', () => {
    // `resetCursor` is what the editor calls when the reader types. A stash left
    // behind would pop out later as a program nobody asked for.
    assert.equal(prev('agg Draft 1 claim dsev [5]'), A);
    resetCursor();
    assert.equal(canNext(), false, 'no walk in progress and nothing stashed');
    assert.equal(next(), null);
});

test('a build clears the stash', () => {
    const D = 'agg D 1 claim dsev [6]';
    assert.equal(prev('agg Draft 1 claim dsev [7]'), A);
    record(D);
    assert.deepEqual(position(), { m: 4, n: 4 }, 'the build is the newest');
    assert.equal(canNext(), false);
    assert.equal(next(), null, 'the draft is an entry now, or it is gone');
    // Put the store back to three for the caps tests below, which count.
    resetCursor();
});

test('an empty current is text the walk has not visited', () => {
    // The default argument must not read as "showing the newest": a caller that
    // passes nothing gets the newest entry, which is the old behavior and the
    // right one when the editor has been cleared.
    resetCursor();
    assert.equal(prev(), 'agg D 1 claim dsev [6]');
});

test('with no walk in progress, back is live and forward is grey', () => {
    // The state the page lands in, and the state it returns to after a build:
    // there is history behind you and nothing at all in front.
    resetCursor();
    assert.equal(canPrev(''), true, 'an empty box has the whole store behind it');
    assert.equal(canPrev('agg D 1 claim dsev [6]'), true,
        'and so does the box holding the program just built, with one skipped');
    assert.equal(canNext(), false);
});

// ---- The caps. These fill the shared store, so they run last. ----

test('the count cap holds at 500 and keeps the newest end', () => {
    resetCursor();
    for (let i = 0; i < 520; i += 1) record(`agg N${i} 1 claim dsev [1]`);
    const { n } = position();
    assert.equal(n, 500, 'MAX is 500, up from the 20 that froze the readout');
    assert.equal(prev(''), 'agg N519 1 claim dsev [1]', 'and the newest survives');
    resetCursor();
});

test('the character ceiling binds before the count does', () => {
    resetCursor();
    // 300 entries of about 1000 characters is 300KB against a 256KB ceiling, so
    // the sum is what trims here and the count never reaches 500.
    const body = 'x'.repeat(980);
    for (let i = 0; i < 300; i += 1) record(`agg K${i} ${body}`);
    const { n } = position();
    assert.ok(n < 300, `the sum trimmed the oldest end, kept ${n}`);
    assert.ok(n > 200, `and did not overtrim, kept ${n}`);
    assert.equal(prev(''), `agg K299 ${body}`, 'the newest end is what is kept');
});

// The second press of the clear icon. Last in the file: it empties the store
// the tests above spent their run filling.
test('clear empties the store, the readout and the walk', () => {
    resetCursor();
    // Clear the couple of hundred entries the cap tests above left behind, which
    // is the first assertion: it works on a full store, not only a seeded one.
    clear();
    assert.deepEqual(position(), { m: 0, n: 0 },
                     'the store the cap tests filled is gone');

    record(C);
    record(B);
    record(A);
    assert.equal(position().n, 3, 'seeded, so the clear has something to do');

    clear();
    assert.deepEqual(position(), { m: 0, n: 0 },
                     'the readout draws blank at m === 0');
    assert.equal(canPrev(''), false, 'and the walk has nothing to walk');
    assert.equal(canNext(), false);
    assert.equal(prev(''), null, 'a press at either end returns nothing');
});

test('clear takes the stashed draft with it', () => {
    record(A);
    // Step back off a typed draft, which is what stashes it, then clear while
    // the walk is standing on an entry.
    prev('agg Typed 1 claim dsev [9]');
    clear();
    // A surviving stash would surface as a program nobody asked for the next
    // time the reader walked forward, which is the failure `resetCursor` guards
    // against on an edit and this has to guard against too.
    record(B);
    assert.equal(next(), null, 'nothing newer, and no draft to step onto');
});
