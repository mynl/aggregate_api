"""The DecL example library, read from ``aggregate``'s recipe base.

Since ``aggregate`` 1.0.0a159 the three shipped libraries (``examples.agg``,
``cookbook.agg``, ``actuarial-severity-curves.agg``) are one **``library.agg``**
with globally unique descriptive names and a namespaced ``tags{}`` clause on
every entry. The old single-letter filing prefixes (``E.LimitProfile``) are gone,
and with them the text-parsing this module used to do: there is no Contents block
to read, no ``<Letter>.<Name>`` convention to match, and no ``note{...}`` to
strip out of a folded statement.

Everything now comes off the loaded ``Underwriter``:

``build.recipes``
    One row per entry, indexed ``(kind, name)``. ``note`` is a boolean audit
    flag, not text; ``tags`` is a tuple of slugs.
``build.recipe(name)``
    The :class:`aggregate.recipe.Recipe` itself, carrying the text: ``note``,
    ``tags``, ``hints`` and ``decl``.

``Recipe.as_read`` is the entry's DecL as its ``.agg`` file spells it, and
``Recipe.seq`` is the position it was read at. Both arrived in ``aggregate``
1.0.0a320 and both are also columns on ``recipes``.

**One flat list, in the file's own order.** ``library.agg`` is written as a
reading order and the entries inside a part build on one another. Through a121
none of that reached the app: the frame arrives alphabetical, because
``Underwriter._recipes_frame`` ends in ``.sort_index()``, and this module then
grouped on a tag namespace, ordered the groups by a hand kept tuple and sorted
again inside each one. Reading order is meaning, and under the purist ruling
(author, 2026-08-10) the library owns meaning, so the app sorts on ``seq`` and
stops there. The ``# ---`` banners in ``library.agg`` are comments and stay
comments: nothing in ``aggregate`` parses them, so the list carries no headings
at all.

**Pills, not groups.** Every item carries a render-ready ``pills`` list, ordered
kind, then ``topic:``, then ``role:``, so the SPA draws it as given and the
namespace-to-color mapping has exactly one authority. ``tags`` stays as full
slugs, for the search haystack and for anyone reading the api directly, and
``kind`` keeps a field of its own, because the recipe's type is not a tag.

Cached per process; call ``load_examples.cache_clear()`` to pick up an edited
library without a restart.

Returned shape mirrors :class:`aggregate_api.models.ExamplesResponse`::

    {
        "items": [
            {"name": "ExposureLimitProfile", "kind": "agg",
             "note": "A premium by limit by loss ratio profile, ...",
             "decl": "agg ExposureLimitProfile\\n  [10_000 ...",
             "tags": ["topic:aggregate", "role:hero", "role:advanced"],
             "pills": [{"ns": "kind", "value": "agg"},
                       {"ns": "topic", "value": "aggregate"},
                       {"ns": "role", "value": "hero"},
                       {"ns": "role", "value": "advanced"}]},
            ...
        ],
        "facets": {
            "kind":  [{"value": "agg", "count": 94}, ...],
            "topic": [{"value": "aggregate", "count": 27}, ...],
            "role":  [{"value": "intro", "count": 32}, ...]
        }
    }
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Sequence

from aggregate.decl_writer import format_program, spec_to_decl

from .library import get_underwriter

logger = logging.getLogger(__name__)

# The three pill namespaces, in the order a row draws them. ``kind`` leads
# because it is the recipe's own type rather than a tag, and it is read off the
# frame index rather than out of ``tags``.
#
# An ordering table stood here through a121, three of them in fact
# (``_TOPIC_ORDER``, ``_ROLE_ORDER``, ``_KIND_TITLES``) plus ``_title`` and
# ``_sort_key`` to read them, and they are gone with the grouped view. They were
# the app deciding what the library means: the topic tuple had entries in it
# that no library entry claimed (``bounds``, ``ruin``) and was missing two that
# existed (``picks``, ``tweedie``), so the two real ones fell into an
# alphabetical tail. ``seq`` answers the whole question and the library owns it.
PILL_NAMESPACES = ("kind", "topic", "role")


# The two filing clauses a library entry loses on the way to the editor, as the
# grammar's own terminals rather than as a guess at them. ``decl.lark`` lines 830
# to 832 define the trailer as ``/note\{[^}]*\}/``, ``/hints\{[^}]*\}/`` and
# ``/tags\{[^}]*\}/``: the body cannot contain a closing brace, so ``[^}]*`` is
# exact here and not an approximation.
#
# **This mirrors those three terminals**, the way ``web/src/decl-keywords.json``
# is documented as mirroring ``parser_errors._TERMINAL_LABELS``, which puts it
# under agreement 6 of the oversight charter: a grammar change to the trailer is
# checked against this constant.
#
# ``\s*`` before the clause is what does the tidying, and it is why no second
# pass is needed. A clause on its own line takes the newline and the indent in
# front of it, so the line goes with it; a clause trailing one that also carries
# ``hints{}`` takes the single space in front of it, so no double space is left
# behind. Everything else in the line, including any alignment the file wrote
# inside a bracketed list, is untouched.
_FILING_CLAUSES = re.compile(r"\s*(?:note|tags)\{[^}]*\}")


def _strip_filing_clauses(text: str) -> str:
    """Return `text` without its ``note{}`` and ``tags{}`` clauses.

    Parameters
    ----------
    text : str
        A DecL program, as its file spells it.

    Returns
    -------
    str

    Notes
    -----
    **``hints{}`` stays, and that is not negotiable.** Sixteen library entries
    pin a grid, and a reference to one of them means one fixed thing only while
    the clause travels with the program. A program without it rebuilds on
    whatever grid the next build chooses.

    **The note and the tags go because they are filing metadata in front of a
    reader.** Someone watching the app should see the program, not the program
    plus its catalog card, and the prose belongs on the status strip where prose
    goes. The strip is fed from the menu item's own ``note`` and ``tags`` fields
    instead, which is a different channel and one that does not require the
    clauses to survive a build.

    This deliberately differs from what happens when a reader types a ``note{}``
    themselves, which is kept and shown. The asymmetry is accepted (author,
    2026-08-24): one is the library filing an entry, the other is a reader saying
    something about their own program.

    One pass, because ``re.sub`` scans the original string: two clauses in a row
    are both matched against the text as it stands, so the second is not left
    holding whitespace the first exposed.
    """
    return _FILING_CLAUSES.sub("", text).strip()

# The ``source`` marking an entry the api itself built. Every object built
# through ``POST /v1/objects`` is added to the underwriter's recipe base, so
# without this filter a user's own programs would appear in the Examples menu,
# untagged and unnamed.
_SESSION_SOURCE = "session"


def _library_only(frame):
    """Drop session-built entries, leaving the loaded library.

    Parameters
    ----------
    frame : pandas.DataFrame
        ``Underwriter.recipes``.

    Returns
    -------
    pandas.DataFrame
        The same frame without rows whose ``source`` is ``'session'``.

    Notes
    -----
    **This is why the menu reads the process base and not a session fork.**
    Every build route takes a fork of its own since a110, and it would look
    tidier for the menu to do the same. It would also be wrong: a user who
    overwrites a library name marks it ``source='session'`` in *their* fork, so
    this filter would then drop the library's entry from their menu, and the
    entry they would be looking for would simply be missing. The menu is a view
    of the library, which is the same for everybody; the fork is a view of what
    one user has declared.
    """
    if "source" not in frame.columns:
        return frame
    return frame[frame["source"] != _SESSION_SOURCE]


def _decl_of(kind: str, name: str, recipe) -> str:
    """The runnable declaration for an entry, as its own file spells it.

    ``Recipe.as_read`` (``aggregate`` 1.0.0a320) is the entry's DecL exactly as
    it stands in ``library.agg``: laid out over several lines, indented as
    written, comments and the terminating ``;`` removed, the trailer kept. It is
    what this serves whenever it is there, which is every library entry, **less
    its ``note{}`` and ``tags{}``**. It is empty only for a session build, which
    never had a file to come from, and that is what the writer pair below is
    still here for.

    **Why the filing clauses come off**, since a119 and a120 deliberately put
    them on and the reasoning for that is recorded below. Both are true at once:
    an object carries the note and tags its own program declares, so a stripped
    entry builds an object with neither, *and* a reader watching the app should
    see the program rather than the program plus its catalog card. The way out
    is not to undo a119, it is to feed the status strip on a different channel.
    The menu item already carries ``note`` and ``tags`` as fields, and the SPA
    now reads them from there when the object declares none of its own. So the
    clauses can go and nothing on screen is lost.

    ``hints{}`` is untouched. See :func:`_strip_filing_clauses`.

    **Why the file's own text rather than the canonical render.**
    ``spec_to_decl`` then ``format_program`` round trips through the spec, and
    the parser evaluates or expands several spellings on the way in and keeps
    only the result. So through a121 the editor received ``ph 2/3`` as
    ``ph 0.6666666666666666``, ``ceded to tower [0 25 50 75 100 125]`` as five
    and-chained layers, ``dsev [1:6]`` as ``dsev [1 2 3 4 5 6]`` and
    ``sev (100 / exp(1.5**2/2)) * lognorm 1.5`` as
    ``sev 32.465246735834974 * lognorm 1.5``. Those spellings are what several
    of the entries exist to teach, and an example that teaches a spelling has to
    arrive carrying it. Teaching the reader to write ``ph 2/3`` and then handing
    them the float is the example failing at its one job.

    Making the writer invert them is real work and a separate decision, tracked
    upstream as ``[Unparser-Reference-Gaps]``; it is worth doing for
    ``Recipe.decl``, the ``.agg`` export and the cookbook pages. Nothing here
    waits on it, because ``as_read`` never went through the spec at all.

    **The fallback keeps its trailer, and that is why the pair is spelled out.**
    ``Recipe.decl`` is this pair at the default ``trailer=False``, which drops the
    ``note{}`` and ``tags{}`` that ``spec_to_decl`` just wrote. Through a118 that
    is what the menu served, so every library entry arrived in the editor stripped
    of both, built an object carrying neither, and had nothing to show on the
    status strip. Only a hand-typed trailer ever reached it. ``hints{}`` survives
    either way and matters as much: a program without it rebuilds on a different
    grid from the one the entry was written for.

    Placement is the library's business, not the app's, which is the other reason
    to route through the writer. DecL binds a trailer to the declaration it
    follows, so it goes last on an ``agg`` and directly after the name on a
    ``port``, before the first unit; writing it at the end of a portfolio instead
    would bind it to the last unit, and would do so silently, because the program
    still parses and the object still builds.

    Parameters
    ----------
    kind : str
        The recipe's kind, as the writer needs it.
    name : str
        The entry's name, likewise.
    recipe : Any
        A resolved :class:`aggregate.recipe.Recipe`.

    Returns
    -------
    str

    Notes
    -----
    The writer can **refuse**, and one shipped entry makes it. A composite
    distortion (``dist X minimum dist.A dist.B``) holds constructed
    ``Distortion`` objects in its spec rather than names, so ``spec_to_decl``
    raises ``NotImplementedError`` and there is nothing canonical to render.
    Falling back to the stored program keeps the entry usable and loses only the
    canonical layout; a stored trailer is already where the library put it. Both
    of those paths are now reached only by a session build, since a library
    entry answers with ``as_read`` before either runs.
    """
    as_read = (getattr(recipe, "as_read", "") or "").strip()
    if as_read:
        return _strip_filing_clauses(as_read)
    text = ""
    try:
        text = spec_to_decl(getattr(recipe, "spec", None), kind, name) or ""
    except Exception:  # noqa: BLE001 (one un-round-trippable entry must not 500)
        logger.debug("spec_to_decl declined %s.%s; using the stored program", kind, name)
    if not text.strip():
        text = getattr(recipe, "program", "") or ""
    try:
        text = format_program(text, fmt="text", trailer=True)
    except Exception:  # noqa: BLE001 -- keep the unwrapped text
        pass
    return text.strip()


def _entry(kind: str, name: str, recipe) -> dict:
    """One example item from a resolved :class:`Recipe`.

    ``note`` is **optional**: most library entries carry one and it is preferred,
    but nothing guarantees it, so a missing note serializes as ``None`` and every
    consumer treats that as ordinary rather than as a defect.

    ``note`` and ``tags`` are served **only** as fields. They were also inside
    ``decl`` from a119 to a125, on the argument that the clauses are what make a
    built object carry them so the status strip can print them afterward. That
    was true and is no longer the arrangement: the clauses are filing metadata,
    and a reader watching the app should see the program rather than the program
    plus its catalog card, so they are stripped and the strip reads these fields
    instead. See :func:`_strip_filing_clauses`.

    So these two fields are now load bearing rather than a convenience: they are
    the only channel by which an entry's prose reaches the page. Nothing is lost
    from the payload, and no consumer of the api loses anything either; only
    ``decl`` changed.
    """
    note = getattr(recipe, "note", "") or ""
    tags = list(getattr(recipe, "tags", ()) or ())
    return {
        "name": name,
        "kind": kind,
        "tags": tags,
        "note": note.strip() or None,
        "decl": _decl_of(kind, name, recipe),
        "pills": _pills(kind, tags),
    }


def _namespace_values(tags, namespace: str) -> list[str]:
    """The bare values of `tags` carrying `namespace`, e.g. ``topic:severity``."""
    prefix = f"{namespace}:"
    return [t[len(prefix):] for t in tags if t.startswith(prefix)]


def _pills(kind: str, tags: Sequence[str]) -> list[dict]:
    """Render-ready pills for one entry: kind first, then topics, then roles.

    Parameters
    ----------
    kind : str
        The recipe's type, straight off the frame index.
    tags : sequence of str
        The entry's tags as full slugs, in the order its file declares them.

    Returns
    -------
    list of dict
        ``{"ns": ..., "value": ...}`` per pill, ``ns`` one of
        :data:`PILL_NAMESPACES`.

    Notes
    -----
    Built here rather than in the SPA so the namespace-to-color mapping has one
    authority, and so a client that renders the row does not have to know how a
    slug splits.

    Within a namespace the file's own tag order is kept rather than sorted, on
    the same reasoning as the list order itself: the entry declares its tags in
    an order and nothing in the app knows better.

    **A value can repeat across namespaces, and both pills are drawn.**
    ``topic:pnl`` sits on all eight ``pnl`` entries and ``topic:distortion`` on
    all six ``distortion`` ones, so those fourteen rows spell the same word
    twice in two colors. The library owns its vocabulary, so the app serves what
    is there and the redundant tags come out of ``library.agg`` upstream (author
    ruling, 2026-08-24). Suppressing one here would put the app back in the
    business of deciding what the library means, and would leave a topic filter
    selecting rows that show no matching topic pill.
    """
    pills = [{"ns": "kind", "value": kind}]
    for namespace in ("topic", "role"):
        pills += [{"ns": namespace, "value": value}
                  for value in _namespace_values(tags, namespace)]
    return pills


def _facets(items: list[dict]) -> dict[str, list[dict]]:
    """Count each pill value per namespace, in order of first appearance.

    Parameters
    ----------
    items : list of dict
        Entries in file order, each carrying ``pills``.

    Returns
    -------
    dict
        One list of ``{"value": ..., "count": ...}`` per namespace in
        :data:`PILL_NAMESPACES`, every namespace present even when empty.

    Notes
    -----
    First appearance, not alphabetical and not by count, so the filter bar reads
    in the library's order too: ``severity`` stands where the severity entries
    start rather than between ``reinsurance`` and ``tweedie``. A plain ``dict``
    is the whole mechanism, since it keeps insertion order.

    Counted over the items actually returned, so a filtered payload is self
    describing: its counts always add up to what the caller can see.
    """
    counts: dict[str, dict[str, int]] = {ns: {} for ns in PILL_NAMESPACES}
    for item in items:
        for pill in item["pills"]:
            bucket = counts[pill["ns"]]
            bucket[pill["value"]] = bucket.get(pill["value"], 0) + 1
    return {
        namespace: [{"value": value, "count": count}
                    for value, count in bucket.items()]
        for namespace, bucket in counts.items()
    }


@lru_cache(maxsize=1)
def load_examples() -> dict:
    """Return the whole example library, one flat list in the file's own order.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.ExamplesResponse`.

    Raises
    ------
    RuntimeError
        If ``recipes`` carries no ``seq`` column, which means an ``aggregate``
        older than 1.0.0a320 and no reading order to serve.

    Notes
    -----
    ``sort_values('seq')`` is the reading order, and asking for it is the whole
    of what this does about order. The frame's own default is alphabetical by
    ``(kind, name)`` and stays that way, which is what a person reading it at a
    prompt wants; ``seq`` is the column that says where the statement stood in
    its ``.agg`` file.

    **Each entry appears exactly once.** The grouped payload emitted one row per
    ``topic:`` tag, 182 rows for 151 entries, purely to feed a view that no
    longer exists, and the SPA then deduplicated them again to build its search
    index.

    Cached for the process. Resolving the base is cheap, since nothing is built,
    but it walks all of it, so it is not worth repeating per request. Filtering
    runs against this cached payload rather than against the frame, which is why
    :func:`filter_examples` is a separate call.
    """
    uw = get_underwriter()
    frame = _library_only(uw.recipes)
    if "seq" not in frame.columns:
        raise RuntimeError(
            "Underwriter.recipes carries no 'seq' column, so there is no reading "
            "order to serve; aggregate 1.0.0a320 or newer is required"
        )

    items = []
    for kind, name in frame.sort_values("seq").index:
        try:
            recipe = uw.recipe(name, kind)
        except Exception:  # noqa: BLE001 (one bad entry must not blank the menu)
            logger.warning("skipping library entry %s.%s: cannot resolve", kind, name)
            continue
        items.append(_entry(kind, name, recipe))
    return {"items": items, "facets": _facets(items)}


def filter_examples(payload: dict, kind=None, topic=None, role=None) -> dict:
    """Narrow a payload to the entries matching every namespace given.

    Parameters
    ----------
    payload : dict
        The full payload from :func:`load_examples`.
    kind, topic, role : sequence of str, optional
        Pill values to keep, per namespace. An empty or absent sequence means
        that namespace does not filter.

    Returns
    -------
    dict
        The same shape, with ``items`` narrowed and ``facets`` recounted over
        what survived. The unfiltered payload is returned unchanged when nothing
        was asked for.

    Notes
    -----
    OR within a namespace, AND across them, which is what makes "advanced
    reinsurance" and "intro or intermediate" both expressible.

    **The SPA does not use this.** The whole payload is 151 entries fetched
    once, and filtering in the browser is instant and keeps the pills and the
    list in step with no round trip. This exists so a notebook user can say
    ``GET /v1/examples?role=intro``.

    Nothing is mutated: `payload` is the ``lru_cache``d object every other
    caller holds, and the items inside the returned list are shared with it, so
    a caller must treat the result as read-only too.
    """
    wanted = {
        namespace: set(values)
        for namespace, values in (("kind", kind), ("topic", topic), ("role", role))
        if values
    }
    if not wanted:
        return payload
    items = [
        item for item in payload["items"]
        if all(
            any(p["ns"] == namespace and p["value"] in values for p in item["pills"])
            for namespace, values in wanted.items()
        )
    ]
    return {"items": items, "facets": _facets(items)}


@lru_cache(maxsize=1)
def load_heroes() -> dict:
    """Return the landing-page hero entries, those tagged ``role:hero``.

    Returns
    -------
    dict
        ``{"items": [...]}`` in the same item shape as :func:`load_examples`,
        in the library's reading order.

    Notes
    -----
    File order, like the full listing, so the name sort that stood here through
    a121 is gone with the rest of the app's ordering machinery. The order is
    read off each resolved ``Recipe.seq`` rather than by sorting the frame,
    because ``discover``'s lightweight directory path returns a name-indexed
    frame carrying ``program`` and nothing else: ``seq`` is a column on
    ``recipes``, not on what ``discover`` hands back.

    ``discover(tags=...)`` is the library's own selection verb and the tag is
    **plural**. Its lightweight directory path filters the recipe frame without
    building anything, so this is a frame filter, not eight FFTs. (The singular
    ``tag=`` used to bind into ``**kwargs`` and silently return the whole base;
    ``aggregate`` 1.0.0a173 made that a ``TypeError``.)

    The result is intersected with the library names so a session-built program
    that happens to carry ``tags{role:hero}`` cannot reach the landing gallery.
    """
    uw = get_underwriter()
    library = set(_library_only(uw.recipes).index.get_level_values("name"))
    found = uw.discover(tags="role:hero")
    ranked = []
    for name in found.index:
        if name not in library:
            continue
        try:
            recipe = uw.recipe(name)
        except Exception:  # noqa: BLE001
            logger.warning("skipping hero %s: cannot resolve", name)
            continue
        ranked.append((getattr(recipe, "seq", 0), _entry(recipe.kind, name, recipe)))
    ranked.sort(key=lambda pair: pair[0])
    return {"items": [item for _, item in ranked]}


# Points in a hero sparkline. Enough to show a shape at thumbnail size and
# nothing like enough to read a number off, which is the point: the card is an
# invitation, not an exhibit.
SPARKLINE_POINTS = 48


def _sparkline(obj) -> list[float] | None:
    """A normalized density silhouette for a built object, or ``None``.

    Returns
    -------
    list of float or None
        ``SPARKLINE_POINTS`` values scaled so the peak is 1, cropped to the
        q(0.999) window so a heavy tail does not flatten the shape into a
        spike at the origin. ``None`` when the object carries no usable
        density.

    Notes
    -----
    Bins by **summing** into equal-width buckets rather than sampling every
    n-th point. On a spiky discrete support, sampling would land between the
    atoms and return a row of zeros, so the thumbnail for a dice book would be
    a flat line.
    """
    import numpy as np

    frame = getattr(obj, "density_df", None)
    if frame is None or "p_total" not in getattr(frame, "columns", ()):
        return None
    mass = np.asarray(frame["p_total"], dtype=float)
    if mass.size == 0 or not np.isfinite(mass).any():
        return None
    # Crop to the visible body, mirroring the exhibit's density window.
    cdf = np.cumsum(np.nan_to_num(mass))
    hi = int(np.searchsorted(cdf, 0.999)) + 1
    mass = np.nan_to_num(mass[:max(hi, SPARKLINE_POINTS)])
    if mass.size < SPARKLINE_POINTS:
        mass = np.pad(mass, (0, SPARKLINE_POINTS - mass.size))
    # Sum into equal buckets; a ragged tail bucket is fine at this resolution.
    edges = np.linspace(0, mass.size, SPARKLINE_POINTS + 1).astype(int)
    binned = np.array([mass[a:b].sum() for a, b in zip(edges[:-1], edges[1:])])
    peak = binned.max()
    if not np.isfinite(peak) or peak <= 0:
        return None
    return [round(float(v), 5) for v in binned / peak]


@lru_cache(maxsize=1)
def load_hero_sparklines() -> dict:
    """Return ``{name: [floats]}`` silhouettes for the hero gallery.

    Notes
    -----
    **This builds every hero**, which is why it is a separate call rather than
    a field on :func:`load_heroes`. One of them (``CatXOLTower``) carries
    ``hints{log2=16}``, so a cold call costs seconds. The SPA therefore asks
    for it *after* first paint and lets the cards sit on their placeholder art
    until it lands: nothing on the landing path may wait on this.

    Cached for the process, so only the first caller pays. A hero that fails to
    build is skipped rather than raising, since a missing thumbnail is a
    cosmetic loss and a 500 here would be a real one.
    """
    from aggregate import build as _build

    out: dict[str, list[float]] = {}
    for item in load_heroes()["items"]:
        try:
            obj = _build(item["decl"])
            spark = _sparkline(obj)
        except Exception:  # noqa: BLE001
            logger.warning("no sparkline for hero %s", item["name"])
            continue
        if spark is not None:
            out[item["name"]] = spark
    return {"sparklines": out}
