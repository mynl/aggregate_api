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
import { renderFrameTable, renderInfo } from './renderers.js';
import { renderError, renderRateLimit } from './error-pane.js';
import * as history from './history.js';
import { $, el, empty } from './utils/dom.js';
import { fmt } from './utils/format.js';

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
    const kindLabel = res.kind === 'port' ? 'Portfolio' : 'Aggregate';
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
    const word = res.kind === 'port' ? 'portfolio' : 'aggregate';
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
            replacePane('pane-desc', renderFrameTable(await api.description(state.id)));
        } else if (name === 'plot') {
            const img = el('img', { src: api.plotUrl(state.id, { format: 'svg' }), alt: 'native plot' });
            replacePane('pane-plot', img);
        } else if (name === 'stats') {
            replacePane('pane-stats', renderFrameTable(await api.stats_df(state.id)));
        } else if (name === 'reins') {
            await loadReins();
        } else if (name === 'density') {
            const frame = await api.density_df(state.id, {
                cols: 'loss,p_total,F,S', nonzero: true, downsample: 300,
            });
            replacePane('pane-density', renderFrameTable(frame));
        } else if (name === 'bswin') {
            replacePane('pane-bswin', renderFrameTable(await api.bs_window_df(state.id)));
        }
    } catch (err) {
        state.loaded.delete(name);   // allow a retry on the next activation
        replacePane(PANE_OF[name] || 'pane-info', errorNode(err));
    }
}

function replacePane(paneId, node) {
    const pane = $(paneId);
    empty(pane);
    if (node) pane.appendChild(node);
}

function errorNode(err) {
    if (err instanceof ApiError && err.status === 429) return renderRateLimit(err.retryAfter);
    if (err instanceof ApiError) {
        const detail = err.body && (err.body.detail || err.body);
        const msg = (detail && detail.message) || (typeof detail === 'string' ? detail : err.message);
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
        replacePane('pane-reins', renderFrameTable(frame));
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
const PRICE_FMT = {
    LR:  (v) => pctFmt(v, 1),
    P:   (v) => intFmt(v),
    PQ:  (v) => fixFmt(v, 3),
    ROE: (v) => pctFmt(v, 0),
};
const PRICE_TITLE = {
    LR: 'Loss ratio', P: 'Premium', PQ: 'Premium / capital', ROE: 'Return on capital',
};

function pctFmt(v, dp) {
    return (v == null || !Number.isFinite(v)) ? '' : `${(v * 100).toFixed(dp)}%`;
}
function intFmt(v) {
    return (v == null || !Number.isFinite(v)) ? '' : Math.round(v).toLocaleString('en-US');
}
function fixFmt(v, dp) {
    return (v == null || !Number.isFinite(v)) ? '' : Number(v).toFixed(dp);
}

function renderPrice(payload) {
    const root = el('div', { className: 'price-result' });
    root.appendChild(el('div', { className: 'price-section-title' }, 'Pricing pentagon'));
    root.appendChild(renderFrameTable(payload.pentagon));
    if (payload.distortion_df) {
        root.appendChild(el('div', { className: 'price-section-title mt-3' },
            'Calibrated distortions'));
        root.appendChild(renderFrameTable(payload.distortion_df));
    }
    for (const w of payload.warnings || []) {
        root.appendChild(el('div', { className: 'text-muted small fst-italic mt-1' }, `⚠ ${w}`));
    }
    if (payload.distortions) {
        for (const stat of ['LR', 'P', 'PQ', 'ROE']) {
            const frame = payload.distortions[stat];
            if (!frame) continue;
            root.appendChild(el('div', { className: 'price-section-title mt-3' },
                `${PRICE_TITLE[stat]} (${stat}) by distortion`));
            root.appendChild(renderFrameTable(frame, { format: PRICE_FMT[stat] }));
        }
    }
    return root;
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
        replacePane('pane-price', renderPrice(await api.price(state.id, body)));
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
        $('price-target-val').value = isCoc ? '0.1' : '0.7';
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
