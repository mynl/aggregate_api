// The examples picker: the library in its own reading order, and the same list
// as a wider Ctrl+K palette.
//
// `library.agg` is written as a reading order and the entries inside a part
// build on one another. Through a121 none of that reached here: the server
// grouped on the topic namespace, ordered the groups by a hand kept tuple and
// sorted by name inside each one, so the list was neither the file's order nor
// a teaching order. It is now one flat list in the file's own order, with no
// headings at all, and the payload arrives ordered so nothing here re-sorts.
//
// Two surfaces off one payload:
//
//   * the dropdown, with a search box pinned at its top;
//   * Ctrl+K, the same rows full width with more room for the note.
//
// Both filter through uFuzzy over `name + kind + tags + note`, so "cat xol",
// "reins tower" and "ilw" all reach the same entry. Search results are ranked
// rather than file-ordered, because a ranked list that keeps file order is not
// ranked.

import uFuzzy from '@leeoniya/ufuzzy';
import { api } from './api.js';
import { el, empty } from './utils/dom.js';

let cached = null;
let flat = null;      // every entry once, with its haystack line
let haystack = null;  // the strings uFuzzy searches, index-aligned with `flat`

// intraMode 1 allows single-character typos/transposition inside a term, which
// is what makes "porfolio" and "distorton" still land.
const uf = new uFuzzy({ intraMode: 1, interLft: 0, interRgt: 0 });

/** Fetch (and memoize) the grouped example payload. */
export async function loadExamples() {
    if (!cached) {
        cached = await api.examples();
        buildIndex(cached);
    }
    return cached;
}

/**
 * Build the search index over the payload, in the payload's own order.
 *
 * The dedup by name that stood here is gone with the grouped payload: the
 * server emitted an entry once per topic tag, 182 rows for 151 entries, and
 * this had to collapse them again. Each entry now arrives exactly once, so the
 * list is the payload and the order is the library's.
 */
function buildIndex(payload) {
    flat = payload.items || [];
    // Tags keep their namespace so "topic:reinsurance" and "reinsurance" both
    // match, and the note is included so a search can be about the subject
    // rather than the name.
    haystack = flat.map((i) =>
        `${i.name} ${i.kind} ${(i.tags || []).join(' ')} ${i.note || ''}`);
}

/** Entries matching `needle`, best first; everything when the needle is empty. */
function search(needle) {
    const q = needle.trim();
    if (!q) return flat;
    const [idxs, info, order] = uf.search(haystack, q);
    if (!idxs) return [];
    // `order` ranks by match quality when uFuzzy returns the extra passes;
    // fall back to the raw index order when it does not.
    const ranked = (order && info) ? order.map((o) => info.idx[o]) : idxs;
    return ranked.map((i) => flat[i]);
}

/** One clickable row: name, kind badge, and the note as a blurb. */
function row(item, onPick, className = 'dropdown-item example-row') {
    return el('a', {
        className,
        href: '#',
        title: item.note || item.kind || '',
        onClick: (ev) => { ev.preventDefault(); onPick?.(item); },
    },
        el('span', { className: 'example-name' }, item.name),
        el('span', { className: 'example-kind' }, item.kind),
        item.note ? el('span', { className: 'example-note' }, item.note) : null);
}

/**
 * Render results into a container: the library in file order when idle, ranked
 * when searching.
 *
 * No headings and no dividers. The `# ---` banners in `library.agg` are
 * comments, nothing in `aggregate` parses them, and inventing headings here is
 * the app deciding what the library means. File order is what the file carries,
 * so file order is what this draws.
 */
function renderList(container, payload, needle, onPick, rowClass) {
    empty(container);
    const q = needle.trim();

    if (!q) {
        for (const item of payload.items || []) {
            container.appendChild(el('li', {}, row(item, onPick, rowClass)));
        }
        return;
    }

    const hits = search(q);
    if (!hits.length) {
        container.appendChild(el('li', {}, el('span', {
            className: 'dropdown-item-text text-muted small',
        }, `no example matches “${q}”`)));
        return;
    }
    container.appendChild(el('li', {}, el('h6', { className: 'dropdown-header' },
        `${hits.length} match${hits.length === 1 ? '' : 'es'}`)));
    for (const item of hits) {
        container.appendChild(el('li', {}, row(item, onPick, rowClass)));
    }
}

/** Populate the dropdown menu element with a pinned search box + the list. */
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
    const list = el('div', { className: 'example-list' });
    const input = el('input', {
        type: 'search',
        className: 'form-control form-control-sm example-search',
        placeholder: `search ${(payload.items || []).length} examples…`,
        autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: false,
    });
    input.addEventListener('input', () => renderList(list, payload, input.value, onPick));
    // Keystrokes inside a dropdown otherwise reach Bootstrap's own item
    // navigation, which steals the arrow keys and closes on Escape mid-word.
    input.addEventListener('keydown', (ev) => ev.stopPropagation());

    menuEl.appendChild(el('li', { className: 'example-search-wrap' }, input));
    menuEl.appendChild(el('li', {}, list));
    renderList(list, payload, '', onPick);

    // Focus the box when the menu opens, so the dropdown is type-to-find.
    const toggle = menuEl.previousElementSibling;
    if (toggle) {
        toggle.addEventListener('shown.bs.dropdown', () => input.focus());
    }
}

/**
 * The Ctrl+K palette: the same rows, full width, with room for the note.
 *
 * Built once and reused, because it holds the whole library and rebuilding the
 * list on every open is wasted work.
 */
export function mountPalette(onPick) {
    let root = null;
    let input = null;
    let list = null;

    async function ensure() {
        if (root) return true;
        let payload;
        try {
            payload = await loadExamples();
        } catch {
            return false;
        }
        list = el('div', { className: 'example-list palette-list' });
        input = el('input', {
            type: 'search',
            className: 'form-control example-search',
            placeholder: 'search the library…',
            autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: false,
        });
        const pick = (item) => { close(); onPick?.(item); };
        input.addEventListener('input', () => renderList(list, payload, input.value, pick));
        root = el('div', { className: 'palette-backdrop', role: 'dialog', 'aria-modal': 'true' },
            el('div', { className: 'palette' }, input, list));
        // Click outside closes; clicks on the panel itself must not.
        root.addEventListener('mousedown', (ev) => { if (ev.target === root) close(); });
        document.body.appendChild(root);
        renderList(list, payload, '', pick);
        return true;
    }

    function close() {
        if (root) root.classList.remove('open');
    }

    async function open() {
        if (!(await ensure())) return;
        root.classList.add('open');
        input.value = '';
        renderList(list, cached, '', (item) => { close(); onPick?.(item); });
        input.focus();
    }

    document.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
            ev.preventDefault();
            open();
        } else if (ev.key === 'Escape' && root && root.classList.contains('open')) {
            close();
        }
    });

    return { open, close };
}
