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


# `_is_total`, `_is_anchor`, `_summary_flags` and `_tail_flags` came out at
# a71 with the ROW_FLAGS entries they served. Between them they decided which
# of the library's rows a reader should look at hardest, off a hard-coded
# 1-in-200 and 1-in-250. See ROW_FLAGS below.


#: Per-frame row emphasis. Frames absent from this map build unflagged.
#:
#: **Empty since a71, and it should stay that way.** It held `summary`, `tail_df`
#: and `reins_summary_df`, deciding which of the library's rows carry weight: the
#: total, the subtotals, and the two capital anchors on the return-period ladder.
#: Every one of those tables is a published exhibit that ships its own flags, and
#: the anchors are the clearest case of why this was the wrong place to hold it:
#: which return periods a book is capitalized at is the library's choice, this
#: repo had 1-in-200 and 1-in-250 written down as a fact about it, and the copy
#: had already gone stale by a68 without anybody noticing.
#:
#: The mechanism stays because `frame_document` takes a key and the grid audit
#: still goes through it. Nothing should be added here for a frame the library
#: publishes an exhibit for; that is what the exhibit is.
ROW_FLAGS: dict[str, Callable[[pd.DataFrame, int], Sequence[str]]] = {}

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
#: applies to **every** column. The second form was for a frame whose columns
#: are not statistics: the sharpen score grid's were steps in log2, so one
#: spec covered the lot.
#:
#: Money, everywhere money appears. Grouped, and to the cent.
#:
#: It was ``,d`` through a50, and on a real book that made the whole pricing
#: table integers: every column of the pentagon is money except the three
#: ratios, `P` was declared ``,d`` outright, and `L`, `M`, `Q` and `a` fell
#: through to greater-tables' inference, which drops to zero decimals once a
#: column's mean reaches 20,000 (``engine/formats.py``). So a book priced in the
#: millions reported its margin as a whole number of dollars and its loss ratio
#: to a tenth of a percent, which is the wrong way round: the margin is the
#: small difference between two large numbers and is exactly where the digits
#: are worth having.
#:
#: Two decimals rather than a scale-aware choice. Money is money at every
#: magnitude, and a table whose decimal count moves with the book is harder to
#: read across than one that is slightly over-precise in places.
MONEY = ",.2f"

# `PROBABILITY` came out at a71 with the `tail_df` entry that was its only user.

FORMATS: dict[str, dict[str, object] | str] = {
    # ---- empty, and staying that way --------------------------------------
    #
    # Every entry this map ever held named the formats for a frame whose table
    # the library publishes as an exhibit, which ships its formats resolved, so
    # each was this repo asserting how the library's own numbers print.
    # `summary`, `tail_df`, `validation_df`, `reins_summary_df` and
    # `bs_window_df` came out at a71; the six pricing sets (`price`,
    # `reins_price` and the four `stat_*` slices) at a85; the last two,
    # `sharpen_df` and `sharpen_score`, at a94 when the Sharpen leaf moved
    # onto the `sharpen` exhibit the library registered at 1.0.0a255.
    #
    # The `frame/{which}` route still serves the frames for direct api use; it
    # renders them by dtype inference, and if that reads badly the answer is to
    # fetch the exhibit, which is what the app does. Nothing belongs here for a
    # frame the library publishes an exhibit for; that is what the exhibit is.
}


def frame_spec(
    df: pd.DataFrame, which: str | None = None, formats: str | None = None,
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

        There is no ``full_precision`` here since a68. It rebuilt the document
        with ``formatters={}`` and a wide ``float_format``, which was only ever
        a way to reprint numbers a client could not reach; ``include_raw`` puts
        them in every document, so reprinting is the client's to do and costs no
        round trip. See ``dev/plan-ui-round-5.md``.
    """
    flags = ROW_FLAGS.get(which or "")
    chosen = FORMATS.get(formats or "")
    if isinstance(chosen, str):
        columns = {c: chosen for c in df.columns}
    else:
        # Filter to what the frame actually has: an Aggregate's pentagon carries
        # fewer columns than a Portfolio's, and naming an absent one is not an
        # error worth raising.
        #
        # Under a **spanned** header the name to match is the innermost level,
        # not the whole tuple. `x in df.columns` on a MultiIndex tests the first
        # level, so a frame whose columns are (component, measure) matched none
        # of the measure names declared above and quietly fell through to
        # inference for the whole table. Building the key set from the last
        # level and mapping back to the full tuples is what makes one
        # declaration cover `('freq', 'mean')`, `('sev', 'mean')` and
        # `('agg', 'mean')`, which is right: the format belongs to the measure.
        wanted = chosen or {}
        if isinstance(df.columns, pd.MultiIndex):
            columns = {
                col: wanted[col[-1]] for col in df.columns if col[-1] in wanted
            }
        else:
            columns = {k: v for k, v in wanted.items() if k in df.columns}
    return TableSpec(
        include_raw=list(df.columns),
        max_rows=MAX_ROWS,
        row_flags=(lambda pos, _row: flags(df, pos)) if flags else None,
        # ``formatters``, not ``formats``: the field was renamed somewhere in the
        # ``greater_tables`` 1.9 to 6.0.0a4 run that the sibling checkout has
        # moved through. Following the rename is all a37 does about that move;
        # catching up with the rest of 6.0 is its own piece of work.
        formatters=columns,
    )


def frame_document(
    df: pd.DataFrame, which: str | None = None, formats: str | None = None,
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
