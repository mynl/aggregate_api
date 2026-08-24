// The pill filter composition, under `node --test`.
//
// Every pill on an example row is a filter and every active filter is a pill,
// so `applyFilters` is the whole of what a click means. The two properties it
// has to hold are the ones a reader would state in words: two roles is "either
// role", while a role and a topic is "both". Getting that backwards would make
// "intro or intermediate" return nothing and "advanced reinsurance" return the
// union, and neither failure announces itself on screen: the list just reads
// wrong.
//
// Order is the third property and it is the one the whole plan is about. The
// library is written as a reading order, so filtering may hide rows and must
// never move the ones that remain.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyFilters } from '../src/examples.js';

/** One row, in the shape the payload serves. */
function item(name, kind, ...tags) {
    return {
        name,
        kind,
        pills: [
            { ns: 'kind', value: kind },
            ...tags.map((t) => {
                const at = t.indexOf(':');
                return { ns: t.slice(0, at), value: t.slice(at + 1) };
            }),
        ],
    };
}

// Deliberately not alphabetical: this stands in for the library's reading
// order, and every assertion below reads it as given.
const LIBRARY = [
    item('Zeroth', 'agg', 'topic:aggregate', 'role:intro'),
    item('First', 'sev', 'topic:severity', 'role:reference'),
    item('Second', 'agg', 'topic:reinsurance', 'role:advanced'),
    item('Third', 'port', 'topic:portfolio', 'topic:reinsurance', 'role:advanced'),
    item('Fourth', 'agg', 'topic:aggregate', 'role:intermediate'),
];

const names = (rows) => rows.map((r) => r.name);

test('no filters is the whole list, and the identical array', () => {
    assert.equal(applyFilters(LIBRARY, []), LIBRARY);
    assert.equal(applyFilters(LIBRARY, new Set()), LIBRARY);
});

test('two values in one namespace is their union', () => {
    const got = applyFilters(LIBRARY, ['role:intro', 'role:intermediate']);
    assert.deepEqual(names(got), ['Zeroth', 'Fourth']);
});

test('values in two namespaces is their intersection', () => {
    const got = applyFilters(LIBRARY, ['role:advanced', 'kind:port']);
    assert.deepEqual(names(got), ['Third']);
});

test('the two rules compose: OR inside, AND across', () => {
    // Either advanced role, but only among the aggregates: `Third` is advanced
    // and drops on its kind, `Zeroth` is an aggregate and drops on its role.
    const got = applyFilters(
        LIBRARY, ['role:advanced', 'role:intermediate', 'kind:agg']);
    assert.deepEqual(names(got), ['Second', 'Fourth']);
});

test('an entry carrying two values in one namespace matches on either', () => {
    // `Third` is filed under both portfolio and reinsurance.
    assert.deepEqual(names(applyFilters(LIBRARY, ['topic:portfolio'])), ['Third']);
    assert.deepEqual(names(applyFilters(LIBRARY, ['topic:reinsurance'])),
        ['Second', 'Third']);
});

test('filtering hides rows and never reorders what remains', () => {
    const got = applyFilters(LIBRARY, ['kind:agg']);
    assert.deepEqual(names(got), ['Zeroth', 'Second', 'Fourth']);
    // The same names read out of the unfiltered list in the same order.
    assert.deepEqual(names(got), names(LIBRARY).filter(
        (n) => new Set(names(got)).has(n)));
});

test('a combination nothing carries is empty, not everything', () => {
    assert.deepEqual(applyFilters(LIBRARY, ['kind:sev', 'role:intro']), []);
});

test('an unknown value narrows to nothing rather than being ignored', () => {
    assert.deepEqual(applyFilters(LIBRARY, ['topic:nosuchtopic']), []);
});

test('a junk stored key is skipped, so a stale localStorage costs no menu', () => {
    // Persisted filters are read back from a viewer's browser and nothing
    // guarantees they still parse: a key with no namespace is dropped rather
    // than matched against a namespace called ''.
    assert.equal(applyFilters(LIBRARY, ['advanced']), LIBRARY);
    assert.deepEqual(names(applyFilters(LIBRARY, ['advanced', 'kind:port'])),
        ['Third']);
});

test('a row with no pills survives only an empty filter set', () => {
    const bare = [{ name: 'Bare', kind: 'agg' }];
    assert.equal(applyFilters(bare, []), bare);
    assert.deepEqual(applyFilters(bare, ['kind:agg']), []);
});
