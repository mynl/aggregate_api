// Examples dropdown, loaded once from /v1/examples.
//
// The api returns the library grouped on one axis (topic by default) as
// categories of {key, title, items}, each item {name, kind, tags, note, decl}.
// A category header per group, one entry per example; clicking loads the DecL
// into the editor without building.
//
// `note` is optional. Most library entries carry one and it is preferred, but
// an entry without a note is ordinary, so the title attribute simply falls back
// to the kind rather than showing an empty tooltip.

import { api } from './api.js';
import { el, empty } from './utils/dom.js';

let cached = null;

/** Fetch (and memoize) the grouped example payload. */
export async function loadExamples() {
    if (!cached) cached = await api.examples();
    return cached;
}

/** Populate the dropdown menu element. */
export async function mountExamples(menuEl, onPick) {
    let payload;
    try {
        payload = await loadExamples();
    } catch (err) {
        empty(menuEl);
        menuEl.appendChild(el('li', {}, el('span', {
            className: 'dropdown-item-text text-danger small',
        }, `failed to load examples: ${err.message}`)));
        return;
    }

    empty(menuEl);
    const categories = payload.categories || [];

    if (!categories.length) {
        menuEl.appendChild(el('li', {}, el('span', {
            className: 'dropdown-item-text text-muted small',
        }, 'no examples')));
        return;
    }

    let first = true;
    for (const cat of categories) {
        if (!first) {
            menuEl.appendChild(el('li', {}, el('hr', { className: 'dropdown-divider' })));
        }
        first = false;
        menuEl.appendChild(el('li', {}, el('h6', {
            className: 'dropdown-header',
        }, cat.title)));

        for (const item of cat.items || []) {
            const a = el('a', {
                className: 'dropdown-item',
                href:      '#',
                title:     item.note || item.kind || '',
                onClick:   (ev) => {
                    ev.preventDefault();
                    onPick?.(item);
                },
            }, item.name);
            menuEl.appendChild(el('li', {}, a));
        }
    }
}
