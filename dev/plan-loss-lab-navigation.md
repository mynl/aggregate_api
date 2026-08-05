# plan-loss-lab-navigation: the aggregate Loss Lab navigation

Status: **draft, parked**. Nothing here starts until the `aggregate` plots workstream settles; the author runs the api as it stands in the meantime. Target 1.0.0a42 through 1.0.0a48, one version bump per stage.

Depends on `plan-derived-programs.md` in the `aggregate` checkout, which supplies `sharpen_program`, `pnl_program` and `reins_program`. That plan is independent of the plots workstream and can land first.

The app is renamed and its navigation is rebuilt around what an object can actually answer. Six groups replace the current six tabs, each group carries its own sub-tab row, every leaf greys out from a capability payload the library computes rather than from a hard-coded table in JavaScript, and three buttons next to Build derive a new DecL program server side instead of mutating an object in place.

## Why

Three separate irritations, one answer.

The Overview crams a chart and two tables into one pane and reads as clutter, the standalone Plot tab duplicates part of it, and the log2 and bs dropdowns have never been used. That is chrome nobody wants sitting where the reading happens.

The tab set is authored twice: once as markup in `web/index.html`, and again as `NA_TABS_BY_KIND` and `NA_MORE_BY_KIND` in `web/src/main.js:370` and `main.js:436`, which say what each kind cannot answer. The library now knows the same thing properly, through `available_exhibits(obj)` and `available_charts`, and `dev/exhibits-and-charts.md` states the invariant: capability is derived, never declared twice. The app is the one place still declaring it twice.

Reinsurance, wrapping in a P&L, and moving to a better grid are all things a user wants to do to an object they have already built. Each one is a DecL question, so each one belongs to whatever holds the grammar, which is the library. None of them belongs in JavaScript, and none of them should mutate an object under a cached id.

## The shape

| group | applies to | sub-tabs |
|---|---|---|
| Overview | everything | Plot, Summary, Tail |
| Economics | PnL | Ledger, Ratios, Waterfall |
| Reinsurance | an aggregate carrying a cession, plus the entry box for one that does not | summary, stats, density, plot (placeholder) |
| Pricing | aggregate, portfolio | Determine, Evaluate |
| Bounds | aggregate, portfolio | Bounds, PricingBounds, AllocationBounds |
| More | everything | Validation, Stats, Density, Window, Dependency, Narrative |

Action row, next to Build: Examples, Sharpen, PnL, Reset.

Page-wide preferences, in the header menu: Perspective (Insurer default, Raw), Tables (Static, Interactive), then the existing Help, downloads and About.

Retired: the standalone Plot tab, the log2 dropdown, the bs dropdown, and the `More` view named "Info (raw)", which is absorbed into Narrative.

## Principles this plan holds to

**The nav skeleton is editorial, the leaves are derived.** Which groups exist, what they are called and what order they sit in is a judgment about how insurance work proceeds, and the app authors it. Whether a given leaf is live for the object in front of you is a fact, and the library computes it. A new library exhibit therefore appears in the app with no JavaScript edit, which is the whole point of the exhibit registry.

**Nothing is hidden, everything greys.** The existing house rule, extended to the sub-tab rows. The menu set never changes shape, so what an object cannot answer is visible and plainly unavailable rather than absent.

**Every derivation is a program you can see.** Sharpen, PnL and Reinsurance all return DecL text that lands in the editor. You read what was built, you can edit it, and history, sharing and rebuild all keep working. No hidden state, no object mutated behind a cached id, and no writes into the shared `Underwriter`.

## Stage 1: [Loss-Lab-Rename]

The app becomes the **aggregate Loss Lab**. Short form **aLL** is unchanged, so nothing downstream of the acronym moves. Lower-case `a` throughout, for the same reason as before: `aggregate` is the package, `Aggregate` is the class.

Touches `web/index.html` (title, meta description, the `.brand-title` line, the logo `alt`), `site.webmanifest`, `sw.js`, the About and Help leads, `README.md`, the `pyproject.toml` description, and any occurrence in `CLAUDE.md`. Prose only, no behavior change. This is the same footprint `plan-all-branding` covered at a20.

## The library dependency

The three derivations behind Sharpen, PnL and Reinsurance are grammar questions, so they are answered in the library, not here. Specified in `plan-derived-programs.md` in the `aggregate` checkout, which delivers `sharpen_program`, `pnl_program` and `reins_program`. This repo consumes them through three routes and holds no knowledge of DecL structure in JavaScript.

Two of that plan's decisions matter to the app and are recorded here so they are not rediscovered. The derived text is **self-contained**, carrying its engine inline rather than an `agg.NAME` reference, so nothing is ever written into the server's shared `Underwriter` and two users on the same hero example cannot collide. And derived object names are `NAME_PnL` and `NAME_net`, with no dots, since a dotted name reads as a builtin lookup everywhere else in DecL.

## Stage 2: [Capability-Payload]

The build response grows a capability block, and the two JavaScript tables die.

The block carries the exhibits this object can serve with their perspectives, straight off `available_exhibits`, the charts it can serve off `available_charts`, and a handful of flags the app-only leaves need: `kind`, `has_reins`, `has_premium`, `can_sharpen`, `is_tower`. Inline on the build response rather than a second request, because the nav has to paint immediately and a round trip per build to learn the menu is a round trip too many.

`/objects/{oid}/exhibits` already exists and already reports exactly this for exhibits (`routes/objects.py:1603`), so this is that payload lifted into the build response, not a new computation. The exhibit route itself already takes `perspective` and ETags on the exhibit hash, so perspective-correct caching needs nothing.

Three kinds of leaf come out of this, and the distinction is worth writing down because it decides where a future leaf goes. An **exhibit leaf** lights from `available_exhibits` and needs no app change to appear. A **chart leaf** lights from `available_charts`. An **app leaf** (Narrative, the reinsurance entry box, the Bounds forms, Pricing's two modes) is gated on the flags, because it is a piece of app behavior rather than a library document.

Deletes `NA_TABS_BY_KIND` and `NA_MORE_BY_KIND`.

## Stage 3: [Navigation-Groups]

The six groups, their sub-tab rows, and the phone behavior.

**Layout.** The group row is a horizontally scrollable pill strip with a soft fade at each edge so it reads as scrollable, not clipped. The sub-tab row beneath it scrolls the same way. No Bootstrap navbar collapse, deliberately: collapsing the nav would put a second hamburger in a header that already has one, and a dropdown hides which group you are in and adds a tap to every move. One tap to any group at any width is worth a small horizontal scroll on a narrow phone.

**Overview** splits the current landing pane into three. Plot serves the object's native plot, Summary serves `summary_df`, Tail serves `tail_df` and `tail_behavior` as two blocks in one pane. The standalone Plot tab goes.

**Economics** is PnL only: Ledger is `economic`, Ratios is `economic_ratios`, Waterfall is `economic_waterfall` and lights only for a tower.

**More** is Validation, Stats, Density, Window (`bs_window_df`), Dependency (bivariate only), Narrative.

**Landing and stickiness.** The active group survives a rebuild unless it just went dark, which is today's rule and stays. Each group remembers its own last sub-tab, so stepping away from Pricing and back returns you where you were rather than to its first leaf.

**Removed knobs.** log2 and bs go. The only remaining way to pin a grid from the UI is a `hints{}` clause in the program, which Sharpen now writes for you, so this is a knob replaced by an audit rather than a capability lost.

## Stage 4: [Action-Row]

Build, Examples, Sharpen, PnL, Reset.

**Sharpen** is one request. The server builds if needed, sharpens, and returns both the rewritten program and the sharpened object's id, because `sharpen()` executes the move rather than merely recommending it. The app swaps the current object and refreshes the editor. Greyed for anything that is not an aggregate or a portfolio, and greyed again once the current program carries a no-change note, since a second audit of a confirmed grid is a slow no-op. It is the slowest button on the page, so it disables itself and shows a spinner while it runs.

**PnL** is the same mechanism against the wrap function, and lands you on Economics.

**Reset** restores the last hand-built program and its object, and greys out when nothing has been derived. One control for all three derivations rather than one per pane: at any moment you are either on your own program or exactly one derivation away from it, and Reset is the way back. It is distinct from history on Ctrl+Up and Ctrl+Down, which steps through programs you built yourself.

State this needs is small: the base program text and the base object id, set when a build comes from the editor and cleared by Reset.

## Stage 5: [Reinsurance-Entry]

Below the sub-tab row, a text box for a cession fragment and **one** button. It derives the program, fills the editor and builds, all in one step, because the editor is the preview and a separate copy button would be a second control for a thing already on screen.

The derived object is `NAME_net`. Reset from the action row takes you back to the gross object, which is why the reinsurance pane needs no reset of its own.

The pane's plot stays a placeholder until the reinsurance chart emitters land in the library.

## Stage 6: [Bounds]

The tab stops being greyed out and grows three sub-tabs against the three real classes in `bounds.py`: `Bounds`, `PricingBounds` (line 1440) and `AllocationBounds` (line 1023).

Bounds draws the envelope figure at 50 resamples. That is cheap, contrary to a worry raised and withdrawn during design: `plot_bounds_envelope(n_resamples=...)` overplots that many columns drawn from an already computed `cloud_df` at alpha 0.05, and `cloud_df` is a vectorized gather over `tvar_hinges`. The cost is constructing the `Bounds` object, and that is paid once whether you overplot fifty curves or none.

PricingBounds carries a text box taking either a unit from the current portfolio or a DecL fragment for a new line, and plots the resulting ranges. AllocationBounds is portfolio only.

If Bounds construction does prove slow on the VPS, the lever is a server-side time budget surfaced on the existing timing line, not a guess about the client's connection: what varies is server CPU, and the payload is one figure either way.

## Stage 7: [Narrative-Pane]

One pane collecting every text field the object carries: the `info` block first, then each available `*_description` and `*_explanation` under its own heading. Absorbs today's "Info (raw)" view, which stops existing separately.

## Decisions taken during design, with the reasoning

**Perspective lives in the header menu, and both table views honor it.** A concern that the interactive grid would silently show raw frames under an Insurer perspective was checked and is wrong: `mountTable` (`main.js:601`) takes one document and either walks it statically or derives the grid's input from the same bytes through `irToGridInput`, so the two views cannot disagree about a number. Two residues, both correct as they stand and neither needing work. `irToGridInput` drops hierarchy, row flags and foot rows because none of them survives a sort, so an Insurer framing that speaks through row flags reads flatter in the grid than on the page. And the bulk frames, the densities, never go near a document, so they carry no perspective, which is right because they are raw grids.

**Severities stay buildable.** A plain or discrete severity builds; a mixture already fails with `CannotBuild` and an actionable message telling you to wrap it in an aggregate. The gate exists, so nothing is needed. One nit for whoever next touches the error surface: a logger warning fires ahead of it reading "Mixed severity cannot be created, returning spec. You had [0.5, 0.5], expected 1", which is confusing for weights that do sum to one.

**Dependency goes in More, not Overview.** It is a bivariate's own question rather than part of the standard reading, so it sits with the other specialist frames.

**`tail_behavior` joins `tail_df` under Overview, Tail.** Both answer the same question and neither is large enough to want a pane of its own.

**Spelled out: Reinsurance, Pricing.** Pricing rather than Price because the group covers determining a price and evaluating one already set. Reinsurance rather than the internal `reins` because this is user-facing prose, not the Python surface, where `reins_*` stays canonical.

## Not in scope

The chart IR conversions. Overview's Plot keeps serving the per-kind SVG and each leaf swaps to a ChartDoc route as its emitter lands in the library, so this navigation work does not block on the conversion queue and the queue does not block on it.

The reinsurance plot, which stays a placeholder for the same reason.

Perspectives beyond Raw and Insurer, which are library vocabulary today and implementations later.

## Risks

The capability payload has to be right before the nav is rebuilt on top of it, because a wrong flag greys a leaf that should work and there is no way for the user to tell that from a leaf that genuinely does not apply. Stage 2 wants its own tests against one object of each kind before Stage 3 starts.

The three derived-program functions are the load-bearing piece and they live in the other repo. If they have not landed, this plan stalls at Stage 4.

Removing log2 and bs is a real capability removal for a power user who wants a specific grid without writing DecL. Judged acceptable because Sharpen now writes the clause for them and the clause is editable once written.
