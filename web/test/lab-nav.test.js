// The Lab group's leaves, under `node --test`.
//
// Lab is the one group whose leaves are not authored: they come from whatever
// plugin packages are installed, so what these tests pin is the rule that turns
// a boot manifest into leaf definitions. Three things matter and each has cost
// something to get wrong elsewhere in this app: the order has to be stable
// across installs, a plugin must not put a second pill on a document the app
// already shows, and a Lab leaf has to gate through the ordinary
// `available_exhibits` / `available_charts` path rather than through a special
// case.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    NAV_GROUPS, authoredLeafNames, capsFromResponse, installLabLeaves,
    labLeavesFromManifest, leafAvailable, leafOf, groupAvailable, activeLeaf,
} from '../src/nav.js';

/** A manifest shaped like the `plugins` array on `GET /v1/meta`. */
function manifest(...plugins) {
    return plugins.map((p) => ({ version: '0.1.0', source: 'entry_point', ...p }));
}

const RELATIVITY = {
    name: 'relativity',
    leaves: [{
        name: 'relativity',
        kind: 'exhibit',
        label: 'Relativity',
        hint: 'each cover against the gross book',
        why: 'needs an extended P&L',
    }],
};

test('Lab is last, so the strip order is stable and Alt+7 is the new tab', () => {
    const keys = Object.keys(NAV_GROUPS);
    assert.equal(keys.at(-1), 'lab');
    assert.equal(NAV_GROUPS.lab.label, 'Lab');
    // Label and key agree, unlike `reinsurance`/`Re`, which diverged only
    // because the key predated the rename.
    assert.equal(NAV_GROUPS.lab.dynamic, true);
});

test('a plugin leaf carries the plugin its strings came from', () => {
    const leaves = labLeavesFromManifest(manifest(RELATIVITY));
    const leaf = leaves['exhibit-relativity'];
    assert.equal(leaf.label, 'Relativity');
    assert.equal(leaf.hint, 'each cover against the gross book');
    assert.equal(leaf.why, 'needs an extended P&L');
    assert.equal(leaf.exhibit, 'relativity');
    assert.equal(leaf.plugin, 'relativity');
    assert.equal(leaf.pluginVersion, '0.1.0');
});

test('the gate is the ordinary one, so lit-ness is per object', () => {
    // Lab membership is fixed for the process; whether a leaf answers is the
    // same question every other leaf asks, of the same capability payload.
    installLabLeaves(manifest(RELATIVITY));
    const xpnl = capsFromResponse({ exhibits: [{ name: 'relativity' }], charts: [] });
    const agg = capsFromResponse({ exhibits: [{ name: 'summary' }], charts: [] });
    assert.equal(leafAvailable(xpnl, 'lab', 'exhibit-relativity'), true);
    assert.equal(leafAvailable(agg, 'lab', 'exhibit-relativity'), false);
    assert.equal(groupAvailable(xpnl, 'lab'), true);
    assert.equal(groupAvailable(agg, 'lab'), false);
    installLabLeaves([]);
});

test('a dark Lab leaf says the plugin own why, not a generic line', () => {
    installLabLeaves(manifest(RELATIVITY));
    assert.equal(leafOf('lab', 'exhibit-relativity').why,
                 'needs an extended P&L');
    installLabLeaves([]);
});

test('no plugins means no leaves, which is what hides the tab', () => {
    assert.equal(installLabLeaves([]), 0);
    assert.deepEqual(NAV_GROUPS.lab.leaves, {});
    // Every other group greys when nothing is live; this one is absent, because
    // the missing thing is an uninstalled package rather than a capability of
    // the object in front of you.
    assert.equal(groupAvailable(capsFromResponse({ exhibits: [], charts: [] }),
                                'lab'), false);
});

test('order is plugin name, then registration order inside a plugin', () => {
    // The api already reports plugins in name order and leaves in registration
    // order, so the rule here is to preserve what it sent rather than to sort
    // again. Stable across installs, and not dependent on whatever order
    // importlib.metadata happened to return distributions in.
    const leaves = labLeavesFromManifest(manifest(
        { name: 'alpha', leaves: [
            { name: 'a_second', kind: 'exhibit', label: 'A2' },
            { name: 'a_first', kind: 'chart', label: 'A1' },
        ] },
        { name: 'beta', leaves: [{ name: 'b', kind: 'exhibit', label: 'B' }] },
    ));
    assert.deepEqual(Object.keys(leaves),
                     ['exhibit-a_second', 'chart-a_first', 'exhibit-b']);
});

test('a name the app already authored is refused', () => {
    // The loader upstream refuses a plugin that reuses a name the *library*
    // owns. This is the narrower case it cannot see: a pill the app placed
    // deliberately in one of the six groups, over a name a plugin legitimately
    // owns. Two pills for one document is a menu that has stopped being a map.
    assert.ok(authoredLeafNames().has('exhibit:summary'));
    const leaves = labLeavesFromManifest(manifest({
        name: 'probe',
        leaves: [
            { name: 'summary', kind: 'exhibit', label: 'Clash' },
            { name: 'brand_new', kind: 'exhibit', label: 'Fine' },
        ],
    }));
    assert.deepEqual(Object.keys(leaves), ['exhibit-brand_new']);
});

test('a chart and an exhibit may share a name without colliding', () => {
    // `reins` is both a chart and an exhibit in the library, so the two
    // namespaces are genuinely separate and a flat key would lose one.
    const leaves = labLeavesFromManifest(manifest({
        name: 'probe',
        leaves: [
            { name: 'twin', kind: 'exhibit', label: 'Table' },
            { name: 'twin', kind: 'chart', label: 'Picture' },
        ],
    }));
    assert.deepEqual(Object.keys(leaves), ['exhibit-twin', 'chart-twin']);
    assert.equal(leaves['exhibit-twin'].exhibit, 'twin');
    assert.equal(leaves['chart-twin'].chart, 'twin');
});

test('a failed plugin contributes nothing but is not an error here', () => {
    // It registered nothing, so it has no leaves. Its error still travels on the
    // manifest and the About panel shows it.
    const leaves = labLeavesFromManifest(manifest({
        name: 'halfbaked',
        leaves: [],
        error: 'RuntimeError: deliberately broken',
    }));
    assert.deepEqual(leaves, {});
});

test('a leaf of an unknown kind is ignored', () => {
    // A plugin contributes documents, never app behavior: `flag` is the app's
    // own leaf kind and needs code in the SPA. A plugin claiming one must not
    // produce a pill that cannot work.
    const leaves = labLeavesFromManifest(manifest({
        name: 'overreach',
        leaves: [{ name: 'quick_qs', kind: 'flag', label: 'Quick QS' }],
    }));
    assert.deepEqual(leaves, {});
});

test('a manifest that is missing or malformed yields no leaves', () => {
    assert.deepEqual(labLeavesFromManifest(undefined), {});
    assert.deepEqual(labLeavesFromManifest([]), {});
    assert.deepEqual(labLeavesFromManifest([{ name: 'x' }]), {});
});

test('activeLeaf lands on the first live Lab leaf', () => {
    installLabLeaves(manifest({
        name: 'probe',
        leaves: [
            { name: 'dark_one', kind: 'exhibit', label: 'Dark' },
            { name: 'live_one', kind: 'exhibit', label: 'Live' },
        ],
    }));
    const caps = capsFromResponse({ exhibits: [{ name: 'live_one' }], charts: [] });
    assert.equal(activeLeaf(caps, null, 'lab'), 'exhibit-live_one');
    installLabLeaves([]);
});
