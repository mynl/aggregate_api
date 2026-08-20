# Plan [PnL-Button-Punchup]: a priced book, and one press to explode

> **Status: EXECUTED, 2026-08-20.** Phases **A2** (the explode route), **A2b**
> (`_has_reinsurance` through `PnL.engine`) and **A3** (the capability flag and
> the button's two states) landed at API `1.0.0a113`; phase **A1** (the priced
> premium) landed at API `1.0.0a114` against LIB `1.0.0a306`. Line anchors as
> drafted: API `1.0.0a112`, LIB `1.0.0a305`. Companion document: LIB
> `dev/done/plan-pnl-reinsurance-pricing.md`, executed at a306 with no
> divergences from its own v3.
>
> **A1 landed one field short of this draft, and the missing one is the
> interesting part.** `working_attach` does not exist, and neither does the
> `rate` / `rol` split it selected. A `rate` quote is a fraction of the P&L
> premium, and that premium is what the ladder is computing, so the quotation
> form was circular; the author's ruling during the LIB build was to remove the
> split rather than solve it, and **every cession is written as a `deposit`**, a
> currency amount that references neither the premium nor the limit. Section 1's
> field table is therefore five fields, not six, and section 4's test 7 asserts
> a deposit rather than a rate or a rol. A layer whose program already carries a
> `rate` clause is refused upstream, and surfaces here as a 422 naming the
> layer.
>
> **One design decision this draft did not anticipate.** The ladder prices the
> cessions of a single aggregate engine and refuses a `Portfolio` by name, but
> the PnL button works on portfolios, so sending the app's defaults to one would
> have turned every portfolio press into an error pane. The route drops the
> three ratios for a portfolio, and only when the caller did not ask for them:
> an explicit `net_combined_ratio` reaches the library and is refused there.
> A portfolio P&L is therefore still sized off `loss_ratio`.
>
> **The author's amended defaults are in**: `net_combined_ratio` 0.90,
> `occ_combined_ratio` 0.75, `agg_combined_ratio` 0.65. That is three
> divergences from the library's `None`, not the one this draft's section 1
> claimed, and the test asserts all three by value.
>
> **Execution notes, A2 / A2b / A3.** Four things worth recording against the
> draft. (1) The trailer trap is real and was verified rather than assumed:
> `pnl_program` on an engine carrying `note{hello} hints{log2=12}` returns a P&L
> carrying both after the expense clause, so the peel clause goes in front of
> the earliest of `note{`, `tags{`, `hints{`, and `format_program` preserves that
> placement through the spread rendering, so the round trip is clean. (2) The
> capability reads `PnL.program`, the text the object was built from, since both
> keywords produce the same class and the source is the only thing telling them
> apart. (3) The button's mode switches on `state.kind === 'pnl'` rather than on
> the flags, so a severity or a distortion still reads `PnL` and greys, instead
> of reading `Explode` and greying. (4) A portfolio engine is refused even with
> no peel clause, so the gate is unconditional: plain `xpnl` over a portfolio
> raises `NotImplementedError` upstream on its own.
>
> **Direction**, per the author's answer: `peel bottom-up` as drafted, and it is
> one string in `post_explode` for whoever prefers `top-down`.
>
> **v2 follows the companion plan's v2**: the premium is now built from the
> bottom up, net technical premium plus the cost of each cover, grossed up once
> for expenses, so the fields this repo passes are combined ratios rather than
> a loss ratio and a pair of loadings.
>
> **Origin**: the PnL button is a one shot wrap that writes a thin P&L and, on
> a reinsured engine, one the library itself warns about. The ask is demo
> sugar: press it and get a book with reasonable numbers in it, press it again
> and see the same book broken out layer by layer. The reader adjusts whatever
> they like afterward, in the box, which is what makes this worth doing in DecL
> rather than in a form.

## The design in one paragraph

The button tells a two step story. **Press one**, on any aggregate or
portfolio, writes the P&L it writes today, except that its premium is now built
the way a book is priced: net technical premium at a 90 percent net combined
ratio, plus a premium for each reinsurance layer at its own combined ratio,
grossed up once for the 25 percent expense clause. **Press two**, now on the
P&L, swaps `pnl` for `xpnl` and adds `peel bottom-up`, so the consolidated
total becomes the layer by layer walk. A third press has nothing to do and the
button is greyed. Going back is the history, which already records every
derived program.

## 1. Phase A1: what press one asks for

Passthrough only. The construction lives upstream (companion plan, section 2),
and nothing in this repo computes a premium, a rate, or an expected loss.

`models.PnlProgramRequest` (`src/aggregate_api/models.py:272`) carries the
library's conventions as fields so that a future page can set them without
another round of plumbing, which is the point of the library taking them per
layer in the first place:

| Field | Default | Meaning |
|---|---|---|
| `loss_ratio` | `0.70` unchanged | the legacy sizing, unused once the ladder is engaged |
| `expense_ratio` | `0.25` unchanged | the ER in `P = TP / (1 - ER)` |
| `net_combined_ratio` | `0.90` | net technical premium is net expected loss over this; engages the ladder |
| `occ_combined_ratio` | `0.75` | one value, or one per occurrence layer o |
| `agg_combined_ratio` | `0.65` | the same for the aggregate tier |
| `working_attach` | `0.10` | probability of attachment dividing a `rate` quote from a `rol` quote |

The two per layer fields take `float | list[float] | None`, matching the
library, so a quote sheet arrives as a list and a convention as a scalar.

**One deliberate divergence from the library's defaults**, and the only one:
`net_combined_ratio` defaults to `None` upstream, where `None` means "behave
exactly as before", and to `0.90` here, because this endpoint exists to serve
one app and that app has an opinion. A test asserts every other default matches
the library's signature, which is what catches the two repos drifting apart.

`routes/objects.py:2876`, `post_pnl`, forwards the fields to
`obj.pnl_program(...)` unchanged. The route keeps its shape: nothing computed
here, nothing rewritten here, and the derived text still goes through
`post_object` so every build guard applies.

`web/src/main.js:410` needs **no change**: `api.pnl(id)` already posts an empty
body, and an empty body is now the app's convention, stated once in the model
where it can be documented and tested rather than inline at a call site.

**Sequencing.** Sending `net_combined_ratio` to a library that predates the
companion plan is a `TypeError` inside the route, which is a 500. A1 therefore
lands after LIB L3 is merged **and** after `uv sync --extra dev` has re-recorded
the editable install, the standing skew trap in both houses' CLAUDE.md. The
version floor is not expressible in `pyproject.toml`, since `aggregate` is a
path source, so the ordering is the guard.

## 2. Phase A2: what press two does

A new derivation route, mirroring the three that exist:

```
POST /v1/objects/{id}/explode  ->  DerivedResponse  {program, description, ...build}
```

It reads `entry.decl`, the program the object was built from, and returns the
exploded text plus the object built from it. No request body: there is one
thing to do and no convention to state.

**Why a route and not a text edit in `main.js`.** The transform needs a rebuild
either way, so there is no round trip to save. Server side it sits beside
`collapse_program` (`routes/objects.py:1011`) and `spread` (`:2626`), it is
covered by `pytest` where the web half has no equivalent, and the two gates
below are read off the live object rather than guessed from text.

### 2.1 The transform

1. Refuse anything whose collapsed program does not start with the `pnl`
   keyword, 400, which also covers an `xpnl` that has nothing left to do.
2. Replace that leading keyword with `xpnl`.
3. Insert `peel bottom-up` **before the trailer**, or at the end when there is
   none.

Step 3 is the one trap in this plan. The grammar is `... expense_less
peel_clause trailer` (`decl.lark:133`), and the engine's trailer rides **up**
onto the P&L: verified, an engine carrying `note{hello} hints{log2=16}` wraps
into a P&L carrying both after its expense clause. Sharpen and Hints write
exactly those clauses, so appending at the end would be a parse error for any
program that had been through either. The insertion point is the earliest of
`note{`, `tags{`, `hints{`. That rule is safe because a P&L can carry only one
trailer: the inline engine slot has no room for one, which is why
`pnl_program` lifts it in the first place.

### 2.2 The two gates, both read off the object

- **Peel needs reinsurance.** Without it the build refuses with a good message
  ("'peel' needs a guaranteed-cost program with reinsurance layers to walk").
  The gate is `_has_reinsurance(entry.obj.engine)` (`routes/objects.py:635`);
  `PnL.engine` is the wrapped object. With no reinsurance the route still
  explodes, it just writes no peel clause, which is the correct `xpnl`: one
  group per step with a single step.
- **`xpnl` refuses a portfolio engine** ("the portfolio total hides its units,
  so there is nothing to explode"), a `NotImplementedError` the build path
  already turns into a 422. The route refuses first, 400, so the button can be
  dark instead of the press producing an error pane.

Note for whoever writes this: `has_reins` on the build response is **False for
a P&L today**, because `_has_reinsurance` reads `occ_reins` off the object and
a `PnL` carries none. That is why the gate looks through `.engine` rather than
trusting the flag. Teaching `_has_reinsurance` to look through `.engine` as it
already looks through a `Portfolio`'s units is a two line fix and a genuine
improvement to the summary strip, but it changes a build response field for
every P&L, so it is proposed separately as A2b rather than smuggled in here.

## 3. Phase A3: the button

`capability.py` gains `can_explode`, on the build response like its neighbors:

```
a PnL, whose program starts with the pnl keyword rather than xpnl,
whose engine is not a Portfolio
```

`nav.js:412` maps it to `canExplode`, and `main.js` reads it in
`renderActionRow` (`:293`). The three states:

| Editor holds | Button | Press |
|---|---|---|
| an agg or port | `PnL`, live when `canPnl` | derive the P&L, land on Economics |
| a `pnl` | `Explode`, live when `canExplode` | the A2 route, stay where you are |
| an `xpnl` | `Explode`, greyed | nothing |

Both presses go through `runDerivation` (`main.js:329`) unchanged, which
records the returned program in the history. That is the way back from an
`xpnl`: Ctrl+Up, exactly as for any other derivation, so the cycle needs no
third state and the button never lies about what it will do.

The label changing is the point: `PnL` then `Explode` narrates the flow the
author described, program, then P&L, look at the total, want the breakdown,
`xpnl`. If a fixed label is preferred, the plan degrades to keeping `PnL` and
only the enable state moves.

## 4. Tests

`tests/test_derive.py`, beside the existing derivation cases:

1. explode on a reinsured aggregate P&L: the program starts `xpnl`, ends with
   `peel bottom-up`, and builds;
2. explode on an unreinsured P&L: `xpnl`, no peel clause, builds;
3. the trailer case: an engine carrying `hints{}` and `note{}`, sharpened or
   pinned first, explodes to a program that still builds, with the peel clause
   before the trailer;
4. explode on a portfolio engine P&L: 400, and `can_explode` is False;
5. explode on an `xpnl`: 400, and `can_explode` is False;
6. explode on an aggregate: 400;
7. press one on a reinsured engine: the returned program carries a `rate` or a
   `rol` on every cession, and no `ZeroPremiumCessionWarning` reaches the
   response notes;
8. press one with a per layer list in `occ_combined_ratio`: each layer prices
   at its own ratio, and a wrong length is a 422 rather than a 500;
9. `PnlProgramRequest` defaults match the library signature, `net_combined_ratio`
   excepted and asserted to be the documented divergence.

`tests/test_capability.py` gets the `can_explode` cases. No web tests: the
button logic is one flag and one label, and `web/test/` is for pure functions
with real logic in them.

## 5. Phases and cadence

- **A1**, the request fields. **DONE, a114**, against LIB a306, five fields
  rather than six.
- **A2**, the explode route and its tests. **DONE, a113.** Independent of A1 and
  of the whole LIB plan, and it did land first because the premium work is still
  a draft upstream.
- **A3**, the capability flag and the button. **DONE, a113**, with A2.
- **A2b**, `_has_reinsurance` looks through `PnL.engine`. **DONE, a113**, ruled
  in by the author rather than left optional.

A1 and A2 are each an afternoon. `dev/TODO.md` gets one entry pointing here.

## 6. Open questions

- **The label.** `Explode` for the second state, or keep `PnL` throughout and
  let only the enable state move. The plan assumes the former. --> FINE
- **Direction.** `peel bottom-up`, per the author, lowest attaching layer
  first. Nothing here depends on the choice; it is one string. --> Easy for user to change top-down is fewer letters
- **The 0.90 default** for `net_combined_ratio` is the app's, not the
  library's, and it is the number a reader will see first on every demo. It
  belongs in `CHANGELOG.md` prose as well as in the field description. --> understood, need something reasonable - not a production tool!
- **A2b.** Whether to fix `has_reins` for P&Ls now or leave it, given it
  changes a build response field for an object kind that has carried the wrong
  value since the P&L work landed. --> fix now
