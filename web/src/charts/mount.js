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
import { el, empty } from '../utils/dom.js';
import {
    chartdocToEcharts, panelLayout, readings, rungAt,
} from './chartdoc-to-echarts.js';
import { loadSurface, surfaceOverrides } from './surface.js';
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
};

let view = (() => {
    try {
        return { ...VIEW_DEFAULTS, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') };
    } catch {
        return { ...VIEW_DEFAULTS };
    }
})();

function setView(patch) {
    view = { ...view, ...patch };
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
 * The control strip for one document.
 *
 * A control appears if **any** axis or panel in the document declares its
 * reading, and acts on **every** one that does. So there is one log button
 * rather than one per panel, and a chart whose axes admit a single reading
 * shows no button at all rather than one that would do nothing.
 *
 * Centered under the panels, which is the only layout the strip needs now that
 * every control governs the whole chart by construction. It used to split
 * across the two panels, because a control belonged to one of them.
 */
function renderControls(doc, onChange) {
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
            api.chartDoc(spec.id, spec.chart),
            loadStyle().catch(() => null),   // colors are a bonus, not a blocker
        ]);
        doc = payload;
    } catch {
        empty(container);
        return null;
    }
    return draw(container, tools, host, doc);
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
function draw(container, tools, host, doc) {
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

    const options = () => ({
        view: { ...view, kind: view.kind || defaultKind(doc) },
        width: host.clientWidth || 0,
        zoom,
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
    function writeReadout(model) {
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

    function render() {
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
        // Re-apply what the reader switched off, for the same reason: a rebuilt
        // option carries a fresh legend model with everything selected, so a
        // hidden series would come back every time the log button was pressed.
        for (const name of hidden) {
            renderer.chart.dispatchAction({ type: 'legendUnSelect', name });
        }
        writeReadout(null);
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

    function renderTools() {
        empty(tools);
        const strip = renderControls(doc, () => { if (ready) onToggle(); });
        if (strip) tools.appendChild(strip);
    }
    renderTools();

    if (!render()) { empty(container); return null; }

    // Turning a 3-D realization on for the first time has to fetch its
    // renderer, so a toggle is not always a synchronous redraw.
    async function onToggle() {
        if ((view.kind || defaultKind(doc)) === 'surface' && !surfaceReady) {
            if (await loadSurface()) surfaceReady = true;
        }
        render();
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
    return grid ? ((ctx) => (ctx.logZ === undefined ? null : surfaceOverrides(ctx))) : null;
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
