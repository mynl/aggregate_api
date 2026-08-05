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
// scheme (`t:`) to the ESM loader, which is the same trap `smoke-exhibits.mjs`
// already sidesteps.
const { NAV_GROUPS, leafAvailable, groupAvailable, activeLeaf, capsFromResponse } =
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
    'economics:ledger': ['pnl', 'xpnl'],
    'economics:ratios': ['pnl', 'xpnl'],
    'economics:waterfall': ['xpnl'],
    'reinsurance:summary': ['agg_reins'],
    'reinsurance:stats': ['agg_reins'],
    'reinsurance:density': ['agg_reins'],
    'reinsurance:plot': ['agg_reins'],
    'pricing:determine': ['agg', 'agg_reins', 'port'],
    'pricing:evaluate': ['agg', 'agg_reins', 'port', 'pnl', 'xpnl'],
    'bounds:bounds': [],
    'bounds:pricing': [],
    'bounds:allocation': [],
    'more:validation': ['agg', 'agg_reins', 'port', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    'more:stats': ['agg', 'agg_reins', 'port', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    'more:density': ['agg', 'agg_reins', 'port', 'sev', 'distortion', 'bvagg', 'pnl', 'xpnl'],
    'more:window': ['agg', 'agg_reins', 'port', 'bvagg'],
    'more:dependency': ['bvagg'],
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
    const cells = kinds.map((k) => pad(
        groupAvailable(caps[k], group) ? activeLeaf(caps[k], null, group) : '.'));
    console.log(group.padEnd(24) + cells.join(' '));
}

// Every kind has to land somewhere. Overview is the fallback the gating uses
// when the active group goes dark, so it had better be live for everything.
for (const k of kinds) {
    if (!groupAvailable(caps[k], 'overview')) {
        findings.push(`${k}: Overview is dark, so a rebuild has nowhere to land`);
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

console.log('');
if (findings.length) {
    for (const f of findings) console.log(`FINDING: ${f}`);
    process.exit(1);
}
console.log('clean: every leaf and group greys exactly where it should');
