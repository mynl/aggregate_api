"""Static table rendering through ``greater_tables``.

The api's JSON wire format is lossy for presentation. ``serializers.py``
flattens MultiIndex columns to dotted strings and resets the index into
ordinary data columns, which is right for a grid and wrong for a printed
exhibit: a portfolio's ``tail_df`` carries a two level row index, so the unit
name is reprinted on all ten of its return-period rows. ``greater_tables``
sparsifies that to once per block, and it can only do so where the real
DataFrame still exists, which is here.

This module renders alongside the client's own static tables rather than
replacing them; see ``dev/done/plan-greater-tables.md``. Nothing routes here
unless the caller asks.

Notes
-----
Three constraints come from reading ``greater_tables`` 5.3.0 rather than from
its documentation, and all three are load bearing:

* ``tikz`` defaults to **True**, computing LaTeX output on every call that we
  would immediately discard. Always pass ``tikz=False``.
* ``GT`` **raises** above ``large_warning`` (50) rows unless ``large_ok=True``.
  That is not a warning. A six unit portfolio's ``tail_df`` is 70 rows.
* Its CSS is scoped to ``#{df_id}``, a content hash of the frame, with only
  ``.greater-table`` global (flex centering plus ``overflow-x: auto``). That is
  what makes the emitted blob safe to inject into a page that already has
  styles of its own.

Row emphasis is applied here, as a class on the ``<tr>``, rather than by putting
markup in the cells. ``greater_tables`` does pass HTML in a cell through
unescaped, but a numeric column carrying ``<b>1,234</b>`` fails the
``cast_to_floats`` step, and that is what earns the number formatting and the
right alignment. Marking the row keeps both.
"""

from __future__ import annotations

from typing import Any, Callable

import pandas as pd
from bs4 import BeautifulSoup
from greater_tables import GT

# Hard ceiling, well above any frame that belongs in a static exhibit and well
# below anything that would hang a request. `reins_density_df` is 65,536 rows
# and stays CsvGrid's job permanently; this is the guard that says so out loud
# rather than letting someone discover it with a 60 second render.
MAX_ROWS = 500

#: Class names the SPA styles. Kept here because this module is what emits them.
ROW_HIGHLIGHT = "grt-row-hi"
ROW_EMPHASIS = "grt-row-em"


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


def _anchor_row(df: pd.DataFrame, row: int) -> bool:
    """A capital anchor: 1-in-200 (Solvency II) or 1-in-250 (US)."""
    T = level_value(df, row, "T")
    try:
        return int(T) in (200, 250)
    except (TypeError, ValueError):
        return False


#: Per-frame emphasis, mirroring what the SPA's own static tables mark.
#: Frames absent from this map render unmarked, which is most of them.
EMPHASIS: dict[str, dict[str, Callable[[pd.DataFrame, int], bool]]] = {
    "summary": {
        "emphasize": lambda df, i: (
            level_value(df, i, "X") == "Agg" or _is_total(df, i)
        ),
    },
    "tail_df": {
        "highlight": _anchor_row,
        "emphasize": _is_total,
    },
}


def _mark_rows(
    html: str,
    df: pd.DataFrame,
    highlight: Callable[[pd.DataFrame, int], bool] | None,
    emphasize: Callable[[pd.DataFrame, int], bool] | None,
) -> str:
    """Add row classes to the emitted table.

    ``greater_tables`` emits one ``<tr>`` per frame row inside ``<tbody>``, in
    frame order, so the mapping is positional. Verified rather than assumed: a
    portfolio ``tail_df`` of 30 rows emits 30 body rows.

    Returns the html unchanged when neither predicate is given, which skips the
    parse entirely for the frames that want no marking.
    """
    if highlight is None and emphasize is None:
        return html
    soup = BeautifulSoup(html, "html.parser")
    body = soup.find("tbody")
    if body is None:
        return html
    rows = body.find_all("tr", recursive=False)
    if len(rows) != len(df):
        # Shapes disagree, so positional marking would mark the wrong lines.
        # A table with no emphasis beats a table with misplaced emphasis.
        return html
    for i, tr in enumerate(rows):
        classes = []
        if highlight is not None and highlight(df, i):
            classes.append(ROW_HIGHLIGHT)
        if emphasize is not None and emphasize(df, i):
            classes.append(ROW_EMPHASIS)
        if classes:
            tr["class"] = [*tr.get("class", []), *classes]
    return str(soup)


def render_html(
    df: pd.DataFrame,
    *,
    which: str | None = None,
    caption: str = "",
    max_rows: int = MAX_ROWS,
    **overrides: Any,
) -> str:
    """Render a frame as a self-contained html blob, styles included.

    Parameters
    ----------
    df : pandas.DataFrame
        The frame, with its index intact. Do **not** ``reset_index()`` first:
        the row index is what gets sparsified, and flattening it into data
        columns throws away the whole benefit.
    which : str, optional
        Frame name, used to look up row emphasis in ``EMPHASIS``. Unknown and
        missing names render unmarked.
    caption : str, optional
        Caption above the table.
    max_rows : int, optional
        Refuse anything larger. See ``MAX_ROWS``.
    **overrides
        Passed to ``GT``, which merges them over its ``Configurator`` defaults.

    Returns
    -------
    str
        ``<div class='greater-table'>`` wrapping a scoped ``<style>`` and the
        table. Safe to inject: every rule is scoped to the frame's content hash
        except ``.greater-table`` itself.

    Raises
    ------
    ValueError
        If the frame is empty, wider than its column names can distinguish, or
        longer than ``max_rows``.
    """
    if df is None or df.empty:
        raise ValueError("nothing to render: the frame is empty")
    if len(df) > max_rows:
        raise ValueError(
            f"{len(df)} rows exceeds the {max_rows} row static-table limit; "
            "large frames belong in the interactive grid"
        )
    if not df.columns.is_unique:
        # GT raises on this itself; saying so here names the frame instead of
        # surfacing a library error the caller cannot place.
        raise ValueError("frame has duplicate column names")

    gt = GT(
        df,
        caption=caption,
        # See the module notes: both of these are required, not tuning.
        tikz=False,
        large_ok=True,
        **overrides,
    )
    marks = EMPHASIS.get(which or "", {})
    return _mark_rows(
        gt.html, df, marks.get("highlight"), marks.get("emphasize")
    )
