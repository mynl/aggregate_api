// SPA entry point. Loaded by index.html as a module.
//
// Responsibilities:
//   * import Bootstrap (CSS + JS) and Bootstrap Icons + our CSS so Vite
//     bundles everything (no runtime CDN)
//   * construct the CM6 editor + wire build / history / clear / emacs
//   * wire the Build button, log2 / bs dropdowns, Examples dropdown
//   * render the one-line build summary
//   * render the six output groups and their sub-tab rows, lazily fetching
//     each leaf and caching what a pane is showing per built object; the
//     skeleton and the greying rules live in `nav.js`
//   * surface aggregate/api versions in the header

// ---- Bootstrap + icons + site styles ----
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import * as bootstrap from 'bootstrap';            // side-effect: data-bs-* handlers
import './styles/site.css';
import './styles/cm6.css';

// ---- App modules ----
import { api, ApiError } from './api.js';
import { createEditor, emacsEnabledDefault } from './editor.js';
import { mountExamples, mountPalette, loadExamples } from './examples.js';
import { renderInfo } from './renderers.js';
import { mountExhibit, mountReinsExhibit, showPlaceholder } from './charts/exhibits.js';
import { loadStyle } from './charts/theme.js';
import { mountGrid, clearGrids, destroyAllGrids } from './grid.js';
import { mountIrTable, irToGrid, docTruncated } from './tables.js';
import { renderError, renderRateLimit } from './error-pane.js';
import {
    NAV_GROUPS,
    leafOf,
    leafAvailable as navLeafAvailable,
    groupAvailable as navGroupAvailable,
    activeLeaf as navActiveLeaf,
    capsFromResponse,
    whyLeaf,
    whyGroup,
} from './nav.js';
import * as history from './history.js';
import { $, el, empty } from './utils/dom.js';
import { fmt } from './utils/format.js';

// ----------------------------------------------------------------------
// CsvGrid option presets (see grid.js)
// ----------------------------------------------------------------------
// Every grid gets the full chrome (fzf search, per-column filters, status bar,
// copy / save export). Expand/Contract is auto: mountGrid shows it only from 6
// columns up (see grid.js). GRID_FULL stays as an explicit "defaults" marker at
// call sites; frame-specific tweaks (formats, maxRows) spread over it.
const GRID_FULL = {};

// ----------------------------------------------------------------------
// Module state
// ----------------------------------------------------------------------
// There is no `note` here any more. The Overview lead is read off the built
// object via /v1/objects/{id}/meta, so it is the note the program actually
// carries rather than one remembered from whichever example was last clicked.
// That also gives a hand-typed `note{...}` a lead, which the old route could not.
const state = {
    id: null,
    kind: null,
    name: null,
    mean: null,             // headline mean, for the exhibit's reference line
    hasReins: false,        // the Price basis selector; the Reins tab reads `exhibits`
    // What the object can answer, straight off the build response and already
    // in the shape `nav.js` takes: `{built, exhibits, charts, flags}`. The app
    // holds no per-kind table of its own, so a new library exhibit reaches the
    // menu with no edit here, which is the whole point of the exhibit registry.
    //
    // One object, built by one function, read everywhere. This used to be seven
    // loose `canX` fields copied onto `state` by hand, with `capsFromResponse`
    // sitting unused beside them: `canBounds` and `canAllocate` never got
    // copied when Bounds landed, so the whole group greyed for every object
    // while `check-nav.mjs` passed, because the checker called that function
    // and the app did not. A flag cannot be wired in one and not the other now.
    caps: capsFromResponse(null, false),
    // The program you built yourself, and whether you have since derived from
    // it. Together they are Reset: at any moment you are either on your own
    // program or exactly one derivation away from it.
    base: null,
    derived: false,
    // Each group remembers its own last leaf, so stepping away from Pricing and
    // back returns you where you were rather than to its first leaf.
    leaf: {},
    // And which leaf's content each group's pane is actually showing, which is
    // what decides whether entering a group has to redraw.
    rendered: {},
};

// ----------------------------------------------------------------------
// Editor
// ----------------------------------------------------------------------
const editor = createEditor($('editor-host'), {
    onBuild:       () => build(),
    onHistoryPrev: () => navigateHistory('prev'),
    onHistoryNext: () => navigateHistory('next'),
    onExamplePrev: () => exampleStep('prev'),
    onExampleNext: () => exampleStep('next'),
});

editor.setText('agg Dice dfreq [3] dsev [1:6]\n');
editor.focus();

// Reset the history cursor whenever the user types something new, so Ctrl-↑
// resumes from the latest entry on the next press.
editor.view.dom.addEventListener('keydown', (ev) => {
    // Arrows are movement, not typing. Ctrl-↑/↓ is the history walk itself and
    // must not reset what it is walking; a plain ↑/↓ moves the caret, which is
    // no reason to abandon a walk in progress either.
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') return;
    if (!ev.ctrlKey && !ev.metaKey) history.resetCursor();
});

function navigateHistory(dir) {
    const text = dir === 'prev' ? history.prev() : history.next();
    if (text !== null) editor.setText(text);
}

// Clear-X clears the editor and refocuses.
$('editor-clear').addEventListener('click', () => {
    editor.setText('');
    editor.focus();
});

// Emacs keys, a checked item in the header menu beside the Tables pair.
//
// It was a form switch on the action row through a48, where it sat among the
// build verbs as the one control that does nothing to the object. A preference
// belongs with the other preference. `.active` carries the state, exactly as
// the table-view items do, so the tick and the weight come from one class and
// there is no second source of truth to keep in step.
const emacsItem = $('emacs-item');
if (emacsItem) {
    emacsItem.classList.toggle('active', emacsEnabledDefault());
    emacsItem.addEventListener('click', () => {
        const on = !emacsItem.classList.contains('active');
        emacsItem.classList.toggle('active', on);
        editor.setEmacs(on);
    });
}

// ----------------------------------------------------------------------
// Build
// ----------------------------------------------------------------------
// The log2 and bs dropdowns used to sit next to this button and were never
// used. Sharpen replaced them: it writes the `hints{}` clause they set, into a
// program you can read, edit and keep, so the grid is pinned by an audit that
// explains itself rather than by a menu choice that vanishes on reload. Every
// build now asks the library to choose, unless the program says otherwise.
const buildBtn = $('build-btn');

/**
 * Take a build manifest as the object now on screen.
 *
 * Shared by Build and by the three derivations, because a derived object is an
 * object: same manifest, same panes, same gating. The one thing this does not
 * do is touch the editor, since who owns that text differs. Build reads it, a
 * derivation writes it.
 */
function adoptBuild(res) {
    state.id = res.id;
    state.kind = res.kind;
    state.name = res.name;
    // The exhibit draws a mean reference line; the build response already
    // carries it, so there is no reason to refetch a frame to find it.
    state.mean = res.mean;
    state.hasReins = Boolean(res.has_reins);
    applyCapability(res.capability);
    renderSummary(res);
    clearPanes();
    loadActiveTab();
}

/** Forget the object: a failed build leaves nothing that can answer anything. */
function forgetBuild() {
    state.id = state.kind = state.name = state.mean = null;
    state.hasReins = false;
    applyCapability(null);
}

async function build() {
    const decl = editor.getText().trim();
    if (!decl) return;

    buildBtn.disabled = true;
    buildBtn.textContent = 'Building…';
    try {
        const res = await api.build(decl, {});
        adoptBuild(res);
        history.record(decl);
        // A build from the editor is the program you are working on, so it is
        // what Reset comes back to. Recorded here and nowhere else: a
        // derivation deliberately does not move the mark, or Reset would only
        // ever undo the most recent of two derivations.
        state.base = decl;
        state.derived = false;
        renderActionRow();
    } catch (err) {
        forgetBuild();
        renderBuildFailure(err);
        renderActionRow();
    } finally {
        buildBtn.disabled = false;
        buildBtn.textContent = 'Build';
    }
}

// ----------------------------------------------------------------------
// The action row: Sharpen, PnL, Reset
// ----------------------------------------------------------------------
// Each derivation is a program you can see. The server answers with DecL and
// the object it builds; the text goes into the editor, so you read what was
// made, you can edit it, and history, sharing and rebuild all keep working.
// Nothing is derived behind a cached id.
const sharpenBtn = $('sharpen-btn');
const pnlBtn = $('pnl-btn');
const resetBtn = $('reset-btn');

/** Grey the derivation buttons the current object cannot answer. */
function renderActionRow() {
    const off = (btn, disabled) => {
        btn.classList.toggle('disabled', disabled);
        btn.toggleAttribute('disabled', disabled);
        btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    };
    off(sharpenBtn, !can('canSharpen'));
    off(pnlBtn, !can('canPnl'));
    // Reset is the way back from a derivation, so it means nothing until one
    // has happened. At any moment you are either on your own program or
    // exactly one derivation away from it.
    off(resetBtn, !state.derived);
}

/**
 * Run one derivation: fetch the program and its object, then adopt both.
 *
 * @param {HTMLElement} btn     the button, disabled with a label while it runs
 * @param {string} busy         what the button says meanwhile
 * @param {function} call       returns the derived response
 * @param {string} [land]       group to show afterwards, when the result belongs
 *                              somewhere other than where you are
 */
async function runDerivation(btn, busy, call, land) {
    if (!state.id || btn.hasAttribute('disabled')) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = busy;
    try {
        const res = await call(state.id);
        // The editor first: if adopting the object threw, the text that made it
        // is still what you are looking at.
        editor.setText(res.program);
        adoptBuild(res);
        state.derived = true;
        renderActionRow();
        if (res.description) noteDerivation(res.description);
        if (land) showTab(land);
    } catch (err) {
        replacePane(PANE_OF[activeTabName()] || 'pane-overview', errorNode(err));
    } finally {
        btn.disabled = false;
        btn.textContent = label;
        renderActionRow();
    }
}

/**
 * Put a derivation's own account of itself in the strip's note slot.
 *
 * Its own slot since a49, between the summary line and the timing line. It used
 * to be written onto the timing line itself, which the very next `renderTiming`
 * then overwrote, so Sharpen's verdict, the one sentence saying what the probe
 * decided and why, was on screen for less time than it took to read.
 */
function noteDerivation(text) {
    const line = $('summary-note');
    if (line) line.textContent = text || '';
}

/** Clear the note slot. Called on every build: a note belongs to one object. */
function clearNote() { noteDerivation(''); }

sharpenBtn?.addEventListener('click', () => runDerivation(
    sharpenBtn, 'Sharpening…', (id) => api.sharpen(id)));

pnlBtn?.addEventListener('click', () => runDerivation(
    pnlBtn, 'Wrapping…', (id) => api.pnl(id), 'economics'));

/**
 * Back to the program you built yourself.
 *
 * Rebuilds from the text rather than restoring an id, because Sharpen consumes
 * the object it audits: its entry moves to the sharpened program's id, so the
 * base object may no longer be in the cache. After a PnL it still is, and this
 * is a cache hit. Paying the build only on the undo is the right way round.
 *
 * Distinct from history on Ctrl+Up and Ctrl+Down, which steps through programs
 * you built yourself.
 */
resetBtn?.addEventListener('click', async () => {
    if (!state.base || resetBtn.hasAttribute('disabled')) return;
    resetBtn.disabled = true;
    resetBtn.textContent = 'Resetting…';
    try {
        editor.setText(state.base);
        adoptBuild(await api.build(state.base, {}));
        state.derived = false;
    } catch (err) {
        forgetBuild();
        renderBuildFailure(err);
    } finally {
        resetBtn.disabled = false;
        resetBtn.textContent = 'Reset';
        renderActionRow();
    }
});

/**
 * Take the build response's capability block into module state.
 *
 * A failed build passes null, which clears everything: with no object there is
 * nothing that can be answered, so every gated leaf greys out rather than
 * keeping the last object's shape and lying about the one that did not build.
 */
function applyCapability(capability) {
    // `state.id` is already set by the time this runs on the adopt path, and
    // already cleared on the forget path, so it is the honest `built`.
    state.caps = capsFromResponse(capability, Boolean(state.id));
    renderReinsEntry();
}

/** One capability flag, by the name `nav.js` gates on. */
function can(flag) {
    return Boolean(state.caps.flags[flag]);
}

buildBtn.addEventListener('click', build);

// ----------------------------------------------------------------------
// Build summary line
// ----------------------------------------------------------------------
// The api reports the library's own kind vocabulary (`bvagg`, not `bivariate`):
// where the two disagree on a name, aggregate wins and this app follows.
//
// One map, not two. The lower-case KIND_WORD existed only for the timing line,
// which said "Calculated aggregate in 0.123 seconds" directly under a summary
// line whose second item was already the kind. The timing line now reports the
// timing and nothing else.
const KIND_LABEL = {
    agg: 'Aggregate', port: 'Portfolio', sev: 'Severity',
    distortion: 'Distortion', bvagg: 'Bivariate', pnl: 'P&L',
};

// Kinds whose density frame is not the loss / p_total / F / S shape, so the
// curated column subset would come back empty: a distortion's is the g-curve
// over [0,1], a bivariate's the joint-density matrix. Ask for the whole frame.
const WHOLE_DENSITY_KINDS = new Set(['distortion', 'bvagg', 'sev']);

function sep() { return el('span', { className: 'sep' }, '·'); }

/** Bucket size for display: a sub-unit bs shows as 1/2^k (e.g. 1/64). */
function fmtBs(bs) {
    if (bs == null || !Number.isFinite(bs)) return '';
    if (bs >= 1) return fmt(bs);
    const inv = 1 / bs;
    const k = Math.round(Math.log2(inv));
    return Math.abs(2 ** k - inv) < 1e-6 ? `1/${2 ** k}` : fmt(bs);
}

/**
 * The strip's first line: name, kind, grid, moments, verdict.
 *
 * Everything after the name is joined by the same `·`, the kind included. It
 * used to hang off the name on a bare `ms-2` margin, which made the first gap
 * on the line the one gap that was not a separator, and the eye read name and
 * kind as one item.
 *
 * `log2` joined `bs` at a49. They are one fact between them: bs is how fine the
 * grid is, log2 how far it reaches, and neither alone says whether the window
 * covers the distribution.
 */
function renderSummary(res) {
    const inner = $('summary-inner');
    empty(inner);
    applyCapabilityGating();
    renderPriceBasis();
    const kindLabel = KIND_LABEL[res.kind] || 'Aggregate';
    const bits = [el('span', { className: 'nm' }, res.name || '(anonymous)')];
    const add = (text) => bits.push(sep(), el('span', { className: 'mono' }, text));
    add(kindLabel);
    if (res.bs != null)   add(`bs = ${fmtBs(res.bs)}`);
    if (res.log2 != null) add(`log2 = ${res.log2}`);
    if (res.mean != null) add(`mean ${fmt(res.mean)}`);
    if (res.cv != null)   add(`CV ${fmt(res.cv)}`);
    if (res.validation) {
        const state = validationState(res.validation);
        bits.push(sep(), el('span', { className: `mono ${state}` }, res.validation));
        setStripState(state);
    } else {
        setStripState('ok');
    }
    if (res.cached) add('cached');
    inner.append(...bits);
    clearNote();
    renderTiming(res);
    syncSummaryMore();
}

/**
 * Grade a validation string into one of the three strip states.
 *
 * The library's verdict is prose, and "not unreasonable" is the *good* one: it
 * is the phrase a clean build reports. Anything mentioning the mean is a hard
 * failure, because a wrong mean means the grid cannot represent the
 * distribution at all; everything else (cv, skew, a defective distribution) is
 * a warning about accuracy rather than about correctness.
 *
 * @param {string} text the `validation` field off the build response.
 * @returns {'ok'|'warn'|'bad'}
 */
function validationState(text) {
    const s = String(text).trim().toLowerCase();
    if (s === 'not unreasonable') return 'ok';
    return /\bmean\b/.test(s) ? 'bad' : 'warn';
}

/**
 * Tint the whole status strip, not just the verdict word.
 *
 * Hue alone is too weak for a state you must not miss, and it would ask the
 * reader to tell a scarlet failure from the brick red of a selected tab a few
 * centimetres away. The strip keeps its shape and changes its ground.
 */
function setStripState(state) {
    const strip = $('status-strip');
    if (!strip) return;
    strip.classList.toggle('is-warn', state === 'warn');
    strip.classList.toggle('is-fail', state === 'bad');
}

/**
 * Last line of the strip: "Calculated in 0.000 seconds", or the cache note.
 *
 * No kind word. It named the object a second time, one line under a summary
 * whose second item is the kind, at the one place on the strip where the
 * reader is asking about time rather than about the object.
 */
function renderTiming(res) {
    const node = $('summary-timing');
    if (!node) return;
    if (res.elapsed_ms == null) { node.textContent = ''; return; }
    node.textContent = res.cached
        ? 'Loaded from cache'
        : `Calculated in ${(res.elapsed_ms / 1000).toFixed(3)} seconds`;
}

/**
 * What the strip says when a build did not produce an object.
 *
 * The strip carries the substance, not just the fact. Through a48 it said the
 * literal `build failed` and threw the real message away, while the server's
 * own account of what was wrong went into the Overview pane below the tab
 * strip: the reader was told twice that something happened and once, further
 * down the page, what. Now line one is `build failed` and then the position and
 * the message, so the strip answers on its own and the caret pane below is the
 * detail rather than the only copy.
 *
 * `failureLine` reads whatever the server actually sent. A parse failure is an
 * `ErrorReport` dict with `line`, `column` and `message`; a library validation
 * error is a bare string; a 429 is neither and says so in its own words.
 */
function failureLine(err) {
    if (err instanceof ApiError && err.status === 429) {
        return { text: 'rate limited; please pause a moment', detail: null };
    }
    const body = (err && err.body) || {};
    const detail = body.detail || body || {};
    if (typeof detail === 'string') return { text: 'build failed', detail };
    // FastAPI's own 422: [{loc: [..., field], msg, type}, ...]. Same shape
    // `errorNode` renders in a pane, reduced to one line for the strip.
    if (Array.isArray(detail)) {
        return { text: 'build failed', detail: detail.map((e) => e.msg).join('; ') };
    }
    if (detail.line && detail.column && detail.message) {
        return {
            text: 'build failed',
            detail: `line ${detail.line}, column ${detail.column}: ${detail.message}`,
        };
    }
    if (detail.message) return { text: 'build failed', detail: detail.message };
    return { text: 'build failed', detail: err?.message || null };
}

function renderBuildFailure(err) {
    const limited = err instanceof ApiError && err.status === 429;
    const inner = $('summary-inner');
    empty(inner);
    const { text, detail } = failureLine(err);
    inner.appendChild(el('span', { className: 'mono bad' }, text));
    if (detail) inner.append(sep(), el('span', { className: 'mono' }, detail));
    setStripState('bad');
    clearNote();
    $('summary-timing').textContent = '';
    syncSummaryMore();
    // Surface the rich parse-error report (or the friendly rate-limit card) on
    // the landing tab. It used to go to Info, which is now a More sub-view: a
    // failed build has no object, so sending the reader into a sub-menu to read
    // why would be the wrong direction.
    const pane = $('pane-overview');
    empty(pane);
    if (limited) pane.appendChild(renderRateLimit(err.retryAfter));
    else if (err instanceof ApiError) pane.appendChild(renderError(err));
    else pane.appendChild(el('div', { className: 'alert alert-danger' }, err.message));
    showTab('overview');
}

// Show the ⌄ expander only when the summary text actually overflows.
function syncSummaryMore() {
    const s = $('summary');
    const inner = $('summary-inner');
    const more = $('summary-more');
    if (s.classList.contains('expanded')) { more.style.display = ''; return; }
    more.style.display = (inner.scrollWidth > inner.clientWidth + 1) ? 'block' : 'none';
}
$('summary-more').addEventListener('click', () => {
    $('summary').classList.toggle('expanded');
    syncSummaryMore();
});
window.addEventListener('resize', syncSummaryMore);

// ----------------------------------------------------------------------
// Tabs -- lazy load + cache per built object
// ----------------------------------------------------------------------
// Where a group's content goes, and where its errors land. Pricing is the one
// group with two panes rather than one, because its two leaves are two forms
// with two results rather than two views of the same payload.
const PANE_OF = {
    overview: 'pane-overview', economics: 'pane-economics',
    reinsurance: 'pane-reinsurance', pricing: 'pane-price',
    bounds: 'pane-bounds', more: 'pane-more',
};
const ALL_PANES = [...Object.values(PANE_OF), 'pane-evaluate'];

function clearPanes() {
    destroyAllGrids();
    // Emptying the panes is exactly what makes nothing rendered, so the two
    // move together rather than the caller being trusted to remember.
    state.rendered = {};
    for (const id of ALL_PANES) empty($(id));
    empty($('reins-desc'));
    empty($('head-overview'));
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    if (overviewChart) { overviewChart.dispose(); overviewChart = null; }
}

function activeTabName() {
    const link = document.querySelector('.out-tabs [data-tab].active');
    return link ? link.dataset.tab : 'overview';
}

function showTab(name) {
    const btn = document.querySelector(`.out-tabs [data-tab="${name}"]`);
    if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
}

// ----------------------------------------------------------------------
// The navigation: six groups, each with its own sub-tab row
// ----------------------------------------------------------------------
//
// The skeleton and the rules that decide what is live in it are in `nav.js`,
// which is pure and therefore checkable without a browser
// (`dev/scripts/check-nav.mjs`). What lives here is the other half: how each
// leaf actually renders, keyed `group:leaf`. A leaf named in `nav.js` with no
// loader here draws nothing, which is what the Bounds leaves do until they are
// built.
const LOADERS = {
    'overview:plot': () => loadOverviewPlot(),
    'overview:summary': () => loadOverviewFrames([['summary', 'summary']]),
    // Two blocks in one pane: both answer the same question and neither is
    // large enough to want a pane of its own.
    'overview:tail': () => loadOverviewFrames([
        ['tail_df', 'tail'], ['tail_behavior_df', 'tail_behavior']]),

    'economics:ledger': () => loadExhibitLeaf('pane-economics', 'economic'),
    'economics:ratios': () => loadExhibitLeaf('pane-economics', 'economic_ratios'),
    'economics:waterfall': () => loadExhibitLeaf('pane-economics', 'economic_waterfall'),

    'reinsurance:summary': () => loadReinsFrame('reins_summary_df'),
    'reinsurance:stats': () => loadReinsFrame('reins_stats_df'),
    'reinsurance:density': () => loadReinsFrame('reins_density_df'),
    'reinsurance:plot': () => loadReinsPlot(),

    'pricing:determine': () => showPricingLeaf('determine'),
    'pricing:evaluate': () => showPricingLeaf('evaluate'),

    'bounds:bounds': () => showBoundsLeaf('bounds'),
    'bounds:pricing': () => showBoundsLeaf('pricing'),
    'bounds:allocation': () => showBoundsLeaf('allocation'),

    'more:validation': () => replacePaneTable('pane-more', 'validation_df',
        { columnFilters: false }),
    'more:stats': () => replacePaneTable('pane-more', 'stats_df', GRID_FULL),
    'more:density': () => {
        // `resolution: 'display'` here and nowhere else. The *plots* take every
        // grid point, because a binned atom is a lie; a *table* of 65,536 rows
        // is not a reading experience, and the CSV download is the exact export
        // for anyone who wants the lot.
        //
        // A distortion's density_df is the g-curve over s in [0,1]; a
        // bivariate's is its two component marginals; a severity's is a sampled
        // loss / pdf / F / S curve. None has the aggregate's columns, so pull
        // the whole frame for those.
        const opts = { resolution: 'display' };
        // renderCap lifts CsvGrid's 2,000-row default so the whole display grid
        // shows without a "show all" prompt. 8,192 is the widest that grid gets
        // (see serializers.display_log2_for).
        //
        // The bulk path, permanently: even binned to the display grid this is
        // thousands of rows, so it never becomes a document. The filters are how
        // you read a quantile off it, which is the grid's whole job.
        return replacePaneTable('pane-more', 'density_df',
            { ...GRID_FULL, maxRows: 25, renderCap: 8192 },
            () => (WHOLE_DENSITY_KINDS.has(state.kind)
                ? api.density_df(state.id, opts)
                : api.density_df(state.id, { ...opts, cols: 'loss,p_total,F,S' })));
    },
    'more:window': () => replacePaneTable('pane-more', 'bs_window_df', GRID_FULL),
    'more:dependency': () => loadExhibitLeaf('pane-more', 'dependency'),
    'more:narrative': () => loadNarrative(),
};

// The rules, bound to the one capability object. `state.caps` is already the
// shape `nav.js` takes, so there is nothing to assemble here.
function leafAvailable(group, key) { return navLeafAvailable(state.caps, group, key); }
function groupAvailable(group) { return navGroupAvailable(state.caps, group); }
function activeLeaf(group) {
    return navActiveLeaf(state.caps, state.leaf[group], group);
}

/**
 * Render one group's sub-tab row, greying the leaves it cannot answer.
 *
 * Notes
 * -----
 * A dark leaf is marked with `aria-disabled` and `data-why` rather than the
 * native `disabled`. Two reasons, both about the tooltip: `disabled` suppresses
 * it in Chrome, and it also kills the pointer events the CSS `:hover` rule
 * needs. The click is refused in the handler instead, which is the same
 * guarantee by a different route.
 *
 * The leaf hint no longer appears here. It moved into the exhibit lede, which
 * sits on the table it describes rather than up in the menu; a hint to the
 * right of the row read as a third kind of item inside the row.
 */
function renderSubTabs(group) {
    const row = $(`sub-${group}`);
    if (!row) return;
    empty(row);
    const current = activeLeaf(group);
    for (const [key, leaf] of Object.entries(NAV_GROUPS[group].leaves)) {
        const off = !leafAvailable(group, key);
        const btn = el('button', {
            type: 'button',
            className: `sub-link${key === current ? ' active' : ''}`
                + (off ? ' nav-off' : ''),
        }, leaf.label);
        // Roving tabindex: only the selected leaf is a Tab stop, and the arrow
        // keys move within the row. See wireStripKeys.
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(key === current));
        btn.tabIndex = key === current && !off ? 0 : -1;
        if (off) {
            const reason = leaf.soon ? 'designed, not built yet' : whyLeaf(group, key);
            btn.setAttribute('aria-disabled', 'true');
            btn.setAttribute('data-why', reason);
            btn.setAttribute('aria-label', `${leaf.label}, ${reason}`);
        } else {
            btn.addEventListener('click', () => selectLeaf(group, key));
        }
        row.appendChild(btn);
    }
    const leaf = leafOf(group, current);
    if (leaf?.copy) {
        const paneId = PANE_OF[group];
        const copyBtn = el('button', { className: 'sub-link' }, 'copy');
        copyBtn.addEventListener('click', () => copyPane(paneId, copyBtn));
        row.appendChild(copyBtn);
    }
}

/** Move a group to one of its leaves and load it. */
function selectLeaf(group, key) {
    state.leaf[group] = key;
    renderSubTabs(group);
    loadLeaf(group);
}

/**
 * Load whichever leaf a group is currently on.
 *
 * The guard is "what is this pane already showing", not "what have we ever
 * fetched". Leaves within a group share one pane, so a set of visited leaves
 * would skip the re-render when you stepped back to an earlier one and leave
 * the other leaf's table on screen under the newly active pill. Recording the
 * rendered leaf per group is the same saving with none of that: re-entering a
 * group costs nothing, and moving within one always redraws.
 */
async function loadLeaf(group) {
    if (!state.id) return;
    const key = activeLeaf(group);
    const load = LOADERS[`${group}:${key}`];
    if (!load || !leafAvailable(group, key)) return;
    if (state.rendered[group] === key) return;
    state.rendered[group] = key;
    try {
        await load();
    } catch (err) {
        delete state.rendered[group];    // allow a retry on the next activation
        replacePane(PANE_OF[group], errorNode(err));
    }
}

/**
 * Grey out the groups this object cannot answer, redraw every sub-tab row, and
 * land somewhere live.
 *
 * One input, not two: the capability block the build response carries. This
 * used to be a kind plus a `has_reins` boolean read against a hand-written
 * table of what each kind could not do, which was the same knowledge the
 * library already held, written down a second time in JavaScript.
 *
 * A group greys when every one of its leaves is dark, which needs no rule of
 * its own: Economics is a P&L's group because only a P&L serves the economic
 * exhibits, and Reinsurance lights on the cession the `reins` exhibit is
 * registered behind. Bounds lights for an aggregate or a portfolio, which is
 * the accepted set `aggregate.bounds.Bounds` declares, and its Allocation leaf
 * for a portfolio alone.
 *
 * The active group is left alone unless it just went dark. Stepping through
 * examples on Pricing should stay on Pricing, and the only reason to move is
 * that there is nothing there any more.
 */
function applyCapabilityGating() {
    let activeWentDark = false;
    for (const group of Object.keys(NAV_GROUPS)) {
        const btn = document.querySelector(`.out-tabs [data-tab="${group}"]`);
        if (!btn) continue;
        const off = !groupAvailable(group);
        // Grey out with .nav-off, which styles it and carries the tooltip.
        // Bootstrap's own .disabled is kept because its Tab plugin checks for
        // it and will not activate the trigger; the native `disabled`
        // attribute is NOT set, because it suppresses the tooltip in Chrome
        // and kills the pointer events the :hover rule needs. The click is
        // refused below instead.
        btn.classList.toggle('nav-off', off);
        btn.classList.toggle('disabled', off);
        btn.setAttribute('aria-disabled', off ? 'true' : 'false');
        btn.tabIndex = off ? -1 : 0;
        // A dark group says why, on hover and to a screen reader, in the same
        // two attributes and the same wording the sub-tabs use. Through a48 the
        // group set `data-why` and no `aria-label`, so the two levels of the
        // menu explained themselves by two different rules.
        if (off) {
            const reason = whyGroup(group);
            btn.setAttribute('data-why', reason);
            btn.setAttribute('aria-label', `${NAV_GROUPS[group].label}, ${reason}`);
        } else {
            btn.removeAttribute('data-why');
            btn.removeAttribute('aria-label');
        }
        if (off && activeTabName() === group) activeWentDark = true;
        renderSubTabs(group);
    }
    if (activeWentDark) showTab('overview');
}

function loadActiveTab() { loadTab(activeTabName()); }

// Bootstrap fires shown.bs.tab on the tab trigger when a pill activates.
document.querySelectorAll('.out-tabs [data-tab]').forEach((btn) => {
    btn.addEventListener('shown.bs.tab', () => loadTab(btn.dataset.tab));
    // A dark group keeps its pointer events so the tooltip fires, so the click
    // has to be refused here. Capture phase, ahead of Bootstrap's own handler.
    btn.addEventListener('click', (e) => {
        if (btn.classList.contains('nav-off')) {
            e.preventDefault(); e.stopPropagation();
        }
    }, true);
});

// ----------------------------------------------------------------------
// Keyboard navigation over the two strips
// ----------------------------------------------------------------------
/**
 * Arrow keys within a tab strip, the standard tablist pattern.
 *
 * Both rows carry a roving tabindex, so Tab makes one stop per strip and then
 * moves on to the content, rather than walking through nine buttons. Left and
 * Right move within the strip and skip everything dark; Home and End jump to
 * the first and last live item.
 *
 * @param {HTMLElement} row the strip to wire.
 * @param {string} sel selector matching its buttons.
 */
function wireStripKeys(row, sel) {
    row.addEventListener('keydown', (e) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
        const live = [...row.querySelectorAll(sel)]
            .filter((b) => !b.classList.contains('nav-off'));
        if (!live.length) return;
        e.preventDefault();
        const at = live.indexOf(document.activeElement);
        let i;
        if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = live.length - 1;
        else if (at < 0) i = 0;
        else i = (at + (e.key === 'ArrowRight' ? 1 : -1) + live.length) % live.length;
        const target = live[i];
        target.click();
        // Selecting a leaf re-renders its whole row, so the button just clicked
        // is detached and focusing it would drop focus to <body> mid keyboard
        // run. Re-find by position instead of holding the reference.
        const after = [...row.querySelectorAll(sel)]
            .filter((b) => !b.classList.contains('nav-off'));
        (after[i] || target).focus();
    });
}

wireStripKeys(document.querySelector('.out-tabs'), '[data-tab]');
document.querySelectorAll('.sub-tabs')
    .forEach((row) => wireStripKeys(row, '.sub-link'));

/**
 * `Alt+1…6` jumps straight to a group from anywhere, including the editor.
 *
 * Alt is the one modifier the editor does not already spend: Ctrl+Enter builds,
 * Ctrl+Space completes, and Ctrl+arrows walk history and the example library. A
 * dark group refuses the jump rather than landing you somewhere empty.
 */
document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    const groups = Object.keys(NAV_GROUPS);
    if (!Number.isInteger(n) || n < 1 || n > groups.length) return;
    const group = groups[n - 1];
    if (!groupAvailable(group)) return;
    e.preventDefault();
    showTab(group);
});

/**
 * Activate a group: draw its row, then load the leaf it is on.
 *
 * The identity block is Overview's alone and is fetched once per build rather
 * than per leaf, so moving between Plot, Summary and Tail costs nothing.
 */
async function loadTab(group) {
    if (!state.id || !NAV_GROUPS[group]) return;
    renderSubTabs(group);
    if (group === 'overview') await loadOverviewHeader();
    if (group === 'reinsurance') await loadReinsDescription();
    await loadLeaf(group);
}

// The live ECharts exhibit on the Overview tab, disposed before each re-render
// so its canvas and ResizeObserver don't leak across builds. CsvGrid teardown
// is keyed on the grid registry; the chart is not, so we track it ourselves.
let overviewChart = null;

// ----------------------------------------------------------------------
// How tables render: one preference, page-wide
// ----------------------------------------------------------------------
//
// Two genuinely different instruments, not two skins. The static view walks a
// table document from the server: a sparsified row index, spanned MultiIndex
// headers, the total row and the capital anchors carrying their own weight, and
// resolved formats. It is the printed exhibit. The interactive view is CsvGrid:
// sort, per-column filter, fzf search, copy and save. It is the instrument for
// finding a number in a frame too big to read.
//
// The choice is one value for the whole page rather than per tab or per table,
// which is the author's call and the right one: a per-table switch is a lot of
// chrome for a preference nobody changes twice in a session. Sticky per browser,
// static by default (the Overview is the landing demo).
const TABLE_VIEW_KEY = 'aggapi.tableView';
let _tableView = (() => {
    try {
        // `aggapi.overviewView` is the a26-a31 key, when the preference steered
        // the Overview alone. Read it as the seed so a returning browser keeps
        // the choice it already made.
        return localStorage.getItem(TABLE_VIEW_KEY)
            || localStorage.getItem('aggapi.overviewView') || 'static';
    } catch { return 'static'; }
})();

// Listeners re-render whatever they own when the preference moves. Registered
// rather than hard-wired because the control lives in the header dropdown, which
// knows nothing about which tab is on screen.
//
// Keyed, usually by pane id, so re-registering replaces rather than piles up:
// tabs re-render freely (every rebuild, every sub-button) and an accumulating
// list would re-render panes that no longer exist. A listener also carries the
// node it speaks for, and is dropped once that node leaves the page.
const tableViewListeners = new Map();
function onTableViewChange(key, fn, node) { tableViewListeners.set(key, { fn, node }); }

function setTableView(mode) {
    if (mode === _tableView) return;
    _tableView = mode;
    try { localStorage.setItem(TABLE_VIEW_KEY, mode); } catch { /* private mode */ }
    syncTableViewMenu();
    for (const [key, entry] of [...tableViewListeners]) {
        if (entry.node && !entry.node.isConnected) {
            tableViewListeners.delete(key);
            continue;
        }
        try { entry.fn(); } catch { /* one dead pane must not stop the others */ }
    }
}

// The header dropdown's Tables section: the page-wide affordance for the same
// value. Its tick follows the preference however it moved, including from the
// Overview's pill row.
function syncTableViewMenu() {
    for (const item of document.querySelectorAll('[data-table-view]')) {
        item.classList.toggle('active', item.dataset.tableView === _tableView);
    }
}
for (const item of document.querySelectorAll('[data-table-view]')) {
    item.addEventListener('click', () => setTableView(item.dataset.tableView));
}
syncTableViewMenu();

/**
 * Mount one table the way the preference asks, from a single source.
 *
 * Parameters
 * ----------
 * paneId : str
 *     Output pane, for teardown.
 * host : HTMLElement
 *     Mount point, already attached (CsvGrid measures against live layout).
 * source : object
 *     Either `{doc}`, a table document that feeds **both** views, or `{frame}`,
 *     a plain `{columns, rows}` that can only be a grid. Bulk frames (the
 *     densities) are the second kind and never go near a document.
 * gridOpts : object, optional
 *     CsvGrid options for the interactive view.
 *
 * Notes
 * -----
 * One document per table, not a document and a frame. `irToGridInput` derives
 * the grid's input from the same bytes the walker draws, so the two views cannot
 * disagree about a number, and flipping the switch costs no round trip.
 *
 * Both renderers now live in the walker module, so failing to load it costs both
 * views rather than one. That is a broken server rather than a degraded one, and
 * it says so in the pane instead of leaving an empty box.
 */
function mountTable(paneId, host, source, gridOpts = GRID_FULL) {
    const { doc, frame } = source || {};
    const wantStatic = _tableView === 'static';

    const asGrid = (f, opts) => {
        if (!host.isConnected) return;   // the pane moved on while we waited
        host.className = 'grid-host';
        mountGrid(paneId, host, f, opts);
    };
    const unavailable = () => {
        if (!host.isConnected) return;
        host.className = '';
        empty(host);
        host.appendChild(el('div', { className: 'text-muted small fst-italic' },
            'Table renderer unavailable. The CSV download still has the data.'));
    };

    if (!doc) {                          // bulk path, unchanged
        asGrid(frame, gridOpts);
        return;
    }
    // The adapter's formats and align come out of the document, so the grid
    // renders the same numbers the walker would. Caller options still win, since
    // a call site may know something the frame does not carry.
    const toGrid = () => irToGrid(doc).then(
        (g) => (g ? asGrid(g.frame, { formats: g.formats, align: g.align, ...gridOpts })
                  : unavailable()));

    if (!wantStatic) {
        toGrid();
        return;
    }
    host.className = 'gt-host';
    // Async, but the host is already in the DOM and holds its place, so the
    // table lands without moving anything around it.
    mountIrTable(paneId, host, doc).then((handle) => { if (!handle) toGrid(); });
}


// Render the summary_df + tail_df exhibits into `box` per the current view mode.
// Everything mounted registers under 'pane-overview', so clearGrids tears down
// the previous mode before each (re-)render.
function renderOverviewExhibits(box, ir = {}) {
    clearGrids('pane-overview');
    empty(box);
    if (ir.summary) renderOneExhibit(box, ir.summary, {
        title: 'Summary',
        gloss: 'mean, SD, CV, skewness and key percentiles, by component',
        caption: 'CV blank for signed or near break even rows. Freq percentiles '
            + 'blank by design, the PGF carries no quantiles.',
    });
    if (ir.tail) renderOneExhibit(box, ir.tail, {
        title: 'Return periods',
        gloss: 'VaR, TVaR and xsVaR by return period',
        caption: '1 in 200 (Solvency II) and 1 in 250 (US) are the capital anchors. '
            + 'Exact from the FFT grid, not simulated.',
    });
    if (ir.tail_behavior) renderOneExhibit(box, ir.tail_behavior, {
        title: 'Tail behavior',
        gloss: 'support, the decay class on each side, and concentration',
        caption: 'Read from the spec, so it holds before any grid is chosen.',
    });
}

// One exhibit: the static table walked from its document, or the interactive
// CsvGrid derived from the same one. Title and caption are the SPA's own either
// way, so the two views differ in the table and in nothing else.
function renderOneExhibit(box, doc, opts) {
    // Title and gloss on one line, bold then explanation. Through a46 this was
    // a heading over a separate hint line, and on Overview / Summary the pair
    // said "Summary" twice, at two sizes and two alignments, a few pixels
    // apart. One line, one idea, and the gloss now sits on the table it
    // describes rather than in the menu above it.
    if (opts.title) {
        const lede = el('p', { className: 'exhibit-lede' },
            el('b', {}, opts.title));
        if (opts.gloss) lede.appendChild(document.createTextNode(`: ${opts.gloss}`));
        box.appendChild(lede);
    }
    const host = el('div');
    box.appendChild(host);
    mountTable('pane-overview', host, { doc }, GRID_FULL);
    if (opts.caption) box.appendChild(el('div', { className: 'exhibit-caption' }, opts.caption));
}

/**
 * The object's own header block: its tags, and its note.
 *
 * Reads `/v1/objects/{id}/meta`, so it works for anything that was built,
 * including a hand-typed program carrying `note{}`. This replaces the old
 * `pendingNote` route, where the lead could only ever come from an example that
 * had just been clicked.
 *
 * A missing note is ordinary, not a defect: most library entries carry one and
 * nothing requires it, so an object without one simply has no lead paragraph.
 *
 * Notes
 * -----
 * **The name and the kind are gone from here.** They are the first two things
 * the status strip says, a couple of centimetres up the page, so this row
 * repeated them at a larger size and read as a second heading for the same
 * object. What is left is what the strip does not carry: the tags and the note,
 * on one quiet line above the group strip.
 *
 * The program and its hints are deliberately **not** shown here either. They
 * sit in the editor, so a disclosure repeating them was spending the most
 * valuable strip of the tab on something already on screen.
 */
function renderOverviewHeader(meta) {
    if (!meta) return null;
    // Always a node, even when the object carries neither, so the caller's
    // "already fetched" guard still has something to test; `:empty` in the CSS
    // is what stops an empty one taking up space.
    const head = el('div', { className: 'overview-head' });
    for (const tag of meta.tags || []) {
        head.appendChild(el('span', { className: 'overview-tag' }, tag));
    }
    if (meta.note) head.appendChild(el('span', { className: 'overview-note' }, meta.note));
    return head;
}

// ---- Overview: the landing group, three leaves ----

/**
 * The identity block above the sub-tab row: name, kind, tags, note.
 *
 * Fetched once per build rather than once per leaf, because it names the object
 * rather than any one view of it and stays put as you move between Plot,
 * Summary and Tail.
 */
async function loadOverviewHeader() {
    const host = $('head-overview');
    if (!host || host.firstChild) return;
    const meta = await api.meta_of(state.id).catch(() => null);
    const head = renderOverviewHeader(meta);
    if (head) host.appendChild(head);
}

/**
 * Overview / Plot: the two linked panels, a g-curve for a distortion, a joint
 * heatmap for a bivariate.
 *
 * `mountExhibit` owns the box: it draws the skeleton at the exhibit's final size
 * before fetching anything, and awaits `loadStyle()` behind it. Nothing to
 * reserve from out here, which is the point. Reserving from the call site meant
 * guessing the geometry, and the guess was the two-panel one for every kind, so
 * a distortion or a bivariate reserved the wrong box entirely.
 */
async function loadOverviewPlot() {
    if (overviewChart) { overviewChart.dispose(); overviewChart = null; }
    const pane = $('pane-overview');
    clearGrids('pane-overview');
    empty(pane);
    const host = el('div', { className: 'overview-plot' });
    pane.appendChild(host);
    try {
        overviewChart = await mountExhibit(host, state);
    } catch { /* the exhibit is a bonus; the tables carry the story */ }
    if (!overviewChart) {
        pane.removeChild(host);
        pane.appendChild(el('div', { className: 'text-muted small' },
            'No chart for this object.'));
    }
}

/**
 * Overview / Summary and Overview / Tail: one or more frame documents in a pane.
 *
 * One document each, feeding both table views: the walker draws it, and
 * `irToGridInput` derives the grid's input from the same bytes. So flipping the
 * preference costs no round trip and the two views cannot disagree about a
 * number.
 *
 * @param {Array<[string, string]>} specs `[frame route name, exhibit key]` pairs.
 */
async function loadOverviewFrames(specs) {
    if (overviewChart) { overviewChart.dispose(); overviewChart = null; }
    const pane = $('pane-overview');
    clearGrids('pane-overview');
    empty(pane);
    const docs = await Promise.all(
        specs.map(([which]) => api.frameIr(state.id, which).catch(() => null)));
    const ir = {};
    specs.forEach(([, key], i) => { ir[key] = docs[i]; });
    if (!docs.some(Boolean)) {
        pane.appendChild(el('div', { className: 'text-muted small' },
            'Not available for this object.'));
        return;
    }
    const box = el('div', { className: 'overview-exhibits' });
    pane.appendChild(box);
    renderOverviewExhibits(box, ir);
    onTableViewChange('pane-overview', () => renderOverviewExhibits(box, ir), box);
}

/**
 * More / Narrative: everything the object says about itself in prose.
 *
 * The `info` block first, then a section per text field, each with its short
 * form and its long one. Absorbs the old "Info (raw)" view, which showed the
 * first of those and none of the rest, so the descriptions and explanations
 * the library has been writing all along were reachable only from the api.
 *
 * The section list is derived server side by suffix, so a narrative the library
 * adds upstream appears here with no edit on either side.
 */
async function loadNarrative() {
    const payload = await api.narrative(state.id);
    const root = el('div', { className: 'narrative' });
    if (payload.info) {
        root.appendChild(el('h6', { className: 'exhibit-title' }, 'Info'));
        root.appendChild(el('pre', { className: 'narrative-info' }, payload.info));
    }
    for (const section of payload.sections || []) {
        root.appendChild(el('h6', { className: 'exhibit-title' }, section.name));
        // The short form reads as the verdict and the long one as the working,
        // so the first is emphasized and the second follows it.
        if (section.description) {
            root.appendChild(el('p', { className: 'narrative-lead' }, section.description));
        }
        if (section.explanation) {
            root.appendChild(el('p', { className: 'narrative-body' }, section.explanation));
        }
    }
    if (!root.firstChild) {
        root.appendChild(el('div', { className: 'text-muted small' },
            'This object carries no narrative text.'));
    }
    replacePane('pane-more', root);
}

/**
 * One library exhibit in a pane, as its envelope.
 *
 * The generic leaf loader for Economics and More's Dependency. It takes the
 * exhibit route rather than the frame route for two reasons. Some of these
 * exhibits have no frame behind them at all: `economic_waterfall` and
 * `dependency` are built by the library and reachable only this way. And where
 * both exist the envelope is the richer one, since the library owns the
 * business translation and ships each block with its own caption.
 *
 * An exhibit is one or more blocks, each a table document, so a pane may hold
 * several tables. `economic_ratios` is the reason: its insurer framing splits
 * into pure-unit blocks rather than one frame with mixed measures.
 */
async function loadExhibitLeaf(paneId, name) {
    const envelope = await api.exhibit(state.id, name);
    const blocks = envelope.blocks || [];
    const draw = () => {
        const root = el('div', { className: 'overview-exhibits' });
        replacePane(paneId, root);
        if (!blocks.length) {
            root.appendChild(el('div', { className: 'text-muted small' },
                'Nothing to show for this object.'));
            return;
        }
        for (const block of blocks) {
            const host = el('div');
            root.appendChild(host);
            mountTable(paneId, host, { doc: block }, GRID_FULL);
        }
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

function replacePane(paneId, node) {
    clearGrids(paneId);          // tear down any CsvGrid that lived here
    const pane = $(paneId);
    empty(pane);
    if (node) pane.appendChild(node);
}

/**
 * Replace a pane's contents with one table, rendered the way the preference asks.
 *
 * Parameters
 * ----------
 * paneId : str
 *     Output pane. Also the listener key, so a re-render replaces the previous
 *     registration instead of stacking another one.
 * which : str
 *     Frame name. One `?format=ir` fetch, which then feeds whichever view is on.
 * opts : object, optional
 *     CsvGrid options.
 * bulk : function, optional
 *     Fetches `{columns, rows}` for frames too long to document. Supplied by the
 *     density views, which are permanently the grid's, and used as the fallback
 *     when a document comes back truncated.
 *
 * Notes
 * -----
 * A document that the server truncated is not shown. `max_rows` means a long
 * frame comes back as its first 500 rows plus a note, which is right for a
 * direct request and wrong to render silently, so this refetches the whole frame
 * and hands it to the grid instead.
 */
async function replacePaneTable(paneId, which, opts = GRID_FULL, bulk = null) {
    let source = null;
    if (!bulk) {
        const doc = await api.frameIr(state.id, which).catch(() => null);
        if (doc && !docTruncated(doc)) source = { doc };
    }
    if (!source) {
        const fetchFrame = bulk || (() => api.frameOf(state.id, which));
        source = { frame: await fetchFrame() };
    }
    const draw = () => {
        const host = el('div');
        replacePane(paneId, host);        // tears down the previous mode first
        mountTable(paneId, host, source, opts);
        // Re-register against the node just created, not against the pane. The
        // pane outlives everything, so a listener keyed on it would survive a
        // rebuild and redraw the *previous* object's frame on the next flip.
        // This node is dropped by `clearPanes`, and a disconnected node is what
        // prunes the listener.
        onTableViewChange(paneId, draw, host);
    };
    draw();
}

function errorNode(err) {
    if (err instanceof ApiError && err.status === 429) return renderRateLimit(err.retryAfter);
    if (err instanceof ApiError) {
        const detail = err.body && (err.body.detail || err.body);
        let msg;
        if (Array.isArray(detail)) {
            // FastAPI 422 validation errors: [{loc:[...,field], msg, type}, ...].
            // Show "<field>: <msg>" per entry so the real reason (a bad p, an
            // over-cap log2) is legible instead of a bare "HTTP 422".
            msg = detail
                .map((e) => {
                    const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null;
                    return field ? `${field}: ${e.msg}` : e.msg;
                })
                .join('; ');
        } else {
            msg = (detail && detail.message) || (typeof detail === 'string' ? detail : err.message);
        }
        return el('div', { className: 'text-muted small' }, msg);
    }
    return el('div', { className: 'text-muted small' }, err.message);
}

// ---- Reins tab: description line + gross/ceded/net exhibit + per-layer frame ----
// The live ECharts instance on the Reins tab, tracked for teardown the same way
// the Overview one is.
let reinsChart = null;

/**
 * The program description above the sub-tab row.
 *
 * Group-level like the Overview identity block: it names the whole structure
 * rather than any one leaf, so it is fetched once per build and stays put.
 */
async function loadReinsDescription() {
    const descEl = $('reins-desc');
    if (!descEl || descEl.firstChild) return;
    const info = await api.reinsDescription(state.id).catch(() => null);
    if (info?.text) descEl.appendChild(el('span', { className: 'mono' }, info.text));
}

/**
 * Reinsurance / Plot: the gross, ceded and net exhibit.
 *
 * The Overview's two-panel instrument pointed at three views of one book, so
 * the same reading applies: the left panel is what the cession does to the
 * shape, the right is what it does to the tail, which is the question a
 * reinsurance structure exists to answer.
 *
 * A chart leaf, so the pill lights from `available_charts`. The library
 * registered `chart_reins` behind the same cession predicate, which makes this
 * the first leaf in the app whose availability comes from the chart registry
 * rather than the exhibit one.
 */
async function loadReinsPlot() {
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    const pane = $('pane-reinsurance');
    clearGrids('pane-reinsurance');
    empty(pane);
    const host = el('div', { className: 'overview-plot' });
    pane.appendChild(host);
    // `mountReinsExhibit` is synchronous and takes the frame already fetched, so
    // unlike the Overview the box is reserved from here, and `loadStyle` still
    // has to land before the build reads the colors.
    showPlaceholder(host, 'reins', host.clientWidth || 0);
    try {
        // Full resolution: this is a plot, and a ceded distribution is more
        // atomic than a gross one, not less.
        const [frame] = await Promise.all([
            api.frameOf(state.id, 'reins_density_df'),
            loadStyle().catch(() => null),
        ]);
        reinsChart = mountReinsExhibit(host, frame);
    } catch { /* the exhibit is a bonus; the frames carry the numbers */ }
    // `mountReinsExhibit` replaces the skeleton with its own tools row and
    // canvas, each sized in themselves, so the height set on this node has to
    // come back off or it would clamp them.
    host.style.height = '';
    if (!reinsChart) {
        empty(pane);
        pane.appendChild(el('div', { className: 'text-muted small' },
            'No reinsurance chart for this object.'));
    }
}

/**
 * The cession entry box: derive, fill the editor, build, in one step.
 *
 * A derivation like Sharpen and PnL, and it goes through the same machinery, so
 * Reset on the action row comes back to the gross object with no reset of its
 * own here. Shown only where a cession can be added, which is an aggregate; the
 * group stays live for one carrying no cession yet, since that is exactly the
 * object you want this for.
 */
function renderReinsEntry() {
    const box = $('reins-entry');
    if (!box) return;
    box.classList.toggle('d-none', !can('canReins'));
}

const reinsBtn = $('reins-btn');
const reinsInput = $('reins-input');

async function cede() {
    const cession = reinsInput.value.trim();
    if (!cession || !can('canReins')) return;
    await runDerivation(reinsBtn, 'Ceding…', (id) => api.reins(id, cession),
        'reinsurance');
    // The clause is now in the program in the editor, which is the record, so
    // leaving a copy in the box would be the same text in two places, and the
    // second one would go stale the moment you edited the first.
    if (state.derived) reinsInput.value = '';
}

reinsBtn?.addEventListener('click', cede);
reinsInput?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    cede();
});

/** Reinsurance / Summary, Stats and Density: one per-layer frame. */
async function loadReinsFrame(which) {
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    // The density is the bulk one: the table takes the binned grid, and only
    // the plot leaf wants every point.
    const bulk = which === 'reins_density_df'
        ? () => api.frameOf(state.id, which, { resolution: 'display' })
        : null;
    await replacePaneTable('pane-reinsurance', which,
        { ...GRID_FULL, renderCap: 8192 }, bulk);
}

/**
 * Pricing / Determine and Pricing / Evaluate: show one form, hide the other.
 *
 * The one group whose leaves are two forms rather than two views of a payload,
 * so both live in the markup and the leaf chooses. Neither runs on activation:
 * pricing and evaluation are both work, and a leaf that computed on arrival
 * would spend it every time you passed through.
 */
async function showPricingLeaf(which) {
    $('leaf-determine').classList.toggle('d-none', which !== 'determine');
    $('leaf-evaluate').classList.toggle('d-none', which !== 'evaluate');
    // The premium input is for a position carrying no consideration of its own.
    // A P&L keeps its premium in its ledger and never asks; an exposure that
    // states one does not either.
    $('evaluate-premium-field').classList.toggle('d-none', !can('needsPremium'));
}

// ----------------------------------------------------------------------
// Price tab -- pentagon form (p + CoC/LR); Portfolios also get the
// per-distortion LR/P/PQ/ROE slices from analyze_distortions.
// ----------------------------------------------------------------------
// Column formats are the server's business now, declared per frame in
// `tables.FORMATS` and resolved into the document. Both views read them from
// there, so a loss ratio is a percent in the static table and in the grid
// without the two being told separately. `PRICE_FMT_CODE` and `statFormats`
// lived here until a35.
const PRICE_TITLE = {
    LR: 'Loss ratio', P: 'Premium', PQ: 'Premium / capital', ROE: 'Return on capital',
};

// Render the Price payload straight into pane-price: pentagon + (Portfolios
// only) calibrated distortions and the per-stat distortion slices. Everything
// registers under 'pane-price' so a rebuild tears it down together.
function renderPrice(payload) {
    const paneId = 'pane-price';
    const ir = payload.ir || {};
    const draw = () => {
        const root = el('div', { className: 'price-result' });
        replacePane(paneId, root);      // clears prior tables + attaches root

        // `frame` is the fallback: these come from a POST, so if the document
        // could not be built the plain payload is still there to show.
        const section = (title, frame, key, opts, cls = 'price-section-title') => {
            root.appendChild(el('div', { className: cls }, title));
            const host = el('div');
            root.appendChild(host);
            mountTable(paneId, host, ir[key] ? { doc: ir[key] } : { frame }, opts);
        };

        section('Pricing pentagon', payload.pentagon, 'pentagon', GRID_FULL);
        if (payload.distortion_df) {
            section('Calibrated distortions', payload.distortion_df, 'distortion_df',
                GRID_FULL, 'price-section-title mt-3');
        }
        for (const w of payload.warnings || []) {
            root.appendChild(el('div', { className: 'text-muted small fst-italic mt-1' }, `⚠ ${w}`));
        }
        if (payload.distortions) {
            for (const stat of ['LR', 'P', 'PQ', 'ROE']) {
                const frame = payload.distortions[stat];
                if (!frame) continue;
                section(`${PRICE_TITLE[stat]} (${stat}) by distortion`, frame, stat,
                    GRID_FULL, 'price-section-title mt-3');
            }
        }
        // Against the root just built, not the pane: see `replacePaneTable`.
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

// ---- Reinsurance-aware pricing ----
// Which basis the distortion set is calibrated on. Sticky per browser, and only
// offered when the object carries a cession.
const PRICE_BASES = [
    ['gross', 'Gross', 'Calibrate on the gross book; price the net with the same set'],
    ['net occ', 'Net occ', 'Calibrate net of the occurrence program'],
    ['net', 'Net', 'Calibrate on the net book; price the gross with the same set'],
];
let priceBasis = (() => {
    try { return localStorage.getItem('aggapi.priceBasis') || 'gross'; }
    catch { return 'gross'; }
})();

/**
 * The basis selector, shown above the Price form when there is reinsurance.
 *
 * Not a hidden row that appears and disappears: the container is always in the
 * markup and this fills or empties it, so the form does not jump when you step
 * from a reinsured example to a plain one.
 */
function renderPriceBasis() {
    const host = $('price-basis');
    if (!host) return;
    empty(host);
    if (!state.hasReins) return;
    host.appendChild(el('span', { className: 'exhibit-group-label' }, 'calibrate on'));
    const btns = PRICE_BASES.map(([value, label, title]) => {
        const b = el('button', {
            type: 'button', title,
            className: `exhibit-toggle${value === priceBasis ? ' active' : ''}`,
        }, label);
        b.addEventListener('click', () => {
            priceBasis = value;
            try { localStorage.setItem('aggapi.priceBasis', value); }
            catch { /* private mode */ }
            for (const x of btns) x.classList.toggle('active', x === b);
        });
        return b;
    });
    host.append(...btns);
}

/**
 * Render the reinsurance pricing table.
 *
 * One row per (distortion, basis) plus a difference row per non-calibrated
 * basis. The difference is the point: it is the premium the cession costs, and
 * its `LR` is the loss ratio the reinsurance is being bought at.
 */
function renderReinsPrice(payload) {
    const paneId = 'pane-price';
    const ir = payload.ir || {};
    const draw = () => {
        const root = el('div', { className: 'price-result' });
        replacePane(paneId, root);

        root.appendChild(el('div', { className: 'price-section-title' },
            `Gross and net by distortion, calibrated on ${payload.basis}`));
        root.appendChild(el('div', { className: 'exhibit-caption mb-2' },
            `Distortions fitted to the ${payload.basis} basis at p = ${payload.p} `
            + `(a = ${fmt(payload.a)}, CoC ${(payload.roe * 100).toFixed(1)}%), then `
            + 'applied unchanged to the others. The starred row is the calibrated '
            + 'one. A "less" row is the difference: the implied allowance for '
            + 'reinsurance in the rate, and its LR is the loss ratio the cover is '
            + 'being bought at.'));
        const host = el('div');
        root.appendChild(host);
        // Money grouped, ratios as percents, PQ to 3dp: declared server side in
        // `tables.FORMATS['reins_price']` and resolved into the document, so
        // both views read one answer.
        mountTable(paneId, host,
            ir.table ? { doc: ir.table } : { frame: payload.table },
            { ...GRID_FULL, maxRows: 30 });

        if (payload.distortion_df) {
            root.appendChild(el('div', { className: 'price-section-title mt-3' },
                'Distortion parameters'));
            const dhost = el('div');
            root.appendChild(dhost);
            mountTable(paneId, dhost,
                ir.distortion_df ? { doc: ir.distortion_df } : { frame: payload.distortion_df },
                GRID_FULL);
        }
        for (const w of payload.warnings || []) {
            root.appendChild(el('div', { className: 'text-muted small fst-italic mt-1' }, `⚠ ${w}`));
        }
        // Against the root just built, not the pane: see `replacePaneTable`.
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

const priceBtn = $('price-btn');
priceBtn?.addEventListener('click', async () => {
    if (!state.id) return;
    const anchor = document.querySelector('input[name="price-anchor"]:checked')?.value || 'p';
    const anchorVal = parseFloat($('price-anchor-val').value);
    const target = document.querySelector('input[name="price-target"]:checked')?.value || 'coc';
    const val = parseFloat($('price-target-val').value);
    if (!Number.isFinite(anchorVal) || !Number.isFinite(val)) return;
    const body = {};
    body[anchor] = anchorVal;      // 'p' (a VaR probability) or 'a' (assets)
    body[target] = val;            // 'coc' or 'lr'
    priceBtn.disabled = true;
    priceBtn.textContent = 'Pricing…';
    try {
        if (state.hasReins) {
            renderReinsPrice(await api.reinsPrice(state.id, { ...body, basis: priceBasis }));
        } else {
            renderPrice(await api.price(state.id, body));
        }
    } catch (err) {
        replacePane('pane-price', errorNode(err));
    } finally {
        priceBtn.disabled = false;
        priceBtn.textContent = 'Price';
    }
});

// Anchor radio -> label, step and a sensible default. A probability lives in
// (0, 1] and steps by a thousandth; an asset level is money and does neither,
// so the input's constraints move with the choice rather than being left at the
// probability's and silently rejecting every asset figure.
document.querySelectorAll('input[name="price-anchor"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        const input = $('price-anchor-val');
        const isP = radio.value === 'p';
        $('price-anchor-label').textContent = isP ? 'p' : 'assets';
        input.step = isP ? '0.001' : '1';
        if (isP) input.max = '1'; else input.removeAttribute('max');
        input.value = isP ? '0.99' : '';
        if (!isP) input.focus();
    });
});

// Target radio -> label + a sensible default value.
document.querySelectorAll('input[name="price-target"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        const isCoc = radio.value === 'coc';
        $('price-target-label').textContent = isCoc ? 'CoC' : 'LR';
        $('price-target-val').value = isCoc ? '0.15' : '0.9';
    });
});

// ----------------------------------------------------------------------
// Bounds: how much of the price the choice of distortion decides
// ----------------------------------------------------------------------
// Ordinary pricing picks a distortion and reports its number. These hold the
// calibration fixed and let the distortion range over everything consistent
// with it, so the width of the answer is the reading: narrow means the premium
// decided the price, wide means the distortion did.
//
// The three leaves share one form, because they share one question. Only the
// `against` box differs, and it belongs to PricingBounds alone.
const BOUNDS_HINTS = {
    bounds: 'the band every consistent distortion sweeps, with fifty of them drawn',
    pricing: 'name a unit of this object, or write DecL for a line that does not exist yet',
    allocation: 'each unit’s range, consistent with the total premium',
};

/** Which bounds leaf is showing; the button reads it when you press Compute. */
let boundsWhich = 'bounds';

/**
 * Show one bounds leaf: same form, different extras, pane cleared.
 *
 * Nothing computes here. Each of the three is real work and wants a premium
 * that only you can choose, so arriving at a leaf sets it up and waits.
 */
async function showBoundsLeaf(which) {
    boundsWhich = which;
    $('bounds-against-field').classList.toggle('d-none', which !== 'pricing');
    $('bounds-hint').textContent = BOUNDS_HINTS[which] || '';
    // A premium has to sit above the expected loss for the question to mean
    // anything, so the object's own mean is the only sensible starting point.
    const premium = $('bounds-premium');
    if (!premium.value && Number.isFinite(state.mean)) {
        premium.value = Math.round(state.mean * 1.25);
    }
    replacePane('pane-bounds', el('div', { className: 'text-muted small' },
        'Set a premium and press Compute.'));
}

/** Render a bounds table: one row per unit or per named risk. */
function renderBoundsTable(payload) {
    const paneId = 'pane-bounds';
    const ir = payload.ir || {};
    const draw = () => {
        const root = el('div', { className: 'price-result' });
        replacePane(paneId, root);
        root.appendChild(el('div', { className: 'price-section-title' },
            `Consistent with a premium of ${fmt(payload.premium)}`));
        root.appendChild(el('div', { className: 'exhibit-caption mb-2' },
            'Lower and upper are the ends of the range over every distortion '
            + 'that prices this object to the premium above. Width is the '
            + 'reading: it is how much of the answer the choice of distortion '
            + 'decides rather than the calibration.'));
        const host = el('div');
        root.appendChild(host);
        mountTable(paneId, host,
            ir.table ? { doc: ir.table } : { frame: payload.table },
            { ...GRID_FULL, maxRows: 30 });
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

const boundsBtn = $('bounds-btn');
boundsBtn?.addEventListener('click', async () => {
    if (!state.id) return;
    const premium = parseFloat($('bounds-premium').value);
    if (!Number.isFinite(premium)) return;
    const assetsRaw = parseFloat($('bounds-assets').value);
    const assets = Number.isFinite(assetsRaw) ? assetsRaw : null;
    boundsBtn.disabled = true;
    boundsBtn.textContent = 'Computing…';
    try {
        if (boundsWhich === 'bounds') {
            // An image identified entirely by its query, so it is a GET and the
            // browser can cache it. No fetch: the <img> does the work.
            const img = el('img', {
                className: 'bounds-figure',
                src: api.boundsEnvelopeUrl(state.id, { premium, assets }),
                alt: 'pricing bounds envelope',
            });
            replacePane('pane-bounds', img);
        } else if (boundsWhich === 'allocation') {
            renderBoundsTable(await api.allocationBounds(state.id, { premium, assets }));
        } else {
            const against = $('bounds-against').value.trim();
            if (!against) return;
            renderBoundsTable(await api.pricingBounds(
                state.id, { premium, assets, against: [against] }));
        }
    } catch (err) {
        replacePane('pane-bounds', errorNode(err));
    } finally {
        boundsBtn.disabled = false;
        boundsBtn.textContent = 'Compute';
    }
});

// ----------------------------------------------------------------------
// Pricing / Evaluate: the breakeven acceptability panel
// ----------------------------------------------------------------------
/**
 * Render the evaluation panel.
 *
 * One tidy frame whose reading depends on what was evaluated. An aggregate or a
 * portfolio gives one block, a row per distortion family. A P&L gives one block
 * per margin row of its ledger, which for a tower is the whole story: the gross
 * deal, each layer as a position, and the running net after each purchase.
 */
function renderEvaluate(payload) {
    const paneId = 'pane-evaluate';
    const ir = payload.ir || {};
    const draw = () => {
        const root = el('div', { className: 'price-result' });
        replacePane(paneId, root);
        root.appendChild(el('div', { className: 'price-section-title' },
            'Breakeven acceptability'));
        root.appendChild(el('div', { className: 'exhibit-caption mb-2' },
            'The distortion in each family whose risk-adjusted margin is zero: '
            + 'the stress this position survives. `gini_p` is the '
            + 'family-agnostic index, so it compares across families and, for a '
            + 'walk, down the steps. A layer whose figure sits above the net row '
            + 'over it is priced above the holder’s own acceptability.'));
        const host = el('div');
        root.appendChild(host);
        mountTable(paneId, host,
            ir.panel ? { doc: ir.panel } : { frame: payload.panel },
            { ...GRID_FULL, maxRows: 30 });
        for (const warning of payload.warnings || []) {
            root.appendChild(el('div', { className: 'exhibit-caption mt-2' }, warning));
        }
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

const evaluateBtn = $('evaluate-btn');
evaluateBtn?.addEventListener('click', async () => {
    if (!state.id) return;
    const body = {};
    if (can('needsPremium')) {
        const premium = parseFloat($('evaluate-premium').value);
        if (!Number.isFinite(premium)) return;
        body.premium = premium;
    }
    evaluateBtn.disabled = true;
    evaluateBtn.textContent = 'Evaluating…';
    try {
        renderEvaluate(await api.evaluate(state.id, body));
    } catch (err) {
        replacePane('pane-evaluate', errorNode(err));
    } finally {
        evaluateBtn.disabled = false;
        evaluateBtn.textContent = 'Evaluate';
    }
});

// ----------------------------------------------------------------------
// Tab tools: copy a pane's text / download the plot SVG. Per-frame CSV download
// and copy are handled by CsvGrid's own export controls (copy / save), so the
// old per-tab "csv" buttons are gone: the grid is the single export path.
// ----------------------------------------------------------------------

/** Copy a pane's rendered text to the clipboard. */
async function copyPane(paneId, btn) {
    const text = ($(paneId)?.innerText || '').trim();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        if (btn) flash(btn, 'copied');
    } catch { /* clipboard blocked; nothing useful to say */ }
}

// Static copy buttons declared in the markup. The More tab builds its own,
// because which views offer one depends on the sub-view being shown.
document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => copyPane(btn.dataset.copy, btn));
});

document.querySelector('[data-plot-download]').addEventListener('click', () => {
    if (!state.id) return;
    window.open(api.plotUrl(state.id, { format: 'svg' }), '_blank');
});

function flash(btn, text) {
    const original = btn.innerHTML;
    btn.textContent = text;
    setTimeout(() => { btn.innerHTML = original; }, 900);
}

// ----------------------------------------------------------------------
// Examples dropdown + Ctrl+Shift-↑/↓ ring navigation
// ----------------------------------------------------------------------
// A flat ring of every example decl, seeded from the same /v1/examples
// payload (cached server-side). Independent of build history; navigated by
// Ctrl+Shift-↑/↓ for quick inspection of the whole library, and documented in
// the feedback line and the Help panel since a37. It was an undisclosed Alt-
// binding before that, which is a working feature nobody could find.
const exampleRing = { decls: [], cursor: -1 };

// Load a program into the editor. A library example arrives as `Recipe.decl`,
// already canonical spread-form DecL carrying its hints, so there is nothing to
// normalize: the old post-load /v1/decl/format round-trip is gone. Pass
// `formatted: false` for hand-written text (the Help panel's sample) to take
// that trip anyway. The Overview lead is read off the built object, so no note
// has to ride along here.
function loadExample(decl, formatted = true) {
    editor.setText(decl);
    editor.focus();
    if (formatted) return;
    const at = exampleRing.cursor;
    api.formatDecl(decl).then((res) => {
        if (exampleRing.cursor === at && res && res.decl) editor.setText(res.decl);
    }).catch(() => { /* keep raw */ });
}

function pickExample(item) {
    exampleRing.cursor = exampleRing.decls.indexOf(item.decl);  // sync the ring
    loadExample(item.decl);
}

mountExamples($('examples-menu'), pickExample);

// Ctrl+K opens the same library as a wider palette. Registered here rather
// than inside the dropdown so it works from anywhere on the page, including
// with focus in the editor.
mountPalette(pickExample);

// The ring walks every example in the library, flattened out of the grouped
// payload. An entry tagged in two topics appears in two groups, so dedupe on the
// decl to keep the ring a genuine cycle.
loadExamples().then((data) => {
    const seen = new Set();
    for (const cat of data.categories || []) {
        for (const item of cat.items || []) {
            if (seen.has(item.decl)) continue;
            seen.add(item.decl);
            exampleRing.decls.push(item.decl);
        }
    }
}).catch(() => { /* dropdown still works; the ring just stays empty */ });

// ----------------------------------------------------------------------
// The landing build
// ----------------------------------------------------------------------
// One of the entries tagged `role:hero` in library.agg, picked at random and
// built, so a visitor arrives on a populated page rather than an empty one and
// gets a different book each visit. The set grows over time, so never assume a
// fixed count.
//
// a37 took away the card gallery this fed, not the build. The cards are to come
// back inside the Examples dropdown, where a showcase is findable rather than
// occupying the top of the page; `pickRandom` and the sparkline endpoint are
// what that work will want, so the endpoint stays on the server.
//
// Retried once, and it reports. The author saw an empty hero row on a first page
// load that populated on the next, and the old code could not tell us why: one
// `.catch` covered both the fetch and the rendering, and it swallowed whatever
// it caught in silence. A cold server takes ~2 s to answer this route (it loads
// the whole recipe library on the first call), which is the sort of window a
// single transient failure hides in, so a second attempt is worth more than a
// diagnosis. The two failure modes stay separated: a fetch that fails twice says
// so, and a build that throws is not mistaken for one.
async function loadHeroes(attempt = 1) {
    let data;
    try {
        data = await api.heroes();
    } catch (err) {
        if (attempt === 1) {
            await new Promise((r) => setTimeout(r, 750));
            return loadHeroes(2);
        }
        console.warn('[aLL] landing example unavailable:', err);
        return;
    }
    const [item] = pickRandom(data.items || [], 1);
    if (!item) {
        console.warn('[aLL] no landing example: no entries tagged role:hero');
        return;
    }
    loadExample(item.decl);
    build();
}

// Before anything is built there is no object, so every derivation is greyed.
// Drawn once at startup rather than left to the first build, which would leave
// three live-looking buttons on an empty page.
renderActionRow();

loadHeroes();

// Fisher-Yates partial shuffle -> first n. Math.random is fine here (purely
// cosmetic which-example-shows choice; not reproducibility-sensitive).
function pickRandom(arr, n) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
}

function exampleStep(dir) {
    const n = exampleRing.decls.length;
    if (!n) return;
    exampleRing.cursor = dir === 'prev'
        ? (exampleRing.cursor + 1) % n
        : (exampleRing.cursor - 1 + n) % n;
    loadExample(exampleRing.decls[exampleRing.cursor]);
}

// ----------------------------------------------------------------------
// Help offcanvas: "Load it" drops the sample program into the editor
// ----------------------------------------------------------------------
// Reuse loadExample, with formatted=false so the hand-written sample gets the
// format_program round-trip a library entry no longer needs. Close the panel and
// return focus to the editor once it has finished animating out, so Bootstrap's
// focus-restore doesn't bounce back to the trigger.
const helpLoad = $('help-load');
if (helpLoad) {
    helpLoad.addEventListener('click', () => {
        const sample = $('help-example').textContent.trim();
        const panel = $('helpPanel');
        panel.addEventListener('hidden.bs.offcanvas',
            () => editor.focus(), { once: true });
        loadExample(sample, false);
        bootstrap.Offcanvas.getOrCreateInstance(panel).hide();
    });
}

// ----------------------------------------------------------------------
// About panel: tool versions + session-model download
// ----------------------------------------------------------------------
// Bundled-library versions are build-time constants (inlined by Vite's define);
// aggregate / api versions come from the backend at runtime.
$('about-grid').textContent = __CSV_GRID_VERSION__;
$('about-echarts').textContent = __ECHARTS_VERSION__;
$('about-echarts-gl').textContent = __ECHARTS_GL_VERSION__;
$('about-bootstrap').textContent = __BOOTSTRAP_VERSION__;
api.meta().then((meta) => {
    $('about-aggregate').textContent = meta.aggregate_version;
    $('about-api').textContent = meta.version;
    // Not a build-time constant like the rest: the static-table walker is served
    // from the installed Python package, so the server is what knows its version.
    $('about-tables').textContent = meta.tables_version;
}).catch(() => {
    $('about-api').textContent = '(api offline)';
});

// Download every DecL program built this session: raw (as typed, from the object
// cache) or agg (canonical, re-loadable, from the underwriter's session
// knowledge). The attachment header makes the browser save the file.
$('dl-raw')?.addEventListener('click', () => window.open(api.sessionModelsUrl('raw')));
$('dl-agg')?.addEventListener('click', () => window.open(api.sessionModelsUrl('agg')));

// ----------------------------------------------------------------------
// PWA service worker (production bundle only)
// ----------------------------------------------------------------------
// Registered only in the built bundle so the Vite dev server's HMR isn't
// intercepted. Makes the SPA installable and speeds repeat loads; the caching
// strategy lives in web/public/sw.js (served verbatim at /sw.js, scope /).
// Requires a secure context (HTTPS or localhost), and is a no-op otherwise.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ });
    });
}
