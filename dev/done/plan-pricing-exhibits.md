# Plan [Pricing-Exhibits]: Calibrate, Allocate, Evaluate through the official channels

> **EXECUTED BOTH SIDES, moved to done 2026-08-13.** The five LIB phases
> landed at `aggregate` 1.0.0a259 to a263, one bump per phase, with execution
> notes and nine recorded divergences in the LIB repo's
> `dev/done/plan-pricing-exhibits-LIB.md` (read that before treating any
> detail below as shipped). The three API phases landed at a83 (A1, routes),
> a84 (A2, the pane) and a85 (A3, the deletions): `pricing.py` is thin
> runners, `_BasisView`, `_REINS_BASES` and the pentagon arithmetic are gone,
> four routes deleted, and `tables.FORMATS` lost its six pricing keys. This
> closes round 6 item 4. The LIB-side pointer file moved to the LIB repo's
> `dev/done/` alongside it.

> **Status: FINAL, 2026-08-12.** Written up from the author's specification
> and reviewed by the author the same day: the four review questions (the PQ
> display, `ccoc` in evaluate, `bid`, the Evaluate basis) are ruled and the
> remaining recommendations adopted as written; see the decisions section.
> Canonical copy lives in `aggregate_api/dev/`;
> `aggregate_REFACTOR/dev/plan-pricing-exhibits.md` is a symlink to it, the
> `plan-3d-plot.md` arrangement. Nothing is implemented yet. Line anchors are
> LIB `1.0.0a258` and API `1.0.0a76`.

> **Supersedes phases 8 to 10 of LIB `dev/plan-exhibit-official-channels.md`**,
> which were parked "waiting on the Pricing pane design discussion". This plan
> is that discussion's outcome. It closes round 6 item 4 for the pricing
> leaves. The bounds leaves stay with the official channels plan; nothing here
> touches `bounds.py`.

## The design in one paragraph

The Pricing pane becomes three subtabs, `Calibrate  Allocate  |  Evaluate`,
laid out so the first two read as linked. Calibrate determines the distortion
parameters; Allocate spreads the calibrated pentagon across views (reinsured
Aggregate) or units (Portfolio); Evaluate runs the other direction, starting
from a premium you already hold and reporting what it survives (the Cherny and
Madan acceptability panel). Every table the pane draws arrives as a library
exhibit: `calibrate_distortions` and `evaluate` return result objects, three
exhibits (`pricing.calibrate`, `pricing.allocate`, `pricing.evaluate`) are
registered on those result objects through the existing `singledispatch`
registry with no framework change, and the app's flow becomes validate the
form, call the method, draw the envelope. The frames behind the exhibits are
created on the fly by the pricing call and live on the result, not as
persistent state on the built object; that is new for the exhibit layer but
consistent with its invariant, because every RAW block still names an
attribute holding a real public frame. When this lands, `aggregate_api`'s
`pricing.py` shrinks to thin runners, its `_BasisView` shim and its pentagon
arithmetic delete, and `tables.FORMATS` loses all six pricing keys.

## Rulings adopted

`[Calibrate-Allocate-Evaluate]` (author, 2026-08-11, restated 2026-08-12 with
the three-subtab layout). The Pricing group is three leaves, not two.

`[Pricing-Keyed-On-Result]` (author, 2026-08-11). Pricing exhibits register on
result objects, not through an `inputs=` channel on `build_exhibit`. Confirmed
feasible with zero registry changes: dispatch is plain `singledispatch` on
`type(obj)` (`exhibits/_core.py:293`, `:464`).

`[Difference-Is-A-Perspective]` (author, 2026-08-11, official channels plan,
open questions). The `gross less net` row is the buyer's reading of a cession
and belongs to INSURER; the `ceded` row is the seller's price and belongs to a
future REINSURER perspective. So RAW serves the view frame whole, with no
difference rows and no star, and INSURER restructures. The author's target
exhibit (screenshot, 2026-08-12) confirms: INSURER shows `gross*`, `net`,
`gross less net`, and no `ceded` row.

`[Pentagon-Is-The-Preview]` (author, 2026-08-12, settles an official channels
open question). The pricing pentagon completed from the form inputs does not
appear as a table in any exhibit. It becomes the live preview line on the
Calibrate form. `pricing.calibrate` carries `distortion_df` only, and
`calibration_df` moves to Allocate, where it is the degenerate single-view
case of the allocation story.

`[Allocate-Carries-The-Octet]` (author, 2026-08-12, settles the other open
question, via the target screenshots). The Allocate table shows the full
pentagon octet `L, M, P, Q, a, LR, PQ, ROE` per row, not the bare quote.

## The three exhibits

Names follow the pane: the nav leaf `pricing:calibrate` draws exhibit
`pricing.calibrate`, and so on. Titles resolve through `_title_name`
delegation to the source, so a reader sees `Calibrated distortions: BasicBook`
rather than `Calibration: CalibrationResult`.

### `pricing.calibrate`, on `CalibrationResult`

One block, `distortion_df`, identical under RAW and INSURER: the per family
receipt (`param_name`, `param`, `error`, `gini_p`, `area`) with no
adjustments. Caption is the current app text about calibrated distortions,
moved upstream and owned by the library. Deliberately small.

### `pricing.allocate`, on `CalibrationResult`, blocks by source shape

Per `[Perspective-May-Restructure]`, the block list is a property of the
`(exhibit, perspective)` pair, and here it is also a property of what the
source object is.

| source | RAW | INSURER |
|---|---|---|
| `Aggregate`, no reinsurance | `calibration_df`, one row | same |
| `Aggregate` with reinsurance | `reins_price_df` whole: every member of `reins_views` including `ceded`, octet columns, no star, no difference rows | whole program views only (`gross`, `net occ` when both stages, `net`), calibration basis starred, `basis less view` difference rows appended with ratios recomputed on the differenced levels; `ceded` views dropped (the seller's reading, deferred to REINSURER); caption is the app's current fitted-basis text moved upstream (`main.js:2406-2412`) |
| `Portfolio` | `calibration_df`, then `pricing_df` from `analyze_distortions` whole: `(distortion, stat)` rows, units across | `calibration_df`, then the four stat slices `LR`, `P`, `PQ`, `ROE` with units across, captioned `Loss ratio (LR) by distortion` and so on (the `PRICE_TITLE` strings, `main.js:2267-2269`, moved upstream) |

This is the RAW versus INSURER example the framework has been waiting for: the
Portfolio case shows the two perspectives as genuinely different readings of
one calculation, and the reinsured Aggregate case is the first exhibit where
RAW carries strictly more rows than INSURER.

Distortions skipped by the library (the mass distortion on an unbounded book)
surface as warnings in the envelope `meta`, drawn by the app under the table,
never a failure.

A future view is already known: when `[NetCeded-Natural-Allocation]`
(`aggregate_REFACTOR/dev/plan-natural-allocation-to-occurrence-net-ceded.md`)
lands, its gross to ceded and net allocation becomes an additional
`pricing.allocate` block for occurrence-reinsured Aggregates. Out of scope
here; recorded so the block list is designed with room for it.

### `pricing.evaluate`, on `EvaluationResult`

RAW is the panel, one block: `(Step, distortion)` rows with `role`,
`param_name`, `param`, `gini_p`, `error`, `status`. INSURER is the same frame
with the caption moved upstream (`main.js:2613-2618`): the breakeven reading of
`gini_p`, the `status` column, and the `DegenerateEvaluationWarning`
distinction between a position unacceptable at any stress and one that cannot
lose. An `Aggregate` or `Portfolio` evaluates its own position; a reinsured
`Aggregate` evaluates the premium on the basis the caller named
(`reins_view=`), which the caption states; a `PnL`
evaluates every margin row of its ledger. Background reference for captions
and docstrings: Cherny and Madan 2009, the methods of performance evaluation
paper.

### Which objects get which leaves

| object | Calibrate | Allocate | Evaluate |
|---|---|---|---|
| `Aggregate` (with or without reinsurance) | yes | yes | yes |
| `Portfolio` | yes, output basis only | yes | yes |
| `PnL` | no, it carries its own premium | no | yes |
| `Severity`, `Distortion`, `BivariateAggregate` | no | no | no |

Verified against the library surface: `calibrate_distortions` exists on
`Aggregate` and `Portfolio` only; `evaluate` on those two plus `PnL`; nothing
else has either. The basis choice (`gross`, `net occ`, `net`) applies only to
a reinsured `Aggregate`. A `Portfolio` always calibrates on its output basis,
whatever the program made that; its `analyze_distortions` refuses the view
axis by design (`_portfolio.py:3927-3937`) and this plan does not reopen that.

## LIB work

Five phases, one version bump and one commit each, in order. LIB lands first,
then the API syncs and cuts over, the `load_chart_doc` precedent.

### Phase L1 `[Pricing-Result-Objects]`

Was phase 8 of the official channels plan, unchanged in substance.

`CalibrationResult` in `results.py`: `distortion_df`, `calibration_df`,
`distortions`, the inputs it was called with (`coc`, `p`, `a` as resolved,
`kind`, `names`, `reins_view`), and a `_source` back reference (the
`PnL._source` precedent, `_pnl.py:922`). **Breaking**: `calibrate_distortions`
returns it instead of the bare `distortion_df`. The instance attributes
(`self.distortions`, `self.distortion_df`, `self.calibration_df`) stay, so
nothing breaks twice (decision 5).

The result also materializes the Allocate frames lazily, computed on first
access from `_source` and the stored inputs, then cached on the result:
`pricing_df` for a Portfolio source (`_source.analyze_distortions` at the same
anchor with the result's own distortion set) and `reins_price_df` for a
reinsured Aggregate source (`_source.reins_price_df(p=...)` with the
calibrated set). This is what keeps the RAW invariant intact for on-the-fly
exhibits: every RAW block still names an attribute on the dispatched object
that returns a real public frame, and the a253 invariant sweep extends over
result fixtures with no change of wording.

`EvaluationResult`: the panel frame, the premium it was measured against, the
basis that premium was stated on (`reins_view`, feeding phase A2's Evaluate
basis group), the asset anchor (`p`, `a`) from phase L3, `_source`.
**Breaking**, same reason: a
bare DataFrame cannot be dispatched on. Panel field name to be vetted per the
house naming rule against `PnL.evaluation_df` (promoted at a253), which is the
natural vocabulary to match.

All result classes (the two new ones and the three existing in `results.py`)
gain `_source`, plus `name`, `label`, `_title_name` and `_relabel` delegation
to it, so `build_exhibit`'s `meta` assembly (`_core.py:550-556`) reads real
values. `PricingResult` gains the `_relabel` at construction its two siblings
already apply (`_portfolio.py:3864`, `:4000` versus `:3616`).

### Phase L2 `[Unbounded-Anchor-Guard]`

`p=1` on an unbounded risk currently resolves, silently, to the last grid
point carrying mass (`_grid_distribution.py:185-187`) and every number
downstream moves with `log2` rather than with the risk. There is no guard
anywhere in the chain. The clean test exists and is spec-only: the `bounded`
property (`_aggregate.py:675-689`, `_portfolio.py:741-750`, backed by
`_tail_info` and `TailClass`), already used as a guard by the lifted
allocation builder (`_portfolio_common.py:137-140`) and by
`analyze_distortions` (`_portfolio.py:3952-3958`). Tail info, not
`density_df`, exactly because the density frame cannot distinguish a bounded
risk from an unbounded one that ran out of grid.

One shared helper in `_pricing.py`, applied wherever a caller's `p` resolves
to an asset level: `calibrate_distortions`, `price_pentagon`,
`price_pentagon_ex`, `reins_price_df`, and the phase L3 `evaluate` anchor.
`p == 1` with `bounded` false raises `ValueError` with a message fit for the
wire, naming the tail as the reason and `tail_behavior_df` as the place to
look. Note `Portfolio.bounded` is the worst-of over units and the right test
there; the Portfolio `tail_behavior_df` total row shows realized grid extent
and must not be used for this (`_portfolio.py:1151-1161`).

Test programs: the author's `BasicBook` (Poisson count, so unbounded even
with the 1000 xs 0 severity limit) must raise cleanly at `p=1` and calibrate
normally at `p=0.99`; a `dfreq` bounded program must accept `p=1`.

### Phase L3 `[Evaluate-Asset-Anchor]`

`evaluate` takes no `p=` or `a=` on any class today; the acceptability solve
anchors on `z[-1]`, the top of the FFT grid (`_pricing.py:874-881`), which is
a grid artifact on an unbounded risk. The requirement: `Aggregate.evaluate`
and `Portfolio.evaluate` accept at most one of `p=` / `a=`, resolve the asset
level the same way calibration does, and make the breakeven solve a function
of it, so that evaluation at the same anchor as a calibration closes the round
trip. Default `None` keeps the current whole-distribution behavior, documented
as the unlimited case. `PnL.evaluate` is deliberately unchanged this round
(decision 4): each ledger row is its own position and the right anchor
semantics deserve their own discussion.

The round trip is the acceptance test and the author's own check: calibrate
`(coc, p)`, take each family's implied premium at the resolved asset level,
evaluate that premium at the same anchor, and recover that family's calibrated
parameters within tolerance, per family, on the three reference programs in
this plan's appendix.

Note `ccoc` is currently excluded from `EVAL_FAMILIES` precisely because "its
closed form needs an asset level that the acceptability question does not
supply" (`_pricing.py:696-699`). **Ruled 2026-08-12: `ccoc` joins the families
when an anchor is supplied.** The unanchored default keeps today's four, since
the stated reason still holds there.

### Phase L4 `[Reins-View-Pricing]`

Was phase 9. The method exists (`reins_price_df`, `(distortion, view)` rows)
and works across all five views since the a250 fuzz fix. Three edits:

1. **The frame grows the octet**, per `[Allocate-Carries-The-Octet]`. Today's
   columns are the quote, `a, el, bid, ask, margin`; the target exhibit shows
   `a, L, M, P, Q, LR, PQ, ROE`. Since `el` is `L`, `ask` is `P` and `margin`
   is `M`, the frame adopts the pentagon vocabulary outright and completes
   `Q` and the three ratios through `complete_pentagon`. **`bid` is dropped
   entirely** (author, 2026-08-12: too confusing), so the columns are the
   canonical octet in `PENTAGON_STATS` order and nothing else.
2. **`price_pentagon` and `price_pentagon_ex` gain `reins_view=`**, resolved
   through the same `_reins_view_source` as calibration, so the preview line
   can answer on the calibration basis a reinsured reader chose.
3. **The two docstrings gain the buyer's sentence.** `reins_price_df`
   (`_reinsurance.py:650-652`) and `Portfolio._reins_view_density`
   (`_portfolio.py:1713-1718`) state that differencing views is not the price
   of the cession. That is the seller's truth; per the settled perspective
   ruling they add the sentence naming the buyer's reading rather than
   asserting the reversal is meaningless.

In the same phase (decision 6): `calibrate_distortions` accepts `lr=` as the
alternative target (exactly one of `coc` / `lr`), resolved to a cost of
capital through the pentagon at the resolved anchor. Today the API performs
that conversion itself through `Pentagon.solve` (`pricing.py:442-445`); the
form has offered `CoC | LR` since round 3 and the library owns the
conversion.

### Phase L5 `[Pricing-Exhibits]`

Register the three exhibits per the specification table above. Mechanics, all
existing:

- `register_simple_exhibit('pricing.calibrate', ..., 'distortion_df',
  [CalibrationResult], caption=...)` covers Calibrate in one call.
- Allocate and Evaluate use the raw `fn.register` / `fn.insurer.register`
  decorator forms; the Allocate builder dispatches on `type(result._source)`
  internally, which is ordinary Python inside one registered builder.
- Predicates: `_perspectives_always`. A result object exists only because a
  successful call produced it; there is no partially-available state.
- Formats and captions move upstream from the app: the six pricing format sets
  in `tables.FORMATS` (`tables.py:135-151`) become library formatters beside
  `SHARPEN_FORMATS`, and the caption texts named in the specification table
  come from `main.js` as the seed the author edits.
- `available_exhibits(result)` answers the three names through the existing
  dispatch; nothing in `available_exhibits(built_object)` changes, so the
  app's capability payload is untouched by this phase.

Tests: the standing envelope contract (every block reconstructs hash for hash
through `gt.TableDoc.model_validate`), the RAW invariant sweep over result
fixtures, and block-list assertions per source shape and perspective,
including the INSURER drop of `ceded` rows and the star on the calibration
basis.

## API work

Three phases, after LIB lands and a sync records the new versions.

> **Execution log.** LIB phases L1 to L5 landed at `aggregate` 1.0.0a259 to
> a263; read `aggregate_REFACTOR/dev/plan-pricing-exhibits-LIB.md` section 4
> before working here, and section 3 for the nine places the code and this plan
> deliberately disagree. API phases: **A1 landed 1.0.0a83**, **A2 landed
> 1.0.0a84**, **A3 landed 1.0.0a85**. Three notes from A1, none of them
> requiring either side to move:
>
> 1. `price_pentagon` spells its target `ROE=` / `LR=`, not `coc=` / `lr=`, so
>    the preview route translates. `calibrate_distortions` does take `coc=` /
>    `lr=`, which is why the two are separated at the runner rather than shared.
> 2. The loss-ratio refusal (LIB note 3.4) is raised by `calibrate_distortions`,
>    not by `price_pentagon`. Completing a pentagon at an impossible loss ratio
>    is arithmetic; it is the calibration that would chase a premium above the
>    essential supremum. So that one message reaches the reader on `[Calibrate]`
>    rather than in the preview line, and only the unbounded anchor guard lands
>    in the line as the plan describes.
> 3. Skipped distortions are Python warnings raised during the exhibit build,
>    not entries in the envelope `meta` (the meta carries `kind`, `object`,
>    `label` and `captions`). So the routes wrap the build in the api's own
>    `library_warnings()` capture and carry them beside the envelopes, which is
>    the same reading for the reader by a different route.
>
> Two notes from A3, both scope rather than contradiction:
>
> 4. The sharpen pair stays in `tables.FORMATS`. The plan says `FORMATS` empties
>    at A3, which is true once the sharpen leaf moves onto the exhibit the
>    library registered at a255; that cutover is its own `dev/TODO.md` item and
>    not part of this plan, so A3 deleted the six pricing keys and left those
>    two. `frame_document_dict` is `bounds.py`-only as the plan says, which was
>    the load-bearing half of that claim.
> 5. `dev/scripts/check-adapter.py` lost its `_price_pairs` pass. It compared a
>    document against the `FrameResponse` for the same frame, and the pricing
>    routes were the only place both were built from one call. There is no
>    second rendering of an exhibit envelope to disagree with, so the pass had
>    nothing left to check. The string-column property it was added for is still
>    exercised by `validation_df` and `stats_df`; noted in the file.

### Phase A1 `[Pricing-Routes]`

New routes beside the existing ones (which stay alive until A3 so the SPA
never breaks mid-cutover):

- `POST /v1/objects/{oid}/pricing/preview`. Body: exactly one of `p` / `a`,
  exactly one of `coc` / `lr`, optional `basis`. Runs
  `price_pentagon(reins_view=basis, ...)`, no calibration. Returns the octet
  as scalars: `premium`, `assets`, `lr`, `pq`, `coc`, plus the resolved `p`.
  Library `ValueError` (including the L2 unbounded guard) becomes HTTP 400
  whose `detail` is the message the preview line prints.
- `POST /v1/objects/{oid}/pricing/calibrate`. Same body. Runs
  `calibrate_distortions`, holds the `CalibrationResult`, and returns
  envelopes for both `pricing.calibrate` and `pricing.allocate`, each under
  both perspectives (decision 8: bundled; the frames are tiny and the
  perspective toggle then flips with no recompute and no server-side result
  cache). Envelope serialization reuses the exhibit route's deterministic
  serializer (`objects.py:2860-2871`).
- `POST /v1/objects/{oid}/pricing/evaluate`. Body: optional `premium`
  (rejected for `PnL`, required when the exposure states none), optional
  `basis` naming which premium is being input (reinsured Aggregate only,
  passed as `reins_view=`), at most one of `p` / `a`. Returns the
  `pricing.evaluate` envelopes.

The capability payload gains `premium`, the object's own resolved premium or
null, so the Evaluate form can prefill it; `needs_premium` stays as the "must
type one" signal.

### Phase A2 `[Calibrate-Allocate-Evaluate-Pane]`

The SPA restructure, driving everything through the A1 routes.

**Subtabs.** `nav.js` `NAV_GROUPS.pricing` becomes `calibrate` / `allocate`
(both `flag: 'canPrice'`) and `evaluate` (`flag: 'canEvaluate'`), each with a
`hint` so `ledeFor` finally has something to say on this pane. The row is laid
out `Calibrate  Allocate  |  Evaluate`: `renderSubTabs` (`main.js:968-995`)
learns a divider marker on a leaf (`dividerBefore: true` on `evaluate`),
drawn as a thin vertical rule, so the first two read as one linked pair.
`dev/scripts/check-nav.mjs:74-75` expected leaves update in the same commit:
`calibrate` and `allocate` for `['agg','agg_reins','port']`, `evaluate`
unchanged. Panes become `pane-calibrate`, `pane-allocate`, `pane-evaluate`
(`PANE_OF` / `ALL_PANES`, `main.js:780-785`); the standing rule that a leaf
never computes on activation (`main.js:2241-2248`) is preserved: one
`[Calibrate]` click fills both the Calibrate and Allocate panes from one POST,
and switching between them just swaps visibility.

**The form.** One shared form, visible on both Calibrate and Allocate:
the basis group (`#price-basis`, unchanged gating: live only for a reinsured
Aggregate, greyed with a `why` otherwise, and the Portfolio `why` becomes "a
portfolio calibrates on its output basis"), the `p | assets` anchor group, the
`CoC | LR` target group, and the button, relabeled `[Price]` to
`[Calibrate]` because that is what it does. Heights: adopt the Quick Re
solution verbatim, a `--price-h` custom property on `.price-form` applied to
`.btn-group .btn`, the direct `> .btn` and `.price-field input` alike
(`site.css:614-640` is the pattern and carries the author's ruling; the
current `.price-form` gives inputs a hard `1.7rem` while buttons are
padding-derived, `site.css:515-516` and `:570-572`, which is the complaint).
Give `#price-anchor-label` the `min-width` that `#price-target-label` already
has (`site.css:574`) so `p` to `assets` stops reflowing the row.

**The preview line.** A `Preview:` line under the form, updating debounced as
the reader types, exactly the Quick Re pattern (`main.js:2091-2150`): trailing
edge debounce at 350 ms, monotonic ticket against out-of-order responses,
dim-not-blank while in flight (`.is-pending` after 120 ms), and on failure the
error message is the preview text, which is how the L2 unbounded guard reaches
the reader as a sentence instead of a broken pane. Format:

    Preview: premium #,##0.00, assets #,##0.00, loss ratio 0.0%, PQ 0.000, and COC 0.0%

fed from `POST pricing/preview`. PQ displays as a ratio, `.3f`, matching the
tables (decision 9, correcting the specification line's `0.0%`). Gated
silent, not error, when the object cannot price or the form is incomplete.

**Evaluate form.** Premium field prefilled from the capability `premium` when
the object states one, editable either way, hidden for `PnL`; a
`Gross | Net occ | Net` basis group that names **which premium is being
input**, live only for a reinsured Aggregate and greyed with a `why`
otherwise, passed as `reins_view=` (decision 10, ruled 2026-08-12: include
it, but deliberately narrow; the fuller gross versus net evaluation story
overlaps Economics and stays there); a `p | assets` anchor pair matching the
Calibrate form, since the panel is now asset-sensitive; the `[Evaluate]`
button. This closes `api-punchlist.md:196` in the premium-identification
sense.

**Rendering.** `renderPrice`, `renderReinsPrice` and `renderEvaluate` are
replaced by one envelope renderer shared in shape with `loadExhibitLeaf`
(`main.js:1722-1760`): blocks in order, caption lifted out of the block and
drawn under the table, warnings from `meta` after that. All app-authored
caption and title literals on this pane delete.

### Phase A3 `[Pricing-Assembly-Deletes]`

The cutover complete, delete what the plan exists to delete:

- `pricing.py`: `run_price_pentagon`, `run_reins_price`, `run_evaluate`,
  `_BasisView`, `_REINS_BASES`, `reins_bases`, `_pentagon_row`,
  `_pentagon_diff`, `_sub`, `_document`. What remains is the thin runners for
  the three A1 routes: validate the body, call the method, build envelopes.
  The legacy `run_pricing` / `POST pricing_at` pair deletes here too
  (decision 7; the SPA has never called them).
- The three old routes and their models (`PriceRequest/Response`,
  `ReinsPriceRequest/Response`, `EvaluateRequest/Response` reshaped to the new
  envelope-bearing forms).
- `tables.FORMATS`: `price`, `reins_price`, `stat_LR`, `stat_P`, `stat_PQ`,
  `stat_ROE` (`tables.py:135-151`). With the sharpen pair already deletable on
  the a255 sync (separate, pre-existing item), `FORMATS` empties and
  `frame_document_dict` becomes `bounds.py`-only.
- `capability.reins_bases_for` rewires from `pricing.reins_bases` to the
  library's `obj.reins_views`, filtered to the calibration bases the form
  offers (`gross`, `net occ` when present, `net`).
- `main.js`: `PRICE_TITLE`, the two app-authored captions, the
  `state.hasReins` endpoint branch (`main.js:2454`), and the pricing entry in
  the LOADERS exception comment (`main.js:852-856`), which after this names
  Bounds alone.
- Tests: `test_objects.py:2108` (the declared-formats test follows the
  envelope), `test_capability.py:309` (reins bases from `reins_views`), plus
  new round-trip coverage of the three routes.

## Acceptance

1. **The round trip closes** (LIB, phase L3 test): calibrate, price, evaluate
   at the same anchor recovers each family's parameters, on all three
   reference programs below.
2. **The target screenshots reproduce.** `pricing.allocate` INSURER for
   `BasicBookRe` matches the author's first target (rows `gross*`, `net`,
   `gross less net` per distortion, octet columns); for `Basic` it matches the
   second (calibration line plus the four stat slices).
3. **`p=1` on `BasicBook` fails gracefully end to end**: clean `ValueError`
   in LIB, HTTP 400 at the route, the message as the preview line in the app.
4. **Hash for hash**: every served block reconstructs through
   `gt.TableDoc.model_validate`, the standing envelope contract.
5. **The deletion grep is clean**: no `greater_tables` import outside
   `tables.py`, no pricing keys in `FORMATS`, no pandas frame assembly in
   `pricing.py`.

Reference programs (the author's, 2026-08-12): `BasicBook` (250 Poisson
claims, lognormal 100 cv 1.5 under 1000 xs 0), `BasicBookRe` (same with
`occurrence net of 276 xs 55`), and the two-unit `port Basic` (gamma
severities, dfreq [1]), each calibrated at `coc=0.15, p=0.99`.

## Decisions (author review, 2026-08-12)

The draft carried ten numbered questions. The author ruled on four (1, 3, 9,
10); the other six carried recommendations, adopted at finalization, to be
re-flagged at the owning phase's review only if execution turns up a reason.

1. **`bid` is dropped** from the grown `reins_price_df`: too confusing. The
   columns are the canonical octet alone.
2. **INSURER drops the `ceded` rows** on the reinsured Aggregate Allocate.
   Stands as written, per the perspective ruling and the target screenshot;
   RAW is strictly wider than INSURER here for the first time.
3. **`ccoc` joins the evaluate families** when an asset anchor is supplied.
   The unanchored default keeps today's four.
4. **`PnL.evaluate` anchor semantics**: deferred, unchanged this round; the
   per-row position question wants its own discussion.
5. **The calibration instance attributes stay**; no second break.
6. **The library owns the `lr=` target conversion** on
   `calibrate_distortions`.
7. **The legacy `pricing_at` route and `run_pricing` delete** at A3.
8. **Both perspectives bundle** in the POST responses.
9. **PQ displays as a ratio, `.3f`**, in the preview line as in the tables;
   the specification line's `0.0%` was a slip.
10. **The Evaluate form gains the `Gross | Net occ | Net` group naming which
    premium is being input**, `reins_view=` underneath, live for reinsured
    Aggregates only. Kept deliberately narrow: the broader gross versus net
    evaluation reading overlaps Economics and stays there.

## Cross-document ledger (edits made alongside this draft, 2026-08-12)

- LIB `dev/plan-exhibit-official-channels.md`: phases 8 to 10 marked
  superseded by this plan; the two pricing open questions marked settled with
  pointers here.
- LIB `dev/note-from-aggregate-api-round-6.md`: item 4 status row points here.
- LIB `dev/TODO.md`: the `[Exhibit-Official-Channels]` entry notes the design
  discussion happened and names this plan.
- LIB `dev/plan-exhibits.md`: the two deferral lines about pricing exhibits
  annotated as superseded.
- LIB `dev/plan-natural-allocation-to-occurrence-net-ceded.md`: out of scope
  bullet points at `pricing.allocate` as its eventual screen surface.
- API `dev/TODO.md`: the "pricing FORMATS stay" line and the a71 settlement
  block updated; the `calibrate_distortions` upstream ask closed as landed
  (`reins_view=` at a223, fixed a250) and folded here.
- API `dev/api-punchlist.md`: the Pricing punch list items absorbed by this
  plan annotated (196, 197, 203); the leaf matrix stub row noted.
- API `dev/plan-ui-round-6.md`: the exhibit-migration table row declaring
  Pricing "cannot be" migrated annotated as overturned by
  `[Pricing-Keyed-On-Result]` and this plan.
- Finalized the same day after author review: the `bid` reference in the
  official channels plan and the `api-punchlist.md` item 196 annotation
  updated to their settled state.

## Cadence

LIB phases L1 to L5 land first, each its own `1.0.0aNNN` bump with a one line
commit and the CHANGELOG section as the real description; then the API syncs
(`uv sync --extra dev`, so `/v1/meta` reports both new versions) and lands A1
to A3, each its own `1.0.0aNN` bump. On completion this plan moves to
`aggregate_api/dev/done/` and the LIB symlink follows it; the official
channels plan closes at the same time, its bounds phase permitting.
