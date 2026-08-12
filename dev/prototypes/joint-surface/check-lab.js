// Invariant sweep over the pure half of surface-lab.html: everything above the
// `app` marker evaluates in node with no DOM. The baked surfaces are registered
// by hand here, the way `loadData` does it in the browser.
const fs = require('fs');
const here = (f) => require('path').join(__dirname, f);
const path = here('surface-lab.html');
const txt = fs.readFileSync(path, 'utf8');
const i = txt.lastIndexOf('<script>') + 8;
const marker = txt.indexOf('/* ------------------------------------------------------------------- app */');
if (marker < 0) throw new Error('app marker not found');
const src = txt.slice(i, marker);
const mod = new Function(`${src}\nreturn {SURFACES, DATA, PRESETS, state, sample, reduceGrid,
  gridPolylines, diagPolylines, vertexAt, diagPath, levelLine, sampler, meanOf, interpAt,
  sliceSeries, buildOption, SPEC, cleanState, wallCurves, windowOf, axisWindow, marginalCums,
  windowIndices, reduceWith, subGrid, fullOf};`)();

const baked = JSON.parse(fs.readFileSync(here('surface-data.json'), 'utf8'));
Object.assign(mod.DATA, baked);
for (const [name, d] of Object.entries(baked)) {
  mod.SURFACES[name] = {
    label: `${name}, ${d.label}`, sampled: name, units: d.units, decl: d.decl,
    span: [d.x[0], d.x[d.x.length - 1]], signed: false, floorable: true,
  };
}
const BAKED = Object.keys(baked);
const ALL = Object.keys(mod.SURFACES);

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); };
const uniform = (a, tag) => {
  const n = a.length, step = (a[n - 1] - a[0]) / (n - 1);
  let worst = 0;
  for (let k = 1; k < n; k++) worst = Math.max(worst, Math.abs((a[k] - a[k - 1]) - step));
  ok(worst <= Math.abs(step) * 1e-9, `${tag}: spacing drifts by ${worst} against step ${step}`);
};

// 1. controls and defaults agree
const specKeys = new Set();
for (const [, , items] of mod.SPEC) for (const it of items) specKeys.add(it[0]);
for (const k of specKeys) ok(k in mod.PRESETS.app, `SPEC key ${k} has no default`);
for (const k of Object.keys(mod.PRESETS.app)) ok(specKeys.has(k), `default ${k} has no control`);

// 2. reduction is mass preserving, keeps the spacing uniform, and never
//    invents cells that were not there. The grid comes back as a density, so
//    the mass is the sum times the cell area rather than the bare sum.
const massOf = (g) => {
  const area = (g.x[1] - g.x[0]) * (g.y[1] - g.y[0]);
  return g.z.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0) * area;
};
for (const name of BAKED) {
  const src0 = baked[name];
  const total = src0.z.reduce((a, b) => a + b, 0);
  for (const n of [16, 24, 32, 48, 64, 96, 128, 220]) {
    const g = mod.reduceGrid(src0, n);
    const got = massOf(g);
    ok(Math.abs(got - total) < 1e-9 * Math.max(1, total),
      `${name} n=${n}: mass ${got} against ${total}`);
    ok(g.x.length <= src0.x.length && g.y.length <= src0.y.length,
      `${name} n=${n}: reduction grew the grid`);
    ok(g.z.length === g.y.length && g.z[0].length === g.x.length,
      `${name} n=${n}: z is ${g.z.length}x${g.z[0].length}, axes are ${g.y.length}x${g.x.length}`);
    uniform(g.x, `${name} n=${n} x`);
    uniform(g.y, `${name} n=${n} y`);
  }
}

// 2b. the window: it is nested, it keeps the mass it says it keeps, it never
//     leaves the low edge stranded above a zero it could have reached, and the
//     reduction over it still preserves what is inside it.
for (const name of BAKED) {
  const src0 = baked[name];
  const total = src0.z.reduce((a, b) => a + b, 0);
  let prevSpanX = Infinity, prevSpanY = Infinity;
  for (const nw of [12, 8, 6, 5, 4, 3, 2, 1]) {
    const w = mod.windowOf(src0, nw);
    const kept = w.z.reduce((a, b) => a + b, 0);
    // `kept` on the window is the fraction of the mass it holds, not the mass
    ok(Math.abs((w.kept === undefined ? 1 : w.kept) - kept / total) < 1e-9,
      `${name} window ${nw}: kept ${w.kept} against ${kept / total}`);
    // Two ends on each of two axes, each bounded by p, so 4p is the budget.
    ok(kept >= (1 - 4.05 * 10 ** -nw) * total,
      `${name} window ${nw}: dropped ${(1 - kept / total).toExponential(2)}, over the depth`);
    ok(w.z.length === w.x.length * w.y.length,
      `${name} window ${nw}: z is ${w.z.length} against ${w.x.length} x ${w.y.length}`);
    const spanX = w.x[w.x.length - 1] - w.x[0], spanY = w.y[w.y.length - 1] - w.y[0];
    ok(spanX <= prevSpanX + 1e-9 && spanY <= prevSpanY + 1e-9,
      `${name} window ${nw}: ${spanX} x ${spanY} is wider than the shallower one`);
    prevSpanX = spanX; prevSpanY = spanY;
    // the zero snap: a low edge left within 5% of the span of a reachable zero
    // is a low edge that should have been taken to it.
    for (const [ax, coords] of [['x', w.x], ['y', w.y]]) {
      const full = ax === 'x' ? src0.x : src0.y;
      const reachable = full.find((v) => v >= 0);
      if (coords[0] > 0 && reachable !== undefined && reachable < coords[0]) {
        ok(coords[0] - reachable > 0.05 * (coords[coords.length - 1] - coords[0]),
          `${name} window ${nw} ${ax}: starts at ${coords[0]} with ${reachable} in reach`);
      }
    }
    const g = mod.reduceGrid(w, 96);
    ok(Math.abs(massOf(g) - kept) < 1e-9 * Math.max(1, total),
      `${name} window ${nw}: reduction lost mass, ${massOf(g)} against ${kept}`);
  }
}

// 2c. the whole point of the units fix: on a joint that factors, the
//     conditional drawn on a wall lands on the marginal drawn beside it, at
//     every cut, and the two only agree if both are densities.
{
  const indep = baked.Indep;
  ok(indep !== undefined, 'the Indep surface is missing, so the wall check did not run');
  if (indep) {
    const g = mod.reduceGrid(indep, 96);
    const nx = g.x.length, ny = g.y.length;
    const dx = g.x[1] - g.x[0], dy = g.y[1] - g.y[0];
    const { my } = mod.wallCurves(g);
    /* Only where there is something to compare. The baked z is trimmed to six
       significant figures, so a cell a billionth of the peak is noise and a
       column out in the tail is a handful of such cells; the claim is about
       where the distribution lives, not about the trim. */
    const peakY = Math.max(...my);
    const colMass = g.x.map((_, c) => g.y.reduce((s, _v, r) => s + g.z[r][c], 0));
    const peakCol = Math.max(...colMass);
    for (const t of [0.05, 0.2, 0.4, 0.6, 0.8]) {
      const cut = Math.round(t * (nx - 1));
      if (colMass[cut] < 1e-6 * peakCol) continue;
      const raw = g.y.map((_, r) => g.z[r][cut]);
      const mass = raw.reduce((a, b) => a + b, 0) * dy;
      let worst = 0;
      for (let r = 0; r < ny; r++) {
        if (my[r] < 1e-6 * peakY) continue;
        worst = Math.max(worst, Math.abs(raw[r] / mass - my[r]) / my[r]);
      }
      ok(worst < 1e-3, `Indep x cut at ${t}: conditional is ${worst.toExponential(2)} off the marginal`);
    }
    ok(Math.abs(my.reduce((a, b) => a + b, 0) * dy - 1) < 1e-6, 'the y marginal does not integrate to one');
    const { mx } = mod.wallCurves(g);
    ok(Math.abs(mx.reduce((a, b) => a + b, 0) * dx - 1) < 1e-6, 'the x marginal does not integrate to one');
  }
}

// 2d. the whole point of computing on the full grid: a quantity that is an
//     integral over an axis must not depend on how deep the window is cut.
//     kappa is the one that matters, so kappa is the one checked, held at a
//     fixed total in data coordinates rather than at a fixed slider position,
//     since the slider is parameterized by the box and the box is what moves.
const DEPTHS = [0, 6, 5, 4, 3];
const gridAt = (name, nw, n = 96) => {
  Object.assign(mod.state, { surf: name, n, windowN: nw });
  return mod.sample();
};
for (const name of BAKED) {
  const tight = gridAt(name, DEPTHS[DEPTHS.length - 1]);
  const sLo = tight.x[0] + tight.y[0];
  const sHi = tight.x[tight.x.length - 1] + tight.y[tight.y.length - 1];
  for (const f of [0.3, 0.5, 0.7]) {
    const target = sLo + (sHi - sLo) * f;
    const runs = [];
    for (const nw of DEPTHS) {
      const g = gridAt(name, nw);
      const sMin = g.x[0] + g.y[0];
      const sMax = g.x[g.x.length - 1] + g.y[g.y.length - 1];
      const t = (target - sMin) / (sMax - sMin);
      if (!(t > 0.02 && t < 0.98)) continue;
      const p = mod.diagPath(g, t);
      const zs = p.map((q) => q[2]);
      if (zs.reduce((a, b) => a + b, 0) <= 0) continue;
      const step = Math.max(g.x[1] - g.x[0], g.y[1] - g.y[0]);
      runs.push({ nw, step, s: p[0][0] + p[0][1], k1: mod.meanOf(p.map((q) => q[0]), zs) });
    }
    if (runs.length < 2) continue;
    /* The cut quantizes to its own box's step, so two depths land on totals a
       step or so apart, and kappa is a function of the total. What cannot
       happen, once the mean is taken over the whole line, is kappa moving by
       more than the total did: kappa_1 + kappa_2 = s, both are increasing in
       s, so |dkappa_1| <= |ds|. That is the invariant, and it holds near s = 0
       where a relative tolerance means nothing. Computed over the window
       instead, kappa misses by a fraction of s, which on these grids is many
       steps and fails loudly. */
    const first = runs[0];
    for (const r of runs.slice(1)) {
      const slack = Math.max(r.step, first.step);
      if (Math.abs(r.s - first.s) > 6 * slack) continue;
      ok(Math.abs(r.k1 - first.k1) <= Math.abs(r.s - first.s) + slack,
        `${name}: kappa1 ${first.k1.toPrecision(6)} at s=${first.s.toPrecision(6)} window `
        + `${first.nw}, but ${r.k1.toPrecision(6)} at s=${r.s.toPrecision(6)} window ${r.nw}, `
        + `moved ${Math.abs(r.k1 - first.k1).toPrecision(4)} against a total that moved `
        + `${Math.abs(r.s - first.s).toPrecision(4)}`);
    }
  }
}

// 2e. and the same for a component conditional: E[Y | X = x] is a property of
//     the joint, not of the box it is drawn in.
for (const name of BAKED) {
  const tight = gridAt(name, 3);
  const xAt = tight.x[Math.round(0.4 * (tight.x.length - 1))];
  const runs = [];
  for (const nw of DEPTHS) {
    const g = gridAt(name, nw);
    const { base } = mod.fullOf(g);
    if (xAt < g.x[0] || xAt > g.x[g.x.length - 1]) continue;
    let c = 0;
    for (let i = 1; i < base.x.length; i++) {
      if (Math.abs(base.x[i] - xAt) < Math.abs(base.x[c] - xAt)) c = i;
    }
    const col = base.y.map((_, r) => base.z[r][c]);
    if (col.reduce((a, b) => a + b, 0) <= 0) continue;
    runs.push({ nw, mu: mod.meanOf(base.y, col) });
  }
  if (runs.length < 2) continue;
  const first = runs[0];
  for (const r of runs.slice(1)) {
    ok(Math.abs(r.mu - first.mu) <= 0.05 * Math.max(1, Math.abs(first.mu)),
      `${name} at x=${xAt.toPrecision(6)}: E[Y|X] is ${first.mu.toPrecision(6)} `
      + `at window ${first.nw} and ${r.mu.toPrecision(6)} at window ${r.nw}`);
  }
}

// 3. a level line really is a level line, on rectangular grids with wildly
//    different bucket sizes, and its points stay in the box.
let lines = 0;
for (const name of BAKED) {
  mod.state.surf = name;
  for (const n of [24, 64, 128]) {
    mod.state.n = n;
    const g = mod.sample();
    const nx = g.x.length, ny = g.y.length;
    for (const anti of [true, false]) {
      const lo = anti ? g.x[0] + g.y[0] : g.x[0] - g.y[ny - 1];
      const hi = anti ? g.x[nx - 1] + g.y[ny - 1] : g.x[nx - 1] - g.y[0];
      for (let t = 0.02; t < 0.99; t += 0.03) {
        const level = lo + (hi - lo) * t;
        const pts = mod.levelLine(g, level, anti, Math.max(nx, ny));
        if (!pts.length) continue;
        lines++;
        const scale = Math.max(1, Math.abs(level));
        for (const p of pts) {
          const got = anti ? p[0] + p[1] : p[0] - p[1];
          if (Math.abs(got - level) / scale > 1e-9) {
            fail.push(`${name} n=${n} anti=${anti} level=${level}: off by ${got - level}`);
            break;
          }
          if (p[0] < g.x[0] - 1e-9 || p[0] > g.x[nx - 1] + 1e-9
            || p[1] < g.y[0] - 1e-9 || p[1] > g.y[ny - 1] + 1e-9
            || !Number.isFinite(p[2]) || p[2] < 0) {
            fail.push(`${name} n=${n} anti=${anti} level=${level}: point outside the box or negative`);
            break;
          }
        }
      }
    }
  }
}

// 4. kappa_1 + kappa_2 = s exactly, on every surface, at every cut position
let kchecked = 0;
for (const name of ALL) {
  // kappa is a mean, so it is only defined where the surface is a density.
  if (mod.SURFACES[name].signed) continue;
  mod.state.surf = name;
  for (const n of [24, 61, 110]) {
    mod.state.n = n;
    const g = mod.sample();
    for (let t = 0; t <= 1.0001; t += 0.021) {
      const p = mod.diagPath(g, Math.min(1, t));
      ok(p.length >= 2, `${name} n=${n} t=${t.toFixed(3)}: diagPath has ${p.length} points`);
      const zs = p.map((q) => q[2]);
      if (zs.reduce((a, b) => a + b, 0) <= 0) continue;
      const k1 = mod.meanOf(p.map((q) => q[0]), zs);
      const k2 = mod.meanOf(p.map((q) => q[1]), zs);
      const s = p[0][0] + p[0][1];
      kchecked++;
      ok(Math.abs(k1 + k2 - s) / Math.max(1, Math.abs(s)) < 1e-12,
        `${name} n=${n}: k1+k2-s = ${k1 + k2 - s}`);
      const xLo = Math.min(p[0][0], p[p.length - 1][0]), xHi = Math.max(p[0][0], p[p.length - 1][0]);
      ok(k1 >= xLo - 1e-9 && k1 <= xHi + 1e-9, `${name} n=${n}: kappa1 ${k1} outside [${xLo}, ${xHi}]`);
    }
  }
}

// 5. the row and column mesh never jumps: consecutive vertices are one grid
//    step apart along a row, a column or a face diagonal. Rectangular included.
for (const name of ALL) {
  mod.state.surf = name;
  for (const n of [24, 40, 96]) {
    mod.state.n = n;
    const g = mod.sample();
    const at = mod.vertexAt(g, false, 0, 0, Infinity);
    const idxOf = new Map();
    for (let c = 0; c < g.x.length; c++) {
      for (let r = 0; r < g.y.length; r++) idxOf.set(`${g.x[c]}|${g.y[r]}`, [c, r]);
    }
    for (const k of [1, 3, 6, 16]) {
      mod.gridPolylines(g, k, at).forEach((pts, fi) => {
        ok(pts.length > 1, `${name} n=${n} k=${k} family ${fi} empty`);
        let bad = 0;
        for (let j = 1; j < pts.length; j++) {
          const a = idxOf.get(`${pts[j - 1][0]}|${pts[j - 1][1]}`);
          const b = idxOf.get(`${pts[j][0]}|${pts[j][1]}`);
          if (!a || !b || Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) !== 1) bad++;
        }
        ok(bad === 0, `${name} n=${n} k=${k} family ${fi}: ${bad} jumps`);
      });
      const diag = mod.diagPolylines(g, k, false, 0, 0, Infinity);
      ok(diag.length <= 96, `${name} n=${n} k=${k}: ${diag.length} diagonal series, over the cap`);
      for (const [, pts] of diag) ok(pts.length >= 2, `${name} n=${n} k=${k}: short diagonal`);
    }
  }
}

// 6. the whole option, over every combination that changes its shape
const COMBOS = [];
for (const surf of ALL) {
  for (const meshDir of ['xy', 'diag', 'both', 'none']) {
    for (const rep of ['surface', 'edges', 'wire', 'points']) {
      for (const logz of [false, true]) {
        for (const floor of ['none', 'project', 'bands']) {
          COMBOS.push({ surf, meshDir, rep, logz, floor });
        }
      }
    }
  }
}
let checked = 0;
for (const c of COMBOS) {
  Object.assign(mod.state, mod.PRESETS.app, mod.PRESETS.steve, c, {
    n: 24, sliceX: true, sliceY: true, sliceS: true, marginals: 'line',
    contours: true, contourLevels: 4, slicePlane: true, sliceFloor: true, showMeans: true,
  });
  let opt;
  try { opt = mod.buildOption(); } catch (e) {
    fail.push(`${JSON.stringify(c)}: threw ${e.message}`);
    continue;
  }
  checked++;
  const zAxis = opt.zAxis3D;
  const ids = new Set();
  for (const s of opt.series) {
    if (s.id) { ok(!ids.has(s.id), `${JSON.stringify(c)}: duplicate id ${s.id}`); ids.add(s.id); }
    if (s.dataShape) {
      ok(s.dataShape[0] * s.dataShape[1] === s.data.length,
        `${JSON.stringify(c)}: ${s.name} shape ${s.dataShape} vs ${s.data.length}`);
    }
    for (const v of s.data) {
      if (!v.every(Number.isFinite)) { fail.push(`${JSON.stringify(c)}: ${s.name} non-finite`); break; }
      if (v[2] < zAxis.min - 1e-9 || v[2] > zAxis.max + 1e-9) {
        fail.push(`${JSON.stringify(c)}: ${s.name} escapes the box at z=${v[2]}`);
        break;
      }
    }
  }
  for (const vm of opt.visualMap) {
    const si = Array.isArray(vm.seriesIndex) ? vm.seriesIndex : [vm.seriesIndex];
    for (const k of si) ok(opt.series[k], `${JSON.stringify(c)}: visualMap points at series ${k}`);
  }
}

// 7. the fit rule: nothing flattened with it on, something flattened without it
let flatOn = 0, flatOff = 0;
for (const fitWalls of [true, false]) {
  for (const surf of ['mixture', ...BAKED]) {
    for (let t = 0.06; t < 0.95; t += 0.06) {
      Object.assign(mod.state, mod.PRESETS.app, mod.PRESETS.steve, {
        surf, n: 40, fitWalls, sliceX: true, sliceY: true, sliceS: true,
        sliceAtX: t, sliceAtY: 1 - t, sliceAtS: t, marginals: 'line', contours: false,
      });
      const opt = mod.buildOption();
      const top = opt.zAxis3D.max;
      for (const s of opt.series) {
        if (!/given/.test(s.name || '')) continue;
        if (s.data.filter((v) => Math.abs(v[2] - top) < 1e-12).length > 2) {
          if (fitWalls) flatOn++; else flatOff++;
        }
      }
    }
  }
}
ok(flatOn === 0, `fit is on and ${flatOn} conditionals are still flattened`);
ok(flatOff > 0, 'fit is off and nothing flattened, so the rule is untested');

console.log(`surfaces ${ALL.length} (${BAKED.length} baked), ${lines} level lines, `
  + `${kchecked} kappa positions, ${checked} option builds, `
  + `flattened fit on ${flatOn} / off ${flatOff}`);
console.log(`${fail.length} failures`);
for (const f of fail.slice(0, 25)) console.log('  ' + f);
