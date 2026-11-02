# Short links and link preview cards

Label: **[Short-Links]**. One step, one version (1.43.0). Agreed with the author
2026-11-02 in conversation; this records it for a reader with no context.

## Goal

Menu ▸ Copy link copies `https://agg.mynl.com/x/<code>`, a code of 5 or 8
characters, in place of
`https://agg.mynl.com/?database=library&example=EventLossTable&view=overview%3Aplot`.
Typing the short link opens exactly what the long one opens. Every long link
keeps working. Pasting either kind into Facebook, LinkedIn, X, Slack, Teams,
iMessage or Outlook shows a card with the aLL logo; a short link's card gives
the example's name and note.

## Current behavior

- `web/src/examples.js` parses `?database=&example=&view=` (`readDeepLink`),
  finds the entry (`findLinkedExample`) and strips the parameters once applied
  (`clearDeepLink`). `nav.js` `resolveView` turns `view` into a tab.
- `main.js` `copyLink` builds the long link against `AGGAPI_PUBLIC_URL`
  (`/v1/meta.public_url`, default `https://agg.mynl.com/`).
- `index.html` has `<meta name="description">` and no `og:` tags, so a pasted
  link shows no card anywhere.

## Design

**The code is a pure function of the entry and tab; nothing is stored.** Two
parts:

- **entry**, 5 characters: SHA-256 of `"<database stem>\n<entry name>"`, the
  first 8 bytes as an integer, mod 57^5, in base 57. Computed on the server,
  the one place every entry is loaded, and served as `link_code` on each item
  of `GET /v1/examples` (and the heroes).
- **view**, 3 characters, optional: FNV-1a 32 over the UTF-8 of the view's keys
  (`overview:plot`, or a bare `overview`), mod 57^3, in base 57. Computed in the
  page, where the tabs are defined (`NAV_GROUPS` plus the installed Lab leaves).
  Not SHA-256 because `crypto.subtle` does not exist over plain http on the VPN
  address, the constraint that broke the clipboard at 1.13.1.

Alphabet, 57 characters: `a-zA-Z0-9` without `0 O 1 l I`, since codes get typed
from a PDF.

**Why not the alternatives.** A stored shortener needs state on the VPS and a
public write endpoint, and a link copied on DOOB points at `agg.mynl.com`, whose
store never saw the code. Packed indices (database number, place in the file,
tab number) fit in 4 characters but point at a different entry when
`library.agg` gains or reorders one. One hash over all three needs one side to
hold both the entries and the tabs, and neither does.

**Opening a link.** `GET /x/{code}` (top level, before the SPA mount) scans each
database's cached listing for the entry code, the default database first, then
the rest smallest file first, stopping at the first match. Each file is parsed
at most once per process. Measured on DOOB, first parse: decl-testers 2.27 s,
reproductions 0.90 s, recitations 0.34 s; library is already loaded at startup.
The SPA would parse the same file to open the link anyway.

It returns a small HTML page rather than a 302, because link preview fetchers
parse `og:` tags and never run scripts; behind a 302 they would get only the
SPA shell and every card would be the same. The page holds `og:title`
(`<name> · aggregate Loss Lab`), `og:description` (the entry's note, cut near
200 characters, else the site description), `og:url` (the short link),
`og:image` (`social-card.png`, 1200 by 630) and `twitter:card`, then
`location.replace('../?database=..&example=..&view=~<view code>')`. No
`<meta http-equiv="refresh">`: a fetcher that follows one would land on the
shell and lose the card. Absolute addresses come from `AGGAPI_PUBLIC_URL`, else
the request's own base. An unknown or malformed code is a 404 page with a link
home.

`resolveView` accepts `~<code>` by hashing every view in `NAV_GROUPS`, so
everything after the redirect is the long link's existing path.

**The site-wide card.** `index.html` gains the same tags with generic text, so
a bare `agg.mynl.com` or an old long link gets the branded card. `og:image` must
be absolute, so the host is set at build time: `%PUBLIC_URL%` in `index.html`,
replaced by a small Vite plugin from `VITE_PUBLIC_URL`, default
`https://agg.mynl.com/`. `build-web.ps1 -PublicUrl` sets it, as
`build-excel.ps1 -Base` sets the manifest's; `build-web.sh` takes
`VITE_PUBLIC_URL` from the environment.

**The image.** `dev/scripts/make-social-card.py` draws
`web/public/social-card.png` from `aggregate-api-trim.png`, the wordmark in two
lines (navy, red), the kicker and the address. Committed; rerun only to change
the art.

## Files

- `src/aggregate_api/short_links.py` (new): alphabet, `entry_code`, the lookup,
  the two pages, the endpoint.
- `src/aggregate_api/examples.py`: `_entry` takes the database stem and adds
  `link_code`.
- `src/aggregate_api/models.py`: `ExampleItem.link_code`.
- `src/aggregate_api/app.py`: the `/x/{code}` route.
- `src/aggregate_api/apps.py`: `x` reserved.
- `web/src/short-links.js` (new): alphabet, `viewCode`, `shortLinkFor`.
- `web/src/nav.js`: `resolveView` accepts `~<code>`.
- `web/src/main.js`: `rememberLinkable` keeps the code, `copyLink` builds the
  short link (the long one when an item has no code), and the view note gives a
  short link's tab by its labels.
- `web/index.html`, `web/vite.config.js`, `scripts/build-web.ps1`,
  `scripts/build-web.sh`: the site-wide tags.
- `web/public/social-card.png`, `dev/scripts/make-social-card.py`.
- Tests: `tests/test_short_links.py`, `web/test/short-link.test.js`.

## Acceptance

- `uv run --no-sync pytest`: pinned code vectors; no two shipped entries share a
  code; every listing item's `link_code` matches; `/x/<code>` returns 200 with
  the tags and the redirect, for library and reproductions entries, with and
  without a view; unknown and malformed codes 404; `x` is reserved.
- `npm test` in `web/`: pinned view vector; no two views share a code;
  `resolveView('~' + code)` returns the view; `shortLinkFor` output.
- By hand on DOOB: Copy link copies `.../x/<8 chars>`; the link opens the entry
  on the tab; a long link still works; `curl /x/<code>` shows the tags.
- After deploy, the author's: opengraph.xyz, LinkedIn Post Inspector and
  Facebook Sharing Debugger on a short link and on the bare site.

## Execution log

**2026-11-02, 1.43.0.** Landed as designed, in one step.

- Pinned values: `entry_code('library', 'EventLossTable')` is `GTDNc`;
  `viewCode('overview:plot')` is `tfx`, `economics:pentagon` is `qtB`. So
  EventLossTable on Overview ▸ Plot is `agg.mynl.com/x/GTDNctfx`.
- Collisions: none across the 1,073 shipped entries (library 212, decl-testers
  640, recitations 78, reproductions 143) or the 39 views (32 leaves, 7 groups).
- One change from the draft: the lookup first kept its own cache of
  `{code: item}` per file. The full suite failed with it after
  `test_sessions.py`, which swaps the default library and clears
  `load_examples` but leaves any second cache stale. It is a plain scan
  of the cached listing now, under a millisecond for a thousand items, and the
  collision test takes `client` so its settings are fresh.
- Suites: pytest 782 passed; `npm test` 357 passed; `check-nav.mjs` clean.
- By hand, on a scratch server at `:8011` with `AGGAPI_PUBLIC_URL` pointing at
  it: `/x/GTDNcPTg` opened EventLossTable on Overview ▸ Tail with the address bar
  cleared to `/`; Copy link then showed `link copied:
  http://127.0.0.1:8011/x/GTDNcPTg`; the long link
  `?database=library&example=EventLossTable&view=overview%3Asummary` landed on
  Summary; `/x/GTDNcqtB` (PnL ▸ Pentagon on an aggregate) showed `tab PnL ▸
  Pentagon not available: a P&L only`. curl: 200 with the tags in 0.03 s, the
  card image 200 `image/png`, an unknown code 404. In process, a miss that has
  to load every file took 2.5 s once and nothing after.
- Card image: 1200 by 630, 101 KB, Segoe UI Bold, the mark's own navy and red.
- Still owed, the author's: deploy, then the three card inspectors on
  `agg.mynl.com/x/GTDNctfx` and on `agg.mynl.com`; confirm the Caddy block
  serves no `robots.txt` that blocks LinkedIn's fetcher.
