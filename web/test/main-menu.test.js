// The hamburger menu's order, under `node --test`.
//
// Run: `npm test` from `web/`.
//
// The menu is static markup in `index.html`, so its order is read off the file
// rather than a DOM: each landmark's offset in the source is where it sits in
// the menu. Since 1.33.0 Tables, Perspective and Editor sit collapsed under
// Preferences, after Apps and before Help, so the menu fits a phone.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const menuStart = html.indexOf('main-menu');
// The menu's own `</ul>` is the one followed by the dropdown's `</div>`; the
// Preferences group's inner list closes into `</li>` instead.
const menuEnd = menuStart + html.slice(menuStart).search(/<\/ul>\s*<\/div>/);
const menu = html.slice(menuStart, menuEnd);

test('the menu markup is found', () => {
    assert.ok(menuStart > 0 && menuEnd > menuStart);
    assert.ok(!menu.includes('id="nav-perspective"'), 'the slice is the menu alone');
});

/** Offset of `needle` in the menu markup, failing when it is absent. */
function at(needle) {
    const i = menu.indexOf(needle);
    assert.notEqual(i, -1, `menu has no ${needle}`);
    return i;
}

const header = (label) => at(`<h6 class="dropdown-header">${label}</h6>`);

test('the menu runs Copy link, Examples, Apps, Preferences, then Help', () => {
    const order = [
        at('id="copy-link-item"'),
        header('Examples from'),
        header('Apps'),
        at('id="prefs-toggle"'),
        at('data-bs-target="#helpPanel"'),
        at('data-bs-target="#aboutPanel"'),
    ];
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('Tables, Perspective and Editor sit inside the collapsed Preferences group', () => {
    const open = at('<li id="prefs-group" hidden>');
    const close = menu.indexOf('</ul></li>', open);
    assert.ok(close > open, 'the group closes');
    for (const label of ['Tables', 'Perspective', 'Editor']) {
        const i = header(label);
        assert.ok(open < i && i < close, `${label} is inside the group`);
    }
    assert.ok(at('id="prefs-toggle"') < open, 'the row comes before its group');
});

test('the Preferences row names its group and starts collapsed', () => {
    const row = menu.slice(at('id="prefs-toggle"'), at('<li id="prefs-group"'));
    assert.match(row, /aria-expanded="false"/);
    assert.match(row, /aria-controls="prefs-group"/);
    assert.match(row, /<span>Preferences<\/span>/);
});
