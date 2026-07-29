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
import { mountExamples, loadExamples } from './examples.js';
import { renderInfo, renderExhibit } from './renderers.js';
import { mountInteractivePlot, markerLegend } from './plot-interactive.js';
import { mountGrid, clearGrids, destroyAllGrids } from './grid.js';
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
const state = {
    id: null,
    kind: null,
    name: null,
    note: null,             // description for the Overview lead (from an example)
    log2: null,             // null = auto
    bs: null,               // null = auto
    loaded: new Set(),      // tab names whose data has been fetched
    reinsWhich: 'reins_summary_df',
};

// The note for the *next* build. Set when an example / hero is loaded; cleared
// the moment the user types into the editor (so a hand-edited program doesn't
// inherit a stale description). Captured into state.note at build time.
let pendingNote = null;

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
    if (!ev.ctrlKey && !ev.metaKey) {
        history.resetCursor();
        pendingNote = null;   // a hand-edited program is no longer "the example"
    }
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
        state.note = pendingNote;   // the example's description, if this is one
        state.loaded = new Set();
        renderSummary(res);
        history.record(decl);
        clearPanes();
        loadActiveTab();
    } catch (err) {
        state.id = state.kind = state.name = null;
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
const WHOLE_DENSITY_KINDS = new Set(['distortion', 'bvagg']);

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
    applyKindGating(res.kind);
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
        limited ? 'rate limited — please pause a moment' : 'build failed'));
    $('summary-timing').textContent = '';
    syncSummaryMore();
    // Surface the rich parse-error report (or the friendly rate-limit card)
    // in the Info pane and show it.
    const pane = $('pane-info');
    empty(pane);
    if (limited) pane.appendChild(renderRateLimit(err.retryAfter));
    else if (err instanceof ApiError) pane.appendChild(renderError(err));
    else pane.appendChild(el('div', { className: 'alert alert-danger' }, err.message));
    showTab('info');
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
const PANE_OF = {
    overview: 'pane-overview', info: 'pane-info', summary: 'pane-summary',
    validation: 'pane-validation', plot: 'pane-plot',
    stats: 'pane-stats', reins: 'pane-reins',
    density: 'pane-density', bswin: 'pane-bswin', price: 'pane-price',
};

function clearPanes() {
    destroyAllGrids();
    for (const id of Object.values(PANE_OF)) empty($(id));
    empty($('reins-desc'));
}

// Tab triggers carry data-tab; they live either as top-level .nav-link or
// as .dropdown-item inside the More dropdown, so select on [data-tab] (not
// .nav-link) to catch both.
function activeTabName() {
    const link = document.querySelector('.out-tabs [data-tab].active');
    return link ? link.dataset.tab : 'info';
}

function showTab(name) {
    const btn = document.querySelector(`.out-tabs [data-tab="${name}"]`);
    if (btn) bootstrap.Tab.getOrCreateInstance(btn).show();
}

// Tabs that need a loss distribution. A standalone Distortion, a
// BivariateAggregate or a PnL exposes info / summary / stats / density / plot
// but has no pricing, reinsurance or bs window. A Severity is a look-through
// onto a frozen scipy variable, so it carries info and plot and none of the
// frames. Per the playground house rule we NEVER hide menu items (the menu set
// stays stable), we grey them out so the user can see what does not apply.
// agg and port disable nothing.
const NA_TABS_BY_KIND = {
    distortion: ['price', 'reins', 'bswin'],
    bvagg: ['price', 'reins', 'bswin'],
    pnl: ['price', 'reins', 'bswin'],
    sev: ['price', 'reins', 'bswin', 'summary', 'validation', 'stats', 'density'],
};
const GATED_TABS = [
    'price', 'reins', 'bswin', 'summary', 'validation', 'stats', 'density',
];

function applyKindGating(kind) {
    const na = new Set(NA_TABS_BY_KIND[kind] || []);
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
    // If the active tab was just disabled, fall back to Info.
    if (na.has(activeTabName())) showTab('info');
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
        } else if (name === 'info') {
            replacePane('pane-info', renderInfo(await api.info(state.id)));
        } else if (name === 'summary') {
            // Keep the fzf bar but drop the per-column filter row — the summary
            // table is narrow and the global search covers it.
            replacePaneGrid('pane-summary', await api.summary(state.id), { columnFilters: false });
        } else if (name === 'validation') {
            replacePaneGrid('pane-validation', await api.validation_df(state.id), { columnFilters: false });
        } else if (name === 'plot') {
            const img = el('img', { src: api.plotUrl(state.id, { format: 'svg' }), alt: 'native plot' });
            replacePane('pane-plot', img);
        } else if (name === 'stats') {
            replacePaneGrid('pane-stats', await api.stats_df(state.id), GRID_FULL);
        } else if (name === 'reins') {
            await loadReins();
        } else if (name === 'density') {
            // A distortion's density_df is the g-curve (g, g_inv, g_dual,
            // g_prime, ...) over x in [0,1] -- ~101 rows; a BivariateAggregate's
            // is the full joint-density matrix. Neither has the loss,p_total,F,S
            // columns, so pull the whole frame for those. For agg/port the server
            // bins the density to a faithful 2**11 display grid (p_total stays
            // correct), so we only ask for the curated columns -- no nonzero /
            // downsample needed.
            const frame = WHOLE_DENSITY_KINDS.has(state.kind)
                ? await api.density_df(state.id)
                : await api.density_df(state.id, { cols: 'loss,p_total,F,S' });
            // renderCap lifts CsvGrid's default 2,000-row render cap so the full
            // 2**11 = 2048 binned grid shows without the "show all" prompt.
            replacePaneGrid('pane-density', frame, { ...GRID_FULL, maxRows: 25, renderCap: 2048 });
        } else if (name === 'bswin') {
            replacePaneGrid('pane-bswin', await api.bs_window_df(state.id), GRID_FULL);
        }
    } catch (err) {
        state.loaded.delete(name);   // allow a retry on the next activation
        replacePane(PANE_OF[name] || 'pane-info', errorNode(err));
    }
}

// The live uPlot on the Overview tab; destroyed before each re-render so its
// canvas + ResizeObserver don't leak across builds (CsvGrid teardown is keyed
// on the grid registry; uPlot is not, so we track it ourselves).
let overviewChart = null;

// Overview table view mode. The Overview is the landing demo ("demo-central"),
// where the curated *static* exhibit -- lit 1-in-200 / 1-in-250 anchors, bold
// Agg / total "what's my number" -- tells the story better than a bare grid, and
// the frames are 3-11 rows so CsvGrid's sort / filter / search buys little. But
// a returning power user often wants the interactive grid, so the exhibits carry
// a Static | Interactive toggle. Static is the default; the choice is sticky per
// browser. (CsvGrid has no row highlighting, so the two views are genuinely
// different instruments, not just styling -- hence a toggle, not a restyle.)
let overviewView = (() => {
    try { return localStorage.getItem('aggapi.overviewView') || 'static'; }
    catch { return 'static'; }
})();
function setOverviewView(mode) {
    overviewView = mode;
    try { localStorage.setItem('aggapi.overviewView', mode); } catch { /* private mode */ }
}

// The Static | Interactive segmented control; `onChange` re-renders the exhibits.
function exhibitToggle(onChange) {
    const group = el('div', { className: 'btn-group btn-group-sm', role: 'group' });
    const btns = [['static', 'Static'], ['interactive', 'Interactive']].map(([mode, label]) => {
        const b = el('button', { type: 'button', className: 'btn btn-outline-secondary' }, label);
        if (overviewView === mode) b.classList.add('active');
        b.addEventListener('click', () => {
            if (overviewView === mode) return;
            setOverviewView(mode);
            for (const x of btns) x.classList.toggle('active', x === b);
            onChange();
        });
        return b;
    });
    group.append(...btns);
    return el('div', { className: 'overview-view-toggle' },
        el('span', { className: 'overview-view-label' }, 'Tables'), group);
}

// Render the summary_df + tail_df exhibits into `box` per the current view mode.
// Interactive grids register under 'pane-overview', so clearGrids tears down the
// previous mode's grids before each (re-)render.
function renderOverviewExhibits(box, summary, tail) {
    clearGrids('pane-overview');
    empty(box);
    if (summary) renderOneExhibit(box, summary, {
        title: 'Summary — what it’s made of',
        caption: 'Moments and key percentiles. CV blank for signed / near-break-even '
            + 'rows; Freq percentiles blank by design (PGF-only).',
        emphasize: (r) => r.X === 'Agg' || r.unit === 'total',
    });
    if (tail) renderOneExhibit(box, tail, {
        title: 'Tail risk — how bad it gets',
        caption: '1-in-200 (Solvency II) and 1-in-250 (US) are the capital anchors. '
            + 'Exact from the FFT grid, not simulated.',
        highlight: (r) => Number(r.T) === 200 || Number(r.T) === 250,
        emphasize: (r) => r.unit === 'total',
    });
}

// One exhibit: the curated static table (with highlight / emphasis) or, in
// interactive mode, a titled + captioned CsvGrid with the full chrome. The
// highlight/emphasis predicates are ignored by the grid (CsvGrid has no row
// styling), which is the whole reason both views exist.
function renderOneExhibit(box, frame, opts) {
    if (overviewView !== 'interactive') {
        box.appendChild(renderExhibit(frame, opts));
        return;
    }
    if (opts.title) box.appendChild(el('h6', { className: 'exhibit-title' }, opts.title));
    const host = el('div', { className: 'grid-host' });
    box.appendChild(host);
    mountGrid('pane-overview', host, frame, GRID_FULL);
    if (opts.caption) box.appendChild(el('div', { className: 'exhibit-caption' }, opts.caption));
}

// ---- Overview tab: note + interactive plot + summary_df + tail_df ----
// The landing exhibit. Each section is best-effort: a frame the object doesn't
// carry (a distortion has no summary_df; a bivariate has no validation_df) just
// 400s and is skipped, so the tab degrades gracefully rather than erroring.
async function loadOverview() {
    if (overviewChart) { try { overviewChart.destroy(); } catch { /* gone */ } overviewChart = null; }
    clearGrids('pane-overview');
    const pane = $('pane-overview');
    empty(pane);
    let rendered = false;

    // 1. Description lead -- the example's note, when this build came from one.
    if (state.note) {
        pane.appendChild(el('p', { className: 'overview-note' }, state.note));
        rendered = true;
    }

    // 2. Interactive density / exceedance plot (uPlot), with VaR markers.
    try {
        const density = WHOLE_DENSITY_KINDS.has(state.kind)
            ? await api.density_df(state.id)
            : await api.density_df(state.id, { cols: 'loss,p_total,F,S' });
        const tail = await api.tail_df(state.id).catch(() => null);
        const host = el('div', { className: 'overview-plot' });
        pane.appendChild(host);
        const chart = mountInteractivePlot(host, density, tail);
        if (chart) {
            overviewChart = chart;
            const legend = markerLegend(tail);
            if (legend) pane.appendChild(legend);
            rendered = true;
        } else {
            pane.removeChild(host);   // nothing plottable (e.g. a g-curve)
        }
    } catch { /* plot is a bonus; skip on failure */ }

    // 3. Risk exhibits (summary_df + tail_df) with a Static | Interactive toggle.
    // Fetch once; the toggle re-renders from the stashed frames (no refetch).
    const summary = await api.summary(state.id).catch(() => null);
    const tailFrame = await api.tail_df(state.id).catch(() => null);
    if (summary || tailFrame) {
        const box = el('div', { className: 'overview-exhibits' });
        pane.appendChild(exhibitToggle(() => renderOverviewExhibits(box, summary, tailFrame)));
        pane.appendChild(box);
        renderOverviewExhibits(box, summary, tailFrame);
        rendered = true;
    }

    if (!rendered) {
        pane.appendChild(el('div', { className: 'text-muted small' },
            'No risk views for this object — see the other tabs.'));
    }
}

function replacePane(paneId, node) {
    clearGrids(paneId);          // tear down any CsvGrid that lived here
    const pane = $(paneId);
    empty(pane);
    if (node) pane.appendChild(node);
}

/**
 * Replace a pane's contents with a single CsvGrid for `frame`. The host is
 * attached (via replacePane) before the grid is constructed so CsvGrid can
 * measure column widths against the live layout.
 */
function replacePaneGrid(paneId, frame, opts) {
    const host = el('div', { className: 'grid-host' });
    replacePane(paneId, host);
    mountGrid(paneId, host, frame, opts);
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

// ---- Reins tab: description line + per-layer frame ----
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
    await loadReinsFrame();
}

async function loadReinsFrame() {
    if (!state.id) return;
    try {
        const frame = await api.reinsFrame(state.id, state.reinsWhich);
        replacePaneGrid('pane-reins', frame, GRID_FULL);
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
// CsvGrid per-column format codes for the distortion-stat slices, honoring the
// spec the old renderer used: LR/ROE as percents, P thousands-grouped, PQ to
// 3dp. Applied to every value column (column 0 is the distortion label).
const PRICE_FMT_CODE = { LR: '.1%', P: ',d', PQ: '.3f', ROE: '.0%' };
const PRICE_TITLE = {
    LR: 'Loss ratio', P: 'Premium', PQ: 'Premium / capital', ROE: 'Return on capital',
};

/** CsvGrid `formats`: auto-format the label column, force `code` on the rest. */
function statFormats(frame, code) {
    const n = (frame.columns || []).length;
    return [null, ...Array(Math.max(n - 1, 0)).fill(code)];
}

// Render the Price payload straight into pane-price: pentagon + (Portfolios
// only) calibrated distortions and the per-stat distortion slices. Each frame
// is its own CsvGrid; all register under 'pane-price' so a rebuild tears them
// down together.
function renderPrice(payload) {
    const paneId = 'pane-price';
    const root = el('div', { className: 'price-result' });
    replacePane(paneId, root);          // clears prior grids + attaches root

    const section = (title, frame, opts, cls = 'price-section-title') => {
        root.appendChild(el('div', { className: cls }, title));
        const host = el('div', { className: 'grid-host' });
        root.appendChild(host);
        mountGrid(paneId, host, frame, opts);
    };

    section('Pricing pentagon', payload.pentagon, GRID_FULL);
    if (payload.distortion_df) {
        section('Calibrated distortions', payload.distortion_df, GRID_FULL,
            'price-section-title mt-3');
    }
    for (const w of payload.warnings || []) {
        root.appendChild(el('div', { className: 'text-muted small fst-italic mt-1' }, `⚠ ${w}`));
    }
    if (payload.distortions) {
        for (const stat of ['LR', 'P', 'PQ', 'ROE']) {
            const frame = payload.distortions[stat];
            if (!frame) continue;
            section(`${PRICE_TITLE[stat]} (${stat}) by distortion`, frame,
                { ...GRID_FULL, formats: statFormats(frame, PRICE_FMT_CODE[stat]) },
                'price-section-title mt-3');
        }
    }
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
        renderPrice(await api.price(state.id, body));
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
// Tab tools: copy Info text / download the plot SVG. Per-frame CSV download
// and copy are handled by CsvGrid's own export controls (copy / save), so the
// old per-tab "csv" buttons are gone -- the grid is the single export path.
// ----------------------------------------------------------------------
document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const text = ($(btn.dataset.copy)?.innerText || '').trim();
        if (!text) return;
        try { await navigator.clipboard.writeText(text); flash(btn, 'copied'); }
        catch { /* clipboard blocked -- ignore */ }
    });
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
// normalize: the old post-load /v1/decl/format round-trip is gone. `formatted`
// false (the Help panel's hand-written sample, say) still takes that trip.
// `note` rides along to the Overview lead on the next build; passing null
// clears any inherited description.
function loadExample(decl, note = null, formatted = true) {
    pendingNote = note;
    editor.setText(decl);
    editor.focus();
    if (formatted) return;
    const at = exampleRing.cursor;
    api.formatDecl(decl).then((res) => {
        if (exampleRing.cursor === at && res && res.decl) editor.setText(res.decl);
    }).catch(() => { /* keep raw */ });
}

mountExamples($('examples-menu'), (item) => {
    exampleRing.cursor = exampleRing.decls.indexOf(item.decl);  // sync the ring
    loadExample(item.decl, item.note);
});

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
api.heroes().then((data) => {
    mountHeroes(pickRandom(data.items || [], 4));
}).catch(() => { /* no gallery; the page still works */ });

// ----------------------------------------------------------------------
// Hero gallery (group A) -- clickable showcase cards above the editor
// ----------------------------------------------------------------------
function mountHeroes(items) {
    const row = $('hero-row');
    if (!row) return;
    empty(row);
    if (!items.length) { row.classList.add('d-none'); return; }
    row.classList.remove('d-none');
    items.forEach((item, i) => {
        const card = el('button', {
            className: 'hero-card', type: 'button', title: item.note || '',
            onClick: () => { loadExample(item.decl, item.note); build(); },
        },
            el('span', { className: 'hero-thumb', style: `background:${gradientFor(item.name)}` }),
            el('span', { className: 'hero-name' }, item.name));
        row.appendChild(card);
        // Auto-build the first card so the visitor lands on a populated page.
        if (i === 0) { loadExample(item.decl, item.note); build(); }
    });
}

// A deterministic placeholder thumbnail: a gradient seeded by the name hash.
// (Final per-example art / sparklines are a later decision; this needs no
// network and stays stable per example.)
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
        loadExample(sample, null, false);
        bootstrap.Offcanvas.getOrCreateInstance(panel).hide();
    });
}

// ----------------------------------------------------------------------
// About panel: tool versions + session-model download
// ----------------------------------------------------------------------
// Bundled-library versions are build-time constants (inlined by Vite's define);
// aggregate / api versions come from the backend at runtime.
$('about-grid').textContent = __CSV_GRID_VERSION__;
$('about-uplot').textContent = __UPLOT_VERSION__;
$('about-bootstrap').textContent = __BOOTSTRAP_VERSION__;
api.meta().then((meta) => {
    $('about-aggregate').textContent = meta.aggregate_version;
    $('about-api').textContent = meta.version;
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
// Requires a secure context (HTTPS or localhost) — a no-op otherwise.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ });
    });
}
