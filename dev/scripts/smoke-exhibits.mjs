// Smoke-test every Overview exhibit.
//
//     uv run python dev/scripts/capture_fixtures.py     # once, or after an api change
//     node dev/scripts/smoke-exhibits.mjs               # replay, offline
//     node dev/scripts/smoke-exhibits.mjs http://127.0.0.1:8001    # or against a server
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
// This file lives in dev/scripts, so dev/ is one level up and the repo root two.
// Everything it reads is named off one of those rather than off `here`, which is
// what let the whole set move in one go.
const devDir = path.dirname(here);
const root = path.dirname(devDir);

if (BASE) {
    // api.js fetches same-origin paths, which node cannot resolve on its own.
    const nodeFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => nodeFetch(
        typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init);
}

const { EXHIBITS, reinsSeries, PANEL_ASPECT, reservedHeight, twoPanelData } =
    await import(
        pathToFileURL(path.join(root, 'web', 'src', 'charts', 'exhibits.js')).href);
const { surfaceGrid, surfaceOption } = await import(
    pathToFileURL(path.join(root, 'web', 'src', 'charts', 'surface.js')).href);

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

/**
 * True when a series has no gap before its last real point.
 *
 * Mirrors `gapFree` in exhibits.js, because the property being asserted is
 * exactly the one that decides whether the series may carry ECharts' `minmax`
 * sampler: that sampler seeds each frame's min and max from the frame's first
 * point and every comparison against NaN is false, so a frame opening on a gap
 * discards the rest of itself. Trailing gaps are fine, interior ones are not.
 */
function noInteriorGap(data) {
    let last = (data || []).length - 1;
    while (last >= 0 && data[last] == null) last--;
    for (let i = 0; i < last; i++) { if (data[i] == null) return false; }
    return true;
}

/**
 * The a37 two-panel invariants, all three of which are silent when broken.
 *
 * 1. **One x window.** The panels are one instrument and a loss is at the same
 *    place in both. This broke under `full x`, where the window went to
 *    auto-fit and the tail panel then fitted a *shorter* run of data, because
 *    `rightPairs` drops whole entries past the log floor.
 * 2. **Which axis each panel answers.** Loss on the density, survival on the
 *    tail, declared per grid.
 * 3. **The sampler is on** wherever it is safe, which is what makes the density
 *    render as steps rather than as leaning pyramids.
 */
function checkTwoPanel(option, notes) {
    const [x0, x1] = option.xAxis;
    if (typeof x0.min !== 'number' || typeof x0.max !== 'number') {
        notes.push('density x window is not explicit');
    } else if (x0.min !== x1.min || x0.max !== x1.max) {
        notes.push(`panels on different x windows: [${x0.min}, ${x0.max}] `
            + `vs [${x1.min}, ${x1.max}]`);
    }
    const readAxis = (option.grid || []).map(
        (g) => g.tooltip && g.tooltip.axisPointer && g.tooltip.axisPointer.axis);
    if (readAxis[0] !== 'x' || readAxis[1] !== 'y') {
        notes.push(`read axes [${readAxis.join(', ')}], expected [x, y]`);
    }
    const unsampled = (option.series || [])
        .filter((s) => noInteriorGap(s.data) && s.sampling !== 'minmax')
        .map((s) => s.name);
    if (unsampled.length) notes.push(`not sampled: ${unsampled.join(', ')}`);
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
    const file = path.join(devDir, 'fixtures', 'exhibits.json');
    if (!existsSync(file)) {
        console.error(`no fixtures at ${file}\n`
            + 'run:  uv run python dev/scripts/capture_fixtures.py');
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
            checkTwoPanel(option, notes);
            const got = checkAspect(grids, option.panelFootprint, notes);
            // Steps are unconditional now, so *every* density series carries
            // them. A value in the frame is the mass in one bucket, not a sample
            // of a curve, so joining two with a slope draws probability between
            // grid points that carry none. The density series are the first half.
            const density = series.slice(0, series.length / 2);
            const flat = density.filter((s) => s.step !== 'middle').map((s) => s.name);
            if (flat.length) notes.push(`not stepped: ${flat.join(', ')}`);
            shape = `${Math.round(grids[0].width)}x${Math.round(grids[0].height)}`
                + (got ? ` fp=${got.toFixed(2)}` : '') + ` h=${Math.round(option.hostHeight)}`
                // The tail floor, printed rather than asserted: `T_MAX` bounds
                // it at 1e-9 but where it actually lands is the book's own
                // minimum survival rounded down to a decade, so a number is
                // worth more here than a bound.
                + ` tail>=${Number(option.yAxis[1].min).toExponential(0)}`;
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

// The `full x` view, which is the one toggle that changes the axis *contract*
// rather than the axis scale, and the one the a37 window fix was written for.
//
// `view` is read out of localStorage once, at import time, so exercising a
// second view needs a second module instance. A query string on the specifier is
// what gets one past the ESM cache.
if (fixtures) {
    const stored = JSON.stringify({ xFull: true });
    globalThis.localStorage.getItem = (k) =>
        (k === 'aggapi.exhibitView.v2' ? stored : null);
    const url = pathToFileURL(
        path.join(root, 'web', 'src', 'charts', 'exhibits.js')).href;
    const full = await import(`${url}?view=xFull`);
    globalThis.localStorage.getItem = () => null;

    const checked = [];
    for (const [kind, key] of CASES) {
        const entry = fixtures[key];
        const spec = full.EXHIBITS[kind];
        if (!entry || !spec) continue;
        let option;
        try {
            option = spec.build(entry.frames, {
                name: entry.build.name, kind, mean: entry.build.mean,
                wide: true, width: 1000, box: spec.layout(1000),
            });
        } catch (err) {
            fail(`${key} (full x): ${err.message}`);
            continue;
        }
        // Single-panel exhibits do not honor the toggle and have no second
        // window to agree with.
        if (!option || !Array.isArray(option.grid) || option.grid.length < 2) continue;
        const notes = [];
        checkTwoPanel(option, notes);
        if (notes.length) fail(`${key} (full x): ${notes.join('; ')}`);
        else checked.push(key);
    }
    if (checked.length) console.log(`OK   ${'full x'.padEnd(11)} ${checked.join(', ')}`);
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
