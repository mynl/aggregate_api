// The Pentagon figure: gross, ceded and net on one picture.
//
// Ported from the retired `aggregate-asp` experiment (`js/combined.js`), which
// is where the figure was designed and where it earned its place: it is the one
// drawing in that app that carried a whole report at a glance. The vertex
// order, the spring on the one statistical edge, the area-proportional discs,
// the wedge geometry, the call-out rule for a sector too thin to hold its own
// percentage, the three-row label stacks and the three chips all come across as
// they were.
//
// **This file holds no economics.** Every number it draws is a column of
// `PnL.pentagon_df`, served by `POST /v1/objects/{id}/pnl/pentagon`; the only
// arithmetic here is geometry, which is radius from amount, wedge fraction from
// the net share, and the percentage printed in the sector. That division is the
// plan's governing principle (`dev/plan-a195-pnl-pentagon.md`, ruled
// 2026-10-06): the library owns the arithmetic, the browser owns the geometry.
// It constrains the next bespoke figure rather than licensing it. A new picture
// may own its own geometry, and may never own its own arithmetic. aSP's actual
// sin was solving the economics client side, and that does not come across.
//
// One color convention runs the whole figure, and every stack takes the same
// order, the walk from gross to net:
//
//     ink   gross          red   ceded          blue   net
//
// Every node is a disc whose AREA is the gross amount, split by a wedge swept
// from twelve o'clock: blue is the net share, red is what the cession took, the
// same two colors the numbers use. So the cession is literally the part left
// over, which is what makes the figure work. The discs are opaque and draw over
// the edges, so the figure looks like beads on a frame.
//
// A double asterisk marks a quantity the reader set rather than the engine
// derived. In aSP that was four things; here the solvency level is the only
// input, so the mark goes on `assets` and nowhere else.
//
// The markup is built as a string and handed to the DOM once, which is aSP's
// own approach and keeps every geometry function pure and testable under
// `node --test` with no DOM at all. See `web/test/pentagon.test.js`.

import { money, percent } from '../pricing-form.js';

// ----------------------------------------------------------------------
// Geometry
// ----------------------------------------------------------------------

/** The report's vertex order: P at the bottom, then clockwise Q, a, L, M. */
export const VERTS = [[0, 1], [-0.951, 0.309], [-0.588, -0.809],
                      [0.588, -0.809], [0.951, 0.309]];

/**
 * The figure's fixed frame, in viewBox units.
 *
 * `WY` is the gross written premium node, hanging below the pentagon on the
 * premium chain; `EY` is expenses, halfway between the pentagon's foot and it.
 * `R_MAX` caps a disc, so the largest amount in the figure sets the scale and
 * everything else is an area against it.
 */
export const GEOM = { CX: 500, CY: 250, R: 150, R_MAX: 40, WY: 600 };
GEOM.EY = (GEOM.CY + GEOM.R + GEOM.WY) / 2;

/**
 * The viewBox, cropped to what the figure actually occupies.
 *
 * aSP drew the same geometry inside `0 0 1000 700`, which suited the fixed
 * desktop card it sat in and leaves 46% of the width and 24% of the height
 * empty here. Measured against a live figure the content runs x 255 to 796 and
 * y 89 to 624, so this is that box with a margin, and the margin is generous on
 * the right where the widest label stack is three columns of currency.
 *
 * Derived from the geometry rather than measured at draw time, which would mean
 * rendering twice: the vertices are fixed, `R_MAX` caps every disc, and `COLS`
 * caps every label stack, so the extent is known in advance and does not move
 * with the numbers.
 */
export const VIEW_BOX = { x: 235, y: 78, w: 620, h: 580 };

/** Every stack takes the same order down the page: gross, ceded, net. */
const ROW_CLS = ['pent-g', 'pent-c', 'pent-n'];

/** Column offsets for a label stack carrying more than one figure. */
const COLS = [0, 66, 128, 176];

/** Below this an amount is treated as absent rather than as zero. */
const TINY = 1e-9;

/**
 * A spring path between two points: coils between straight stubs.
 *
 * The assets to loss edge is the one statistical link in the figure, the one
 * the solvency standard stretches, so it draws as a spring while the identities
 * draw as straight edges.
 */
export function springPath(p1, p2, coils = 6, amp = 7, stub = 0.12) {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) return `M${p1[0]},${p1[1]}`;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const s1 = [p1[0] + ux * len * stub, p1[1] + uy * len * stub];
    const s2 = [p2[0] - ux * len * stub, p2[1] - uy * len * stub];
    let d = `M${p1[0].toFixed(1)},${p1[1].toFixed(1)}`
        + ` L${s1[0].toFixed(1)},${s1[1].toFixed(1)}`;
    const n = coils * 2;
    for (let i = 1; i <= n; i += 1) {
        const t = i / (n + 1);
        const px = s1[0] + (s2[0] - s1[0]) * t;
        const py = s1[1] + (s2[1] - s1[1]) * t;
        const off = i % 2 ? amp : -amp;
        d += ` L${(px + nx * off).toFixed(1)},${(py + ny * off).toFixed(1)}`;
    }
    d += ` L${s2[0].toFixed(1)},${s2[1].toFixed(1)}`
        + ` L${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    return d;
}

/**
 * Disc radius for an amount, scaled so AREA is proportional to it.
 *
 * Floored, because a node that vanishes still has to carry its label, and
 * clamped both ways on the share: at zero below, since a negative amount has no
 * area, and at one above, so a disc can never exceed `R_MAX` whatever it is
 * handed. A gross figure is positive on any sensible book and no amount exceeds
 * the figure's own maximum, so both clamps are guards rather than arithmetic;
 * they are what keeps a loss-making book, or a degenerate one whose every
 * amount is zero, drawing rather than throwing.
 */
export function radiusFor(value, vmax) {
    if (!(vmax > 0) || !Number.isFinite(value)) return 11;
    const share = Math.min(Math.max(value / vmax, 0), 1);
    return Math.max(11, GEOM.R_MAX * Math.sqrt(share));
}

/**
 * The net share of a gross amount, as a fraction in [0, 1].
 *
 * Returns `null` where the gross amount is absent or vanishes, which is a node
 * with nothing to split rather than a node that is wholly ceded. The expense
 * node reaches this on a program whose only expense is a ceding commission:
 * gross expense is zero and the net is a credit, so a fraction of 0 would
 * print "100.0% ceded" of nothing.
 */
export function netFraction(net, gross) {
    if (!Number.isFinite(gross) || Math.abs(gross) <= TINY) return null;
    if (!Number.isFinite(net)) return null;
    return Math.min(Math.max(net / gross, 0), 1);
}

/**
 * Does the ceded percentage fit inside its own sector?
 *
 * The usable width is the chord across the sector at the radius the text sits
 * on, and five characters of the smallest legible type need about 22 of them.
 */
export function pctFitsInSector(r, cededFraction) {
    return r >= 18
        && 1.1 * r * Math.sin(Math.min(Math.PI * cededFraction, Math.PI / 2))
            >= 22;
}

/** The angle bisecting the ceded sector, which runs from the end of the net
    wedge back round to twelve o'clock. */
const cedeAngle = (f) => -Math.PI / 2 + Math.PI * (1 + f);

/** A pie slice of the disc, swept clockwise from twelve o'clock. */
export function wedgePath(cx, cy, r, f, cls) {
    if (!Number.isFinite(f) || f <= 0.0005) return '';
    if (f >= 0.9995) {
        return `<circle class="${cls}" cx="${cx}" cy="${cy}" r="${r}"/>`;
    }
    const a0 = -Math.PI / 2;
    const a1 = a0 + 2 * Math.PI * f;
    const x1 = cx + r * Math.cos(a0);
    const y1 = cy + r * Math.sin(a0);
    const x2 = cx + r * Math.cos(a1);
    const y2 = cy + r * Math.sin(a1);
    const large = f > 0.5 ? 1 : 0;
    return `<path class="${cls}" d="M${cx},${cy} L${x1.toFixed(1)},`
        + `${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},`
        + `${y2.toFixed(1)} Z"/>`;
}

// ----------------------------------------------------------------------
// Reading the wire frame
// ----------------------------------------------------------------------

/**
 * `{Step: {column: value}}` for one level's frame.
 *
 * The response carries `Step` as the first column, so the index of
 * `PnL.pentagon_df` arrives as data. The figure draws three of those rows and
 * ignores the rest, which are the ledger's own steps and are what a future
 * stepper would walk.
 */
export function rowsByStep(frame) {
    if (!frame || !Array.isArray(frame.columns)) return {};
    const [first, ...rest] = frame.columns;
    const out = {};
    for (const row of frame.rows || []) {
        if (first !== 'Step') break;
        out[row[0]] = Object.fromEntries(rest.map((c, i) => [c, row[i + 1]]));
    }
    return out;
}

/**
 * The three rows the figure draws, or `null` when the frame cannot supply them.
 *
 * The closing position is `All`, not `Net`. That is what the ledger, the
 * summary card and the walk all call it, and inventing a second word for it
 * here would be exactly the drift the library's own index docstring warns
 * against. A P&L with no program has one row and no cession, and then the
 * cession reads as zero throughout, which is the honest picture.
 */
export function sidesOf(frame) {
    const rows = rowsByStep(frame);
    const gross = rows.Gross;
    if (!gross) return null;
    const net = rows.All || gross;
    const ceded = rows.Ceded
        || Object.fromEntries(Object.keys(gross).map((k) => [k, 0]));
    return { gross, ceded, net, steps: rows };
}

/** `1-in-100`, the label the strip and the caption both use. */
export function levelLabel(t) {
    return `1-in-${Number(t).toLocaleString('en-US')}`;
}

// ----------------------------------------------------------------------
// Formatting
// ----------------------------------------------------------------------

/** A quantity the frame declined, which the figure prints as a dot. */
const DOT = '·';

const m = (v) => (Number.isFinite(v) ? money(v) : DOT);
const pct = (v) => (Number.isFinite(v) ? percent(v) : DOT);
const num = (v) => (Number.isFinite(v) ? v.toFixed(2) : DOT);
const lev = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}:1` : DOT);

/** Escape for an attribute value. Every tooltip is authored here, but the
    object's own labels are not, so this is applied to all of them. */
function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------------
// The pieces
// ----------------------------------------------------------------------

/**
 * One sized node: the gross amount by area, the net share filled blue, the
 * cession left red, and the ceded percentage in white inside the red sector.
 *
 * Where the sector is too small to hold it, the figure calls out instead, just
 * off the disc diagonally above it, on the side away from the label. A call-out
 * sits close enough to its own disc to need no leader, with one exception the
 * caller names: where the sector it measures is nowhere near it, a hairline
 * runs in. The hairline ends inside the red, just counterclockwise of twelve
 * o'clock where the red sector ends, so it travels beside that boundary rather
 * than across the blue; on a thin cession it steps in proportionately so it
 * cannot overshoot into the blue.
 */
function nodeDisc(x, y, r, f, out, lead) {
    if (f === null) {
        // nothing to split: a neutral disc, and no percentage of nothing
        return `<circle class="pent-empty" cx="${x}" cy="${y}" r="${r}"/>`;
    }
    const fc = 1 - f;
    if (fc < 0.005) {
        return `<circle class="pent-ceded" cx="${x}" cy="${y}" r="${r}"/>`
            + wedgePath(x, y, r, f, 'pent-net');
    }
    const txt = percent(fc);
    let label;
    if (!out) {
        const a = cedeAngle(f);
        const fs = Math.max(6, Math.min(8.5, r * 0.25));
        label = `<text class="pent-pin" font-size="${fs.toFixed(1)}" `
            + `x="${(x + 0.58 * r * Math.cos(a)).toFixed(1)}" `
            + `y="${(y + 0.58 * r * Math.sin(a) + fs * 0.35).toFixed(1)}">`
            + `${txt}</text>`;
    } else {
        const side = out === 'upright' ? 1 : -1;
        const tx = x + side * (0.66 * r + 2);
        const ty = y - 0.66 * r - 2;
        const d = Math.min(0.22, 2 * Math.PI * fc * 0.4);
        const b = -Math.PI / 2 - d;
        const line = !lead ? '' : `<line class="pent-lead" `
            + `x1="${(tx - side * 3).toFixed(1)}" y1="${(ty + 1.5).toFixed(1)}" `
            + `x2="${(x + 0.55 * r * Math.cos(b)).toFixed(1)}" `
            + `y2="${(y + 0.55 * r * Math.sin(b)).toFixed(1)}"/>`;
        label = `${line}<text class="pent-pct" x="${tx.toFixed(1)}" `
            + `y="${ty.toFixed(1)}" `
            + `text-anchor="${side > 0 ? 'start' : 'end'}">${txt}</text>`;
    }
    return `<circle class="pent-ceded" cx="${x}" cy="${y}" r="${r}"/>`
        + wedgePath(x, y, r, f, 'pent-net') + label;
}

/**
 * The three lines beside a node, gross over ceded over net.
 *
 * A row may carry more than one column; they set right-aligned, as the chips
 * do, so the columns line up down the stack. The node's title names the columns
 * in order, which is the principle everywhere here: titles match numbers.
 */
function nodeLabel(x, y, r, side, name, rows, dx = 0) {
    const anchor = side === 'left' ? 'end' : 'start';
    const lx = (side === 'left' ? x - r - 12 : x + r + 12) + dx;
    const line = (t, i) => {
        const yy = y - 11 + i * 15;
        const cells = Array.isArray(t) ? t : [t];
        // a single figure takes the first column's position, so the amounts
        // line up from node to node whatever else they carry
        if (cells.length === 1) {
            return `<text class="${ROW_CLS[i]}" `
                + `x="${side === 'left' ? lx : lx + COLS[1]}" y="${yy}" `
                + `text-anchor="end">${cells[0]}</text>`;
        }
        return cells.map((c, k) => {
            const cx = side === 'left'
                ? lx - COLS[cells.length - 1 - k] : lx + COLS[k + 1];
            return `<text class="${ROW_CLS[i]}" x="${cx}" y="${yy}" `
                + `text-anchor="end">${c}</text>`;
        }).join('');
    };
    return `<text class="pent-name" x="${lx}" y="${y - 26}" `
        + `text-anchor="${anchor}">${esc(name)}</text>`
        + rows.map(line).join('');
}

/** A chip: a row of column titles, then the three colored rows. */
function chip(x, y, heads, rows, w = 72) {
    const h = 15 * rows.length + 22;
    const cw = w / heads.length;
    const colX = (c) => x - w / 2 + cw * (c + 1) - 6;
    return `<g class="pent-chip">`
        + `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" `
        + `height="${h}" rx="5"/>`
        + heads.map((t, c) => `<text class="pent-chip-head" x="${colX(c)}" `
            + `y="${y - h / 2 + 12}" text-anchor="end">${esc(t)}</text>`).join('')
        + rows.map((cells, i) => cells.map((t, c) => `<text `
            + `class="${ROW_CLS[i]} pent-chip-v" x="${colX(c)}" `
            + `y="${y - h / 2 + 28 + i * 15}" text-anchor="end">${t}</text>`)
            .join('')).join('')
        + `</g>`;
}

// ----------------------------------------------------------------------
// The figure
// ----------------------------------------------------------------------

/** The mini pentagon outline the strip uses as its own glyph. */
export function pentagonGlyph(size = 34) {
    const c = size / 2;
    const r = size * 0.353;
    const pts = VERTS
        .map(([x, y]) => [(c + r * x).toFixed(2), (c + r * y).toFixed(2)]
            .join(','))
        .join(' ');
    return `<svg class="pent-glyph" width="${size}" height="${size}" `
        + `viewBox="0 0 ${size} ${size}" aria-hidden="true">`
        + `<polygon points="${pts}"/></svg>`;
}

/**
 * The whole figure for one solvency level, as SVG markup.
 *
 * Parameters
 * ----------
 * frame : object
 *     One level's `{columns, rows}` payload.
 * t : number
 *     The level, for the tooltip on assets, which is the one node the reader's
 *     own choice moves.
 *
 * Returns
 * -------
 * string
 *     An `<svg>` element's markup, or an empty string where the frame carries
 *     no `Gross` row and so has no pentagon to draw.
 */
export function pentagonSvg(frame, t) {
    const sides = sidesOf(frame);
    if (!sides) return '';
    const { gross: g, ceded: c, net: n } = sides;
    const { CX, CY, R, WY, EY } = GEOM;
    const star = '**';
    const pts = VERTS.map(([x, y]) => [CX + R * x, CY + R * y]);
    const [pP, pQ, pA, pL, pM] = pts;
    const vmax = Math.max(g.a, g.L, g.M, g.P_tech, g.Q, g.P, 1);
    const el = [];
    // the frame: identities straight, the one statistical edge a spring
    el.push(`<path class="pent-edge" d="M${pP[0]},${pP[1]} L${pQ[0]},${pQ[1]} `
        + `L${pA[0]},${pA[1]}"/>`
        + `<path class="pent-edge" d="M${pL[0]},${pL[1]} L${pM[0]},${pM[1]} `
        + `L${pP[0]},${pP[1]}"/>`
        + `<path class="pent-edge" d="${springPath(pA, pL, 7, 8)}"/>`
        + `<line class="pent-diag" x1="${pQ[0]}" y1="${pQ[1]}" `
        + `x2="${pM[0]}" y2="${pM[1]}"/>`
        + `<line class="pent-diag" x1="${pP[0]}" y1="${pP[1]}" `
        + `x2="${pL[0]}" y2="${pL[1]}"/>`
        + `<line class="pent-edge" x1="${CX}" y1="${pP[1]}" x2="${CX}" `
        + `y2="${WY}"/>`
        + `<line class="pent-arc" x1="${pQ[0]}" y1="${pQ[1]}" x2="${CX}" `
        + `y2="${WY}"/>`);
    const place = (pos, key, name, side, rows, opt = {}) => {
        const gv = g[key];
        const r = radiusFor(gv, vmax);
        const f = netFraction(n[key], gv);
        // the call-out goes above the disc, on the side away from the label,
        // so the two mid vertices mirror each other
        const out = (f === null || pctFitsInSector(r, 1 - f)) ? null
            : (side === 'left' ? 'upright' : 'upleft');
        el.push(`<g class="pent-node" data-bs-toggle="tooltip" `
            + `title="${esc(opt.tip || '')}">`
            + nodeDisc(pos[0], pos[1], r, f, out, opt.lead)
            + nodeLabel(pos[0], pos[1], r, side, name, rows, opt.dx || 0)
            + `</g>`);
    };
    /** The one-column stack: gross over ceded over net, in currency. */
    const stack = (key) => [m(g[key]), m(c[key]), m(n[key])];
    /** The two-column stack: the amount, then whatever rides beside it. */
    const pair = (key, gx, cx, nx) => [[m(g[key]), gx], [m(c[key]), cx],
                                       [m(n[key]), nx]];

    place(pA, 'a', `assets${star}`, 'left', stack('a'),
        { tip: `Assets the solvency standard calls for at ${levelLabel(t)}: `
            + 'a = P + Q, with P the technical premium. The one figure in the '
            + 'picture the reader sets, through the strip above. Notional: '
            + 'nothing in the ledger is truncated here and no default is '
            + 'modeled.' });
    // no star on loss: aSP marked volume here, which the reader set through its
    // own book card. Here the solvency level is the only input, so assets takes
    // the only mark in the figure.
    place(pL, 'L', 'loss and CV', 'right',
        pair('L', num(g.CV), num(c.CV), num(n.CV)),
        { tip: 'Expected loss, with the coefficient of variation of that law '
            + 'beside it. The ceded CV is the cession taken as one position, '
            + 'off the ledger, and prints a dot where the ledger has no joint '
            + 'to form it from.' });
    // capital is the one node whose call-out lands clear across the disc from
    // the sector it measures, so it is the one that takes a leader
    place(pQ, 'Q', 'capital', 'left', stack('Q'),
        { lead: true,
          tip: 'Capital behind the book: Q = a − P. The red share is what the '
            + 'cession released, and it does not have to grow with the level: '
            + 'a program exhausted in the far tail releases less at a remoter '
            + 'standard.' });
    // a margin is premium less loss and the premium is fixed, so the standard
    // deviation of a margin is the standard deviation of its loss
    place(pM, 'M', 'margin and SD', 'right',
        pair('M', m(g.SD), m(c.SD), m(n.SD)),
        { tip: 'Margin, the price of risk: M = P − L, with the standard '
            + 'deviation of that result beside it. Red is the margin the '
            + 'cession took, which is the cost of the reinsurance.' });
    place(pP, 'P_tech', 'technical prem', 'right', stack('P_tech'),
        { dx: 16,
          tip: 'Technical premium, loss plus margin, before expenses: '
            + 'P = L + M.' });
    place([CX, EY], 'E', 'expenses and ER', 'right',
        pair('E', pct(g.ER), pct(c.ER), pct(n.ER)),
        { tip: 'Expenses and the expense ratio on each basis, against written '
            + 'premium. A ceding commission books as a credit here, so the '
            + 'ceded line can read negative.' });
    const cvOf = (row) => (Number.isFinite(row.SD)
        ? num(row.SD / (row.L + row.E)) : DOT);
    place([CX, WY], 'P', 'gross prem, CR and CV', 'right', [
        [m(g.P), pct(g.CR), cvOf(g)],
        [m(c.P), pct(c.CR), cvOf(c)],
        [m(n.P), pct(n.CR), cvOf(n)],
    ], { tip: 'Written premium, its combined ratio, and the cv of that '
            + 'combined ratio: the standard deviation over loss plus expense. '
            + 'The red line is the cession, ceded premium and what it bought.' });
    // the chips, each on the line it belongs to, each with its own tooltip
    const wrap = (tip, inner) => `<g class="pent-node" `
        + `data-bs-toggle="tooltip" title="${esc(tip)}">${inner}</g>`;
    el.push(wrap('Cost of capital, margin over capital. The red row is the '
        + 'cession itself: margin given up over capital released, which is the '
        + 'rate the reinsurance was bought at.',
    chip((pQ[0] + pM[0]) / 2, (pQ[1] + pM[1]) / 2, ['CoC'],
        [[pct(g.CoC)], [pct(c.CoC)], [pct(n.CoC)]], 62)));
    el.push(wrap('Loss over technical premium, then loss over written premium.',
    chip(pP[0] + (pL[0] - pP[0]) * 0.66 - 16,
        pP[1] + (pL[1] - pP[1]) * 0.66, ['TLR', 'LR'],
        [[pct(g.TLR), pct(g.LR)], [pct(c.TLR), pct(c.LR)],
         [pct(n.TLR), pct(n.LR)]], 106)));
    el.push(wrap('Written premium to capital. The red row is ceded premium '
        + 'over the capital that cession released.',
    chip((pQ[0] + CX) / 2 - 16, (pQ[1] + WY) / 2, ['P:Q'],
        [[lev(g.PQ)], [lev(c.PQ)], [lev(n.PQ)]], 72)));
    const { x, y, w, h } = VIEW_BOX;
    return `<svg class="pent-figure" viewBox="${x} ${y} ${w} ${h}" `
        + `role="img" aria-label="Pentagon report at ${levelLabel(t)}">`
        + el.join('') + `</svg>`;
}

// ----------------------------------------------------------------------
// The leaf
// ----------------------------------------------------------------------

/**
 * The strip of mini pentagons, one per level, the live one marked.
 *
 * Each carries its level and the assets that level implies, so the reader picks
 * from figures they can already see. That is a different act from choosing a
 * parameter, which is why this is not a dropdown: a select would show one
 * number at a time and make the leaf worse than the thing it replaced.
 */
function stripMarkup(levels, live) {
    return `<div class="pent-strip" role="group" `
        + `aria-label="Solvency level">`
        + levels.map((lv, i) => {
            const sides = sidesOf(lv.frame);
            // the closing position's assets, which is what the firm would
            // actually hold at that standard, and so the figure a reader is
            // choosing between. The gross number is in the figure itself.
            const assets = sides ? sides.net.a : null;
            return `<button type="button" class="pent-mini`
                + `${i === live ? ' on' : ''}" data-level="${i}" `
                + `aria-pressed="${i === live}" `
                + `title="Net assets at ${levelLabel(lv.t)}: ${m(assets)}">`
                + pentagonGlyph(30)
                + `<span class="pent-mini-t">${levelLabel(lv.t)}</span>`
                + `<span class="pent-mini-a">net a ${m(assets)}</span>`
                + `</button>`;
        }).join('')
        + `</div>`;
}

/** The note under the figure: the three things the picture cannot say itself. */
function noteMarkup(t) {
    return `<p class="pent-note">`
        + `<b class="pent-key-g">gross</b> <span class="pent-dot">·</span> `
        + `<b class="pent-key-c">ceded</b> <span class="pent-dot">·</span> `
        + `<b class="pent-key-n">net</b>`
        + `<br><b>**</b> marks the one figure you set, the solvency level, `
        + `now ${levelLabel(t)}. `
        + `Disc area is the gross amount and the blue wedge its net share, so `
        + `the red is the cession; the figure in the red sector is the `
        + `percentage ceded, called out beside the disc where the sector is `
        + `too small to hold it. `
        + `<b>The capital is notional:</b> nothing in the ledger is truncated `
        + `at these amounts, no default is modeled and no premium is reduced `
        + `for the possibility of insolvency. Hover any node or chip.`
        + `</p>`;
}

/**
 * Draw the leaf into `host`: the level strip, the figure, and the note.
 *
 * Every level came back in one response, so pressing one is a redraw and not a
 * re-ask. Nothing here computes a number.
 *
 * Parameters
 * ----------
 * host : Element
 *     The pane to fill. Its contents are replaced.
 * levels : Array
 *     The response's `levels`, each `{t, frame}`.
 * onTooltips : function, optional
 *     Called with the host after each draw, so the caller can attach whatever
 *     tooltip mechanism it uses to the `[data-bs-toggle="tooltip"]` nodes. Kept
 *     as a callback rather than importing Bootstrap here, so this module stays
 *     testable with no DOM and no bundler globals.
 */
export function mountPentagon(host, levels, onTooltips) {
    if (!host) return;
    if (!levels || !levels.length) {
        host.innerHTML = '<p class="text-muted small">'
            + 'This P&amp;L has no pentagon to draw.</p>';
        return;
    }
    let live = 0;
    const draw = () => {
        const lv = levels[live];
        host.innerHTML = `<div class="control-band pent-band">`
            + stripMarkup(levels, live) + `</div>`
            + `<div class="pent-scroll">${pentagonSvg(lv.frame, lv.t)}</div>`
            + noteMarkup(lv.t);
        host.querySelectorAll('.pent-mini').forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = Number(btn.dataset.level);
                if (next === live) return;
                live = next;
                draw();
            });
        });
        if (onTooltips) onTooltips(host);
    };
    draw();
}
