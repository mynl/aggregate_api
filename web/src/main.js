// SPA entry point. Loaded by index.html as a module.
//
// Responsibilities:
//   * import Bootstrap (CSS + JS) and Bootstrap Icons + our CSS so Vite
//     bundles everything (no runtime CDN)
//   * construct the CM6 editor + wire build / history / clear / emacs
//   * wire the Build button, log2 / bs dropdowns, Examples dropdown
//   * render the one-line build summary
//   * lazily fetch + render each output tab (Info / Summary / Plot /
//     Reins, plus Stats under the More dropdown), caching per built
//     object; Price and Density are placeholders (wired later)
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
    hasReins: false,        // gates the Reins tab and the Price basis selector
    log2: null,             // null = auto
    bs: null,               // null = auto
    loaded: new Set(),      // tab names whose data has been fetched
    reinsWhich: 'reins_summary_df',
    moreWhich: 'validation',   // which sub-view the More tab is showing
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

// Reset the history cursor whenever the user types something new so
// arrow-up resumes from the latest entry on the next press.
editor.view.dom.addEventListener('keydown', (ev) => {
    // Plain ↑/↓ drive history navigation (see editor.js) -- don't reset the
    // cursor on them or sequential history walking breaks.
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

// Emacs keys switch -- reflect the persisted default, then toggle live.
const emacsSwitch = $('emacs-switch');
emacsSwitch.checked = emacsEnabledDefault();
emacsSwitch.addEventListener('change', () => editor.setEmacs(emacsSwitch.checked));

// ----------------------------------------------------------------------
// log2 / bs dropdowns
// ----------------------------------------------------------------------
function wireOptionDropdown(menuId, valId, onPick) {
    const menu = $(menuId);
    menu.querySelectorAll('a.dropdown-item[data-val]').forEach((a) => {
        a.addEventListener('click', (ev) => {
            ev.preventDefault();
            menu.querySelectorAll('a.dropdown-item').forEach(x => x.classList.remove('active'));
            a.classList.add('active');
            $(valId).textContent = a.textContent.trim();
            onPick(a.dataset.val);
        });
    });
}

wireOptionDropdown('log2-menu', 'log2-val', (val) => {
    state.log2 = val === 'auto' ? null : parseInt(val, 10);
});
wireOptionDropdown('bs-menu', 'bs-val', (val) => {
    state.bs = val === 'auto' ? null : parseFloat(val);
});

// Custom bs: free text, committed on Enter.
const bsCustom = $('bs-custom');
bsCustom.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const v = parseFloat(bsCustom.value);
    if (!Number.isFinite(v) || v <= 0) return;
    state.bs = v;
    $('bs-val').textContent = bsCustom.value.trim();
    $('bs-menu').querySelectorAll('a.dropdown-item').forEach(x => x.classList.remove('active'));
    bootstrap.Dropdown.getOrCreateInstance($('bs-btn')).hide();
});

// ----------------------------------------------------------------------
// Build
// ----------------------------------------------------------------------
const buildBtn = $('build-btn');

async function build() {
    const decl = editor.getText().trim();
    if (!decl) return;

    buildBtn.disabled = true;
    buildBtn.textContent = 'Building…';

    const opts = {};
    if (state.log2 != null) opts.log2 = state.log2;
    if (state.bs != null) opts.bs = state.bs;

    try {
        const res = await api.build(decl, opts);
        state.id = res.id;
        state.kind = res.kind;
        state.name = res.name;
        // The exhibit draws a mean reference line; the build response already
        // carries it, so there is no reason to refetch a frame to find it.
        state.mean = res.mean;
        state.hasReins = Boolean(res.has_reins);
        state.loaded = new Set();
        renderSummary(res);
        history.record(decl);
        clearPanes();
        loadActiveTab();
    } catch (err) {
        state.id = state.kind = state.name = state.mean = null;
        state.hasReins = false;
        renderBuildFailure(err);
    } finally {
        buildBtn.disabled = false;
        buildBtn.textContent = 'Build';
    }
}

buildBtn.addEventListener('click', build);

// ----------------------------------------------------------------------
// Build summary line
// ----------------------------------------------------------------------
// The api reports the library's own kind vocabulary (`bvagg`, not `bivariate`):
// where the two disagree on a name, aggregate wins and this app follows.
// KIND_LABEL is the display form, KIND_WORD the lower-case noun for the timing
// line ("Calculated <word> in 0.123 seconds").
const KIND_LABEL = {
    agg: 'Aggregate', port: 'Portfolio', sev: 'Severity',
    distortion: 'Distortion', bvagg: 'Bivariate', pnl: 'P&L',
};
const KIND_WORD = {
    agg: 'aggregate', port: 'portfolio', sev: 'severity',
    distortion: 'distortion', bvagg: 'bivariate', pnl: 'P&L',
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

function renderSummary(res) {
    const inner = $('summary-inner');
    empty(inner);
    applyKindGating(res.kind, res.has_reins);
    renderPriceBasis();
    const kindLabel = KIND_LABEL[res.kind] || 'Aggregate';
    const bits = [
        el('span', { className: 'nm' }, res.name || '(anonymous)'),
        el('span', { className: 'mono ms-2' }, kindLabel),
    ];
    if (res.bs != null)   { bits.push(sep(), el('span', { className: 'mono' }, `bs = ${fmtBs(res.bs)}`)); }
    if (res.mean != null) { bits.push(sep(), el('span', { className: 'mono' }, `mean ${fmt(res.mean)}`)); }
    if (res.cv != null)   { bits.push(sep(), el('span', { className: 'mono' }, `CV ${fmt(res.cv)}`)); }
    if (res.validation) {
        const ok = res.validation.trim() === 'not unreasonable';
        bits.push(sep(), el('span', { className: `mono ${ok ? 'ok' : 'warn'}` }, res.validation));
    }
    if (res.cached) { bits.push(sep(), el('span', { className: 'mono' }, 'cached')); }
    inner.append(...bits);
    renderTiming(res);
    syncSummaryMore();
}

/** Sub-line: "Calculated aggregate in 0.000 seconds" (or cache note). */
function renderTiming(res) {
    const node = $('summary-timing');
    if (!node) return;
    if (res.elapsed_ms == null) { node.textContent = ''; return; }
    const word = KIND_WORD[res.kind] || 'aggregate';
    node.textContent = res.cached
        ? `Loaded ${word} from cache`
        : `Calculated ${word} in ${(res.elapsed_ms / 1000).toFixed(3)} seconds`;
}

function renderBuildFailure(err) {
    const limited = err instanceof ApiError && err.status === 429;
    const inner = $('summary-inner');
    empty(inner);
    inner.appendChild(el('span', { className: 'mono warn' },
        limited ? 'rate limited; please pause a moment' : 'build failed'));
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
// One pane per top-level tab. There is no `summary` entry: summary_df is an
// Overview exhibit, and showing it twice was the same table in two places.
const PANE_OF = {
    overview: 'pane-overview', plot: 'pane-plot', price: 'pane-price',
    reins: 'pane-reins', bounds: 'pane-bounds', more: 'pane-more',
};

function clearPanes() {
    destroyAllGrids();
    for (const id of Object.values(PANE_OF)) empty($(id));
    empty($('reins-desc'));
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    empty($('reins-plot'));
}

function activeTabName() {
    const link = document.querySelector('.out-tabs [data-tab].active');
    return link ? link.dataset.tab : 'overview';
}

function showTab(name) {
    const btn = document.querySelector(`.out-tabs [data-tab="${name}"]`);
    if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
}

// ---- More: one pane, a sub-button row selects the view ----
// The same shape as Reins, which is the point: a dropdown nested inside a pill
// bar was the one control on the page that behaved differently from everything
// around it.
const MORE_VIEWS = {
    validation: {
        label: 'Validation',
        hint: 'theoretical vs empirical moments; reads “not unreasonable” on a clean build',
        copy: true,
        load: async () => replacePaneTable('pane-more', 'validation_df',
            { columnFilters: false }),
    },
    stats: {
        label: 'Stats',
        hint: 'frequency / severity / aggregate moments; raw moment rows are dropped',
        load: async () => replacePaneTable('pane-more', 'stats_df', GRID_FULL),
    },
    density: {
        label: 'Density',
        hint: 'binned to a power-of-two display grid; copy / save from the grid',
        load: async () => {
            // `resolution: 'display'` here and nowhere else. The *plots* take
            // every grid point, because a binned atom is a lie; a *table* of
            // 65,536 rows is not a reading experience, and the CSV download is
            // the exact export for anyone who wants the lot.
            //
            // A distortion's density_df is the g-curve over s in [0,1]; a
            // bivariate's is its two component marginals; a severity's is a
            // sampled loss / pdf / F / S curve. None has the aggregate's
            // columns, so pull the whole frame for those.
            const opts = { resolution: 'display' };
            // renderCap lifts CsvGrid's 2,000-row default so the whole display
            // grid shows without a "show all" prompt. 8,192 is the widest that
            // grid gets (see serializers.display_log2_for).
            //
            // The bulk path, permanently: even binned to the display grid this
            // is thousands of rows, so it never becomes a document. The filters
            // are how you read a quantile off it, which is the grid's whole job.
            await replacePaneTable('pane-more', 'density_df',
                { ...GRID_FULL, maxRows: 25, renderCap: 8192 },
                () => (WHOLE_DENSITY_KINDS.has(state.kind)
                    ? api.density_df(state.id, opts)
                    : api.density_df(state.id, { ...opts, cols: 'loss,p_total,F,S' })));
        },
    },
    bswin: {
        label: 'bs window',
        hint: 'bucket / window estimator; the selected row is the chosen grid',
        load: async () => replacePaneTable('pane-more', 'bs_window_df', GRID_FULL),
    },
    info: {
        label: 'Info (raw)',
        hint: 'the object’s own info block, verbatim',
        copy: true,
        load: async () => replacePane('pane-more', renderInfo(await api.info(state.id))),
    },
};

// Sub-views a kind cannot answer, greyed out rather than removed, same rule as
// the tabs. A Severity carries no frames at all beyond its sampled density.
const NA_MORE_BY_KIND = {
    distortion: ['bswin'],
    bvagg: ['bswin'],
    pnl: ['bswin'],
    sev: ['validation', 'stats', 'bswin'],
};

/** Render the More sub-button row for the current kind. */
function renderMoreTools() {
    const tools = $('more-tools');
    if (!tools) return;
    empty(tools);
    const na = new Set(NA_MORE_BY_KIND[state.kind] || []);
    for (const [key, view] of Object.entries(MORE_VIEWS)) {
        const off = na.has(key);
        const btn = el('button', {
            type: 'button',
            className: `btn btn-outline-secondary${key === state.moreWhich ? ' active' : ''}`
                + (off ? ' disabled' : ''),
            onClick: () => {
                if (off) return;
                state.moreWhich = key;
                renderMoreTools();
                loadMoreView();
            },
        }, view.label);
        if (off) btn.setAttribute('disabled', '');
        tools.appendChild(btn);
    }
    const view = MORE_VIEWS[state.moreWhich];
    if (view?.copy) {
        const copyBtn = el('button', { className: 'btn btn-outline-secondary' }, 'copy');
        copyBtn.addEventListener('click', () => copyPane('pane-more', copyBtn));
        tools.appendChild(copyBtn);
    }
    if (view?.hint) {
        tools.appendChild(el('span', {
            className: 'text-muted ms-1', style: 'font-size:.7rem;',
        }, view.hint));
    }
}

async function loadMoreView() {
    if (!state.id) return;
    const view = MORE_VIEWS[state.moreWhich];
    if (!view) return;
    // A disabled view can still be the sticky default from a previous kind;
    // fall back rather than firing a request that will 400.
    if ((NA_MORE_BY_KIND[state.kind] || []).includes(state.moreWhich)) {
        state.moreWhich = 'info';
        renderMoreTools();
        return loadMoreView();
    }
    try {
        await view.load();
    } catch (err) {
        replacePane('pane-more', errorNode(err));
    }
}

// Tabs that need something the object does not have. A Distortion, a
// BivariateAggregate or a PnL has no pricing, reinsurance or bs window; a
// Severity is a look-through onto a frozen scipy variable and has none of the
// frames. Per the house rule we NEVER hide menu items (the menu set stays
// stable), we grey them out so the user can see what does not apply. Bounds is
// disabled for every kind until it is built.
const NA_TABS_BY_KIND = {
    distortion: ['price', 'reins'],
    bvagg: ['price', 'reins'],
    pnl: ['price', 'reins'],
    sev: ['price', 'reins'],
};
const GATED_TABS = ['price', 'reins'];

/**
 * Grey out the tabs this object cannot answer, and land somewhere it can.
 *
 * Two inputs, not one: the kind, and whether the object carries a cession. An
 * Aggregate with no reinsurance used to leave Reins enabled and open a pane
 * reading "No reinsurance on this object", which is the tab telling you it was
 * the wrong tab after you clicked it. `has_reins` rides along on the build
 * response, so the pill can say so before you do.
 *
 * The active tab is left alone unless it just went dark. Stepping through
 * examples on the Price tab should stay on Price, and the only reason to move is
 * that there is nothing there any more.
 */
function applyKindGating(kind, hasReins = false) {
    const na = new Set(NA_TABS_BY_KIND[kind] || []);
    if (!hasReins) na.add('reins');
    for (const tab of GATED_TABS) {
        const btn = document.querySelector(`.out-tabs [data-tab="${tab}"]`);
        if (!btn) continue;
        const off = na.has(tab);
        // Clear any legacy hide so the menu set is always complete, then grey
        // out via Bootstrap's .disabled + the native attribute (self-styling,
        // pointer-events: none, and Bootstrap's Tab plugin won't activate it).
        btn.closest('li').classList.remove('d-none');
        btn.classList.toggle('disabled', off);
        btn.toggleAttribute('disabled', off);
        btn.setAttribute('aria-disabled', off ? 'true' : 'false');
    }
    // If the active tab was just disabled, fall back to the landing tab, which
    // every kind can answer.
    if (na.has(activeTabName())) showTab('overview');
}

function loadActiveTab() { loadTab(activeTabName()); }

// Bootstrap fires shown.bs.tab on the tab trigger when a pill activates.
document.querySelectorAll('.out-tabs [data-tab]').forEach((btn) => {
    btn.addEventListener('shown.bs.tab', () => loadTab(btn.dataset.tab));
});

async function loadTab(name) {
    if (!state.id) return;
    if (state.loaded.has(name)) return;
    state.loaded.add(name);
    try {
        if (name === 'overview') {
            await loadOverview();
        } else if (name === 'plot') {
            const img = el('img', { src: api.plotUrl(state.id, { format: 'svg' }), alt: 'native plot' });
            replacePane('pane-plot', img);
        } else if (name === 'reins') {
            await loadReins();
        } else if (name === 'more') {
            renderMoreTools();
            await loadMoreView();
        }
    } catch (err) {
        state.loaded.delete(name);   // allow a retry on the next activation
        replacePane(PANE_OF[name] || 'pane-overview', errorNode(err));
    }
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

// The Static | Interactive control on the Overview, writing the page-wide
// preference the header dropdown also writes.
//
// Both affordances exist on purpose. The dropdown is where a page-wide setting
// belongs; this is on the landing tab, next to the tables it changes, which is
// where anyone would first reach for it.
//
// Same pill shape as the chart's own toggles, in the code red rather than the
// primary blue. They are the same kind of control (a sticky view switch) so they
// should look like each other; they steer different halves of the tab, so a
// glance should still tell them apart.
function exhibitToggle() {
    const btns = [['static', 'Static'], ['interactive', 'Interactive']].map(([mode, label]) => {
        const b = el('button', {
            type: 'button',
            className: 'exhibit-toggle exhibit-toggle--table'
                + (_tableView === mode ? ' active' : ''),
        }, label);
        b.addEventListener('click', () => setTableView(mode));
        return b;
    });
    const row = el('div', { className: 'overview-view-toggle' },
        el('span', { className: 'overview-view-label' }, 'Tables'), ...btns);
    // Follow the preference however it was changed, so the pills stay honest
    // when the dropdown is what moved it.
    onTableViewChange('overview-pills', () => {
        btns.forEach((b, i) => b.classList.toggle('active',
            ['static', 'interactive'][i] === _tableView));
    }, row);
    return row;
}

// Render the summary_df + tail_df exhibits into `box` per the current view mode.
// Everything mounted registers under 'pane-overview', so clearGrids tears down
// the previous mode before each (re-)render.
function renderOverviewExhibits(box, ir = {}) {
    clearGrids('pane-overview');
    empty(box);
    if (ir.summary) renderOneExhibit(box, ir.summary, {
        title: 'Summary',
        caption: 'Moments and key percentiles. CV blank for signed / near-break-even '
            + 'rows; Freq percentiles blank by design (PGF-only).',
    });
    if (ir.tail) renderOneExhibit(box, ir.tail, {
        title: 'Tail risk',
        caption: '1-in-200 (Solvency II) and 1-in-250 (US) are the capital anchors. '
            + 'Exact from the FFT grid, not simulated.',
    });
}

// One exhibit: the static table walked from its document, or the interactive
// CsvGrid derived from the same one. Title and caption are the SPA's own either
// way, so the two views differ in the table and in nothing else.
function renderOneExhibit(box, doc, opts) {
    if (opts.title) box.appendChild(el('h6', { className: 'exhibit-title' }, opts.title));
    const host = el('div');
    box.appendChild(host);
    mountTable('pane-overview', host, { doc }, GRID_FULL);
    if (opts.caption) box.appendChild(el('div', { className: 'exhibit-caption' }, opts.caption));
}

/**
 * The object's own header block: name, kind, tags, and the note as the lead.
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
 * The program and its hints are deliberately **not** shown here. They sit in
 * the editor a few centimetres up the page, so a disclosure repeating them was
 * spending the most valuable strip of the tab on something already on screen.
 * The exhibit's toggle row occupies that space instead.
 */
function renderOverviewHeader(meta) {
    if (!meta) return null;
    const head = el('div', { className: 'overview-head' });

    const line = el('div', { className: 'overview-ident' },
        el('span', { className: 'overview-name' }, meta.name || '(anonymous)'),
        el('span', { className: 'overview-kind mono' }, KIND_LABEL[meta.kind] || meta.kind));
    for (const tag of meta.tags || []) {
        line.appendChild(el('span', { className: 'overview-tag' }, tag));
    }
    head.appendChild(line);

    if (meta.note) head.appendChild(el('p', { className: 'overview-note' }, meta.note));
    return head;
}

// ---- Overview tab: header block + exhibit + summary_df / tail_df ----
// The landing tab. Each section is best-effort: a frame the object doesn't
// carry just 400s and is skipped, so the tab degrades gracefully rather than
// erroring.
async function loadOverview() {
    if (overviewChart) { overviewChart.dispose(); overviewChart = null; }
    clearGrids('pane-overview');
    const pane = $('pane-overview');
    empty(pane);
    let rendered = false;

    // 1. Header block: name / kind / tags / note / program, from the object.
    const meta = await api.meta_of(state.id).catch(() => null);
    const head = renderOverviewHeader(meta);
    if (head) { pane.appendChild(head); rendered = true; }

    // 2. The exhibit: two linked panels for anything with a loss distribution,
    // a g-curve for a distortion, a joint heatmap for a bivariate.
    const host = el('div', { className: 'overview-plot' });
    pane.appendChild(host);
    // `mountExhibit` owns the box: it draws the skeleton at the exhibit's final
    // size before fetching anything, and awaits `loadStyle()` behind it. Nothing
    // to reserve from out here, which is the point. Reserving from the call site
    // meant guessing the geometry, and the guess was the two-panel one for every
    // kind, so a distortion or a bivariate reserved the wrong box entirely.
    try {
        overviewChart = await mountExhibit(host, state);
    } catch { /* the exhibit is a bonus; the tables still carry the story */ }
    if (overviewChart) rendered = true;
    else pane.removeChild(host);

    // 3. Risk exhibits (summary_df + tail_df) with a Static | Interactive toggle.
    // One document each, feeding both views: the walker draws it, and
    // `irToGridInput` derives the grid's input from the same bytes. So flipping
    // the toggle costs no round trip and the two views cannot disagree.
    const [summaryDoc, tailDoc] = await Promise.all([
        api.frameIr(state.id, 'summary').catch(() => null),
        api.frameIr(state.id, 'tail_df').catch(() => null),
    ]);
    const ir = { summary: summaryDoc, tail: tailDoc };
    if (summaryDoc || tailDoc) {
        const box = el('div', { className: 'overview-exhibits' });
        pane.appendChild(exhibitToggle());
        pane.appendChild(box);
        renderOverviewExhibits(box, ir);
        onTableViewChange('pane-overview', () => renderOverviewExhibits(box, ir), box);
        rendered = true;
    }

    if (!rendered) {
        pane.appendChild(el('div', { className: 'text-muted small' },
            'No risk views for this object. See the other tabs.'));
    }
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

async function loadReins() {
    const descEl = $('reins-desc');
    empty(descEl);
    let info;
    try {
        info = await api.reinsDescription(state.id);
    } catch (err) {
        replacePane('pane-reins', errorNode(err));
        return;
    }
    if (!info.available) {
        replacePane('pane-reins', el('div', { className: 'text-muted small' },
            'No reinsurance on this object.'));
        return;
    }
    if (info.text) descEl.appendChild(el('span', { className: 'mono' }, info.text));
    await Promise.all([loadReinsExhibit(), loadReinsFrame()]);
}

/**
 * The gross / ceded / net exhibit, above the per-layer tables.
 *
 * Reuses the Overview's two-panel instrument pointed at three views of one
 * book, so the same reading applies: the left panel is what the cession does to
 * the shape, the right is what it does to the tail, which is the question a
 * reinsurance structure exists to answer.
 */
async function loadReinsExhibit() {
    const host = $('reins-plot');
    if (!host) return;
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    empty(host);
    // Same skeleton as the Overview, in the shape this exhibit draws (two
    // panels). `mountReinsExhibit` is synchronous and takes the frame already
    // fetched, so unlike the Overview the box is reserved from here, and
    // `loadStyle` still has to land before the build reads the colors.
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
    if (!reinsChart) empty(host);
}

async function loadReinsFrame() {
    if (!state.id) return;
    try {
        // `state.reinsWhich` is already the frame name both routes want. The
        // density is the bulk one: the table takes the binned grid, and only the
        // exhibit above wants every point.
        const bulk = state.reinsWhich === 'reins_density_df'
            ? () => api.frameOf(state.id, state.reinsWhich, { resolution: 'display' })
            : null;
        await replacePaneTable('pane-reins', state.reinsWhich,
            { ...GRID_FULL, renderCap: 8192 }, bulk);
    } catch (err) {
        replacePane('pane-reins', errorNode(err));
    }
}

// Reins sub-buttons switch which frame is shown.
document.querySelectorAll('[data-reins]').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-reins]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.reinsWhich = btn.dataset.reins;
        if (state.id) loadReinsFrame();
    });
});

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
    const p = parseFloat($('price-p').value);
    const target = document.querySelector('input[name="price-target"]:checked')?.value || 'coc';
    const val = parseFloat($('price-target-val').value);
    if (!Number.isFinite(p) || !Number.isFinite(val)) return;
    const body = { p };
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

// Target radio -> label + a sensible default value.
document.querySelectorAll('input[name="price-target"]').forEach((radio) => {
    radio.addEventListener('change', () => {
        const isCoc = radio.value === 'coc';
        $('price-target-label').textContent = isCoc ? 'CoC' : 'LR';
        $('price-target-val').value = isCoc ? '0.15' : '0.9';
    });
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
// Examples dropdown + (undisclosed) Alt-↑/↓ ring navigation
// ----------------------------------------------------------------------
// A flat ring of every example decl, seeded from the same /v1/examples
// payload (cached server-side). Independent of build history; navigated by
// Alt-↑/↓ for quick inspection of the whole library. Not surfaced in the UI.
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

// The Alt-↑/↓ ring walks every example in the library, flattened out of the
// grouped payload. An entry tagged in two topics appears in two groups, so
// dedupe on the decl to keep the ring a genuine cycle.
loadExamples().then((data) => {
    const seen = new Set();
    for (const cat of data.categories || []) {
        for (const item of cat.items || []) {
            if (seen.has(item.decl)) continue;
            seen.add(item.decl);
            exampleRing.decls.push(item.decl);
        }
    }
}).catch(() => { /* dropdown still works; Alt-nav just stays empty */ });

// Hero gallery: the entries tagged `role:hero` in library.agg. The set grows
// over time, so never assume a fixed count; a random handful shows each load.
//
// Retried once, and it reports. The author saw an empty hero row on a first page
// load that populated on the next, and the old code could not tell us why: one
// `.catch` covered both the fetch and the rendering, and it swallowed whatever
// it caught in silence. A cold server takes ~2 s to answer this route (it loads
// the whole recipe library on the first call), which is the sort of window a
// single transient failure hides in, so a second attempt is worth more than a
// diagnosis. The two failure modes are now separated: a fetch that fails twice
// says so, and a render that throws is not mistaken for one.
async function loadHeroes(attempt = 1) {
    let data;
    try {
        data = await api.heroes();
    } catch (err) {
        if (attempt === 1) {
            await new Promise((r) => setTimeout(r, 750));
            return loadHeroes(2);
        }
        console.warn('[aLL] hero gallery unavailable:', err);
        return;
    }
    const items = pickRandom(data.items || [], 4);
    if (!items.length) {
        console.warn('[aLL] hero gallery empty: no entries tagged role:hero');
        return;
    }
    mountHeroes(items);
}

loadHeroes();

// ----------------------------------------------------------------------
// Hero gallery -- clickable showcase cards above the editor
// ----------------------------------------------------------------------
// Cards mount immediately on their placeholder gradient, then upgrade to a
// real density silhouette when the sparkline payload lands. That order is
// deliberate: the sparkline endpoint *builds every hero*, one of which carries
// hints{log2=16}, so a card that waited for it would leave the landing page
// blank for seconds. Nothing on the landing path may block on that request.
function mountHeroes(items) {
    const row = $('hero-row');
    if (!row) return;
    empty(row);
    if (!items.length) { row.classList.add('d-none'); return; }
    row.classList.remove('d-none');

    const thumbs = new Map();
    items.forEach((item, i) => {
        const thumb = el('span', {
            className: 'hero-thumb',
            style: `background:${gradientFor(item.name)}`,
        });
        thumbs.set(item.name, thumb);
        row.appendChild(el('button', {
            className: 'hero-card', type: 'button', title: item.note || '',
            onClick: () => { loadExample(item.decl); build(); },
        }, thumb, el('span', { className: 'hero-name' }, item.name)));
        // Auto-build the first card so the visitor lands on a populated page.
        if (i === 0) { loadExample(item.decl); build(); }
    });

    api.heroSparklines().then((data) => {
        for (const [name, values] of Object.entries(data.sparklines || {})) {
            const thumb = thumbs.get(name);
            if (thumb && values.length) upgradeThumb(thumb, values);
        }
    }).catch(() => { /* placeholders stay; a thumbnail is not worth an error */ });
}

/** Replace a card's gradient with an SVG silhouette of its density. */
function upgradeThumb(thumb, values) {
    const W = 100;
    const H = 40;
    const step = W / Math.max(values.length - 1, 1);
    // Values are peak-normalized in [0, 1]; invert for SVG's y-down axis and
    // leave a 2px margin so the peak is not clipped by the viewBox edge.
    const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(H - 2 - v * (H - 4)).toFixed(2)}`);
    const area = `0,${H} ${pts.join(' ')} ${W},${H}`;
    thumb.style.background = '';
    thumb.classList.add('hero-thumb-spark');
    // Built as markup rather than through el(): SVG needs createElementNS, and
    // this is a fixed shape with no user content in it.
    thumb.innerHTML =
        `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
        + `<polygon points="${area}"/><polyline points="${pts.join(' ')}"/></svg>`;
}

// The placeholder thumbnail: a gradient seeded by the name hash. Shown until
// the sparkline arrives, and permanently for a hero whose build failed.
function gradientFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const a = h % 360;
    const b = (a + 40 + (h >> 8) % 80) % 360;
    return `linear-gradient(135deg, hsl(${a} 70% 62%), hsl(${b} 65% 45%))`;
}

// Fisher-Yates partial shuffle -> first n. Math.random is fine here (purely
// cosmetic which-heroes-show choice; not reproducibility-sensitive).
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
$('about-plotly').textContent = __PLOTLY_VERSION__;
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
