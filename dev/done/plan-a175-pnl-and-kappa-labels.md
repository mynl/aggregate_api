# plan-a175: PnL tab labels, and the waterfall's vocabulary

**Status:** approved, not yet implemented.
**Date:** 2026-09-29.
**Repos:** `V:\dev\aggregate-api` (bumps to `1.0.0a175`) and
`V:\worktrees\aggregate_REFACTOR`, the `aggregate` library (bumps to
`1.0.0a358`).

## Goal

Five presentation changes the author asked for, in one pass. Nothing
computational moves: every number served after this plan is the number served
before it. What changes is what the columns, panels and pills are called, and
the prose that explains them.

1. The right-hand panel of Pricing / Plot is titled `The same reading as a
   share`. It becomes `Cession as share of gross`.
2. The PnL group's three sub-tabs read `Ledger  Ratios  Waterfall`. They
   are reordered and renamed (3) to become `Summary  Waterfall  Ledger`.
3. `Ratios` is relabeled `Summary`, with a new lede.
4. Waterfall gets a new lede.
5. The waterfall's two tables get shorter column headings built on a new word,
   `M01`, and their captions are rewritten to introduce it.

## Why this spans two repos

`aggregate_api` is a FastAPI service plus a vanilla-JS SPA wrapping the
`aggregate` actuarial library. It does not vendor the library; it depends on it,
as an editable path source declared in `pyproject.toml`
(`aggregate = { path = "../../worktrees/aggregate_REFACTOR", editable = true }`).

The api owns the **navigation**: which groups and leaves exist, what the pills
are called, and the one-line lede above each pane. The library owns the
**business translation**: frame column names, exhibit captions, row flags, and
chart panel and axis titles. `web/src/main.js` says so explicitly, and there is
no override layer in the api for either. `CLAUDE.md` in this repo puts it as a
rule: do not copy library internals into this repo; depend on them, and raise
anything missing or awkward as an upstream change in `aggregate`.

So items 2, 3 and 4 are api changes, in one file. Items 1 and 5 are library
changes. Because the library is an editable install, a library edit is live in
the running api on a server restart, with no re-sync and no version pin to move.

Nothing in `aggregate_api` (source, tests or SPA) references any of the column
names or panel titles this plan renames. That was checked by `rg` across
`src/aggregate_api/`, `web/src/` and `tests/`: zero hits. The api-side blast
radius of item 5 is therefore nil.

Two related facts about `aggregate`, from its own `CHANGELOG.md` policy section:

- `aggregate.charts` and `aggregate.exhibits` are **provisional** in the
  [PEP 411](https://peps.python.org/pep-0411/) sense, explicitly outside the 1.0
  API contract. Panel titles, exhibit names, captions and the chart IR document
  hash may change in a minor release with no deprecation. Item 1 and the caption
  half of item 5 sit entirely inside that surface.
- `PnL` is **stable** tier, and `walk_df` / `evaluation_df` are properties on
  it. Renaming their columns is a breaking change on a stable-tier class. It is
  permissible only because the library is still in its alpha series, where that
  promise has not yet taken effect. The CHANGELOG entry must call it out as a
  rename, in its own sentence, because it is the one fact a downstream reader
  has to act on.

## Current behavior

### The Pricing / Plot panel title

`Pricing / Plot` draws the `kappa` chart. For a `Portfolio` that is a
single-panel document (`charts/_emit_portfolio.py`). For an **occurrence
cession**, which is the case with a right-hand panel, it is the two-panel
bivariate document built by `_kappa_band` in
`src/aggregate/charts/_emit_bivariate.py`. Its panels are declared at lines 684
to 690:

```python
panels=(
    Panel(id='cession', kind='xy', x_axis='outcome',
          y_axis='cession', aspect='equal',
          title='Cession given the gross outcome'),
    Panel(id='share', kind='xy', x_axis='outcome', y_axis='share',
          title='The same reading as a share'),
),
```

The `share` panel's y-axis is separately labeled `Share of the outcome ceded`
(line 681). The SPA reads both straight off the document
(`web/src/charts/chartdoc-to-echarts.js:2472` draws `p.title`); there is no
override.

### The PnL sub-tabs

`web/src/nav.js:241-270` declares the group. Pill order is the insertion order
of the `leaves` object, read by `Object.keys`. Present state:

```js
economics: {
    label: 'PnL',
    leaves: {
        ledger:    { label: 'Ledger',    exhibit: 'economic',
                     why: 'a P&L only',
                     hint: 'the P&L sheet, line by line' },
        ratios:    { label: 'Ratios',    exhibit: 'economic_ratios',
                     why: 'a P&L only',
                     hint: 'the same sheet read as ratios' },
        waterfall: { label: 'Waterfall', exhibit: 'economic_waterfall',
                     why: 'a P&L tower only',
                     hint: 'the margin walk, gross to net; a tower only' },
    },
},
```

`hint` is the lede. `ledeFor` (`web/src/main.js:2251`) renders it as
`<b>{label}</b>: {hint}`, so the hint is the text after the colon, and no
trailing period is added. `loadExhibitLeaf` (`main.js:2287`) draws it once, at
the top of the pane, above every block of the exhibit.

`activeLeaf` (`nav.js:492`) returns the leaf the group was last left on if it
still answers, and otherwise **the first live leaf in declaration order**.

### The waterfall's columns

Built in one pass by `PnL._waterfall_frames`, `src/aggregate/_pnl.py:2100`, and
served by the `economic_waterfall` exhibit, `src/aggregate/exhibits/_pnl.py:226`,
as two blocks. `WATERFALL_RETURN_PERIOD` is `100` (`_pnl.py:784`) and is bound
to `t` in both files.

```python
walk_df = pd.DataFrame(
    walk, index=idx,
    columns=['M', f'M @ 1-in-{t} standalone',
             f'M @ 1-in-{t} diversified'])
evaluation_df = pd.DataFrame(
    evaluation, index=idx,
    columns=['Premium spent', 'Margin spent', 'CR', 'M / SD',
             'M / capital standalone', 'M / capital diversified'])
```

The last two columns of `evaluation_df` come from `_capital_ratio`
(`_pnl.py:791`), which is `M / -M_100`: the 1-in-100 margin is normally
negative, so its negation is the capital that state calls for and the quotient
reads as a return on it. `NaN` where no capital is called for.

## The change

### [kappa] the share panel's title

`src/aggregate/charts/_emit_bivariate.py:689`, one string:

```python
Panel(id='share', kind='xy', x_axis='outcome', y_axis='share',
      title='Cession as share of gross'),
```

`tests/test_chart_kappa.py` asserts panel **ids**, axes and aspect, never
titles, so nothing there moves. No golden file or docs page carries the old
string; `rg` over `tests/`, `docs/`, `src/` and `dev/` finds it only at its
declaration.

### [kappa-axis] the y-axis label, optional

With the panel titled `Cession as share of gross`, its y-axis label
`Share of the outcome ceded` (line 681) says nearly the same thing directly
under it. Recommended: shorten the axis to `Share ceded`. This step is
**discretionary and severable**; strike it and the plan still stands. It is
flagged because the duplication is only visible once item 1 lands.

### [nav] reorder, relabel, and the two ledes

`web/src/nav.js:241-270`. The whole `leaves` block becomes, in this order:

```js
leaves: {
    ratios: {
        label: 'Summary',
        exhibit: 'economic_ratios',
        why: 'a P&L only',
        hint: 'expected premium, loss, expense and margins, and '
            + 'corresponding ratios',
    },
    waterfall: {
        label: 'Waterfall',
        exhibit: 'economic_waterfall',
        why: 'a P&L tower only',
        hint: 'the margin (M) and standalone and diversified 1-in-100 '
            + 'margin walk over the whole tower',
    },
    ledger: {
        label: 'Ledger',
        exhibit: 'economic',
        why: 'a P&L only',
        hint: 'the P&L sheet, line by line',
    },
},
```

**The keys do not change.** `ratios` stays `ratios` even though its label is now
`Summary`. The keys appear in `data-tab` attributes, the pane ids, the `LOADERS`
map (`main.js:1364-1369`), the stored per-object view state and any link already
shared. A label change costs nothing; a key change orphans saved state and
breaks existing links, for no gain.

Two consequences, both intended and both worth stating so a reviewer is not
surprised:

- **A freshly built PnL now opens on Summary, not Ledger**, because
  `activeLeaf` falls back to the first live leaf and all three gate on an
  exhibit that a PnL publishes. That is the point of putting Summary first. A
  PnL the reader has already visited still returns to wherever they left it.
- **Two pills are now called Summary**, this one and `overview:summary`. They
  are in different groups and the group pill disambiguates them. Accepted.

There are two stale mentions of the old label in comments, neither
user-visible. Update both while here, since they are the map a later reader
follows: `web/index.html:122` (`PnL Ledger / Ratios / Waterfall`, inside the
Perspective menu comment) and `web/src/main.js:1811`.

### [walk] the waterfall's column headings

`src/aggregate/_pnl.py:2134-2143`. Keep the labels derived from
`WATERFALL_RETURN_PERIOD` rather than writing `01` in by hand, so they cannot
drift from the constant:

```python
idx = pd.Index(index, name='Step')
t = WATERFALL_RETURN_PERIOD
m = f'M{100 // t:02d}'          # 'M01' at t=100, the way P01 reads
walk_df = pd.DataFrame(
    walk, index=idx,
    columns=['Margin', f'{m} standalone', f'{m} diversified'])
evaluation_df = pd.DataFrame(
    evaluation, index=idx,
    columns=['Premium spent', 'Margin spent', 'CR', 'M / SD',
             f'M / {m} standalone', f'M / {m} diversified'])
```

`M01` is chosen to read as "M at the 1st percentile", which is the convention
the format sheet already uses for `P01` and `P99`. It is the right anchor:
margin is a profit, so its adverse tail is the low one.

Also update the `M @ 1-in-{t} diversified` lookup at
`src/aggregate/exhibits/_pnl.py:238`, which is how the exhibit detects that no
conditioning was possible, and the `Returns` sections of the `walk_df` and
`evaluation_df` docstrings (`_pnl.py:2162-2172` and `2209-2221`), which name
every column.

### [captions] the two footnotes

`src/aggregate/exhibits/_pnl.py:241-259`. `M01` is a new word, so the walk's
caption has to introduce it, and the evaluation caption then leans on that
rather than repeating it. Both stay one paragraph.

```python
walk_caption = (
    f'The margin walk in currency: gross, what each layer cedes, and the '
    f'closing net. Margin is the expected result and {m} is the result in '
    f'the 1-in-{t} state, which measures the capital that state calls for. '
    f'The diversified column conditions on the whole book landing at its '
    f'own 1-in-{t}, so it foots down the walk exactly. The standalone '
    f'column is each step\'s own 1-in-{t}, the capital it would call for '
    f'alone; tail measures do not add, so it does not foot, and the gap '
    f'between the two columns is the diversification benefit.')
```

The existing `if not diversified_available:` rider is unchanged.

```python
evaluation_caption = (
    f'The same walk read as ratios. Premium and margin spent are against '
    f'the gross block. The last two columns are the return on the capital '
    f'a 1-in-{t} outcome calls for, on each of the walk\'s two readings of '
    f'that state; they are blank where the step calls for no capital, '
    f'which is what a purchased layer does in the adverse state, and there '
    f'the diversified column is the more meaningful of the two.')
```

**A sign is deliberately glossed.** The ratio is `M / -M01`, not `M / M01`:
`_capital_ratio` negates, because `M01` is normally negative and the capital is
its negation. The heading says `M / M01` anyway, on the author's explicit
instruction, the reasoning being that a reader of a capital return does not need
the minus spelled into the header. The captions are therefore written to be
**true as stated** without asserting the identity: the walk caption says `M01`
*measures* the capital, and the evaluation caption says the columns are *the
return on the capital* rather than the quotient of the two headings.
`_capital_ratio`'s own docstring keeps the exact `M / -M_100` statement, which
is where a reader chasing the arithmetic will land. Do not "fix" the heading to
`M / -M01` in implementation; that decision was taken and closed.

### [formats] the format sheet

`src/aggregate/formats/formats-raw.yaml`. `M: money` at line 71 is an entry
keyed on the column label, so renaming `M` to `Margin` drops that column out of
its declared reading and onto inference. Add `Margin: money` beside it. This is
required, not cosmetic: without it, under the INSURER perspective, the first
column of the walk would read to a different precision from the two beside it.

`M` itself stays in the sheet. It is still the margin column of
`economic_ratios_df`'s amounts block (`exhibits/_pnl.py:173`).

### [formats-extra] declare the four renamed readings, optional

`tests/test_exhibits.py` runs a two-sided gate over every float column of every
exhibit. A served label with no declared reading and no exemption fails; an
exemption for a label no longer served also fails, as stale
(`test_exhibits.py:310-319`). The exemption list is `PENDING_VOCABULARY`
(line 251), described in its own comment as a punch list. Four of its entries
are exactly the labels this plan renames:

```
'M / capital diversified', 'M / capital standalone',
'M @ 1-in-100 diversified', 'M @ 1-in-100 standalone'
```

So the gate forces a choice, and either arm is the same amount of work:

- **Minimal.** Swap the four names in `PENDING_VOCABULARY` for `M01
  standalone`, `M01 diversified`, `M / M01 standalone`, `M / M01 diversified`.
  The rename is then rendering-neutral: every column reads exactly as it does
  today.
- **Recommended.** Declare them instead, in `formats-raw.yaml` beside
  `Margin`: `'M01 standalone': money` and `'M01 diversified': money`, then
  `'M / M01 standalone': ratio` and `'M / M01 diversified': ratio` in the P&L
  ratios block near `'Premium spent'`. Delete all four old entries from
  `PENDING_VOCABULARY` and add none. Four punch-list items retire, and the
  walk's three columns finally read alike.

The recommended arm **changes rendering**: the two `M01` columns go from
inferred to `money`, and the two ratio columns from inferred to `ratio`
(`.1%`), which is the reading `ROE` and `coc` already take and which is what a
return on capital is. That is an improvement beyond the literal ask, which is
why it is a separate, severable step. If the author wants the diff to be a pure
rename, strike this step and take the minimal arm.

### [tests] the library's own assertions

Four sites in `V:\worktrees\aggregate_REFACTOR\tests\`, all mechanical:

- `test_exhibits.py:251-260`, `PENDING_VOCABULARY`, per the step above.
- `test_exhibits.py:248-250`, the comment above it, which quotes
  `M @ 1-in-100 diversified` as an example.
- `test_exhibits.py:961-962, 976-977, 991-992`: three tests indexing the walk
  and evaluation frames by column name. `walk['M']` becomes `walk['Margin']`
  in `test_waterfall_diversified_foots_and_standalone_does_not`.
- `tests/data/exhibit_snapshots.json`, which pins captions **and** column
  labels for every (exhibit, perspective, kind) case. **Do not hand-edit it.**
  Regenerate with `uv run python tests/capture_exhibit_snapshots.py` and read
  the diff: it should show only the waterfall's labels and captions, plus
  whatever `[formats-extra]` moves. Anything else in that diff is a regression,
  not a rename.

`tests/test_exhibit_formats.py:88` asserts `'Premium spent'` is declared. That
column is untouched.

### [features] the feature register

`dev/FEATURES.csv` rows 24 and 25 describe `walk_df` and `evaluation_df`
including every column name. It is **generated**: regenerate with
`dev/regen_features.py` after the docstrings are updated rather than editing the
CSV by hand.

## Acceptance checks

In `V:\worktrees\aggregate_REFACTOR`:

1. `uv run pytest tests/test_exhibits.py tests/test_chart_kappa.py
   tests/test_exhibit_formats.py` green.
2. `uv run pytest` green, the full fast suite, once at the commit boundary.
3. The snapshot diff contains only waterfall labels and captions, plus any
   `[formats-extra]` format moves.

In `V:\dev\aggregate-api`:

4. `uv run pytest` green. No api test references any renamed name, so this is a
   regression check rather than a target.
5. Build a tower PnL in the running app and read the PnL group. Pills read
   `Summary  Waterfall  Ledger`, left to right. A fresh build lands on Summary.
   Summary's lede reads **Summary**: expected premium, loss, expense and
   margins, and corresponding ratios. Waterfall's reads **Waterfall**: the
   margin (M) and standalone and diversified 1-in-100 margin walk over the whole
   tower.
6. In that Waterfall pane, the first table heads `Margin  M01 standalone  M01
   diversified` and the second ends `M / M01 standalone  M / M01 diversified`.
   Flip Perspective between Insurer and Raw; both read sensibly.
7. Build an object with an occurrence cession, open Pricing / Plot, and confirm
   the right-hand panel is titled `Cession as share of gross`.
8. `/v1/meta` and the About panel report `1.0.0a175`.

## Bookkeeping

**`aggregate`, `1.0.0a357` to `1.0.0a358`.** One commit, carrying the source
change, the format sheet, the tests, the regenerated snapshot and
`dev/FEATURES.csv`, the `pyproject.toml` bump and the `CHANGELOG.md` section.
One line, no body, no trailers, house format:

```
[PnL-Waterfall-Labels] a358: rename the waterfall columns onto M01
```

The CHANGELOG entry is one paragraph opening
`**[PnL-Waterfall-Labels] ...**`, plus a second short paragraph for the
breaking rename, since `walk_df` and `evaluation_df` are stable-tier properties
and a caller indexing them by name has to act.

**`aggregate_api`, `1.0.0a174` to `1.0.0a175`.** One commit, carrying
`web/src/nav.js`, the two comment fixes, `pyproject.toml`, `uv.lock`,
`CHANGELOG.md`, this plan moved to `dev/done/`, and the matching `dev/TODO.md`
tick if one exists. Subject in this repo's convention:

```
[a175] reorder the PnL sub-tabs and relabel Ratios to Summary
```

Then, in order, because the order matters:

1. Commit.
2. `uv sync --extra dev`, or `/v1/meta` keeps reporting `a174`: the version is
   read with `importlib.metadata.version`, which returns what the editable
   install recorded. **Stop any running server first**, or the sync fails with
   `os error 32` on a locked `Scripts/aggregate-api.exe`.
3. `.\scripts\build-web.ps1`. `web/` moved, so the SPA must be rebuilt or the
   About panel reports `a175` over a page that predates it. Build the artifact,
   never stage it: `src/aggregate_api/static/` is gitignored.

Neither repo is pushed. The author pushes.

## Execution log, 2026-09-29

Landed as `aggregate` `1.0.0a358` (commit `9f2a8fe`) and `aggregate_api`
`1.0.0a175`. Every file, line number and quoted snippet in the plan matched the
code as found; nothing in the plan's factual account had to be corrected.

**Rulings taken at the start.** Both severable steps were put to the author and
both were taken at the plan's recommended arm: `[kappa-axis]` shortens the
y-axis to `Share ceded`, and `[formats-extra]` declares the four renamed
readings in the format sheet rather than swapping the exemptions.

**Divergences.**

- `[features]`. The plan says to regenerate `dev/FEATURES.csv` with
  `dev/regen_features.py` rather than editing it by hand. The script turns out
  to be an **auditor over the live member surface**, not a generator of the
  hand-written `notes` prose: it reported `OK` and wrote nothing, because no
  member name moved, only column labels quoted inside the notes text. Rows 24
  and 25 were therefore edited by hand, and `# table-version` was moved from
  `1.0.0a353` to `1.0.0a358`. A later reader should treat the `notes` column as
  hand-maintained.
- `[captions]`. The plan's caption snippets interpolate `{m}`, but `m` is
  defined only in `_pnl.py`. `src/aggregate/exhibits/_pnl.py` needed its own
  `m = f'M{100 // t:02d}'`, added beside `t` with a comment saying why it is
  derived the same way the frame derives it.
- `[tests]`. The plan named `walk['M']` in
  `test_waterfall_diversified_foots_and_standalone_does_not`. A second site
  also indexes it, in `test_waterfall_capital_ratio_definition` (the
  `pytest.approx` line). Both became `walk['Margin']`.
- The `PENDING_VOCABULARY` comment above the list described the waterfall's
  composed readings as a pair. With the two `M @ 1-in-100` entries gone, it now
  reads as the one remaining reading, `M / SD`.
- No `dev/TODO.md` entry exists for this plan in either repo, so there was
  nothing to tick.

**Verification.** `uv run --no-sync pytest tests/test_exhibits.py
tests/test_chart_kappa.py tests/test_exhibit_formats.py` in the library: 4
failures before the snapshot regeneration, all four the waterfall snapshot
cases, then 285 passed. The snapshot diff was read line by line: it contains
only the waterfall's labels, the three rewritten captions, and the
`[formats-extra]` format moves, the two ratio columns going to `.1%` and the
three money columns onto the sheet's declared money reading. Full library suite
5156 passed. In the api, `uv run --no-sync pytest` 400 passed and `npm test` 183
passed.
