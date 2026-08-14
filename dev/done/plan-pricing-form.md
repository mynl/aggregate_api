# plan-pricing-form: one pricing form, carried across Pricing and Bounds

Status: **EXECUTED 2026-08-14**, both phases, at `1.0.0a100` and `1.0.0a101`.
Section 9 records what the execution found that this document did not predict,
which is one shipped bug in `bounds.py` and one thing the author's basis ruling
was stated on that did not hold. Read section 9 before trusting sections 3 to 6
as a description of the code.

Drafted and settled 2026-08-14. API and SPA only; no
LIB change is required to execute either phase, and no open decision remains.
The author ruled on the calibration basis (6.2, a `Portfolio` locks to net), on
the target set (3.3, all three everywhere) and on the 1.0 behavior when a
pricing cannot be carried (6.3, withhold the seed, keep the controls live).
Section 7 is the deliberate non goal. Section 8, technical against booked
premium, is parked by the author until this lands.

**One upstream bug was found while checking the basis ruling and is not fixed
here**: `CalibrationResult.pricing_df` ignores `reins_view` for a `Portfolio`
and allocates the net book whatever is asked for (6.2). Locking the app to net
hides it from the reader; the round 7 note carries the fix.

Two phases, each its own version bump:

* **Phase 1** (`1.0.0a100`): the shared pricing form, compacted to one line
  (3.6), premium as a pricing target, and one held pentagon that Calibrate,
  Evaluate and the three Bounds leaves all read and write. A `Portfolio` locks
  to net (6.2), and a pricing struck on a basis the Bounds group cannot honor
  withholds its seed rather than carrying silently (6.3).
* **Phase 2** (`1.0.0a101`): the debounced preview line under the Bounds form,
  and the deletion of the api's hand rolled pentagon in `bounds.py`.

Carried out of this plan, to be raised as a round 7 note: `reins_view=` on
`Bounds` and `PricingBounds`, and `calibrate_distortions(P=...)`. Neither gates
execution; see 6.1.

---

## 1. The finding this rests on

`Aggregate.price_pentagon` (`_aggregate.py:6475`) takes exactly one capital
anchor and exactly one pricing target, and **premium is one of the targets**:

```python
def price_pentagon(self, *, p=None, a=None, P=None, M=None, Q=None,
                   LR=None, PQ=None, ROE=None, reins_view=None):
```

Read the three panes against that signature and they are the same form:

| Leaf | anchor | target | verb |
|---|---|---|---|
| Pricing / Calibrate | `p` or `a` | `coc` or `lr` | fit the distortion set |
| Pricing / Evaluate | `p` or `a` | `P` | breakeven acceptability solve |
| Bounds, all three | `p` or `a` | `P` | sweep the consistent distortions |

Evaluate is already the premium mode: its form is `(evaluate-premium,
evaluate-anchor-val)`, which is the pair `(P, a)` under two different labels.
Bounds is the same pair again, under two more (`bounds-premium`,
`bounds-assets`).

So this plan does not impose a shared abstraction on three panes. It notices
that all three are instances of one the library already publishes, and stops
spelling it three ways. `price_pentagon_ex` is freer still, taking the limited
expected loss `L` as an anchor, which is held in reserve and not offered.

## 2. What the reader gets

The flow the app is laid out for, left to right, becomes continuous:

1. Overview, then Reinsurance, then **Pricing / Calibrate**. Set an anchor and
   a target, watch the preview line complete the pentagon, press Calibrate.
2. **Allocate** reads the same calibration, as it does now, with no second
   press.
3. **Evaluate** arrives carrying that calibration's own premium and anchor.
   Pressing Evaluate unchanged is a round trip that must return the same
   families, which is a check the reader can see. Changing the premium asks the
   question the leaf exists for, and **that premium becomes the current one**.
4. **Bounds** arrives carrying whatever the current pricing is, with the same
   form and the same preview line. The band it draws is the band around the
   premium the reader has been working with, rather than around
   `mean * 1.25`.

The last of those is not a convenience. `bounds.py:65`
`_calibrate_for_envelope` re-derives a calibration from the request's own
premium so that panel 2 of the envelope names distortions on the same band
panel 1 draws, and its docstring says so: "they have to be the same premium or
the two panels answer different questions." Today, unless the reader retypes
the calibration's `P` and `a` exactly, the Bounds envelope shows the same five
families struck at a different premium from the ones Calibrate just showed,
with nothing on screen saying so. Carrying the pentagon is what makes the two
panes one reading.

## 3. Phase 1: the form and the held pentagon

### 3.1 The held pentagon

One module level value in `main.js`, beside `_calibration` and `_evaluation`:

```js
//: The pricing every pane is currently talking about: the completed pentagon,
//: plus the question that produced it. Written by a Calibrate press, by an
//: Evaluate press, and by a Bounds compute; read by every form on arrival.
let _pricing = null;   // {octet: PricingPreviewResponse, anchor, target, basis}
```

`octet` is a `PricingPreviewResponse` verbatim, which already carries `p`,
`assets`, `loss`, `margin`, `premium`, `capital`, `lr`, `pq` and `coc`. It is a
wire type this repo already owns, so nothing new is invented to hold it.

Last write wins, which is the author's rule: an ad hoc premium typed on
Evaluate becomes the premium. There is no provenance tracking and no "prefill
but do not overwrite" flag, because there is one current pricing rather than
several boxes with private histories.

Dropped in `forgetPricing()`, which already runs on every object change and is
already called from both arms of `adoptBuild`. A pricing is about the object it
was struck on.

### 3.2 The form component

`web/src/pricing-form.js`, new. A factory rather than three copies of markup,
because three hand maintained copies of one form drift, and the layout
consistency is half the point of the request.

```js
export function createPricingForm(host, { verb, onSubmit, basis, extras })
```

* `verb`: the button's word, `'Calibrate'`, `'Evaluate'` or `'Compute'`, and
  its busy form.
* `onSubmit(body)`: what the press does with `{p|a, coc|lr|premium, basis}`.
* `basis`: `'calibrate'`, `'evaluate'` or `null`, choosing which basis row is
  drawn above the anchor, or none. See section 6.
* `extras`: an optional node placed **below** the form and above the preview
  line. The `against` field on Pricing Bounds is the only user, which is the
  layout the author asked for.

The component returns `{ read(), write(pricing), setBusy(on) }`. `write` is how
a leaf adopts the current pricing on arrival; `read` is what the button posts.

Three mount points, replacing the static markup in `index.html`: `leaf-price`,
`leaf-evaluate` and the Bounds form. The existing `d-none` toggling in
`showPricingLeaf` and `showBoundsLeaf` stays as it is; only what sits inside
each host changes.

### 3.3 Premium as a target

The target selector gains a third member, so it reads CoC, LR, Premium.

**Settled (author, 2026-08-14): all three on every leaf, which is what
replicating the form means.** It costs nothing and buys a question worth
asking, since "the bounds at a 15% cost of capital and p = 0.99" is well formed
and resolves through the pentagon to a premium before the sweep. It also makes
the carry over faithful to the question and not only to its answer: arriving at
Bounds after a CoC calibration shows the CoC that was calibrated, with the
premium it implies on the preview line beneath.

Wire changes, both small:

* `PricingPreviewRequest` gains `premium: float | None`. `_one_target` in
  `pricing.py` accepts it as a third mutually exclusive member and maps it to
  the pentagon's own spelling, `P`, beside the existing `ROE` and `LR`.
* `PricingCalibrateRequest` gains the same field. `calibrate_distortions` takes
  `coc` or `lr` and not `P`, so a premium target resolves through one
  `price_pentagon(a=..., P=...)` call and the returned `ROE` is what is
  calibrated. That is two library calls chained, not arithmetic: the api solves
  nothing. Section 6 notes the tidier upstream alternative.

`PricingPreviewResponse` is unchanged; it already carries the whole octet.

### 3.4 What each leaf does on arrival

* **Calibrate**: `write(_pricing)` when there is one, else the current
  defaults. Unchanged otherwise.
* **Evaluate**: `write(_pricing)`. This replaces the current prefill from
  `state.caps.flags.premium`, which stays as the fallback when no pricing has
  been struck. It also fills the anchor, which is prefilled by nothing today
  and left at `0.99`, so the round trip the leaf's own comment describes
  ("evaluating a family's own implied premium recovers that family's calibrated
  parameters", `main.js:2759`) finally happens by default.
* **Bounds, all three**: `write(_pricing)`, else an empty form. The
  `mean * 1.25` seed in `showBoundsLeaf` goes: it existed only to put the box
  above the expected loss, and the preview line now says whether it is.

### 3.5 What each press does

Every press writes `_pricing` from the octet it used, so the three verbs feed
each other. The Calibrate and Evaluate presses keep their existing bodies plus
the new target. The Bounds presses send `premium` and `assets` read off the
resolved octet rather than off two raw boxes, so a CoC targeted bounds sweep
posts the premium that CoC implies.

### 3.6 The layout: one line (author, 2026-08-14)

The form is compacted at the same time, because rebuilding it as a component and
restyling it separately would mean touching the same markup twice.

Target, Calibrate leaf:

```
calibrate on [Gross|NetOcc|Net]   [0.99](p)  ◦  [0.15](CoC)  [Calibrate]
```

reading as: an input box, then the segmented control that both labels the box
and switches what it means. Value first, unit after, the way a quantity is
written. `◦` is a spacer between the anchor pair and the target pair, keeping
the two pairs legible as pairs. All of it on one line with the basis, wrapping
only when the viewport is too narrow.

#### What this deletes

The current row carries the choice **twice**: a `btn-group` of two radios naming
the anchor, and a `<span>` beside the input naming it again
(`index.html:463-470`). Same for the target. The `btn-group` stays and the
`<span>` goes, so the control that switches the box is also the one that labels
it. That is three spans and the `min-width` rule holding them steady, and it is
most of why the line then fits.

The separate `#price-basis` row (`exhibit-controls`) folds into the form row.
`.tab-tools` is already `display: flex; flex-wrap: wrap`, so one line with
graceful wrapping is what that costs: nothing.

#### The switches stay the left-to-right segmented control

The existing `btn-group` of radios, unchanged as a widget. Not a `<select>`,
not a click-to-cycle label. `(p|assets)` in the sketch above is that control,
moved to sit **immediately after** its input box so it labels the box rather
than being stated twice.

Which member is active is carried by `.active` alone, and the author's reading
of that (2026-08-14): with two members it is admittedly not obvious which is
selected, and that is accepted. With three it reads cleanly, because only one
member differs from the other two. So the target's move from two members to
three (3.3) improves the control rather than straining it.

All three controls are then the same widget, which answers the complaint in
`renderPriceBasis`'s own docstring that the tab "used to stack three visual
languages". One row, one language.

**The reflow problem goes away rather than moving.** `#price-anchor-label`,
`#price-target-label` and `#evaluate-anchor-label` carry `min-width: 2.3rem`
(`site.css:628-630`) because the row shifted every time the anchor changed,
a live bug through a83. Those spans are what this deletes, and a `btn-group`
draws every member all the time, so its width does not depend on the selection
and nothing shifts. The rule goes with the spans.

Keep `text-align: right` on the number inputs, and keep the `against` box as the
documented exception.

#### The greying protocol is unaffected

House rule is that a control the object cannot use greys out and says why, and
`renderPriceBasis` gives every member its own `title` and `aria-label` today.
Keeping the `btn-group` keeps all of that verbatim, including the two distinct
reasons it writes ("needs a cession; add one on the Reinsurance tab" against
"this program has no distinct basis of that kind") and the third this plan adds
for a locked `Portfolio` (6.2).

#### The three forms

Same component, same line, different members:

```
Calibrate   calibrate on [basis]  [val](p|assets) ◦ [val](CoC|LR|Premium) [Calibrate]
Evaluate    premium is   [basis]  [val](p|assets) ◦ [val](Premium)        [Evaluate]
Bounds      (basis, per 6.2)      [val](p|assets) ◦ [val](CoC|LR|Premium) [Compute]
                                  [against]  (Pricing Bounds only, below the line)
```

Evaluate's target is fixed to Premium, since that is the question the leaf asks,
so it has nothing to switch and draws as a plain label. Its anchor stays
optional, blank meaning the library's unlimited reading.

#### Behavior that must survive

The radios keep their handlers, which is what makes this the cheap half of the
change: switching the anchor rewrites the value box's `step` and `max` and its
default (`p` steps by a thousandth and is capped at 1; `assets` steps by 1,
uncapped, and focuses), and switching the target rewrites its default (`0.15`
for CoC, `0.9` for LR, and for Premium the pentagon's own if one is held). Both
fire the preview at once rather than through the typing debounce, because a
switch changes the question.

What actually moves is where the handlers live, since three copies of the form
become one component. Section 5 pins the behavior for that reason.

## 4. Phase 2: the preview line, and a deletion

### 4.1 The preview under every form

`renderPricePreview` moves into the component and runs under all three, on the
same 350 ms trailing debounce, the same 120 ms dim, and the same ticket against
out of order answers. It is one `price_pentagon` solve, documented in
`pricing.py` as the cheapest question in the group, against Compute's fifty
resamples.

Two things it buys on Bounds specifically. The pane says nothing at all today
until a press, and the press is real work. And **the refusals move in front of
the button**: `Bounds` rejects a premium below the expected loss or above the
cap, and the preview shows `M` or `Q` going non positive before the reader
commits. That is the principle already established for the library's unbounded
anchor guard, that a refusal is the preview text, applied to the pane where the
wait is longest.

### 4.2 `_calibrate_for_envelope` loses its arithmetic

`bounds.py:110` currently completes the pentagon by hand:

```python
limited = obj.prob_loss_assets(a=assets)
margin = premium - float(limited.L)
capital = assets - premium
obj.calibrate_distortions(margin / capital, a=assets)
```

That is the api deciding what a price means, which is the shape of thing the
purist ruling is about, and it predates `price_pentagon` being reachable here.
It becomes one `price_pentagon(a=assets, P=premium)` and a calibrate at the
`ROE` it returns, which is the same two call chain phase 1 introduces for the
premium target, so the two share a helper.

Second order, and worth watching in review: the function's three `return False`
cases (no asset cap, degenerate margin, degenerate capital) become largely
unreachable once a real calibration is carried in, because an implied `(P, a)`
has `M > 0` and `Q > 0` by construction. Panel 2 will draw where it silently
vanished before. The cases stay, because a hand typed premium can still hit
them.

## 5. Tests

* `_one_target` accepts exactly one of three, and refuses zero or two.
* A premium target and the CoC it implies produce the same calibration, family
  for family and parameter for parameter. This is the round trip, pinned.
* The preview octet answers identically whether the caller stated `coc`, `lr`
  or `premium`, given the same anchor.
* `_calibrate_for_envelope` before and after phase 2 produce the same
  distortions on a case that currently succeeds, and the pentagon route is
  exercised on a case that currently returns `False`.
* `reins_bases_for` returns `[]` with no cession, `['net']` for a reinsured
  `Portfolio`, and the full live set for a reinsured `Aggregate` (6.2). The
  portfolio case is the regression test for the mismatched-tables bug and
  should cite it in its docstring, so it is not "simplified" back later.
* A reinsured `Aggregate` priced on `gross` does not seed the Bounds form, the
  line says why, and the boxes still accept a typed premium and compute (6.3).
* Switching the anchor rewrites `step`, `max` and the default on the value box,
  and switching the target rewrites its default; both fire the preview
  immediately rather than through the debounce (3.6). The radios and their
  handlers survive intact, so the risk is in the move to a single component
  rather than in the widget.
* The basis is sticky in `localStorage` across objects and falls back to a live
  member when the stored one is not offered. That logic exists in
  `renderPriceBasis` today and has to survive the move into the component.
* SPA: `check-nav.mjs` is untouched by this, but the three form hosts need a
  smoke test that each mounts and reads back what was written.

## 6. The calibration basis

Updated 2026-08-14 with the author's ruling and with what was measured against
it. The ruling: reinsurance is placed at the **unit** level, so a book has no
cession of its own to choose and takes whatever its units produce. The basis
row therefore greys for a `Portfolio` in both the Pricing and the Bounds forms,
and reinsurance is an `Aggregate` question.

That ruling stands, and it takes the expensive upstream ask off the table. Two
things measured while checking it need recording, because one of them
contradicts the premise the ruling was stated on.

### 6.1 The three classes, after the ruling

| Class | Leaf | Needs a view? |
|---|---|---|
| `Bounds` | Bounds | **Yes**, for a reinsured `Aggregate` |
| `PricingBounds` | Pricing Bounds | **Yes**, for a reinsured `Aggregate` |
| `AllocationBounds` | Allocation Bounds | **No**: `Portfolio` only, and the row greys there |

`AllocationBounds` was the expensive one: it needs `density_df` with `exeqa_*`
and `exi_xgta_*`, which are per-unit conditional expectations on the book's own
basis, so a gross-view natural allocation would need allocation machinery the
library does not build. Greying the row for a `Portfolio` disposes of it
entirely rather than deferring it.

The other two need only the **total distribution** of the named view, which
both classes already resolve internally through `_reins_view_density(view)`
(`_pricing.py:648`), the private hook behind the `reins_view=` keyword on
`calibrate_distortions`, `evaluate` and `price_pentagon`. So the ask is to wire
an existing mechanism to two more front doors.

The api cannot do it itself. `_reins_view_density` is private, and the
oversight charter names a new private-name import in the API as a finding whose
sanctioned path is an upstream ask. Passing a `Series` instead (both classes
accept one) means the app selecting a column out of `reins_density_df`, which
is exactly the `_BasisView` duck type deleted at a85 as "this repo deciding
what a price means". Reinstating it for a different caller is the same mistake
under a new name.

**Round 7 ask: `reins_view=` on `Bounds` and `PricingBounds`.** Same shape as
asks already answered (a256 reins orientation, a254 `bs_window`). On
`PricingBounds`, note that the `against` risks are separate objects with their
own bases and a view named for the reference X should not silently reach them.

A second, smaller ask for the same note: `calibrate_distortions(P=...)`, so the
premium target is one call rather than two chained. Not a blocker.

### 6.2 A Portfolio locks into net, and why (author, 2026-08-14)

**Decision: a reinsured `Portfolio` is locked to `net`.** `gross` greys out
beside `net occ`, which is already grey there, so the row is drawn with one
live member. A book with no cession keeps today's behavior, the whole row grey.
A reader who wants a gross calibration takes the reinsurance out of the
program, which is the honest way to ask for it.

This applies to **both** the Pricing and the Bounds forms, so the shared
component has one rule rather than two, and it disposes of the
`AllocationBounds` question with it.

The evidence below is what turned this from a tidy-up into a correction. It was
gathered because the author's reaction to the measurement in 6.2.1 was that a
book-level gross calibration cannot be right, since going back to gross is a
great many convolutions. It is worse than that: the calibration is real, and
the allocation beside it is not.

#### The allocation ignores `reins_view` entirely

Measured 2026-08-14 on `port ReinsBook`, one ceding unit and one not:

```
book expected losses:  gross 2000.0118   ceded 47.9737   net 1952.0382

reins_view='gross':  a = 2693.50   E[min(X,a)] gross = 1998.71   net = 1951.48
  pricing_df L total = 1950.827227    UnitA 951.470961   UnitB 999.356266

reins_view='net':    a = 2599.50   E[min(X,a)] gross = 1997.36   net = 1950.83
  pricing_df L total = 1950.827227    UnitA 951.470961   UnitB 999.356266
```

The calibration half is genuine: the anchor resolves on the gross distribution
to a different asset level, and the fitted distortion parameters differ. The
allocation half is identical to the net one to the last digit on every unit,
and its total matches the net book at the **net** asset level, 2599.50, not at
the gross 2693.50 the calibration was struck at. `CalibrationResult.pricing_df`
allocates `density_df`, which is the net book, and the keyword never reaches
it.

So today, a reinsured portfolio calibrated on Gross shows a gross calibration
on the Calibrate leaf and a net allocation on the Allocate leaf, from one press,
labeled as one calculation. That is live now and predates this plan.

**Round 7 ask, and the sharpest one in the note:** `pricing_df` on a
`CalibrationResult` should refuse a non-net `reins_view` for a `Portfolio`,
matching the `NotImplementedError` that `analyze_distortions` already raises
for exactly this reason (LIB a223 changelog). Silently returning the net
allocation is the failure mode the two-tier stability policy exists to catch
early, and the api is its first consumer.

Locking the app to net closes the reader-visible half immediately and does not
depend on the ask landing.

#### 6.2.1 The measurement that started it

The ruling was stated as matching what the app already does. It does not, and
on the Pricing side it would be a **removal of working behavior**, so it needs
a second look before it is executed.

Measured 2026-08-14 against a reinsured book, `port ReinsBook` with one ceding
unit and one not, through the api's own runners:

```
reins_views     : ['gross', 'ceded', 'net']
reins_bases_for : ['gross', 'net']
preview   basis='gross' -> ok      calibrate basis='gross' -> ok
preview   basis='net'   -> ok      calibrate basis='net'   -> ok
pricing.calibrate   gross and net payloads differ
pricing.allocate    gross and net payloads differ
```

So a reinsured `Portfolio` is offered Gross and Net today, both are live, both
work, and they give genuinely different answers (LR 0.9566 against 0.9584, PQ
3.458 against 3.609). `Portfolio.reins_views` has returned `['gross', 'ceded',
'net']` since LIB a223.

Two consequences.

**The comment in `priceFormBody` (`main.js:2508`) is stale.** It says "a
portfolio calibrates on its output basis and the library refuses a `reins_view`
there, so sending one would turn a greyed control into a 400". The library does
not refuse it. The comment predates a223 and should be corrected whatever is
decided. The `NotImplementedError` the LIB a223 changelog describes belongs to
`analyze_distortions`, a different method from the one this path calls.

**The choice a portfolio offers is not the one the ruling rules out.** The
ruling is right that a book has no cession of its own to place: the units
decide, and there is nothing to choose. But the basis row is not asking which
cession to place. It is asking which of two resulting distributions to
calibrate on, the pre-cession convolution or the post-cession one, and both
exist for a reinsured book. "What would I have charged for this book gross" is
a question a reader can reasonably ask.

Both points stood when this was written. The allocation evidence above then
settled the question the other way from "defensible either way": the Gross
button on a reinsured book produces a mismatched pair of tables, so removing it
is a fix and not a reduction. The CHANGELOG entry says that, and cites the
measurement.

`reins_bases_for` gains the rule, so it is the one place that knows it and both
forms read it off the capability block as they do today:

```python
# A book has no cession of its own: units cede on their own stages and the
# portfolio takes what they produce. `pricing_df` allocates `density_df`
# regardless of the view asked for, so a gross calibration would arrive beside
# a net allocation. Net is the only basis a Portfolio can answer end to end.
```

### 6.3 What phase 1 does meanwhile

With 6.2 settled, the only object left that can strike a pricing the Bounds
group cannot honor is a **reinsured `Aggregate`** calibrated on `gross` or
`net occ`. A `Portfolio` is locked to net, and an unreinsured object has one
distribution.

For that one case the form **withholds the seed rather than performing it
silently**. To be explicit, since the shorthand "refuses the carry over" reads
more strongly than it is meant: the boxes are live and the reader can type any
premium and assets they like, press Compute, and get an answer. The only thing
withheld is the automatic fill, replaced by a line saying the pricing on hand
was struck on the gross view and this group answers on the object's own. Every
control keeps working.

Ship that for 1.0. It needs no upstream work and it degrades into the real
thing when `reins_view=` lands on `Bounds` and `PricingBounds`, at which point
the line goes and the seed happens.

The alternative, carrying the number across silently, puts a gross premium on a
net band with nothing on screen saying so, which is the failure this section
exists to prevent.

## 7. Deliberately not in this plan

**The `against` field keeps exactly the form it has**: a text box taking a unit
name or a DecL fragment, moved below the pricing form so the layout is
consistent, and otherwise untouched. No dropdown, no enumeration of session
objects, no `agg.MYOBJ` picker.

The reason to record, so it is not rediscovered: a storage backed picker would
be the first feature in the app that **reads** a user's stored recipes, and per
`dev/TODO.md:319` the api builds through the module singleton, so every named
declaration every visitor makes is stored under `(kind, name)` in one process
wide session store. The TODO's own words are that "nothing in the app reads a
user's stored recipe today, so the collision is currently invisible rather than
wrong". A picker would make it visible, and on `agg.mynl.com` that means
offering one reader a menu of another reader's object names. It is a real
recipes use case and it is gated on "one Underwriter per session", which is an
open backlog item. Pended by the author, 2026-08-14.

Enumerating a portfolio's own units would be safe, since they belong to the
object in hand, but unit names do not ride on the build response today and it
is not worth a capability field on its own. It goes with the picker.

## 8. Forward compatibility: technical premium and booked premium

Recorded because the author raised it while this was being drafted, and because
it constrains one naming decision here rather than any behavior.

The app currently holds two premium worlds that do not meet.

* **Pricing and Bounds are technical premium.** The pentagon is `L`, `M`, `P`,
  `Q`, `a` with no expense in it. Every leaf in both groups is an `Aggregate` or
  a `Portfolio`.
* **Economics is booked premium.** All three of its leaves are "a P&L only"
  (`nav.js:163`), and `PnL` is the ledger model, whose `LEG_KINDS` are
  `premium`, `loss`, `expense`, `recovery`, `commission`. Expenses are a recent
  addition to the model and, as the author puts it, a demo needs them.

The bridge already exists and the library owns it. Per the a97 CHANGELOG entry,
`pnl_program` writes `derive premium` whenever the engine states one: the
technical premium `T` grossed up for the expense clause the program carries,

```
P = (T + fixed) / (1 - premium ratios)
```

so premium net of expenses returns exactly `T` and the expected underwriting
result is the risk load. That identity is the whole relationship between the
two worlds, and it is upstream where it belongs.

What is missing is that the bridge cannot be handed a calibrated premium.
`PnlProgramRequest` carries `loss_ratio` and `expense_ratio` and no premium, and
`pnl_program` uses the engine's **own** stated premium as `T`. So a reader who
calibrates a technical premium on the Pricing tab cannot press PnL and see that
premium booked with expenses. That is the same seeding idea in this plan, one
hop further along, and it is the natural next plan after this one.

The one constraint this places on the work here: **name the held state for what
it is**. `_pricing.octet.premium` is a technical premium. Do not let a field
called `premium` float around the app meaning either, because the moment
Economics joins the flow there are two of them and they differ by a quarter.

The author's reading of the shape, which this plan is built to leave room for:
Overview, then Reinsurance, then Pricing, and then a fork. Economics and Bounds
answer different questions and there is probably no loop between them. The loop
that does exist is Economics back to Pricing.

---

## 9. Execution notes (2026-08-14)

Both phases landed as written. Five divergences and findings, in the order they
matter.

**9.1 The hand pentagon in `bounds.py` was wrong, not just misplaced.** Phase 2
expected a straight substitution: the same answer, computed upstream instead of
here. The test written to pin that (section 5, "before and after produce the
same distortions") **failed**, and it was right to. `prob_loss_assets` snaps the
asset level to the loss grid and reports `L` there, while `Q = a - premium` used
the caller's raw request, so the margin and the capital were struck at two
different asset levels. The cost of capital they implied belonged to no
consistent pentagon. Measured: a request for 15625.068 snaps to 15624.0 at
`bs` 4, giving 0.13334437 against 0.13335957 now, about 1.1e-4 relative and
scaling with the distance from a grid point.

So panel 2 of the envelope has been calibrated slightly off its own band since
the function was written. The test now asserts the corrected identity and that
the old reading is genuinely different rather than a rounding of the same, so
nobody "fixes" it back.

**9.2 The premium round trip is approximate, not exact.** A premium target
resolves to a cost of capital and back, which costs one or two ULPs (`0.15`
against `0.14999999999999997`) and every fitted parameter inherits it at about
1e-15. The tests use `pytest.approx`. The served envelopes therefore have
different `doc_hash` values for the two spellings of the same calibration, which
is correct: different request, different bytes.

**9.3 The author's basis ruling was stated on a premise that did not hold.** It
was given as matching current behavior. It did not: a reinsured `Portfolio` was
offered live Gross and Net buttons, both worked, and they answered differently.
Checking why turned up the mismatched-tables bug in 6.2, which changed the
ruling from a tidy-up into a fix. The lesson for next time is the one the
oversight loop already states: never assert repo state from memory, including
about behavior. The measurement took two minutes and changed the character of
the change.

**9.4 `errorMessage` moved to `api.js`.** Not in the plan. The form prints a
library refusal as a sentence where `errorNode` mounts a node, so two callers
needed it, and it belongs beside the `ApiError` it reads rather than private to
`main.js`.

**9.5 The component grew three options the plan did not name**, all forced by
Evaluate: `allowBlank` (an empty box is "unstated" rather than "incomplete",
which is how a blank premium means the object's own and a blank anchor means
the library's unlimited reading), `gloss` (the muted note after the button), and
`setFieldsVisible` (a P&L carries a premium and an asset level on every ledger
row, so both pairs go). The plan's `{read, write, setBusy}` return became
`{read, write, setBusy, sync, note, setFieldsVisible, held, button}`; `note` is
what prints 6.3's withheld-seed sentence.

**Not done, carried forward.** The round 7 note is still to be written. It now
carries three asks rather than two: `reins_view=` on `Bounds` and
`PricingBounds`, `calibrate_distortions(P=...)`, and the sharpest one,
`CalibrationResult.pricing_df` refusing a non-net `reins_view` for a
`Portfolio` instead of silently allocating the net book (6.2).
