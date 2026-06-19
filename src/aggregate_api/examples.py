"""Parser for ``aggregate/agg/examples.agg`` → grouped DecL examples.

The curated example library doubles as the SPA's dropdown menu source.
Each non-comment, non-blank line is a runnable DecL program. Names follow
the convention ``<Letter>.<Name>`` (e.g. ``A.Basic``, ``C.MixedGamma``);
the letter prefix identifies the category.

Programs may span several physical lines (the portfolios are written
this way for readability); statements are separated by a blank line or
a trailing ``;``, and full-line ``#`` / ``//`` comments are transparent.
Splitting the file into logical statements -- folding continuations,
stripping comments, honoring ``;`` terminators -- is delegated to
``aggregate``'s own ``UnderwritingLexer.preprocess`` so the SPA sees
exactly the statements the default ``build`` underwriter does.

Categories are sourced from the "Contents" block at the top of the
file, which lists ``# A. Title``, ``# B. Title`` etc. -- one for each
letter the body uses.

Cached as a module-level dict; reloaded only on server restart.

Returned shape mirrors :class:`ExamplesResponse` in
``models.py``::

    {
        "categories": [
            {
                "letter": "A",
                "title": "Creating Aggregates...",
                "items": [
                    {"name": "A.Dice00", "decl": "...", "note": "..."}
                ]
            },
            ...
        ]
    }
"""

from __future__ import annotations

import re
import warnings
from functools import lru_cache
from importlib.resources import files
from pathlib import Path

from aggregate.parser import UnderwritingLexer

# Lines like ``# A. Creating Aggregates, Portfolios, and Distortion objects``
# from the Contents block. Capture letter + title.
_CONTENTS_LINE = re.compile(r"^#\s+([A-O])\.\s+(.+)$")

# An item line. Must start with a DecL top-level keyword so we don't
# mistake a comment-stripped section header for a program. Covers the
# object-producing kinds: agg, sev, port, dist, pnl, the bivariate
# family (bivariate / bv) and clash, plus the view-pair prefixes
# netceded / grossceded / grossnet -- which each carry an extra ``agg``
# token before the name (``netceded agg X.Name ...``), so that form is
# matched explicitly. The leading keyword itself is captured but unused;
# the name's ``<Letter>.<Suffix>`` is what drives grouping.
_ITEM_LINE = re.compile(
    r"^(agg|sev|port|dist|pnl|bivariate|bv|clash"
    r"|(?:netceded|grossceded|grossnet)\s+agg)"
    r"\s+([A-O])\.([A-Za-z0-9_.\-]+)\s+(.*)$"
)

# ``note{...}`` trailing annotation. Allowed to span the rest of the
# line. Captured greedily up to the closing brace.
_NOTE = re.compile(r"\s*note\{([^}]*)\}\s*$")


def _load_contents(text: str) -> dict[str, str]:
    """Parse the Contents block at the top of the file.

    Walks every line and picks out ``# X. Title`` rows -- the
    Contents block lives at the top but the parser is content with
    any matching line position, so reordering the file won't break
    the lookup.
    """
    out: dict[str, str] = {}
    for line in text.splitlines():
        m = _CONTENTS_LINE.match(line)
        if m:
            letter, title = m.group(1), m.group(2).strip()
            # Don't let a later duplicate clobber the first hit.
            out.setdefault(letter, title)
    return out


def _load_items(statements: list[str]) -> dict[str, list[dict]]:
    """Group the preprocessed statements by letter prefix.

    Takes the logical statements produced by
    ``UnderwritingLexer.preprocess`` -- already comment-free, folded onto
    one line, and ``;``-terminator-free -- so trailing ``note{...}`` is
    again at end-of-line where :data:`_NOTE` can find it. Each item
    carries the original DecL minus the trailing ``note{...}`` so the
    client can re-evaluate it directly via ``POST /v1/objects``.
    """
    grouped: dict[str, list[dict]] = {}
    for line in statements:
        m = _ITEM_LINE.match(line)
        if not m:
            # Statements that don't match the convention (no Letter.Name)
            # are kept out of the example library; they still parse
            # fine as DecL, but aren't surface-able via the categorized
            # dropdown.
            continue
        kind, letter, _suffix, _body = m.groups()
        # Split off trailing note{...} for the dedicated `note` field.
        note_match = _NOTE.search(line)
        if note_match:
            note = note_match.group(1).strip()
            decl = _NOTE.sub("", line).rstrip()
        else:
            note = None
            decl = line
        # The full Letter.Name name lives at groups (letter, suffix);
        # rebuild as ``letter + '.' + suffix`` for round-trip clarity.
        name = f"{letter}.{m.group(3)}"
        grouped.setdefault(letter, []).append(
            {"name": name, "decl": decl, "note": note}
        )
    return grouped


def _read_suite_text() -> str:
    """Return the examples-source text.

    Prefers ``AGGAPI_EXAMPLES_FILE`` (a curated ``.agg`` on disk) when it is
    set and present; otherwise falls back to the bundled
    ``agg/spa_examples.agg`` discovered via package resources. A configured
    but missing path warns and falls back rather than failing the route.
    """
    from .config import get_settings

    custom = get_settings().examples_file
    if custom:
        path = Path(custom)
        if path.is_file():
            return path.read_text(encoding="utf-8")
        warnings.warn(
            f"AGGAPI_EXAMPLES_FILE={custom!r} not found; "
            "using bundled examples.agg",
            stacklevel=2,
        )
    resource = files("aggregate").joinpath("agg/examples.agg")
    # ``importlib.resources`` traversables expose .read_text() for files.
    return resource.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def load_examples() -> dict:
    """Return the cached examples payload.

    Cached at the module level via ``lru_cache``; the example library is
    parsed once per server process. To pick up edits to examples.agg
    without restarting, call ``load_examples.cache_clear()``.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.ExamplesResponse`:
        ``{"categories": [...]}``.
    """
    text = _read_suite_text()
    # Contents titles come from the raw comment block; items come from the
    # preprocessed statements (comments stripped, continuations folded).
    titles = _load_contents(text)
    items_by_letter = _load_items(UnderwritingLexer.preprocess(text))
    # Build the output in letter order so the SPA dropdown is
    # alphabetically consistent. Letters appearing only in titles
    # but with no items get an empty list; letters with items but
    # no title fall back to "Section <Letter>".
    letters = sorted(set(titles) | set(items_by_letter))
    categories = [
        {
            "letter": letter,
            "title": titles.get(letter, f"Section {letter}"),
            "items": items_by_letter.get(letter, []),
        }
        for letter in letters
    ]
    return {"categories": categories}
