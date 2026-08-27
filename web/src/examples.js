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
// Both filter through uFuzzy over `name + kind + tags + note`, with the terms
// in any order, so "cat xol", "reins tower" and "tower reins" all reach the
// entry they describe. Search results are ranked rather than file-ordered,
// because a ranked list that keeps file order is not ranked. Entries that score
// *equal* keep the library's order, which is a different thing and the common
// case: see `sortByRankThenFileOrder`.
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
let loading = null;   // the fetch in flight, so concurrent callers share one
let flat = null;      // every entry once, in the library's order
let haystack = null;  // the strings uFuzzy searches, index-aligned with `flat`

/**
 * uFuzzy's own ranking chain with the library's order as the tiebreak.
 *
 * Copied comparator for comparator from uFuzzy's default `sort`, with one line
 * changed: where it ends `compare(haystack[idx[a]], haystack[idx[b]])`, a locale
 * string compare, this ends `idx[a] - idx[b]`. `haystack` is index-aligned with
 * `flat` and `flat` arrives in the library's reading order, so the haystack
 * index *is* the position in `library.agg` and the tail reads "and if they
 * scored the same, the order the file puts them in".
 *
 * **Ranking is untouched.** Every criterion above the tail is uFuzzy's, in
 * uFuzzy's order, so a query that discriminates ranks exactly as it did: "reins"
 * and "tower" return what they returned. Only exact ties move.
 *
 * **Exact ties are the common case, and they were being alphabetized.** Measured
 * on the shipped payload of 195 entries: "capstone" returns 11 hits with *one*
 * distinct score signature between them, every field equal, `start` 0 for all
 * eleven because each is named `Capstone.*` and the haystack opens with the
 * name. So nothing in the ranking had an opinion and the alphabetic tail decided
 * the whole list, handing back file positions 14, 19, 13, 22, 16, 21, 20, 15,
 * 12, 17, 18 for what the file writes as a contiguous run, 12 through 22. "pnl"
 * is the same wound on a family written as a graded sequence: positions 4
 * through 15 of its result are one tie block of twelve, alphabetized to
 * `PnLBook` first and `PnLSimple` eleventh, where the library teaches
 * `PnLSimple` first and `PnLBook` last.
 *
 * The header note above, that a ranked list keeping file order is not ranked,
 * still holds and is still the design. A block of exact ties was never ranked
 * to begin with, it was alphabetized, and the library's order is the better
 * answer: the entries inside a part build on one another, so a reader who typed
 * a family name and walks the result with Ctrl+Shift+arrow walks the argument
 * in the order it is made.
 *
 * @param {object} info uFuzzy's per-match fields for this pass.
 * @returns {number[]} positions into `info.idx`, best first.
 */
function sortByRankThenFileOrder(info) {
    const {
        idx, chars, terms, interLft2, interLft1, start, intraIns, interIns, cases,
    } = info;
    return idx.map((v, i) => i).sort((a, b) => (
        // most contiguous chars matched
        chars[b] - chars[a] ||
        // least intra-term fuzz
        intraIns[a] - intraIns[b] ||
        // most prefix bounds, boosted by whole-term matches
        (
            (terms[b] + interLft2[b] + 0.5 * interLft1[b]) -
            (terms[a] + interLft2[a] + 0.5 * interLft1[a])
        ) ||
        // least inter-term fuzz
        interIns[a] - interIns[b] ||
        // earliest start of match
        start[a] - start[b] ||
        // case match
        cases[b] - cases[a] ||
        // and, scoring equal, the library's own order (uFuzzy sorts alphabetically here)
        idx[a] - idx[b]
    ));
}

// intraMode 1 allows single-character typos/transposition inside a term, which
// is what makes "porfolio" and "distorton" still land.
const uf = new uFuzzy({
    intraMode: 1, interLft: 0, interRgt: 0, sort: sortByRankThenFileOrder,
});

// How many terms uFuzzy may permute, its `outOfOrder` argument. Without it a
// needle only matches where its terms appear in the order they were typed, so
// "reins tower" reached `ReinsuranceOccurrenceTower` and "tower reins" did not,
// and "lognorm poisson" found nothing at all while "poisson lognorm" found the
// entry that says both. Nobody remembers which way round they wrote it.
//
// 4 permutes up to 4! = 24 passes, which over 151 rows is not worth measuring:
// on the shipped library every query tried came back inside 3ms and most came
// back *faster* than the ordered search, because uFuzzy's out-of-order path
// prefilters. Measured before choosing it, on the real payload, and it is why
// the `fzf` port the plan held in reserve is not needed: no query lost a
// result, "tower reins" went from 3 hits to the same 6 as "reins tower", and
// the tower entries rank at the top of both.
const SEARCH_PERMUTE_TERMS = 4;

// The active filters, as `ns:value` keys, and the surfaces watching them. Both
// live at module scope because the dropdown, the palette and the Ctrl+Shift
// arrow ring are three views of one list, and a filter that applied to only one
// of them would be a second piece of state to reason about.
const FILTER_KEY = 'aggapi.examples.filters';
const active = new Set(readFilters());
const watchers = new Set();

/**
 * The search box's text, as module state beside the filter set.
 *
 * It is here for the same reason `active` is: both narrow the list on screen,
 * so both have to reach the Ctrl+Shift arrow ring, and one subscriber channel
 * should carry both rather than two carrying one each. Deliberately not
 * persisted: a filter is a standing choice a reader makes once, a needle is
 * what they are doing this second.
 *
 * Written only by `publishNeedle`, from the search boxes' own `input` handlers.
 * `renderList` wrote it through a138, which read well (one place computed `q`,
 * so one place recorded it) and drew every list twice. See `publishNeedle`.
 */
let needle = '';

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

/**
 * Whether a `notify()` fanout is in progress, so nothing notifies from inside
 * one.
 *
 * Written for a loop that no longer exists: `renderList` used to publish the
 * needle, every surface redraws through `renderList` on a notify, and the two
 * search boxes would therefore trade the needle for ever, each overwriting it
 * from its own box. Publishing moved out of the render at a138 and took the
 * loop with it. The guard stays because a watcher is arbitrary code, `main.js`
 * already registers one, and one that touched a filter would recurse without
 * it.
 */
let notifying = false;

/** Tell every mounted surface the view moved. */
function notify() {
    if (notifying) return;
    notifying = true;
    try {
        for (const watcher of watchers) watcher();
    } finally {
        notifying = false;
    }
}

/**
 * Watch the visible view: the filter set and the search needle both.
 *
 * `main.js` uses this to drop the Ctrl+Shift arrow ring's cursor, which indexes
 * into the visible list and means nothing once that list changes shape, and to
 * redraw the `[m/n]` readout that was numbering it.
 *
 * Named for filters alone through a131, when that was all it carried.
 */
export function onExamplesViewChange(fn) {
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

/**
 * Record what the reader typed and redraw every surface, this one included.
 *
 * The search boxes' `input` handlers call this and do not draw themselves: each
 * surface is one of `notify`'s watchers, so the fanout is what repaints it. That
 * is the whole of the a138 fix. `renderList` published the needle from inside
 * itself, between emptying the container and filling it, so the fanout re-
 * entered the *calling* surface's own render, that inner render emptied the
 * container and drew the complete list, and then the outer render resumed and
 * appended the filter bar, the "n matches" header and every row a second time.
 * Two copies of the list on every keystroke, which is what a reader searching
 * `capstone` saw. The `notifying` guard stopped the two boxes looping, but a
 * surface redrawing itself into a container its caller was still filling is not
 * a loop and slipped straight through.
 *
 * Publishing here also keeps the render a pure draw, which is worth having on
 * its own: a function that paints a list should not be the one deciding what the
 * list is.
 *
 * No fanout when the trimmed text has not moved, so a trailing space costs
 * nothing and nothing is redrawn that would not change. `search` trims too.
 *
 * @param {string} text the search box's raw value.
 */
function publishNeedle(text) {
    const q = text.trim();
    if (q === needle) return;
    needle = q;
    notify();
}

/**
 * Fetch (and memoize) the example payload.
 *
 * Two things are memoized, and it takes both. `cached` is the resolved payload,
 * which has to stay a plain value because the palette reads it synchronously.
 * `loading` is the fetch still in flight, and without it two callers arriving in
 * the same tick both see `cached` null and both fire: the example ring and the
 * dropdown mount do exactly that at startup, which cost a second `/v1/examples`
 * on every page load through a134.
 *
 * `loading` is cleared when the request settles, so a failure is retried by the
 * next caller rather than being remembered as a rejection for ever.
 */
export async function loadExamples() {
    if (cached) return cached;
    if (!loading) loading = api.examples().finally(() => { loading = null; });
    const payload = await loading;
    if (!cached) {
        cached = payload;
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
 * The pool `search` ranks within, and the ring's list whenever nothing is typed.
 * See `visibleExamples`, which is what the ring actually calls.
 */
export function filteredExamples() {
    if (!flat) return [];
    return active.size ? applyFilters(flat, active) : flat;
}

/**
 * What the reader last saw: the filtered list, or the search results over it.
 *
 * **This is the ring's list.** The Ctrl+Shift arrow ring walks the dropdown read
 * top to bottom, so it has to walk what the dropdown is actually showing, and
 * since a123 that is what the pills leave *and* what the needle matches. Through
 * a131 the ring read `filteredExamples()`, so typing `hero` narrowed the list on
 * screen to seven rows and the arrows went on walking all 151.
 *
 * **Ranked, not in file order, while a needle is live.** `search` returns best
 * first, which `renderList` draws and which this therefore walks. That is the
 * ring's contract holding rather than breaking: it is the list read top to
 * bottom, and with a needle typed the top is the best match.
 *
 * **Last render wins**, which is worth saying because there are two surfaces.
 * The dropdown and the Ctrl+K palette both draw through `renderList` and each
 * has its own box, so `needle` is whichever was typed into most recently. The
 * ring walks what the reader last looked at, which is the only reading of "the
 * list on screen" that means anything when two of them exist.
 */
export function visibleExamples() {
    return needle.trim() ? search(needle) : filteredExamples();
}

/**
 * Entries matching `needle` within the filtered set, best first.
 *
 * Terms may arrive in any order, so "reins tower", "tower reins" and "advanced
 * tower" all reach `ReinsuranceOccurrenceTower`. See `SEARCH_PERMUTE_TERMS`.
 *
 * Pills narrow, search ranks within what is left. Ranking runs over the whole
 * haystack and the survivors are kept, rather than rebuilding a haystack per
 * filter change: 151 rows makes the difference unmeasurable, and one index that
 * never moves is one fewer thing to keep aligned with `flat`.
 *
 * Entries that score equal come back in the library's order rather than the
 * alphabet, which for a family query like "capstone" is every hit: see
 * `sortByRankThenFileOrder`.
 */
function search(needle) {
    const pool = filteredExamples();
    const q = needle.trim();
    if (!q) return pool;
    const allowed = new Set(pool);
    return rankMatches(haystack, q).map((i) => flat[i])
        .filter((item) => allowed.has(item));
}

/**
 * Positions in `strings` matching `q`, best first, ties in `strings` order.
 *
 * The whole of what the app asks uFuzzy for, split out from `search` so the
 * ordering can be asserted on the instance the app actually uses rather than on
 * a second one a test builds with the options copied across. `search` adds the
 * pill filter and the mapping back to entries; there is nothing else here.
 *
 * @param {string[]} strings the haystack, in the library's order.
 * @param {string} q a trimmed, non-empty needle.
 * @returns {number[]} indexes into `strings`.
 */
export function rankMatches(strings, q) {
    const [idxs, info, order] = uf.search(strings, q, SEARCH_PERMUTE_TERMS);
    if (!idxs) return [];
    // `order` ranks by match quality when uFuzzy returns the extra passes;
    // fall back to the raw index order when it does not.
    return (order && info) ? order.map((o) => info.idx[o]) : idxs;
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
 *
 * **A pure draw.** It reads state and paints; it changes nothing. Through a138
 * it published the needle as well, from between the `empty` and the first
 * `appendChild`, which drew every list twice: see `publishNeedle`. The boxes'
 * `input` handlers publish now, and this is only ever called from a fanout or a
 * mount.
 *
 * @param {string} typed the search box's raw text.
 */
function renderList(container, payload, typed, onPick) {
    empty(container);
    const q = typed.trim();
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
    // Publish, and let the fanout draw: this surface is one of its watchers. See
    // `publishNeedle` for why the render must not be the thing that publishes.
    input.addEventListener('input', () => publishNeedle(input.value));
    // Keystrokes inside a dropdown otherwise reach Bootstrap's own item
    // navigation, which steals the arrow keys and closes on Escape mid-word.
    input.addEventListener('keydown', (ev) => ev.stopPropagation());
    // A pill clicked in the palette has to move this list too.
    onExamplesViewChange(draw);

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
    // Held at this scope so `open` can repaint through the same function the
    // fanout uses, rather than calling `renderList` with its own arguments and
    // being a second opinion about what the palette shows.
    let draw = null;

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
        draw = () => renderList(list, payload, input.value, pick);
        // Publish, and let the fanout draw. See `publishNeedle`.
        input.addEventListener('input', () => publishNeedle(input.value));
        // A pill clicked in the dropdown has to move this list too.
        onExamplesViewChange(draw);
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
        // The box is empty, so the needle is: an emptied box that left the ring
        // walking the last search was the same disagreement the render-side
        // publish used to hide. Publishing may repaint through the fanout, and
        // does not when the needle was already empty, so draw either way.
        publishNeedle('');
        draw();
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
