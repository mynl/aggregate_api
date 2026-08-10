# plan-ui-round-6: the round 5 punch-ups

Eleven items off the author's read of a68, plus one question that turns into a
policy. Everything here was reproduced before it was written down: the two
backend faults were traced to the lines that cause them, and the one item that
could **not** be reproduced says so rather than being guessed at.

Three phases, three commits, in this order: the niggles, the two correctness
faults, and the exhibit step.

---

## Phase A (a69): the niggles

### A1. Delete "Example source... (soon)"

`web/index.html:111`, a greyed placeholder shipped at a17 for a source switcher
that a159 made moot: the three shipped libraries became one `library.agg`, so
there is nothing to switch between. The divider above it goes with it, or the
menu ends on a rule.

`dev/TODO.md:596` is the matching open item and ticks.

### A2. A floor of six lines under the editor

`editor.js`, `.cm-content { minHeight: '4.5em' }`. Measured in the browser: the
line box is 19.6px and the padding is 12px top and bottom, and `minHeight` is
taken as the border box, so 4.5em at 14px is 63px, which is **two** lines and
not the "~3" the comment claims. Six lines is `6 x 19.6 + 24 = 141.6px`, so
`10.2em`. Keep `em` so it tracks the 16px mobile bump, and correct the comment
to say what the number actually buys.

### A3. The sqlite warning: two faults, both ours

**What the sqlite is.** `audit.py`: an append-only log, one row per
`POST /v1/objects` regardless of outcome, holding the DecL, the knobs, the
status, the error, the elapsed time, the client IP and a timestamp. It lives at
`~/.aggregate/api/audit.db` (`Settings.audit_db`). Nothing reads it in v1; it is
there to be inspected with the `sqlite3` CLI, which is why each connection sets
WAL. It is not on any request path the reader can see.

**Fault 1, the leak.** `AuditLog._connect` hands its connection to
`with self._connect() as conn:`. That is sqlite3's **transaction** context
manager: it commits or rolls back on exit and it does **not** close. So every
build, and every `recent()` / `by_ip()` call, leaks a connection until the
garbage collector finalizes it, and the finalizer is what prints
`ResourceWarning: unclosed database in <sqlite3.Connection object at 0x...>`.
Three call sites, one fix: wrap in `contextlib.closing`.

**Fault 2, why it reaches the status strip.** `routes/objects.py::_collecting_notes`
already knows about this. It opens `warnings.catch_warnings(record=True)` with
`simplefilter('always')`, which lifts the default suppressions process wide, and
then keeps a warning only when `_from_library` says it was raised from inside
the `aggregate` package. Its own docstring names this exact ResourceWarning as
the reason. `pricing.py` opens the same construct **twice**, at lines 242 and
632, and keeps everything:

    with _warnings.catch_warnings(record=True) as caught:
        _warnings.simplefilter("always")
        ad = obj.analyze_distortions(**anchor)
        warns.extend(str(w.message) for w in caught)

A collection that fires anywhere inside either block is attributed to the
reader's pricing call and travels in `warnings` to the strip. Fix: lift
`_from_library` into a place both modules can import, and scope both.

Fault 1 alone would stop the message today. Fault 2 alone would stop it
reaching the reader. Both are wrong on their own terms, so both are fixed: the
scoping is what keeps the next stray warning from any other library out of the
reader's face.

### A4. `[m/n]` counts from the newest

`history.js::position()` returns `m = n - max(cursor, 0)`, so the program on
screen is `[20/20]` and the oldest is `[1/20]`. The author reads it the other
way: the current one is the first one. `m = max(cursor, 0) + 1`. The docstring
currently **argues for** the direction being removed, so it is rewritten rather
than edited.

**Where the entries live**, since the question was asked. `localStorage`, key
`aggregate-web:history`, shape `{entries: [newest, ..., oldest], cursor}`,
capped at 20, deduped against the most recent. Browser-profile-and-origin
local: it survives the tab, the browser and a reboot; it is not synced, it is
not per-user, and the server keeps no copy. Per-user history would need an
account. (The audit db in A3 does hold every program ever built, but it is
keyed by IP and is not this.)

### A5. Quick Re: words, a comma, and left-aligned tooltips

**The operator.** `#qr-op` shows the live DecL token, `so` for a percentage and
`po` for an amount. The author's ruling: it reads **"part of"**, always, because
the `%` is what triggers the share reading in DecL and `share of` is going away
upstream. The label is therefore the row's English and no longer the token; the
emitted clause keeps `so` for a share until the grammar merges them, and that
gets a comment saying so, since a label that has stopped tracking the thing it
used to mirror is exactly the sort of fact that gets silently "fixed" later.

**The comma.** `attach` becomes `attach,` so the row reads as a sentence:
`100%  part of  50%  attach,  95%  detach`.

**Tooltips left-align.** Two mechanisms and both are centered today:
Bootstrap's `.tooltip-inner` (the `?` on this row is the only one) and the
`.nav-off[data-why]::after` pseudo-element used by every greyed tab and leaf,
`text-align: center` at `site.css:491`. Both go left.

### A6. One CsvGrid, everywhere

`grid.js:99`, `expandButtons: columns.length > 10`. Reinsurance Summary is 11
columns wide, so it grew the pair and Pricing did not. The threshold was a
guess and the author's call is that the buttons never appear: `expandButtons:
false`, unconditional, and the paragraph justifying 10 comes out. Raw (not
formatted) copy and save stays exactly as it is; `unformattedExport` runs on
every mount and is already correct.

`mountGrid` is the single construction site, so this is the whole change.

### A7. A shortcut for the table view

**Ctrl+Shift+U**, document level, toggling interactive against the static
reading you last had (so it never *enters* full precision, and it does not
throw the setting away if you are in it).

Every mnemonic letter on the right hand is taken. `Ctrl+Shift+I` / `J` are
devtools, `M` is the profile switcher, `N` is incognito, `O` is bookmarks, `P`
is print, `L` is `selectSelectionMatches` in CodeMirror's own search keymap, and
`Y` is next to our emacs `Ctrl-Y`. `U` is free in Chrome, Edge and Firefox on
Windows and is bound by nothing in the editor. Announced in the feedback line
and in Help, per the a-whatever rule that an undisclosed binding is a feature
nobody can find.

### A8. Derived programs enter the history

`runDerivation` writes `res.program` into the editor and never calls
`history.record`. That is all three derivations behind it, Sharpen, PnL and
Reins, not only the one reported. `applyViews` (GCN) does record, which is why
the gap reads as arbitrary from the outside.

The fix goes in `runDerivation`, once, beside the `editor.setText` it already
does. The cession draft is deliberately **not** cleared: ceding is iterative.

---

## Phase B (a70): the P&L premium

`pnl Wind_PnL 1428.5840984231345 premium less agg ... less 0.25 premium expenses`.

The author's rule: `.0f` above 100, `.2f` at or below. This is round 5's item 19
and it is upstream ask 2, in `aggregate._program._pnl_consideration`, which
returns `est_m / loss_ratio` unrounded. It is done **here** because the author
asked for it now, as an anchored rewrite in `post_pnl` before
`collapse_program`:

    ^(pnl\s+\S+\s+)(<number>)(\s+premium\b)

Anchored, because a naive number-before-`premium` match also hits
`0.25 premium expenses`, which is the expense ratio and must not move. Skipped
when the program says `inherit premium`. Idempotent, so the day the library
rounds, this rewrites an already-round number and can delete.

---

## Phase C (a71): the exhibits, and the exceptions

### The question

> THERE SHOULD BE NO EXCEPTIONS to OUR PROCESS!

Agreed, and the recorded exceptions were three sentences where they should have
been three tickets. Here is the whole board. The library publishes eleven
registry exhibits (`dev/summary-exhibits-and-charts.md` in `aggregate_REFACTOR`):
`summary`, `tail`, `stats`, `validation`, `reins`, `economic`,
`economic_ratios`, `economic_waterfall`, `dependency`, `bs_window`,
`tail_behavior`.

**On the exhibit route after a68 (9 leaves).** Overview Summary / Tail /
Validation, Economics Ledger / Ratios / Waterfall, More Stats / Tail behavior /
Dependency.

**Not, and why, each verified against a running server:**

| Leaf | Exhibit? | The gap |
|---|---|---|
| Reinsurance Summary | yes, `reins` block 2 | **none.** Byte-identical head to `reins_summary_df`. Moves in this phase. |
| Reinsurance Stats | yes, `reins` block 1 | the library serves one 17-row table, measures down and layers across; the api transposes and splits it into Layer terms and Moments. Author is pushing the change upstream. |
| More Window | yes, `bs_window` | the exhibit serves the **public** frame: 10 columns, and it carries a stray `level_0`. The api serves the private `_bs_window_df`: 11 columns including `W` and `coverage`, which are the pane's whole diagnostic value. |
| More Sharpen | **no exhibit at all** | `sharpen_df` / `sharpen_score` are not in the registry. |
| Pricing (both), Bounds (all three) | **cannot be** | computed from what the reader typed, so not keyed on the object. The api builds these documents from pandas in `pricing.py` / `bounds.py`, which is the last pandas in the table pipeline. |
| More Density, Reinsurance Density | n/a | bulk, permanently the grid's. Agreed exception. |

So: one moves now, four are upstream asks, two are the agreed density case.
The asks go into a note for the library, as round 5's did.

### The work

Move `reinsurance:summary` onto `loadExhibitLeaf` with the `reins` exhibit's
second block. Since one envelope carries both blocks, the loader takes a block
index; that is also the shape Stats needs the day the library turns it over.

The three remaining exceptions keep their comment, but each now points at the
ask rather than reading like a settled decision.

---

## Not reproduced: More / Window

> more->window is not coming through? Where's that being dropped?

Walked in a browser at a68 and it draws, in **both** views, on an aggregate, on
a portfolio and on a gross/ceded bivariate. Every layer answers: the leaf is
live in the capability, `/frame/bs_window_df?format=ir` returns the document,
and the grid derives from it.

It is correctly **dark** on a P&L, a severity and a distortion, because the
library publishes no `bs_window` for those kinds and the frame route agrees
(`400 bs_window_df not available for 'pnl'`). A P&L is the likely one: it is
one press of PnL away from an aggregate, and the greyed reason it gives,
"needs an FFT grid", is arguably wrong for an object that has one.

Left open pending the author saying which object was on screen.

---

## As executed

Three phases, two commits: A landed as **a69**, B and C together as **a70**
(the P&L rounding is four lines and did not deserve a version of its own).
Everything below was watched in a browser before it was recorded.

**One defect, and it was mine.** The first cut of the Ctrl+Shift+U binding
flipped the view and **silently deleted the program in the editor**. CodeMirror
drops the Shift when it matches a character key held with Ctrl, so on the bubble
phase the keystroke matched `Mod-u` in `historyKeymap`, which is
`undoSelection`, which pops the last document change when there is no
selection-only event to pop. `preventDefault` does not help: the editor had
already handled it on the way up. Fixed by taking the event on the **capture**
phase and calling `stopPropagation`, which is the fix that does not depend on
picking a lucky letter, since the same collision waits for every
`Ctrl+Shift+<letter>` whose plain `Ctrl+<letter>` the editor binds.

Worth naming because of *how* it was found. It is invisible to a unit test, it
is invisible to a screenshot of the feature working (the view really did flip),
and it only shows up if you look at the part of the page the change was not
about. That is the third round in a row where the browser rule has earned its
place, and the pattern is the same each time: the feature works and something
beside it broke.

**Two smaller corrections.** The plan said the editor floor was three lines and
the code's comment agreed; measured, `4.5em` was 63px against a 19.6px line box
and 24px of padding, which is two. And the P&L rewrite is re-rendered
downstream: `spread` re-parses the program, so `10.50` comes back `10.5`. The
value is rounded, which is what the route owes; the trailing zero is the
library's rendering and not worth fighting the writer over. The test asserts the
value.

**Phase C came in smaller than the question deserved.** One leaf moved. The
useful output was the board: six leaves off the exhibit route, four of them
library asks now written up as
`aggregate_REFACTOR/dev/note-from-aggregate-api-round-6.md`, and the fifth and
sixth (the two densities) agreed as bulk. The point of the exercise was that
"three sentences of justification in a comment" and "three tickets" look
identical from the outside until someone asks.

## Also carried forward

- `uv sync` still fails with `os error 32` on `Scripts/aggregate-api.exe`: a
  Session 0 orphan (now PID 7156) holds it and `Stop-Process` returns Access
  denied without elevation. `/v1/health` currently reports a68 correctly, so
  the recorded version is **not** stale right now, but the next bump needs that
  process gone.
- Round 5's item 19 closes in phase B. Nothing else from round 5 is outstanding.
