"""Pricing dispatch -- distortion-based or constant cost of capital.

The ``POST /v1/objects/{id}/pricing_at`` endpoint accepts a flexible
body and the server picks the underlying method based on which
fields are present:

* ``ccoc`` set                       → :meth:`Portfolio.price_ccoc`
* ``distortion`` set (+ ``p`` or ``a``) → :meth:`Portfolio.pricing_at`

Pricing is Portfolio-only in v1; calling on an Aggregate raises
``ValueError`` and the route turns that into HTTP 400.

Why dispatch in one endpoint
----------------------------

The SPA's pricing pane has one form -- "distortion or CoC, asset
level or probability". A single endpoint matches that UX and keeps
the client honest (server validates the combination, client just
ships the form values).
"""

from __future__ import annotations

from typing import Any


def _document(df, formats: str = "price") -> dict | None:
    """One frame as a table document, or None if it cannot be built.

    Parameters
    ----------
    df : pandas.DataFrame
        The frame, index intact.
    formats : str
        Format-set key, see ``tables.FORMATS``. Loss ratios and returns on
        capital are floats, so nothing in the dtype says they read as percents;
        naming the set here is what makes both views agree on that.

    Notes
    -----
    Best effort on purpose. These documents feed the SPA's table views, so a
    frame that will not build (empty, duplicate column names) costs that one
    table its document and nothing else: the SPA falls back to the plain frame,
    which is where it would have been anyway. Never worth a 500.
    """
    from .tables import frame_document_dict

    try:
        return frame_document_dict(df, formats=formats)
    except Exception:  # noqa: BLE001 -- a static table is never worth a 500
        return None


def run_pricing(
    obj: Any,
    *,
    p: float | None,
    a: float | None,
    ccoc: float | None,
    distortion: str | None,
) -> dict:
    """Dispatch to the right Portfolio method.

    Parameters
    ----------
    obj : Portfolio
        The live object.
    p, a : float | None
        Probability or asset level. Exactly one must be set.
    ccoc : float | None
        If set, use ``price_ccoc(ccoc, p=p)``. Requires ``p``.
    distortion : str | None
        Distortion name (looked up on ``obj.distortions``) for
        ``pricing_at(distortion, p=..., a=...)``.

    Returns
    -------
    dict
        Matches :class:`PricingResponse`: headline fields plus a
        per-unit ``rows`` list-of-dicts.
    """
    # Pricing surface is Portfolio-only; Aggregate has no
    # ``pricing_at`` / ``price_ccoc``. Check up front so we can
    # raise a clean error rather than AttributeError mid-call.
    if not hasattr(obj, "pricing_at"):
        raise ValueError("pricing endpoint requires a Portfolio")

    if (p is None) == (a is None):
        # Same invariant the Portfolio methods enforce; flag early
        # so the client gets a sensible 400 instead of bubbling the
        # library ValueError through HTTPException.
        raise ValueError("exactly one of p or a must be provided")

    if ccoc is not None:
        # ``price_ccoc(ccoc, *, p)``: it computes ``a`` internally via q(p),
        # so ``p`` is required (and keyword-only); reject a stray ``a``.
        if p is None:
            raise ValueError("price_ccoc requires p (probability)")
        df = obj.price_ccoc(ccoc, p=p)
        # The price_ccoc DataFrame has a single row indexed
        # 'total'; expose it as a list-of-dicts for symmetry with
        # the distortion path.
        rows = _df_to_records(df)
        return {
            "a": _scalar(df.loc["total", "a"]) if "a" in df.columns else None,
            "p": p,
            "ccoc": ccoc,
            "distortion": None,
            "rows": rows,
        }

    if distortion is None:
        raise ValueError("must supply either ccoc or distortion")

    df = obj.pricing_at(distortion, p=p, a=a)
    rows = _df_to_records(df, index_name="unit")
    # ``pricing_at`` doesn't return the asset level itself in the
    # frame; recover it the same way the method did to surface on
    # the response.
    a_used = a if a is not None else obj.q(p)
    return {
        "a": _scalar(a_used),
        "p": p,
        "ccoc": None,
        "distortion": distortion,
        "rows": rows,
    }


def run_price_pentagon(
    obj: Any,
    *,
    p: float | None = None,
    a: float | None = None,
    coc: float | None = None,
    lr: float | None = None,
    ir: bool = False,
) -> dict:
    """Pricing-pentagon completion, plus distortion analysis for Portfolios.

    Parameters
    ----------
    obj : Aggregate | Portfolio
        The live object (both expose ``price_pentagon``).
    p : float, optional
        VaR probability fixing the capital level; mutually exclusive with ``a``.
    a : float, optional
        Asset level fixing the capital, snapped to the grid by the library;
        mutually exclusive with ``p``. The library has taken either anchor since
        the pentagon landed, and the app now offers both: a reinsurance program
        is written to an asset level far more often than to a probability.
    coc, lr : float | None
        Exactly one pricing target -- cost of capital (ROE) or loss ratio.
    ir : bool
        Also return a table document per frame, for the SPA's static view. Built
        from the frames with their index intact, before ``reset_index_safe``
        flattens them for the wire.

    Returns
    -------
    dict
        Matches :class:`PriceResponse`: ``kind``, the one-row ``pentagon``
        frame, an optional ``distortions`` map (Portfolio only), any
        ``warnings``, and the optional ``ir`` map.

    Notes
    -----
    For a Portfolio we calibrate distortions to the pentagon's cost of capital
    at the same ``p`` and run :meth:`Portfolio.analyze_distortions`, exposing
    the ``LR`` / ``P`` / ``PQ`` / ``ROE`` slices of its ``pricing_df``. The
    library may *skip* a distortion (e.g. the mass/ccoc distortion on an
    unbounded portfolio) -- that surfaces as a warning and we render whatever
    came back rather than failing.
    """
    from .serializers import frame_to_payload, reset_index_safe

    if (coc is None) == (lr is None):
        raise ValueError("pass exactly one of coc (CoC/ROE) or lr (loss ratio)")
    if (p is None) == (a is None):
        raise ValueError("pass exactly one of p (VaR probability) or a (assets)")
    if not hasattr(obj, "price_pentagon"):
        raise ValueError("pricing requires an Aggregate or Portfolio")

    target = {"ROE": coc} if coc is not None else {"LR": lr}
    anchor = {"p": p} if p is not None else {"a": a}
    pent = obj.price_pentagon(**anchor, **target)
    is_port = type(obj).__name__ == "Portfolio"
    out: dict = {
        "kind": "port" if is_port else "agg",
        "pentagon": frame_to_payload(reset_index_safe(pent)),
        "distortion_df": None,
        "distortions": None,
        "warnings": [],
    }
    # The static view's documents, built from the frames **before**
    # `reset_index_safe` flattens them. These frames are computed here rather
    # than living on the object, so the generic `frame/{which}` route cannot
    # reach them and they have to travel with the response.
    docs: dict = {}
    if ir:
        docs["pentagon"] = _document(pent)

    # Calibrate to the pentagon's own cost of capital at the same anchor. Both
    # steps are best-effort -- collect warnings, don't 500.
    import warnings as _warnings

    warns: list[str] = []
    roe = coc if coc is not None else _scalar(pent["ROE"].iloc[0])
    # Both of these take either anchor, so the caller's choice threads all the
    # way through and the calibration happens at exactly the capital level the
    # pentagon was completed at.
    try:
        obj.calibrate_distortions(roe, **anchor)
    except Exception as exc:  # noqa: BLE001 -- reported as a warning
        warns.append(f"calibrate_distortions: {exc}")

    # The calibrated-distortions detail (one row per standard distortion) is
    # populated by calibrate_distortions even when allocation later balks at
    # an unbounded ccoc -- surface it below the pentagon.
    dist_df = getattr(obj, "distortion_df", None)
    if dist_df is not None:
        out["distortion_df"] = frame_to_payload(reset_index_safe(dist_df))
        if ir:
            docs["distortion_df"] = _document(dist_df)

    if not is_port:
        # An aggregate stops here. It gets the pentagon and the distortion
        # parameters, and no allocation: `analyze_distortions` reads the
        # `exeqa_*` columns, which are what a portfolio's density frame carries
        # and a single aggregate has no analogue of.
        #
        # Through a51 it returned before the calibration too, so an aggregate
        # with no reinsurance showed one row of pentagon results and nothing
        # else, while the same aggregate *with* a cession showed the parameters
        # (down the reins pricing path) and a portfolio showed them either way.
        # `calibrate_distortions` is on Aggregate as well; nothing was missing
        # but the call.
        out["warnings"] = warns
        out["ir"] = docs or None
        return out

    with _warnings.catch_warnings(record=True) as caught:
        _warnings.simplefilter("always")
        ad = obj.analyze_distortions(**anchor)
        warns.extend(str(w.message) for w in caught)

    pdf = ad.pricing_df
    dist: dict = {}
    for stat in ("LR", "P", "PQ", "ROE"):
        try:
            sl = pdf.xs(stat, level="stat")
        except KeyError:
            continue
        dist[stat] = frame_to_payload(reset_index_safe(sl))
        if ir:
            # Columns here are units, not statistics, and the whole slice is one
            # statistic, so the format is that stat's applied across.
            docs[stat] = _document(sl, f"stat_{stat}")
    out["distortions"] = dist
    out["warnings"] = warns
    out["ir"] = docs or None
    return out


# ----------------------------------------------------------------------
# Reinsurance-aware pricing
# ----------------------------------------------------------------------
# The three aggregate bases ``reins_density_df`` carries, in program order:
# before any cession, after the occurrence program, and the object's own final
# distribution. Verified: ``p_agg_net`` reproduces ``obj.density_df.p_total``
# exactly, for a ``net of`` program and for a ``ceded to`` one (where the "net"
# the program asked for is the reinsurer's position, and the object is that).
_REINS_BASES = (
    ("gross", "p_agg_gross"),
    ("net occ", "p_agg_net_occ"),
    ("net", "p_agg_net"),
)


class _BasisView:
    """One basis of a reinsured object, shaped like the thing that prices it.

    ``Aggregate.calibrate_distortions`` resolves its survival, expected loss and
    premium target from ``self.density_df``, which under a cession is the *net*
    distribution. There is no public keyword for pointing it at another one, so
    this presents a chosen ``reins_density_df`` column with the small surface
    that method reads: ``bs``, ``density_df``, ``q`` / ``cdf`` / ``snap``,
    ``_is_loss_value``, and three attributes it writes its results back onto.

    Nothing here re-implements pricing. The quantile / cdf / snap / lev calls all
    delegate to a real :class:`GridDistribution` built over the chosen column,
    and the calibration itself is the library's own method invoked on this view.
    The alternative was reproducing ``_pricing._calibration_survival`` and the
    cost-of-capital to premium inversion in this repo, which is exactly the
    copied-internals the house rule forbids, and which would fail by producing
    prices that are plausible and wrong.

    Parameters
    ----------
    source : Aggregate
        The built object, for ``bs`` and the loss orientation.
    loss : numpy.ndarray
        The shared grid, from ``reins_density_df['loss']``.
    mass : numpy.ndarray
        The chosen basis column: a pmf over that grid.
    name : str
        Basis label, carried onto the GridDistribution.
    """

    def __init__(self, source: Any, loss, mass, name: str) -> None:
        import pandas as pd

        from aggregate._grid_distribution import GridDistribution

        self.name = name
        self.bs = source.bs
        self._is_loss_value = getattr(source, "_is_loss_value", True)
        self.density_df = pd.DataFrame(
            {"p_total": mass}, index=pd.Index(loss, name="loss")
        )
        self.gd = GridDistribution(loss, mass, bs=source.bs, name=name)
        # calibrate_distortions writes its results here.
        self.distortions = None
        self.distortion_df = None
        self.calibration_df = None

    def q(self, p, kind="lower"):
        return float(self.gd.q(p, kind))

    def cdf(self, x):
        return float(self.gd.cdf(x))

    def snap(self, x):
        return float(self.gd.snap(x))


def reins_bases(obj: Any) -> list[str]:
    """Basis labels this object can be priced on, or ``[]`` for no reinsurance.

    ``net occ`` is offered only when **both** stages are present. With no
    occurrence cover it is the gross; with an occurrence cover and no aggregate
    cover it is the net. Either way it would be a third column of numbers
    identical to one already on screen, which is worse than absent: a reader who
    sees three bases assumes three answers.
    """
    rd = getattr(obj, "reins_density_df", None)
    if rd is None:
        return []
    both_stages = (getattr(obj, "occ_reins", None) is not None
                   and getattr(obj, "agg_reins", None) is not None)
    return [
        name for name, column in _REINS_BASES
        if column in rd.columns and (both_stages or name != "net occ")
    ]


def run_reins_price(
    obj: Any,
    *,
    p: float | None = None,
    a: float | None = None,
    coc: float | None = None,
    lr: float | None = None,
    basis: str = "gross",
    ir: bool = False,
) -> dict:
    """Price every reinsurance basis off one calibration, and show the spread.

    Calibrate the standard distortion set on ``basis`` to the requested cost of
    capital (or loss ratio) at probability ``p``, then apply that same set,
    unchanged, to each of the other bases. What separates the answers is the
    distribution, which is the whole point: the difference between the gross and
    the net premium is the **allowance for reinsurance in the rate**.

    Parameters
    ----------
    obj : Aggregate
        A built object carrying reinsurance.
    p, a : float, optional
        Exactly one capital anchor, matching :func:`run_price`. ``p`` is a VaR
        probability; ``a`` is an asset level **on the calibration basis**, which
        the library's ``prob_loss_assets`` converts to the probability it sits
        at. Either way what travels to the other bases is the *probability*, so
        each takes its own asset level ``a = q(p)`` and the comparison holds the
        threshold fixed rather than the capital (a reinsured book needs less
        capital, and that saving is part of what the cession bought).

        Both anchors have been on the form since a44 and only ``p`` reached this
        function, so choosing assets on a reinsured object was a 422.
    coc, lr : float, optional
        Exactly one pricing target on the calibration basis.
    basis : str
        Which basis to calibrate on; see :func:`reins_bases`.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.ReinsPriceResponse`.

    Notes
    -----
    Every number here comes from the library. ``prob_loss_assets`` resolves the
    ``(p, L, a)`` capital anchor, :class:`aggregate.pentagon.Pentagon` turns
    ``(L, a, target)`` into the premium, ``calibrate_distortions`` fits the set,
    and ``Distortion.price`` applies it. The api contributes the bookkeeping:
    which distribution goes in, and the subtraction at the end.
    """
    from aggregate.distributions import Aggregate
    from aggregate.pentagon import Pentagon

    from .serializers import frame_to_payload

    if (coc is None) == (lr is None):
        raise ValueError("pass exactly one of coc (CoC/ROE) or lr (loss ratio)")
    if (p is None) == (a is None):
        raise ValueError("pass exactly one of p (VaR probability) or a (assets)")
    rd = getattr(obj, "reins_density_df", None)
    if rd is None:
        raise ValueError("no reinsurance on this object")
    available = reins_bases(obj)
    if basis not in available:
        raise ValueError(
            f"unknown basis {basis!r}; expected one of {', '.join(available)}"
        )

    loss = rd["loss"].to_numpy(dtype=float)
    columns = dict(_REINS_BASES)
    views = {
        name: _BasisView(obj, loss, rd[columns[name]].to_numpy(dtype=float), name)
        for name in available
    }

    # ---- calibrate on the chosen basis -------------------------------
    #
    # The anchor is resolved once, on the calibration basis, from whichever end
    # the caller gave. `prob_loss_assets` answers a mutually consistent
    # (p, L, a) from either, so an asset level becomes the probability the other
    # bases are then compared at, and the whole path below sees one `p` exactly
    # as it always did.
    cal = views[basis]
    anchor = cal.gd.prob_loss_assets(**({"p": p} if p is not None else {"a": a}))
    p = float(anchor.p)
    target = Pentagon()
    target.solve(L=anchor.L, a=anchor.a, **({"roe": coc} if coc is not None
                                            else {"lr": lr}))
    roe = float(target.as_series()["ROE"])

    warnings: list[str] = []
    try:
        # The library's own calibration, invoked on the view. Unbound, because
        # the view is not an Aggregate; it is the argument that method reads.
        Aggregate.calibrate_distortions(cal, roe, p=p)
    except Exception as exc:  # noqa: BLE001 -- reported, never a 500
        raise ValueError(f"calibration failed on the {basis} basis: {exc}") from None
    dists = cal.distortions or {}
    if not dists:
        raise ValueError(f"no distortions calibrated on the {basis} basis")

    # ---- price every basis with that same set ------------------------
    rows: list[dict] = []
    for dist_name, dist in dists.items():
        priced: dict[str, dict] = {}
        for name, view in views.items():
            a_here = float(view.gd.q(p))
            quote = dist.price(view.density_df["p_total"], a=a_here)
            priced[name] = _pentagon_row(L=float(quote.el), P=float(quote.ask),
                                         a=a_here)
        for name in views:
            rows.append({
                "distortion": dist_name,
                # The asterisk marks the basis the distortion was fitted to. The
                # other rows are that same distortion applied stand-alone, which
                # is what makes them comparable.
                "basis": f"{name}*" if name == basis else name,
                **priced[name],
            })
        for name in views:
            if name == basis:
                continue
            rows.append({
                "distortion": dist_name,
                "basis": f"{basis} less {name}",
                **_pentagon_diff(priced[basis], priced[name]),
            })

    import pandas as pd

    table = pd.DataFrame(rows)
    docs: dict = {}
    if ir:
        docs["table"] = _document(table, "reins_price")
        if cal.distortion_df is not None:
            docs["distortion_df"] = _document(cal.distortion_df)
    return {
        "basis": basis,
        "bases": available,
        "p": p,
        "roe": roe,
        "a": float(anchor.a),
        "table": frame_to_payload(table),
        "distortion_df": (frame_to_payload(cal.distortion_df.reset_index())
                          if cal.distortion_df is not None else None),
        "warnings": warnings,
        "ir": docs or None,
    }


def _pentagon_row(*, L: float, P: float, a: float) -> dict:
    """The pricing octet at one basis, from its expected loss and premium.

    ``M = P - L`` and ``Q = a - P`` are the accounting identities, not a model;
    :class:`Pentagon` completes the ratios so this file never spells out what
    ``LR`` or ``ROE`` mean.
    """
    from aggregate.pentagon import Pentagon

    pent = Pentagon()
    pent.solve(L=L, P=P, a=a)
    out = pent.as_series().to_dict()
    return {k: _scalar(out.get(k)) for k in ("a", "L", "M", "P", "Q", "LR", "PQ", "ROE")}


def _pentagon_diff(first: dict, second: dict) -> dict:
    """``first - second`` on the levels, with the ratios recomputed on the result.

    The level columns subtract because they are money. The ratios do **not**: a
    difference of two loss ratios is not a loss ratio. Recomputing them from the
    differenced levels gives the thing worth reading, the implied pricing *of the
    cession itself*, so ``LR`` on this row is the loss ratio the reinsurance is
    being bought at.
    """
    levels = {k: _sub(first.get(k), second.get(k)) for k in ("a", "L", "M", "P", "Q")}
    out = dict(levels)
    P, L, M, Q = (levels["P"], levels["L"], levels["M"], levels["Q"])
    out["LR"] = (L / P) if (P not in (None, 0) and L is not None) else None
    out["PQ"] = (P / Q) if (Q not in (None, 0) and P is not None) else None
    out["ROE"] = (M / Q) if (Q not in (None, 0) and M is not None) else None
    return out


def _sub(a, b):
    """``a - b``, or None if either side is missing."""
    if a is None or b is None:
        return None
    return a - b


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------

def _df_to_records(df, *, index_name: str | None = None) -> list[dict]:
    """DataFrame → list-of-dicts with the index included.

    Pricing frames are small (≤ 10 rows, ≤ 10 cols) so the verbosity
    of list-of-dicts (vs the wider density_df list-of-lists form) is
    actually a win for readability on the client.
    """
    out: list[dict] = []
    idx_name = index_name or (df.index.name or "index")
    for idx, row in df.iterrows():
        rec: dict = {idx_name: idx}
        for col, val in row.items():
            rec[str(col)] = _scalar(val)
        out.append(rec)
    return out


def run_evaluate(
    obj: Any,
    *,
    premium: float | None = None,
    ir: bool = False,
) -> dict:
    """The breakeven acceptability panel: what stress this position survives.

    The other half of the Pricing group. Determining a price asks what the
    obligation is worth at a chosen capital level; evaluating one asks how much
    stress the position you already hold survives. The library solves, per
    distortion family, for the shape at which the risk-adjusted margin reaches
    zero, and reports the family-agnostic Cherny and Madan index ``gini_p``.

    Three shapes come back from one method, which is why this runner is thin.
    An ``Aggregate`` or a ``Portfolio`` evaluates its own position, one block.
    A ``PnL`` evaluates **every margin row of its ledger**, so a tower reads as
    a story: the gross deal, each layer as a position in its own right, and the
    running net after each purchase.

    Parameters
    ----------
    obj : Aggregate | Portfolio | PnL
        The live object; all three expose ``evaluate``.
    premium : float, optional
        The consideration to measure against. Only an ``Aggregate`` or a
        ``Portfolio`` takes one, and only when its own exposure states none: a
        position has to have a premium before it can be evaluated, and the
        library raises rather than guessing. A ``PnL`` carries its premium in
        the ledger, so passing one here is a 400 rather than a silent ignore.
    ir : bool
        Also return the table document for the SPA's static view, built from
        the frame with its index intact.

    Returns
    -------
    dict
        Matches :class:`aggregate_api.models.EvaluateResponse`.

    Notes
    -----
    ``DegenerateEvaluationWarning`` is not an error and is not swallowed. It
    fires when no breakeven level exists, either because the premium does not
    cover the expected loss (unacceptable at any stress) or because the position
    cannot lose (acceptable at every stress). Both report ``NaN`` in the panel,
    so the warning is what tells the reader which of the two they are looking
    at, and it travels in ``warnings``.
    """
    import warnings as _warnings

    from .serializers import frame_to_payload, reset_index_safe

    if not hasattr(obj, "evaluate"):
        raise ValueError(
            "evaluation requires an Aggregate, a Portfolio or a P&L")

    is_pnl = type(obj).__name__ == "PnL"
    if is_pnl and premium is not None:
        raise ValueError(
            "a P&L carries its own premium in the ledger; drop the premium "
            "argument and evaluate it as it stands")

    warns: list[str] = []
    with _warnings.catch_warnings(record=True) as caught:
        _warnings.simplefilter("always")
        panel = obj.evaluate() if is_pnl else obj.evaluate(premium)
        warns.extend(str(w.message) for w in caught)

    return {
        "kind": "pnl" if is_pnl else ("port" if type(obj).__name__ == "Portfolio"
                                      else "agg"),
        "panel": frame_to_payload(reset_index_safe(panel)),
        "warnings": warns,
        "ir": {"panel": _document(panel, "price")} if ir else None,
    }


def _scalar(value):
    """Coerce numpy scalars and non-finite floats for JSON."""
    import math
    import numpy as np

    if value is None:
        return None
    if isinstance(value, (np.integer, np.floating)):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value
