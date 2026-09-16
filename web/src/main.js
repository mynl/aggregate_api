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
import { api, ApiError, errorMessage } from './api.js';
import { createPricingForm, money, percent } from './pricing-form.js';
import { createEditor, emacsEnabledDefault, modifierName } from './editor.js';
import {
    mountExamples, mountPalette, loadExamples, visibleExamples,
    onExamplesViewChange,
} from './examples.js';
import { renderInfo } from './renderers.js';
import { fetchFailed, mountChart, mountChartDoc, notDrawable } from './charts/mount.js';
import { mountGrid, clearGrids, destroyAllGrids } from './grid.js';
import { mountIrTable, irToGrid, docTruncated, atFullPrecision } from './tables.js';
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
import { anchorEditor, anchorNav, anchorNavSettled } from './scroll.js';
import { $, el, empty, replaceChildren } from './utils/dom.js';
import { debounce } from './utils/debounce.js';
import { fmt } from './utils/format.js';
import { mountTips } from './utils/tip.js';

// ----------------------------------------------------------------------
// CsvGrid option presets (see grid.js)
// ----------------------------------------------------------------------
// Every grid gets the same chrome, on every tab: fzf search, per-column filters,
// status bar, copy / save export, and no Expand/Contract (see grid.js).
// GRID_FULL stays as an explicit "defaults" marker at call sites;
// frame-specific tweaks (formats, maxRows) spread over it.
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
    mean: null,             // headline mean, seeding the Bounds premium field
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
    // Each group remembers its own last leaf, so stepping away from Pricing and
    // back returns you where you were rather than to its first leaf.
    leaf: {},
    // And which leaf's content each group's pane is actually showing, which is
    // what decides whether entering a group has to redraw.
    rendered: {},
};

/**
 * Which of the two stacks the `[m/n]` readout is describing.
 *
 * `'history'` or `'examples'`. One readout, two walks, and the rule for which is
 * showing is the rule the reader already has in their head: **the counter
 * describes whatever the last press walked.** Ctrl+Shift stepped the library, so
 * the counter numbers the library; Ctrl+Up stepped the history, so it numbers
 * the history. A build and an edit both put it back, because both mean the box
 * has stopped showing a library row.
 *
 * The two **buttons** stay bound to history whatever this says, which is
 * deliberate. They are the walk's only route on a touch device, since an iPad's
 * on-screen keyboard has no arrow keys, and the example ring has no buttons of
 * its own. So while this reads `'examples'` the counter and the arrows describe
 * different stacks. The alternative, greying the arrows against whichever stack
 * is live, makes the touch route vanish mid walk and is worse. If the two are
 * ever to agree the answer is a second pair of buttons for the library.
 *
 * It is declared **here**, with the module state, and not beside
 * `renderHistoryNav` where it reads. The landing `editor.setText` runs at module
 * top level and fires the update listener synchronously into `onEdit`, which
 * reaches `renderHistoryNav` whatever `fromApp` says, which reads this. Declared
 * below that `setText` it is still in the temporal dead zone when the read
 * lands, and through a134 every page load logged a `ReferenceError` from inside
 * CodeMirror's listener guard and lost that first render.
 */
let walkMode = 'history';

// ----------------------------------------------------------------------
// Editor
// ----------------------------------------------------------------------
const editor = createEditor($('editor-host'), {
    onBuild:       () => { anchorEditor(); build(); },
    onHistoryPrev: () => navigateHistory('prev'),
    onHistoryNext: () => navigateHistory('next'),
    onExamplePrev: () => exampleStep('prev'),
    onExampleNext: () => exampleStep('next'),
    // The document changed. A change the reader made ends a walk in progress;
    // one `setText` made is the walk itself and must not. Either way the
    // control is refreshed, because `canPrev` reads the text in the box: what
    // the first step back reaches depends on whether the editor is still
    // holding the program that was built.
    onEdit: (fromApp) => {
        if (!fromApp) {
            history.resetCursor();
            // The reader typed, so the box has stopped showing a library row and
            // the readout goes back to describing the history. A `setText` the
            // app made is the walk itself, example or history, and must not.
            walkMode = 'history';
            // The library caption goes for the same reason: it described the row
            // that was in the box, and the box now holds something else. Guarded
            // so an ordinary keystroke does not redraw the strip.
            if (_note.caption) {
                _note.caption = null;
                renderNote();
            }
        }
        renderHistoryNav();
    },
});

// The program the page lands on, in `format_program`'s own spread layout so it
// needs no round trip to look right. It mirrors `BasicBook` in the library's
// `library.agg`, which is where the note and the tags live; this is a copy of
// five lines of DecL rather than a fetch, because the whole point of it is
// that the first paint owes nothing to the network. See `loadLanding`.
// BasicBook displaced DiceOfDice on 2026-09-06: the dice are the better
// hand-checkable first example, but the landing should speak actuary, and a
// Poisson book with a lognormal severity under an occurrence limit is the
// workhorse a practitioner recognizes on sight.
const LANDING_DECL = 'agg BasicBook\n  250 claims\n  1000 xs 0\n'
    + '  sev lognorm 100 cv 1.5\n  poisson\n';

editor.setText(LANDING_DECL);
editor.focus();

function navigateHistory(dir) {
    // This press walked the history, so the readout describes the history.
    walkMode = 'history';
    // `prev` is told what is on screen: it skips the newest entry when that is
    // already the text in the editor, so the first press back always moves, and
    // it stashes the text when it is a draft no build has recorded.
    const text = dir === 'prev' ? history.prev(editor.getText()) : history.next();
    if (text !== null) {
        editor.setText(text);
        clearCessionDraft();
    }
    renderHistoryNav();
}

/**
 * The whole history control: the `[m/n]` readout and the two step buttons.
 *
 * One function and one source of truth for what the control shows, called from
 * every site that can move the walk. Split in two it would be two, and the
 * greying is exactly the sort of thing that gets refreshed at four of five call
 * sites.
 *
 * The readout answers "did that do anything", which nothing on the page did
 * before it: walking back to a program you have built before and building it
 * redraws the strip with the same words, so the only evidence the build
 * happened was the timing line ticking over, which is not something anyone
 * watches. The greying answers the same question at the two ends of the walk,
 * where the readout cannot: a refused press and a dropped keystroke look
 * identical when the number does not move.
 *
 * Neither answers it for a build of the text already on screen, since
 * `history.record` dedups against the most recent entry, so m and n both hold.
 * The strip flash in `renderSummary` is what covers that case.
 *
 * Since a129 the readout answers for the **example** walk too, per `walkMode`.
 * Only the number changes: the greying below still reads the history, for the
 * reasons recorded on `walkMode`.
 */
function renderHistoryNav() {
    const node = $('history-pos');
    if (node) {
        const { m, n } = walkMode === 'examples'
            ? examplePosition()
            : history.position();
        // `[3/4]`, not `DecL 3/4`. The word was doing no work beside a box that
        // is visibly full of DecL, and the brackets are what make four
        // characters read as a counter rather than as a fraction someone forgot
        // to finish. Blank at `m === 0`, which is nothing built yet or a walk
        // showing the stashed draft: neither is a position in the history.
        node.textContent = m ? `[${m}/${n}]` : '';
    }
    const text = editor.getText();
    const back = $('history-prev');
    const forward = $('history-next');
    if (back) back.disabled = !history.canPrev(text);
    if (forward) forward.disabled = !history.canNext();
}

/**
 * Record a program that was just built, and refresh the readout.
 *
 * The four sites that build something all did `history.record(...)` followed by
 * `renderHistoryNav()`, and a129 needed a third line at each: a build puts
 * `walkMode` back to `'history'`, because whatever the box was showing before,
 * it is now a program in the history stack. Three lines repeated four times is
 * where the fourth copy quietly goes missing, so they are one call.
 *
 * @param {string} text the program to record, already the text in the editor.
 */
function recordProgram(text) {
    history.record(text);
    walkMode = 'history';
    renderHistoryNav();
}

// The two step buttons, which are the walk's only route on a touch device: an
// iPad's on-screen keyboard has no arrow keys, so through a115 the readout
// described a control the reader could not operate.
//
// No refocus, per the author. The clear icon refocuses because clearing is a
// prelude to typing; walking is not, and on a phone a refocus pops the
// keyboard over the thing the reader is trying to look at.
$('history-prev').addEventListener('click', () => navigateHistory('prev'));
$('history-next').addEventListener('click', () => navigateHistory('next'));

// Whichever modifier this device's `Mod-` really is, written into the button
// titles and into the three hints that hardcoded `Ctrl`. On an iPad it is Cmd,
// and the page taught the wrong key on the one device where the keys are the
// harder route.
const MOD_KEY = modifierName();
$('history-prev').title = `step back through your history (${MOD_KEY}+↑)`;
$('history-next').title = `step forward through your history (${MOD_KEY}+↓)`;
for (const node of document.querySelectorAll('.mod-key')) node.textContent = MOD_KEY;

// Clear-X clears the editor and refocuses. Press it again on an empty box and
// it clears the stored history, which is the walk the two arrows below it
// navigate: the readout goes blank and both arrows grey.
//
// A second press rather than a control of its own, per the author, and
// deliberately with no confirmation dialog: a modal would defeat the point of
// asking for a gesture. "The cache of programs" is read as the localStorage
// history under `aggregate-web:history`, which is the only store a reader would
// describe that way and the one this icon's neighbors walk. The server side
// object cache is shared and is not the app's to drop.
//
// The word matters more here than anywhere else the button flashes one. The box
// was already empty, so nothing visible changes except a readout going blank,
// which is easy to miss, and without a word the second press reads as a dead
// control. It goes on `#history-pos`, which is the thing that just emptied and
// already carries `aria-live="polite"`, so it is announced as well as drawn.
//
// Guarded on the history being non-empty, which is not fussiness. `flashLabel`
// restores the text it captured, so two presses inside its 900ms would have the
// second capture the word the first was showing and put it back for good. There
// is also nothing to say: a press that clears nothing should report nothing.
$('editor-clear').addEventListener('click', () => {
    if (editor.getText().trim()) {
        editor.setText('');
        editor.focus();
        return;
    }
    if (history.position().n) {
        history.clear();
        renderHistoryNav();
        flashLabel($('history-pos'), 'cleared');
    }
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
    // A Bounds leaf starts its premium field above the expected loss, and the
    // build response already carries the mean, so there is no reason to
    // refetch a frame to find it. The summary chips read the response direct.
    state.mean = res.mean;
    state.hasReins = Boolean(res.has_reins);
    // A calibration is about the object it was made on, so a new object drops
    // both held pricing answers. `clearPanes` cannot do this: it also runs on a
    // perspective flip, where holding them is exactly what makes the toggle a
    // redraw rather than a second calibration.
    forgetPricing();
    applyCapability(res.capability);
    renderSummary(res);
    clearPanes();
    loadActiveTab();
}

/** Forget the object: a failed build leaves nothing that can answer anything. */
function forgetBuild() {
    state.id = state.kind = state.name = state.mean = null;
    state.hasReins = false;
    forgetPricing();
    applyCapability(null);
}

/**
 * Rebuild a declaration this session has lost, then retry what wanted it.
 *
 * The server keeps each session its own recipe base and drops it when the
 * session goes idle, when the registry evicts it, or on a restart. After that a
 * program referring to something you built earlier fails on a name the server no
 * longer holds, and the answer names it: the error pane finds the program that
 * declared it in history and calls this.
 *
 * Two steps, in order, and neither touches the editor: the inner program is
 * built to put the name back, then `build()` re-reads the editor, which still
 * holds the program the reader was trying to build.
 */
async function rebuildMissing(program) {
    try {
        await api.build(program, {});
        recordProgram(program);
    } catch (err) {
        renderBuildFailure(err);
        return;
    }
    await build();
}

/**
 * Write one plain line to the strip's first row, with nothing under it.
 *
 * For the two answers that are neither an object nor a failure: an empty box,
 * and a program that meant a number. Both leave the note and the timing lines
 * blank, because there is no program to quote and nothing was calculated.
 *
 * @param {Node|string|Array} content the line, as a node, text, or a list of
 *   either; `replaceChildren` flattens a list, which is why it is used rather
 *   than `append`.
 * @param {'ok'|'warn'|'bad'} [state] tints the whole strip; 'ok' leaves it plain
 */
function renderStripLine(content, state = 'ok') {
    const inner = $('summary-inner');
    replaceChildren(inner, content);
    setStripState(state);
    clearNote();
    $('summary-timing').textContent = '';
    syncSummaryMore();
}

/**
 * The empty box, answered rather than ignored.
 *
 * `build()` returned silently on a blank program through a137, so pressing
 * Build with nothing in the box did nothing at all and said nothing about it.
 * The hint names the other thing the box takes, because most readers do not
 * know DecL evaluates arithmetic.
 */
function renderNothingToBuild() {
    const mod = modifierName();
    renderStripLine(el('span', { className: 'text-muted' },
        'Nothing to build. Type a DecL program, or an expression in '
        + 'parentheses such as ',
        el('span', { className: 'mono' }, '(2+2)'),
        ', and press ',
        el('span', { className: 'mono' }, `${mod}+Enter`),
        '.'));
}

/**
 * A program that meant a number.
 *
 * DecL's top-level `answer` rule carries `expr`, so `(2+2)`, `2/3` and
 * `(exp(1))` are programs like any other and the library answers each with a
 * float. The route serves that as `kind: 'value'`; here it is one line on the
 * strip and nothing else.
 *
 * The object goes, which is the judgment call in this. A number is what the box
 * holds now, and leaving six tabs answering for the program that used to be
 * there would be a page showing two different things at once. The previous
 * program is one history step away.
 *
 * Formatted with the app's own `fmt`, the same helper that prints `mean` and
 * `CV` off a build response; those arrive equally bare. No format is invented
 * for a number the library hands over without one.
 */
function renderValue(res) {
    forgetBuild();
    clearPanes();
    renderActionRow();
    renderStripLine([
        el('span', { className: 'mono' }, res.decl),
        el('span', { className: 'mono' }, ' = '),
        el('span', { className: 'mono nm' }, fmt(res.value)),
    ]);
}

async function build() {
    const decl = editor.getText().trim();
    if (!decl) { renderNothingToBuild(); return; }

    // No scroll here, deliberately: `loadLanding` builds on page load and the
    // first paint must not move. The gesture sites (the button, Ctrl+Enter,
    // an example pick, the ring) each call `anchorEditor()` beside this, so
    // the scroll belongs to the gesture and never to the build itself.
    buildBtn.disabled = true;
    buildBtn.textContent = 'Building…';
    try {
        const res = await api.build(decl, {});
        // A number is not an object: no id, no panes, and nothing for the
        // action row to derive from. It is also not recorded in history, whose
        // ring is the trail of programs that built something and which
        // `rebuildMissing` walks looking for declarations.
        if (res && res.kind === 'value') { renderValue(res); return; }
        adoptBuild(res);
        recordProgram(decl);
        renderActionRow();
    } catch (err) {
        forgetBuild();
        renderBuildFailure(err, rebuildMissing);
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
const hintsBtn = $('hints-btn');
const pnlBtn = $('pnl-btn');
const reformatBtn = $('reformat-btn');
const gcnBtn = $('gcn-btn');
const gcnCaret = $('gcn-caret');

/** Grey the action-row buttons the current object cannot answer. */
function renderActionRow() {
    const off = (btn, disabled) => {
        if (!btn) return;
        btn.classList.toggle('disabled', disabled);
        btn.toggleAttribute('disabled', disabled);
        btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    };
    off(sharpenBtn, !can('canSharpen'));
    off(hintsBtn, !can('canHints'));
    // One button, two steps of one story: wrap the object in a P&L, then break
    // that P&L out layer by layer. The label moves with the object in the box,
    // so the button never lies about what the press will do, and the way back
    // from an exploded program is Ctrl+Up like any other derivation, which is
    // why there is no third state.
    const exploding = state.kind === 'pnl';
    if (pnlBtn) {
        pnlBtn.textContent = exploding ? 'Explode' : 'PnL';
        pnlBtn.title = exploding
            ? 'break this P&L out layer by layer, lowest attaching first'
            : 'wrap this object in a P&L';
    }
    off(pnlBtn, exploding ? !can('canExplode') : !can('canPnl'));
    // Both halves of the split button move together: a caret opening a menu
    // whose every item is refused would be worse than a dark caret.
    off(gcnBtn, !can('canViews'));
    off(gcnCaret, !can('canViews'));
    // Reformat is never greyed, and is the only control here that is not.
    // It reads the text rather than the object, so it works before anything
    // has been built, which is exactly when a pasted program is at its least
    // readable. Greying it on an empty box would mean re-rendering this row on
    // every keystroke to keep one button honest; Build already sets the
    // precedent for the alternative, staying live and doing nothing when there
    // is nothing to do.
}

/**
 * Run one derivation: fetch the program and its object, then adopt both.
 *
 * @param {HTMLElement} btn     the button, disabled with a label while it runs
 * @param {string} busy         what the button says meanwhile
 * @param {function} call       returns the derived response
 * @param {string} [land]       group to show afterwards, when the result belongs
 *                              somewhere other than where you are
 *
 * Notes
 * -----
 * **The derived program is recorded**, exactly as a typed one is. It has to be:
 * the whole design here is that a derivation answers with DecL rather than
 * hiding behind a cached id, so what lands in the editor is a program you own,
 * and a program you own that Ctrl+Up cannot get back to is not one you own.
 * Ceding three layers one at a time and wanting the second of them back is the
 * ordinary case, and through a68 it was unreachable.
 *
 * All three derivations behind this were missing it, not only the reported one
 * (Reins). GCN records its own because it composes its program here rather than
 * fetching one, which is why the gap read as arbitrary from the outside.
 */
async function runDerivation(btn, busy, call, land) {
    if (!state.id || btn.hasAttribute('disabled')) return;
    anchorEditor();                  // the scroll rule: a button under the box
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = busy;
    try {
        const res = await call(state.id);
        // The editor first: if adopting the object threw, the text that made it
        // is still what you are looking at.
        editor.setText(res.program);
        recordProgram(res.program);
        adoptBuild(res);
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
    _note.derivation = text || '';
    renderNote();
}

/**
 * The note slot's tenants, and why they share one line.
 *
 * `tags` and `declared` are the program's own `tags{}` and `note{}`, verbatim:
 * how the author of the declaration classified it and what they said about it,
 * as the reader typed it in the box. They are one tenant between them, on one
 * line, tags first as chips and the note running on after them.
 *
 * `caption` is the library's, and it is the fourth tenant, added at a132. A
 * program picked out of the Examples menu arrives with its `note{}` and
 * `tags{}` stripped, because filing metadata in front of a reader is not what
 * anyone is there to look at, so the prose reaches the strip on this channel
 * instead: the picked item's own `note` and `tags` fields, which the menu row
 * already reads. It is drawn in the same slot and looks identical, which is the
 * point.
 *
 * **`declared` wins over `caption`.** A reader who types their own `note{}`
 * over a loaded example sees theirs, which keeps the hand typed path exactly as
 * it was.
 *
 * **They have different lifetimes**, which is why the caption is not simply
 * assigned to `declared`. The three build derived tenants belong to one object
 * and are cleared on every build; the caption belongs to the **program in the
 * box** and survives being built, so the strip still says what the example is
 * once it has run. It goes when the reader types over it.
 * `derivation` is what Sharpen or PnL just did, in the library's own words.
 * `warnings` is what the library said while building, at WARNING and above:
 * a splice reaching below zero, a clause ignored, a grid clipping the tail.
 *
 * They share a slot because they are the same kind of thing, what this object
 * says about itself rather than a reading off it, and a strip line each for
 * three things usually empty would cost the layout more than it returns.
 *
 * The declaration's own line leads. It is the only one the object carries on its
 * own account, so it reads as a caption on the facts line right above it, and the
 * other two are then remarks about the build that just ran, in the order they
 * happened. The note is printed with no label: a sentence of prose under a line
 * of instrument readings does not need to be told apart from one.
 *
 * This line is where the Overview header block used to be, and it absorbed that
 * block at a120 rather than copying it. The header was drawn for one group and
 * cost a `/meta` fetch to draw; the strip stands under all six and is already
 * holding the build response that carries both fields.
 */
const _note = { tags: [], declared: '', derivation: '', warnings: [],
                caption: null };

function renderNote() {
    const line = $('summary-note');
    if (!line) return;
    empty(line);
    // The object's own declaration first, the library's caption behind it. Read
    // per field rather than per source, so a program that declares tags and no
    // note still picks the caption's sentence up.
    const caption = _note.caption || {};
    const tags = _note.tags.length ? _note.tags : (caption.tags || []);
    const declared = _note.declared || caption.note || '';
    if (tags.length || declared) {
        // One block, so the chips and the sentence wrap as one paragraph rather
        // than the note starting a line of its own under a short row of tags.
        const own = el('span', { className: 'note-declared' });
        for (const tag of tags) {
            own.appendChild(el('span', { className: 'note-tag' }, tag));
        }
        if (declared) own.appendChild(el('span', {}, declared));
        line.appendChild(own);
    }
    if (_note.derivation) line.appendChild(el('span', {}, _note.derivation));
    for (const w of _note.warnings) {
        line.appendChild(el('span', { className: 'note-warn' }, w));
    }
}

/**
 * Clear the note slot's build derived tenants. Called on every build.
 *
 * A note belongs to one object, which is why these three go on every build. The
 * **caption** does not: it belongs to the program in the box, so a library entry
 * that has just been built still says what it is. It is cleared where the box
 * stops holding that program, which is `onEdit` when the reader typed.
 */
function clearNote() {
    _note.tags = [];
    _note.declared = '';
    _note.derivation = '';
    _note.warnings = [];
    renderNote();
}

sharpenBtn?.addEventListener('click', () => runDerivation(
    sharpenBtn, 'Sharpening…', (id) => api.sharpen(id)));

// Hints is Sharpen's quiet twin: same shape, no probe. Sharpen asks whether a
// better grid exists and moves to it; this keeps the grid you have and writes it
// down. That is the cheaper and more common thing to want, because a declaration
// another program will reference by name has to state its own resolution, and
// the library refuses an unpinned one.
hintsBtn?.addEventListener('click', () => runDerivation(
    hintsBtn, 'Pinning…', (id) => api.hints(id)));

// Press one lands on Economics, where the P&L it just wrote is the thing to
// look at. Press two stays where you are: you are already reading the P&L and
// the exploded one answers in the same place, now layer by layer.
pnlBtn?.addEventListener('click', () => (
    state.kind === 'pnl'
        ? runDerivation(pnlBtn, 'Exploding…', (id) => api.explode(id))
        : runDerivation(pnlBtn, 'Wrapping…', (id) => api.pnl(id), 'economics')));

/**
 * Rewrite the program in the box in canonical form.
 *
 * Builds nothing and touches no object: `format_program` parses, re-renders
 * with the library's own clause order, spacing and line breaks, and hands the
 * text back. Which is why this is not in the derive group.
 *
 * The server is best-effort by design and echoes the input on any failure
 * (`routes/decl.py`), so a malformed program reformats to itself. Saying
 * "unchanged" is what stops that reading as a dead button; it is also the
 * honest answer for a program that was already canonical.
 */
reformatBtn?.addEventListener('click', async () => {
    const before = editor.getText();
    if (!before.trim() || reformatBtn.hasAttribute('disabled')) return;
    anchorEditor();                  // the scroll rule: a button under the box
    reformatBtn.disabled = true;
    try {
        const { decl } = await api.formatDecl(before);
        if (decl && decl !== before) editor.setText(decl);
        else flashLabel(reformatBtn, 'unchanged');
    } catch {
        flashLabel(reformatBtn, 'unchanged');
    } finally {
        reformatBtn.disabled = false;
        renderActionRow();
    }
});

/**
 * Say something on a button for a moment, then put its label back.
 *
 * Came out at a55 with the copy buttons, its only caller then. Back because
 * Reformat needs it: its no-op case is indistinguishable from a broken button
 * without a word.
 */
function flashLabel(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 900);
}

/**
 * GCN: read the program as a pair of {gross, ceded, net} views.
 *
 * A prefix on the program text, not a route: the grammar takes
 * `GROSSCEDED agg_out` and an `agg_out` is a whole inline declaration, so
 * this is `grossceded ` + what you already have. Reformatted on the way
 * through, which is why a58 does Reformat first and reuses the call here.
 *
 * The result is a `BivariateAggregate`, so the object's kind changes and the
 * navigation re-gates around it. That is why it lands on Overview: pressing
 * this from the Reinsurance tab would otherwise leave you looking at a group
 * that just went dark, since a bivariate cannot cede.
 */
const VIEW_LABEL = {
    grossceded: 'Gross / Ceded', grossnet: 'Gross / Net', netceded: 'Net / Ceded',
};

async function applyViews(kw) {
    if (!can('canViews') || gcnBtn.hasAttribute('disabled')) return;
    const base = editor.getText().trim();
    if (!base) return;
    anchorEditor();                  // the scroll rule: a button under the box
    // Close the menu **before** anything is disabled, and never the other way
    // round. Bootstrap finds open dropdowns with
    // `[data-bs-toggle="dropdown"]:not(.disabled):not(:disabled).show`, so a
    // disabled toggle is invisible to `clearMenus`, the document-level handler
    // that closes a menu when you click away; `Dropdown.hide()` bails on the
    // same test. Disabling first therefore stranded the menu open: this handler
    // runs on the item's click, disables the caret synchronously, and the click
    // then bubbles to a `clearMenus` that can no longer see the thing it is
    // there to close. The build that follows returns a bivariate, `canViews`
    // goes false, and `renderActionRow` leaves `.disabled` on for good, so the
    // menu could not be closed by clicking the caret either. Stuck open, which
    // is the author's report (Round 5 item 7).
    //
    // General rule for anything added beside it: do not disable a Bootstrap
    // dropdown toggle while its menu is open.
    bootstrap.Dropdown.getInstance(gcnCaret)?.hide();
    gcnBtn.disabled = true;
    gcnCaret.disabled = true;
    const label = gcnBtn.textContent;
    gcnBtn.textContent = 'Reading…';
    try {
        // Strip a prefix already there, so pressing GCN twice swaps the pair
        // rather than stacking `grossnet grossceded agg ...`, which does not
        // parse and would report as a syntax error in a program the reader
        // never typed.
        const bare = base.replace(/^\s*(grossceded|grossnet|netceded)\s+/i, '');
        let decl = `${kw} ${bare}`;
        try {
            const formatted = await api.formatDecl(decl);
            if (formatted?.decl) decl = formatted.decl;
        } catch { /* formatting is a courtesy; build the text either way */ }
        editor.setText(decl);
        adoptBuild(await api.build(decl, {}));
        recordProgram(decl);
        noteDerivation(`Read as ${VIEW_LABEL[kw] || kw}.`);
        showTab('overview');
    } catch (err) {
        forgetBuild();
        renderBuildFailure(err);
    } finally {
        gcnBtn.disabled = false;
        gcnCaret.disabled = false;
        gcnBtn.textContent = label;
        renderActionRow();
    }
}

// The main button takes the default pair; the menu offers all three.
gcnBtn?.addEventListener('click', () => applyViews('grossceded'));
document.querySelectorAll('[data-views]').forEach((item) => {
    item.addEventListener('click', () => applyViews(item.dataset.views));
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

buildBtn.addEventListener('click', () => { anchorEditor(); build(); });

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
    // Every form takes the shape of the object in front of it, and its preview
    // line answers for it, before any leaf has been visited. A form left out of
    // this list draws the *previous* object's basis row until something else
    // redraws it, which is a control that lies rather than one that is merely
    // stale: the Allocate row greyed all three views, on a cession, saying to
    // add one.
    priceForm.sync();
    allocateForm.sync();
    syncEvaluateForm();
    boundsForm.sync();
    const kindLabel = KIND_LABEL[res.kind] || 'Aggregate';
    const bits = [el('span', { className: 'nm' }, res.name || '(anonymous)')];
    const add = (text) => bits.push(sep(), el('span', { className: 'mono' }, text));
    add(kindLabel);

    // An object built from a pair measures a grid per axis, so its facts are
    // pairs and the scalar fields are all null. Reported as `(a, b)` in the
    // same slots, rather than as a second line or a different vocabulary: it
    // is the same five facts about a thing that happens to have two halves.
    const parts = res.components || [];
    if (parts.length) {
        const pair = (fn, key) => `(${parts.map((c) => (c[key] == null ? '?' : fn(c[key]))).join(', ')})`;
        add(`bs = ${pair(fmtBs, 'bs')}`);
        add(`log2 = ${pair(String, 'log2')}`);
        add(`mean ${pair(fmt, 'mean')}`);
        add(`CV ${pair(fmt, 'cv')}`);
    } else {
        if (res.bs != null)   add(`bs = ${fmtBs(res.bs)}`);
        if (res.log2 != null) add(`log2 = ${res.log2}`);
        // Between log2 and mean, on every object that has an orientation to
        // report. Sent for `loss` as well as `payoff` since a65: reporting only
        // the exceptional case meant reporting nothing at all, because the two
        // kinds that answer are both `loss` and the one that is `payoff` does
        // not answer. A missing value now means the kind has no convention, not
        // that its convention is the ordinary one.
        if (res.value_type)   add(res.value_type);
        if (res.mean != null) add(`mean ${fmt(res.mean)}`);
        if (res.cv != null)   add(`CV ${fmt(res.cv)}`);
    }

    if (res.validation) {
        const state = validationState(res.validation);
        bits.push(sep(), el('span', { className: `mono ${state}` }, res.validation));
        setStripState(state);
    } else if (parts.length) {
        // A bivariate has no `validation_description`: its correctness gate is
        // the tail deficit, a mass-conservation check rather than the moment
        // comparison every other kind reports. Saying `n/a` is the honest
        // answer, and better than a silent gap that reads as a clean bill.
        // Relabeling the deficit as a verdict would not be; that is asked for
        // upstream instead, see `dev/TODO.md`.
        add('validation n/a');
        setStripState('ok');
    } else {
        setStripState('ok');
    }
    // No `cached` marker here since a56. It said on line one what line two
    // already says in words ("Loaded from cache"), and it said it in the middle
    // of the object's own facts, where a property of *this request* does not
    // belong. What it was incidentally doing, marking a rebuild of the same
    // program as a no-op, is now the flash's job and done for every build
    // rather than only for the cached ones.
    inner.append(...bits);
    clearNote();
    // What the program says about itself, on the line under its own numbers.
    // Straight off the build response rather than off `/v1/objects/{id}/meta`,
    // which was fetched once per object and only while Overview was open: a note
    // worth reading is worth reading from wherever the reader happens to be.
    _note.tags = res.tags || [];
    _note.declared = res.note || '';
    // Whatever the library said while building this object. Deliberately does
    // NOT tint the strip: the ground carries the validation verdict, which is
    // a narrower and more actionable statement, and letting a warning repaint
    // it would put two claims on one surface.
    _note.warnings = res.warnings || [];
    renderNote();
    renderTiming(res);
    syncSummaryMore();
    flashStrip();
}

/**
 * Blink the strip once, on every adopted build.
 *
 * The answer to "I pressed Build and nothing happened". Building the same
 * program twice is a cache hit that redraws the strip with identical text, so
 * without this there is no evidence at all that the second press did anything.
 * The `[m/n]` readout does not cover it either, because history dedups against
 * the most recent entry and both numbers hold.
 *
 * Fires for cached and computed builds alike, deliberately: the reader is
 * asking whether the press registered, which has the same answer either way.
 *
 * Restarting a CSS animation needs the class off, a forced reflow, then the
 * class on. Without the reflow the browser coalesces both changes into no
 * change at all and the second build does not blink, which is exactly the bug
 * this is here to fix.
 */
function flashStrip() {
    const strip = $('status-strip');
    if (!strip) return;
    strip.classList.remove('is-flash');
    void strip.offsetWidth;
    strip.classList.add('is-flash');
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
 * Under a cession the library prefixes its verdict: an object whose gross is
 * clean reports `reinsurance; subject not unreasonable`, and a failing one
 * `reinsurance; subject fails agg mean`. The realized net view has no
 * independent theoretical to check against, so what it can honestly report is
 * the status of the subject it was built from, and that is what the prefix
 * says.
 *
 * Through a55 none of that was recognized here, so every reinsured object with
 * a perfectly clean gross turned the strip amber. Stripping the prefix and
 * grading the remainder fixes it, and does so for the right reason rather than
 * by adding a second literal: `reinsurance; subject fails agg mean` also grades
 * `bad` because it names the mean, which it would previously have reached only
 * because the substring happened to survive.
 *
 * @param {string} text the `validation` field off the build response.
 * @returns {'ok'|'warn'|'bad'}
 */
const REINS_VERDICT = /^reinsurance;\s*subject\s+/;

function validationState(text) {
    const s = String(text).trim().toLowerCase().replace(REINS_VERDICT, '');
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

/**
 * @param {Error} err the failure
 * @param {(program: string) => void} [onRebuild] offered when the failure is a
 *   declaration this session has lost and history holds the program that made
 *   it; see `rebuildMissing`.
 */
function renderBuildFailure(err, onRebuild) {
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
    else if (err instanceof ApiError) pane.appendChild(renderError(err, onRebuild));
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
// group with several panes rather than one. Calibrate and Stand-alone are two
// readings of one calibration and share a form, but they are two documents and
// so two panes; Allocate is a second press; Plot is a chart; Evaluate is a
// second form asking the opposite question.
const PANE_OF = {
    overview: 'pane-overview', economics: 'pane-economics',
    reinsurance: 'pane-reinsurance', pricing: 'pane-calibrate',
    bounds: 'pane-bounds', more: 'pane-more',
};
const ALL_PANES = [...Object.values(PANE_OF), 'pane-standalone', 'pane-allocate',
                   'pane-kappa', 'pane-evaluate', 'pane-ruin', 'pane-ruin-stats'];

function clearPanes() {
    destroyAllGrids();
    // Emptying the panes is exactly what makes nothing rendered, so the two
    // move together rather than the caller being trusted to remember.
    state.rendered = {};
    for (const id of ALL_PANES) empty($(id));
    empty($('reins-desc'));
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    if (overviewChart) { overviewChart.dispose(); overviewChart = null; }
    if (boundsChart) { boundsChart.dispose(); boundsChart = null; }
    if (kappaChart) { kappaChart.dispose(); kappaChart = null; }
    if (ruinChart) { ruinChart.dispose(); ruinChart = null; }
    if (moreChart) { moreChart.dispose(); moreChart = null; }
}

// The scroll policy (the anchors, the down-only rule, the closed set of
// gestures) lives in scroll.js, with the `.tab-content` floor in site.css
// that makes one scroll at gesture time sufficient.

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
// Four of these moved onto the exhibit route at a68: Overview Summary, Tail and
// Validation, and More Stats. Each was fetching a DataFrame and having the api
// build a document from it, with the api holding that frame's formats and row
// emphasis in `tables.py` and its title and caption as literals in this file.
// All four are published exhibits, so all four of those copies were a second
// opinion about a table the library already has one about. What the library
// serves now, the app draws.
//
// The move was blocked until `aggregate` 1.0.0a246: an exhibit block carried no
// raw values, so it could not be handed to the interactive grid at all, and
// moving a leaf onto that route would have traded a working table for a broken
// one. See `dev/plan-ui-round-5.md` item 21.
//
// Reinsurance Summary followed at a70, and Reinsurance Stats and More Window at
// a71. **Every published exhibit is now drawn as published.**
//
// The a71 pair are worth a sentence because both had been recorded as decisions
// and neither was one. Reins Stats fetched two frames the *api* built by turning
// the library's layering analysis on its side and splitting it; More Window
// fetched the library's *private* probe frame in preference to its published
// one. Nobody had weighed the library's version and rejected it: the leaves
// predate the registry, and when exhibits arrived nobody came back for them. The
// author's ruling, and it is the standing rule: publish what the library says,
// and if it is wrong, change the library.
//
// More Sharpen followed at a94, onto the `sharpen` exhibit the library
// registered at a255: INSURER leads with the score grid, then the walk with
// its working, each block captioned upstream. That cutover deleted the two
// hardcoded block ledes this file carried and emptied `tables.FORMATS`.
//
// **What is left, and none of it is a table the library publishes.**
//
//   Bounds (2)      computed from what the reader typed, so not keyed on the
//                   object and not registry exhibits in the current sense. The
//                   author is adding a bounds summary upstream. The documents
//                   are built here meanwhile, which is the last pandas in the
//                   table pipeline.
//   both densities  bulk, permanently the grid's, and the one agreed exception,
//                   scoped out by the author. A table of thousands of rows is
//                   not a reading experience.
//
// **Pricing left this list at a85.** Its table leaves draw `pricing.calibrate`,
// `pricing.stand_alone`, `pricing.allocate` and `pricing.evaluate`, which the
// library registers on the result objects `calibrate_distortions` and
// `evaluate` return. They are not fetches in the sense this list means: a form
// posts and the pane draws what came back, so a leaf here only reveals what a
// press already produced. Pricing Plot is the exception and is a chart leaf
// like any other, because it asks the object rather than a form.
//
// Nothing else is allowed on the frame route. If a leaf here starts fetching a
// DataFrame and formatting it, that is the bug.
const LOADERS = {
    'overview:plot': () => loadOverviewPlot(),
    'overview:summary': () => loadExhibitLeaf('pane-overview', 'summary',
        ['overview', 'summary']),
    // The return-period ladder, and only that. It was paired with
    // `tail_behavior_df` through a50 on the grounds that both are about the
    // tail; they are not the same question, and in any case the pairing never
    // drew, because that loader took the frame route and the name is not in
    // `_CSV_FRAMES`. Tail behavior is its own leaf under More, off its own
    // exhibit.
    'overview:tail': () => loadExhibitLeaf('pane-overview', 'tail',
        ['overview', 'tail']),
    // Moved to Overview from More at a55, onto the exhibit route at a68.
    'overview:validation': () => loadExhibitLeaf('pane-overview', 'validation',
        ['overview', 'validation']),
    // Moved to Overview from More at a125. Both halves of the key move: the
    // pane id decides which pane the table is drawn into and the reading-map
    // key decides where its reading is filed, so a half move would draw the
    // Stats table into the More pane behind an Overview pill.
    'overview:stats': () => loadExhibitLeaf('pane-overview', 'stats',
        ['overview', 'stats']),

    'economics:ledger': () => loadExhibitLeaf('pane-economics', 'economic',
        ['economics', 'ledger']),
    'economics:ratios': () => loadExhibitLeaf('pane-economics', 'economic_ratios',
        ['economics', 'ratios']),
    'economics:waterfall': () => loadExhibitLeaf('pane-economics', 'economic_waterfall',
        ['economics', 'waterfall']),

    // The `reins` exhibit's first block, the layering analysis, in the
    // library's own orientation. Under Summary since a151: it is the leaf's
    // own hint ("the program layer by layer"), and the daily read of a
    // program. The api transposed it and split it in two from round 3 to a71.
    'reinsurance:summary': () => loadReinsExhibit(0, ['reinsurance', 'summary']),
    // The `reins` exhibit's second block, which is `reins_summary_df` with
    // the library's caption and, on a portfolio, its row flags: the moment
    // table in the eight column validation layout, which is what Stats
    // promises ("gross, ceded and net moments"). The two leaves showed each
    // other's block from a70 to a150.
    'reinsurance:stats': () => loadReinsExhibit(1, ['reinsurance', 'stats']),
    'reinsurance:density': () => loadReinsFrame('reins_density_df',
        ['reinsurance', 'density']),
    'reinsurance:plot': () => loadReinsPlot(),

    'pricing:calibrate': () => showPricingLeaf('calibrate'),
    'pricing:standalone': () => showPricingLeaf('standalone'),
    'pricing:allocate': () => showPricingLeaf('allocate'),
    'pricing:plot': () => showPricingLeaf('plot'),
    'pricing:ruin': () => showPricingLeaf('ruin'),
    'pricing:evaluate': () => showPricingLeaf('evaluate'),

    'bounds:bounds': () => showBoundsLeaf('bounds'),
    'bounds:pricing': () => showBoundsLeaf('pricing'),
    'bounds:allocation': () => showBoundsLeaf('allocation'),

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
                : api.density_df(state.id, { ...opts, cols: 'loss,p_total,F,S' })),
            ['more', 'density']);
    },
    // The exhibit route, not the frame route: the library registers a
    // `tail_behavior` exhibit and the api already serves it, so this leaf needs
    // no backend change at all. Its neighbors here take the frame route for
    // historical reasons rather than good ones.
    'more:behavior': () => loadExhibitLeaf('pane-more', 'tail_behavior',
        ['more', 'behavior']),
    // The one More leaf that is not a single table: a Plot / Summary switch
    // inside the pane, the exhibit under one pill and the library's chart under
    // the other. See the section above `loadApproximation`.
    'more:approximation': () => loadApproximation(),
    'more:window': () => loadExhibitLeaf('pane-more', 'bs_window',
        ['more', 'window']),
    'more:dependency': () => loadExhibitLeaf('pane-more', 'dependency',
        ['more', 'dependency']),
    // The `sharpen` exhibit (LIB a255): INSURER leads with the score grid
    // unstacked (`[Sharpen-Grid-Is-A-Reading]`), then the per-cell walk, each
    // block captioned by the library. The frame route still serves
    // `sharpen_score` / `sharpen_df` for direct api use.
    'more:sharpen': () => loadExhibitLeaf('pane-more', 'sharpen',
        ['more', 'sharpen']),
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
 *
 * A leaf declaring `dividerBefore` gets a thin rule to its left, which splits
 * the row into groups without splitting it into two rows. Pricing is the one
 * user: Calibrate and Allocate are two readings of one calculation and Evaluate
 * asks the opposite question, so the row reads `Calibrate Allocate | Evaluate`
 * rather than as three equal siblings.
 */
function renderSubTabs(group) {
    const row = $(`sub-${group}`);
    if (!row) return;
    empty(row);
    const current = activeLeaf(group);
    for (const [key, leaf] of Object.entries(NAV_GROUPS[group].leaves)) {
        const off = !leafAvailable(group, key);
        // Presentational, so `aria-hidden`: a screen reader walking the tab
        // list should hear three tabs, not three tabs and a piece of furniture.
        if (leaf.dividerBefore) {
            const rule = el('span', { className: 'sub-divider' });
            rule.setAttribute('aria-hidden', 'true');
            row.appendChild(rule);
        }
        const btn = el('button', {
            type: 'button',
            className: `sub-link${key === current ? ' active' : ''}`
                + (off ? ' nav-off' : ''),
            // The same label again, for the hidden bold ghost site.css draws
            // inside the button: the row is `flex-wrap`, so a leaf that widens
            // when it is selected can rewrap the row under a thumb that is
            // already moving toward it. `nav.js` owns the label; this reads it.
            'data-label': leaf.label,
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
}

/** The group's `.tab-pane` element (`#t-<group>`), the clamp for `anchorNav`. */
function paneOf(group) { return document.getElementById(`t-${group}`); }

/** Move a group to one of its leaves, load it, and anchor once it settles. */
function selectLeaf(group, key) {
    state.leaf[group] = key;
    renderSubTabs(group);
    anchorNavSettled(paneOf(group), loadLeaf(group));
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
        // attribute is NOT set, because it suppresses the tooltip in Chrome.
        // The click is refused below instead.
        //
        // The a48 note here said the attribute "kills the pointer events the
        // :hover rule needs", and stopped there, which missed that Bootstrap's
        // `.disabled` CLASS does exactly the same thing: `.nav-link.disabled`
        // carries `pointer-events: none`. So this line was suppressing the very
        // tooltip the two lines below it set up, on every dark GROUP tab, from
        // a48 to a53. The sub-tabs never take the class and were always fine,
        // which is what made it read as "the tabs do nothing" rather than as a
        // missing rule. `site.css` puts the pointer events back under
        // `.nav-link.nav-off`; see the greying protocol block there.
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

// Bootstrap fires shown.bs.tab on the tab trigger when a pill activates, and
// it fires during the capture phase at `document` (the data-api passes its
// selector as `addEventListener`'s third argument, which reads as
// `capture: true`). It fires synchronously there: Tab's completion callback
// defers only when the element it queued on carries .fade, and that element
// is the trigger button, which never does. So within one click the order is
// pinned: shown starts the load, the click listeners below run, and the load
// completes at least a microtask later, after the whole click bubble. The
// anchor still rides the click, not the shown event, so a programmatic
// activation (the initial page, `applyCapabilityGating` falling back to
// Overview, the arrow keys) loads its tab and never scrolls. The click
// records a pending-gesture token; the load's completion consumes it if the
// group still matches and fires the settled anchor, so of two gestures
// racing the latest wins and the stale one moves nothing (plan a150).
let pendingNav = null;   // { group, scrollY } recorded by the live click
let navShown = null;     // group whose shown event fired in the current task
document.querySelectorAll('.out-tabs [data-tab]').forEach((btn) => {
    btn.addEventListener('shown.bs.tab', () => {
        const group = btn.dataset.tab;
        navShown = group;
        queueMicrotask(() => { navShown = null; });
        const loading = loadTab(group);
        loading.catch(() => {}).then(() => {
            if (pendingNav && pendingNav.group === group) {
                const { scrollY } = pendingNav;
                pendingNav = null;
                anchorNavSettled(paneOf(group), loading, scrollY);
            }
        });
    });
    // A dark group keeps its pointer events so the tooltip fires, so the click
    // has to be refused here. Capture phase on the button, which still runs
    // after Bootstrap's capture at document; the class check inside
    // Bootstrap's own handler is what actually refuses the activation, and
    // this stops the bubble for everything else.
    btn.addEventListener('click', (e) => {
        if (btn.classList.contains('nav-off')) {
            e.preventDefault(); e.stopPropagation();
        }
    }, true);
    // A live group click is the navigation gesture whether or not the tab
    // changed. A fresh activation (its shown event just fired, above) hands
    // the anchor to the load through the token; re-clicking the active tab
    // fires no shown, so it anchors directly, content already rendered and
    // geometry already known.
    btn.addEventListener('click', () => {
        if (btn.classList.contains('nav-off')) return;
        const group = btn.dataset.tab;
        if (navShown === group) {
            pendingNav = { group, scrollY: window.scrollY };
        } else {
            anchorNav(paneOf(group));
        }
    });
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
 * Reinsurance carries a block above its row, fetched once per build rather than
 * per leaf, so moving between its leaves costs nothing. Overview had one too
 * through a119; see the note above the Overview loaders for where it went.
 */
async function loadTab(group) {
    if (!state.id || !NAV_GROUPS[group]) return;
    renderSubTabs(group);
    if (group === 'reinsurance') await loadReinsDescription();
    await loadLeaf(group);
}

// The live ECharts instances, one per pane that can hold a chart, disposed
// before each re-render so canvases and ResizeObservers do not leak across
// builds. CsvGrid teardown is keyed on the grid registry; charts are not, so we
// track them ourselves.
let overviewChart = null;
let boundsChart = null;
// The Pricing group's Plot leaf. A chart on the built object rather than on a
// pricing result, which is why it is held here beside the other three rather
// than inside the pricing state: a kappa curve conditions on an outcome, not on
// a distortion, so nothing a form does invalidates it.
let kappaChart = null;
// The Pricing group's Pr Ruin leaf: the two-panel surplus-path chart, drawn
// from a document the form fetched. Tracked like the others so a pane
// replacement disposes it rather than leaving a ResizeObserver on a detached
// canvas.
let ruinChart = null;
// The More group's Approximation leaf, whose Plot half is the first chart to
// appear under More. Every other leaf in that group is a table, so before this
// the pane had no instance to track and `disposePaneChart` had no branch for
// it; stepping from the plot to any neighboring leaf would have left the
// instance alive over a detached canvas with its ResizeObserver still running.
let moreChart = null;

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
//
// Three values since a59, not two: `precise` is the static view printing every
// meaningful digit instead of the house formats. A third state of one
// preference rather than a second preference, because it answers the same
// question the other two do, how should a table read, and because the
// interactive view is already exact. It fetches nothing extra; the raw values
// travel in every document under `include_raw`, and this decides which of the
// two the static walker prints.
const TABLE_VIEW_KEY = 'aggapi.tableView';
/** Is this table-view value one of the static readings? */
function isStatic(mode) { return mode === 'static' || mode === 'precise'; }

/** A frame document. One per frame: the precision is decided at render time. */
function frameDoc(which) {
    return api.frameIr(state.id, which);
}

/**
 * Which business reading of an exhibit to serve, page-wide and sticky.
 *
 * The library owns the translation, so this is a passthrough on the exhibit
 * route and nothing here knows what either perspective does to a frame.
 *
 * Thirteen of the nineteen table leaves take one, which is every leaf drawing a
 * published exhibit: Overview Summary, Tail and Validation; Economics Ledger,
 * Ratios and Waterfall; Reinsurance Summary and Stats; More Stats, Tail
 * behavior, Window, Dependency and Sharpen (since a94). The other six are the
 * two densities and the four Pricing and Bounds tables, and the reason each is
 * still outside the generic exhibit loader is above `LOADERS`.
 */
const PERSPECTIVE_KEY = 'aggapi.perspective';
let _perspective = (() => {
    try { return localStorage.getItem(PERSPECTIVE_KEY) || 'insurer'; }
    catch { return 'insurer'; }
})();
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

/**
 * Re-render everything registered, and drop what has left the page.
 *
 * The **redraw** path, for a preference the panes can honor from the document
 * they already hold. A pane that registered and was then replaced is dropped
 * here rather than tracked, which is what keeps the map from growing across
 * rebuilds.
 */
function notifyTableListeners() {
    for (const [key, entry] of [...tableViewListeners]) {
        if (entry.node && !entry.node.isConnected) {
            tableViewListeners.delete(key);
            continue;
        }
        try { entry.fn(); } catch { /* one dead pane must not stop the others */ }
    }
}

/**
 * Throw away every pane's contents and load the group on screen again.
 *
 * The **refetch** path, for a preference that changes what the *server* builds.
 * Perspective alone since a68: the library owns the business translation, so the
 * other reading of a frame exists only on the server. Full precision was here
 * too and is not any more, because the numbers travel with every document and
 * the app reprints them itself.
 *
 * Two things have to give way together, which is why this exists rather than the
 * listeners simply being asked twice. A loader awaits its document **outside**
 * the closure it registers with `onTableViewChange`, so the registered redraw
 * re-renders the bytes it already has. And `loadLeaf` declines to re-run a
 * loader for the leaf already on screen (`state.rendered`), so even walking away
 * and back would not have fetched again. Clearing the record is what makes the
 * loader run.
 *
 * Cleared for **every** group, not only the one in view: the panes behind the
 * other tabs are also holding documents built at the old setting, and they must
 * reload when the reader next reaches them rather than showing yesterday's
 * digits under today's tick.
 *
 * a59 shipped both preferences without this, and both were inert until the next
 * build. See `dev/plan-ui-round-5.md`, items 15 and 23.
 */
function refetchTables() {
    if (!state.id) return;
    // `clearPanes` rather than clearing `state.rendered` by hand: it is already
    // the one place that tears down the CsvGrid and ECharts instances a pane
    // holds, and doing half of it here would leak a grid per flip of the switch.
    // The identity blocks it also clears are refilled by `loadTab`, for this
    // group now and for the others when they are next opened, which is the same
    // path a rebuild takes.
    //
    // It takes the charts with it, so flipping a *table* preference while the
    // reader is on a plot leaf costs that chart's document again. Accepted, and
    // cheap in practice: every document route answers with its content hash as
    // an ETag under `Cache-Control: no-cache`, so a re-request revalidates to a
    // 304 rather than sending the payload. The alternative, teaching this which
    // panes hold tables, is a second map to keep in step with the loaders for a
    // saving on an action nobody takes twice in a minute.
    clearPanes();
    tableViewListeners.clear();
    loadActiveTab();
}

function setTableView(mode) {
    if (mode === _tableView) return;
    _tableView = mode;
    try { localStorage.setItem(TABLE_VIEW_KEY, mode); } catch { /* private mode */ }
    syncPreferenceMenu();
    // A redraw, for all three readings. Every document carries the exact values
    // beside the formatted ones, so static, interactive and full precision are
    // three ways of printing bytes already in hand and none of them needs the
    // server. Full precision cost a refetch from a59 to a67 only because the
    // exhibit route served documents with their numbers dropped, and there was
    // nothing local left to reprint; `aggregate` 1.0.0a246 ships raw on every
    // served block and that is what makes this line honest.
    notifyTableListeners();
}

function setPerspective(mode) {
    if (mode === _perspective) return;
    _perspective = mode;
    try { localStorage.setItem(PERSPECTIVE_KEY, mode); } catch { /* private mode */ }
    syncPreferenceMenu();
    // Always a refetch: the library owns the translation, so the other reading
    // of a frame exists only on the server.
    refetchTables();
}

// The header dropdown's Tables and Perspective sections. One sync for both,
// since both are the same checked-item pattern and a tick that follows the
// value however it moved is the whole contract. Tables has a second affordance
// on the Overview, which is why this reads the value rather than the click.
function syncPreferenceMenu() {
    for (const item of document.querySelectorAll('[data-table-view]')) {
        item.classList.toggle('active', item.dataset.tableView === _tableView);
    }
    for (const item of document.querySelectorAll('[data-perspective]')) {
        item.classList.toggle('active', item.dataset.perspective === _perspective);
    }
}
/**
 * Ctrl+Shift+U: step through the three readings of a table.
 *
 * The one preference worth a keystroke, because it is the one you change while
 * reading rather than while deciding: a table you want to sort is a table you
 * are already looking at, and going up to the header menu and back loses your
 * place on the page.
 *
 * It **cycles** rather than flips, in the order the menu lists: static, static
 * at full precision, interactive, and round to static again. Full precision was
 * held out of the keystroke through a133 and reachable from the menu only. It
 * earns its place here because it answers the same question the other two do,
 * how should this table read, and because checking a printed digit against all
 * of them is exactly a thing done while reading.
 *
 * **Capture phase, and `stopPropagation`, and this is the whole trick.**
 * CodeMirror drops the Shift when it matches a character key held with Ctrl, so
 * inside the editor `Ctrl+Shift+U` matches the `Mod-u` in `historyKeymap`,
 * which is `undoSelection`, which pops the last *document* change when there is
 * no selection-only event to pop. The first cut of this bound the shortcut on
 * the bubble phase: the view flipped, and the program you had typed vanished,
 * because CM had already handled the keystroke on the way up.
 *
 * That is not a fact about U. The same collision waits for every
 * `Ctrl+Shift+<letter>` whose plain `Ctrl+<letter>` CM binds, which is most of
 * them once `Mod-z/y/u/a/d/f/g` and our emacs `Ctrl-a/e/k/y/b/f/n/p/d/h/o/t/v`
 * are counted, and the failure is silent. Taking the event on the way *down*
 * and stopping it is the fix that does not depend on picking a lucky letter.
 *
 * **Why U anyway.** Of the right-hand letters the author asked for, the browser
 * claims I and J (devtools), M (profiles), N (private window), O (bookmarks)
 * and P (print). U is free in Chrome, Edge and Firefox on Windows, which is all
 * that is left to check once the editor can no longer see it.
 *
 * On the document rather than in the editor's keymap: it is a page-wide
 * preference and the reader is usually in a pane, not in the editor, when they
 * want it.
 */
// Menu order, so the keystroke and the dropdown tell one story. `indexOf`
// returns -1 for a value outside the ring, which steps to the first entry: the
// seed comes from `localStorage` and an old or hand-edited key lands on static
// rather than nowhere.
const TABLE_VIEW_CYCLE = ['static', 'precise', 'interactive'];
function cycleTableView() {
    const at = TABLE_VIEW_CYCLE.indexOf(_tableView);
    setTableView(TABLE_VIEW_CYCLE[(at + 1) % TABLE_VIEW_CYCLE.length]);
}
document.addEventListener('keydown', (ev) => {
    if (!ev.ctrlKey || !ev.shiftKey || ev.altKey) return;
    // `ev.code`, not `ev.key`: with Shift held the key is 'U' on a US layout and
    // something else on others, where the physical key is the thing the author
    // asked for ("a letter you type with your right hand").
    if (ev.code !== 'KeyU') return;
    ev.preventDefault();
    ev.stopPropagation();
    cycleTableView();
}, true);       // capture: see above, the editor must never see this

/** Flip between the two business readings, the pair being only two. */
function togglePerspective() {
    setPerspective(_perspective === 'raw' ? 'insurer' : 'raw');
}

/**
 * Ctrl+Shift+V: flip the perspective, for the reason Ctrl+Shift+U flips the
 * table view.
 *
 * The second preference you change while reading rather than while deciding:
 * the raw frame and the business reading of one exhibit are the same numbers
 * asked two questions, and comparing them means going back and forth. The
 * header strip beside the versions says which one you are on, so the keystroke
 * and its readout arrived together.
 *
 * **Not taken inside an editable.** V is the one letter the browser itself
 * claims with Ctrl+Shift: it is paste-as-plain-text, and it means something in
 * the program box, in the Quick Re fields and in the pricing forms. So the
 * shortcut yields there and works everywhere else, which is where the reader is
 * standing when they want it, since this steers panes rather than the editor.
 * The `.cm-editor` test is what covers the program box, whose editable node is
 * a `contenteditable` div and not an input.
 *
 * Capture and `stopPropagation` for the same reason as U: CodeMirror drops the
 * Shift on a Ctrl+letter and would otherwise match its own `Mod-v` binding.
 */
function inEditable(node) {
    const el = node instanceof Element ? node : null;
    return !!el?.closest('input, textarea, select, [contenteditable="true"], .cm-editor');
}
document.addEventListener('keydown', (ev) => {
    if (!ev.ctrlKey || !ev.shiftKey || ev.altKey) return;
    if (ev.code !== 'KeyV') return;
    if (inEditable(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    togglePerspective();
}, true);

for (const item of document.querySelectorAll('[data-table-view]')) {
    item.addEventListener('click', () => setTableView(item.dataset.tableView));
}
for (const item of document.querySelectorAll('[data-perspective]')) {
    item.addEventListener('click', () => setPerspective(item.dataset.perspective));
}
syncPreferenceMenu();

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
    const wantStatic = isStatic(_tableView);

    const asGrid = (f, opts) => {
        if (!host.isConnected) return;   // the pane moved on while we waited
        host.className = 'grid-host';
        mountGrid(paneId, host, f, opts);
    };
    const unavailable = () => {
        if (!host.isConnected) return;
        host.className = '';
        empty(host);
        // No mention of a CSV download. Three of the exhibit-route panes have no
        // frame route behind them at all, so offering one was pointing at a way
        // out that does not exist for the reader most likely to be reading this.
        host.appendChild(el('div', { className: 'text-muted small fst-italic' },
            'This table could not be rendered.'));
    };

    if (!doc) {                          // bulk path, unchanged
        asGrid(frame, gridOpts);
        return;
    }
    // The adapter's formats and align come out of the document, so the grid
    // renders the same numbers the walker would. Caller options still win, since
    // a call site may know something the frame does not carry. Always the
    // *unmodified* document: the grid sorts and filters on the raw values and
    // formats them itself, so full precision is a static-view question only.
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
    const shown = _tableView === 'precise' ? atFullPrecision(doc) : doc;
    mountIrTable(paneId, host, shown).then((handle) => { if (!handle) toGrid(); });
}


// `renderOverviewExhibits` and `renderOneExhibit` came out at a68 with the two
// leaves they served. Between them they carried four literals: a title, a gloss
// and a caption for Summary and for Return periods, written here because the
// frame route ships a frame and nothing about it. The library publishes both as
// exhibits with their own captions, so those literals were the app's second
// opinion on a sentence it did not own, and one of them was wrong in a way
// nobody had noticed: the Return periods caption named 1-in-200 and 1-in-250 as
// the capital anchors, which is the library's own choice and is exactly the sort
// of fact that goes stale in a copy.

// ---- Overview: the landing group, three leaves ----
//
// The header block that used to stand above this row is gone at a120, and its
// history is worth a paragraph because it kept losing tenants. It opened as a
// two-deck heading carrying the name and the kind, which the status strip
// already says a couple of centimetres up the page, so those went at a48 and it
// became one quiet line of tags and the note. The note went to the strip at a119
// and the tags followed at a120, which left the block with nothing to draw and a
// `/meta` fetch to draw it with.
//
// Both fields ride on the build response now, so the strip has them without
// asking, and it is drawn under all six groups where this row was drawn under
// one. `GET /v1/objects/{id}/meta` is still a route, and still the place to ask
// for the program and its hints; nothing in the app asks it any more.

/**
 * Overview / Plot: the object's own picture, whichever chart that is.
 *
 * The app does not choose. `capability.primary_chart` names the chart the
 * library says is this object's own (an aggregate's two panels, a distortion's
 * unit square, a bivariate's joint grid), the document carries every semantic
 * decision in it, and `mountChart` realizes it. There is no fallback: a kind
 * the library publishes nothing for says so, rather than being approximated
 * from a frame.
 *
 * `mountChart` owns the box too: it draws the skeleton at the chart's final
 * size before fetching anything and awaits `loadStyle()` behind it.
 */
async function loadOverviewPlot() {
    if (overviewChart) { overviewChart.dispose(); overviewChart = null; }
    const pane = $('pane-overview');
    clearGrids('pane-overview');
    empty(pane);
    const chart = state.caps.primaryChart;
    if (!chart) { pane.appendChild(notDrawable()); return; }
    const host = el('div', { className: 'overview-plot' });
    pane.appendChild(host);
    // The chart is a bonus and the tables carry the story, so a failure never
    // throws out of here. It is still worth saying which failure it was: a
    // request that did not land is not the library declining to publish.
    let failed = false;
    try {
        overviewChart = await mountChart(host, { id: state.id, chart });
    } catch { failed = true; }
    if (!overviewChart) {
        pane.removeChild(host);
        pane.appendChild(failed ? fetchFailed() : notDrawable());
    }
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
 * The lede for a leaf: its label in bold, then what it declares it shows.
 *
 * `nav.js` has carried a `hint` on every leaf since a44, and `renderSubTabs`'s
 * own comment says it "moved into the exhibit lede". It did not: the only two
 * ledes on the page were hardcoded strings in `renderOverviewExhibits`, and
 * every other leaf's hint was written down and rendered nowhere. This is that
 * comment becoming true.
 *
 * One sentence saying what the table is, on the table rather than in the menu
 * above it. That is where it belongs for the same reason the Overview pair sit
 * there: a hint beside a sub-tab reads as a third kind of item inside the row.
 *
 * @returns {HTMLElement|null} the lede, or null for a leaf that declares none.
 */
function ledeFor(group, key) {
    const leaf = leafOf(group, key);
    if (!leaf?.hint) return null;
    const p = el('p', { className: 'exhibit-lede' }, el('b', {}, leaf.label));
    p.appendChild(document.createTextNode(`: ${leaf.hint}`));
    return p;
}

/**
 * One library exhibit in a pane, as its envelope.
 *
 * The generic leaf loader for Economics, More's Dependency and More's Tail
 * behavior. It takes the exhibit route rather than the frame route for two
 * reasons. Some of these exhibits have no frame behind them at all:
 * `economic_waterfall` and `dependency` are built by the library and reachable
 * only this way. And where both exist the envelope is the richer one, since the
 * library owns the business translation and ships each block with its own
 * caption.
 *
 * An exhibit is one or more blocks, each a table document, so a pane may hold
 * several tables. `economic_ratios` is the reason: its insurer framing splits
 * into pure-unit blocks rather than one frame with mixed measures.
 *
 * @param {[string, string]} leaf `[group, key]`, for the lede.
 * @param {number} [block] draw only this block of the exhibit, by index. For
 *   `reins`, whose two blocks are two different leaves of the Reinsurance
 *   group: the layering analysis is Stats and the per-stage cession impact is
 *   Summary. One envelope answers both, so a reader stepping between them pays
 *   one fetch and the second is a 304.
 * @param {function} [header] builds a node to sit above the lede, rebuilt on
 *   every draw. For a pane carrying a control of its own: Approximation's Plot
 *   / Summary switch is the only user. It has to be built inside `draw` rather
 *   than inserted afterwards, because `draw` re-runs on a perspective or
 *   static / interactive flip and would otherwise wipe the control that is
 *   sitting above the table it just redrew.
 */
async function loadExhibitLeaf(paneId, name, leaf, block = null, header = null) {
    const envelope = await api.exhibit(state.id, name, _perspective);
    const all = envelope.blocks || [];
    const blocks = block === null ? all : all.slice(block, block + 1);
    const draw = () => {
        // `.exhibit-blocks`, not `.overview-exhibits`: the blocks here have no
        // lede of their own between them, so the spacing has to come from the
        // container. Stacked flush, a two-block exhibit reads as one table that
        // changed its mind about its columns half way down.
        const root = el('div', { className: 'overview-exhibits exhibit-blocks' });
        replacePane(paneId, root);
        if (header) root.appendChild(header());
        const lede = leaf && ledeFor(leaf[0], leaf[1]);
        if (lede) root.appendChild(lede);
        if (!blocks.length) {
            root.appendChild(el('div', { className: 'text-muted small' },
                'Nothing to show for this object.'));
            return;
        }
        for (const block of blocks) {
            // The caption comes out of the document and is drawn by the page.
            //
            // It rides *inside* the block, so the walker printed it and the
            // interactive grid did not, and flipping the switch silently
            // dropped the library's own sentence about what the frame means.
            // That sentence is most of why the exhibit route exists, so it
            // belongs to the block rather than to one of its two renderings.
            // Lifted rather than copied, or the static view would show it twice.
            const { caption, ...doc } = block;
            const host = el('div');
            root.appendChild(host);
            mountTable(paneId, host, { doc }, GRID_FULL);
            if (caption) {
                root.appendChild(el('div', { className: 'exhibit-caption' }, caption));
            }
        }
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

/**
 * Dispose the ECharts instance a pane is holding, if it is holding one.
 *
 * Charts are tracked here rather than in the grid registry (they are not
 * `destroy()`ables), so emptying a pane leaves its instance alive over a
 * detached canvas, and a live ResizeObserver with it. Each chart loader already
 * disposed its own
 * before drawing, which covered plot-to-plot and missed plot-to-table. That gap
 * mattered for one leaf before a68 and for four after it, so the disposal moved
 * to the one place every pane replacement goes through.
 */
function disposePaneChart(paneId) {
    if (paneId === 'pane-overview' && overviewChart) {
        overviewChart.dispose(); overviewChart = null;
    } else if (paneId === 'pane-reinsurance' && reinsChart) {
        reinsChart.dispose(); reinsChart = null;
    } else if (paneId === 'pane-bounds' && boundsChart) {
        boundsChart.dispose(); boundsChart = null;
    } else if (paneId === 'pane-kappa' && kappaChart) {
        kappaChart.dispose(); kappaChart = null;
    } else if (paneId === 'pane-ruin' && ruinChart) {
        ruinChart.dispose(); ruinChart = null;
    } else if (paneId === 'pane-more' && moreChart) {
        moreChart.dispose(); moreChart = null;
    }
}

function replacePane(paneId, node) {
    clearGrids(paneId);          // tear down any CsvGrid that lived here
    disposePaneChart(paneId);    // and any chart, for the same reason
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
async function replacePaneTable(paneId, which, opts = GRID_FULL, bulk = null,
                                leaf = null) {
    let source = null;
    if (!bulk) {
        const doc = await frameDoc(which).catch(() => null);
        if (doc && !docTruncated(doc)) source = { doc };
    }
    if (!source) {
        const fetchFrame = bulk || (() => api.frameOf(state.id, which));
        source = { frame: await fetchFrame() };
    }
    const draw = () => {
        const root = el('div');
        const lede = leaf && ledeFor(leaf[0], leaf[1]);
        if (lede) root.appendChild(lede);
        const host = el('div');
        root.appendChild(host);
        replacePane(paneId, root);        // tears down the previous mode first
        mountTable(paneId, host, source, opts);
        // Re-register against the node just created, not against the pane. The
        // pane outlives everything, so a listener keyed on it would survive a
        // rebuild and redraw the *previous* object's frame on the next flip.
        // This node is dropped by `clearPanes`, and a disconnected node is what
        // prunes the listener.
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

/**
 * An error as a node, for a pane.
 *
 * `errorMessage` is the sentence inside it and lives in `api.js` since a100,
 * beside the class it reads: the pricing form prints the message rather than
 * mounting a node, because a library refusal is written to be read and the
 * reader should meet it in the line under the form they are typing in.
 */
function errorNode(err) {
    if (err instanceof ApiError && err.status === 429) return renderRateLimit(err.retryAfter);
    return el('div', { className: 'text-muted small' }, errorMessage(err));
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
 * Reinsurance / Plot: the occurrence program, per claim and in total.
 *
 * The document's own two panels, and they answer two different questions:
 * what the treaty does to a single claim, and what that does to the year. They
 * share no axis, because a per-claim loss and an annual aggregate are not the
 * same quantity and one window over both would say they were.
 *
 * A chart leaf, so the pill lights from `available_charts`, behind the
 * library's own cession predicate. Dark on a reinsured *portfolio* on purpose:
 * `chart_reins` is registered for `Aggregate` alone (see `nav.js`).
 */
async function loadReinsPlot() {
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    const pane = $('pane-reinsurance');
    clearGrids('pane-reinsurance');
    empty(pane);
    const host = el('div', { className: 'overview-plot' });
    pane.appendChild(host);
    // As in the Overview: a bonus, and the frames carry the numbers, but a
    // fetch that failed says so in its own words.
    let failed = false;
    try {
        reinsChart = await mountChart(host, { id: state.id, chart: 'reins' });
    } catch { failed = true; }
    if (!reinsChart) {
        empty(pane);
        pane.appendChild(failed ? fetchFailed() : notDrawable());
    }
}

/**
 * The cession entry box: derive, fill the editor, build, in one step.
 *
 * A derivation like Sharpen and PnL, and it goes through the same machinery, so
 * `Ctrl+↑` walks back to the gross program with no undo of its own here. (That
 * used to read "Reset on the action row", a button removed at a58 for exactly
 * this reason: history already did its job, better.) Shown only where a cession
 * can be added, which is an aggregate; the
 * group stays live for one carrying no cession yet, since that is exactly the
 * object you want this for.
 */
function renderReinsEntry() {
    const box = $('reins-entry');
    if (!box) return;
    // Greyed, not hidden, which is the same house rule the sub-tabs and the
    // calibration row keep: a control the object cannot use stays on the page
    // and says why. It used to be `d-none`, so on a portfolio or a P&L the tab
    // simply had nothing in it and the reader had no way to learn that ceding
    // is an aggregate's affair.
    const off = !can('canReins');
    const why = 'a cession applies to an aggregate';
    box.classList.toggle('is-off', off);
    for (const control of box.querySelectorAll('input, button')) {
        control.disabled = off;
        // The help button owns its own `title`, which is its tooltip, so it is
        // exempt: overwriting it would trade the explanation for the reason the
        // row is grey, and the row already says that underneath.
        if (control.id === 'qr-help') continue;
        if (off) control.setAttribute('title', why);
        else control.removeAttribute('title');
    }
    const hint = box.querySelector('.reins-entry-hint');
    if (hint) hint.classList.toggle('d-none', off);
    let note = box.querySelector('.reins-entry-off');
    if (off && !note) {
        note = el('p', { className: 'reins-entry-hint reins-entry-off' }, why);
        box.appendChild(note);
    } else if (!off && note) {
        note.remove();
    }
    // The preview reads the object, so it is redrawn whenever the object moves.
    // This runs on every adopted build (through `applyCapability`), which is
    // also what makes the row show its defaults resolved against the new book
    // rather than the previous one's quantiles.
    renderCessionPreview();
}

const reinsBtn = $('reins-btn');

// ----------------------------------------------------------------------
// Quick Re: one row, one layer, straight into the editor
// ----------------------------------------------------------------------
//
// Three boxes, a tier switch and a button. There is no text box holding the
// clause, and its removal is the point of a68: through a67 this row wrote a
// clause into a local input which was then ceded, so the same string was
// carried twice before anything happened. Now Add re composes and cedes, and
// the program that comes back is where the clause is read and edited. The
// editor upstairs is that box, and it has real completion.
//
// The clause is still shown before it is applied, in the preview line under the
// row, which is what the local box was actually providing.

const QR_FIELDS = ['qr-share', 'qr-attach', 'qr-detach'];
const QR_DEFAULTS = { 'qr-share': '100%', 'qr-attach': '50%', 'qr-detach': '95%' };

/**
 * Read one field of the row: a probability, or an amount.
 *
 * The row's whole trick, and the reason attach and detach each need one input
 * rather than a pair. `50%` is a probability and `500` is currency, so there is
 * no mode to be in and no second set of boxes to keep in step with the first.
 *
 * @returns {{kind: 'p'|'amount', value: number} | null} null when empty or
 *   unreadable, which the caller reports rather than guessing at.
 */
function readLayerField(text) {
    const s = String(text || '').trim().replace(/,/g, '');
    if (!s) return null;
    const pct = s.endsWith('%');
    const n = Number.parseFloat(pct ? s.slice(0, -1) : s);
    if (!Number.isFinite(n)) return null;
    if (pct) {
        const p = n / 100;
        return p > 0 && p < 1 ? { kind: 'p', value: p } : null;
    }
    return n > 0 ? { kind: 'amount', value: n } : null;
}

/** Trim a number for a program someone will read: no trailing `.0`. */
function layerNumber(v) {
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

/** Which tier the segmented control is on. */
function qrBasis() {
    return $('qr-basis-agg')?.checked ? 'aggregate' : 'occurrence';
}

/**
 * `q(p)` already asked for, keyed by object and probability.
 *
 * The preview recomposes on every settled keystroke and a probability costs a
 * round trip, so without this, typing `95%` one character at a time asks the
 * server for `q(.9)` and then `q(.95)` and then asks again for both the moment
 * anything else in the row moves. Keyed by object id, so it cannot serve one
 * book's quantile for another; never invalidated within an id, because an id is
 * a hash of the program and the same program has the same quantiles.
 */
const _quantileCache = new Map();

/**
 * Turn the row into a DecL cession clause.
 *
 * Resolves each field on its own, so mixing is legal and needs no special case:
 * `attach 50% detach 1000000` is a currency detachment over a median attachment.
 *
 * **The third box is a DETACHMENT, in both readings**, which is the author's
 * ruling of 2026-08-09 and the reason it is no longer called a limit. `95%` is
 * `q(.95)` and `1000` is 1000; either way it names a point on the loss axis and
 * the width follows as `detach - attach`. Through a67 a percentage was a
 * detachment probability and a bare number was a width, so one box meant two
 * different things depending on how it was typed.
 *
 * The **share** box takes the same dual reading, and both readings now emit
 * `po`: `50% po 5000 xs 2500` is half the layer and `2500 po 5000 xs 2500` is
 * an absolute amount of it, the share following as `amount / limit`. The `%` is
 * the whole difference, which is why the box can keep taking either. A
 * whole-layer share emits no head at all, since `100% po` is a clause saying
 * nothing.
 *
 * **`po` is the only placement keyword left.** `so` (share of) and `of` were
 * retired upstream at `aggregate` 1.0.0a249, which computed the identical tuple
 * for all three: `so` is an ordinary English word and a poor reserved word, and
 * `of` forked the Earley parse against the `net of` in front of it. This row
 * went on writing `so` over a percentage until a93, so every Quick Re add with
 * a share in the box came back a parse error. Emitting the percentage literal
 * is what carries the share reading now; do not "simplify" it to the fraction,
 * which the grammar would read as an amount.
 *
 * The label on the row says `part of` in both cases and does not track the
 * token. That is the author's ruling, not drift: one fixed English phrase reads
 * better than a two-letter token, and the preview line below the row is where
 * the clause itself is shown.
 *
 * @returns {Promise<string>} `occurrence net of 5000 xs 2500`, ready to cede.
 */
async function composeCession() {
    const attach = readLayerField($('qr-attach').value);
    const detach = readLayerField($('qr-detach').value);
    if (!attach || !detach) throw new Error('attach and detach are both needed');
    const share = readLayerField($('qr-share').value);
    const basis = qrBasis();

    // **On the tier's own distribution.** An occurrence cession applies to one
    // claim and an aggregate cession to the year, so a percentage means a
    // different number on each. Read both off the annual law and the occurrence
    // defaults write a treaty that can never attach: see the route's own note.
    const key = (p) => `${state.id}:${basis}:${p}`;
    const wanted = [attach, detach]
        .filter((f) => f.kind === 'p')
        .map((f) => f.value)
        .filter((p) => !_quantileCache.has(key(p)));
    if (wanted.length) {
        const { quantiles } = await api.quantiles(state.id, wanted, basis);
        for (const row of quantiles) {
            _quantileCache.set(key(row.p), row.snapped);
        }
    }
    const resolve = (f) => (f.kind === 'p' ? _quantileCache.get(key(f.value)) : f.value);

    const attachAmount = resolve(attach);
    const detachAmount = resolve(detach);
    if (!(detachAmount > attachAmount)) {
        throw new Error('the detachment has to sit above the attachment');
    }
    const layer = `${layerNumber(detachAmount - attachAmount)} xs `
        + `${layerNumber(attachAmount)}`;

    let head = '';
    if (share && share.kind === 'p' && Math.abs(share.value - 1) > 1e-9) {
        // The percentage as written, because the `%` is what tells the grammar
        // this is a share and not an amount of cover.
        head = `${layerNumber(share.value * 100)}% po `;
    } else if (share && share.kind === 'amount') {
        head = `${layerNumber(share.value)} po `;
    }
    return `${basis} net of ${head}${layer}`;
}

/**
 * The clause this row would write, under the row, kept current as you type.
 *
 * Debounced, because a percentage costs a quantile lookup and a keystroke is
 * not a question. Populated from the defaults before anything is touched, so
 * the row explains itself without being used first, which is the author's
 * "initially: preview the default values".
 *
 * Reports the composer's own complaint on a bad field rather than going blank:
 * "the detachment has to sit above the attachment" is the whole message, and it
 * belongs where the reader is looking rather than after they press the button.
 *
 * Guarded against the answer arriving out of order. A quantile lookup is a
 * round trip and the boxes can move while it is in flight, so each run takes a
 * ticket and a stale one throws its answer away instead of overwriting a newer
 * reading with an older one.
 *
 * **Dimmed while a lookup is in flight**, rather than blanked. A round trip on
 * an unseen probability is long enough to read, and a preview still showing the
 * *previous* clause while the boxes say something else is the same kind of lie
 * this whole round has been about. Dimming keeps the last good reading on screen
 * and says it is not current yet; blanking would make the line flicker on every
 * keystroke. Cached probabilities resolve without a round trip and never dim.
 */
let _previewTicket = 0;
async function renderCessionPreview() {
    const node = $('qr-preview');
    if (!node) return;
    if (!state.id || !can('canReins')) {
        node.textContent = '';
        node.classList.remove('is-pending');
        return;
    }
    const ticket = ++_previewTicket;
    const pending = setTimeout(() => {
        if (ticket === _previewTicket) node.classList.add('is-pending');
    }, 120);
    const settle = (text) => {
        clearTimeout(pending);
        if (ticket !== _previewTicket) return;
        node.textContent = text;
        node.classList.remove('is-pending');
    };
    try {
        settle(`Preview: ${await composeCession()}`);
    } catch (err) {
        settle(err.message);
    }
}

const previewSoon = debounce(renderCessionPreview, 350);

for (const id of QR_FIELDS) {
    $(id)?.addEventListener('input', previewSoon);
}
for (const id of ['qr-basis-occ', 'qr-basis-agg']) {
    // The tier switch changes only the first word, so it redraws at once rather
    // than through the debounce that exists to absorb typing.
    $(id)?.addEventListener('change', renderCessionPreview);
}

/**
 * Put the row back to its defaults, because the program it described has gone.
 *
 * Called where the editor's text is *replaced* by another program, never on a
 * rebuild of the same one: ceding is iterative, and a row that reset itself
 * every time you pressed Build would make each retry a retype. An attachment in
 * currency means nothing on a different book, and one in probability means
 * something different, which is worse, so both go back to the defaults.
 */
function clearCessionDraft() {
    for (const id of QR_FIELDS) {
        const node = $(id);
        if (node) node.value = QR_DEFAULTS[id];
    }
    renderCessionPreview();
}

/** Compose the clause and cede it, in one press. */
async function cede() {
    if (!state.id || !can('canReins') || reinsBtn.hasAttribute('disabled')) return;
    let cession;
    try {
        cession = await composeCession();
    } catch (err) {
        const node = $('qr-preview');
        if (node) node.textContent = err.message;
        return;
    }
    await runDerivation(reinsBtn, 'Ceding…', (id) => api.reins(id, cession),
        'reinsurance');
    renderCessionPreview();
}

reinsBtn?.addEventListener('click', cede);

// Enter anywhere in the row cedes, which is the shortcut the text box used to
// carry and the one thing about it worth keeping.
for (const id of QR_FIELDS) {
    $(id)?.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        cede();
    });
}

// The help tooltip. Bootstrap tooltips are opt-in per element, and this is the
// only one on the page, so it is initialized here rather than by a sweep.
if ($('qr-help')) bootstrap.Tooltip.getOrCreateInstance($('qr-help'));

/**
 * Reinsurance / Density: the one leaf here still on the frame route.
 *
 * The bulk path, permanently. `reins_density_df` is thousands of rows even
 * binned to the display grid, so it never becomes a document, exactly as More /
 * Density never does. The plot leaf is what wants every point.
 *
 * It was Summary's loader too until a70, and Summary is on the exhibit route
 * now. See `loadReinsExhibit`.
 */
async function loadReinsFrame(which, leaf = null) {
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    const bulk = () => api.frameOf(state.id, which, { resolution: 'display' });
    await replacePaneTable('pane-reinsurance', which,
        { ...GRID_FULL, renderCap: 8192 }, bulk, leaf);
}

/**
 * One block of the `reins` exhibit in the Reinsurance pane.
 *
 * The chart disposal is why this exists rather than `loadExhibitLeaf` being
 * called directly from `LOADERS`: every loader in this group has to drop the
 * ECharts instance the plot leaf may have left, and doing it in the shared
 * loader would put a Reinsurance concern in the generic path. `replacePane`
 * disposes as well, since a68, so this is belt and braces on the one group
 * whose leaves alternate between a chart and a table.
 */
async function loadReinsExhibit(block, leaf) {
    if (reinsChart) { reinsChart.dispose(); reinsChart = null; }
    await loadExhibitLeaf('pane-reinsurance', 'reins', leaf, block);
}

// `loadReinsStats` came out at a71 with the transpose it existed to draw. It
// fetched `reins_stats_terms` and `reins_stats_moments`, two frames the *api*
// made by turning the library's layering analysis on its side and splitting it,
// and it wrote a title and a gloss for each. The library serves that analysis
// as the `reins` exhibit's first block with its own caption, so all of that was
// this repo's second opinion on a table it does not own. If the orientation is
// wrong, it is wrong in the library.

// ----------------------------------------------------------------------
// More / Approximation: one story, two readings
// ----------------------------------------------------------------------
//
// The method-of-moments story, as two pictures and a table. The `approximation`
// chart draws the realized mass with the five fitted families over it; the
// `approximation_tails` chart (library a344) is the exceedance picture the
// first chart dropped at a337, the per-family survival curves with the
// sub-exponential implied tail, split off purely for payload size; and the
// exhibit serves `approximation_df`, the fitted DecL fragments, their achieved
// moments with the Kolmogorov distance, and the quantiles on the return period
// ladder, every column read against `exact`.
//
// **Why the switch is inside the pane rather than two leaves in the More row.**
// The navigation is two levels, groups and then each group's sub-tab row, and
// `dev/scripts/check-nav.mjs` asserts that shape, so a third level has to live
// in the pane. It is also the better reading: these are two views of one
// question, so they keep one address, and the More row stays at seven pills
// instead of growing an `Approx plot` and an `Approx summary` that would sort
// apart from each other the moment another leaf lands between them.
//
// **Why the halves gate differently.** The leaf lights from the exhibit,
// which the library registers for an updated Aggregate or Portfolio. Both
// charts it registers for an Aggregate alone, because the implied tail
// `E[N] * S_X(x)` needs a single severity and a book has one per unit. So a
// portfolio opens on Summary with both plot pills greyed and saying why,
// which is the same shape as Reinsurance Plot on a reinsured portfolio, and
// greyed rather than hidden per the house rule.

/** The three readings, in the order they are always drawn. */
const APPROXIMATION_HALVES = [
    ['plot', 'Plot'], ['tails', 'Plot tail'], ['summary', 'Summary']];

/**
 * Which chart each plot reading draws. Two documents rather than one panel
 * pair since library a337/a344, purely for payload size: the body and the
 * exceedance picture each travel alone. That may fold back later; nothing
 * here would change except this map losing a row.
 */
const APPROXIMATION_CHART = { plot: 'approximation', tails: 'approximation_tails' };

/** What a greyed plot pill says on hover; both charts share the predicate. */
const APPROXIMATION_NO_PLOT =
    'the implied tail needs a single severity, so an aggregate only';

// Which half the reader last chose. Per session and not persisted, like the
// perspective flip's in-pane state and unlike the chart readings: it is a
// position within one pane, not a preference about how anything is drawn.
let _approximationHalf = 'plot';

/** Does the library publish this half's chart for the object in front of us? */
function approximationCanPlot(half) {
    const chart = APPROXIMATION_CHART[half];
    return Boolean(chart) && state.caps.charts.has(chart);
}

/**
 * The half to draw: the one chosen, unless it cannot answer for this object.
 *
 * Plot leads wherever it is live, which is the author's ruling and matches
 * Overview and Reinsurance, where the picture is the first pill too. The
 * fallback is what makes a portfolio open on Summary without the pill order
 * changing under a reader stepping between objects.
 */
function approximationHalf() {
    if (APPROXIMATION_CHART[_approximationHalf]
        && !approximationCanPlot(_approximationHalf)) return 'summary';
    return _approximationHalf;
}

/**
 * The Plot / Summary switch, as a segmented control.
 *
 * `aria-disabled` and `data-why` rather than `disabled` on the dead pill, which
 * is the same choice `renderSubTabs` makes and for the same two reasons: a
 * `disabled` button suppresses the tooltip in Chrome, and it emits no pointer
 * events, so the delegated `data-why` footnote in `utils/tip.js` would never
 * see it. The click is refused by simply not binding one.
 *
 * @returns {HTMLElement} the control row, rebuilt on every draw.
 */
function approximationStrip() {
    const row = el('div', { className: 'tab-tools' });
    const group = el('div', { className: 'btn-group btn-group-sm', role: 'group' });
    group.setAttribute('aria-label', 'approximation reading');
    const active = approximationHalf();
    for (const [value, label] of APPROXIMATION_HALVES) {
        const off = Boolean(APPROXIMATION_CHART[value])
            && !approximationCanPlot(value);
        const button = el('button', {
            type: 'button',
            className: 'btn btn-outline-secondary'
                + (value === active ? ' active' : ''),
        }, label);
        button.setAttribute('aria-pressed', String(value === active));
        if (off) {
            button.setAttribute('aria-disabled', 'true');
            button.setAttribute('data-why', APPROXIMATION_NO_PLOT);
            button.setAttribute('aria-label', `${label}, ${APPROXIMATION_NO_PLOT}`);
        } else {
            button.addEventListener('click', () => {
                if (value === approximationHalf()) return;
                _approximationHalf = value;
                // The scroll rule: an in-pane view pill is navigation.
                anchorNavSettled(paneOf('more'), loadApproximation());
            });
        }
        group.appendChild(button);
    }
    row.appendChild(group);
    return row;
}

/**
 * More / Approximation: the switch, and whichever half it is set to.
 *
 * Summary is the ordinary exhibit path with the switch passed as its header, so
 * the greater-tables walker, the library's caption, the perspective flip and
 * the CSV export all arrive with nothing written here. `tables.FORMATS` stays
 * empty: the frame carries its own readings and the family columns sit under a
 * named column axis, which the library's format sweep already treats as data.
 *
 * Plot is the `loadReinsPlot` shape, with one difference. That one empties the
 * whole pane when the chart cannot be drawn; this replaces the host only, so
 * the switch survives and a reader who cannot have the picture can still reach
 * the table from where they are standing.
 */
async function loadApproximation() {
    const half = approximationHalf();
    if (half === 'summary') {
        await loadExhibitLeaf('pane-more', 'approximation',
                              ['more', 'approximation'], null, approximationStrip);
        return;
    }
    const root = el('div');
    root.appendChild(approximationStrip());
    const lede = ledeFor('more', 'approximation');
    if (lede) root.appendChild(lede);
    // `plot-half` caps the host at half the pane, so a one-panel document
    // draws at the geometry one panel of the two-panel density chart gets:
    // these two documents are one split picture, and each half should read
    // at the size it had when they traveled together.
    const host = el('div', { className: 'overview-plot plot-half' });
    root.appendChild(host);
    // Before the mount, so `disposePaneChart` drops any instance the previous
    // visit left rather than this assigning over it.
    replacePane('pane-more', root);
    let failed = false;
    try {
        moreChart = await mountChart(host,
                                     { id: state.id, chart: APPROXIMATION_CHART[half] });
    } catch { failed = true; }
    if (!moreChart) {
        empty(host);
        host.appendChild(failed ? fetchFailed() : notDrawable());
    }
}

// ----------------------------------------------------------------------
// Pricing: Calibrate, Stand-alone, Allocate, Plot and Evaluate
// ----------------------------------------------------------------------
// Every table on this pane is a library exhibit. `calibrate_distortions` and
// `evaluate` return result objects, the library registers `pricing.calibrate`,
// `pricing.stand_alone`, `pricing.allocate` and `pricing.evaluate` on those,
// and the api serves the envelopes. So this file holds no title, no caption, no
// format and no arithmetic about a price: it posts a form and draws a document,
// which is what the other twelve table leaves have done since a71.
//
// The last of that assembly, in this file and in the api's `pricing.py`, goes at
// a85. See `dev/plan-pricing-exhibits.md`.
//
// The row became five at a104, and the middle three are the shape of the
// argument. Stand-alone prices each part as a distribution in its own right and
// sets the sum against the whole, which is the diversification reading.
// Allocate takes one calibrated premium and splits it across the same parts so
// they foot exactly, which is the consistency reading. Plot draws the kappa
// curves the split is made of. See `dev/plan-pricing-natural-allocation.md`.

/**
 * The last answer from each of the pricing POSTs, held so a leaf never
 * computes on activation.
 *
 * Both perspectives ride in each response, which is what makes the RAW /
 * INSURER toggle a redraw rather than a recalculation: `refetchTables` clears
 * every pane and reloads the group, and the loader here paints from these
 * rather than asking the server for a calibration it has already made.
 *
 * Dropped when the **object** changes, not when a pane is cleared. Those are
 * different events, and clearing on the second would blank the pane on every
 * flip of the perspective, which is the thing holding them is for.
 */
let _calibration = null;
let _allocation = null;
let _evaluation = null;
// The Pr Ruin response, chart document and exhibit envelopes together, plus
// the seed the last Sample rolled: held so typing after a Sample re-prices the
// same drawn skeleton rather than silently swapping the picture underfoot.
let _ruin = null;
let _ruinSeed = null;

/**
 * The pricing every pane is currently talking about.
 *
 * `{octet, anchor, target, basis}`: the completed pentagon the server sent, plus
 * the question that produced it, so a leaf can reopen showing the cost of
 * capital that was calibrated and not only the premium it resolved to.
 *
 * Written by a Calibrate press, by an Evaluate press and by a Bounds compute.
 * Last write wins, because there is one current pricing rather than several
 * boxes with private histories: an ad hoc premium tried on Evaluate is the
 * premium Bounds then sweeps, which is what that leaf is for.
 *
 * `octet.premium` is a **technical** premium. Economics reads a booked one, the
 * two differ by the expense clause, and the library owns the identity between
 * them, so nothing here should start calling either of them just "premium".
 */
let _pricing = null;

function forgetPricing() {
    _calibration = null;
    _allocation = null;
    _evaluation = null;
    _ruin = null;
    _ruinSeed = null;
    // The pricing goes with them. It was struck on the previous object, and
    // left in the boxes it would be relabeled as this one's by the basis row
    // beside it, which is worse than an empty field.
    _pricing = null;
}

/** Which wrapper each leaf lives in; the others are hidden on arrival. */
const PRICING_WRAPPER = {
    calibrate: 'leaf-price', standalone: 'leaf-price',
    allocate: 'leaf-allocate', plot: 'leaf-kappa', evaluate: 'leaf-evaluate',
    ruin: 'leaf-ruin',
};

/**
 * Pricing: reveal one leaf, and draw what is held for it.
 *
 * Calibrate and Stand-alone share a form and a press, so they share the wrapper
 * and differ only in which pane inside it is visible. Allocate is a second
 * press with a form of its own, Evaluate a third, and Plot has no form at all.
 *
 * **Nothing computes here, except on Plot.** Pricing, allocation and evaluation
 * are all work behind a button, and a leaf that ran on arrival would spend it
 * every time you passed through, so those panes stay as the last press left
 * them. Plot is a chart leaf like every other chart leaf: it asks the object a
 * question that no form qualifies, so there is nothing for a button to add, and
 * the ETag on `doc_hash` makes a second visit free.
 */
async function showPricingLeaf(which) {
    const showing = PRICING_WRAPPER[which];
    for (const wrapper of new Set(Object.values(PRICING_WRAPPER))) {
        $(wrapper).classList.toggle('d-none', wrapper !== showing);
    }
    $('pane-calibrate').classList.toggle('d-none', which !== 'calibrate');
    $('pane-standalone').classList.toggle('d-none', which !== 'standalone');
    if (which === 'evaluate') {
        syncEvaluateForm();
        drawPricingPane('evaluate');
    } else if (which === 'ruin') {
        await showRuinLeaf();
    } else if (which === 'plot') {
        await loadKappaPlot();
    } else if (which === 'allocate') {
        allocateForm.write(_pricing);
        drawPricingPane(which);
    } else {
        priceForm.write(_pricing);
        drawPricingPane(which);
    }
}

/** Which exhibit each table leaf draws, out of which held response. */
const PRICING_LEAF = {
    calibrate: ['pane-calibrate', 'pricing.calibrate', () => _calibration,
                'Calibrate'],
    standalone: ['pane-standalone', 'pricing.stand_alone', () => _calibration,
                 'Calibrate'],
    allocate: ['pane-allocate', 'pricing.allocate', () => _allocation,
               'Allocate'],
    evaluate: ['pane-evaluate', 'pricing.evaluate', () => _evaluation,
               'Evaluate'],
    ruin: ['pane-ruin-stats', 'ruin', () => _ruin, 'Draw'],
};

/**
 * Draw one Pricing leaf from the response already in hand.
 *
 * Shaped like `loadExhibitLeaf`, and deliberately: blocks in order, the caption
 * lifted out of each block and drawn under its table, then whatever the library
 * said on the way. The only difference is where the envelope came from, which is
 * a POST carrying a form's answer rather than a GET on the object.
 */
function drawPricingPane(which) {
    const [paneId, name, held, button] = PRICING_LEAF[which];
    const payload = held();
    const views = payload?.exhibits?.[name] || null;
    // The perspective the reader has chosen, out of the pair the response
    // carries. `insurer` as the fallback matches the app's own default.
    const envelope = views ? (views[_perspective] || views.insurer) : null;
    const draw = () => {
        const root = el('div', { className: 'overview-exhibits exhibit-blocks' });
        replacePane(paneId, root);
        const lede = ledeFor('pricing', which);
        if (lede) root.appendChild(lede);
        if (!envelope) {
            root.appendChild(el('div', { className: 'text-muted small' },
                `Press ${button}.`));
            onTableViewChange(paneId, draw, root);
            return;
        }
        for (const block of envelope.blocks || []) {
            // The caption rides inside the block, so it is lifted out and drawn
            // by the page: the walker prints one and the interactive grid does
            // not, and the library's own sentence about what a frame means must
            // not depend on which renderer is switched on.
            const { caption, ...doc } = block;
            const host = el('div');
            root.appendChild(host);
            mountTable(paneId, host, { doc }, GRID_FULL);
            if (caption) {
                root.appendChild(el('div', { className: 'exhibit-caption' }, caption));
            }
        }
        // A distortion the library declined to allocate, most often the mass
        // distortion on an unbounded book. The rows that answered are above;
        // this says which family is not among them, and why.
        for (const warning of payload.warnings || []) {
            root.appendChild(el('div', { className: 'text-muted small fst-italic mt-1' },
                `⚠ ${warning}`));
        }
        onTableViewChange(paneId, draw, root);
    };
    draw();
}

// ---- The five forms ----
//
// One component, five mounts. `pricing-form.js` holds the anchor, the target,
// the basis group and the preview line; this file says what each leaf does with
// the body it reads. Through a99 there were four hand maintained copies of that
// row, two of them spelling the same pentagon in a different vocabulary.

/** What the forms need to know about the object now on screen. */
const formContext = () => ({
    id: state.id,
    kind: state.kind,
    bases: state.caps.flags.reinsBases || [],
    canPreview: can('canPrice'),
});

/**
 * Remember what a press was struck at, so the next leaf opens on it.
 *
 * The octet is the server's, verbatim. `anchor` and `target` are the question
 * that produced it, which is what lets a leaf reopen showing the cost of
 * capital that was calibrated rather than only the premium it resolved to.
 * `basis` rides along so 6.3's refusal can tell whether the pricing belongs to
 * the distribution the reader is now looking at.
 */
function holdPricing(body, octet) {
    if (!octet) return;
    _pricing = {
        octet,
        anchor: 'a' in body ? 'a' : 'p',
        target: 'premium' in body ? 'premium' : ('lr' in body ? 'lr' : 'coc'),
        basis: body.basis || null,
    };
}

/**
 * Which of the Calibrate press's own two panes is on screen.
 *
 * Not `activeLeaf('pricing')`, which since a104 can answer `allocate` or
 * `plot`: neither is this press's to fill, and `plot` has no entry in
 * `PRICING_LEAF` at all, so handing it over threw where a pane should have been
 * drawn. The press fills two panes and names them itself.
 */
const calibratedLeaf = () => (
    activeLeaf('pricing') === 'standalone' ? 'standalone' : 'calibrate');

const priceForm = createPricingForm($('price-form'), {
    verb: 'Calibrate',
    basisLabel: 'calibrate on',
    preview: true,
    context: formContext,
    onSubmit: async (body) => {
        if (!state.id) return;
        priceForm.setBusy(true, 'Calibrating…');
        try {
            _calibration = await api.pricingCalibrate(state.id, body);
            holdPricing(body, priceForm.held());
            // One press, two panes. Only the visible one is drawn: a CsvGrid
            // measures itself as it mounts, and mounting one inside a `d-none`
            // wrapper measures nothing. The other leaf redraws from the same
            // held response the moment it is shown, which costs no request.
            drawPricingPane(calibratedLeaf());
        } catch (err) {
            _calibration = null;
            replacePane(calibratedLeaf() === 'standalone'
                ? 'pane-standalone' : 'pane-calibrate', errorNode(err));
        } finally {
            priceForm.setBusy(false);
        }
    },
});

/**
 * The Allocate leaf's basis row: one live button, and the rest drawn dark.
 *
 * The narrowing is structural rather than a preference. A natural allocation
 * splits a *gross* premium into its ceded and net parts, so a fit struck on net
 * has nothing to split; a book takes net alone, because reinsurance is placed at
 * the unit level and it has no cession of its own to choose. Both are what the
 * route enforces, so the form refuses to send what the route would refuse to
 * take, and says why on hover rather than after a press.
 */
const allocateBases = (bases, kind) => (
    kind === 'port' ? bases : bases.filter((basis) => basis === 'gross'));

const allocateForm = createPricingForm($('allocate-form'), {
    verb: 'Allocate',
    basisLabel: 'allocate on',
    preview: true,
    basisOnly: allocateBases,
    basisWhy: 'net and ceded are this tab’s outputs, not its inputs',
    context: formContext,
    onSubmit: async (body) => {
        if (!state.id) return;
        allocateForm.setBusy(true, 'Allocating…');
        try {
            _allocation = await api.pricingAllocate(state.id, body);
            // The shared pentagon moves, as it does on every other press. The
            // held *calibration* does not: writing another leaf's state from a
            // side effect here is how a pane drifts out of sync with its own
            // button, and Stand-alone would then show numbers no press of its
            // own produced.
            holdPricing(body, allocateForm.held());
            drawPricingPane('allocate');
        } catch (err) {
            _allocation = null;
            replacePane('pane-allocate', errorNode(err));
        } finally {
            allocateForm.setBusy(false);
        }
    },
});

/**
 * The Pricing group's Plot leaf: the kappa curves behind the allocation.
 *
 * A chart leaf, so the pill lights from `available_charts` and this draws
 * whatever the library registered under `kappa` for the object in hand: the
 * per-unit curves for a book, the two-panel band chart for an occurrence
 * program. The app knows neither, which is the point of gating on the name.
 *
 * The one pricing leaf that fetches on activation, and the only one that can:
 * a kappa curve conditions on an outcome rather than on a distortion, so no
 * form qualifies it and there is nothing for a button to add.
 */
async function loadKappaPlot() {
    if (kappaChart) { kappaChart.dispose(); kappaChart = null; }
    const pane = $('pane-kappa');
    clearGrids('pane-kappa');
    empty(pane);
    const host = el('div', { className: 'overview-plot' });
    pane.appendChild(host);
    let failed = false;
    try {
        kappaChart = await mountChart(host, { id: state.id, chart: 'kappa' });
    } catch { failed = true; }
    if (!kappaChart) {
        empty(pane);
        pane.appendChild(failed ? fetchFailed() : notDrawable());
    }
}

// ----------------------------------------------------------------------
// Pricing / Pr Ruin: the probability of eventual default
// ----------------------------------------------------------------------
// A teaching pane, not a pricing tool. The premium half of the form is the
// shared pricing component, verbatim; the capital half is one box stating a
// probability of eventual default, which the library resolves to an initial
// surplus through the ruin function's capital lookup. Every change feeds one
// debounced POST that answers with the two-panel chart document and the
// `ruin` exhibit envelopes together; the app draws both and labels the boxes
// from the document's `meta`, so nothing about ruin is computed here.
//
// Two buttons, two actions, per the house rule that nothing changes meaning
// with state. Draw is the go button: ask now, with the boxes as they stand,
// without waiting out the debounce. Sample is the one action typing cannot
// express: the server rolls a fresh seed, reports it in `meta.seed`, and the
// seed is then held and re-sent so the drawn skeleton survives subsequent
// edits. See `dev/done/plan-pk-tab.md` and its API execution notes.

// The capital box: a probability, so it shares the anchor box's constraints
// rather than the target box's.
const ruinPInput = el('input', {
    type: 'number', step: '0.001', min: '0', max: '1',
    value: '0.05', autocomplete: 'off',
});
// Where the resolved reading prints: the surplus the probability bought, the
// psi achieved at the grid point, and the seed the picture was drawn from.
const ruinReadout = el('span', { className: 'text-muted ms-2 form-gloss' });
const ruinSample = el('button', { className: 'btn btn-outline-secondary btn-sm' },
    'Sample');
ruinSample.title = 'fresh paths, same question';
const ruinExtras = el('div', { className: 'tab-tools price-form' },
    el('span', { className: 'exhibit-group-label' }, 'Pr default'),
    el('label', { className: 'price-field' }, ruinPInput),
    ruinSample,
    ruinReadout);

/** Stale-answer guard: the boxes move while a request is in flight. */
let _ruinTicket = 0;

/**
 * Ask for the ruin reading and draw both halves of the answer.
 *
 * `sample` is the Sample press; everything else is the debounced echo of the
 * form. An incomplete form is silence, not an error, matching the preview
 * line's reading of an empty box.
 */
async function requestRuin({ sample = false } = {}) {
    if (!state.id || !state.caps?.charts?.has('ruin')) return;
    const body = ruinForm.read();
    if (!body) return;
    const ruinP = parseFloat(ruinPInput.value);
    if (Number.isFinite(ruinP) && ruinP > 0 && ruinP < 1) body.ruin_p = ruinP;
    else return;
    if (sample) body.sample = true;
    else if (_ruinSeed != null) body.seed = _ruinSeed;
    const mine = ++_ruinTicket;
    ruinForm.setBusy(true, sample ? 'Sampling…' : 'Drawing…');
    ruinSample.disabled = true;
    try {
        const payload = await api.ruin(state.id, body);
        if (mine !== _ruinTicket) return;
        _ruin = payload;
        _ruinSeed = payload.chart?.meta?.seed ?? _ruinSeed;
        drawRuin();
    } catch (err) {
        if (mine === _ruinTicket) replacePane('pane-ruin', errorNode(err));
    } finally {
        ruinForm.setBusy(false);
        ruinSample.disabled = false;
    }
}

/** Draw the held response: the chart, the stats strip, and the readout. */
function drawRuin() {
    if (!_ruin) return;
    const host = el('div');
    replacePane('pane-ruin', host);
    ruinChart = mountChartDoc(host, _ruin.chart);
    if (!ruinChart) replacePane('pane-ruin', notDrawable());
    drawPricingPane('ruin');
    const meta = _ruin.chart?.meta || {};
    ruinReadout.textContent =
        `u ${money(meta.u)}, psi ${percent(meta.psi_exact)}, `
        + `simulated ${percent(meta.psi_sim)}, seed ${meta.seed ?? ''}`;
}

/**
 * Arrive at the leaf: draw what is held, or ask with the form as it stands.
 *
 * Unlike its button-driven neighbors this pane computes on activation, the
 * Plot precedent: the picture tracks the form live, so a leaf that greeted
 * its reader blank while being live to every keystroke would be odd.
 */
async function showRuinLeaf() {
    if (_ruin) { drawRuin(); return; }
    await requestRuin();
}

const requestRuinSoon = debounce(() => requestRuin(), 350);

const ruinForm = createPricingForm($('ruin-form'), {
    verb: 'Draw',
    preview: true,
    context: formContext,
    extras: ruinExtras,
    onChange: requestRuinSoon,
    onSubmit: () => requestRuin(),
});
ruinSample.addEventListener('click', () => requestRuin({ sample: true }));
ruinPInput.addEventListener('input', requestRuinSoon);

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

// The `against` box, the one thing the three leaves do not share. It sits below
// the form rather than inside it so the pricing row reads the same here as on
// the Pricing tab, and it takes a name or a program rather than a number, which
// is why it is the one field in the group that is not right aligned.
const boundsAgainst = el('input', {
    type: 'text', autocomplete: 'off', autocorrect: 'off',
    autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'a unit name, or DecL for a new line',
});
const boundsAgainstField = el('label',
    { className: 'price-field bounds-against d-none' },
    'against', boundsAgainst);

/**
 * Show one bounds leaf: same form, different extras, pane cleared.
 *
 * Nothing computes here. Each of the three is real work, so arriving at a leaf
 * sets it up and waits.
 *
 * The form opens on the pricing the reader has been working with, which is what
 * makes the band the band around *their* premium. Through a99 it opened on
 * `mean * 1.25`, a number chosen only to sit above the expected loss, and the
 * envelope's second panel then named distortions calibrated to that rather than
 * to anything the reader had asked for.
 */
async function showBoundsLeaf(which) {
    boundsWhich = which;
    boundsAgainstField.classList.toggle('d-none', which !== 'pricing');
    $('bounds-hint').textContent = BOUNDS_HINTS[which] || '';
    adoptPricing(boundsForm);
    replacePane('pane-bounds', el('div', { className: 'text-muted small' },
        'Set a premium and press Compute.'));
}

/**
 * Open a form on the held pricing, or say why it cannot.
 *
 * The Bounds classes answer on the object's own distribution and take no
 * reinsurance view, so a pricing struck on a book's gross view describes a
 * different distribution from the one about to be swept. Seeding across that
 * gap would draw a gross premium on a net band with nothing on screen saying
 * so, which is the one failure worth a sentence.
 *
 * The seed is withheld, and nothing else: every box stays live, a typed premium
 * computes exactly as before. When `reins_view=` lands on `Bounds` and
 * `PricingBounds` this check goes and the seed happens.
 */
function adoptPricing(form) {
    if (_pricing?.basis && _pricing.basis !== 'net') {
        form.note(`The pricing on hand was struck on the ${_pricing.basis} view. `
            + 'This group answers on the object’s own distribution, so it is '
            + 'not carried over; type a premium to sweep one.');
        return;
    }
    form.write(_pricing);
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

const boundsForm = createPricingForm($('bounds-form'), {
    verb: 'Compute',
    // No basis row. The three Bounds classes take the object and answer on its
    // own distribution, with no `reins_view` to give them, so a control here
    // would be one the request cannot carry. `adoptPricing` is where that gap
    // becomes a sentence rather than a silent mislabel.
    basisLabel: null,
    // The pane said nothing at all until a press, and the press is fifty
    // resamples. One pentagon solve says what is about to be swept, and it puts
    // the refusals in front of the button: Bounds rejects a premium below the
    // expected loss or above the cap, and the line shows M or Q going non
    // positive before the reader commits to the wait.
    preview: true,
    extras: boundsAgainstField,
    context: formContext,
    onSubmit: async (body) => {
        if (!state.id) return;
        boundsForm.setBusy(true, 'Computing…');
        try {
            // The sweep is parameterized by a premium and an asset level, and
            // the form may have been given a cost of capital instead, so the
            // pentagon resolves the pair first. One cheap call, and it is the
            // same one the preview line makes.
            const octet = await api.pricingPreview(state.id, body);
            holdPricing(body, octet);
            const premium = octet.premium;
            const assets = Number.isFinite(octet.assets) ? octet.assets : null;
            if (!Number.isFinite(premium)) return;
            if (boundsWhich === 'bounds') {
                // A chart document since a60, where this used to be an <img>
                // whose src was the whole request. The reader gets a picture
                // they can zoom and read values off, and the api stopped
                // rendering.
                const doc = await api.boundsEnvelope(state.id, { premium, assets });
                const host = el('div', { className: 'bounds-figure' });
                replacePane('pane-bounds', host);
                if (boundsChart) { boundsChart.dispose(); boundsChart = null; }
                // The document is already in hand, since the premium the reader
                // typed is what identifies it, so this takes the mount's
                // already-fetched entry point rather than its fetching one.
                boundsChart = mountChartDoc(host, doc);
                if (!boundsChart) replacePane('pane-bounds', notDrawable());
            } else if (boundsWhich === 'allocation') {
                renderBoundsTable(await api.allocationBounds(state.id, { premium, assets }));
            } else {
                const against = boundsAgainst.value.trim();
                if (!against) return;
                renderBoundsTable(await api.pricingBounds(
                    state.id, { premium, assets, against: [against] }));
            }
        } catch (err) {
            replacePane('pane-bounds', errorNode(err));
        } finally {
            boundsForm.setBusy(false);
        }
    },
});

// ----------------------------------------------------------------------
// Pricing / Evaluate: the breakeven acceptability panel
// ----------------------------------------------------------------------
// The other direction. Calibrate asks what an obligation is worth at a chosen
// capital level; this starts from a premium already held and reports what stress
// it survives. Anchored at the level a calibration was struck at, the two close
// a round trip: evaluating a family's own implied premium recovers that family's
// calibrated parameters.

/**
 * Put the Evaluate form in the shape this object calls for, and open it on the
 * pricing in hand.
 *
 * A P&L carries a premium and an asset level per ledger row, so neither the
 * premium box nor the anchor means anything for it and both go; the api refuses
 * them rather than guessing, and a form that can only produce a 400 is worse
 * than one control fewer.
 *
 * Everything else opens on the held pricing: the premium a calibration was
 * struck at, and the asset level it was struck at, which is what closes the
 * round trip the leaf exists for. Pressing Evaluate unchanged recovers that
 * calibration's own parameters, and changing the premium asks the question the
 * leaf is for. Through a99 the anchor was seeded by nothing and sat at 0.99
 * whatever the calibration had used, so the round trip was described in a
 * comment and never actually offered.
 *
 * Falls back to the object's own consideration when nothing has been struck,
 * which is what it did before.
 */
function syncEvaluateForm() {
    const isPnl = state.kind === 'pnl';
    evaluateForm.setFieldsVisible(!isPnl);
    evaluateForm.sync();
    if (isPnl) return;
    if (_pricing) {
        evaluateForm.write(_pricing);
        return;
    }
    const own = state.caps.flags.premium;
    if (Number.isFinite(own)) {
        evaluateForm.write({ octet: { premium: own }, anchor: 'p', target: 'premium' });
    }
}

const evaluateForm = createPricingForm($('evaluate-form'), {
    verb: 'Evaluate',
    // Narrower than the calibration basis, and deliberately: it names what the
    // number in the box **is**, so the panel measures it against the right
    // distribution. The fuller gross versus net story overlaps Economics and
    // stays there.
    basisLabel: 'premium is',
    // One question, so nothing to switch. The premium is the input and the
    // stress it survives is the answer.
    targets: ['premium'],
    allowBlank: true,
    gloss: 'breakeven acceptability: the distortion that values the margin at zero',
    context: formContext,
    onSubmit: async (fields) => {
        if (!state.id) return;
        const body = {};
        if (state.kind !== 'pnl') {
            // Required only where the object states none of its own. With one,
            // an empty box means "as it stands", which is what the library does
            // with no premium argument.
            if (Number.isFinite(fields.premium)) body.premium = fields.premium;
            else if (can('needsPremium')) return;
            // Blank is not incomplete here. It is the library's unlimited
            // reading, which solves over the whole distribution and reports
            // four families rather than five, since `ccoc` needs an asset level.
            if (Number.isFinite(fields.p)) body.p = fields.p;
            if (Number.isFinite(fields.a)) body.a = fields.a;
            if (fields.basis) body.basis = fields.basis;
        }
        evaluateForm.setBusy(true, 'Evaluating…');
        try {
            _evaluation = await api.pricingEvaluate(state.id, body);
            // The premium just evaluated becomes the current one, which is the
            // point of the leaf: an ad hoc premium tried here is what Bounds
            // then sweeps.
            if (state.kind !== 'pnl') {
                const octet = await api.pricingPreview(state.id, {
                    ...(Number.isFinite(body.a) ? { a: body.a } : { p: body.p ?? 0.99 }),
                    premium: body.premium ?? state.caps.flags.premium,
                    ...(body.basis ? { basis: body.basis } : {}),
                }).catch(() => null);
                holdPricing({ ...body, premium: body.premium }, octet);
            }
            drawPricingPane('evaluate');
        } catch (err) {
            _evaluation = null;
            replacePane('pane-evaluate', errorNode(err));
        } finally {
            evaluateForm.setBusy(false);
        }
    },
});

// ----------------------------------------------------------------------
// Tab tools: download the plot SVG.
// ----------------------------------------------------------------------
// There is no copy button here any more, at any level. a55 took the last two
// off (Validation and Narrative, the only leaves that declared `copy: true`)
// along with `copyPane` and the dead `[data-copy]` wiring that no markup ever
// used. The reason is that the app grew two export stories and only one of them
// earns its place: CsvGrid's own copy / save is on every table, exports the raw
// values rather than the rendered text, and is what the author actually uses. A
// second button beside the sub-tabs, copying a pane's `innerText`, was a worse
// answer to the same question sitting in the more prominent spot.
// ----------------------------------------------------------------------

// The PNG download used to hang off a `[data-plot-download]` item in the header
// menu and is gone from here as of a131. It is an item in each chart's own
// Download menu now, in the strip beside the picture, alongside the three mesh
// writers on a relief, so the menu is the one place a drawing leaves the app.
//
// The move also fixed something the header item never could. The `liveChart`
// helper behind it mapped the active group to one of three chart handles, and
// the Pricing group's kappa curves are a fourth, so that chart had no way to be
// saved at all. The strip is rendered by every chart mount, so every chart can
// now save itself, and `liveChart` had no callers left and is gone with the
// item.

// ----------------------------------------------------------------------
// Examples dropdown + Ctrl+Shift-↑/↓ ring navigation
// ----------------------------------------------------------------------
// A ring over the same /v1/examples payload (cached server-side) that fills the
// dropdown, holding the item rows themselves. Independent of build history;
// navigated by Ctrl+Shift-↑/↓ for quick inspection of the whole library, and
// documented in the feedback line and the Help panel since a37. It was an
// undisclosed Alt- binding before that, which is a working feature nobody could
// find.
// Only the cursor is held. The list itself is `visibleExamples()`, read at
// each step, because the ring is the dropdown read top to bottom and the
// dropdown shows what the active pills leave (a123) and what the search box
// matches (a133). Holding a copy would make the walk and the menu two lists
// that agree until someone clicks a pill or types a letter.
const exampleRing = { cursor: -1 };

/**
 * Where the example walk is, as `{m, n}`, in `history.position()`'s shape.
 *
 * `n` is the length of the list actually being walked, which is what the active
 * pills leave (a123) and what the search box matches (a133), so a reader
 * filtered to `role:hero` walks `[1/7]` to `[7/7]` and one who has typed `hero`
 * walks whatever that matched. That is the readout doing its job: it says where
 * you are in what you are walking, not how big the library is.
 *
 * Read off the same call `exampleStep` makes rather than off a copy. Two
 * readings of the length would agree until a pill was clicked mid walk, and then
 * disagree silently.
 *
 * `m === 0` for an unset cursor, so the readout draws blank. That is the same
 * rule `history.position` uses for "not in the stack", and it is the state a
 * fresh page and a just-changed filter are both in.
 *
 * Declared as a hoisted function on purpose: `renderHistoryNav` is defined far
 * above `exampleRing` and runs during startup, before that `const` is
 * initialized. It only calls this when `walkMode` is `'examples'`, which nothing
 * can set until module evaluation has finished, so the ring is always live by
 * the time this runs.
 */
function examplePosition() {
    const n = visibleExamples().length;
    const at = exampleRing.cursor;
    return { m: at < 0 ? 0 : at + 1, n };
}

// Load a program into the editor. A library example arrives as `Recipe.decl`,
// already canonical spread-form DecL carrying its hints, so there is nothing to
// normalize: the old post-load /v1/decl/format round-trip is gone. Pass
// `formatted: false` for hand-written text (the Help panel's sample) to take
// that trip anyway. The Overview lead is read off the built object, so no note
// has to ride along here.
function loadExample(decl, formatted = true) {
    editor.setText(decl);
    // A different program, so the cession draft written for the last one goes.
    clearCessionDraft();
    editor.focus();
    // The scroll rule: choosing an example is an editor gesture, from the
    // Examples menu, the palette, or the Ctrl+Shift ring alike. After the
    // focus on purpose: the focus scroll is instant, so the smooth anchor
    // here is the one that lands.
    anchorEditor();
    if (formatted) return;
    const at = exampleRing.cursor;
    api.formatDecl(decl).then((res) => {
        if (exampleRing.cursor === at && res && res.decl) editor.setText(res.decl);
    }).catch(() => { /* keep raw */ });
}

// Sync the ring on the row's own identity. Through a121 an entry filed under
// two topics had a row in each group, so this resumed from the showing that was
// clicked; each entry now has exactly one row, so there is one place to resume
// from and `indexOf` finds it whichever surface handed the item over.
/**
 * Put a library entry's own prose in the strip's caption slot.
 *
 * Since a132 the served program has its `note{}` and `tags{}` stripped, so this
 * field pair is the only channel by which the library's own words reach the
 * page. Called before the program is loaded, so the caption is on screen the
 * moment the program is rather than one build later, and it survives that build
 * because `clearNote` leaves the caption alone.
 *
 * Both routes into the editor call it: the menu and the palette through
 * `pickExample`, and the Ctrl+Shift ring through `exampleStep`, which loads the
 * program itself rather than going through `pickExample`. The Help panel's
 * sample is not a library entry and deliberately gets none.
 *
 * @param {object} item a row from `/v1/examples`, carrying `note` and `tags`.
 */
function captionExample(item) {
    _note.caption = item ? { note: item.note, tags: item.tags || [] } : null;
    renderNote();
}

function pickExample(item) {
    walkMode = 'examples';
    exampleRing.cursor = visibleExamples().indexOf(item);
    captionExample(item);
    loadExample(item.decl);
    // Explicitly, rather than relying on the `setText` inside `loadExample` to
    // fire `onEdit`: picking the row the editor already holds changes no text
    // and so fires nothing, and that is exactly the press whose number the
    // reader is looking for.
    renderHistoryNav();
    // Choosing an example is asking to see it (author, 2026-09-06): the menu
    // and the palette build at once. The ring steps through `exampleStep`,
    // which debounces the same call instead, since a reader flicking along
    // the shelf has not settled on a book yet.
    anchorEditor();
    build();
}

mountExamples($('examples-menu'), pickExample);

// Ctrl+K opens the same library as a wider palette. Registered here rather
// than inside the dropdown so it works from anywhere on the page, including
// with focus in the editor.
mountPalette(pickExample);

// The ring is the dropdown read top to bottom, which since a122 is the library
// in its own reading order, each entry once. Through a101 it deduped on the
// decl, which dropped 20 of the 209 rows the grouped payload carried and left
// the alphabet inside the later groups gap-toothed; a walk that silently omits
// rows you can see on screen is what reads as random order. The grouped payload
// is what made both the repeats and the dedup necessary, and it is gone.
//
// The fetch is still kicked off here so the ring answers on the first press
// rather than on the first time the menu is opened; `loadExamples` memoizes, so
// the dropdown and the palette read the same payload when they mount.
loadExamples().catch(() => { /* dropdown still works; the ring just stays empty */ });

// A changed pill set or a changed search needle changes the list the cursor
// indexes into, so the cursor stops meaning anything. Dropping it restarts the
// walk at the end the next press asks for, which is where an unset cursor
// already lands.
//
// The readout is redrawn with it, since a129: it may be showing a position in
// the list that just changed shape, and an unset cursor draws blank, which is
// the honest reading until the next press.
onExamplesViewChange(() => {
    exampleRing.cursor = -1;
    renderHistoryNav();
});

// ----------------------------------------------------------------------
// The landing build
// ----------------------------------------------------------------------
// Dice of dice, every time. The author's ruling, round 7 item 13: "initial page
// load is not smooth, rather than the hero idea let's just show dice of dice".
//
// Through a92 this asked `/v1/examples/heroes` for the entries tagged
// `role:hero`, picked one at random and built it. Three things about that were
// what made the landing untidy, and only the third was a bug: the editor showed
// one program and then swapped to another when the fetch answered; a cold
// server takes ~2 s on that route, because the first call loads the whole
// recipe library, so the swap was slow enough to watch; and a different book
// each visit meant the first thing a returning reader saw was unfamiliar. A
// fixed program in the editor from the first paint has none of those. The
// retry-and-report the old path carried went with it, having nothing left to
// fail at.
//
// **BasicBook** rather than any other example, the author's ruling of
// 2026-09-06 superseding the round 7 dice ruling: the landing should speak
// actuary directly, and the workhorse compound (Poisson count, lognormal
// severity, an occurrence limit) is what a practitioner recognizes on sight.
// The dice remain the first entry a reader finds in the Examples menu when
// they want something checkable by hand.
//
// The heroes endpoint stays on the server. The card gallery a37 took away is to
// come back inside the Examples dropdown, and that is what will want it.
function loadLanding() {
    // The editor already holds `LANDING_DECL` from startup, so this is the
    // build and nothing else: no text swap to watch and no fetch in front of
    // it. `build()` reads the editor, so the reader can also have typed over it
    // in the moment before this runs and get what they typed.
    build();
}

// The `data-why` footnote: one node on the body, clamped to the window. Wired
// once, delegated on the document, so the sub-tab rows and the group tabs can be
// rebuilt as often as they like without anything having to re-bind. A node
// rather than a `::after` because the pseudo-element was already spoken for by
// the bold width ghost, and sharing it made every dark tab narrow on hover. See
// `utils/tip.js`.
mountTips();

// Before anything is built there is no object, so every derivation is greyed.
// Drawn once at startup rather than left to the first build, which would leave
// three live-looking buttons on an empty page.
renderActionRow();

loadLanding();

// The arrows move on the dropdown, not on the history walk beside them: up goes
// up the list, towards the library's first entry, and down goes down it.
// The two walks share a pair of keys and read their direction the opposite way
// round, which sounds like a trap and is not: history's up is older, because the
// list it moves on is not on screen, while this one is looking at the menu.
//
// From the unset cursor the two directions land on the two ends of the ring, as
// they would if the cursor sat just above the first row: down on that first row,
// up wrapping round to the last. The modular step alone cannot do that, because
// `-1` would have to mean "at 0" for one direction and "at n" for the other.
// `pickExample` can also leave the cursor unset, when the row picked is not one
// of the ring's own, so this is not only the opening press.
// The settling build behind the Ctrl+Shift ring: 450 ms after the last step,
// long enough to flick past entries without firing a request per press, short
// enough that stopping on one feels answered.
const buildSoon = debounce(() => { anchorEditor(); build(); }, 450);

function exampleStep(dir) {
    const items = visibleExamples();
    const n = items.length;
    if (!n) return;
    const at = exampleRing.cursor;
    if (at < 0) exampleRing.cursor = dir === 'prev' ? n - 1 : 0;
    else exampleRing.cursor = dir === 'prev' ? (at - 1 + n) % n : (at + 1) % n;
    // This press walked the library, so the readout describes the library.
    walkMode = 'examples';
    const item = items[exampleRing.cursor];
    captionExample(item);
    loadExample(item.decl);
    renderHistoryNav();
    // The ring builds too, once the flicking settles: each step resets the
    // clock, so holding the arrows walks text only and releasing them builds
    // what is on screen. The debounce is the build's, not the step's, so the
    // caption and program still move under every press.
    buildSoon();
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
    // The same two in the header, where they can be read without opening
    // anything. `agg` first, because which library built the numbers is the
    // question this answers most often.
    const strip = $('nav-versions');
    if (strip) strip.textContent = `agg ${meta.aggregate_version} · api ${meta.version}`;
}).catch(() => {
    $('about-api').textContent = '(api offline)';
});

// Download every DecL program built this session, canonical and re-loadable,
// from the underwriter's session recipes. The attachment header makes the
// browser save the file.
//
// The raw form went at a82. It served the programs as typed, straight off the
// object cache, and the two sat next to each other in the menu asking a reader
// to know the difference; the canonical one is the one that reloads.
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
