# joint-surface prototype

The reference implementation for `dev/done/plan-3d-plot.md`. Where that plan says
"the prototype does X", this is X, and where it quotes a number, one of the
scripts here produced it.

Tracked, and deliberately so. It settled the semantics of the bivariate joint
surface and found three defects in shipped code; losing it would mean deriving
all of that a second time. It stays until the shipped surface matches it, and
then it becomes the thing the shipped one is diffed against before it goes.

Nothing here is imported by the package or the SPA. It is a laboratory.

## Running it

```
python -m http.server 8123
```

then open `http://localhost:8123/dev/prototypes/joint-surface/surface-lab.html`.

The synthetic surfaces work immediately. The four real ones need the baked
data, which is **not tracked** because it is derived and 530 kB:

```
uv run --no-sync python dev/prototypes/joint-surface/make-surface-data.py
```

That runs four DecL programs through `aggregate` and writes `surface-data.json`
beside this file. It also prints, every run, the gap between each surface's true
mean and the mean read off its display grid, which is upstream item 5.1 in the
plan.

Network: echarts, echarts-gl and Bootstrap come from jsDelivr. The two HDR
environment maps under "image lighting" are the one thing that needs the network
at click time.

## What is here

| file | what it is |
|---|---|
| `surface-lab.html` | the lab. Around 3,300 lines, self contained bar the CDN scripts |
| `make-surface-data.py` | bakes the four real joint aggregates out of DecL |
| `check-lab.js` | the invariant sweep. **Run this after touching the lab** |
| `check-kappa-window.js` | what kappa read off the visible part of a cut costs against kappa read off the whole line |
| `show-windows.js` | what the quantile window does to each surface at several depths |
| `bench-encodings.py` | the wire format benchmark behind section 2.3 of the plan |

## The invariant sweep

```
node dev/prototypes/joint-surface/check-lab.js
```

Expected tail: `0 failures`, after around 800 level lines, 860 kappa positions
and 860 option builds. It runs from any working directory.

What it holds down, and why each one is there rather than being obvious:

1. every control has a default and every default has a control
2. the reduction preserves mass and keeps the spacing uniform on both axes
3. the quantile window is nested in its depth, holds the mass it claims, never
   strands its low edge above a reachable zero, and never collapses an axis
4. on a joint that factors, the conditional drawn on a wall lands on the
   marginal beside it, at every cut. This is the one that catches the mass
   against density units bug
5. kappa and `E[Y|X]` do not move when the window depth changes. Stated as
   "kappa cannot move by more than the total moved", which holds through `s = 0`
   where a relative tolerance says nothing
6. a level line really is a level line, on rectangular grids with wildly
   different bucket sizes
7. `kappa_1 + kappa_2 = s` exactly, on every surface at every cut position
8. the mesh never jumps: consecutive vertices are one grid step apart
9. every option builds, over all combinations of surface, mesh, representation,
   log height and floor, with no duplicate series ids and nothing escaping the
   box
10. the fit rule flattens nothing when it is on and something when it is off,
    so the rule is actually being tested

The plan's section 8 says which of these move into real test suites and where.
