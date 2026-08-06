# plan-loss-lab-navigation: the aggregate Loss Lab navigation

Status: **executed**, all seven stages, at `1.0.0a42` through `1.0.0a46`. What
each stage found on the way is recorded under it. Two things this plan named and
did not do, both deliberately out of its scope: the header's Perspective control
(the exhibit fetches take insurer, which is the plan's default), and the chart IR
conversions, which land upstream chart by chart.

The library work this waited on has landed:
`aggregate` a213 `[Derived-Programs]` supplies `sharpen_program`, `pnl_program`
and `reins_program`, and a215 `[Sharpen-Pin]` fixes what first use of them
found. One version bump per stage, starting at the next free number. The stage
numbers below are an order, not a version map.

One piece is still in flight rather than landed, and only Stage 4 touches it:
the grammar's inline portfolio engine (`agg_source_inline_port`), which is what
makes `Portfolio.pnl_program` self-contained. See "The library dependency".

The app is renamed and its navigation is rebuilt around what an object can
actually answer. Six groups replace the current six tabs, each group carries its
own sub-tab row, every leaf greys out from a capability payload the library
computes rather than from a hard-coded table in JavaScript, and three buttons
next to Build derive a new DecL program server side instead of mutating an
object in place.

## Why

Three separate irritations, one answer.

The Overview crams a chart and two tables into one pane and reads as clutter,
the standalone Plot tab duplicates part of it, and the log2 and bs dropdowns
have never been used. That is chrome nobody wants sitting where the reading
happens.

The tab set is authored twice: once as markup in `web/index.html`, and again as
`NA_MORE_BY_KIND` and `NA_TABS_BY_KIND` in `web/src/main.js:370` and
`main.js:436`, which say what each kind cannot answer. The library now knows the
same thing properly, through `available_exhibits(obj)`
(`aggregate/exhibits/_core.py:306`) and `available_charts(obj)`
(`aggregate/charts/__init__.py:69`), and `dev/exhibits-and-charts.md` states the
invariant: capability is derived, never declared twice. The app is the one place
still declaring it twice.

Reinsurance, wrapping in a P&L, and moving to a better grid are all things a
user wants to do to an object they have already built. Each one is a DecL
question, so each one belongs to whatever holds the grammar, which is the
library. None of them belongs in JavaScript, and none of them should mutate an
object under a cached id.

## The shape

| group | applies to | sub-tabs |
|---|---|---|
| Overview | everything | Plot, Summary, Tail |
| Economics | PnL | Ledger, Ratios, Waterfall |
| Reinsurance | an aggregate carrying a cession, plus the entry box for one that does not | Summary, Stats, Density, Plot |
| Pricing | Determine: aggregate, portfolio. Evaluate: those plus PnL | Determine, Evaluate |
| Bounds | aggregate, portfolio | Bounds, PricingBounds, AllocationBounds |
| More | everything | Validation, Stats, Density, Window, Dependency, Narrative |

Action row, next to Build: Examples, Sharpen, PnL, Reset.

Page-wide preferences, in the header menu: Perspective (Insurer default, Raw),
Tables (Static, Interactive), then the existing Help, downloads and About.

Retired: the standalone Plot tab, the log2 dropdown, the bs dropdown, and the
`More` view named "Info (raw)", which is absorbed into Narrative.

## Principles this plan holds to

**The nav skeleton is editorial, the leaves are derived.** Which groups exist,
what they are called and what order they sit in is a judgment about how
insurance work proceeds, and the app authors it. Whether a given leaf is live
for the object in front of you is a fact, and the library computes it. A new
library exhibit therefore appears in the app with no JavaScript edit, which is
the whole point of the exhibit registry.

**Nothing is hidden, everything greys.** The existing house rule, extended to
the sub-tab rows. The menu set never changes shape, so what an object cannot
answer is visible and plainly unavailable rather than absent.

**Every derivation is a program you can see.** Sharpen, PnL and Reinsurance all
return DecL text that lands in the editor. You read what was built, you can edit
it, and history, sharing and rebuild all keep working. No hidden state and no
object mutated behind a cached id.

## Stage 1: [Loss-Lab-Rename] (landed, 1.0.0a42)

The app becomes the **aggregate Loss Lab**. Short form **aLL** is unchanged, so
nothing downstream of the acronym moves. Lower-case `a` throughout, for the same
reason as before: `aggregate` is the package, `Aggregate` is the class.

Touches `web/index.html` (title, meta description, the `.brand-title` line, the
logo `alt`), `site.webmanifest`, `sw.js`, the About and Help leads, `README.md`,
the `pyproject.toml` description, and any occurrence in `CLAUDE.md`. Prose only,
no behavior change. This is the same footprint `plan-all-branding` covered at
a20.

## The library dependency

The three derivations behind Sharpen, PnL and Reinsurance are grammar questions,
so they are answered in the library, not here. Specified in
`dev/done/plan-derived-programs.md` in the `aggregate` checkout, executed at
a213 with a second half at a215. This repo consumes them through three routes
and holds no knowledge of DecL structure in JavaScript.

What shipped, in the shape the app has to consume:

**`sharpen_program`** is a property on `Aggregate` and `Portfolio`, empty until
`sharpen()` has run. a215 is the part that matters here: `sharpen()` moves the
object **in place** and rewrites `program`, `note` and `hints` together, so
`build(obj.program)` reproduces the sharpened object and the three records
cannot disagree. `sharpen_program` is that pinned program rendered to read. A
moved grid carries `hints{log2=...; bs=...}`; a confirmed one carries
`note{sharpen: ...}` and deliberately no hints.

The sharpen verdict is **namespaced and replaced**, not appended: the sentence
begins `sharpen: ` and a second probe overwrites the first rather than stacking.
So `can_sharpen` tests that prefix, never the mere presence of a note, or an
author's own `note{}` would disable the button.

There are three outcomes, not two. The third is a probe under `execute=False`
that finds a better cell and does not take it, recording a recommendation and no
hints. The app always executes, so it sees two, and the flag can ignore the
third.

**`pnl_program(loss_ratio=0.70, expense_ratio=0.25)`** is a method on both
classes. Premium is `inherit premium` when the exposure states one and otherwise
expected loss over `loss_ratio`; `expense_ratio=0` omits the expense clause
rather than writing a zero.

**`reins_program(cession)`** is a method on `Aggregate`. It takes a string or an
iterable of them, **one clause per tier**, each opening with `occurrence` or
`aggregate`, because composing two tiers otherwise means a build round trip
between the calls. A clause is authoritative for its own tier and leaves the
other alone. It rejects `approximate` combined with an occurrence cession,
because the parser does, rather than returning text that will not build.

Two decisions from that plan matter to the app and are recorded here so they are
not rediscovered. The derived text is **self-contained**, carrying its engine
inline rather than an `agg.NAME` reference, so the text builds anywhere and not
only in the session that wrote it. And derived object names are `NAME_PnL` and
`NAME_net`, with no dots, since a dotted name reads as a builtin lookup
everywhere else in DecL.

**The one piece still in flight.** a213 found that the grammar had no inline
portfolio engine, so `Portfolio.pnl_program` had to reference (`less port.NAME`)
where the aggregate form inlines, which makes the text portable only within the
session that holds the name. The author is fixing that in the grammar rather
than accepting it: `agg_source_inline_port` admits `port PNAME <units>` as an
engine, and `Portfolio.pnl_program` emits it. Uncommitted at a215. Stage 4's PnL
button is greyed for portfolios until it lands, and lights with no app change
once it does.

**A derived program is built; a sharpened object is moved.** PnL and
Reinsurance mutate nothing: they derive text and take the ordinary build path
with it. Sharpen is the exception, and it needs a rule, because `sharpen()`
moves its object in place while the cache is keyed on a hash of
`(decl, log2, bs)` (`cache.py:80`, `routes/objects.py:479`). Left alone, the
cache would serve, under a key asserting one grid, an object sitting on another,
whose own `program` no longer matches its key.

The rule is that **the cache entry moves with the object**, and nothing is
rebuilt. Sharpen the cached object in place, which is what makes it affordable,
then re-file: drop the old id and insert the same object under the id its
`sharpen_program` hashes to, with the entry's `decl`, `log2` and `bs` fields
updated to match. No second build, no copy of a live object, and the probe is
paid exactly once.

Two details from the build route make the derived id exact rather than
approximate. The id hashes the **requested** knobs, so 0 and 0.0 when the
request omits them, and the hint-aware `effective_log2` is used only for the cap
check (`routes/objects.py:439-479`). And the program is whitespace-collapsed
before it is canonicalized and hashed (`routes/objects.py:455`), which matters
because the library renders derived text in the multi-line spread layout. So the
derived id is the id an ordinary build of that same text would produce, and
rebuilding it from the editor is a cache hit.

The old id goes away because the object it named no longer exists: sharpen
consumed it. That is the library's own semantics, where `a = a.sharpen()`
rebinds one object rather than producing a second. The SPA never notices, since
Sharpen hands it the new id. The one consequence is that Reset after a Sharpen
rebuilds the base object from its text rather than finding it in the cache,
which is the right place to pay: the common path, sharpen and carry on, pays
nothing, and only the undo pays a build.

**The api's log2 cap has to reach the probe.** `sharpen()` defaults to
`log2_cap=20` and `AGGAPI_LOG2_CAP` defaults to 18, so a probe left on its own
default could land on a grid the build route would then refuse to rebuild, which
is a derived program the app cannot honor. The call passes
`log2_cap=settings.log2_cap`.

## Stage 2: [Capability-Payload] (landed, 1.0.0a43)

The build response grows a capability block, and the two JavaScript tables die.

The block carries the exhibits this object can serve with their perspectives,
straight off `available_exhibits`, the charts it can serve off
`available_charts`, and the flags the app-only leaves need: `has_premium`,
`can_sharpen`, `can_price`. Inline on the build response rather than a second
request, because the nav has to paint immediately and a round trip per build to
learn the menu is a round trip too many.

**Two corrections found in execution.** `can_price` was missing from the draft's
flag list, which named Pricing as an app leaf and then gave it nothing to read.
It is derived like `can_sharpen`, off the object's own `price_pentagon`, which
is the same test the pricing path makes before it raises, so no kind list
survives anywhere. And `kind` and `has_reins` are not repeated inside the block:
both already ride on the build response, and one field per fact is the point.

`/objects/{oid}/exhibits` already exists and already reports exactly this for
exhibits (`routes/objects.py:1603`), so this is that payload lifted into the
build response, not a new computation. The exhibit route itself already takes
`perspective` and ETags on the exhibit hash, so perspective-correct caching
needs nothing.

**The flags earn their place or they do not ship.** A flag that restates
something already in the exhibit or chart list is capability declared twice,
which is the thing this stage exists to end. `has_reins` stays because it has a
consumer that is not an exhibit: the Price gross / net basis selector
(`models.py:93`). `has_premium` stays because it decides whether the PnL button
offers a loss-ratio input at all. `can_sharpen` stays because it is a fact about
a method, not a document, and it reads the namespaced note prefix described
above. `is_tower` is **dropped** from the draft's list: `economic_waterfall` is
registered against `_perspectives_tower`, which reads `PnL._tower`
(`aggregate/_pnl.py:884`), so a single-group PnL already omits the exhibit from
`available_exhibits` and the app needs to know nothing more.

Three kinds of leaf come out of this, and the distinction is worth writing down
because it decides where a future leaf goes. An **exhibit leaf** lights from
`available_exhibits` and needs no app change to appear. A **chart leaf** lights
from `available_charts`. An **app leaf** (Narrative, the reinsurance entry box,
the Bounds forms, Pricing's two modes) is gated on the flags, because it is a
piece of app behavior rather than a library document.

**Leaves are named in the registry's vocabulary**, not the frame's, since that
is the whole point of lighting them from the capability list. The names are
`summary`, `tail`, `tail_behavior`, `validation`, `stats`, `bs_window`, `reins`,
`dependency`, `economic`, `economic_ratios`, `economic_waterfall`
(`aggregate/exhibits/__init__.py:77-91`, `_core.py:646`). Where a leaf below is
introduced by its display name, the registry name follows it in parentheses.

Deletes `NA_TABS_BY_KIND` and `NA_MORE_BY_KIND`.

**What the derivation caught, which is the argument for doing it.** The hand
table said a `BivariateAggregate` had no grid-sizing pane. The object serves one
perfectly well; what was broken was this repo's frame route, which read only the
private `_bs_window_df` that a bivariate does not carry, and the table had been
written to match the 400 rather than the object. Both routes now read private
first and public second, so the aggregate keeps the raw probe frame with its `W`
and `coverage` diagnostics and the bivariate gets the display view it has. A
leaf lit by the capability list has to be a leaf that serves, which is why
Stage 2's tests walk every listed exhibit and chart and fetch it.

## Stage 3: [Navigation-Groups] (landed, 1.0.0a44)

The six groups, their sub-tab rows, and the phone behavior.

**Pricing's two leaves, settled by the author.** Determine sets `p` or `a` and a
cost of capital and determines a premium. Evaluate goes the other way: the
premium is already in the object, and `evaluate()` returns the distortions that
value the margin flow at zero. Three shapes, one method: the distortions alone
for an aggregate or a portfolio, the total net margin for a P&L, and an expanded
set for a tower, which evaluates every margin row of its ledger. A portfolio or
aggregate carrying no premium must be given one.

That needed api surface this plan had not accounted for: a `POST /evaluate`
route, the `a` anchor on `PriceRequest`, and two more capability flags.
`can_evaluate` is not a synonym for `can_price`, since evaluation reaches a P&L
and pricing does not. `needs_premium` decides whether the form shows a premium
input, and is derived rather than a kind test: a P&L has no `exp_premium`
attribute at all, so the flag reads "the sort of object that carries its own
consideration, and does not carry one".

**The rules moved out of `main.js`.** `web/src/nav.js` holds the group and leaf
table plus four pure functions over a capability payload, and `main.js` supplies
the loaders. That split is what lets `dev/scripts/check-nav.mjs` run the real
rules against real payloads with no browser and no port, which is the Stage 3
answer to the risk this plan records: a wrong gate greys a leaf that works, and
nothing on screen tells the user which kind of dark it is.

**Layout.** The group row is a horizontally scrollable pill strip with a soft
fade at each edge so it reads as scrollable, not clipped. The sub-tab row
beneath it scrolls the same way. No Bootstrap navbar collapse, deliberately:
collapsing the nav would put a second hamburger in a header that already has
one, and a dropdown hides which group you are in and adds a tap to every move.
One tap to any group at any width is worth a small horizontal scroll on a narrow
phone.

**Overview** splits the current landing pane into three. Plot is the two-panel
ECharts exhibit lifted out of that pane, Summary is `summary`, Tail is `tail`
and `tail_behavior` as two blocks in one pane.

The standalone Plot tab goes, and with it the matplotlib SVG leaves the
navigation. The `/plot` route stays on the server, because the SVG is worth
having as a download and costs nothing to keep, but nothing in the nav points at
it. Overview's Plot swaps to a ChartDoc route per kind as each emitter lands
upstream; today `available_charts` returns nothing for an aggregate or a
portfolio, so the existing app-side path draws it, which is exactly what "Not in
scope" below describes.

**Economics** is PnL only: Ledger is `economic`, Ratios is `economic_ratios`,
Waterfall is `economic_waterfall` and lights only for a tower, which the
capability list already decides.

**Reinsurance** is Summary and Stats (`reins`), Density, and Plot. Plot is a
**chart leaf**, not a placeholder: `chart_reins` landed upstream at a210 with
`predicate=_has_cession` (`aggregate/charts/_emit_reins.py:170`), this repo
already serves `/objects/{oid}/chart/{name}` (`routes/objects.py:1557`), and the
chartdoc-to-echarts adapter landed at a38. It is the nav's first real consumer
of `available_charts`, which makes it the proof that Stage 2 works.

**More** is Validation (`validation`), Stats (`stats`), Density, Window
(`bs_window`), Dependency (`dependency`, bivariate only), Narrative.

**Landing and stickiness.** The active group survives a rebuild unless it just
went dark, which is today's rule and stays. Each group remembers its own last
sub-tab, so stepping away from Pricing and back returns you where you were
rather than to its first leaf.

**The log2 and bs dropdowns stay for now.** They are removed in Stage 4, with
the Sharpen button that replaces them, so no version ships with neither. See the
note under Stage 4.

## Stage 4: [Action-Row] (landed, 1.0.0a45)

Build, Examples, Sharpen, PnL, Reset.

**Two corrections found in execution.** `can_pnl` was missing from the flag
list, the same omission `can_price` was: the button is app behavior with no
exhibit behind it, so something has to gate it. And the plan said PnL is
"greyed for a portfolio until the inline portfolio engine lands upstream",
which it no longer is: `aggregate` a216 `[Inline-Port-Engine]` landed before
this stage ran, so the button lights for both kinds and the text is
self-contained either way.

The other thing execution turned up is that the id equality this stage depends
on needs the whitespace collapse to be **shared** rather than reproduced. The
library renders derived programs in its multi-line spread layout and the build
route collapses before hashing, so a derivation computing its own id any other
way would file the object where a rebuild of the same text could never find it.
`collapse_program` is now one helper with that reasoning written on it.

**Sharpen** is one request. The server sharpens the cached object in place,
re-files it under the id its own `sharpen_program` hashes to, and returns both
the text and that id, per the rule recorded above. Nothing is rebuilt and
nothing is copied. The app swaps the current object and refreshes the editor.
Greyed for anything that is
not an aggregate or a portfolio, and greyed again once the current program
carries a `sharpen: ` note, since a second audit of a confirmed grid is a slow
no-op. It is the slowest button on the page, so it disables itself and shows a
spinner while it runs.

**PnL** is the same mechanism against `pnl_program`, and lands you on Economics.
Greyed for a portfolio until the inline portfolio engine lands upstream, since
until then the derived text is not portable and the pane would be handing out
something that only builds here. Nothing else changes when it lands: the flag
flips and the button lights.

**Reset** restores the last hand-built program and its object, and greys out when
nothing has been derived. One control for all three derivations rather than one
per pane: at any moment you are either on your own program or exactly one
derivation away from it, and Reset is the way back. It is distinct from history
on Ctrl+Up and Ctrl+Down, which steps through programs you built yourself.

State this needs is small: the base program text and the base object id, set
when a build comes from the editor and cleared by Reset.

**The log2 and bs dropdowns come out here**, not in Stage 3, because Sharpen is
what replaces them and the two should not be a version apart. The only remaining
way to pin a grid from the UI is a `hints{}` clause in the program, which
Sharpen now writes for you, so this is a knob replaced by an audit rather than a
capability lost.

Tests this stage wants, because they are the ones a naive implementation gets
wrong: the derived id equals the id a plain build of the derived text produces,
so rebuilding from the editor is a cache hit and not a second build; the old id
is gone rather than still serving the moved object; a sharpen that wants to
cross `AGGAPI_LOG2_CAP` is held at the cap by the probe rather than by a 422 on
the rebuild; and a second Sharpen on a confirmed grid is refused by the flag
rather than run and discarded.

## Stage 5: [Reinsurance-Entry] (landed, 1.0.0a46)

Below the sub-tab row, a text box for the cession and **one** button. It derives
the program, fills the editor and builds, all in one step, because the editor is
the preview and a separate copy button would be a second control for a thing
already on screen.

The box takes one clause per tier, since `reins_program` does: a line opening
`occurrence` or `aggregate`, or one of each. A clause the parser refuses, and
the `approximate` plus occurrence combination the library rejects up front,
both come back as a 422 the error pane already knows how to render.

The derived object is `NAME_net`. Reset from the action row takes you back to
the gross object, which is why the reinsurance pane needs no reset of its own.

**Found in execution.** The group has to stay live for an aggregate with **no**
cession, which is the object the box exists for, and every leaf in it is dark
until there is a program to describe. So `can_reins` gates the box, and
`NAV_GROUPS` grew an `alsoLive` field rather than `groupAvailable`
special-casing this one group by name.

## Stage 6: [Bounds] (landed, 1.0.0a46)

The tab stops being greyed out and grows three sub-tabs against the three real
classes in `bounds.py`: `Bounds` (line 149), `PricingBounds` (line 1440) and
`AllocationBounds` (line 1023).

Bounds draws the envelope figure at 50 resamples. That is cheap, contrary to a
worry raised and withdrawn during design: `plot_bounds_envelope(n_resamples=...)`
overplots that many columns drawn from an already computed `cloud_df` at alpha
0.05, and `cloud_df` is a vectorized gather over `tvar_hinges`. The cost is
constructing the `Bounds` object, and that is paid once whether you overplot
fifty curves or none.

PricingBounds carries a text box taking either a unit from the current portfolio
or a DecL fragment for a new line, and plots the resulting ranges.
AllocationBounds is portfolio only.

If Bounds construction does prove slow on the VPS, the lever is a server-side
time budget surfaced on the existing timing line, not a guess about the client's
connection: what varies is server CPU, and the payload is one figure either way.

**Measured, so the lever is not needed.** Constructing a `Bounds` is 0.01 s,
`cloud_df` 0.12 s, and the fifty-resample figure 0.5 to 0.9 s. The worry is
formally closed by `test_the_envelope_is_not_expensive`, which times the figure
with and without the resamples and asserts the second is not a different kind of
request.

## Stage 7: [Narrative-Pane] (landed, 1.0.0a46)

One pane collecting every text field the object carries: the `info` block first,
then each available `*_description` and `*_explanation` under its own heading.
Absorbs today's "Info (raw)" view, which stops existing separately.

Found by **suffix** rather than from a list, so a narrative the library adds
upstream appears with no change on either side, which is the contract the
exhibit and chart routes already keep.

**One judgment taken in execution.** "Sharpen: not run." and "No reinsurance"
stay. The library writes an informative line where a narrative has nothing to
report, and that reads better than silence: a missing Sharpen heading looks like
an app that forgot it, where the line reads as an audit you have not asked for
yet. Genuinely empty strings are dropped, and nothing matches on the text, which
would rot the moment a sentence was rephrased.

## Decisions taken during design, with the reasoning

**Overview's Plot is the ECharts exhibit, and the matplotlib SVG leaves the
nav.** Settled by the author. The draft said both things a sentence apart, once
as "splits the current landing pane into three" and once as "keeps serving the
per-kind SVG", which are two different pictures. The exhibit is the one a21
through a37 built and the one the ChartDoc conversions are aimed at, so it is
the one that stays.

**The flags carry only what the capability lists cannot say.** Recorded under
Stage 2, and the reason `is_tower` was dropped. A flag is the exception, so each
one names its non-exhibit consumer or it does not ship.

**Perspective lives in the header menu, and both table views honor it.** A
concern that the interactive grid would silently show raw frames under an
Insurer perspective was checked and is wrong: `mountTable` (`main.js:601`) takes
one document and either walks it statically or derives the grid's input from the
same bytes through `irToGridInput`, so the two views cannot disagree about a
number. Two residues, both correct as they stand and neither needing work.
`irToGridInput` drops hierarchy, row flags and foot rows because none of them
survives a sort, so an Insurer framing that speaks through row flags reads
flatter in the grid than on the page. And the bulk frames, the densities, never
go near a document, so they carry no perspective, which is right because they
are raw grids.

**Severities stay buildable.** A plain or discrete severity builds; a mixture
already fails with `CannotBuild` and an actionable message telling you to wrap it
in an aggregate. The gate exists, so nothing is needed. One nit for whoever next
touches the error surface: a logger warning fires ahead of it reading "Mixed
severity cannot be created, returning spec. You had [0.5, 0.5], expected 1",
which is confusing for weights that do sum to one.

**Dependency goes in More, not Overview.** It is a bivariate's own question
rather than part of the standard reading, so it sits with the other specialist
frames.

**`tail_behavior` joins `tail` under Overview, Tail.** Both answer the same
question and neither is large enough to want a pane of its own.

**Spelled out: Reinsurance, Pricing.** Pricing rather than Price because the
group covers determining a price and evaluating one already set. Reinsurance
rather than the internal `reins` because this is user-facing prose, not the
Python surface, where `reins_*` stays canonical.

## Not in scope

The chart IR conversions. Four emitters are registered upstream (distortion,
reins, severity, joint_surface); the two-panel family (agg, pnl, port) and the
bivariate heatmap are still queued, so `available_charts` returns nothing for an
aggregate today. Each leaf swaps to a ChartDoc route as its emitter lands, so
this navigation work does not block on the conversion queue and the queue does
not block on it.

Perspectives beyond Raw and Insurer, which are library vocabulary today and
implementations later.

**One Underwriter per session.** Surfaced by this plan's portability argument
and left to its own work. The api builds through the module singleton
(`routes/objects.py:80`) and every named declaration is stored as a `Recipe`
under `(kind, name)` with `source='session'` (`aggregate/underwriter.py:1399`),
so a shared server accumulates every user's declarations in one store and two
users building different `port ABC` collide, last writer wins. That is true at
a41, before any of this lands, and none of the three derivations makes it worse
now that all three emit self-contained text. Tracked in `dev/TODO.md`.

## Risks

The capability payload has to be right before the nav is rebuilt on top of it,
because a wrong flag greys a leaf that should work and there is no way for the
user to tell that from a leaf that genuinely does not apply. Stage 2 wants its
own tests against one object of each kind before Stage 3 starts.

Sharpen is the one derivation that moves its object, so the re-filing rule above
is the piece most likely to be implemented the easy wrong way, in either
direction: leaving the moved object under its old id, or paying a rebuild to
avoid having to think about it. Its tests are named in Stage 4 rather than left
implied.

The inline portfolio engine is the only outstanding upstream dependency, it
gates exactly one button for exactly one kind, and the plan ships around it.

## Housekeeping

`uv sync --extra dev` before the first stage. The venv currently records
`aggregate 1.0.0a203` and `aggregate_api 1.0.0a39` against sources at a215 and
a41. Editable installs mean the code is live, which is why the three derived
program functions already import and run here, but `/v1/health`, `/v1/meta` and
the About panel report the recorded numbers and will lie until the sync.

Incidental, and free wherever it is touched: `web/index.html:173` carries
`title="pricing bounds — coming"`, an em dash in a user-visible string against
the house rule. Stage 6 deletes the attribute anyway; the point is not to copy
it forward.
