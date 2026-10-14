// The deep link parse, under `node --test`.
//
// A link printed beside a figure in a paper has to keep working for as long as
// the paper is read, so the two pure halves are pinned here: reading
// `?database=<stem>&example=<name>&view=<group>:<leaf>` out of a query string,
// and taking exactly those three parameters back out of the address bar while
// leaving every other one (`?full=1`, `?lite=1`) where it was. How `view`
// resolves to a tab is `view-link.test.js`.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkFor, readDeepLink, withoutDeepLink } from '../src/examples.js';

test('both parameters', () => {
    assert.deepEqual(readDeepLink('?database=aas-paper&example=Fig3'),
        { database: 'aas-paper', example: 'Fig3', view: null });
});

test('either parameter alone', () => {
    assert.deepEqual(readDeepLink('?database=reproductions'),
        { database: 'reproductions', example: null, view: null });
    assert.deepEqual(readDeepLink('?example=BasicBook'),
        { database: null, example: 'BasicBook', view: null });
});

test('neither parameter is no link', () => {
    assert.equal(readDeepLink(''), null);
    assert.equal(readDeepLink('?full=1'), null);
    assert.equal(readDeepLink('?database=&example='), null);
    assert.equal(readDeepLink(undefined), null);
});

test('a dotted name needs no escaping, and an escaped one arrives decoded', () => {
    assert.equal(readDeepLink('?example=Bear1990.BN.One').example, 'Bear1990.BN.One');
    assert.equal(readDeepLink('?example=Bear1990%2EBN%2EOne').example, 'Bear1990.BN.One');
    assert.equal(readDeepLink('?example=A%20B').example, 'A B');
});

test('the leading question mark is optional and other parameters are ignored', () => {
    assert.deepEqual(readDeepLink('lite=1&database=x&example=y'),
        { database: 'x', example: 'y', view: null });
});

test('surrounding whitespace from a pasted link is dropped', () => {
    assert.deepEqual(readDeepLink('?database=%20reproductions%20&example=Fig3%0A'),
        { database: 'reproductions', example: 'Fig3', view: null });
});

test('view alone is a link, and rides beside the other two', () => {
    assert.deepEqual(readDeepLink('?view=pnl:pentagon'),
        { database: null, example: null, view: 'pnl:pentagon' });
    assert.deepEqual(readDeepLink('?database=library&example=Capstone.Capped&view=pnl%3Apentagon'),
        { database: 'library', example: 'Capstone.Capped', view: 'pnl:pentagon' });
    assert.equal(readDeepLink('?view=%20'), null);
});

test('clearing removes the three link parameters and keeps the rest', () => {
    assert.equal(withoutDeepLink('http://h/?database=r&example=E'), '/');
    assert.equal(withoutDeepLink('http://h/app/?full=1&database=r&example=E#x'),
        '/app/?full=1#x');
    assert.equal(withoutDeepLink('http://h/lite.html?lite=1&example=E'),
        '/lite.html?lite=1');
    assert.equal(withoutDeepLink('http://h/?full=1&view=pnl:pentagon'), '/?full=1');
});

test('a copied link reads back as the parameters it was written from', () => {
    const roundTrip = (base, link) => readDeepLink(new URL(linkFor(base, link)).search);
    for (const link of [
        { database: 'library', example: 'Capstone.Capped', view: 'economics:pentagon' },
        { database: 'reproductions', example: 'A name with a space', view: 'overview:plot' },
        { database: 'library', example: 'BasicBook', view: null },
    ]) {
        assert.deepEqual(roundTrip('https://agg.mynl.com/', link), link);
    }
});

test('a copied link drops the base query and hash and keeps its path', () => {
    const href = linkFor('http://127.0.0.1:8001/app/?full=1#x',
        { database: 'library', example: 'BasicBook', view: 'pnl:pentagon' });
    const url = new URL(href);
    assert.equal(url.pathname, '/app/');
    assert.equal(url.hash, '');
    assert.equal(url.searchParams.get('full'), null);
    assert.equal(href,
        'http://127.0.0.1:8001/app/?database=library&example=BasicBook&view=pnl%3Apentagon');
});
