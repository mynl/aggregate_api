// The Apps menu renderer, under `node --test`.
//
// Run: `npm test` from `web/`.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appsMenuHtml } from '../src/apps-menu.js';

const ASP = {
    name: 'asp',
    title: 'agg Structure Pentagon',
    description: 'reinsurance structure and pricing on one pentagon',
    url: '/asp/',
};

test('one link per app, title and description, same tab', () => {
    const demo = { name: 'demo', title: 'Demo', description: 'a stand-in', url: '/demo/' };
    const html = appsMenuHtml([ASP, demo]);
    assert.equal((html.match(/<li>/g) || []).length, 2);
    assert.match(html, /<a class="dropdown-item" href="\/asp\/">agg Structure Pentagon<small class="d-block text-muted">reinsurance structure and pricing on one pentagon<\/small><\/a>/);
    assert.match(html, /href="\/demo\/">Demo<small/);
    assert.doesNotMatch(html, /target=/);
    assert.ok(html.indexOf('/asp/') < html.indexOf('/demo/'), 'the server order is kept');
});

test('title and description are escaped', () => {
    const html = appsMenuHtml([{
        name: 'x', title: '<b>"T" & co</b>', description: '<script>alert(1)</script>', url: '/x/',
    }]);
    assert.match(html, /&lt;b&gt;&quot;T&quot; &amp; co&lt;\/b&gt;/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>|<b>/);
});

test('no description, no second line; no title, the name', () => {
    const html = appsMenuHtml([{ name: 'plain', title: '', description: '', url: '/plain/' }]);
    assert.equal(html, '<li><a class="dropdown-item" href="/plain/">plain</a></li>');
});

test('nothing for an empty or missing list', () => {
    assert.equal(appsMenuHtml([]), '');
    assert.equal(appsMenuHtml(undefined), '');
});
