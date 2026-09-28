// The phone lite entry: a read-mostly showcase of the aggregate Loss Lab.
//
// The full app assumes a wide viewport, a keyboard, and hover; a phone gets
// this instead. The design bet, recorded in `dev/prototypes/phone.html` (the
// specification for this page): a phone user never types DecL, so the curated
// chip row is the primary control, the program is displayed read-only, and
// Build is the one verb. Facts, tiles, and (from a169) one chart and one small
// table; everything else lives on the full site behind `?full=1`.
//
// No Bootstrap, no CodeMirror. The shared modules (`api.js`, `examples.js`)
// are imported read-only; nothing here reaches into `main.js`, which stays the
// full app's own wiring.

import './styles/lite.css';
import { ApiError, api, errorMessage } from './api.js';
import { fetchFailed, mountChart, notDrawable } from './charts/mount.js';
import { loadExamples, rankMatches } from './examples.js';
import { clearGrids } from './grid.js';
import { mountIrTable } from './tables.js';

// The curated chips, in display order. A starter list, ruled 2026-09-28;
// editing it is this one line. A name that stops resolving against the library
// logs and drops rather than breaking the row.
const CURATED = [
    'DiceOfDice',
    'BasicBook',
    'Capstone.Gross',
    'Capstone.XOL',
    'Capstone.FullProgram',
];

// The library's kind vocabulary, spelled for a reader. A local copy of the
// map in `main.js`, which cannot be imported from here without dragging the
// whole desktop bundle (Bootstrap, CodeMirror) onto the phone.
const KIND_LABEL = {
    agg: 'Aggregate', port: 'Portfolio', sev: 'Severity',
    distortion: 'Distortion', bvagg: 'Bivariate', pnl: 'P&L',
};

const $ = (id) => document.getElementById(id);

/**
 * Grade the library's validation prose into a strip state.
 *
 * Mirrors `validationState` in `main.js` (see its docstring for the full
 * reasoning): "not unreasonable" is the clean verdict, anything naming the
 * mean is a hard failure, the rest is an accuracy warning. The reinsurance
 * prefix is stripped first so a clean reinsured gross stays green.
 */
const REINS_VERDICT = /^reinsurance;\s*subject\s+/;
function validationState(text) {
    const s = String(text).trim().toLowerCase().replace(REINS_VERDICT, '');
    if (s === 'not unreasonable') return 'ok';
    return /\bmean\b/.test(s) ? 'bad' : 'warn';
}

/** A tile value: grouped integer below a million, else a 3-figure M form. */
function tileNumber(x) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '·';
    const abs = Math.abs(x);
    if (abs >= 1e6) return `${Number((x / 1e6).toPrecision(3))}M`;
    if (abs >= 100) return Math.round(x).toLocaleString('en-US');
    return String(Number(x.toPrecision(3)));
}

// ---- Page state ----
let current = null;        // the selected ExampleItem
let building = false;
let chartHandle = null;    // the mounted ECharts instance, disposed per build
let items = [];            // the whole library, in file order
let haystack = [];         // one search string per item, aligned with `items`
let clockTimer = null;     // the in-flight elapsed readout on the Build button

// ---- The program card ----

/** Show `item`'s program in the card, collapsed to its opening lines. */
function showProgram(item) {
    const card = $('lite-prog');
    $('lite-prog-text').textContent = item.decl || '';
    card.hidden = false;
    card.classList.add('collapsed');
    $('lite-build').disabled = false;
}

// ---- The chips ----

/** Mark the chip named `name` selected, or clear the marks for a sheet pick. */
function markChip(name) {
    const row = $('lite-chips');
    row.querySelectorAll('.on').forEach((c) => c.classList.remove('on'));
    for (const chip of row.querySelectorAll('.p-chip')) {
        if (chip.dataset.name === name) chip.classList.add('on');
    }
}

/** Select `item`: mark its chip (if it has one) and show its program. */
function pick(item) {
    current = item;
    markChip(item.name);
    showProgram(item);
}

async function initChips() {
    const payload = await loadExamples();
    items = payload.items || [];
    // The same haystack recipe the desktop menu indexes: name, kind, tags
    // (with their namespace), and the note, so a search can be about the
    // subject rather than the name.
    haystack = items.map((i) =>
        `${i.name} ${i.kind} ${(i.tags || []).join(' ')} ${i.note || ''}`);
    const byName = new Map(items.map((i) => [i.name, i]));
    const row = $('lite-chips');
    for (const name of CURATED) {
        const item = byName.get(name);
        if (!item) {
            console.warn(`[lite] curated example not in the library: ${name}`);
            continue;
        }
        const chip = document.createElement('button');
        chip.className = 'p-chip';
        chip.type = 'button';
        chip.textContent = item.name;
        chip.dataset.name = item.name;
        chip.addEventListener('click', () => pick(item));
        row.appendChild(chip);
    }
    // The sheet opener: the whole library behind one dashed chip.
    const more = document.createElement('button');
    more.className = 'p-chip more';
    more.type = 'button';
    more.textContent = 'All examples…';
    more.addEventListener('click', openSheet);
    row.appendChild(more);
    // Land on the first curated example so the page never opens empty.
    const first = row.querySelector('.p-chip:not(.more)');
    if (first) pick(byName.get(first.dataset.name));
}

// ---- The example sheet: frame 3, the whole menu of the lite app ----

/** The entries matching the search box, best first; file order when empty. */
function sheetMatches(q) {
    const needle = q.trim();
    if (!needle) return items;
    return rankMatches(haystack, needle).map((i) => items[i]);
}

function renderSheetList(matches) {
    const list = $('lite-sheet-list');
    list.replaceChildren();
    for (const item of matches) {
        const row = document.createElement('div');
        row.className = `p-item${current && item.name === current.name ? ' on' : ''}`;
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = item.name;
        const kind = document.createElement('span');
        kind.className = 'p-item-kind';
        kind.textContent = item.kind;
        nm.appendChild(kind);
        row.appendChild(nm);
        // The note, visible and clamped to two lines: it replaces every hover
        // title the desktop menu leans on, because titles never fire on touch.
        if (item.note) {
            const nt = document.createElement('div');
            nt.className = 'nt';
            nt.textContent = item.note;
            row.appendChild(nt);
        }
        row.addEventListener('click', () => {
            pick(item);
            closeSheet();
        });
        list.appendChild(row);
    }
    if (!matches.length) {
        const none = document.createElement('div');
        none.className = 'p-item-none';
        none.textContent = 'Nothing matches.';
        list.appendChild(none);
    }
}

function openSheet() {
    renderSheetList(sheetMatches($('lite-search').value));
    $('lite-dim').hidden = false;
    $('lite-sheet').hidden = false;
}

function closeSheet() {
    $('lite-dim').hidden = true;
    $('lite-sheet').hidden = true;
}

// ---- The built state ----

/** One tile: label over value. */
function tile(label, value) {
    const t = document.createElement('div');
    t.className = 'p-tile';
    const l = document.createElement('div');
    l.className = 'l';
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'v';
    v.textContent = value;
    t.append(l, v);
    return { tile: t, value: v };
}

function renderBuilt(res) {
    const strip = $('lite-strip');
    strip.replaceChildren();
    strip.classList.remove('is-warn', 'is-fail');
    const state = res.validation ? validationState(res.validation) : 'ok';
    if (state === 'warn') strip.classList.add('is-warn');
    if (state === 'bad') strip.classList.add('is-fail');
    const name = document.createElement('span');
    name.className = 'p-name';
    name.textContent = res.name;
    const kind = document.createElement('span');
    kind.className = 'p-kind';
    kind.textContent = KIND_LABEL[res.kind] || res.kind;
    strip.append(name, kind);
    // The verdict is said only when it is not clean; the tint already says it.
    if (state !== 'ok' && res.validation) {
        const verdict = document.createElement('span');
        verdict.className = 'p-verdict';
        verdict.textContent = res.validation;
        strip.appendChild(verdict);
    }
    const facts = document.createElement('div');
    facts.className = 'p-grid-facts';
    const bits = [];
    if (res.bs !== null && res.bs !== undefined) bits.push(`bs <b>${res.bs}</b>`);
    if (res.log2 !== null && res.log2 !== undefined) bits.push(`log2 <b>${res.log2}</b>`);
    if (res.value_type) bits.push(res.value_type);
    facts.innerHTML = bits.join(' · ');
    strip.appendChild(facts);

    const tiles = $('lite-tiles');
    tiles.replaceChildren();
    tiles.appendChild(tile('Mean', tileNumber(res.mean)).tile);
    tiles.appendChild(tile('CV', tileNumber(res.cv)).tile);
    const p99 = tile('P99', '…');
    tiles.appendChild(p99.tile);
    tiles.appendChild(tile('Build', `${(res.elapsed_ms / 1000).toFixed(2)} s`).tile);

    $('lite-built').hidden = false;
    return p99;
}

/**
 * The object's own picture, exactly the Overview Plot leaf's rule.
 *
 * `capability.primary_chart` names the chart, `mountChart` realizes the
 * document, and a failure never blocks the page: the `fetchFailed` /
 * `notDrawable` cards render in its place. The control apparatus below the
 * canvas is hidden by lite.css rather than suppressed here, so no shared
 * chart code changes for the phone.
 */
async function renderChart(res) {
    if (chartHandle) { chartHandle.dispose(); chartHandle = null; }
    const wrap = $('lite-chart');
    const host = $('lite-chart-host');
    host.replaceChildren();
    wrap.hidden = false;
    const chart = res.capability ? res.capability.primary_chart : null;
    if (!chart) { host.appendChild(notDrawable()); return; }
    let failed = false;
    try {
        chartHandle = await mountChart(host, { id: res.id, chart });
    } catch { failed = true; }
    if (!chartHandle) {
        host.replaceChildren(failed ? fetchFailed() : notDrawable());
    }
}

/**
 * The one table: the return-period ladder, static, with the library's own
 * caption. Served as the `tail` exhibit envelope and rendered by the walker;
 * the interactive grid never mounts here. An object without the exhibit (a
 * severity, a distortion) simply shows no table, and a fetch or walker
 * failure hides it too: the table is a bonus, the facts carry the story.
 */
async function renderTable(res) {
    const wrap = $('lite-table');
    clearGrids('lite-table');
    wrap.replaceChildren();
    wrap.hidden = true;
    const exhibits = (res.capability && res.capability.exhibits) || [];
    if (!exhibits.some((e) => e.name === 'tail')) return;
    try {
        const envelope = await api.exhibit(res.id, 'tail');
        let mounted = false;
        for (const block of envelope.blocks || []) {
            const { caption, ...doc } = block;
            const host = document.createElement('div');
            wrap.appendChild(host);
            const handle = await mountIrTable('lite-table', host, doc);
            if (handle) mounted = true;
            if (caption) {
                const cap = document.createElement('div');
                cap.className = 'p-table-caption';
                cap.textContent = caption;
                wrap.appendChild(cap);
            }
        }
        wrap.hidden = !mounted;
    } catch (err) {
        console.warn('[lite] tail exhibit did not render', err);
    }
}

/**
 * A failed build, said in the strip's own vocabulary: the parse or validation
 * sentence `errorMessage` writes, or the rate-limit line with its retry-after
 * wait. No toast, no modal.
 */
function renderBuildFailure(err) {
    const strip = $('lite-strip');
    strip.replaceChildren();
    strip.classList.remove('is-warn');
    strip.classList.add('is-fail');
    const name = document.createElement('span');
    name.className = 'p-name';
    const msg = document.createElement('div');
    msg.className = 'p-error';
    if (err instanceof ApiError && err.status === 429) {
        name.textContent = 'Easy there';
        const secs = Number(err.retryAfter);
        msg.textContent = 'This is a shared, free demo, so builds are gently '
            + 'rate-limited. '
            + (Number.isFinite(secs) && secs > 0
                ? `Please try again in about ${secs} second${secs === 1 ? '' : 's'}.`
                : 'Please give it a moment and try again.');
    } else {
        name.textContent = 'Build failed';
        msg.textContent = errorMessage(err);
    }
    strip.append(name, msg);
    $('lite-tiles').replaceChildren();
    $('lite-chart').hidden = true;
    $('lite-table').hidden = true;
    $('lite-built').hidden = false;
}

/** The in-flight state: Build disabled, the elapsed clock running on it. */
function startClock(btn) {
    const t0 = performance.now();
    btn.textContent = 'Building…';
    clockTimer = setInterval(() => {
        btn.textContent = `Building… ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    }, 100);
}

function stopClock(btn) {
    clearInterval(clockTimer);
    clockTimer = null;
    btn.textContent = 'Build';
}

async function build() {
    if (!current || building) return;
    building = true;
    const btn = $('lite-build');
    btn.disabled = true;
    startClock(btn);
    try {
        const res = await api.build(current.decl);
        const p99 = renderBuilt(res);
        // The chart and the table land as they arrive; neither blocks the
        // other or the facts already on screen. P99 off one quantiles call,
        // the exact value (`q`), not the three-figure `snapped` form.
        const fillP99 = api.quantiles(res.id, [0.99])
            .then((qs) => { p99.value.textContent = tileNumber(qs.quantiles[0]?.q); })
            .catch(() => { p99.value.textContent = '·'; });
        await Promise.all([renderChart(res), renderTable(res), fillP99]);
    } catch (err) {
        renderBuildFailure(err);
    } finally {
        building = false;
        stopClock(btn);
        btn.disabled = false;
    }
}

// ---- Boot ----

function init() {
    // The header versions, from /v1/meta: blank until it answers, and blank if
    // it does not, since a wrong version is worse than none.
    api.meta().then((meta) => {
        $('lite-versions').textContent = `agg ${meta.aggregate_version} · api ${meta.version}`;
    }).catch(() => {});

    $('lite-prog').addEventListener('click', () => {
        $('lite-prog').classList.toggle('collapsed');
        $('lite-prog-hint').textContent = $('lite-prog').classList.contains('collapsed')
            ? 'the program, as library.agg writes it · tap to expand'
            : 'the program, as library.agg writes it · tap to collapse';
    });
    $('lite-build').addEventListener('click', build);

    // The sheet closes on the dim, and its search re-ranks as you type.
    $('lite-dim').addEventListener('click', closeSheet);
    $('lite-search').addEventListener('input', (ev) => {
        renderSheetList(sheetMatches(ev.target.value));
    });

    initChips().catch((err) => {
        console.error('[lite] examples did not load', err);
        const row = $('lite-chips');
        row.textContent = 'The example library could not be loaded. ';
        const a = document.createElement('a');
        a.href = './?full=1';
        a.textContent = 'Open the full site';
        row.appendChild(a);
    });
}

// `?full=1` forces the full app even if this page is reached directly: the
// mirror of the branch in index.html. The search string is passed through so
// the full app's own branch sees the same override and stays put.
if (new URLSearchParams(location.search).has('full')) {
    location.replace(`./${location.search}${location.hash}`);
} else {
    init();
}
