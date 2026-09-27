# Plan, UI round 9: five punch-ups from kicking round 8's tires

Status: ruled 2026-09-27, from `1.0.0a158`. Three phases, three bumps.

The author read the running app after `dev/done/plan-ui-round-8.md` landed and
reported six things. The sixth, the chart control strip, is deferred to its own
plan: it is a layout question with real design choices in it and it does not
belong in a batch of fixes. What is here is the other five, two of which are
bugs with proven causes and three of which are small rulings.

Read in this order. Phase 1 is the urgent one.

| phase | bump | what |
|---|---|---|
| 1 [strip fold] | a159 | the status strip's fold is unreachable, so warnings, notes, tags and derivation sentences are all hidden |
| 2 [grid formats] | a160 | the interactive table view throws on any `g` format spec, which is most of them |
| 3 [three rulings] | a161 | More leads with Tail behavior; Quick Re names the amounts that collide; the control band loses its tint |

---

# Phase 1 [strip fold], 1.0.0a159

## The complaint

"The new status bar: I thought we'd get a `[More v]` for the notes (near the
end). But that is not appearing? Also we are not getting the error / warning
messages."

## What is wrong

a158 gave `#summary-more` a real job and hid the note slot behind it. The button
cannot appear, so the slot cannot be opened, so **everything in it is
unreachable on a built object**.

Two lines, in two files, and either one alone is enough to cause it.
`web/src/styles/site.css` ends the base rule with `display: none`:

```css
.summary-more {
    flex: 0 0 auto; ... white-space: nowrap; display: none;
}
```

and `syncSummaryMore` in `web/src/main.js` reveals the button with

```js
more.style.display = '';
```

Clearing an inline value does not show an element. It falls back to the
stylesheet, which says `none`. So the chevron is invisible in every state, and
because `.status-strip.foldable .summary-note { display: none }` is lifted only
by `.summary.expanded + .summary-note`, and `expanded` is set only by that
button's click handler, a reader can reach none of the four tenants of the note
slot:

- library warnings off the build (`_note.warnings`)
- the derivation sentence Sharpen, Hints and P&L write (`noteDerivation`)
- the program's own `tags{}` chips
- the program's own `note{}`

The api is fine and was checked: a build on a grid too coarse for its severity
returns a full `warnings` array, and `note` / `tags` come through verbatim. The
regression is entirely in the page.

This is also why phase 2 of round 8 could pass its gates. Its own execution
notes record that the five acceptance states were never walked in a browser, and
items 2, 3 and 4 of that list are exactly the ones this would have failed.

## The change

1. **`site.css`**: drop `display: none` from the `.summary-more` rule and add
   `.summary-more[hidden] { display: none; }` beside it. The attribute is the
   honest carrier of "not now", and an explicit rule means the state does not
   depend on the UA sheet losing a specificity race with `flex: 0 0 auto`.
2. **`main.js`**, `syncSummaryMore`: `more.hidden = !folds`, replacing both
   `more.style.display` assignments. `hidden` and `aria-expanded` then move
   together in one function, which is what the control already wanted.

Nothing else in the fold changes. The order inside it, the count on the
chevron, the sticky `expanded`, the `.foldable` keying that keeps an unbuilt
example's caption open: all of that is implemented as round 8 specified and was
read against the code before writing this.

## Acceptance, phase 1

Walk round 8's own five states, which is what was never done:

1. Clean build, nothing declared: one line, no verdict word, green bar, clock at
   the right, **no chevron**.
2. Clean build with `note{}` or `tags{}`: `note ▾` appears. Press to open, press
   to close.
3. Warned build (`agg Probe 10 claims sev lognorm 100 cv 8 poisson` warns and
   fails its mean): ground tinted, verdict after the name, chevron reads
   `1 warning` in amber, and opening it shows the library's sentence.
4. Press Sharpen or Hints: the derivation sentence is in the fold, under any
   warnings.
5. Pick an example from the menu and do not build: its caption is visible with
   no interaction, and there is no chevron.

---

# Phase 2 [grid formats], 1.0.0a160

## The complaint

"Ctrl+Shift+U cycles around html table, html+full precision, and the csv-grid
interactive display. I like that cycle. But the csv-grid does not always work.
E.g. it works for Overview to Summary but not Overview to Validation."

## The cause, proven

`csv-grid`'s format-spec parser accepts five presentation characters and two
named specs, and `g` is not among them
(`src/grid/util.js:56` in `V:\dev\csv-viewer`, `dist/csv-grid.es.js:418` as
installed):

```js
const m = /^(,)?(?:\.(\d+))?([fd%es])$/.exec(spec);
if (!m) throw new Error(`CsvGrid: unrecognized format spec '${spec}'`);
```

`greater_tables`' `irToGridInput` maps an IR column format of
`{kind: 'gen', digits: N}` to `.Ng`, which is the natural spelling and the one
Python would use. So every exhibit column the library resolves as "general"
poisons the whole grid: `parseFormatSpec` is called from `_install`, inside the
constructor, over every column, so one bad spec means no table at all.

Measured on the real documents, insurer perspective, which is what the SPA asks
for by default:

| leaf | formats handed to CsvGrid |
|---|---|
| Overview / Summary | `,.2f  ,.2f  .1%  .3f  ,.2f  ,.2f  ,.2f` |
| Overview / Validation | `,.2f  ,.2f  **.5g**  .1%  .1%  **.5g**  .3f  .3f` |

Summary carries no `g` and works. Validation's two `Err` columns are `.5g` and
throw. In the **raw** perspective Summary is `.7g` too, so there the interactive
view fails on nearly everything, which is the "does not always work".

**A second, smaller bug on the same path.** In `mountTable` the mount happens
inside `irToGrid(doc).then((g) => asGrid(...))` with no `.catch`, so a throw from
the CsvGrid constructor becomes an unhandled rejection. `unavailable()` never
runs and the pane goes blank instead of saying "This table could not be
rendered". The reader is told nothing at all.

**Why no gate caught it.** `dev/scripts/check-adapter.mjs` compares a document's
cells against the same frame's cells after csv-grid's own coercion, which is the
right question for that gate and does not touch `formats`. A spec csv-grid cannot
parse is invisible to every harness in the repo.

## The change, in three places

### [upstream] csv-grid learns `g`

The fix belongs where the grammar lives, not in a shim here: a local rewrite of
`.Ng` into something else would have to guess fixed against exponential per
column, and the two views would then disagree about a printed digit, which is the
one thing the single-document design exists to prevent.

`V:\dev\csv-viewer` is the author's own repo, its own plan doc is
`dev/plan-3.10-g-format.md` there, and it ships version 3.10.0 with:

- `g` added to the presentation characters in `parseFormatSpec`
- a `case 'g'` in `formatWithSpec` following Python's `%g`: `N` significant
  digits, exponential when the exponent is below -4 or at least `N`, trailing
  zeros dropped, two-digit exponent so the grid prints the `8.8689e-06` the
  static walker prints, and the leading `,` grouping the integer part
- smoke-test cases, the three doc sites that spell the grammar out, and the
  three-place version bump that repo's rules require

### [consumer] the pin

`web/package.json` pins the dependency by commit:

```
"csv-grid": "github:mynl/CSV_Viewer#01a9773cfc6c7ac64d8a99133c23deba2c1f9263"
```

**That pin can only move once csv-viewer 3.10.0 is pushed**, because npm fetches
it from GitHub and not from the sibling checkout. No path source is added for
this: `greater-tables` stopped being one at a53 and a second one would be a
regression in what a fresh clone can do. So the pin moves in a follow-on one-line
bump, after the author pushes. Until then the interactive view stays broken for
`g` columns and now says so out loud, which is the rest of this phase.

### [here] say so, and gate it

1. `web/src/main.js`, `mountTable`: a `.catch` on the grid path, so a constructor
   that throws lands in `unavailable()` and the pane carries "This table could
   not be rendered" instead of nothing. The console still gets the error, which
   is where the spec text is.
2. `dev/scripts/check-adapter.mjs`: validate every format spec the adapter emits
   against csv-grid's own `parseFormatSpec`, imported from `web/node_modules`.
   Ten lines, and it is the regression test for this bug on the side where it was
   felt. It fails today, against the pinned csv-grid, and passes the moment the
   pin moves, which makes it the check that says whether the pin move worked.

## Acceptance, phase 2

- In `V:\dev\csv-viewer`: `npm test` green, and `node -e` on the rebuilt
  `dist/csv-grid.es.js` formats `.5g` of `8.868896852698427e-06` as
  `8.8689e-06`, `.7g` of `1000.008868896194` as `1000.009`, and `,.7g` of
  `1234567.8` as `1,234,568`.
- Here: `node dev/scripts/check-adapter.mjs` reports the unparseable specs by
  name, rather than reporting nothing.
- Here: with the pinned csv-grid still in place, Overview / Validation under
  Ctrl+Shift+U shows "This table could not be rendered" rather than a blank.
- After the pin moves: Validation, Summary and Return periods all render in the
  interactive view, in both perspectives.

---

# Phase 3 [three rulings], 1.0.0a161

Three unrelated small changes, batched because each is a handful of lines and
each was ruled in the same reading.

## 3a. More leads with Tail behavior

**The complaint:** "Under More, I do not like having density be the first tab. It
is a heavy load. Which subtab would you put first and why?"

Density is the heaviest thing in the app: a bulk frame on the permanent grid
path, a data dump rather than a diagnostic, and it is what the group loads when
you arrive.

**Tail behavior leads**, on three grounds. It is the cheapest (one small
exhibit). `nav.js`'s own comment says it "holds before any grid is chosen", so it
is logically prior to everything else in the group. And that same comment already
calls Tail behavior, Approximation and Window "one run"; leading with it means
the group opens on that run instead of interrupting it.

New order in `NAV_GROUPS.more.leaves`, which is the order the row draws in:

```
Tail behavior   Approximation   Window   Dependency   Sharpen   Density   Narrative
```

Density goes second to last, beside Narrative: the two things in the group that
are not diagnostics. Nothing else moves. Not Dependency first (a bivariate only,
so it greys for most objects) and not Narrative (true of everything, but it is a
footnote).

Landing is safe with no other change: `activeLeaf` in `nav.js` falls through to
the first *available* leaf, so no object can land on a greyed tab.

## 3b. Quick Re names the amounts that collide

**The complaint:** "Re, Quick Re, Agg (and sometimes occ) we get the message
'detachment has to sit above the attachment'. That can appear at times when it is
mystifying. Is it a matter of *strictly* above? Ah, no, the agg message appears
if there is agg re already there and you don't change the percents."

The test in `composeCession` is `!(detachAmount > attachAmount)`, and **strict is
correct**: a zero-width layer cedes nothing and `0 xs a` is a clause that says
nothing. The message is what is wrong. It states a rule the reader has not
broken on purpose and gives no fact they can act on.

Two different things reach it, and neither is explained. Measured against the API
with the row's own defaults (share 100%, attach 50%, detach 95%, aggregate
basis):

```
gross:              attach(50%) = 844    detach(95%) = 2,240   width 1,396
after one cession:  attach(50%) = 844    detach(95%) =   848   width     4
```

An earlier cession leaves an atom at its attachment, and both default
probabilities then read inside that atom. That is the author's own diagnosis,
confirmed. Separately, `/quantiles` snaps to three significant figures, so two
distinct quantiles can land on one value at six or seven figures (1,234,000 and
1,234,500 both snap to 1,230,000) and produce the same refusal on a gross object
with nothing ceded.

**The change:** name the resolved amounts, and tell the two cases apart. In
`composeCession`, replacing the single literal:

- inverted: `detach 20% is 500 here, below attach 50% at 844`
- equal: `attach 50% and detach 95% both read 844 on this object, so the layer
  has no width`

Both spell the amounts with `layerNumber`, the same function that would have
spelled them into the clause, so the numbers in the refusal are the numbers the
clause would have carried. The field text is quoted as typed, so a reader sees
their own `50%` rather than a fraction. The sentence is written once and used by
both callers, the preview line and the button, which already share the throw.

Not done here, and worth a ruling of its own: whether an already-net object
should resolve percentages against its **subject** rather than against the net,
which would make the second cession behave like the first.

## 3c. The control band loses its tint

**The complaint:** "Did I agree to putting the lede in a box? I don't remember
that. I don't think it is a good move."

For the record, the lede is not in the box. `#reins-desc` sits above the band,
per round 8 section 1d, and what was gathered inside was the sentence that
explains the control: `#qr-preview`, the four Pricing preview lines and
`#bounds-hint`. The box itself is round 8 section 1b and was ruled on.

What is wrong is the **fill**, and round 8's own argument for it is where to look.
It said the box follows `.editor-box`, "the page already uses a box to mean you
provide something here". It does not:

| element | ground |
|---|---|
| `.editor-box` (an input) | `#fff`, `1px solid var(--line)`, soft shadow |
| `.status-strip` (a readout) | `var(--soft)`, `1px solid var(--line-2)` |
| `.control-band` (an input) | `var(--soft)`, `1px solid var(--line-2)` |

The band took the readout's ground, character for character, so it reads as
something to be read rather than something to be filled in, and the page now
meets three soft-tinted panels on the way down.

**The change:** `.control-band` gets `background: #fff` and
`border: 1px solid var(--line)`, the editor's ground and its hairline. No
shadow: the editor's is part of its focus affordance and a static band has none.
On the white page the band is then an outlined region rather than a filled one,
which is the minimum ink that still gathers the preview line in. Everything else
about the band stays: the label, the radius, the `--tabpad` margin, the rhythm
tokens.

Two alternatives were weighed and not chosen. Dropping the box entirely leaves
the preview line floating again, which is what round 8 fixed. Variant B, a
hairline above the pane, cannot gather the preview line in at all, which is why
round 8 rejected it.

## Files, phase 3

- `web/src/nav.js`: the leaf order inside `more`.
- `web/src/main.js`: the refusal sentence in `composeCession`.
- `web/src/styles/site.css`: the two declarations on `.control-band`, and its
  comment, which currently cites `.editor-box` for a fill it did not have.

## Acceptance, phase 3

- Build a portfolio, press More: the row reads Tail behavior first and lands on
  it; Density is second to last and still draws when picked.
- Quick Re on a gross object with a deliberately inverted pair: the message names
  both amounts. Cede the defaults, then press Add re again without touching the
  boxes: the message names the one amount both probabilities read.
- The control band is white with a hairline on all six hosts (Re, the four
  Pricing leaves, Bounds), and the preview line is still inside it.
- `node dev/scripts/check-nav.mjs` clean, since the leaf order moved.

---

# Out of scope

- **The chart control strip**, the author's item 1. Its own plan: three
  unenclosed rows stand above every canvas (tools, readout, then the drawing),
  and `.exhibit-group-panel`'s `flex: 1 1 0` centering promises a positional
  correspondence to the panels that the document group's width makes impossible.
  The candidate moves are labeling every panel group rather than only the stacked
  and towered ones, folding the rarely-touched controls behind one menu, and
  giving the strip the control band. Not started here.
- Whether Quick Re should resolve probabilities on the subject of a cession (3b).
- `include_raw='data'` against `irToGridInput`, the cousin of phase 2 already
  written up in `dev/TODO.md`.

# Housekeeping, each phase

Per `CLAUDE.md`: bump `pyproject.toml`, write the `CHANGELOG.md` section, `uv
sync --extra dev`, `.\scripts\build-web.ps1` (every phase moves `web/`),
`uv run pytest`, `cd web; npm test`, one commit per bump carrying source, tests,
`CHANGELOG.md`, this plan doc, `dev/TODO.md` and `uv.lock`.

csv-viewer is a separate repo with its own rules: its own plan doc, its own
three-place version bump, `npm run build` for the committed `dist/`, and its own
commit. Neither repo is pushed.

---

# Execution notes

Written as the work ran.
