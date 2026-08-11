# Changelog

Running release-notes draft for `aggregate_api`. Newest first. The cadence
mirrors the main `aggregate` project: every plan-based change bumps the
`1.0.0a*` version and adds a section here.

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
