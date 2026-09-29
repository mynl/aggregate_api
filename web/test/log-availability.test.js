// Whether a log button is live, under `node --test`.
//
// `readings` offers the button off the union of every axis that could occupy a
// screen position; the drawing resolves the one that actually does. The two
// answers are both wanted and they are not the same answer, so `logAvailable`
// is the bridge: it says whether the axis under the button *today* admits log,
// which is what the strip greys on.
//
// The sweep at the bottom is the real test. It walks every chart in the
// fixture, every panel, both log readings and all eight combinations of the
// three controls that exchange axes, and asserts that `logAvailable` agrees
// with the drawing in every one. That is the invariant the a167 report broke:
// on an `agg`'s Lee panel `log x` was offered, pressed, and changed nothing,
// because x is the non-exceeding probability and it declares `["linear"]`.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The chart modules are browser code: zrender sniffs the environment at import
// time and reads `document.documentElement.style`, so the stub carries that
// much and the import is deferred until it is in place. Nothing here renders.
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

const { chartdocToEcharts, declaredLogs, logAvailable, readings } =
    await import('../src/charts/chartdoc-to-echarts.js');

// Resolved off this file rather than off the working directory, since the
// suite runs from `web/` and the harnesses run from the repo root.
const FIXTURE = fileURLToPath(new URL('../../dev/fixtures/charts.json', import.meta.url));
const CHARTS = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

const BASE = {
    kind: null, panels: {}, windows: {}, lee: {},
    mesh: true, wallGrid: true, marginals: false, contours: true, lights: true,
    cut: 'none', cutX: 0.5, cutY: 0.5, cutS: 0.5,
};

/**
 * The drawn axes as a comparable string.
 *
 * The axis configs alone rather than the whole option, which matters: the
 * option carries every series, and stringifying those over a sweep costs
 * nineteen seconds against seven milliseconds for this. It loses nothing,
 * because everything a log reading does shows up here. It sets the axis `type`,
 * and the window it draws in is the axis' own `min` and `max`, so even the
 * uncropped density ordinate moves one of these. Checked against the full
 * comparison over every combination below: the verdicts are identical.
 */
const shape = (option) => (option
    ? JSON.stringify([option.xAxis, option.yAxis, option.xAxis3D, option.yAxis3D,
                      option.zAxis3D, option.visualMap],
                     (k, v) => (typeof v === 'function' ? '[fn]' : v))
    : 'NULL');

/** Does flipping `key` on `panelId` change what is drawn? */
function changesDrawing(doc, panelId, key, held, kind = null) {
    const build = (value) => chartdocToEcharts(doc, {
        view: { ...BASE, kind, panels: { [panelId]: { ...held, [key]: value } } },
        width: 980,
    });
    return shape(build(false)) !== shape(build(true));
}

const AGG = CHARTS.agg.charts.agg;
const LEE = AGG.panels.find((p) => p.id === 'lee');

test('the axis a Lee panel opens on declares one reading, so log x is not live', () => {
    const live = logAvailable(AGG, LEE, {});
    assert.equal(live.logX, false);
    assert.equal(live.xLabel, 'Non-exceeding probability');
    // And the drawing agrees, which is the whole point.
    assert.equal(changesDrawing(AGG, 'lee', 'logX', {}), false);
});

test('the loss axis on the same panel does admit log', () => {
    const live = logAvailable(AGG, LEE, {});
    assert.equal(live.logY, true);
    assert.equal(live.yLabel, 'Loss');
    assert.equal(changesDrawing(AGG, 'lee', 'logY', {}), true);
});

test('reflect puts an axis that admits log under the button', () => {
    // The complement of a non-exceeding probability is the survival function,
    // which declares both scales.
    assert.equal(logAvailable(AGG, LEE, { reflect: true }).logX, true);
    assert.equal(changesDrawing(AGG, 'lee', 'logX', { reflect: true }), true);
});

test('the return period does the same, by the reciprocal pairing', () => {
    assert.equal(logAvailable(AGG, LEE, { returnPeriod: true }).logX, true);
    assert.equal(changesDrawing(AGG, 'lee', 'logX', { returnPeriod: true }), true);
});

test('invert exchanges the two answers, because it exchanges the two axes', () => {
    const plain = logAvailable(AGG, LEE, {});
    const flipped = logAvailable(AGG, LEE, { invert: true });
    assert.equal(flipped.logX, plain.logY);
    assert.equal(flipped.logY, plain.logX);
    assert.equal(flipped.xLabel, plain.yLabel);
});

test('a P&L declares no log on its own quantity, so neither reading is live', () => {
    // A P&L goes negative, so `outcome` carries `["linear"]` where an `agg`'s
    // carries both. Its Lee panel is the case where both buttons are greyed at
    // once, which is what made it the worst of the eight.
    const pnl = CHARTS.pnl.charts.pnl;
    const lee = pnl.panels.find((p) => p.id === 'lee');
    const live = logAvailable(pnl, lee, {});
    assert.equal(live.logX, false);
    assert.equal(live.logY, false);
    assert.equal(changesDrawing(pnl, 'lee', 'logX', {}), false);
    assert.equal(changesDrawing(pnl, 'lee', 'logY', {}), false);
});

test('a grid panel answers on its height, which is what log y drives there', () => {
    const joint = CHARTS.bvagg.charts.joint_surface;
    const panel = joint.panels[0];
    const live = logAvailable(joint, panel, {});
    assert.equal(live.logY, true);
    // No `log x` on a grid panel: the two position axes are components and
    // `readings` never offers one, so the query says so too rather than
    // answering about an axis no button addresses.
    assert.equal(live.logX, false);
    assert.equal(readings(joint).panels[0].logX, false);
});

test('a missing panel or axis answers false rather than throwing', () => {
    assert.deepEqual(logAvailable({ axes: [], panels: [] }, { id: 'x' }, {}),
                     { logX: false, logY: false, xLabel: '', yLabel: '' });
});

// ---- the reading a panel opens on --------------------------------------
//
// An axis may declare `scale: 'log'`, which says the panel opens on log. The
// reins chart's occurrence density is the one axis in the library that does,
// and through a172 that default was applied inside `axisScale`, where no button
// could get past it: pressed or not, the panel drew log. The default is a seed
// for the reading now, so the panel still opens on log and the button switches
// it off.

const REINS = CHARTS.reins.charts.reins;
const OCCURRENCE = REINS.panels.find((p) => p.id === 'occurrence');

/** The `type` of each panel's y axis, in document order. */
const yTypes = (panels) => chartdocToEcharts(
    REINS, { view: { ...BASE, panels }, width: 980 },
).yAxis.map((a) => a.type);

test('an axis declaring a log default seeds its panel\'s reading', () => {
    assert.deepEqual(declaredLogs(REINS, OCCURRENCE), { logX: false, logY: true });
    // The aggregate panel declares no default, so it seeds neither reading.
    assert.deepEqual(declaredLogs(REINS, REINS.panels.find((p) => p.id === 'aggregate')),
                     { logX: false, logY: false });
});

test('so the occurrence panel opens on log, with nothing held', () => {
    assert.equal(yTypes({})[0], 'log');
});

test('and the button switches it off, which is what it could not do', () => {
    assert.equal(yTypes({ occurrence: { logY: false } })[0], 'value');
    assert.equal(yTypes({ occurrence: { logY: true } })[0], 'log');
});

test('the seed reaches one panel only, and the other axes are unmoved', () => {
    // The aggregate panel's loss axis declares both scales and no default, so
    // it opens linear beside a panel that opens on log.
    assert.equal(yTypes({})[1], 'value');
});

test('a panel with no document answers false rather than throwing', () => {
    assert.deepEqual(declaredLogs(null, null), { logX: false, logY: false });
    assert.deepEqual(declaredLogs({ axes: [] }, { id: 'x' }), { logX: false, logY: false });
});

// ---- the sweep ---------------------------------------------------------

/** All eight states of the three controls that exchange which axis sits where. */
const STATES = [];
for (const invert of [false, true]) {
    for (const reflect of [false, true]) {
        for (const returnPeriod of [false, true]) STATES.push({ invert, reflect, returnPeriod });
    }
}

/** How a state reads in a failure message. */
const stateName = (held) => Object.entries(held).filter(([, v]) => v)
    .map(([k]) => k).join('+') || 'plain';

// One chart per distinct axis topology in the fixture. The others repeat these
// shapes across objects: `sev/severity`, `discrete/agg` and `reins/agg` all
// carry the same density-and-Lee pair as `agg/agg`, and asserting the same
// topology four more times buys nothing and costs option builds, which is the
// whole expense here. Every row of the a167 audit is represented.
const TOPOLOGIES = [
    ['agg', 'agg'],                  // density and Lee, quantity admits log
    ['pnl', 'pnl'],                  // the same, quantity linear-only
    ['agg', 'approximation_tails'],  // a tails panel, dead under reflect
    ['reins', 'reins'],              // occurrence and aggregate
    ['bvagg', 'joint_surface'],      // a grid, in both realizations
];

test('the query agrees with the drawing, on every topology and in every state', () => {
    let checked = 0;
    const wrong = [];
    for (const [obj, name] of TOPOLOGIES) {
        const doc = CHARTS[obj].charts[name];
        const offered = readings(doc);
        const kinds = offered.kinds.length ? offered.kinds : [null];
        for (const kind of kinds) {
            for (const entry of offered.panels) {
                const panel = (doc.panels || []).find((p) => p.id === entry.id);
                for (const key of ['logX', 'logY']) {
                    if (!entry[key]) continue;
                    for (const held of STATES) {
                        const live = logAvailable(doc, panel, held)[key];
                        const draws = changesDrawing(doc, entry.id, key, held, kind);
                        checked += 1;
                        if (live !== draws) {
                            wrong.push(`${obj}/${name} ${entry.id} ${key} `
                                       + `[${stateName(held)}] query=${live} drawing=${draws}`);
                        }
                    }
                }
            }
        }
    }
    assert.ok(checked > 100, `the sweep should be broad, saw ${checked}`);
    assert.deepEqual(wrong, [], `the query and the drawing disagree:\n${wrong.join('\n')}`);
});

test('no log button in the fixture is dead in every state', () => {
    // The whole corpus, and free: this reads the declarations and builds no
    // options. A button offered on a panel where no combination of reflect,
    // invert and the return period ever puts a log-capable axis under it is
    // offering a reading that does not exist, which is a fault in the offer
    // rather than in the greying.
    const never = [];
    for (const [obj, bundle] of Object.entries(CHARTS)) {
        for (const [name, doc] of Object.entries(bundle.charts || {})) {
            for (const entry of readings(doc).panels) {
                const panel = (doc.panels || []).find((p) => p.id === entry.id);
                for (const key of ['logX', 'logY']) {
                    if (!entry[key]) continue;
                    if (STATES.some((held) => logAvailable(doc, panel, held)[key])) continue;
                    never.push(`${obj}/${name} ${entry.id} ${key}`);
                }
            }
        }
    }
    assert.deepEqual(never, [], `offered but live in no state:\n${never.join('\n')}`);
});
