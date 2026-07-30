"""Static tables as a semantic document, not as markup.

The api's JSON wire format is lossy for presentation. ``serializers.py``
flattens MultiIndex columns to dotted strings and resets the index into
ordinary data columns, which is right for a grid and wrong for a printed
exhibit: a portfolio's ``tail_df`` carries a two level row index, so the unit
name would be reprinted on all ten of its return-period rows.

So the static path does not go through that wire format at all. It hands the
real DataFrame to ``greatest_tables``, which returns a **table document**: an
``ir_version`` 1 JSON structure carrying dtypes, resolved formats, hierarchy,
spans and flags, and carrying no widths and no CSS. The browser owns geometry.
A walker shipped in the same package renders it, so the renderer and the
document can never version skew.

Notes
-----
This replaces an evaluation path (``greater_tables`` 5.x) that returned an html
blob and stamped row emphasis onto it with a positional BeautifulSoup pass. The
emphasis now rides in the document as ``row_flags``, which is what deletes that
pass rather than tidying it. See ``dev/plan-gt2-ir.md``.

Row flags use the IR's own vocabulary (total / subtotal / emphasis / muted)
rather than reproducing the old css class names, because the vocabulary happens
to fit: a portfolio's ``total`` row is a total, a unit's ``Agg`` line is that
unit's subtotal, and the capital anchors are the only rows left wanting plain
emphasis. Styling those is the SPA's business, which is the separation the whole
exercise is about.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Sequence

import pandas as pd
from greatest_tables import TableSpec, build, canonical_json

# Truncation ceiling, well above any frame that belongs in a static exhibit.
# Unlike the 5.x path this does not refuse: ``build`` slices to the cap and
# appends a note saying so, before doing any formatting work, so even a 65,536
# row density frame is cheap to ask for. The SPA still routes big frames to the
# grid, which is the honest answer for them, but a direct request degrades
# rather than erroring.
MAX_ROWS = 500


def level_value(df: pd.DataFrame, row: int, name: str) -> Any:
    """Value of index level ``name`` in row ``row``, or None when absent.

    Parameters
    ----------
    df : pandas.DataFrame
        Frame whose index is being read.
    row : int
        Positional row number.
    name : str
        Index level name, e.g. ``'unit'``, ``'X'``, ``'T'``.

    Returns
    -------
    Any or None
        None when the frame has no such level, so a caller can write one
        predicate that works for both the Aggregate and the Portfolio shape of
        a frame. An Aggregate's ``tail_df`` is indexed by ``T`` alone; the
        Portfolio's by ``(unit, T)``.
    """
    names = list(df.index.names or [])
    if name not in names:
        return None
    label = df.index[row]
    if df.index.nlevels == 1:
        return label
    return label[names.index(name)]


def _is_total(df: pd.DataFrame, row: int) -> bool:
    """The portfolio total row, which is the "what is my number" line."""
    return level_value(df, row, "unit") == "total"


def _is_anchor(df: pd.DataFrame, row: int) -> bool:
    """A capital anchor: 1-in-200 (Solvency II) or 1-in-250 (US)."""
    try:
        return int(level_value(df, row, "T")) in (200, 250)
    except (TypeError, ValueError):
        return False


def _summary_flags(df: pd.DataFrame, row: int) -> list[str]:
    """Total row, and each unit's aggregate line as that unit's subtotal."""
    flags = []
    if _is_total(df, row):
        flags.append("total")
    if level_value(df, row, "X") == "Agg":
        flags.append("subtotal")
    return flags


def _tail_flags(df: pd.DataFrame, row: int) -> list[str]:
    """Total row, and the two capital anchors, which are what gets read."""
    flags = []
    if _is_total(df, row):
        flags.append("total")
    if _is_anchor(df, row):
        flags.append("emphasis")
    return flags


#: Per-frame row emphasis. Frames absent from this map build unflagged, which
#: is most of them: a stats or validation frame has no line that carries more
#: weight than its neighbors.
ROW_FLAGS: dict[str, Callable[[pd.DataFrame, int], Sequence[str]]] = {
    "summary": _summary_flags,
    "tail_df": _tail_flags,
    "reins_summary_df": _summary_flags,
}


def frame_spec(df: pd.DataFrame, which: str | None = None) -> TableSpec:
    """The build spec for one named frame.

    Parameters
    ----------
    df : pandas.DataFrame
        The frame, needed here because the row-flag predicates read its index
        rather than the row values ``TableSpec`` would otherwise hand them.
    which : str, optional
        Frame name, used to look up row emphasis in ``ROW_FLAGS``. Unknown and
        missing names build unflagged.

    Returns
    -------
    TableSpec
        Notes
        -----
        ``include_raw='data'`` carries the unrounded value beside the formatted
        text on every numeric cell. That is what lets a copy or a CSV export off
        the rendered table give real numbers instead of display strings, and it
        is cheap: the frames that reach here are at most a few hundred rows.
    """
    flags = ROW_FLAGS.get(which or "")
    return TableSpec(
        include_raw="data",
        max_rows=MAX_ROWS,
        row_flags=(lambda pos, _row: flags(df, pos)) if flags else None,
    )


def frame_document(df: pd.DataFrame, which: str | None = None) -> tuple[bytes, str]:
    """Render a frame as canonical table-document JSON.

    Parameters
    ----------
    df : pandas.DataFrame
        The frame, **with its index intact**. Do not ``reset_index()`` first:
        the row index is what gets sparsified into stub rowspans, and flattening
        it into data columns throws away the whole benefit.
    which : str, optional
        Frame name, for row emphasis. See ``ROW_FLAGS``.

    Returns
    -------
    body : bytes
        Deterministic UTF-8 JSON: the same frame and spec give byte identical
        output, which is what makes the content hash usable as an ETag.
    hash : str
        The document's 12-hex content hash, returned alongside so a caller can
        set an ETag without parsing the body back.

    Raises
    ------
    ValueError
        If the frame is empty or carries duplicate column names.
    """
    if df is None or df.empty:
        raise ValueError("nothing to render: the frame is empty")
    if not df.columns.is_unique:
        # Naming the frame here beats surfacing a library error the caller
        # cannot place.
        raise ValueError("frame has duplicate column names")
    doc = build(df, frame_spec(df, which))
    return canonical_json(doc), doc.hash


def frame_document_dict(df: pd.DataFrame, which: str | None = None) -> dict:
    """``frame_document`` as a parsed object, for embedding in a JSON response.

    The frame routes return the canonical bytes directly, because that is what
    the ETag hashes. The POST pricing endpoints carry their documents *inside* a
    Pydantic response, so those need the parsed form.
    """
    body, _hash = frame_document(df, which)
    return json.loads(body)
