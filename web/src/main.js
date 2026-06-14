// SPA entry point. Loaded by index.html as a module.
//
// Responsibilities:
//   * import Bootstrap (CSS + JS) and Bootstrap Icons + our CSS so Vite
//     bundles everything (no runtime CDN)
//   * construct the CM6 editor + wire build / history / clear / emacs
//   * wire the Build button, log2 / bs dropdowns, Examples dropdown
//   * render the one-line build summary
//   * lazily fetch + render each output tab (Info / Describe / Plot /
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
import { mountExamples } from './examples.js';
import { renderInfo } from './renderers.js';
import { mountGrid, clearGrids, destroyAllGrids } from './grid.js';
import { renderError, renderRateLimit } from './error-pane.js';
import * as history from './history.js';
import { $, el, empty } from './utils/dom.js';
import { fmt } from './utils/format.js';

// ----------------------------------------------------------------------
// CsvGrid option presets (see grid.js)
// ----------------------------------------------------------------------
// FULL: the default chrome (sort / fzf search / per-column filters / expand)
// for the substantive frames. PLAIN: chrome stripped for the small 3–8 row
// frames where search/filter is just noise (sort stays — it's free and handy).
const GRID_FULL = {};
const GRID_PLAIN = {
    globalSearch: false, columnFilters: false, statusBar: false, expandButtons: false,
};

// ----------------------------------------------------------------------
// Module state
// ----------------------------------------------------------------------
const state = {
    id: null,
    kind: null,
    name: null,
    log2: null,             // null = auto
    bs: null,               // null = auto
    loaded: new Set(),      // tab names whose data has been fetched
    reinsWhich: 'reins_describe',
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
    const kindLabel = res.kind === 'port' ? 'Portfolio'
        : res.kind === 'distortion' ? 'Distortion'
        : res.kind === 'multivariate' ? 'Multivariate'
        : 'Aggregate';
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
    const word = res.kind === 'port' ? 'portfolio'
        : res.kind === 'distortion' ? 'distortion'
        : res.kind === 'multivariate' ? 'multivariate'
        : 'aggregate';
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
    info: 'pane-info', desc: 'pane-desc', plot: 'pane-plot',
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

// Tabs that need a loss distribution. A standalone Distortion or a
// MultivariateAggregate exposes info / describe / stats / density / plot but
// has no pricing, reinsurance, or bs window. Per the playground house rule we
// NEVER hide menu items — the menu set stays stable — we grey them out
// (disabled) so the user can see what's not applicable. agg / port disable
// nothing.
const NA_TABS_BY_KIND = {
    distortion: ['price', 'reins', 'bswin'],
    multivariate: ['price', 'reins', 'bswin'],
};
const GATED_TABS = ['price', 'reins', 'bswin'];

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
        if (name === 'info') {
            replacePane('pane-info', renderInfo(await api.info(state.id)));
        } else if (name === 'desc') {
            // Keep the fzf bar but drop the per-column filter row — describe is
            // narrow and the global search covers it.
            replacePaneGrid('pane-desc', await api.description(state.id), { columnFilters: false });
        } else if (name === 'plot') {
            const img = el('img', { src: api.plotUrl(state.id, { format: 'svg' }), alt: 'native plot' });
            replacePane('pane-plot', img);
        } else if (name === 'stats') {
            replacePaneGrid('pane-stats', await api.stats_df(state.id), GRID_FULL);
        } else if (name === 'reins') {
            await loadReins();
        } else if (name === 'density') {
            // A distortion's density_df is the g-curve (g, g_inv, g_dual,
            // g_prime, ...) over x in [0,1] -- ~101 rows; a MultivariateAggregate's
            // is the full joint-density matrix. Neither has the loss,p_total,F,S
            // columns, so pull the whole frame for those. For agg/port the server
            // bins the density to a faithful 2**11 display grid (p_total stays
            // correct), so we only ask for the curated columns -- no nonzero /
            // downsample needed.
            const frame = (state.kind === 'distortion' || state.kind === 'multivariate')
                ? await api.density_df(state.id)
                : await api.density_df(state.id, { cols: 'loss,p_total,F,S' });
            // renderCap lifts CsvGrid's default 2,000-row render cap so the full
            // 2**11 = 2048 binned grid shows without the "show all" prompt.
            replacePaneGrid('pane-density', frame, { ...GRID_FULL, maxRows: 25, renderCap: 2048 });
        } else if (name === 'bswin') {
            replacePaneGrid('pane-bswin', await api.bs_window_df(state.id), GRID_PLAIN);
        }
    } catch (err) {
        state.loaded.delete(name);   // allow a retry on the next activation
        replacePane(PANE_OF[name] || 'pane-info', errorNode(err));
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

    section('Pricing pentagon', payload.pentagon, GRID_PLAIN);
    if (payload.distortion_df) {
        section('Calibrated distortions', payload.distortion_df, GRID_PLAIN,
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
                { ...GRID_PLAIN, formats: statFormats(frame, PRICE_FMT_CODE[stat]) },
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
// Tab tools: copy / csv / plot download
// ----------------------------------------------------------------------
document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const text = ($(btn.dataset.copy)?.innerText || '').trim();
        if (!text) return;
        try { await navigator.clipboard.writeText(text); flash(btn, 'copied'); }
        catch { /* clipboard blocked -- ignore */ }
    });
});

document.querySelectorAll('[data-csv]').forEach((btn) => {
    btn.addEventListener('click', () => {
        if (!state.id) return;
        window.open(api.frameCsvUrl(state.id, btn.dataset.csv), '_blank');
    });
});

$('reins-csv').addEventListener('click', () => {
    if (!state.id) return;
    window.open(api.frameCsvUrl(state.id, state.reinsWhich), '_blank');
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

// Load a program into the editor, then standardize it via format_program.
// Raw text shows instantly; the formatted version replaces it unless the
// user has since stepped to another example (stale-format guard).
function loadExample(decl) {
    editor.setText(decl);
    editor.focus();
    const at = exampleRing.cursor;
    api.formatDecl(decl).then((res) => {
        if (exampleRing.cursor === at && res && res.decl) editor.setText(res.decl);
    }).catch(() => { /* keep raw */ });
}

mountExamples($('examples-menu'), (item) => {
    exampleRing.cursor = exampleRing.decls.indexOf(item.decl);  // sync the ring
    loadExample(item.decl);
});

api.examples().then((data) => {
    exampleRing.decls = (data.categories || [])
        .flatMap((c) => (c.items || []).map((i) => i.decl));
}).catch(() => { /* dropdown still works; Alt-nav just stays empty */ });

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
// Reuse loadExample so the program is format_program-normalized just like the
// Examples dropdown. Close the panel and return focus to the editor once it has
// finished animating out, so Bootstrap's focus-restore doesn't bounce back to
// the "?" trigger.
const helpLoad = $('help-load');
if (helpLoad) {
    helpLoad.addEventListener('click', () => {
        const sample = $('help-example').textContent.trim();
        const panel = $('helpPanel');
        panel.addEventListener('hidden.bs.offcanvas',
            () => editor.focus(), { once: true });
        loadExample(sample);
        bootstrap.Offcanvas.getOrCreateInstance(panel).hide();
    });
}

// ----------------------------------------------------------------------
// Versions from /v1/meta
// ----------------------------------------------------------------------
api.meta().then((meta) => {
    $('ver-aggregate').textContent = `aggregate ${meta.aggregate_version}`;
    $('ver-api').textContent = `api ${meta.version}`;
}).catch(() => {
    $('ver-api').textContent = '(api offline)';
});

// csv-grid version is a build-time constant (inlined by Vite's define),
// not a runtime value -- set it directly, outside the meta fetch.
$('ver-csv').textContent = `grid ${__CSV_GRID_VERSION__}`;

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
