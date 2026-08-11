# plan-3d-plot: the bivariate joint surface, end to end

Status: **draft for review**, 2026-08-11. Three parties have to agree before any
of it is built: Steve, Agent for LIB and Agent for API/SPA.
Nothing here is implemented outside the prototype.

This is one document for `aggregate` (LIB), `aggregate_api` (API) and the SPA,
because the thing being agreed is a wire format and a format described in two
documents has two versions of itself within a month.

The canonical copy is `aggregate_api/dev/plan-3d-plot.md`, tracked there.
`aggregate_REFACTOR/dev/plan-3d-plot.md` is a **symlink** to it, and gitignored
in that repo so it is never committed as a link. A hard link was tried first and
is the wrong tool: most editors, and every agent file tool tested, write a new
file and rename over the old one, which leaves the hard link pointing at the
previous inode. The two copies then diverge in silence, which is worse than
having no link at all. A symlink resolves by path, so it survives the rename.
Edit the copy in `aggregate_api`.

Every number in here was measured this session. The scripts that produced them
are in `aggregate_api/dev/prototypes/joint-surface/`, tracked, all rerunnable:
`bench-encodings.py`, `check-lab.js`, `check-kappa-window.js`,
`show-windows.js`. See the README beside them.

---

## 1. Overview

### What is being built

A bivariate joint density, drawn in relief, that a reader can interrogate: cut
it along either component or along the total, read the conditional distribution
that each cut leaves, and see where the conditional mean sits on the curve it is
the mean of. On the total cut those two means are kappa, and watching them move
as the total rises is the point of the whole exercise.

There is a working prototype: `dev/prototypes/joint-surface/surface-lab.html`,
around 3,300 lines, tracked, over four real joint aggregates baked out of DecL. It is not the
deliverable. It is the argument for the deliverable and the place the semantics
were settled. Two of its findings are bugs in shipped code and are written up in
section 5.

### Why it earns the work

A heat map can show a joint density. It cannot show three things this can:

- **the marginals**, standing on the walls, which is what the joint is usually
  compared against
- **a conditional against its marginal**, side by side on the same wall and the
  same scale, where the gap between them is the dependence. So independence is
  something you *watch*: sweep the cut and the conditional does not move off the
  marginal it is standing next to. Measured on `Indep`, the gap is 0.0000 of the
  taller curve at every cut, against 0.39 to 0.81 on Clayton
- **kappa**, the split of a total given its size, which has never had a good
  picture and is the quantity an aggregate is most often being asked about.

The third is the one that matters. Kappa is `E[X_i | X_1 + X_2 = s]`, and read
off as a number it is a fact you have to trust. So we plot the conditional
distributions themselves, `X_i | X_1 + X_2 = s`, and mark where their means,
which are kappa, fall on them. Read off the curve it sits on, next to the even
split at `s/2`, moving as `s` rises, it is a fact you can see. The prototype
shows the
kappa slope on independent components coming out at the variance share, 0.292
observed against 0.2857 predicted, without being told the formula. That is the
moment an audience can check the machine rather than believe it.

This plot will be a very powerful educational tool.

### The split of work

| repo | owns |
|---|---|
| LIB (`aggregate`) | the semantics: what the grid is, where it is cut, what it is a reduction of, what the document declares |
| API (`aggregate_api`) | the interface and the transport: which parameters a caller may set, how the payload is encoded, caching |
| SPA (`web/`) | the rendering and every interaction: cuts, walls, walk, controls |

The rule the last three months of this project keep re-learning: **the API assembles
nothing.** It passes the library's document through, revalidates it, and adds
HTTP semantics. Anything the API computes about the numbers is a second opinion
that will drift from the first.

### Decisions already closed

Recorded so they are not relitigated. Each has an argument in the sections
below.

1. The wire carries **mass per cell**, not density. The client divides by the
   cell area once.
2. The **window is chosen upstream**, before the reduction, and is a request
   parameter. Cropping downstream cannot recover resolution that was already
   averaged away.
3. Everything derived (marginals, conditionals, kappa) is computed on the
   **whole grid**; only the drawing is clipped to the window.
4. The display box stays **square** regardless of the data aspect, because the
   axes carry their own labels and honoring a 256:1 bucket ratio geometrically
   would squash one axis to a sliver.
5. The two axes may differ in **length and bucket size**, independently. This
   is not an edge case; one of the four test surfaces is 64 wide against 128
   deep with `dx = 2` against `dy = 512`.
6. Default encoding is **float32 base64 inside the document**, with a declared
   `dtype` so it can change without a format change.

### Out of scope for this plan

Three dimensional rendering of anything other than a bivariate joint. The
heatmap fallback path, which already works. Anything about `Portfolio` in more
than two dimensions.

---

## 2. The IR: the contract

This is the section the other two are written against.

### 2.1 What `series[].surface` carries today

```
{x: [...], y: [...], z: [[...], ...]}
```

`x` and `y` as full coordinate arrays, `z` nested by row. It is enough to draw a
surface and not enough to do anything else: nothing says what the grid is a
reduction of, what convention the coordinates follow, how much of the
distribution is in the box, or what the exact marginals are.

### 2.2 What it needs to carry

| field | type | why it is there |
|---|---|---|
| `x0`, `dx`, `nx` | float, float, int | the x lattice, as an origin and a step, **not** an array. See 2.2.1 |
| `y0`, `dy`, `ny` | float, float, int | the y lattice. Independent of x in both length and step |
| `edge` | `"left" \| "mid"` | what a coordinate names: the left edge of its cell or its midpoint. Stating this is what would have caught upstream ask 1. **Absent means `mid`**, since a document from before the field existed documented its coordinates as cell centers, and reading those as left edges would shift every legacy grid half a bucket |
| `z_block` | object, see 2.3 | the joint **mass** per cell, row major over `(y, x)`, length `nx * ny`. Its own key rather than `z`, see 2.4.1 |
| `bs` | `[float, float]` | the **fine** bucket size each axis was reduced from |
| `k` | `[int, int]` | the block factor per axis, so `dx == bs[0] * k[0]`. Together with `bs`, this says what the grid is a reduction of, which is the difference between "the support starts at 508" and "the first block covers [0, 512)" |
| `window` | object | `{p, x: [lo, hi], y: [lo, hi], kept}`. The depth asked for, the resulting bounds in data coordinates, and the fraction of the mass inside them |
| `marginals` | `{x: [...], y: [...]}` | the exact marginal densities on the display lattice, from the object rather than integrated off a reduced joint. A few hundred floats, immune to the window, and a free check on the client's arithmetic |
| `moments` | object | at minimum `{mean: [mx, my]}` from the fine lattice. Two numbers that would have made both of this session's bugs visible on day one |
| `deficit` | float | mass the construction did not place, already computed upstream |

Names, labels and formats come from the existing axis and panel machinery and
are not restated here.

### 2.2.1 Both lattices go as origin, step and count, never as arrays

Normative, and the reason is not only size. The grids **are** arithmetic
sequences: an aggregate lives on a lattice by construction, and the block
reduction in 5.2 uses a power of two factor per axis precisely so the reduced
grid is one too. Sending `x0 + i * dx` for `i` in `0..nx-1` is sending a derived
quantity and inviting the reader to wonder whether it might not be uniform this
time.

Three things follow from making it inexpressible rather than merely
discouraged:

- **the interpolations become sound by construction.** Everything the client
  does off the grid, bilinear lookup, the line of constant total, the mean along
  a cut, divides by a constant step. Given arrays, that division is an
  assumption the format permits the emitter to violate. Given `x0`, `dx`, `nx`,
  there is nothing to violate
- **the fine lattice comes free.** With `bs` and `k` alongside, the underlying
  grid is `x0` in steps of `bs[0]`, `k[0]` of them per display cell, so the
  client can say what it is looking at a reduction of without a second array
- **it is smaller**, though this is the least of it: about 2 kB against a 128
  cell pair of axes, next to a `z` block of tens of kB

The one thing that stays an array is `marginals`, since those are values rather
than coordinates. They are indexed by the same lattice and carry no coordinates
of their own.

There is no future array form to plan for. The grids come out of an FFT, so
uniformity is a property of how they are made and not a convenience of the
present implementation. What varies, and what the format must carry
independently, is `nx` against `ny` and `dx` against `dy`.

### 2.3 The `z` block and the encoding

```
z_block: {dtype: "f32b64", order: "yx", data: "<base64>"}
```

`dtype` is a closed vocabulary, and the point of naming it is that the default
can change later without a format change:

| dtype | bytes/cell | worst relative error | when |
|---|---|---|---|
| `f32b64` | 4 | 1e-7 | the default. No decode step, exact to seven figures |
| `f64b64` | 8 | exact | never by default, see below |
| `u16log12b64` | 2 | 2.1e-4 | large grids, when a four figure density is enough |
| `json` | ~10 | 1e-6 | the current behavior, kept for one release as a fallback |

For `u16log12` the block also carries `peak` and `decades`. **Code 0 is
reserved for an exact zero**, and the live codes run 1 to 65535 over the
decades below the peak:

```
value = 0                                                    if code == 0
value = peak * 10 ** ((code - 1) / 65534 * decades - decades) otherwise
```

The reserved zero is the library's refinement of the draft formula above it
(landed with the emitter, 2026-08-11) and it is worth the code it costs: an
FFT-built joint is between 14% and 59% exact zeros, and an encoding whose
smallest word is "twelve decades down" turns every one of them into a floor
that the log view then draws as a real, flat surface. Anything more than
`decades` under the peak also encodes as zero, which is the wire saying it
cannot carry that depth rather than claiming the mass is absent.

**Do not send float64.** It is the single largest lever in this whole plan and
it points the other way from intuition. The low mantissa bits of an FFT built
density are genuine digits, not fuzz, and no compressor touches them. Measured
on the 128 x 128 `IndepSigned` display grid, best compressed size of each
candidate:

| encoding | best compressed |
|---|---|
| float64, blosc2 byte shuffle + zstd | 92.3 kB |
| JSON at six significant figures, zstd | 48.0 kB |
| float32, blosc2 byte shuffle + zstd | 43.6 kB |
| uint16 log quantized, same | 21.4 kB |

That ordering held on all six grids tested, by roughly 2x each time. A float64
pipeline would be **twice the size of the text it replaced**, because six
significant figures is itself a 20 bit quantization and is doing more work than
any compressor. Choosing the dtype is the compression decision; everything after
it is a rounding error by comparison.

### 2.4 Versioning: use the mechanism that exists

An earlier draft of this section invented a `surface_version` field. Wrong:
`charts/ir.py` already carries `CHART_IR_VERSION`, currently **2**, the document
carries `ir_version`, and `chartdoc-to-echarts.js` already pins it and returns
null on a document from the future. A second version number for one block would
mean two mechanisms answering the same question, drifting.

So the transition runs in two phases and needs no new field:

- **phase one, additive, no bump.** The new fields go in beside the existing
  `x`, `y` and `z` arrays. Old consumers read what they always read and ignore
  what they do not know; new consumers prefer the new form. Both are emitted for
  one release. This is what makes the SPA work independent of the LIB release
  train, which matters, since section 6 has them landing in different orders
- **phase two, the removal.** Dropping the array form is the breaking change,
  and that is what bumps `CHART_IR_VERSION` to 3. An old SPA then refuses every
  chart document, not only surfaces, which is the price of one global version
  and is the existing design's choice, not this plan's to relitigate

### 2.4.1 The encoded block takes its own key, because `z` cannot hold both forms

Settled by the API agent 2026-08-11, on executing this plan, because the two
paragraphs above were in conflict and LIB was building against them. Phase one
promises that a new field lands beside `x`, `y` and `z` and an old consumer
reads what it always read. Section 2.2 also gave `z` an object as its value.
Both cannot be true: `z[r][c]` on a `{dtype, order, data}` object is
`undefined`, so an old consumer does not ignore the change, it draws a grid of
holes, which is the "would draw something wrong" case that the IR version
exists to mark.

So the encoded mass goes under **`z_block`**, and `z` keeps its nested array
form untouched for the one release phase one lasts. The name says it holds the
same quantity as `z`, in the form the wire wants, so nothing has to guess that
the two are one slot. Phase two then deletes `x`, `y` and `z`, leaves `z_block`
named as it already was, and bumps `CHART_IR_VERSION` to 3. No rename ever
happens, which is the point of not calling it `z` now.

Reader rule, both phases: **prefer `z_block` when it is present**, fall back to
`z` when it is not, and never mix them. The app's decoder additionally accepts
an encoded object found under `z` itself, so a library build that reads this
section the other way still draws rather than showing a moth-eaten mesh. That
tolerance is a transition courtesy with a stated end: it goes when phase two
lands, and it is written down here rather than living as undeclared cleverness
in the adapter.

Two riders. `Chart-IR` is provisional in the PEP 411 sense per the LIB
changelog preamble, so a minor release may make this change without deprecation;
the two phase route is a courtesy to the app, not an obligation. And
`canonical_json` byte determinism must survive the base64 field, which it will,
since base64 is deterministic given the bytes and the field is a plain string.

---

## 3. API specs

### 3.1 The route

Unchanged in shape. `GET /v1/objects/{oid}/chart/{name}` already passes the
library document through with its own hash as the ETag, which is the right
design and stays.

New query parameters, all optional, all with library defaults:

| parameter | type | default | meaning |
|---|---|---|---|
| `window` | float, 0 to 12, steps of 0.5 | 4 | keep `q(10^-window)` to `q(1 - 10^-window)` of each marginal. 0 means the whole grid |
| `detail` | int, 16 to `AGGAPI_MAX_CHART_DETAIL` | 128 | target cells per axis after reduction. A target, not a promise: the reduction is by powers of two so the result is what the blocking could reach |
| `encoding` | enum | `f32b64` | one of the `dtype` values in 2.3 |

The ceiling on `detail` is a **setting, not a constant**, defaulting to 1024,
because this surface serves two cases that want opposite things. Over the wire
it is a few thousand cells and a payload in kilobytes; locally it is a drill
down into fine detail on a machine where bandwidth is not a constraint, and a
hard cap there would be preventing a use in order to prevent nothing. What
stops a client misrepresenting what it got is the document, not the limit: `k`,
`bs`, `nx` and `ny` say what was actually delivered, and the client reports the
realized grid rather than the requested one.

Deployment guidance (author, 2026-08-11): the public route sets the ceiling
low, `AGGAPI_MAX_CHART_DETAIL=256` on `agg.mynl.com`, because chart GETs sit
outside the Caddy rate limiter (which caps only the build POST) and each
parameter combination is a fresh reduction plus a payload that can reach
megabytes. The VPN and local runs keep the high default; the local drill down
case is the reason the ceiling is a setting at all.

All three go into the cache key and therefore into the ETag, since they change
the bytes.

### 3.2 On "control over detail, is that all API side?"

Partly, and the part that is not is the important one.

- the **knob** is API side: a query parameter, its bounds, its validation, its
  place in the cache key
- the **encoding** is API side: how the numbers are serialized, and the
  `Content-Encoding` negotiation
- the **capability** is LIB side, and without it the knob is a lie. The API
  cannot honor `detail=256` by re-reducing a grid the library already reduced to
  128, and it cannot honor `window=4` usefully by cropping a grid whose blocking
  was chosen before the window was known. Both would spend resolution the API
  never received

The measurement that settles it. On `Indep`, the same `q(1e-4)` window in y:

- applied to the fine lattice, then reduced: **232 cells**, starting at 0
- applied to the emitted display grid: **8 cells**, starting at 508

A factor of 29 in resolution, and a support that starts in the wrong place. So
`window` and `detail` must be plumbed into `build_chart_doc` and honored by the
emitter. The API's job is to expose them, validate them, and cache on them.

### 3.3 Payload budget

The real payload, the display grid cropped to its window, `IndepSigned` at
`window=4`, 66 x 63 = 4,158 cells:

| encoding | on the wire, compressed |
|---|---|
| uint16 log, byte shuffle + zstd | 6.1 kB |
| float32, byte shuffle + zstd | 12.6 kB |
| float32, plain zstd | 15.2 kB |
| JSON six figures, gzip | 17.6 kB |

At this size the compression question is moot and the default should be chosen
for simplicity, which is float32. It becomes real at `detail=512` on a fine
window: 262,584 cells is 114 kB as uint16 with blosc2 against 1.9 MB as float64
with zstd, a 17x spread.

### 3.4 Compression: let HTTP do it

Base64 costs 33% before compression and the transport gives it back. Measured:
float32 blosc2 = 43.6 kB, base64 of it = 58.2 kB, gzipped by the transport =
**43.8 kB**, a 0.5% overhead. Base64 is 6 bits in 8 and the outer compressor
recovers exactly that padding.

So: no in-payload compression, no WASM codec in the SPA, and let Caddy negotiate
`Content-Encoding: zstd` with the browser. Two riders:

- do not compress inside the payload **and** at the transport. The outer layer
  then spends CPU on incompressible bytes for nothing
- **what the app actually does today is gzip, not zstd**, and that is a finding
  rather than a fix. `create_app` installs `GZipMiddleware(minimum_size=1024)`,
  so any chart payload worth compressing is already encoded when it reaches
  Caddy, and Caddy passes an encoded body through rather than re-encoding it.
  Nothing is compressed twice, which is the rider that matters, but
  `Content-Encoding: zstd` is unreachable while the app compresses first. The
  cost is small at this size, gzip 43.8 kB against zstd's low forties on the
  same block, so this is not worth a middleware change made unilaterally: it is
  a deployment question for the author, and the honest reading of criterion 8.1
  "API 3.4" until it is answered is that the body is compressed exactly once and
  the codec is gzip
- Blosc2 buys 10% to 25% over plain zstd, all of it from the shuffle filter, and
  costs 100 to 200 kB of WASM decoder in a bundle whose largest asset is a lazily
  loaded echarts-gl. Not worth it at 6 kB per surface. Revisit only if fine
  resolution grids are wanted client side. If it is ever revisited: **byte**
  shuffle, not bit shuffle, which lost on almost every real case tested, and note
  that `blosc2.compress2(filter=...)` is silently ignored, the kwarg is `filters`
  and takes a list

### 3.5 Errors and edges

- unknown or unavailable chart name: 404 carrying the capability set, as today
- `window` so deep the grid degenerates: the library returns at least 8 cells per
  axis (see 5.2) and reports `kept`; the API does not second guess it
- `detail` above what the fine lattice supports: honored as far as the blocking
  allows, and the response says what it actually did through `k` and `nx`, `ny`.
  The client reports the realized grid, never the requested one

---

## 4. SPA specs

### 4.1 The adapter

**Two call sites read `series.surface`, not one.** `surfaceOption` draws the
relief and `heatmapPanel` draws the flat version of the same grid, and both
destructure `{x, y, z}` today. Both need the decode, and the decode belongs in
one shared helper that returns `{x0, dx, nx, y0, dy, ny, z}` with `z` a typed
array, so the two cannot drift. The heatmap is out of scope for the features in
this plan and is emphatically not out of scope for the format change.

The helper grows a decode step and loses the assumption that `z` is nested.
Order of operations, which matters:

1. decode `z` per `dtype` into a typed array
2. divide by the cell area `dx * dy` **once**, giving a density
3. everything downstream works in density

Step 2 is not cosmetic. The prototype had the marginal integrating `sum * dy`
as if `z` were a density while the conditional normalized by `sum * dy` into a
real one, so the two disagreed by a factor of `1 / (dx * dy)`, which on `Indep`
is 1024. The conditional lay flat on the floor at every cut while the marginal
stood up beside it. Density is also the only convention under which the surface
does not change height when the resolution does.

### 4.2 The full grid rule

**Everything derived is computed on the whole grid. Only the drawing is clipped
to the window.** The client therefore holds two things: the full reduced grid,
and the index range of the window inside it.

This is not fastidiousness. At a useful window only a third of a cut at constant
total is on screen:

| surface | window | of the cut on screen | of its weight | kappa1 off by |
|---|---|---|---|---|
| Clayton | 4 | 33% | 83.2% | 4.9% |
| Clayton | 2 | 27% | 81.9% | 7.8% |
| IndepFreq | 3 | 34% | 95.5% | 1.0% |

and the error flips sign with `s`, so it bends the shape of kappa against the
total, which is the one thing the chart exists to show. The same argument
applies to the marginals, which must be the unit's own aggregate distribution
and not the marginal of a truncated joint, and to `E[Y | X = x]`, which must not
move when the window does.

#### 4.2.1 The whole grid and the payload budget cannot both be had, and the way out is upstream

Raised by the API agent 2026-08-11, on starting this section. **Open: needs the
author.** It changes what LIB emits, so it wants answering while that work is
in flight rather than after.

The rule above and section 3.3 are in tension, and the tension is arithmetic
rather than emphasis. "Everything derived is computed on the whole grid" needs
the client to hold the whole grid. Section 5.2 chooses the block factor from the
*cropped* extent, so that the window gets `detail` cells. Emit the whole grid at
that factor and the payload is the window's cell count multiplied by the square
of the ratio of the axis to the window. Measured on the four test surfaces with
`show-windows.js`, that ratio per axis is:

| surface | window | window cells of the 128 cell axis | full grid at `detail=128` on the window |
|---|---|---|---|
| Clayton | 4 | 38 x 39 | 431 x 420, 181k cells, 724 kB as float32 |
| Clayton | 2 | 20 x 19 | 819 x 673, 551k cells, 2.2 MB |
| Indep | 4 | 31 x 8 | 256 x 2048, 524k cells, 2.1 MB |

Against section 3.3's budget of 4,158 cells and 12.6 kB. So the choice as the
plan currently stands is between a payload one to two orders of magnitude over
budget, and a client whose kappa is wrong by up to 4.9%, which is the error
`check-kappa-window.js` measures and the reason 4.2 exists.

**The way out is that neither of those is the real design.** Every quantity the
full-grid rule protects is one dimensional, and the library can serve each one
exactly, off the fine lattice, immune to the window, for a few hundred floats:

- `marginals.x`, `marginals.y`. Already in 2.2, for exactly this reason
- the density of the **total**, on its own lattice. This is what normalizes a
  cut at constant total, and without it a conditional drawn from the visible
  part of the cut is wrong by the missing weight, up to 17% at `window=4`
- `kappa_1(s)` on that same lattice. `kappa_2 = s - kappa_1`, so one array
- the conditional means `E[Y | X = x]` and `E[X | Y = y]`, one array each

With those served, the client needs the whole grid for nothing. It draws shapes
from the windowed grid, normalizes them with a served exact curve, and marks
means that are the library's own numbers rather than its own arithmetic over a
truncated integral. The payload stays at 3.3's budget, the invariants of 4.2
become statements about the library, and the acceptance criteria that currently
sit under "SPA 4.2" move to the LIB suite with them.

That is also the only reading consistent with the purist ruling. Kappa is
meaning. An app that integrates a joint density to get one is an app building a
number the library owns, which is the thing the round 6 preamble forbids and
the thing 5.5 already says about the marginals: "the exact marginal is a better
curve than one integrated off a coarsened and windowed joint".

The ask, if this is agreed: `kappa`, `total` and `cond_mean` join `marginals`
and `moments` in the surface block, and 5.2 emits the display grid cropped to
its window. The SPA work below waits on the answer, since the two designs put
the same arithmetic in different repos.

Two invariants hold this down and both are implemented in the prototype's `check-lab.js`:

- kappa and `E[Y|X]`, compared across window depths at a fixed total in **data**
  coordinates, agree
- kappa cannot move by more than the total moved, since `k1 + k2 = s` and both
  are increasing in `s`. Stated this way it survives `s` passing through zero,
  which a relative tolerance does not, and one of the four surfaces has support
  on both sides of zero

### 4.3 The wall curves

One vertical scale for **both** walls, not one each. Scaling each marginal to
its own peak draws them at identical heights every time, whatever the two
distributions are, and a reader takes equal heights to mean something. Both
axes are losses in the same currency, so `f_X` and `f_Y` are both densities per
unit loss and are directly comparable.

Where the two peaks differ by more than a factor of 8, the smaller is given
`1/8` of the wall and the larger runs off the top and is clipped against the
lid. A curve visibly leaving the box says "taller than fits"; a curve lying on
the floor says nothing. On `Indep` the ratio is 13.3 and the cap fires.

A conditional drawn on a wall takes that wall's factor, which is what makes the
comparison with the marginal behind it fair, and under independence the two
coincide exactly. Verified: worst gap between the y marginal and `f(y|x)` is
0.0000 of the taller curve at every cut on `Indep`, against 0.39 to 0.81 on
Clayton, where the gap is the dependence.

### 4.4 The controls

Eight on the row over the chart. This is the shipping set; everything else in
the prototype's sidebar is laboratory apparatus and does not travel.

| control | behavior |
|---|---|
| `log z` | height on a log scale. Disabled where the axis declares one scale |
| `marginals` | both marginals on the two low walls |
| `contours` | contour lines, on the surface **and** on the floor image, same levels |
| `mesh` | on and off. The direction is not a preference: it follows the cut, `xy` for component cuts, `diag` for the total, both for both. Every rung of a matched mesh is a copy of the cut, which turns the mesh into a scale for it |
| `cut` | none, components, total, all |
| `wall grid` | grid lines on the three walls |
| `window` | a number box, 0.5 steps, live on `input` so arrow keys and spinners move the picture. Redraw deferred ~90 ms so a held key coalesces. Never written back into while focused |
| `reset` | back to the last preset, camera included |

Defaults: floor image **on**, in continuous `project` form at 0.5 opacity, not
the stepped version, which reads as a contour map and is a different claim. No
cast shadow: it is a dark shape thrown by the thing you are reading, and on a
density it lands on the tail every time. Surface carrying its own mesh, viridis.

### 4.5 The walk

The one animation with an argument behind it. All live cuts walk together out
along the line `y = x`, the total rising steadily, at about 13 seconds a pass.

It must be parameterized **on the diagonal**, not by a shared fraction. Setting
each cut to the same fraction of its own range does not put them through one
point, because the two axes cover different intervals and the total is
parameterized by a third range again: three cuts that are supposed to cross at
the point being walked to, drifting apart. Take `v` on the segment of `y = x`
inside the box and derive all three: hold x at `v`, hold y at `v`, hold the
total at `2v`.

Two marks on the cut, and the pair is the content:

- **filled dot** at `(kappa_1, kappa_2)`, on the cut by construction
- **hollow ring** at `(s/2, s/2)`, the even split, on the diagonal by
  construction and on the cut by construction

The gap between them is how far from even the split is, drawn rather than
subtracted. On an exchangeable pair they sit on top of each other at every `s`,
which is the cleanest statement of what exchangeable means.

Both marks, and both conditional mean marks, are emitted with empty data rather
than omitted when they fall outside the box. An incremental update merges by id
and can change a series that is there but cannot remove one that has gone, so
dropping it leaves the last dot stuck where it was.

### 4.6 Display decisions on the record

- the box is **square** whatever the data aspect. The axes carry labels and a
  256:1 bucket ratio drawn faithfully makes one axis a sliver. Consequence worth
  stating in a caption: the box's visual diagonal is **not** the line `y = x`
- hover picking on a surface is `O(n^2)` per event in echarts-gl, which stalls a
  software renderer. Click to place the cuts is the way out and is already how
  the prototype works
- the reading strip is fixed at the bottom, not a tooltip following the cursor,
  matching `mount.js:useStrip`

---

## 5. LIB specs

Seven items. The first three are defects in shipped code, found by drawing the
data and asking it questions.

### 5.1 The display grid labels each block with its last fine coordinate

**Severity: high. This one makes numbers wrong.**

The block reduction under `chart_joint_surface` files a block covering
`[a, a + k*bs)` under `a + (k-1)*bs`. Two consequences: a distribution supported
on `[0, inf)` is reported as starting at `(k-1)*bs`, and every mean taken against
these coordinates is biased up by close to one whole display bucket.

| surface | axis | lattice mean | display grid mean | bias |
|---|---|---|---|---|
| Clayton | x, y | 40, 60 | 41.5, 63.75 | 0.38, 0.47 buckets |
| Indep | y | 23.77 | 508.35 | **0.95 buckets** |
| IndepFreq | x, y | 1000, 999.5 | 1012, 1074.5 | 0.38, 0.47 buckets |
| IndepSigned | x, y | 0, -500 | 17.5, -472.0 | 0.44, 0.44 buckets |

`Indep`'s y axis reduces 128 fine cells into one 512 wide bucket, so its support
is reported as starting at 508 when it starts at 0, and its mean reads 508
against a true 23.8.

Fix: carry the block's **first** fine coordinate, the left edge, which is the
convention the fine lattice is already in. Then declare it, via `edge` in the
surface block. Repro: `uv run --no-sync python dev/prototypes/joint-surface/make-surface-data.py`,
which
prints the table above every run.

#### 5.1.1 The fix lands, and `edge = "left"` is half a fine bucket off

Found by the API agent 2026-08-11, decoding the first real document the new
emitter produced (`aggregate` a257, `bvagg/joint_surface`, 94 x 117,
`bs = (10, 8)`, `k = (4, 2)`). Small, and the same bug as 5.1 rather than a new
one, so it wants fixing in the same place.

The premise above is wrong on one point: **the fine lattice is not in the left
edge convention.** It is in the representative-point convention, and it is
exact. Measured on `agg TestConv 5 claims sev lognorm 100 cv 0.5 poisson`,
`xs @ p` reproduces the theoretical mean of 500 to 8e-9 of a bucket, while
`(xs + bs/2) @ p` is high by exactly half a bucket. The fine coordinate *is*
the point the mass sits at.

So a display block covering `k` fine cells has its representative point at the
mean of the fine coordinates it covers, `x0 + i * dx + (k - 1) * bs / 2`, which
is neither the block's left edge nor its midpoint. Declaring `edge = "left"`
tells a consumer to add `dx / 2`, and `dx = k * bs`, so it overshoots by
`bs / 2` on every axis. Measured on that document, taking the mean off the
display grid three ways against the served `moments.mean` of
`(624.9170, 624.3338)`:

| the coordinate read as | mean | off by |
|---|---|---|
| the declared coordinate itself | 609.500, 620.194 | -15.4, -4.1 |
| a cell midpoint, which is what `edge = "left"` asks for | 629.500, 628.194 | **+4.58, +3.86**, exactly `bs / 2` |
| the mean of the fine coordinates the block covers | 624.500, 624.194 | -0.42, -0.14, the window truncation and nothing else |

The third row is the one that closes on the served moments, and the residual in
it is the upper tail the window drops, biasing down, which is the right sign.

Three ways out, all upstream, none of them the app's to take:

1. emit the block's representative point as the coordinate,
   `x0 + (k - 1) * bs / 2`, and declare `edge = "mid"`. Exact, and it costs
   8.1's phrasing: the first coordinate of a positive-support law becomes
   `(k - 1) * bs / 2` rather than 0, which is the honest answer to "where does
   the first block's mass sit" but is no longer "starts at 0". The criterion
   becomes `x0 - (k - 1) * bs / 2 == xs[0]`
2. give `edge` a third value for what is actually being carried, the block's
   first fine coordinate. Exact, and it makes every consumer learn a word
3. leave it and let consumers reconstruct the representative point from `bs`
   and `k`, which they can, since both are carried. This re-opens the exact
   ambiguity `edge` was added to close, and is what the app is doing today
   only because it marks no means yet

Recommend 1. Until it lands the app's `centerX` and `centerY` follow the
declaration literally rather than second-guessing it, which is the purist rule
and also means the bias is visible rather than quietly patched out.

### 5.2 The window must be chosen before the reduction

**Severity: high. This is what makes `detail` meaningful.**

Accept `window` and `detail` in `build_chart_doc` and the joint surface emitter.
Order: measure the marginal CDFs on the fine lattice, take the index window,
crop, **then** choose the block factor from the cropped extent, then reduce.

Three details the prototype had to get right and the library will too:

- the factor is a **power of two per axis, chosen independently**, so the blocks
  divide the axis exactly. An uneven last block makes the spacing non-uniform,
  which every interpolation downstream relies on, and puts a wider cell at the
  end of the axis, which is exactly where the tail is
- the low edge **snaps to zero** when it lands within 5% of the window's width
  of a reachable zero. A loss that starts at the origin should be drawn starting
  at the origin, and a window opening 3% above it invents support. It must not
  snap on a signed distribution whose lower bound is genuinely negative
- a floor of **8 cells per axis**. A Lomax on a lattice wide enough to hold its
  tail carries 99.99% of its mass in the first bucket, and both ends of the
  window land in that bucket, leaving a grid one cell across with no spacing to
  interpolate on

Report `kept`, the fraction of mass inside the window, in the document. At
`window=4` it runs 99.96% to 99.998% across the four test surfaces.

### 5.3 The density clip keeps large negatives

**Severity: medium, currently latent.**

`bivariate.py:882` and `:1953` both do:

```python
density[np.abs(density) < 1e-15] = 0.0
```

Three problems, in increasing order of how much they matter.

**The predicate.** `abs` says "small in magnitude is noise", which is true, but
it also **preserves** any large negative, and for a density a large negative is
not data. The two sidedness was inherited from `remove_fuzz`, whose docstring
justifies it explicitly for signed P&L columns in a frame. That does not
transfer: a joint density is non-negative even where its **support** is signed,
which is exactly what `IndepSigned` is. Negative x, never negative f.

The fix is not a one sided clip either, since that zeroes a large negative just
as quietly, and a large negative is a broken construction rather than fuzz:

```python
density[np.abs(density) < floor] = 0.0
if density.min() < 0:
    logger.warning('joint density has %d negative cells, worst %.3e; clipped',
                   int((density < 0).sum()), density.min())
    density[density < 0] = 0.0
```

**The threshold.** `1e-15` is absolute, applied to a per-cell **mass**, which
falls as the grid refines. The same constant sits 12.4 decades below the peak on
one grid and 10.7 on another. `eps * density.max()` holds the depth still.

**A free detector.** `deficit = 1.0 - density.sum()` is computed after the clip,
so zeroing a genuine negative raises the sum and drives the deficit negative. A
negative deficit means something was clipped upward and the warning should have
fired.

Measured today, nothing trips it: at 1024², 2048² and 4096² there are zero
negatives surviving, minimum positive exactly 1.0e-15, and 14% to 59% exact
zeros. So this is robustness, not a live bug. It also does **not** help
compression: de-fuzzed float64 compresses to the same byte.

Related tidy: these two sites are the scattered de-fuzz idiom that
`utilities.remove_fuzz` was written to replace. Route them through a shared
helper that takes the density semantics rather than the frame semantics.

### 5.4 Emit the fields in section 2.2

`x0/dx/nx`, `y0/dy/ny`, `edge`, `bs`, `k`, `window`, `deficit`, and `z_block`
with its declared `dtype` (2.4.1: its own key, `z` keeps its arrays for the
phase one release). Mass per cell, not density: mass is exact, is what
block reduction preserves, and lets the consumer form either.

### 5.5 Carry the exact marginals and the moments

See 4.2.1, which asks for three more arrays on the same argument and is open.

`marginals.x` and `marginals.y` on the display lattice, computed by the object
rather than integrated off the reduced joint, and `moments.mean` from the fine
lattice. A few hundred floats. Two reasons: the exact marginal is a better curve
than one integrated off a coarsened and windowed joint, and the moments give the
client a reference to check itself against. Both of this session's arithmetic
bugs would have been visible on the first render if the document had carried the
means.

### 5.6 Encoding support

Produce `f32b64` and `u16log12b64` from the same code path, selected by the
request. Keep `json` for one release.

### 5.7 A note on the test programs

The four baked surfaces and their DecL live in the prototype's
`make-surface-data.py`.
When they move upstream as fixtures, carry this with them: **only `Indep` has
independent marginals.** It is the one with `dfreq[1]`, one claim, certain. The
three that open `10 claims ... poisson` share the claim count, which makes their
units conditionally independent given N and dependent without it, whatever the
copula says. Worst relative gap from the product of the marginals: `Indep`
2.5e-5, which is the six figure trim and not a real gap, `IndepSigned` 7.7x,
`IndepFreq` 124x, the last two worst at the origin where the shared event N = 0
puts an atom neither marginal expects.

A conditional that slides as the cut sweeps is correct on three of them and
would be a bug on the fourth. Any test that asserts independence must use
`Indep`.

---

## 6. Order of work

Digging from both ends, in the style this project already uses.

**LIB first, because nothing else can start without the format.** 5.1 and 5.3
are independent of everything and can land immediately; they are corrections,
not features. 5.2 and 5.4 are the format and should land together, since 5.4
declares what 5.2 chose. 5.5 and 5.6 follow.

**API next, and it is small.** Three query parameters, validation, cache key,
ETag. Then confirm the transport negotiates zstd and is not double compressing.

**SPA last, and it is most of the work.** The adapter and the decode step, then
the full grid rule, then the walls, then the cuts, then the walk. Each is
testable against the prototype, which is the reference implementation and stays
in `dev/prototypes/joint-surface/` until the shipped one matches it. See 8.0.

**Where they meet.** The API can be built against a hand written document before
LIB emits one. The SPA can be built against the prototype's baked JSON, which is
the same shape. Neither has to wait.

**One prerequisite that is not part of this plan.** DecL cannot currently build
a bivariate from a `Portfolio`, and that piece belongs upstream and is post 1.0.
Nothing here blocks on it, because the renderer takes a `BivariateAggregate` and
does not ask how one was made, the same way it already does not ask whether the
object arrived by the plain route or the netceded one. But this surface is at
its most useful with a `Portfolio` behind it, so that piece wants to land before
this stage is exercised in anger. Tracked wherever the LIB roadmap tracks it,
not here.

---

## 7. Questions, answered 2026-08-11

All five are settled. Kept as questions with their answers rather than folded
silently into the specs above, because the reasoning is the part that stops
them being reopened.

**1. Does `detail` belong in the URL or in a header?** In the URL. It changes
the bytes, so it belongs in the thing the ETag is computed against, and a URL
that names its own resolution is shareable and debuggable. A header would hide
the parameter from the browser cache and from anyone reading a log. The cost is
that the chart cache key becomes `(oid, name, window, detail, encoding)`, which
is fine: it sits above the object cache, which stays keyed on `(decl, log2, bs)`
and is the expensive one. Nothing about a chart parameter should ever cause a
rebuild.

**2. Should the fine lattice ever be reachable?** Yes, and it is not ruled out
anywhere in this plan. Two purposes, and they pull in opposite directions:

- **over the wire**, a general reader on a general connection, where the answer
  is a windowed and reduced grid of a few thousand cells and a payload measured
  in kilobytes
- **local**, a drill down into fine detail on a machine where bandwidth is not
  a constraint, which is the case this whole surface exists to serve for its
  author

So `detail` is bounded but the bound is a **setting, not a constant**:
`AGGAPI_MAX_CHART_DETAIL`, defaulting high enough for the second case. The
concern behind the original question, a client that misrepresents its
resolution, is answered by the document rather than by a limit: the surface
block reports `k`, `bs`, `nx` and `ny`, so what was actually delivered is on the
record and the client displays the realized grid, never the requested one. A
limit would have prevented a use rather than a lie.

**3. Does the surface belong on the `Portfolio` two unit case?** The question
was wrongly framed. The renderer takes a `BivariateAggregate` and must not care
how one was made, exactly as it does not care today whether the object came from
a plain bivariate or from the netceded route: same object, different routes in.
`Portfolio` to bivariate is a separate upstream piece, post 1.0 for DecL, and it
needs to land **before** this stage is useful in anger. When it does, the path
is `Portfolio` to bivariate to render and nothing here changes. The emitter's
availability predicate should therefore key on the object type and on nothing
else.

**4. What does the caption say about the square box?** Generic for now. It needs
to say something eventually, since the box's visual diagonal is not the line
`y = x` and the walk runs along the latter, but caption wording is the last
problem this project will have.

**5. Precision in the readout must follow the declared `dtype`.** Restating it,
since the original was too terse. `u16log12` stores each cell as one of 65,536
codes spread over twelve decades, which recovers the density to about 2.1e-4
relative, or **four significant figures**. The reading strip currently prints
five. Under that encoding it would be printing five digits of a number known to
four, which invents precision the wire never carried.

Not a problem under the `f32b64` default, which is exact to seven figures, and
answer 2 makes uint16 less likely to be chosen anyway, since the case that
wants the most cells is the local one that cares least about bytes. The rule is
simply that the strip's precision is a function of `z.dtype`: seven figures for
float32, four for `u16log12`, and the tooltip says the height is quantized when
it is.

Two more, from the oversight review, answered by the author 2026-08-11.

**6. Who owns the seam with `load_chart_doc` (round 6 item 6)?** Settled by the
order of work: LIB first, then API. The LIB stage that emits the new surface
fields also teaches the reader them, in the same release, so the round trip
contract `doc_hash(load_chart_doc(canonical_dict(doc))) == doc.hash` covers the
base64 `z` block and the phase one dual emission. A reader that lags the
emitter by a release is exactly the drift a library owned reader exists to
prevent, so the two never land apart.

**7. Where do the 1.0 demo heroes come from?** Handled by the author,
separately; some native `BivariateAggregate` heroes already exist in
`library.agg`. Not this plan's scope, recorded so it is not re-raised.

---

## 8. Done means: acceptance criteria and the test plan

Sections 2 to 5 say what to build. This one says how anyone can tell it is
built, and where the checks live afterward. Written because the first draft had
neither, so "agreed" and "delivered" had no test between them.

### 8.0 The prototype is tracked

`dev/prototypes/joint-surface/`, moved there from gitignored `hacks/` on
2026-08-11. It is the reference implementation: where this plan says "the
prototype does X", that is X, and every number quoted here came from one of the
scripts beside it. It stays until the shipped surface matches it, then it
becomes the thing the shipped one is diffed against before it is deleted.

`surface-data.json` stays untracked, since it is derived and 530 kB. One command
rebuilds it and that command is in the README.

### 8.1 Acceptance criteria, per item

Each is a check someone other than the author can run.

**LIB 5.1, block coordinates.** `make-surface-data.py` prints a bias table every
run. Done when every row reads `0.000 buckets`, and when `Indep`'s y axis starts
at 0 rather than 508. Add a LIB test asserting that for a positive support
aggregate the display grid's first coordinate is its fine lattice's first
coordinate, at three reduction factors.

**LIB 5.2, window before reduction.** Done when `build_chart_doc(obj, name,
window=4, detail=128)` on `Indep` returns a y axis of about 232 cells rather
than 8, and when the emitted `window.kept` matches an independently computed sum
over the crop to 1e-9. Plus: the low edge snaps to zero on positive support, does
**not** snap on `IndepSigned`, and no axis comes back under 8 cells at any depth
from 1 to 12.

**LIB 5.3, density clip.** Done when a joint carrying an injected large negative
raises the warning and is clipped, when the threshold is relative to the peak,
and when `deficit` goes negative in that case. Test by injecting rather than by
hoping: at 1024², 2048² and 4096² nothing currently trips it, so a test that
waits for nature will pass forever without testing anything.

**LIB 5.4 to 5.6, the format.** Done when a document round trips: emit, parse
with the SPA's decoder, and recover `z` to within the declared error of the
dtype. `f32b64` to 1e-7, `u16log12b64` to 2.1e-4. Plus `canonical_json` stays
byte deterministic across two builds of the same object.

**API 3.1, the parameters.** Done when the three appear in the OpenAPI schema
with their bounds, when out of range values give 422 rather than being clamped
silently, when two requests differing only in `detail` produce different ETags,
and when a repeat request with `If-None-Match` gives 304. Plus: no chart
parameter triggers an object rebuild, checked by asserting the object cache is
hit.

**API 3.4, compression.** Done when a response with `Accept-Encoding: zstd`
comes back `Content-Encoding: zstd`, and when the body is not compressed twice.

**SPA 4.1, the decode.** Done when one shared helper serves both `surfaceOption`
and `heatmapPanel`, and neither destructures `series.surface` directly.

**SPA 4.2, the full grid rule.** Done when kappa and `E[Y|X]` at a fixed total
in data coordinates agree across window depths 0, 6, 5, 4 and 3, which is the
prototype's own invariant, ported. This is the criterion that matters most: it
is the one that failed before, silently, by 4.9% at window 4 and 7.8% at
window 2.

**SPA 4.3, the wall curves.** Done when the two marginals have different drawn
heights on all four test surfaces, when a joint that factors puts the
conditional exactly on the marginal at every cut, and when the 8x cap fires on
`Indep` rather than flattening the smaller curve onto the floor.

**SPA 4.5, the walk.** Done when the three cuts cross within one cell of the
line `y = x` at every step, and when `kappa_1 + kappa_2 = s` holds to floating
point at every step.

**SPA, the iPad gate.** Done when the surface renders and stays interactive on
iPad Safari: click to cut works, the walk runs at a usable frame rate or
degrades gracefully, and the window spinner stays live. Good performance on
iPad is a requirement, not a nice to have (author, 2026-08-11). Before this
work starts, pin `echarts-gl` to an exact version in `web/package.json`: it is
the least maintained dependency in the stack and the one this feature leans on
hardest.

**Whole feature.** Done when the shipped surface, on all four test programs,
produces the same numbers as the prototype for: both marginal peaks, both
conditional means at three cut positions, and kappa at three totals. Tolerance
1e-9, since both are computing the same thing off the same grid. Any difference
is a defect in one of them and worth finding.

### 8.2 Where the checks live

The prototype's invariants are the design's load bearing wall and they currently
live in one gitignored file run by bare `node`. That is now half fixed, since
the file is tracked, and the other half is that they have to end up beside the
code they constrain.

| invariant | destination |
|---|---|
| block coordinates, window mass, snap and floor, clip and deficit | LIB test suite, `pytest`. They are statements about the library |
| encoding round trip, both directions | both suites. LIB asserts what it wrote, the API asserts what a client reads back |
| parameters, ETag, cache, 422, compression | `aggregate_api/tests/`, `TestClient`, alongside the existing `test_objects.py` |
| decode helper, window arithmetic, level lines on rectangular grids, kappa invariance, the fit rule, mesh continuity | SPA, and there is no runner. See 8.3 |
| the whole-feature comparison against the prototype | a script beside the prototype, run by hand at the end. Not CI: it needs a built SPA and a live server |

Nothing is deleted from `check-lab.js` when it is ported. The prototype keeps
its own copy and stays runnable on its own, because the two diverge the moment
the shipped code takes a different shape and the prototype is still the
reference.

### 8.3 The JS runner decision

`web/package.json` has no test script and no runner. The SPA has never had one.
This plan needs one, because six of its invariants are geometry and geometry
does not survive a rewrite unless something checks it.

**Recommendation: `node --test`, no new dependency.** Node's built in runner has
been available since 18, the repo already runs `node` for the prototype harness,
and it costs one line in `package.json`. The condition is that the code under
test must import cleanly in node, which means the decode helper and the grid
arithmetic go in **leaf modules with no imports of their own**, separate from
the echarts-touching code. That separation is worth having regardless: the
functions that need testing are pure, and they are currently tangled with a
1,500 line adapter that imports a charting library.

The alternative is `vitest`, which shares Vite's resolver and would let a test
import anything the app imports, including modules that pull in echarts. That
buys the ability to test the adapter end to end, and costs a dev dependency plus
a config file in a repo that has kept itself to two.

Start with `node --test` and the leaf module split. Reach for vitest only if
something genuinely needs the resolver, which will be visible rather than
guessed.

### 8.4 What is not covered, said out loud

No visual regression testing. The whole feature is a picture and none of the
above looks at one. The prototype's PNG button and the `?panel=0&sweep=0` query
form exist so a screenshot can be taken headlessly, and if visual regressions
become a problem that is where to start. Until then the honest statement is that
the numbers are tested and the appearance is reviewed by eye.
