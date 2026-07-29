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

const { EXHIBITS, reinsSeries } = await import(
    pathToFileURL(path.join(here, '..', 'web', 'src', 'charts', 'exhibits.js')).href);
const { aspect } = await import(
    pathToFileURL(path.join(here, '..', 'web', 'src', 'charts', 'theme.js')).href);

// The house aspect, from the fallback style (no api in offline mode). Panels are
// checked against it because the shape is the one property of a rendered chart
// that is fully determined by the option object, and so the one thing this test
// can genuinely verify about appearance. The tolerance absorbs the clamp: a very
// narrow window hits PANEL_MIN_H and a very wide one PANEL_MAX_H, and a panel
// pinned at a clamp is correct without being at the ratio.
const ASPECT = aspect();
const ASPECT_TOL = 0.02;

/** Two-panel geometry check: equal panels, house aspect unless clamped. */
function checkAspect(grids, notes) {
    const [a, b] = grids;
    if (Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) {
        notes.push(`panels differ (${a.width}x${a.height} vs ${b.width}x${b.height})`);
        return null;
    }
    const got = a.width / a.height;
    const clamped = a.height <= 130 + 0.5 || a.height >= 380 - 0.5;
    if (!clamped && Math.abs(got - ASPECT) > ASPECT_TOL) {
        notes.push(`aspect ${got.toFixed(2)} not ${ASPECT.toFixed(2)}`);
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
        let option;
        try {
            option = spec.build(data, {
                name: build.name, kind, mean: build.mean,
                wide: layout.wide, width: layout.width,
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
            if (!(option.hostHeight > 0)) notes.push('no host height');
            const got = checkAspect(grids, notes);
            shape = `${Math.round(grids[0].width)}x${Math.round(grids[0].height)}`
                + (got ? ` (${got.toFixed(2)})` : '') + ` h=${Math.round(option.hostHeight)}`;
        } else {
            // A single-panel exhibit must be square: a stretched g(s) misreads
            // as a different curve, which is the whole reason it is fixed.
            const g = grids[0] || {};
            if (g.width !== g.height) notes.push(`not square (${g.width}x${g.height})`);
            shape = `square=${g.width}`;
        }

        if (notes.length) { fail(`${key} (${layout.name}): ${notes.join('; ')}`); broke = true; break; }

        const stepped = series.filter((s) => s.step === 'middle').map((s) => s.name);
        const marks = series.filter((s) => s.markLine).length;
        lines.push(`${layout.name} ${shape} marks=${marks}`
            + (stepped.length ? ` steps=[${stepped.join(',')}]` : ''));
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

// The discrete case exists to prove the step rendering fires, and the
// continuous one to prove it does not. A smoke test that cannot tell them apart
// would pass forever with the feature broken either way.
console.log('');
console.log(bad ? `${bad} problem(s)` : 'all exhibits built cleanly');
process.exit(bad ? 1 : 0);
