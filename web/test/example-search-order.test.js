// The search order, under `node --test`.
//
// `applyFilters` has its own file and covers the pills; this covers the other
// half of what decides the list on screen, and the half the Ctrl+Shift arrow
// ring walks whenever a needle is live.
//
// The property is one sentence: rank where the query discriminates, the
// library's order where it does not. uFuzzy's default sort ends in a locale
// compare of the haystack string, which begins with the entry's name, so before
// a138 a query that scored every hit identically came back alphabetical. That is
// not an edge case. On the shipped payload "capstone" returns eleven hits with
// one distinct score between them, every field equal, because each is named
// `Capstone.*` and the haystack opens with the name; "pnl" returns a tie block
// of twelve. Both are families written as a reading order and both arrived
// shuffled.
//
// These assertions go through `rankMatches`, which is the app's own uFuzzy
// instance, so the options under test are the shipped ones rather than a copy.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rankMatches } from '../src/examples.js';

/** The haystack string `buildIndex` makes: name, kind, tags, note. */
function hay(name, kind, tags, note) {
    return `${name} ${kind} ${tags.join(' ')} ${note}`;
}

// The capstone run as `library.agg` writes it, names and all. Deliberately not
// alphabetical, and deliberately real: the whole point is that these eleven
// score identically, which depends on every one of them being named
// `Capstone.*` so the match sits at offset 0 in each haystack.
const CAPSTONE_NAMES = [
    'Capstone.Sev', 'Capstone.Gross', 'Capstone.ExposureRating',
    'Capstone.SelectedLosses', 'Capstone.LossPicksTest', 'Capstone.XOL',
    'Capstone.XOL.PnL', 'Capstone.FullProgram', 'Capstone.PnL', 'Capstone.PC',
    'Capstone.GrossNet',
];
const CAPSTONE = CAPSTONE_NAMES.map((name) => hay(
    name, 'agg', ['topic:capstone', 'role:advanced'],
    'One step of the capstone worked example.'));

test('a query every hit scores the same on keeps the library order', () => {
    assert.deepEqual(rankMatches(CAPSTONE, 'capstone'),
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('the alphabet does not get a say once the scores tie', () => {
    // The failing order this replaced, and worth naming: it is what the reader
    // reported, and a regression would land back on exactly it.
    const alphabetical = [...CAPSTONE_NAMES].sort()
        .map((n) => CAPSTONE_NAMES.indexOf(n));
    assert.notDeepEqual(rankMatches(CAPSTONE, 'capstone'), alphabetical);
});

test('ranking still ranks, and still overrules the library order', () => {
    // uFuzzy scores a word standing on its own above the same letters welded
    // into a longer one, so the second row leads on merit. That judgment is
    // uFuzzy's and this change does not touch it: the tiebreak only runs when
    // every criterion above it has tied, and here `interLft2` separates them.
    const rows = [
        hay('ReinsuranceOccurrenceTower', 'agg', ['topic:reinsurance'],
            'An occurrence program written as a tower.'),
        hay('SomethingElse', 'agg', ['topic:reinsurance'],
            'Mentions the tower construction in passing.'),
    ];
    assert.deepEqual(rankMatches(rows, 'tower'), [1, 0]);
});

test('terms in either order reach the same entry, still ranked', () => {
    const rows = [
        hay('PlainAggregate', 'agg', ['topic:aggregate'], 'Nothing to see.'),
        hay('ReinsuranceOccurrenceTower', 'agg', ['topic:reinsurance'],
            'An occurrence program written as a tower.'),
    ];
    assert.deepEqual(rankMatches(rows, 'reins tower'), [1]);
    assert.deepEqual(rankMatches(rows, 'tower reins'), [1]);
});

test('no match is an empty list, not the whole haystack', () => {
    assert.deepEqual(rankMatches(CAPSTONE, 'nosuchthing'), []);
});

test('a tie block inside a ranked result keeps the library order', () => {
    // The shape the shipped `pnl` query has, in miniature, and the one that
    // matters: a row that outranks the rest still leads, and the block that
    // scored equal behind it reads `PnLSimple`, `PnLBook`, `PnLVector`, which is
    // the order the file teaches them in and not the alphabet's `PnLBook` first.
    const rows = [
        hay('PnLSimple', 'pnl', ['topic:pnl'], 'The first PnL.'),
        hay('PnLBook', 'pnl', ['topic:pnl'], 'A book of business.'),
        hay('PnLVector', 'pnl', ['topic:pnl'], 'Vector picks.'),
        hay('AardvarkAccount', 'agg', ['topic:retro'], 'Has a PnL view.'),
    ];
    assert.deepEqual(rankMatches(rows, 'pnl'), [3, 0, 1, 2]);
});
