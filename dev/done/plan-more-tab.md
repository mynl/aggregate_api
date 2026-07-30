# plan-more-tab: More becomes a tab, Bounds appears, Reins gets its exhibit

Status: **done** (1.0.0a25). Stage 5 of the aLL work.

## Why

The author asked, at planning time, whether More would be better as tabs like
Reins. It would, and for a reason worth stating: the tab bar had two different
kinds of control in it. Four pills opened panes, the fifth opened a menu, so
half the output views behaved one way and half the other. That is the sort of
inconsistency a user absorbs as "this app is fiddly" without being able to name.

Reins had also been shipping numbers only. Gross, ceded and net is the question
a reinsurance structure exists to answer, and the tab was answering it in a
table.

## What landed

### More as a tab

Top bar: Overview · Plot · Price · Reins · Bounds · More. More's pane carries a
`tab-tools` row exactly like Reins: Validation | Stats | Density | bs window |
Info (raw).

Five panes collapse to one `#pane-more`, driven by a `MORE_VIEWS` registry that
holds each view's label, hint line, whether it offers a copy button, and its
loader. The hints used to be duplicated in the markup per pane; now there is one
of each.

**Info moved into More**, and that had a consequence worth calling out: a failed
build used to render its parse-error report into the Info pane and switch there.
A failed build has no object, so sending the reader into a sub-menu to read why
is backwards. The error now lands on the Overview tab.

### Bounds

A greyed-out sixth pill with a pane that says it is not wired up. Per the
standing rule that the menu set never changes shape: visible and plainly not
ready beats absent and unmentioned.

### The Reins exhibit

`mountReinsExhibit` reuses `twoPanel`, so the Reins tab reads the same way the
Overview does. Three series (gross, ceded, net), gross first so the cession
reads as something taken out of it and `net` draws on top where the two nearly
coincide.

`reins_density_df` has the masses and no survival, so `S` is accumulated. Exact,
since each `p_agg_*` is a pmf over one grid summing to one. Clamped at zero: the
accumulation overshoots by a few parts in 1e15 and `-3.6e-15` is not a value to
hand a log axis.

### Gating, reworked

Top-level gating is now just `price` and `reins`; everything else a kind lacks
is a sub-view and greys out inside More. A sticky sub-view the current kind
cannot answer falls back instead of firing a request that would 400.

## Verified

`uv run pytest` 86 passed, `ruff` clean, bundle builds (app chunk 35.0 kB gzip).
`node dev/smoke-exhibits.mjs` clean across eight cases including the new `reins`
one.

Worth recording: the reins check initially asserted every survival *starts* at
1, which failed. It was the test that was wrong, and the failure was
informative. The ceded distribution is small next to the gross, so on a grid
scaled for the gross its entire mass lands in the first display bucket, and its
survival correctly starts at 0. The assertion is now non-increasing, bounded,
finishing at zero.

That is also a real display observation: on the linear cropped view the ceded
density is a spike in the first bucket. The `log y` and `full x` toggles are the
answer for now; if it stays hard to read, the exhibit should crop to the
**gross** support per series rather than share one window.

Appearance remains unverified across every stage: no rendered chart has been
inspected in any session.
