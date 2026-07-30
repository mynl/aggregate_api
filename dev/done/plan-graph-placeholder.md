# plan-graph-placeholder: a fixed box, and a skeleton in it

Status: **done**, landed as `1.0.0a29`.

## The ask

> First we MUST get a fixed placeholder for graphs. else too distracting, plus we
> need some symbol in the placeholder that a graph is forthcoming.

Two things: the box must not move, and it must say a graph is coming.

## What was actually wrong

a28 already reserved the chart height before fetching, so the expectation was a
small cosmetic job. Measuring first turned up something larger.

`reservedHeight(width)` took **only a width** and always returned the two-panel
geometry. Two of the six kinds do not use that layout:

| kind | host 1000 (wide) | host 560 (narrow) |
|---|---|---|
| agg / port / sev / pnl | reserved 347, rendered 347 | reserved 730, rendered 730 |
| distortion | reserved 347, rendered **498** | reserved 730, rendered **498** |
| bvagg heatmap | reserved 347, rendered **498** | reserved 730, rendered **478** |
| bvagg surface | reserved 347, rendered **480** | reserved 730, rendered **480** |

133 to 151 px down the page on a wide screen, 232 to 252 px up on a narrow one,
guaranteed, on every distortion or bivariate.

Three smaller leaks alongside it:

1. `reservedHeight` hardcoded `twin: true`, so a `rightLogY: false` view ran about
   21 px short.
2. The three square call sites disagreed. The surface set
   `option.hostHeight = side + 60`; the distortion and heatmap set nothing and fell
   through the mount's `grid.height + grid.top + 52` guess to `side + 78`. Two
   formulas for the same square, so the 3-D toggle resized the box by 18 px.
3. The control row rendered *after* the data landed, so a perfectly reserved chart
   was still pushed down by a button row on arrival.

## What landed

**One layout, declared per exhibit.** Every `EXHIBITS` entry has a
`layout(width)` returning the geometry and the host height. `mountExhibit` calls it
once before the fetch and passes the same box into `build()`, which never derives
geometry again. `reservedHeight(width, kind)` dispatches through the same function.
Reservation and render cannot disagree because there is only one of them.
`chartHeight()` is deleted.

**`SQUARE_CHROME`**, one constant, `PAD_TOP + 52`, for all three square exhibits.

**The bivariate's pads stopped being per renderer.** Sizing the surface from its
own narrower pads made `layout` depend on `surfaceReady`, which only turns true
once the lazy chunk lands, so on a narrow screen the box was reserved as a heatmap
(478) and drawn as a surface (498). A layout that depends on async state cannot be
reserved ahead of that state resolving, so this one depends on none. The surface
draws at the heatmap's side.

**`showPlaceholder(host, kind, width)`** fills the box with the exhibit's outline:
panels at the exact grid geometry, titles at `top - 24` where the chart puts its
own, a centered `bi-graph-up`, dashed border, faint fill, a slow shallow pulse that
drops out under `prefers-reduced-motion`. The chart lands on top of its own
outline instead of replacing a differently shaped block.

**Controls render up front.** They depend on the width and the spec, never on the
payload. `redraw()` no-ops until there is something to draw, so a toggle pressed
mid-fetch records the view and is honored when the data arrives. The `ready` flag
is declared before the controls are wired, not beside the chart it guards: a `let`
further down would be in its temporal dead zone when a mid-fetch click read it.

**`loadStyle()` moved into the mounts**, so its round trip also happens behind the
skeleton, and `main.js` stopped juggling `minHeight` around a guess it should never
have been making.

## Verification

`dev/smoke-exhibits.mjs` asserts `reservedHeight(width, kind)` equals the built
option's `hostHeight` for every kind at both breakpoints. That is the invariant
this plan is about, and nothing checked it before because nothing compared the two
numbers. All twelve checks pass; the square kinds now report their host heights
alongside their side.

`uv run pytest` 92 passed. `npm run build` clean, app chunk 39.47 kB gzip
(39.16 at a28), `echarts-gl` still absent from `index.html`.

Not verified: how any of it looks. The Chrome extension has still never connected
in any session.
