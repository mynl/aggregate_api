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
    chartdocToEcharts, panelLayout, readings, rungAt, surfaceCuts,
} from './chartdoc-to-echarts.js';
import { fileStem, meshToObj, meshToStl, surfaceMesh } from './mesh-export.js';
import { createSurfaceNav } from './surface-nav.js';
import { loadSurface, readCamera, surfaceOverrides } from './surface.js';
import { echarts, loadStyle } from './theme.js';

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

// v3, because the state is now readings rather than the per-panel toggles the
// app used to own. A stored v2 would restore a view nobody chose.
const VIEW_KEY = 'aggapi.chartView.v3';

const VIEW_DEFAULTS = {
    log: false,          // every axis that declares a log reading
    fullRange: false,    // every axis that declares a full extent
    returnPeriod: false, // the paired reading of a probability axis
    invert: false,       // every panel that declares its axes exchange
    refLines: true,      // the document's marks: mean, capital anchors
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
    tips: true,
    cut: 'none',         // none | components | total | all
    // Where each cut sits, as a fraction of its own range. Three rather than
    // one because a click places a cut where the reader pointed, which is two
    // independent coordinates; the walk drives all three off the diagonal.
    cutX: 0.5,
    cutY: 0.5,
    cutS: 0.5,
    window: null,        // quantile depth asked of the library; null takes its default
};

/** Which view keys the relief owns, for the reset button to put back. */
const SURFACE_KEYS = ['mesh', 'wallGrid', 'marginals', 'contours', 'lights',
                      'tips', 'cut', 'cutX', 'cutY', 'cutS'];

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
        return { ...VIEW_DEFAULTS, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
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

// The controls, in the house order: axis readings first, then panel
// realizations, each family appended within its group as it arrives. Fixed so
// the strip does not reorder itself between charts and a reader's hand learns
// one layout.
//
// `key` names the reading in the view state; `offer` reads the document's
// declaration, which is what decides whether the button exists at all.
const CONTROLS = [
    {
        key: 'log',
        label: 'log',
        title: 'Read every axis that offers a log scale on log. Which axes '
            + 'those are is the document\'s statement, not a setting here',
    },
    {
        key: 'fullRange',
        label: 'full range',
        title: 'Show the whole extent of every axis that offers one, instead '
            + 'of the window the library computed from the data',
    },
    {
        key: 'returnPeriod',
        label: 'return period',
        title: 'Read a probability axis as the return period it pairs with: '
            + 'the same curve, interrogated at 1-in-200 rather than at 0.995',
    },
    {
        key: 'invert',
        label: 'invert',
        title: 'Exchange the axes of a panel that says they exchange. A '
            + 'quantile plot inverted is the distribution function',
    },
    // Offered whenever the document publishes marks, and **on** by default: the
    // mean and the capital anchors are what most readers came to see, and this
    // is the button for taking them away rather than for asking for them. It
    // existed before a62, did not survive the rewrite onto chart documents, and
    // its absence is punch item G3.
    {
        key: 'refLines',
        offer: 'marks',
        label: 'reference lines',
        title: 'Show the mean and the capital anchors the document marks, '
            + 'drawn on the panels that carry them',
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
    {
        key: 'tips',
        label: 'tips',
        title: 'The hover tooltip, which reads one cell under the cursor. The '
            + 'strip above the chart carries the cut\'s own numbers either way, '
            + 'and it neither moves nor covers what it describes',
    },
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
 */
function windowBox(onWindow) {
    const wrap = el('label', { className: 'exhibit-window' }, 'window ');
    const input = el('input', {
        type: 'number', min: '0', max: '12', step: '0.5',
        className: 'form-control form-control-sm exhibit-window-input',
        title: 'How deep to cut the quantile window: keep q(10^-w) to '
            + 'q(1 - 10^-w) of each component. 0 keeps the whole grid. The '
            + 'library chooses the grid from this before it reduces, so a '
            + 'deeper window is finer, not cropped',
    });
    input.value = Number.isFinite(view.window) ? String(view.window) : '';
    input.placeholder = 'auto';
    let timer = null;
    input.addEventListener('input', () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            const raw = input.value.trim();
            const next = raw === '' ? null : Number(raw);
            if (raw !== '' && !(next >= 0 && next <= 12)) return;
            setView({ window: next });
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
 *     bounds envelope, drawn from a premium the reader typed); `onExport` and
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
 * Its own function because it is the one button on the strip whose label and
 * title change without the strip being rebuilt: the device sleeps, the
 * receiver is unplugged, and the reader is told, in place. The `watch`
 * subscription is registered with the strip, which drops it when the strip is
 * rebuilt: without that, every rebuild would leave another dead button being
 * repainted for the life of the page.
 */
function spaceMouseButton(onSpaceMouse, register) {
    const btn = el('button', { type: 'button', className: 'exhibit-toggle' });
    const paint = () => {
        const on = spacemouse.isConnected();
        btn.textContent = on ? `spacemouse: ${spacemouse.deviceName()}` : 'spacemouse';
        btn.classList.toggle('active', on);
        btn.disabled = !spacemouse.isSupported();
        btn.setAttribute('aria-disabled', btn.disabled ? 'true' : 'false');
        btn.title = btn.disabled
            ? 'This browser has no WebHID, so a 6DOF puck cannot be reached '
                + 'from a page. Chrome or Edge on the desktop can. The .obj '
                + 'download is the way in on every other browser: '
                + "3Dconnexion's own viewer navigates it natively"
            : (on
                ? 'Connected. Twist to orbit, tilt to raise the camera, push '
                    + 'and pull to zoom, slide to pan. The left button puts the '
                    + 'view back, the right one swaps perspective and '
                    + 'orthographic. Click to let the device go'
                : 'Drive the relief with a 3Dconnexion SpaceMouse. One grant '
                    + 'per browser: after that it reattaches silently. Mouse '
                    + 'dragging keeps working throughout');
    };
    paint();
    register(spacemouse.watch(paint));
    btn.addEventListener('click', () => { onSpaceMouse().then(paint, paint); });
    return btn;
}

function renderControls(doc, hooks) {
    const { onChange, onReset, onWindow, walking, onWalk, onExport, canExport,
            onSpaceMouse, register } = hooks;
    const offered = readings(doc);
    const row = el('div', { className: 'exhibit-controls exhibit-controls-center' });
    const box = el('div', { className: 'exhibit-group' });
    for (const spec of CONTROLS) {
        // `offer` names the declaration that decides whether the button exists,
        // where it differs from the view key the button sets. Only reference
        // lines needs it: it is gated on the document carrying marks at all,
        // and there is no reading called `refLines` for it to read.
        if (!offered[spec.offer || spec.key]) continue;
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

        // Reset, last of the group. Back to the preset, camera included, which
        // is why it goes through its own handler rather than through
        // `onChange`: the camera lives in the renderer instance and survives an
        // ordinary redraw by design.
        box.appendChild(el('button', {
            type: 'button',
            className: 'exhibit-toggle',
            title: 'Back to the default view, camera included',
            onClick: () => onReset && onReset(),
        }, 'reset'));
        // The mesh, which is the drawing leaving the app: the surface on
        // screen as a file that 3Dconnexion's viewer, Windows 3D Viewer,
        // Blender or a slicer opens, and navigates with a 6DOF puck natively.
        // No round trip and no wire change: this writes the same drawn heights
        // ECharts is holding, which is what makes it a rendering of the served
        // document rather than a second opinion about it.
        for (const [ext, what] of [['stl', 'a slicer or Windows 3D Viewer'],
                                   ['obj', 'a viewer or Blender']]) {
            const can = canExport();
            const btn = el('button', {
                type: 'button',
                className: 'exhibit-toggle',
                title: can
                    ? `Save the drawn surface as ${ext.toUpperCase()}, for `
                        + `${what}. The file is the box on screen: the log `
                        + 'reading and the proportions come with it, and masked '
                        + 'cells are holes rather than invented geometry'
                    : 'No surface is drawn yet, so there is nothing to save',
                'aria-disabled': can ? 'false' : 'true',
                onClick: () => onExport(ext),
            }, `download .${ext}`);
            btn.disabled = !can;
            box.appendChild(btn);
        }
        // The puck. Greyed with a why where WebHID is not, which is Firefox,
        // Safari and the iPad, so the control still says the feature exists
        // and that this browser is not covered, per the never-hide rule.
        box.appendChild(spaceMouseButton(onSpaceMouse, register));
        // The window, last, and a number rather than a toggle: it is the one
        // control that is a new request rather than a new drawing.
        if (onWindow) box.appendChild(windowBox(onWindow));
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
    if (!box.childNodes.length) return null;
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
 *     A handle with `dispose()`, or null when the document could not be
 *     fetched or carries nothing this renderer can draw. A null is the
 *     caller's cue to say so; it is never an approximation.
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

    let doc;
    try {
        const [payload] = await Promise.all([
            api.chartDoc(spec.id, spec.chart, chartParams()),
            loadStyle().catch(() => null),   // colors are a bonus, not a blocker
        ]);
        doc = payload;
    } catch {
        empty(container);
        return null;
    }
    return draw(container, tools, host, doc, spec);
}

/**
 * The request parameters the held view implies.
 *
 * Only `window`, and only when the reader has moved it off the library's own
 * default. Sending a parameter to say "do what you would have done" would put
 * the app's idea of the default into the URL, the cache key and the ETag, and
 * the first time the library changed its mind the app would be overriding it
 * without anybody deciding to.
 */
function chartParams() {
    return Number.isFinite(view.window) ? { window: view.window } : {};
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
        if (!where.length && !leaves.length) {
            readout.appendChild(el('span', { className: 'chart-readout-head is-idle' },
                                   'click the surface to cut it'));
            return;
        }
        // Two lines: where the cut is, then what it leaves. One row would put
        // the position of the cut and the answer it produces in the same
        // sentence, and they are not the same kind of thing.
        for (const group of [where, leaves]) {
            if (!group.length) continue;
            const line = el('div', { className: 'chart-readout-line' });
            for (const row of group) {
                const chip = el('span', {
                    className: 'chart-readout-item',
                    title: row.hint || row.name,
                });
                chip.appendChild(el('i', {
                    className: 'chart-readout-swatch',
                    style: `background:${row.color}`, 'aria-hidden': 'true',
                }));
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
     *     'stl' or 'obj'.
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
        const body = format === 'obj' ? meshToObj(mesh, stem) : meshToStl(mesh, stem);
        const type = format === 'obj' ? 'text/plain' : 'model/stl';
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
    const nav = createSurfaceNav({
        read: () => {
            const chart = renderer && renderer.chart;
            return (ready && chart && drawn && drawn.is3d) ? readCamera(chart) : null;
        },
        write: (patch) => {
            const chart = renderer && renderer.chart;
            if (!ready || !chart) return;
            // Merged, not `notMerge`: everything else about the grid3D stands,
            // and `animation: false` because this is a rate controller. Eased
            // camera updates at sixty frames a second would each chase the
            // previous one and the box would swim.
            chart.setOption({ grid3D: { viewControl: { ...patch, animation: false } } });
        },
        reset: () => { if (ready) onReset(); },
        setProjection: (projection) => {
            const chart = renderer && renderer.chart;
            if (!ready || !chart) return;
            chart.setOption({ grid3D: { viewControl: { projection, animation: false } } });
        },
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
     * **Double-click** resets the view. On the zrender layer rather than on the
     * chart, because `chart.on('dblclick')` fires only over a graphic element
     * and the reader who has zoomed too far is usually over blank canvas.
     * Preferred to `toolbox.feature.restore`, which ships a corner cluster of
     * buttons and works against how hard a26 to a29 worked to keep the chrome
     * down: the gesture costs no pixels.
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
            const patch = cutFractions(box, value[0], value[1]);
            // A click with no cut showing has to show one, or it does nothing
            // visible and reads as a dead gesture.
            if (view.cut === 'none') patch.cut = 'all';
            setView(patch);
            renderTools();
            render();
        });
        const zr = chart.getZr();
        zr.off('dblclick');
        zr.on('dblclick', () => {
            // Dropping the held zoom is the whole reset: the rebuilt option
            // carries a dataZoom with no start or end, which is the component's
            // own full-range default, and the redraw puts the drawing back on
            // the rung a full window deserves.
            zoom = null;
            if (ready) render();
        });
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
            onChange: () => { if (ready) onToggle(); },
            onReset: () => { if (ready) onReset(); },
            onWindow: spec ? () => { if (ready) refetch(); } : null,
            walking: () => walking,
            onWalk: () => setWalk(!walking),
            onExport: (format) => saveMesh(format),
            canExport: () => Boolean(drawn && drawn.meshSource),
            onSpaceMouse: () => (spacemouse.isConnected()
                ? spacemouse.disconnect()
                : spacemouse.connect()),
            register: (off) => stripOff.push(off),
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
     * Back to the preset, camera included.
     *
     * The camera is the reason this is not just a view reset and a redraw. It
     * lives in the renderer instance and survives `setOption` deliberately, so
     * that a reading toggled while the reader is looking at the ridge does not
     * swing the box back to the default angle. Which makes the one control
     * whose whole job is to swing it back need a new instance.
     */
    function onReset() {
        setWalk(false);
        const patch = {};
        for (const key of SURFACE_KEYS) patch[key] = VIEW_DEFAULTS[key];
        setView(patch);
        if (renderer) { renderer.dispose(); renderer = null; }
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
            next = await api.chartDoc(spec.id, spec.chart, chartParams());
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
        lastWidth = width;
        if (ready) render();
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
            : surfaceOverrides({ ...ctx,
                                 lights: view.lights !== false,
                                 tips: view.tips !== false })))
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
