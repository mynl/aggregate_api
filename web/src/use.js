// The /use page: running `aggregate` from Jupyter, R, Excel and Google Sheets.
//
// A static page with four folder tabs of numbered steps. The reader ticks a
// step by clicking its number; ticks are kept in this browser only. The layout
// and every behavior here are `dev/prototypes/use-page/side-by-side.html`,
// which is the specification; the plan is `dev/done/plan-use-page.md`.
//
// Standalone like `lite.js`: no Bootstrap, no CodeMirror, and nothing from
// `main.js`. The only server call is `/v1/meta`, for the versions line.

import './styles/use.css';
import { api } from './api.js';
import { parseUseHash, useHash } from './use-route.js';

/**
 * The `/copy` link of the AGG for Sheets template, which puts a copy in the
 * reader's Drive. Empty until the author publishes the template
 * (`sheets/README.md`, step 5); while it is empty the Sheets tab's first step
 * says so and shows no button.
 */
const SHEETS_TEMPLATE_URL = '';

/** Where the ticks are kept: `{stepId: 1}` for every ticked step. */
const TICKS_KEY = 'use-page-ticks';

/**
 * The ticks this browser holds.
 *
 * Wrapped because storage can be absent, full, or blocked outright, and in the
 * last case reading `localStorage` itself throws. The page works without it;
 * the ticks then last as long as the page.
 *
 * @returns {Object<string, number>}
 */
function loadTicks() {
    try { return JSON.parse(localStorage.getItem(TICKS_KEY) || '{}') || {}; }
    catch { return {}; }
}

/** @param {Object<string, number>} ticks keep these, silently if refused. */
function saveTicks(ticks) {
    try { localStorage.setItem(TICKS_KEY, JSON.stringify(ticks)); }
    catch { /* blocked or private: the ticks last the page */ }
}

let ticks = loadTicks();

/**
 * Show one tab, and on Excel one route.
 *
 * @param {string} tab one of `USE_TABS`.
 * @param {string} route one of `EXCEL_ROUTES`.
 * @param {boolean} rewrite also put the matching hash in the address bar, so it
 *     is always a link to what is on screen. `replaceState`, so tab clicks do
 *     not pile up in the Back history.
 */
function show(tab, route, rewrite) {
    document.querySelectorAll('.out-tabs button').forEach((b) => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.pane').forEach((p) =>
        p.classList.toggle('active', p.dataset.pane === tab));
    document.querySelectorAll('.sub-link').forEach((b) =>
        b.classList.toggle('active', b.dataset.route === route));
    document.querySelectorAll('.route').forEach((p) =>
        p.classList.toggle('active', p.dataset.routepane === route));
    if (rewrite) history.replaceState(null, '', useHash(tab, route));
}

/**
 * Number the steps and give each a tick button. The number is the checkbox: a
 * real button, so it takes focus and the Space key.
 */
function addTickButtons() {
    document.querySelectorAll('ol.steps > li').forEach((li) => {
        const n = [...li.parentElement.children].indexOf(li) + 1;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tick';
        button.setAttribute('aria-label', `Step ${n} done`);
        li.prepend(button);
        button.addEventListener('click', () => {
            const id = li.dataset.step;
            if (ticks[id]) delete ticks[id]; else ticks[id] = 1;
            saveTicks(ticks);
            paint();
        });
    });
}

/**
 * Draw every list's ticks, its current step and its progress line.
 *
 * A ticked step shows a check and folds its body away; the first unticked one
 * is ringed as current, so the page always says where the reader is.
 */
function paint() {
    document.querySelectorAll('ol.steps').forEach((list) => {
        const items = [...list.children];
        let current = null;
        items.forEach((li, i) => {
            const on = Boolean(ticks[li.dataset.step]);
            li.classList.toggle('ticked', on);
            const button = li.querySelector('.tick');
            button.textContent = on ? '✓' : String(i + 1);
            button.setAttribute('aria-pressed', on ? 'true' : 'false');
            if (!on && !current) current = li;
        });
        items.forEach((li) => li.classList.toggle('current', li === current));

        const done = items.filter((li) => li.classList.contains('ticked')).length;
        const line = list.parentElement.querySelector('.progress-line');
        line.replaceChildren();
        const track = document.createElement('span');
        track.className = 'bar-track';
        const fill = document.createElement('span');
        fill.className = 'bar-fill';
        fill.style.width = `${(100 * done) / items.length}%`;
        track.append(fill);
        const count = document.createElement('span');
        count.textContent = done === items.length ? 'all done' : `${done} of ${items.length}`;
        line.append(track, count);
        if (done) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'linkbtn';
            clear.textContent = 'Clear ticks';
            clear.addEventListener('click', () => {
                items.forEach((li) => { delete ticks[li.dataset.step]; });
                saveTicks(ticks);
                paint();
            });
            line.append(clear);
        }
    });
}

/**
 * A Copy button on every command block. Its label never changes; a separate
 * "copied" readout fades in and out beside it, so the button always means one
 * thing.
 */
function addCopyButtons() {
    document.querySelectorAll('.code').forEach((block) => {
        const said = document.createElement('span');
        said.className = 'said';
        said.textContent = 'copied';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'copy';
        button.textContent = 'Copy';
        block.append(said, button);
        button.addEventListener('click', () => {
            navigator.clipboard?.writeText(block.querySelector('pre').innerText).then(() => {
                said.classList.add('on');
                setTimeout(() => said.classList.remove('on'), 1200);
            }).catch(() => {});
        });
    });
}

/**
 * Back goes to the Loss Lab. When the reader came from it, `history.back()`
 * returns them to the session as they left it rather than to a fresh landing
 * page; from anywhere else, the plain link to `/` stands.
 */
function wireBack() {
    const back = document.getElementById('use-back');
    let fromHere = false;
    try { fromHere = new URL(document.referrer).origin === location.origin; }
    catch { /* no referrer */ }
    back.addEventListener('click', (event) => {
        if (fromHere && history.length > 1) {
            event.preventDefault();
            history.back();
        }
    });
}

/** The Sheets copy button, or the line saying the template is on its way. */
function wireSheetsTemplate() {
    const link = document.getElementById('sheets-copy');
    const pending = document.getElementById('sheets-copy-pending');
    if (SHEETS_TEMPLATE_URL) {
        link.href = SHEETS_TEMPLATE_URL;
        link.hidden = false;
        pending.hidden = true;
    } else {
        link.hidden = true;
        pending.hidden = false;
    }
}

function init() {
    // The header versions, from /v1/meta: blank until it answers, and blank if
    // it does not, since a wrong version is worse than none.
    api.meta().then((meta) => {
        document.getElementById('use-versions').textContent =
            `agg ${meta.aggregate_version} · api ${meta.version}`;
    }).catch(() => {});

    addTickButtons();
    addCopyButtons();
    wireBack();
    wireSheetsTemplate();

    document.querySelectorAll('.out-tabs button').forEach((b) =>
        b.addEventListener('click', () => show(b.dataset.tab, parseUseHash(location.hash).route, true)));
    document.querySelectorAll('.sub-link').forEach((b) =>
        b.addEventListener('click', () => show('excel', b.dataset.route, true)));
    window.addEventListener('hashchange', () => {
        const { tab, route } = parseUseHash(location.hash);
        show(tab, route, false);
    });

    const { tab, route } = parseUseHash(location.hash);
    show(tab, route, false);
    paint();
}

init();
