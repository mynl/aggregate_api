# [Hints-Docs-Headless] Plan: the Hints button, the doc catch-up, and a headless flag

Status: **DONE**, 2026-08-17. Written against API `1.0.0a105` and LIB
`1.0.0a301`, with the environment synced to a301. Three independent phases, one
version bump and one commit each: phase 1 at a106, phase 2 at a107, phase 3 at
a108. Every acceptance point below was met; see `CHANGELOG.md` for what each
landed as.

Two carried notes for whoever reads this next. The suite has **four failures
that predate this work**, all in `tests/test_objects.py` and all exhibit
formatting, from the a293 to a301 library sync rather than from anything here:
`test_tail_df_endpoint`, `test_the_library_formats_its_own_numbers`,
`test_frame_ir_sparsifies_the_row_index`, `test_the_library_flags_the_capital_anchors`.
And `uv sync` could not record the version bumps, because a stale
`aggregate-api` process is holding `Scripts/aggregate-api.exe` and refuses to be
killed from this session; `uv lock` was used instead, so the lock is correct and
only the installed metadata is stale. `/v1/meta` will report a105 until the
process is gone and a sync runs.

These are the three items from the author's 2026-08-17 list that are ready to
build. The other two are parked:

* **The P&L face toggle is dropped** (author, 2026-08-17). `decl.lark:133` and
  `:134` give `pnl_out` and `xpnl_out` byte-for-byte identical bodies, and both
  transformers call the same `_pnl_spec`, so moving between the faces is typing
  one character. A button for that is not worth its complexity. Worth keeping the
  grammar fact: the two faces are one statement shape. `peel` is accepted on
  `pnl` too, deliberately, so going back from a peeled `xpnl` parses and then
  fails in the transformer with a clear message.
* **The custom library and per-user recipe bases** are parked in
  `dev/note-session-isolation.md`, which carries the measured findings, the
  design that survived, and what is left to decide.

Nothing here depends on either.

## Phase 1 [Headless-Flag], a106

Declare what the static mount already does by accident. `create_app` mounts the
routers under `/v1`, then mounts `StaticFiles(html=True)` at `/` **only if the
directory exists** (`app.py:106`). `static/` is gitignored and built at deploy,
so an install with no web build is already api only, which `app.py:105` calls
"backend-only deploys". The switch today is knowing that not building the SPA is
the switch, and the only explicit off is pointing `AGGAPI_STATIC_DIR` at a
directory that does not exist.

1. `config.py`: `serve_spa: bool = True` in the static-files block beside
   `static_dir`, with a comment saying why a deploy needs to state this rather
   than express it by omission.
2. `app.py::_resolve_static_dir`: return `None` when `serve_spa` is false, ahead
   of the existing precedence, so the mount site at `app.py:107` stays the one
   place that decides.
3. `__main__.py`: `--headless`, setting `AGGAPI_SERVE_SPA=0` in `os.environ`
   before the first `get_settings()`. The env-var-not-Settings reasoning is
   already written at `__main__.py:105` for `--library` (a `--reload` child
   process inherits `os.environ` and would never see a value poked into this
   process's cached Settings) and applies unchanged. Help text names what is
   still served.
4. `README.md`: a short "Running headless" section. Headless plus
   `AGGAPI_CORS_ORIGINS` is the whole recipe for driving the engine from a
   third-party front end, and `/openapi.json` is the contract. One sentence that
   the `/v1` surface is pre-1.0 and shaped by what aLL needs, so the flag is not
   read as a stability promise.
5. Tests: with `serve_spa` false, `/` is 404, `/v1/health` is 200, and **`/docs`
   is 200**. The third is the point of the test. FastAPI registers `/docs`,
   `/redoc` and `/openapi.json` in its constructor, before `create_app` mounts
   anything, and Starlette matches in registration order, so headless only
   removes the catch-all at the end. That is true by construction today and
   nothing says so.
6. Housekeeping, riding here because it is two lines on the same surface: the
   Reset button came out at a58 (`index.html:223`) because `Ctrl+↑` / `Ctrl+↓`
   already walk the programs you built, and two references to it survive.
   `index.html` still lists Reset in the Keys panel; `main.js` still tells the
   reader that Reset comes back to the gross object.

## Phase 2 [Hints-Button], a107

The third derivation, alongside Sharpen and PnL, modeled on PnL line for line.

`with_hints(**extra)` landed upstream at a291 on both `Aggregate`
(`_aggregate.py:5025`) and `Portfolio` (`_portfolio.py:2156`), delegating to
`_program.with_hints`. It returns the object's own program with `log2`, `bs` and
`normalize` merged into the existing `hints{}` clause, replacing rather than
duplicating one, and raises `ValueError` when the object has not been updated,
carries no program, or is handed a hint key DecL does not have.

It is the certification helper for the reference-severity work: the resolver
refuses a reference whose target declares no `log2` and `bs`, and its error names
this method (`underwriter.py:1709`). So the button turns a candidate inner into a
certified one, which is the inner-and-outer preparation the author asked for.

1. `capability.py`: `can_hints(obj)` returning `hasattr(obj, "with_hints")`,
   surfaced as `canHints`. Docstring mirrors `can_pnl`'s, including the argument
   for not folding it into a neighbor: `with_hints` and `pnl_program` sit on
   exactly the same two classes today, and a shared flag would tie a future
   change in one to the other.
2. `routes/objects.py`: `POST /objects/{oid}/hints`, `response_model=DerivedResponse`,
   the shape of `post_pnl`. Guard `hasattr(obj, "with_hints")` to a 400 naming
   the two classes; catch `ValueError` to a 422; `collapse_program`, then
   `post_object(...)` called directly rather than reimplemented so every build
   guard applies unchanged; return `{"program": spread(program),
   "description": None, **built}`.
3. **No request body and no cap guard**, both deliberate and both earning a Notes
   paragraph. `with_hints(**extra)` takes further hint keys, but the app has no
   opinion to offer about `padding` or `normalize` and a form for them would be
   the app holding meaning. And unlike Sharpen, which probes and can land above
   `AGGAPI_LOG2_CAP` (`post_sharpen`'s Notes), this pins the grid the object
   **already built on**, which the build route already vetted, so the pinned
   `log2` is at or under the cap by construction.
4. `description` stays `None`, like PnL and unlike Sharpen. The result is
   visible: the `hints{}` clause is right there in the returned text.
5. `web/src/api.js`: `hints`, beside `sharpen` and `pnl` under the same "The
   derivations" comment.
6. `web/index.html`: `hints-btn` in the derive group between Sharpen and PnL, and
   a line in the Keys panel beside the other two.
7. `web/src/main.js`: `off(hintsBtn, !can('canHints'))` in `renderActionRow`, and
   `runDerivation(hintsBtn, 'Pinning…', (id) => api.hints(id))` with no `land`
   argument, since the result belongs where you already are.
8. Tests: the route on an `agg` and on a `port` returns a program containing
   `hints{` whose rebuild is a cache hit on the returned id; 400 on a `Severity`;
   the capability flag rides on the build manifest.

## Phase 3 [Docs-Decommission-Catch-Up], a108

LIB finished the job today: a298 removed the cookbook and its renderer, a299 put
the library invariants into pytest, a300 took the seven doc bodies out of
`library.agg`, and **a301 removed the `doc{{{...}}}` clause from the grammar**.
`plan-decommission-docs.md` is in `dev/done/`, and `recipe.py` has no doc surface
left. Its section 6 said removing the app's defense was the app's call on its own
schedule; the clause can no longer be produced, so the schedule is now.

**Nothing in the app ever consumed a doc.** Every touchpoint is defensive, so
this deletes a defense, not a feature, and behavior is unchanged.

| File | What |
|---|---|
| `examples.py` | the doc regex in `_STRIP_CLAUSES` and the comment lines about the base64 one-liner; keep note and tags |
| `examples.py` | "``note`` and ``doc`` are boolean audit flags" in the module docstring: LIB a301 dropped the doc-derived `_RECIPE_COLUMNS` |
| `examples.py` | "doc-free" in the two `Recipe.decl` descriptions, and "the doc sections parse lazily" in `load_examples` |
| `models.py` | the `MetaResponse` paragraph on `doc{{{...}}}` being deliberately absent, and "any doc body base64-encoded" in the `program` field description |
| `routes/objects.py` | `get_meta`'s "``doc{{{...}}}`` is deliberately never served: it is the cookbook's" |
| `tests/test_examples.py` | drop the `doc{{{` assertion and the docstring paragraph, keep note and tags, rename to `test_example_decl_is_trailer_free_and_reloadable` |

Verified clean, nothing owed: `web/src/decl-keywords.json` never listed `doc`
(its structural pool is `agg`, `port`, `sev`, `distortion`, `note`), and nothing
in the app imports `aggregate.cookbook`. Re-confirm the keywords file at
execution, since a301 also dropped `"DOC"` from `parser_errors._TERMINAL_LABELS`,
which that file mirrors by hand.

## Verification

* `uv run pytest` green at each bump. The environment was synced to LIB a301
  before starting, so `/v1/meta` and the About panel report a301.
* Phase 1: `/` 404 and `/docs` 200 under `serve_spa` false.
* Phase 2: the derived program's returned id equals the id an ordinary build of
  that text produces, which is the `DerivedResponse` contract and what makes
  rebuilding from the editor a cache hit.
* Phase 3: `rg -n "doc\{\{\{" src tests web` returns nothing.

## Upstream, for the round 7 note

Only one item, and it is a docstring. `Portfolio.pnl_program`
(`_portfolio.py:1105` to `:1109`) says "the grammar has no inline portfolio
engine, so unlike the aggregate form this text **references** the portfolio", but
it delegates to `_program.pnl_program`, whose `port` branch writes the units out
inline via `_engine_port_spec`, and whose Notes say `less port.NAME` was the
rejected alternative and the inline portfolio engine arrived at a216. The app's
own route docstring repeats the self-contained claim, so the app needs to know
which text is current.

## Open for the author

**Phase 2 button label.** "Hints" is the author's own word and matches the clause
it writes, so it is what ships. "Pin" says more to someone who has not read the
grammar. One string either way.
