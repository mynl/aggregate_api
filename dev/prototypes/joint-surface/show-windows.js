// What the window control does to each baked surface, at a few depths.
const fs = require('fs');
const here = (f) => require('path').join(__dirname, f);
const txt = fs.readFileSync(here('surface-lab.html'), 'utf8');
const i = txt.lastIndexOf('<script>') + 8;
const marker = txt.indexOf('/* ------------------------------------------------------------------- app */');
const mod = new Function(`${txt.slice(i, marker)}\nreturn {windowOf, reduceGrid};`)();
const baked = JSON.parse(fs.readFileSync(here('surface-data.json'), 'utf8'));
const f = (v) => (Math.abs(v) >= 1e5 ? v.toExponential(2) : String(+v.toPrecision(6)));
for (const [name, src] of Object.entries(baked)) {
  console.log(`${name}  source ${src.x.length} x ${src.y.length}, `
    + `x [${f(src.x[0])}, ${f(src.x[src.x.length - 1])}]  y [${f(src.y[0])}, ${f(src.y[src.y.length - 1])}]`);
  for (const n of [6, 4, 3, 2]) {
    const w = mod.windowOf(src, n);
    const g = mod.reduceGrid(w, 128);
    console.log(`   n=${n}: x [${f(w.x[0])}, ${f(w.x[w.x.length - 1])}] ${w.x.length} cells`
      + `   y [${f(w.y[0])}, ${f(w.y[w.y.length - 1])}] ${w.y.length} cells`
      + `   keeps ${(100 * w.kept).toFixed(4)}%   drawn ${g.x.length} x ${g.y.length}`);
  }
}
