"""Static tables as a semantic document, not as markup.

The api's JSON wire format is lossy for presentation. ``serializers.py``
flattens MultiIndex columns to dotted strings and resets the index into
ordinary data columns, which is right for a grid and wrong for a printed
exhibit: a portfolio's ``tail_df`` carries a two level row index, so the unit
name would be reprinted on all ten of its return-period rows.

So the static path does not go through that wire format at all. It hands the
real DataFrame to ``greater_tables``, which returns a **table document**: an
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
from greater_tables import TableSpec, build, canonical_json

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

#: Per-frame column formats, for the columns whose dtype does not say enough.
#:
#: A loss ratio and a return on capital are both just floats, so the engine has
#: no way to know they should read as percents. These say so once, in the
#: document, and **both** views then render from the same resolved format: the
#: walker draws it, and ``irToGridInput`` maps it into the grid's own format-spec
#: language. The strings are the same ones the SPA used to carry in three
#: hand-written maps, which is what this replaces.
#:
#: A value is either a mapping of column name to spec, or a single spec that
#: applies to **every** column. The second form is for the per-distortion slices,
#: whose columns are unit names rather than statistics: the whole slice is one
#: statistic, so one format covers it.
FORMATS: dict[str, dict[str, object] | str] = {
    # The pricing pentagon, whose columns are the statistics themselves.
    "price": {"LR": ".1%", "ROE": ".0%", "P": ",d", "PQ": ".3f"},
    # Gross / ceded / net by distortion, plus the difference rows.
    "reins_price": {
        "a": ",d", "L": ",d", "M": ",d", "P": ",d", "Q": ",d",
        "LR": ".1%", "PQ": ".3f", "ROE": ".1%",
    },
    # One per-distortion slice each, columns being units.
    "stat_LR": ".1%",
    "stat_P": ",d",
    "stat_PQ": ".3f",
    "stat_ROE": ".0%",
}


def frame_spec(
    df: pd.DataFrame, which: str | None = None, formats: str | None = None
) -> TableSpec:
    """The build spec for one named frame.

    Parameters
    ----------
    df : pandas.DataFrame
        The frame, needed here because the row-flag predicates read its index
        rather than the row values ``TableSpec`` would otherwise hand them.
    which : str, optional
        Frame name, used to look up row emphasis in ``ROW_FLAGS``. Unknown and
        missing names build unflagged.
    formats : str, optional
        Key into ``FORMATS``. Separate from ``which`` because several frames
        share one format set: the four per-distortion slices are all priced the
        same way.

    Returns
    -------
    TableSpec
        Notes
        -----
        ``include_raw`` carries the unrounded value beside the formatted text,
        which is what lets the interactive grid sort and filter on real numbers.
        ``irToGridInput`` refuses a document built without it.

        It is the **explicit column list**, not the ``'data'`` shorthand the
        handoff spec names, and the difference is load bearing: ``'data'`` means
        numeric, date and bool columns only, so a string data column gets no raw
        value and the adapter then throws on the whole document. Three of the
        Price tab's frames carry one (``distortion``, ``param_name``). Naming
        every column is what makes the two features compose. Reported upstream;
        see ``dev/TODO.md``.

        Columns absent from a ``FORMATS`` entry are left to the engine, which
        infers from the dtype. Only the ones whose meaning outruns their dtype
        need naming.
    """
    flags = ROW_FLAGS.get(which or "")
    chosen = FORMATS.get(formats or "")
    if isinstance(chosen, str):
        columns = {c: chosen for c in df.columns}
    else:
        # Filter to what the frame actually has: an Aggregate's pentagon carries
        # fewer columns than a Portfolio's, and naming an absent one is not an
        # error worth raising.
        columns = {k: v for k, v in (chosen or {}).items() if k in df.columns}
    return TableSpec(
        include_raw=list(df.columns),
        max_rows=MAX_ROWS,
        row_flags=(lambda pos, _row: flags(df, pos)) if flags else None,
        formats=columns,
    )


def frame_document(
    df: pd.DataFrame, which: str | None = None, formats: str | None = None
) -> tuple[bytes, str]:
    """Render a frame as canonical table-document JSON.

    Parameters
    ----------
    df : pandas.DataFrame
        The frame, **with its index intact**. Do not ``reset_index()`` first:
        the row index is what gets sparsified into stub rowspans, and flattening
        it into data columns throws away the whole benefit.
    which : str, optional
        Frame name, for row emphasis. See ``ROW_FLAGS``.
    formats : str, optional
        Format-set key. See ``FORMATS``.

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
    doc = build(df, frame_spec(df, which, formats))
    return canonical_json(doc), doc.hash


def frame_document_dict(
    df: pd.DataFrame, which: str | None = None, formats: str | None = None
) -> dict:
    """``frame_document`` as a parsed object, for embedding in a JSON response.

    The frame routes return the canonical bytes directly, because that is what
    the ETag hashes. The POST pricing endpoints carry their documents *inside* a
    Pydantic response, so those need the parsed form.
    """
    body, _hash = frame_document(df, which, formats)
    return json.loads(body)
