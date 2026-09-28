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
import { api, errorMessage } from './api.js';
import { loadExamples } from './examples.js';

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

async function initChips() {
    const payload = await loadExamples();
    const byName = new Map((payload.items || []).map((i) => [i.name, i]));
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
        chip.addEventListener('click', () => {
            row.querySelectorAll('.on').forEach((c) => c.classList.remove('on'));
            chip.classList.add('on');
            current = item;
            showProgram(item);
        });
        row.appendChild(chip);
    }
    // Land on the first chip so the page never opens empty.
    row.querySelector('.p-chip')?.click();
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

/** A failed build, said in the strip's own vocabulary. Refined at a169. */
function renderBuildFailure(err) {
    const strip = $('lite-strip');
    strip.replaceChildren();
    strip.classList.remove('is-warn');
    strip.classList.add('is-fail');
    const name = document.createElement('span');
    name.className = 'p-name';
    name.textContent = 'Build failed';
    strip.appendChild(name);
    const msg = document.createElement('div');
    msg.className = 'p-error';
    msg.textContent = errorMessage(err);
    strip.appendChild(msg);
    $('lite-tiles').replaceChildren();
    $('lite-built').hidden = false;
}

async function build() {
    if (!current || building) return;
    building = true;
    const btn = $('lite-build');
    btn.disabled = true;
    try {
        const res = await api.build(current.decl);
        const p99 = renderBuilt(res);
        // P99 off one quantiles call, filled when it lands; the exact value
        // (`q`), not the three-figure `snapped` form Quick Re writes.
        try {
            const qs = await api.quantiles(res.id, [0.99]);
            p99.value.textContent = tileNumber(qs.quantiles[0]?.q);
        } catch {
            p99.value.textContent = '·';
        }
    } catch (err) {
        renderBuildFailure(err);
    } finally {
        building = false;
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
