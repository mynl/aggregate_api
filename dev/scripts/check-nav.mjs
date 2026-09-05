/**
 * check-nav: does the navigation grey the right things, for every kind?
 *
 * The sibling of `check-exhibits.py` on the app side. The plan's own risk note
 * says the capability payload has to be right before the navigation is rebuilt
 * on top of it, because a wrong entry greys a leaf that works or lights one
 * that 400s, and the user cannot tell either from a leaf that genuinely does
 * not apply. This is that check.
 *
 * It runs the real rules from `web/src/nav.js` against real capability payloads
 * captured from the api, and prints one grid: a row per leaf, a column per
 * kind, `on` or `.`. Anything else is a finding.
 *
 * Since a49 it also checks the one thing about the navigation that is written
 * twice: the group order, in `nav.js`'s key order and in the `out-tabs` list in
 * `index.html`. See the foot of this file.
 *
 * Capture the payloads first (they are the api's answer, not a fixture anyone
 * wrote by hand):
 *
 *     uv run --no-sync python dev/scripts/capture-capability.py
 *     node dev/scripts/check-nav.mjs
 *
 * No server: the capture drives the app in-process through TestClient, and this
 * reads the file it writes.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

// `pathToFileURL`, not the bare path: a Windows absolute path reads as a URL
// scheme (`t:`) to the ESM loader, which is the same trap `smoke-charts.mjs`
// already sidesteps.
const { NAV_GROUPS, leafAvailable, groupAvailable, activeLeaf, capsFromResponse,
        leafOf } =
    await import(pathToFileURL(path.join(repo, 'web', 'src', 'nav.js')).href);

const fixture = path.join(repo, 'dev', 'fixtures', 'capability.json');
let payloads;
try {
    payloads = JSON.parse(readFileSync(fixture, 'utf8'));
} catch {
    console.error(`no ${path.relative(repo, fixture)}; run `
        + 'uv run --no-sync python dev/scripts/capture-capability.py first');
    process.exit(2);
}

const kinds = Object.keys(payloads);
const caps = Object.fromEntries(
    kinds.map((k) => [k, capsFromResponse(payloads[k].capability)]));

// What each kind is expected to answer. Written out rather than derived,
// because a check that recomputes the thing it is checking proves nothing. The
// left column is `group:leaf`; a kind listed means that leaf is live for it.
const EXPECTED = {
    'overview:plot': ['agg', 'agg_reins', 'port', 'sev', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    'overview:summary': ['agg', 'agg_reins', 'port', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    'overview:tail': ['agg', 'agg_reins', 'port'],
    // Moved out of More at a55: it is the verdict on what the three leaves above
    // it just showed, so it belongs beside them rather than in the specialist
    // menu. The live set is unchanged by the move, which is the point of
    // asserting it here.
    'overview:validation': ['agg', 'agg_reins', 'port', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    // Moved out of More at a125, the same move Validation made and asserted the
    // same way. This row is byte-identical to the two above it, which is the
    // whole argument for the move: the live set is unchanged, so the Overview
    // row lights nothing new and the More row darkens nothing.
    'overview:stats': ['agg', 'agg_reins', 'port', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    'economics:ledger': ['pnl', 'xpnl'],
    'economics:ratios': ['pnl', 'xpnl'],
    'economics:waterfall': ['xpnl'],
    'reinsurance:summary': ['agg_reins'],
    'reinsurance:stats': ['agg_reins'],
    'reinsurance:density': ['agg_reins'],
    'reinsurance:plot': ['agg_reins'],
    // Calibrate and Stand-alone gate together on `canPrice`: they are two
    // readings of one calibration and one press fills both, so a live Calibrate
    // with a dark Stand-alone would be a promise the pane cannot keep.
    'pricing:calibrate': ['agg', 'agg_reins', 'port'],
    'pricing:standalone': ['agg', 'agg_reins', 'port'],
    // Allocate and Plot need parts to split a premium across, which is a book
    // of units or an occurrence cession. A plain aggregate has one part and it
    // is the whole, so both are dark there while the two beside them are lit:
    // the narrower gate is the point of the split.
    'pricing:allocate': ['agg_reins', 'port'],
    // Plot is a chart leaf and lights from `kappa`, which the library registers
    // against the same two shapes: a book, whose unit curves the overview plot
    // already draws on its right hand side, and an occurrence program, whose
    // band chart is its own emitter. So this row equals the one above it, and
    // that agreement is the assertion rather than a coincidence.
    'pricing:plot': ['agg_reins', 'port'],
    'pricing:evaluate': ['agg', 'agg_reins', 'port', 'pnl', 'xpnl'],
    // Pr Ruin is a chart leaf and lights from `ruin`, whose predicate is the
    // library's frequency test: Poisson or renewal, on an aggregate alone.
    // Both captured aggregates are Poisson books, so both light; a portfolio
    // never does (plan-pk-tab ruling 5), and neither does anything without a
    // claim-count process of its own.
    'pricing:ruin': ['agg', 'agg_reins'],
    // Bounds takes an Aggregate or a Portfolio, which is the library's own
    // accepted set; allocation needs the per-unit conditional expectations only
    // a portfolio's density frame carries.
    'bounds:bounds': ['agg', 'agg_reins', 'port'],
    'bounds:pricing': ['agg', 'agg_reins', 'port'],
    'bounds:allocation': ['port'],
    'more:density': ['agg', 'agg_reins', 'port', 'sev', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    // Same set as overview:tail, and for the same reason: both need a full loss
    // distribution. They answer different questions about it, which is why they
    // are two leaves rather than two blocks in one pane.
    'more:behavior': ['agg', 'agg_reins', 'port'],
    // The leaf lights from the `approximation` exhibit, which the library
    // registers for an updated Aggregate or Portfolio, so this row equals the
    // two around it. The pane's Plot half gates separately on the
    // `approximation` **chart**, which is an Aggregate alone, and that split is
    // inside the pane rather than in the navigation: `agg` and `agg_reins` get
    // both pills, `port` gets Summary with Plot greyed. This grid is leaves, so
    // it cannot say that; `main.js::approximationCanPlot` is where it lives.
    'more:approximation': ['agg', 'agg_reins', 'port'],
    'more:window': ['agg', 'agg_reins', 'port', 'bvagg'],
    'more:dependency': ['bvagg'],
    // Dark for every kind here, and that is the assertion, not an omission.
    // The Sharpen leaf shows an audit that only exists once the probe has run,
    // and `capture-capability.py` builds each fixture and stops. An object that
    // has been sharpened lights it; nothing captured has been.
    'more:sharpen': [],
    'more:narrative': ['agg', 'agg_reins', 'port', 'sev', 'distortion', 'bvagg', 'pnl', 'xpnl'],
};

const findings = [];
const width = Math.max(...kinds.map((k) => k.length), 10);
const pad = (s) => String(s).padStart(width);

console.log('\nLeaves\n');
console.log('  '.padEnd(24) + kinds.map(pad).join(' '));
for (const [group, def] of Object.entries(NAV_GROUPS)) {
    for (const key of Object.keys(def.leaves)) {
        const token = `${group}:${key}`;
        const cells = kinds.map((k) => {
            const live = leafAvailable(caps[k], group, key);
            const want = (EXPECTED[token] || []).includes(k);
            if (live !== want) {
                findings.push(`${token} for ${k}: expected ${want ? 'on' : 'off'}, `
                    + `derived ${live ? 'on' : 'off'}`);
                return pad(live ? 'ON?' : '.?');
            }
            return pad(live ? 'on' : '.');
        });
        console.log(token.padEnd(24) + cells.join(' '));
    }
}

console.log('\nGroups, and the leaf each lands on\n');
console.log('  '.padEnd(24) + kinds.map(pad).join(' '));
for (const group of Object.keys(NAV_GROUPS)) {
    const cells = kinds.map((k) => {
        if (!groupAvailable(caps[k], group)) return pad('.');
        const leaf = activeLeaf(caps[k], null, group);
        // A live group can still have no live leaf: Reinsurance for a gross
        // aggregate is the entry box and nothing else. `activeLeaf` falls back
        // to the first key so a pill is drawn active, but printing that name
        // here would claim a pane that stays empty.
        return pad(leafAvailable(caps[k], group, leaf) ? leaf : '(no leaf)');
    });
    console.log(group.padEnd(24) + cells.join(' '));
}

// Every kind has to land somewhere. Overview is the fallback the gating uses
// when the active group goes dark, so it had better be live for everything.
for (const k of kinds) {
    if (!groupAvailable(caps[k], 'overview')) {
        findings.push(`${k}: Overview is dark, so a rebuild has nowhere to land`);
    }
}

// The Reinsurance group is live with every leaf dark, for an aggregate with no
// cession, because the entry box below the row is its content until there is a
// program to describe. That is the one place a group and its leaves disagree,
// so it gets its own check rather than riding on the grid above.
const GROSS_AGG = 'agg';
if (caps[GROSS_AGG]) {
    const anyLeaf = ['summary', 'stats', 'density', 'plot']
        .some((key) => leafAvailable(caps[GROSS_AGG], 'reinsurance', key));
    if (anyLeaf) findings.push('reinsurance: a gross aggregate should have no leaves');
    if (!groupAvailable(caps[GROSS_AGG], 'reinsurance')) {
        findings.push('reinsurance: the group must stay live so cover can be added');
    }
}
for (const k of ['port', 'pnl', 'sev', 'distortion', 'bvagg']) {
    if (caps[k] && groupAvailable(caps[k], 'reinsurance')) {
        findings.push(`reinsurance: ${k} cannot cede, so the group should be dark`);
    }
}

// A remembered leaf that has gone dark must not be kept. This is the rule that
// makes stickiness safe: step from a tower to a plain P&L on the Waterfall leaf
// and the group has to move you, not fire a request that 404s.
const towerCaps = caps.xpnl;
const plainCaps = caps.pnl;
if (towerCaps && plainCaps) {
    if (activeLeaf(towerCaps, 'waterfall', 'economics') !== 'waterfall') {
        findings.push('economics: a tower should keep the Waterfall leaf');
    }
    if (activeLeaf(plainCaps, 'waterfall', 'economics') === 'waterfall') {
        findings.push('economics: a plain P&L must not keep the Waterfall leaf');
    }
}

// The group order is written twice: as the key order of NAV_GROUPS, which is
// what `Alt+1…6` indexes, and as the `<ul class="out-tabs">` list in
// index.html, which is what the eye reads. Nothing made the two agree until
// a49, and a strip whose fourth tab is not what Alt+4 opens is the kind of bug
// nobody reports because each half looks right on its own.
//
// Parsed with a regex rather than a DOM: this file is the only markup in the
// repo and one attribute off one element is not worth a parser dependency. A
// strip that stops matching this shape fails loudly below rather than silently
// finding nothing.
const html = readFileSync(path.join(repo, 'web', 'index.html'), 'utf8');
const strip = html.match(/<ul[^>]*class="[^"]*out-tabs[^"]*"[^>]*>([\s\S]*?)<\/ul>/);
if (!strip) {
    findings.push('index.html: no <ul class="out-tabs"> tab strip found to check');
} else {
    const markup = [...strip[1].matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
    const declared = Object.keys(NAV_GROUPS);
    if (markup.join(',') !== declared.join(',')) {
        findings.push('group order disagrees between the two places it is written:\n'
            + `           index.html: ${markup.join(' ')}\n`
            + `           nav.js:     ${declared.join(' ')}`);
    } else {
        console.log(`Group order agrees in both files: ${declared.join(' ')}`);
    }
}

// Every leaf is also written twice: as a NAV_GROUPS entry, which draws the
// pill, and as a `'group:leaf'` row in main.js's LOADERS table, which is what
// clicking it does. A leaf with no row is a pill that lights, greys and does
// nothing, which is exactly how the Pr Ruin pane shipped dark at a142: every
// gate here was green because gating was all this file checked. Same
// text-level reading as the strip above, and for the same reason.
const mainSrc = readFileSync(path.join(repo, 'web', 'src', 'main.js'), 'utf8');
for (const [group, def] of Object.entries(NAV_GROUPS)) {
    for (const key of Object.keys(def.leaves || {})) {
        if (leafOf(group, key)?.soon) continue;
        if (!mainSrc.includes(`'${group}:${key}':`)) {
            findings.push(`${group}:${key} has no LOADERS row in main.js: the `
                + 'pill would light and do nothing');
        }
    }
}

console.log('');
if (findings.length) {
    for (const f of findings) console.log(`FINDING: ${f}`);
    process.exit(1);
}
console.log('clean: every leaf and group greys exactly where it should');
