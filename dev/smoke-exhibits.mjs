// Smoke-test every Overview exhibit against a live api.
//
//     node dev/smoke-exhibits.mjs [base-url]      # default http://127.0.0.1:8011
//
// `mountExhibit` needs a DOM, but each exhibit's `build()` is pure, so this
// builds one object per first-class kind, assembles its ECharts option, and
// checks the things that would show up as a broken chart rather than as an
// exception: a missing series, an EP panel that is entirely null (which is what
// a bad survival column looks like), or a collapsed density x-window.
//
// It is a smoke test, not a rendering test. It cannot tell you the chart looks
// good; it tells you the data reached it in a drawable shape.

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BASE = (process.argv[2] || 'http://127.0.0.1:8011').replace(/\/$/, '');

// The chart modules are browser code. These are the only globals they touch at
// import time; nothing here renders, so a stub is enough.
// zrender (ECharts' renderer) sniffs the environment at import time and reads
// `document.documentElement.style`, so the stub has to carry that much.
const styleStub = new Proxy({}, { get: () => '', set: () => true });
globalThis.window = globalThis;
globalThis.document = {
    documentElement: { style: styleStub },
    createElement: () => ({ style: {}, getContext: () => null }),
    addEventListener() {},
};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
// node >= 21 defines `navigator` as a getter-only global, so assigning to it
// throws. It already carries a `userAgent`, which is all zrender reads.
if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };

// api.js fetches same-origin paths ('/v1/...'), which node cannot resolve.
// Resolve them against BASE instead of threading a base URL through the app.
const nodeFetch = globalThis.fetch;
globalThis.fetch = (input, init) =>
    nodeFetch(typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init);

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { EXHIBITS } = await import(
    pathToFileURL(path.join(here, '..', 'web', 'src', 'charts', 'exhibits.js')).href);

async function build(decl) {
    const r = await fetch('/v1/objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decl }),
    });
    if (!r.ok) throw new Error(`build failed ${r.status}: ${await r.text()}`);
    return r.json();
}

const CASES = [
    ['agg', 'agg SMOKE.A 100 claims 1000 xs 0 sev lognorm 90 cv 1.5 poisson'],
    ['port', 'port SMOKE.P agg U1 80 claims 500 xs 0 sev lognorm 50 cv 1.2 poisson '
             + 'agg U2 20 claims 2000 xs 0 sev lognorm 250 cv 2.0 mixed gamma 0.4'],
    ['sev', 'sev SMOKE.S lognorm 50 cv 1.5'],
    ['distortion', 'dist SMOKE.D ph 0.7'],
    ['pnl', 'pnl SMOKE.N 1000 prem less '
            + 'agg SMOKE.L 1000 prem at 70% lr sev lognorm 100 cv 2 poisson'],
    ['bvagg', 'bivariate SMOKE.B 25 claims '
              + 'agg A dfreq [0 1] [.5 .5] sev lognorm 50 cv 1.5 '
              + 'agg B dfreq [0 1] [.5 .5] sev gamma 50 cv 1.0 poisson'],
];

let bad = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); bad++; };

for (const [expectKind, decl] of CASES) {
    let res;
    try {
        res = await build(decl);
    } catch (err) {
        fail(`${expectKind}: ${err.message}`);
        continue;
    }
    if (res.kind !== expectKind) { fail(`${expectKind}: built as ${res.kind}`); continue; }

    const spec = EXHIBITS[res.kind];
    if (!spec) { fail(`${res.kind}: no exhibit registered`); continue; }

    let option;
    try {
        const data = await spec.fetch(res.id);
        option = spec.build(data, { name: res.name, kind: res.kind, wide: true });
    } catch (err) {
        fail(`${res.kind}: ${err.message}`);
        continue;
    }
    if (!option) { fail(`${res.kind}: build() returned null`); continue; }

    const series = option.series || [];
    const panels = Array.isArray(option.grid) ? option.grid.length : 1;
    const counts = series.map((s) => {
        const d = s.data || [];
        return `${s.name}:${d.filter((p) => p != null).length}/${d.length}`;
    });

    const notes = [];
    if (panels === 2) {
        const half = series.length / 2;
        if (!series.slice(half).every((s) => (s.data || []).some((p) => p != null))) {
            notes.push('EP panel entirely null');
        }
        const x = option.xAxis[0];
        if (typeof x.min === 'number' && typeof x.max === 'number' && !(x.max > x.min)) {
            notes.push('density x window collapsed');
        }
    }
    if (!series.length) notes.push('no series');

    if (notes.length) { fail(`${res.kind}: ${notes.join('; ')}`); continue; }
    console.log(`OK   ${res.kind.padEnd(11)} panels=${panels} series=${series.length}  `
        + counts.join(' '));
}

console.log(bad ? `\n${bad} problem(s)` : '\nall exhibits built cleanly');
process.exit(bad ? 1 : 0);
