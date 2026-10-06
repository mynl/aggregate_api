// The Pentagon figure's geometry and its reading of the wire frame, under
// `node --test`.
//
// Everything asserted here is a pure function, which is the point of the
// figure building its markup as a string: the whole drawing is checkable with
// no DOM and no renderer. What is *not* here is any arithmetic over the
// economics, because there is none in `pentagon.js`. Every amount and every
// ratio the figure prints is a column of `PnL.pentagon_df`, and whether the
// pentagon closes is the library's business, pinned in
// `aggregate_REFACTOR/tests/test_pnl_pentagon.py`.
//
// Run: `npm test` from `web/`, or `node --test web/test/` from the repo root.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    GEOM, VERTS, VIEW_BOX, levelLabel, netFraction, pctFitsInSector,
    pentagonGlyph, pentagonSvg, radiusFor, rowsByStep, sidesOf, springPath,
    wedgePath,
} from '../src/charts/pentagon.js';

// One level's payload in the shape the route serves, with the three rows the
// figure draws plus a ledger step it must ignore. Numbers are the two-tier test
// peel's, rounded: a gross book of 1,000 written, a cession taking 140 of it,
// and a cession with no law of its own, so SD and CV arrive null.
const COLUMNS = ['Step', 'L', 'E', 'P', 'P_tech', 'M', 'a', 'Q',
                 'LR', 'TLR', 'ER', 'CR', 'PQ', 'CoC', 'SD', 'CV'];
const FRAME = {
    columns: COLUMNS,
    rows: [
        ['Gross', 700, 0, 1000, 1000, 300, 2820, 1820,
         0.7, 0.7, 0, 0.7, 0.549, 0.165, 592, 0.845],
        ['All occurrence', -248, -12, -100, -88, 160, -1040, -952,
         2.477, 2.814, 0.12, 2.597, 0.105, -0.168, 253, -1.022],
        ['All', 339, -12, 860, 872, 533, 1736, 864,
         0.394, 0.389, -0.014, 0.38, 0.995, 0.617, 346, 1.022],
        ['Ceded', -361, -12, -140, -128, 233, -1084, -956,
         2.58, 2.822, 0.086, 2.666, 0.146, -0.244, null, null],
    ],
};

// ----------------------------------------------------------------------
// Reading the frame
// ----------------------------------------------------------------------
test('the frame is read by Step, which arrives as a column', () => {
    const rows = rowsByStep(FRAME);
    assert.deepEqual(Object.keys(rows),
        ['Gross', 'All occurrence', 'All', 'Ceded']);
    assert.equal(rows.Gross.a, 2820);
    assert.equal(rows.Ceded.SD, null);
    // Step itself is not left in the row
    assert.equal(rows.Gross.Step, undefined);
});

test('a frame with no Step column reads as empty rather than mis-keyed', () => {
    assert.deepEqual(rowsByStep({ columns: ['L'], rows: [[1]] }), {});
    assert.deepEqual(rowsByStep(null), {});
    assert.deepEqual(rowsByStep({}), {});
});

test('the three sides are Gross, Ceded and All, and the steps ride along', () => {
    const sides = sidesOf(FRAME);
    assert.equal(sides.gross.a, 2820);
    assert.equal(sides.net.a, 1736);
    assert.equal(sides.ceded.a, -1084);
    // the ledger's own steps are kept whole, for whatever reads them next
    assert.ok('All occurrence' in sides.steps);
});

test('the closing row is All, the word the ledger uses', () => {
    // Not `Net`. The ledger, the summary card and the walk all spell it `All`,
    // and a second word for the same thing is the drift the library's own
    // index docstring warns against.
    assert.ok(FRAME.rows.some((r) => r[0] === 'All'));
    assert.ok(!FRAME.rows.some((r) => r[0] === 'Net'));
});

test('a P&L with no program reads its cession as zero, not as missing', () => {
    const one = { columns: COLUMNS, rows: [FRAME.rows[0]] };
    const sides = sidesOf(one);
    assert.equal(sides.net.a, sides.gross.a, 'net is gross with no program');
    assert.equal(sides.ceded.a, 0);
    assert.equal(sides.ceded.L, 0);
});

test('a frame with no Gross row has no pentagon to draw', () => {
    assert.equal(sidesOf({ columns: COLUMNS, rows: [] }), null);
    assert.equal(pentagonSvg({ columns: COLUMNS, rows: [] }, 100), '');
});

// ----------------------------------------------------------------------
// The disc: area is the amount, the wedge is the net share
// ----------------------------------------------------------------------
test('disc area is proportional to the amount, so radius goes as its root', () => {
    const r1 = radiusFor(400, 1600);
    const r2 = radiusFor(1600, 1600);
    assert.equal(r2, GEOM.R_MAX, 'the largest amount sets the scale');
    assert.ok(Math.abs(r1 / r2 - 0.5) < 1e-12, 'a quarter the area, half the radius');
});

test('a disc is floored so a vanishing node still carries its label', () => {
    assert.equal(radiusFor(0, 1600), 11);
    assert.equal(radiusFor(-500, 1600), 11, 'a negative amount has no area');
    assert.equal(radiusFor(10, 0), 11, 'nor does a figure with no scale');
    assert.equal(radiusFor(Number.NaN, 1600), 11);
});

test('a disc can never exceed the cap, whatever it is handed', () => {
    // The cap is what makes the figure legible: every disc is an area against
    // the largest amount in it. An amount above that maximum would otherwise
    // draw a disc over its neighbours.
    assert.equal(radiusFor(1600, 1600), GEOM.R_MAX);
    assert.equal(radiusFor(999999, 1600), GEOM.R_MAX);
});

test('the net fraction is the net share of the gross, clamped', () => {
    assert.equal(netFraction(500, 1000), 0.5);
    assert.equal(netFraction(1500, 1000), 1, 'a net above gross is wholly net');
    assert.equal(netFraction(-200, 1000), 0, 'and a negative net wholly ceded');
});

test('a node with nothing to split declines rather than reading 100% ceded', () => {
    // The expense node on a program whose only expense is a ceding commission:
    // gross expense is zero and the net is a credit. A fraction of 0 there
    // would print "100.0%" of nothing.
    assert.equal(netFraction(-12, 0), null);
    assert.equal(netFraction(5, Number.NaN), null);
    assert.equal(netFraction(Number.NaN, 100), null);
});

test('the wedge sweeps clockwise from twelve oclock', () => {
    const half = wedgePath(100, 100, 50, 0.5, 'k');
    // starts at the center, goes to the top of the disc, then arcs
    assert.ok(half.startsWith('<path class="k" d="M100,100 L100.0,50.0 A50,50'),
        half);
    // a half turn is not a large arc; just over one is
    assert.ok(half.includes(' 0 0,1 '), half);
    assert.ok(wedgePath(100, 100, 50, 0.6, 'k').includes(' 0 1,1 '));
});

test('a whole wedge is a circle and a vanishing one is nothing', () => {
    assert.ok(wedgePath(0, 0, 10, 1, 'k').startsWith('<circle'));
    assert.equal(wedgePath(0, 0, 10, 0, 'k'), '');
    assert.equal(wedgePath(0, 0, 10, 0.0001, 'k'), '');
    assert.equal(wedgePath(0, 0, 10, Number.NaN, 'k'), '');
});

test('a sector too thin for its own percentage calls out instead', () => {
    assert.ok(pctFitsInSector(40, 0.5), 'half a large disc has room');
    assert.ok(!pctFitsInSector(12, 0.5), 'a small disc never does');
    assert.ok(!pctFitsInSector(40, 0.02), 'nor does a sliver of a large one');
});

// ----------------------------------------------------------------------
// The frame the nodes hang on
// ----------------------------------------------------------------------
test('the vertex order is P at the bottom, then clockwise', () => {
    assert.equal(VERTS.length, 5);
    assert.deepEqual(VERTS[0], [0, 1], 'P at the bottom of the figure');
    assert.ok(VERTS[1][0] < 0 && VERTS[2][0] < 0, 'Q then a on the left');
    assert.ok(VERTS[3][0] > 0 && VERTS[4][0] > 0, 'L then M on the right');
});

test('the spring runs between its endpoints and coils in between', () => {
    const d = springPath([0, 0], [100, 0], 3, 5);
    assert.ok(d.startsWith('M0.0,0.0 L12.0,0.0'), d);
    assert.ok(d.endsWith('L88.0,0.0 L100.0,0.0'), d);
    // 3 coils is 6 offsets, alternating either side of the straight run
    assert.equal((d.match(/,5\.0/g) || []).length, 3);
    assert.equal((d.match(/,-5\.0/g) || []).length, 3);
});

test('a spring between coincident points is a bare move', () => {
    assert.equal(springPath([7, 7], [7, 7]), 'M7,7');
});

// ----------------------------------------------------------------------
// The whole figure
// ----------------------------------------------------------------------
test('the figure draws every node, chip and label stack', () => {
    const svg = pentagonSvg(FRAME, 100);
    const { x, y, w, h } = VIEW_BOX;
    assert.ok(svg.startsWith(
        `<svg class="pent-figure" viewBox="${x} ${y} ${w} ${h}"`), svg.slice(0, 60));
    // seven nodes and three chips, each its own tooltip host
    assert.equal((svg.match(/class="pent-node"/g) || []).length, 10);
    assert.equal((svg.match(/class="pent-chip"/g) || []).length, 3);
    // the names are uppercased by CSS, so the markup carries them as written
    for (const name of ['assets**', 'loss and CV', 'capital', 'margin and SD',
                        'technical prem', 'expenses and ER',
                        'gross prem, CR and CV']) {
        assert.ok(svg.includes(`>${name}</text>`), name);
    }
    for (const head of ['CoC', 'TLR', 'LR', 'P:Q']) {
        assert.ok(svg.includes(`>${head}<`), head);
    }
});

test('assets carries the only input mark in the figure', () => {
    // The reader sets one thing, the solvency level, and the figure says so in
    // one place. aSP marked four quantities because it had four inputs.
    const svg = pentagonSvg(FRAME, 100);
    assert.equal((svg.match(/\*\*/g) || []).length, 1);
    assert.ok(svg.includes('>assets**<'));
});

test('the three rows of every stack take the gross, ceded, net order', () => {
    const svg = pentagonSvg(FRAME, 100);
    const stacks = svg.indexOf('class="pent-g"');
    assert.ok(stacks > 0);
    assert.ok(svg.indexOf('class="pent-c"') > stacks);
    assert.ok(svg.indexOf('class="pent-n"') > svg.indexOf('class="pent-c"'));
});

test('a quantity the ledger declined prints a dot', () => {
    // The cession's standard deviation and CV on a stitched ledger: there is no
    // joint to form them from, so the frame serves null and the figure must not
    // invent a zero.
    const svg = pentagonSvg(FRAME, 100);
    // exactly three cells read it: the cession's SD on the margin node, its CV
    // on the loss node, and the cv of its combined ratio on the premium node
    assert.equal((svg.match(/·/g) || []).length, 3);
    // a real zero is still a zero. The gross book here declares no expense, so
    // its expense cell is 0.00 and must not be mistaken for a declined one.
    assert.ok(svg.includes('>0.00</text>'));
});

test('the level reaches the figures own label', () => {
    assert.ok(pentagonSvg(FRAME, 250).includes('1-in-250'));
    assert.ok(pentagonSvg(FRAME, 2000).includes('1-in-2,000'));
});

test('the viewBox is cropped to what the figure actually occupies', () => {
    // Measured against a live figure the content runs x 255 to 796 and y 89 to
    // 624. aSP's own `0 0 1000 700` suited the fixed card it drew into and
    // leaves 46% of the width empty here, which on a narrow screen is dead
    // scroll.
    assert.ok(VIEW_BOX.x <= 255 && VIEW_BOX.x + VIEW_BOX.w >= 796);
    assert.ok(VIEW_BOX.y <= 89 && VIEW_BOX.y + VIEW_BOX.h >= 624);
    assert.ok(VIEW_BOX.w < 1000 && VIEW_BOX.h < 700, 'and it is a crop');
});

test('the level label groups its thousands', () => {
    assert.equal(levelLabel(100), '1-in-100');
    assert.equal(levelLabel(2000), '1-in-2,000');
});

test('the strips glyph is the pentagon itself, five points', () => {
    const glyph = pentagonGlyph(30);
    assert.ok(glyph.includes('viewBox="0 0 30 30"'));
    assert.equal(glyph.match(/points="([^"]+)"/)[1].split(' ').length, 5);
});

test('a tooltip with a quote cannot break out of its attribute', () => {
    // Every tooltip here is authored, but the node names are interpolated too,
    // so the escape is applied to all of them.
    const svg = pentagonSvg(FRAME, 100);
    const titles = svg.match(/title="[^"]*"/g) || [];
    assert.equal(titles.length, 10, 'one per node and chip');
    assert.ok(!svg.includes('title=""'), 'and none of them empty');
});
