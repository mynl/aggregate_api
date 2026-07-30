// Smoke-test every Overview exhibit.
//
//     uv run python dev/capture_fixtures.py     # once, or after an api change
//     node dev/smoke-exhibits.mjs               # replay, offline
//     node dev/smoke-exhibits.mjs http://127.0.0.1:8001    # or against a server
//
// `mountExhibit` needs a DOM, but each exhibit's `build()` is pure, so this
// assembles one ECharts option per first-class kind and checks the things that
// would show up as a broken chart rather than as an exception: a missing
// series, a right panel that is entirely null (what a bad survival column looks
// like), or a collapsed density x-window.
//
// It defaults to replaying captured payloads rather than calling a live api, so
// it needs no server. Pass a base URL to run against one.
//
// It is a smoke test, not a rendering test. It cannot tell you the chart looks
// good; it tells you the data reached it in a drawable shape.

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BASE = process.argv[2] ? process.argv[2].replace(/\/$/, '') : null;

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
// node >= 21 makes `navigator` a getter-only global, so assigning to it throws.
// It already carries the `userAgent` zrender reads.
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
// localStorage backs the sticky view toggles; an in-memory stand-in is enough,
// and it keeps the test on the documented defaults.
globalThis.localStorage = {
    getItem: () => null, setItem() {}, removeItem() {},
};

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (BASE) {
    // api.js fetches same-origin paths, which node cannot resolve on its own.
    const nodeFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => nodeFetch(
        typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init);
}

const { EXHIBITS, reinsSeries, PANEL_ASPECT, reservedHeight, twoPanelData } =
    await import(
        pathToFileURL(path.join(here, '..', 'web', 'src', 'charts', 'exhibits.js')).href);
const { surfaceGrid, surfaceOption } = await import(
    pathToFileURL(path.join(here, '..', 'web', 'src', 'charts', 'surface.js')).href);
// `plotlyFigure` is pure like the rest and needs no Plotly bundle: the library
// itself is only reached through a dynamic import inside `loadPlotly`.
const { plotlyFigure } = await import(
    pathToFileURL(path.join(here, '..', 'web', 'src', 'charts', 'plotly-panels.js')).href);
const { PLOTLY_KINDS } = await import(
    pathToFileURL(path.join(here, '..', 'web', 'src', 'charts', 'engine.js')).href);

// Panels are checked against the target aspect because the shape is the one
// property of a rendered chart that is fully determined by the option object,
// and so the one thing this test can genuinely verify about appearance.
//
// The ratio is measured on the panel's **footprint** (plot area plus its title
// strip and axis), which is what it occupies on the page and what `PANEL_ASPECT`
// targets. Measuring the plot rectangle alone is what let a26 hit 1.43 there
// while the footprint came out near 1.06, i.e. much taller than intended.
const ASPECT_TOL = 0.02;

/** Two-panel geometry check: equal panels, target footprint unless clamped. */
function checkAspect(grids, footprint, notes) {
    const [a, b] = grids;
    if (Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) {
        notes.push(`panels differ (${a.width}x${a.height} vs ${b.width}x${b.height})`);
        return null;
    }
    if (!(footprint > 0)) { notes.push('no panel footprint'); return null; }
    const got = a.width / footprint;
    const clamped = a.height <= 130 + 0.5 || a.height >= 380 - 0.5;
    if (!clamped && Math.abs(got - PANEL_ASPECT) > ASPECT_TOL) {
        notes.push(`footprint aspect ${got.toFixed(2)} not ${PANEL_ASPECT.toFixed(2)}`);
    }
    return got;
}

// Each case names the exhibit to build and the fixture key holding its payloads.
const CASES = [
    ['agg', 'agg'],
    ['port', 'port'],
    ['sev', 'sev'],
    ['distortion', 'distortion'],
    ['pnl', 'pnl'],
    ['bvagg', 'bvagg'],
    // A discrete book builds as an `agg`; it is here because the step-drawn
    // density only triggers on a small support.
    ['agg', 'discrete'],
];

let fixtures = null;
if (!BASE) {
    const file = path.join(here, 'fixtures', 'exhibits.json');
    if (!existsSync(file)) {
        console.error(`no fixtures at ${file}\n`
            + 'run:  uv run python dev/capture_fixtures.py');
        process.exit(2);
    }
    fixtures = JSON.parse(readFileSync(file, 'utf8'));
}

async function payloadFor(kind, key, spec) {
    if (fixtures) {
        const entry = fixtures[key];
        if (!entry) throw new Error(`fixture ${key} missing; re-capture`);
        return { data: entry.frames, build: entry.build };
    }
    const r = await fetch('/v1/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decl: LIVE_DECLS[key] }),
    });
    if (!r.ok) throw new Error(`build failed ${r.status}`);
    const build = await r.json();
    return { data: await spec.fetch(build.id), build };
}

// Only needed in live mode; the fixture file carries its own programs.
const LIVE_DECLS = {
    agg: 'agg SMOKE.A 100 claims 1000 xs 0 sev lognorm 90 cv 1.5 poisson',
    port: 'port SMOKE.P agg U1 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson '
        + 'agg U2 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4',
    sev: 'sev SMOKE.S lognorm 50 cv 1.5',
    distortion: 'dist SMOKE.D ph 0.7',
    pnl: 'pnl SMOKE.N 1000 prem less '
        + 'agg SMOKE.L 1000 prem at 70% lr sev lognorm 100 cv 2 poisson',
    bvagg: 'bivariate SMOKE.B 25 claims '
        + 'agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 '
        + 'agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 poisson',
    discrete: 'agg SMOKE.Dice dfreq [3] dsev [1:6]',
};

let bad = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); bad++; };

console.log(BASE ? `live against ${BASE}` : 'replaying dev/fixtures/exhibits.json');

// Both layouts, because the reported aspect bug was in the *stacked* one: it
// pinned a fixed panel height against a full-width panel and so drew at roughly
// 3.5:1. A test that only exercised the wide breakpoint would have passed
// throughout.
const LAYOUTS = [
    { name: 'wide', wide: true, width: 1000 },
    { name: 'narrow', wide: false, width: 560 },
];

for (const [kind, key] of CASES) {
    const spec = EXHIBITS[kind];
    if (!spec) { fail(`${key}: no exhibit registered for ${kind}`); continue; }

    let payload;
    try {
        payload = await payloadFor(kind, key, spec);
    } catch (err) {
        fail(`${key}: ${err.message}`);
        continue;
    }

    const lines = [];
    let broke = false;
    for (const layout of LAYOUTS) {
        const { data, build } = payload;
        // What the mount reserves before the fetch, taken the same way the mount
        // takes it. The build below is handed the box from the same `layout`, so
        // the two heights must agree; see the check further down.
        const reserved = reservedHeight(layout.width, kind);
        let option;
        try {
            option = spec.build(data, {
                name: build.name, kind, mean: build.mean,
                wide: layout.wide, width: layout.width,
                box: spec.layout(layout.width),
            });
        } catch (err) {
            fail(`${key} (${layout.name}): ${err.message}`);
            broke = true;
            break;
        }
        if (!option) { fail(`${key} (${layout.name}): build() returned null`); broke = true; break; }

        const series = option.series || [];
        const grids = Array.isArray(option.grid) ? option.grid : [option.grid];
        const notes = [];
        if (!series.length) notes.push('no series');

        // The invariant a29 exists to hold: the box reserved before the fetch is
        // the box the chart lands in. Before a29 `reservedHeight` took only a
        // width and always answered with the two-panel geometry, so a distortion
        // reserved 347 and rendered 498 and a bivariate reserved 730 and
        // rendered 480. The page jumped 133 to 252 px on every such load, and
        // nothing here noticed, because nothing compared the two numbers.
        if (!(option.hostHeight > 0)) notes.push('no host height');
        else if (Math.round(option.hostHeight) !== Math.round(reserved)) {
            notes.push(`reserved ${Math.round(reserved)} but rendered `
                + `${Math.round(option.hostHeight)}`);
        }

        let shape;
        if (grids.length >= 2) {
            const half = series.length / 2;
            if (!series.slice(half).every((s) => (s.data || []).some((p) => p != null))) {
                notes.push('right panel entirely null');
            }
            const x = option.xAxis[0];
            if (typeof x.min === 'number' && typeof x.max === 'number' && !(x.max > x.min)) {
                notes.push('density x window collapsed');
            }
            const got = checkAspect(grids, option.panelFootprint, notes);
            // Steps are unconditional now, so *every* density series carries
            // them. A value in the frame is the mass in one bucket, not a sample
            // of a curve, so joining two with a slope draws probability between
            // grid points that carry none. The density series are the first half.
            const density = series.slice(0, series.length / 2);
            const flat = density.filter((s) => s.step !== 'middle').map((s) => s.name);
            if (flat.length) notes.push(`not stepped: ${flat.join(', ')}`);
            shape = `${Math.round(grids[0].width)}x${Math.round(grids[0].height)}`
                + (got ? ` fp=${got.toFixed(2)}` : '') + ` h=${Math.round(option.hostHeight)}`;
        } else {
            // A single-panel 2-D exhibit must be square: a stretched g(s)
            // misreads as a different curve, which is the whole reason it is
            // fixed. A grid3D exhibit has no `grid` at all and is checked below.
            const g = grids[0] || {};
            if (g == null) notes.push('no grid');
            else if (g.width !== g.height) notes.push(`not square (${g.width}x${g.height})`);
            shape = `square=${g.width} h=${Math.round(option.hostHeight)}`;
        }

        if (notes.length) { fail(`${key} (${layout.name}): ${notes.join('; ')}`); broke = true; break; }

        const marks = series.filter((s) => s.markLine).length;
        lines.push(`${layout.name} ${shape} marks=${marks}`);
    }
    if (broke) continue;
    console.log(`OK   ${key.padEnd(11)} ${lines.join('  |  ')}`);
}

// The Reins exhibit is keyed by tab rather than by object kind, so it is not in
// EXHIBITS and gets its own check. Offline only: it needs the captured frame.
if (fixtures && fixtures.reins) {
    const frame = fixtures.reins.frames.reins;
    // All three triples, not just the default: they read different columns of
    // the same frame, and a typo in one column name would otherwise sit
    // undetected behind a control nobody clicked in the test.
    for (const which of ['sev', 'occ', 'agg']) {
        const series = reinsSeries(frame, which);
        if (series.length !== 3) {
            fail(`reins/${which}: got ${series.length} series, expected 3`);
            continue;
        }
        // Each column is a pmf, so its derived survival must be non-increasing,
        // inside [0, 1], and finish at zero. It must NOT be asserted to *start*
        // at 1: the ceded distribution is small next to the gross, so on a grid
        // scaled for the gross its whole mass lands in the first display bucket
        // and its survival legitimately starts at 0.
        const bad = series.filter((s) => {
            const t = s.tailProb;
            const ends = t[t.length - 1] < 1e-9;
            const bounded = t.every((v) => v >= 0 && v <= 1 + 1e-12);
            let falling = true;
            for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1] + 1e-12) falling = false;
            return !(ends && bounded && falling);
        });
        if (bad.length) fail(`reins/${which}: bad survival on ${bad.map((s) => s.name).join(', ')}`);
        else {
            console.log(`OK   ${`reins/${which}`.padEnd(11)} `
                + `series=[${series.map((s) => s.name).join(',')}]`);
        }
    }
    // The gross/ceded/net subset control: one part selected yields one series,
    // and `subject` answers to the `gross` button on the aggregate stage.
    if (reinsSeries(frame, 'occ', ['ceded']).length !== 1) fail('reins: part filter ignored');
    const sub = reinsSeries(frame, 'agg', ['gross']);
    if (sub.length !== 1 || sub[0].name !== 'subject') {
        fail('reins: `gross` does not select `subject` on the aggregate stage');
    }
}

// ---- Plotly parity ----------------------------------------------------
//
// The point of the a30 spike is to judge two libraries drawing the *same*
// chart. An unfair comparison answers nothing, so the properties that took
// a26 to a29 to get right are asserted on the Plotly figure too: steps-mid,
// loss on x in both panels, the reserved height, the capital anchors, and one
// legend entry per unit rather than two.

// Which trace types the pinned Plotly bundle actually registers, read out of
// the shipped file. The partial bundles are not interchangeable and the failure
// is invisible until runtime: `plotly.js-basic-dist-min` carries bar, pie and
// scatter only, so the `scattergl` these traces need would have thrown "invalid
// trace type" in the browser and nowhere else. Null when node_modules is absent.
function registeredTraces() {
    const dir = path.join(here, '..', 'web', 'node_modules');
    for (const pkg of ['plotly.js-gl2d-dist-min', 'plotly.js-basic-dist-min']) {
        const base = path.join(dir, pkg);
        if (!existsSync(base)) continue;
        const main = JSON.parse(readFileSync(path.join(base, 'package.json'), 'utf8')).main;
        const file = path.join(base, main);
        if (!existsSync(file)) continue;
        const src = readFileSync(file, 'utf8');
        const found = new Set();
        for (const m of src.matchAll(/moduleType:"trace",name:"([a-z0-9]+)"/g)) {
            found.add(m[1]);
        }
        if (found.size) return { pkg, traces: found };
    }
    return null;
}
const bundle = registeredTraces();
if (bundle) console.log(`plotly bundle ${bundle.pkg}: ${[...bundle.traces].sort().join(', ')}`);

if (fixtures) {
    for (const kind of PLOTLY_KINDS) {
        const spec = EXHIBITS[kind];
        const entry = fixtures[kind];
        if (!spec || !entry) { fail(`plotly/${kind}: no fixture`); continue; }
        for (const layout of LAYOUTS) {
            const notes = [];
            const args = spec.panelArgs(entry.frames, {
                name: entry.build.name, kind, mean: entry.build.mean,
                wide: layout.wide, width: layout.width,
                box: spec.layout(layout.width),
            });
            if (!args) { fail(`plotly/${kind} (${layout.name}): no panel args`); continue; }
            const d = twoPanelData(args);
            const fig = plotlyFigure(d);
            const traces = fig.data || [];
            const half = traces.length / 2;

            // Same box as ECharts, so flipping engines does not move the page.
            const reserved = reservedHeight(layout.width, kind);
            if (Math.round(fig.layout.height) !== Math.round(reserved)) {
                notes.push(`height ${fig.layout.height} not ${reserved}`);
            }
            // Steps-mid. `hvh` is Plotly's centered step, the same shape as
            // ECharts' `step: 'middle'`.
            const flat = traces.slice(0, half)
                .filter((t) => (t.line || {}).shape !== 'hvh').map((t) => t.name);
            if (flat.length) notes.push(`not stepped: ${flat.join(', ')}`);
            // Loss on x in BOTH panels, never a transpose.
            for (const ax of ['xaxis', 'xaxis2']) {
                if (((fig.layout[ax] || {}).title || {}).text !== 'loss') {
                    notes.push(`${ax} is not loss`);
                }
            }
            // A log axis in Plotly takes its range in EXPONENTS. Handing it the
            // raw 1e-15 where it wants -15 collapses the axis silently, and it
            // is the one mapping here that looks right in code and wrong on
            // screen. Round-trip it against the survival range the shared
            // bundle computed.
            const y2 = fig.layout.yaxis2 || {};
            if (y2.type === 'log') {
                const want = d.asRP ? 1 / d.sHi : d.sLo;
                const got = 10 ** y2.range[0];
                if (!(Math.abs(got - want) <= 1e-9 * Math.max(want, 1e-30))) {
                    notes.push(`log range not in exponents: 10**${y2.range[0]} `
                        + `is ${got.toExponential(1)}, wanted ${want.toExponential(1)}`);
                }
            }
            // The capital anchors, as shapes with their labels.
            const marks = (fig.layout.shapes || []).length;
            if (marks !== d.densRefs.length + d.tailRefs.length) {
                notes.push(`${marks} shapes for `
                    + `${d.densRefs.length + d.tailRefs.length} refs`);
            }
            // One legend entry per unit. Plotly toggles per trace, so the tail
            // trace must join its density trace's group and stay out of the
            // legend, or a portfolio shows every unit twice and hiding one
            // leaves its tail curve behind.
            const shown = traces.filter((t) => t.showlegend).length;
            const expected = d.solo ? 0 : d.series.length;
            if (shown !== expected) {
                notes.push(`${shown} legend entries for ${d.series.length} series`);
            }
            const ungrouped = traces.filter((t) => !t.legendgroup).length;
            if (ungrouped) notes.push(`${ungrouped} traces without a legendgroup`);
            // Every trace type must exist in the bundle we ship.
            if (bundle) {
                const missing = [...new Set(traces.map((t) => t.type))]
                    .filter((t) => !bundle.traces.has(t));
                if (missing.length) {
                    notes.push(`${bundle.pkg} does not register ${missing.join(', ')}`);
                }
            }

            if (notes.length) fail(`plotly/${kind} (${layout.name}): ${notes.join('; ')}`);
            else {
                console.log(`OK   ${`plotly/${kind}`.padEnd(11)} ${layout.name} `
                    + `h=${Math.round(fig.layout.height)} traces=${traces.length} `
                    + `marks=${marks}`);
            }
        }
    }
}

// The bivariate 3-D surface. `surfaceOption` is pure like the rest, so it can be
// assembled here without WebGL or echarts-gl; what cannot be checked offline is
// whether it *renders*, only whether the mesh is well formed.
if (fixtures && fixtures.bvagg) {
    const joint = fixtures.bvagg.frames.joint;
    const grid = surfaceGrid(joint);
    if (!grid) fail('surface: joint frame did not reduce to a grid');
    else {
        for (const logZ of [false, true]) {
            const option = surfaceOption(grid, { xName: 'A', yName: 'B', logZ });
            const s = (option.series || [])[0] || {};
            const notes = [];
            if (s.type !== 'surface') notes.push(`type ${s.type}`);
            // dataShape must match the vertex count exactly or echarts-gl reads
            // the flat list into the wrong mesh topology and draws a tangle.
            const [nx, ny] = s.dataShape || [];
            if (nx * ny !== (s.data || []).length) {
                notes.push(`dataShape ${nx}x${ny} != ${(s.data || []).length} vertices`);
            }
            if (!option.grid3D) notes.push('no grid3D');
            // The mesh must be complete. A zero-mass cell rests on the log floor
            // rather than being a hole: on this fixture 41% of the cells are
            // exact zeros, and as holes the surface arrived moth-eaten.
            const holes = (s.data || []).filter((d) => !Number.isFinite(d[2])).length;
            if (holes) notes.push(`${holes} holes in the mesh`);
            // And it must have relief. A surface whose heights are all equal is
            // what a broken reduction produces, and it draws as a flat plate.
            const heights = (s.data || []).map((d) => d[2]);
            const spread = Math.max(...heights) - Math.min(...heights);
            if (!(spread > 0)) notes.push('no relief: every height equal');
            if (notes.length) fail(`surface (logZ=${logZ}): ${notes.join('; ')}`);
            else {
                console.log(`OK   ${`surface/${logZ ? 'log' : 'lin'}`.padEnd(11)} `
                    + `mesh=${nx}x${ny} z=[${Math.min(...heights).toExponential(1)}`
                    + `, ${Math.max(...heights).toExponential(1)}]`);
            }
        }
    }
}

console.log('');
console.log(bad ? `${bad} problem(s)` : 'all exhibits built cleanly');
process.exit(bad ? 1 : 0);
