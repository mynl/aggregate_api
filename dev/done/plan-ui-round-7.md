# plan-ui-round-7: four GUI tweaks

Author report, 2026-08-27, six items. Two of them (the bivariate program, the
SpaceMouse feel) turned out to need no code here and are recorded at the end.
The four that do are A to D below, and they land as one version bump.

---

## A. The editor wraps

**Report.** "Text in the edit box should wrap. Sometimes you load in a decl with
a long note. It should wrap."

**Diagnosis.** `web/src/editor.js` assembles the CM6 extension list without
`EditorView.lineWrapping`, so `.cm-scroller { overflow: auto }` answers a long
line with a horizontal scrollbar. A `note{...}` body is the case that makes it
hurt: it is one run of prose on one line, and it is the part of a program a
reader most wants to read.

**Change.** Add `EditorView.lineWrapping` to the extension list.

**What it does not disturb.** The 54px right channel in the `.cm-content`
padding is a reserved lane that keeps a line clear of the history step buttons;
wrapping respects padding, so a wrapped line now stops at the lane rather than
running under it, which is what the lane was for. `minHeight: 10.2em` is a floor
and stays a floor. `maxHeight: 40vh` on the scroller still caps the growth, so a
very long note scrolls vertically instead of horizontally.

---

## B. Economics becomes PnL

**Report.** "Change the name of the Economics tab to PnL (you think? or P&L?)."

**Ruling, taken here.** `PnL`, not `P&L`. The Derive button that creates the
object is already labeled `PnL`, the DecL keyword is `pnl` and the route is
`/pnl`, so a reader presses `PnL` and should land on `PnL`. Prose keeps `P&L`,
which is what the page already writes everywhere it explains itself ("wrap this
object in a P&L", "a P&L only", "the P&L sheet, line by line"). Two spellings
with two jobs, which is the house pattern for an identifier against its prose.

**Change.** Five user-visible strings.

| file | line | what |
|---|---|---|
| `web/index.html` | 387 | the tab's label **and** its `data-label` ghost |
| `web/index.html` | 105 | perspective menu comment, "Economics Ledger / Ratios / Waterfall" |
| `web/index.html` | 513 | Evaluate prose, "the reading Economics answers" |
| `web/index.html` | 673 | the Help panel's group list |
| `web/src/nav.js` | 200 | `label: 'Economics'` |

**The key stays `economics`.** It is in `data-tab`, in the pane ids
(`t-economics`, `pane-economics`), in `NAV_GROUPS`, in the leaf ids the sticky
view state stores and in any link already shared. Renaming a label is a label
change; renaming the key would break stored state for a cosmetic gain.
`data-label` must move with the label or the width ghost measures the wrong
word, which is the failure D is about.

---

## C. Comments survive the build, and three programs that build nothing get an
answer

Three related things on the build path, in one section because they are one
function's worth of edit.

### C1. `#` comments are swallowed

**Report.** "The edit box does not seem to strip out # comments. You get
'unexpected end of file'."

**Diagnosis.** `routes/objects.py` `collapse_program` folds the whole program
onto one line before anything parses it:

```python
return re.sub(r"\s+", " ", decl.replace("\\", " ")).strip()
```

A leading `# a note` therefore swallows the program behind it, and the library
preprocesses what is left to zero statements. `//` fails the same way. The
docstring states the assumption that made this safe, and it is no longer true:
"`#` comments are not accepted in the input box, so nothing gets swallowed."
Measured against the running app:

| program | now |
|---|---|
| `# a note` newline `agg A 5 claims sev lognorm 10 cv 1.2 poisson` | 422, "expects a single output, got 0" |
| the same program with a **trailing** `# comment` | 200 |

The trailing case passes only because `build()` preprocesses downstream. It was
never the comment rule working.

**Change.** Depend rather than reimplement: run the library's own
`UnderwritingLexer.preprocess`, join its statements with a space, then keep the
existing whitespace collapse.

```python
text = UnderwritingLexer.preprocess(decl.replace("\\", " "))
return re.sub(r"\s+", " ", " ".join(text)).strip()
```

`UnderwritingLexer.preprocess` is public and is already imported in
`routes/decl.py` for a137's `_every_statement_parses`, so the sanctioned import
surface does not move. It is also the only place the comment rules exist: full
line and inline, `#` and `//`, with `note{}` / `tags{}` / `hints{}` bodies
lifted out first so a `#` in prose stays prose. Reimplementing that here would
be a second copy of a rule the library owns.

**Verified byte identical on every comment-free program.** Prototyped against
nine, including a multi-line `port` with two `agg` lines, a `dsev` vector, the
bivariate `dbvsev` nested matrices, and `note{a # hash in prose}`. Old and new
agree exactly on all of them; only the commented cases change, and they change
to correct. This matters beyond tidiness: `collapse_program` computes the cache
key, and a key that moved would silently miss every stored object.

### C2. A program that holds no statement

`collapse_program` can now return `''`, from a program that is only comments.
Today that reaches the library and comes back as "build() expects a single
output, got 0; use build_many() for batched programs", which is an answer about
`build_many` to a reader who wrote a comment.

**Change.** Guard immediately after the collapse: an empty result is a 422
saying the program holds no statement, that it is empty or all comments. The
check stays on the server because the comment rules are the library's, and a
client that knew when a program was comments-only would be holding a copy of
them.

### C3. The empty box, and arithmetic

**Report.** "If you build '' then the status bar gives you a friendly hint
message. I'd kinda like to be able to build math expressions too and just have
the answer in the status bar, but not if that is hard."

**It is not hard, because the library already does it.** `decl.lark` carries
`answer: ... | expr -> answer_expr`, and full arithmetic is reachable through
the paren island. Measured:

| program | `build()` returns |
|---|---|
| `(2+2)` | `4.0` |
| `2/3` | `0.6666666666666666` |
| `(2**10)` | `1024.0` |
| `(exp(1))` | `2.718281828459045` |
| `(1e6/7)` | `142857.14285714287` |

So this is not a calculator the app writes. It is a kind of answer the library
already gives and the app currently refuses: `POST /v1/objects` builds the float
and then rejects it at the classify step with "api supports 'agg', 'port',
'sev', 'distortion', 'bvagg', 'pnl' only; got 'float'". Serving it is the
purist reading, not an exception to it: the library owns what a program means,
including when it means a number.

**Change, server.** `models.ValueResponse`, a small model with
`kind: Literal["value"]`, `value: float`, `decl: str` and `elapsed_ms: int`. The
route's `response_model` becomes a union discriminated on `kind`, which works
because `BuildResponse.kind` is already a `Literal` of the six object kinds.
Before the `SUPPORTED_KINDS` refusal, a numeric result returns a
`ValueResponse`. No cache slot (there is no object to hold), no session recipe
registration, and the audit row records status `value` so the operator page does
not count arithmetic as object builds.

The float is sent raw and formatted by the app's own `fmt`, which is what
already prints `mean` and `CV` off the build response. No new precedent, and no
format invented server side for a number the library hands over bare.

**Change, client.** `main.js` `build()`:

- The box is empty (`if (!decl) return;` today, silently). Write a friendly line
  to the status strip instead: nothing to build, type a program or an expression
  in parentheses, and the key to press. No request.
- The answer is a `value`. Write `<decl> = <fmt(value)>` to the status strip's
  first line, and otherwise treat it as any build: `forgetBuild`, `clearPanes`,
  `renderActionRow`. A number is what the box now holds, so an object pane from
  the previous program would be a tab showing one thing while the strip shows
  another.

**The one judgment call, stated rather than buried.** Evaluating `(2+2)` drops
the object you had. The alternative, keeping it, leaves the page in a split
state where six tabs answer for a program that is no longer in the box. The
previous program is one `Ctrl+↑` away, because it is still in history.

**Not recorded in history.** The ring is the trail of programs that built
something, and `rebuildMissing` walks it looking for declarations. Arithmetic
in it would be noise in both readings.

---

## D. The tabs stop moving

**Report.** "The tabs all jitter when they are not enabled and you mouse over
them and the tooltip appears. They should not move at all. At the moment they
get slightly narrower."

**Diagnosis.** Two rules in `site.css` fight over one pseudo-element. The first
reserves bold width so selecting a tab does not shove the strip along
(`site.css:546`):

```css
.out-tabs .nav-link::after, .sub-tabs .sub-link::after {
    content: attr(data-label);
    display: block; height: 0; overflow: hidden; visibility: hidden;
    font-weight: 700;
}
```

The second reuses **the same `::after`** as the tooltip (`site.css:643`) and
sets `position: absolute`. Absolute takes it out of flow, so its contribution to
the element's intrinsic width vanishes and the tab collapses to its
`font-weight: 400` width for exactly as long as the pointer is on it. Narrower,
which is what was reported. Both levels do it: sub-links carry the same ghost
and the same `data-label` (`main.js:1296`).

There is no pure-CSS escape that keeps everything. `::before` is already the
arrow and an element has only the two.

**Change.** Move the tooltip and its arrow out of the pseudo-elements and into
one shared node, owned by `utils/tip.js`, which already runs on hover to compute
`--tip-shift`.

- `mountTipClamp` becomes `mountTips`: it creates a single
  `<div class="tip" role="tooltip">` on `document.body`, fills it from the
  anchor's `data-why` on `pointerenter` / `focus`, positions it `fixed` under
  the anchor with the existing clamp, and hides it on `pointerleave` / `blur`,
  on scroll and on resize.
- `tipShift` keeps its arithmetic and its test. It stops guessing against a
  `TIP_WIDTH` constant that mirrors a CSS `max-width` it admits it cannot
  measure, because a real node can be measured.
- The arrow becomes `.tip::after` and is offset by the anchor's center against
  the box's left edge, written as `--tip-arrow`. That preserves the rule the
  module states: the box slides to stay readable, the arrow keeps pointing at
  the control.
- `site.css` loses the two `.nav-off[data-why]:hover` blocks and gains a `.tip`
  block with the same look, unchanged. `.out-tabs .nav-link::after` is then the
  ghost and only the ghost, and nothing moves.

**Untouched on purpose.** Screen readers never read the pseudo-element; a dark
tab explains itself through `aria-label`, set beside `data-why` in
`applyCapabilityGating`. That path does not change.

**Also true, and out of scope.** `.out-tabs` carries `overflow: visible` with a
comment saying it must, because a scroll container would swallow a tooltip
hanging below it. A body-level node lifts that constraint. Not acted on here:
nobody asked for a scrolling strip on the desktop, and the change is worth
making on its own merits or not at all.

---

## Tests

- `web/test/tip.test.js` covers `tipShift` and is updated for the new module
  shape. The arithmetic it asserts does not change.
- New Python tests for the build path: a program with a leading `#` comment
  builds, one with `//` builds, a `note{}` body holding a `#` keeps it, a
  comments-only program answers 422 with the new message, and `(2+2)` answers
  200 with a `value` payload.
- `dev/scripts/check-nav.mjs` asserts the group order in `index.html` matches
  `NAV_GROUPS`. It reads keys, not labels, so B does not disturb it. Run it.

## Housekeeping

Version to `1.0.0a138`, `CHANGELOG.md` section, `dev/TODO.md` ticked, this doc
to `dev/done/`. `uv sync --extra dev` after the bump or `/v1/meta` reports the
old version.

---

## The two items that need no code here

**The bivariate program is correct.** The author's

```
bivariate BivariateDiscreteSparse
  25 claims
  dbvsev [1 10 20] [1 2 50] [[0 0 0.15] [0.4 0.1 0] [0.2 0.15 0]]
```

builds because `decl.lark:251` has a no-frequency production,
`BIVARIATE name exposures dbvsev trailer -> bv_out_discrete_nofreq`. The
frequency is **Poisson**, the library default, and the count is the shared 25.
The matrix sums to exactly 1. Verified: `shared frequency poisson`,
`claim count 25.000`, `correlation 0.087817`.

It is `library.agg`'s `BivariateDiscreteSparse` after Reformat, with `fixed`
removed by hand. The library entry reads `5 claims`, the sparse triple form of
`dbvsev`, and `fixed`; `format_program` expands the triples to the dense matrix
and keeps both the count and `fixed` correctly.

**But Reformat drops `note{}` and `tags{}`, on every program.** Found while
checking the above:

```
IN : agg A 5 claims sev lognorm 10 cv 1.2 poisson note{keep me} tags{topic:x}
OUT: agg A / 5 claims / sev lognorm 10 cv 1.2 / poisson
```

`format_program` renders no trailer. The app writes the answer back over the
editor with `editor.setText`, so pressing Reformat is how a reader loses the
note they wrote. That is a137's bug one layer down, and it is LIB's: the app is
right to write back what it is served. **Raise as an upstream ask**, not fixed
here.

**SpaceMouse: the settings are right, the load is not.** `NAV_DEFAULTS` is what
a136 restored, and the camera settings match the testbed exactly
(`surface-lab.html:2507`, `damping: 0.85, zoomSensitivity: 1`). The difference
is what they drive. The lab draws `n: 96`, so 9,216 vertices; the real document
for the author's bivariate comes back `nx 256, ny 256`, so 65,536, because the
app never sends `detail` and the library's own value stands. On top of that,
every puck frame goes through `chart.setOption({grid3D: {viewControl: ...}})`
(`mount.js:1305`), a full option merge sixty times a second, where a mouse drag
runs inside echarts-gl's `OrbitControl` and touches no option at all. Two levers
if it comes back: send `detail` (the route accepts it, the app has never used
it), or drive `OrbitControl` directly, which reaches a private handle in
echarts-gl and wants its own decision. The author is testing on a small surface
first, which is the right next measurement.
