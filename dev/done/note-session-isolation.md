# [Session-Isolation] Parked: one recipe base, many users

Status: PARKED for the author, 2026-08-17. Design discussion is complete and
every claim below was **measured or executed**, not reasoned about. Nothing has
been built. Picked up fresh when the author has a clear head.

The executable work from the same session went to
`dev/plan-hints-docs-headless.md` and does not depend on any of this. This note
is the whole of what was established, written so a cold reader can start from
here.

## 1. The bug

Every build through `POST /v1/objects` registers a session entry in the
underwriter's recipe base, and the API builds through `aggregate.build`, the one
process-wide singleton. Until reference severities landed (LIB a291 to a294) the
base was write-only clutter, and the only symptom was cosmetic: `examples.py`
filters `source == 'session'` rows out of the Examples menu so a user's own
programs do not appear there.

Now programs read the base back. `sev agg.NAME`, `agg NEWB agg.NAME` and a bare
`NAME` all resolve against it. So on a shared server, one user's declaration is
what another user's reference means.

Measured, with a one-entry library `agg B dfreq[3] dsev[4]`:

```
alice edits B to dsev[6]; bob does not; both type the SAME line
  agg NET agg.B occurrence net of 2 xs 2
  alice: 12.0        bob: 6.0        identical text, same answer? False
```

Both answers are correct for their author. Today both hash to one cache key, so
whoever builds second is served the other's object. Wrong by a factor of two,
silently.

**When it bites.** Different text is a different key, so a class all typing
*different* layers never collides. The failure needs **identical outer text over
different inners**, which is exactly what a taught demo produces: the instructor
dictates the net line while people have quietly tweaked or typo-fixed their
gross.

LIB knows the write half of this as `[Session-Build-Clobbers-The-Trailer]` in
`dev/TODO.md`, rewritten at a300, with an author ruling on 2026-08-17 naming the
fix as "either a session build should not silently overwrite a **library** entry
(warn, or namespace the session base), or the overwrite should merge the trailer
rather than replace it". This note is the app's side of the same problem.

## 2. The two stores, which is the thing to get straight first

They are separate, and only the second one shares anything.

| | holds | keyed by | scope |
|---|---|---|---|
| Recipe base (LIB) | the **declaration** | `(kind, name)` | one per process today |
| Object cache (`cache.py`) | the **live object** | `hash(decl, log2, bs)` | one, shared by everyone |

**LIB never keeps the live object.** Measured:

```
before any build, stored .object: None
after  the build, stored .object: None
second build returns the SAME python object? False
```

`build_many` hands back a `replace()` copy precisely so the caller's `.object`
cannot leak into the store (`underwriter.py:2072`). Ask LIB for the same program
twice and it does the FFT twice. All sharing between users is the API's cache
and nothing else.

The consequence that matters: fixing the recipe base does **not** fix the cache.
They need separate fixes.

## 3. Options considered, and why three were dropped

**Prefix names in the app.** The app rewrites `agg SL` to `agg <guid>.SL` and
rewrites references to match. Dropped: it is grammar work in the wrong repo, and
the mangled name then appears in the editor, in every exhibit caption and chart
title, and in the `.agg` download. The editor text being exactly the program you
own is the app's whole design.

**Inline the inner instead of referencing it** (the `port PNAME <units>`
precedent, added to the grammar at a216 for this exact reason). Dropped by the
author: `agg.ID` and `sev.ID` are a broad construct, not an inner-outer special
case, and **injection does not dodge the problem anyway**, because something has
to resolve the name in order to inject it and that resolution reads the shared
base. It also parses badly: an inline engine inside a P&L works because `less`
marks where it ends, and a severity slot has no such anchor.

**A namespace concept inside `Underwriter`.** Content-addressed cards plus a
per-session name-to-hash ref map (the git model) was worked through and is sound,
including the nice property that the object cache needs no per-user key because
identity becomes text plus resolved reference hashes. Dropped as too much
permanent public surface, arriving just before 1.0, to solve one consumer's
deployment problem.

## 4. The approach that survived: one underwriter per user, made by forking

The author's call, and the measurements support it.

**A fresh load is far too slow to do per user.** `Underwriter(databases=['library'])`
plus `load()`, measured over 20: **3,185 ms each** (first one 4,871 ms). 168
shipped recipes through the Earley parser. A hundred people arriving at once
would be five minutes of GIL-bound parsing.

**Forking the parsed base is free.** Copy the object, rebind `_recipes` to a
shallow `dict()` copy: **6 microseconds each**, measured over 100. About half a
million times faster. Memory is a non-issue: 0.36 MB for a fully fresh
underwriter, far less for a fork since the `Recipe` records are shared by
reference.

So the pre-work is: parse once at boot, hand out copies. The load is not made
faster, it is made to happen exactly once.

### 4.1 The trap, which is why this belongs upstream

`Underwriter.parser` is a lazy property:

```python
self._parser = UnderwritingParser(self._safe_lookup, self.debug)
```

The Lark grammar is a module singleton and is fine to share, but **the
transformer is per-underwriter and holds a bound method pointing at whoever
built it**. A plain shallow copy carries the parent's already-constructed
`_parser`, so the fork writes into its own base and reads out of the parent's.
Split brain, and it fails silently in exactly the direction we are trying to fix.

Observed on the first attempt: the fork registered its inner (169 entries against
the parent's 168) and then could not find it.

The cure is `_parser = None` (and `_lexer = None`) on the copy so the property
rebuilds bound to the fork. With that, executed:

```
100 forks: 0.6 ms total, 6 us each
after a builds the inner: a=169, b=168, global=168
a resolves its own inner: mean 302.3635
  b (never saw it): refused, KeyError: no recipe named 'TireKick'
  global build:     refused, KeyError: no recipe named 'TireKick'
a clobbers LimitProfile: global intact True, b intact True, a changed True
fork + first build (parser construction included): 84 ms
```

Isolation holds both directions, and the library-clobber bug is contained as a
side effect.

That non-obvious invariant about internal state is why this should be
`Underwriter.fork()` upstream rather than the app reaching into `_recipes`,
`_parser` and `_lexer`, which would be three new private-name imports and an
oversight finding under `T:/worktrees/CLAUDE.md`.

### 4.2 Walkthrough, a class of four

Library has `basicExample`. All four load it into the editor.

* **a builds.** Key is the hash of the text. Miss. Built through a's fork. a's
  base gets a session card; the live object goes into the **shared** cache.
* **b builds.** Same text, same key, **hit**. b is handed a's object and b's fork
  is never touched, so b's card is still the library one.
* **c builds.** Same. Same object. One FFT has run; three people are looking at
  it.
* **d changes the claim count and builds.** Different text, different key, miss.
  Built through d's fork. d's base gets a session card; a second object joins the
  cache. Nothing a, b or c had is disturbed.

**Change detection is free and there is nothing to invalidate.** The key is the
text, so a changed program is a different key is a different slot. Cache entries
and forks only accumulate and expire.

Then all four type the same next line, `agg NET agg.basicExample occurrence net
of 500 xs 500`. Four identical texts, one key, but d's fork resolves
`basicExample` to his card and the others resolve to the library's. Whoever
builds first fills the slot. **The fork alone does not save you: the bases are
correctly separate and the cache does not know it.**

## 5. What has to be built

### 5.1 LIB, small

1. **`Underwriter.fork()`**, about five lines. Copy, rebind `_recipes` to a
   shallow dict copy, and reset `_parser` and `_lexer`. The reset is the whole
   substance; without it the method is worse than useless.
2. **Report the names a parse resolved.** The parser already calls
   `_safe_lookup` once per resolved name, so recording them is a couple of lines.
   Section 5.2 explains why a regex is not good enough.
3. Optional: a **named exception** for an unresolved reference, so the app can
   tell that failure apart from others without matching message text. Today it
   arrives as `KeyError: "no recipe named 'X' of kind 'agg'"`.

### 5.2 The cache rule, which is the other half of the fix

Stated correctly, with the default inverted:

> **Qualify the cache key by the user unless the program is provably
> self-contained.** Never the other way round.

Failing toward a redundant build is cheap; failing toward a shared object is
silently wrong.

The first draft of this rule was "qualify when the text contains a dotted name
that the user has built themselves", and it has a hole that a bare name walks
straight through. `Underwriter.__call__` accepts "the bare name of an entry
already in the recipe base", so the one-character program `B` is a reference:

```
alice.build('B')  mean 18.0   (her B)
bob.build('B')    mean 12.0   (library B)
```

A lexical scan for `agg.` / `sev.` / `port.` / `dist.` misses it entirely.

So do not scan. **Parse first**, which is cheap next to a build, then ask what
the parse actually resolved; resolve nothing and the plain key is provably safe,
otherwise qualify. That covers every reference form including any added later and
removes the standing question of whether the scan is exhaustive. It reorders
`post_object` slightly: parse, then key, then check the cache, then build.

Fallback if LIB declines item 2: qualify unless the text opens with a declaration
keyword **and** carries no dotted name. A bare name fails the first clause, so it
qualifies. Correct, over-eager, costs some sharing.

Note what is preserved either way: a program with no reference shares exactly as
today, which is the conference case of a hundred people on one hero example, one
build. A program referencing only **library** names also still shares, since the
library is byte-identical in every fork. Only a program referencing something the
user built themselves is qualified.

### 5.3 API, the bulk of it

1. Session identity. A guid is a **namespace, not a security boundary**: anyone
   holding your guid gets your objects. Say so out loud, since it is the reason
   no login is needed. Client-generated `crypto.randomUUID()` in localStorage
   plus a header is adequate; server-issued is better if it should be unguessable.
2. A guid-to-fork registry with LRU and TTL. Forks are tiny; what they build is
   not.
3. The cache key change of section 5.2.
4. Routing: every build path, the `.agg` download's `recipes` read, and the
   derivation routes all use the caller's fork.
5. **The Examples menu reads the parent, never a fork.** Falls out of the
   walkthrough: a user who builds over a library name replaces their own card
   with a session-sourced one, and `_library_only` filters session rows, so a menu
   built from their fork would lose the entry entirely rather than show theirs.
6. The expiry path. The browser's guid outlives the server's fork across a
   restart or eviction, so an outer fails on a name that is gone. The SPA holds
   program history, so the recovery is "rebuild your inner", but it needs item
   5.1.3 to know that is the failure it is looking at.

## 6. Sizing, and the one thing that is neither

Mostly API, a little LIB, and lopsidedly so. LIB is one small method plus two
couple-of-line additions. The API carries session identity, the registry, the
cache rule, routing, the menu source and the expiry path.

Neither, and worth deciding at the same time: **`cache_max` is 50 built objects
globally.** A hundred concurrent users share those 50 slots no matter what is
done here. That is the real conference-day constraint and it is already true.

## 6.1 The prerequisite: one underwriter for the process

Independent of everything above, and a bug on its own terms. **`--library`
re-points the Examples menu only.** `examples.py::_underwriter()` builds a
private `Underwriter(databases=(path,))` for the menu, while both build paths use
`aggregate.build`, the shipped singleton, at `routes/objects.py:363`
(`_do_build`) and `routes/objects.py:1214` (the `.agg` download's `recipes`
read). So a custom library's entries are browsable and any entry referencing a
sibling by name fails to build, and the download lists session rows from a
different base than the menu came from.

`Settings.knowledge_base` (`config.py:72`) is documented as forwarding to
`Underwriter(databases=...)` and is read nowhere in `src`.

This wants doing whether or not the fork work happens, and it is the natural
parent for every fork, so do it first:

1. New `src/aggregate_api/library.py` with `get_underwriter()`, `lru_cache(maxsize=1)`:
   the body of today's `examples.py::_underwriter()`, behavior unchanged.
   `aggregate.build` when `examples_file` is unset, a private `Underwriter` when
   set, warn and fall back when the configured path is missing.
2. `examples.py` imports it and deletes its local copy.
3. `_do_build`: `get_underwriter()(decl, log2=log2, bs=bs)`. `Underwriter.__call__`
   delegates to `build` with the same signature (`underwriter.py:2502`, `:2543`),
   so this is a substitution, not a rewrite. Drop the `build as _build_singleton`
   import.
4. The `.agg` download reads `get_underwriter().recipes`.
5. `Settings.knowledge_base`: delete it, or wire it. It has never been read and a
   second knob meaning almost the same as `--library` is a trap.
6. `AGGAPI_EXAMPLES_FILE` stops being about examples once it feeds builds.
   `--library` already has the right name; propose `AGGAPI_LIBRARY`.
7. `get_settings.cache_clear()` in `create_app` needs `get_underwriter.cache_clear()`
   beside it, or a test that monkeypatches the library path gets the previous
   underwriter. `objects_routes.reset_singletons()` is the existing precedent.
8. Test: a fixture library with two entries where the second references the
   first, asserting the reference builds under `--library`. It fails today.

## 7. Open for the author

1. Client-held guid or server-issued token?
2. Does LIB take items 5.1.2 and 5.1.3, or does the app use the conservative
   lexical fallback?
3. `cache_max` sizing for a talk.
4. Does the custom-library work in `plan-remove-docs-hints-pnl-toggle-headless-lib.md`
   phase 3 (one underwriter for the process, so `--library` governs what programs
   resolve against and not just what the menu lists) land first, or as part of
   this? It is the natural parent for every fork, so this note assumes it.

## 8. Reproductions

The four scripts that produced every number above were written to the session
scratchpad and are not preserved. They are small and each is described precisely
enough above to rewrite in a few minutes: load timing against fork timing, fork
isolation both directions, the Alice and Bob one-entry library, and the
conference `dfreq`/`dsev` walkthrough.
