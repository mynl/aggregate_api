// Mounting a chart document in a pane: the skeleton, the control strip, the
// ECharts lifecycle and the gestures.
//
// This module used to be `exhibits.js`, one chart specification per first-class
// kind: which frames to fetch, which columns mean what, where the window sits,
// which curves to draw and how. All of that was app-side semantics, and all of
// it is now upstream in the library's chart emitters, which publish a
// `ChartDoc` this fetches and `chartdoc-to-echarts.js` realizes. What is left
// here is genuinely the app's: reserving the box before the payload lands,
// surfacing a control for each reading the document declares, holding which one
// the reader picked, and the zoom.
//
// The rename is not cosmetic. An "exhibit" in this app is a library *table*
// envelope, and a module called `exhibits.js` that drew charts had been
// misleading since the exhibits endpoint arrived.
//
// One consequence worth stating plainly: **there is no fallback drawing path**.
// A chart the library does not publish is a chart the app says it cannot draw
// yet, rather than one it approximates from a frame. That is the purist ruling
// of `dev/plan-plot-ir-api.md` item 4, and it is what stops a chart working
// because the old pathway is still wired.

import { api } from '../api.js';
import * as spacemouse from '../spacemouse.js';
import { el, empty } from '../utils/dom.js';
import {
    PANEL_DEFAULTS, WIDE_PX, chartdocToEcharts, panelLayout, readings, rungAt,
    surfaceCuts,
} from './chartdoc-to-echarts.js';
import { fileStem, meshToGlb, meshToObj, meshToStl, surfaceMesh } from './mesh-export.js';
import { chartParamsFor, migrateChartView, windowsWith } from './request-params.js';
import { createSurfaceNav } from './surface-nav.js';
import { loadSurface, readCamera, surfaceOverrides } from './surface.js';
import { stampTouchCoordinates } from './touch.js';
import { VIRIDIS, echarts, loadStyle } from './theme.js';

// Set once `loadSurface()` has resolved. Read synchronously inside a build,
// which must stay pure, so the async part happens in the mount and this is the
// flag it leaves behind.
let surfaceReady = false;

// ---- view state --------------------------------------------------------
//
// Sticky per browser, like the Static / Interactive table switch: a chosen
// reading survives a rebuild and a reload, so you are not re-clicking log every
// time you press Build.
//
// One flat set of readings rather than a per-kind list, because the document
// says which of them apply and the adapter ignores the rest. A reading nothing
// declares is simply not surfaced and does nothing if it is held.

// v3 was readings rather than the per-panel toggles the app used to own, and a
// stored v2 would have restored a view nobody chose. v4 is the same reasoning
// one level in: v3 also held a flat `window`, which is a request parameter and
// not a reading, and a browser holding one asked every 2-D chart for something
// no 2-D chart takes. See `dev/plan-plot-2d-fix.md`. The previous key is read
// once, migrated and dropped, so the readings survive and the leak does not.
const VIEW_KEY = 'aggapi.chartView.v4';
const VIEW_KEY_PREVIOUS = 'aggapi.chartView.v3';

const VIEW_DEFAULTS = {
    // The seven readings live per panel, under `panels`, keyed by the
    // document's own panel id. **No `VIEW_KEY` bump for the move**, per the test
    // `dev/done/plan-chart-reflect.md` records: a key is bumped when a stored
    // value would now mean something *wrong*, as v3's flat `window` did. Here
    // the stored blob spreads over these defaults, the six old flat keys become
    // inert because nothing reads them any more, `panels` takes `{}` and every
    // panel takes `PANEL_DEFAULTS`. Nothing means anything wrong, and `kind`,
    // the surface preferences, the cut position and the per-chart `windows` all
    // survive, which a bump would silently discard. `migrateChartView` strips
    // the dead keys on the next write.
    //
    // Keying on the panel id is a real gain over the flat set rather than the
    // cost of the move: `density`, `lee`, `kappa`, `occurrence`, `aggregate`,
    // `square` and `cloud` are stable names carrying one meaning across every
    // document that uses them, so `log y` chosen on a density panel carries
    // from an `agg` to a `port` to a P&L, which the flat set could not tell
    // apart from `log y` chosen on a Lee panel.
    panels: {},
    kind: null,          // panel realization: a z grid flat or in relief
    // The relief's own controls, which act on nothing else. Defaults are the
    // prototype's `app` preset: the mesh and the wall grid on, the marginals
    // and the contours off until asked for. See `dev/plan-3d-plot.md` 4.4.
    mesh: true,
    wallGrid: true,
    marginals: false,
    // Contours on by default, in both readings. The prototype's preset had them
    // off for the relief, which was right while they were the only thing the
    // control could add; now that the flat image wants them too, one key with
    // one default is worth more than matching the preset exactly, and it is one
    // click to a bare surface.
    contours: true,
    lights: true,
    cut: 'none',         // none | components | total | all
    // Where each cut sits, as a fraction of its own range. Three rather than
    // one because a click places a cut where the reader pointed, which is two
    // independent coordinates; the walk drives all three off the diagonal.
    cutX: 0.5,
    cutY: 0.5,
    cutS: 0.5,
    // The quantile depth asked of the library, per chart registry name. A chart
    // with no entry takes the library's own default, and a chart that takes no
    // grid options can never gain an entry, because the box that writes one is
    // only ever rendered on a document that realizes as a surface.
    windows: {},
};

/** Which view keys the relief owns, for the reset button to put back. */
// `tips` was here through a130 and is retired, not repurposed: with the cell
// reading in a fixed place there is no second question for a button to ask. A
// stored `tips` key in a reader's persisted view is harmless once nothing
// reads it.
const SURFACE_KEYS = ['mesh', 'wallGrid', 'marginals', 'contours', 'lights',
                      'cut', 'cutX', 'cutY', 'cutS'];

/** The cut control cycles rather than branching into four buttons. */
const CUT_MODES = ['none', 'components', 'total', 'all'];

/** One pass of the walk, and how often it redraws.
 *
 * Twenty frames a second, not sixty. Each step rebuilds the option and hands
 * echarts a new one, which is far more work than moving a line, and a walk that
 * drops the browser to a crawl cannot be watched at all, which is the only
 * thing it is for. */
const WALK_PERIOD = 13000;
const WALK_INTERVAL = 50;

let view = (() => {
    try {
        const held = localStorage.getItem(VIEW_KEY);
        // Migrated on the way in as well as on the v3 path below: the a121 move
        // of the readings under `panels` left its dead keys inside the key that
        // is still current, so they are stripped here rather than carried
        // forward forever. Inert either way, since nothing reads them.
        if (held !== null) {
            return { ...VIEW_DEFAULTS, ...migrateChartView(JSON.parse(held)) };
        }
        const previous = localStorage.getItem(VIEW_KEY_PREVIOUS);
        if (previous === null) return { ...VIEW_DEFAULTS };
        const migrated = { ...VIEW_DEFAULTS, ...migrateChartView(JSON.parse(previous)) };
        // Written through at once rather than left to the first control the
        // reader touches: the old key is gone as of the next line, so a reload
        // before any click would otherwise land on the defaults.
        localStorage.setItem(VIEW_KEY, JSON.stringify(migrated));
        localStorage.removeItem(VIEW_KEY_PREVIOUS);
        return migrated;
    } catch {
        return { ...VIEW_DEFAULTS };
    }
})();

function setView(patch, persist = true) {
    view = { ...view, ...patch };
    // The walk moves a cut twenty times a second and every one of those is a
    // position nobody chose, so it does not go to storage. Where it stopped
    // does, once, when it stops.
    if (!persist) return;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* private mode */ }
}

/** One panel's held readings, resolved against the defaults. */
function panelView(id) {
    return { ...PANEL_DEFAULTS, ...((view.panels || {})[id] || {}) };
}

/** Set one reading on one panel, leaving every other panel alone. */
function setPanelView(id, patch) {
    setView({ panels: { ...(view.panels || {}),
                        [id]: { ...panelView(id), ...patch } } });
}

// The controls, in the house order: axis readings first, then panel
// realizations, each family appended within its group as it arrives. Fixed so
// the strip does not reorder itself between charts and a reader's hand learns
// one layout.
//
// The canonical order is `log x, log y, full range, reflect, return period,
// invert, reference lines`, stated the same way in the library's
// `dev/plan-chart-reflect.md` bar the log split. `reflect` is the one entry
// that did not simply append: it sits *before* the return period because the
// two act on the same probability axis and the period reading composes on top
// of the reflection, so reading the strip left to right is reading the
// coordinate changes in the order they apply.
//
// **One `log` became `log x` and `log y`** (author ruling 2026-08-21). The
// single button could not draw a log ordinate over a linear loss axis, which is
// the reading wanted most often, and a naive split by screen position could not
// have either: the loss axis is read by both panels of an `agg`, so one flag
// would have drawn it on log in the density panel and linear in the Lee panel.
// Per-panel groups dissolve that entirely, since each panel answers for itself.
// The two resolve by screen position *after* the invert exchange, so a button
// keeps meaning the axis under the reader's eye.
//
// `key` names the reading in the view state; `offer` reads the panel's
// declaration, which is what decides whether the button exists at all.
const CONTROLS = [
    {
        key: 'logX',
        label: 'log x',
        title: 'Read this panel\'s horizontal axis on log, where it offers a '
            + 'log reading. Which axes do is the document\'s statement, not a '
            + 'setting here, and it acts on this panel alone',
    },
    {
        key: 'logY',
        label: 'log y',
        title: 'Read this panel\'s vertical axis on log, where it offers a log '
            + 'reading. A density ordinate is uncropped on the way there, '
            + 'because room for a spike is the whole point of asking',
    },
    {
        key: 'fullRange',
        label: 'full range',
        title: 'Draw this panel\'s axes over the whole extent they declare, '
            + 'instead of the window the library suggested. On a return period '
            + 'that opens the ladder past 1-in-10,000 to the deep tail',
    },
    {
        key: 'reflect',
        label: 'reflect',
        title: 'Read this panel\'s probability axis as its complement, 1 - v. '
            + 'A distribution function reflected is the survival function; '
            + 'with the return period it opens out the other end of the curve',
    },
    {
        key: 'returnPeriod',
        label: 'return period',
        title: 'Read this panel\'s probability axis as the return period it '
            + 'pairs with: the same curve, interrogated at 1-in-200 rather '
            + 'than at 0.995',
    },
    {
        key: 'invert',
        label: 'invert',
        title: 'Exchange this panel\'s axes, where it says they exchange. A '
            + 'quantile plot inverted is the distribution function',
    },
    // Offered whenever the panel carries marks, and **on** by default: a mark
    // is a reading a reader cannot hover for, so it is what they came to see,
    // and this is the button for taking it away rather than for asking for it.
    // It existed before a62, did not survive the rewrite onto chart documents,
    // and its absence is punch item G3. Per panel since a121, and it lost the
    // middle group of the old three-group arrangement with the move: marks
    // carry `panel_id` and `xyPanel` already filters on it, so the button
    // belongs to the panel whose marks it suppresses. On an `agg` and a `port`
    // that is the density group alone, which is why the restored arrangement is
    // two groups rather than the older three.
    {
        key: 'refLines',
        offer: 'marks',
        label: 'reference lines',
        title: 'Show the marks this panel carries, the mean and break even, '
            + 'drawn where the document puts them',
    },
];

// The relief's own controls, offered only while a surface is on screen. They
// are not document readings: nothing in the IR declares that a joint has
// marginals worth drawing on a wall, and nothing should, because these are
// decisions about *this* drawing. `dev/plan-3d-plot.md` 4.4 is the list.
const SURFACE_CONTROLS = [
    {
        key: 'contours',
        label: 'contours',
        title: 'Contour lines at eight levels. In relief they run on the '
            + 'surface and on the floor image at the same levels, which is what '
            + 'makes the two read as one drawing; flat, they run over the image',
        // The one control that means something in both readings of a grid, so
        // it is offered in both. The rest are about a box drawn in perspective.
        flat: true,
    },
    {
        key: 'marginals',
        label: 'marginals',
        title: 'Draw each component\'s own distribution on the wall behind it. '
            + 'These are the library\'s exact marginals, not an integral of '
            + 'what is on screen, so they do not move when the window does',
    },
    {
        key: 'mesh',
        label: 'mesh',
        title: 'The grid over the skin, every sixth line. Off leaves a bare '
            + 'surface, which reads the shape more cleanly and the resolution '
            + 'not at all',
    },
    {
        key: 'wallGrid',
        label: 'wall grid',
        title: 'Grid lines on the three walls of the box',
    },
    // A `tips` toggle stood here through a130, offering the hover tooltip that
    // read one cell under the cursor. Both are gone: the cell reading is in the
    // strip now, in a fixed place, so there is no second question left to ask.
    {
        key: 'lights',
        label: 'lights',
        title: 'Light the surface from all around, so no face of it is dark. '
            + 'The color is the height here, so a key light strong enough to '
            + 'shade one side into darkness is a second encoding fighting the '
            + 'first. Off is one hard key light, which reads the relief more '
            + 'sculpturally and the color less well',
    },
];

// The panel-realization control is a choice among named kinds rather than a
// toggle, so it renders as a pair of buttons with the kinds' own words.
const KIND_LABELS = { xy: 'curves', heatmap: 'flat', surface: '3D' };

// ---- the skeleton ------------------------------------------------------

// What shape a chart's skeleton is drawn at, before its document has arrived.
//
// A **hint**, and presentational only. The real layout comes off the document,
// which is not in hand at reservation time: panel count and equal aspect are
// facts about the picture and the picture is what is being fetched. Where the
// hint is wrong the chart still draws correctly and only the placeholder was
// mis-sized, so this is allowed to be a small table keyed by chart name while
// nothing semantic is.
const SKELETON_SHAPE = {
    distortion: { panels: 1, square: true },
    joint_surface: { panels: 1, square: true, colorbar: true },
    envelope: { panels: 2, square: true },
};
const DEFAULT_SHAPE = { panels: 2, square: false };

/**
 * Fill `host` with the chart's outline, at its final size, before the fetch.
 *
 * The panels are positioned at the grid geometry the chart will use and the
 * arriving chart lands on top of its own outline instead of replacing a
 * differently shaped block. A reserved but empty box says nothing; this says a
 * graph is coming, and where.
 *
 * Parameters
 * ----------
 * host : HTMLElement
 *     Emptied, sized and given a positioning context.
 * chart : str
 *     The chart's registry name, for the shape hint.
 * width : number
 *     Host width in CSS pixels.
 *
 * Returns
 * -------
 * object
 *     The layout box, so a caller that needed it does not compute it twice.
 */
export function showPlaceholder(host, chart, width) {
    const shape = SKELETON_SHAPE[chart] || DEFAULT_SHAPE;
    const box = panelLayout(shape.panels, shape.square, width, shape.colorbar ? 78 : 0);
    empty(host);
    host.style.position = 'relative';
    host.style.height = `${box.hostHeight}px`;
    const skin = el('div', { className: 'exhibit-skeleton' });
    for (const g of box.grids) {
        skin.appendChild(el('div', {
            className: 'exhibit-skeleton-panel',
            style: `left:${g.left}px; top:${g.top}px;`
                 + `width:${g.width}px; height:${g.height}px`,
        }, el('i', { className: 'bi bi-graph-up', 'aria-hidden': 'true' })));
    }
    host.appendChild(skin);
    return box;
}

/** The pane a chart cannot be drawn in yet, said plainly. */
export function notDrawable(message) {
    return el('div', { className: 'text-muted small fst-italic' },
        message || 'This chart is not published by the library yet.');
}

/**
 * The pane a chart could not be fetched into, which is a different statement.
 *
 * `notDrawable`'s wording is about the library: it says this object publishes
 * no such chart, and a reader who sees it stops asking. A request that failed
 * says nothing about the library, and borrowing that wording for it is how a
 * client bug reads as an upstream hole for a day. See
 * `dev/plan-plot-2d-fix.md`, where a held request parameter did exactly that
 * to every 2-D chart in the app.
 */
export function fetchFailed() {
    return notDrawable('This chart could not be fetched. That is a request '
        + 'failure rather than a gap in what the library publishes, so it is '
        + 'worth trying again.');
}

// ---- controls ----------------------------------------------------------

/**
 * A point in the box, as the three cut positions it implies.
 *
 * Each cut is held as a fraction of its own range, because a fraction survives
 * a rebuild at a different window and a data coordinate does not. Holding x at
 * `xv` and y at `yv` is two of them; the third is the total through that point,
 * which is what makes a click on the surface place all three cuts through the
 * place that was clicked.
 */
function cutFractions(box, xv, yv) {
    const span = (lo, hi, v) => (hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5);
    const [x0, x1] = box.x;
    const [y0, y1] = box.y;
    return {
        cutX: span(x0, x1, xv),
        cutY: span(y0, y1, yv),
        cutS: span(x0 + y0, x1 + y1, xv + yv),
    };
}

/**
 * Where the walk is at `u`, as the same three fractions.
 *
 * Parameterized on the segment of `y = x` inside the box: hold x at `v`, hold y
 * at `v`, hold the total at `2v`. Where the two axes do not overlap there is no
 * such segment, and the walk falls back to sweeping each axis by `u`, which
 * still moves the picture and no longer claims the three cuts meet.
 */
function walkPositions(box, u) {
    const lo = Math.max(box.x[0], box.y[0]);
    const hi = Math.min(box.x[1], box.y[1]);
    if (!(hi > lo)) return { cutX: u, cutY: u, cutS: u };
    const v = lo + (hi - lo) * u;
    return cutFractions(box, v, v);
}

/**
 * The window box: a number the reader turns, which is a new request.
 *
 * `input` rather than `change`, so arrow keys and the spinner move the picture,
 * with the redraw deferred ~90 ms so a held key coalesces into one fetch rather
 * than one per repeat. Never written back into while focused: the value the
 * reader is typing is theirs until they leave.
 *
 * Held against `chart`, the registry name of the chart on screen, because the
 * number is a parameter of the request rather than a way of reading the
 * document. Sharing one number across charts is what stopped every 2-D chart
 * on every object at a91, `dev/plan-plot-2d-fix.md`.
 */
function windowBox(chart, onWindow) {
    const wrap = el('label', { className: 'exhibit-window' }, 'window ');
    const input = el('input', {
        type: 'number', min: '0', max: '12', step: '0.5',
        className: 'form-control form-control-sm exhibit-window-input',
        title: 'How deep to cut the quantile window: keep q(10^-w) to '
            + 'q(1 - 10^-w) of each component. 0 keeps the whole grid. The '
            + 'library chooses the grid from this before it reduces, so a '
            + 'deeper window is finer, not cropped',
    });
    const held = (view.windows || {})[chart];
    input.value = Number.isFinite(held) ? String(held) : '';
    input.placeholder = 'auto';
    let timer = null;
    input.addEventListener('input', () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            const raw = input.value.trim();
            const next = raw === '' ? null : Number(raw);
            if (raw !== '' && !(next >= 0 && next <= 12)) return;
            setView({ windows: windowsWith(view.windows, chart, next) });
            onWindow();
        }, 90);
    });
    wrap.appendChild(input);
    return wrap;
}

/**
 * The control strip, from the document and the handlers the mount holds.
 *
 * Parameters
 * ----------
 * doc : object
 *     The chart document, read for which controls it declares.
 * hooks : object
 *     `onChange`, `onReset`, `walking` and `onWalk` are the strip's own
 *     actions; `onWindow` is null on a document nobody can refetch (the
 *     bounds envelope, drawn from a premium the reader typed), and `chart` is
 *     the registry name its number is held against, null alongside it;
 *     `onExport` and
 *     `canExport` are the mesh writers, which act on the drawing rather than
 *     on the document and so are greyed rather than absent while there is no
 *     drawing to write.
 *
 * Notes
 * -----
 * A control appears if **any** axis or panel in the document declares its
 * reading, and acts on **every** one that does. So there is one log button
 * rather than one per panel, and a chart whose axes admit a single reading
 * shows no button at all rather than one that would do nothing.
 *
 * Centered under the panels, which is the only layout the strip needs now that
 * every control governs the whole chart by construction. It used to split
 * across the two panels, because a control belonged to one of them.
 *
 * The handlers arrive as one object rather than as six positional arguments,
 * which is what the list had grown to. A call site passing five arrows and a
 * null says nothing about which is which, and the strip is still gaining
 * controls.
 */
/**
 * The SpaceMouse control: connect, connected, or greyed with a why.
 *
 * Its own function because it is the one button on the strip whose title changes
 * without the strip being rebuilt: the device sleeps, the receiver is unplugged,
 * and the reader is told, in place. The `watch` subscription is registered with
 * the strip, which drops it when the strip is rebuilt: without that, every
 * rebuild would leave another dead button being repainted for the life of the
 * page.
 *
 * **The label is always `spacemouse`.** Through a130 it became
 * `spacemouse: SpaceMouse Wireless` on connect, which signaled the state twice
 * and made the button grow enough to rewrap the whole strip, so connecting a
 * puck moved every control beside it. `.active` carries connected, which is the
 * fill the rest of the strip already uses for on, and the device name moves into
 * the title. A reader who wants to know *which* puck asks the button; a reader
 * who wants to know whether it is on sees the color.
 */
function spaceMouseButton(onSpaceMouse, register) {
    const btn = el('button', { type: 'button', className: 'exhibit-toggle' },
                   'spacemouse');
    const paint = () => {
        const on = spacemouse.isConnected();
        btn.classList.toggle('active', on);
        btn.disabled = !spacemouse.isSupported();
        btn.setAttribute('aria-disabled', btn.disabled ? 'true' : 'false');
        btn.title = btn.disabled
            ? 'This browser has no WebHID, so a 6DOF puck cannot be reached '
                + 'from a page. Chrome or Edge on the desktop can. The .obj '
                + 'download is the way in on every other browser: '
                + "3Dconnexion's own viewer navigates it natively"
            : (on
                ? `Connected to ${spacemouse.deviceName()}. Twist to orbit, `
                    + 'tilt to raise the camera, push and pull to zoom, slide '
                    + 'to pan. The left button puts the view back, the right '
                    + 'one swaps perspective and orthographic. Click to let the '
                    + 'device go'
                : 'Drive the relief with a 3Dconnexion SpaceMouse. One grant '
                    + 'per browser: after that it reattaches silently. Mouse '
                    + 'dragging keeps working throughout');
    };
    paint();
    register(spacemouse.watch(paint));
    btn.addEventListener('click', () => { onSpaceMouse().then(paint, paint); });
    return btn;
}

/**
 * The Download menu: one button, one item per format the drawing can leave as.
 *
 * Parameters
 * ----------
 * formats : Array<object>
 *     `{ext, label, why}` per item, in menu order.
 * onExport : function
 *     Called with the `ext` of the item pressed.
 * canExport : function
 *     Whether there is a drawing to write. Greys the button rather than hiding
 *     it, and carries the reason once instead of once per item.
 *
 * Returns
 * -------
 * HTMLElement
 *
 * Notes
 * -----
 * A menu rather than a button per format, which is what stood here through a130:
 * a `mesh` label followed by `.glb`, `.obj` and `.stl` sitting mid strip, four
 * nodes for one idea. The three per format sentences become the items' own hover
 * text, so nothing written is lost, and the button's title carries the sentence
 * they shared about the file being the box on screen.
 *
 * Bootstrap's dropdown is already loaded and delegates from the document, so a
 * menu built here works without being initialized. The Examples menu is the
 * pattern.
 */
function downloadMenu(formats, onExport, canExport) {
    const can = canExport();
    const wrap = el('div', { className: 'dropdown' });
    const btn = el('button', {
        type: 'button',
        className: 'exhibit-toggle dropdown-toggle',
        'data-bs-toggle': 'dropdown',
        'aria-expanded': 'false',
        title: can
            ? 'Save what is on screen. The file is the box you are looking at, '
                + 'so the log reading and the proportions come with it'
            : 'Nothing is drawn yet, so there is nothing to save',
        'aria-disabled': can ? 'false' : 'true',
    }, 'Download');
    btn.disabled = !can;
    wrap.appendChild(btn);
    const menu = el('ul', { className: 'dropdown-menu' });
    for (const { ext, label, why } of formats) {
        menu.appendChild(el('li', {}, el('button', {
            type: 'button', className: 'dropdown-item', title: why,
            onClick: () => onExport(ext),
        }, label)));
    }
    wrap.appendChild(menu);
    return wrap;
}

/** The picture, offered on every chart. */
const IMAGE_FORMAT = {
    ext: 'png',
    label: 'PNG image',
    why: 'The chart exactly as drawn, at twice the screen resolution, including '
        + 'every toggle and zoom since it was drawn',
};

/** The mesh writers, offered while a relief is the drawing on screen. */
const MESH_FORMATS = [
    {
        ext: 'glb',
        label: 'GLB mesh',
        why: 'One file, colored by height in the chart\'s own viridis, which is '
            + 'what makes it read as the picture rather than as a gray sheet',
    },
    {
        ext: 'obj',
        label: 'OBJ mesh',
        why: 'Geometry only, which every viewer and Blender read. This is the '
            + 'way in for a 6DOF puck on a browser with no WebHID: '
            + '3Dconnexion\'s own viewer navigates it natively',
    },
    {
        ext: 'stl',
        label: 'STL mesh',
        why: 'Geometry only, and the format a slicer wants. Masked cells are '
            + 'holes rather than invented geometry, so it is a surface and not '
            + 'a solid',
    },
];

function renderControls(doc, hooks) {
    const { chart, onChange, onReset, onWindow, walking, onWalk, onExport,
            canExport, onSpaceMouse, register, width } = hooks;
    const offered = readings(doc);
    const row = el('div', { className: 'exhibit-controls' });
    // `panelLayout` stacks panels one per row below `WIDE_PX`, and the strip
    // sits above a single canvas holding every grid, so under the breakpoint
    // left and right stop corresponding to anything. The groups stack the same
    // way and take their panel's title as a label, which is the only thing that
    // can say which group is which once they are no longer side by side.
    const stacked = (width ? width() : 0) < WIDE_PX;
    if (stacked) row.classList.add('exhibit-controls-stacked');
    // One group per panel, in document order, each holding only what that
    // panel's own axes declare. Author ruling 2026-08-21, reversing
    // `dev/done/plan-plot-ir-api.md` section 6 and restoring the arrangement
    // `dev/done/plan-exhibit-punchups-3.md` describes. Ten buttons in two
    // labeled halves reads as less cluttered than seven in one undifferentiated
    // centered row, because each half visibly belongs to the panel above it,
    // which the centered row could not say at all.
    // The document's own group. Created before the panel loop rather than after
    // it, because with a single panel the panel's buttons are folded into this
    // one and there has to be somewhere to fold them into.
    const box = el('div', { className: 'exhibit-group' });
    const panelGroups = [];
    for (const panel of offered.panels) {
        const group = el('div', { className: 'exhibit-group exhibit-group-panel' });
        if (stacked && offered.panels.length > 1 && panel.title) {
            group.appendChild(el('span', { className: 'exhibit-group-label' },
                                  panel.title));
        }
        for (const spec of CONTROLS) {
            // `offer` names the declaration that decides whether the button
            // exists, where it differs from the view key the button sets. Only
            // reference lines needs it: it is gated on the panel carrying marks
            // at all, and there is no reading called `refLines` to read.
            if (!panel[spec.offer || spec.key]) continue;
            const btn = el('button', {
                type: 'button',
                className: `exhibit-toggle${panelView(panel.id)[spec.key] ? ' active' : ''}`,
                title: spec.title,
                onClick: () => {
                    setPanelView(panel.id, { [spec.key]: !panelView(panel.id)[spec.key] });
                    btn.classList.toggle('active',
                                         Boolean(panelView(panel.id)[spec.key]));
                    onChange();
                },
            }, spec.label);
            group.appendChild(btn);
        }
        // A panel declaring nothing gets no group at all rather than an empty
        // one, which would draw a rule with nothing beside it.
        if (group.querySelector('button')) panelGroups.push(group);
    }
    // **One group is not a group.** `.exhibit-group-panel` is
    // `flex: 1 1 0; justify-content: center`, which exists so that with two
    // panels each group sits over its own half of the canvas, and
    // `.exhibit-group + .exhibit-group` draws a rule between them. With a single
    // panel that layout takes all the spare width, centers one or two buttons in
    // the middle of it, and separates them from everything else by a rule: the
    // surface's lone `log y` floating away from the strip is exactly this. The
    // layout was doing what it was built to do, on a case it was not built for.
    //
    // So a single panel's buttons go into the document group instead, at the
    // front, which keeps the house order of axis readings before realizations.
    // Not a surface special case: with one panel there is nothing for the half
    // and half layout to align to, and a labeled column of one is the
    // disconnected look on any chart. The `setPanelView` handlers are untouched;
    // only the parent node moves.
    if (panelGroups.length === 1) {
        const only = panelGroups[0];
        while (only.firstChild) box.appendChild(only.firstChild);
    } else {
        for (const group of panelGroups) row.appendChild(group);
    }
    // Everything below acts on the whole drawing rather than on one panel, so
    // the document group sits apart from the panel groups and takes only the
    // width it needs while they share what is left.
    //
    // The relief's own controls, between the readings and the realization:
    // they act on one drawing rather than on the document, and they exist only
    // while that drawing is the one on screen.
    const realized = view.kind || defaultKind(doc);
    const grid = (doc.panels || []).some((p) => p.kind === 'surface' || p.kind === 'heatmap');
    if (grid && (realized === 'surface' || realized === 'heatmap')) {
        for (const spec of SURFACE_CONTROLS) {
            if (realized !== 'surface' && !spec.flat) continue;
            const btn = el('button', {
                type: 'button',
                className: `exhibit-toggle${view[spec.key] ? ' active' : ''}`,
                title: spec.title,
                onClick: () => {
                    setView({ [spec.key]: !view[spec.key] });
                    btn.classList.toggle('active', Boolean(view[spec.key]));
                    onChange();
                },
            }, spec.label);
            box.appendChild(btn);
        }
    }
    // The cuts and the camera are the relief's alone: a flat image has no wall
    // to draw a conditional on and no camera to put back.
    if (grid && realized === 'surface') {
        // The cut is a choice among four rather than a toggle, and cycling one
        // button through them keeps the strip one row: none, each component
        // held in turn, the total, and all three at once.
        const cutBtn = el('button', {
            type: 'button',
            className: `exhibit-toggle${view.cut !== 'none' ? ' active' : ''}`,
            title: 'Cut the joint and read the conditional it leaves, drawn on '
                + 'the wall beside the marginal it should be compared with. On '
                + 'the total, the two means are kappa',
            onClick: () => {
                const next = CUT_MODES[(CUT_MODES.indexOf(view.cut) + 1) % CUT_MODES.length];
                setView({ cut: next });
                cutBtn.textContent = `cut: ${next}`;
                cutBtn.classList.toggle('active', next !== 'none');
                onChange();
            },
        }, `cut: ${view.cut}`);
        box.appendChild(cutBtn);

        // The walk. All three cuts move together out along y = x, the total
        // rising steadily, which is the one animation with an argument behind
        // it: watching kappa move as the total rises is the whole exercise.
        const walkBtn = el('button', {
            type: 'button',
            className: `exhibit-toggle${walking() ? ' active' : ''}`,
            title: 'Walk the cuts out along the diagonal, the total rising '
                + 'steadily, and watch where the split falls against an even one',
            onClick: () => {
                onWalk();
                walkBtn.classList.toggle('active', walking());
            },
        }, 'walk');
        box.appendChild(walkBtn);

        // The puck. Greyed with a why where WebHID is not, which is Firefox,
        // Safari and the iPad, so the control still says the feature exists
        // and that this browser is not covered, per the never-hide rule.
        box.appendChild(spaceMouseButton(onSpaceMouse, register));
        // No `feel` button beside it. a89 put the gains, the reverses, the
        // deadzone, the curve and a live readout behind one, and a136 took the
        // page of controls away again: see `surface-nav.js` `NAV_DEFAULTS` for
        // what the puck does now, which is one setting for everyone.
        // The window, last, and a number rather than a toggle: it is the one
        // control that is a new request rather than a new drawing.
        if (onWindow) box.appendChild(windowBox(chart, onWindow));
    }

    // The realization control, last, per the house order: axis readings before
    // panel realizations.
    for (const kind of offered.kinds) {
        const active = () => (view.kind || defaultKind(doc)) === kind;
        const btn = el('button', {
            type: 'button',
            className: `exhibit-toggle${active() ? ' active' : ''}`,
            title: `Draw the grid as ${KIND_LABELS[kind] || kind}`,
            onClick: () => { setView({ kind }); onChange(); },
        }, KIND_LABELS[kind] || kind);
        box.appendChild(btn);
    }

    // Download, second to last, on every chart. It is the drawing leaving the
    // app, so it belongs after everything that decides what the drawing is.
    //
    // **PNG on every chart, the three mesh writers only on a relief.** The menu
    // is meant to be the one place a drawing leaves, so offering three mesh
    // formats and not the picture would be an odd set, and the header More
    // menu's "Download plot" came out at a131 rather than sitting beside it
    // saying the same thing in another place. That item also only ever reached
    // three of the five charts, because the handler behind it read a hard coded
    // trio of chart handles and the Pricing group's kappa curves were not among
    // them. The strip is rendered by every chart mount, so this reaches all of
    // them.
    //
    // Client side and off the option in hand, for both kinds of file: the reader
    // is looking at a particular drawing, at a particular window, on the log
    // reading or not, and a file fetched instead would be a second rendering
    // that agrees with the picture only by luck.
    const surfaceDrawn = grid && realized === 'surface';
    box.appendChild(downloadMenu(
        surfaceDrawn ? [IMAGE_FORMAT, ...MESH_FORMATS] : [IMAGE_FORMAT],
        onExport,
        // A picture can always be written; a mesh needs a drawn relief. So the
        // menu is only greyed when the one thing it offers is unavailable.
        surfaceDrawn ? canExport : () => true));

    // Reset, last of the group, on every chart. It acts on the whole drawing
    // rather than on one reading, so it belongs after the readings, after the
    // surface controls, after the Download menu and after the realization
    // control. The author's a117 note put it at the end on the grounds that it
    // acts on the whole drawing, and that still holds.
    //
    // Unconditional, per the author: every plot has some controls in practice,
    // so a one-button strip is close to hypothetical, and a chart a reader has
    // pinch zoomed into a corner needs a way back whatever else it offers. On a
    // 2-D chart there was none: the reset lived inside the surface-only block
    // and double click, which is the gesture that did the job, is spent on page
    // zoom on iOS and refused by zrender's own 700ms touch guard besides.
    //
    // It goes through its own handler rather than through `onChange` because
    // the camera lives in the renderer instance and survives an ordinary redraw
    // by design, so the one control whose job is to swing the box back needs a
    // new instance.
    box.appendChild(el('button', {
        type: 'button',
        className: 'exhibit-toggle',
        title: 'Back to the default view: the full range, and the camera with '
            + 'it on a surface',
        onClick: () => onReset && onReset(),
    }, 'reset'));

    // No `if (!box.childNodes.length) return null` guard here any more. With
    // reset always appended the box is never empty, and a line claiming a case
    // that cannot arise is worse than no line.
    row.appendChild(box);
    return row;
}

/**
 * The realization a document takes when the reader has not picked one.
 *
 * What the document declares. A surface draws in relief, which is the reading
 * it exists for; the flat one is a click away and is what a machine without
 * WebGL falls back to.
 *
 * This returned 'heatmap' from 2026-08-09, the author's interim ruling while
 * the 3-D design was unsettled, and lifted 2026-08-12. Kept as a function
 * rather than folded away because the pressed state of the realization control
 * reads it, and because "what a document draws as by default" is a question
 * worth having one answer to.
 */
function defaultKind(doc) {
    const panels = (doc && doc.panels) || [];
    return panels.some((p) => p.kind === 'surface') ? 'surface' : null;
}

// ---- mount -------------------------------------------------------------

/**
 * Fetch a chart document and draw it.
 *
 * Parameters
 * ----------
 * container : HTMLElement
 *     Already attached, so the chart can size to it. The control strip and the
 *     canvas are both created inside it.
 * spec : object
 *     `{id, chart}`, an object id and a chart registry name.
 *
 * Returns
 * -------
 * Promise<object|null>
 *     A handle with `dispose()`, or null when the served document carries
 *     nothing this renderer can draw. A null is the caller's cue to say so; it
 *     is never an approximation.
 *
 * Raises
 * ------
 * Error
 *     When the document could not be fetched at all. Separated from the null
 *     so the caller can tell the reader which of the two happened: one is a
 *     statement about the library, the other is not. See `fetchFailed`.
 */
export async function mountChart(container, spec) {
    empty(container);
    const tools = el('div');
    const host = el('div', { className: 'exhibit-canvas' });
    container.appendChild(tools);
    container.appendChild(host);
    // The outline first, at its final size, before anything is fetched. A
    // document for a book at log2 16 is megabytes; a chart that sizes itself on
    // arrival shoves everything below it down the page at the moment the reader
    // has started reading.
    showPlaceholder(host, spec.chart, host.clientWidth || 0);

    const params = chartParamsFor(view, spec.chart);
    let doc;
    try {
        const [payload] = await Promise.all([
            api.chartDoc(spec.id, spec.chart, params),
            loadStyle().catch(() => null),   // colors are a bonus, not a blocker
        ]);
        doc = payload;
    } catch {
        // A fetch that carried parameters and failed retries without them, so
        // held request state can only ever cost the reader the depth they
        // asked for, never the chart. Defense in depth: with the window held
        // per chart this should not fire, and it is cheap insurance against
        // the next parameter that outlives the control offering it.
        doc = Object.keys(params).length
            ? await api.chartDoc(spec.id, spec.chart, {}).catch(() => null)
            : null;
        if (!doc) {
            empty(container);
            throw new Error('chart document could not be fetched');
        }
    }
    return draw(container, tools, host, doc, spec);
}

/**
 * Draw a chart document already in hand.
 *
 * The bounds envelope arrives this way: it is a document about a `Bounds` built
 * from a premium the reader typed, so the fetch is the form's, not this
 * module's.
 */
export function mountChartDoc(container, doc) {
    empty(container);
    const tools = el('div');
    const host = el('div', { className: 'exhibit-canvas' });
    container.appendChild(tools);
    container.appendChild(host);
    return draw(container, tools, host, doc);
}

/**
 * The shared body: build, render, wire the strip, the zoom and the resize.
 *
 * Returns null rather than throwing when the document has no realizable panel,
 * so a caller can put the plain "not yet" pane up instead.
 */
function draw(container, tools, host, doc, spec = null) {
    if (!doc) { empty(container); return null; }

    // The legend, which is also the readout. One strip carrying the swatch, the
    // name and the value under the cursor, in ordinary page text, above the
    // canvas where a legend belongs.
    //
    // a63 put the readout in a strip **below** the chart and left ECharts' own
    // legend drawing above it, so the page grew a second thing where the author
    // had asked for one. The ask was uPlot's: the legend is where the values
    // live. So the built-in legend is declared and not drawn (it still owns
    // series selection), and this takes both jobs.
    //
    // Inserted before the canvas rather than appended, and created before the
    // first render, so it holds its own height from the start and nothing below
    // the chart moves when a reader puts the cursor on it.
    const readout = el('div', { className: 'chart-readout' });
    container.insertBefore(readout, host);

    let zoom = null;
    let renderer = null;
    let drawn = null;
    let ready = false;
    // The walk is not view state: it is a thing happening now, and a sticky one
    // would have every chart open mid-animation.
    let walking = false;
    let walkFrame = null;

    // The camera the reader is holding. Read off the live chart before every
    // rebuild and sent back in the next option, so adjusting a control changes
    // the picture and leaves the point of view where it was. Without this,
    // every toggle snaps the box back to the default angle, and the walk, which
    // rebuilds twenty times a second, fights the reader for the camera and
    // wins.
    let camera = null;

    const options = () => ({
        view: { ...view, kind: view.kind || defaultKind(doc) },
        width: host.clientWidth || 0,
        zoom,
        camera,
        overrides: overridesFor(doc),
    });

    function build() {
        const next = chartdocToEcharts(doc, options());
        if (!next) return null;
        // A 3-D realization needs its renderer chunk, which is lazy and may not
        // have landed. Falling back to the flat reading is honest: it is the
        // same grid, and the reader is told which one they are looking at by
        // the control's pressed state.
        if (next.is3d && !surfaceReady) {
            return chartdocToEcharts(doc, { ...options(), view: { ...view, kind: 'heatmap' } });
        }
        return next;
    }

    // Which series the reader has switched off, by name, so a redraw does not
    // silently switch them all back on. Series selection lives in the ECharts
    // legend model, which a rebuild replaces, so the page holds the answer.
    const hidden = new Set();

    /**
     * Draw the legend, with the values under the cursor filled in.
     *
     * Every series is always listed, whether the cursor is over it or not: this
     * is a legend first, so the names and swatches are the standing content and
     * the values are what arrives on hover. That is the difference between this
     * and the a63 strip, which was empty until pointed at and therefore had to
     * carry a "point at the chart" instruction to explain its own blankness.
     *
     * @param {object|null} model `{head, rows}` from the adapter, or null when
     *   the cursor is off the chart, which leaves the names and blanks the
     *   values rather than emptying the strip.
     */
    /**
     * The last cell clicked, as `[x, y, h]`, or null before the first click.
     *
     * Held here rather than in `view` because it is about this drawing rather
     * than about how the document is read: it does not belong in a persisted
     * view and it has nothing to say to a rebuilt chart.
     */
    let pointer = null;

    /**
     * The clicked cell as readout rows: three names, blank until a click.
     *
     * The formatting lives on the document's own `cellReader`, put there by
     * `surfaceOverrides`, so the strip prints the height to the precision the
     * encoding actually carried and keeps the log-floor and quantized cases the
     * tooltip used to make. See `surface.js`.
     */
    function pointerRows() {
        const read = drawn && drawn.cellReader;
        return read ? read(pointer) : [];
    }

    /**
     * The relief's strip: what the cut is standing on, in a fixed place.
     *
     * Not a tooltip. On a 3-D scene a tooltip follows the cursor over the thing
     * it is describing and hides it, and the numbers here belong to the cut
     * rather than to wherever the pointer happens to be, so they are written
     * once per redraw and stay put. Above the canvas, where the 2-D charts
     * already put their readout, which is also where the room is.
     */
    function writeCutReadout(rows) {
        empty(readout);
        const where = (rows && rows.where) || [];
        const leaves = (rows && rows.leaves) || [];
        // The clicked cell, drawn first: it is where the reader pointed, which
        // comes before what the cut through that point is standing on and before
        // what it leaves. Names present with blank values from the first paint,
        // so the strip holds its height and nothing below the chart moves on the
        // first click. That is the same reason the readout node is created
        // before the first render.
        const at = pointerRows();
        if (!at.length && !where.length && !leaves.length) {
            readout.appendChild(el('span', { className: 'chart-readout-head is-idle' },
                                   'click the surface to cut it and read the cell'));
            return;
        }
        // Three lines: the cell clicked, where the cut is, then what it leaves.
        // One row would put the position of the cut and the answer it produces
        // in the same sentence, and they are not the same kind of thing.
        for (const group of [at, where, leaves]) {
            if (!group.length) continue;
            const line = el('div', { className: 'chart-readout-line' });
            for (const row of group) {
                const chip = el('span', {
                    className: 'chart-readout-item',
                    title: row.hint || row.name,
                });
                // The cell reading carries no color, and should not: the cut
                // lines have swatches because they name curves drawn on the
                // wall, while these three name a point the reader put there.
                if (row.color) {
                    chip.appendChild(el('i', {
                        className: 'chart-readout-swatch',
                        style: `background:${row.color}`, 'aria-hidden': 'true',
                    }));
                }
                chip.appendChild(el('span', { className: 'chart-readout-name' }, row.name));
                chip.appendChild(el('b', {}, row.value));
                line.appendChild(chip);
            }
            readout.appendChild(line);
        }
    }

    function writeReadout(model) {
        if (drawn && drawn.is3d) return;        // the relief writes its own
        empty(readout);
        const items = (drawn && drawn.legendItems) || [];
        if (!items.length) return;              // a grid panel keeps its own tooltip
        // Rows arrive per hovered series; a stem is two series under one name,
        // so keying by name is also what stops it being listed twice.
        const byName = new Map((model ? model.rows : []).map((r) => [r.name, r.value]));
        readout.appendChild(el('span', {
            className: `chart-readout-head${model ? '' : ' is-idle'}`,
        }, model ? model.head : 'hover to read'));
        for (const item of items) {
            const off = hidden.has(item.name);
            const chip = el('button', {
                type: 'button',
                className: `chart-readout-item${off ? ' is-off' : ''}`,
                title: `${off ? 'Show' : 'Hide'} ${item.name}`,
                onClick: () => toggleSeries(item.name),
            });
            chip.appendChild(el('i', {
                className: 'chart-readout-swatch',
                style: `background:${item.color}`, 'aria-hidden': 'true',
            }));
            chip.appendChild(el('span', { className: 'chart-readout-name' }, item.name));
            chip.appendChild(el('b', {}, byName.get(item.name) || ''));
            readout.appendChild(chip);
        }
    }

    /**
     * Show or hide one series from the legend, as clicking it always did.
     *
     * `dev/graphs.md` records select-by-legend as one of three things the author
     * liked unprompted at a30, so replacing the built-in legend without it would
     * have traded a liked behavior for a chore. The ECharts legend component is
     * still declared (drawn: false), which is what makes the action work.
     */
    function toggleSeries(name) {
        const chart = renderer && renderer.chart;
        if (!chart) return;
        const off = hidden.has(name);
        if (off) hidden.delete(name); else hidden.add(name);
        chart.dispatchAction({
            type: off ? 'legendSelect' : 'legendUnSelect', name,
        });
        writeReadout(null);
    }

    /**
     * Point the option's reading at the strip instead of at a floating box.
     *
     * The formatter is the hook: it is called with everything under the cursor,
     * writes the strip, and returns nothing for ECharts to draw. The adapter
     * builds the reading as *data* (`option.readout`), so nothing about what
     * the numbers say lives here and the model stays testable without a DOM.
     *
     * **`showContent: false` is the one thing that cannot be used to hide the
     * box, and a63 used it.** `TooltipView._showTooltipContent` reads
     * `showContent` and returns *before* it reads the formatter
     * (`echarts/lib/component/tooltip/TooltipView.js:539`), so the flag does not
     * mean "call the formatter and draw nothing", it means "do nothing at all".
     * The readout strip shipped at a63 therefore never displayed a single value:
     * it sat under every chart saying "point at the chart to read values off
     * it", and pointing at the chart did nothing. Found by hovering one,
     * which is the whole argument for the browser pass this round added.
     *
     * So the content stays on and the **box** is hidden in CSS. The axis pointer
     * and the highlighted symbol are unaffected either way; they are drawn by
     * the axisPointer component, not by the tooltip's DOM.
     */
    function useStrip(option) {
        if (!option.readout || !option.tooltip) return option;
        option.tooltip = {
            ...option.tooltip,
            showContent: true,
            extraCssText: 'display:none!important',
            formatter: (params) => { writeReadout(option.readout(params)); return ''; },
        };
        return option;
    }

    /**
     * Save the drawn surface as a mesh file.
     *
     * Parameters
     * ----------
     * format : str
     *     'glb', 'obj' or 'stl'.
     *
     * Notes
     * -----
     * Client side and off the option in hand, for the same reason the PNG
     * download is: the reader is looking at a particular drawing, at a
     * particular window, on the log reading or not, and a file fetched instead
     * would be a second rendering that agrees with the picture only by luck.
     *
     * A lattice too small to triangulate raises rather than returning an empty
     * mesh, and here that means the button does nothing. Saving a file with no
     * triangles in it would be worse: it opens, and it is empty.
     */
    /**
     * Save the chart on screen as a PNG.
     *
     * Parameters
     * ----------
     * stem : str
     *     The file stem, without the extension.
     *
     * Notes
     * -----
     * `getDataURL` returns exactly what is on screen, including every
     * interaction since it was drawn, which is the same argument `saveMesh`
     * makes below. `pixelRatio: 2` so the file is worth pasting into a document
     * rather than being a screenshot of a 400px canvas, and an explicit white
     * ground because the canvas itself is transparent and a PNG of a chart on
     * nothing reads as a chart on black in half the viewers that open it.
     *
     * This moved here from `main.js` at a131 with the header menu item it used
     * to back. There it read a hard coded trio of chart handles and so missed
     * the Pricing group's kappa curves; here it is the mount's own chart, so
     * every chart that draws a strip can save itself.
     */
    function savePng(stem) {
        const chart = renderer && renderer.chart;
        if (!chart) return;
        const url = chart.getDataURL({ type: 'png', pixelRatio: 2,
                                       backgroundColor: '#fff' });
        const link = el('a', { href: url, download: `${stem}.png` });
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function saveMesh(format) {
        const source = drawn && drawn.meshSource;
        if (!source) return;
        let mesh;
        try {
            mesh = surfaceMesh(source, { box: source.box, zRange: source.zRange });
        } catch {
            return;
        }
        const stem = fileStem(source.name);
        // The ramp is the drawn option's, stretch baked in, passed in rather
        // than restated, so the file and the colorbar cannot disagree about
        // what a height looks like.
        const writers = {
            glb: [() => meshToGlb(mesh, stem,
                                  { ramp: source.ramp || VIRIDIS,
                                    colorRange: source.colorRange }),
                  'model/gltf-binary'],
            obj: [() => meshToObj(mesh, stem), 'text/plain'],
            stl: [() => meshToStl(mesh, stem), 'model/stl'],
        };
        const [write, type] = writers[format] || writers.stl;
        const body = write();
        const url = URL.createObjectURL(new Blob([body], { type }));
        const link = el('a', { href: url, download: `${stem}-surface.${format}` });
        document.body.appendChild(link);
        link.click();
        link.remove();
        // Revoked on the next turn of the loop rather than at once: the click
        // has to have started the download before the URL stops resolving.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    /**
     * Rebuild the strip when the answer to "is there a surface to save" moves.
     *
     * The strip is built before the first draw, so the export buttons are
     * greyed when they are created and would stay greyed for the life of the
     * chart. They read the drawing rather than the document, which is what
     * makes them the one pair of controls whose state the render decides.
     */
    /**
     * The puck, against this chart's camera.
     *
     * One nav for the life of the mount, reading the live instance through
     * these two closures rather than holding it. A rebuild between two frames
     * replaces the ECharts instance, and a captured reference would be driving
     * a disposed camera by the next tick; a closure is simply null for one
     * frame and correct on the following one.
     *
     * `read` returns null while the flat reading is on screen, which is what
     * makes the loop harmless there: the axes still arrive, nothing is driven,
     * and it stops as soon as the reader lets go.
     */
    const liveCamera = () => {
        const chart = renderer && renderer.chart;
        return (ready && chart && drawn && drawn.is3d) ? readCamera(chart) : null;
    };
    const nav = createSurfaceNav({
        read: liveCamera,
        write: (patch) => {
            const chart = renderer && renderer.chart;
            if (!ready || !chart) return;
            // Merged, not `notMerge`: everything else about the grid3D stands,
            // and `animation: false` because this is a rate controller. Eased
            // camera updates at sixty frames a second would each chase the
            // previous one and the box would swim.
            chart.setOption({ grid3D: { viewControl: { ...patch, animation: false } } });
        },
        reset: () => { if (ready) resetView(); },
        setProjection: (projection) => {
            const chart = renderer && renderer.chart;
            if (!ready || !chart) return;
            chart.setOption({ grid3D: { viewControl: { projection, animation: false } } });
        },
    // No settings argument: the nav runs on `NAV_DEFAULTS`. a89 to a134 passed
    // the reader's stored feel here, which is what let a browser carry a bad
    // tuning forever, and a136 took that layer out.
    });
    const navOff = spacemouse.subscribe((message) => nav.input(message));

    // Whether the page has already looked for a device it was granted. Once
    // per mount, and only once a surface is actually on screen: a reader who
    // never opens a bivariate never touches WebHID.
    let asked = false;

    // What the strip subscribed to, dropped when the strip is rebuilt.
    let stripOff = [];

    let exportable = false;
    function syncTools() {
        const can = Boolean(drawn && drawn.meshSource);
        if (can === exportable) return;
        exportable = can;
        renderTools();
    }

    function render() {
        if (renderer && renderer.chart) camera = readCamera(renderer.chart) || camera;
        const next = build();
        if (!next) return false;
        drawn = useStrip(next);
        host.style.height = `${next.hostHeight}px`;
        if (!renderer) {
            // `empty` clears the skeleton, which the chart would otherwise draw
            // over rather than replace.
            empty(host);
            renderer = echartsRenderer(host, next);
        } else {
            renderer.update(next);
        }
        // After every render, not only the first: switching a panel between its
        // 2-D and 3-D realizations disposes the instance and builds a new one,
        // and the listeners would be left on the dead one. Each unbinds before
        // it binds, so re-arming costs nothing on the ordinary path.
        wireGestures();
        if (next.is3d) writeCutReadout(next.cutReadout);
        if (next.is3d && !asked) {
            // A grant already given should not need a second click, so the
            // device is reopened silently the first time a relief is drawn.
            asked = true;
            spacemouse.reattach().catch(() => { /* no device, the ordinary case */ });
        }
        // Re-apply what the reader switched off, for the same reason: a rebuilt
        // option carries a fresh legend model with everything selected, so a
        // hidden series would come back every time the log button was pressed.
        for (const name of hidden) {
            renderer.chart.dispatchAction({ type: 'legendUnSelect', name });
        }
        writeReadout(null);
        syncTools();
        return true;
    }

    /**
     * The two gestures: zoom, and double-click to undo it.
     *
     * **Zoom** redraws only when it changes which rung of the drawing ladder
     * applies. Guarded twice, because a wheel gesture fires continuously: the
     * rung has to actually change, and the answer comes from a count rather
     * than from a trial build. `chartdocToEcharts` then writes the held zoom
     * back into the new dataZoom config, so the gesture survives its own
     * consequence.
     *
     * **Double-click** runs `resetView`, the same one the `reset` button runs.
     * On the zrender layer rather than on the chart, because
     * `chart.on('dblclick')` fires only over a graphic element and the reader
     * who has zoomed too far is usually over blank canvas. It costs no pixels,
     * which is why it is kept over `toolbox.feature.restore` and its corner
     * cluster of buttons.
     *
     * It is no longer the only way back, and could not be on an iPad: the
     * second tap of a double tap lands inside zrender's 700ms `scope.touching`
     * guard and is discarded, and with `touch-action: manipulation` the gesture
     * is spent on the page anyway. That is what the `reset` button on every
     * chart is for, and it is the answer for a projector and a keyboard too.
     */
    function wireGestures() {
        const chart = renderer && renderer.chart;
        if (!chart) return;
        chart.off('globalout');
        chart.on('globalout', () => writeReadout(null));
        // Click to place the cuts. Hover picking on a surface is O(n^2) per
        // event in echarts-gl, which stalls a software renderer, so a click is
        // both the cheaper gesture and the one that leaves the cut where it was
        // put rather than under wherever the cursor drifted to.
        //
        // All three cuts go through the clicked point: x held there, y held
        // there, and the total through it. On the total the two coordinates do
        // not matter separately, only their sum, which is why a click anywhere
        // on one anti-diagonal gives the same total cut.
        chart.off('click');
        chart.on('click', (params) => {
            const box = drawn && drawn.surfaceBox;
            const value = params && params.value;
            if (!box || !Array.isArray(value) || value.length < 2) return;
            if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) return;
            setWalk(false);
            // The cell reading, into the strip. The same gesture that places the
            // cuts, because the reader is pointing at one place and asking two
            // questions about it: what is here, and what does a cut through here
            // leave. Updating on click rather than live is what the author asked
            // for and is also what the picking cost allows.
            pointer = value;
            const patch = cutFractions(box, value[0], value[1]);
            // A click with no cut showing has to show one, or it does nothing
            // visible and reads as a dead gesture. Kept even though the reading
            // now always gives a click something visible to do: changing it is a
            // separate behavior decision.
            if (view.cut === 'none') patch.cut = 'all';
            setView(patch);
            renderTools();
            render();
        });
        const zr = chart.getZr();
        zr.off('dblclick');
        // The same reset the button runs, rather than the half of it this used
        // to do. It dropped the held zoom and left the surface's readings and
        // camera alone, while the button did the reverse, so neither was a
        // reset and a reader could get a drawing into a state neither undid.
        zr.on('dblclick', () => { if (ready) resetView(); });
        if (!drawn || !drawn.lossWindow) return;
        chart.off('dataZoom');
        chart.on('dataZoom', () => {
            const w = drawn && drawn.lossWindow;
            if (!w || !(w[1] > w[0])) return;
            // Read back off the chart rather than out of the event: an `inside`
            // dataZoom reports a batch on some gestures and bare start / end on
            // others, and the component's own state is always current.
            const dz = (chart.getOption().dataZoom || [])[0];
            if (!dz || dz.start == null) return;
            const span = w[1] - w[0];
            const full = dz.start <= 0 && dz.end >= 100;
            const next = full ? null : [w[0] + (span * dz.start) / 100,
                                        w[0] + (span * dz.end) / 100];
            zoom = next;
            if (rungAt(drawn, next) === (drawn.rung || {}).drawnAs) return;
            render();
        });
    }

    // Which realization the strip was built for. The relief's controls exist
    // only while the relief is on screen, so a switch to the flat reading has
    // to rebuild the strip rather than leave four buttons that act on a
    // drawing nobody is looking at.
    let stripKind = view.kind || defaultKind(doc);

    function renderTools() {
        for (const off of stripOff) off();
        stripOff = [];
        empty(tools);
        const strip = renderControls(doc, {
            chart: spec ? spec.chart : null,
            onChange: () => { if (ready) onToggle(); },
            onReset: () => { if (ready) resetView(); },
            onWindow: spec ? () => { if (ready) refetch(); } : null,
            walking: () => walking,
            onWalk: () => setWalk(!walking),
            // One entry point for every format the Download menu offers. The
            // picture is the chart's own canvas, the three meshes are the drawn
            // height field, and the strip does not have to know which is which.
            onExport: (format) => (format === 'png'
                ? savePng(fileStem(doc.title || (spec && spec.chart) || 'chart'))
                : saveMesh(format)),
            canExport: () => Boolean(drawn && drawn.meshSource),
            onSpaceMouse: () => (spacemouse.isConnected()
                ? spacemouse.disconnect()
                : spacemouse.connect()),
            register: (off) => stripOff.push(off),
            // Read at render time rather than captured: the strip is rebuilt on
            // resize, and the group layout turns on the same breakpoint the
            // panels do.
            width: () => host.clientWidth || 0,
        });
        if (strip) tools.appendChild(strip);
    }
    renderTools();

    if (!render()) { empty(container); return null; }

    // Turning a 3-D realization on for the first time has to fetch its
    // renderer, so a toggle is not always a synchronous redraw.
    async function onToggle() {
        const kind = view.kind || defaultKind(doc);
        if (kind === 'surface' && !surfaceReady) {
            if (await loadSurface()) surfaceReady = true;
        }
        if (kind !== stripKind) { stripKind = kind; renderTools(); }
        render();
    }

    /**
     * Back to the default view, on every chart and from every route.
     *
     * One function, because there were two and they disagreed. The `reset`
     * button put the surface's readings and camera back and left a held `zoom`
     * in place, so a zoomed relief stayed zoomed after being reset; double
     * click dropped the zoom and touched nothing else, and existed only as a
     * gesture, which on iOS is spent on page zoom and refused by zrender's
     * 700ms touch guard anyway. Each was half a reset. This is the whole one.
     *
     * Dropping the held `zoom` is what puts the range back: the rebuilt option
     * carries a dataZoom with no start or end, which is the component's own
     * full-range default, and the redraw lands the drawing on the rung a full
     * window deserves.
     *
     * The camera is the reason the surface arm is not just a view reset and a
     * redraw. It lives in the renderer instance and survives `setOption`
     * deliberately, so that a reading toggled while the reader is looking at
     * the ridge does not swing the box back to the default angle. Which makes
     * the one control whose whole job is to swing it back need a new instance.
     */
    function resetView() {
        setWalk(false);
        zoom = null;
        if ((view.kind || defaultKind(doc)) === 'surface') {
            const patch = {};
            for (const key of SURFACE_KEYS) patch[key] = VIEW_DEFAULTS[key];
            setView(patch);
            if (renderer) { renderer.dispose(); renderer = null; }
        }
        renderTools();
        render();
    }

    /**
     * Fetch the document again, because the window is a request parameter.
     *
     * Not a client-side crop, and the difference is the point of the parameter:
     * the library chooses the reduction from the window *before* it reduces, so
     * a deeper window comes back finer rather than cropped. Cropping here could
     * only throw away resolution that had already been averaged out.
     */
    async function refetch() {
        if (!spec) return;
        let next;
        try {
            next = await api.chartDoc(spec.id, spec.chart, chartParamsFor(view, spec.chart));
        } catch {
            return;                     // the old document stays on screen
        }
        if (!ready || !next) return;
        doc = next;
        if (renderer) { renderer.dispose(); renderer = null; }
        render();
    }

    /**
     * The walk: all three cuts out along `y = x`, the total rising steadily.
     *
     * Parameterized on the diagonal rather than by a shared fraction of each
     * axis, which is `cutU`'s whole reason for being one number: the two axes
     * cover different intervals and the total is parameterized by a third range
     * again, so three cuts set to the same fraction of their own ranges drift
     * apart instead of crossing at the point being walked to.
     */
    function setWalk(on) {
        if (walking === on) return;
        walking = on;
        if (!on) {
            if (walkFrame) clearInterval(walkFrame);
            walkFrame = null;
            setView({});                // persist where it stopped
            return;
        }
        if (view.cut === 'none') setView({ cut: 'all' });
        // The walk is one parameter, and the three cuts are derived from it, so
        // they cross at the point being walked to. Setting each to the same
        // fraction of its own range does not: the two axes cover different
        // intervals and the total is parameterized by a third range again, so
        // three cuts that are supposed to meet drift apart instead.
        let u = 0;
        walkFrame = setInterval(() => {
            const box = drawn && drawn.surfaceBox;
            const chart = renderer && renderer.chart;
            if (!walking || !ready || !box || !chart) return;
            u = (u + WALK_INTERVAL / WALK_PERIOD) % 1;
            setView(walkPositions(box, u), false);
            // Only the cuts. A full rebuild decodes the grid, rebuilds a
            // hundred thousand surface vertices and hands echarts a new scene,
            // which at twenty frames a second is more work than the browser
            // has, and it is what made the walk crawl. These merge by id: the
            // set of cut series does not change while the walk runs, only
            // where they are.
            const bundle = surfaceCuts(drawn, view);
            if (!bundle) { render(); return; }
            chart.setOption({ series: bundle.series }, false);
            writeCutReadout(bundle.readout);
        }, WALK_INTERVAL);
    }

    ready = true;

    // A 3-D default has to ask for its own renderer. `build()` already falls
    // back to the flat reading while the lazy chunk is missing, so the first
    // draw of a surface is flat and then correct; what this adds is the asking,
    // which nothing did while the only path to `loadSurface` was a click on a
    // control that was not being offered.
    if (!surfaceReady && (view.kind || defaultKind(doc)) === 'surface') onToggle();

    // Rebuild on resize, always: every panel is sized from the host width so it
    // can hold the house aspect, which a bare `resize()` would not do.
    let lastWidth = host.clientWidth || 0;
    const ro = new ResizeObserver(() => {
        const width = host.clientWidth || 0;
        if (Math.abs(width - lastWidth) <= 8) return;
        const crossed = (width < WIDE_PX) !== (lastWidth < WIDE_PX);
        lastWidth = width;
        if (!ready) return;
        // The strip is rebuilt only when the breakpoint is actually crossed:
        // that is what changes whether the groups stack and carry their panel
        // titles, and rebuilding it on every resize tick would re-register the
        // puck's watchers for nothing.
        if (crossed) renderTools();
        render();
    });
    ro.observe(host);

    return {
        get option() { return drawn; },
        dispose() {
            ready = false;
            setWalk(false);
            // The puck outlives the chart: the grant and the open handle are
            // the page's, and reopening the device on every leaf switch would
            // put a chooser or a stall where there should be nothing. What
            // goes is this chart's claim on it.
            navOff();
            nav.dispose();
            for (const off of stripOff) off();
            stripOff = [];
            try { ro.disconnect(); } catch { /* already gone */ }
            if (renderer) renderer.dispose();
        },
        // The live chart, for the download button, which saves the picture on
        // screen rather than asking the server for a second rendering of it.
        get chart() { return renderer && renderer.chart; },
    };
}

/** The per-chart renderer chrome, which today only the 3-D realization needs. */
function overridesFor(doc) {
    const grid = (doc.panels || []).some((p) => p.kind !== 'xy');
    return grid
        ? ((ctx) => (ctx.logZ === undefined
            ? null
            : surfaceOverrides({ ...ctx, lights: view.lights !== false })))
        : null;
}

/**
 * The ECharts lifecycle, as a renderer handle.
 *
 * `notMerge` on every update: a reading can change an axis *type* (value to
 * log) and swap which series carry markLines, and a merged `setOption` would
 * leave the old ones behind. A 2-D to 3-D switch changes more than that, so the
 * instance is disposed and rebuilt, because ECharts cannot migrate a `grid`
 * option to a `grid3D` one in place.
 */
function echartsRenderer(host, option) {
    let is3d = Boolean(option.is3d);
    let chart = echarts.init(host, null, { renderer: 'canvas' });
    // On `host` rather than on the instance, so the listeners outlive the
    // dispose and re-`init` that `update` performs when a panel switches
    // between its flat and relief readings. See touch.js for what they are
    // compensating for, which is a defect in `echarts-gl` rather than here.
    const unstamp = stampTouchCoordinates(host);
    chart.setOption(option);
    linkPanels(chart, option);
    return {
        engine: 'echarts',
        get chart() { return chart; },
        update(next) {
            const next3d = Boolean(next.is3d);
            if (next3d !== is3d) {
                is3d = next3d;
                try { chart.dispose(); } catch { /* already gone */ }
                chart = echarts.init(host, null, { renderer: 'canvas' });
            }
            chart.setOption(next, true);
            chart.resize();
            linkPanels(chart, next);
        },
        dispose() {
            unstamp();
            try { chart.dispose(); } catch { /* already gone */ }
        },
    };
}

/**
 * Link the cursor across panels, pairing series by **name**.
 *
 * Series in different panels sharing a name are the same entity seen twice, so
 * hovering one highlights the others. That is the document's own statement
 * (`ChartSeries.name` is the legend identity), and it replaces the emission
 * order arithmetic this used to do: the old rule assumed both panels carried
 * the same series in the same order, which a portfolio's kappa panel and a
 * reinsurance document both break.
 */
function linkPanels(chart, option) {
    const series = option.series || [];
    if (series.length < 2) return;
    const byName = new Map();
    series.forEach((s, i) => {
        if (!s.name) return;
        if (!byName.has(s.name)) byName.set(s.name, []);
        byName.get(s.name).push(i);
    });

    // The mirrored dispatch re-enters this handler; the guard stops the panels
    // highlighting each other forever.
    let mirroring = false;
    chart.off('highlight');
    chart.on('highlight', (event) => {
        if (mirroring) return;
        const { seriesIndex, dataIndex } = event;
        if (seriesIndex == null || dataIndex == null) return;
        const name = (series[seriesIndex] || {}).name;
        const peers = (byName.get(name) || []).filter((i) => i !== seriesIndex);
        if (!peers.length) return;
        mirroring = true;
        try {
            for (const i of peers) {
                chart.dispatchAction({ type: 'highlight', seriesIndex: i, dataIndex });
            }
        } finally {
            mirroring = false;
        }
    });
}
