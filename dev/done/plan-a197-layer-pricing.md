# a197: Quick Re quotes the layers it writes

Target version `1.0.0a197`.

## Goal

The Quick Re row on the Reins tab writes coverage and no price. Make it write a
price too: one deterministic quote per layer, spelled `deposit` or `rol` in the
DecL clause, so the program that lands in the editor is a quote sheet rather
than a bare structure. Along the way the row gains a live expected loss and a
live indication on the preview line, with no build.

One method, no options, no radio buttons. The parameters are hidden constants in
one place.

## What happens today

`web/src/main.js`, the section headed `Quick Re: one span, one layer or one
stack`. Three boxes (share, attach, detach), a tier switch (occurrence or
aggregate) and two buttons:

- **Add re** composes one layer over the span and cedes it.
- **Tower** composes a generated stack over the span and cedes that.

Each box takes a probability (`50%`) or an amount (`500`); probabilities resolve
through `GET /v1/objects/{id}/quantiles` on the chosen tier's own distribution,
cached per object. `composeCession` and `composeTower` return a clause such as
`occurrence net of 95% po 1000 xs 1000 as "Occ 1" and ...`, which goes to
`POST /v1/objects/{id}/reins`. That route calls `obj.reins_program(cession)` to
get the DecL for the net object (the clause cannot be string-spliced, because an
occurrence cession sits before the frequency clause and an aggregate cession
after it) and then builds it.

The preview line under the row shows the clause the row would write, recomposed
on every settled keystroke.

Nothing anywhere prices the layer. `dev/TODO.md` carries the open item
"`cession`, pricing a cession with a distortion; the library has no glue between
reinsurance and distortions at all". That glue shipped upstream in the meantime
(`Aggregate.reins_price_df`), and this plan uses it, so the item can be ticked.

## The prior art: `aggregate-asp`

`../aggregate-asp/js/seeds.js` carries three seed engines behind a radio switch,
plus a repair pass. They were ported from the retired vaporware and are the
starting point this plan rejects, for reasons worth recording.

1. **ROL curve.** `rol = kappa * lol^theta` (`kappa = 1.3`, `theta = 0.8`),
   floored at `minROL`, premium `rol * limit`. Cheap and deterministic, and
   blind to volatility and to the occurrence / aggregate distinction.
2. **Distortion.** `scale * integral of g(S(x)) dx` over the layer, five
   families, with `scale` the expected claim count on the occurrence side and 1
   on the aggregate side. This is the formula with the most theory behind it and
   the one measured below as wrong: distorting the **severity** survival curve
   and then multiplying by the expected count charges a severity risk load on
   every one of the year's claims and lets none of it diversify. On the worked
   example it quotes a layer that is hit ten times a year at a 45% loss ratio.
   The fix is to distort the layer's own **annual** loss distribution, which is
   what this plan does.
3. **CR ladder.** `cr = bottom * (top / bottom) ^ (j / (n - 1))`, premium
   `el / cr`. Parameterized by the layer's **ordinal position in the tower**, so
   re-chopping a tower moves every price even though no risk changed.

Then `constraints` applies three post hoc clamps in sequence: a minimum rate on
line, a margin-monotone clamp up the tower, and an `aggOverOcc` clamp lifting
every aggregate multiple to the top occurrence layer's. Order dependent, and
they can produce visible jumps.

The author's own `../aggregate-asp/dev/rules-of-thumb.md` states the target
behavior, and it is the specification this plan implements:

```
1. CR / LR decreases with higher attachment
2. Once claim count to layer < 0.5 quote ROL
3. Minimums for capacity layers; capacity = claim count < 1
4. Aggregate xol (agg stops) more expensive than occ layers
5. QS (inf xs 0) cheaper than occ layers; limited qs cheaper still
6. Only QS and well-balanced layers (el > limit) can have cedes
```

## What the engine already gives

Three findings from probing the library, each measured. They are the reason the
method below needs no new distributional mathematics and no library internals.

### Finding 1: the layer's annual moments are closed form off the gross object

For a layer `limit y xs attach a` at share `s`, let `S` be the survival function
of the subject, `bs` the model bucket, and `f1`, `f2` the first two frequency
moments from `Aggregate.frequency.freq_moms(n)`.

With `m1 = integral of S over [a, a+y]` and `m2 = 2 * integral of (x - a) S(x)
dx` over the same range (the first two moments of the layered severity, since
`E[Y^2] = 2 * integral of y P(Y > y) dy`):

- occurrence tier, `S` the per-claim survival `Aggregate.sev.sf`:
  `mean = s * f1 * m1` and `var = s^2 * (f1 * (m2 - m1^2) + (f2 - f1^2) * m1^2)`
- aggregate tier, `S` the annual survival `density_df.S`:
  `mean = s * m1` and `var = s^2 * (m2 - m1^2)`

Measured against the engine's own exact per-layer figures from
`Aggregate.reins_stats_df` (which computes each layer's annual distribution by
FFT), on `agg G 100 claims 20000 xs 0 sev lognorm 50 cv 4`, log2 19:

```
occurrence, poisson              occurrence, mixed gamma 0.3
layer           el      cv       el      cv          engine cv
100 xs 100   704.1686  0.3515  704.1686  0.4621      0.3515 / 0.4621
300 xs 200   758.9755  0.5598  758.9755  0.6351      0.5598 / 0.6351
500 xs 500   385.7024  1.0270  385.7024  1.0700      1.0270 / 1.0700
1000 xs 1000 231.9494  1.8441  231.9494  1.8683      1.8441 / 1.8683
3000 xs 2000 141.8330  3.8117  141.8330  3.8235      3.8117 / 3.8235
5000 xs 5000  39.1135  9.6663   39.1135  9.6709      9.6663 / 9.6709
```

Every figure agrees with the engine to the four decimals shown, for Poisson and
for a mixed frequency. The aggregate tier agrees to four or five significant
figures (the small loss is grid interpolation of `density_df.S`).

**So a layer's expected loss and standard deviation are available on the gross
object with no build at all.** That is what lets the form quote live.

### Finding 2: a layer's exact annual distribution costs one small build

`Aggregate.reins_program('occurrence ceded to <y> xs <a>')` renders the DecL for
a single-layer **ceded** program, whose aggregate distribution **is** that
layer's annual ceded loss. `ceded to` replaces the tier's program rather than
appending to it, so the auxiliary object carries that one layer and nothing
else, even when the object it came from already cedes. Hand the resulting pmf to
`Distortion.price` and the distorted quote is exact.

Measured cost: **55 ms per layer at log2 16**, 0.42 s for a six-layer tower, and
the quote is flat in log2:

```
          100 xs 100   1000 xs 1000   5000 xs 5000
log2 14      822.25        407.33         166.24
log2 16      823.26        407.34         166.24
log2 18      823.30        407.34         166.24
log2 19      823.30        407.34         166.24
```

0.13% between log2 14 and 19, which is why the pricing builds are capped at
log2 16 regardless of the object's own log2. A pricing indication does not need
a fine lattice, and the cap keeps the press snappy on a book built at log2 20.

Two practical notes. The pmf carries numerical noise of order 1e-11 negative,
which trips `choquet_weights` with "distorted atom weights materially negative",
so clip at zero and renormalize before pricing. And `reins_price_df` itself is
**not** the right call here: its views are `gross` / `ceded` / `net` only, so it
prices the whole cession and not the layers.

### Finding 3: the grammar already spells all of this

`deposit <amount>`, `rol <fraction>`, `rate <fraction>` and `cede <fraction>`
all parse today, on both tiers, and survive the round trip through
`reins_program`:

```
occurrence net of 1000 xs 1000 deposit 400 as "Occ 1"            OK
occurrence net of 1000 xs 1000 rol 2.5% as "Occ 1"               OK
occurrence net of 1000 xs 1000 deposit 400 cede 20% as "Occ 1"   OK
aggregate net of 2000 xs 5000 deposit 300 as "Agg 1"             OK
```

Two constraints from the parser: `rol` needs a finite limit, and `cede` needs a
premium clause on the same layer.

**One wrinkle to know about.** A plain `agg` builds the loss structure and
**ignores** the ceded premium, with `IgnoredDecLClauseWarning`: "a plain 'agg'
has no premium context". The price only bites inside a `pnl` / `xpnl`. The
program text keeps the full declaration, and `pnl_program` inlines it, verified:

```
pnl G_PnL 0.76 premium less agg G 100 claims 20000 xs 0 sev lognorm 50 cv 4
  occurrence net of 95% po 1000 xs 1000 deposit 360 as "Occ 1"
  and 90% po 3000 xs 2000 deposit 300 as "Occ 2" poisson
  less 0.25 premium expenses
```

So the demo is: Quick Re writes a priced program, then PnL or xPnL turns it into
a ledger carrying the ceded premium layer by layer. The warning rides along in
the build notes on the intermediate `agg`, which is accepted here rather than
worked around. See [notes].

## The method

Per layer, three candidate prices, take the largest, then floor it.

```
el, sd  = the layer's annual mean and standard deviation      (Finding 1 or 2)
sd_load = el + LAMBDA * sd
ph      = Distortion('ph',   PH_SHAPE  ).price(layer pmf).ask
dual    = Distortion('dual', DUAL_SHAPE).price(layer pmf).ask

technical = max(sd_load, ph, dual)
premium   = max(technical, MIN_ROL * share * limit)
written   = premium / (1 - cede)
```

`written` is then rounded to `SIG_FIGS` significant figures and spelled
`deposit <written>` when the layer's annual attachment probability is at or
above `ROL_THRESHOLD`, `rol <written / (share * limit)>` when it is below.
DecL's `rol` is a fraction of `share * limit`, which is the same base.

### Why each piece is there

**The standard deviation load does the shaping.** `LR = 1 / (1 + LAMBDA * cv)`,
which is literally "low volatility, high loss ratio". It also delivers the
attachment ladder without a ladder being drawn: a layer hit with annual
probability `p` satisfies `cv >= sqrt((1 - p) / p)` always, because among all
payments in `[0, limit]` with a given attachment probability the all-or-nothing
one has the smallest variance relative to its mean. So

```
LR <= 1 / (1 + LAMBDA * sqrt((1 - p) / p))
```

and the right side is increasing in `p`. **The loss ratio cannot rise as the
attachment probability falls.** asp's margin-monotone clamp becomes a theorem
and is not implemented.

**The two distortions make it interesting, and they bind in different places.**
On the worked example, `dual 1.8` binds on the three working layers and
`ph 0.7` on the three upper ones, which is exactly right economically: the dual
transform loads the body of a distribution and the proportional hazard transform
loads the tail. Taking the maximum of three measures is also what a reinsurer
actually does with three indications.

**The minimum rate on line terminates the ladder.** As `p` goes to zero the
standard deviation load behaves like `LAMBDA * limit * sqrt(p)`, so it decays
through any sensible floor, and the floor takes over exactly where capacity
layers live. On the worked book, `10000 xs 10000` quotes 1.08% unfloored and
`50000 xs 50000` floors at 1.00%. This is the one clamp kept, and it is the
natural end of the ladder rather than a patch on it.

**The aggregate surcharge is not needed.** "Aggregate covers cost more than the
corresponding occurrence layer" falls out, where "corresponding" means the same
probability pair resolved on each tier's own distribution, which is exactly what
the Quick Re percentage boxes mean. Measured on the worked book:

```
band        tier  limit        el        cv      quote      LR      rol    binds
50%-95%     occ        180  2,551.37   0.213   2,813.68  90.68% 1563.2%   dual
50%-95%     agg      3,732    729.32   1.508   1,162.93  62.71%   31.2%   dual
90%-99%     occ        504  1,547.80   0.454   1,883.46  82.18%  373.7%   dual
90%-99%     agg      4,712    167.21   4.107     435.11  38.43%    9.2%   ph
99%-99.9%   occ      1,592    513.79   1.401     812.35  63.25%   51.0%   ph
99%-99.9%   agg      9,444     32.07  13.626     168.72  19.01%    1.8%   ph
```

The aggregate layer is dearer per unit of expected loss at every band, by a wide
margin, because at the same percentile pair it is a genuinely rare event and its
cv says so. asp's `aggOverOcc` clamp is therefore not implemented either. If the
ordering is ever wanted at equal **annual attachment probability** as well, it
is one constant on `LAMBDA` and not a clamp; see [notes].

**The cede gross-up** is the author's rule, stated directly: when there is a
ceding commission, the technical risk-loaded premium is the reinsurer's net, so
the written premium is `technical / (1 - cede)`.

### Determinism

Every input is a pure function of the gross object and the layer: the survival
curves off a built object, the auxiliary builds at a fixed capped log2 from
rendered DecL, fixed distortion parameters, fixed rounding. Same boxes, same
program text, every time. No solving, no iteration, no ordering effects.

### The constants

One block, one module, no UI. `src/aggregate_api/layer_pricing.py`:

| name | value | what it does |
|---|---|---|
| `LAMBDA` | `0.30` | standard deviation load, so `LR = 1/(1 + 0.3 cv)` |
| `PH_SHAPE` | `0.7` | proportional hazard shape, loads the tail |
| `DUAL_SHAPE` | `1.8` | dual shape, loads the body |
| `MIN_ROL` | `0.01` | minimum rate on line, as a fraction of `share * limit` |
| `ROL_THRESHOLD` | `0.10` | annual attachment probability below which the quote is spelled `rol` |
| `SIG_FIGS` | `3` | rounding of the written premium, a quote-sheet number |
| `PRICE_LOG2` | `16` | cap on the auxiliary pricing builds |
| `CEDE` | `0.0` | default ceding commission |

`LAMBDA = 0.30` is not arbitrary. On the worked tower the three measures agree
within about 3%, so the standard deviation load is calibrated against the two
distortions rather than guessed, and the maximum is a cross-check as often as it
is a binding constraint.

## Worked example

`agg Demo 100 claims 20000 xs 0 sev lognorm 50 cv 4 poisson`, six-layer tower,
`LAMBDA = 0.30`, `PH 0.7`, `dual 1.8`, `MIN_ROL = 1%`:

```
layer         count  pr_attach       el     cv   sd_load      ph    dual   quote binds     LR    rol
100 xs 100    10.48     100.0%   704.12  0.352    778.38  793.92  823.26  823.26  dual  85.5%  823%
300 xs 200     4.79      99.2%   758.96  0.560    886.42  918.45  961.30  961.30  dual  79.0%  320%
500 xs 500     1.36      74.2%   385.70  1.027    504.54  542.39  563.51  563.51  dual  68.4%  113%
1000 xs 1000   0.44      35.5%   231.95  1.844    360.27  407.34  381.85  407.34    ph  56.9%  40.7%
3000 xs 2000   0.12      11.4%   141.83  3.812    304.02  360.07  249.21  360.07    ph  39.4%  12.0%
5000 xs 5000   0.02       1.7%    39.11  9.666    152.54  166.24   70.13  166.24    ph  23.5%   3.3%
```

Monotone loss ratio 85.5% down to 23.5%, monotone rate on line, no clamp fired,
and the two distortions take turns binding. The last layer is spelled
`rol 3.32%` because its annual attachment probability is under 10%; the rest are
spelled as deposits. Push on to `10000 xs 10000` and `50000 xs 50000` and the
minimum rate on line takes over at 1%.

## Steps

### [stats] closed-form layer statistics, no build

New `src/aggregate_api/layer_pricing.py`. The constants block above, then:

```python
def layer_moments(obj, basis, attach, limit, share=1.0) -> tuple[float, float]:
    """(mean, sd) of the annual loss in one layer, off the gross object."""
```

Finding 1's arithmetic. `basis` is `"occurrence"` or `"aggregate"`, matching the
vocabulary of the quantiles route. Occurrence reads `obj.sev.sf` on the midpoint
grid `arange(attach, attach + limit, bs) + bs / 2` and compounds through
`obj.frequency.freq_moms(obj.n)`; aggregate interpolates `obj.density_df.S`. An
unlimited limit runs to the end of the lattice. Document the `E[Y^2] = 2 *
integral of y S(a + y) dy` identity in Notes, and that the figures tie to
`reins_stats_df` exactly (quote the comparison above).

```python
def attachment_probability(obj, basis, attach) -> float:
    """P(the layer is hit this year)."""
```

Aggregate: `S_agg(attach)` straight off `density_df`. Occurrence: `1 - exp(-n *
S_sev(attach))`, exact for Poisson and a close reading otherwise, which is all
the deposit / `rol` spelling decision needs. Say so in Notes.

```python
def indication(obj, basis, attach, limit, share=1.0, cede=CEDE) -> dict:
    """The no-build quote: el, sd, cv, count, lol, pr_attach, premium, rol,
    spelling, and the loss ratio."""
```

The standard deviation load, the floor and the gross-up, with no distortion
term. Because the quote is a maximum that includes the standard deviation load,
**the indication can only be revised upward**, never down. State that in the
docstring: it is what makes showing it on the form honest.

### [quote] the per-layer quote, with the distortion maximum

Same module:

```python
def layer_quotes(uw, obj, layers, cede=CEDE) -> list[dict]:
    """One quote per layer: the maximum of the standard deviation load and the
    two distortion prices, floored, grossed up, rounded."""
```

`layers` is a list of `(basis, share, limit, attach, label)`. Per layer: render
the single-layer auxiliary program with
`obj.reins_program(f'{basis} ceded to {head}{limit} xs {attach}')` (where `head`
is `f'{share * 100:g}% po '` for a partial placement and empty otherwise), build
it at `PRICE_LOG2` through the same build path the rest of the api uses, clip
and renormalize `density_df.p`, price it with the two distortions, take
`est_m` and `est_sd` for the standard deviation load, and combine. Return every
component, not just the winner: the Reins tab shows them and the demo is more
interesting for it.

Build the two `Distortion` objects once at module level; they are stateless.

### [clause] writing the premium into the clause

Same module:

```python
def price_clause(uw, obj, cession, cede=CEDE) -> tuple[str, list[dict]]:
    """Rewrite one composed cession clause with a premium on every layer."""
```

1. `program = obj.reins_program(cession)` and build it, which is the build
   `post_reins` already does.
2. Read the layer triples and labels off the built object: `occ_reins` /
   `agg_reins` give `(share, limit, attach)` in the library's own order, and
   `spec['occ_reins_label']` / `spec['agg_reins_label']` give the `as` labels.
   Verified present. `occ_kind` / `agg_kind` give `net of` or `ceded to`.
3. `layer_quotes` on those triples.
4. Re-compose the clause from the triples, the labels and the quotes, and return
   it with the quote rows.

Re-composing from the triples rather than editing the caller's string is the
point: the library's reading of the clause is authoritative, so a placement or a
limit the row spelled loosely cannot diverge from what gets priced.

### [route] two routes

`src/aggregate_api/routes/objects.py`.

- `ReinsProgramRequest` in `models.py` gains `price: bool = False` and
  `cede: float = 0.0`. `post_reins`, when `price` is set, runs `price_clause`
  first and then builds the priced program, returning that as the derived text.
  The unpriced path is untouched, so the route stays usable both ways and every
  existing test holds.
- New `POST /v1/objects/{oid}/layers/indication`, taking a list of
  `(basis, attach, limit, share)` and returning one `indication` row each. No
  build, so it is cheap enough for the preview line. New
  `LayerIndicationRequest` / `LayerIndicationResponse` in `models.py`.

Both get the usual 400 when the object cannot cede and a 422 on a layer the
library refuses.

`api.js`: `reins` gains the two optional fields, and a new
`layerIndication(id, layers)`.

### [form] the preview line quotes the layer

`web/src/main.js`, `renderCessionPreview`. After composing the clause, ask for
the indication on the span's single-layer reading and append it:

```
Preview: occurrence net of 95% po 1000 xs 1000
         EL 232, lol 23.2%, 0.44 claims, cv 1.84, indication 360 (LR 64%)
```

Same debounce, same stale-ticket guard and same dimming the quantile lookup
already uses, since this is a round trip on the same keystroke. The indication
is labeled as such, because the press can revise it upward.

Both buttons pass `price: true`.

### [frame] the Reins tab shows the components

The per-layer frame on the Reins tab gains the quote columns from the last
pricing run: `sd_load`, `ph`, `dual`, `binds`, `premium`, `rol`, `LR`. This is
where the demo gets its story (watch `dual` bind low and `ph` bind high), and it
is free, since `layer_quotes` already returns every component.

### [tests] `tests/test_layer_pricing.py`

- `layer_moments` ties to `reins_stats_df` on both tiers and on a mixed
  frequency, to 1e-6 relative on occurrence and 1e-3 on aggregate.
- The loss ratio is monotone decreasing up a six-layer tower.
- The minimum rate on line binds on a remote capacity layer and nowhere lower.
- An aggregate layer prices at a lower loss ratio than the occurrence layer at
  the same probability pair.
- `cede` grosses up exactly: `written * (1 - cede) == technical`.
- A layer with annual attachment probability under 10% is spelled `rol`, one
  above it `deposit`, and an unlimited layer is always `deposit`.
- Share scaling is linear in `el` and in the premium, and leaves `cv` alone.
- The priced clause round trips: `price_clause` output parses, and the premium
  survives `pnl_program`.
- Determinism: two calls give byte-identical clause text.
- The route: `price: true` returns a program carrying `deposit` or `rol` on
  every layer; `price: false` returns today's text unchanged.

### [bump] version and notes

`pyproject.toml` to `1.0.0a197`, a `CHANGELOG.md` section, tick the
`cession` item in `dev/TODO.md` (the library glue it was waiting on exists now),
move this plan to `dev/done/`, `uv sync --extra dev` to re-record the version,
and `.\scripts\build-web.ps1` because `web/` moved.

## Files touched

```
src/aggregate_api/layer_pricing.py      new, the whole method
src/aggregate_api/models.py             price / cede on the reins request; the
                                        indication request and response
src/aggregate_api/routes/objects.py     post_reins gains pricing; the new
                                        indication route
web/src/api.js                          reins fields, layerIndication
web/src/main.js                          preview line, both button calls, the
                                        Reins frame columns
tests/test_layer_pricing.py             new
pyproject.toml CHANGELOG.md dev/TODO.md
```

Roughly 200 lines of Python and 60 of JavaScript, most of it in one new module.

## Acceptance check

1. `uv run pytest` green.
2. Build `agg Demo 100 claims 20000 xs 0 sev lognorm 50 cv 4 poisson`, go to the
   Reins tab. The preview line reads the clause **and** an expected loss, a
   claim count and an indication, and all three track the boxes as you type.
3. Set attach `50%`, detach `99%`, press **Tower**. The program in the editor
   carries a `deposit` on every layer, descending up the tower, with the top
   layer or two spelled `rol`.
4. The Reins per-layer frame shows `sd_load`, `ph` and `dual` side by side, with
   `dual` binding low in the tower and `ph` binding high.
5. The loss ratio column is monotone decreasing, and no layer is quoted below
   1% rate on line.
6. Press **PnL**, then **xPnL**. The ledger carries the ceded premium layer by
   layer, and the per-layer margins and loss ratios are the quoted ones.
7. Press **Tower** twice with the same boxes on the same gross object. Identical
   program text.
8. Switch the tier to aggregate over the same probability band. The aggregate
   quote carries a markedly lower loss ratio than the occurrence one did.

## Notes

**The ignored-premium warning.** On the intermediate `agg` the premium is
carried in the text and not in the model, and the build reports
`IgnoredDecLClauseWarning`. This plan accepts that rather than suppressing it or
gating pricing behind a P&L: the warning is accurate, the program text is
complete, `pnl_program` inlines it, and PnL is one press away. If it proves
noisy in the demo, the next move is to have the pricing press offer the P&L wrap
rather than to hide the warning.

**`ROL_THRESHOLD = 0.10` is a high bar.** On the worked tower only the top layer
clears it. asp's own rule of thumb is looser ("claim count to layer < 0.5"),
which would put the top three layers on a rate on line. 10% on the annual
attachment probability is what was asked for, and it has the merit of biting
in the same place as the minimum rate on line, so the two top-of-tower
behaviors arrive together. The constant is one line if more layers should quote
on a rate.

**No aggregate surcharge, deliberately.** The ordering holds at equal percentile
pairs, measured above, which is the reading the Quick Re boxes give. It is not
guaranteed at equal annual attachment probability. If a demo ever shows the
wrong ordering there, the fix is a second `LAMBDA` for the aggregate tier
(`1.5 * LAMBDA` would do it), not a clamp.

**Quota shares are out of scope.** Rule 5 of the asp list ("QS cheaper than occ
layers") concerns a `rate` basis premium, a share of subject premium, which has
no meaning without a premium context and belongs with the P&L work rather than
here. A ground-up unlimited layer priced by this method gets a deposit, which is
correct but is not how a quota share is quoted.

**Rule 6 is not enforced.** "Only QS and well-balanced layers can have cedes" is
a sensible refusal and this plan simply does not add a commission box, so the
case cannot arise from the UI. The gross-up is implemented and tested so the box
is a one-line addition later.

## An observation for the author, not part of this plan

`main.js` says of **Tower**: "This cedes like Add re rather than replacing what
is there, so pressing it on an already ceded object adds a tier's worth of
layers." Measured, the library **replaces** the tier's program in both spellings:

```
gross:  ... occurrence net of 1000 xs 1000 as "Occ 1" poisson
after reins_program('occurrence net of 3000 xs 2000'):
        ... occurrence net of 3000 xs 2000 poisson
```

The `1000 xs 1000` layer is gone. So either the comment records an intention the
library no longer honors, or it was never true. It does not block this plan (it
makes the layer list to price simply the composed clause's own layers), but the
comment and the behavior disagree and one of them is wrong.
