# Plan a193: Stack and Round, a tower generator on the Quick Re row

**Scope: this repo only.** No library change, no api change, no new route. One
version bump, one commit.

Written for a reader with no conversation context. File references are to this
repo (`V:\dev\aggregate-api`) unless marked *aSP*, which is the sibling
experiment `V:\dev\aggregate-asp`, a static SPA that talks to this service over
`/v1`. aSP is an experiment that will probably be retired; this plan lifts the
one piece of it the author wants to keep.

Date drafted: 2026-10-06.

---

## Goal

Give the Quick Re row a second action, **Tower**, that turns one wide attach to
detach span into a stack of quote-sheet-rounded layers, with a declining
placement ladder, and writes the whole stack into the program box as one
cession clause.

The reason, in the author's words: put a big stretch in and give it a good
layering, which is exactly what an underwriter would want. Typing a six layer
tower by hand is the thing that stops a reader from exploring a program, and
the arithmetic (double, snap to a quote-sheet number, step the share down) is
mechanical.

---

## Current behavior

### The row

`web/index.html` around line 529, inside `#reins-entry`. A segmented tier
control (Occ / Agg), three text fields (`qr-share`, `qr-attach`, `qr-detach`),
an **Add re** button (`reins-btn`), a `?` tooltip, and a preview line
(`qr-preview`) under the row.

### The code

`web/src/main.js`, the block introduced by the comment
`// Quick Re: one row, one layer, straight into the editor` (around line 2697).
Five pieces matter here:

| Function | What it does |
|---|---|
| `readLayerField(text)` | the dual reading: `50%` is `{kind:'p', value:0.5}`, `500` is `{kind:'amount', value:500}`, anything else null |
| `composeCession()` | resolves each field, looks up probabilities through `api.quantiles(state.id, ps, basis)` with `_quantileCache`, refuses a zero-width or inverted layer through `layerRefusal`, and returns `` `${basis} net of ${head}${limit} xs ${attach}` `` |
| `renderCessionPreview()` | debounced 350 ms, ticketed against out-of-order answers, dims while a lookup is in flight |
| `cede()` | composes, then `runDerivation(... api.reins(id, cession) ...)`, which posts `POST /v1/objects/{id}/reins` |
| `layerNumber(v)` | spells a number for a program someone will read |

The quantile route already snaps its answers to three significant figures, so
a probability that resolves to 1,234,567 arrives as 1,230,000. The `?` tooltip
says so: "Quantiles are rounded to three figures, because a layer is something
you write down."

So **half of Stack and Round already exists**. The dual reading, the quantile
lookup, the rounding, the preview, the cede path and the error reporting are
all in place and are all reused unchanged.

### The ruling this plan reverses

`web/index.html`, in the comment block above the row:

> ONE layer, deliberately. Multi-layer programs are typed upstairs, which is
> what that box is for. This is demo sugar and is worth having only while it
> stays small; a second layer here means it has failed. Two *tiers* is
> different and is supported: cede on Occ, then switch to Agg and cede again,
> each clause authoritative for its own tier.

The author has reversed this deliberately: a generated stack is not a second
hand-typed layer, it is one press producing the structure an underwriter would
have written. The comment must be rewritten to say so, with the date and the
reason, rather than left to contradict the button beside it.

---

## The change

### [tower-generate] the generator, ported from aSP

Two pure functions, new, in `web/src/main.js` beside `layerNumber`. Both come
from aSP and are reproduced here because they are arithmetic, not code worth
sharing across repos.

`snap125(x)` (aSP `js/format.js:57`): snap to the nearest quote-sheet number in
log space, over the grid `1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10` times a power of
ten.

`generateTower(attach, detach, share)` (aSP `js/panels.js:721`): bounds start at
`snap125(attach)`, then repeatedly `snap125(previous * 2.1)` with a floor of
`previous * 1.5` so the snap can never fail to advance, stopping at `detach` or
at a layer cap. Returns `[{limit, attach, share}, ...]`.

A ground-up span (`attach` at or near zero) starts the stack at
`snap125(detach / 64)` and keeps a first layer running from zero, so a
ground-up tower still has layers rather than one unbounded bottom.

### [tower-compose] one clause, many layers

New `composeTower()` beside `composeCession()`, sharing every piece of field
handling with it. Factor the field read, the quantile resolution and the
refusal out of `composeCession` into one helper (`resolveSpan()`, returning
`{attachAmount, detachAmount, share, basis}`) so the two actions cannot drift
in how they read the boxes.

The emitted clause is the layers joined by `and`, each named, matching the DecL
form aSP emits (aSP `js/decl.js:40` `layerLine`):

```
occurrence net of 95% po 1000 xs 1000 as "Occ 1" and
                  90% po 2500 xs 2000 as "Occ 2" and
                  90% po 5000 xs 4500 as "Occ 3"
```

Layer names are load bearing downstream: they become the `Step` labels on every
P&L exhibit (the ledger, the ratio sheet, the waterfall), and an unnamed stack
produces a ledger nobody can read. See **Open question Q3** on what to call
them.

### [tower-button] the control

A fourth button in `.lbtns`, labeled **Tower**, beside **Add re**, outline
style so Add re keeps the primary. It composes through `composeTower()` and
cedes through the same `runDerivation` path `cede()` uses, so busy state, error
reporting and the rebuild are unchanged.

The preview line shows whichever clause the row would write. Two presses need
two previews, so the simplest honest version is: the preview keeps showing the
single-layer clause, and Tower shows its own clause in the preview line the
moment it is pressed, before the cede. An alternative is a third mode on the
preview. See **Open question Q4**.

### [tower-ruling] rewrite the comment

In `web/index.html`, replace the "ONE layer, deliberately" paragraph with the
author's reversal of 2026-10-06, stating what is now true: the row writes one
hand-specified layer, or one generated stack, and nothing else. Multi-layer
programs that are not a stack are still typed upstairs. Keep the rest of the
comment block, which is still accurate.

### [tower-help] the tooltip

Extend `#qr-help`'s `title` with one sentence on Tower: what it does with the
span, that the bounds are snapped to quote-sheet numbers, and that the share
box sets the whole stack or seeds the ladder (whichever Q1 settles).

---

## Files touched

| File | Why |
|---|---|
| `web/index.html` | the Tower button, the reversed ruling comment, the help text |
| `web/src/main.js` | `snap125`, `generateTower`, `resolveSpan`, `composeTower`, the button wiring |
| `web/src/styles/site.css` | only if the fourth button breaks the row at a narrow width |
| `CHANGELOG.md` | the a193 section |
| `pyproject.toml` | version to `1.0.0a193` |

`dev/scripts/check-nav.mjs` is unaffected: nothing in the nav skeleton moves.

---

## Acceptance

1. Build `agg Demo 100 claims 1000 xs 0 sev lognorm 50 cv 2 poisson`. Open
   **Re**. Set attach `50%`, detach `99.9%`, share `100%`. Press **Tower**.
2. The program box gains one `occurrence net of ... and ... and ...` clause
   with between three and eight layers, every bound a quote-sheet number, every
   layer named, and the build succeeds.
3. **Re / Diagram** draws the stack as a tower. **Re / Summary** lists the
   layers, one row each, under the names the clause gave them.
4. Build a P&L over that program. **PnL / Ledger** shows one step per layer,
   under the same names.
5. Press **Add re** with the same boxes on a fresh build: one layer, exactly as
   today. The single-layer path is unchanged in every respect.
6. Set attach `0`, detach `95%`, press **Tower**: a ground-up stack, with a
   first layer attaching at zero.
7. Set attach `99%`, detach `99.1%`, press **Tower**: a span too narrow to
   stack produces one layer rather than an error or an empty clause.
8. Press **Tower** twice without touching the boxes: the second press cedes
   against the already-ceded object, and the existing `layerRefusal` message is
   what the reader sees if the span has collapsed. No new error path.

---

## Open questions for the author

**Q1. The share ladder.** aSP walks `[0.95, 0.90, 0.90, 0.85]` down the stack
and holds the last value for deeper layers, ignoring the share box. Options:

- (a) the ladder, share box ignored for Tower
- (b) the share box applies flat to every layer
- \(c) the share box sets the first layer and the ladder steps down from it

\(c) reads best to me: the box keeps meaning what it means, and the ladder is a
shape rather than a set of magic numbers. But the ladder's numbers are a real
underwriting judgment and are the author's to set.

==> share is applied to the bottom (lowest attaching) layer and the ladder increases from that up to max(input share, 0.95) for the top most layer. Shares never decrease with increasing attachments. If share = 1 then obvs all layers are 100% placed.

**Q2. The stacking ratio and the cap.** aSP doubles (`* 2.1` before the snap,
floored at `* 1.5`) and caps at 10 layers, which on a wide span gives six or
seven. Keep both? A ratio closer to 3 gives fewer, fatter layers.

==> aSP layers looked right to me as i tried it; keep that logic.

**Q3. Layer names.** The names become the `Step` labels on every P&L exhibit.
Candidates:

- `as "Occ 1"`, `as "Occ 2"`, ... (what the author's hand-typed demo programs
  use, short, sorts correctly, says nothing about the layer)
- `as "2500 xs 2500"` (aSP's default, self-describing, wide in a table)
- no `as` clause at all, and let the library name them

I lean to the first for the ledger's sake, with the second available if the
author prefers self-describing rows.

==> Let's go Occ 1 etc. with 1 = lowest attaching layer.

**Q4. The preview line.** One line, two possible clauses. Simplest: leave the
preview on the single-layer clause and let Tower write its own clause into the
line when pressed. Alternative: a small Occ/Agg-style segment choosing which
action the row is previewing, which is a control the row does not currently
need.

==> Leave as preview for single-layer - this shows the overall bottom and top of the program, which is what you want to see.

**Q5. Does Tower replace or add?** `POST /objects/{id}/reins` cedes onto the
current object, so pressing Tower on an already-ceded object adds a second
tier's worth of layers. aSP's own generator *replaces* the tower. Replacing
here would mean rewriting the program text rather than ceding, which is a
different and larger operation. Recommend: Tower cedes like Add re, and the
reader undoes by editing the program box. Confirm.

==> confirm. generally expect the user only clicks this once - if multiple times they can adjust the decl manually. that's what it's there for!

---

## Execution log, 2026-10-06, landed as `1.0.0a193`

One phase, one bump, one commit, as the plan's scope line asked. All five open
questions were ruled, so nothing blocked. Both gates green: `uv run pytest`
439 passed, `npm test` 247 passed (12 of those new), and `node
dev/scripts/check-nav.mjs` clean.

### Verified before writing any code

The clause form round-trips. `obj.reins_program(cession)` parses the clause and
re-renders the whole program from the spec, so the emitted text is a parse
input and need not be pretty: the library re-spells it, and it re-spells it in
exactly the indented `and`-joined layout this plan's example shows. The names
land in `spec['occ_reins_label']` (`agg_reins_label` on the other tier), which
is what the P&L `Step` labels are drawn from. Five emitted clauses were checked
end to end against `aggregate` 1.0.0a387: a fully placed six-layer stack, the
same stack on a 60% ladder, a seven-layer ground-up stack, a one-layer
fallback, and an aggregate-tier stack. All five build and all five carry their
labels.

LIB is a387 on disk and a387 as installed, so there was no sync drift to
correct first.

### Divergences

1. **`.lbtns` does not exist in this repo.** [tower-button] places the Tower
   button in `.lbtns` as "a fourth button"; that is an aSP class and an aSP
   count. The button went into `.reins-row`, beside `#reins-btn`, which is what
   the plan's prose says. `.reins-row > .btn` already carries the height,
   padding and face, so Tower is styled by what is there.

2. **`site.css` was not touched.** [tower-button] allowed for a CSS change "if
   the fourth button breaks the row at a narrow width". `.reins-row` is
   `flex-wrap: wrap`, so it does not: the button wraps with everything else.

3. **The arithmetic went into a new `web/src/tower.js`, not into `main.js`.**
   [tower-generate] asked for the two functions "in `web/src/main.js` beside
   `layerNumber`". `main.js` reaches for the document at import time and cannot
   be loaded under `node --test` at all, so three pure arithmetic functions put
   there would be untestable, and both gates are the bump. They are a module,
   `main.js` imports them, and `web/test/tower-stack.test.js` exercises them.
   The plan asked for no tests; twelve were written anyway, because the `* 1.5`
   floor under the stacking step is a termination guarantee and a regression
   there is an infinite loop rather than a cosmetic defect.

4. **The attachment box now reads a bare `0`.** Acceptance 6 asks for a
   ground-up stack from attach `0`, and `readLayerField('0')` returned null
   through a192, so the plan's own acceptance was unreachable: `0` was "attach
   and detach are both needed". `readLayerField` takes an `allowZero` option
   and `resolveSpan` passes it for the attachment box alone. **This reaches Add
   re too**, which now writes `net of 1000 xs 0` where it used to refuse, so
   acceptance 5's "unchanged in every respect" is not quite true of that one
   input. That is deliberate: giving Tower a different reading of the boxes
   than Add re is precisely what [tower-compose] factored `resolveSpan` out to
   prevent, and a ground-up single layer is a correct clause. `0 xs 0` is still
   refused by the width test, and `0%` stays unreadable in every box.

5. **A span too narrow to stack falls back to one layer.** Acceptance 7 asks
   for one layer rather than an error or an empty clause; aSP's generator
   returns nothing there and aSP's caller silently does nothing. `generateTower`
   keeps returning nothing, which is the honest report, and `composeTower`
   writes the span as one layer. Worth knowing when kicking the tires: on
   attach `99%` detach `99.1%` the snap carries the *bottom* bound above the
   detachment, so the generator yields one `350 xs 400` layer (not the
   fallback) rather than the 22-wide span as typed. Tower rounds to the quote
   sheet by construction and a 22-wide span does not survive that. Add re is
   what writes the span exactly.

6. **An amount in the share box is refused for Tower.** `2500 po` places an
   absolute amount of cover, which means something on one layer and nothing
   across six layers of different limits, and the ladder needs a fraction.
   Add re still takes it, unchanged. This is a new refusal, which acceptance 8
   did not want for the double-press case and does not get: it is a field
   refusal in the `layerRefusal` idiom, in the preview line, not a new path
   through the cede.

7. **Layer names follow the tier.** Q3 ruled `Occ 1` up from the lowest
   attaching layer, and the plan's example is occurrence only. An aggregate
   stack is named `Agg 1` up, which is the obvious parallel and keeps the two
   tiers' `Step` labels apart when both carry a stack.

8. **Tower does not write its own clause into the preview line.**
   [tower-button] proposed that it should, "the moment it is pressed, before the
   cede"; Q4's later ruling says the line stays on the single-layer reading,
   because that is what names the bottom and the top of the program. The ruling
   governs. Tower composes and cedes through the same path Add re uses, and the
   line goes back to the single-layer clause afterward, which is what `cede`
   already did. Refusals from either button still land there.

9. **The share ladder, spelled out**, since Q1 ruled a shape rather than
   numbers. The bottom layer takes the box exactly. The top takes
   `max(box, 95%)`. The layers between are interpolated and rounded to the
   whole percent, then clamped non-decreasing, because a ladder of 68.75% and
   77.5% is arithmetic showing through. A one-layer stack keeps the box
   untouched rather than being raised to 95% for also being the top. A box of
   `100%` places every layer whole and emits no `po` head at all. On the
   acceptance book a `60%` box gives 60, 67, 74, 81, 88, 95.

10. **One stale comment corrected in passing.** `composeCession`'s docstring
    said the row's label reads `part of`; it has read `placed, from` since the
    row was reworded. The same staleness survives in `site.css`'s `.qr-op`
    comment and was left alone, since nothing else in that file moved.

### What the acceptance case actually produces

On the Occ tier (the row's default), `agg Demo 100 claims 1000 xs 0 sev lognorm
50 cv 2 poisson` resolves attach `50%` to 22.5 and detach `99.9%` to 1,000, and
Tower writes six layers: `25 xs 25`, `50 xs 50`, `100 xs 100`, `200 xs 200`,
`350 xs 400`, `750 xs 750`. Every bound is a quote-sheet number and the top
bound is 1,500, above the detachment, per the ruling on Q2.

Acceptance 2's "between three and eight layers" is an **occurrence** reading.
On the Agg tier the same book runs 4,850 to 8,660, a ratio under two, so a
doubling tower there is one layer. That is the arithmetic, not a defect: there
is no stack to lay out across less than one doubling.
