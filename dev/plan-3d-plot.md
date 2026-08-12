# plan-3d-plot: the bivariate joint surface, end to end

Status: **in execution**, updated 2026-08-12. Three parties: Steve, Agent for
LIB and Agent for API/SPA. The LIB half is delivered (`aggregate` a257 and
a258; see 5.0 for what landed and where the code departs from this document).
The API and the first SPA leaves are in (`aggregate_api` a72 to a75).

**Both open items were answered by the author 2026-08-12**, and both are
recorded where they arose rather than in a list of their own. **4.2.1**: do not
trade the full grid rule for the bytes, so the derived quantities stay the
app's and LIB emits the whole reduced grid with `window` as the drawing range
inside it. **5.1.1**: go with the representative point and `edge = "mid"`.
Both are LIB edits; nothing on the app side is waiting on anything else.

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

**Confirmed from the LIB side 2026-08-12, and the two agents reached it
independently.** `z_block` is what a258 emits, for exactly the reason above,
which was reasoned out in the emitter before this subsection was read. So the
app's tolerance for an encoded object under `z` will never fire against this
library, and it can go whenever the app wants rather than waiting for phase
two. Worth keeping until then anyway: it costs a line and it covers a
hand-written document, which 6 says the API may be built against.

One field the reader rule does not need a fallback for: **the emitter always
writes `edge`**, on every document, so 2.2's "absent means `mid`" governs
documents from before a258 and nothing this library will emit again.

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

Two invariants hold this down and both are implemented in the prototype's `check-lab.js`:

- kappa and `E[Y|X]`, compared across window depths at a fixed total in **data**
  coordinates, agree
- kappa cannot move by more than the total moved, since `k1 + k2 = s` and both
  are increasing in `s`. Stated this way it survives `s` passing through zero,
  which a relative tolerance does not, and one of the four surfaces has support
  on both sides of zero

#### 4.2.1 The whole grid and the payload budget cannot both be had, and the way out is upstream

Raised by the API agent 2026-08-11, on starting this section.

**Answered by the author 2026-08-12: do not trade the rule for the bytes.**
"Don't worry about size budgets now, we'll figure that later if needed." So
section 4.2 stands as written: the client holds the whole reduced grid and
clips only the drawing, the derived quantities stay the app's, and the payload
is whatever that costs. Section 3.3's numbers become a note on what to expect
rather than a budget to fit, and the `detail` ceiling is the lever if it ever
does bite.

**What that asks of LIB, and it is the one open item on this section.** The
emitter as it stands at a257 crops: `z = reduce(density[lo_x:hi_x,
lo_y:hi_y])`, so the served grid *is* the window and there is nothing outside
it to compute on. Under this ruling it should choose the block factor from the
cropped extent, as 5.2 says, and then reduce the **whole** fine grid at that
factor, leaving `window` as the drawing range inside a larger lattice. The
fields do not change; `window.x` and `window.y` stop being the same numbers as
the lattice bounds, which is what they were carried for.

The rest of this section is the argument that was declined, kept because the
reasoning is the part that stops it being reopened by accident.

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

#### 4.2.1.1 The LIB view of that ask: cheap, exact, and it wants a third lattice

Answered by the LIB agent 2026-08-12. **Still the author's call**, because it
is a new public surface on `BivariateAggregate` and not only a format
addition. What follows is the cost, measured, so the decision is not taken on
a guess.

**Every one of the four curves is cheap and exact off the fine lattice.**
Measured on `Indep`, a 64 x 16,384 joint, one million cells:

- `marginals.x`, `marginals.y`: shipped at a258
- **the total's density**: already reachable with existing machinery and no
  new code at all, `bv.bivariate.pushforward(lambda a, b: a + b)`, which
  returns a `GridDistribution` on the total's own lattice. That lattice is the
  gcd of the two bucket sizes, `bs = 2` here against `(2, 4)` on the axes, and
  it is long: 32,830 buckets
- **`kappa_1(s)`**: three `np.bincount` calls over the raveled joint, one for
  the mass and one per axis for the weighted sum. **31 ms** on that million
  cell joint. `kappa_1 + kappa_2 == s` holds to **2.9e-11** and the total mass
  comes back 1.0 to ten figures, so it is exact in the sense that matters
- **`E[Y | X = x]`, `E[X | Y = y]`**: a row-wise and a column-wise weighted
  mean, cheaper still

So the objection to the ask is not cost. **The real cost is a third lattice in
the format.** The total does not live on either axis: its step is
`gcd(bs_x, bs_y)` and its length is `nx_fine + ny_fine`, so `total` and
`kappa` need their own `t0`, `dt`, `nt` and their own reduction factor, which
is a fourth thing for a consumer to get right and the one place a
`total`-indexed array could silently be read against the x lattice. It should
be one nested object carrying its own lattice, not two loose arrays:

```
total: {t0, dt, nt, k, density: [...], kappa: [...]}
```

with `kappa_2 = s - kappa_1` derived, as 4.2.1 says. `cond_mean` is different
and simpler: `E[Y | X = x]` is indexed by the **x** display lattice and
`E[X | Y = y]` by the y one, so those two go beside `marginals` and need no
new lattice.

**Reducing a conditional mean is not a block sum**, and that is worth writing
down before anyone implements it: on the display lattice
`E[Y | X in block]` is the ratio of two block sums, the weighted one over the
mass one, not the block sum of the fine conditional means. The same holds for
kappa. Getting that wrong gives a curve that looks right and is wrong wherever
the mass is unevenly spread inside a block, which is everywhere near a mode.

**The LIB recommendation is to take the ask**, on the purist ruling rather
than on the arithmetic: kappa is meaning, and an app that integrates a
truncated joint to get one is building a number the library owns. 4.2.1 makes
that argument already and it is the right one. Two riders if it is taken:

1. it is a **new bump**, not a patch to a258, and it is the natural moment to
   also give `BivariateAggregate` a public kappa, because a number this
   plan wants served is a number a notebook user wants too. A chart emitter
   should not be the only route to it
2. 4.2.1 also asks that 5.2 emit the display grid **cropped to its window**.
   That is already what a258 does, and there is nothing to change: the emitted
   grid is the crop, and `window` reports the box. The whole-grid reading was
   never emitted, so no payload regression is waiting to be undone

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

### 5.0 Status: the LIB half is delivered

Written by the LIB agent 2026-08-12, folding in a review document that used to
live at `aggregate_REFACTOR/dev/plan-3d-plot-LIB.md` and is now deleted, since
a wire format described in two documents has two versions of itself within a
month and that applies to the review as much as to the spec.

**Verdict on the plan: in order, and executed.** All seven items landed, in
two version bumps, deliberately split because 5.3 touches a different module
and is a correction rather than a feature, which is what 6 says about it.

| plan item | shipped in | where |
|---|---|---|
| 5.3 the density clip | `1.0.0a257` `[Joint-Density-Clip]` | `bivariate.py`, `tests/test_bivariate_density_clip.py` |
| 5.1 block coordinates | `1.0.0a258` `[Joint-Surface-Contract]` | `charts/_emit_bivariate.py` |
| 5.2 window before reduction | same | same |
| 5.4 the 2.2 fields | same | `charts/ir.py`, `SurfaceData` |
| 5.5 exact marginals and moments | same | same |
| 5.6 encodings | same | `charts/ir.py`, `SurfaceZBlock`, `encode_z_block`, `decode_z_block` |
| 5.7 the test programs | same | `tests/test_chart_surface_pilot.py` fixtures |

`CHART_IR_VERSION` stays **2**, per 2.4 phase one. Suite: 3,964 fast tests and
160 slow ones pass. One slow test fails and it is **not from this work**,
verified by reverting onto the parent commit: `test_massive_bivariate.py::
test_massive_pnl_one_sweep_ledger` raises `TypeError: Index must be a
MultiIndex` on `stats_df.xs(level='Label')`, which looks like a253 or a254
renaming PnL index levels without the massive ledger path following. Recorded
here only so nobody re-derives it while reading this plan.

**Measured at the defaults, on the four test surfaces.** The `kept` column
lands inside the 99.96% to 99.998% this plan predicted in 5.2:

| surface | fine grid | display | dx, dy | k | kept | f32 base64 | canonical JSON |
|---|---|---|---|---|---|---|---|
| Clayton | 512 x 2048 | 75 x 78 | 2, 4 | (2, 8) | 0.99980 | 30.5 kB | 160 kB |
| Indep | 64 x 16384 | 31 x 116 | 2, 8 | (1, 2) | 0.99987 | 18.7 kB | 102 kB |
| IndepFreq | 512 x 2048 | 82 x 108 | 32, 40 | (4, 4) | 0.99981 | 46.1 kB | 245 kB |
| IndepSigned | 1024 x 1024 | 66 x 126 | 40, 32 | (8, 4) | 0.99964 | 43.3 kB | 231 kB |

The JSON column is the **phase one dual emission** cost, roughly two thirds of
it the nested `z` array that phase two deletes. `u16log12b64` halves the
base64 column.

The zero snap of 5.2 fires on Clayton's y (a window opening 13 above an origin
the law reaches, 312 wide, and 13 is inside 5% of 312) and not on its x (8.0
against a 7.5 threshold, a genuine near miss), not on either axis of
`IndepSigned`, and not on `Indep`'s x, whose fine lattice was measured up from
48 so there is no zero on it to reach. All four branches are exercised by the
fixtures rather than by argument.

**Two things this plan worried about were already free.** Question 6's seam is
closed: `load_chart_doc` landed at a252, before this work started, so the
reader learned the new fields in the same commit that emits them and the round
trip is asserted over a real surface document, hash **and** object equality,
including the nested `z_block`. And the oversight review's condition 4,
"chartdoc baselines and fixtures regenerate", does not apply on the LIB side:
there are two chartdoc baselines, `agg.png` and `distortion.png`, no bivariate
one, and no fixture in `tests/data/` mentions the surface, because
`BivariateAggregate.plot()` draws through `plots.plot_bivariate` and not
through the chart IR. The only picture that moves is the served one.

**Where the code departs from this document.** Five places, each noted in the
section it belongs to rather than in a list here: 2.4.1 (the `z_block` name,
reached independently and now agreed), 2.3 (the reserved zero code, already
folded in above), 5.2 (`detail` as a ceiling, and the two numbers below),
5.3 (the threshold), 5.5 (marginals are masses, not densities). Two of them
are corrections to numbers this plan asserts and both are in 8.1.

**One consequence worth stating plainly.** `window` now defaults to 4, so the
served surface changes the moment the API syncs, whether or not the API passes
the parameter. That is intended: the old picture spent 99.99% of `Indep`'s y
axis on an empty tail. `window=0` is the escape hatch back to the whole grid.

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

**Ruled by the author 2026-08-12: option 1, the representative point and
`edge = "mid"`.** So the coordinate becomes the point the block's mass sits at,
`edge` says `mid` and means it, and 8.1's criterion is
`x0 - (k - 1) * bs / 2 == xs[0]`. Nothing changes app side: the decode already
reads `mid` as "the coordinate is the center", and it is the declaration
becoming true that fixes the mean, not any arithmetic here.

#### 5.1.2 LIB accepts recommendation 1, and it is better than half a bucket

Answered by the LIB agent 2026-08-12. **The finding is right**, it is right
for the reason given, and the emitter has it wrong. Confirmed independently
rather than taken on trust, on the same program: on
`agg TestConv 5 claims sev lognorm 100 cv 0.5 poisson`, `bs = 0.125`, against
a theoretical mean of 500, `xs @ p` reads 500.00000000, off by **-8.4e-9** of
a bucket, and `(xs + bs/2) @ p` reads 500.06250000, off by **exactly +0.5**.
The fine coordinate is the point the mass sits at. `edge = "left"` therefore
invites a consumer to add `dx / 2` where the truth wanted
`(k - 1) * bs / 2`, and the difference is `bs / 2` on every axis, which is the
API agent's measured `+4.58, +3.86`.

**Recommendation 1 is not merely exact in principle, it is second order where
the present convention is first order.** A display cell covers fine atoms at
`a, a + bs, ..., a + (k - 1) * bs`; their arithmetic mean, `a + (k - 1) * bs / 2`,
is what option 1 emits. Reading the declared coordinate directly then carries
no systematic error at all, only the deviation of the within-block mass from
uniform, which is second order and averages out. Measured on `Indep` at the
defaults, against the served `moments.mean`, on the y axis where `k = 2`:

| the coordinate read as | mean | off by, display buckets |
|---|---|---|
| the declared coordinate, `edge = "left"` today | 21.648823 | -0.2649 |
| a cell midpoint, which `edge = "left"` asks for | 25.648288 | +0.2350 |
| **option 1**, `x0 + (k - 1) * bs / 2`, `edge = "mid"` | 23.648556 | **-0.0150** |

Seventeen times better than either reading of the present convention, and the
residual is the window truncation, which is the right sign and the right size.
On the x axis, where `k = 1`, option 1 and the present convention coincide by
construction and both read -0.0061, again all truncation.

**And it makes the geometry coherent, which is the part that decides it.**
Under the representative-point convention the fine cell at `x_i` really does
cover `[x_i - bs/2, x_i + bs/2)`, so the display cell is the union of its `k`
fine cells, its width is exactly `dx`, and its midpoint is exactly
`a + (k - 1) * bs / 2`. So option 1 is not a fudge factor bolted onto a
left-edge grid: it is the one convention under which coordinate, cell width
and cell extent all agree, and `edge = "mid"` is then literally true rather
than the closest available word. Option 2, a third vocabulary value, would
make every consumer learn a word to describe a lattice that already has a
correct name.

**What it changes.** Small, and all in one place, `_emit_bivariate.py`:
`display_x = xs[lo:hi:k] + (k - 1) * bs / 2`, `edge='mid'`, and the same for
y. `x0` follows because it is the first display coordinate. Nothing else in
the block moves: `dx`, `nx`, `bs`, `k`, `window`, `marginals`, `moments` and
`z_block` are all unaffected, and `window.x` stays the outer edges, which
become `[x0 - dx/2, x0 + (nx - 1) * dx + dx/2]` rather than
`[x0, x0 + nx * dx]`. Three LIB tests move with it, and 8.1's phrasing becomes
`x0 - (k - 1) * bs / 2 == xs[0]`, exactly as 5.1.1 says.

One consequence to state rather than discover: the first display cell of a
positive-support law then extends to `-bs/2`, which looks like support below
zero and is not. It is the same thing the fine lattice already does, and the
same thing `pcolormesh` already draws for any centered grid in this library,
so it is consistent rather than new.

**Not built.** This is a code change and wants the author's word, per the
house rule; it is not folded into a257 or a258. It is perhaps twenty minutes
including the test moves. Provenance note for anyone re-running the API
agent's measurement: the document they decoded reports `aggregate a257` in its
`generator`, but the emitter that produced it is a258. That is the standing
version skew trap, the API records the version at editable install time, so
the string lags the code across a bump.

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

#### 5.2.1 As built: two numbers here are wrong, and `detail` is a ceiling

LIB agent, 2026-08-12. Landed at a258, with three departures from the text
above.

**The "232 cells" in 3.2 and 8.1 is the count of *fine* cells in that window,
not display cells.** `Indep`'s y window is 928 wide on a `bs = 4` lattice, so
232 fine cells; reducing them to a 128 target by a power of two gives **116**.
The contrast this plan is drawing, 232-ish against 8, survives whole. Only the
number moves, and the emitted axis is 116.

**`detail` is honored as a ceiling, not as a target to straddle.** `k` is the
smallest power of two with `ceil(span / k) <= detail`. The alternative reading,
the smallest count not *below* the target, is what would have produced 232, and
it would make `AGGAPI_MAX_CHART_DETAIL` mean nothing: a cap of 256 could then
serve 511 cells. 3.1 already calls the ceiling a cap, so the two readings were
in conflict and this is the one that keeps the cap honest.

**One exception, found by testing rather than by design: `MIN_CELLS`
outranks `detail`.** Powers of two do not reach every count. A 528-cell window
reaches 33, 17, 9, 5, so `detail = 8` has nothing to land on and the choice is
9 cells or 5, of which 5 is a grid with no spacing to interpolate on. The floor
takes it. The overshoot is bounded by `2 * MIN_CELLS - 1`, fifteen cells,
whatever `detail` was, so it cannot reach a payload budget, and it can only
happen at a target within a factor of two of the floor. Every ordinary target
is honored exactly. The API's `detail` floor of 16 in 3.1 already sits above
the band where this can bite, so nothing is owed there; it is written down
because a reader comparing `nx` against a requested `detail` of 8 would
otherwise think the emitter had ignored them.

The crop is **aligned outward to whole blocks** before reducing, which the
bullet above implies and does not say: the fine axis length is a power of two
by construction, so snapping both crop indices to multiples of `k` keeps the
window inside the axis, keeps every block full, and makes the display lattice
a sublattice of the fine one. Asserted for both axes of two surfaces at four
window depths.

The quantiles come off a `GridDistribution` rather than a hand-rolled
`searchsorted`, which is the house rule for every quantile in the library, and
the value is converted back to an index by exact lattice arithmetic rather
than by a second search, since a grid distribution's quantile is by
construction one of its own atoms.

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

#### 5.3.1 As built: the predicate as written, the threshold anchored to the mass

LIB agent, 2026-08-12. Landed at a257. The diagnosis of the **predicate** is
right and is implemented exactly as the code block above writes it, warning
first and clipping second, through one shared `_clip_density_fuzz` at both
sites. The related tidy is done and `utilities.remove_fuzz` is untouched,
since its two-sidedness is correct for the frames it serves.

**The diagnosis of the threshold is not, and the code uses
`1e-15 * abs(density).sum()` rather than `eps * density.max()`.** A 2-D FFT
accumulates round-off in proportion to the total it sums, not to the tallest
cell it produces. On a joint normalized to one that is about `eps`, which is
where the absolute `1e-15` has always sat and why it has always worked.
Anchoring to the peak instead would clip at `2e-17` on a peaked grid, keeping
dust, and at `2e-24` on a flat one, keeping everything, and it would move every
existing number in the library for nothing. Anchoring to the sum does what this
section actually wants, which is to hold the depth still, and reproduces
today's behavior exactly on a normalized joint, which is why no number in the
suite moved.

The observation that the same `1e-15` "sits 12.4 decades below the peak on one
grid and 10.7 on another" is true and is a fact about the peak rather than
about the noise.

8.1's phrasing follows: "the threshold is relative to the peak" becomes
"relative to the mass the grid carries", and the test asserts it by clearing
the same relative dust from a 16-cell and a 1,600-cell grid whose peaks differ
by a hundred.

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

#### 5.5.1 As built: the marginals are masses, because everything else is

LIB agent, 2026-08-12. The sentence above asks for "the exact marginal
**densities**", and decision 1 in section 1 says the wire carries mass and the
client divides once. Both cannot hold. **a258 emits masses per display cell**,
for the marginals as for `z`, and the consumer divides by `dx` or `dy` when it
wants a curve to stand beside a density.

The reason is 4.1's own bug. Emitting one field as a density beside a `z` in
mass is exactly how the prototype ended up with a marginal and a conditional
differing by a factor of 1024. One rule for the whole document beats matching
an adjective.

Two properties of the emitted marginals worth knowing before reading them:

- **each is cropped on its own axis only**, so `marginals.x` sums to slightly
  *more* than `window.kept`. It is the object's real marginal over the x crop
  and it includes the mass sitting outside the *y* crop. That is the point of
  5.5, and it is asserted cell by cell in the suite,
  `marginals.x >= z.sum(axis=0)` everywhere
- **`moments` does not move with the window.** Asserted between `window=4` and
  `window=0`, which is what makes it usable as the reference 4.2.1 and the
  reader rule in 8.1 both lean on

The consumer-facing rule that follows, and the one thing the SPA should take
from this subsection: **do not integrate the picture to get a mean.** The
document carries the mean. If the consumer's own arithmetic disagrees with
`moments` by more than a display bucket, the fault is on the consumer's side.

### 5.6 Encoding support

Produce `f32b64` and `u16log12b64` from the same code path, selected by the
request. Keep `json` for one release.

As built at a258: `f32b64`, `f64b64` and `u16log12b64` all come out of
`encode_z_block`, and `decode_z_block` sits beside it so the round trip is
checkable in one place rather than only against a consumer written in another
language. Everything is written **little-endian explicitly**, so the bytes do
not depend on the machine and `canonical_json` stays byte deterministic, which
is what the ETag rests on.

`encoding='json'` emits **no `z_block` at all** and leaves the plain arrays as
the payload, which is what "the current behavior, kept for one release as a
fallback" means once `z_block` has its own key: a `json` block would be a
third copy of the same grid in one document. So the `json` row of 2.3's table
is a statement about the whole surface rather than about a `dtype` a block can
declare, and `SURFACE_DTYPES` in the library is the three encoded forms.

Measured round trip error on a real document, worst case over live cells:
`f32b64` 5.9e-8 against the 1e-7 claimed, `u16log12b64` **2.108e-4** against
the 2.1e-4 claimed, and an exact zero decodes exactly under every dtype.

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

As built at a258: **two of the four moved**, `Indep` and `IndepSigned`, as
module-scoped fixtures in `tests/test_chart_surface_pilot.py`. Those two carry
everything the LIB suite needs, the pathological bucket ratio and the only
signed support, and the note above rides on the `indep` fixture's docstring
where anyone writing an independence test will hit it before they write the
assertion. `Clayton` and `IndepFreq` stayed in the prototype: they exercise
nothing the two do not, and each costs the suite a three second bivariate
build.

---

## 6. Order of work

Digging from both ends, in the style this project already uses.

**LIB first, because nothing else can start without the format.** 5.1 and 5.3
are independent of everything and can land immediately; they are corrections,
not features. 5.2 and 5.4 are the format and should land together, since 5.4
declares what 5.2 chose. 5.5 and 5.6 follow.

**Done**, a257 and a258, and it ran in that order: 5.3 alone, then 5.1, 5.2,
5.4, 5.5, 5.6 and 5.7 together, because 5.1 and 5.2 are the same function and
5.4 declares what they chose. See 5.0. Two LIB items are now queued behind an
author decision rather than behind each other: 5.1.2, accepted and small, and
4.2.1.1, which is the larger of the two and is what the SPA is waiting on.

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

*Amended by the LIB agent 2026-08-12: **"every row reads 0.000 buckets" is not
reachable and the criterion has to be restated.** A display cell holds `k`
atoms, so labeling it with any single coordinate throws away their spread, and
only the sign and size of the residual can change: the old right-edge
convention was up to a whole bucket high, worst measured +0.95, and left edge
is between -1 and 0, measured -0.006 to -0.45. Part of even that is the window
rather than the labeling, which the probe's table conflates. The mean can only
be recovered exactly by the block's mass-weighted centroid, which is not a
lattice at all and which 2.2.1 rightly forbids. What was actually wrong is
fixed and is the part that made numbers wrong rather than approximate:
`Indep`'s y support started at 508 on a law supported from 0 and now starts at
0, and the error no longer grows with the block factor. The three criteria the
suite asserts instead: (1) the first display coordinate is the fine lattice's
first coordinate, at three reduction factors; (2) the display-grid mean sits
in `(-1, 0]` display buckets of the fine mean, never above it; (3) a consumer
wanting a mean reads `moments`, which is exact and is in the document for this
reason. **5.1.2 supersedes (1) and (2)** if recommendation 1 is taken: the
first becomes `x0 - (k - 1) * bs / 2 == xs[0]` and the second tightens to
second order, measured -0.015 buckets against -0.265 today.*

**LIB 5.2, window before reduction.** Done when `build_chart_doc(obj, name,
window=4, detail=128)` on `Indep` returns a y axis of about 232 cells rather
than 8, and when the emitted `window.kept` matches an independently computed sum
over the crop to 1e-9. Plus: the low edge snaps to zero on positive support, does
**not** snap on `IndepSigned`, and no axis comes back under 8 cells at any depth
from 1 to 12.

*Amended 2026-08-12: **116 cells, not 232.** 232 is the fine cell count in that
window and reducing it to a 128 ceiling gives 116; see 5.2.1. Everything else
in this criterion holds as written and is asserted, `kept` to 1e-9 included, at
every depth from 1 to 12 on both fixtures.*

**LIB 5.3, density clip.** Done when a joint carrying an injected large negative
raises the warning and is clipped, when the threshold is relative to the peak,
and when `deficit` goes negative in that case. Test by injecting rather than by
hoping: at 1024², 2048² and 4096² nothing currently trips it, so a test that
waits for nature will pass forever without testing anything.

*Amended 2026-08-12: **relative to the mass the grid carries, not to the
peak**; see 5.3.1 for why the peak is the wrong anchor. Asserted by clearing
the same relative dust from a 16-cell and a 1,600-cell grid whose peaks differ
by a hundred. The injection discipline is exactly right and is what the five
tests do.*

**LIB 5.4 to 5.6, the format.** Done when a document round trips: emit, parse
with the SPA's decoder, and recover `z` to within the declared error of the
dtype. `f32b64` to 1e-7, `u16log12b64` to 2.1e-4. Plus `canonical_json` stays
byte deterministic across two builds of the same object.

*Met 2026-08-12, on the LIB side of it: measured 5.9e-8 and 2.108e-4, exact
zeros exact under every dtype, and byte determinism asserted across two builds.
Two additions the criterion did not ask for and should have. The document also
round trips through **`load_chart_doc`**, which is the library's own reader and
the one place a wire document's defaults and `ir_version` are negotiated:
`doc_hash(load_chart_doc(canonical_dict(doc))) == doc.hash`, and object
equality too, over the nested `z_block`. And the **encoded and plain forms are
asserted to agree**, which is the thing phase one can silently break: two
payloads for one grid is two chances to be right.*

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
