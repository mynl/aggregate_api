// What kappa read off the visible part of the cut costs, against kappa read
// off the whole line of constant total. The first is what the page did before
// the full grid was kept beside the window; the second is the quantity.
const fs = require('fs');
const here = (f) => require('path').join(__dirname, f);
const txt = fs.readFileSync(here('surface-lab.html'), 'utf8');
const i = txt.lastIndexOf('<script>') + 8;
const marker = txt.indexOf('/* ------------------------------------------------------------------- app */');
const mod = new Function(`${txt.slice(i, marker)}\nreturn {SURFACES, DATA, state, sample, diagPath, meanOf, PRESETS};`)();
const baked = JSON.parse(fs.readFileSync(here('surface-data.json'), 'utf8'));
Object.assign(mod.DATA, baked);
for (const [name, d] of Object.entries(baked)) {
  mod.SURFACES[name] = { label: name, sampled: name, units: d.units, decl: d.decl,
    span: [d.x[0], d.x[d.x.length - 1]], signed: false, floorable: true };
}
const f = (v) => String(+v.toPrecision(6));
for (const name of Object.keys(baked)) {
  console.log(`\n${name}`);
  for (const nw of [4, 3]) {
    Object.assign(mod.state, mod.PRESETS.app, { surf: name, n: 96, windowN: nw });
    const g = mod.sample();
    for (const t of [0.25, 0.5, 0.75]) {
      const path = mod.diagPath(g, t);
      const nx = g.x.length, ny = g.y.length;
      const inBox = (p) => p[0] >= g.x[0] && p[0] <= g.x[nx - 1] && p[1] >= g.y[0] && p[1] <= g.y[ny - 1];
      const shown = path.filter(inBox);
      const zs = path.map((p) => p[2]), zsIn = shown.map((p) => p[2]);
      if (zs.reduce((a, b) => a + b, 0) <= 0 || zsIn.reduce((a, b) => a + b, 0) <= 0) continue;
      const k1 = mod.meanOf(path.map((p) => p[0]), zs);
      const k1in = mod.meanOf(shown.map((p) => p[0]), zsIn);
      const s = path[0][0] + path[0][1];
      const seen = zsIn.reduce((a, b) => a + b, 0) / zs.reduce((a, b) => a + b, 0);
      console.log(`  window ${nw} s=${f(s).padEnd(9)} the cut is ${(100 * shown.length / path.length).toFixed(0)}% on screen `
        + `holding ${(100 * seen).toFixed(1)}% of its weight:  kappa1 whole ${f(k1).padEnd(10)} visible ${f(k1in).padEnd(10)}`
        + `  off by ${f(k1in - k1)} (${(100 * Math.abs(k1in - k1) / Math.max(1e-9, Math.abs(k1))).toFixed(1)}%)`);
    }
  }
}
