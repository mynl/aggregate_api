// Smoke-test the ECharts adapter over every chart document the library ships.
//
//     uv run python dev/scripts/capture_fixtures.py   # once, or after a library bump
//     node dev/scripts/smoke-charts.mjs               # replay, offline
//
// `chartdocToEcharts` is pure, so this needs no DOM, no WebGL and no server: it
// replays captured documents and checks the things that would show up as a
// broken chart rather than as an exception. A panel drawing nothing, a series
// whose coordinates never expanded, a window that collapsed, a reading the
// document declared that the adapter then ignored.
//
// It is a smoke test, not a rendering test. It cannot tell you the chart looks
// good; it tells you the document reached the renderer in a drawable shape, and
// that every reading it declares does something.

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// The chart modules are browser code. zrender sniffs the environment at import
// time and reads `document.documentElement.style`, so the stub carries that
// much. Nothing here renders.
const styleStub = new Proxy({}, { get: () => '', set: () => true });
globalThis.window = globalThis;
globalThis.document = {
    documentElement: { style: styleStub },
    createElement: () => ({ style: {}, getContext: () => null }),
    addEventListener() {},
};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const devDir = path.dirname(here);
const root = path.dirname(devDir);

const fixture = path.join(devDir, 'fixtures', 'charts.json');
if (!existsSync(fixture)) {
    console.error(`no ${fixture}\nrun: uv run python dev/scripts/capture_fixtures.py`);
    process.exit(2);
}

const {
    chartdocToEcharts, documentLayout, readings, rungAt, PANEL_ASPECT, WIDE_PX,
} = await import(pathToFileURL(
    path.join(root, 'web', 'src', 'charts', 'chartdoc-to-echarts.js')).href);

const cases = JSON.parse(readFileSync(fixture, 'utf8'));

let failures = 0;
const fail = (where, message) => { failures++; console.log(`  FAIL ${where}: ${message}`); };

/** Every drawn point of a series, as [x, y] pairs, gaps dropped. */
function points(series) {
    return (series.data || []).filter((p) => Array.isArray(p) && p[1] != null);
}

/** Panels whose footprint should hold the house aspect: not square, not a grid. */
function aspectChecked(doc) {
    return (doc.panels || []).every((p) => p.aspect !== 'equal' && p.kind === 'xy');
}

/**
 * The base checks, run for every document under every reading.
 *
 * Anything that is true of a drawable chart whatever it draws: a panel per
 * panel, an axis per panel, every series carrying at least one point, and a
 * finite window on every axis that declares one.
 */
function checkDrawable(label, doc, option) {
    if (!option) { fail(label, 'adapter returned null'); return false; }
    if (option.is3d) return true;           // the 3-D path has its own shape
    const panels = doc.panels.length;
    if (option.grid.length !== panels) {
        fail(label, `${option.grid.length} grids for ${panels} panels`);
    }
    if (option.xAxis.length !== panels || option.yAxis.length !== panels) {
        fail(label, `${option.xAxis.length}/${option.yAxis.length} axes for ${panels} panels`);
    }
    if (!option.series.length) fail(label, 'no series');
    for (const s of option.series) {
        // A stacked band's upper half and a stem's own base line are allowed to
        // be sparse; everything else must carry a drawn point.
        if (s.type === 'heatmap') {
            if (!(s.data || []).length) fail(label, `${s.name}: empty heatmap`);
            continue;
        }
        if (!points(s).length) fail(label, `${s.name}: no drawn points`);
    }
    for (const ax of [...option.xAxis, ...option.yAxis]) {
        for (const end of ['min', 'max']) {
            if (ax[end] !== undefined && !Number.isFinite(ax[end])) {
                fail(label, `axis ${ax.name}: ${end} is ${ax[end]}`);
            }
        }
        if (Number.isFinite(ax.min) && Number.isFinite(ax.max) && !(ax.max > ax.min)) {
            fail(label, `axis ${ax.name}: collapsed window [${ax.min}, ${ax.max}]`);
        }
        if (ax.type === 'log' && Number.isFinite(ax.min) && ax.min <= 0) {
            fail(label, `axis ${ax.name}: log axis with min ${ax.min}`);
        }
    }
    if (!(option.hostHeight > 0)) fail(label, `hostHeight ${option.hostHeight}`);
    return true;
}

/** Every human-facing string the option shows came from the document. */
function checkLabels(label, doc, option) {
    if (option.is3d) return;
    const known = new Set([
        doc.title, ...doc.panels.map((p) => p.title),
        ...doc.panels.map((p) => p.inverse_title),
        ...doc.axes.map((a) => a.label), ...doc.series.map((s) => s.name),
        ...(doc.marks || []).map((m) => m.label),
    ].filter(Boolean));
    for (const t of option.title || []) {
        // An inverted panel with no name of its own says so rather than
        // inventing one, which is the only string the adapter composes.
        if (!known.has(t.text) && !t.text.endsWith(', inverted')) {
            fail(label, `panel title ${JSON.stringify(t.text)} is not in the document`);
        }
    }
    for (const ax of [...option.xAxis, ...option.yAxis]) {
        if (ax.name && !known.has(ax.name)) {
            fail(label, `axis name ${JSON.stringify(ax.name)} is not in the document`);
        }
    }
    // The typeset forms are matplotlib's and must never reach a canvas.
    const tex = Object.values(doc.tex || {}).filter((v) => v.includes('$'));
    const shown = JSON.stringify([option.title, option.legend,
                                  option.xAxis.map((a) => a.name),
                                  option.yAxis.map((a) => a.name)]);
    for (const t of tex) {
        if (shown.includes(t)) fail(label, `typeset form ${JSON.stringify(t)} reached the chart`);
    }
}

/** A document's declared readings each do something when switched on. */
function checkReadings(label, doc, base) {
    const offered = readings(doc);
    const at = (view) => chartdocToEcharts(doc, { view, width: 980 });

    if (offered.log) {
        const logged = at({ log: true });
        if (!checkDrawable(`${label} [log]`, doc, logged)) return;
        const scales = (o) => [...o.xAxis, ...o.yAxis].filter((a) => a.type === 'log').length;
        // A grid panel reads its z axis through the color ramp rather than
        // through a drawn axis, so the log reading lands on the visualMap.
        const ramps = (o) => JSON.stringify((o.visualMap || []).map((v) => [v.min, v.max]));
        if (!(scales(logged) > scales(base)) && ramps(logged) === ramps(base)) {
            fail(label, 'log is declared but nothing changed scale');
        }
    }
    if (offered.fullRange) {
        const full = at({ fullRange: true });
        if (!checkDrawable(`${label} [full]`, doc, full)) return;
        // Widening can move either end: a signed outcome axis reaches further
        // down rather than further up.
        const wider = (a, b) => (Number.isFinite(a.max) && Number.isFinite(b.max)
                                 && a.max > b.max)
            || (Number.isFinite(a.min) && Number.isFinite(b.min) && a.min < b.min);
        const widened = full.xAxis.some((a, i) => wider(a, base.xAxis[i]))
            || full.yAxis.some((a, i) => wider(a, base.yAxis[i]));
        if (!widened) fail(label, 'full range is declared but no window widened');
    }
    if (offered.returnPeriod) {
        const rp = at({ returnPeriod: true });
        if (!checkDrawable(`${label} [rp]`, doc, rp)) return;
        const named = [...rp.xAxis, ...rp.yAxis].some((a) => a.name === 'Return period');
        if (!named) fail(label, 'return period is declared but no axis took the reading');
        // The map turns a probability into a period, so the drawn values must
        // move on the paired panel. Only that panel: a density panel names no
        // probability axis and is untouched by design.
        const moved = rp.series.some((s, i) => (
            base.series[i] && JSON.stringify(s.data) !== JSON.stringify(base.series[i].data)));
        if (!moved) fail(label, 'return period left every coordinate untouched');
    }
    if (offered.invert) {
        const inv = at({ invert: true });
        if (!checkDrawable(`${label} [invert]`, doc, inv)) return;
        const titles = new Set((inv.title || []).map((t) => t.text));
        const wanted = doc.panels.filter((p) => p.invertible)
            .map((p) => p.inverse_title).filter(Boolean);
        for (const t of wanted) {
            if (!titles.has(t)) fail(label, `inverted panel did not take its name ${t}`);
        }
        // An exchange swaps the axes, so the panel's x name must have moved.
        const moved = inv.xAxis.some((a, i) => a.name !== base.xAxis[i].name);
        if (!moved) fail(label, 'invert is declared but no panel exchanged its axes');
    }
    for (const kind of offered.kinds) {
        const drawn = at({ kind });
        if (!drawn) fail(label, `declared kind ${kind} does not realize`);
    }
}

/** The layout holds the target footprint, and stacks when the host is narrow. */
function checkLayout(label, doc) {
    const wide = documentLayout(doc, 980);
    const narrow = documentLayout(doc, 420);
    if (!wide.wide) fail(label, 'a 980px host did not lay out side by side');
    if (narrow.wide) fail(label, 'a 420px host did not stack');
    const rows = new Set(wide.grids.map((g) => g.top)).size;
    const cols = new Set(wide.grids.map((g) => g.left)).size;
    if (doc.panels.length > 1 && cols < 2) fail(label, 'wide layout put every panel in one column');
    if (narrow.grids.length > 1
        && new Set(narrow.grids.map((g) => g.left)).size !== 1) {
        fail(label, 'narrow layout did not stack into one column');
    }
    if (aspectChecked(doc)) {
        const ratio = wide.panelW / wide.footprint;
        // Clamped panels legitimately miss the target; an unclamped one must hit it.
        const clamped = wide.panelH <= 130 + 1 || wide.panelH >= 380 - 1;
        if (!clamped && Math.abs(ratio - PANEL_ASPECT) > 0.02) {
            fail(label, `panel footprint ${ratio.toFixed(3)} against ${PANEL_ASPECT.toFixed(3)}`);
        }
    }
    void rows;
}

/**
 * The reading under the cursor is available as data, and names its coordinate.
 *
 * The mount writes it into a strip in ordinary page text rather than letting a
 * box follow the pointer, so the model has to be complete without any markup:
 * a head naming the interrogated quantity, and one row per series with the
 * color its curve is drawn in.
 */
function checkReadout(label, doc, option) {
    if (option.is3d || !option.series.length) return;
    if (typeof option.readout !== 'function') {
        // A grid panel answers per item and has no axis reading to strip.
        if (doc.panels.every((p) => p.kind === 'xy')) fail(label, 'no readout model');
        return;
    }
    // One synthetic hover, shaped as ECharts delivers it.
    const first = option.series.findIndex((s) => points(s).length);
    const [x, y] = points(option.series[first])[0];
    const model = option.readout([{
        seriesIndex: first, seriesName: option.series[first].name,
        color: '#123456', marker: '', value: [x, y],
    }]);
    if (!model) { fail(label, 'readout answered nothing for a drawn point'); return; }
    if (!model.head || /^\s*$/.test(model.head)) fail(label, 'readout head is empty');
    if (!/[A-Za-z]/.test(model.head)) fail(label, `readout head names nothing: ${model.head}`);
    if (!model.rows.length || !model.rows[0].value) fail(label, 'readout row has no value');
}

/** Zooming to a handful of atoms reaches the stem rung on a discrete book. */
function checkLadder(label, doc, option) {
    if (!option.lossGrid || !option.rung) return null;
    const w = option.lossWindow;
    if (!w) return null;
    const tight = [w[0], w[0] + (w[1] - w[0]) / 500];
    return { full: option.rung.drawnAs, zoomed: rungAt(option, tight) };
}

for (const [name, entry] of Object.entries(cases)) {
    for (const [chart, doc] of Object.entries(entry.charts || {})) {
        const label = `${name}/${chart}`;
        if (!doc) { fail(label, 'no document captured'); continue; }
        if (doc.ir_version !== 2) fail(label, `ir_version ${doc.ir_version}`);
        const option = chartdocToEcharts(doc, { width: 980 });
        if (!checkDrawable(label, doc, option)) continue;
        checkLabels(label, doc, option);
        checkLayout(label, doc);
        checkReadout(label, doc, option);
        checkReadings(label, doc, option);
        const ladder = checkLadder(label, doc, option);
        const offered = readings(doc);
        const which = Object.entries(offered)
            .filter(([, v]) => (Array.isArray(v) ? v.length : v))
            .map(([k]) => k).join(' ') || 'none';
        const marks = (option.series || []).filter((s) => s.markLine).length;
        console.log(
            `${label.padEnd(22)} panels=${doc.panels.length} `
            + `series=${option.series.length} marks=${marks} `
            + `h=${option.hostHeight} readings=[${which}]`
            + (ladder ? ` ladder=${ladder.full}->${ladder.zoomed}` : ''));
    }
}

// Every mark in every document reaches the chart, which is the check that would
// have caught a mark placed on a panel id nothing draws.
for (const [name, entry] of Object.entries(cases)) {
    for (const [chart, doc] of Object.entries(entry.charts || {})) {
        if (!doc || !(doc.marks || []).length) continue;
        const option = chartdocToEcharts(doc, { width: 980 });
        if (!option) continue;
        const drawn = (option.series || [])
            .flatMap((s) => (s.markLine ? s.markLine.data : [])).length;
        if (drawn !== doc.marks.length) {
            fail(`${name}/${chart}`, `${doc.marks.length} marks, ${drawn} drawn`);
        }
    }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall clear');
process.exit(failures ? 1 : 0);
void WIDE_PX;
