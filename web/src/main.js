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
import { renderError } from './error-pane.js';
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

function renderSummary(res) {
    const inner = $('summary-inner');
    empty(inner);
    const kindLabel = res.kind === 'port' ? 'Portfolio' : 'Aggregate';
    const bits = [
        el('span', { className: 'nm' }, res.name || '(anonymous)'),
        el('span', { className: 'mono ms-2' }, kindLabel),
    ];
    if (res.mean != null) { bits.push(sep(), el('span', { className: 'mono' }, `mean ${fmt(res.mean)}`)); }
    if (res.cv != null)   { bits.push(sep(), el('span', { className: 'mono' }, `CV ${fmt(res.cv)}`)); }
    if (res.validation) {
        const ok = res.validation.trim() === 'not unreasonable';
        bits.push(sep(), el('span', { className: `mono ${ok ? 'ok' : 'warn'}` }, res.validation));
    }
    if (res.cached) { bits.push(sep(), el('span', { className: 'mono' }, 'cached')); }
    inner.append(...bits);
    syncSummaryMore();
}

function renderBuildFailure(err) {
    const inner = $('summary-inner');
    empty(inner);
    inner.appendChild(el('span', { className: 'mono warn' }, 'build failed'));
    syncSummaryMore();
    // Surface the rich parse-error report in the Info pane and show it.
    const pane = $('pane-info');
    empty(pane);
    if (err instanceof ApiError) pane.appendChild(renderError(err));
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
    density: 'pane-density', bswin: 'pane-bswin',
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
// Examples dropdown
// ----------------------------------------------------------------------
mountExamples($('examples-menu'), async (item) => {
    editor.setText(item.decl);      // show the raw program immediately
    editor.focus();
    // Standardize it via the server's format_program pass; keep the raw text
    // if the round-trip fails (offline, parse hiccup).
    try {
        const res = await api.formatDecl(item.decl);
        if (res && res.decl) editor.setText(res.decl);
    } catch { /* keep raw */ }
});

// ----------------------------------------------------------------------
// Versions from /v1/meta
// ----------------------------------------------------------------------
api.meta().then((meta) => {
    $('ver-aggregate').textContent = `aggregate ${meta.aggregate_version}`;
    $('ver-api').textContent = `api ${meta.version}`;
}).catch(() => {
    $('ver-api').textContent = '(api offline)';
});
