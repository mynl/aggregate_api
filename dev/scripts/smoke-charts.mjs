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

// The adapter's backstop, restated here rather than exported: the check below
// asserts a realized axis against it, and a test that imported the number it is
// testing could not tell a changed cap from a broken one. `_chartdoc`'s
// `MAX_RETURN_PERIOD`, and note it is a different thing from the library's
// `charts._two_panel.RETURN_PERIOD_TOP`, which is the suggested ladder.
const MAX_RETURN_PERIOD = 1e9;

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
        // A band's fill carries one datum it never reads, and everything else
        // must carry a drawn point.
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
        // **The return-period axis always carries a window.** The assertion the
        // old test could not make, and the one that would have caught the a120
        // defect: `xyPanel` discarded that axis' window outright, so the check
        // above passed cleanly because the min was `undefined` rather than
        // zero, and echarts auto-fitted a log axis over twelve decades and
        // picked a ten-decade tick interval. The bug was an *absent* bound, not
        // a bad one.
        //
        // Not written as the blanket "no log axis has an undefined minimum" the
        // plan drafted: a companion axis under a period reading is handed to
        // echarts to fit on purpose, and `sev_density` and `pdf` declare no
        // window at all and have always auto-fitted, so the blanket form fails
        // three documents that are drawing correctly.
        if (ax.name === 'Return period') {
            if (!Number.isFinite(ax.min) || !Number.isFinite(ax.max)) {
                fail(label, `axis ${ax.name}: unbounded [${ax.min}, ${ax.max}]`);
            }
            if (Number.isFinite(ax.max) && ax.max > MAX_RETURN_PERIOD) {
                fail(label, `axis ${ax.name}: max ${ax.max} over the ${MAX_RETURN_PERIOD} cap`);
            }
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
        ...doc.axes.map((a) => a.label), ...(doc.series || []).map((s) => s.name),
        ...(doc.marks || []).map((m) => m.label),
        // A tower's human strings live in its blocks, which is the whole of
        // what a panel drawn from `doc.blocks` has to say.
        ...(doc.blocks || []).flatMap((b) => [b.label, ...(b.label_lines || [])]),
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

/**
 * Each panel's declared readings do something when switched on, and nothing to
 * any other panel.
 *
 * Per panel since a121. The second half is the new claim and the one the
 * a-generation punch item asked for: pressing a button in one group must leave
 * every other panel completely still, which is checked here by realizing one
 * panel's reading at a time and comparing the untouched panels' axes against
 * the base drawing.
 */
function checkReadings(label, doc, base) {
    const offered = readings(doc);
    const at = (view) => chartdocToEcharts(doc, { view, width: 980 });
    const only = (id, patch) => at({ panels: { [id]: patch } });

    /** Every other panel's axes, as the string that must not move. */
    const others = (o, i) => JSON.stringify(
        o.xAxis.filter((_, k) => k !== i).concat(o.yAxis.filter((_, k) => k !== i)));

    offered.panels.forEach((panel, i) => {
        const P = `${label} [${panel.id}]`;
        /** Realize one reading on this panel, check it drew, check it was alone. */
        const solo = (key, tag) => {
            const o = only(panel.id, { [key]: true });
            if (!checkDrawable(`${P} [${tag}]`, doc, o)) return null;
            if (!o.is3d && others(o, i) !== others(base, i)) {
                fail(P, `${tag} on this panel moved another panel's axes`);
            }
            return o;
        };

        // Every reading this panel can be in, as the patches to compose the log
        // flag with. A position is offered on everything that can reach it, so
        // `log x` on a Lee panel is nothing under the plain reading, whose
        // abscissa is a probability with one scale, and is the whole point once
        // `reflect` or `return period` has put a two-scale axis there. The
        // assertion is therefore "some reading this panel offers takes it",
        // not "the plain one does": checking the plain reading alone would
        // demand the strip hide a button until another button was pressed,
        // which is the appearing and disappearing control the per-panel design
        // exists to avoid.
        const composed = [{}];
        for (const key of ['reflect', 'returnPeriod', 'invert']) {
            if (!panel[key]) continue;
            for (const base2 of [...composed]) composed.push({ ...base2, [key]: true });
        }
        /** Does any offered reading draw `position` on log when asked? */
        const reaches = (key, position) => composed.some((extra) => {
            const o = only(panel.id, { ...extra, [key]: true });
            return o && !o.is3d && o[position][i] && o[position][i].type === 'log';
        });

        if (panel.logX) {
            solo('logX', 'log x');
            if (!base.is3d && !reaches('logX', 'xAxis')) {
                fail(P, 'log x is offered but no reading put a log axis on x');
            }
        }
        if (panel.logY) {
            solo('logY', 'log y');
            // A surface reads its height through `zAxis3D` rather than through
            // a y axis, so the flat assertion does not apply to it and that it
            // drew at all is the check.
            if (!base.is3d && !reaches('logY', 'yAxis')) {
                fail(P, 'log y is offered but no reading put a log axis on y');
            }
        }
        if (panel.fullRange) {
            const o = solo('fullRange', 'full range');
            // Widening can move either end: a signed outcome axis reaches
            // further down rather than further up.
            const wider = (a, b) => (Number.isFinite(a.max) && Number.isFinite(b.max)
                                     && a.max > b.max)
                || (Number.isFinite(a.min) && Number.isFinite(b.min) && a.min < b.min);
            // Composed, for the reason `reaches` is: the button is offered on
            // everything that can reach the position, so the claim is "some
            // reading this panel offers takes it". The case that made this
            // necessary is the Lee panel beside a tower, whose loss axis is
            // sized exactly to the program it bands and so has nothing to
            // open, while the return period paired with its probability axis
            // runs from a ladder of 10^4 out to the 10^9 cap. Asking only the
            // plain reading would demand the strip hide the button until
            // another button was pressed.
            const widens = composed.some((extra) => {
                const open = only(panel.id, { ...extra, fullRange: true });
                const shut = only(panel.id, extra);
                return open && shut && !open.is3d && !shut.is3d
                    && (wider(open.xAxis[i], shut.xAxis[i])
                        || wider(open.yAxis[i], shut.yAxis[i]));
            });
            if (o && !o.is3d && !widens) {
                fail(P, 'full range is offered but no reading widened a window');
            }
        }
        if (panel.reflect) {
            const o = solo('reflect', 'reflect');
            if (o && !o.is3d) {
                // The reflected axis is a declared axis of its own, so it
                // arrives with its own name off the document.
                if (o.xAxis[i].name === base.xAxis[i].name
                    && o.yAxis[i].name === base.yAxis[i].name) {
                    fail(P, 'reflect is offered but no axis took the reading');
                }
                // The assertion the other readings do not make, and the reason
                // it is here: a reflection is a bijection of [0, 1] onto
                // itself, so unlike a return period it keeps its window. An
                // axis bounded before must still be bounded, or the panel has
                // lost its bounds, its nice interval and its zoom extent to the
                // return period's rule.
                const bounded = (o2) => [o2.xAxis[i], o2.yAxis[i]]
                    .filter((a) => Number.isFinite(a.min) && Number.isFinite(a.max)).length;
                if (bounded(o) < bounded(base)) {
                    fail(P, 'reflect dropped an axis window it should have kept');
                }
            }
        }
        if (panel.returnPeriod) {
            const o = solo('returnPeriod', 'return period');
            if (o && !o.is3d) {
                if (o.xAxis[i].name !== 'Return period'
                    && o.yAxis[i].name !== 'Return period') {
                    fail(P, 'return period is offered but no axis took the reading');
                }
                // The period axis keeps its declared window and the companion
                // follows the data, which is the pair of behaviors that used to
                // be exactly swapped. `checkDrawable` has already asserted the
                // period axis is bounded and under the cap; this is the other
                // half, that the companion was released.
                const onX = o.xAxis[i].name === 'Return period';
                const companion = onX ? o.yAxis[i] : o.xAxis[i];
                const wasBounded = Number.isFinite((onX ? base.yAxis : base.xAxis)[i].min);
                if (wasBounded && Number.isFinite(companion.min)
                    && Number.isFinite(companion.max)) {
                    fail(P, 'the companion axis kept its probability-reading crop');
                }
                // Both orientations, since `invert` moves the period onto the
                // other axis and the window and the cap have to follow it.
                if (panel.invert) {
                    solo2(P, only(panel.id, { returnPeriod: true, invert: true }),
                          doc, 'return period inverted');
                }
            }
        }
        if (panel.invert) {
            const o = solo('invert', 'invert');
            if (o && !o.is3d && o.xAxis[i].name === base.xAxis[i].name) {
                fail(P, 'invert is offered but the panel did not exchange its axes');
            }
        }
        if (panel.marks) {
            const o = only(panel.id, { refLines: false });
            checkDrawable(`${P} [no marks]`, doc, o);
        }
    });

    for (const kind of offered.kinds) {
        const drawn = at({ kind });
        if (!drawn) fail(label, `declared kind ${kind} does not realize`);
    }
}

/** One extra realization, checked drawable only. */
function solo2(where, option, doc, tag) {
    checkDrawable(`${where} [${tag}]`, doc, option);
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

/**
 * A `y2` series draws as the region between its two edges.
 *
 * The check a62 to a98 needed and did not have. The band was realized as two
 * line series sharing an ECharts `stack`, and stacking on twin `value` axes
 * sums the x coordinates rather than the y, so the envelope drew as a wavy
 * line at doubled abscissa with its fill sweeping under the diagonal. Nothing
 * threw and every other assertion here passed, which is why it survived so
 * long. Asserting the realization rather than the absence of an exception:
 * three series under the document series' one name, the two edges carrying
 * the document's own `y` and `y2`, and a closed ring over both of them.
 */
function checkBands(label, doc, option) {
    if (option.is3d) return;
    for (const band of (doc.series || []).filter((s) => s.y2)) {
        const at = doc.panels.findIndex((p) => p.id === band.panel_id);
        const mine = option.series.filter((s) => s.name === band.name && s.xAxisIndex === at);
        const lines = mine.filter((s) => s.type === 'line');
        const fills = mine.filter((s) => s.type === 'custom');
        const where = `${band.name} on ${band.panel_id}`;
        if (lines.length !== 2 || fills.length !== 1) {
            fail(label, `${where}: ${lines.length} edges and ${fills.length} fills, want 2 and 1`);
            continue;
        }
        if (mine.some((s) => s.stack)) fail(label, `${where}: stacked`);
        const [lo, hi] = lines.map((s) => s.data);
        const edge = (drawn, want) => drawn.length === want.length
            && want.every((v, k) => drawn[k] && drawn[k][1] === v);
        if (!edge(lo, band.y)) fail(label, `${where}: lower edge is not the document y`);
        if (!edge(hi, band.y2)) fail(label, `${where}: upper edge is not the document y2`);
        // `apiRef.coord` stands in as the identity, so the ring is checkable in
        // data coordinates without a canvas.
        const rings = fills[0].renderItem({}, { coord: (p) => p }).children;
        if (!rings.length) { fail(label, `${where}: fill drew no ring`); continue; }
        const points = rings[0].shape.points;
        const half = points.length / 2;
        const forward = points.slice(0, half).every((p, k) => p[1] === band.y[k]);
        const back = points.slice(half).every((p, k) => p[1] === band.y2[half - 1 - k]);
        if (!forward || !back) fail(label, `${where}: the ring is not lower out and upper back`);
    }
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
        if (doc.ir_version !== 3) fail(label, `ir_version ${doc.ir_version}`);
        const option = chartdocToEcharts(doc, { width: 980 });
        if (!checkDrawable(label, doc, option)) continue;
        checkLabels(label, doc, option);
        checkLayout(label, doc);
        checkReadout(label, doc, option);
        checkBands(label, doc, option);
        checkReadings(label, doc, option);
        const ladder = checkLadder(label, doc, option);
        const offered = readings(doc);
        // Printed per panel, which is what the strip now draws: one group per
        // entry, in document order, so the line reads as the row of buttons a
        // reader would see. The clutter count in
        // `dev/done/plan-2d-punchups.md` is read straight off this.
        const which = offered.panels.map((p) => {
            const on = Object.entries(p)
                .filter(([k, v]) => v === true && k !== 'id')
                .map(([k]) => k).join(' ');
            return `${p.id}:${on || 'none'}`;
        }).join(' | ') || 'none';
        const kinds = offered.kinds.length ? ` kinds=[${offered.kinds.join(' ')}]` : '';
        const marks = (option.series || []).filter((s) => s.markLine).length;
        console.log(
            `${label.padEnd(22)} panels=${doc.panels.length} `
            + `series=${option.series.length} marks=${marks} `
            + `h=${option.hostHeight} readings=[${which}]${kinds}`
            + (ladder ? ` ladder=${ladder.full}->${ladder.zoomed}` : ''));
    }
}

// Every mark in every document reaches the chart, which is the check that would
// have caught a mark placed on a panel id nothing draws.
//
// Two realizations, because a mark means two different things by panel. On a
// curve it is a reference line, drawn as a markLine entry. On a tower it is a
// boundary, and a tower is read at its breaks, so the panel's marks become the
// ticks of its quantity axis, which is what `_chartdoc._render_tower_panel`
// does. Distinct positions there: a tower marking one boundary twice labels it
// once, and counting the document's marks would then demand a duplicate tick.
for (const [name, entry] of Object.entries(cases)) {
    for (const [chart, doc] of Object.entries(entry.charts || {})) {
        if (!doc || !(doc.marks || []).length) continue;
        const option = chartdocToEcharts(doc, { width: 980 });
        if (!option) continue;
        const towers = new Set((doc.panels || [])
            .filter((p) => p.kind === 'tower').map((p) => p.id));
        const wantLines = doc.marks.filter((m) => !towers.has(m.panel_id)).length;
        const wantTicks = new Set(doc.marks.filter((m) => towers.has(m.panel_id))
            .map((m) => `${m.panel_id}:${m.at}`)).size;
        const drawn = (option.series || [])
            .flatMap((s) => (s.markLine ? s.markLine.data : [])).length;
        const ticked = (option.yAxis || []).reduce(
            (n, ax) => n + ((ax.axisLabel && ax.axisLabel.customValues) || []).length, 0);
        if (drawn !== wantLines || ticked !== wantTicks) {
            fail(`${name}/${chart}`,
                 `${wantLines} reference lines and ${wantTicks} boundary ticks `
                 + `wanted, ${drawn} and ${ticked} drawn`);
        }
    }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall clear');
process.exit(failures ? 1 : 0);
void WIDE_PX;
