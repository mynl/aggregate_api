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
    One row per entry, indexed ``(kind, name)``. ``note`` and ``doc`` are
    boolean audit flags, not text; ``tags`` is a tuple of slugs.
``build.recipe(name)``
    The :class:`aggregate.recipe.Recipe` itself, carrying the text: ``note``,
    ``tags``, ``hints`` and ``decl``.

``Recipe.decl`` is the entry's own declaration re-rendered canonically, doc-free,
carrying ``hints{}`` and nothing else. That is exactly what the editor wants, so
the SPA no longer has to round-trip a loaded example through
``POST /v1/decl/format``.

Grouping is by tag namespace rather than by filing letter:

``topic:``
    what the entry is about (severity, aggregate, portfolio, ...). The default,
    and the successor to the letter categories.
``kind``
    the object type, straight off the recipe index (agg, port, sev, bvagg, pnl,
    distortion). Not a tag: type is what ``kind`` is for.
``role:``
    where the entry stands (hero, intro, reference, paper). Sparse by design, so
    this view carries an "other" group for the untagged majority.

Cached per process and per grouping; call ``load_examples.cache_clear()`` to pick
up an edited library without a restart.

Returned shape mirrors :class:`aggregate_api.models.ExamplesResponse`::

    {
        "grouping": "topic",
        "categories": [
            {
                "key": "severity",
                "title": "Severity",
                "items": [
                    {"name": "...", "kind": "sev", "tags": [...],
                     "note": "...", "decl": "..."}
                ]
            },
            ...
        ]
    }
"""

from __future__ import annotations

import logging
import re
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

Grouping = Literal["topic", "kind", "role"]

# Display titles for the kind keys the parser emits. Anything unlisted falls
# back to the key itself, so a new kind surfaces rather than disappearing.
_KIND_TITLES = {
    "agg": "Aggregate",
    "port": "Portfolio",
    "sev": "Severity",
    "bvagg": "Bivariate aggregate",
    "pnl": "P&L",
    "distortion": "Distortion",
}

# Order the topic groups so the menu reads in teaching order rather than by
# entry count. Unlisted topics sort alphabetically after these.
_TOPIC_ORDER = (
    "aggregate", "severity", "frequency", "reinsurance", "portfolio",
    "distortion", "pnl", "bivariate", "bounds", "ruin", "numerics",
)

# Ditto for roles, most prominent first. ``_UNGROUPED`` collects entries with no
# tag in the namespace being grouped on; it always sorts last.
_ROLE_ORDER = ("hero", "intro", "reference", "paper")
_UNGROUPED = "other"

_GROUP_TITLES = {_UNGROUPED: "Other"}


def _underwriter():
    """Return the ``Underwriter`` whose recipe base backs the example library.

    Defaults to ``aggregate.build``, the shipped singleton loaded from
    ``library.agg``. ``AGGAPI_EXAMPLES_FILE`` overrides it with a custom
    ``.agg``: a private :class:`Underwriter` is pointed at that file's stem via
    ``databases=`` and loaded, so a curated library goes through exactly the same
    recipe machinery as the shipped one. A configured but missing path warns and
    falls back rather than failing the route.

    Returns
    -------
    aggregate.underwriter.Underwriter
    """
    from .config import get_settings

    custom = get_settings().examples_file
    if not custom:
        from aggregate import build

        return build

    path = Path(custom)
    if not path.is_file():
        warnings.warn(
            f"AGGAPI_EXAMPLES_FILE={custom!r} not found; using the shipped library",
            stacklevel=2,
        )
        from aggregate import build

        return build

    from aggregate import Underwriter

    uw = Underwriter(databases=(str(path),))
    uw.load()
    return uw


def _title(key: str) -> str:
    """Human-readable heading for a group key.

    Kind keys get their spelled-out class name, everything else is title-cased
    with hyphens opened out, so ``heavy-tail`` reads "Heavy tail".
    """
    if key in _GROUP_TITLES:
        return _GROUP_TITLES[key]
    if key in _KIND_TITLES:
        return _KIND_TITLES[key]
    return key.replace("-", " ").replace("_", " ").capitalize()


def _sort_key(order: tuple[str, ...]):
    """Return a sort key placing `order` first, then alphabetical, `other` last."""
    def key(group_key: str) -> tuple[int, str]:
        if group_key == _UNGROUPED:
            return (2, "")
        if group_key in order:
            return (0, f"{order.index(group_key):03d}")
        return (1, group_key)

    return key


# Trailer clauses stripped on the fallback path below, matching what
# ``Recipe.decl`` emits: ``hints{}`` stays, because it changes how the object
# builds and a program without it would not reproduce the entry; ``note`` and
# ``tags`` are carried in their own fields, and ``doc`` is never served. The doc
# pattern runs first and is non-greedy over newlines: in a *stored* program the
# body is the preprocessor's base64 one-liner, not the readable text, so it must
# never reach the editor.
_STRIP_CLAUSES = (
    re.compile(r"\s*doc\{\{\{.*?\}\}\}", re.S),
    re.compile(r"\s*note\{[^}]*\}"),
    re.compile(r"\s*tags\{[^}]*\}"),
)

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
    """
    if "source" not in frame.columns:
        return frame
    return frame[frame["source"] != _SESSION_SOURCE]


def _decl_of(recipe) -> str:
    """The runnable declaration for an entry, preferring the canonical form.

    ``Recipe.decl`` re-renders the entry from its parsed spec: canonical, in
    spread layout, doc-free, carrying ``hints{}``. That is what the editor wants.

    It can come back **empty**, though, when the unparser cannot render the spec.
    The shipped case is a composite distortion (``dist X minimum dist.A
    dist.B``), whose spec holds constructed ``Distortion`` objects rather than
    names, so there is nothing for ``spec_to_decl`` to write. Falling back to the
    stored program keeps the entry usable and loses only the canonical layout;
    its trailer is trimmed to match, ``hints`` kept and the rest dropped.
    """
    decl = (getattr(recipe, "decl", "") or "").strip()
    if decl:
        return decl
    program = (getattr(recipe, "program", "") or "").strip()
    for pattern in _STRIP_CLAUSES:
        program = pattern.sub("", program)
    return program.strip()


def _entry(kind: str, name: str, recipe) -> dict:
    """One example item from a resolved :class:`Recipe`.

    ``note`` is **optional**: most library entries carry one and it is preferred,
    but nothing guarantees it, so a missing note serializes as ``None`` and every
    consumer treats that as ordinary rather than as a defect.
    """
    note = getattr(recipe, "note", "") or ""
    return {
        "name": name,
        "kind": kind,
        "tags": list(getattr(recipe, "tags", ()) or ()),
        "note": note.strip() or None,
        "decl": _decl_of(recipe),
    }


def _namespace_values(tags, namespace: str) -> list[str]:
    """The bare values of `tags` carrying `namespace`, e.g. ``topic:severity``."""
    prefix = f"{namespace}:"
    return [t[len(prefix):] for t in tags if t.startswith(prefix)]


@lru_cache(maxsize=len(Grouping.__args__))
def load_examples(grouping: Grouping = "topic") -> dict:
    """Return the example library grouped by `grouping`.

    Parameters
    ----------
    grouping : {'topic', 'kind', 'role'}, optional
        Which axis to group on. ``topic`` (the default) uses the ``topic:`` tag
        namespace, ``kind`` the recipe's own type, ``role`` the ``role:``
        namespace. An entry carrying several tags in the namespace appears under
        each of them, which is intended: ``role:hero, role:paper`` really does
        belong in both.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.ExamplesResponse`.

    Notes
    -----
    Cached per grouping. The cache is sized to the number of legal groupings so
    every view is computed at most once per process; resolving 186 recipes is
    cheap (the doc sections parse lazily and nothing is built), but it walks the
    whole base, so it is not worth repeating per request.
    """
    if grouping not in Grouping.__args__:
        raise ValueError(
            f"unknown grouping {grouping!r}; expected one of {Grouping.__args__}"
        )

    uw = _underwriter()
    frame = _library_only(uw.recipes)
    grouped: dict[str, list[dict]] = {}

    for kind, name in frame.index:
        try:
            recipe = uw.recipe(name, kind)
        except Exception:  # noqa: BLE001 -- one bad entry must not blank the menu
            logger.warning("skipping library entry %s.%s: cannot resolve", kind, name)
            continue
        item = _entry(kind, name, recipe)
        if grouping == "kind":
            keys = [kind]
        else:
            keys = _namespace_values(item["tags"], grouping) or [_UNGROUPED]
        for key in keys:
            grouped.setdefault(key, []).append(item)

    order = _TOPIC_ORDER if grouping == "topic" else _ROLE_ORDER
    keys = sorted(grouped, key=_sort_key(order))
    categories = [
        {
            "key": key,
            "title": _title(key),
            "items": sorted(grouped[key], key=lambda i: i["name"]),
        }
        for key in keys
    ]
    return {"grouping": grouping, "categories": categories}


@lru_cache(maxsize=1)
def load_heroes() -> dict:
    """Return the landing-page hero entries, those tagged ``role:hero``.

    Returns
    -------
    dict
        ``{"items": [...]}`` in the same item shape as :func:`load_examples`,
        name-sorted.

    Notes
    -----
    ``discover(tags=...)`` is the library's own selection verb and the tag is
    **plural**. Its lightweight directory path filters the recipe frame without
    building anything, so this is a frame filter, not eight FFTs. (The singular
    ``tag=`` used to bind into ``**kwargs`` and silently return the whole base;
    ``aggregate`` 1.0.0a173 made that a ``TypeError``.)

    The result is intersected with the library names so a session-built program
    that happens to carry ``tags{role:hero}`` cannot reach the landing gallery.
    """
    uw = _underwriter()
    library = set(_library_only(uw.recipes).index.get_level_values("name"))
    found = uw.discover(tags="role:hero")
    items = []
    for name in found.index:
        if name not in library:
            continue
        try:
            recipe = uw.recipe(name)
        except Exception:  # noqa: BLE001
            logger.warning("skipping hero %s: cannot resolve", name)
            continue
        items.append(_entry(recipe.kind, name, recipe))
    return {"items": sorted(items, key=lambda i: i["name"])}
