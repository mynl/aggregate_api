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
//
// **Every pill is a filter and every filter is a pill.** A row's pills are its
// kind, its topics and its roles; clicking one narrows the list to entries
// carrying it, and the bar above the list shows what is on. There is no
// separate facet UI to design, learn or keep in sync with the pills. The filter
// set is one module-level `Set` shared by both surfaces and persisted per
// viewer, so a filter set in the dropdown is still on in the palette.

import uFuzzy from '@leeoniya/ufuzzy';
import { api } from './api.js';
import { el, empty } from './utils/dom.js';

let cached = null;
let flat = null;      // every entry once, in the library's order
let haystack = null;  // the strings uFuzzy searches, index-aligned with `flat`

// intraMode 1 allows single-character typos/transposition inside a term, which
// is what makes "porfolio" and "distorton" still land.
const uf = new uFuzzy({ intraMode: 1, interLft: 0, interRgt: 0 });

// The active filters, as `ns:value` keys, and the surfaces watching them. Both
// live at module scope because the dropdown, the palette and the Ctrl+Shift
// arrow ring are three views of one list, and a filter that applied to only one
// of them would be a second piece of state to reason about.
const FILTER_KEY = 'aggapi.examples.filters';
const active = new Set(readFilters());
const watchers = new Set();

/**
 * The persisted filter keys, or none.
 *
 * Wrapped because `localStorage` throws rather than returning null in a private
 * window and in a browser configured to block site data. A viewer who cannot
 * store loses a filter, not a menu, so every failure here is an empty set.
 */
function readFilters() {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(FILTER_KEY) || 'null');
        return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
    } catch {
        return [];
    }
}

/** Persist the filter keys, silently doing nothing where storage is refused. */
function writeFilters() {
    try {
        window.localStorage.setItem(FILTER_KEY, JSON.stringify([...active]));
    } catch {
        /* see readFilters: a filter, not a menu */
    }
}

/** Tell every mounted surface the filter set moved. */
function notify() {
    for (const watcher of watchers) watcher();
}

/**
 * Watch the filter set. Returns the function that stops watching.
 *
 * `main.js` uses this to drop the Ctrl+Shift arrow ring's cursor, which indexes
 * into the filtered list and means nothing once that list changes shape.
 */
export function onExamplesFilterChange(fn) {
    watchers.add(fn);
    return () => watchers.delete(fn);
}

/** Turn a pill on or off, persist, and redraw every surface. */
function toggleFilter(ns, value) {
    const key = `${ns}:${value}`;
    if (active.has(key)) active.delete(key);
    else active.add(key);
    writeFilters();
    notify();
}

/** Drop every filter, persist, and redraw. */
function clearFilters() {
    if (!active.size) return;
    active.clear();
    writeFilters();
    notify();
}

/** Fetch (and memoize) the example payload. */
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

/**
 * `items` narrowed to those carrying every namespace in `keys`, in file order.
 *
 * OR within a namespace and AND across them, which is what makes "advanced
 * reinsurance" and "intro or intermediate" both expressible. Filtering hides
 * rows and never reorders what remains, so a reader who has learned where
 * something lives keeps that knowledge with a filter on.
 *
 * @param {Array} items entries carrying `pills`, in the library's order.
 * @param {Iterable<string>} keys active filters as `ns:value`.
 *
 * Pure, and exported for that reason: the composition rule is the whole of what
 * a pill click means, and it is worth a test that needs no DOM.
 */
export function applyFilters(items, keys) {
    const wanted = new Map();
    for (const key of keys) {
        const at = key.indexOf(':');
        if (at < 1) continue;  // a stored key from an older shape, or junk
        const ns = key.slice(0, at);
        if (!wanted.has(ns)) wanted.set(ns, new Set());
        wanted.get(ns).add(key.slice(at + 1));
    }
    if (!wanted.size) return items;
    return items.filter((item) => {
        for (const [ns, values] of wanted) {
            const hit = (item.pills || []).some(
                (p) => p.ns === ns && values.has(p.value));
            if (!hit) return false;
        }
        return true;
    });
}

/**
 * The entries passing the active filters, in file order.
 *
 * Exported for the Ctrl+Shift arrow ring, which walks the dropdown read top to
 * bottom and so has to walk what the dropdown is actually showing.
 */
export function filteredExamples() {
    if (!flat) return [];
    return active.size ? applyFilters(flat, active) : flat;
}

/**
 * Entries matching `needle` within the filtered set, best first.
 *
 * Pills narrow, search ranks within what is left. Ranking runs over the whole
 * haystack and the survivors are kept, rather than rebuilding a haystack per
 * filter change: 151 rows makes the difference unmeasurable, and one index that
 * never moves is one fewer thing to keep aligned with `flat`.
 */
function search(needle) {
    const pool = filteredExamples();
    const q = needle.trim();
    if (!q) return pool;
    const [idxs, info, order] = uf.search(haystack, q);
    if (!idxs) return [];
    // `order` ranks by match quality when uFuzzy returns the extra passes;
    // fall back to the raw index order when it does not.
    const ranked = (order && info) ? order.map((o) => info.idx[o]) : idxs;
    const allowed = new Set(pool);
    return ranked.map((i) => flat[i]).filter((item) => allowed.has(item));
}

/**
 * One pill: the value, colored by its namespace, clickable as a filter.
 *
 * The text inside the pill is the value, so a reader who cannot separate the
 * three hues still reads `advanced`. Nothing here carries meaning by color
 * alone.
 *
 * Two values repeat across namespaces today: `topic:pnl` sits on all eight
 * `pnl` entries and `topic:distortion` on all six `distortion` ones, so those
 * rows draw the same word twice. The library owns its vocabulary and the app
 * draws what it is served; the redundant tags come out of `library.agg`
 * upstream.
 */
function pill(ns, value, { count = null, on = false } = {}) {
    return el('button', {
        type: 'button',
        className: `pill pill-${ns}${on ? ' is-on' : ''}`,
        title: on ? `stop filtering on ${ns} ${value}` : `filter on ${ns} ${value}`,
        onClick: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            toggleFilter(ns, value);
        },
    },
        count == null ? value : `${value} ${count}`,
        on ? el('span', { className: 'pill-x' }, '×') : null);
}

/**
 * One row of the list: the name, the note, and the pills.
 *
 * Three lines, nothing right aligned, so the row has one clean left edge and a
 * long name never collides with anything. The pills sit outside the anchor
 * rather than inside it, because a button nested in a link is neither valid nor
 * clickable without the link swallowing the press; the whole `<li>` is the row
 * and it highlights as one.
 *
 * The note is clamped to three lines with the full text on `title`. The longest
 * in the library is a 320 character citation, which is five or six lines in a
 * dropdown, and the Ctrl+K palette is wide enough to show it whole.
 */
function row(item, onPick) {
    const node = el('li', { className: 'example-item' },
        el('a', {
            className: 'dropdown-item example-row',
            href: '#',
            title: item.note || item.kind || '',
            onClick: (ev) => { ev.preventDefault(); onPick?.(item); },
        },
            el('span', { className: 'example-name' }, item.name),
            item.note ? el('span', { className: 'example-note' }, item.note) : null));
    const pills = item.pills || [];
    if (pills.length) {
        node.appendChild(el('div', { className: 'example-pills' },
            pills.map((p) => pill(p.ns, p.value, {
                on: active.has(`${p.ns}:${p.value}`),
            }))));
    }
    return node;
}

/**
 * The bar of active filters, or null when nothing is on.
 *
 * Each active pill carries its own count off the payload's facets, so the bar
 * says what a filter is worth as well as that it is on, and the running total
 * says what the combination left. Both are presentation off numbers the payload
 * already carries.
 */
function filterBar(payload) {
    if (!active.size) return null;
    const counts = new Map();
    for (const [ns, values] of Object.entries(payload.facets || {})) {
        for (const facet of values) counts.set(`${ns}:${facet.value}`, facet.count);
    }
    const bar = el('div', { className: 'example-filters' });
    for (const key of active) {
        const at = key.indexOf(':');
        bar.appendChild(pill(key.slice(0, at), key.slice(at + 1), {
            count: counts.get(key), on: true,
        }));
    }
    bar.appendChild(el('span', { className: 'example-shown' },
        `${filteredExamples().length} of ${(payload.items || []).length}`));
    bar.appendChild(el('button', {
        type: 'button', className: 'example-clear',
        onClick: (ev) => { ev.preventDefault(); clearFilters(); },
    }, 'clear'));
    return bar;
}

/**
 * Render results into a container: the library in file order when idle, ranked
 * when searching, narrowed either way by the active pills.
 *
 * No headings and no dividers. The `# ---` banners in `library.agg` are
 * comments, nothing in `aggregate` parses them, and inventing headings here is
 * the app deciding what the library means. File order is what the file carries,
 * so file order is what this draws.
 */
function renderList(container, payload, needle, onPick) {
    empty(container);
    const q = needle.trim();
    const bar = filterBar(payload);
    if (bar) container.appendChild(el('li', {}, bar));

    const hits = search(q);
    if (!hits.length) {
        // An empty list with an invisible cause is the one bad state this design
        // can reach, so say which of the two emptied it and offer the way out.
        const why = q ? `no example matches “${q}”` : 'no example carries every filter';
        container.appendChild(el('li', {}, el('span', {
            className: 'dropdown-item-text text-muted small',
        },
            active.size ? `${why} with these filters. ` : why,
            active.size ? el('a', {
                href: '#',
                onClick: (ev) => { ev.preventDefault(); clearFilters(); },
            }, 'Clear them') : null)));
        return;
    }
    if (q) {
        container.appendChild(el('li', {}, el('h6', { className: 'dropdown-header' },
            `${hits.length} match${hits.length === 1 ? '' : 'es'}`)));
    }
    for (const item of hits) container.appendChild(row(item, onPick));
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
    const draw = () => renderList(list, payload, input.value, onPick);
    input.addEventListener('input', draw);
    // Keystrokes inside a dropdown otherwise reach Bootstrap's own item
    // navigation, which steals the arrow keys and closes on Escape mid-word.
    input.addEventListener('keydown', (ev) => ev.stopPropagation());
    // A pill clicked in the palette has to move this list too.
    onExamplesFilterChange(draw);

    menuEl.appendChild(el('li', { className: 'example-search-wrap' }, input));
    menuEl.appendChild(el('li', {}, list));
    draw();

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
        const draw = () => renderList(list, payload, input.value, pick);
        input.addEventListener('input', draw);
        // A pill clicked in the dropdown has to move this list too.
        onExamplesFilterChange(draw);
        root = el('div', { className: 'palette-backdrop', role: 'dialog', 'aria-modal': 'true' },
            el('div', { className: 'palette' }, input, list));
        // Click outside closes; clicks on the panel itself must not.
        root.addEventListener('mousedown', (ev) => { if (ev.target === root) close(); });
        document.body.appendChild(root);
        draw();
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
