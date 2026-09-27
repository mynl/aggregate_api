# Changelog

Running release-notes draft for `aggregate_api`. Newest first. The cadence
mirrors the main `aggregate` project: every plan-based change bumps the
`1.0.0a*` version and adds a section here.

## 1.0.0a160

Phase 2 of `dev/plan-ui-round-9.md`, the second bug: the interactive table view
(the third stop on the Ctrl+Shift+U cycle) drew nothing at all on six of the
twelve exhibit blocks a portfolio publishes.

- **The cause is a format spec.** csv-grid's grammar took `f d % e s` and threw
  on anything else, and `greater_tables` writes `.Ng` for every column it
  resolves as "general". The parse runs inside the CsvGrid constructor over every
  column, so one `.5g` means no table. Overview / Validation was the reported
  case; Stats in both perspectives, and Summary and Return periods in `raw`, were
  the same bug unreported.
- **Fixed upstream**, in csv-viewer 3.10.0: `g` is now a presentation character
  and prints what Python's `%g` prints. **The `web/package.json` pin cannot move
  until that repo is pushed**, so the interactive view is still broken here until
  it does.
- **A failing table now says so.** The grid was mounted inside a `then` with
  nothing after it, so a throw from the constructor was an unhandled rejection
  and the pane stayed blank. Both views now fall back the way they always meant
  to: the interactive one to "This table could not be rendered", the static one
  to the grid.
- **`check-adapter` grew a second pass**, over every exhibit block in both
  perspectives, checking each derived format spec against the grammar it reads
  out of the installed csv-grid bundle. The old pass compares a document against
  its `FrameResponse`, which an exhibit does not have, which is why this was
  invisible to every harness in the repo.
- Noted while walking every exhibit: `bs_window` is offered by
  `available_exhibits` for an object that cannot produce one, and `build_exhibit`
  then raises inside the library rather than declining. Reported in `dev/TODO.md`.

## 1.0.0a159

Phase 1 of `dev/plan-ui-round-9.md`, the first of two bugs found kicking round
8's tires.

- **The status strip's note slot is reachable again.** a158 hid it behind the
  chevron and the chevron could not appear, so on every built object the
  library's build warnings, the sentence Sharpen / Hints / P&L write about what
  they just did, the program's `tags{}` chips and its `note{}` were all on the
  page and none of them could be opened.
- The cause was one declaration and one assignment: the base `.summary-more` rule
  ended `display: none`, and the reveal was `more.style.display = ''`, which
  clears an inline value instead of setting one and so fell straight back to that
  rule. Visibility now rides on the `hidden` attribute, which cannot fail that
  way.
- No other part of the fold moved. The count on the chevron, the order inside the
  slot, the sticky open state and the unbuilt example's open caption are all as
  a158 specified.

## 1.0.0a158

Phase 2 of `dev/plan-ui-round-8.md`, the other half of the author report: the
status strip "gets a bit busy" and gets glazed over. Four causes, all addressed.

**Line one is three clusters, not eight facts joined by seven dots.** Labels are
in the UI face and grey, values in mono and dark, and three different gaps bind a
label to its value more tightly than to the pair beside it and those pairs more
tightly than to the cluster alongside. Same information, roughly half the
apparent density. The dotted run stays on the two lines that are prose rather
than readings, the build failure and the landing prompt.

**The verdict is said only when it is not clean, and then said second.** The left
bar and the tinted ground already state it, so on a clean build the word was a
third copy of a fact nothing disputed, sitting at the far right of a line that
wraps, where its position moved with the window. On a warning or a failure it now
appears right after the name. `validationState` and its grading are unchanged.

**The clock is four characters in the corner**, `0.41s` or `cached`. "Calculated
in 0.412 seconds" was a whole line and a whole sentence for a number nobody
reads, and the timing sub-line is gone.

**The note slot folds behind the chevron, and the chevron carries the count.** It
reads `2 warnings` in amber when the library said something, `note` when the
object merely declares one, and nothing when there is nothing to show. That is
what makes a consistently folded slot safe: a warning you have to click for is a
warning you do not read. The chevron itself was dormant through a157, shown only
when line one overflowed horizontally, which a freely wrapping line can never do.

**Inside the fold, warnings lead and the declaration comes last.** What the
library says went wrong outranks what the program says about itself. This
reverses the previous order, whose argument was that the declaration reads as a
caption on the facts line directly above it. That held while the slot was always
open and adjacent to those facts; it does not survive the fold.

**A picked example still shows its note and tags with no interaction.** The fold
applies only when there is a built object. `_note.caption` is set when an entry
is chosen from the Examples menu, before anything is built, and folding it away
unconditionally would have been a real regression in that flow.

## 1.0.0a157

Phase 1 of `dev/plan-ui-round-8.md`, from an author report: the design is good
but a lot "floats about", because on the Re, Pricing and Bounds groups you meet
a leaf row, then a form, then output, with nothing saying where one ends and the
next begins. All three sit on the same `--tabpad` indent, so alignment was
already spent as a grouping cue and the spacing was not taking it up.

**Three spacing tokens, and a rhythm that says what belongs to what.**
`--gap-tight` (.3rem) holds a leaf row against the form it steers, `--gap-unit`
(1.75rem) stands a form off the output it produced, and `--gap-major` (2rem)
separates the input region from the output region at the status strip. Pricing
and Bounds ran .7rem above the form and .8rem below it, a ratio that grouped
nothing. Re already read at about 2 to 1, on `.reins-preview`'s own bottom
margin, and that margin is now a token rather than a local rule nobody
remembered was load bearing.

**One enclosure per group, the control band.** The form row, and the line that
explains it, get a ground and a hairline; the output below stays plain. It earns
the box on function: the band holds a button that changes what appears beneath
it, and the page already uses a box to mean "you provide something here", which
is the editor. Six users, one component: Quick Re, the four Pricing forms and
Bounds. Its left edge lands on `--tabpad`, where the pane's text starts.

**The line under a control is inside the band with it.** Through a156
`#qr-preview` and `#bounds-hint` were the last thing before the output, so the
sentence about the ask was loose in the no man's land between the ask and the
answer. `#bounds-hint` was also unstyled, drawing at body weight and flush left;
it now reads like the preview lines it sits beside.

**The Pricing and Bounds bands are named.** A letterspaced small caps word,
first in the row, where an anonymous row of small buttons used to sit at exactly
the point the reader is being asked to decide something. It names the question
and never the leaf: `anchor and target` on Calibrate, Allocate and Bounds,
`premium and anchor` on Evaluate, `premium and capital` on Pr Ruin. Re keeps
`Quick Re`, which is a feature name rather than a leaf name.

**Evaluate gains the preview line the other Pricing leaves have**, saying what
the premium in the box implies at the anchor beside it. It goes quiet rather
than printing the route's refusal when either box is cleared: an unstated anchor
is that leaf's deliberate request for the library's unlimited reading, and a
deliberate choice must not come back looking like a mistake.

## 1.0.0a156

**[Stale-Companion-Reading] the log switch drives the quantile curve beside
every tower, not just some of them.** Reported against `Capstone.PnL`: the
button worked on the aggregate stage and appeared to do nothing on the
occurrence one.

The coupling added at a155 was working. What was wrong is that **a panel
offering no controls was still honoring a reading stored against it.** Between
the library's a352 and this app's a155 the shipped bundle offered `log y` on
every panel of a structure document, because the loss axis had just begun
declaring the scale, and readings are held per browser. A reader who pressed
it on a Lee panel in that window was left with that panel stuck on log while
the tower beside it stayed linear, and with no control on it any more there
was nothing to clear the value. Pressing the tower's own button then looked
inert: the companion was already where the button would have put it. The other
stage, never pressed, behaved correctly, which is exactly the asymmetry
reported.

A companion panel's stored blob is now dropped rather than merged, so the
reading comes from the axis and nowhere else. No storage migration and nothing
for anyone to clear: an affected browser heals on its next load.

**The two control groups are labeled side by side, and named by the axis.** A
tower document shows one group per cession stage, identical but for which loss
axis they drive, and the strip labeled a group only when it was stacked. Wide,
they were two unlabeled pairs of buttons with nothing to tell them apart,
which is its own half of the confusion above: press one, watch the other half
of the chart, conclude the control is broken. They now read `Loss per claim`
and `Aggregate loss`, which is what the reader is choosing a scale for.

## 1.0.0a155

**[Tower-Log] the SPA draws a tower on log, and the tower's loss axis stops
lying.** Consumes `aggregate` a352 and a353. Three defects the author found on
first use of the Diagram pane were the library's and are fixed there: the loss
axis no longer starts below zero (it was padded twice, below a quantity that
cannot be negative), the gross and per-occurrence towers now reach the known
limit instead of the 99.9th percentile of the law, so a `100 xs 0` policy draws
as a closed slab to 100 rather than cropped and open at 65.6, and the loss axis
declares a log reading. Those arrive with no change here beyond the re-sync.

What this bump does is make the app draw the log reading correctly:

- **One decade floor per quantity axis**, pooled over the blocks, where it used
  to be one per panel. The gross slab, the tower carving it up and the quantile
  curve beside it name one loss axis and are one picture, so computed per panel
  the three disagreed and a slab floated a decade above the tower next to it.
  Pooled over blocks and not over everything drawn, because a Lee curve runs
  three decades under the program and a floor taken from it would squeeze the
  bands back into the slivers log is there to cure. The library hit the same
  thing at a353 and this is the port of its fix.
- **The floor is the decade strictly under the smallest value drawn.** A gross
  panel holding one slab from 0 to 100 has exactly one positive coordinate, and
  a floor *at* 100 collapsed the window to `[100, 100]` and the slab with it.
  Unchanged wherever the smallest value is not an exact power of ten, which is
  every continuous series.
- **A band running from zero starts at the floor**, rather than being sent to
  minus infinity, and one wholly under the floor draws nothing.
- **A boundary at zero is dropped from a log axis** instead of placed. An
  aggregate cover written `20 xs 0` marks its own attachment there.
- **The quantity reading belongs to the axis, not to the panel.** On a tower
  document `log y` is offered once per loss axis, on the stage tower, and acts
  on every panel naming it. Pressed on one panel alone it drew the same loss at
  two heights. The companion panels beside it, the gross slab and the Lee
  curves, now offer no readings at all, which is also the author's ruling on
  the Lee controls: the curve switches on and off with the `quantiles` button
  and needs nothing else.
- **An unlimited block gets a torn top edge** rather than merely a missing one,
  so it says "continues" instead of declining to say anything. Worth having
  only since the library's a352: before it the window cropped nearly every
  gross slab, so nearly every block was open and the tear would have meant
  nothing.

The offline chart harness learned the one place the a121 isolation rule does
not hold. A reading must not move a panel drawn against a *different* axis;
moving the panels that share one is what a tower document is for.

## 1.0.0a154

**[Structure-Lee] the chart route carries the structure chart's own two
options, and a `quantiles` button on the Diagram pane presses one of them.**
`GET /v1/objects/{id}/chart/{name}` gains `lee` and `annotate` beside the grid
charts' `window`, `detail` and `encoding`. Both are content options, which is
the only kind this route carries: what the document *says*, never how it is
drawn.

`lee` draws the quantile curve each tower is read against beside it, on the
same loss axis, so every attachment and exhaustion point reads off as a return
period. It had to be a request parameter rather than a reading: the curves are
**panels**, and the emitter does not put them in the document until it is
asked, so no amount of client-side work on the plain document could produce
them. `annotate` selects which fields label each layer, any subset of
`geometry, premium, el, lr, rol, lol, sd, pr_attach, pr_detach,
reinstatements, cede`, rendered in that order whatever order they are given,
with the empty selection a real request for bare rectangles. Unknown fields are
a 422 naming the whole vocabulary, which is the emitter's message, not a copy
of the list kept here to go stale.

In the SPA the `quantiles` button sits beside the grid window box and for the
same reason: both ask for a different document rather than reading the one on
screen. It is held per chart, like the window, so it cannot ride along on a
fetch for an emitter that does not take it, which is what darkened every 2-D
chart at a91. The control strip is rebuilt on a refetch only when the panel set
actually moved, so pressing this redraws the row of controls and typing in the
window box does not have focus torn out of it.

Two things fixed along the way, both found by replaying the new mixed document
(tower panels beside curve panels, which nothing in the fixture set had
before):

- The offline chart harness asked the wrong reading about the zoom out. A Lee
  panel beside a tower shares that tower's loss axis, which is sized exactly to
  the program and has nothing to open, while the return period paired with its
  probability axis runs from a ladder of 10^4 out to the 10^9 cap. The check
  now composes the panel's other readings, as the log check already did.
- `capture_fixtures.py` captures a second document for a chart that takes a
  content option, under a label of its own. Without it the harness only ever
  sees documents that are one panel kind throughout.

## 1.0.0a153

**[Diagram-Leaf] Diagram takes the head of the Re row.** The group now reads
Diagram | Plot | Summary | Stats | Density, and a reinsured aggregate opens on
Diagram rather than on Plot. It leads because it answers what the program *is*
before Plot answers what it does, and because the Re group's whole point is the
cession entry box below the row: the tower is the most legible confirmation
that a just-typed clause means what was intended. The a55 rule the change
displaces (a picture first, then the tables that quantify it) survives it,
since Diagram is a picture too.

**A reinsured P&L reaches the Re group for the first time.** The leaf lights
from the `structure` chart, and `chart_structure` is registered for `PnL` as
well as `Aggregate`, unlike `chart_reins` and the `reins` exhibit. So an
`xpnl` that cedes now shows the Re tab with Diagram live and the other four
leaves dark, over a cession entry box that greys itself with "a cession applies
to an aggregate". Deliberate: the program's shape is the most useful thing that
object can say there. `check-nav.mjs` asserts both halves, since a leaf gated
on `can_reins` instead of on its chart would have left the group live with
every leaf dark.

## 1.0.0a152

**[Tower-Panel] the chart adapter learns the tower, and the SPA draws charts
again.** `aggregate` a349 bumped `CHART_IR_VERSION` from 2 to 3 for the new
`ChartDoc.blocks` and the `'tower'` panel kind, and this app pinned 2 and
refused *every* document from a later version, so from a349 until this bump it
drew no charts at all. That window was declared in the library plan and is now
closed. The pin moves to 3 in `chartdoc-to-echarts.js`, in the smoke harness
and in the `ir_version` canary in `tests/test_objects.py`.

Added with it, the realization of a tower panel: a reinsurance program as a
band of labeled rectangles over a quantity axis, filled by block role (a placed
layer in the house primary with alternating shade, retention and
co-participation in grey, a gap as an absence with no fill and a dashed edge),
an unlimited layer drawn without a top edge, and the placement axis left bare
because width is share and carries no reading. A block shows as much of its
label stack as its rectangle has room for and drops the rest rather than
spilling it across a neighbour; the tooltip carries the whole stack, which is
this renderer's advantage over the static figure. A tower is read at its breaks,
so the panel's marks become the ticks of its quantity axis, as the matplotlib
renderer does; the reference-lines button takes them off.

Three changes around it, each visible on charts that have nothing to do with
towers:

- A document holding a tower lays out in **one row** split by ratio, a tower
  against a curve beside it at 1:2, the row taller than the house landscape
  cell and each strip as wide as that height allows. `panelLayout` takes an
  optional plan for this; every other document lays out exactly as before.
- The **zoom out** is offered only where an axis' full extent actually reaches
  past the window it is drawn in. Declaring `full_range` is not the same as
  having room in it, and a tower's quantity axis declares the same pair twice.
- The **realization choice** (curves / flat / 3D) is offered only where a
  *panel* declares more than one kind, instead of on the set of kinds the
  document happens to hold. A structure document with its Lee curves was
  offering to redraw itself as "tower" or "xy", which is two panels with one
  kind each and no choice anywhere.

No behavior change for any existing chart: the captured fixtures are
regenerated and every reading, window, ladder and mark count is unmoved.

## 1.0.0a151

**[Reins-Leaves-Swap] the Reinsurance Summary and Stats leaves swap
exhibits.** Summary now shows the `reins` exhibit's first block, the layering
analysis, and Stats its second, the stage summary in the eight column
validation layout. The leaf order and labels do not move; the two leaves had
been showing each other's block since a70, which is why each hint described
the other leaf's table. Paired sibling change in `aggregate`: the insurer
format sheet gains `Sk` and `Est Sk` at `.3f`, so the stage summary's skew
columns read in fixed decimals under the insurer perspective instead of
falling through to the raw `.3g` reading (that change and its regenerated
exhibit snapshots land in the library's repo, not here).

## 1.0.0a150

**[Nav-Scroll-Clamp] a navigation gesture scrolls only as far as there is
something to see.** The strip-at-top target of a147 is now clamped by the
bottom of the active pane coming into view, so a short exhibit stops
mid-viewport the moment its table is fully visible, a tall one still gets the
full strip-at-top anchor, and a bottom already on screen moves nothing. Down
only, as before. The anchor fires once the gesture's content is in place
rather than at gesture time: `anchorNavSettled` waits for the leaf's loader
plus two animation frames, skips the scroll if the reader moved meanwhile
(they took control), and anchors the error pane too. Group tabs meet their
load through a pending-gesture token recorded on the click, so a programmatic
activation still never scrolls and of two racing gestures the latest wins.
Program gestures (Build, examples, derive) keep the a147 editor anchor
untouched, and forms inside panes still never scroll. Plan retired to
`dev/done/plan-a150-nav-scroll-clamp.md`.

## 1.0.0a149

**[Color-Stretch-Heatmap-Controls] the flat panels join, and the reader gets
the dial.** A `color` control sits in the grid panel's group beside `log y`,
cycling linear, gamma and log; the choice is held per panel id, so gamma
picked on the density grid carries across documents, and switching away and
back is lossless. Flat heatmap panels default to linear, because their z is
not always a density, and take the same stretched ramp and matched contour
ladder as the relief when asked. The chartdoc reader honors an optional
per-panel `stretch` field as that panel's default (the forward hook for LIB's
matplotlib-side `[Bivariate-Color-Stretch]`, tracked in that repo). The label
shows the effective mode, so an untouched relief reads `color: gamma` and its
log-z reading `color: linear`. Plan retired to
`dev/done/plan-color-stretch.md`.

## 1.0.0a148

**[Color-Stretch-Surface] the joint surface reveals its tail: gamma color
stretch by default on the relief.** A joint density spans many decades, and a
linear ramp spends itself on the peak, so the body rendered as one dark field.
The relief's drape and floor image now default to a gamma 0.35 stretch of the
shared viridis ramp: the color lookup takes the normalized height to the power
gamma, realized as a dense 33-stop ramp precomputed in the new leaf module
`web/src/charts/color-stretch.js`, so the values, the tooltips and the
colorbar's value axis never move, only where the colors sit along the bar. The
contour ladder follows the active stretch (equally spaced in stretched space),
so the rings sit where the colors resolve structure, and the exported GLB mesh
bakes the on-screen ramp via `meshSource.ramp`, so the file matches the
picture. The log z reading keeps its linear ramp, being a stretch already, and
is pixel-unchanged. Flat heatmap panels stay linear at this version; their
control arrives with the next. Per `dev/plan-color-stretch.md`.

## 1.0.0a147

**[Scroll-Policy] one scroll per gesture, down only for navigation, and the
two-pass mechanism retires.** The policy lives in a new `web/src/scroll.js` as
two primitives. A program gesture (Build, Ctrl+Enter, Reformat, the derive
buttons, picking an example) anchors the editor box under the header, in both
directions. A navigation gesture (group tab, sub-tab, in-pane view pill)
anchors the tab strip, but only when the reader is above it: a reader who has
scrolled into content stays put, the yank the a145/a146 rule never prevented.
Forms inside panes (pricing, the ruin Draw and Sample buttons, bounds) never
scroll, and no scroll ever fires after the gesture that asked for it.

**[Scroll-Floor] the keystone: `.tab-content` keeps a viewport of height
under the strip.** Measured at a146, the two-pass wiring worked exactly as
designed and the geometry defeated it: on a desktop window the document was
often exactly viewport height, so the maximum scroll was zero and no anchor
could move the page, while a tall-to-short pane swap collapsed the document
mid-scroll and hurled the reader to the top. `min-height: calc(100vh -
var(--anchor-band))` on `.tab-content`, with `overflow-anchor: none`, keeps
both anchor targets reachable at every moment, including mid-swap, so a
single scroll at gesture time suffices. Deleted with the settle pass:
`scrollAnchor`, `scrollTabsTop`, `scrollEditorTop`, `anchorTabs`, the
`anchorEditor` wrapper, and the `_tabLoading` plumbing.

## 1.0.0a146

**[Scroll-Rule] the a145 rule now actually holds, verified in a real browser.**
Two defects, both found by driving the page headlessly and tracing every
scroll. Group tabs never anchored: Bootstrap's delegated data-api registers
with `capture: true` (its selector string lands in `addEventListener`'s third
argument), so the tab activates and `shown` fires before any button-level
click listener, and the a145 flag was read before it was set. And any scroll
racing a pane swap could be clamped mid-flight when the page momentarily
shrank below the target. Both anchors are now two-pass (`anchorTabs`,
`anchorEditor`): scroll on the gesture, scroll again when the load settles,
the second pass a no-op when the first landed. Measured after the fix: tab,
sub-tab pill, in-pane pill, and example pick all settle exactly at the anchor.

**[Landing-Basic-Book] the page lands on `BasicBook`, and examples build
themselves.** The landing program is now the workhorse compound (Poisson
count, lognormal severity, an occurrence limit), superseding the dice ruling:
the landing should speak actuary on sight, and the dice stay first in the
Examples menu. Choosing an example from the menu or the Ctrl+K palette builds
immediately; stepping the Ctrl+Shift ring builds 450 ms after the last step,
so flicking along the shelf walks text only and stopping on an entry answers.
The landing build itself never scrolls: the first paint does not move.

## 1.0.0a145

**[Scroll-Rule] one scroll rule across the site, two anchors.** Clicking a
tab, a sub-tab pill, or an in-pane pill (the Approximation Plot / Plot tail /
Summary switch) now scrolls the tab strip to the top of the page: the reader
has chosen what to look at, so the answer sits directly under the strip.
Pressing Build, Reformat, Sharpen, Hints, PnL or GCN, choosing an example
(menu, palette, or the Ctrl+Shift ring), or building with Ctrl+Enter scrolls
the editor box to the top instead: those gestures are about the program. Both
anchors sit just below the sticky header, which stays put, and the scroll is
smooth. Before this, replacing a pane collapsed the page height and the
browser clamped the scroll to the top of the page, which is what made a Plot
click on the Approximation pane jump to nowhere in particular.

## 1.0.0a144

**[Approximation-Tab] a Plot tail pill, and both plots at half width.** The
Approximation pane's switch grows a third reading:
`Plot | Plot tail | Summary`. Plot tail draws the library's new
`approximation_tails` chart (LIB a344), the exceedance picture the
`approximation` chart dropped at a337: the exact tail, one survival curve per
admissible family, and the sub-exponential implied tail, with the cdf, return
period and Lee readings declared in the document. The two documents are one
split picture, separated for payload size, so both plot halves now render in
a `plot-half` host capped at half the pane: each panel draws at the geometry
it had when the two traveled together, and a phone still gets full width.
Both pills grey together for a portfolio with the existing single-severity
why. No server change: the chart is name-addressed through the generic route,
and the gate is `available_charts` as ever.

## 1.0.0a143

**[Pk-Tab] the Pr Ruin pill actually opens, and the row stops shifting.** At
a142 the pill lit, greyed correctly, and did nothing when clicked: the leaf
was missing its row in `main.js`'s `LOADERS` dispatch table, the one
registration point no gate checked, so the Calibrate wrapper stayed on screen
and the plots never appeared. The row is added, and `check-nav.mjs` now
asserts every declared leaf has a `LOADERS` row so the next pill cannot ship
dark the same way.

Two form changes from the author's first kick of the tires. The pill moves
between Plot and Evaluate, fenced by dividers on both sides
(`... Plot | Pr Ruin | Evaluate`), so stepping between the two form-bearing
leaves does not shift the row. And the verb button becomes **Draw**, a plain
go button asking with the boxes as they stand, with **Sample** its own
explicitly labeled button beside the probability box, per the house rule that
one control never changes meaning: Draw repeats the question, Sample re-rolls
the seed.

## 1.0.0a142

**[Pk-Tab] the Pr Ruin pill: probability of eventual default.** A new leaf in
the Pricing row, last, after Evaluate, serving `dev/plan-pk-tab.md`. The form
is the shared pricing component plus one box, a probability of eventual
default; below it the library's two-panel `ruin` chart, about fifty sample
surplus paths with the expected trend, the LIL funnel and a rug of simulated
ruin times, beside the exact `psi(u)` curve with the resolved point marked and
a log reading offered. The `ruin` exhibit rides the same response as the
pane's stats strip. Every form change re-requests through a 350 ms debounce;
the Sample button re-rolls the seed server side and the rolled seed is then
held, so a drawn skeleton survives subsequent edits. Consumes `aggregate`
1.0.0a339 to a341.

One new route, `POST /v1/objects/{id}/ruin`, in the pricing family: it
derives the loss ratio through `price_pentagon` where the target is not one,
builds the chart document and the `RuinResult` exhibit envelopes on one shared
seed, and answers with both. A POST rather than the generic chart GET because
the exhibit registers on the result object and because a Sample must never be
answered from a cache. The pill itself gates on `available_charts` carrying
`ruin` (Poisson or renewal frequency, an aggregate alone), the Plot leaf's
mechanics, so there is no new capability flag.

The chart adapter gains three generic role treatments the ruin document is
first to use: `sample` families draw muted and stay out of the legend, `rug`
series draw as tick marks, and a `marker` is a visible point. The pricing
form component gains an `onChange` hook; the other five mounts are unchanged
and the Calibrate subtab is untouched. Nine backend tests in
`test_ruin_route.py`, three web tests in `ruin-nav.test.js`, and the
`check-nav.mjs` expectations learn the new row.

## 1.0.0a141

**[Approximation-Tab] the method-of-moments story reaches the page.** A new
Approximation leaf in the More row, between Tail behavior and Window, carrying
both readings of one question behind a Plot / Summary switch inside the pane.
Plot draws the library's `approximation` chart, the realized mass with the five
fitted families over it and an exceedance panel adding the sub-exponential
implied tail. Summary serves the `approximation` exhibit: the fitted DecL
fragments and their parameters, the achieved moments with the Kolmogorov
distance, and the quantiles on the return period ladder, every column read
against `exact`.

Consumes `aggregate` 1.0.0a331 to a333 and needed **no server change**. Both
the chart and the exhibit are name addressed through the routes that already
existed, and the generic chart adapter realized a thirteen-series, two-panel
document with no per-chart override, so the whole change is four files of SPA.

The two halves gate differently, and that is the library's decision rather than
this app's. The leaf lights from the exhibit, which is registered for an updated
aggregate or portfolio. The chart is registered for an aggregate alone, because
the implied tail needs a single severity and a book has one per unit. So a
portfolio opens on Summary with the Plot pill greyed and saying why, the same
shape Reinsurance Plot has on a reinsured portfolio, and greyed rather than
hidden per the house rule.

**Changed: the Reinsurance tab is now `Re`.** The six-tab strip is the one row
that has to survive a phone, and `Reinsurance` was the longest label by half
again, pushing the strip into a horizontal scroll. `Re` is also what the app
already calls the thing wherever a reader types it, in the Quick Re row and the
Add re button, so the tab now agrees with its own controls. The group key stays
`reinsurance`, so `data-tab`, the pane ids, the stored view state and any link
already shared are unaffected; this is the split `PnL` made at a138. Prose keeps
the full word, and the Help panel entry now opens with it.

## 1.0.0a140

**[Library-Skew-a333] the app catches up to `aggregate` 1.0.0a333.** Six
upstream bumps between a327 and a333 moved surfaces this repo reads, and nine
backend tests were failing against them. One was a real defect and the rest were
expectations describing a library that has since restated itself. Both suites
are green again, 386 backend and 121 web.

**Fixed: a bivariate's moments came back empty, so its status strip said
nothing.** `_component_fields` read a pair's mean and CV out of `stats_df` at
`("theoretical", stat)`. Library a330 gave the bivariate the Portfolio layout,
indexed `(component, measure)` over `meta` / `freq` / `sev` / `agg` blocks, so
neither that key nor its `empirical` fallback exists any more and both moments
resolved to `None`. Every pair built since printed `mean (?, ?) . CV (?, ?)`,
which is the a57 bug arriving by a new route. It reads `("agg", stat)` now, the
analytic aggregate moment, which is what `theoretical` meant.

**Changed, upstream, and visible without any edit here.** The return period
ladder is two sided: `tail_df` is indexed `P` rather than `p` and runs 0.001 to
0.999 in 19 rungs rather than 10, so the Tail tables are longer and the library
flags the 1-in-200 and 1-in-250 capital anchors at **both** ends, four rows per
unit instead of two. The joint surface reports its coordinates at the bucket
midpoint (`edge` is `mid`, was `left`) and carries the whole placed mass rather
than the fraction inside the display window. The SPA already decoded both
spellings of `edge`, so no plot moved.

**Corrected: two joint surface tests were asserting quantities the library never
promised**, and passed only while those quantities happened to agree with the
ones it does. `detail` counts cells across the **window**, not across the
emitted axis, and the window "does not crop what is served", so `nx` is the
whole lattice over the block factor and legitimately exceeds `detail`. Likewise
the served grid carries the whole placed mass, not the window's fraction of it.
Both now assert what `_joint_surface` documents, the window ceiling read off
the document's own `window` block. Nothing is owed upstream.

**Removed:** one examples test that asserted `library.agg` carries a tag value
repeating across two namespaces. The library dropped the namespace, so the test
had no subject; the app rule it guarded, that pills are never deduped, is
asserted by the test above it.

## 1.0.0a139

**[Examples-Search] the list stops drawing itself twice, and hits that score
equal keep the library's order.** Two faults in `web/src/examples.js`, both
reported from one search: typing `capstone` in the Examples dropdown answered
"11 matches" and then drew the eleven rows twice, alphabetized.

**Drawn twice: a render that published state from inside itself.**
`renderList` emptied the container, then set the search needle and called
`notify()` **before** appending anything. Every mounted surface subscribes to
that fanout, the dropdown included, so the fanout re-entered the calling
surface's own render, and that inner pass emptied the container and drew the
complete list. The outer pass then resumed and appended the filter bar, the
"n matches" header and every row a second time. The `notifying` guard was
written for the other loop, the two search boxes trading the needle, and a
surface redrawing itself into a container its caller is still filling is not a
loop, so it went straight through. Publishing moves to `publishNeedle`, called
from the boxes' own `input` handlers, and `renderList` is a pure draw: it reads
state and paints, and changes nothing. The handlers do not draw, because each
surface is one of the fanout's watchers and that is what repaints it. Nothing
notifies when the trimmed text has not moved, so a trailing space costs a
keystroke and no repaint. `mountPalette` now holds its `draw` at closure scope
so `open` repaints through the same function the fanout uses, and publishes its
cleared box rather than leaving the ring walking the last search.

**Alphabetized: uFuzzy's tiebreak, on a query that ranks everything equal.**
The payload was never the problem, `load_examples` serves `sort_values('seq')`
and `buildIndex` keeps it. uFuzzy's default `sort` ends in a locale compare of
the haystack string, which begins with the entry's name. Measured on the shipped
payload of 195 entries, `capstone` returns eleven hits with **one** distinct
score between them, every field equal and `start` 0 for all eleven, because each
is named `Capstone.*` and the haystack opens with the name. So nothing in the
ranking had an opinion and the alphabet decided the whole list, returning file
positions 14, 19, 13, 22, 16, 21, 20, 15, 12, 17, 18 for what `library.agg`
writes as a contiguous run, 12 through 22. `pnl` is the same wound on a family
written as a graded sequence: a tie block of twelve, alphabetized to `PnLBook`
first where the library teaches `PnLSimple` first and `PnLBook` last.

`sortByRankThenFileOrder` is uFuzzy's own comparator chain with one line
changed, `idx[a] - idx[b]` in place of that locale compare. `haystack` is index
aligned with `flat` and `flat` arrives in reading order, so the haystack index
is the position in `library.agg`. **Ranking is untouched**: every criterion
above the tail is uFuzzy's, in uFuzzy's order, so a query that discriminates
ranks exactly as it did. Only exact ties move, and they move from the alphabet
to the order the file teaches them in. The header note that a ranked list
keeping file order is not ranked still stands; a block of exact ties was never
ranked, it was alphabetized.

The Ctrl+Shift arrow ring inherits both, since it walks `visibleExamples()`,
which is the search result while a needle is live. Typing `capstone` and
walking now reads `[1/11]` `Capstone.Sev`, `[2/11]` `Capstone.Gross`, `[3/11]`
`Capstone.ExposureRating`, which is the worked example in the order it is built,
and the reason the author asked.

`rankMatches` is split out of `search` and exported so the order can be asserted
on the instance the app actually uses rather than on a second one a test builds
with the options copied across. `web/test/example-search-order.test.js` covers
it, six tests: an all-ties query holds file order, the alphabet does not get a
say, ranking still overrules file order where it discriminates, terms in either
order reach the same entry, a tie block inside a ranked result keeps its own
order, and no match is an empty list. Server side unchanged.

## 1.0.0a138

**[GUI-Round-7] four tweaks: the editor wraps, Economics becomes PnL, comments
stop swallowing programs, and the tabs stop moving.**
`dev/done/plan-ui-round-7.md`, from an author report of six items. The other two
needed no code here and are recorded at the foot of this entry.

**The editor wraps.** `EditorView.lineWrapping` joins the extension list. A
`note{...}` body is one run of prose on a single line, so a horizontal scrollbar
hid the part of a loaded example most worth reading. The 54px right channel in
the `.cm-content` padding is what a wrapped line now stops at, which is what
that lane was always for; the six-line floor and the `40vh` cap are untouched.

**Economics becomes PnL**, five user-visible strings in `index.html` and
`nav.js`. The button that creates the object is labeled `PnL`, the DecL keyword
is `pnl` and the route is `/pnl`, so the tab a reader lands on now spells it the
way the control that sent them there does. Prose keeps `P&L`, which is what
every hint and the Help panel already write. The key stays `economics`: it is in
`data-tab`, the pane ids, the stored view state and any link already shared, and
this was a label change. `data-label` moves with the label, since it is the
width ghost's measuring stick.

**A `#` comment no longer swallows the program behind it.** Author report: a
program with a note comment answered "unexpected end of file". `collapse_program`
folds the program onto one line before anything parses it, and it did that with
a single `re.sub` over the raw text, on an assumption its own docstring stated
and that had stopped being true: "`#` comments are not accepted in the input box,
so nothing gets swallowed". They are. Flattening first puts a leading `# a note`
in FRONT of the program, the whole statement becomes one comment, the library
preprocesses it to nothing, and the reader gets a parse failure with no
explanation. `//` failed the same way. A trailing comment survived, but only
because `build()` preprocesses downstream: the rule was never working here.

It runs `aggregate.parser.UnderwritingLexer.preprocess` now and joins the
statements it returns. That is where the comment rules live, full line and
inline, `#` and `//`, with `note{}` / `tags{}` / `hints{}` bodies lifted out
first so a `#` in prose stays prose. Public, and already imported by
`routes/decl.py` for a137, so the sanctioned import surface does not move. A
regex here would have been a second copy of a rule the library owns.

The trailing whitespace collapse stays, and that is not tidiness. It is what
makes the output **byte identical** to the old one on every program without a
comment, which matters because `collapse_program` computes the cache key: a key
that moved would silently miss every stored object. Checked against nine
programs, from a multi-line `port` through the bivariate's nested `dbvsev`
matrices to a `note{}` body holding a `#`. A test asserts the commented and
uncommented forms of one program are one id, not two.

**A program that holds no statement says so.** The collapse can now return an
empty string, from a box holding only comments, and the library's answer to that
is "build() expects a single output, got 0; use build_many() for batched
programs", which is about `build_many` and is addressed to a reader who wrote a
comment. The route answers 422 with "this program holds no statement: it is
empty, or all comments". Screened on the server because the comment rules are
the library's, and a client that could tell a comments-only program from an
empty one would be holding a copy of them.

**Arithmetic gets an answer.** Author request: pressing Build on an empty box
should say something, and a math expression should put its answer on the status
strip. The second half needed no calculator, because DecL already is one:
`decl.lark`'s top-level `answer` rule carries `expr`, so `(2+2)`, `2/3`,
`(2**10)` and `(exp(1))` are programs and `build()` answers each with a float.
The api built them and then **refused the library's own answer** at the classify
step, with "api supports 'agg', 'port', ... only; got 'float'".

`models.ValueResponse` serves it instead: `kind`, `value`, `decl`,
`elapsed_ms`, and the route's `response_model` becomes a union discriminated on
`kind`. A union rather than six null fields on `BuildResponse`, because almost
nothing a build manifest carries applies to a number: no id, no grid, no
capability block, no cache slot, no recipe registration. The audit records it
under its own status, `value`, so the operator's page does not read arithmetic
as object builds; the summary groups by that column, so a new status is a new
row rather than a disturbed one. The float travels raw and the app formats it
with the same helper that prints `mean` and `CV`, which arrive equally bare.

Client side, `build()` gains two answers where it had one and a silence. An
empty box writes a hint naming the other thing the box takes, since most readers
do not know DecL evaluates arithmetic. A `value` writes `<program> = <answer>`
to the strip and drops the object, which is the judgment call in this: a number
is what the box holds now, and leaving six tabs answering for the program that
used to be there would be a page showing two different things at once. The
previous program is one history step away. Arithmetic is not itself recorded in
history, whose ring is the trail of programs that built something and which
`rebuildMissing` walks looking for declarations.

**The tabs stop moving on hover.** Author report: a dark tab jitters when the
tooltip appears, getting slightly narrower. Two rules were fighting over one
pseudo-element. `site.css` reserves bold width with an `::after` ghost carrying
`content: attr(data-label)`, so selecting a tab does not shove the strip along;
the tooltip then reused **the same `::after`** and set `position: absolute`.
Absolute takes it out of flow, its contribution to the element's intrinsic width
goes with it, and the tab collapses to its unbold width for exactly as long as
the pointer is on it. Both levels of the menu did it, since sub-links carry the
same ghost.

There is no escape in CSS alone: an element has two pseudo-elements, the ghost
had one and the arrow had the other. So the box and the arrow move out to a
single node on the body, owned by `utils/tip.js`, and `::after` goes back to
being the ghost and only the ghost. `mountTipClamp` becomes `mountTips`; the box
is `.tip` and the arrow is `.tip::after`, placed at `--tip-arrow`, the anchor's
center measured from the box's own left edge, which preserves the rule the
module has always stated: the box slides to stay readable, the arrow keeps
pointing at the control. The look is unchanged, line for line.

Three things fall out. `tipShift` keeps its arithmetic and every one of its
tests, and gains an optional width, because a real node can be measured where a
pseudo-element could not: a short footnote is no longer shifted further than it
needs. The listeners become `pointerover` and `focusin`, which bubble, so one
handler sees every anchor and, more to the point, a `pointerover` on something
that is not an anchor is the signal to put the box away; that covers a row
rebuilt while the box is open, whose detached anchor would never fire a
`pointerleave`. And `.out-tabs` no longer has to forgo `overflow-x: auto` to
avoid swallowing the box, a constraint now lifted rather than acted on: nobody
asked for a scrolling strip on the desktop.

Nothing changes for a screen reader. A dark control carries its reason in
`aria-label`, set beside `data-why`, and never read the pseudo-element.

**Two reports that needed no code here.** The author's bivariate program builds
correctly: `decl.lark` has a no-frequency production for it, so `25 claims` sets
the exposure and the frequency defaults to Poisson, as it does for an ordinary
`agg`. It is `library.agg`'s `BivariateDiscreteSparse` after Reformat with
`fixed` removed by hand, and Reformat handles that entry correctly, expanding
the sparse triples to the dense matrix and keeping both the count and `fixed`.
**But `format_program` drops `note{}` and `tags{}` on every program**, found
while checking it, and the app writes the answer back over the editor, so
pressing Reformat is how a reader loses the note they wrote. That is a137's bug
one layer down and it is the library's; raised upstream rather than worked
around here.

On the SpaceMouse, the settings are right and match the testbed exactly
(`damping: 0.85`, `zoomSensitivity: 1`); what differs is the load. The lab draws
9,216 vertices and the real document comes back `nx 256, ny 256`, so 65,536,
because the app has never sent `detail` and the library's own value stands. Every
puck frame also goes through a full `chart.setOption` merge, where a mouse drag
runs inside echarts-gl's `OrbitControl` and touches no option at all. Two levers
if it comes back, both recorded in the plan: send `detail`, or drive
`OrbitControl` directly.

---

## 1.0.0a137

**[Reformat-Keeps-The-Program] Reformat stops flattening a program it cannot
read.** Author report: the button used to answer with a spread program, a clause
to a line, and now answers with one long line.

The button was not the thing that changed. `format_program` renders a program
statement by statement through `decl_writer._render_statement`, which catches
every exception and returns the statement instead of a render node, and that
fallback is documented as verbatim. It is not verbatim. The statement it holds
has already been through `UnderwritingLexer.preprocess`, which is what split the
program into statements in the first place, and preprocessing folds every line
break and every run of indentation into a single space. So a program the writer
cannot read comes back **collapsed onto one line**, the SPA sees an answer that
differs from what it sent, and `editor.setText` writes it over the reader's
spread program. Pressing the button that formats a program was how you lost its
formatting.

Three ways in, all of them ordinary:

1. A statement spelled the way the grammar used to allow. `doc{{{...}}}` left at
   `aggregate` 1.0.0a301 and the `so` placement keyword at a249, so a program
   from a fortnight ago is still in the history ring and no longer readable.
2. A statement naming something the default underwriter cannot resolve.
3. A **second** statement naming something the **first** statement defines.
   `sev MySev lognorm 50 cv 1.5` then `agg A 100 claims sev.MySev poisson`
   canonicalizes the first and collapses the second, though the program builds:
   the writer parses each statement against `aggregate.build` alone, which has
   never read statement one.

`routes/decl.py` now asks the parser before it asks the writer:
`_every_statement_parses` splits with `UnderwritingLexer.preprocess` and parses
each statement with `build.parser.parse`, the same two calls the writer makes,
and a program that fails either comes back exactly as it arrived. That is the
promise the route's docstring has made since a4 and could not keep. Both names
are public, so the sanctioned import surface is unchanged.

It parses the program twice on the way to a canonical answer. That is the right
trade for a button a reader presses by hand: a few milliseconds nobody can
perceive, against a program nobody can get back.

**What it does not fix.** Case 3 is a working program the button now declines
rather than damages, which is honest and is still a gap. Both halves are written
up in `dev/TODO.md` under the asks raised with `aggregate`: return the source
slice rather than the preprocessed copy, and resolve a statement against the
ones already read in the same call. The guard retires when either lands.

Four tests in `tests/test_objects.py`: a one-line program spreads, a program
carrying a retired clause comes back byte identical, the two statement case
comes back byte identical, and the existing trailer tests still pass.

---

## 1.0.0a136

**[SpaceMouse-Feel-Retired] the feel panel goes, and the puck runs on one
setting again.** Author request: the puck was responsive when phase 3 landed and
is not now, and the `feel` button is a page of options the reader should never
have been handed.

`web/src/charts/spacemouse-panel.js` is deleted, with its button, its four gain
sliders, the curve and deadzone sliders, the five reverse flags, the one-axis
option, the live readout and its CSS. The nav is created with no settings
argument, so `NAV_DEFAULTS` in `surface-nav.js` is what drives the camera:
90 degrees a second at full twist, 55 at full tilt, 0.9 e-folds of distance a
second, pan at 0.7 of the distance, expo 0.6, nothing reversed. The device's
deadzone falls back to `TUNING.deadzone`, 0.05, since nothing calls `setTuning`
any more. That is the a88 to a90 feel exactly, which is the one the author says
worked.

**Where the responsiveness went, as far as the code can say.** The arithmetic
did not move: `surface-nav.js` and `spacemouse.js` are byte for byte what a90
left, and nothing since has touched `readCamera`, the `viewControl` write or the
loop. The one layer that arrived between the working version and now is a89's,
and it is stateful in the worst way for a fault like this: `feelForNav()` seeded
the integrator from `aggapi.spacemouse` in localStorage and `applyTuning()`
pushed the stored deadzone into the device layer at import. A tuning session
that ended with low gains, a hard curve or a wide deadzone was then the permanent
setting of that browser, surviving every reload and every deploy, with nothing on
screen to say so. Deleting the layer is also the cure: nothing reads the key now,
so the stale value is inert.

**What this cannot have fixed, stated so it is not assumed.** The puck writes a
camera and the scene redraws, so its feel is bounded by how fast the surface
redraws. If a drag with the mouse is equally heavy, the cost is in the drawing,
not in the puck, and the answer is a smaller grid rather than anything here.

`aggapi.spacemouse` is left in localStorage rather than cleared. Deleting a key
the app no longer reads is a write for no reader.

---

## 1.0.0a135

**[Page-Load-Waste] the exhibit route stops rebuilding to say "nothing
changed", and a page load stops asking three questions twice.**
`dev/plan-page-load-waste.md`, from a network trace of the running app.

The trace was opened on a suspicion that the 2D charts were refetching on every
visit and that caching was broken. The opposite is true, and the measurement is
worth recording: `Cache-Control: no-cache` means revalidate every time, so a row
appears in the network panel on every visit even when no body is transferred,
and that is what was being read as a reload. On a three unit portfolio,
`chart/port` costs 200 and 2,417,700 bytes on the wire once, then 304 and 300
bytes on every return.

What the trace did find was four other things, none of them the suspected one.

**`RevalidationCache`** replaces `_chart_cache` and its two module functions.
The class is the same LRU with the same argument, now parameterized by capacity
and by the telemetry channel it counts on, and it is instantiated twice: the
chart cache at 8 entries, keyed `(oid, name, window, detail, encoding)` as
before, and a new exhibit cache at 64, keyed `(oid, name, perspective)`.
Exhibit envelopes run a few kB against a chart's few MB, so the larger count is
the smaller worst case.

The exhibit route needed it more than the chart route did. It built the exhibit,
serialized it, computed the hash, compared `If-None-Match` and on a match threw
all of it away: 210 ms on that portfolio's `tail` and 48 ms on `summary`, to
reply that nothing had changed, against 7 ms for a chart answering off its
cache. Both now answer in about 4 ms. Availability is still screened first, so
an unknown name is a 404 before any cache is consulted.

`status.record_chart_cache` and `chart_cache_state` become
`status.record_cache(channel, event)` and `cache_state(channel, ...)`. The
status payload gains an `exhibit_cache` panel beside `chart_cache`, and the
operator's page renders both through one `revalidationCache` helper.

**Three client fixes**, each a redundant request or an error on every load.
`loadExamples` memoized the resolved payload but not the fetch in flight, so the
example ring and the dropdown mount, which race at startup, both saw `cached`
null and both fired. `pricingPreview` gains an in-flight map keyed on the whole
question: three of the four pricing forms mount with `preview: true` and
identical defaults, so a build posted `{p: 0.99, coc: 0.15}` three times. It
coalesces rather than caches, and the entry is dropped the moment the request
settles, so a live readout can never answer with a stale number.

And `walkMode` moves up into the module state block. The landing
`editor.setText` runs at module top level and fires CodeMirror's update listener
synchronously into `onEdit`, which reaches `renderHistoryNav` whatever `fromApp`
says, which reads `walkMode`; declared 35 lines below that `setText` it was
still in the temporal dead zone, so every page load logged a `ReferenceError`
from inside CodeMirror's listener guard and lost that first render.

A page load is 10 `/v1/` requests before and 7 after, with a clean console.

Not a finding, recorded because it was checked: compression has no bypass.
`GZipMiddleware` is installed on the app itself, so it covers every `/v1/`
route, the `.csv` download and the StaticFiles mount alike, and nothing sets
`Content-Encoding` itself or returns a `StreamingResponse`. Density and the 3D
surface both travel the ordinary JSON routes. The ratio is worth knowing for the
separate question of chart document size: the `app.py` comment expects about
10 to 1 on a density payload, and a chart document measured 2.5 to 1
(6,105,738 raw to 2,417,700 on the wire), because it is full precision float
text with high entropy.

---

## 1.0.0a134

**[Table-View-Cycle] Ctrl+Shift+U walks all three table readings.** Author
request, no plan doc.

The keystroke flipped two states, static and interactive, and deliberately never
entered the third: it toggled against the static reading you last had, so a
reader living in full precision kept it but nobody arrived there except from the
menu. That was the a69 ruling ("not the full prec version") and the author has
now reversed it. It cycles in menu order instead: static, static at full
precision, interactive, and round to static again.

Full precision belongs in the cycle for the reason the other two are there. It
answers the same question, how should this table read, and comparing a printed
digit against every digit is a thing done while reading rather than while
deciding, which is the whole test for what earns a keystroke.

`_lastStaticView` goes with the toggle, replaced by `TABLE_VIEW_CYCLE`, the menu
order written once. A stored preference outside that ring, which nothing writes
but `localStorage` can hold from an older build, steps to static rather than to
`undefined`.

Ctrl+Shift+V is untouched and still flips perspective. The help panel already
described the menu's three readings and needed no edit.

---

## 1.0.0a133

**[Example-Ring-Follows-Search] the ring follows the search box as well as the
pills.** Item 5 of `dev/plan-punchups-aug-24-API.md`, and the last of it.

Half of this landed with the examples dropdown work: a123 made
`filteredExamples()` the Ctrl+Shift arrow ring's list and reset the cursor on a
pill click, so filtering to `role:hero` and walking those seven already worked.
The search box was the half still missing, and it is the half the author named.
`filteredExamples()` returns the **pill filtered** set while the visible list is
`search(q)` over that set, so a needle narrowed what was on screen and the ring
went on walking everything the pills had left. Type `hero`, see seven rows, walk
151.

The needle becomes module state in `examples.js`, exactly as the filter set
already is, so one subscriber channel carries both. `renderList` writes it from
the `q` it has already computed, which is the one place that knows what the
reader typed. A new `visibleExamples()` is the ring's list from now on:
`search(needle)` when the needle is non-empty, `filteredExamples()` otherwise.
`main.js` calls it at all three sites, `pickExample`, `exampleStep` and the reset
subscription.

`onExamplesFilterChange` is renamed `onExamplesViewChange`, since it stops being
about filters alone, and it now fires on a needle change for the same reason it
fires on a pill click: the cursor indexes a list that just changed shape, so it
is dropped and the `[m/n]` readout is redrawn.

**The loop this could have become is guarded, and it was not hypothetical.**
`renderList` runs inside a `notify()` fanout, and the dropdown and the Ctrl+K
palette each have their own search box. A keystroke in one would set the needle,
notify, redraw the other from *its* empty box, set the needle back, and the two
would trade it for ever. A `notifying` flag makes a fanout suppress both the
notify **and** the assignment, so a redraw caused by a notify cannot throw away
what the reader just typed in the other surface.

**Search results are ranked, not in file order**, which `renderList` and the
plan both state deliberately, so with a needle live the ring walks in relevance
order. That is the ring's contract holding rather than breaking: it is the list
read top to bottom, and with a needle typed the top is the best match. Combined
with a129, `hero` now walks `[1/7]` to `[7/7]` with the counter following.

## 1.0.0a132

**[Example-Load-Strips-Trailer] the picked entry loses its note and tags, and
the strip prints the note anyway.** Item 1 of
`dev/plan-punchups-aug-24-API.md`. A program loaded from the Examples menu now
arrives in the editor with its `note{}` and `tags{}` stripped. A reader watching
the app should see the program, not the program plus its filing metadata, and
the prose belongs on the status strip where prose goes.

**`hints{}` stays, and that is not negotiable.** Sixteen library entries pin a
grid, a reference to one of them means one fixed thing only while the clause
travels, and a program without it rebuilds on whatever grid the next build
chooses.

**This is not a revert of a119.** That change put the clauses on deliberately,
and the reason is still true: an object carries the note and tags its own
program declares, so a stripped entry builds an object with neither and the
strip has nothing to print. The fix is to keep the strip fed on a different
channel rather than to put the clauses back. The picked item already carries
`note` and `tags` as fields, which is what the menu row reads, so the SPA takes
them from there.

Server side, `examples.py` gains `_strip_filing_clauses` and a module constant
`_FILING_CLAUSES`. The pattern is exact rather than approximate: `decl.lark`
lines 830 to 832 define the trailer terminals as `/note\{[^}]*\}/`,
`/hints\{[^}]*\}/` and `/tags\{[^}]*\}/`, so a body cannot contain a closing
brace and `[^}]*` is the grammar's own rule and not a guess at it. It is
documented as mirroring those three, the way `web/src/decl-keywords.json` is
documented as mirroring `parser_errors._TERMINAL_LABELS`, which puts it under
agreement 6 of the oversight charter: a grammar change to the trailer gets
checked against it.

**The whitespace tidies itself.** The pattern carries a leading `\s*`, so a
clause on its own line takes the newline and indent in front of it and the line
goes with it, while a clause trailing one that also carries `hints{}` takes the
single space in front of it and leaves no double space. Nothing else on the line
is touched, including any alignment the file wrote inside a bracketed list. One
`re.sub` pass, no second cleanup, verified over all 151 shipped entries: no
blank lines, no trailing spaces, and the sixteen `hints{}` intact.

App side, the strip's note slot gains a fourth tenant, the library caption,
holding the picked item's `note` and `tags`. `pickExample` and `exampleStep`
both record it before the program is loaded, so the caption is on screen the
moment the program is rather than one build later. `renderNote` prefers the
object's own declaration and falls back to the caption per field, so a reader who
types their own `note{}` still sees theirs and the hand typed path is exactly as
it was. `clearNote` no longer clears the caption: the three build derived
tenants belong to one object and go on every build, while the caption belongs to
the **program in the box** and has to survive being built. It is cleared in
`onEdit` when the reader typed, which is the page's "the box holds something
else now" hook.

`ExampleItem` does not move and no consumer of the api loses anything; only
`decl` changed. Three tests rewritten and two added, including a `port` case,
where DecL binds the trailer directly after the name rather than at the end, so
the removal cannot be accidentally anchored to the end of a program.

## 1.0.0a131

**[Surface-Strip-Punchups] four fixes to the 3-D control strip.** Item 10 of
`dev/plan-punchups-aug-24-API.md`, all four in one bump.

**[Surface-Single-Panel-Group] the log button joins the strip.** `renderControls`
drew one `.exhibit-group.exhibit-group-panel` per panel, and that class is
`flex: 1 1 0; justify-content: center` so that with two panels each group sits
over its own half of the canvas, with `.exhibit-group + .exhibit-group` ruling
between them. A surface document has one panel, so its group took all the spare
width, centered a single `log y` in the middle of it, and was cut off from
everything else by a rule. The layout was doing exactly what it was built to do,
on a case it was not built for. A single panel's buttons now go into the document
group instead, at the front, which keeps the house order of axis readings before
realizations. Not a surface special case: with one panel there is nothing for the
half and half layout to align to, and a labeled column of one is the
disconnected look on any chart.

**[Surface-Download-Menu] one Download button, four formats.** The `mesh` label
and the three bare `.glb` / `.obj` / `.stl` buttons sitting mid strip become one
`Download` dropdown, second to last, before `reset`, which keeps the end on the
grounds a117 recorded. The three per format sentences become the items' own
hover text, so nothing written is lost, and the shared sentence about the file
being the box on screen moves to the button.

**PNG joins it** (author ruling, 2026-08-24), and the header More menu's
"Download plot" comes out. The menu is meant to be the one place a drawing
leaves the app, and three mesh formats without the picture is an odd set. So the
menu is drawn on **every** chart, not only on a relief: PNG always, the three
mesh writers while a surface is the realization on screen. That is what lets the
header item go without loss, and it fixes something that item never could: the
`liveChart` helper behind it mapped the active group to one of three chart
handles, so the Pricing group's kappa curves had no way to be saved at all. The
strip is rendered by every chart mount. `liveChart` had no callers left and is
gone with the item.

**[Surface-Puck-Button-Width] the puck button stops growing.** Its label became
`spacemouse: SpaceMouse Wireless` on connect, which signaled the state twice and
grew the button enough to rewrap the strip, so connecting a puck moved every
control beside it. The label is always `spacemouse` now; `.active` carries
connected, which is the fill the rest of the strip already uses for on; and the
device name moves into the title, whose connected branch reads "Connected to
SpaceMouse Wireless." A reader who wants to know which puck asks the button, and
one who wants to know whether it is on sees the color.

**[Surface-Reading-In-The-Strip] the cell reading moves to the fixed legend.**
No floating tooltip on the surface, per the author. A tooltip on a 3-D scene
follows the cursor over the very thing it is describing and hides it, and it
asks its question every time the cursor crosses the box. `writeCutReadout` now
draws a third group, the clicked cell, ahead of where the cut is and what it
leaves, from the `[x, y, h]` the click handler already received. Placeholders
from the first paint, names present and values blank, so the strip holds its
height and nothing below the chart moves on the first click. The `tips` control
is retired from `SURFACE_CONTROLS`, `SURFACE_KEYS` and the view defaults, rather
than repurposed: with the reading in a fixed place there is no second question
for a button to ask, and a stored `tips` key in a reader's persisted view is
harmless once nothing reads it.

The reading itself is a new leaf module, `charts/cell-reading.js`, on the
`reading-map.js` pattern: it imports one formatter and nothing else, so it can
be tested outside a browser, which it could not be inside `surface.js` because
that imports `theme.js` and so `echarts`. Seven tests pin what it decides,
including the two careful cases the tooltip made and this keeps: a cell resting
on the log floor reads `< 1e-12` rather than reporting the floor as data, and a
quantized encoding says so rather than implying four significant figures are
seven.

A click with `cut === 'none'` still forces `cut: 'all'`. With the reading in the
strip a click now always does something visible, so that forcing could go, but
changing it is a separate behavior decision.

## 1.0.0a130

**[Tooltips-Stay-On-Screen] the `data-why` footnote clamps to the viewport.**
Item 9 of `dev/plan-punchups-aug-24-API.md`. Hover the Reinsurance group's Plot
leaf while it is dark and the explanation ran off the left edge of the screen.
The footnote is a CSS `::after` centered on its button (`left: 50%` with
`translateX(-50%)`) and capped at 230px, and Plot is the first leaf in its row,
the row starts at the content's left edge, and the button is about 45px wide, so
a 230px box centered on it overhung by roughly 90px. The mirror case exists at
the right edge and both get worse as the window narrows.

The rule now reads `translateX(calc(-50% + var(--tip-shift, 0px)))`, and a new
`web/src/utils/tip.js` writes `--tip-shift` on the anchor on `pointerenter` and
`focus`, computing the least shift that keeps the box inside the window with an
8px margin, then clears it on the way out. **With the variable unset the rule is
byte identical to what it replaces**, so the footnote still centers if the
script never runs.

Wired once, delegated on `document`, so nothing has to be re-bound when
`renderSubTabs` rebuilds a row or the group tabs are re-marked on every build.
Both listeners are registered in the capture phase, because `pointerenter` and
`focus` do not bubble, and `focus` matters: the box is drawn for
`:focus-visible` too, so a keyboard reader gets the same clamped footnote.

**The arrow is not shifted.** It is a separate `::before`, still centered on the
button, because the arrow points at the control while the box slides to stay
readable. That is what every tooltip library does when it shifts rather than
flips.

This is the page's only hand rolled tooltip, used by the dark group tabs, the
dark sub-tab leaves and the Allocate leaf's `.massive-toggle` placeholder, so
one fix covers every case. The Bootstrap tooltips elsewhere are Popper
positioned and already flip. The phone breakpoint's "the tooltip is clipped
here; that is the trade" comment comes out, having stopped being true.

Six tests over `tipShift`, which is the whole of what the module decides:
`mountTipClamp` is four `addEventListener` calls. One of them is the argument
against the pure-CSS alternative, `:first-child` and `:last-child` anchoring: a
button in the middle of a row is untouched by an end-of-row rule and clips
anyway once the window narrows. CSS anchor positioning with
`position-try-fallbacks` is the real answer and is not on the iPad, which is a
supported target.

## 1.0.0a129

**[Counter-Follows-The-Example-Walk] the readout numbers the example walk.**
Item 11 of `dev/plan-punchups-aug-24-API.md`. Ctrl+Shift+Up and Down step
through the library and the `[m/n]` beside the editor did not move. It could
not: it read `history.position()`, and the example ring is a different stack
that nothing reported on.

One readout, two stacks, and the rule for which is showing is the rule the
reader already has: **the counter describes whatever the last press walked.**
`walkMode` is `'history'` or `'examples'`; `exampleStep` and `pickExample` set
it to `'examples'`, `navigateHistory` sets it to `'history'`, and a build or an
edit by the reader puts it back, since both mean the box has stopped showing a
library row.

`n` is the count of what is being walked, which since a123 is what the active
pills leave, so a reader filtered to `role:hero` walks `[1/7]` to `[7/7]`. That
is the readout doing its job: it says where you are in what you are walking, not
how big the library is. The length is read off the same call `exampleStep`
makes, not off a copy, or the two drift the first time a filter changes mid
walk. A pill click now redraws the readout as well as dropping the cursor,
because the number it was showing indexed a list that just changed shape; an
unset cursor draws blank, the same rule the history readout already uses for
"not in the stack".

**The two step buttons stay bound to history and keep their own greying.** They
are the walk's only route on a touch device, an iPad's on-screen keyboard having
no arrow keys, and the example ring has no buttons. So while the counter is
describing the library the arrows describe the history. Greying them against
whichever stack is live would make the touch route disappear mid walk, which is
worse; if the two are ever to agree, the answer is a second pair of buttons.

The four sites that build something did `history.record(...)` then
`renderHistoryNav()`, and each now needed a third line to put `walkMode` back.
They go through one `recordProgram()` instead, which is where the fourth copy
would otherwise have gone quietly missing. The Help panel's Ctrl+Shift line now
says the counter follows the walk.

## 1.0.0a128

**[Clear-Twice-Clears-History] a second press of the clear icon empties the
store.** Item 4 of `dev/plan-punchups-aug-24-API.md`. Press the clear icon with
a program in the box and it clears the box, as before. Press it again on an
empty box and it clears the stored history: the `[m/n]` readout goes blank, both
arrows grey, and the walk has nothing to walk.

"The cache of programs" is read as the localStorage history under
`aggregate-web:history`. It is the store the icon's two neighbors navigate and
the only one a reader would describe that way. The server side object cache is
shared and is not the app's to drop.

`history.js` gains `clear()`, which empties `entries`, puts `cursor` back to
`-1`, drops the stashed `draft` and saves once. It belongs there because that
module owns the stored shape and the two caps in `trim`.

**No confirmation dialog, deliberately.** The author asked for a second click,
and a modal in front of it would defeat the point of asking for a gesture rather
than a control. What is lost is a local convenience store, not work.

The readout flashes "cleared" for a moment, on `#history-pos`, which is the
element that just emptied and already carries `aria-live="polite"`, so the word
is announced as well as drawn. Without it the second press looks like a dead
control: the box was already empty and a readout going blank is easy to miss.
The flash is guarded on the history being non-empty, because `flashLabel`
restores the text it captured, so two presses inside its 900ms would otherwise
leave the word up for good. A press that clears nothing now says nothing, which
is also the honest reading.

Two tests in `web/test/history-walk.test.js`, last in the file because they
empty the store the tests above spend the run filling: one records three,
clears, and checks the readout reads `{m: 0, n: 0}` with both directions dead;
the other checks the stashed draft goes too, since a survivor would surface
later as a program nobody asked for. The Help panel's `✕` line now names the
second job.

## 1.0.0a127

**[Editor-Margin-Controls] the walk buttons align right and lose their boxes.**
Item 3 of `dev/plan-punchups-aug-24-API.md`, all of it in `site.css` and two
`<i>` classes.

The editor's right margin holds three marks: the clear icon, then the two walk
buttons under it. The icon was a bare glyph pinned to `right: 1rem` and the
buttons were 2.1rem boxed controls with a border and a fill, centered in the
column, so none of the three right edges agreed and the pair read as a widget
bolted under an icon. `.editor-hist` now takes `align-items: flex-end`, so the
buttons and the `[m/n]` readout share the icon's right edge, and `.hist-step`
drops its border and background and follows `.editor-clear` instead:
`var(--mut)`, going to `var(--ink)` on hover. `:disabled` greys by
`color: var(--line)` alone, which is what its own comment already said the
greying should be. The glyphs become `bi-arrow-up-circle` and
`bi-arrow-down-circle`, the same family, weight and optical size as the
`bi-x-circle` above them, so the three stack as one set of marks.

**The 2.1rem hit area is kept on purpose.** The a115 comment computes the stack
against the editor's six line floor and records why 33.6px was chosen against
Apple's 44px guidance, and none of that reasoning is about whether the target is
outlined. The declared height is unchanged, so the arithmetic still lands near
the same 128px; the comment now says so rather than being left quoting numbers
for a box that had changed.

Nothing in `main.js` moved. The `title` strings, the `aria-label`s and the
disabled logic are all as they were.

## 1.0.0a126

**[Reformat-Keeps-Trailer] Reformat stops deleting the note and the hints.**
Item 8 of `dev/plan-punchups-aug-24-API.md`, one keyword.
`routes/decl.py` called `format_program(decl, fmt="text")`, and the writer's
signature is
`(spec_or_text, *, fmt='text', layout='spread', trailer=False)`. It emits the
trailer as a unit, so at the default every `note{}`, `hints{}` and `tags{}` in
the program was dropped. Press Sharpen, which writes a `hints{}` clause pinning
the grid the probe chose, then press Reformat, and the pinning is gone. That is
meaning lost rather than formatting: a program that does not state its grid is
one the next build is free to put on a different one. The call now passes
`trailer=True`.

**Tags come back with the note and the hints** (author ruling, 2026-08-24),
because the writer emits the three together and a reader who typed their own
`tags{}` should keep it on the same rule as their own `note{}`. This does not
fight the Examples library: an entry loaded from the menu arrives with note and
tags already stripped, so there is nothing on that path for Reformat to restore.

Two tests, asserted clause by clause rather than on the whole string, since the
writer decides layout and placement and this is a test about what survives. The
second uses a `port`, where DecL binds the trailer directly after the name and
before the first unit, so the round trip is not accidentally checked only at the
end of a program.

Reformat still rewrites `ph 2/3` as a float and `dsev [1:6]` as six values,
because `format_program` round trips through the spec. That is the writer
working as designed, is out of scope here, and is tracked upstream as
`[Unparser-Reference-Gaps]`. It is also why the Examples menu serves
`Recipe.as_read` rather than coming through this route.

The route's own docstring said it standardizes a program loaded from the
Examples library. That stopped being true at a122. Its callers are the Reformat
button and the `grossceded` prefix path, and it now says so. The file's legacy
` -- ` glosses were cleaned in the same pass, per the house rule that they go as
their file is next edited.

## 1.0.0a125

**[Stats-Joins-Overview] and [Overview-Leaf-Order] the Stats leaf moves up, and
the Overview row is reordered.** Items 6 and 7 of
`dev/plan-punchups-aug-24-API.md`, one edit because they are one edit. Stats
leaves More for Overview and the row now reads **Plot, Summary, Validation,
Stats, Tail**. Summary states the moments, Validation says whether to believe
them, Stats breaks them out by frequency, severity and aggregate, and Tail is
the one reading that leaves the body of the distribution behind. Validation
therefore stops sitting after Tail, where it had been since a55.

**The move lights nothing new and darkens nothing, and the check asserts that
rather than leaving it to be believed.** `more:stats` was live for `agg`,
`agg_reins`, `port`, `distortion`, `bvagg`, `pnl` and `xpnl`, which is exactly
the set `overview:summary` and `overview:validation` carry, so the new
`overview:stats` row in `dev/scripts/check-nav.mjs` is byte-identical to the two
above it. `node dev/scripts/check-nav.mjs` reads clean on all eight fixture
kinds. This is the same move Validation made at a55 and it is recorded the same
way.

**Both halves of the loader key move.** `LOADERS` goes from
`loadExhibitLeaf('pane-more', 'stats', ['more', 'stats'])` to
`loadExhibitLeaf('pane-overview', 'stats', ['overview', 'stats'])`: the pane id
decides which pane the table is drawn into and the reading-map key decides which
leaf definition `ledeFor` reads its label and hint from, so a half move would
have drawn the Stats table into the More pane behind an Overview pill, with no
lede.

A reader whose More group was sitting on Stats has a remembered key that no
longer exists. `activeLeaf` falls back to the first live leaf when the
remembered one is not available, and `leafAvailable` returns false for an
unknown key because `leafOf` returns undefined, so this self heals on the next
render. `state.leaf` is in-memory and per session, not persisted, so it does not
survive a reload either.

## 1.0.0a124

**[Examples-Fuzzy] the example search takes its terms in any order.** Phase A5,
the last of `dev/plan-examples-dropdown.md`, which retires to `dev/done/`.
uFuzzy's `search` takes an `outOfOrder` argument the call here never passed, so
a needle only matched where its terms appeared in the order they were typed:
"reins tower" reached `ReinsuranceOccurrenceTower` and "tower reins" did not,
and "lognorm poisson" found nothing at all while "poisson lognorm" found the one
entry that says both. Nobody remembers which way round they wrote it. Passing 4
permutes up to 24 passes.

**Measured on the real payload before choosing it**, which is what the plan
asked for. No query lost a result; "tower reins" went from 3 hits to the same 6
as "reins tower", "lognorm poisson" from 0 to 1, "mixed severity" from 3 to 4,
and the entries a reader is describing rank at the top of both orders. Every
query came back inside 3ms over the 151 rows, most of them *faster* than the
ordered search, because uFuzzy's out-of-order path prefilters. So the `fzf` port
the plan held in reserve is not needed and no dependency is added.

**`CLAUDE.md` records the recipe base on the import surface**: `Recipe.seq` and
`Recipe.as_read`, both load bearing here, with a pointer to the audited list in
the oversight charter, since the section's four bullets understate what the app
actually imports.

## 1.0.0a123

**[Examples-Tag-Pills] every pill is a filter and every filter is a pill.**
Phase A4 of `dev/plan-examples-dropdown.md`, the app side of the flat list a122
started serving. The row is now three lines: the name in bold, the note in muted
text, and a row of pills. Nothing is right aligned, so the list has one clean
left edge and a long name never collides with anything.

**The kind is the first pill rather than a column of its own**, then the topics,
then the roles, in the order the payload serves them. Three hues, one per
namespace, no shading inside a namespace, defined as `--pill-kind-*`,
`--pill-topic-*` and `--pill-role-*` on `:root`. They are chips, not signals:
low saturation, well clear of the accent and of the three state colors, and
separated from each other by hue rather than by intensity, because the page
reserves the house red for selection and green, orange and scarlet for state.
Color is never the meaning either way, since the value is the text inside the
pill. `site.css` has no dark mode at all, so the tokens are light only rather
than the place to introduce the page's first `prefers-color-scheme` block.

**Clicking a pill filters on it.** Values compose OR within a namespace and AND
across them, so "intro or intermediate" and "advanced reinsurance" are both
expressible, and the new `applyFilters` is the pure function that says so, with
`web/test/example-filters.test.js` covering both rules, their composition, and
the property the whole plan is about: filtering hides rows and never reorders
what remains. A bar above the list carries the active pills, each with its own
count off the payload's facets and an x, plus a running "47 of 151" and a clear
control. There is no separate facet UI to design, learn or keep in sync with the
pills.

**The filter set persists per viewer** in `localStorage`, read on mount and
written on change, both wrapped: `localStorage` throws rather than returning
null in a private window and where site data is blocked, so a viewer who cannot
store loses a filter, not a menu. A stored key that no longer parses is skipped
for the same reason. The set is one module-level `Set` shared by the dropdown
and the Ctrl+K palette, which watch it and redraw together, so a filter set in
one is on in the other.

**The Ctrl+Shift arrow ring walks the filtered list**, which is its own stated
contract, the dropdown read top to bottom. It no longer holds a copy of the
items, only a cursor, and the cursor is dropped whenever the filter set moves,
since an index into a list that changed shape means nothing.

**The note is clamped to three lines with the whole text on `title`**, and the
clamp comes off in the palette, which is wide enough to show it. The longest
note in the library is a 320 character citation, five or six lines in a
dropdown, and one entry that tall pushes everything after it off the screen. The
pill row wraps rather than truncating; the widest today carries five, and a "+2"
affordance is more machinery than that case deserves.

## 1.0.0a122

**[Examples-File-Order] the Examples menu reads the library in the file's own
order, and hands the editor the author's own text.** Phases A1 to A3 of
`dev/plan-examples-dropdown.md`. The library half landed at `aggregate 1.0.0a320`
(`Recipe.seq`, the zero-based reading order, and `Recipe.as_read`, the entry's
DecL as its `.agg` file spells it), so the environment must be synced before any
of this is believed.

**Two re-orderings between the file and the reader are gone.** `library.agg` is
written as a reading order and the entries inside a part build on one another.
`Underwriter._recipes_frame` ends in `.sort_index()`, so the frame arrives
alphabetical by `(kind, name)`; `examples.py` then grouped on the `topic:`
namespace, ordered the groups by a hand kept tuple, ordered the entries inside
each group by a second `sorted()`, and title-cased the group key. Reading order
is meaning, and under the purist ruling the library owns meaning, so the app now
says `recipes.sort_values('seq')` and stops. With it go `_TOPIC_ORDER`,
`_ROLE_ORDER`, `_UNGROUPED`, `_GROUP_TITLES`, `_KIND_TITLES`, `_title`,
`_sort_key`, both `sorted()` calls and the `Grouping` literal: every place the
app decided what the library means. The ordering tables were also wrong, which
is what a hand kept table becomes. `_TOPIC_ORDER` held slots for `bounds` and
`ruin`, which no entry claims, and was missing `picks` and `tweedie`, which
existed, so those two fell into an alphabetical tail.

**Breaking, `GET /v1/examples`.** The payload is now `{"items": [...],
"facets": {...}}`, one flat list with no groups and no headings, each entry
appearing exactly once. The grouped payload emitted a row per `topic:` tag, 182
rows for 151 entries, purely to feed the grouped view, and the SPA then
deduplicated them again to build its search index. `?group=topic|kind|role` is
retired rather than deprecated, since the api is private and pre-release; a clean
break costs nothing and keeping a grouped view would have kept the tables it
needed. `ExampleCategory` is replaced by `Pill` and `FacetValue`.

**Pills are served render-ready.** Every item carries `pills`, already ordered
kind, then `topic:`, then `role:`, so the SPA draws the row as given and the
namespace-to-color mapping has one authority. `tags` stays as full slugs for the
search haystack and for anyone reading the api directly, and `kind` keeps a
field of its own, because the recipe's type is not a tag. `facets` is keyed by
those same three namespaces and each list is ordered by first appearance in
`items`, so a filter bar built from it reads in file order too, with counts over
the entries actually returned. Two values repeat across namespaces today:
`topic:pnl` sits on all eight `pnl` entries and `topic:distortion` on all six
`distortion` ones, so those fourteen rows draw the same word twice. Both pills
are served, because the library owns its vocabulary and the redundant tags come
out of `library.agg` upstream.

**Optional server-side filters**, repeatable `kind=`, `topic=` and `role=`, OR
within a namespace and AND across them. The SPA does not pass them: the whole
payload is 151 entries fetched once and filtering in the browser keeps the pills
and the list in step with no round trip. They exist so a notebook can say
`GET /v1/examples?role=intro`.

**The served declaration is the file's own text.** `_decl_of` answers with
`Recipe.as_read`, keeping the `spec_to_decl` then `format_program` pair only as
the fallback for a session build, which never had a file. That pair round trips
through the spec, and the parser evaluates or expands several spellings on the
way in and keeps only the result, so the editor used to receive `ph 2/3` as
`ph 0.6666666666666666`, `ceded to tower [0 25 50 75 100 125]` as five
and-chained layers, `dsev [1:6]` as `dsev [1 2 3 4 5 6]` and
`sev (100 / exp(1.5**2/2)) * lognorm 1.5` as `sev 32.465246735834974 * lognorm
1.5`. Those spellings are what several entries exist to teach. An entry now
arrives laid out over several lines exactly as written, trailer and `hints{}`
included, and the sixteen hinted entries still rebuild on the grid they were
written for. Inverting the desugared clauses stays upstream work, tracked there
as `[Unparser-Reference-Gaps]`, and nothing here waits on it.

**Heroes come back in file order too**, so `load_heroes` loses its name sort.
The order is read off each resolved `Recipe.seq` rather than by sorting the
frame, because `discover`'s directory path returns a name-indexed frame carrying
`program` and nothing else.

**App side, only what the payload change requires.** `examples.js` renders
`payload.items` with no headers or dividers, `buildIndex` stops deduplicating by
name, the hardcoded `186` in the search placeholder reads the payload length
(the library has been 151 for some time), and the Ctrl+Shift arrow ring in
`main.js` walks `data.items`. The pill row, the filter bar and the fuzzy search
are phases A4 and A5.

## 1.0.0a121

**[Chart-2D-Punchups] the control strip goes per panel, and three axis windows
stop lying.** The app half, A1 to A6, of the paired plan
`dev/done/plan-2d-punchups.md`, which is canonical for the whole change. The
library half landed at `aggregate 1.0.0a314` and this runs against it: the
environment must be synced before any of it is believed, or `importlib.metadata`
keeps reporting the old `aggregate` and the moved axes never arrive.

**One group per panel, with a rule between them** (author ruling 2026-08-21).
This reverses `dev/done/plan-plot-ir-api.md` section 6's one-control-per-document
rule and restores the arrangement `dev/done/plan-exhibit-punchups-3.md`
describes, which the a62 chart-IR rewrite collapsed into a centered row. It is
what properly fixes the a-generation punch item "log y on rh plot triggers
reshape/draw of left plot; left plot should not move/change"
(`dev/api-punchlist.md:238`), which section 6 had resolved by answering it
differently rather than by fixing it. Pressing anything in one group now leaves
every other panel's axes character for character unchanged, which the smoke test
asserts per panel. `reference lines` moves into the group of the panel whose
marks it suppresses, so the restored arrangement is two groups rather than the
older three.

**`log` becomes `log x` and `log y`.** The single button could not draw a log
ordinate over a linear loss axis, which is the reading wanted most often, and a
split by screen position could not have either: an `agg`'s loss axis is read by
both panels, so one flag would have drawn it on log in the density panel and
linear in the Lee panel. Per-panel groups dissolve that, since each panel answers
for itself. A panel offers on every axis that can reach a position rather than on
the one occupying it now, which is the existing invertibility argument extended
to the `reflect` and `return period` substitutions; without it the P&L's Lee
panel would have lost the log reading it has today, its outcome axis being signed
and its `p` single scaled.

**`full range` means the declared extents and nothing else.** It no longer falls
back to the drawn data, which is what labeled a probability axis to 1.5: the
severity quantile curve's last cumulated probability is `1.000000000000002`,
floating point rather than a reading, and the nice-window rounding took that
outward. An axis declaring no extent now has nothing for the button to open.

**The log release is a separate question and acts on a density ordinate alone**
(author ruling 2026-08-21). Punchlist item 7, "when we go to log, get rid of any
capping", collided head on with the new return-period ladder once a314 gave the
`mass` axis a declared extent: releasing every declared extent under log would
have opened the ladder to 1e9 on `log x` alone and left `full range` nothing to
do. The split is by what the axis is, keyed on `unit == 'density'`, because a
density's suggested top is the tallest thing worth seeing in the *linear*
reading, a statement about a picture, while every other axis' suggestion is a
reading of the quantity and survives the change of scale. Keying on the unit
rather than the screen position is what carries it through `invert`. So `log y`
on an `agg` density panel puts the severity block's head back, measured at 49
times the suggested top on the fixture and 79 times on the author's own program.

**The return-period axis keeps its window, and its companion stops keeping
one.** Four independent faults on two lines of `xyPanel`, each enough on its own:
the release was keyed on the scale the axis happened to be drawn on rather than
on a reading anyone chose, the declared window was then discarded outright, the
`MAX_RETURN_PERIOD` clamp was gated so it could never fire and was dead code, and
the companion rule's two conditions were exactly swapped against the comment
above them, so the period axis lost its window and the loss axis kept a crop
computed for the probability reading. ECharts was left auto-fitting a log axis
over twelve decades, picking a ten-decade tick interval and printing
`100000000000B`. The axis now draws its declared ladder to 1-in-10,000, opens to
1-in-1e9 under `full range`, reads on log under either, and follows onto y under
`invert`; the clamp survives as a backstop for a document that declares nothing.

**No `VIEW_KEY` bump**, per the test `dev/done/plan-chart-reflect.md` records: a
key is bumped when a stored value would now mean something *wrong*, as v3's flat
`window` did. The six flat readings are merely unread, so a held blob spreads
over the new defaults, `panels` takes `{}` and every panel takes its defaults.
`kind`, the surface preferences, the cut position and the per-chart `windows` all
survive, which a bump would have silently discarded. `migrateChartView` strips
the dead keys on the next write and now runs on the current key as well as the
superseded one, since this move leaves its dead keys inside `v4` rather than in a
key already being dropped. Readings are held per panel id, which is a gain rather
than a cost: `density`, `lee`, `kappa`, `occurrence` and `aggregate` carry one
meaning across every document that uses them, so `log y` chosen on a density
panel carries from an `agg` to a `port` to a P&L.

**Fixtures re-captured** against a314, since every chart ETag moved with the
axes. `dev/scripts/smoke-charts.mjs` checks readings per panel, asserts the
isolation claim, and gains the assertion that would have caught this: the
`Return period` axis always carries a finite window and never one above the cap.
The old check passed cleanly on the bug because the min was `undefined` rather
than zero, so the defect was an absent bound rather than a bad one.

**Not done, and owed:** the browser pass, sections 5 and 6 of the plan's
verification. The two things no offline check stands in for are the group
alignment over the panels at both sides of `WIDE_PX` and the sticky state
carrying across documents.

## 1.0.0a120

**The tag chips join the note on the status strip, and the Overview header block
is retired.** a119 left that block drawing tags alone, which was a vestige: the
tags were still stripped from the served declaration, so the row was empty for
every library entry and drew something only for a hand-typed `tags{}`. Both
fields belong in the same place, and that place is the strip.

`examples._decl_of` now keeps the whole trailer. The tuple of clause patterns it
used to strip is gone, and with it the reasoning that the menu item's own `note`
and `tags` fields made the clauses redundant. They are not redundant and never
were: the fields feed the menu row and the search index before anything is
built, and the clauses are what survive into the object, which is the only way
the strip can report either. `hints{}` was always kept and is unaffected.

`tags` rides on the build response beside `note`, off `_summary_fields`, so all
three manifest paths carry it.

**The chips are the ones from the old header, and they had to change color.**
There they were `--soft` on the white page. The strip's own ground *is* `--soft`,
so the same chip would have vanished into it; they are one step darker than the
strip instead (`#e7e7e7`), which also holds against the two tinted grounds a
warning and a failure paint, both lighter than that. Chips first, then the note
running on after them, wrapping as one paragraph rather than the note starting a
line of its own under a short row of tags.

**The header block is deleted, not emptied.** `renderOverviewHeader`,
`loadOverviewHeader`, the `head-overview` div and the `.overview-head` and
`.overview-tag` rules all go, and with them Overview's `/v1/objects/{id}/meta`
fetch on every build. The route stays and is still where the program and its
hints are asked for; nothing in the app asks it now. The block had been shedding
tenants since a48, when the name and the kind left it for the same reason the
note and the tags have now: the strip already carried them, better placed.

## 1.0.0a119

**The library's own entries keep their notes, and the note is on the strip
only.** a118 put the declared `note{}` on the status strip and it worked for
exactly one case, a program the reader typed themselves. Every entry loaded from
the Examples menu or the landing gallery arrived with its note already gone, so
the object built from it carried none and the strip had nothing to print. Which
is most of the library: 154 of its 170 entries carry a note, 97 of them `agg`.

**Where it went.** `Recipe.decl` is `spec_to_decl` followed by `format_program`
at the default `trailer=False`, and that argument drops the `note{}` that
`spec_to_decl` had just written. The app then stripped `note{}` a second time on
its fallback path, believing the field carried on the menu item was the whole
story. It is not: the menu field is what the row and the search index read
before anything is built, and the clause inside the program is what makes the
built object carry it afterward. Both are needed and they are not duplicates.

`examples._decl_of` now spells the pair out with `trailer=True`, which is what
`routes.objects` already does for the `.agg` export and for the same reason,
then strips `tags{}` alone. Tags classify the entry for the menu and say nothing
about the object, so they stay out of the editor; the note is the entry's own
account of itself and belongs in the program that declares it. Verified against
the whole shipped library: the new text reproduces `Recipe.decl` exactly on 169
of 170 entries once the note is removed, and the one exception is the composite
distortion whose `Recipe.decl` was already empty and which falls back to the
stored program as before.

**Placement is the library's business, which is the real reason to route through
its writer.** DecL binds a trailer clause to the declaration it follows, so the
note goes last on an `agg` and directly after the name on a `port`, before the
first unit. Writing it at the end of a portfolio instead binds it to the last
unit and leaves `Portfolio.note` empty, silently: the program parses and the
object builds. `format_program` gets this right, and `test_examples.py` now
builds one entry of each kind and asserts the note reached the object, with the
`port` case there to catch exactly that.

**And the note is no longer printed twice.** The Overview header block drew it
too. That row is drawn for one group where the strip is drawn under all six, so
the copy that survives is the one the reader can see from wherever they are. The
header keeps the tags.

A paragraph stood here claiming `TwoLineBook` and `BodoffWindQuake` carry their
`note{}` after the last unit in `library.agg`, repeating an open item in
`dev/TODO.md`. It is wrong and was never checked. Both entries put the note
directly after the portfolio name, correctly, and have since `aggregate`
1.0.0a159 wrote them. The TODO item wants deleting rather than doing.

## 1.0.0a118

**A program's `note{}` now prints on the status strip, on every build.** It goes
in the strip's note slot, between the facts line (name, kind, bs, log2, mean,
CV, validation) and the timing line, so the reading order is what the object is,
what its author said about it, then how long it took or that it came from cache.

Verbatim, with no label. The slot is already the place on the strip where prose
lives rather than instrument readings, so a sentence appearing there is
self-evidently a sentence; a leading "Notes:" would spend a line's worth of
width saying what the reader can see. The declared note leads the slot's three
tenants because it is the only one the object carries on its own account, and
the other two, a derivation's account of what it just did and the library's
build warnings, are then remarks about the build that just ran, in the order
they happened.

**The note rides on the build response rather than being fetched.**
`_summary_fields` reads `obj.note` and `BuildResponse` carries it, so all three
paths that build a manifest report it: the cache miss, the cache hit, and the
one a derivation returns. `GET /v1/objects/{id}/meta` was the obvious source and
is the wrong one: it is requested once per object and only while the Overview
group is open, so a reader sitting in Pricing or Reinsurance would never see
what the program says about itself. The Overview header keeps drawing the note
too, which is a duplicate on that one group and left alone for now.

Verbatim means the whole field, including the `sharpen: ` verdict the library
merges into it (`aggregate._program._SHARPEN_NOTE`, the chunk `capability.py`
already tests for). After a Sharpen the strip therefore carries the library's
sentence beside the author's. Trimming it down would be the app editing the
object's own words, which is not the app's call.

## 1.0.0a117

**A tap on the 3-D surface places the cuts, and every chart has a reset that
actually resets.** `dev/plan-idevice-ui.md`, phase 3, which closes the plan's
code. Phase 4 is a device round in the author's hands and carries no code unless
it finds something.

**New module, `web/src/charts/touch.js`, and it compensates for a defect in a
dependency rather than in this app.** The chain, each link read in the shipped
source: `zrender` finds no usable pointer events on Safari and takes its touch
branch; it normalizes a touch event by writing `zrX` and `zrY`, and a
`TouchEvent` carries no `offsetX` or `offsetY`; `zrender`'s `Handler` copies
those onto the event **packet**, which is why orbit rotation already worked on
an iPad; and then `echarts-gl`'s `LayerGL` drops from the packet back to the raw
event before calling `pickObject(e.offsetX, e.offsetY)`, which on touch is
`pickObject(undefined, undefined)`. Nothing is picked, so no data event fires, so
the `click` handler that places the cuts never runs. Three more lines in
`LayerGL` have the same defect, which is why hover and the surface readout were
dead there too, and why they come back with the same cure.

`stampTouchCoordinates(host)` attaches one **capture phase** listener each for
`touchstart`, `touchmove` and `touchend` and defines the two properties from
`changedTouches[0]` against the touch target's own rectangle. Capture phase on
the host is what makes this work without patching anything: zrender's listeners
are on its viewport root, a descendant, so ours runs first and the coordinates
are there by the time `LayerGL` reads them. It hangs off `host` rather than the
chart instance, so it survives the dispose and re-`init` that switching between
the flat and relief readings performs. The dependency is left alone, and the
docstring names the file and line so the next reader can check whether a later
`echarts-gl` has fixed it and the shim can go.

**One limit this does not answer, deliberately.** zrender synthesizes a click
from touch only when `touchend` lands within 300ms, and a carefully aimed tap on
an iPad often takes longer; the native click iOS sends afterward is discarded
too, inside a 700ms touch guard. The recognizer that would answer it is sketched
in the plan's section 6 and is not built until the device says it bites.

**One `resetView`, reached from the button, the double click and the puck.**
There were two and they disagreed: the button put the surface's readings and
camera back and left a held `zoom` in place, so a zoomed relief stayed zoomed
after being reset, while double click dropped the zoom and touched nothing else.
Each was half a reset. The surface's own reset leaving a held zoom behind was a
bug on every device, not only on an iPad.

**The `reset` button now exists on every chart, and it is last in the group.**
It lived inside the surface-only block, so a 2-D chart had no button at all, and
double click was its only route: spent on page zoom on iOS, and refused by the
touch guard besides. A reader could pinch a chart into a corner and the only way
back was to leave the leaf and come back. The rule, stated because the group has
grown: reset acts on the whole drawing rather than on one reading, so it goes
after the readings, after the surface controls, after the mesh export cluster and
after the realization control. **On a surface that moves it**, from mid group
ahead of the mesh buttons to the end.

**A dead guard is deleted rather than kept.** With `reset` always appended,
`if (!box.childNodes.length) return null` covers a case that can no longer arise,
so it goes. The author ruled `reset` unconditional on the reading that every plot
has some controls in practice, which a check of the realizations bears out.

**One gap for a ruling rather than a quiet widening.** `resetView` restores the
relief's readings only when the realization is a surface, which is what the plan
specifies. A `heatmap` also offers `contours`, so a reader who turns contours off
on a flat grid and presses reset still has them off. It is one line to extend if
the author wants the button to mean the same thing in both readings.

**Tests.** `touchPoint(rect, touch)` is the pure half of the shim and is split
out for exactly that reason, since the listener needs a DOM the web suite does
not have. `web/test/touch.test.js` covers a rectangle at the origin, one down the
page, and a touch outside it, which reads negative rather than clamping because
picking nothing is the right answer for a touch that missed. The suite is 88
tests, up from 85. The strip changes need a DOM and get none: their verification
is this diff plus the device round.

## 1.0.0a116

**The program history walk reaches a finger, and the counter starts counting
up.** `dev/plan-idevice-ui.md`, phase 2. Five defects in one control, which is
why it took a phase of its own rather than a line in phase 1.

**Two buttons in the editor's right margin, stacked: up, the readout, down.**
The walk was `Ctrl+↑` and `Ctrl+↓` and nothing else, and an iPad's on-screen
keyboard has no arrow keys, so on the device the author is demoing on there was
no route to it at all. The page already half knew this: the key hints fold away
below `sm` because phones have no Ctrl key, which left the `[m/n]` readout
visible on a phone describing a control the reader could not operate.

The nav sits with the box it navigates rather than on the action row, which
already carries Build, Examples, Reformat and a five-wide derive group. Both
buttons are present from the first paint, greyed, so nothing moves when the
first program lands, and neither refocuses the editor: walking is not a prelude
to typing, and on a phone a refocus pops the keyboard over the thing the reader
is looking at.

**The counter counts up now, JupyterLab style, and the cap raise is what makes
that honest.** The newest entry carries the highest number: the first program
built is `[1/1]`, the second `[2/2]`, and stepping back from the tenth reads
`[9/10]`. This reverses the a68 ruling deliberately. That ruling's argument was
that a counter whose position changes on every build (`[19/19]`, then `[20/20]`,
then `[20/20]` again once the cap bites) describes the pile rather than your
place in it, and the parenthesis is the whole argument: it is about **the cap**,
not the direction. At 20 entries the number froze within a day of use. At 500 it
climbs on every build for as long as anyone will use the app in one sitting,
which is the point of a number that moves.

**So the store went from 20 entries to 500, with a 256KB character ceiling
beside it.** The ceiling is the cap that actually binds: a DecL program is
short, the landing program is 63 characters and a large portfolio about a
thousand, so 500 entries is roughly 150KB in an origin that gets about 5MB. The
oldest end is trimmed until both hold, and the newest entry always survives.
`save` no longer swallows a refused write in silence, which at 20 entries meant
nothing and at 500 would drop the program just built: it retries once on a
trimmed copy and adopts the copy only if that lands. Retrying on a copy matters
beyond a full store, since a browser with storage switched off refuses every
write, and trimming the live entries there would eat the session's own history a
quarter at a time.

**The arrows are drawn to match the numbering, and that is the one thing a later
reader could get backwards.** Up steps to an older program and a lower number,
down to a newer one and a higher number. Stacked, the buttons draw the list they
walk: oldest above, newest below, the way a notebook puts earlier cells higher
and a terminal puts newer output lower.

**An unbuilt draft is stashed and handed back.** Walking away from text no build
has recorded used to throw it away, and walking forward ran out at the newest
entry rather than returning it. `Ctrl+Z` did recover it, since `setText`
dispatches a real change into CodeMirror's own history, but nothing said so and
a phone has no `Ctrl+Z`. The draft is now held in the stored state, handed back
on one more step forward off the newest entry, and kept rather than spent so it
can be walked down to again. It is not an entry, so it has no number and the
readout draws blank, exactly as it does before the first build.

**The walk stops dying on keys that are not typing.** It ended on any unmodified
keydown, so `Shift` held to start a selection, or `Home`, `End`, `PageUp`,
`Escape` or `Tab`, all silently ended a walk in progress. The test is now the
event that was always meant: the document changed. `setText` marks its own
transaction with an annotation so the walk does not reset itself when it loads
an entry.

**And the keys tell the truth about themselves.** `Mod-ArrowUp` resolves to
**Cmd** on a Mac and on an iPad, where `navigator.platform` reports `MacIntel`
and `maxTouchPoints` is 5, so both halves of CodeMirror's own test fire. Every
hint on the page said `Ctrl`. `Ctrl-` is now bound beside `Mod-` for all four
arrow bindings, so either key works everywhere, and a `modifierName` helper
copied from CodeMirror's own test writes the right word into the two button
titles and the three hints that hardcoded it.

**Two things worth knowing.** The touch targets are 2.1rem, or 33.6px, against
Apple's 44px guidance, and that is a deliberate trade: there is no more room
without pushing the stack outside the editor box or moving the clear icon, and
what 44px guards against is pressing the *wrong* control, which does not arise
when everything around these two is dead margin. If the device round says
otherwise, the escape hatch is to move the clear icon to the bottom right, which
buys 44px squares. And the four hints that are still not platform aware
(`Ctrl+Enter`, `Ctrl+Space`, `Ctrl+K`, `Ctrl+Shift+U`) have the same defect on a
Mac, out of this plan's scope and left for a ruling rather than widened into it.

**`.cm-content` reserves 54px on the right**, in the editor theme rather than in
`site.css`, since CodeMirror injects its theme at load and a plain `.cm-content`
selector in the stylesheet would win or lose on injection order. It is a channel
rather than padding: a glyph a long line runs under is ugly, a button a long line
runs under is broken.

**Tests.** `web/test/history-walk.test.js` goes from 6 cases to 14, covering the
reversed direction, the stash walked away from and back to, both predicates at
both ends and on the draft, and both caps. The suite is 85 tests, up from 77.
The DOM half was read against a real page instead: the width reservation from
a115 measured identical in both states, the greyed tab's tooltip still draws,
and the geometry landed on the plan's arithmetic to the pixel, with the stack
ending at 127px inside a 144px box.

## 1.0.0a115

**The tab strips stop moving under a thumb, and a double tap stops zooming the
page.** `dev/plan-idevice-ui.md`, phase 1, the first of three. Both items are
defects on a touch device and neither changes what the app can do.

**Every tab is laid out at its selected width now, and the selected state looks
exactly as it did.** `.out-tabs .nav-link.active` and `.sub-tabs .sub-link.active`
carry `font-weight: 700` while the rest inherit normal weight, so selecting a tab
made it wider: 5.5px on Overview, 1.9px on More, measured on the live site. Every
tab to the right of the change moved by that much on every switch. With a mouse
it is nothing. With a thumb the target moves while you aim at it, and on the leaf
row, which is `flex-wrap: wrap`, a width change can rewrap the row, drop a leaf
onto another line and move everything below it.

The fix reserves the width rather than dropping the bold, per the author's
ruling: each tab carries `data-label` repeating its own text, and a block
`::after` at zero height draws that text at 700, laid out and not painted. A
zero-height block contributes to the element's intrinsic width and to nothing
else, so the box is always as wide as its bold label and the visible text never
moves inside it. Six static attributes in `index.html` and one line where the
leaf buttons are built. No JavaScript runs at paint time.

**The measured price, so it is not a surprise later.** Reserving the bold width
widens the group strip by about 5px a tab, roughly 30px across the six. On an
iPad in portrait it goes from about 575px to about 605px against roughly 720px of
usable width, so nothing changes. On a phone, where the strip already scrolls by
60 to 70px under 576px, it will scroll by 90 to 100px. A strip that scrolls a
little further is a lesser problem than a strip that moves while you aim at it.

**One collision the plan did not foresee.** An element has one `::after`, and the
greyed tab's `data-why` tooltip already claimed it. That rule outranks the ghost
on `content` and on the paint, but it declares nothing about `height`, `overflow`
or `visibility`, so the ghost's `height: 0; overflow: hidden; visibility: hidden`
would have leaked in and hidden the tooltip, which is the explanation a dark tab
owes the reader. The tooltip rule now undoes those three explicitly.

**`touch-action: manipulation` on `body`.** The page declared no `touch-action`
anywhere, so a stray double tap zoomed it, and a zoomed page pans under a finger
with the sticky header drifting across the content: the most likely reading of
the "floating around" report. `manipulation` keeps panning and keeps **pinch
zoom**, which is how a reader magnifies a dense table, so this is not an
accessibility regression; only double tap to zoom goes. Page wide, and the
scoped alternative declined, per the author. It is the third member of the iOS
family in `site.css`, beside the two 16px input bumps that stop Safari
magnifying the page when a small field takes focus.

**Not verifiable from a Windows desktop.** Both items are iOS behavior. They ride
to the author's iPad with phases 2 and 3, and the checks are written out in the
plan's phase 4.

## 1.0.0a114

**The PnL button writes a priced book: every cession carries a premium, and the
warning the library used to raise about it is gone.**
`dev/done/plan-pnl-button-punchup.md`, phase A1, which completes the plan. It
needed `aggregate` 1.0.0a306, `[PnL-Reinsurance-Pricing]`, and could not land at
a113 because that release did not exist yet.

**Passthrough, and nothing else.** `PnlProgramRequest` gains
`net_combined_ratio`, `occ_combined_ratio` and `agg_combined_ratio`, `post_pnl`
forwards them, and the library builds the premium from the bottom up: net
technical premium plus the cost of each cover, summed, then grossed up once for
expenses. Nothing in this repo computes a premium, a rate or an expected loss.
The button still posts an empty body, so the defaults are where the app's
opinion about a demo book is written down.

**Three defaults diverge from the library's, deliberately**: a 90 percent net
combined ratio, occurrence cover at 75 and aggregate cover at 65, against an
upstream `None` that means "leave the cover unpriced". This endpoint serves one
app whose button is demo sugar, and a reader adjusts the numbers in the box
afterward, which is the whole reason this is DecL rather than a form. A test
holds all five field names to the library's signature and asserts the three
divergences by value, so neither the drift nor the opinion can go unnoticed.

**Every ceded premium is a `deposit`, a currency amount, and the app has no say
in it.** The drafted plan had a sixth field, `working_attach`, choosing between a
`rate` and a `rol` quote by probability of attachment. It does not exist: a
`rate` is a fraction of the P&L premium and that premium is what the ladder is
computing, so the library removed the split rather than solve the circularity.
A layer whose program already carries a `rate` clause is refused upstream and
surfaces here as a 422 naming the layer, which beats writing a book whose
numbers quietly do not add up.

**A portfolio engine keeps the old path.** The ladder prices the cessions of a
single aggregate engine and refuses a portfolio by name, so sending the app's
defaults to one would turn every portfolio press into an error pane. They are
dropped for a portfolio only when the caller did not ask for them: an explicit
`net_combined_ratio` reaches the library and is refused there, because silently
ignoring what a caller asked for is worse than refusing it. The consequence
worth knowing is that a portfolio P&L is still sized off `loss_ratio` while an
aggregate one is sized off the ladder.

**One existing test changed rather than broke.**
`test_pnl_premium_keeps_the_cents_when_small` pinned a premium of 10.5 sized off
`loss_ratio`, which the ladder now overrides by default. It switches the ladder
off for that arm, keeping the exact expectation, and gained a second arm on the
default path, because the rounding rule has to hold on both.

## 1.0.0a113

**One button, two steps of one story: wrap a program in a P&L, then break that
P&L out layer by layer.** `dev/plan-pnl-button-punchup.md`, phases A2, A2b and
A3. Phase A1, the premium the P&L is written at, waits on its companion plan in
the library (`dev/plan-pnl-reinsurance-pricing.md`) and is not in this release.

**`POST /v1/objects/{id}/explode`**, a derivation like the four beside it: it
answers with DecL plus the object that text builds, so the program lands in the
editor and history, sharing and rebuild all keep working. `pnl` and `xpnl` share
an identical body in the grammar, so the transform is the leading keyword plus a
`peel bottom-up` clause. Nothing is recomputed: this is a rewrite of the program
the object was built from, not a re-render of the object.

**The trap is where the `peel` clause goes.** The rule is `... expense_less
peel_clause trailer`, and a P&L inherits its engine's trailer: an engine carrying
`note{...} hints{...}` wraps into a P&L carrying both after the expense clause.
Sharpen and Hints write exactly those clauses, so appending the peel at the end
would be a parse error for any program that had been through either button. The
clause goes in front of the earliest of `note{`, `tags{` and `hints{`, which is
safe because a P&L carries at most one trailer: the inline engine slot has no
trailer of its own, which is why `pnl_program` lifts the engine's onto the
wrapper in the first place.

**Two gates, both read off the live object rather than guessed from the text.** A
portfolio engine is refused with a 400, because `xpnl` over a portfolio raises
upstream ("the portfolio total hides its units, so there is nothing to explode")
and refusing here lets the button go dark instead of making the press produce an
error pane. An engine with no reinsurance still explodes and simply writes no
`peel` clause: that is the correct `xpnl`, one group per step with a single step,
where the clause would be refused for having no layers to walk.

**The button carries both states and says which one it is in.** `PnL` over an
aggregate or a portfolio, `Explode` once a P&L is what you are reading, greyed on
a program already exploded. `can_explode` is the new capability flag behind the
second state, false for a `PnL` built by `xpnl` and false over a portfolio
engine. `can_pnl` and `can_explode` are never both true, which is what lets one
button carry both. The way back from an exploded program is Ctrl+Up, exactly as
for any other derivation, so there is no third state to press.

**A fix that had been wrong quietly.** `_has_reinsurance` now looks through a
`PnL` to its engine, as it already looked through a `Portfolio` to its units. A
`PnL` has no `occ_reins` attribute at all, so a P&L over a reinsured engine had
reported `has_reins` false on every build response since the P&L work landed. Two
things ride on it: the summary strip's flag, and the choice of moments in
`_summary_fields`, which prefers the realized pair net of a cession because those
are the ones describing what is on screen and had been handing a reinsured P&L
the analytic pair.

## 1.0.0a112

**An operator's page, private by three independent mechanisms, and the audit log
finally records who asked.** `dev/done/plan-site-status-page.md`, phases S0 to S4,
executed as one bump because none of them ships alone: instrumentation with
nothing reading it, or a page with no route behind it, is not a working thing.

**The trap first, because it is the one that would have been arrived at
independently.** Both Caddy front doors `reverse_proxy 127.0.0.1:8001`, so
`request.client.host` is loopback for a visitor from the public internet exactly
as much as for one on the VPN. A gate written as "allow if the peer is loopback"
would test green on the laptop, test green over the VPN, and publish the page to
the whole internet. The gate reads `X-Forwarded-For` instead and reads the
**last** element: Caddy appends what it observed, so a visitor who sends
`X-Forwarded-For: 10.8.0.2` arrives as `10.8.0.2, <their real address>`, and
reading the first element hands them the page. `net.py` holds the rule, its
module docstring holds the reasoning, and `tests/test_status.py` holds eight
cases including that exact forgery. Reading the last element is correct for
exactly one trusted proxy, which is a deployment invariant and is written down in
three places.

**The same fact was already a bug.** `_client_ip` read the peer and nothing else,
so every production row in the audit log recorded `ip = '127.0.0.1'`, the
`builds_ip` index indexed one value, and `AuditLog.by_ip` could not answer the
question it exists for. It delegates to `net.client_address` now. Rows written
before this release are not retroactively meaningful, and the by-address panel
on the new page is the first time that breakdown says anything.

**Three layers, none trusted alone.** The public Caddy block gains `/v1/status*`
on the matcher that already 404s `/docs`, which is the layer that needs no trust
in application logic at all. `require_private` is the app's own gate, deny by
default, refusing with 404 rather than 403 so the page's existence is not
advertised, and logging the refusal because one on a correctly configured box
means something changed. `AGGAPI_STATUS_REQUIRE_ZONE_HEADER` is built,
documented and off: it is the only layer that survives a mistake in the CIDR
list, so turning it on is a setting rather than a change. `AGGAPI_PRIVATE_CIDRS`
defaults to `127.0.0.0/8, ::1, 10.8.0.0/24`.

**What the page shows.** Versions loaded beside the process start time, which is
the standing `importlib.metadata` trap made visible at a glance rather than after
an hour. Live session forks with what each declared and built, and eviction split
by cause, because expiry, capacity and an explicit drop mean different things to
whoever is asking why sessions keep vanishing. The object cache in LRU order, so
the table answers "what will I lose next" rather than "what is oldest". Build
latency and error mix over the last hour and the last day, queried in SQL against
the existing audit table. Process memory and CPU. And the panel the plan calls
its strongest argument, below.

**Whether the a110 cache rule is behaving.** Session isolation phase A3 asked for
shared keys to be counted against session-qualified ones, in these words: "a
qualified rate near 100 percent in a demo would mean the rule is misfiring." a110
landed the audit column and neither the counters nor any way to read them. They
are here, split by the two reasons, which mean opposite things.
`session_reference` is the rule working. `preview_unavailable` is the previewer
declining to speak about a program, which is usually a program about to fail its
build and is occasionally the previewer refusing what the builder then accepts:
there a shareable object took a private slot and a room pays a build each. That
narrow class, previewed `None` and built anyway, is the one thing this page keeps
verbatim, because it is an upstream ask against `Underwriter.preview` and an ask
needs the program rather than a paraphrase.

**The plan was drafted against session isolation v1 and has been corrected.**
That plan shipped as v2 and dropped content addressing, so the draft's
"key derivation health" panel described a fallback path that does not exist. It
was rewritten against what a110 actually landed before any code was written; the
plan records the finding in its header and nine execution divergences in its
section 6.5.

**Retention, stated as an invariant rather than as limits.** The status subsystem
persists nothing and holds nothing unbounded: counters are plain integers, text
lives in `collections.deque` with `maxlen` set, and everything else is a query
against something already bounded. Restarting clears all of it by construction.
Fifty programs at two thousand characters, twenty refusals, five hundred timing
samples, roughly 250 kB. The audit log on disk is deliberately untouched, and its
retention stays an open question the page now makes visible by showing the file
growing.

**Session ids never travel in full.** An id is a namespace and not a security
boundary, so anyone holding one gets that session's objects. The cut happens
server side rather than in the page, in the three places one can reach the wire,
because truncating in the page would leave the JSON carrying a list of other
people's namespaces for anyone who saved it. The timestamp survives whole and
eight characters of the uuid go with it, which correlates with a log line and
does not impersonate.

**The page is one file and does not go through Vite.** `scripts/build-web.ps1`
wipes `static/` on every run, so a copy there would be deleted by the next
deploy, and a status page whose delivery depends on the pipeline it reports on
cannot report on that pipeline failing. It is `status_page.html` inside the
package, inline CSS and JS, no imports, served by an explicit route: the same
argument the `_ASSETS` allow-list in `routes/meta.py` already makes. Dense,
monospace, tables rather than charts, auto refresh with a pause control.

**Two things measured rather than assumed.** Object sizes are arithmetic on
`log2` and labeled estimated, because `sys.getsizeof` would walk into numpy and
pandas and, worse, would materialize the lazy frames it was trying to measure, on
a timer. And the route does not load the recipe library in order to report on it:
it reads `get_underwriter.cache_info()` and says the library is not loaded yet,
which on a cold process is true and is cheaper than the two seconds the naive
version would have spent measuring its own request. The whole payload costs 25 to
40 ms warm on the Windows development box, of which `psutil` is about 17, and
`generated_in_ms` rides in the payload so a regression of a different order is
self evident.

**`psutil` is an optional extra**, `uv sync --extra status`, with a stdlib
fallback over `/proc` that covers the Linux VPS. A field that cannot be filled
reads "unavailable" with the reason, never zero, because a resource panel
reporting zero resident bytes is worse than one reporting nothing. Worth
declaring even though `psutil` already arrives transitively through `ipython`:
that is an accident one unrelated dependency change away from not holding, and
the tests force the fallback path because nothing else ever would.

**The capability drift panel earned its place on the first request.** It compares
the live exhibit and chart registry counts against the numbers the oversight
charter records, expecting a future library bump to make it interesting. It is
interesting now: 16 exhibits and 9 charts against the charter's 12 and 8, the
difference being the four pricing exhibits and the `kappa` chart the library
registered at a259 to a263. Reconciling the charter is an oversight task, not
this one.

**Deployment.** One Caddy edit on the public block, documented in
`human-hints.md` with the topology reasoning, the single-hop assumption, the
install line, and a three-command verification that checks the refusal as well as
the answer. The third command is the one worth running after any Caddy change:
the first two pass whenever layer one is intact, and only the third says layer
two is still there.

## 1.0.0a111

**The residue: an expiry that says what it lost, a sharpen that leaves other
people alone, and the one rule that keeps shared pricing safe.** Phases A5 to A7
of `dev/plan-session-isolation.md`, which closes the plan.

**Expiry has an answer, not just a failure.** A session id lives in the browser
and outlives the fork it names: idle past the TTL, evicted under pressure, or
gone with a server restart. After that a program referring to something the user
built themselves refers to nothing. The build route already answered 422 with the
library's sentence, which is correct and not actionable, so `RecipeNotFound` now
comes back structured, `{error, kind, name, message}`, caught around both the
preview and the build (the deferred `sev agg.NAME` resolves at build time, so the
referent can go missing between the two). `error-pane.js` renders it as its own
pane, `history.findDeclaring` looks for the program that declared the missing
entry, and when it finds one the pane carries a **Rebuild `agg Name`** button:
`main.js` builds the inner, then re-presses Build on the text still in the
editor. The fix is one press rather than a paragraph.

**The Examples menu reads the process base, and now says why.** It looks tidier
for the menu to take a fork like everything else, and it would be wrong:
`_library_only` drops `source='session'` rows, and overwriting a library name
marks it session-sourced in that user's fork, so a fork-built menu would lose the
very entry the reader went looking for. The reasoning is in `_library_only`'s
Notes and pinned by a test.

**Sharpen is additive.** It moved the cached object in place and re-filed the
entry under the new program's id, dropping the old one. On a personal instance
nobody notices, because the only viewer is the one who pressed the button. On a
shared one it changes the grid under everyone else reading that object and kills
the id they hold, and the object cache is shared on purpose. So the probe now
runs on `copy.deepcopy` of the object, taken under the entry lock the route
already holds, and files the sharpened copy as a **new** entry while the original
stays exactly as it was. Measured cost: 10.5 ms for a log2 16 aggregate and 31.4
ms for a three-unit portfolio, against rebuilds of 73.5 and 453 ms. The new entry
gets its own lock, since it is a different object and sharing one would serialize
unrelated readers. `test_the_entry_moves_with_the_object` becomes
`test_the_sharpened_object_is_a_new_entry` and asserts the opposite of what it
used to.

**Pricing and bounds are unchanged, deliberately.** They write result attributes
onto the object they price and the object is shared, so the residue is real. It
is accepted on measured grounds: nothing in this repo reads any of it back, and
every request recomputes from its own form. The one condition attached to that
acceptance is now written into `pricing.py`'s module docstring as a standing
rule: **every call from here passes its own target and its own distortions
explicitly, and never leans on a library default that reads
`self.distortions`**. A method falling back to the stored fit would serve this
request an answer struck for whoever priced the object last, plausibly and
silently. `tests/test_sessions.py` pins the residue directly: two sessions
calibrate one shared object at different targets, each gets what its own form
implies, and the answer over the shared object is byte-identical (object name
aside) to the same calibration over a private one.

## 1.0.0a110

**One recipe base per session, and a cache key that knows the difference.**
Phases A1 to A4 of `dev/plan-session-isolation.md`, which is the fix itself. Two
users on one process no longer write into one namespace, and no user is served an
object built from somebody else's declaration.

**The fork.** `Underwriter.fork()`, upstream for this work, is a copy whose
recipe dict is a fresh dict over the same parsed `Recipe` objects: about 6
microseconds against the 3,185 milliseconds a fresh load costs. New
`sessions.py` holds `SessionRegistry`, a bounded LRU with a TTL modeled on
`ObjectCache`, and `normalize_session_id`. `AGGAPI_SESSION_MAX` (500) and
`AGGAPI_SESSION_TTL_S` (eight hours) size it; a fork is cheap enough that the
count is generous and the TTL does the work.

**The identity.** The SPA mints `<utc timestamp>-<uuid4>` into `sessionStorage`
(new `web/src/session.js`) and sends it as `X-Aggregate-Session` on every
request. A reload keeps the id; a new tab mints a fresh one, which is the
strictest reading of the author's ruling that a returning user starts afresh.
The header moved outside `_json`'s `body ?` ternary, which used to leave GETs
with no headers object at all. The `.agg` download takes the id in the query
string instead, because `window.open` is a navigation and cannot carry a header.
`cors.py` allows the header, without which only split-origin deploys would have
broken, which is precisely the deploy that most needs this.

**A session id is a namespace, not a credential.** Anyone holding yours gets your
objects. That is why no login is needed, and it is written into the module
docstring so nobody builds anything on it that would matter if it leaked. A
missing or unusable id falls back to one per-process anonymous session, so `curl`
and the test suite keep working and keep today's collision behavior among
themselves.

**The key rule.** The object cache keyed on program text, which stopped
determining the object the moment a reference could be in it: Alice's
`port Book agg.Line` and Bob's are the same eight words over different inners. So
`post_object` now previews before it keys. A program that resolved nothing, or
resolved only entries read from the library file, keeps the shared key and is
built once for the whole room, which is the conference case of a hundred people
on one hero example. A program that touched anything its own session declared,
**including a library name that session overwrote**, is keyed with the session id
joined to the hash (`cache.qualified_object_id`). Unrecognized provenance
qualifies: a redundant build costs one build, a wrongly shared one serves the
wrong answer.

The rule reads what the parse resolved, never the text. `Underwriter.preview`
reports it, including the bare-name route, which is the one program shape that
never reaches the parser and the hole any lexical scan would fall through, and
including the deferred `sev agg.NAME` chain followed to exhaustion.

**A cache hit registers too.** Nothing was parsed on a hit, so without this the
user served a cached object could not then refer to it: their next `agg.NAME`
would fail on a name their own base never saw, and their `.agg` download would
omit it. The bare-name route registers nothing, since filing that statement would
re-mark a library entry as this session's and every later program naming it would
qualify for no reason.

**What it costs, stated rather than discovered.** A hit now pays a parse it did
not pay before, tens of milliseconds against builds measured in hundreds, and a
miss parses twice. The reorder also moves parsing outside the single build slot
for the first time, so previews genuinely run at once; `tests/test_sessions.py`
carries the threaded parse hammer and the registry-contention pin that say so.

**The routes.** `_run_build` takes the caller's base as a parameter rather than
reaching for a global. The `.agg` download's canonical form reads the caller's own
fork, so its scope is honest for the first time; its `raw` form still walks the
process-wide object cache and now says so. `_resolve_risk` builds its DecL
fragment in the caller's base, where it used to register a user's ad-hoc line in
the process base. `post_hints`, `post_pnl` and `post_reins` hand their fork to the
`post_object` they call. `post_sharpen` re-files under the same key rule, or the
rebuild would miss the slot it just wrote.

**The audit row** gains `session_id` and `key_scope`. The second is the one number
that says whether the rule is working: a demo where nearly every build is
`session` means it is firing on programs that did not need it. A database written
before this release is migrated by `ALTER TABLE ADD COLUMN`, guarded by a
`PRAGMA table_info` read, since `CREATE TABLE IF NOT EXISTS` leaves an existing
table alone and every insert would otherwise fail on the column count.

Not in this release, and next: the Examples menu still reads the process base
(correct, and pinned in a111), the expiry path's own error pane, sharpen on a
deepcopy, and the pricing-residue comment. Sessions are in-process memory, so a
multi-worker uvicorn would silently shard them: keep workers at 1.

## 1.0.0a109

**One recipe base for the process.** Phase A0 of
`dev/plan-session-isolation.md`, which stands on its own: it fixes a live bug
and it is the natural parent of every fork the rest of that plan takes.

The api had two recipe bases and did not know it. `examples.py` built a private
`Underwriter` for the Examples menu whenever `--library` was set, while all
three build paths went on resolving against `aggregate.build`, the shipped
singleton: the build itself, the `.agg` download's recipes read, and the
`_resolve_risk` fragment build. Under the default library the split is
invisible, because both names reach the same object. Under a custom one it has
two faces. An entry is browsable in the menu and any program naming one of its
siblings fails to build, since the base doing the parsing never read the file.
And the download lists the session rows of a base the menu did not come from.

New `library.py` holds `get_underwriter()`, an `lru_cache(maxsize=1)` over what
was `examples.py`'s private `_underwriter`, and the four call sites take it.
`create_app` clears it beside `get_settings`, for the same reason: which library
it reads is a setting, and a test that just changed that setting would otherwise
get the base built for the previous case. `tests/test_library.py` is the fixture
library the plan asked for, two entries with the second naming the first;
`test_a_program_may_reference_a_library_entry` is the one that fails on a108.

**`AGGAPI_EXAMPLES_FILE` becomes `AGGAPI_LIBRARY`.** The setting stopped being
about examples the moment it started feeding builds. The old name is accepted
for one release through an `AliasChoices` and warns once per settings read;
`--library` sets the new name. `Settings.knowledge_base` is deleted outright:
the library retired the knowledge base at `1.0.0a164` when `recipes` replaced
`knowledge`, nothing in `src`, `tests` or `web` ever read the setting, and its
comment claimed a default (`"test_suite"`) that its value (`"default"`)
contradicted. `--library` already carries that job under the right name.

Behavior under the default library is unchanged: with nothing set,
`get_underwriter()` returns `aggregate.build` itself.

## 1.0.0a108

**The doc defenses come down.** `aggregate` retired the `doc{{{...}}}` clause
over a298 to a301 (`dev/done/plan-decommission-docs.md`): the Quarto cookbook
and its renderer left the repository, the library's invariants became ordinary
pytest, the seven long-form write-ups left `library.agg`, and the clause left
the grammar. Its section 6 left the timing of the app's side to the app. The
clause can no longer be produced, so the timing is now.

**Nothing here was ever a feature.** Every touchpoint was defensive, and the
load-bearing one was a regex: in a stored program the doc body was the
preprocessor's base64 one-liner rather than the readable text, so `examples.py`
had to strip it before it could reach a user's editor. That pattern now matches
nothing and is deleted, along with the `_STRIP_CLAUSES` comment explaining it,
the `doc` audit-flag reference in the module docstring, two "doc-free"
descriptions of `Recipe.decl`, the `ObjectMetaResponse` paragraph on why the
clause was deliberately absent, and `get_meta`'s version of the same. `note` and
`tags` stripping is untouched.

`test_example_decl_is_doc_free_and_reloadable` becomes
`test_example_decl_is_trailer_free_and_reloadable` and loses its `doc{{{`
assertion; the docstring records what that assertion was for, since it was the
one that mattered. `test_meta_reports_the_trailer`'s `"doc" not in body` stays
and changes meaning: with the clause gone it guards against a field being added
rather than against one leaking, and says so.

Behavior is unchanged. Verified clean and nothing owed:
`web/src/decl-keywords.json` never listed `doc`, and nothing in the app ever
imported `aggregate.cookbook`.

## 1.0.0a107

**Hints, the third derivation.** A button between Sharpen and PnL, and
`POST /v1/objects/{id}/hints`: the object's own declaration comes back carrying
`log2`, `bs` and `normalize` as it actually computed them, merged into whatever
`hints{}` it already had rather than replacing the clause, so a declared
`padding` survives and only the grid moves. `Aggregate.with_hints` and
`Portfolio.with_hints`, upstream since `aggregate` 1.0.0a291.

**Why it earns a place next to Sharpen.** A `sev agg.NAME` reference requires
the referenced declaration to state `log2` and `bs`, because the reference
stands for the distribution that declaration *outputs*, so the declaration has
to say at what resolution or the severity moves with the ambient defaults
instead of with the model. The library's resolver refuses an unpinned target and
its error names this very method. So this is the step that turns a candidate
inner into one an outer may reference: get it right interactively, press Hints,
build the text it hands back.

Sharpen's quiet twin, and the difference is worth stating: Sharpen asks whether
a better grid exists and moves to it; Hints keeps the grid you have and writes
it down. `test_hints_pins_the_grid_the_object_built_on` asserts the grid did not
move, which is the whole distinction.

**No request body and no cap guard, both deliberate.** `with_hints(**extra)`
accepts further hint keys, but the app has no opinion to offer about `padding`
or `normalize` and a form for them would be the app holding a view about the
library's settings. And unlike the probe, which can land above `AGGAPI_LOG2_CAP`
and so needs clamping in `post_sharpen`, this writes down the grid the object
**already built on**, which exists only because the build route let it through,
so the pinned `log2` is at or under the cap by construction.

`description` is empty, like PnL and unlike Sharpen: the result *is* the
returned text, and narrating it would be the app talking over the library.

`can_hints` joins the capability block, read off `with_hints` and deliberately
not folded into `can_pnl` even though both are true for exactly an `Aggregate`
and a `Portfolio` today. The route list at the top of `routes/objects.py` gains
all four derivations, none of which it had ever mentioned.

## 1.0.0a106

**A deploy can now say it wants the api alone.** `aggregate-api --headless`, or
`AGGAPI_SERVE_SPA=0`, and the web app stops being mounted at `/`. Everything
under `/v1` stays, as do `/docs` and `/openapi.json`.

Headless already worked, by accident: the mount in `app.py` is conditional on
the bundle directory existing, and `static/` is gitignored and built at deploy,
so an install that never ran the web build was already api only. What was
missing was a way to *state* it. Absence of a build cannot be set on a machine
that has one, does not appear in the config, and left `AGGAPI_STATIC_DIR`
pointed at a nonexistent path as the only explicit off switch, which is a trick
rather than a setting. `_resolve_static_dir` now refuses first and stays the
single place that decides whether to mount.

`README.md` gains a "Running headless" section pairing the flag with
`AGGAPI_CORS_ORIGINS`, which is the rest of what a third-party front end needs,
and saying plainly that `/v1` is pre-1.0 and shaped by what aLL wants, so the
flag is not read as a stability promise.

**`/docs` is now pinned by a test, not by luck.** FastAPI registers the
documentation routes in its own constructor, before `create_app` mounts
anything, and Starlette matches in registration order, so the SPA's catch-all at
`/` never shadowed them. That was true by construction and stated nowhere.
Headless is the mode where the Swagger UI is the only interface, so it is the
mode where losing it would matter most. `tests/test_headless.py` points
`AGGAPI_STATIC_DIR` at a real directory holding a real `index.html` in every
case, because against an absent bundle `/` is 404 whether or not the flag works
and the suite would pass for the wrong reason.

**Two stale references to a button removed at a58.** Reset left the action row
because `Ctrl+↑` and `Ctrl+↓` already walk the programs you built and a button
that undid exactly one derivation was a second, weaker way to do it. The Keys
panel still listed it, and `renderReinsEntry` still told the reader that Reset
comes back to the gross object. Both now name the history walk.

## 1.0.0a105

**The library caught up, so the scaffolding comes down.** `aggregate` 1.0.0a281
to a285 landed phases N1 to N5 of `dev/plan-pricing-natural-allocation.md`, on
top of a277 to a280 from the companion notes, which is everything a103 and a104
were written against. `needs_split_allocation` is deleted from
`tests/conftest.py` and from all seven tests that carried it,
`check-nav.mjs` expects `pricing:plot` live for a reinsured aggregate and a
book, and `dev/fixtures/capability.json` is recaptured: `kappa` is registered
for exactly those two. Nothing is skipped and nothing is pending.

**Two assertions were wrong about the library rather than about the app**, and
both for the same reason. `aggregate` 1.0.0a286 to a288 turned the column
formats into a raw sheet with an insurer overlay, so RAW and INSURER now hash
apart wherever they carry the same frame: the plain aggregate's stand-alone row
and the whole occurrence allocation, both of which had asserted hash equality
inherited from a85. The claim they were making is still true and is now made
against the values, through a `_raws` helper, with the formats free to differ.
That is the correct reading of the two perspectives under the purist ruling:
the values are the calculation, the formats are how it reads.

**Two bugs the browser found that the suite could not.** The Allocate form was
left out of `renderSummary`'s per-build sync, so its basis row drew the previous
object's answer: on a program with an occurrence cession it greyed all three
views and said to add one. And the Calibrate press drew `activeLeaf('pricing')`,
which since a104 can answer `plot`, a leaf with no table and no `PRICING_LEAF`
entry, so the destructuring threw where a pane should have been drawn. Not
reachable through the UI, because the form is hidden whenever Plot is the active
leaf, but it is a crash sitting behind one wrapper's `d-none`. The press now
names its own two panes, which is also the truer statement of what it fills.

**Every acceptance criterion of the plan is met**, checked in the browser on
both reference programs. On `BasicBookRe` calibrated gross at `coc=0.15,
p=0.99`: Stand-alone carries the starred basis and the `gross less net`
difference rows unchanged, Allocate foots ceded plus net to a gross row constant
down the table, and Plot draws the two-panel band chart, cession against gross
outcome with its conditional band beside the same reading as a share under the
single-layer ceiling. On the two-unit book: Stand-alone shows the units, the sum
of parts and the total with the diversification difference row under INSURER,
sum above total for every concave family, and Plot draws the unit kappa curves
with the total. The Allocate basis row offers Gross alone on a cession, saying
"net and ceded are this tab's outputs, not its inputs" on the view it refuses.

## 1.0.0a104

**The Pricing row becomes `Calibrate  Stand-alone  Allocate  Plot |
Evaluate`.** Phase B2 of `dev/plan-pricing-natural-allocation.md`, the pane
over the routes a103 built. The middle three are the shape of the argument.
Stand-alone prices each part as a distribution in its own right and sets the
sum against the whole, which is the diversification reading. Allocate takes one
calibrated premium and splits it across the same parts so they foot exactly,
which is the consistency reading. Plot draws the kappa curves the split is made
of. Read one after the other on a reinsured aggregate they give the three
different numbers for net that the pane exists to put side by side: net priced
alone, net as its share of the gross premium, and net calibrated directly.

**Stand-alone is the old Allocate tab, renamed and otherwise untouched.** Same
press, same document, same star and difference rows. A Portfolio reader loses
nothing from Calibrate either: what used to arrive with that press now arrives
with the Allocate one, which is where it was always being computed.

**Allocate is a second press with a form of its own**, and its basis row carries
one live button. A natural allocation splits a gross premium, so an aggregate
offers Gross alone there and the other two views stay drawn and dark, saying
"net and ceded are this tab's outputs, not its inputs" on hover. A book keeps
the row it has on Calibrate, Net alone, by the same 1.0.0a100 ruling. The press
writes the shared pentagon like every other verb and does **not** write the held
calibration: setting another leaf's state from a side effect is how a pane
drifts out of sync with its own button.

`createPricingForm` grew `basisOnly` and `basisWhy` for that. A form that
narrows the basis takes its own answer and neither reads nor writes the sticky
choice the other forms share, so stepping onto Allocate cannot change what
Calibrate is calibrating on one pill over.

**Plot is the first pricing leaf that fetches on activation**, and the only one
that can. A kappa curve conditions on an outcome rather than on a distortion, so
no form qualifies it and there is nothing for a button to add; it is an ordinary
chart leaf, gated on the library registering `kappa` and ETag-cached on
`doc_hash` like the rest.

**A disabled `Massive joint` toggle sits under the Allocate form.** It does
nothing and says so: the disk-backed joint cannot serve the kappa curve yet. It
is drawn rather than hidden because the house rule is that what is coming is
visible and plainly not ready, and it becomes a real switch when the library's
band iterator lands.

**Still ahead of the library, and the two markers that say where.** `check-nav`
expects Plot dark for every kind, because `kappa` is not registered yet, and
`tests/conftest.py` still carries `needs_split_allocation`. Both flip in the
commit that syncs against the landed library, along with recapturing
`dev/fixtures/capability.json`. Verified in the browser meanwhile on a two-unit
book: the five pills draw with Plot greyed and Allocate live, the Allocate press
fills its pane with the library's five blocks, and a plain aggregate greys
Allocate and Plot with the reason on hover.

## 1.0.0a103

**Pricing one premium across the parts is its own question, and now its own
press.** Phase B1 of `dev/plan-pricing-natural-allocation.md`, the api half of
a plan whose library half is in flight. Two things were living under one name.
Pricing each part of an object as a distribution in its own right and then
comparing them is not the same exercise as taking one calibrated premium and
splitting it across those parts so the pieces foot to the whole. The registry
called both `pricing.allocate`, and only the second is an allocation.

**The calibrate route serves `pricing.calibrate` and `pricing.stand_alone`.**
Same press, same two panes, and for a reinsured aggregate the same table to the
byte: every view priced on its own, the calibrated one starred, the difference
rows appended because gross less net is the buyer's allowance for reinsurance
rather than the price of the cession. Only the name moved, and it moved to the
one that describes it.

**`POST /v1/objects/{id}/pricing/allocate` is new** and serves
`pricing.allocate` under both perspectives. For a book that is the
`analyze_distortions` sweep, unchanged, byte for byte what a Calibrate press
used to return. For an aggregate carrying an occurrence program it is the
natural allocation off the joint distribution of gross and ceded, where each
family's distorted view of the gross sets the weights and ceded plus net foot to
gross exactly. Two costs move with it, both the right way: a book's Calibrate
press stops paying for a sweep it was not asked for, and the occurrence joint is
built only when someone asks for the allocation.

Stateless like its siblings, so a press recomputes. Nothing about a
`CalibrationResult` is cached server side, and holding one would mean a result
cache keyed on a form body.

**The basis is gated in both directions, structurally.** An occurrence
allocation splits a *gross* premium, so a fit struck on net has nothing to
split and the route says so in the reader's terms rather than letting an
availability predicate refuse it later. A book takes `net` alone, the same
1.0.0a100 ruling that governs the Calibrate row beside it: reinsurance is placed
at the unit level, so a book has no cession of its own to choose. An aggregate
that states no basis at all is read as gross, because the library's own default
is the object's own distribution, which for a reinsured aggregate is the one
view that cannot answer.

**New capability flag `can_natural_allocation`**, true for a portfolio and for
an aggregate whose `occ_reins` is not `None`. An aggregate cession is
deliberately not enough: the allocation reads the kappa curve off a
per-occurrence joint, and a program that cedes only in the aggregate has no such
joint to condition on. It is not `can_allocate`, which is the Bounds group's
per-unit range and stays a portfolio alone; for the same reason the runner is
`run_natural_allocation`, so `bounds.run_allocation` beside it in the route
module keeps meaning what it always has.

**Ahead of the library, on purpose, and the tests say where.** The sibling
checkout does not register `pricing.stand_alone` yet. Tests that need it carry
`needs_split_allocation` from `tests/conftest.py`, which reads the registry
rather than a version number, since the library phases land under numbers
assigned at execution. That marker and every use of it is deleted in the commit
that syncs against the landed library. Everything not waiting on it runs: the
new route's refusals, the capability flag, and the book's allocation through the
new route, which is content that does not move.

## 1.0.0a102

**The two keyboard walks land where you can see they should.** Both fixes are
about the same thing, a cursor that starts unset and a step that read it as one
place when it is two.

**Ctrl+Shift+↑/↓ now steps the example library in the dropdown's own order.**
It always followed that order, topics in teaching order with the entries
name-sorted inside one, but it deduped on the decl as it flattened the groups,
on the argument that a repeat is not a ring. An entry filed under two topics is
a row under each, so 20 of the 209 rows never got a turn, and they are not
spread evenly: 7 come out of P&L, 7 out of Numerics, 4 out of Bivariate. The
effect is an alphabet that runs cleanly through Aggregate and Severity and then
goes gap-toothed exactly where the cross-tagged entries are, so the walk reads
as an arbitrary order rather than as the list on screen. It now walks every row
of every group, a repeated entry included, which is what the dropdown shows.
Picking a row syncs the walk to that row's identity rather than to the first
entry with the same program, so resuming from a second showing resumes there.

**The first press of Ctrl+↑ no longer does nothing.** `history.prev` read the
unset cursor as "start at the newest entry", and straight after a build the
newest entry is the program already in the editor, so the opening press replaced
the text with itself and moved the readout from `[1/n]` to `[1/n]`. It is told
what is on screen now and skips that one entry when it matches, which makes the
first press land on `[2/n]`, the behavior `position` has documented since a68.
Nothing changes for the other reading of an unset cursor: once you have typed,
the newest entry is somewhere the walk has not been and stays the first stop,
which is what a shell does with a half-typed line. The example ring had the same
fault in its own dialect, where `-1` stepped backwards to the second-to-last
entry and the last one was unreachable on an opening press.

`web/test/history-walk.test.js` covers the walk in both readings of the unset
cursor, the stops in each direction and the two refusals at the ends.

## 1.0.0a101

**The Bounds pane answers before you press it.** The pricing form's preview
line now runs under all three Bounds leaves, on the same 350 ms trailing
debounce, the same 120 ms dim and the same ticket against out of order answers.
The pane said nothing at all until a press, and the press is fifty resamples.
One pentagon solve, documented in `pricing.py` as the cheapest question in the
group, says what is about to be swept.

It also puts the refusals in front of the button. `Bounds` rejects a premium
below the expected loss or above the cap, and the line shows `M` or `Q` going
non positive before the reader commits to the wait. That is the principle
already established for the library's unbounded anchor guard, that a refusal is
the preview text, applied to the pane where the wait is longest.

**`_calibrate_for_envelope` lost its arithmetic, and a bug with it.** It
completed the pentagon by hand: `L` from `prob_loss_assets`, then `M = P - L`,
`Q = a - P` and `coc = M / Q`. Besides being the api deciding what a price
means, which is the shape of thing the purist ruling is about, it **mixed two
asset levels**. `prob_loss_assets` snaps the level to the loss grid and reports
`L` there, while `Q` came off the caller's raw request, so the margin and the
capital were struck at different asset levels and the cost of capital they
implied belonged to no consistent pentagon. On a 50 claim lognormal book at
`log2=13` a request for 15625.068 snaps to 15624.0 at `bs` 4, and the two
readings are 0.13334437 against 0.13335957, about 1.1e-4 relative, scaling with
the distance from a grid point.

It is now one `price_pentagon(a=..., P=...)` call through the same
`_coc_for_premium` helper the premium target uses, so panel 2 is calibrated on
one asset level, the one the band is drawn at. The three `return False` cases
stay: an unbounded asset level still has no cost of capital to fit to, and a
premium at or beyond either boundary now reaches the function as the library's
own refusal rather than as a comparison written here, so one test covers both
ends. They fire less often than they did, because since a100 the pane opens on
a real calibration whose implied `(P, a)` has `M > 0` and `Q > 0` by
construction, so panel 2 draws where it used to vanish.

See `dev/done/plan-pricing-form.md`.

## 1.0.0a100

**Five leaves were asking the same question in three spellings, so they now
share one form.** `Aggregate.price_pentagon` takes exactly one capital anchor
and exactly one pricing target, and premium has always been one of the targets.
Read against that signature, Pricing / Calibrate (anchor plus CoC or LR),
Pricing / Evaluate (anchor plus premium) and the three Bounds leaves (anchor
plus premium, then sweep) are one form over a signature the library already
publishes. `web/src/pricing-form.js` is that form, built once and mounted five
times; the four hand maintained copies of the row are gone, along with the
Bounds group's separate vocabulary of `premium` and `assets` boxes.

**The pricing carries across the tabs.** One held value, `_pricing`, is the
completed pentagon plus the question that produced it. A Calibrate press writes
it, an Evaluate press overwrites it, a Bounds compute overwrites it again, and
every form opens on it. Last write wins, because there is one current pricing
rather than several boxes with private histories: an ad hoc premium tried on
Evaluate is the premium Bounds then sweeps, which is what that leaf is for.

This is not a convenience. `bounds._calibrate_for_envelope` re-derives a
calibration from the request's own premium so that the envelope's second panel
names distortions on the band the first panel draws, and its docstring says
they have to be the same premium or the two panels answer different questions.
Through a99 the Bounds form opened on `mean * 1.25`, a number chosen only to
sit above the expected loss, so unless the reader retyped the calibration's `P`
and `a` exactly the two panes showed the same five families struck at different
premiums, with nothing on screen saying so. Evaluate is the same story: its own
comment describes a round trip that recovers a calibration's parameters, and
its asset anchor was seeded by nothing and sat at `0.99` whatever the
calibration had used, so the round trip was documented and never offered.

**Premium is the third pricing target.** `PricingPreviewRequest` and
`PricingCalibrateRequest` gain a `premium` field and `_one_target` accepts
exactly one of three. `calibrate_distortions` takes a cost of capital or a loss
ratio and not a premium, so `_coc_for_premium` completes the pentagon first and
hands over the cost of capital it reports: two library calls chained, with no
arithmetic here. A premium target and the cost of capital it implies calibrate
to the same families, and the test asserts that approximately rather than
exactly, because the round trip loses a couple of bits (`0.15` against
`0.14999999999999997`) and every fitted parameter inherits it at about 1e-15.

**A reinsured Portfolio is locked to `net`, and this is a fix.** Reinsurance is
placed at the unit level: a book has no cession of its own to choose and takes
whatever its units produce. `Portfolio.reins_views` has reported `['gross',
'ceded', 'net']` since library a223 and `reins_bases_for` passed `gross` and
`net` straight through, so both were live buttons here. That was wrong in a way
the reader could not see. `CalibrationResult.pricing_df` allocates `density_df`,
the net book, whatever view is asked for, so a gross calibration arrived beside
a net allocation from one press and the pane labeled the pair as one
calculation. Measured on a two unit book: the calibrations differed, resolving
to asset levels of 2693.50 and 2599.50, while the allocations agreed to the
last digit on every unit (UnitA 951.470961, UnitB 999.356266) and the total
matched the net book at the net anchor. The upstream half, `pricing_df`
refusing a non-net `reins_view` for a `Portfolio` as `analyze_distortions`
already does, is an open ask. An Aggregate is unaffected: it places its own
cession, so all its views are its own.

**A pricing the Bounds group cannot honor withholds its seed rather than
carrying silently.** The three bounds classes take the object and answer on its
own distribution, with no `reins_view` to give them, so a reinsured Aggregate
calibrated on `gross` or `net occ` describes a different distribution from the
one about to be swept. The form says so where the preview line goes and leaves
every control live: a typed premium computes exactly as before. When
`reins_view=` lands on `Bounds` and `PricingBounds` the line goes and the seed
happens.

**The form is one line.** The row stated each choice twice, a `btn-group` of
radios naming the anchor and a `<span>` beside the input naming it again, and
the same for the target. The group stays and the span goes, so the control that
switches the box is the one that labels it, and the basis group folds onto the
same row: `calibrate on [Gross|Net occ|Net]  [0.99](p) ◦ [0.15](CoC)
[Calibrate]`, wrapping only when the viewport is too narrow. The `min-width:
2.3rem` on the three labels went with them, since it existed to stop the row
shifting on every switch (a live bug through a83) and a `btn-group` draws all
its members always, so its width does not depend on the selection.

`errorMessage` moved from `main.js` to `api.js`, beside the `ApiError` it
reads, because the form prints the sentence where `errorNode` mounts a node.

See `dev/done/plan-pricing-form.md`.

## 1.0.0a99

**The bounds envelope band draws where it belongs, for the first time since
a62.** The Bounds pane showed a wavy line at roughly `g = 0.2` labeled
Envelope, a shaded triangle under the identity diagonal, and no band at all
around the resampled or the calibrated curves. The served document was correct
throughout: `charts/_emit_bounds.py` carries the envelope as one series with
`y` the lower edge and `y2` the upper, and the library's own matplotlib
rendering of that document draws the band correctly. The defect was entirely
in this repo's ECharts realization, so it raises no upstream ask and the
purist ruling is untouched.

**What the adapter did wrong.** The `if (y2)` branch realized a band as two
line series sharing an ECharts `stack`, the lower edge with an invisible area
and the gap `hi - lo` stacked on top with the fill. The comment called it
exact because the two share one x array, and that holds only on a category x
axis. Both axes here are `type: 'value'`, and data stacking on twin value axes
stacks the **x** dimension: it sums the x coordinates and leaves y raw.
Confirmed outside the browser against this repo's own tree shaken ECharts,
where the stacked value at index 280 came back 1.0898, exactly twice the
0.5449 the document places there. Every artifact follows: the upper half drew
`hi(s) - lo(s)` for `s` in `[0, 0.5]` stretched across the panel, which is the
wavy 0.2 line, its right end at the gap rather than at zero, everything past
`s = 0.5` clipped, and the fill spanning from that stretched curve down to the
lower edge.

**What it does now: three series under the document series' one name, so the
one legend entry still toggles the whole region.** The two edges as plain
lines at `(x, lo)` and `(x, hi)`, the lower one keeping the readout and the
upper silent; and the region between them as a `custom` series polygon whose
vertices are the lower edge walked forward then the upper edge walked back,
mapped per vertex through `apiRef.coord` the way the surface panel's contour
overlay already is, so the fill stays glued to its edges through a zoom or a
window change. Built from the drawn record's own mapped arrays, so the axis
exchange and the reflected reading ride along with no special case, and a null
on either edge closes the ring rather than letting a polygon bridge a gap the
log hide opened. `CustomChart` was already registered. Nothing else moved: the
emitter, the document, and `legend.push(s.name)` are all as they were.

The smoke test gains `checkBands`, which asserts the realization rather than
the absence of an exception: three series per band, the two edges carrying the
document's own `y` and `y2`, no `stack`, and a ring that runs lower out and
upper back. Verified against a two-panel document (`Bounds(BasicBook, 25500,
a=31000)` with ten resamples and the five calibrated distortions) rendered
offline to SVG: the band contains every resampled curve, the lower edge sits
just above the diagonal, the upper edge is concave and reaches 1 near
`s = 0.8`, and the reflected reading draws the dual band. Plan:
`dev/done/plan-envelope-band-render.md`.

## 1.0.0a98

**The percentile reference lines leave the browser, and the app deleted
nothing to make it happen.** Upstream at `aggregate` 1.0.0a271
(`[Chart-Marks-Mean-Only]`) the emitters stopped marking return periods: the
`agg` density panel's 1-in-200, the faint 1-in-100 and 1-in-250 on the `agg`
and `pnl` Lee panels, and the 1-in-200 on both `port` panels. What survives is
the mean and, on a P&L, break even at zero. The app renders `doc.marks` and
holds none of its own, so the lines vanish on the sync. The purist ruling
working the way it is supposed to, for the second release running.

**Why they went: the readout strip already answers the question better.** A
percentile is a point on a curve the chart draws, and `readoutModel` writes
every series value at the hovered coordinate into the legend strip, printing a
return-period axis as `1-in-N`. A permanent dashed vertical asserting the same
number bought a label collision rule, a side rule and a place in every punch
up round, and returned a number that hovering gives for free. The mean stays
because it is a property of the whole distribution, and break even because
zero is where the sign of a signed outcome changes; neither is a coordinate a
reader can point at.

**What actually changed here is three strings.** The `reference lines` control
keeps its key, its `offer: 'marks'` gate, its default and its place in
`aggapi.chartView.v4`, so a stored `false` is still honored: only its tooltip
and the comment above it stop naming capital anchors. `state.mean`'s two
comments, stale since a62, now say what the value feeds, which is the Bounds
premium field and not a reference line the exhibit stopped drawing.

**The `rightmost` side rule stays, and one thing to know about it.** It gives
the right side to the vertical mark with the largest `at`, which used to be
the 1-in-200 and is now the mean, so the mean's label changes side on the
density panel. The rule is correct for one mark and correct again if a second
ever returns, so it is left alone rather than special cased for the count it
happens to see today.

Fixtures re-captured and `node dev/scripts/smoke-charts.mjs` clean:
`doc.marks` is 1 for `agg` and `port` and 3 for `pnl`, from 4, 3 and 5. Two
punch list items close with it, the button governing mean plus 100 plus 200
(partly: the button governs what is left) and the 1-in-200 label side (fully:
there is nothing left to overlap). Round 5 ask 4 closes by supersession, so
that note is fully done. Plan: `dev/done/plan-no-reference-lines.md`.

## 1.0.0a97

**The PnL button emits `derive premium`, and the button chain did not change.**
The button posts an empty body; the server calls the library's
`pnl_program(loss_ratio=0.70, expense_ratio=0.25)` and the app echoes the text
back. Upstream at `aggregate` 1.0.0a270 that method writes `derive premium`
whenever the engine states a premium: the technical premium T grossed up for
the expense clause the program already carries, `P = (T + fixed) / (1 -
premium ratios)`, so premium net of expenses returns exactly T and the
expected underwriting result is the risk load. With the default 25% clause
the booked premium is T/0.75 where it used to be T. An engine without premium
keeps the loss ratio sized head and the button behaves as before. Zero code
change in the chain is the purist ruling working as designed: the library owns
the meaning, the app draws what it is served, and the switch reached the
button by sync alone.

**The words moved where they were quoted.** The `post_pnl` route docstring,
the `has_premium` capability gloss and the `loss_ratio` field description all
said `inherit premium`; they now describe the derive head. The test pinning
the button's program renamed and asserts the new keyword.

**`decl-keywords.json` gains a `pnl` group, the file's first pnl vocabulary.**
`pnl`, `xpnl`, `inherit`, `derive`, `retro`, `peel`, `less`, `expense`,
`expenses`: the editor now highlights the whole clause and the offline
completion pool offers it, where before none of those words were known to the
client at all. `decl-mode.js` and `completion.js` flatten every group
automatically, so the JSON edit is the whole change. Server side completion
needed nothing: `derive` flows from the library's `_TERMINAL_LABELS` through
`/v1/decl/complete` on its own.

**One stale test corrected at the sync.** Upstream `[Allocation-Default-Linear]`
(`aggregate` 1.0.0a265) made `ccoc` allocate on an unbounded book at a finite
anchor, so the calibrate route's warning about the skipped family legitimately
stopped firing, and the test pinning that warning had been failing since the
library moved. It now pins the improved reality: `ccoc` rows present in the
allocation, warnings empty. Verified against the live route.

Synced against `aggregate` 1.0.0a270. Plan: `dev/done/plan-pnl-button.md`.

## 1.0.0a96

**A sixth declared reading, `reflect`, and the button that asks for it.** The
library is adding `ChartAxis.complement_of`, a paired axis declaring that a
probability axis may be read as its complement, `1 - v`. On a Lee panel that
turns the non-exceeding probability into the exceeding one, so the drawn curve
becomes the survival function, which with `invert` is `(x, 1 - F(x))`, the
reading the author wanted on the right-hand panel of the Overview plot. On the
unit square of a distortion or an envelope it reflects both axes and gives the
dual. Planned in `dev/plan-chart-reflect.md`, the app half of the library's
plan of the same name.

Nothing changes on the wire. `reflect` is a renderer switch, so the chart
route, its options, its cache key and its ETag are untouched, and toggling the
button re-realizes the document already in hand.

**The flip has to happen exactly once, and the library's plan does it twice.**
Its ruling 4 says that where both readings are asked for, reflect maps the
values *and* exchanges `complement` with `reciprocal`, "so the two compose".
They do not compose, they cancel: `complement(1 - v)` is `reciprocal(v)` and
`reciprocal(1 - v)` is `complement(v)`, so doing both returns the original
number on every document and `reflect` quietly stops acting wherever the
return period is on. This repo does one: it mirrors the coordinate and leaves
the document's map name alone. There is no flipped-map table, and the absence
is the point.

What that buys is the reading asked for, which is choosing **which end of the
curve the return period opens out**. A log return-period axis stretches
whichever end sends `T` to infinity, so on a loss, where the map is
`complement`, the period alone opens the right end and adding `reflect` opens
the left; on a signed payoff, where the map is `reciprocal`, the pair swaps the
shortfall for the upside. Raised upstream: the library's phase 5 asserts both
"identical to return period alone" on a `complement` document and `1 / (1 - p)`
on a `reciprocal` one, and those cannot both hold. The first is the double flip
written down as an expectation.

**`web/src/charts/reading-map.js`**, a new leaf importing nothing, holds
`readingMap` and the `returnPeriods` map moved out of the adapter, so the
composition is arithmetic in one place with a `node --test` over it
(`web/test/reading-map.test.js`, seven cases). The last of them is the guard
that would have caught the double flip on paper: on neither document may the
two readings draw the same curve.

**The map and the return period stop being the same variable.** `panelAxes`
returned `xMap`/`yMap` holding a map *name*, and two behaviors in the panel
realizer read their truthiness to mean "a return-period reading is live": the
`MAX_RETURN_PERIOD` cap, which exists because the quantile function saturates
and `T` diverges, and the companion-window release, which exists because a
return-period reading re-slices the panel into the deep tail. Neither is true
of a reflection, which is a bijection of `[0, 1]` onto itself whose axis
carries its own window from the emitter. So `panelAxes` now returns the
composed map and the period separately, and those two sites read the period.
Without that split a reflected panel would lose its bounds, its nice interval
and its zoom extent.

The button sits **between `full range` and `return period`**, making the
canonical order `log, full range, reflect, return period, invert, reference
lines`: the two probability readings together, and the strip read left to
right is the coordinate changes in the order they apply. Three buttons moved
once, which is stated in the `CONTROLS` preamble since the house rule there is
otherwise to append. No `VIEW_KEY` bump: the stored view already loads over
`VIEW_DEFAULTS`, so a new key takes its default on its own, and a bump exists
for when a stored key would mean something *wrong*, which `reflect: false`
does not. Bumping would have discarded every reader's sticky log, invert,
reference lines and surface preferences to no purpose.

**Inert until the library lands.** `readings.reflect` probes for
`complement_of`, which no served document carries yet, so no button appears
and no drawing changes. The smoke test's new block is skipped for the same
reason and the other ten fixtures stay clean, which is what proves the
`panelAxes` refactor changed nothing. The path itself is exercised against a
hand-built document carrying the field, confirming the axis substitutes, the
window survives, and `reflect` with `return period` reads `T = 1 / p` where
the period alone reads `T = 1 / (1 - p)`.

## 1.0.0a95

**`_round_pnl_premium` deletes, on the terms its own docstring set.** The
route rewrote `pnl_program` text to round the consideration before build,
because the library sized an uninherited premium at full precision and the
author wanted the rounding immediately. The rule moved upstream at
`aggregate` 1.0.0a251, where `_pnl_consideration` rounds the number where it
is produced, and that release's note already said the app's pass "is
idempotent... so it can be deleted on the sync that picks this up". This is
that sync: the function, its `_PNL_PREMIUM` regex and the call in `post_pnl`
go, and the route docstring points at the upstream home. Nothing observable
moves; the library hands the route an already-round premium.

**The round 5 ledger closes in `dev/TODO.md`.** The entry sat unchecked with
all four asks open; every one is resolved. Item 1 landed better than asked
(raw values in every exhibit at LIB a246, caller-set `max_rows` at a247, so
`spec_extra=` was never needed), item 2 is the deletion above, item 3
(`PnL.value_type`) landed at a248, and item 4, the density-panel reference
marks, is superseded by `[Chart-Marks-Mean-Only]`
(`dev/plan-no-reference-lines.md`, author 2026-08-13): the percentile lines
come off entirely and the readout strip answers by hover, so the redesign
that ask requested is moot.

## 1.0.0a94

**The Sharpen leaf joins the exhibit route, which was the last table drawn
from a frame this repo formatted itself.** More Sharpen now draws the
`sharpen` exhibit the library registered at `aggregate` 1.0.0a255: INSURER
leads with the score grid unstacked by `d_log2` (the library's ruling
`[Sharpen-Grid-Is-A-Reading]`: the score is a column read as a grid, not a
second fact), then the per-cell walk with its working, each block captioned
and formatted upstream, scientific notation on the six `u_*` moment-error
columns included. `loadSharpenAudit` and the two hardcoded block ledes it
carried ("Score grid", "Every cell") delete; the leaf goes through
`loadExhibitLeaf` like every other published table, so it answers the
page-wide Raw / Insurer switch for free, which the frame route never did.

**`tables.FORMATS` is empty, and the comment now says why it stays that
way.** The `sharpen_df` and `sharpen_score` entries were the last two, held
since a71 only because this leaf had not moved. Every entry the map ever held
was this repo asserting how the library's own numbers print; all of them are
gone the same way, a71 then a85 then now. `ROW_FLAGS` has been empty since
a71, so the app now carries no per-frame formats and no row emphasis at all.

**Nothing moves on the wire.** The `frame/{which}` route still serves
`sharpen_score` and `sharpen_df` for direct api use, rendered by dtype
inference like every other frame, and `test_capability`'s pinned agreement
between the `has_sharpen` gate and the frames behind it is untouched. The
leaf's nav hint, gate and lede are unchanged; only where the table comes from
moved. The frame-route inventory comments above `LOADERS` and on the
perspective switch update to match: what is left outside the exhibit loader
is Bounds, awaiting the library's registration, and the two densities,
permanently the grid's.

## 1.0.0a93

The author's round 7 punch list, nine items of it, all app side. One of the ten
is a library matter and is recorded rather than worked around; see the end.

**Quick Re wrote a keyword the grammar no longer has.** A share in the first box
emitted `50 so 5000 xs 2500`, and `so` was retired upstream at `aggregate`
1.0.0a249, so every Quick Re add with anything other than a whole line in the
share box came back a parse error. `po` is the one placement keyword now, and
the leading quantity is what says which reading is meant, so `composeCession`
emits the **percentage literal**: `50% po 5000 xs 2500` is half the layer, where
`0.5 po` would be read as an amount and give a placement of 0.01%. Verified end
to end: the clause parses, the program reformats, and the description line reads
"Net of 50% share of 3 xs 3 per occurrence". `dev/api-punchlist.md` round 7
item 11. The row's English is unchanged and still deliberately not the token.

**The Quick Re row reads as a sentence again**, in the author's own words:
`100% part of, from 50% attach to 95% detach`. Two operator words changed; the
comma moved from after `attach` to after `part of`, where it belongs once
`from` and `to` carry the layer. The three boxes narrow from 5.4rem to 3.9rem,
cut for the four characters of `100%` rather than for a text field, which is
what stops the row wrapping on a laptop.

**Every box holding a number is right aligned**, percentages included: the three
Quick Re fields, the four pricing and evaluation fields, and the two Bounds
amounts. The Bounds `against` box keeps its left edge, holding a unit name or a
DecL fragment rather than a number.

**Ctrl+Shift+V flips the perspective**, the second preference worth a keystroke
for the reason Ctrl+Shift+U was the first: it is the one you change while
reading, and the raw frame against the business reading is a comparison you make
by going back and forth. It yields inside an editable, which is the one thing V
needs that U did not: Ctrl+Shift+V is the browser's own paste-as-plain-text and
it means something in the program box and in every form field, so the shortcut
works everywhere else, which is where a reader stands when they want it.

**And the header says which perspective is in force.** `Raw | Insurer ·` sits
left of the versions, the active word lit. It is also the control: both words
carry `data-perspective`, so the click wiring and the tick sync that already
served the menu items pick them up with no second code path, and menu, header
and keystroke are three ways into one value.

**The chart legend stopped shuffling.** It is a legend that fills in as the
cursor moves, laid out left to right, so a number growing a character pushed
every name to the right of it along and reading one curve against another meant
watching the whole row move. Tabular figures on the head, a mono face on each
value, and a floor under both slots: measured across two hover positions, every
chip holds its width and its x to the pixel while the numbers change.

**A log axis is never cropped, and full range means full x and full y.** The
author's item 7, whose case is a severity spike: the agg chart's ordinate stops
at the *aggregate* peak whenever the severity peak is more than twice it
(`_emit_aggregate.ordinate_top`), so dice of dice draws its severity block with
the head cut off at 8e-2 when the block stands at 1.67e-1. Two changes, and
between them the picture has a way out. `axisWindow` falls back to the drawn
data's own extent where the document declares no `full_range`, so one button
releases both axes rather than only the one the library thought worth a
zoom-out. And an axis that goes log releases on the way there, because room to
see everything is the whole point of asking for a log scale. Reading the data
rather than second-guessing the library keeps this inside the purist rule: how
much of what was served to show is a question about drawing.

**Exponential tick labels keep their decimal place**: `1.0e-4`, never `1e-4`.
a62 stripped a trailing `.0` as the tidier label, and tidier is what it is on
its own; in a row of ticks it is the one label in a different register, and half
a decade lattice reads `1e-4, 1.5e-4, 2e-4` with every second label a place
shorter than its neighbors. The heatmap colorbar had a real duplicate rather
than an inconsistent one: it labeled the height in the exponent it is held in,
rounded, so a bar running from 10^-8.2 to 10^-8.0 printed `1e-8` at both ends.
It now raises the height and prints the value, the same reading the tooltip
gives a cell.

**The landing is dice of dice, in the editor from the first paint.** Through a92
the page asked `/v1/examples/heroes`, picked one at random and built it, so the
editor showed one program and swapped to another when the fetch answered, on a
route that takes ~2 s cold because the first call loads the whole recipe
library. A fixed program has none of that, and dice of dice is a good landing
for the same reason it is a good first example: a die for the count and a die
for each claim is a compound distribution the reader can check by hand. The
heroes route and its client method stay, for the showcase that is to return
inside the Examples dropdown.

**Not fixed, and upstream: the Reinsurance plot's occurrence panel answers none
of the control strip** (round 7 item 12). Confirmed at the document rather than
guessed: `charts/_emit_reins.py` gives that panel a `claim` axis that offers no
log reading, and a `sev_density` axis that is log with no alternative, so the
`log` button can never touch it. On an unlimited program `_claim_window` returns
`None`, and the axis is then given **neither** a suggested nor a full range,
because `full_range` is written as `None if claim is None`; so `full range` has
nothing to act on either, though the full extent `(min(0, x[0]), x[-1])` is
knowable whether or not the limit bounds the window. `return period` and
`invert` are declared by the aggregate panel's axes alone. The library owns what
readings an axis offers, so this is an upstream ask and not an app patch.

No Python changes. Web suite 64 passing, `check-nav.mjs` clean.

## 1.0.0a92

**Every 2-D chart said "not published by the library yet", on every object, and
the library had nothing to do with it.** The window box, offered while a surface
realization is on screen, wrote its depth into the one flat sticky view state
that every chart on every object shares, `aggapi.chartView.v3`. `chartParams`
then attached that depth to every chart fetch; the chart route answers 422 to
any emitter that takes none of the grid options, which is every 2-D chart; and
the pane reported that refusal in `notDrawable`'s words. One number, turned once
on one surface, and agg, port, severity, distortion and reins went dark
everywhere until localStorage was cleared. Diagnosed and fixed per
`dev/plan-plot-2d-fix.md`. The route behaved exactly as designed and is
untouched, as is its pinned 422 contract in `tests/test_objects.py`: it named
the offending parameter precisely, which is how the diagnosis took minutes.

**The window is now held per chart.** `VIEW_DEFAULTS` loses `window` and gains
`windows`, a map keyed by chart registry name; the box reads and writes its own
chart's slot; a fetch carries a depth only for the chart the depth was set on.
The map needs no list of which charts take the knob, because the box only ever
renders on a document that realizes as a surface, so the stored key set
maintains itself and a future grid chart gains its slot the day it offers the
box. The view key moves to `aggapi.chartView.v4`: a stored v3 migrates minus its
`window` and the old key is dropped, so a poisoned browser heals on its next
load with no user action.

**A fetch that failed now says so, in its own words.** A first fetch that
carried parameters and failed retries once with none, so held request state can
cost a reader the depth they asked for and never the chart. When that retry
fails too, `mountChart` throws rather than returning null, and the Overview and
Reinsurance panes put up `fetchFailed`: a request failure rather than a gap in
what the library publishes, worth trying again. `notDrawable` keeps its "not
published" wording for the case it is actually about, capability offering
nothing.

**The decision is a leaf module with tests.** It broke for want of three lines
that could have been checked, and it was uncheckable because it lived against
DOM state, next to a localStorage read at import time and an echarts import that
will not load outside a browser. So `web/src/charts/request-params.js` imports
nothing, the `surface-grid.js` arrangement and for the same reason, and holds
`chartParamsFor`, `windowsWith` and the v3 migration.
`web/test/request-params.test.js` exercises them under `node --test`, eight
tests including the one that is the whole bug: a depth set on `joint_surface`
reaches no other chart. Web suite 64 passing. No Python changes.

## 1.0.0a91

**The exported surface gets its color, and stays a surface.** The author opened
the a86 OBJ in 3Dconnexion's viewer and named what was missing: it is just the
surface element. The ruling, 2026-08-12, is that the shell is right and the
color is what it wanted, so the phase 1 stretch in `dev/plan-spacemouse.md` is
settled as **GLB with vertex colors**: `meshToGlb` writes a glTF 2.0 binary
carrying positions, per vertex viridis and a double sided material.

**One file, which is the argument against OBJ with an MTL.** A material file is
a second download that has to land in the same folder under the name the OBJ
writes, and a texture would be a third; a reader who saves one of three has a
mesh that renders untextured and no way to know why. STL cannot carry color at
all. So `.obj` and `.stl` stay geometry and the colored reading is its own
format.

**Colored by the numbers the colorbar uses**, not by the box. `surfaceMesh` now
returns the drawn height beside each vertex, and `meshSource` carries
`colorRange`, the visualMap's own `[zMin, zMax]`. The box reaches below `zMin`
so the relief has a floor to stand on, and coloring against it would shift
every hue off the screen's. The ramp is passed in from `theme.js` rather than
restated, so the file and the colorbar cannot disagree, and the values are
written **linear**, as glTF requires: raw hex would read washed out in every
viewer that gets the transfer function right.

The mesh row is now `mesh | .glb | .obj | .stl`, three short buttons under one
label rather than three sentences.

Verified in the running app on `CopulaWindFlood`: a 679 kB GLB, 14,238
vertices, 28,000 triangles, a valid container end to end (magic, total length,
padded chunks, `BIN`, POSITION bounds), and a color spread that runs the ramp
from the floor to 0.8 of the way up at the mode, which is the picture on
screen: mostly dark, with the peak bright.

## 1.0.0a90

**The probe met the puck, and it found two things.** The author ran
`/dev/spacemouse-probe.html` on the SpaceMouse Wireless; the findings are
written into `dev/plan-spacemouse.md` phase 2, which closes the last open
deliverable of that phase.

**A button report that could press its own reset.** This unit sends report 3 as
**twelve** bytes with one byte of content. The mask was read with a shift per
byte, and JavaScript's bitwise operators work on int32: byte 4 shifts by 32 and
wraps onto bits 0 to 7, so anything appearing there would read as button 1,
which is the camera reset, firing itself in the reader's hands. The mask now
stops at four bytes and is read unsigned, with a test that fails on the old
arithmetic.

**The vertical pan ran the wrong way.** The rule is that the picture follows
the hand: press the cap down and the surface goes down with it. The puck
reports a press as *positive* TZ, so the vertical needs the opposite sign from
the horizontal, and a88 shipped one sign for both. Corrected, with the
measurement recorded beside it rather than a convention asserted.

**What the run confirmed and left alone**: the combined report layout, chosen
by length with no change (report 2 never appears on this unit); the single
multi axis collection, so there is nothing for `preferred()` to choose between;
travel of exactly plus or minus 350, which is where `TUNING.scale` now comes
from rather than from documentation that happens to agree; buttons at bits 0
and 1 as phase 3 assumed; and no double action from 3DxWare, whose service was
live throughout, so the driver stays installed and nothing needs configuring.
Report 23 is the battery, and dropping it silently was right.

## 1.0.0a89

**Phase 4 of `dev/plan-spacemouse.md`: the feel, which is the difference
between working and wanting to use it.** A `feel` button on the surface row
opens `web/src/charts/spacemouse-panel.js`: four gain sliders (twist, tilt,
zoom, pan), the shaping curve, the deadzone, a reverse flag for each of the
five axes that drive something, the one axis at a time option, a live readout,
and a reset to defaults. Sticky under `aggapi.spacemouse`, in the same try and
catch the chart view state uses, so a browser that refuses the write gets a
control that works and forgets.

Every gain is per second at full deflection, which is the only unit in which a
number here means anything you can feel, and the panel says so. A slider moved
with the cap held takes effect on the next frame: the panel writes
`nav.settings`, which the loop reads every tick, rather than at the next
connection. The deadzone goes to the device layer instead, where the axes are
normalized, so it is held once rather than twice.

Roll has no reverse flag, because it drives nothing: an orbit camera has no
roll, and a control over nothing is worse than no control.

**A row under the strip rather than a popover.** Nothing floats over the chart,
nothing has to be positioned against a button, and the panel can be as tall as
it needs. The live readout sits inside it for the same reason: it is the tuning
loop made visible, so it belongs beside the sliders it justifies, and covering
a corner of the canvas with numbers about itself is the wrong trade. It writes
straight into its nodes on each report, and only while the puck is moving.

**Browser pass, on `CopulaWindFlood`.** The relief draws with the four new
controls on the row; both writers run in the page, producing a 1.4 MB STL of
28,000 triangles at exactly `84 + 50n` bytes with the header and the document's
own title in the filename, and an 817 kB OBJ whose second line records the box
and the drawn height axis; the panel opens with its six sliders at their
defaults and redraws with the readout without leaking its subscription;
switching to the flat reading and back, and toggling contours and marginals,
leaves the strip and the console clean. What could not be exercised is the
device itself, which needs the author's puck: that is the phase 2 findings
block and the acceptance list in the plan.

## 1.0.0a88

**Phase 3 of `dev/plan-spacemouse.md`: the puck drives the relief.** A
`spacemouse` control on the surface row connects a 3Dconnexion device over
WebHID, once per browser, and after that it reattaches silently on every
reload. Twist orbits, tilt raises the camera, push and pull zoom, slide pans,
and the two buttons put the view back and swap perspective for orthographic.
Mouse dragging keeps working throughout, between gestures and during them.

**Two modules, sharing no vocabulary.** `web/src/spacemouse.js` is the device
and knows nothing about charts: feature detection, the chooser behind a user
gesture, `getDevices` for the silent reattach, `connect` and `disconnect`
listeners for sleep, wake and a receiver replug, and parsing into six axes in
[-1, 1] with a button mask. `web/src/charts/surface-nav.js` is the integrator
and knows nothing about hardware: the mapping table, the gains, the shaping
curve, the camera relative pan basis and the loop. It imports nothing at all,
which is what puts its arithmetic under `node --test`.

**Both documented report layouts are parsed**, chosen by the report's own
length: three translations under id 1 with three rotations under id 2, or one
combined report carrying all six. The author's unit has not been read yet, so
this is deliberate rather than accidental generality, and the probe page writes
reports in the form the tests take.

**The camera contract is honored the way `surface.js` documents it.** The loop
reads the live camera, adds the tick's deltas and writes a partial
`viewControl` back, and only while deflected: centered axes stop the loop and
send nothing, so a mouse drag between gestures is untouched and the damping
feel survives. A puck that goes silent for 300 ms is read as released, because
a camera that drifts on after the hand comes off is the worst failure this can
have. The chart is reached through two closures rather than held, so a rebuild
between frames cannot leave the loop driving a disposed instance.

**`readCamera` now carries `center` and `projection`** alongside the two angles
and the distance. Without that, panning the camera off the middle of the box
survived until the first control toggle and then snapped back, which is exactly
the failure the function was written to end for the angles.

Greyed with a why where WebHID is absent, which is Firefox, Safari and the
iPad: the control says the feature exists, that this browser is not covered,
and that the `.obj` download is the way in there. Nothing about the gl path
changes and the `echarts-gl` pin is untouched.

`web/test/spacemouse.test.js` and `web/test/surface-nav.test.js`: both report
layouts, the button mask, an unknown report dropped rather than guessed at, the
deadzone rescaled rather than clipped, the shaping curve holding both ends, the
pan basis orthonormal at every angle, orbit, clamped elevation, multiplicative
zoom against the control's own limits, pan following the hand and adding to a
camera already panned, the invert and dominant options, and the loop starting
on deflection, stopping on release, stopping on silence, and writing nothing
while there is no surface to drive.

## 1.0.0a87

**Phase 2 of `dev/plan-spacemouse.md`: the probe page.**
`web/public/dev/spacemouse-probe.html`, self contained, no imports and no
bundle: Vite copies `public/` verbatim, so it is served at
`/dev/spacemouse-probe.html` by `npm run dev` and by the built app alike, and
it is linked from nowhere. Nothing happens until Connect is pressed, which is
WebHID's own rule and a good one.

What it says: every granted device and every collection it exposes, with usage
page, usage and report ids, which is how the multi axis collection is
identified rather than guessed; a live table of report ids with their length,
count, rate and last bytes, decoded as little endian int16 words; six axis bars
with the raw counts and the travel observed so far, which is where the gains
come from; the button mask, live and ever seen; and a timestamped log of
`connect` and `disconnect`, which is the reading on sleep, wake and a receiver
replug.

Two buttons write findings out. `Record three seconds` collects raw reports and
prints them deduplicated by id and bytes, in the form the phase 3 parser tests
take, so confirming the layout is a fixture rather than a rewrite. `Copy
findings` assembles the device, the reports, the axis travel and the button
mask as a markdown block for the plan.

**The findings themselves are open.** They need the puck, Chrome and the
author's machine. Phase 3 therefore parses both documented candidate layouts,
chosen by the report's own length, rather than waiting on the answer.

## 1.0.0a86

**Phase 1 of `dev/plan-spacemouse.md`: the drawn surface leaves the app as a
mesh.** Two buttons on the relief's control row, `download .stl` and
`download .obj`, save the joint surface on screen as a file. The payoff is out
of the browser: 3Dconnexion's own viewer navigates an `.obj` with the puck
natively, fully tuned, with no integration code at all, which is both the
fastest route to the thing and the audition for the in-app version phases 2 to
4 build.

**`web/src/charts/mesh-export.js`, a leaf that imports nothing.** `surfaceMesh`
triangulates a height field into two triangles per grid cell, `meshToStl`
writes binary STL and `meshToObj` writes OBJ. Everything is arithmetic over a
plain object, so `node --test` holds it down directly, the argument
`surface-grid.js` and `surface-geometry.js` already make.

**The input is the drawn heights, not the densities.** The export takes the
array the renderer hands echarts-gl and the drawn z axis it is measured
against, so the file carries the log reading and the box proportions the reader
is looking at. In raw units it would be a pancake: losses run to the thousands
against a density near zero, and no viewer rescales axes. `chartdoc-to-echarts`
now takes the heights once into a named array and holds the snapped z axis in
`zBox`, both of which the vertex list and the export read, and attaches
`option.meshSource` carrying the lattice, the heights, that axis and the box
dimensions read back off the merged option, so the file cannot disagree with
the picture about its own proportions.

Masked cells leave holes rather than inventing geometry, and only referenced
vertices are written, so no file carries a NaN and every face index is in
range. The mesh is therefore an open shell rather than a solid: a slicer will
offer to close it, and closing it is a modeling decision this has no business
making. Z is up in both writers.

**The strip's handlers become one object.** `renderControls` had grown to six
positional arguments, and a call site passing five arrows and a null says
nothing about which is which. The export pair is also the first control whose
state the *drawing* decides rather than the document, so the strip rebuilds
once when the first surface lands: greyed with a why until then, per the
never-hide rule.

`web/test/mesh-export.test.js`: the triangle count a 3 by 3 grid implies, the
box the mesh fills and a stated z range honored, `84 + 50n` STL bytes with
normals up (including on a negative step, which flips the cross product and
renders a surface inside out), OBJ faces one based and in range, a masked
corner dropping exactly two triangles and its vertex, and a lattice too small
to triangulate refused loudly.

## 1.0.0a85

**Phase A3, the deletions the plan exists to make.** Nothing new works; a great
deal stops being this repo's opinion.

**`pricing.py` is thin runners and no pandas.** Out: `_BasisView`, the duck type
that presented one column of `reins_density_df` to an unbound
`Aggregate.calibrate_distortions`; `_REINS_BASES` and `reins_bases`;
`_pentagon_row`, `_pentagon_diff` and `_sub`, which completed a pentagon row by
row and differenced two of them; `run_price_pentagon`, `run_reins_price`,
`run_evaluate`, the legacy `run_pricing`, and the `_document` helper that told
four frames how to print. What is left is validate the body, call the method,
serve the envelope.

The shim is not merely replaced, it is outclassed:
`calibrate_distortions(reins_view=...)` landed upstream at a223 and was fixed
for these shapes at a250, and the library knows five views where the shim knew
three.

**Four routes go**: `POST /price`, `/reins_price`, `/evaluate` and the legacy
`/pricing_at`, with their eight request and response models. The SPA has not
called any of them since a84, and never called `pricing_at`.

**`tables.FORMATS` loses its six pricing keys**, `price`, `reins_price` and the
four `stat_*` slices. They said how a premium, a margin, a loss ratio and a
return on capital print, which is the library's statement to make, and it makes
it now. `frame_document_dict` is `bounds.py`-only. The two `sharpen` entries
stay: that leaf has not moved onto the exhibit the library registered for it at
a255, and when it does, `FORMATS` empties.

**`capability.reins_bases_for` reads `obj.reins_views`** and filters to the
whole program views, in the order the two forms draw them. It replaces a local
list of `reins_density_df` column names that had to reason about the program's
stages itself; the library's property already knows, so `net occ` appears
exactly on the two-stage programs that have a distinct one.

**Tests follow the routes.** The pricing block of `test_objects.py` and all of
`test_evaluate.py` are gone, their coverage in `test_pricing_exhibits.py`, which
gained the tower and severity cases. The declared-formats test asserts the same
thing about the same numbers and reads them out of an exhibit envelope. The
reins-bases test now posts every basis it reports to the calibrate route, which
is the promise the row makes.

`dev/scripts/check-adapter.py` loses its pricing pass: it compared a document
against the `FrameResponse` for the same frame, and an envelope has no second
rendering to disagree with.

## 1.0.0a84

**Phase A2: the Pricing pane becomes `Calibrate  Allocate | Evaluate`, and
draws only what the library serves.**

**Three leaves where there were two.** Calibrate and Allocate are two readings
of one calculation and share a form and a press: the button fits the standard
distortion set, and the two panes are the per family receipt and that same
calibration spread across the views of a cession or the units of a book.
Evaluate runs the other way, which is why it sits behind a thin divider rather
than beside them. `dividerBefore` on a leaf is how `nav.js` says so; Pricing is
its only user.

**A live preview line under the Calibrate form**, updating as you type: the
pentagon this form would complete, in the Quick Re treatment. Debounced at
350 ms, ticketed against out-of-order answers, dimmed rather than blanked while
in flight. PQ reads as a ratio to three places, the same as in the tables.

It is also where a refusal lands. The library's unbounded anchor guard, `p=1` on
a book whose claim count has no maximum, is a sentence written to be read, and
the reader meets it in the line under the box they are typing in rather than as
a broken pane after a press.

**`[Price]` is `[Calibrate]`**, because that is what it does.

**One envelope renderer for all three leaves**, shaped like `loadExhibitLeaf`:
blocks in order, the caption lifted out of each block and drawn under its table,
then whatever the library warned about. `renderPrice`, `renderReinsPrice` and
`renderEvaluate` are gone, and with them every title, caption and section
heading this file used to write about a price. A distortion the library declines
to allocate now says so under the table it is missing from.

**Both perspectives ride in each response, so the RAW / INSURER toggle is a
redraw.** The two answers are held per object rather than per pane, which is
what lets the toggle flip and the leaves swap without a second calibration.
They are dropped when the object changes, not when a pane is cleared.

**The Evaluate form grew three things.** The premium box now shows for every
object that takes one, prefilled from the object's own consideration; through
a83 it appeared only when the object carried none, so an exposure written with
a premium was evaluated against a number the reader never saw. A
`Gross | Net occ | Net` group names **which** premium is in the box, live for a
reinsured Aggregate and greyed with a reason otherwise. And a `p | assets`
anchor pair, matching the Calibrate form: evaluating at the level a calibration
was struck at is what closes the round trip. Left blank it is the library's
unlimited reading, which reports four families rather than five. All three are
hidden for a P&L, which states a premium on every row of its ledger.

**One height for every control on both pricing forms**, `--price-h`, the Quick
Re solution applied here. The inputs carried a hard `1.7rem` and the buttons
were padding-derived, which is the kind of difference the eye reads as a mistake
without being able to name it. `#price-anchor-label` gains the fixed width its
target sibling already had, so switching `p` to `assets` stops reflowing the row.

## 1.0.0a83

**Phase A1 of `dev/plan-pricing-exhibits.md`: three routes that hold a result
object and serve the exhibits registered on it.** The library half landed at
`aggregate` 1.0.0a259 to a263, where `calibrate_distortions` and `evaluate`
started returning `CalibrationResult` and `EvaluationResult` and three exhibits
(`pricing.calibrate`, `pricing.allocate`, `pricing.evaluate`) were registered on
those results. This is the api coding against that.

**`POST /v1/objects/{id}/pricing/preview`** completes the pentagon and answers
with scalars: the five levels and three ratios under wire names, plus the
probability the caller named. No distortion is fitted and nothing is allocated,
because this feeds a line that updates as the reader types.

**`POST /v1/objects/{id}/pricing/calibrate`** fits the standard set and returns
the `pricing.calibrate` and `pricing.allocate` envelopes, each under both
perspectives. Two exhibits from one call because one press fills two subtabs;
both perspectives because the frames are small and the alternative is caching a
result object server side so a second request can answer the other reading of a
calibration already made.

**`POST /v1/objects/{id}/pricing/evaluate`** returns the `pricing.evaluate`
envelope the same way. It takes an asset anchor now, which is what closes the
round trip: evaluating a family's own implied premium at the level its
calibration was struck at recovers that family's parameters. An anchored panel
reports five families and an unanchored one four, since `ccoc` needs an asset
level. A P&L takes neither the anchor nor a premium, and says so rather than
passing a number the library would have to guess about.

**Three library refusals arrive as HTTP 400 with the sentence intact**: the
`p=1` unbounded anchor guard, a loss-ratio target implying a premium above the
assets, and the "exactly one of" validations. All three are written to be shown
to a reader, and the first two land in the preview line.

**The capability block gains `premium`**, the object's own resolved premium or
null, for the Evaluate form to prefill with. `has_premium` is now derived from
it, so the flag and the number cannot disagree.

The old `price`, `reins_price` and `evaluate` routes are untouched and still
serve the SPA; they and the pandas assembly behind them go at A3. One bridge was
needed meanwhile: `run_evaluate` reaches the panel through
`EvaluationResult.evaluation_df`, since the library's return type changed under
it.

## 1.0.0a82

**Four small things on the page, three on the relief.**

**The two versions ride in the header**, left of the hamburger, small and
quiet: which library built the numbers on screen is the first question of any
session that spans a bump, and the api one answers "did the deploy take"
without opening a panel. Filled from `/v1/meta`, blank if it does not answer,
since a wrong version is worse than none. Hidden on a phone, where the header
has no room and the About panel still carries them.

**One Download models.** The raw form served the programs as typed, straight
off the object cache, and the two sat next to each other asking a reader to
know the difference. The canonical one is the one that reloads.

**Download plot** is labeled by what it does. It has saved a PNG since the
matplotlib route left at a60, and a 3-D relief is a WebGL canvas, so ".svg" was
promising a vector form of a picture that has none.

**"all digits"** rather than "every meaningful digit" under Static, full
precision, which is what it does.

**A `tips` toggle on the relief.** The hover tooltip reads one cell under the
cursor; the strip above the chart carries the cut's own numbers either way, and
that strip neither moves nor covers what it describes.

**The strip is two lines now**: where the cut is (each component, the total,
the density there) and then what it leaves (the conditional means, or kappa
against the even split). The duplicate "total cut" went: when a total cut is on
it *is* the total, so it replaces the components' sum rather than sitting
beside it saying the same thing twice. Every row carries a hint on hover,
including the one that prompted the question: the **even split** is half the
total to each, where the split would sit if the two components shared it
equally, and it is the hollow ring on the chart. The gap between it and the
filled dot is how far from even this total actually splits.

**The flat contours are redrawn in pixel space, and smoothed.** They were line
series on the panel's own axes, and a heatmap needs category axes: a category
axis cannot place a point between two categories, because
`OrdinalScale.normalize` indexes its tick table with the value, so a contour
vertex at "cell 12.4" reads `undefined` and collapses. That is why they looked
like torn paper. One `custom` series now renders them in pixels, where the grid
is uniform and a fractional cell is a position like any other, and zrender's
polyline smooths the facets that a contour off a lattice always has.

`contours` is one control for both readings and it is **on** by default now.

## 1.0.0a81

**The second look, six more.**

**A `lights` control, on by default.** It lifts the fill to 0.85 and drops the
key to 0.45, so no face of the surface is dark. Not only taste: the color *is*
the height here, and a key light strong enough to shade one side into darkness
is a second, silent encoding fighting the first. The key stays lit rather than
going out, or the relief flattens into its own floor image. Off is the single
hard light of a77, one click away, which reads the shape more sculpturally and
the color less well.

**The flickering cutting planes were the axis pointer.** On a `grid3D` it draws
three planes through the picked point, and since a click is how a cut is
placed, every placement flashed a set of planes that are not the cut. Off.

**The walk was slow because it was rebuilding everything.** Each step decoded
the grid, rebuilt eleven thousand surface vertices and handed echarts a whole
new scene, twenty times a second, which is more work than a browser has. The
surface context now rides on the option, so a step rebuilds only the cut series
and merges them by id. What the walk does, since the question was fair: all
three cuts move together out along `y = x`, the total rising steadily, one pass
in thirteen seconds. The thing to watch is the filled dot against the hollow
ring, which is how far from even the split is as the total grows.

**A fixed strip above the chart**, in the place the 2-D charts already put
theirs, carrying where the cut is (each component, their sum, the density
there) and then what it leaves (the two conditional means, or kappa and the
even split). Written once per redraw rather than followed by the cursor: on a
3-D scene a tooltip covers the thing it describes, and these numbers belong to
the cut rather than to wherever the pointer drifted. The rows are named by what
is *left*, not by what is held: fixing x leaves a distribution in y, so the mean
is of y.

**The flat reading is the same drawing seen twice now**: viridis, the same
eight contour levels, over the image. `VIRIDIS` moved to `theme.js` from the
3-D module, because a reader flipping between the two readings is entitled to
see one color mean one height. On category axes a contour path becomes
fractional cell indices, which is what those axes take.

**The z axis box snaps to round numbers.** Its ends were the data's own bounds,
and an axis drawn between two of those subdivides into five more of them, so it
printed arithmetic rather than ticks. Both ends now snap to multiples of a nice
step, which makes every tick between them round as well and costs a little
empty box where there was nothing to see. The data floor and ceiling are
untouched: they still set the color scale, the log clamp and where the floor
image stands.

## 1.0.0a80

**Nine fixes from the first real look at the relief**, author 2026-08-12.

**The camera stays where the reader put it.** This was the big one and it was
behind two of the complaints. `viewControl` is what the camera is set from, and
echarts-gl writes the live angles back into that same object as the reader
drags, so a rebuild that re-sent the option's original alpha, beta and distance
snapped the box back to the default angle. Every control did that. And the
walk, which rebuilds many times a second, re-sent it on every frame, fighting
the reader for the camera and winning, which is why it produced a picture
mostly outside the viewport that could not be watched. `readCamera` reads the
live one before each rebuild and the next option carries it back. The
prototype's `syncCamera`, which had solved this already.

**Click to place a cut.** All three cuts go through the clicked point: x held
there, y held there, and the total through it. On the total the two coordinates
do not matter separately, only their sum, so a click anywhere along one
anti-diagonal gives the same cut. Clicking with no cut showing turns them on,
or the gesture reads as dead. Hover picking on a surface is O(n^2) per event in
echarts-gl, which stalls a software renderer, so a click is both the cheaper
gesture and the one that leaves the cut where it was put.

The three cut positions are now held separately, as fractions of their own
ranges, because a click is two independent coordinates. The walk still drives
all three from one parameter on the diagonal, which is what keeps them crossing
at the point being walked to.

**The walk** also runs at twenty frames a second rather than sixty, and does
not write a position nobody chose to storage on every one of them. Where it
stops is saved, once.

**Drag has damping**, 0.85, from the same preset: a drag with weight rather
than one that snaps to the cursor and stops dead.

**Contours in white**, wider, at 0.85 opacity. Viridis runs dark purple to
yellow and the prototype's mid gray reads on neither end; over the floor image
it disappeared.

**The colorbar is half the height of the viewport**, not nearly all of it. At
full height it read as the second half of a two-panel chart.

**The floor drops further**, 0.45 of the drawn range against 0.32, so more of
the image clears the surface silhouette.

**The host is 40% taller** for the relief than for the flat panel it shares a
layout with. The 3-D box spends height on perspective and on the base drop
before it spends any on the surface, so at the flat panel's size the picture is
mostly chrome. The one place the app sizes a chart by what it is rather than by
the document's aspect, and a drawing decision rather than a semantic one.

**The z axis prints four significant figures.** At one, a density axis stepping
1.5e-6, 2.0e-6, 2.5e-6 reads "2e-6" three times, which says the axis is not
moving. The prototype's `tick`, which is exponential only where a decimal would
be unreadable.

## 1.0.0a79

**The cuts, the marks and the walk.** `dev/plan-3d-plot.md` sections 4.4 and
4.5, which is the last of the app's half that does not wait on the library.

**cut** cycles none, components, total, all. Holding x leaves a distribution in
y, and the conditional it leaves is drawn on the wall beside the marginal it
should be compared with, at that wall's scale, so the gap between the two curves
is the dependence: sweep the cut and on a joint that factors the conditional
does not move off the marginal behind it. The cut is drawn three times over,
because on its own the curve on the skin reads as a stripe of color rather than
as a position: on the surface, as a trace on the floor giving it a foot, and as
the conditional on the wall.

**The marks.** On a component cut, `E[Y | X = x]` as a stem and a dot standing
on the curve it is the mean of, which is the pairing that makes it a fact you
can see rather than one you have to trust. On the total cut the same two marks
are kappa, plus a hollow ring at the even split, `s / 2` to each: on the
diagonal by construction and on the cut by construction, so the gap between the
filled dot and the ring is how far from even the split is, drawn rather than
subtracted. On an exchangeable pair the two sit on top of each other at every
total.

`kappa_1 + kappa_2 = s` holds to floating point at every position, checked at
five: every point of the path has `x + y = s`, so the two means are weighted
averages of numbers summing to `s` under the same weights, which makes it a
real check on the arithmetic rather than a slogan.

**walk**, one pass in thirteen seconds, all three cuts moving together out
along `y = x`. Parameterized **on the diagonal**, which is why the position is
one number: the two axes cover different intervals and the total is
parameterized by a third range again, so three cuts set to the same fraction of
their own ranges drift apart instead of crossing at the point being walked to.
`diagonalSegment` returns null where the two axes do not overlap, which is a
real case rather than a defensive one.

**window**, a number box, live on `input` with the redraw deferred 90 ms so a
held arrow key coalesces. It is the one control that is a new **request** rather
than a new drawing: the library chooses the reduction from the window before it
reduces, so a deeper window comes back finer rather than cropped, and a
client-side crop could only throw away resolution that had already been
averaged out. Empty means "the library's own default" and sends nothing, since
a parameter saying "do what you would have done" puts the app's idea of the
default into the URL and the ETag.

**One honest limit, and it is upstream.** The conditionals and the marks are
computed on the grid as served, and the library still crops that grid to the
window, so a total cut whose line runs off the box is integrating over the part
it can see. The author's 4.2.1 ruling closes this: the library emits the whole
reduced grid with the window as a drawing range inside it, and nothing here
changes when it lands. Until then, `window` 0 is the escape hatch: it asks for
the whole grid and the marks are then exact.

`loadSurface` registers `Scatter3DChart` as well, since the marks are points.

## 1.0.0a78

**The relief gets controls of its own, and two of the things they turn on.**
`dev/plan-3d-plot.md` section 4.4. Five buttons, offered only while the relief
is the drawing on screen, and rebuilt away when the reader switches to the flat
reading, because four toggles acting on a picture nobody is looking at are
worse than none.

They are deliberately **not document readings**. Nothing in the chart IR
declares that a joint has marginals worth drawing on a wall, and nothing
should: these are decisions about this drawing, which is the app's half of the
split. The strip keeps them in the house order, between the readings the
document declares and the realization control.

**marginals**, off by default, draws each component's own distribution on the
wall behind it. They are the library's exact marginals, off the object rather
than integrated from the reduced and windowed joint, so they do not move when
the window does. One vertical scale for **both** walls with the eight-fold cap
from a74: scaling each to its own peak draws them at identical heights every
time, whatever the two distributions are, and a reader takes equal heights to
mean something. Both are clamped into the box, since echarts-gl does not clip
and an unclamped wall curve renders as a line hanging in space below the floor.

**contours**, off by default, at eight levels, on the surface *and* on the
floor image at the same levels, which is what makes the two read as one
drawing. Marching squares, with the two saddle cases resolved on the average of
the four corners rather than picked arbitrarily, which keeps a contour from
crossing itself where two modes nearly touch. `contourPaths` lives in the
tested leaf module beside the rest of the geometry, so the plan's "level lines
on rectangular grids" invariant is checked rather than eyeballed.

**mesh** and **wall grid**, both on by default, and **reset**, which is the one
control that disposes the renderer rather than redrawing: the camera lives in
the instance and survives `setOption` deliberately, so that toggling a reading
while looking at the ridge does not swing the box back to the default angle,
which makes the control whose whole job is to swing it back need a new
instance.

One structural change behind them. The chrome dict now styles the skin and
nothing else. Everything drawn over the surface is optional, so the series list
length depends on which controls are on, and a positional merge onto it would
style the wrong series the moment a reader turned one off. The mesh, the floor,
the wall curves and the contours carry their style where they are built, from
the same preset.

## 1.0.0a77

**The relief starts looking like the draft.** `dev/plan-3d-plot.md` section 4.6
and the prototype's `app` preset, which is the state the author picked after
looking at the four real surfaces. Every constant is copied from it rather than
reinterpreted: the lab is the reference implementation, and a value invented
here would be a second opinion about a question already answered.

Five changes, and the lab records the diff itself as `app` against `shipped`:

**The floor image.** The same grid laid flat at the base, carrying its real
height in a fourth column so a second visualMap colors by it. On by default and
continuous rather than stepped, because a density covers its whole domain, so
the interesting part of the base is pressed flat against the floor and the
image is the only thing that says what is down there. The stepped form reads as
a contour map and is a different claim, so it stays an option rather than the
default.

**The base drop**, 0.32 of the drawn range. The box gets a visible bottom,
which it never had, and the floor's picture slides down the screen relative to
the surface's, so a band of it clears the silhouette along the near edges and
the image underneath stops being an opaque lid's worth of wasted work.

**No cast shadow.** It is a dark shape thrown across the floor picture by the
thing you are trying to read, and on a density it lands on the tail every time.
The key light and the ambient fill carry the shading without it.

**Viridis**, not the house blue. A density in relief is a height field first,
and the house ramp runs white to one hue, so the lit and unlit faces of one
height read as two different values.

**A mesh of its own**, every sixth line, pale and half transparent, lifted a
hair off the skin and capped so the lift cannot push a vertex through the lid
at the peak. Real `line3D` geometry rather than the surface's built-in
`wireframe`: that one is drawn inside the surface's fragment shader, so it
inherits the skin's opacity, and it traces the data mesh, so at ninety cells a
side it is a solid block of ink with no way to thin it.

**And the log floor is a stated depth**, eight decades under the peak rather
than wherever the data stops. A joint lognormal runs twelve decades from its
mode to its corner, and on a log axis that spends most of the box on mass
nobody will ever look at, which is its own way of pressing the interesting part
flat.

`loadSurface` now registers `Line3DChart` beside the surface and the grid.

## 1.0.0a76

**The joint surface draws in relief again, and there is a control for the flat
reading.** Reported from the running app on a258 and a75: only the heatmap
appeared. Nothing in the a72 to a75 work caused it. Two pieces of standing
behavior did, and together they left no way out.

`realization` fell a surface panel to `heatmap` whenever the reader had not
asked for something, which was the author's **interim ruling of 2026-08-09**,
taken while the 3-D design was unsettled. And the realization control only
appears for kinds the *document* declares, so with `chart_joint_surface`
declaring one kind there were no 3D and flat buttons at all. Flat by default,
and nothing on screen to change it.

The interim ruling is **lifted**, now that `dev/plan-3d-plot.md` is in flight:
a panel the document declares as a surface draws as a surface. The flat reading
is offered beside it, as **renderer capability rather than a document claim**,
which is the honest place for it: a heatmap and a relief are two drawings of
one z grid and this renderer has both. Not the converse, so a panel declared
`heatmap` gets no 3-D button, because `realization` would decline the request
and a control that does nothing is worse than no control.

One real bug behind the two: **a 3-D default has to ask for its own renderer.**
`echarts-gl` is a lazy chunk and `build()` correctly falls back to the flat
reading while it is missing, but the only thing that ever called `loadSurface`
was a click on the control that was not being offered. So the mount now asks
for the chunk when the default realization is 3-D, and redraws when it lands.

The chart smoke test learned the 3-D shape. Its log check read `option.xAxis`,
which a `grid3D` option does not carry, so it threw the moment the default
changed. It compares a footprint per shape now, `zAxis3D` and the single
visualMap for the 3-D form, and asserts the same thing either way: switching a
declared reading on has to change something.

**Both plan questions ruled, 2026-08-12.** Section 4.2.1: do not trade the full
grid rule for the payload, so the derived quantities stay the app's and the
library emits the whole reduced grid with `window` as the drawing range inside
it. Section 5.1.1: the representative point and `edge = "mid"`, so the
coordinate becomes the point a block's mass sits at and the declaration becomes
true. Both are library edits; the app's decode already reads `mid` correctly
and nothing here changes for either.

## 1.0.0a75

**The library's emitter landed, the two halves were read against each other,
and three things did not match.** `aggregate` a257 emits the windowed lattice,
`edge`, `bs`, `k`, `window`, `marginals`, `moments`, `deficit` and `z_block`.
This release is what changed on reading it.

**The log-quantized decode was wrong.** The plan drafted
`peak * 10 ** (code / 65535 * decades - decades)`; the library reserves **code
0 for an exact zero** and spreads 65,535 live codes over the decades below the
peak. The library's version is the better one and the plan now carries it: an
FFT-built joint is between 14% and 59% exact zeros, and an encoding whose
smallest word is "twelve decades down" turns every one of them into a floor
that the log view then draws as a real, flat surface.

**A missing `edge` means midpoints, not left edges.** The app had guessed the
other way. A document that declares no edge is one from before the field
existed, and those documented their coordinates as cell centers, so reading
them as left edges would shift every legacy grid half a bucket.

**The bivariate chart test now asserts the windowed contract.** It read "the
display cells sum to 1", which was true while the emitted grid was the whole
joint and became wrong the moment the window arrived. It reconciles instead:
the grid holds `kept * (1 - deficit)`. It also checks the lattice against the
arrays beside it, `edge`, the `z_block` dtype and order, and that the served
marginals are as long as their axes. The two round-trip tests that skipped at
a72 now run: `detail=32` and `detail=64` are two documents, two ETags, and each
revalidates only against its own.

**Plan section 5.1.1, upstream, found in the fix for 5.1.** `edge = "left"` is
half a fine bucket off. The fine lattice is not in the left edge convention: it
is in the representative-point convention and it is exact, with `xs @ p`
reproducing a theoretical mean to 8e-9 of a bucket. So a display block covering
`k` fine cells has its representative point at `x0 + i * dx + (k - 1) * bs / 2`,
and `edge = "left"` asks a consumer to add `dx / 2`, which overshoots by
`bs / 2`. Measured against the served `moments.mean` on the first real
document, that is +4.58 and +3.86 on the two axes, exactly `bs / 2` each. The
app follows the declaration literally rather than second-guessing it, so the
bias is visible rather than quietly patched out, and nothing marks a mean yet.

## 1.0.0a74

**The drawing geometry, and the finding that stops the drawing.**

`web/src/charts/surface-geometry.js` is the second leaf module: the window
range, a bilinear sampler, the line of constant total, a cut as a snapped grid
row or column, and the fit rule for the two wall curves. Eight more tests, 22
in all under `npm test`. These are the invariants `dev/plan-3d-plot.md` section
8.2 sends to the app, and each is checked on a grid whose two axes differ by 250
to 1 in bucket size, because a square fixture passes tests a rectangular one
fails and one of the four real test surfaces is 64 wide against 128 deep.

The fit rule is the interesting one. One vertical scale for **both** walls, not
one each: scaling each marginal to its own peak draws them at identical heights
every time, whatever the two distributions are, and a reader takes equal heights
to mean something. Past a factor of eight the smaller curve gets an eighth of
the wall and the taller one runs off the top, because a curve visibly leaving
the box says "taller than fits" and a curve lying on the floor says nothing.

**Plan section 4.2.1, open, and it is why the rest of the app's half waits.**
Section 4.2 says everything derived is computed on the whole grid and only the
drawing is clipped to the window. Section 5.2 chooses the reduction from the
cropped extent, so the window gets the requested detail. Both together put the
whole grid on the wire at the window's resolution, which is 181k cells on
Clayton at `window=4` and 551k at `window=2`, against section 3.3's budget of
4,158. Dropping the rule instead costs up to 4.9% on kappa, which
`check-kappa-window.js` measures and which is the one quantity this chart exists
to show.

Neither is the real design. Every quantity the rule protects is one
dimensional, and the library can serve each exactly for a few hundred floats:
the marginals (already in the plan), the density of the total, `kappa_1(s)`,
and the two conditional means. Served, the app needs the whole grid for
nothing, draws shapes from the window, normalizes them with an exact curve, and
marks numbers that are the library's rather than its own integral over a
truncated cut. That is also the only reading consistent with the purist ruling:
kappa is meaning, and an app that integrates a joint density to get one is
building a number the library owns.

So this release stops at the geometry. `weightedMean` is in the module and
nothing marks a mean with it yet, which is the seam the answer lands on.

## 1.0.0a73

**One decode for the surface grid, and the app grows a test runner to hold it
down.** `dev/plan-3d-plot.md` section 4.1 and section 8.3.

`web/src/charts/surface-grid.js` is a new **leaf module**: it imports nothing,
so `node --test` can exercise it, and it is the only thing in the app that
reads a document's grid. Both drawing paths call it. `surfaceOption` drew the
relief and `heatmapPanel` drew the flat version of the same grid, and both
destructured `series.surface` themselves; two readers of one wire format drift,
and the format is about to grow four encodings and a lattice.

It decodes `f32b64`, `f64b64`, `u16log12b64` and `json`, from `z_block` or from
the legacy `x`, `y`, `z` arrays, normalizes an `xy`-ordered block to row major
once, and prefers the declared lattice over the arrays beside it. Then it does
the one thing the plan is most insistent about: **divides by the cell area,
once**, so everything downstream is a density. The wire carries mass per
display cell, because mass is what a block reduction preserves and is exact.
The prototype's worst bug was a marginal integrating as if the values were
already a density against a conditional normalizing into one, which disagreed
by a factor of 1024 on one surface and drew the conditional flat on the floor
while the marginal stood up beside it.

`edge` is read and honored: `centerX` and `centerY` return the coordinate
itself when the grid names midpoints and half a step up when it names left
edges. That is the arithmetic every mean, conditional mean and kappa is taken
against, and it is where the library's display grid currently biases a mean by
close to a whole bucket. A document that says nothing is read as left edges.

A grid whose value count does not match its lattice **throws** rather than
drawing. A silent mismatch here is a picture that reads plausibly and says
something false.

**The reading strip follows the declared dtype.** Seven significant figures on
float32, four on the log-quantized form, which recovers a density to about
2.1e-4, plus a tooltip line saying the height is quantized. Printing five
digits of a number known to four invents precision the wire never carried.

**`npm test`**, `node --test`, no new dependency: node's own runner, one line in
`package.json`, 14 tests over the decode. The SPA has never had a runner, and
six of this plan's invariants are geometry, which does not survive a rewrite
unless something checks it. One of the tests reads the adapter's source and
asserts there are exactly two calls to the decode and no `series.surface`
destructuring left, which is the plan's own acceptance criterion for 4.1 and
the only cheap way to state it about a module that cannot be imported outside a
browser.

**`echarts-gl` is pinned exactly**, 2.1.0, not `^2.1.0`. It is the least
maintained dependency in the stack and the one this feature leans on hardest,
and the plan's iPad gate wants a known version under it.

## 1.0.0a72

**The chart route grows a knob, and the knob is all this service owns of it.**
`dev/plan-3d-plot.md` section 3, the api half of the bivariate joint surface.
`GET /v1/objects/{id}/chart/{name}` takes three optional query parameters,
`window` (quantile depth, 0 to 12 in halves), `detail` (target cells per axis
after the display reduction, 16 up) and `encoding` (`f32b64`, `f64b64`,
`u16log12b64` or `json`), and forwards to `charts.build_chart_doc` exactly what
the caller named and nothing else.

Which grid a caller gets is the library's decision, taken **before** the
reduction, and this route does not crop or re-reduce what it is handed.
Cropping downstream cannot recover resolution that was already averaged away:
on one test surface the same quantile window applied to the fine lattice leaves
232 cells and applied to the emitted display grid leaves 8, starting in the
wrong place. So the parameters are plumbed upstream rather than honored here,
and until the library takes them (its plan items 5.2 and 5.4) the round trip
is the one thing this side cannot demonstrate: the two tests for it skip on
the emitter's own signature rather than failing on a schedule nobody controls.

They travel in the URL rather than a header because they change the bytes, so
they belong in the thing the ETag answers for, and a URL that names its own
resolution is shareable and shows up in a log.

**`AGGAPI_MAX_CHART_DETAIL`, default 1024**, caps `detail`. A setting rather
than a constant, because one route serves two cases that want opposite things:
over the wire the answer is a few thousand cells and a payload in kilobytes,
and locally it is a drill-down into fine detail on a machine where bandwidth is
not a constraint, where a hard cap would prevent a use in order to prevent
nothing. The public deploy sets it to 256, since chart GETs sit outside the
Caddy rate limiter. What stops a client misrepresenting what it got is the
document, which reports the realized grid, not the ceiling.

Out of range is **422, never a silent clamp**. A request for detail this
deployment will not serve was asking for something specific, and answering it
with something else under a 200 and an ETag that both claim otherwise is the
response lying about itself. Same for a chart whose emitter takes none of the
three: the 422 names what was sent, rather than dropping it.

**A chart document cache**, eight entries, keyed on `(oid, name, window,
detail, encoding)`: everything that changes the bytes, which is what makes it
the same key the ETag answers for. It sits above the object cache and can never
cause a build, so no chart parameter is ever a reason to re-run an FFT. What it
buys is revalidation: a conditional GET has to know the hash before it can
answer 304, and the hash comes from building the document, so without it every
`If-None-Match` would redo the window-and-reduce work in order to report that
nothing changed.

**Two findings recorded in the plan rather than fixed here.** The encoded `z`
block takes its own key, `z_block`, because a nested array and an object cannot
share one and phase one promises an old reader still draws (new section 2.4.1).
And `GZipMiddleware` means chart payloads reach Caddy already encoded, so
nothing is compressed twice but `Content-Encoding: zstd` is unreachable while
the app compresses first: a deployment question for the author, worth about
half a kilobyte on a surface.

## 1.0.0a71

**Every table the library publishes is now drawn as published.** The author's
ruling of 2026-08-10: publish what the library says, and if it is wrong, change
the library. The two leaves that were not doing that are, and neither of them
was a decision anybody had taken. They predate the exhibit registry, and when
exhibits arrived nobody came back for them.

**More / Window** fetched the library's **private** `_bs_window_df` in
preference to its published `bs_window_df`, because the private probe frame is
two columns wider (`W`, the window width, and `coverage`). It draws the
`bs_window` exhibit now, with the library's own caption, which says what a
clipped row is and where aliasing comes from: a sentence the app's hand-written
lede did not carry. The two columns are asked for upstream. `_bs_window_frame`
serves the published frame, so the route and the exhibit cannot disagree.

**Reinsurance / Stats** fetched two frames the *api* manufactured by transposing
the library's layering analysis and splitting it in two, and wrote a title and a
gloss for each half. It draws the `reins` exhibit's first block.
`_reins_stats_transposed`, `_REINS_COMPONENTS`, the `reins_stats_terms` and
`reins_stats_moments` routes and `loadReinsStats` all delete.

**`tables.py` loses most of what was left in it.** `ROW_FLAGS` is empty and
`FORMATS` is down to the pricing frames and the two sharpen ones. The five
entries that went (`summary`, `tail_df`, `validation_df`, `reins_summary_df`,
`bs_window_df`) each declared how a published exhibit's numbers print, and had
been dead for the leaves that moved at a68 and a70 without anybody noticing.
`_is_anchor` went with them, and it is the clearest case for the rule: which
return periods a book is capitalized at is a fact about the practice, and this
repo had 200 and 250 written down as a literal. The library flags exactly the
same rows under the insurer perspective, so nothing moved on screen. The library
does **not** agree about formats, and does not have to: it writes a VaR in the
tens of millions as `41.864M` where this repo said `41,864,000.00`.

Five tests that pinned the old behavior now pin the new rule, including one that
asserts those five keys stay out of `FORMATS`.

**What is left, and none of it is a table the library publishes.** More /
Sharpen, because the registry is eleven entries and `sharpen` is not one of
them; Pricing and Bounds, which are computed from what the reader typed and so
cannot be keyed on the object; and the two densities, which are bulk and are the
one exception the author scoped out.

## 1.0.0a70

`dev/plan-ui-round-6.md`, phases B and C: the P&L premium, and the exceptions.

**The P&L premium is a number someone would write down.** `1324 premium` where
it was `1324.2716561855557 premium`: no decimals above 100, two at or below,
which is the author's rule. Anchored at the head of the program, because the
same text ends `0.25 premium expenses` and the obvious pattern matches that too,
where rewriting it to `0` would silently change the object rather than only how
it reads. This belongs in `aggregate._program._pnl_consideration`, is asked for
there, and is idempotent, so the day it lands upstream this rounds an
already-round number and deletes.

**Reinsurance Summary moves onto the exhibit route**, off the `reins` exhibit's
second block, which is `reins_summary_df` with the library's own caption and,
on a portfolio, its row flags. Byte-identical otherwise, so there was nothing to
weigh. `loadExhibitLeaf` takes a block index for it, which is also the shape
Stats needs the day the library turns that frame over.

**The remaining exceptions are a board, not a paragraph.** a68 recorded three
leaves that had stayed on the frame route as three sentences of justification,
which read as settled decisions; the author's ruling is that there are no
exceptions to the rule that the library owns what a table means, so each is a
ticket. The list above `LOADERS` now names all six with what blocks each:
Reins Stats (the library serves the layering analysis measures-down rather than
layers-down), More Window (the published `bs_window_df` is two columns narrower
than the private one, missing `W` and `coverage`), More Sharpen (no exhibit is
registered at all), and Pricing and Bounds, five leaves that are computed from
what the reader typed and so are not keyed on the object, which is a design
question rather than a missing registration. The densities stay bulk and are the
agreed exception. All of it is written up for the library as
`aggregate_REFACTOR/dev/note-from-aggregate-api-round-6.md`.

## 1.0.0a69

`dev/plan-ui-round-6.md`, phase A: the author's punch-ups off a68, plus the one
backend fault they exposed.

**The sqlite line in the status strip was ours twice over.** `AuditLog` handed
each connection to `with self._connect() as conn`, which is sqlite3's
*transaction* context manager: it commits and it does not close. So every build
leaked a connection until the collector got to it, and the finalizer printed
`ResourceWarning: unclosed database in <sqlite3.Connection ...>`. Three call
sites now go through `contextlib.closing`. The second fault is why the reader
ever saw it: `_collecting_notes` in the build route scopes caught warnings to
the `aggregate` package by path, and names this exact warning as the reason, but
`pricing.py` opened two more `catch_warnings` blocks and kept everything they
caught, so a collection landing inside a pricing call was reported as something
the reader's program had provoked. The rule lives in one place now,
`library_notes.py`, and both use it.

**The history readout counts from the newest.** `[1/20]` is the program on
screen and `[20/20]` is the oldest one Ctrl+Up can reach. It ran the other way
through a68.

**A shortcut for the table view**, Ctrl+Shift+U, flipping between the static
reading you last had and the interactive grid. It never enters full precision
and it does not throw it away if you are in it. Taken on the **capture** phase
and stopped there, which is the whole of why it works: CodeMirror drops the
Shift when it matches a character key held with Ctrl, so on the bubble phase
this matched `Mod-u` in `historyKeymap`, which is `undoSelection`, which pops
the last document change. The first cut flipped the view and silently deleted
the program you had typed. That collision waits for every `Ctrl+Shift+<letter>`
whose plain `Ctrl+<letter>` the editor binds, so the fix is the phase, not the
letter.

**One CsvGrid toolbar everywhere.** Expand/Contract was conditional on a
10-column threshold, so Reinsurance Summary (11 columns) carried the pair and
every frame on the Price tab did not: one widget, two toolbars, on two tabs of
one page. It is off unconditionally now. Raw rather than formatted copy and save
is unchanged.

**Derived programs enter the history.** `runDerivation` wrote its program into
the editor and never recorded it, so Sharpen, PnL and a Quick Re cession were
all unreachable by Ctrl+Up. Ceding three layers one at a time and wanting the
second back is the ordinary case. GCN already recorded its own, which is why the
gap read as arbitrary.

Also: the editor's floor is six lines rather than the two the old `4.5em`
actually bought (the comment claimed three), so stepping through programs of
different lengths stops resizing the page; Quick Re reads
`100% part of 50% attach, 95% detach`, with `part of` fixed as the row's English
rather than the DecL token it used to mirror; every tooltip is left-aligned,
both Bootstrap's and the `data-why` notes on greyed tabs; and the hamburger's
"Example source… (soon)" placeholder, dead since a159 merged the three shipped
libraries into one, is gone.

## 1.0.0a68

`dev/plan-ui-round-5.md`, the exhibits phase, and the close of Round 5. Item 21
and the half of items 15 and 23 that had been waiting on the library.

**Five panes that could not draw at all now draw.** Economics Ledger, Ratios and
Waterfall, More Tail behavior and More Dependency were dead in the interactive
table view from a62 to a67: the exhibit route served blocks built without
`include_raw`, so `irToGridInput` refused them and the pane printed a grey
apology instead. `aggregate` 1.0.0a246 makes raw values a property of a served
block rather than a caller option, which is the right call and a stronger one
than the passthrough this repo asked for. Nothing changed here to adopt it.

**Full precision moves into the browser and stops costing a round trip.** It was
a server rebuild with the per-column formats dropped, and that only existed
because a document could arrive with its numbers thrown away. Every document
carries the exact value beside the formatted string now, on both routes, so
`atFullPrecision` reprints what is already in hand. Three consequences: the
preference takes effect on the flip rather than on the next fetch, the
`?precision=` query parameter comes off `/frame/{which}` along with
`frame_spec(full_precision=)` and `FULL_PRECISION_FLOAT`, and the refetch a64
introduced now fires for Perspective alone, which is the one preference the
server really does own.

**Four leaves move onto the exhibit route**: Overview Summary, Tail and
Validation, and More Stats. Each had been fetching a DataFrame and having the
api build a document from it, with this repo holding that frame's formats and
row emphasis in `tables.py` and its title and caption as literals in `main.js`.
All four are published exhibits, so every one of those copies was a second
opinion about a table the library already has one about, and one had already
gone stale: the Return periods caption named the capital anchors, which is the
library's choice to make. `renderOverviewExhibits` and `renderOneExhibit` delete.

Three leaves deliberately did **not** move, and the reasons are in the code.
More Window reads the *private* `_bs_window_df`, two columns wider than the
published frame (`W`, `coverage`), and those two are the pane's whole diagnostic
value. Reins Stats is transposed and split in two by the api, which is a round 3
punch item; the `reins` exhibit serves that frame the other way up. And Pricing
and Bounds are computed from what the reader typed rather than read off the
object, so they cannot be registry exhibits at all without parameterized
exhibits, which is a design question and not a migration.

**Captions come out of the document and are drawn by the page.** A caption rode
*inside* the block, so the walker printed it and the interactive grid did not,
and flipping the switch silently dropped the library's own sentence about what
the frame means. Lifted rather than copied, or the static view would show it
twice.

Smaller, all found while doing the above:

* The exhibit route passes `max_rows`, so a reader cannot meet two different
  truncation points depending on which route a leaf happens to use.
* `_value_type` loses its `PnL` special case. a65 asserted `payoff` from outside
  the class on the author's ruling, knowing that was the wrong side of the wall;
  `aggregate` 1.0.0a248 states it on the class and this is a plain read again.
* The pane that cannot render a table no longer offers a CSV download. Three of
  the five exhibit panes have no frame route behind them, so it was pointing at
  a way out that does not exist for the reader most likely to be reading it.
* `replacePane` disposes the chart its pane was holding. Chart instances are
  tracked outside the grid registry, so emptying a pane left one alive over a
  detached canvas, with a live ResizeObserver and a `liveChart` the download
  button would have saved a picture of. Each chart loader disposed its own before
  drawing, which covered plot-to-plot and missed plot-to-table: one leaf before
  this phase, four after it.

Still outstanding upstream and not blocking anything here: the P&L premium is
still written at full float width (`12740.358597431476 premium`), which is Round
5 item 19 and ask 2 of the library note.

## 1.0.0a67

`dev/plan-ui-round-5.md` phase a68, Quick Re. Taken before the exhibits phase
because that one waits on a library change and this waits on nothing.

**One row, and the text box goes.** Round 5 item 11, to the author's layout:

```
QUICK RE  [Occ|Agg]  [100%] so  [50%] attach  [95%] detach  [Add re] (?)
```

Everything on one baseline at one height, reading left to right as the clause it
writes. Through a66 the row wrote a clause into a local input which was then
ceded, so the same string was carried twice before anything happened; the
author's ruling is that Add re composes and cedes in one press and the program
that comes back is where the clause is read and edited. The editor upstairs is
that box, and it has real completion, so a second and worse one beside it was
earning nothing. Both hint paragraphs fold into a tooltip on the `(?)`.

**The third box is a detachment now**, in both readings: `95%` is `q(.95)` and
`1000` is 1000, and the width follows as `detach - attach`. It was a limit, where
a percentage meant a detachment probability and a bare number meant a width, so
one box meant two different things depending on how it was typed. The **share**
box takes the same dual reading, which is what lets the operator beside it be a
real DecL token rather than a label: a percentage is a share (`so`) and a bare
number is an amount part-of (`po`), and it changes as you type. No stepper
arrows, per the author: `<input type=number>` refuses the `%`, and the dual
reading is worth more than the arrows.

**A live preview** under the row, debounced, showing the clause the row would
write and updating as any box changes. Populated from the defaults before
anything is touched, so the row explains itself without being used first. It
dims rather than blanks while a quantile lookup is in flight: a preview still
showing the *previous* clause while the boxes say something else is the same
kind of lie as everything else this round, and blanking would flicker on every
keystroke. Quantiles are cached per object and probability, so typing `95%` one
character at a time does not ask the server three times.

**The quantile route grew a `basis`, and this is a correctness fix rather than a
feature.** An occurrence cession applies to a single claim and an aggregate
cession to the year, so a percentage means a different number on each tier.
Reading both off the annual law is what the route did, and on
`100 claims 1000 xs 0 sev lognorm 50 cv 2` that put the occurrence attachment at
the annual median of 4,850 when no single claim can exceed 1,000: Quick Re's own
defaults wrote `occurrence net of 1830 xs 4850`, a treaty that builds, validates
and can never attach. Found by pressing the button and watching the mean not
move. `q_sev` is the per-claim quantile function and is aggregate level, so it
answers for a mixture too, where the individual `sevs` components cannot.

**Completion offers a token again** (item 10's surviving half; its widget half
went with the text box). `_label` was
`_TERMINAL_LABELS[terminal].strip("'")`, and `strip` removes matching characters
from the **ends** of a string, so a label ending in `)` kept its interior quote:
38 of the 105 terminals carry a gloss, and accepting one of those completions
wrote `after' (profit-commission allowance)` into the program. The payload now
carries `text` (the bare token, what an editor inserts) beside `label` and a
separate `detail` for the gloss, and CM6 shows the gloss without inserting it.
Three label shapes are handled and the fourth is dropped: a bare `'agg'`, a
glossed `'approximate' (or 'approx')`, an alternative `'**' or '^'` where the
first spelling wins, and a *description* like `a frequency name (poisson,
binomial, ...)`, which names a category with no literal to insert and is no
longer offered as though it were one.

Walked in a browser: the row writes `occurrence net of 157.5 xs 22.5` on the
per-claim law and `aggregate net of 1830 xs 4850` on the annual one, ceding drops
the mean from 4,926 to 2,430, and a second press on the other tier composes both
clauses into one program with the occurrence cession before the frequency clause
and the aggregate one after it.

## 1.0.0a66

`dev/plan-ui-round-5.md` phase a67, taken out of order because a66 waits on a
library change and this waits on nothing. The charts, and the discovery that one
of a63's headline items had never worked at all.

**The readout in the legend, and why the first attempt drew nothing** (G2). a63
wrote the values under the cursor into a strip below the chart using
`tooltip.showContent: false`, on the reading that the flag keeps the axis
pointer and still calls the formatter. It does not.
`TooltipView._showTooltipContent` tests `showContent` and returns **before** it
reads the formatter (`echarts/lib/component/tooltip/TooltipView.js:539`), so the
strip has sat under every chart since a63 saying "point at the chart to read
values off it", and pointing at the chart did nothing. Found by hovering one,
which is the whole argument for this round's browser rule.

The content stays on now and the box is hidden in CSS, which leaves the
formatter reachable. And the strip moves above the canvas and takes the
legend's job as well as its own: ECharts' legend is declared and not drawn, so
one row carries the swatches, the names, and the values as the cursor moves.
That was the ask, in the author's words, "the mouse over legend should appear in
the legend, rather than floating around with the pointer".

**Clicking a legend entry still hides its series**, which is not incidental:
`dev/graphs.md` records select-by-legend as one of three things the author liked
unprompted at a30, so replacing the built-in legend without it would have traded
a liked behavior for a chore. The declared-but-undrawn legend component is what
`legendUnSelect` addresses, and the page holds the hidden set so a rebuild (a
press of `log`) does not silently switch everything back on.

**One tracking line, not a cross** (G1). Each panel already declares the
coordinate it is interrogated on, and the strip prints that reading in words, so
the second line was a line whose meaning had to be worked out. `axisPointer.type`
goes to `'line'` and the per-panel `axis` picks which.

**The reference lines come back as a control** (G3). It existed before a62 and
did not survive the move onto chart documents, which is the whole of "we've lost
the annotations option". Offered whenever the document publishes marks, and on
by default: this is the button for taking the mean and the capital anchors away,
not for asking for them.

Their labels now run **vertically**, hang down from the top of the plot, and
take a side by where the mark is: the outermost goes right and every other goes
left, so `mean` and `1-in-100` open left and the capital anchor opens right and
the two do not print on top of each other. a62 alternated on `index % 2`, which
gives the right answer for two marks in document order and an arbitrary one
otherwise. Worth recording because it reads backwards: under `rotate: 90` it is
`verticalAlign` that puts a label left or right of its line, and `'top'` draws
it to the **right**, which is the opposite of what the rotation direction
suggests. Established by looking at it, after deriving it and getting it wrong.

**Ticks sit on a round lattice, on every axis type** (G5). Three faults, one
disease, and the author's rule settles all of them: "are the max and min in the
grid of the other ticks?"

* **Value axes** were pinned to the raw window at both ends, which defeats
  ECharts' nice-number algorithm, because the interval then has to divide an
  exact span. a62 answered by hiding the two end labels, which left the unround
  interior ones and cost a distortion drawn on [0, 1] its 0 and its 1. The
  window is rounded outward to a 1 / 2 / 5 step now and the interval set from
  it, so every label including the ends is on the lattice and none is hidden.
  Clamped to the axis's own `full_range` **before** rounding: a suggested window
  carries the library's padding, so an outcome axis arrives as
  `[-173.18, 8832.18]` and rounding that first turned 173 units of padding into
  a 2,000 unit margin of empty axis below zero, labeled `-2,000`, on a quantity
  that cannot be negative.
* **Log axes** got the same treatment on their own lattice, decades. "ECharts
  handles it" was the first cut and is not true: given exact ends it labels them
  exactly, so a log loss axis ran `1e-1, 1e+0, 1e+1, 1e+2, 1e+3, 8.8e+3`.
* **Category axes**, which a heatmap requires, labeled as many cells as fit
  without colliding. That is a legibility rule, not a reading rule, and on one
  joint density it produced 13 labels across 610 px and **26** down 370 px, four
  times the density on the shorter axis of the same picture, none of them round
  because they land on cell centers. The labeled cells are chosen now, on the
  same round ladder, targeting a comparable count per axis: that panel reads 5
  and 4.

Two consequences of the wider labels, both taken here rather than left to be
noticed later. The exponential formatter carried one significant figure, which
was enough while the ticks fell where ECharts put them and is not enough on a
lattice stepping by 5e-5, where it printed `1e-4` twice on two different
gridlines. And the y axis name now clears its own labels (`nameGap` 26 to 46,
with `AXIS_LEFT` and `GAP_X` following), because `2.5e-4` is wider than the old
gap reserved.

**G4 needed no change and is closed.** The author accepted the y rescale on
zoom ("you need that, else with a big mass at 0 you never see the detail"), and
the one remaining lever, `animationDurationUpdate: 0`, is already covered:
`baseOption` has set `animation: false` throughout, so nothing tweens.

## 1.0.0a65

`dev/plan-ui-round-5.md` phase a65, the strip and the action row. Three punch
items and one thing the acceptance walk turned up, all of them a control or a
readout saying something other than what is true.

**The GCN menu could be opened and not closed** (Round 5 item 7). Bootstrap
finds open dropdowns with
`[data-bs-toggle="dropdown"]:not(.disabled):not(:disabled).show`, so a disabled
toggle is invisible to `clearMenus`, the document handler that closes a menu
when you click away, and `Dropdown.hide()` bails on the same test. `applyViews`
disabled the caret synchronously on the item's own click, so by the time that
click reached the document the menu could no longer be seen, let alone closed.
The build then returned a bivariate, `canViews` went false, and
`renderActionRow` left `.disabled` on for good: the menu was stranded open and
the caret would not close it either. Hiding the menu **before** anything is
disabled is the whole fix, and the rule it implies is in the comment for the
next split button: do not disable a Bootstrap dropdown toggle while its menu is
open.

**The history readout was three sizes too big** (item 14). `#history-pos`
carried `.fb-text`, but the rule that makes those hints small, grey and
monospaced is on `.fb-right`, and the label sat outside it, so it rendered at
body size in the UI face: larger and darker than the key hints beside it. It is
now a bare `[3/4]` under the editor's clear icon, right-aligned to it, in the
same 11.8px mono grey as `Ctrl+Enter build`. The word `DecL` went with the move;
it was doing no work beside a box visibly full of DecL.

**The sign convention printed for nothing** (item 17). a57 sent `value_type`
only when it was `payoff`, so as not to spend a word saying "normal" on every
build. Sound, and the outcome was that it never appeared at all: `Aggregate` and
`Portfolio` both answer `'loss'` and were suppressed, and a `PnL` carries no
`value_type` attribute whatsoever. It is now sent whenever the object has an
orientation to report, and `None` means the kind has none rather than that its
orientation is ordinary. A P&L says `payoff` on the author's ruling, which the
app asserts knowingly from outside the class; `PnL.value_type` is asked for
upstream and that branch deletes when it lands.

**A GCN pair reported `mean (?, ?)` and `CV (?, ?)`.** Not on the punch list,
found by walking the page, and the same failure as the item above one layer
down: a57 read the per-axis moments off `obj.units`, on the stated belief that
it is a list of component `Aggregate` objects. It is on a copula bivariate,
which is why the test written at the time passed, and it is `None` on one built
by `grossnet` or its siblings, which is what the reader actually presses the
button for. So the block added at a57 to give a bivariate a status line gave it
two question marks instead. The moments come off `stats_df` now, whose columns
are exactly `unit_names`, so the pair lines up by name rather than by position,
with the `units` path kept ahead of it for a kind that does carry components.

Item 19, rounding the P&L premium, is upstream and is not here. It is written up
with the round's three other library asks in
`aggregate_REFACTOR/dev/note-from-aggregate-api-round-5.md`.

Walked in a browser: the menu opens and closes on the pick and stays closed as
the caret goes dark, `[3/3]` sits 4px under the clear icon at the hint's own
size and face, the strip reads `bs = 1 . log2 = 16 . loss . mean 8,646.1`, and a
`grossnet` pair reads `mean (4926.52, 4561.42) . CV (0.201225, 0.176488)`.

## 1.0.0a64

`dev/plan-ui-round-5.md` phase a64. Two preferences that shipped at a59 and have
never once worked start working, and the grid stops formatting the numbers you
take away.

**Full precision and Perspective were both inert until the next build.** Not
partly, not subtly: flipping either switch changed the tick in the menu and
nothing else on the page. Two things held it, and either alone was enough.

Every loader `await`s its document **outside** the closure it registers with
`onTableViewChange`, so the registered redraw re-rendered bytes already in hand.
`setTableView`'s own comment claimed the opposite, that "panes hold their own
fetch, so asking them to redraw is enough", which is the comment that made the
bug look like a design. And `loadLeaf` declines to re-run a loader for the leaf
already on screen (`state.rendered[group] === key`), so even walking to another
tab and back would not have fetched again.

The fix separates the two kinds of preference change rather than making
everything refetch. A **redraw** is right for the static / interactive flip:
both views come off one document, which is what makes that flip free, and it
stays free. A **refetch** is the only thing that can honor a change to what the
*server* builds, which is what full precision (the static walker prints the
house formats or the raw values, decided at build time) and perspective (the
library owns the translation) both are. `refetchTables` goes through
`clearPanes`, which is already the one place that tears down the CsvGrid and
ECharts instances a pane holds, and clears every group rather than the one in
view: the panes behind the other tabs were also built at the old setting.

It takes the charts with it, so flipping a table preference on a plot leaf costs
that chart's document again. Accepted: every document route answers with its
content hash as an ETag under `Cache-Control: no-cache`, so the re-request
revalidates to a 304.

**Menu order.** The two statics are adjacent and Interactive is last, so the
list reads printed, printed with all the digits, then the instrument. Full
precision is a third state of one preference, not a second preference.

**Copy and Save hand over the raw values.** A grid is where you go to take
numbers away, and a copied `17,319.66` has to be cleaned by hand before anything
can compute with it when the exact value was sitting right there. Both export
controls, not just Copy: a Copy that differs from a Save is a surprise nobody
asked for. CsvGrid 3.9.0 hard codes its "Formatted values" checkbox to checked
and reads it live at export time, so there is no option to pass and `mountGrid`
clears the boxes after construction. An `exportValues` option is asked for
upstream and this deletes the day it lands.

Verified in a browser, which is the point of the round: 27.18 becomes
27.1831742436421 under the cursor with no rebuild, the static to interactive
flip issues zero requests, Economics Ratios goes from three blocks to two and
back as Perspective moves, and both checkboxes come up clear.

## 1.0.0a63

`dev/plan-plot-ir-api.md` item 7, the punch items that are not adapter work.
Two land, one is answered without a change, and one landed early at a62.

**7.4, the readout moves into the page.** The best idea on the list, in the
author's words, and the argument against the floating box is not taste: it
covers exactly the region being inspected whenever the reader goes looking at
the tail, which is the one place they most often are. So the values under the
cursor are written into a fixed strip under the chart, in ordinary page text,
styled like the rest of the page. uPlot's strip is the model.

Built on the split the plan called the right one, arrived at from the other
end. The adapter answers **as data** (`option.readout`, a pure function of the
hover returning `{head, rows}`), and the mount does the writing, so nothing
about what the numbers say lives in the DOM code and the model is checked in
node with no browser. `tooltip.showContent: false` is the hook: it keeps the
axis pointer and the cross-hair and still calls the formatter, which is the
only thing that had to be found.

The head names the coordinate the panel is **interrogated on**, not a fixed
axis. A density is read by loss and a Lee diagram at a chosen probability, so
one "loss ..." head would have been wrong on half of every two-panel chart.

**7.2, double-click resets the view.** On the zrender layer rather than on the
chart, because `chart.on('dblclick')` fires only over a graphic element and the
reader who has zoomed too far is usually over blank canvas. Dropping the held
zoom is the whole reset: the rebuilt option carries a dataZoom with no start or
end, which is the component's own full-range default. Preferred to
`toolbox.feature.restore`, which ships a corner cluster of buttons and works
against how hard a26 to a29 worked to keep the chrome down.

**7.1 is answered, not fixed.** The plan's recommended first move,
`animationDurationUpdate: 0`, on the theory that the disorientation is the tween
rather than the rescale, turns out to be in place already and to have been since
the exhibits landed: `baseOption()` sets `animation: false`. So the tween was
never the cause, and the only remaining lever is `dataZoom.filterMode`, which
trades the rescale for a flat line pinned near zero when you zoom into a tail.
That is a judgment about how it feels, and it needs a browser rather than a
guess, so it stays open and the mode stays `'filter'`.

**7.6 landed at a62**, early, because the control strip was being rewritten
anyway and centering it was less work than reproducing the split layout in order
to remove it.

## 1.0.0a62

`dev/plan-plot-ir-api.md` items 2, 3, 4, 5, 6 and 8 together: the app stops
drawing charts and starts realizing documents. Every picture on the page now
comes from a library emitter, and the app-side chart semantics are gone.

**The plan expected to meet the library halfway and found it finished.** It was
written against a230, where four emitters existed and `chart_agg` had just
landed; a244 ships all eight, so items 3 and 5 collapsed into one adoption pass
and item 4's accepted consequence, Overview reading "not yet implemented" for an
aggregate, a portfolio and a P&L until their emitters arrived, never had to
happen. Nothing went dark.

**`chartdoc-to-echarts.js` grew the 2-D path**, which was the long pole. Lattice
coordinates expanded (IR version 2, and the two charts on the critical path both
use it, so a reader without this draws an empty panel); multi-panel layout as a
function of panel count, equal aspect and viewport width; the axis walker over
`scale`, `scales`, `suggested_range` and `full_range`; marks with their label
sides; bands; the atomic support ladder; and series paired across panels by
**name**, retiring the emission-order arithmetic that assumed both panels
carried the same series in the same order.

**The ladder reads axis units, not series roles**, which is the library
renderer's rule and the reason it is right: a reinsurance series is called gross
or ceded in every panel it appears in, and only the axes know that one panel
carries mass, another accumulated probability, and a third the same probability
read back to an outcome. Probability on y is a right-continuous step,
probability on x is the left-continuous one (a quantile function rises *before*
its atom where F steps after it), and a mass with room to show its atoms is a
stem. No pixel rung, deliberately: this chart zooms, so pixels per atom is a
property of a gesture that has not happened yet.

**Four controls, off the document.** `log`, `full range`, `return period` and
`invert` appear when any axis or panel declares the reading and act on every one
that does, which is the surfacing rule `plot_chartdoc` follows, so one
instrument reads the same way in both renderers. `logY`, `rightLogY`, `xFull`,
`epMode`, `refLines` and the per-kind `controls` arrays are all gone, and so is
the split strip: every control governs the whole chart by construction now, so
centered is the only layout it needs. Two of the four did not exist when the
plan was written: `invert` arrived upstream at a240 and turns a Lee diagram into
the distribution function under the name the document gives it.

**`capability.primary_chart`** answers which chart is an object's own picture,
which the Overview Plot leaf had been answering with a per-kind table in the
browser. A passthrough of `charts.primary_chart`, so the answer moves when the
library's registrations move.

**`exhibits.js` deleted**, 2,310 lines, and with it `twoPanelData`, `twoPanel`,
`densitySeries`, `rightSeries`, `anchorMarks`, `densityWindow`, `survivalRange`,
`gapFree`, `heatmapData`, `axisNames`, `reinsSeries`, `mountReinsExhibit`, the
per-kind `EXHIBITS` registry and the `twoPanelBox` / `squareBox` geometry pair.
What is left is `mount.js`: the skeleton, the control strip, the ECharts
lifecycle and the zoom. The rename is not cosmetic. An "exhibit" here is a
library *table* envelope, and a module called `exhibits.js` that drew charts had
been misleading since the exhibits endpoint arrived.

Three consequences visible on screen, each the library's call rather than ours.
A **portfolio** gains the kappa panel (`E[Xi | X = x]`, equal aspect, read
against the diagonal) in place of its exceedance panel, and its units draw on
their own native grids rather than on one resampled common one. A **severity**
loses the server-side log-spaced survival inversion, which the emitter absorbed.
And the **bivariate** heatmap is no longer square: the emitter says an
anisotropic joint grid is deliberately free, and the app does not get a vote.

**The bivariate draws flat for now**, per the author, while the final 3-D design
is settled separately. The grid comes off the same document either way and the
3-D chunk stays lazy behind the realization control; `chart_joint_surface`
declares `kinds: ('surface',)` and nothing else, so there is one honest reading
to offer until it declares two. That is the one place the plan assumed a
declaration upstream has not made.

**Fixtures and the acceptance gate.** `capture_fixtures.py` captures every chart
document each kind publishes plus the bounds envelope, and writes
`dev/fixtures/charts.json`, which settles the name collision `dev/TODO.md`
flagged. `dev/scripts/smoke-charts.mjs` replays them through the real adapter
with no DOM and no WebGL: ten documents, every declared reading switched on and
checked to actually change the drawing, every mark placed, every window finite,
and no typeset string reaching a canvas.

Also fixed, found while moving the download button's source: `liveChart()`
returned the mount handle rather than the ECharts instance, so Save chart had
been throwing on Overview and Reinsurance since a60. Handles now expose the
instance through a getter, which is what the 2-D to 3-D rebuild needs anyway.

Two items from the plan fall out of this work rather than being separate jobs,
and are done: **7.3**, the exact end labels on a scaled axis, now suppressed on
every value axis in the adapter's walker; and **7.5**, reference-line label
sides, which the plan expected to come off the document and does not, since
`Mark` carries no side. It is a renderer decision and marks alternate sides so a
pair of anchors opens away from each other.

## 1.0.0a61

`dev/plan-ui-round-4.md` phase 6, the last of the round: the cession box grows a
form, a memory and a completion.

**Quick Re**, the cession entry renamed and given a quick-edit disclosure. The
typed box stays the default path and stays the record: the form *writes into*
it rather than applying anything, so the clause is on screen and editable before
Add re is pressed. Closed by default, so the page does not grow a form nobody
asked for.

**One layer, on purpose.** A multi-layer program is typed in the big box, which
is what that box is for. This is demo sugar and is worth having only while it
stays small.

**One field per quantity, two readings**, which is the form's whole trick and
the reason attach and limit each need one input rather than a pair: `50%` is a
probability and `500` is currency, so there is no mode to be in and no second
set of boxes to keep in step. Three consequences, each stated because each is a
place it could be built wrong. Share is exempt and is always a share, defaulting
to 100%. A percentage limit is a **detachment** probability, so `attach 50%
limit 99%` attaches at q(.5) with a limit of q(.99) minus q(.5), which is the
only reading under which a percentage limit means anything. And mixing is legal,
because each field resolves on its own.

**A quantile route**, `GET /objects/{id}/quantiles?p=…`, which the percentage
reading needs and nothing else served: `tail_df` carries VaR by return period,
so q(0.99) was reachable and q(0.5) was not. It answers with the exact quantile
**and** one snapped to three significant figures, rather than choosing for the
caller. The snapping is not cosmetic: quantiles land on the FFT grid and carry
every digit of it, so unsnapped the form produces arithmetic where a layer
should be.

Caught by testing the composed clauses against the grammar rather than assuming
them: the share form is `0.5 so 1000 xs 500`. The grammar's share token is the
two-letter `so` (and `po` for part-of), and a spelled-out `share of` is a parse
error, which is what the first cut emitted.

**The draft clears when the program changes identity**, which is the
distinction a51 was missing. Rebuilding what you are working on keeps the
draft, because that is the iteration a draft exists for; loading an example or
stepping history to another program throws it away, because a cession written
for one book is not a draft for another, and an attachment given as a
probability means something different on a different book, which is worse than
meaning nothing.

**Ctrl+Space completes in the cession box.** The completion endpoint takes a
whole program and a cursor into it, and a bare `250 xs 250` is not a valid
prefix of one, so the draft is spliced onto the end of the program in the editor
and the cursor offset to match: the grammar sees the clause where it will
actually sit. The answers feed the datalist that already opens on the box, so
the two openers it used to hold are now whatever can follow. No second editor,
and the Tab complaint goes with it.

## 1.0.0a60

**Matplotlib leaves the api.** Nothing here renders a picture any more: every
chart is a document, and the browser draws it. This is `dev/plan-plot-ir-api.md`
item 1 and the bounds half of item 5, brought forward because `aggregate` a239
removed the `plot_envelope` keyword the api was passing and there is no sense
repairing a route about to be deleted.

**The envelope is a chart document.** `GET /objects/{id}/bounds/envelope` served
SVG or PNG from a matplotlib figure and now serves the document
`charts.chart_envelope` emits, with the content hash as its ETag. The reader
gets a picture they can zoom and read values off, and the two renderers cannot
disagree about what the envelope is, because there is one document behind both.

It arrives with **two panels where the figure had three**, which is upstream's
call and the right one: the five calibrated distortions used to be split across
the last two panels, an accident of the order they were added rather than a
reading anyone wants, since the question is how the five compare. `bounds.py`
loses `ENVELOPE_PANELS` and `_drop_empty_panels` with the figure, and
`_envelope_overlay` becomes `_calibrate_for_envelope`, which still calibrates to
the request's own premium (the emitter reads that off the priced object) but no
longer has an opinion about which panel anything goes on.

**The 2-D path in the ECharts adapter**, which is what makes the document
drawable. `chartdocToEcharts` bifurcated at the top, by renderer capability
rather than by panel kind, so a heatmap will land with the 2-D side where a
kind-based split would file it with the surface. It realizes multi-panel
layout, axes with their declared scale and window, line series, and the `y2`
band, drawn as the lower bound plus the stacked gap above it with the stacked
half silent, since that half carries a delta and would read as a bound if it
answered a hover. Not yet: marks, the atomic ladder and the reading toggles,
each its own item in the plan.

Two things fixed on the way. The adapter read `meta.z_log_ok` for the surface's
log height, a field the library generalized into `ChartAxis.scales`, so the
toggle had silently stopped working; it reads the axis now. And lattice
coordinates are expanded, which `chart_agg` and `chart_reins` both need.

**The `/plot` route, `plotting.py` and `plot_default_format` are gone**, with
the four legacy kinds (`density`, `cdf`, `qq`, `kappa`). `/v1/meta` loses its
field. The Download plot item now exports the chart on screen through
`getDataURL`, which is a better answer than the route was: it saves exactly what
the reader is looking at, including their zoom, rather than a second rendering
of the same object at whatever window the server chose, and it costs no round
trip.

Recorded upstream in `dev/TODO.md`: the emitter's bracketing curves are drawn
with an unseeded `sample`, so a resampled envelope is not byte deterministic and
its ETag cannot revalidate. The band is deterministic, so the api asserts
revalidation at `n_resamples=0` and only there.

## 1.0.0a59

`dev/plan-ui-round-4.md` phase 5, two page-wide preferences in the header menu.
Both follow the Tables switch: a checked item, a sticky value, and a re-render
of every live pane.

**Perspective, Insurer or Raw.** The library owns the business translation
(captions, row flags, drops, relabeling), so this is a passthrough on the
exhibit route and nothing here knows what either reading does to a frame. The
route and the client wrapper both already took the parameter; the control was
what was missing.

Worth stating plainly, because the honest answer is "some of the page": the
leaves that respond are the five on the exhibit route, Economics Ledger, Ratios
and Waterfall, plus More Tail behavior and Dependency. Everything else, the
Overview tables, all four Reinsurance leaves and the rest of More, is served by
the frame routes, which carry no perspective. Closing that is the
`[Exhibits-App-Cleanup]` item in `dev/TODO.md`, not this one.

**Full precision, as a third state of the Tables preference** rather than a
fourth section. It answers the same question the other two do, how should a
table read, and the interactive view is already exact, so "Static, full
precision" is where it belongs.

Nothing is fetched that was not already on the wire. Every table document
carries the unrounded value beside the rendered text under `include_raw`, which
is what lets the interactive grid sort on real numbers; the new
`?precision=full` decides which of the two the **static** walker prints. A
summary that read `3.16` reads `3.16227766016838`.

Two details that were bugs first. Setting the house `float_format` alone
changes nothing on any frame with a `FORMATS` entry, because an explicit
`formatters` mapping beats the house default, so full precision drops the
per-column formats as well; doing only the obvious half looks like the flag was
ignored. And the format is `.15g`, not `.17g`: seventeen digits round-trips a
double exactly and prints its dust, so a mean the model computed as 1234.5 would
read `1234.5000000000002` and teach the reader about IEEE 754 rather than about
their book.

The content hash moves with the setting, which is correct rather than
incidental: the ETag has to tell the two readings apart or a reader switching to
full precision would be handed the rounded document out of cache.

## 1.0.0a58

`dev/plan-ui-round-4.md` phase 4, the action row. Three items in a fixed order,
because the third reuses the first.

**Reformat**, before the derive group and outside it. It rewrites the program in
the box into `format_program` form and builds nothing, so filing it under
"derive" would mislabel the one button in the row that leaves the object alone.
Both halves already existed, the `/v1/decl/format` route and its client wrapper;
this is the button that was missing.

The server is best-effort by design and echoes the input on any failure, so a
malformed program reformats to itself. The button says "unchanged" in that case,
which is also the honest answer for a program that was already canonical, and is
what stops a no-op reading as a dead control. That brought back the transient
label helper a55 removed along with the copy buttons, its only caller then.

Reformat is the one control in the row that never greys. It reads the text
rather than the object, so it works before anything is built, which is exactly
when a pasted program is least readable.

**Reset is gone.** Ctrl+↑ and Ctrl+↓ already walk back through the programs you
built, and a button that undid exactly one derivation was a second and weaker
way to do the same thing. `state.base` and `state.derived` went with it; they
had no other consumer.

**GCN took its place**, a split button defaulting to gross / ceded with gross /
net and net / ceded on the caret. It reads the current program as a pair of
views by **prefixing** it: the grammar takes `GROSSCEDED agg_out` and an
`agg_out` is a whole inline declaration, so this is client-side text plus a
rebuild, with no new route. The program goes through Reformat on the way, which
is why that item lands first.

Three details. Pressing GCN twice **swaps** the pair rather than stacking
`grossnet grossceded agg …`, which does not parse and would have reported as a
syntax error in a program the reader never typed. The result is a
`BivariateAggregate`, so the object's kind changes and the navigation re-gates
around it, which is why it lands on Overview: pressing this from Reinsurance
would otherwise leave you looking at a group that had just gone dark, since a
bivariate cannot cede. And a57's components block pays off here immediately, as
the new object's status line reads `bs = (a, b)` with the halves named Gross and
Ceded.

**A new capability flag, `can_views`, gates it**, and it is deliberately
narrower than `has_reins`. The view prefixes build the joint **per-occurrence**
aggregate of a pair, so they need an occurrence cession specifically: a program
carrying only an aggregate cession answers `has_reins` true and cannot serve
them. Greying with a reason beats failing on submit. A portfolio is out for the
other reason, that the prefixes take an `agg_out` and a portfolio cedes through
its units.

Still to come, recorded so it is not lost: adjusting the reinsurance from the
GCN view, rather than going back to rebuild it.

## 1.0.0a57

`dev/plan-ui-round-4.md` phase 3, the status strip's facts. Three items, all
through `_summary_fields` and `BuildResponse`, so this is the phase that moves
the response schema. Both additions are additive; nothing existing changed
shape.

**A bivariate's status line said nothing but its name and its kind.** Its `bs`
is a two element list, one grid per axis, so every scalar headline field
coerced to `None` and vanished. The pair is the honest answer, so the response
now carries a `components` block, `{name, bs, log2, mean, cv}` per half, and
the strip prints `bs = (10, 8) · log2 = (11, 9)` in the same slots as everything
else. `log2` is derived from the axis length, since this kind carries no such
attribute and the axis length is what log2 means; the library's own
`bs_description` computes it the same way.

Additive rather than widening `bs` / `log2` / `mean` / `cv` to "scalar or pair",
which would have changed the shape every consumer reads to describe one kind. A
block that is empty everywhere else costs those kinds nothing.

Validation reads **`n/a`** for a bivariate, because it has no
`validation_description` at all. It does have a correctness gate, the tail
deficit against 1e-5, but that is mass conservation rather than the moment
comparison every other kind reports, so relabeling it as a verdict would be a
lie. Asked upstream instead; see `dev/TODO.md`.

**The loss / payoff convention now reports, and only when it is payoff.** Read
off the public `value_type`, printed between `log2` and `mean`. Loss is the
default and the overwhelming case, so reporting it every time would spend a word
on the strip's first line to say "normal".

**Warnings reach the page.** `BuildResponse.warnings` has existed since the
beginning and was always empty: the field was declared and the capture was never
written. Both channels are now collected for the duration of a build, since the
library uses both and the larger one is logging, not warnings.

Three details worth knowing, each of which was a bug first. The capture is
opened **inside the build worker**, not around the future, because
`catch_warnings` swaps module state a warning raised on another thread would not
reliably see. It is safe to touch that global state because `_build_semaphore`
admits one build at a time and the executor has a single worker, so there is
exactly one writer. And each caught warning is kept only if it was raised from
**inside the `aggregate` package**, tested by path: `catch_warnings` is
process-wide and lifting the default suppressions made a first cut report
`unclosed database in <sqlite3.Connection ...>`, which is the api's own audit
log, on every single build.

Warnings are stored on the cache entry, so a cache hit reports what the miss
reported: a warning describes the object, not the request that happened to build
it. They render in the strip's note slot beside a derivation's own account, and
deliberately do **not** tint the strip, because the ground carries the
validation verdict and two claims on one surface is one too many.

**Caught in passing: the chart IR is at version 2.** `aggregate` a238 lets a
series carry a coordinate as a lattice, `(start, step, count)`, which an old
reader cannot draw at all, so the version moved. Nothing here is broken, because
the only chart the adapter realizes is the surface and it still ships explicit
coordinates. `chart_agg` and `chart_reins` do use lattices, which is recorded in
`dev/plan-plot-ir-api.md` as the adapter's first job rather than a refinement.

## 1.0.0a56

`dev/plan-ui-round-4.md` phase 2, the status strip's verdict and its history.
Three items, all client side.

**A clean object under reinsurance no longer reads as a warning.** The library
prefixes its verdict once a cession is present: a sound gross reports
`reinsurance; subject not unreasonable`, because the realized net view has no
independent theoretical to check against, so what it can honestly report is the
status of the subject it was built from. `validationState` tested for the bare
phrase, missed, tested for the word "mean", missed, and fell through to the
amber state. So every reinsured object with a perfectly clean gross tinted the
whole strip orange.

It now strips the prefix and grades the remainder, which is right for a better
reason than a second literal would have been: `reinsurance; subject fails agg
mean` reaches the failure state because it names the mean, rather than because
the substring happened to survive.

**`DecL m/n` under the editor**, saying where Ctrl+Up and Ctrl+Down have you.
Counted from the oldest so that stepping back counts down, which is the
direction the reader feels. It says "in your history" rather than "this
session", deliberately: the entries live in localStorage and outlive the tab, so
a session count is a number the module cannot honestly produce.

**The strip blinks once on every adopted build.** The readout does not answer
the case that prompted it, building the *same* program twice, because history
dedups against the most recent entry and both numbers hold; the strip then
redraws with identical text and the press looks lost. The blink animates the
left bar's width rather than the ground, since the ground carries the verdict
and flashing it would read as the object briefly changing state. It fires for
cached and computed builds alike, because the reader is asking whether the press
registered and that has one answer either way. Suppressed under
`prefers-reduced-motion`.

**`cached` comes off the first row.** It said on line one what line two already
says in words, in the middle of the object's own facts, where a property of this
particular request does not belong. What it was incidentally doing, marking a
rebuild as a no-op, is now the blink's job and is done for every build rather
than only the cached ones.

## 1.0.0a55

`dev/plan-ui-round-4.md` phase 1, the nav and its greying. Five items off the
author's second pass over the running site. No server change.

**A greyed group tab explained itself to nobody, and had not since a48.** The
report was that hovering a dark tab does nothing while a dark sub-tab shows a
message, and the cursor was the clue: it stayed an arrow instead of becoming the
"not allowed" sign the stylesheet asks for, which meant the rule was not
matching.

`applyCapabilityGating` sets both `nav-off` and Bootstrap's `disabled` class on a
dark group tab, the latter so Bootstrap's Tab plugin refuses to activate the
trigger. But `.nav-link.disabled` carries `pointer-events: none`, so `:hover`
never fired and the `data-why` tooltip could not draw at all. The sub-tabs are
plain buttons that never take the class, which is why one level of the menu
explained itself and the other stayed silent. The a48 comment at that line
worried about the native `disabled` **attribute** doing exactly this and set the
class instead, not noticing the class does the same thing by another route; both
the comment and the rule are corrected.

The fix restores `pointer-events: auto` under `.nav-link.nav-off` and keeps
Bootstrap's guard. Nothing becomes clickable: the click was already refused in a
capture-phase handler, which was the second of the two guarantees all along.

**The tooltip is quieter, and the panic cursor is gone.** It was a near-black
card with a 12px drop shadow, which is the styling of an alert for what is a
footnote naming which object would answer. It is now a bordered note on the
page's own surface, and `cursor: not-allowed` comes off both levels.

**Copy buttons are gone from the app.** Both leaves that declared one
(Validation, Narrative), the branch in `renderSubTabs` that drew it, `copyPane`,
the `[data-copy]` wiring no markup ever used, and `flash`, which had no other
caller. The app had grown two export stories and only one earns its place:
CsvGrid's own copy and save is on every table, exports raw values rather than
rendered text, and is what the author uses. A button beside the sub-tabs copying
a pane's `innerText` was the worse answer in the more prominent spot.

**Validation moved from More to Overview**, after Tail. It is the verdict on
what Plot, Summary and Tail just showed, so it belongs beside them rather than
in the specialist menu. Same frame, same options; only the pane id changed.

**The Reinsurance row reordered** to Plot, Summary, Stats, Density, parallel to
Overview. One visible consequence, accepted: a reinsured aggregate now opens on
Plot. A reinsured portfolio still opens on Summary, because `chart_reins` is
registered for `Aggregate` alone.

**A little more air around the sub-tab row**, and equal above and below, so it
reads as a level of the menu rather than as something attached to the tabs.

`check-nav.mjs` gains the moved leaf and confirms the live set is unchanged by
both moves, which is the point of asserting it there rather than trusting the
edit.

## 1.0.0a54

Catching up with `aggregate` a230, which broke the chart route and shipped the
two things `dev/plan-plot-ir-api.md` was waiting on. Not a plan item: the whole
test suite was red on `main` before any of Round 4 started, and this is the
green baseline the round is built on.

**The chart route stops unpacking the registry.** `GET /objects/{id}/chart/{name}`
read `emitter, _predicate = charts.CHARTS[name]`, and the registry value grew a
third field (`primary`, backing the new `charts.primary_chart`), so a two-name
unpack of a three-field record raised `ValueError` and every chart 500'd. Five
tests red.

Fixed by depending on the accessor rather than on the container: the route now
calls `charts.build_chart_doc(obj, name)`, the library's one public entry point,
which resolves the entry, checks the emitter's own availability predicate and
stamps the hash. The next field added to `ChartEntry` is now a non-event here.
Two things come free: a document on the wire carries `generator`, naming the
`aggregate` version that produced it, and the emitter's predicate is enforced as
a second, narrower gate behind the `available_charts` check that produces the
404.

**Two test premises had gone stale, both from emitters landing upstream.**
`chart_agg` has shipped, so a plain aggregate reports `available_charts ==
['agg']` and a test asserting `"available: []"` was asserting that no such chart
existed yet. It now asserts what the route actually promises, the refusal plus
the signpost, read off the object's own capability set, so the next emitter does
not break it again.

The other is the surface pilot's `meta['z_log_ok']`, which the library
generalized into `ChartAxis.scales`, the tuple of readings an axis admits. That
is the schema half of `plan-plot-ir-api.md` item 6 and it landed **at
`ir_version` 1**, additively: `scale` remains the default reading, so a consumer
that ignores `scales` still draws correctly. `full_range` (the zoom-out
declaration), `reciprocal_of` (the return-period pairing) and a panel's `kinds`
(the realization list) arrived on the same terms. Noted in that plan, where it
unblocks the 2-D adapter.

No SPA change, and no behavior change beyond charts working again.

## 1.0.0a53

`dev/plan-chart-draw-styles.md`. A regression fixed, and two things that were
never built. Also the packaging tidy that preceded it, which carried no bump.

**The density is steps again.** a50 replaced an unconditional `step: 'middle'`
with the library's three-rung ladder, including its third rung: a plain line
under three pixels per atom. That rung wants between 41 and 141 visible atoms on
a 424px panel. No real book is in that band, so steps went from *always* to
*never* and every density drew as a line. Measured: a lognormal at log2=16 has
28,813 atoms in the crop, 0.015 px each.

The rung is sound where it came from. `plot_chartdoc` draws a static figure, and
sub-pixel steps and a line really are the same pixels there. This chart zooms,
so "how many pixels does an atom get" is not a property of the data, it is a
property of a gesture that has not happened yet. There is no pixel rung now:
atomic and over 40 visible atoms is steps-mid, at any density. `sampling:
'minmax'` already bounds what that costs.

**S and F are stepped, which they never were.** `rightSeries` carried no `step`
at all in its whole life, so a survival over a discretized law drew as a polyline
sloping between atoms, through values the law does not take. It is steps-post
(`step: 'end'`), not steps-mid: a cumulative jumps *at* the atom and holds to
the right, and it never reaches the stem rung because it takes a value
everywhere rather than only at the atoms. That is the library's own split, and
it is why `cumulativeStyle` is a separate function rather than an argument.

**Zoom changes the drawing.** The option has carried `dataZoom` from the start
and nothing ever listened to it, so the lollipop rung was reachable only on a
book that was already tiny, which is not what it is for. The listener re-judges
the rung from the zoomed window and redraws only when the answer changes, since
a wheel gesture fires continuously and rebuilding per notch would be an option
rebuild per frame. The held zoom is written back into the new `dataZoom` config,
because the replace that a redraw performs would otherwise reset the range and
undo the gesture that triggered it.

**Not the cause, and worth recording**: the parallel `aggregate` work found that
`ChartSeries.support` was being stripped from the canonical dict whenever it
equalled its `'atomic'` default, so the instruction to draw steps reached nobody
while `'continuous'` survived. Real, and already fixed upstream. It could not
have caused this, because the Overview plot reads **frames**, not chart
documents: `agg`, `port` and `pnl` register no chart at all. The app's only
consumer of the chart IR is the bivariate surface.

**The smoke test now shows its working.** It prints the atom count beside the
rung it chose, which is how a threshold no book could reach survived a green
run, and it gained a zoom case proving the stem rung is reachable by narrowing
the window rather than only by a small object.

**Upstream catch-up.** `aggregate` 1.0.0a227 gave `PnL` and
`BivariateAggregate` the current `tail_df` contract, so a P&L's `tail_df` route
answers 200 where a test pinned 400. The navigation is unmoved: Overview / Tail
gates on the `tail` exhibit, which a P&L still does not register.

**Packaging, no bump of its own.** `greater-tables` is an ordinary registry
dependency now that 6.0.0 has shipped, floored at `>=6.0.0` because PyPI still
carries the 5.3 generation under the same name and it fails at import rather
than at install. And the repo stopped committing `.venv`: it was tracked as a
`120000` symlink blob holding a Windows absolute path, so a Linux checkout got a
dangling link. `.gitignore` said `.venv/`, and a trailing slash matches
directories only.

## 1.0.0a52

`dev/plan-ui-round-3.md` phase 4, the reinsurance and pricing forms. Nine
items. Phase 5 is deferred: it waits on the companion `aggregate` plan, which
has not started, so `evaluate`, `alloc`, `cession` and `replot` stay open.

**The Bounds figure has three panels, and they have something in them.** This
was the item the plan said to diagnose before touching, and the diagnosis is
the whole fix. The figure was always a one by three grid; the api asked for
`distortions='space'`, which matches neither of the library's two overlay
branches, so the block that draws panels 2 and 3 was skipped entirely and they
came back blank. "Only one panel" was one drawn panel beside two empty boxes.

`'space'` was chosen because `'ordered'`, the shorthand that does fill them,
raises for anything that is not a Portfolio carrying calibrated distortions.
Building the list ourselves lifts that: the five named distortions are
calibrated to **this request's own premium**, which is what panel 1 is the
envelope of, so the three panels finally answer one question. The cost of
capital `calibrate_distortions` wants is the pentagon identity away from the
premium and the asset cap, and the limited expected loss comes from the
library's `prob_loss_assets`. An aggregate gets three panels too now, which
`'ordered'` could never give it. Without an asset cap there is no capital and
so no calibration, and the two panels are **removed** rather than shipped
blank.

**The assets anchor works on a reinsured object.** The Price form has offered
`p` or assets since a44, and `ReinsPriceRequest` required `p` and had no `a`,
so choosing assets on a reinsured object was a 422 from the model before any
pricing ran, while the identical choice on a plain object was fine. No library
work was needed: `prob_loss_assets` answers a mutually consistent `(p, L, a)`
from either end, so the route resolves the anchor on the calibration basis and
the rest of the path sees one `p` exactly as before.

**An aggregate gets its distortion parameters.** Four pricing cases and they
disagreed: an aggregate with no reinsurance returned one row of pentagon
results and nothing else, while the same aggregate *with* a cession showed the
parameters down the reins path, and a portfolio showed them either way. The
non-portfolio path returned before calling `calibrate_distortions`, which is on
`Aggregate` as well. Allocations stay portfolio-only, and not by preference:
`analyze_distortions` reads the `exeqa_*` columns a single aggregate has no
analogue of.

**"Calibrate on" is one control, and it greys.** It stacked three visual
languages down the tab, house-red toggles over Bootstrap grey radios over a
blue button; it is a divided button group like `derive` now, grey for active,
matching the p / assets pair directly beneath it. And it no longer vanishes: on
an object with no cession the row used to empty itself, so the form changed
shape between examples and the choice was invisible until you happened to load
something reinsured. Which of the three are live comes from a new `reins_bases`
capability field rather than from offering all three and finding out: a
portfolio has no `p_agg_net_occ` and an occurrence-only program's net occ *is*
its net, so at least one button was wrong on most objects.

**PricingBounds on a portfolio defaults to every unit.** That is the question a
portfolio invites, and having to type one unit name to ask any of it made the
default answer nothing at all. Naming a unit still narrows to it and a DecL
fragment still prices a line that does not exist yet. An aggregate has no units
to default to, so the empty case stays the error it was.

**The cession row.** `Adjust cession [box] [Add reinsurance]`, with the
description on its own line beneath the pair rather than trailing the button,
and real space under it. The box keeps what you last ceded across a reload,
because ceding is iterative and clearing it on success made every retry a
retype of a clause the grammar accepts no abbreviation for; the editor is the
record, and this box is a draft. A datalist offers the two openers, which is as
far as this goes: `occ` and `agg` are not accepted in that position, and there
is nothing shorter to offer. The row greys rather than disappearing when a
cession cannot apply.

**The reinsurance plot says what its buttons do.** The three bases are three
gross / ceded / net readings taken at different points in the program, and the
explanation existed only as a native `title` that arrives after a second of
hover. It is a line under the buttons, including the trap it was hiding: the
third triple's first column is the aggregate cover's *subject*, what the
occurrence program left, and reading it as gross understates the cession
whenever both stages are present.

**Off-scale sizes.** The last three inline `font-size` rules in the markup, at
`.7rem` and `.74rem`, neither of them a step on the scale.

## 1.0.0a51

`dev/plan-ui-round-3.md` phase 3, the text and the tables. Eight items.

**A derived program comes back readable.** All three derivations collapsed their
program to one line, so a wrapped portfolio arrived as several hundred
characters of unbroken DecL in the editor, which is the one place it has to be
editable. They render through `format_program(layout='spread', trailer=True)`
now, one clause per indented line.

`trailer=True` is load bearing, not cosmetic. The default is `False` and it
silently drops `note{}`, `tags{}` and `hints{}`; Sharpen's whole contract is
that the `hints{}` it writes rides on the returned text, so a program rendered
without its trailer looks right and rebuilds on the old grid. **The same default
was a live bug in the session `.agg` download**, which stripped the trailer ten
lines after `spec_to_decl` emitted it: every file exported before this is
missing its `hints{}`.

The cache key is untouched, and does not need touching. `post_object` collapses
before it hashes, so a spread program already hashes to its collapsed twin's id;
what a derivation shows and what the cache is keyed on differ only in
whitespace. The one place that needed care is Sharpen, which computes its own id
to re-file the moved entry, and keeps hashing the collapsed form.

**Tail behavior is a leaf, and it works.** `tail_behavior_df` was drawn as a
second block inside Overview / Tail, which was wrong twice over. Wrong on the
merits, because `tail_df` is the return-period ladder read off the computed grid
and this is the analytic classification of the frequency, severity and aggregate
tails, sub or super exponential, bounded, concentrated: two different questions.
And it had never actually rendered, because that pane takes the *frame* route,
`tail_behavior_df` is not in `_CSV_FRAMES`, and the loader swallows a failed
fetch. It is a More leaf now, off the `tail_behavior` exhibit the library
already registers and the api already serves, so it needed no backend change at
all.

**The grid audit is visible.** Sharpen computed `sharpen_df` and threw it away:
the reader was told a grid had moved and never shown the search that moved it.
More gains a Sharpen leaf with two blocks, the score grid
(`score.unstack('d_log2')`, the library's own picture, `d_bs` down and `d_log2`
across, lower better, NaN where the walk ran out of budget) and the full
per-cell frame under it. Gated on a new `has_sharpen` capability flag, which is
**not** the negation of `can_sharpen`: one asks whether running a probe is worth
offering and the other whether one has run, and an object can answer yes to
both.

**The layering analysis reads the way it is used.** `reins_stats_df` arrives
with the measures down and the layers across, and it holds two different kinds
of thing in one table. It is now two, both with the layers down the rows, where
the eye compares gross against ceded against net: the **terms**, share, limit,
attachment and the probabilities of reaching each layer, and the **moments**,
what the layer does to the frequency, severity and aggregate distributions. A
portfolio carries a different frame with no terms at all, and takes the same
treatment with view by unit down the rows.

**Money reads as money.** `tables.FORMATS` never reached the generic frame
route, which passed no format key, so `summary`, `tail_df`, `stats_df`,
`validation_df`, `bs_window_df` and every reins frame were pure dtype inference,
and inference drops the decimals once a column's mean reaches 20,000. A book
worth pricing reported its VaR as a whole number of dollars. The route passes
each frame's own name now, and the pentagon's money columns are declared: `P`
was `,d` outright and `L`, `M`, `Q` and `a` fell through, so the margin, which
is the small difference between two large numbers, was the column losing the
most.

`frame_spec` also matched format keys against the **first** level of a spanned
header, so a frame with `(component, measure)` columns matched none of its
declared measures and quietly fell through to inference for the whole table. It
matches the innermost level now, which is right: a format belongs to the
measure, not to the block it sits under.

**The window says what it shows.** `x_max` and `W` printed at full float width,
because those columns arrive as `object` dtype and inference has nothing to work
from. Declared, along with the leaf's own lede: each row proposes a window
`[x_min, x_max]` of width `W`, and the grid `bs · 2^log2` that covers it.

**Every leaf has a lede.** `nav.js` has carried a `hint` per leaf since a44 and
`renderSubTabs`'s comment says it "moved into the exhibit lede"; it had not, and
the only two ledes on the page were hardcoded strings for the Overview pair.
Every leaf renders its own now.

**The Ledger's caption stays on screen.** The walker draws it as a real
`<caption>` inside the table, `.gt` is `width: fit-content`, and `.gt-host` is a
horizontal scroll container: so a paragraph of caption prose *set the table's
scroll width* and ran off the right of the screen, dragging a reasonable table
into a scroll it did not need. Capped at `--measure` like every other run of
prose, and lightened off the walker's 600 weight, which read as a section
heading rather than as a note on a table. Exhibit blocks also get vertical air
between them; stacked flush, a two-block exhibit read as one table that changed
its mind about its columns half way down.

**The Narrative pane is in reading order.** It came out sorted by attribute
stem, which is alphabetical over names the reader never sees. It is info, bs,
validation, tail, reins, sharpen, with anything the library adds later appended
alphabetically so a new stem still appears without an edit.

## 1.0.0a50

`dev/plan-ui-round-3.md` phase 2, the charts. Six items, all in
`web/src/charts/`, none of them touching what is computed.

**The density draws at the honest density, on the library's ladder.** Not one of
ours: `aggregate/charts/ir.py` states it renderer-agnostically and
`aggregate/plots/_chartdoc.py` implements it for matplotlib with the same two
constants, `LOLLIPOP_ATOMS = 40` and `STEP_PIXELS = 3`. Forty or fewer atoms in
view and each is drawn as a stem with a dot on the end; three or more pixels per
atom and it is steps centered on the grid point; under that, a plain line, since
steps and a line are the same picture at that size. Counted in atoms **in view**,
so a zoomed window is judged on what it shows. Dice now comes out as a lollipop,
which it has not since the exhibit landed.

Through a49 the density was `step: 'middle'` unconditionally, on the argument
that a condition which can only be wrong in one direction should not be a
condition. That was right about the *old* condition, a guess at "is this
discrete" from a count of nonzero points; it is not an argument against a rule
about how much room each atom gets.

**A severity is a line.** Its x values are samples of a function that exists
everywhere between them, not the mass in a bucket, so the aggregate's reasoning
for steps does not apply to it and never did: one shared `densitySeries` was
applying it to every kind that passed through. `densityStyle` now takes the
support kind, `atomic` or `continuous`, which is the library's own vocabulary.

**The twin axis is gone, and with it the panel that moved on its own.** The tail
panel carried a second y axis on its right showing whichever reading the
`return period` toggle had not picked. That left the toggle deciding nothing and
asked the reader which of two scales they were looking at. It also reserved 52px
only when log y was on, and the two panels split what is left, so pressing log y
on the *right* panel resized the *left* one. Deleting the axis is what fixes
that; the geometry is now a function of the host width alone and reads no view
state at all. The panels are 26px wider each for it.

**Reference lines mean all of them, on both panels.** The toggle governed the
mean and the density panel's single anchor while the tail panel's anchors were
computed outside the guard and stayed lit regardless. The anchors are also
1-in-100 and 1-in-200 now, `q(0.99)` and `q(0.995)`, rather than 100 and 250:
a reader asking for a reference line is asking where capital sits, and in this
book that is Solvency II. Both are on the library's default ladder.

**The 1-in-200 label is beside its rule, not on it.** The density panel took a
plainer mark mapping that dropped the `align` the anchors carry, which was
invisible while it drew one anchor and became a label on top of its own line the
moment it drew two. Both panels take one mapping now.

**No more six-figure tick at each end of every x axis.** ECharts always draws a
tick at an explicit `min` and `max`, and ours are the crop padded by two percent,
so the endpoints are arbitrary reals and printed at six significant figures. The
two endpoint labels are suppressed; the window itself is untouched, because
rounding it would move what the reader sees to make a label look better.

**The smoke test stops assuming.** It split the two panels by counting series in
half, which the stem rung breaks by drawing each density as two. It now splits
on `xAxisIndex`, and it asserts the rung the ladder chose against the series
actually built rather than asserting that everything is stepped.

## 1.0.0a49

`dev/plan-ui-round-3.md` phase 1, the shell and the status strip. Nine items off
the author's punch list, taken after the first end-to-end run of the whole site.

**Bootstrap blue is gone, this time actually.** a47's comment said it was, and
it was not: `--house` and `--primary` are our tokens and Bootstrap reads
neither, so Cede, Price, Evaluate, Compute and the help panel's Load it all
still came out `#0d6efd`, as did every link the sheet had not styled by hand.
`site.css` now maps `--bs-primary`, the `--bs-link-*` pair, `--bs-focus-ring-color`
and the `.btn-primary` token block onto the house red, with `--house-dark` for
the pressed state and `--house-ring` for the focus ring.

**The identity row goes.** The Overview header repeated the name and the kind
that the status strip says two centimetres higher, at a larger size, so the page
had two headings for one object. What is left is the material the strip does not
carry, the tags and the note, on one quiet line above the group strip.
`--fs-title` keeps its place in the scale with no subject rather than leaving a
hole for the next page title to fall through.

**The status strip, rebuilt.** Line one is name, kind, `bs`, `log2`, mean, CV
and the verdict, every item joined by the same separator; the kind used to hang
off the name on a bare margin, which made the one gap that was not a separator
the first one on the line. `log2` is new, and joins `bs` because the two are one
fact: bs is how fine the grid is, log2 how far it reaches. Line two is a new
note slot, and line three is `Calculated in 0.000 seconds` with no kind word,
since the kind is now directly above it.

**Sharpen's verdict survives being read.** `noteDerivation` wrote the sharpen
message onto the timing line, which the very next `renderTiming` overwrote, so
the one sentence saying what the probe decided was on screen for less time than
it took to read. It has its own slot now.

**A failed build says what was wrong, in the strip.** It said the literal
`build failed` and threw the server's message away, while the real account went
into the Overview pane below the tab strip. The strip now carries the line,
column and message off the `ErrorReport` the server already sends; the caret
pane stays where it is, as the detail. `error-pane.js`'s header documented a
`kind` field and an `expected_labels` field, neither of which the library has
ever sent, and the code was resolving on the fallback.

**Every greyed group says why.** `whyGroup` took a reason only when *every* leaf
agreed on one, and three of the four groups that can grey do not agree, so
Economics, Pricing and Bounds all collapsed to "not available for this object".
It takes the first leaf's reason, which is the group's reason in all four cases
and not by accident: a group's leaves run from its general answer to its
specialized ones. Group tabs also carry `aria-label` now, so the two levels of
the menu explain themselves by one rule instead of two.

**Tab order is the demo flow, and cannot drift again.** Overview, Reinsurance,
Pricing, Economics, Bounds, More: look at the gross book, add reinsurance,
decide what to charge for what is left, then read the economics. Economics sat
second, which put a P&L's group, dark for most objects, where the eye lands
first. The order is written twice, as `NAV_GROUPS`' key order (which `Alt+1…6`
indexes) and as the markup in `index.html`, and nothing checked that the two
agreed; `dev/scripts/check-nav.mjs` now parses the strip and asserts it.

**The action row.** The key hints become two lines split by kind, what you do to
the program over where you go. The emacs switch leaves the row for the hamburger
as a checked item under an `Editor` header: it is a preference, not an action,
and it was the one control there that does nothing to the object. Not a form
switch in a menu, because a form control inside a `dropdown-menu` holds the menu
open on click; the check-style item that toggles and closes is what Tables
already does, so `.table-view-item` is renamed `.menu-check-item` for the two of
them.

**Group tabs are 80% of their old height.** Height is two paddings plus
line-height times font-size, which is why trimming the padding alone never got
there. The bare `1rem` was also the only label on the page off the five-step
scale, sitting between `--fs-body` and `--fs-head` and reading as neither.

## 1.0.0a48

Not from a plan. `dev/TODO.md` closed the navigation work with a warning that
nobody had clicked any of it, and the first pass over the Bounds group found it
dark for every object.

**Bounds lights, for an aggregate or a portfolio.** `capability.py` has emitted
`can_bounds` and `can_allocate` since a46, and `nav.js` gates the three Bounds
leaves on them, but `main.js` never copied either onto the object it handed the
rules. Both read `undefined`, so all three leaves greyed, and with no live leaf
the group pill greyed with them: there was no object anywhere in the app that
could reach Bounds. An aggregate and a portfolio now light Bounds and Pricing
Bounds, and a portfolio also lights Allocation Bounds, which is the set
`aggregate.bounds.Bounds` accepts. Nothing else moved: the routes, the forms and
the three loaders were all built and correct.

**One capability object, which is why it cannot recur.** `nav.js` already
exported `capsFromResponse`, the correct build-response to rules mapping, and
its only caller was `dev/scripts/check-nav.mjs`. The app assembled its own
equivalent by hand from seven `canX` fields copied onto `state`. So the checker
and the app read different shapes, the checker expected Bounds live for `agg`,
`agg_reins` and `port` and passed, and the app greyed it. `state.caps` is now
that one function's output, read by the rules and by the six call sites that
used to reach for a loose field. A flag added in one place and forgotten in the
other is no longer expressible.

**Stale text.** The gating docstring claimed Bounds greyed because its leaves
were marked `soon`, which stopped being true when they were built; the About
panel still listed Bounds as "(coming)"; and `main.js`'s file header still
described the tab set from before the six groups landed.

## 1.0.0a47

`dev/plan-revamp-aug-06.md`, executed in one batch. The page around the output
is rebuilt. Nothing about what the app computes changes; this is the shell.
Designed in `hacks/mockup-10-concepts.html` over five rounds against the running
api, three concepts down to one.

**A type scale, at last.** Five steps (`--fs-meta` through `--fs-title`)
replacing the twenty distinct sizes the sheet declared between `.6rem` and
`1.05rem`. Nothing on the page except the brand used to be larger than
`1.05rem`, so hierarchy was being signalled by one pixel steps the eye cannot
resolve, and nothing read as a heading.

**The press ramp and the house red.** `--ink` / `--ink-2` / `--mut` go to pure
black through true neutrals, over Bootstrap's greys, which are three colors from
three different hues pretending to be one ramp. `--house #a81313` becomes the
accent and keeps its old job on inline `code` and the parse-error caret. Blue
leaves the page entirely. Build therefore carries no color: the accent means
*selected* and Build is not a selection, so it leads by weight and position
instead. `site.css` is fully tokenized on the way through, from 7 tokens and 49
inline literals to no color outside `:root` except a handful of one-off tints.

**One green.** `--green` is the editor's own string green, now read from
`:root` by `cm6.css` too, so there is one green in the stylesheet instead of two
that differed by a few points. Worth recording that the premise this started
from was wrong: the editor's *numbers* are copper `#b87333`, not green, and a
DecL object name is plain text rather than red.

**Real tabs.** The six groups become folder tabs, drawn from the same Bootstrap
`nav-pills` markup with the Tab plugin, the panes and the capability gating all
untouched. Every tab is drawn, not only the selected one: previously only the
active pill carried a background, so landing on More left the left half of the
strip looking like loose text under a rule. The active tab is filled in the
accent and paints 2px over the strip's rule, so tab and content read as one
surface.

**A sub menu that reads as a menu.** Letterspaced small caps, so the two levels
differ in case as well as size. The sub menu and the panes indent by `--tabpad`,
the tab's own left padding, so everything below aligns with the first tab's
*label* rather than its box edge. `renderSubTabs` emits `sub-link` rather than
`btn btn-outline-secondary`, whose Bootstrap `.active` was a solid dark fill:
the child level shouted while the parent whispered.

**The identity block moved above the group strip.** It was between the two menu
rows, which is why they never read as parent and child.

**One action row, one status strip.** The button row and the feedback line
merge; Sharpen, PnL and Reset collapse into one labelled `derive` group, because
each writes DecL back into the editor rather than acting on the object. The
summary line and the timing line share one bordered container that wraps and
never overflows.

**Validation grades into three states.** "not unreasonable" is the good one and
reads green. A wrong mean is a hard failure and reads scarlet; cv, skew and the
defective-distribution warning read orange. Each of the two bad states tints the
whole strip rather than only coloring a word, because hue alone is too weak for
a state you must not miss and a scarlet failure must never be mistaken for the
brick red of a selected tab.

**One line per exhibit.** `<b>Return periods</b>: VaR, TVaR and xsVaR by return
period` replaces a heading over a separate hint line. On Overview / Summary the
old pair said "Summary" twice, at two sizes and two alignments, a few pixels
apart. The sub-tab hint line is deleted; this is where it went.

**Greyed items say why.** A `why:` string per leaf in `nav.js`, plus `whyLeaf`
and `whyGroup`, rendered as a drawn tooltip rather than a native `title`, which
Chrome sits on for about a second. A Severity lights 3 leaves out of 22, and a
wall of grey that explains itself is a map of what the object is. Dark items
keep their pointer events so the tooltip fires and refuse the click in the
handler; `disabled` would have suppressed both. `check-nav.mjs` confirms not one
gate moved.

**Keyboard navigation.** Roving tabindex on both strips, so Tab makes one stop
per strip rather than walking nine buttons. Left and Right move within a strip
and skip everything dark, Home and End jump to its ends, and `Alt+1…6` reaches a
group from anywhere including the editor. Alt is the one modifier the editor
does not already spend.

Not in scope, and still Bootstrap-colored: `gt.css` (served from the
`greater_tables` package), `csv-grid.css`, and the ECharts palette in
`web/src/charts/theme.js`.

## 1.0.0a46

Stages 5, 6 and 7 of `dev/plan-loss-lab-navigation.md`, which closes the plan.
The reinsurance entry box, Bounds with real content, and the Narrative pane.

**Cede a layer.** One box and one button below the Reinsurance sub-tab row,
because the editor is the preview: the derived program goes straight into it
and builds, so a separate copy control would be a second control for a thing
already on screen. `POST /objects/{id}/reins` over the library's
`reins_program`, which mutates the spec and re-renders rather than splicing
text. That matters: an occurrence cession sits before the frequency clause and
an aggregate cession after it, so a clause cannot simply be appended. One
clause per tier, and a clause is authoritative for its own tier.

`can_reins` joins the capability block, and it does something the other flags
do not: it keeps the Reinsurance **group** live when every leaf in it is dark.
An aggregate with no cession has nothing to tabulate or draw and is exactly the
object you want to add cover to, so `NAV_GROUPS` grew an `alsoLive` field
rather than the group name being special-cased in `groupAvailable`.

**Bounds stops being a placeholder.** Three leaves against the three classes in
`bounds.py`. Ordinary pricing picks a distortion and reports its number; these
hold the calibration fixed, let the distortion range over everything consistent
with it, and report how wide the answer can be. The width is the reading: narrow
means the premium decided the price, wide means the distortion did.

`GET /bounds/envelope` is the three-panel figure as an SVG, a GET because it is
an image identified entirely by its query and so cacheable by the browser.
`POST /bounds/allocation` is per-unit natural-allocation ranges, portfolio only
and not by our choice: it reads the `exeqa_*` columns a portfolio's density
frame carries. `POST /bounds/pricing` carries the calibration across to a second
risk, which is the question behind quoting a new line off an existing book, and
its target is either a unit of the current object or a DecL fragment for a line
that does not exist yet. A fragment is an ordinary build reached by a different
door, so it answers to the same log2 cap, and there is a test that it cannot be
used to get round it.

**The plan's cost worry was unfounded, and now it is measured rather than
argued.** Constructing a `Bounds` is 0.01 s, `cloud_df` 0.12 s, and the
fifty-resample envelope 0.5 to 0.9 s. The resamples are overplotted columns
drawn from a frame that is already computed, so asking for fifty rather than
none costs the drawing and nothing else. `test_the_envelope_is_not_expensive`
times both and asserts the second is not a different kind of request.

Two more derived gates: `can_bounds` and `can_allocate`. These are `isinstance`
rather than `hasattr`, unlike every other flag, and the difference is honest.
The others name a method the object either has or does not; `Bounds` declares
the types it accepts, and a duck-typed near miss would fail somewhere deep
instead of at the door. It is still the library deciding, just through a
different door.

**Narrative** replaces "Info (raw)". The `info` block first, then a section per
text field the object carries, each with its short form and its long one.
`GET /objects/{id}/narrative` finds them **by suffix**, so a `*_description` the
library adds upstream appears with no change on either side, which is the same
contract the exhibit and chart routes keep. An aggregate reports five sections
where the old view showed one block, so the descriptions and explanations the
library has been writing all along are finally reachable from the page.

One judgment recorded: "Sharpen: not run." and "No reinsurance" stay. The
library writes an informative line where a narrative has nothing to report, and
that reads better than silence, since a missing Sharpen heading looks like an
app that forgot it. Genuinely empty strings are dropped; nothing matches on the
text, which would rot the moment a sentence was rephrased.

Sixteen new tests in `tests/test_bounds.py` and six more in `test_derive.py`.
`check-nav.mjs` carries the Bounds expectations and one rule of its own: the
Reinsurance group is live with every leaf dark for a gross aggregate, and dark
for every kind that cannot cede.

## 1.0.0a45

Sharpen, PnL and Reset join Build and Examples, and the log2 and bs dropdowns
come out. Stage 4 of `dev/plan-loss-lab-navigation.md`.

Both derivations answer with the DecL that reproduces the object **and** the
object itself. The text lands in the editor, so you read what was built, you
can edit it, and history, sharing and rebuild all keep working. The grammar
knowledge stays in the library, where `sharpen_program` and `pnl_program`
landed at a213 and a215; these routes only call it and file the result.

**The cache entry moves with the object, and nothing is rebuilt.** `sharpen`
moves its object in place while the cache is keyed on a hash of
`(decl, log2, bs)`, so left alone the cache would serve, under a key asserting
one grid, an object sitting on another. Rebuilding to avoid that would throw
away the probe, which is the expensive part and has already run. So the entry
is re-filed: the old id is dropped and the same entry goes back under the id
its own `sharpen_program` hashes to, which is exactly the id an ordinary build
of that text produces. Pressing Build on the derived program is then a cache
hit rather than a second object. The entry object is reused rather than
replaced, so the lock guarding reads of it is the same before and after.

That id equality is why `collapse_program` is now a shared helper rather than
four lines inside the build route. The library renders derived programs in its
multi-line spread layout; without collapsing them exactly as the build route
does, the id would be computed over different bytes and a derived program
would miss its own cache slot.

**The api's cap reaches the probe.** `sharpen` defaults to `log2_cap=20` and
`AGGAPI_LOG2_CAP` defaults to 18, so an unattended probe could land on a grid
the build route then refuses, leaving the user holding a program that will not
build. The call passes `settings.log2_cap`, and a test rebuilds whatever the
probe chose to prove it survives the cap check.

`POST /objects/{id}/pnl` mutates nothing, so it needs no re-filing: it derives
the text and calls `post_object` directly rather than reimplementing the build
path, which keeps the log2 cap, the semaphore, the timeout, the audit row and
the whole parse-error surface applying unchanged to a derived program. A
portfolio's P&L is self-contained as of `aggregate` a216 `[Inline-Port-Engine]`,
so the button lights for both kinds with no caveat and the text builds anywhere.

Reset rebuilds from the base program text rather than restoring an id, because
Sharpen consumes the object it audits. After a PnL the base is still cached and
Reset is a hit; after a Sharpen it is a rebuild. Paying that only on the undo is
the right way round, and the common path costs nothing.

`can_pnl` joins the capability block, read off `pnl_program`. Deliberately not
folded into `can_price` even though both are true for exactly an `Aggregate` and
a `Portfolio` today: two different questions, and a shared flag would tie a
future change in one to the other.

**The knobs are gone.** log2 and bs were never used, and Sharpen writes the
`hints{}` clause they set into a program you can keep, so the grid is pinned by
an audit that explains itself rather than by a menu choice that vanishes on
reload. The Help panel's control list and tab guide were rewritten to match the
six groups, since both still described the a25 layout.

Fourteen new tests in `tests/test_derive.py`, the load-bearing ones being the
cache pair: the old id is gone rather than still serving the moved object, and
the derived program rebuilds to the same id as a cache hit. Both branches of
the probe are covered, moved and confirmed, since a move pins hints and leaves
the button live while a confirmation writes the note and greys it.

## 1.0.0a44

Six groups, each with its own sub-tab row. Stage 3 of
`dev/plan-loss-lab-navigation.md`, and the largest visible change since the
Overview landed.

Overview, Economics, Reinsurance, Pricing, Bounds, More. The skeleton is
editorial, a judgment about how insurance work proceeds, and the app authors
it. Which leaves are live inside one is a fact, so a42's capability block
decides it and nothing in the app says what a kind can do.

**Overview splits into three.** Plot is the two-panel exhibit lifted out of the
landing pane, Summary is `summary_df`, Tail is `tail_df` and `tail_behavior_df`
as two blocks in one pane. The identity block stays above the sub-tab row,
since it names the object rather than any one leaf. The standalone Plot tab is
retired and the matplotlib SVG leaves the navigation; the `/plot` route stays
and its download moved to the hamburger, which is where the other downloads
live.

**Economics** is a P&L's group: Ledger, Ratios and the Waterfall, all served
through the exhibit envelope rather than the frame routes, so each block
arrives with the library's own caption and its insurer framing. The waterfall
has no frame route at all and was unreachable from the app until now.

**Reinsurance** keeps its three tables and gains a Plot leaf, which is the
first leaf in the app to light from `available_charts` rather than from the
exhibit list. `chart_reins` landed upstream at a210 behind the same cession
predicate the tables use, so the whole group appears and disappears together.

**Pricing** is two modes. Determine completes the pentagon and now takes either
capital anchor: `a` joins `p` on `PriceRequest`, threading through
`calibrate_distortions` and `analyze_distortions` so the calibration happens at
exactly the level the pentagon was completed at. The library has taken either
since the pentagon landed and the app only ever sent a probability, which is
the wrong default for a group about programs written to an attachment.

Evaluate is new: `POST /objects/{id}/evaluate` over the library's `evaluate`,
the breakeven acceptability panel. One method, three shapes, and the api keeps
them straight. An aggregate or a portfolio evaluates one position. A plain P&L
evaluates its margin row. A tower evaluates **every margin row of its ledger**,
so the panel reads as the gross deal, each layer as a position in its own
right, and the running net after each purchase. Two new capability flags carry
it: `can_evaluate`, which reaches a P&L where `can_price` does not, and
`needs_premium`, which is what puts the premium input on screen. Neither is a
kind test: a P&L has no `exp_premium` attribute at all, so "the sort of object
that carries its own consideration, and does not" is a fact read off the
object.

**Bounds** ships with three greyed leaves named for the three classes in
`bounds.py`, so the shape of what is coming is visible and plainly not ready.

**More** is Validation, Stats, Density, Window, Dependency and Narrative. Window
is the old "bs window"; Narrative absorbs "Info (raw)"; Dependency is new and
lights only for a bivariate.

The rules that decide all of this moved into `web/src/nav.js`, which is pure:
the group and leaf table, and four functions over a capability payload. That is
what makes `dev/scripts/check-nav.mjs` possible, a new harness running the real
rules against real payloads captured by `dev/scripts/capture-capability.py`.
It prints a leaf-by-kind grid and fails on any cell that disagrees with what
the plan says should be there. Clean at a44, including the two stickiness rules:
a tower keeps the Waterfall leaf across a rebuild and a plain P&L does not.

Both strips scroll horizontally at narrow widths with a fade at each edge,
rather than wrapping or collapsing. A navbar collapse would put a second
hamburger in a header that already has one, and a dropdown hides which group
you are in and adds a tap to every move. The fades are two pairs of gradients
on `background-attachment: local`, so each appears only on the side with more to
see: no scroll listener, no JavaScript.

Not yet done, and neither is in Stage 3: the header's Perspective control (the
exhibit fetches take insurer, which is the plan's default), and everything the
action row needs, which is Stage 4.

## 1.0.0a43

The two hand-written per-kind tables in the SPA are gone, and the navigation
greys from what the library says instead. Stage 2 of
`dev/plan-loss-lab-navigation.md`.

`NA_TABS_BY_KIND` and `NA_MORE_BY_KIND` said what each kind could not answer.
The library already knew, through `available_exhibits` and `available_charts`,
so the app was the one place left declaring capability a second time. The build
response now carries a `capability` block and the app holds no per-kind table at
all. A new library exhibit reaches the menu with no JavaScript edit, which is
the whole point of the exhibit registry.

New `capability.py`, and each flag on it names the consumer that cannot get its
answer any other way. `has_premium` for the PnL form, `can_sharpen` for the
Sharpen button, `can_price` for the pricing group. `can_sharpen` and `can_price`
are read off the object's own `sharpen` and `price_pentagon` rather than off a
list of kinds, so a future host needs no edit. `can_sharpen` also goes false
once a program carries the library's namespaced `sharpen: ` verdict, since a
second audit of a grid the probe just confirmed is a slow no-op; the note is
`;`-separated and the author's own prose never matches the prefix.

`is_tower` was in the plan's draft list and is not here: `economic_waterfall` is
registered behind a tower predicate, so a single group P&L already drops it from
the exhibit list, and a flag repeating that would be the second declaration this
work exists to delete. `kind` and `has_reins` stay on the response and are not
repeated inside the block for the same reason.

**One bug, found by the derivation rather than by a user.** A
`BivariateAggregate` carries the public `bs_window_df` and not the private
`_bs_window_df` the frame route read alone, so the library served a `bs_window`
exhibit while the route answered 400, and the hand table had greyed the pane out
to match the symptom. Both routes now resolve private first and public second:
an aggregate keeps the raw probe frame with its `W` and `coverage` columns,
which are the pane's whole diagnostic value, and a bivariate gets the display
view it does have. `test_bivariate_builds_and_reports` asserted the old 400 and
now asserts the 200.

Twenty new tests in `tests/test_capability.py`, run against one object of every
kind the api builds. The load-bearing one transcribes both retired tables and
asserts the derived answer agrees with them, since deleting them is only safe if
it does; the bivariate row is the single exception and it is asserted
separately. Two more check that every exhibit and every chart the block lists
actually serves, because a leaf lit by the capability list and then refused by
its own route is worse than a leaf that is greyed.

## 1.0.0a42

The app is the **aggregate Loss Lab**. Stage 1 of
`dev/plan-loss-lab-navigation.md`, and prose only: no route, no behavior and no
bytes on any payload change.

Library was the wrong word twice over. It is what `aggregate` is, so the app
borrowing it made the two harder to tell apart in a sentence, and it describes
a place things are kept rather than a place work happens, which is the opposite
of what the page is for. Lab says the page is where you try something.

The short form **aLL** is unchanged, so nothing downstream of the acronym
moves: the manifest `short_name`, the PWA install name and the `[aLL]` console
prefix all stand. Lower-case `a`, for the reason the branding plan set at a20:
`aggregate` is the package, `Aggregate` is the class.

Renamed in the title, the meta description, the brand line, the logo `alt`, the
Help and About leads, the web manifest, the service worker header, both
package descriptions and `README.md`. Untouched: the historical `CHANGELOG.md`
and `dev/done/` entries, which record what the app was called when they landed.

## 1.0.0a41

Coverage, not capability. `aggregate` `1.0.0a206` and `a207` landed the
economic insurer treatments and `economic_waterfall`, and both reached the api
through the generic exhibit routes with no endpoint change, which is the whole
point of that design. What was missing was a fixture to prove it.

`check-exhibits.py` gains an `xpnl` case. The existing `pnl` fixture is a
single group ledger, which correctly declines to serve `economic_waterfall`
(one margin row, no walk to draw), so the flagship exhibit was showing as
absent everywhere in the sweep and nothing exercised it app side. The walk
fixture covers it: the waterfall now reports 6 rows across its two blocks, and
`economic_ratios` shows 7 raw against 10 insurer, the extra block being the
amounts-from-ratios split that keeps one unit per column.

Still clean: every exhibit serves, revalidates, and agrees with the frame
routes wherever the two overlap.

## 1.0.0a40

Keeping step with `aggregate` `1.0.0a204` and `a205`
(`[PnL-Economic-Frames]`, `[Exhibits-Package-Split]`). No new routes; this is
the app catching the library's renames and staying honest about who owns the
capability set.

`_CSV_FRAMES` gains `economic_df` and `economic_ratios_df`. Upstream, a P&L's
`stats_df` now delegates to its wrapped engine and means what it means
everywhere else (the moment store of a book), while the ledger sheet that used
to answer to that name became `economic_df`. Without these two entries the
ledger would have been unreachable from the api until the economics tab lands.
Visible in the sweep: `stats` on a P&L now reads 26 rows raw and 17 insurer,
the ordinary raw-moment drop, where it used to be the ledger's 3.

`check-exhibits.py` reads the exhibit list from `aggregate.exhibits.EXHIBITS`
rather than a literal, so an exhibit landing upstream joins the sweep with no
edit here. It picked up `bs_window` and `tail_behavior` on its own, and reports
clean.

`test_exhibits_capability_listing` no longer pins a literal list of exhibit
names. The library owns the capability set; re-pinning on every upstream
addition would test nothing but our own bookkeeping. It now asserts the route
is a faithful passthrough over a floor of exhibits any aggregate must serve.

## 1.0.0a39

The app side of the business exhibits surface, first slice
(`dev/plan-exhibits.md` in the library repo, `[Exhibits-App-Endpoint]`;
library phases landed there as `1.0.0a200`, `a201` and `a203`). Additive
only: the two routes and the regression sweep. The menu-from-capability
rewrite (`applyKindGating` reading the capability response, the migrated
`ROW_FLAGS` / `FORMATS` / caption deletions) waits until the library's PnL
insurer framing clears its author gate, so nothing is deleted here and the
frame routes are untouched.

### Two exhibit routes

`GET /v1/objects/{oid}/exhibits`: a passthrough of
`aggregate.exhibits.available_exhibits`, `{name, title, perspectives}` per
served exhibit. The library owns the capability set, so a new library
exhibit appears here with zero endpoint changes.

`GET /v1/objects/{oid}/exhibit/{name}?perspective=raw|insurer`: the envelope
`{name, title, perspective, meta, blocks, hash}` with TableDoc canonical
dicts as blocks. Deterministic UTF-8 body; the exhibit hash (sha256 over the
block document hashes) is the ETag under the same revalidation contract as
the table and chart documents. Unknown or unavailable names are a 404
carrying the capability set; unsupported perspectives (insured, reinsurer,
or an unknown string) are a 400.

### `check-exhibits.py`, the sweep

`dev/scripts/check-exhibits.py`, the sibling of `check-frames.py`: sweeps
every exhibit across every buildable kind, asserts the capability and
envelope routes agree, that every envelope is byte deterministic, and that
the INSURER blocks match the frame-document routes row for row where they
cover the same frame (the frame routes already serve the app presentation:
`_drop_raw_moments` on the two stats stores). Clean at capture: the stats
26/17 and reins 35/26 drops line up exactly.

Envelope contract tests join `tests/test_objects.py` (capability listing,
reins gating, ETag / 304, byte determinism, 404 and 400 families). Left
open, deliberately: extending `capture_fixtures.py` to the new envelopes.
Its output file is already named `dev/fixtures/exhibits.json` for the chart
panel fixtures, a vocabulary collision with the new table exhibits that the
author should settle before the file grows a second meaning.

## 1.0.0a38

The app side of the chart-IR surface pilot (`dev/plan-chart-ir.md` in the
library repo, `[Chart-Surface-Pilot]`; library side landed there as
`1.0.0a199`). The bivariate 3-D surface is the first chart whose semantics
live upstream: the app keeps a translator and its chrome, not a rebuild.

### One chart-document route

`GET /v1/objects/{oid}/chart/{name}`: the chart sibling of the
frame-document route. Names resolve through
`aggregate.charts.available_charts`, so a new library emitter appears here
with zero endpoint changes; an unknown or unavailable name is a 404 carrying
the capability set. The body is the document's `canonical_json` bytes and
the stamped content hash is the ETag, same revalidation contract as the
table documents. `api.chartDoc(id, name)` on the client.

### `chartdoc-to-echarts.js`, the generic adapter

One walker from ChartDoc vocabulary to an ECharts option, pure so the node
smoke test exercises it offline. It realizes the 'surface' panel kind today
(the xy family joins as its conversions land upstream) and merges a small
per-chart override dict over the semantic skeleton: `surfaceOverrides` in
`surface.js` carries exactly the renderer-specific chrome (colors, tooltip
dressing, the visualMap ramp and placement, lighting, and the
down-the-diagonal camera). The log-height toggle is honored only when the
document declares `meta.z_log_ok`, because whether a log reading is
meaningful is the emitter's call.

### `surfaceGrid` deletes; the reduction lives upstream

The mass-preserving block-sum to the display grid now happens inside the
library emitter, which also ships both resolved component labels, so the
`axisNames` stats_df hack is unnecessary on the surface path (the heatmap
still uses it until its own conversion). The surface payload arrives display
sized (128 per side) however fine the model grid is, which is dramatically
lighter than the full joint frame the old path reduced client side. The
joint frame is still fetched for the heatmap fallback; a WebGL-less browser,
a failed chunk, or a failed document fetch all still land on a picture.

`capture_fixtures.py` captures the chart document per bvagg fixture and
`smoke-exhibits.mjs` assembles the surface through the adapter plus override
(same mesh invariants as before, plus the document's own: display cells sum
to the joint's mass, axis names resolved upstream). Server contract pinned
in `tests/test_objects.py`: canonical bytes, quoted 12-hex ETag, 304 on
If-None-Match, 404 with the capability set, byte determinism across GETs.

## 1.0.0a37

From `dev/done/plan-a37-quick-hits.md`. The first list written after actually
looking at the exhibits in a browser rather than at the code. Frontend only, but
for one keyword forced by the dependency.

### The tail panel is read by picking a probability

`S(x)` is monotone in loss, so "at S = 0.005, what loss?" has one answer and that
answer is the VaR. Hovering the tail panel now snaps to the survival axis and
reports the loss. The density panel is unchanged and still read by loss, because
a horizontal line crosses a density twice and the lookup has no single answer
there.

Declared **per grid**, not per axis. `axisPointer.triggerTooltip` looks like the
switch for this and is inert: under `type: 'cross'` ECharts supplies the flag
from the tooltip pass and never consults the axis. Each grid is its own
coordinate system, though, and its model carries a `tooltip`, which is what lets
two panels in one chart be read two ways.

### `full x` widens both panels

It only ever widened one. The window went to auto-fit, and the two panels do not
hold the same data: `rightPairs` drops whole entries past the log floor, so the
tail panel fitted a shorter run and the panels stopped sharing an x axis at
exactly the moment the reader asked to see everything. The window is now always
an explicit pair, computed once and given to both. The button moved to the middle
control group to match.

### The tail runs to 1-in-1 billion

`T_MAX` was 1e5, which cut the curve off while it still had shape to show. The
guard against `1 - cumsum` arithmetic dust is unchanged. Axis labels and the
tooltip gained a compact form, since neither could carry ten digits.

### Densities draw as steps again

They were drawing as little pyramids: the risers leaned. Not a `step` setting and
not an ECharts limitation. `step: 'middle'` is applied correctly, and then
`drawSegment` discards any segment under sqrt(0.5) px **without advancing its
`prev` point**, so a point is emitted only once it is ~0.7 px from the last one
emitted. A bucket here is ~0.006 px wide, so the step's horizontal moves were all
culled and the risers lost the base points that made them vertical.

`sampling: 'minmax'` reduces to the min and max per device pixel column before
the path is built, so the riser is drawn and the peak survives rather than being
averaged away, which matters because these peaks are atoms. Zoom still restores
full resolution, since the sampler runs after the dataZoom filter. It is switched
off per series where the data has an interior gap, because ECharts' sampler seeds
each frame from the frame's first point and would discard a frame that opens on
one.

### Keys: history on Ctrl, examples on Ctrl+Shift

Plain up and down are ordinary cursor movement again. They used to walk history
at the buffer edges, and on a one line program every press is at an edge, so
moving the caret silently threw the program away. History is Ctrl+↑/↓ and does
not move the cursor; the example library is Ctrl+Shift+↑/↓ and loads without
building. Both are now documented in the feedback line and the Help panel; the
example nav was an undisclosed Alt- binding.

### Chrome

The hero cards are gone from the top of the page, replaced by a two line lede
(placeholder copy). One hero is still picked at random and built on load, so the
landing page still arrives populated on a different book each visit; the gallery
is to resurface inside the Examples dropdown. Tables got more vertical space, and
both table hosts now share one box, so flipping Static to Interactive no longer
reflows the page under the reader.

### Breaking, from the dependency

`greater-tables` renamed `TableSpec.formats` to `formatters` somewhere in its
1.9.0 to 6.0.0a4 run, which took 13 tests down. a37 follows the rename and
nothing else of that move; catching up with the rest of 6.0 is in `dev/TODO.md`.

## 1.0.0a36

From `dev/done/plan-tidy-and-library.md`. A batch of four: consolidate on
ECharts, load an alternate example library, and drop two bits of chrome.

### ECharts only

a30 shipped Plotly to answer one question, and a30 answered it: "not massive
differences between the two". A second renderer with no question behind it is a
535 kB lazy chunk and a second code path, so it comes out.

Gone: `charts/engine.js`, `charts/plotly-panels.js`, the `draw` control on the
exhibit row, the `plotly.js-gl2d-dist-min` dependency, the `__PLOTLY_VERSION__`
define and its chunk entry, the About panel row, and the parity block in the
smoke test. The bundle drops the 1,599 kB chunk entirely, and
`chunkSizeWarningLimit` comes back from 1600 to 700 now that `echarts-gl` is the
only lazy vendor chunk left.

**`twoPanelData` stays.** It is the split that made the comparison possible, and
it earns its keep regardless: chart decisions are worth reading on their own
rather than interleaved with an ECharts option literal.

### `--library PATH`

Points the Examples dropdown at an alternate `.agg` instead of `aggregate`'s
shipped `library.agg`, so a short library makes a review pass quick. The default
is unchanged.

The plumbing already existed as `AGGAPI_EXAMPLES_FILE`; the flag sets that in the
environment before uvicorn starts, which is what survives `--reload` (the app is
built in a child process and would never see a value poked into this process's
cached `Settings`).

**It fails rather than falling back.** The env var warns and drops back to the
full library when the path is wrong, which is right for a stale setting on a
server and wrong for a flag typed on purpose: silently loading everything is the
exact outcome someone passing `--library` is avoiding. The flag resolves the
path, checks it, and exits naming what it could not read.

### Removed chrome

- The subhead ("Describe an insurance book and get its full loss distribution,
  tail risk, and price.") and its `.subhead` style.
- The Overview's Static / Interactive pill row. a33 put the same preference in
  the header menu, and one preference with two controls on one screen reads as
  two settings. The menu still re-renders the tab, so nothing else moves.

## 1.0.0a35

From `dev/plan-gt2-ir.md`, Stage B of the follow-on. Every table is switchable,
and one fetch feeds both renderers.

### One document per table, not a document and a frame

GT 1.8.0 shipped `irToGridInput(doc)`, which flattens a table document into
CsvGrid's input. So the SPA now fetches **one** `?format=ir` per table and
renders either way from it: the walker draws it, or the adapter derives the
grid's `{columns, records}` from the same bytes. The paired fetch is gone, the
flip costs no round trip, and the two views cannot disagree about a number
because there is only one number.

Bulk frames are untouched: the densities go `FrameResponse` straight to CsvGrid
and never become a document. A document the server truncated is not rendered
either; the SPA sees the note, refetches the whole frame and hands it to the
grid, so nothing shows 500 of 4,096 rows without saying so.

### Fixed: two views of one button showed two different tables

`stats_df` and `reins_stats_df` drop their raw `ex1` / `ex2` / `ex3` moment rows.
That step lived in the JSON route alone, so a portfolio's More > Stats showed
**26 rows static and 17 interactive**, and the `.csv` download exported 26. Three
paths resolved "the frame called X" independently and drifted.

`_CSV_FRAMES` is now a map of name to **callable**, and the CSV and document
routes both go through one `_named_frame`. All three agree at 17 rows, which
changes the CSV download. A test asserts row-count parity for every frame across
four object kinds, which is the invariant that was silently broken rather than
the one instance of it.

### Formats are declared server side

`PRICE_FMT_CODE`, `REINS_PRICE_FMT` and `statFormats` are gone from `main.js`.
A loss ratio is a float, so nothing in the dtype says it reads as a percent;
`tables.FORMATS` says so once, the engine resolves it into the document, and both
views render from that. The strings are the same ones the SPA carried.

### Also

- `include_raw` is the **explicit column list**, not the `'data'` shorthand the
  handoff spec names. `'data'` covers numeric, date and bool columns only, so a
  string data column gets no raw value and `irToGridInput` then throws on the
  whole document. Three Price frames carry one. Reported upstream.
- `api.reinsFrame` is now `api.frameOf`: it was always generic, and it is the
  bulk path for every frame too long to carry as a document.
- Two harnesses kept rather than rewritten each time: `dev/scripts/check-frames.py`
  sweeps every frame across every kind and asserts both routes agree, and
  `dev/scripts/check-adapter.py` proves a document is interchangeable with its
  `FrameResponse` after csv-grid's own cell coercion.
- Losing the walker now costs both views rather than one, so the pane says so
  instead of sitting empty.

## 1.0.0a34

From `dev/plan-gt2-ir.md`, Stage A of the follow-on. The static-table engine
renamed itself, so this lands the rename before anything is built on top of it.

### The package is `greater_tables` again

`greatest_tables` was a working name it carried for a day. It publishes as
**`greater-tables` 6.0**, a major version of the existing package, so the import
goes back to `from greater_tables import ...` and the dependency key with it. Its
checkout folder stays `c:/s/ai/greatest-tables`, deliberately, so the
`[tool.uv.sources]` path is unchanged.

**This is not a revert to the PyPI 5.3 that a32 removed.** It is the same
rewrite, under the name it will publish as. The two generations share an import
name and cannot coexist in one environment, and plain `pip install
greater-tables` still resolves to 5.3 until 6.0.0 ships, so a deploy that misses
the source entry gets 5.3 and dies at import.

Because importing proves nothing (both generations export `GT`), a test asserts
the symbols that exist only in the rewrite: `build`, `canonical_json` and
`IR_VERSION == 1`, plus a major version that is not 5.

### Also

- Engine moves 1.6.1 to **1.9.0**, which brings 1.7.x **spanner rules**: a
  trimmed rule under each labeled column-group header, the booktabs `\cmidrule`
  pattern, made full width in 1.7.1. Visible only on frames with multi-level
  column headers.
- `/v1/meta` `tables_version` and the About panel now read `greater-tables`, and
  a test pins them to each other.

## 1.0.0a33

From `dev/plan-gt2-ir.md`, Stage B. a32 built the pipeline and pointed it at the
Overview; this gives it the whole page and one place to steer it from.

### One switch, in the header menu

> The switch is at the tab level, not the table level, that's too complex. In
> fact we should put it on the hamburger at the top to select one or the other.

So the header dropdown gains a **Tables** section, Static or Interactive, ticked.
It writes the same page-wide preference the Overview's pill row writes, and the
two follow each other because there is only one value to read. Nothing else on
the page grew a control.

### Every table honors it

Overview (summary, tail risk), More (validation, stats, bs window, density),
Reins (per-layer summary, stats, density) and Price (pentagon, calibrated
distortions, the four per-distortion slices, and the reinsurance pricing table
with its parameters).

The gate is the **row count, not a list of frame names**: past 500 rows a frame
stops being a reading experience and stays interactive, which covers the density
frames the author named and anything else that grows. When static is selected and
a frame is over the line, the grid renders and one muted line says why, rather
than the control appearing to do nothing.

### New

- `POST /v1/objects/{id}/price?ir=true` and `.../reins_price?ir=true` return an
  `ir` map of table documents beside the frames. These frames are *computed* by
  the POST, so the generic `frame/{which}` route cannot reach them. The SPA
  always asks, so flipping the view after a pricing run never costs a re-POST.
  Documents are built before `reset_index_safe` flattens the frames, which is
  what keeps `analyze_distortions`'s distortion index as a stub.

### Fixed

- A view listener keyed on a pane would have survived `clearPanes` and redrawn
  the *previous* object's frames on the next flip. Listeners now key on the node
  they created, and a disconnected node prunes them.

## 1.0.0a32

From `dev/plan-gt2-ir.md`, Stage A, implementing the `greatest_tables` handoff
spec in `dev/done/plan-gt2-ir-adoption.md`. The a31 evaluation of `greater_tables` 5.x
concludes and its whole path is replaced.

### The static table is a document now, not markup

The server no longer renders html. It builds a **table document**: `ir_version` 1
JSON carrying dtypes, resolved formats, hierarchy, spans, break depths and flags,
and carrying no widths and no CSS. The browser owns geometry. A walker that ships
inside the same `greatest_tables` install renders it.

The point is not tidiness. Row emphasis used to be stamped onto emitted html by a
positional BeautifulSoup pass, which is fragile in exactly the way that matters:
it silently gave up whenever the row counts disagreed. Emphasis now rides in the
document as `row_flags`, so there is nothing to stamp and nothing to get wrong.

### New

- **`GET /v1/objects/{oid}/frame/{which}?format=ir`**, replacing the a31
  `.html` route and resolving the same `_CSV_FRAMES` names through the same
  `_resolve_frame`. Returns `canonical_json` bytes with `ETag: <doc.hash>` and
  honors `If-None-Match` with a 304. Built from the **DataFrame**, index intact.
- **`GET /v1/assets/{name}`** serves the walker (`gt-render.esm.js`) and its
  stylesheet out of `importlib.resources.files('greatest_tables')`. Serving it
  from the package that emits the documents is what makes version skew between
  the two impossible.
- **`web/src/tables.js`**: lazy-loads the walker on the first static table a
  session draws, and mounts documents into a pane.
- `/v1/meta` gains `tables_version`, shown in the About panel. It is a front-end
  version as much as a backend one, since one install serves both halves.

### Changed

- The Static / Interactive preference is now **page-wide** (`aggapi.tableView`),
  seeded from the old `aggapi.overviewView` so a returning browser keeps its
  choice. Reach is still the Overview in this version; a33 extends it.
- Static falls back to the interactive grid, with a line saying why, when the
  frame is past 500 rows or the walker cannot be loaded. Never an empty pane.
- The pane teardown registry in `grid.js` is generic: anything with `destroy()`
  registers, so the existing `clearGrids` sweep tears down IR tables too and no
  call site had to learn about a second registry.
- Row emphasis uses the IR's own vocabulary rather than reproducing css class
  names. A portfolio's total row is a `total`, a unit's Agg line is that unit's
  `subtotal`, and the capital anchors carry `emphasis`. The anchors keep the
  `#fff7e6` wash they have had since the hand-built exhibit.

### Removed

- `greater-tables`, `tables.render_html`, the `/frame/{which}.html` route,
  `HtmlFrameResponse`, `api.frameHtml`, the `?tables=gt` sticky dev flag,
  `mountStaticTable`, `renderExhibit` and its `.exhibit-table` styles, and the
  `beautifulsoup4` import that existed only for row emphasis.

### Breaking

- **`requires-python` is now `>=3.13`**, up from `>=3.11`. `greatest-tables`
  declares that floor and it is the binding one. Nothing in its source needs
  3.13, so relax it there if 3.11 or 3.12 ever matters here again.

## 1.0.0a31

From `dev/done/plan-greater-tables.md`. A second static-table renderer, alongside
the first, for the same reason a30 added a second chart renderer.

### The argument is structure, not prettiness

`serializers.py` flattens MultiIndex columns to dotted strings and resets the row
index into ordinary data columns. That is right for a grid and lossy for a printed
exhibit: `port.summary_df` and `port.tail_df` both carry a **two level row index**,
so today a unit name is reprinted on all ten of its return-period rows.
`greater_tables` sparsifies it to once per block, and it can only do that where
the real DataFrame still exists, which is server side.

### New

- **`src/aggregate_api/tables.py`**, `render_html(df, *, which, caption)`.
- **`GET /v1/objects/{oid}/frame/{which}.html`**, an exact mirror of the existing
  `.csv` route, resolving the same `_CSV_FRAMES` names through the same
  `_resolve_frame`. Returns `HtmlFrameResponse {which, rows, html}`.
- `greater-tables>=5.3` as a dependency. **No `[tool.uv.sources]` override**: the
  published 5.3.0 is byte identical to the local checkout, so there is nothing to
  co-develop against and the repo stays installable anywhere.

Three constraints, all read out of the source rather than its documentation, and
all load bearing: `tikz` defaults to **True** and would compute LaTeX we discard
on every request; `GT` **raises** above 50 rows rather than warning, and a six
unit portfolio's `tail_df` is 70; its CSS is scoped to `#{df_id}`, a content hash
of the frame, which is what makes the blob safe to inject. A density frame (65,536
rows) is refused with a 422 and stays the grid's job permanently.

### Row emphasis is preserved, not dropped

The premise that it would be lost was wrong, as the author pointed out.
`greater_tables` passes markup in a cell straight through: `core.py` emits
`<td class="...">{c}</td>` with no escaping, and `clean_html_tex` only rewrites
`$...$` into MathJax delimiters.

The design still avoids cell markup. `cast_to_floats` is what earns the number
formatting and the right alignment, so a numeric column carrying `<b>1,234</b>`
would fail the float cast and drop to unformatted left-aligned strings. The
1-in-200 highlight and the bold total are therefore classes on the `<tr>`, added
by a short bs4 pass (already a `greater_tables` dependency) that maps frame rows
to body rows positionally, verified rather than assumed.

### Nothing is deleted, and there is no switch

`renderExhibit` stays and stays the default. The server-rendered table is reached
by a dev flag, `?tables=gt` (and `?tables=native` to go back), sticky per browser,
with **no user-facing control**. The two can be compared on real frames before
either is chosen. The highlight color is deliberately the same `#fff7e6` as the
built-in table, so the comparison is about structure rather than about a different
shade of yellow.

Deferred: the Price tab. `PriceResponse`, `ReinsPriceResponse` and
`PricingResponse` carry *computed* frames from POST endpoints, so the generic
route cannot reach them.

## 1.0.0a30

From `dev/done/plan-plotly-spike.md`. A second renderer, so the question "is it
the library or the charts" can be answered by looking rather than by arguing.

### Why a spike and not a migration

The author is not sold on ECharts (a28). The difficulty is that almost everything
wrong from a26 to a29 was a design error on our side, not something ECharts did:
the wrong rectangle measured, the wrong default orientation, binned data,
conditional steps, labels over the title, a reservation aimed at the wrong layout.
None of those are arguments about a library. So this ships both engines on the
same data, behind a switch, and leaves the judgment to a look.

### One set of decisions, two renderers

The work that makes the comparison worth anything is not the Plotly code, it is
`twoPanelData()`: which curves, over which x-window, on which scales, which
verticals are marked and which way their labels open. That was interleaved with
ECharts option construction; it is now a separate step both renderers read, so
neither can quietly draw a different chart.

Falling out of that: the four two-panel specs gained a `panelArgs` that does the
column picking, `build` is `echartsBuild(panelArgs)`, and `sev` and `pnl` stopped
patching titles onto a built option after the fact. Their wording (`pdf` rather
than `density`, `Downside probability` rather than `Survival`) now lives in the
shared bundle where both engines can read it. `anchorMarks()` returns neutral
`{x, name, faint, align}` and `anchorLineStyle()` does the ECharts dressing.

### The switch

A `draw` group at the right of the exhibit control row, muted rather than primary
because it changes what draws the chart, not what the chart shows. Sticky per
browser. On `sev`, `pnl`, `distortion` and `bvagg` the Plotly button is **greyed
out, not hidden**, per the house rule.

`plotly.js-gl2d-dist-min` sits behind a dynamic import in its own chunk, 535 kB
gzipped, verified absent from `index.html`, so nobody who leaves the default alone
pays for it.

### gl2d, not basic, and the smoke test now checks that

The first cut used `plotly.js-basic-dist-min` (378 kB) with `scattergl` traces.
That bundle registers **bar, pie and scatter only**, so it would have thrown
"invalid trace type" in the browser and nowhere else. Its `scatter` is the SVG
renderer, and since a27 every exhibit carries all 2**16 grid points, so a
portfolio is half a dozen curves of 65,536 points. Asking SVG to draw that would
make Plotly look bad for a reason that has nothing to do with how it draws.
ECharts renders to canvas, so WebGL is the like-for-like choice.

`dev/smoke-exhibits.mjs` now reads the registered trace list out of the shipped
bundle and fails if a figure uses a type that is not in it.

### Parity, asserted

An unfair comparison answers nothing, so the properties a26 to a29 established are
checked on the Plotly figure too: `line.shape: 'hvh'` (its centered step, the same
shape as ECharts' `step: 'middle'`), loss on x in **both** panels, the same
reserved height, the capital anchors present as shapes with labels opening away
from their lines, and one legend entry per unit rather than two (Plotly toggles
per trace, so the tail trace joins its density trace's `legendgroup` and stays out
of the legend).

The mapping most likely to break silently gets its own check: **Plotly log axes
take `range` in exponents**, so handing one 1e-15 where it wants -15 collapses the
axis while looking right in the source. The test round-trips `10 ** range[0]`
against the survival range the shared bundle computed.

## 1.0.0a29

From `dev/done/plan-graph-placeholder.md`. The chart box stops moving, and it says
a graph is coming instead of leaving a hole.

### The reservation was for the wrong exhibit

a28 reserved the chart's height before fetching, which was the right idea aimed at
the wrong rectangle. `reservedHeight(width)` took **only a width** and always
returned the two-panel geometry, but two of the six kinds do not use that layout:

| kind | host 1000 (wide) | host 560 (narrow) |
|---|---|---|
| agg / port / sev / pnl | reserved 347, rendered 347 | reserved 730, rendered 730 |
| distortion | reserved 347, rendered **498** | reserved 730, rendered **498** |
| bvagg | reserved 347, rendered **498** | reserved 730, rendered **478** |

So a distortion or a bivariate shoved the page down 133 to 151 px on a wide screen
and snapped it up 232 to 252 px on a narrow one, every load.

Each exhibit now declares a `layout(width)` returning the geometry **and** the host
height. The mount calls it once before the fetch and hands the same box to
`build()`, which never derives geometry again. Reservation and render cannot
disagree, because there is only one of them. `chartHeight()` and its
`grid.height + top + 52` guess are gone.

Two related leaks closed with it. `reservedHeight` hardcoded the return-period twin
axis, running about 21 px short whenever it was off; it reads `view.rightLogY` now.
And the three square call sites disagreed, the surface declaring `side + 60` while
the others fell through to `side + 78`, so flipping the 3-D toggle resized the box
by 18 px. One `SQUARE_CHROME` constant, declared once.

The bivariate's pads are no longer per renderer. Sizing the surface from its own
narrower pads made `layout` depend on `surfaceReady`, which only turns true once
the lazy chunk lands, so on a narrow screen the box was reserved as a heatmap and
drawn as a surface. A layout that depends on async state cannot be reserved ahead
of that state resolving.

### The skeleton

`showPlaceholder()` fills the reserved box with the exhibit's outline: panels at
the exact grid geometry the chart will use, titles where the chart will put its
own, a centered glyph, a dashed border and a slow shallow pulse (dropped under
`prefers-reduced-motion`). The arriving chart lands on top of its own outline
rather than replacing a differently shaped block. A reserved but empty box says
nothing; this says a graph is coming, and where.

### The control row was the other half of the jump

Reserving the chart perfectly and then rendering the toggle row on arrival pushed
everything down by a button row anyway. The controls depend on the width and the
spec, never on the payload, so they are drawn up front. `redraw()` no-ops until
there is something to draw, so a toggle pressed mid-fetch records the view and is
picked up when the data lands.

`loadStyle()` moved from the two call sites into the mounts, so its round trip also
happens behind the skeleton, and `main.js` no longer juggles `minHeight` around a
guess it should never have been making.

### Verification

`dev/smoke-exhibits.mjs` now asserts `reservedHeight(width, kind)` equals the built
option's `hostHeight` for every kind at both breakpoints. That is the invariant a29
is about, and nothing checked it before because nothing compared the two numbers.

## 1.0.0a28

From `dev/done/plan-exhibit-punchups-5.md`. Third round of exhibit feedback: step
rendering, two capital anchors, the bivariate 3-D surface, reserved space, and the
panel aspect measured on the right rectangle at last.

### Steps everywhere

`step: 'middle'`, matplotlib's `drawstyle='steps-mid'`, on every density series
unconditionally. Every value in the frame is the mass in **one bucket**, not a
sample of a curve, so joining two with a slope draws probability at values between
grid points that carry none. a23 gated this on a count of nonzero points, guessing
at "is this discrete"; the guess was unnecessary, since steps are right for a
coarse grid and right for a fine one. A condition that can only be wrong in one
direction should not be a condition.

### Two anchors, labels inside the panel

`ANCHORS` drops to `[100, 250]`. The pair still spans the regulatory range and the
tooltip gives any other return period, so the third line cost a label slot and
bought nothing.

Labels move to `position: 'insideEndTop'`: inside the plot at the top rather than
above it, where they were landing on the panel title. That fixes the density
panel's `mean` and `1-in-200` lines too. The first anchor's text is right-aligned
and the second's left-aligned, so they open away from each other and cannot
collide however close the two VaRs sit.

### The bivariate 3-D surface

New `web/src/charts/surface.js`: the joint density in relief, with linear and log
height scaling (log the default, since a joint density spans four or five orders
of magnitude and on a linear axis everything but the mode is floor). Dependence
shows as a ridge off the diagonal, which a flat heatmap can only imply.

`echarts-gl` sits behind a **dynamic import** in its own lazy chunk, 165.9 kB
gzipped, absent from `index.html`, so a visitor who never builds a bivariate never
downloads it. The joint grid is block-summed to 128 x 128, not sampled, for the
same reason the heatmap is. Falls back to the heatmap when the chunk fails or
WebGL is missing.

One thing changed after measuring: a zero-mass cell was first sent as `null`, on
the grounds that zero mass is no height rather than a small one. On the real
fixture **41% of the mesh came back as holes**, because an FFT-built bivariate has
large regions of exact zero, and the surface arrived moth-eaten. Zero now rests on
the log floor, one decade below the smallest mass present, so the surface touches
down where the model puts nothing. The tooltip says `< 1e-15` there rather than
reporting the floor as data.

### Reserved space

The chart host's height is computed and set **before** the fetch, so the page no
longer shifts when the density payload lands. Exact rather than a guess: the
geometry is a function of the container width, known immediately.

### The aspect was measured on the wrong rectangle

a26 applied the house `FIG_W / FIG_H` (4:2.8) to the **plot area**, and the chrome
around it made the panel's footprint on the page about **4:3.8**. That is what
read as too tall, and it is why the author's "4:3.25" and "a bit too high" looked
like they pointed opposite ways: 4:3.25 is *flatter* than 4:3.8.

`PANEL_ASPECT = 4 / 3.25` now targets the **footprint** (plot area plus title
strip and axis), with the plot height falling out of it. That is also the fairer
comparison with matplotlib, where `FIG_W x FIG_H` is the whole figure including
margins, not the axes box.

At a 1000 px host: panels 398 x 251, footprint 323, so 1.23, and the exhibit is
347 px tall where it was 375. Stacked at 560 px: 730 px, was 777.

The smoke test now asserts the **footprint** ratio at both breakpoints, which is
the check a26 should have had: it was asserting 1.43 on the plot rectangle and
passing while the visible shape was 1.06. It also asserts every density series is
stepped, and that the surface mesh is complete and has relief.

### Bundle

Eager: app 39.1, bootstrap 24.7, codemirror 114.2, echarts 197.8 kB gzipped. Lazy:
echarts-gl 165.9. The echarts chunk grew 186.1 to 197.8, which is Rollup hoisting
internals now shared with the lazy chunk into the eager one rather than shipping
them twice.

## 1.0.0a27

From `dev/done/plan-exhibit-punchups-4.md`. Second round of author feedback, and
the two questions a26 left open are answered.

### Every point

a26 raised the display grid and kept binning. That improved the picture without
fixing it: an atom in a `bs=1` bucket, binned by 8, is still 8 units wide and
located only to within 4. And detecting atoms to treat them separately is not
possible from the frame, because a tall bucket and a point mass are the same
number. There is no threshold.

`density_df`, `unit_density_df` and `reins_density_df` now default to
`resolution='full'`: every row, unbinned. `resolution='display'` keeps the binned
form and its only caller is the More to Density **table**, where 65,536 rows is
not a reading experience and the CSV download is the exact export anyway.

The payload objection turned out to cost ten minutes rather than a design
compromise, because there was **no compression on the api at all**:

| | rows | raw | gzipped |
|---|---|---|---|
| one aggregate's density (4 cols) | 65,536 | 3.65 MB | **0.35 MB** |
| a 2-unit portfolio's per-unit frame | 65,536 | 6.99 MB | **1.29 MB** |

`GZipMiddleware` at a 1 kB floor. Float text compresses about 10 to 1, so both
land inside what an image costs. Installed before CORS so the stack unwinds with
CORS headers on the outside, where a browser needs them even on a compressed
response.

### Both tail views put loss on x

The right panel no longer transposes. Loss is on x in both modes and the toggle
changes only the y-axis, between `S(x)` and its reciprocal as a return period.
Whichever is not primary is the twin axis on the right, so both readings stay
available without touching the toggle, and following a loss across the two panels
never means swapping axes.

"EP" is gone. In catastrophe modeling EP is a term of art (OEP / AEP) and this is
neither: it is `S(x) = P(X > x)`. The panel says Survival and the axis says
`S(x)`. Every reference line on that panel is now a vertical, since they are all
loss values.

### Reinsurance-aware pricing

`POST /v1/objects/{id}/reins_price`. Calibrate the standard distortion set on one
basis (gross, net of the occurrence program, or the object's own net) and apply
it unchanged to the others, so the spread between them is attributable to the
distribution rather than to two separate fits. The difference between the gross
and the net premium is the implied **allowance for reinsurance in the rate**.

Built entirely on library machinery: `GridDistribution` over a `reins_density_df`
column, `prob_loss_assets` for the `(p, L, a)` anchor, `Pentagon.solve` for the
premium target, `Aggregate.calibrate_distortions` for the fit, `Distortion.price`
to apply it. The one piece of glue is `_BasisView`, which presents a chosen basis
with the surface `calibrate_distortions` reads.

One row per (distortion, basis), the calibrated one starred, plus a difference
row per other basis. `net occ` is offered only when **both** cession stages
exist, so an occurrence-only program gives exactly three rows per distortion. The
difference row differences the levels and **recomputes** the ratios: a difference
of two loss ratios is not a loss ratio, while the loss ratio of the differenced
levels is the rate the cover is being bought at. Each basis takes its own
`a = q(p)`, holding the threshold fixed rather than the capital, because a
reinsured book needs less capital and that saving is part of what the cession
bought.

The Price tab grows a `calibrate on` selector, shown only when the object carries
a cession.

### Smaller items

- **Bivariate More to Density** returns the two component **marginals**
  (`unit / loss / p / F / S`), not the joint matrix. Long rather than wide
  because the two axes have different grids and lengths; aligning them would
  invite comparing row `i` of one against row `i` of the other. The Overview
  heatmap asks for `view='joint'`.
- **Tab persistence.** `has_reins` on the build response greys out the Reins
  pill when there is no cession, instead of opening a pane that says "No
  reinsurance on this object" after you clicked it. The active tab is otherwise
  left where it was.
- **Button shape.** Everything takes `--bs-border-radius`, Bootstrap's own token,
  so the exhibit toggles, the output tabs and the hero cards cannot drift from
  Build and Examples. The pill radius is gone.
- **Banner.** The kicker centers under the title.
- **Hero gallery** retries once and reports. The old single `.catch` covered both
  the fetch and the rendering and swallowed either in silence. The empty-first-
  load the author saw is **not reproduced**: the route answers 200 in ~2 s cold
  and returns all eight, including fired concurrently with `/v1/examples` and
  `/v1/meta` across four cold processes, and the service worker never touches
  `/v1/*`. If it recurs the console now says which half failed.

## 1.0.0a26

From `dev/done/plan-exhibit-punchups-3.md`. Author feedback after the first
visual inspection of the exhibits: resolution, panel shape, orientation, and
where the controls sit. Plus one wrong number the verification turned up.

### The density had lost its atoms

A discretized aggregate is routinely **atomic**, not merely spiky, and the
display grid was destroying that. On the reported program (limits
`250 500 1000 2000 xs 0`, a `750 xs 750` occurrence cession, `log2=16`, `bs=1`)
single buckets at 0 / 250 / 500 / 750 hold 8.6% / 12.9% / 10.0% / 5.7% of the
mass against a continuum of 0.07% per bucket. Layer limits and an occurrence
cession put point masses in the severity; the aggregate inherits them at every
multiple.

At `2**11` display rows the server was summing **32** fine buckets into one, so
the atom at 250 landed in a bucket labeled 256 carrying its 12.9% plus 31
neighbours' worth of continuum, located only to within 16 loss units, and drawn
as a straight line to the next bucket center: a triangle 64 units wide where the
truth is a spine one unit wide.

`DENSITY_DISPLAY_LOG2` goes 11 to 13, under a new **cell budget** rather than a
flat row count. `display_log2_for(n_cols)` keeps the full `2**13` for a narrow
frame and steps down for a wide one, so a Portfolio's per-unit densities
(`2 * units + 3` columns) ship the same number of JSON numbers however many units
there are, instead of scaling with the unit count.

Measured on that program: the peak now stands 23x above its neighbours in an
8-unit bucket, roughly 1.4 px on a 400 px panel. Payload 0.12 MB to 0.46 MB.

Not fixed: the atom still occupies one display bucket rather than being drawn at
its exact loss. Doing that properly means splitting the frame into atoms (exact
loss, stem) and continuum (binned, line). Recorded in `dev/TODO.md`.

### Panels hold the house aspect

`FIG_W` / `FIG_H` from `aggregate.constants` ride along on `/v1/meta/style` with
the colors, and every panel is sized `width / (FIG_W / FIG_H)` from the host
width. Nothing is hardcoded, which was the bug: the stacked layout pinned
`height: 150` against a full-width panel and drew at roughly 3.5:1 against a
house ratio of 1.43:1. The smoke test now asserts the ratio at both breakpoints,
since panel shape is the one property of a rendered chart an offline test can
genuinely verify.

### Exceedance stops being a transpose

Loss on x and exceedance probability on y is now the default; the transposed
return-period view is the toggle. A second y-axis on the right of that panel
reads the same curve as a return period, so `1e-5` and `1-in-100,000` are the
same gridline and the capital question needs no re-orientation. It appears only
against a log probability axis, because `T = 1/p` is log-linear in `p` and on a
linear axis the twin would not line up.

Tracking is now a **cross**: on that panel the y value is the answer, so a
horizontal line reading it off the axis is worth as much as the vertical one.

### Controls sit over the panel they drive

Three groups with rule separators: density controls, the shared reference lines,
then the exceedance-panel controls, pushed into the right half when the panels
are side by side. `log y` becomes two independent toggles, one per panel.

The Overview's Static | Interactive table switch takes the same pill shape in the
code red rather than the primary blue: the same kind of control, steering a
different half of the tab.

### Reinsurance: the frame's own structure

`reins_density_df` is not one gross / ceded / net triple, it is three, read at
different points in the program. The exhibit now asks which: **occurrence** (the
severity views), **after occurrence** (the aggregate of each, where gross is the
true gross aggregate), **after aggregate** (the aggregate cover's subject, ceded
and net). Plus which of the three curves to draw.

The third triple's first column is labeled `subject`, not `gross`, for the reason
the library's own docstring gives: `p_agg_subject` equals the true gross only
when there is no occurrence cover, so calling it gross would quietly understate
the cession whenever both stages are present.

### A gross mean over a net distribution

Found while verifying the density fix, not reported. Under a cession `actual_m`
and `est_m` describe **different random variables**: `actual_m` is the analytic
mean of the subject book, while the density, the percentiles, `summary_df` and
everything plotted are net. The summary bar preferred `actual_m` unconditionally,
so on the reported program it read `mean 12000` directly above a table whose Agg
row said `549.48`, and the exhibit drew its mean reference line off the end of
the axis. A Portfolio has the same problem via its units (1150 against 411).

`_summary_fields` now prefers the realized moments when the object carries a
cession and the analytic ones otherwise, where they are exact. The library was
never wrong here: `validation_description` says "reinsurance; subject not
unreasonable", which is it naming which variable `actual_m` belongs to.

### Smaller things

- Log axes floor at `1e-15`. Below that a survival built by `1 - cumsum` is
  plotting its own accumulated rounding error, and the fringe reads as tail.
- Expand / Contract on a grid now needs **more than 10** columns, was 6. Every
  frame on the Price tab is under that and carried a pair of dead controls.
- Reins moves ahead of Price in the tab bar: you decide what you are keeping
  before you decide what to charge for it.
- The sticky exhibit-view key is `aggapi.exhibitView.v2`. The default
  orientation changed and a toggle was added, so a stored v1 state would have
  restored a view nobody chose.

### Not done

Two of the twelve reported items are open questions rather than work, both put
back to the author: what "better rules for what to plot" refers to, and how to
calibrate a distortion set on the **gross** basis for the reinsurance-aware
pricing table. The latter has no public route today (`calibrate_distortions`
reads the object's own `density_df`, which under reinsurance is the net), and
reproducing `aggregate._pricing._calibration_survival` here would break the
standing rule against copying library internals.

## 1.0.0a25

From `dev/plan-more-tab.md`. The output tabs stop having two different kinds of
control in one bar, Bounds takes its place, and Reins gets the exhibit.

### More is a tab

Overview · Plot · Price · Reins · Bounds · **More**, and More's pane carries a
sub-button row: Validation | Stats | Density | bs window | Info (raw). Exactly
the Reins pattern.

The dropdown it replaces was the one control on the page that behaved
differently from everything around it: a menu nested inside a pill bar, so half
the output views opened like tabs and half like a menu. Five panes collapse into
one, with the per-view hint line and copy button rendered from a small registry
rather than duplicated in the markup.

**Info moved with it**, which changes one thing worth knowing: a *failed* build
used to dump its parse-error report into the Info pane and switch there. A
failed build has no object, so sending the reader into a sub-menu to find out
why was the wrong direction. The error now renders on the landing tab.

### Bounds

A sixth pill, greyed out. The house rule is that the menu set never changes
shape, so what is coming is visible and plainly not ready rather than absent and
unmentioned. Its pane exists and says so.

### The Reins exhibit

The same two-panel instrument, pointed at three views of one book instead of at
the units of a portfolio: **gross, ceded and net** densities on the left and
their exceedance curves on the right, above the per-layer tables. That is the
question a reinsurance structure exists to answer, and until now the tab
answered it only in numbers.

`reins_density_df` carries the masses but no survival column, so `S` is
accumulated from them. Exact, not approximate: each `p_agg_*` column is a pmf
over the same grid and sums to one, so `1 - cumsum` **is** its survival. Clamped
at zero, because accumulating 2,048 floats to 1 overshoots by a few parts in
1e15 and a survival of `-3.6e-15` is not a number to hand a log axis.

The smoke test checks the derived survivals are non-increasing, bounded and
finish at zero. It deliberately does **not** assert they start at 1: the ceded
distribution is small next to the gross, so on a grid scaled for the gross its
whole mass lands in the first display bucket and its survival legitimately
starts at 0. Writing that assertion the obvious way is what found this.

### Gating

Reworked for the new shape. Top-level tabs gate to `price` and `reins`; the
frames that a kind lacks are now sub-views, so they grey out inside More
instead. A sticky sub-view that the current kind cannot answer falls back rather
than firing a request that would 400.

## 1.0.0a24

From `dev/plan-examples-find.md`. The examples menu becomes findable, and the
hero cards show what they build.

### Finding, not remembering

The library is 186 entries. Grouping them by topic was the right successor to
the letter categories, but scrolling nine groups to reach `CatXOLTower` is not
finding, it is remembering where it lives. The author's verdict on a19 was
short: "no filtering on examples yet, right? if there is i don't understand it".

One list component, two surfaces, both fed by the same payload:

- **the dropdown**, grouped by topic, with a search box pinned at the top and
  focused when the menu opens, so it is type-to-find;
- **`Ctrl+K`**, the same rows full width with room for the note on its own line.

Matching is `@leeoniya/ufuzzy` (about 5 kB gzipped) over
`name + kind + tags + note`, so "cat xol", "reins tower" and "ilw" all reach the
same entry, and `intraMode: 1` means "porfolio" and "distorton" still land. Tags
keep their namespace, so `topic:reinsurance` and `reinsurance` both match.

Typing switches both surfaces from grouped to a **flat ranked list**. A search
result is already ordered by relevance and re-grouping it would scatter the best
matches down the page. Once you are searching, the grouping is noise.

Search keystrokes are stopped from reaching Bootstrap's dropdown handler, which
otherwise steals the arrow keys and closes the menu on Escape mid-word.

### Hero cards show their distribution

New `GET /v1/examples/heroes/sparklines`: a peak-normalized 48-point density
silhouette per hero, rendered as a small inline SVG on the card. Shape only, no
axes and no way to read a number off it, which is what a card thumbnail should
promise.

**Deliberately a separate endpoint from `/heroes`, and called after first
paint.** It builds every hero, and one of them (`CatXOLTower`) carries
`hints{log2=16}`, so a cold call costs seconds. Cards mount immediately on their
placeholder gradient and upgrade in place when the payload lands; a hero that
fails to build keeps its gradient. Nothing on the landing path waits on it.

The silhouette **sums** into its buckets rather than sampling every n-th point.
On a spiky discrete support, sampling lands between the atoms and returns a row
of zeros, so a dice book's thumbnail would be a flat line.

### Bundle

The app chunk goes 28.8 to 34.1 kB gzip; the vendor chunks are untouched.

## 1.0.0a23

From `dev/plan-exhibit-punchups-2.md`. The author's second pass on the exhibit,
and a test harness that no longer needs a server.

### A discrete density is drawn as steps

`drawstyle='steps-mid'`, or ECharts' `step: 'middle'`. `agg Dice dfreq [3]
dsev [1:6]` puts mass on sixteen integers, and joining those with a sloped line
draws probability at values that **cannot occur**. For a discrete book the step
plot is not a nicer rendering of the distribution, it is the distribution.

Triggered by counting points that carry mass: at or below 256, steps. The
threshold is generous because the failure is one-sided, steps being honest for
a coarse continuous grid too, whereas a line over a lattice is a lie. The smoke
test asserts the discrete case steps and the continuous ones do not, so a
harness that stopped discriminating would fail rather than pass quietly.

### The capital anchors are lines, not dots

The dots did not sit on the curve, and could not: the curve is a binned display
grid while the anchor is the library's quantile function at that return period,
so the marker landed slightly off every time. A point has to be *on* the line to
look right; a faint dashed vertical does not, because it makes a claim about the
x-axis rather than about the curve, and reads correctly however coarse the grid
is. Labels sit at the top of each line.

`tail_df` remains the source, for the reason it always was: where it and the
plotted curve differ, the library is right.

### Return periods are integers

`1-in-247`, not `1-in-247.0000003`. In tooltips and axis labels; below 1-in-10
one decimal survives, where the difference is real.

### The smoke test runs offline

`dev/smoke-exhibits.mjs` replayed against a live server, which is no longer
something this project's tooling should assume. New `dev/capture_fixtures.py`
drives the app through FastAPI's `TestClient` (in-process, no port bound) and
writes one payload set per kind to `dev/fixtures/exhibits.json`; the smoke test
replays that by default and still accepts a base URL for a live run.

The fixture file is gitignored: it is derived data and ~17 MB of it.

It also gained a check it should have had at a21: a single-panel exhibit must be
**square**. The distortion aspect ratio was wrong for a whole release and no
automated check would have caught it.

## 1.0.0a22

From `dev/plan-exhibit-punchups.md`. The author's first inspection of the a21
Overview, acted on, plus two bugs that inspection led to.

### A race that made the landing page fail intermittently

**The one that matters.** Fetching `unit_density_df` and `tail_df` for the same
Portfolio at the same moment raised
`KeyError: "['F', 'S'] not in index"` from inside
`Portfolio.unit_density_df`, about half the time on a cold object and never on
a warm one. That is exactly what the portfolio exhibit does, in a single
`Promise.all`, and three of the eight landing heroes are portfolios, one of
which auto-builds on load. So a11 in ten cold visits to the front page got a
500 where a chart should be.

An `Aggregate` or `Portfolio` materializes several frames lazily and caches
them on the instance, so the first read *is* a write. FastAPI runs sync
handlers in a thread pool, so two requests for different frames of one object
are two threads racing to build them. Bisected to that and nothing else:
sequential fetches always passed, concurrent ones failed on cold objects across
repeated fresh server starts.

`CacheEntry` gains a `threading.Lock`, and the eighteen routes that read object
data now take their entry from a `_locked_entry` dependency that holds it for
the request, rather than resolving it unlocked in the body. Structural rather
than a habit each new handler has to remember. Per entry, so unrelated objects
still serve in parallel, and contention is confined to the first access of each
frame. Verified across four fresh cold starts, four passes.

(The dependency is a bare generator, deliberately not wrapped in
`@contextmanager`: FastAPI drives a yield-dependency as an iterator itself and
the wrapper breaks it.)

### Two unbuildable programs were 500s

Both are statements about the program, not server faults, and the library
already reports both well:

- **`xpnl` over a portfolio** raises `NotImplementedError` ("the portfolio
  total hides its units, so there is nothing to explode. Use 'pnl' ...").
- **An unresolved `port.X` / `agg.X` / `sev.X` reference** raises `KeyError`
  ("no recipe named 'X' of kind 'port'").

Neither was caught, so both fell to the catch-all 500 with no useful body. Both
are 422s now, carrying the library's own message. `str()` on a `KeyError`
re-quotes its argument, so the detail is read from `args[0]` or the user would
see a message wrapped in stray quotes.

`pnl` over a portfolio, which does work, gained the regression test it never
had.

### The exhibit gets a control row

Four toggles, sticky per browser like the Static | Interactive table switch, so
a chosen view survives a rebuild and a reload:

| toggle | what it does |
|---|---|
| **log y** | log density, where a heavy tail becomes readable. Zeros are emitted as gaps: a log axis cannot place zero, and the tail of a discretized density is full of exact zeros. The area fill turns off with it, since shading to a log axis floor is a different and false area |
| **survival** | swaps the right panel from loss against return period to exceedance against loss. Same numbers transposed, and in this view both panels share the loss axis, so they read as one picture |
| **full x** | drops the q(0.001) to q(0.999) crop. Answers "what am I not being shown", which the crop otherwise hides silently |
| **reference lines** | the mean and the 1-in-200 anchor, on both panels. One anchor, not three: three dashed verticals over a density say nothing three times |

Each exhibit declares which toggles it honors, so a distortion never offers a
log-y button that would do nothing.

**Zoom now rescales.** The `dataZoom` `filterMode` moves from `none` to
`filter`, so the y-axis re-fits to what is left visible. Without it, zooming
into a heavy tail zoomed into a flat strip near zero, which made the feature
look present and useless.

### Distortion and bivariate are square

`aspect='equal'`, and it was a real error not to have it. A g(s) curve lives on
the unit square and the only thing anyone reads off it is **concavity**, which
a 1000-by-300 aspect ratio misrepresents. The joint-density heatmap is square
for the same reason: stretched wide it lies about where the mass sits. Both now
size a square plot area from the container width, bounded to 240 to 420 px.

### Also

- **The Overview program disclosure is gone.** It repeated what the editor
  shows a few centimetres up the page, which is a poor use of the most valuable
  strip of the tab. The toggle row takes that space. The hints line went with
  it, same redundancy.
- **Exhibit titles trimmed** to `Summary` and `Tail risk`. The captions stay:
  unlike the titles they carry content, naming which anchor is Solvency II and
  why the Freq percentiles are blank.
- The build response's `mean` is now kept in the SPA's state, so the reference
  line costs no extra fetch.

## 1.0.0a21

From `dev/plan-echarts-exhibit.md`. The Overview gets a real chart engine and an
exhibit per first-class citizen. uPlot retires.

### What was wrong with the old plot

Not the library, the design. Five separate faults, only one of which was uPlot's:

1. **It cropped away the subject.** x stopped at `q(0.999)` on a linear scale,
   so the tail (the thing an accurate FFT is *for*) was the part not drawn.
2. **Two y-axes with incomparable scales.** Density around 1e-6 against an
   exceedance in [0, 1]: the density dominated and S read as a cliff then a flat
   line.
3. **Portfolio blind.** It drew `p_total` and nothing else, so the best story in
   the library, diversification, was invisible.
4. **Only agg and port drew anything.** A distortion, severity, P&L or bivariate
   landed on "No risk views for this object", and three of the eight landing
   heroes are portfolios with a bivariate among them.
5. **An instrument, not an exhibit.** No title, 10 px canvas-drawn dashed
   labels, marker chips underneath, no legend, no export.

### The exhibit

Two panels for anything with a loss distribution:

```
density (what it looks like)      exceedance (what it costs)
x = loss, linear, cropped         x = return period, log
y = probability mass              y = loss
```

The EP curve gets equal billing rather than living behind a toggle, because it
is the chart an insurance reader looks at first. The 1-in-100 / 200 / 250
anchors become labeled points **on** the curve instead of dashed lines floating
over a density, and they are read from `tail_df` rather than off the plotted
line: that frame is the library's own quantile function, while the curve is a
binned display grid, and where they differ the library is right.

**The cursor link is exact, not an approximation.** Both panels are built from
the same row array, so a point's index is the same grid bucket in either. A
point the EP panel cannot show (S out in the numerical noise, or a return period
past 1-in-100,000, where the survival function is FFT noise rather than tail) is
emitted as `null` rather than dropped, which keeps the indices aligned and draws
a clean trailing gap. Hovering a loss on the left therefore highlights its
return period on the right because it is literally the same bucket.

Series in the two panels share a `name`, so one legend entry toggles a unit in
both at once.

### One exhibit per kind

The registry is total over the six kinds, so the Overview always lands:

| kind | exhibit |
|---|---|
| `agg` | density + EP, anchors marked |
| `port` | one density and one EP curve per unit, plus the total, legend-toggled |
| `sev` | sampled density + EP; the y-axis says `pdf`, because it is an ordinate |
| `pnl` | signed density with a break-even line; the EP panel runs off **F**, not S, since a P&L's bad tail is the low end |
| `distortion` | g(s) against the diagonal, the load shaded between, tooltip reporting `g(s) - s` |
| `bvagg` | the joint density as a heatmap, block-summed to 96 cells a side |

The bivariate is **summed** into its display cells, not sampled: dropping cells
would silently discard mass and lighten the tail. Its axis names come from
`stats_df`, because the joint frame names only axis 0 (axis 1 arrives as bare
grid values for column headers).

### Two new routes, and why

- **`GET /v1/objects/{id}/unit_density_df`** (Portfolio only). A
  `Portfolio.density_df` carries `p_total` and the per-unit *allocation* columns
  but no per-unit densities; since the windowed-grid work those live on
  `unit_density_df()`, a long frame indexed `(unit, loss)`. Unstacked back to
  wide it gives `p_<unit>` and `S_<unit>` on the portfolio's own grid, which is
  what the portfolio exhibit draws. Verified to align even when the units are on
  wildly different scales.
- **`GET /v1/meta/style`**. The color cycle, grid color and line width read off
  `aggregate.style.rc_params()`. The alternative was a second hardcoded copy of
  the palette in the frontend, which would drift from the Plot tab's matplotlib
  output and the drift would be visible. Falls back to the current values if the
  style is unreadable, so the front page cannot be broken by it.

A **severity now has a `density_df`**: the api samples the frozen scipy variable
onto a quantile-spaced grid, the same presentation-layer move it already makes
for a `PnL`. Columns are `loss / pdf / F / S`, and `pdf` is deliberately not
called `p_total`: it is a density ordinate, not a mass, and reusing the
aggregate's name would invite summing it. The grid inverts the survival function
over log-spaced probabilities rather than walking loss linearly, because a
severity is routinely heavy-tailed with unbounded support, where a linear grid
either truncates the tail or spends every point on it.

### The Overview header block

`/v1/objects/{id}/meta` (new at a19) now feeds a header: name, kind, tag chips,
the note as the lead, and a collapsible canonical `pprogram` with its hints.

This replaces the `pendingNote` module variable, which could only ever show a
note remembered from whichever example was last clicked. The lead is now the
note the built object actually carries, so a **hand-typed** `note{...}` gets one
too. A missing note remains ordinary: no lead paragraph, no empty element.

### Bundle

ECharts is not small and the split says so honestly:

| chunk | gzip |
|---|---|
| app | 27.8 kB |
| bootstrap | 24.7 kB |
| codemirror | 114.2 kB |
| echarts | 186.6 kB |

353 kB total against 187 kB on uPlot. The vendor chunks are new: they change
only with their own version while the app chunk changes every release, so a
redeploy no longer invalidates ~325 kB of cached library code in every returning
browser, and the four download in parallel. `echarts/core` with explicit `use()`
registration keeps the unused two thirds of the library out; the narrow
`DataZoomInsideComponent` and `VisualMapContinuousComponent` are imported
deliberately, since the umbrella names pull both halves of each.

### Also

- **Summary is gone from More.** `summary_df` is an Overview exhibit; showing it
  twice was the same table in two places.
- `dev/smoke-exhibits.mjs` builds one object per kind against a live api and
  asserts each option is drawable: series present, EP panel not entirely null,
  density window not collapsed. It is a smoke test, not a rendering test, and
  says so.
- `config.js` guards `import.meta.env` with optional chaining, which is what
  lets that smoke test import the chart code under bare node.
- `CLAUDE.md` records the re-sync trap: `/v1/meta` reports the version recorded
  when the editable install was built, so a bump without `uv sync` leaves the
  running server (and the About panel) reporting the old one.

## 1.0.0a20

From `dev/plan-all-branding.md`. The app gets a name and the house prose rule.

### aggregate Loss Library (aLL)

`aggregate_api` is the package; **aggregate Loss Library** is the app it serves.
The banner reads the app name on the first line with *description to
distribution* under it in grey small caps, which inverts the old pair
("Description to distribution" set as the title, over "AGGREGATE" as a kicker).
The tagline was doing the title's job.

The name follows through the page `<title>`, the `meta description`, the PWA
manifest (`short_name` is `aLL`, so an installed icon is labeled), the service
worker header, the Help and About leads, `README.md` and the package
description. The lower-case `a` is deliberate throughout: `aggregate` is the
package, `Aggregate` is the class.

`.brand-kicker` moves from mono, `.52rem`, `.3em` tracking to
`font-variant: small-caps` at `.6rem` with `.18em` tracking. Real small caps
where the face has them, synthesized where it does not, and legible either way.

### No dashes as punctuation

The `aggregate` house rule is adopted verbatim into `CLAUDE.md`: not the em dash
`—`, not the ASCII double `--`, not a spaced hyphen. Rewrite rather than
substitute, so a comma, a colon, parentheses or a full stop does the work.
Hyphenated compounds, CLI flags and CSS custom properties are unaffected, since
those are not punctuation.

Every user-visible string is swept: the tab captions and hint lines in
`index.html`, the Overview exhibit titles ("Summary: what it's made of", "Tail
risk: how bad it gets"), the rate-limit card, the build-failure line, the
empty-Overview message, and `CLAUDE.md` itself. The About panel's placeholder
`—` becomes `…`, which reads as "loading" rather than as an em dash.

It is an **authoring** rule, so it binds strings as they are written or touched.
Roughly 190 legacy ` -- ` glosses remain in internal docstrings and comments;
those are cleaned as their file is next edited, rather than in one mechanical
sweep that would bury the real diffs. Recorded in `CLAUDE.md` so the policy is
explicit rather than looking like an oversight.

### Also

`CLAUDE.md`'s frontend section listed `actions.js`, `plot-pane.js` and
`pricing-pane.js`, all deleted at 1.0.0a7. Replaced with the modules that exist.

## 1.0.0a19

From `dev/plan-relink-library.md`. The api catches up with `aggregate`
1.0.0a148 to 1.0.0a174. The library moved a long way in that span (the recipe
layer, one merged `library.agg`, and a declared first-class-citizen contract),
and the api had stopped tracking it. Everything here is a consequence of
following upstream rather than a new idea.

### The example library was dead

`examples.py` read `agg/examples.agg`, which stopped existing when a159 merged
the three shipped libraries into one `library.agg`. `load_examples()` raised
`FileNotFoundError`, so `/v1/examples` returned 500 and took both the Examples
dropdown and the landing hero gallery with it.

The whole text-parsing layer is gone with it: no Contents block to read
(`_CONTENTS_LINE`), no `<Letter>.<Name>` convention to match (`_ITEM_LINE`), no
`note{...}` to pick out of a folded statement (`_NOTE`), no
`UnderwritingLexer.preprocess` call. The library is now read the way the library
asks to be read, off `build.recipes` and `build.recipe(name)`.

Grouping moved from filing letters to the tag namespaces a161 introduced, with
`?group=` selecting the axis:

| | |
|---|---|
| `topic` (default) | the successor to the letters: aggregate 31, severity 55, frequency 16, reinsurance 13, portfolio 29, distortion 8, pnl 24, bivariate 12, numerics 17 |
| `kind` | the object type, off the recipe index: agg 114, port 29, sev 13, bvagg 12, pnl 10, distortion 8 |
| `role` | hero, intro, reference, paper, plus an `other` bucket for the untagged majority |

An entry tagged in two topics appears under both, which is intended.
`GET /v1/examples/heroes` is new and is exactly
`build.discover(tags='role:hero')`, the eight landing-gallery entries.

Two details worth knowing:

- **`Recipe.decl` is already canonical.** It is the entry re-rendered from its
  spec: doc-free, in spread layout, carrying `hints{}` because those change how
  the object builds. So the SPA's post-load `POST /v1/decl/format` round-trip is
  gone. It comes back *empty* for a spec the unparser cannot render (the shipped
  case is `dist MinimumDistortion minimum dist.A dist.B`, whose spec holds
  constructed `Distortion` objects rather than names); the loader falls back to
  the stored program with the same trailer trim.
- **Session builds no longer leak into the menu.** Every program built through
  `POST /v1/objects` is added to the underwriter's recipe base with
  `source='session'`, and the api shares the `build` singleton, so an unfiltered
  walk put the user's own untagged programs in the Examples dropdown. Filtered
  out in both the listing and the hero lookup.

### `bivariate` is `bvagg`

**Breaking.** The parser's kind vocabulary is `agg`, `sev`, `port`, `bvagg`,
`pnl`, `distortion`; the api said `bivariate`. Where the two disagree on a name
the library wins and the api adapts. `BuildResponse.kind` changes accordingly,
along with the SPA's gating keys, labels and density switch.

`_classify_object` is now a table keyed on the class name, and the classes are
exactly `aggregate.constants.FIRST_CLASS_CLASSES` plus `NEAR_FIRST_CLASS`, with
a startup warning if upstream adds a first-class class the api has no kind for.
`Distortion` and `Severity` reach the api as *subclasses* (`DistortionPH`,
`SeverityScipy`), so those two taxonomies flatten to their base kind.

### `sev` builds

`Severity` is DecL-creatable and near-first-class, and the merged library ships
13 `sev` entries that the Examples menu now offers, so refusing to build them was
no longer defensible. It is a look-through onto a frozen scipy variable rather
than a compute result, so it carries `info`, `plot` and the metadata surface and
none of the frames: every frame route answers a clean 400 and the SPA greys out
the tabs that do not apply.

### Renames followed

Three upstream renames were live bugs here, all silent:

- **`agg_m` / `agg_cv` are `actual_m` / `actual_cv`** (a149). The build summary
  line had been showing a blank mean and CV. A `PnL` carries only `est_m` /
  `est_cv` (its outcome is emergent, so there is no input mean), which is now the
  documented fallback rather than an accident.
- **`validation_explanation` is the long form** (a172). It used to return
  `'not unreasonable'`; it now returns a paragraph, and the terse verdict moved
  to `validation_description`. The one-line summary chip reads the description.
- **`Underwriter.knowledge` is `recipes`** (a164). The session `.agg` export
  raised `AttributeError` on every `form=agg` download.

Also corrected: `tail_df` is a property on `Aggregate` and `Portfolio` (a149,
not a method), and a `BivariateAggregate` has no `tail_df` at all since a171
renamed its same-named frame to `axis_support_df` because the two reports were
unrelated.

### `GET /v1/objects/{id}/meta`

New. The object's own DecL metadata in one call: `note`, `tags`, `hints`,
`program` (what the parser was handed, after preprocessing) and `pprogram` (what
it understood, re-rendered canonically). One route for all six kinds.
`doc{{{...}}}` is never served: it is the cookbook's long-form recipe, not
playground content. Empty clauses serialize as `null` so the client can test
presence without trimming.

### Note

A `note{}` is **preferred, never required**. 146 of the 186 shipped entries carry
one; an entry without a note is ordinary, and the dropdown blurb, hero card and
Overview lead all degrade to nothing rather than showing an empty element.

## 1.0.0a18

Punch-ups to the a17 chrome/download pass.

- **Header docs / github links removed.** They're now in both the Help and About
  panels, so the header cluster is just the hamburger.
- **Session `agg` download is line-wrapped.** The `agg` form now runs each
  canonical program through `format_program` (spread/text layout) after
  `spec_to_decl`, so the download reads as tidy multi-line DecL. The `raw` form is
  deliberately **left verbatim** — `format_program` re-parses and would expand
  compact syntax (a range `[10:100:10]` becomes `[10 20 … 100]`), which is exactly
  the difference the two forms exist to preserve: `raw` = your exact source,
  `agg` = canonical/re-flowed. *(Rebuild the SPA bundle.)*

## 1.0.0a17

From `dev/plan-chrome-about-download.md` — header chrome refresh + session-model
download (first cut of a UI refresh).

- **Top-right hamburger menu** replaces the `?` help button: Help, Download models
  (raw / .agg), About, and a greyed-out **"Example source… (soon)"** placeholder
  for a coming example-source switcher.
- **About panel** (new right offcanvas): lists internal-tool versions —
  `aggregate` / `aggregate_api` (from `/v1/meta`) and `csv-grid` / `uPlot` /
  `Bootstrap` (Vite build-time `define`s; two new defines added). The three
  version strings are **removed from the header** and now live here.
- **Download session models** — new `GET /v1/session/models.agg?form=raw|agg`.
  `raw` emits the programs exactly as typed (from the object cache); `agg` emits
  canonical, dependency-ordered DecL from the underwriter's session knowledge
  (best-effort, verbatim fallback), re-loadable. Empty session ⇒ header-only file.
  **Note:** scope is *process-global* (shared cache/underwriter) — every build
  since server restart, not per-browser; fine for a personal/local instance.
  *(Rebuild the SPA bundle — `scripts/build-web.ps1`.)*

## 1.0.0a16

From `dev/plan-grid-full-chrome.md` — turn on the CsvGrid feature set so the grids
are actually useful, and consolidate export onto the grid. Frontend only.

- **csv-grid 3.1.0 → 3.9.0 (dependency bump).** The pinned 3.1.0 (`6033b20`)
  predated the copy / save export controls, so they couldn't be "enabled" — 3.9.0
  (`01a9773`) adds them (a default-on `exportButtons` option) plus row selection.
  The `web/package.json` spec is now **pinned to the exact commit** (was a bare
  git URL): with the bare URL, `npm install` re-resolved from npm's cache to the
  old commit and silently reverted the build to 3.1.0. (Lockfile still records
  `git+ssh://`; a deploy host needs GitHub SSH or the `insteadOf` git config — see
  a7.)
- **Every grid gets the full chrome by default.** fzf global search, per-column
  filters, the status bar, and copy / save export — all CsvGrid defaults — are no
  longer stripped. The `GRID_PLAIN` (chrome-off) preset is gone.
- **Expand/Contract is conditional on width.** Shown only from 6 columns up,
  omitted below that (`grid.js`), so it doesn't clutter narrow tables.
- **Custom per-tab CSV download buttons removed.** The `data-csv` buttons
  (summary / validation / stats / density / bs-window) and the reins `csv` button
  are gone — CsvGrid's own copy / save is the single export path; the unused
  `api.frameCsvUrl` helper is dropped. The Info-text **copy** and the Plot **SVG**
  download stay (not table exports). **Note:** the grid exports the *displayed*
  data, so for density (binned) and stats (raw moments dropped) that isn't the
  full frame the old buttons gave — the `/frame/{which}.csv` backend endpoints
  remain for full-frame access. *(Rebuild the SPA bundle — `scripts/build-web.ps1`.)*

## 1.0.0a15

From `dev/plan-overview-polish.md` — punch-ups to the a13 Overview landing
("demo-central"). Frontend only; no backend or api change.

- **Overview tables get a `Static | Interactive` toggle (Static default).** Every
  table in the app is a CsvGrid except the two Overview exhibits (`summary_df`,
  `tail_df`), which stayed hand-built because the landing demo reads better with
  the curated static exhibit — lit **1-in-200 / 1-in-250** capital anchors, bold
  **Agg / total** — and CsvGrid has no row-highlight to reproduce it. Rather than
  force one, the exhibits now carry a small `Static | Interactive` segmented
  toggle: Static (the curated exhibit) is the default, Interactive swaps in the
  CsvGrid (sort / filter / search); the choice is sticky per browser. All other
  tables are unchanged (CsvGrid).
- **Overview density / exceedance plot width capped.** The uPlot chart was
  full-bleed (`width: 100%`); now `max-width: 720px`, reflowing to the container.
- **Overview density plot x-axis cropped to a sensible window.** The plot auto-fit
  to the whole FFT grid, so a heavy tail squashed the visible mass into a sliver.
  It now crops to ~`q(0.001)..q(0.999)` with 2% padding — the window
  `aggregate`'s `Aggregate._limits` / `Portfolio._limits` use — computed
  client-side from the `F` column already in the payload, which handles signed
  (PnL) vs non-negative (agg / port) grids automatically. Drag still zooms.

## 1.0.0a14

From `dev/plan-pnl-kind.md` — pick up the `aggregate` a114→a145 surface (the
library advanced ~30 releases since a13 rode a113). An audit of both sides found
almost all of it internal or serialized generically; the one thing that reached
our surface was the **P&L engine**, which now builds a real object.

- **New `pnl` object kind (breaking-ish surface addition).** `aggregate.build`
  returns an `aggregate._pnl.PnL` for a `pnl` / `xpnl` DecL program (`xpnl` is
  the same class built with a multi-group walk). `_classify_object` had no `PnL`
  case, so it fell through to an unaccepted `"pnl"` kind and **every `pnl` /
  `xpnl` build 422'd** — and the bundled `examples.agg` now ships a `pnl H.PnL …`
  example that surfaced in the dropdown and failed on click. `PnL` now maps to a
  new `kind="pnl"`; `BuildResponse.kind`'s `Literal` and the accepted-kind guard
  gain `"pnl"`. **Clients that switch on `kind` will now see `"pnl"`.**
- **PnL density synthesis.** A `PnL`'s `density_df` is an `OrderedDict` of per-leg
  grid distributions, not a DataFrame, so the generic density path would 500. The
  density route (and its CSV export) now synthesize the grand-result density
  (`obj.result`) into the standard `loss / p_total / F / S` frame
  (`serializers.pnl_density_frame`) and bin it to the 2¹¹ display grid like an
  aggregate. The P&L outcome axis is signed (losses negative); the existing
  positional `bin_density` handles it, and `p_total` stays faithful (sums to ~1).
- **PnL reporting surface.** Info / Summary / Validation / Stats / Density / Plot
  work (the Overview tab too — the absent `tail_df` is skipped gracefully); the
  build summary line's mean/CV fall back to `PnL.mean` / `PnL.cv` (no `agg_m`),
  and the Info tab falls back to `construction_explanation` (no `info` string).
  Price / Reins / bs-window are inapplicable and return a clean 400 (the SPA
  greys those tabs out — `NA_TABS_BY_KIND.pnl`, mirroring `bivariate`).
- **SPA:** the summary line and timing word read **P&L** for a `pnl`; kind gating
  added. *(Rebuild the bundle — `scripts/build-web.ps1` — to ship the frontend.)*
- **Examples loader recognizes `xpnl`.** The `_ITEM_LINE` keyword set gains
  `xpnl` (latent — no `xpnl` item in the bundled file yet, but it's a valid
  top-level statement keyword).
- **No change needed** for the rest of the a114→a145 drift (verified
  non-breaking): the `summary_df` a142 column renames (`E[X]`→`Mean`,
  `p0.99`→`P99`, values now computed) are cosmetic to us — the Overview
  emphasizes by row index (`Agg`/`total`/`T`), not header names; the
  `VariableRatingAnalysis` / `ReinstatementAnalysis` removal (a144) was never on
  our surface; the a145 bs-window rework leaves the public `bs_window_df` columns
  unchanged; the labels namespace and reins premium scaling change values, not
  the serialized frame shapes.

## 1.0.0a13

From `dev/plan-user-facing.md` — rework the SPA landing from an internal tool
into an immediate demo, riding the upstream `aggregate` 1.0.0a113 risk frames.

- **New risk-view endpoints.** `GET /v1/objects/{id}/tail_df` (return-period /
  exceedance table — `p · VaR · TVaR · xsVaR · VaR/Mean`) and
  `GET /v1/objects/{id}/validation_df` (the moment-vs-estimate QA table). Both
  are CSV-downloadable via `/frame/{which}.csv`. A `_resolve_frame` helper calls
  `tail_df` when it is a method (Aggregate / Portfolio) and reads it when it is a
  property (BivariateAggregate), so one route covers both.
- **`/summary` now serves the user risk view.** Upstream repurposed `summary_df`
  in place (moments + percentiles, Freq/Sev/Agg), so the existing route changed
  meaning; the old moment-validation payload moved to the new `validation_df`
  route. Docstrings updated; no path change.
- **SPA: "Description to distribution" landing.** Brand title + one-line subhead;
  a hero gallery of four random group-A showcase examples (the set grows — the
  count is not assumed), one of which auto-builds on load so the page lands fully
  populated with zero clicks. Examples load in the new multiline/spread DecL
  layout (now `format_program`'s default).
- **SPA: Overview tab (new default).** Replaces Info as the landing tab: the
  example's `note` as a lead, an interactive density / exceedance chart (uPlot,
  fed from `density_df` with 1-in-100/200/250 markers off `tail_df`), then the
  `summary_df` and `tail_df` exhibits (the 1-in-200 / 1-in-250 capital rows lit,
  `Agg` / `total` emphasized). Degrades gracefully when an object lacks a frame.
  Info / Summary / Validation / Stats / Density / bs-window move under **More ▾**.
  The matplotlib SVG export stays on the **Plot** tab.

## 1.0.0a12

Batch from `dev/plan-misc-03.md` (gather → review → execute).

- **Examples loader follows `aggregate`'s new statement syntax.** DecL programs
  now separate statements with a blank line or a trailing `;` (line breaks
  replaced the old `\` continuation), so the bundled `examples.agg` is
  semicolon-terminated and writes the portfolios across several indented lines.
  The old loader only folded `\`-continuations and only stripped a `note{...}`
  at the very end of a line, so under the new syntax every multi-line `port`
  (section F) and the `bivariate` example (section H) vanished from the dropdown,
  and every `;`-terminated program lost its `note` and carried a stray
  `note{...};` in its decl. The loader now delegates statement splitting to
  `aggregate`'s own `UnderwritingLexer.preprocess` (so the SPA sees exactly the
  statements the default `build` underwriter does) and runs the item/note
  regexes over those clean statements. The item-keyword set is refreshed for the
  current grammar: `bivariate` / `bv` and `clash` added, the view-pair prefixes
  `grossceded` / `grossnet` added alongside `netceded`, and the retired
  `mv` / `multivariate` keywords dropped.
- **Docs:** `examples.py`'s module docstring and comments now name `examples.agg`
  (the file the loader actually reads) and describe the statement model
  (closes `plan-misc-03` item 4).
- **Bivariate objects replace the `multivariate` vocabulary.** `aggregate`
  renamed `MultivariateAggregate` to `BivariateAggregate` and retired the
  `multivariate` / `mv` keywords in favor of `bivariate` / `bv` (plus `clash`
  and the `netceded` / `grossceded` / `grossnet` occurrence view-pairs). The api
  follows suit: `_classify_object` maps `BivariateAggregate` to a new
  `kind="bivariate"` (replacing `"multivariate"`), `BuildResponse.kind`'s
  `Literal` is updated, and the SPA's kind label / timing word / tab-gating /
  density-fetch switch all key off `"bivariate"`. The reporting surface is
  unchanged — info / summary_df / stats_df / density_df / plot work; price /
  reins / bs-window return a clean 400. **Breaking:** clients that special-cased
  `kind == "multivariate"` must switch to `"bivariate"`. *(Rebuild the SPA bundle
  — `scripts/build-web.ps1` — to ship the frontend half.)*
- **`reins_description` reads the library's string attribute.** `aggregate`
  turned `Aggregate.reins_description` from a method into a plain string
  attribute (e.g. *"Ceded to 100% share of 15 xs 5 per occurrence"*). The
  `reins_description` endpoint returned empty text because it only called a
  *callable*; it now reads the string property directly, so the always-visible
  reinsurance blurb renders again.
- **`describe` → `summary` (object moment table).** `aggregate` renamed the
  object-level `describe` property to `summary_df`. The api endpoint is renamed
  `GET /v1/objects/{id}/description` → `GET /v1/objects/{id}/summary`, the CSV
  download token `describe` → `summary` (`/frame/summary.csv`), and the SPA tab
  is relabeled **Describe → Summary** (tab id `desc` → `summary`, pane
  `pane-desc` → `pane-summary`, `api.description` → `api.summary`). **Breaking:**
  the `/description` path and the `describe.csv` download token are gone — use
  `/summary` and `summary.csv`. *(`reins_describe` / `reins_description` are a
  separate reinsurance surface and are unchanged.)*
- **Build-summary validation reads `validation_explanation`.** `aggregate`
  replaced the `explain_validation()` method with a `validation_explanation`
  string property (e.g. *"not unreasonable"* / *"fails sev mean, agg mean"*).
  `_summary_fields` now reads the property, so the build status line's validation
  chip is populated again instead of going blank.
- **`line` → `unit` and pricing-method signatures (full `aggregate` a76–a84
  surface sweep).** Brought the rest of the API into line with the renamed
  library surface:
  - **kappa plot** keyed off the removed `Portfolio.line_names_ex`; now
    `unit_names_ex`. Without this, every per-unit kappa plot 400'd ("kappa plot
    requires a Portfolio") even for a real Portfolio.
  - **`Portfolio.price_ccoc`** signature changed to `price_ccoc(ccoc, *, p)`
    (arg order swapped, `p` keyword-only). The constant-CoC `/pricing_at` path
    called `price_ccoc(p, ccoc)` → `TypeError`/500; now `price_ccoc(ccoc, p=p)`.
  - **`pricing_at` frame index** renamed `line` → `unit` upstream; the per-row
    breakdown is now keyed `unit` (was a hard-coded `index_name="line"`).
  - Confirmed unchanged-and-working against the new surface: `summary_df`,
    `stats_df`, `density_df`, `bs_window_df` / `_bs_window_df`, `agg_m` /
    `agg_cv`, `price_pentagon(*, p, ROE|LR)`, `calibrate_distortions`,
    `analyze_distortions(*, p).pricing_df`, `distortion_df`, `reins_*`, and the
    `exeqa_*` density columns. New tests cover the two previously-untested
    breakages (Portfolio kappa plot, ccoc `/pricing_at`).
  - The transitional `describe`/`explain_validation`/callable-`reins_description`
    fallbacks added earlier this batch are removed — `aggregate` made clean
    breaks (no aliases), so the API matches the single canonical name.
- **`reins_describe` → `reins_summary_df` (aggregate a85).** The last
  `describe`-verb frame property was renamed to join the `_df` family. The api
  follows: the endpoint `GET /v1/objects/{id}/reins_describe` →
  `GET /v1/objects/{id}/reins_summary_df`, the CSV token / `_CSV_FRAMES` entry
  `reins_describe` → `reins_summary_df`, the reinsurance-availability signal in
  the `reins_description` route now reads `reins_summary_df`, and the SPA Reins
  tab's first sub-button is relabeled **"reins describe" → "reins summary"**
  (`data-reins="reins_summary_df"`, `state.reinsWhich` default). **Breaking:**
  the `/reins_describe` path and `reins_describe.csv` token are gone — use
  `reins_summary_df`. The text blurb endpoint `reins_description` (a string
  property) is unchanged, as are `reins_stats_df` / `reins_density_df`. The
  `BivariateAggregate` reporting redesign (a85: rebuilt `summary_df`, slimmed
  `stats_df`, new `dependency_df`) needs no api change — those frames are
  serialized generically. *(SPA bundle rebuilt.)*
- **Infinite-variance builds return 422 (aggregate a87).** Building an
  infinite-variance aggregate (e.g. `pareto` shape ≤ 2) without an explicit `bs`
  now raises `InfiniteVarianceError` (a `ValueError` subclass) instead of
  silently sizing. The build handler's existing `except ValueError` already maps
  it to a 422 carrying the library's "pass an explicit `bs`" message; a
  regression test pins the behavior.
- **Transformer errors now arrive as plain `ValueError` (aggregate a86).** A bad
  distortion kind (and other transformer `ValueError`s) surface directly rather
  than wrapped in Lark's `VisitError`. The build handler's `except ValueError`
  catches them and still returns 422; the `except VisitError` clause is retained
  as defensive cover for any non-`ValueError` transformer exception. (Test
  comment updated; no behavior change.)

## 1.0.0a11

Punch-ups from the a10 demo pass — two small fixes on top of 1.0.0a10.

- **Build-time semantic errors render legibly in the SPA.** The a10 fix returned
  these as a 422 with a *plain-string* `detail` (e.g. *"Unknown distortion kind
  'dualx'; available: …"*), but the error pane only knew how to render the
  `ErrorReport` *dict* shape, so a string fell through to a generic "Request
  failed". The renderer now shows a string `detail` directly. (Frontend only;
  the backend was already correct.)
- **Density binning uses centered "around xᵢ" buckets.** The 2¹¹ binning now
  labels each coarse node at `i·bs'` (0, bs', 2·bs', …) and sums the fine mass
  in the window *centered* on it — node `i` owns `(i·bs' − bs'/2, i·bs' + bs'/2]`
  (so with `bs'=320` the first row is `0` covering `loss ≤ 160`, the second is
  `320` covering `160 < loss ≤ 480`, …). Masses sum; `loss` takes the node
  center; `F`/`S`/`ex***` take the window right edge, so `F` reads as the running
  cumulative and `F[i] − F[i−1] == p_total[i]` exactly (the native coarse-build
  convention). Still exactly 2048 rows; `p_total` sums to ~1. (Replaces the a11
  right-edge labeling shipped earlier in this section.)
- **Density grid shows all 2048 rows.** CsvGrid's default `renderCap` (2,000)
  truncated the binned grid with a "show all" prompt; the Density pane now sets
  `renderCap: 2048` so the full grid renders directly.
- **Examples loader recognizes more object kinds.** The `GET /v1/examples`
  item parser only matched programs starting with `agg` / `sev` / `port` /
  `dist`, so `pnl`, `mv` / `multivariate`, and `netceded agg …` examples never
  surfaced in the dropdown. The item regex now covers those (the `netceded agg
  X.Name …` two-keyword form included). The bundled `spa_examples.agg` was
  reformatted to the `# <Letter>. <Title>` contents + `<Letter>.<Name>`
  convention so the curated set populates the categorized dropdown.

## 1.0.0a10

Assorted playground tweaks (`dev/done/plan-misc-02.md`) — six small fixes
gathered while demoing the playground.

**Backend**

- **Build-time semantic errors now return 422, not 500.** An unknown distortion
  kind (`dist X pd 0.5`, a `ph`→`pd` typo) is raised *inside* the Lark
  transformer and surfaced as a `lark.exceptions.VisitError`, which fell through
  to the catch-all 500. A new `except VisitError` clause unwraps `.orig_exc` and
  returns 422 with the clean message (*"Unknown distortion kind 'pd';
  available: …"*), rendered legibly in the SPA error pane. The catch-all 500 is
  retained for genuine server bugs.
- **`MultivariateAggregate` objects build.** The `multivariate` / `mv` /
  `netceded` DecL keywords now build and cache as `kind="multivariate"` instead
  of being rejected with "api supports … only; got 'multivariateaggregate'".
  They expose the common reporting surface — Info, Describe, Stats, Density (the
  joint-density matrix), and the native Plot. Pricing, reinsurance, and the bs
  window legitimately return a clean 400 (the SPA greys those tabs out — see
  below). `BuildResponse.kind` widened to include `"multivariate"`.
- **Multi-line input builds without `\`.** The build entry collapses newlines,
  tabs, and `\` line-continuations to single spaces before parsing, so a program
  formatted across several indented lines builds (DecL otherwise treats a bare
  newline as a program separator). Applies before the hints scan, cache key, and
  parse, so cache keys become formatting-insensitive and parse-error carets
  reflect the submitted source.
- **Stats / Reins-stats tables omit raw moments.** The displayed `stats_df` and
  `reins_stats_df` drop the `ex1` / `ex2` / `ex3` rows (E[X], E[X²], E[X³]),
  keeping the human-readable `mean` / `cv` / `skew` (and the `meta` block). The
  full-frame CSV download keeps everything.
- **Faithful power-of-two density binning.** The density display reduction was
  even-spaced row sampling (stride-skip), which understated `p_total` by the
  stride factor (summed to ~0.045 instead of 1). Density / reins-density / kappa
  now bin the full grid to a fixed 2¹¹ = 2048 grid-aligned rows — "as if built
  at a coarser `bs`" — summing the mass columns (`p_*`) and right-edging the
  pointwise columns (`loss` / `F` / `S` / `ex***`). `p_total` is now correct
  (sums to ~1). The full-frame CSV download stays exact / unbinned.

**Frontend**

- **Price defaults bumped** to CoC `0.15` (was `0.10`) and LR `0.90` (was
  `0.70`) — LR is the technical premium ratio (no expenses), so 0.9 is the
  natural default. The `p` default (`0.99`) is unchanged.
- **Tabs grey out, never disappear (house rule).** Tabs that don't apply to the
  built object (Price / Reins / bs window for a distortion or multivariate) are
  now *disabled* (greyed, non-interactive) rather than hidden — the menu set
  stays stable. **Behavior change vs 1.0.0a9**, which *hid* those tabs for
  distortions via `d-none`; that path is retrofitted to the grey-out.
- Multivariate gets its own summary / timing label ("Multivariate"), and its
  Density tab renders the full joint-density frame.

## 1.0.0a9

Make the playground less brittle (`dev/done/plan-misc-01.md`) — five small,
related fixes found mostly while exercising the Price tab and `dist …`. Absorbs
plan-0002 **C1** (standalone Distortions) and **D2** (hints log2 cap).

**Backend**

- **Pricing accepts `p = 1` (max).** `PriceRequest.p` and `PricingRequest.p`
  relaxed from `(0, 1)` to `(0, 1]` (`lt=1` → `le=1`). On a *bounded*
  distribution `p=1` resolves to the finite max of support via the lower
  quantile — the motivating use case (bounded distortions). On an unbounded one
  it returns the last grid bucket, so it's grid-dependent there.
- **Standalone `Distortion` objects build.** `dist MYD ph 0.5` (and every other
  `Distortion` subclass) now builds and caches as `kind="distortion"` instead of
  being rejected with "api supports 'agg' and 'port' only". Distortions expose
  the common reporting surface — Info, Describe, Stats, Density (the g-curve over
  x∈[0,1]), and the native Plot all work. Pricing, reinsurance, and the bs window
  legitimately return a clean 400 (the SPA hides those tabs — see below).
- **`log2` cap enforced against `hints{}`.** `AGGAPI_LOG2_CAP` (default 18) was a
  request-only guard; a program could dodge it with an embedded
  `hints{ log2=24 }` clause. A static pre-build scan now folds any `hints{}`
  `log2` into the cap check (effective = max(request, hint)); over-cap → 422
  naming the effective `log2`. `bs` and every other hint pass through untouched —
  the guard only vetoes an over-cap `log2`, it never rewrites the program.

**Frontend**

- **FastAPI 422 validation errors render legibly.** A Pydantic rejection (bad
  `p`, over-cap `log2`, malformed `bs`) used to surface as a bare "HTTP 422"; the
  error pane now maps the `detail` array to `"<field>: <msg>"` (e.g.
  *"p: Input should be less than or equal to 1"*). General — covers every
  validated endpoint.
- **Distortion-aware UI.** Summary line and timing label say "Distortion"; the
  Density tab pulls the whole g-curve frame (no `loss,p_total,F,S` columns to
  request); Price / Reins / bs-window tabs are hidden for a distortion (and
  re-shown for agg / port) so they can't be clicked into a guaranteed 400.
- **csv-grid version in the header.** The top-right line now reads
  `… · api <ver> · grid <ver> · docs · …`. The version is a build-time constant
  (Vite `define` reads `csv-grid`'s `package.json`), not an api/meta field — the
  backend has no knowledge of which `csv-grid` the SPA bundled.

## 1.0.0a8

CsvGrid polish (follow-up to a7). No backend changes.

- **Force grids to light mode.** CsvGrid auto-follows the OS via
  `prefers-color-scheme`, so on a dark-mode browser the grids rendered dark while
  the (light-only) SPA around them stayed light. `mountGrid` now sets
  `data-theme="light"` on every grid host to opt out. A real SPA-wide dark mode
  is intentionally out of scope (it would also need dark plots — a whole thing).
- **Describe loses its per-column filter row** (kept the global fzf search bar):
  the frame is narrow enough that the column filters were just noise.

## 1.0.0a7

Adopt **CsvGrid** for every table in the SPA (`dev/done/plan-grid.md`). No
backend changes — the `FrameResponse` `{columns, rows}` shape is unchanged and
maps straight onto CsvGrid `records`.

**Frontend — one grid everywhere**

- **All output tables now render through CsvGrid** (`mynl/CSV_Viewer`, git
  dependency) instead of the hand-rolled `.tbl` renderer: Describe, Stats,
  Density, bs window, the three Reins frames, and the Price set (pentagon,
  calibrated distortions, and the LR/P/PQ/ROE distortion slices). Substantive
  frames get click-to-sort, fzf-style global search, and per-column filters;
  the small 3–8 row frames (bs window, pentagon, distortion slices) keep sort
  but strip the search/filter chrome. The Price-stat slices keep their exact
  formatting via CsvGrid per-column `formats` (`.1%`, `,d`, `.3f`, `.0%`).
- **Density preview lifted** from 300 to 2 000 server-downsampled rows, shown in
  a bounded 25-row scroll viewport (CsvGrid lazy-formats and caps the DOM at its
  render cap). Full-frame `{url}` + worker parsing remains a future option — the
  Vite build already emits a correctly-pathed worker asset; we ship with
  `worker: false` for determinism until it is browser-verified.
- **Teardown lifecycle** (`web/src/grid.js`): CsvGrid instances are tracked per
  pane and `destroy()`ed on re-render and on rebuild, so listeners (and any
  future worker) don't leak.
- **Dead code removed:** `web/src/actions.js`, `pricing-pane.js`, `plot-pane.js`
  (an unimported pre-redesign action layer), the `renderTable` /
  `renderFrameTable` / `renderBuildBanner` renderers, the dense `.tbl` styles,
  and the stale pre-redesign `web/public/index.html`.

**Deployment note**

- The new `csv-grid` git dependency is fetched at `npm install`. npm rewrites
  the lockfile's `resolved` URL to `git+ssh://` regardless of the `git+https`
  spec; the repo is public, so the VPS build host needs either GitHub SSH access
  or `git config --global url."https://github.com/".insteadOf "git@github.com:"`.
  Pinned to commit `6033b20` (csv-grid 3.1.0) via the lockfile.

## 1.0.0a6

Installable PWA (`dev/plan-pwa.md`, Phase B). No backend changes.

**Frontend — PWA**

- **Completed the web app manifest** (`web/public/site.webmanifest`): real
  `name` / `short_name` / `description`, `start_url` and `scope` of `/`,
  `display: standalone`, and a white `theme_color` matching the header (also
  added as `<meta name="theme-color">`). Icons kept `purpose: "any"` — the logo
  runs edge-to-edge with no maskable safe zone, so claiming `maskable` would crop
  it on Android; a padded maskable variant is future polish.
- **Service worker** (`web/public/sw.js`, served at `/sw.js`, scope `/`):
  deliberately minimal — it exists to make the SPA installable and to speed
  repeat loads, not for offline use (a build requires the backend). `/v1/*` is
  **never** cached (network-only); HTML navigations are network-first (so a
  redeploy is picked up); content-hashed assets are cache-first; old caches are
  purged on `activate`. Registered from `main.js` in the **production bundle
  only** (so it never intercepts the Vite dev server) and only in a secure
  context.

**Deployment — retire the `/Q7M4Z9KP` obscured prefix (Phase A, operational)**

- The PWA is only clean at an origin **root**, so the deploy moves off the
  obscured `www.mynl.com/Q7M4Z9KP/` subpath to a dedicated **`agg.mynl.com`**
  subdomain (same-origin api, so the SPA builds with **no** `-ApiBase`). The
  prefix strip used to hide `/docs` by accident; the new Caddy block does it
  **explicitly** (`respond /docs … 404`) while keeping `/v1/*` open and the
  build rate-limit in place. Full DNS + Caddy + `refresh.sh` cutover steps are in
  `dev/plan-pwa.md`; these are server-side and applied at deploy. `build-web.ps1`
  usage notes trimmed to the same-origin default.
  - **Sequencing:** do the subdomain cutover **before** deploying this bundle —
    under the old `/Q7M4Z9KP/` subpath the manifest `start_url`/`scope` and the
    `/sw.js` registration resolve to the wrong path and the PWA simply won't
    activate (no breakage, just inert). It works at `localhost` root today.

## 1.0.0a5

Two small, client-only SPA additions (`dev/plan-help.md`,
`dev/plan-ui-enhancements-01.md`). No backend changes.

**In-SPA help (plan-help)**

- **Always-visible `?` in the header** (after `docs · github`) opens a right-side
  Bootstrap **offcanvas** quick-help panel: a one-line intro, a paste-ready
  example with a **Load it** button (drops it into the editor via the same
  `format_program`-normalized path as the Examples dropdown), the key bindings
  (incl. `↑↓` history and `Alt+↑↓` examples), a one-line guide to the Build /
  Examples / log2 / bs controls and every output tab, doc links, and the
  fair-use note tying into the rate-limit card. Static content; only **Load it**
  is interactive (closes the panel and refocuses the editor).

**Phone-friendly form inputs (plan-ui-enhancements-01)**

- **No iOS zoom-on-focus:** the Price form inputs (`#price-p`,
  `#price-target-val`) and the custom-bs input (`#bs-custom`) bump to 16px on
  phones (≤575.98px) so focusing them no longer magnifies the layout. Desktop
  keeps the tighter `.78rem`.
- **No AutoFill bar:** those inputs get `autocomplete="off"` (and
  `autocorrect`/`autocapitalize="off"` on the text `#bs-custom`) to suppress the
  iOS key/credit-card accessory bar. `#bs-custom` keeps `type="text"` (it accepts
  fractions like `1/64`) and intentionally takes **no** `inputmode` so the `/`
  key stays available.

## 1.0.0a4

In progress (`dev/plan-0002.md`). Iterating on the SPA via
`hacks/mockup-08.html`, then porting agreed changes here.

**Frontend — layout (plan-0002 step 1)**

- **Tab bar reorg:** the output tabs are now `Info · Describe · Plot · Price ·
  Reins · More`, where **More** is a dropdown holding `Stats · Density ·
  (reserved)`. Stats moved off the top row to bound its width; a new **Density**
  tab is stubbed (a placeholder pane; wired to `density_df` in step 2). The tab
  wiring in `main.js` now selects triggers by `[data-tab]` rather than
  `.nav-link` so the dropdown items lazy-load like the top-level pills.
- **Phone-fit button row:** on extra-small screens the live `log2` / `bs`
  values and the *Examples* label collapse (icon/label only); the values still
  show from ≥sm and inside the dropdowns.

**Frontend — editor + data panes (plan-0002 step 2)**

- **Editor selection fixed:** dropped `drawSelection()` in favor of the
  browser's native selection. The opaque active-line highlight was painted over
  drawSelection's (behind-the-text) selection layer, so double-click-word and
  shift-arrow selections were invisible; native selection paints on top.
- **Real kill/yank:** CM's bundled `emacsStyleKeymap` binds Ctrl-K to a
  delete-only command and leaves Ctrl-Y unbound. Added a small kill-ring so
  Ctrl-K stores (line-end or active selection) and Ctrl-Y yanks.
- **↑/↓ history:** plain Up/Down now navigate build history at the buffer edges
  (and no longer reset the history cursor), matching the feedback-line hint;
  Ctrl-↑/↓ still work mid-buffer.
- **Density pane** (under **More**): wired to `density_df` with the SPA default
  `loss · p_total · F · S`, `nonzero` (p_total>0) filter, and a ~300-row
  downsample; full frame via the CSV button.
- **bs window pane** (under **More**): the bucket/window estimator summary
  (`_bs_window_df`), with the `selected` row marking the chosen grid.
- **Example standardization:** picking an Example now runs it through
  `format_program` (new `POST /v1/decl/format`) so the editor shows canonical
  DecL; the raw text shows instantly and is replaced when the format returns.
- **Friendly rate-limit card:** a build that hits the public demo's per-IP
  build cap (HTTP 429) now shows a warm "shared, free resource" card (with a
  Retry-After hint and a "run it locally" link) instead of a raw error.
  `ApiError` carries `retryAfter`; the card lives in `error-pane.js`.

**Backend (plan-0002 step 2)**

- `GET /v1/objects/{id}/density_df` gains a `nonzero` flag (drop zero-mass rows
  before slicing).
- `GET /v1/objects/{id}/bs_window_df` — new; serves the private `_bs_window_df`
  frame (400 when absent, e.g. on a Portfolio). Added to the `/frame/*.csv` map.
- `POST /v1/decl/format` — new; canonicalizes a DecL program via
  `aggregate.decl_writer.format_program`, echoing the input unchanged on any
  parse/format failure (best-effort, never 500s).
- **Curated Examples via env:** `AGGAPI_EXAMPLES_FILE` points the Examples
  dropdown at a custom `.agg` file (same `# A. Title` + `agg A.Name …` format),
  falling back to the bundled `spa_examples.agg`. Runtime-fetched, so swapping
  the file needs only a server restart — no SPA rebuild.

**Price tab (plan-0002 step 3)**

- New `POST /v1/objects/{id}/price` — `price_pentagon(p, ROE=coc | LR=lr)`
  returns the one-row `[L, M, P, Q, a, LR, PQ, ROE]` completion for an
  Aggregate *or* Portfolio. For a Portfolio it also calibrates distortions to
  the pentagon's CoC at the same `p` and runs `analyze_distortions(p)`,
  surfacing the `LR / P / PQ / ROE` slices of `pricing_df` (per distortion ×
  unit + total). Skipped distortions (e.g. mass/ccoc on an unbounded
  portfolio) come back as `warnings`, not errors.
- The **Price** tab is now a live form (p + CoC/LR), replacing the
  placeholder. The pentagon renders for any object; Portfolios additionally
  show the calibrated-distortions detail (`distortion_df`, one row per
  ccoc/ph/wang/dual/tvar) directly below the pentagon, then the four stacked
  distortion tables, formatted per stat (LR/ROE as percents, P
  thousands-grouped, PQ to 3 dp). `renderFrameTable` gained an optional
  per-cell formatter. `/price` is intentionally not rate-limited.

**Build summary (plan-0002 step 3)**

- The summary line now shows the **resolved bucket size** —
  `name · kind · bs = 1/64 · mean … · CV …` (sub-unit bs rendered as a
  power-of-two fraction). `BuildResponse` carries `bs` (the library's auto-pick
  when the request said "auto").
- A **timing sub-line** under the summary: `Calculated aggregate in 0.000
  seconds` (or "Loaded … from cache"), from the existing `elapsed_ms`.

**Frontend — mobile (plan-0002 step 2)**

- **No more iOS zoom-on-tap:** the editor text is bumped to 16px on phones
  (≤575px) so Safari stops magnifying the page when the editor is focused;
  desktop keeps 14px.
- **Tab row fits a phone:** the output pills get tighter padding on ≤575px so
  `Info · Describe · Plot · Price · Reins · More` stays on one line.
- **Editor floor of ~3 lines:** the editor never shrinks below ~3 text lines
  (`min-height: 4.5em`, font-relative) and grows with content as before.
- **No iOS AutoFill bar:** the editor's contenteditable is marked
  `autocomplete/autocorrect/autocapitalize=off, spellcheck=false`, which (on
  iPhone) suppresses the Passwords/Payment accessory bar above the keyboard and
  stops autocorrect mangling DecL keywords.
- **Undisclosed example browsing:** **Alt-↑/↓** steps through the whole example
  library into the editor (format-standardized, wrap-around), seeded from
  `/v1/examples` — separate from build history, not shown in the UI.

## 1.0.0a3

SPA editor fix and look-and-feel redesign (`dev/plan-ui-enhancements.md`). The
DecL playground now mirrors the **archivum** visual language (one UI font,
dense booktabs tables, blue accent, sticky header) and a `nav-pills` tabbed
output. Backend grows native plotting and per-tab data endpoints.

**Frontend**

- **Tamed autocomplete:** completion is now manual-trigger only
  (`activateOnTyping: false`); the per-keystroke `/v1/decl/complete` round-trip
  is gone (`completion.js` only calls the network on an explicit Ctrl-Space).
  This restores smooth typing, selection, and clipboard behavior.
- **Emacs editing keys:** optional `emacsStyleKeymap` (Ctrl-A/E/K/Y/N/P/F/B/D)
  behind a feedback-line switch, swapped at runtime via a CM6 `Compartment` and
  persisted in `localStorage`.
- **Redesign:** rebuilt `index.html` + `styles/site.css` from
  `hacks/mockup-07.html` — header with logo + versions, rounded editor box with
  focus glow and clear-X, mono feedback line, `Build / Examples / log2 / bs`
  button row, a one-line **build summary** (`name · kind · mean · CV ·
  validation`, overflow-only ⌄ expander), and the `Info · Describe · Plot ·
  Stats · Reins · Price · More` tab bar. Tabs fetch their data lazily and cache
  per built object. Price / More are placeholders.

**Backend**

- **Native plot:** `GET /v1/objects/{id}/plot` defaults to `kind=native`,
  rendering the object's own multi-panel `.plot()` figure (captured from
  `obj.figure`). The legacy `density|cdf|qq|kappa` single-panel renderers are
  retained for backward compatibility.
- **Reinsurance endpoints:** `reins_description` (text block, `available` flag),
  `reins_describe`, `reins_stats_df`, and `reins_density_df` (the density frame
  is filtered to `p_total > 0` then downsampled to ~20 rows for preview). All
  getattr-gated → a clean 400 ("no reinsurance on this object") rather than 500.
- **CSV download:** `GET /v1/objects/{id}/frame/{which}.csv` returns the full
  frame (describe / stats_df / density_df / reins_*) for "save the real data".
- **Build summary fields:** `BuildResponse` now carries `mean`, `cv`, and
  `validation` (from `agg_m` / `agg_cv` / `explain_validation()`) for the SPA's
  one-line summary.

**Notes**

- The "sev stats" sub-button was dropped: no clean `sev_stat_df` accessor exists
  upstream; the Stats tab shows `stats_df` (which already carries the Freq / Sev
  / Agg breakdown). Revisit if a dedicated severity-stats view is wanted.
- The SPA bundle now vendors Bootstrap Icons via npm (no runtime CDN).

## 1.0.0a2

Bootstrap the standalone package (`dev/plan-0001-bootstrap-standalone.md`). The
1.0.0a1 verbatim copy now imports, runs under uvicorn, serves the SPA, and
passes the suite.

- Wired the `aggregate` dependency to a local editable checkout
  (`[tool.uv.sources]` → `../aggregate_REFACTOR`), where the `parser_errors` /
  `parser._PARSER` internals the api needs live.
- Rewrote the `aggregate.api` → `aggregate_api` self-references: the uvicorn
  target in `__main__.py`, the OpenAPI `version` in `app.py`, the test imports
  (`conftest.py`, `test_objects.py`, `test_cors.py`), and cosmetic docstrings /
  comments across the package.
- **Version reporting:** `GET /v1/health` and `GET /v1/meta` (and the OpenAPI
  `version` field) now report the api's own version, plus a new
  `aggregate_version` field carrying the wrapped library version.
  `HealthResponse` / `MetaResponse` gained the `aggregate_version` field.
- Pointed the web build output at the renamed package: `web/package.json`,
  `web/vite.config.js`, and the `scripts/build-web.{ps1,sh}` headers now target
  `src/aggregate_api/static/`.
- **Parse-error path fix:** tracked an upstream `aggregate` change — a DecL parse
  failure now attaches its structured `ErrorReport` as `exc.report` and raises
  with `from None` (empty `__cause__`) rather than chaining the Lark
  `UnexpectedInput`. `routes/objects.py` now recognizes a parse error by either
  convention, so parse errors again audit as `parse_error` and return HTTP 422
  with the structured report (was misclassifying them as `build_error` with a
  flat string body).

## 1.0.0a1

Initial extraction and scaffolding.

- Extracted the FastAPI service and web SPA verbatim from the `aggregate` repo
  (last good state: commit `6f828ce`, before the `473bcd8` deletion) into a
  standalone project.
  - Python backend: `src/aggregate_api/` (was `src/aggregate/api/`) and its
    `routes/` + committed `static/` icons.
  - Web SPA: `web/` (Vite + Bootstrap 5 + CodeMirror 6), verbatim.
  - Tests: `tests/` (was `tests/api/`), verbatim.
  - Build scripts: `scripts/build-web.{ps1,sh}`, verbatim.
- Added project scaffolding: `pyproject.toml` (package `aggregate_api`, console
  script `aggregate-api`, `aggregate` as a dependency), `.gitignore`,
  `README.md`, `CLAUDE.md`, this `CHANGELOG.md`, and `dev/TODO.md`.

**Not yet runnable.** This release is a faithful copy in the new layout; the
package directory was renamed to `aggregate_api` but file *contents* are
unchanged, so internal `aggregate.api` self-references and the web build's
output path still point at the old location. `dev/plan-0001-bootstrap-standalone.md`
makes it import, run, and pass tests (→ 1.0.0a2).
