// The service worker's scope rule, under `node --test`.
//
// Run: `npm test` from `web/`.
//
// `sw.js` is a classic worker script, not a module, so it is loaded into a
// `node:vm` context with a stub `self`. Its top-level function declarations
// land on that context, which is how `isShellPath` is reached.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const ORIGIN = 'https://agg.example';

function loadWorker() {
    const listeners = {};
    const context = vm.createContext({
        URL,
        self: {
            location: { origin: ORIGIN },
            addEventListener: (type, handler) => { listeners[type] = handler; },
            skipWaiting: () => {},
        },
    });
    const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
    vm.runInContext(source, context);
    return { context, listeners };
}

const { context, listeners } = loadWorker();

test('the shell is the worker\'s business', () => {
    for (const path of ['/', '/index.html', '/lite.html', '/favicon.ico',
        '/site.webmanifest', '/assets/index-abc.js']) {
        assert.equal(context.isShellPath(path), true, path);
    }
});

test('the API, the add-in, the docs and other front ends are not', () => {
    for (const path of ['/v1/meta', '/v1/objects', '/asp/', '/asp', '/asp/js/main.js',
        '/excel/manifest.xml', '/docs', '/openapi.json', '/dev/spacemouse-probe.html']) {
        assert.equal(context.isShellPath(path), false, path);
    }
});

test('a request outside the shell passes through untouched', () => {
    let answered = false;
    listeners.fetch({
        request: { method: 'GET', mode: 'no-cors', url: `${ORIGIN}/asp/js/main.js` },
        respondWith: () => { answered = true; },
    });
    assert.equal(answered, false);
});

test('the cache version moved, so the old rule\'s entries are dropped', () => {
    assert.equal(vm.runInContext('CACHE_VERSION', context), 'agg-pwa-v3');
});
