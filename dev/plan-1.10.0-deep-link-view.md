# Plan 1.10.0: deep links that open a named tab, and Menu ▸ Copy link

## Goal

A URL that can be emailed, which opens the app, builds a named library entry
and lands on a named tab. The motivating link:

```
https://agg.mynl.com/?database=library&example=Capstone.Capped&view=pnl:pentagon
```

builds the capped exploded P&L and shows PnL ▸ Pentagon, scrolled into view.
And a menu item that writes such a link for whatever is on screen, so nobody
writes them by hand.

Two steps, two minors, following the 1.4.0 / 1.5.0 precedent:

- **[view]** `1.10.0`: the page reads a `view=` parameter.
- **[copy-link]** `1.11.0`: Menu ▸ Copy link, writing links that point at the
  public site by default (`AGGAPI_PUBLIC_URL`).

## Current behavior

1.5.0 (`dev/done/plan-1.4.0-example-databases.md`, step [deep-link]) shipped
`/?database=<stem>&example=<name>`:

- `web/src/examples.js` holds the pure halves. `readDeepLink(search)` returns
  `{database, example}` or null. `withoutDeepLink(href)` and `clearDeepLink()`
  remove exactly the `DEEP_LINK_PARAMS` from the address bar once the link is
  applied, so a reload does not rebuild over the reader's work.
  `findLinkedExample(link)` selects the file (and stores it, as the menu does)
  and finds the entry by exact name.
- `web/src/main.js` `loadLanding()` replaces the landing `BasicBook` build
  with `pickExample(found.item)`. A missing entry builds the landing program and
  puts `example "X" not found in Y.agg` in the strip's note slot, opening the
  fold so the note is seen.
- `web/src/lite.js`, the phone page, does the same with its own chips.
  `index.html` redirects phones there and preserves the query.
- `example` alone is looked up in whichever file the *recipient* last picked,
  which is stored per browser. A link meant for someone else must carry
  `database`.

After every build the page stays on whichever group tab was active (Overview on
a fresh load). `adoptBuild` (`main.js`, about line 403) runs `applyCapability`,
then `renderSummary` (which runs `applyCapabilityGating`, so from that moment
the page knows what is live), then `clearPanes`, then `loadActiveTab()`.

The navigation has two levels. `NAV_GROUPS` in `web/src/nav.js` is the
skeleton: seven groups (`overview`, `reinsurance`, `pricing`, `economics`,
`bounds`, `more`, `lab`), each with keyed leaves. Keys and labels differ in
places: the group `economics` is labeled `PnL`, and its leaf `ratios` is
labeled `Summary`. Comments in `nav.js` already say the keys stay fixed because
they appear in "any link already shared". `state.leaf[group]` holds the chosen
leaf per group. `showTab(group)` activates a group through Bootstrap, whose
`shown.bs.tab` handler calls `loadTab(group)`. `selectLeaf(group, key)` moves
within a group.

Nothing in the app writes to the clipboard today; the grids carry their own
copy buttons.

## Decisions

Settled with the author on 2026-10-14:

1. **The parameter is `view=<group>:<leaf>`**, leaf optional. A colon because
   it is the `group:leaf` form `LOADERS` is keyed by, and a dot would read
   badly beside `Capstone.Capped`.
2. **Keys and labels are both accepted, case-insensitive, key first.**
   `pnl:pentagon`, `economics:pentagon` and `PnL:Pentagon` are one view. A test
   asserts that no label shadows a different key at its level, so the order
   never decides anything today; it is there for a future label.
3. **A bare group lands on its first live leaf**, which `activeLeaf` already
   does.
4. **The view is applied once, to the linked build only.** It replaces
   Overview's load rather than following it, so the Overview chart is never
   fetched and then thrown away. A later Build stays where the reader is.
5. **The page scrolls to the view.** The landing build otherwise never moves
   the first paint (the "No scroll here, deliberately" comment in `build()`). A
   link that names a view is the reader asking to see it, so this is the one
   exception.
6. **A view that cannot be shown says so** in the strip's note slot, the way a
   missing example does, and the page stays on Overview. A missing example
   drops the view: the not-found note is the one message.
7. **The phone page ignores `view`.** It has no group tabs, and the Pentagon is
   cramped on a phone. It still builds the example.
8. **No raw DecL in links** (`decl=`). Links name library entries only.
9. **Per-leaf state is not in the link**: not the Pentagon's solvency level or
   gross / ceded / net, not a pricing form's inputs. A later `p=` if wanted.

10. **Copy link writes keys, not labels**: `view=economics:pentagon`. Keys are
    the stable vocabulary; labels are editorial and have changed (`ratios`
    became Summary). Labels are accepted on the way in for links written by
    hand. Copied links need not be human readable, so `URLSearchParams`
    writes the query as it likes, colon encoded as `%3A`.
11. **Copy link always writes `database`**, the default file's stem included,
    because otherwise the recipient's stored choice decides where `example` is
    looked up.
12. **Copied links point at the public site by default.** `AGGAPI_PUBLIC_URL`
    defaults to `https://agg.mynl.com/`. The author works on `127.0.0.1`, and a
    link copied there is useless to anyone else. See [copy-link].

## Step [view], 1.10.0

### Change

- [front-end] `examples.js`. `DEEP_LINK_PARAMS` gains `view`, so
  `clearDeepLink` removes it with the other two. `readDeepLink` returns
  `{database, example, view}`, each trimmed and null when empty, and is
  non-null when any of the three is present.
- [front-end] `nav.js`. New pure `resolveView(text)`. Split on the first `:`.
  Match the group token against `NAV_GROUPS` keys, then labels, lowercased;
  the same for the leaf token within that group. Return `{group, leaf}`
  (`leaf` null for a bare group), or null when a token matches nothing. It
  reads `NAV_GROUPS` at call time, so Lab leaves resolve once the boot manifest
  has installed them (`installLabLeaves`, from the `/v1/meta` fetch, which
  resolves before any build).
- [front-end] `main.js`.
  - `pickExample` returns `build()`'s promise. Its callers ignore the return
    value today, so nothing else changes; `loadLanding` can now await the
    linked build.
  - A module-level `pendingView` holding the raw text. `loadLanding` sets it
    before the linked build and clears it after that build settles, whether or
    not it succeeded, so a later Build never jumps tabs. It is not set when the
    example was not found.
  - In `adoptBuild`, `loadActiveTab()` becomes
    `if (!applyPendingView()) loadActiveTab();`.
  - `applyPendingView()` takes `pendingView` and sets it to null first. It
    resolves the text and checks `groupAvailable` and `leafAvailable` against
    the capability just applied. On success it sets `state.leaf[group]` and
    activates the group:
    - when the group is not already active, record the pending-gesture token
      `pendingNav = {group, scrollY: window.scrollY}` before `showTab(group)`,
      exactly as a live click does, so the existing `shown.bs.tab` handler
      loads the tab and anchors once it settles (`anchorNavSettled`);
    - when it is already active (`overview:tail`), call
      `anchorNavSettled(paneOf(group), loadTab(group))` directly.
    Calling `loadTab` after `showTab` instead would not work: `loadLeaf` marks
    the leaf rendered before its fetch finishes, so the second call returns at
    once and the anchor would fire on an empty pane.
    On failure it records a message, `view "pnl:pentagon" not recognized` or
    `view "pnl:pentagon" not available: a P&L only` (the reason from `whyLeaf`
    or `whyGroup`), and returns false so Overview loads as usual.
  - `loadLanding` puts that message in the note slot after the build settles,
    through the same fold-opening lines the not-found note uses. Factor those
    into one small helper (`noteLinkProblem(text)`) rather than writing them
    twice.
  - A view-only link (`?view=overview:tail`) builds the landing program and
    applies the view. Harmless, and it falls out of the above.
  - The "No scroll here, deliberately" comment in `build()` and the comment
    above `loadLanding` each gain a sentence on the view exception.
- [front-end] `lite.js`. Comment only, at the `readDeepLink` call: `view` is a
  desktop parameter and is ignored here. A view-only link on the phone clears
  the address bar and does nothing else.
- [front-end] `index.html`, Help panel. The link sentence under Examples gains
  `&view=pnl:pentagon` and says what it does.

### Why this insertion point

Between `renderSummary` and `loadActiveTab` is the first moment the page knows
what the new object can show, and the last before Overview starts fetching.
Switching after the build instead would fetch and draw the Overview chart and
then discard it. Setting the tab before the build does not work: before an
object exists every group is greyed and carries Bootstrap's `.disabled`, which
its Tab plugin refuses to activate.

### Risk to check in the browser

`pickExample` and `loadExample` both call `anchorEditor()`, a smooth scroll to
the editor. If that animation is still running when the view's anchor fires,
`anchorNavSettled` can read the movement as the reader taking control
(`READER_MOVED`) and skip the anchor. On a fresh page the editor is at the top,
so the editor scroll should be near zero. If the check below shows the anchor
skipped, pass a flag so a linked pick does not anchor the editor.

### Files

`web/src/examples.js`, `web/src/nav.js`, `web/src/main.js`, `web/src/lite.js`
(comment), `web/index.html` (Help), `web/test/example-deep-link.test.js` (the
existing `deepEqual`s gain `view: null`, plus new view cases),
`web/test/view-link.test.js` (new, for `resolveView`), and the bump batch:
`CHANGELOG.md`, `dev/TODO.md`, `src/aggregate_api/__init__.py`.

### Acceptance

- `npm test` from `web/` passes, including:
  - `readDeepLink('?view=pnl:pentagon')` is
    `{database: null, example: null, view: 'pnl:pentagon'}`, and
    `withoutDeepLink` removes `view` and keeps `full`;
  - `resolveView`: `pnl:pentagon`, `economics:pentagon` and `PnL:Pentagon`
    each give `{group: 'economics', leaf: 'pentagon'}`; `pnl:summary` gives
    leaf `ratios`; `pnl` gives leaf null; `pnl:nope`, `nope` and `''` give
    null;
  - for every group, no leaf label (lowercased) equals a different leaf's key,
    and no group label equals a different group's key.
- `node dev/scripts/check-nav.mjs` is still clean; `uv run pytest` unaffected.
- In the browser, after `.\scripts\build-web.ps1`:
  - `/?database=library&example=Capstone.Capped&view=pnl:pentagon` builds
    once, lands on PnL ▸ Pentagon with the figure drawn and the page scrolled
    to the tab strip, and the address bar reads `/`. The network panel shows
    no Overview chart request for that build;
  - `view=economics:pentagon` and `view=PnL:Pentagon` do the same, and
    `view=pnl` lands on PnL ▸ Summary;
  - `example=BasicBook&view=pnl:pentagon` stays on Overview, with
    `view "pnl:pentagon" not available: a P&L only` in the note slot and the
    fold open;
  - `view=nope` gives `view "nope" not recognized`;
  - `example=NoSuchThing&view=pnl:pentagon` gives only the not-found note;
  - after landing, pressing Build stays on the Pentagon;
  - `?lite=1&database=library&example=Capstone.Capped&view=pnl:pentagon`
    builds the entry on the phone page with no error.

## Step [copy-link], 1.11.0

### Change

- [backend] `config.py`: `public_url: str = "https://agg.mynl.com/"`, env
  `AGGAPI_PUBLIC_URL`, the address copied links point at. `models.py`
  `MetaResponse` gains `public_url: str | None = None`, and `routes/meta.py`
  reports it, None when set empty. With the default, a link copied on
  `127.0.0.1` points at the public deploy, and the public deploy needs no
  setting since the default is its own address. This is not a breach of the
  house rule on hard-coded paths: it is the project's published address,
  already named in its docs, not a location on any machine, and the env var
  overrides it. The comment on the field says who should override it: a
  deployment of this package elsewhere sets it to its own address, or its
  copied links point at agg.mynl.com; and testing a link round trip against
  local work sets it to the local address (`http://127.0.0.1:8001/`).
- [front-end] `examples.js`: new pure `linkFor(base, {database, example,
  view})`. `new URL(base)`, clear its query and hash, set the three
  parameters through `searchParams`, skipping nulls, and return `href`.
  Exported for the test.
- [front-end] `index.html`: a hamburger item `Copy link` after
  `Download models`, in the same form as `DecL on one page`: a
  `<small class="d-block text-muted">` line under the label carries the reason
  when the item is disabled (a disabled item takes no pointer, so a `title`
  would never show), and `this example, on this tab` when it is live.
- [front-end] `main.js`.
  - `_linkable = {database, name, decl}`, remembered whenever a library entry
    enters the editor. There are two routes, `pickExample` and `exampleStep`,
    which already call `captionExample(item)`; set it beside those calls.
    `database` is `selectedDatabase()` at that moment, the file the entry came
    from, which the reader may change afterward. Null means the default file.
    The deep link path goes through `pickExample`, so a link received can be
    copied on.
  - On the hamburger's `show.bs.dropdown`, work out whether a link can be
    written and set the item's disabled state and its line. This is computed
    when the menu opens rather than tracked across edits. A link can be
    written when `_linkable` is set, the editor's trimmed text equals its
    `decl`, and `_builtDecl` equals it too, so what is on screen was built from
    the entry. Otherwise the item is disabled, with one of:
    - `links name an entry from the Examples menu` (no entry picked, the Help
      sample, or the landing program, which is loaded without a pick);
    - `the program was edited after it was picked`;
    - `build the entry first` (the Ctrl+Shift ring walked to it and the
      debounced build has not landed).
  - On click: `database` is the remembered stem, or the default file's stem
    from `loadDatabases()` when null. `view` is
    `${activeTabName()}:${activeLeaf(group)}`, in keys. The base is
    `meta.public_url`, which is set unless a deployment cleared it, else
    `location.origin + location.pathname`.
    Write the link with `navigator.clipboard.writeText` and put
    `link copied: <url>` in the note slot. When the clipboard API is missing (a
    plain-http origin that is not localhost, such as the VPN address) or
    refuses, the note reads `copy this link: <url>` instead, so the URL is
    still on screen to select by hand.
- [front-end] `index.html`, Help panel: one sentence on Menu ▸ Copy link.

### Not in scope

- Copy link on the phone page.
- Per-viewer preferences (Tables, Perspective, Emacs keys) and per-leaf state.
- A link names its entry by name, so it opens only where that host's library
  carries the entry. A link copied locally against an editable `aggregate`
  ahead of the deploy can name an entry the public host lacks. That host then
  says `not found` in the note slot, which is visible rather than silent.
- Deploying to the public site, which is the author's. Until a release
  carrying [view] is deployed there, a copied link opens there, builds the
  entry and stays on Overview, because that build does not read `view`.

### Files

`src/aggregate_api/config.py`, `src/aggregate_api/models.py`,
`src/aggregate_api/routes/meta.py`, `tests/test_meta.py`, `web/index.html`,
`web/src/main.js`, `web/src/examples.js`, `web/test/example-deep-link.test.js`,
and the bump batch: `CHANGELOG.md`, `dev/TODO.md`,
`src/aggregate_api/__init__.py`.

### Acceptance

- `uv run pytest`: `public_url` is `https://agg.mynl.com/` by default,
  reports `AGGAPI_PUBLIC_URL` when set, and is null when it is set empty.
- `npm test`: `linkFor` round-trips: `readDeepLink(new URL(linkFor(b, l)).search)`
  equals `l` for a dotted name, a name with a space, and a base carrying its
  own query (`/?full=1`), which is dropped.
- In the browser:
  - with no setting, pick `Capstone.Capped` from Examples, open
    PnL ▸ Pentagon, then Menu ▸ Copy link. The note slot shows `link copied:
    https://agg.mynl.com/?database=library&example=Capstone.Capped&view=economics%3Apentagon`;
  - restart with `AGGAPI_PUBLIC_URL=http://127.0.0.1:8001/` and copy again:
    the link starts with that address, and pasting it into a new tab lands on
    PnL ▸ Pentagon, as in [view];
  - edit one character: the item greys with `the program was edited after it
    was picked`; undo the edit and it is live again;
  - a fresh page with no pick: the item greys with `links name an entry from
    the Examples menu`;
  - over the VPN address on plain http, the note reads `copy this link: ...`.

## Version and housekeeping

Each step is one commit with its bump:
`[1.10.0] open a deep link on a named tab with view=` and
`[1.11.0] add Menu > Copy link and AGGAPI_PUBLIC_URL`. The version is the
literal `__version__` in `src/aggregate_api/__init__.py`; a bump runs no sync,
and `/v1/meta` reads it live. After each commit, rebuild the SPA
(`.\scripts\build-web.ps1`), since both steps move `web/`.

## Execution log

### [view], 1.10.0, 2026-10-14

Landed as specified, with these divergences:

1. **The linked pick skips the editor anchor when a view is pending** (`pickExample(item, {anchor})`, `loadExample(decl, formatted, anchor)`), the remedy the plan's "Risk to check in the browser" names. The evidence is **inconclusive**: the Chrome tab used for the check was hidden (`visibilityState: hidden`), so `requestAnimationFrame` never fired and `anchorNavSettled` never reached its anchor, which also explains the one result that looked like the risk (a 900 px iframe left at the editor's scroll, 51, rather than the strip, about 383). The first load, apparently while the tab was still visible, did anchor (scrollY 129.5, the pane-bottom clamp at 1388 px) with the editor anchor still in place. The change was kept because it is harmless: a fresh page has the editor at the top, and for a view link the tab anchor is the one scroll that should land. **Owed: check the scroll by eye in a visible window**, tall and short.
2. **A view-only link sets `pendingView` too.** The plan's "not set when the example was not found" is read as "an example was named and not found"; `?view=overview:tail` (no example) builds the landing program and applies the view, which the plan says falls out but the literal rule would have blocked.
3. **`dev-files.md` not updated**: `T:/worktrees/dev-files.md`, which the project `execute-plan` skill names as the control list, does not exist. `T:/worktrees` holds only the two repository directories.
4. Browser checks needed the worktree `aggregate` (1.3.0) installed editable, since `Capstone.Capped` is not in the released 1.0.1 library; the restore under "Relationship to `aggregate`" in `CLAUDE.md` was run.

Verified in the browser (DOM state, 1400×900 iframes): the motivating link, `economics:pentagon` and `PnL:Pentagon` land on PnL ▸ Pentagon with the figure drawn and the address bar at `/`, one `POST /v1/objects` followed directly by `/pnl/pentagon`, no Overview chart request; `view=pnl` lands on Summary; `BasicBook` with the Pentagon view, `view=nope` and `NoSuchThing` give exactly the plan's notes with the fold open; `overview:tail` lands on Tail; Build after landing stays on the Pentagon; the phone page with the motivating link and `lite=1` builds `Capstone.Capped` with no script error.
