# plan-exhibit-punchups-3: resolution, aspect, orientation, controls

Status: **done** (1.0.0a26), for ten of the twelve reported items. The other two
are open questions rather than work and are carried in `dev/TODO.md`. Author
feedback after the first visual inspection of the ECharts exhibits.

## What was reported

Twelve items, from a live look at the app. Grouped by what they are really about.

### The one that matters most: resolution

> very localized spikes ... appear far too fat. on the scale they should look
> like vertical spines. this kinda indicates there is a gross loss of resolution
> on the x-axis.

Correct, and worse than it looked. Measured on the reported program:

```
agg ExposureRating2
  [1000 2000 10000 500] premium at [0.9 0.85 0.9 0.8] lr
  [250 500 1000 2000] xs 0
  sev lognorm 120 cv 4
  occurrence ceded to 750 xs 750
  mixed gamma 0.2
```

builds at `log2=16, bs=1`, and its density is not "spiky", it is **atomic**:

| loss | mass |
|---|---|
| 0 | 0.0862 |
| 250 | 0.1290 |
| 500 | 0.1004 |
| 750 | 0.0569 |
| 1000 | 0.0271 |
| 1250 | 0.0114 |

each in a **single** `bs = 1` bucket, against a continuum of roughly 0.0007 per
bucket either side. The layer limits (`250 500 1000 2000 xs 0`) and the
`750 xs 750` occurrence cession put atoms in the severity, and the aggregate
inherits them at every multiple.

The display grid was `2**11 = 2048` rows, so at `log2 = 16` it summed **32** fine
buckets into one. The atom at 250 landed in a bucket labeled 256 carrying 0.1290
plus 31 neighbours' worth of continuum, and the panel then joined bucket centers
with a straight line, drawing a triangle 64 loss units wide where the truth is a
spine 1 unit wide. The location was only known to plus or minus 16.

The survival "jumps down essentially vertically" for the same reason and is the
same observation: at an atom the survival really does drop by 13 points of
probability over one bucket. That part was right all along.

**Fix.** Raise the display grid, bounded by a cell budget rather than a row count
so a wide frame (a portfolio's per-unit densities) does not blow the payload:

* `DENSITY_DISPLAY_LOG2` 11 to 13 (8192 rows), and
* `display_log2_for(n_cols)` backs that off so a frame stays under roughly 2**16
  cells. Four columns keep the full 2**13; an 11-column portfolio frame settles
  at 2**12.

At `bs' = 8` on a 2260-wide crop window the atom is a 2.5 px spine standing 24x
above the continuum, which is what a spine is. Payload for the four-column case
goes 0.12 MB to 0.49 MB, about 0.15 MB gzipped.

What this does **not** fix: the atom is still smeared across one display bucket
rather than drawn at its exact loss. Doing that properly means splitting the
frame into atoms (exact loss, stem) and continuum (binned, line), which is a
different frame shape and a bigger change. Recorded in `dev/TODO.md`.

### Aspect ratio

> pick up house style FIG_W and FIG_H from aggregate and try to maintain that
> aspect ratio. Eg when you jump to 2 x 1 format on a narrow screen make sure
> they aren't the wrong shape (they are ATM).

They were badly wrong. `FIG_W = 3.5`, `FIG_H = 2.45`, so the house panel is
1.43:1. The stacked layout hardcoded `height: 150` against a full-width panel,
giving about 3.5:1 on a 600 px screen. Side by side came out near 1.8:1.

Both are now computed: the panel width falls out of the host width and the
margins, and the height is `width / (FIG_W / FIG_H)`, clamped. `FIG_W` / `FIG_H`
ride along on `/v1/meta/style` with the colors, so there is still exactly one
source for the look.

### Orientation

> Can we have exceedance be loss and exceedance on the yaxis? I don't like the
> transpose.

The survival orientation becomes the default and the transposed return-period
view becomes the toggle, rather than the other way round. A second y-axis on the
right of that panel reads the same curve as a return period, so the capital
question is answered without transposing anything: `1e-5` exceedance and
`1-in-100,000` are the same gridline.

> But can we then have either horiz tooltips and tracking line, or both h and v?

Both: `axisPointer: {type: 'cross'}` on that panel.

### Controls

> Can we put the option buttons nearer the plot to which they apply (survival on
> the right). Just separate visually eg | would work. Maybe left group | both
> (ref lines) | right group. logy should apply to survival too.

Three groups with rule separators: density controls, then reference lines, then
right-panel controls pushed to the right half so they sit over the panel they
drive. `log y` splits into two independent toggles, one per panel, which is what
"logy should apply to survival too" asks for: the right panel's y is a
probability in survival mode and a loss in return-period mode, and log is
readable for both.

> the TABLES static | interactive should use the same buttons as the graph
> options. different color though.

Same `.exhibit-toggle` shape, `.exhibit-toggle--table` for the color.

### Log floor

> log scale for plots should never go below 1e-15 because below that it is just
> fp noise

`LOG_FLOOR = 1e-15`. Values at or below it become gaps rather than points, and
the axis minimum never goes under it.

### Grid chrome

> Price tab: we don't need the expand/contract buttons on any of the tables. Can
> we have a general rule that say <= 10 cols no expand / contract buttons?

`expandButtons: columns.length > 10`, was `>= 6`.

### Reinsurance

> buttons should offer all the cols of the displayed dataframe: occurrence (sev)
> or aggregate / ceded to occ, or occ and agg / show resulting gross, ceded, net

`reins_density_df` carries exactly three triples, so the controls are the frame's
own structure:

| basis | stage | gross | ceded | net |
|---|---|---|---|---|
| occurrence | | `p_sev_gross` | `p_sev_ceded` | `p_sev_net` |
| aggregate | after occurrence | `p_agg_gross` | `p_agg_ceded_occ` | `p_agg_net_occ` |
| aggregate | after aggregate | `p_agg_subject` | `p_agg_ceded` | `p_agg_net` |

The second row's "gross" is the library's `p_agg_subject`, the input to the
aggregate cover, which equals the true gross only when there is no occurrence
cover. Labeled `subject` rather than `gross` for that reason.

### Tab order

> Move Reins tab before Price tab.

Overview, Plot, Reins, Price, Bounds, More.

## Not implemented, asked instead

* **"we need better rules for what to plot"** is too broad to act on without
  knowing which plot it refers to.
* **Reins-aware pricing** (gross / net / allowance, three rows per distortion)
  needs the distortion set calibrated on the **gross** basis, and there is no
  public route to that: `Aggregate.calibrate_distortions` reads the object's own
  `density_df`, which under reinsurance is the net. Doing it here means
  reproducing `aggregate._pricing._calibration_survival` and the CoC to premium
  inversion in this repo, which the house rule forbids. Question put to the
  author: upstream hook, or ship the net-calibrated half.

## Found while verifying, not reported

Checking the resolution fix against the author's own program turned up a wrong
number. Under a cession `actual_m` and `est_m` are **different random
variables**: the analytic mean of the subject book, and the realized mean of the
object's own (net) distribution. `_summary_fields` preferred `actual_m`
unconditionally, so the summary bar read `mean 12000` directly above a
`summary_df` whose Agg row said `549.48`, and the exhibit put its mean reference
line at 12,000 on an axis cropped to 0..2260. A Portfolio inherits it through its
units (1150 against 411).

Now: realized moments under a cession, analytic otherwise. The library was never
wrong; `validation_description` reads "reinsurance; subject not unreasonable",
which is it naming the variable.

## Verified

`uv run pytest` 87 passed, `ruff check src` clean, `node dev/smoke-exhibits.mjs`
over eight fixtures at **both** breakpoints, and a rebuilt bundle.

The smoke test gained two real assertions. It now checks the panel aspect,
because the shape is fully determined by the option object and so is the one
appearance property an offline test can honestly verify:

```
OK   agg    wide 398x279 (1.43) h=375  |  narrow 432x302 (1.43) h=777
```

and it walks all three reinsurance triples rather than only the default, since a
typo in one column name would otherwise sit undetected behind a control the test
never clicked.

Appearance beyond the geometry stays unverified: the browser extension has never
connected in any session, so every other visual claim here is an inference from
the data, not an observation of a rendered chart.
