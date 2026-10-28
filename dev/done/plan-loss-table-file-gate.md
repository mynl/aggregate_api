# Loss table files for private requests only

Executed as **1.35.0** on 2026-10-28, the same day it was designed, without a
separate review: the public server was exposed while it was being written. This
file is the design record.

## Goal

A request from the public internet must not make the server read a file. A
request from localhost, the LAN (`192.168.4.0/24`) or the VPN (`10.8.0.0/24`)
may, as before.

## The exposure

`aggregate` 1.13.0 added file sources to the loss tables of 1.12.0:
`agg NAME elt "path"` and `agg NAME ylt "path"` read a CSV, TSV, Parquet or
Feather file. An absolute path may point anywhere; a relative one resolves
against the server's working directory. All reads go through one library
function, `_loss_table._read_table`, at build time. On 2026-10-28
`https://agg.mynl.com/v1/meta` reported `aggregate_version` 1.18.0, so the public
server accepted such programs with no guard. Through aLL a visitor could:

- probe the host's disk: the library's error distinguishes a missing file from
  one lacking columns, and includes the resolved absolute path;
- read numbers out of any file shaped like a loss table. The column aliases are
  broad: a CSV with a column named `loss` or `annual_loss` builds as a `ylt`, and
  the whole distribution of that column comes back through the frames.

Inline tables, `elt [[...]]` and `ylt [...]`, read nothing and are not at issue.

## Who is private

Unchanged, and shared with the status page: `AGGAPI_PRIVATE_CIDRS` (default
`127.0.0.0/8, ::1, 10.8.0.0/24`) judged by `net.is_private_request`. Both Caddy
front doors on the VPS proxy to `127.0.0.1:8001`, so the peer address is
loopback for everyone and cannot be the test; the gate reads the last
`X-Forwarded-For` element, the address Caddy observed. `net.py` explains the
single-proxy assumption that rests on. A request with no forwarded header is
judged on its peer, so local development is private.

DOOB runs without a proxy, bound to `0.0.0.0`, and answers on the LAN, so its
launcher (`~/.great-servers/servers.yaml`, the author's) needs
`AGGAPI_PRIVATE_CIDRS=127.0.0.0/8, ::1, 10.8.0.0/24, 192.168.4.0/24`. The LAN
subnet is a fact about that deployment, so it is not in the code's default.
There, `X-Forwarded-For` is whatever the client sent, which is harmless while
only the LAN and the VPN can reach the port.

## The change

One test, applied in three places. All of it lives in
`src/aggregate_api/loss_table_files.py`.

**The test is a suffix.** The library picks a reader by the path's suffix after
`.lower()` and refuses any other suffix before touching the disk, and a DecL
quoted string has no escapes. So a readable path contains `.csv`, `.tsv`,
`.parquet` or `.feather` literally. Neither preprocessing pass can assemble one
from text that lacks it: the api's `collapse_program` replaces continuations and
whitespace with spaces and deletes nothing, and the library lifts quoted strings
out before it strips comments.

1. **[request-text]** `refuse_file_text`, an async dependency on the meta,
   objects, decl and examples routers (the status router is private already).
   A request from outside whose query values, raw body, or decoded JSON body
   strings contain a readable suffix gets a 422 with `REFUSAL`, before the
   handler runs and before anything reaches the library. Decoding the JSON
   matters: `.csv` is `.csv` once parsed. The URL path is not scanned,
   because `frame/{which}.csv` is a route and no route takes DecL in its path.
2. **[resolved-program]** `preview_names_file`, in `POST /v1/objects`. A
   reference such as `agg.NAME` contains no path in its text but may resolve to a
   recipe that does, for instance one the author built in the anonymous session
   that every headerless request shares. The route already previews every
   program before keying it, and `Underwriter.preview` parses without reading
   any file (checked on 1.18.0 against a missing path). The suffix test runs
   over every string in the parsed statements, which contain an inlined
   referent's sources, and in the spec of every entry the preview resolved,
   which covers the deferred `sev agg.NAME` and the chain behind it. A request
   from outside gets the same 422, with an audit row.
3. **[cache]** `CacheEntry.reads_files`, set from step 2's answer. An object id
   is a SHA-256 prefix of the previewed program, which anyone can compute, so
   `_resolve_object` returns the ordinary 404 to a request from outside, and
   `GET /v1/objects` and both forms of `GET /v1/session/models.agg` leave the
   entry (or the session recipe) out. The sharpen route copies the flag to the
   derived entry.

## Alternatives considered

- **A switch in the library**, at `_read_table`, set per request by the api. It
  would catch every route to a read, however the program was put together, and
  is the general fix: like XML external entities, any server running untrusted
  DecL needs a way to turn file sources off. Not done now because the api fix is
  complete for aLL and did not have to wait on a library release. Worth asking
  for as a second layer.
- **A scan for a quoted string in the source position** (after `elt` or `ylt`,
  not after `as`, outside brackets). It has to agree with the library on where
  every quoted string begins and ends, through `note{}` bodies and comments; a
  disagreement would miss a path. The suffix test ignores position and cannot be
  misled that way. Its false positive, a comment or note that mentions `.csv`,
  costs a visitor a 422 and nothing else.
- **Salting object ids for file-sourced objects.** Would make ids unguessable
  with no lookup gate, but leaves the cache listing showing them. The flag is
  explicit and testable.

## Coupling, and what pins it

- The suffix list copies the library's reader table. `tests/test_loss_table_files.py`
  parses the list from the library's own refusal of an unknown suffix, so a
  reader added upstream fails the suite.
- Step 2 relies on `Underwriter.preview` reading no file, and on
  `ProgramPreview.statements`, `.resolved` and `Underwriter.recipe(name, kind=)`.
  The reference tests (inlined, bare and deferred) build against a real file and
  fail if any of that moves.

## Not covered

- **The configured library.** The examples route builds entries from
  `AGGAPI_LIBRARY` server-side, for everyone. A file-sourced entry there would be
  built for a public visitor. That file is the author's, so putting a file
  source in it is a choice to publish; `POST /v1/objects` naming such an entry
  from outside is still refused by step 2.
- **Private builds** behave as before, including the library's error text with
  the resolved path.

## Files

- `src/aggregate_api/loss_table_files.py` (new): the test, the walkers, the
  dependency and `REFUSAL`.
- `src/aggregate_api/app.py`: the dependency on four routers.
- `src/aggregate_api/cache.py`: `CacheEntry.reads_files`.
- `src/aggregate_api/routes/objects.py`: step 2 after the preview, the flag at
  both `CacheEntry` sites, the request passed into `_resolve_object` from
  `_locked_entry` and `get_manifest`, and the filters in `list_objects` and
  `get_session_models`.
- `tests/test_loss_table_files.py` (new): 22 cases against a synthetic CSV in
  `tmp_path`, varying `X-Forwarded-For` over a loopback peer.

## Acceptance

- `uv run --no-sync pytest`: 671 passed (649 before, 22 new).
- `web` `npm test`: 346 passed (no web change).
- From outside: a path in the text, with or without a label, `unit` clause or
  JSON escape, returns `REFUSAL`, and a missing path returns `REFUSAL` rather than
  the library's read error, which shows the library was not reached. Inlined,
  bare and deferred references to a file recipe return `REFUSAL`. A file object's
  id returns 404 and is absent from the listing and both session downloads.
- From the VPN, and with no proxy header: the same file builds and is served.
- Inline tables build and are served for everyone.

## Execution log

- 2026-10-28, 1.35.0: all three steps in one bump. Deployment and the DOOB
  `AGGAPI_PRIVATE_CIDRS` line are the author's.
