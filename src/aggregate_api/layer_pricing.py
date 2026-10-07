"""One deterministic quote per reinsurance layer, written into the DecL clause.

The Quick Re row composes coverage and, through here, a price: each layer leaves
with a ``deposit`` or a ``rol``, so the program that lands in the editor is a
quote sheet rather than a bare structure. One method, no options, no radio
buttons; the parameters are the constants at the top of this module and nothing
in the UI reaches them.

The method, per layer: four candidate prices, take the largest.

.. code-block:: text

    sd_load   = el + LAMBDA * sd
    min_rol   = MIN_ROL * share * limit
    premium   = max(sd_load, ph_price, dual_price, min_rol)
    written   = premium / (1 - cede)

The minimum rate on line is a **candidate** rather than a floor applied after
the comparison. It is the same number either way, and it says more: ``binds``
names the measure that set the price, so a layer quoted off the minimum reads
``min_rol`` instead of reading ``dual`` beside a premium the dual transform did
not produce. An unlimited layer has no rate-on-line base, so it has no fourth
candidate and competes on three.

Why each piece is there, since none of it is a clamp and the shaping is meant
to be read off the formula rather than configured.

**The standard deviation load does the shaping.** It gives
``LR = 1 / (1 + LAMBDA * cv)``, which is literally "low volatility, high loss
ratio". It also delivers the attachment ladder without a ladder being drawn: a
layer hit with annual probability ``p`` always satisfies
``cv >= sqrt((1 - p) / p)``, because among all payments in ``[0, limit]`` with a
given attachment probability the all-or-nothing one has the smallest variance
relative to its mean. So ``LR <= 1 / (1 + LAMBDA * sqrt((1 - p) / p))``, whose
right side is increasing in ``p``: the loss ratio cannot rise as the attachment
probability falls. The margin-monotone clamp of the retired ``aggregate-asp``
experiment is a theorem here, and is not implemented.

**The two distortions bind in different places.** On the worked tower
``dual 1.8`` binds on the working layers and ``ph 0.7`` on the upper ones, which
is right economically: the dual transform loads the body of a distribution and
the proportional hazard transform loads the tail. Taking the maximum of three
measures is also what a reinsurer does with three indications.

**The minimum rate on line terminates the ladder.** As ``p`` goes to zero the
standard deviation load behaves like ``LAMBDA * limit * sqrt(p)``, so it decays
through any sensible floor and the floor takes over exactly where capacity
layers live. It is the one clamp kept, and it is the natural end of the ladder
rather than a patch on it.

**No aggregate surcharge.** "An aggregate cover costs more than the
corresponding occurrence layer" falls out, where "corresponding" means the same
probability pair resolved on each tier's own distribution, which is exactly what
the Quick Re percentage boxes mean: at equal percentiles the aggregate layer is a
genuinely rare event and its cv says so. If the ordering is ever wanted at equal
annual attachment probability too, that is a second ``LAMBDA`` for the aggregate
tier and not a clamp.

**Determinism.** Every input is a pure function of the gross object and the
layer: survival curves off a built object, auxiliary builds at a fixed capped
log2 from rendered DecL, fixed distortion parameters, fixed rounding. Same
boxes, same program text, every time. No solving, no iteration, and no
dependence on a layer's position in the tower, which is what made the ``asp``
ladder move every price whenever a tower was re-chopped.

Notes
-----
The quote relies on three properties of the engine, each measured against it
rather than assumed. They are why none of this needs new distributional
mathematics or any library internals.

**A layer's annual moments are closed form off the gross object**, so the form
can quote with no build at all. See :func:`layer_moments`, which ties to
``Aggregate.reins_stats_df`` to 5e-11 relative on the mean and 8e-8 on the cv.

**A layer's exact annual distribution costs one small build.**
``Aggregate.reins_program('occurrence ceded to <y> xs <a>')`` renders the DecL
for a single-layer *ceded* program, whose aggregate distribution is that layer's
annual ceded loss. ``ceded to`` replaces the tier's program rather than
appending to it, so the auxiliary object carries that one layer and nothing
else even when the object it came from already cedes. Measured at 55 ms per
layer at log2 16, and the quote is flat in log2 (0.13% between log2 14 and 19),
which is why :data:`PRICE_LOG2` caps the auxiliary builds regardless of the
object's own log2: a pricing indication does not need a fine lattice, and the
cap keeps the press snappy on a book built at log2 20.

``Aggregate.reins_price_df`` is deliberately not used. Its views are ``gross`` /
``ceded`` / ``net``, so it prices the whole cession and not the layers.

**The grammar already spells all of this.** ``deposit <amount>``,
``rol <fraction>``, ``rate <fraction>`` and ``cede <fraction>`` all parse on
both tiers and survive the round trip through ``reins_program``. Two parser
constraints matter here: ``rol`` needs a finite limit, which is why an unlimited
layer is always spelled as a deposit, and ``cede`` needs a premium clause on the
same layer, which it always has by construction.

One wrinkle worth knowing before reading a build's notes. A plain ``agg`` builds
the loss structure and *ignores* the ceded premium, with
``IgnoredDecLClauseWarning``: "a plain 'agg' has no premium context". The price
only bites inside a ``pnl`` or ``xpnl``. The program text keeps the full
declaration and ``pnl_program`` inlines it, so the demo is that Quick Re writes
a priced program and PnL then turns it into a ledger carrying the ceded premium
layer by layer. The warning is accurate and rides along in the build notes
rather than being suppressed.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from aggregate import Distortion

#: Standard deviation load, so ``LR = 1 / (1 + 0.3 cv)``.
#:
#: Not arbitrary. On the worked tower the three measures agree within about 3%,
#: so the load is calibrated against the two distortions rather than guessed,
#: and the maximum is a cross-check as often as it is a binding constraint.
LAMBDA = 0.30

#: Proportional hazard shape. Loads the tail, and binds high in a tower.
PH_SHAPE = 0.7

#: Dual shape. Loads the body, and binds low in a tower.
DUAL_SHAPE = 1.8

#: Minimum rate on line, as a fraction of ``share * limit``.
MIN_ROL = 0.01

#: Annual attachment probability below which the quote is spelled ``rol``.
#:
#: A high bar: on the worked tower only the top layer clears it, where the
#: ``asp`` rule of thumb ("claim count to layer < 0.5") would put the top three
#: on a rate. It has the merit of biting in the same place as
#: :data:`MIN_ROL`, so the two top-of-tower behaviors arrive together.
ROL_THRESHOLD = 0.10

#: Significant figures the written premium is rounded to. A quote-sheet number.
SIG_FIGS = 3

#: Significant figures the rate on line is rounded to, on a ``rol``-spelled
#: layer where the rate is what the clause carries.
#:
#: Four rather than three, because the rate is a small number read to the basis
#: point: a top-of-tower rate of 1.217% rounded to three figures is 1.22%, which
#: moves the premium by a quarter of a percent for no gain in legibility.
ROL_FIGS = 4

#: Cap on the auxiliary pricing builds. See the module Notes for why 16 is
#: enough and why the object's own log2 is not used.
PRICE_LOG2 = 16

#: Default ceding commission. There is no box for it in the UI; the gross-up is
#: implemented and tested so that the box is a one-line addition later.
CEDE = 0.0

#: The two distortions, built once. They are stateless.
_PH = Distortion("ph", PH_SHAPE)
_DUAL = Distortion("dual", DUAL_SHAPE)

#: The tier vocabulary, matching the quantiles route and the DecL keyword.
_TIERS = ("occurrence", "aggregate")


def _round_sig(x: float, figures: int = SIG_FIGS) -> float:
    """Round to a number of significant figures, not decimal places.

    A quote is read as ``823`` or ``1,560``, never as ``823.26``, and the scale
    of a premium is whatever the book's scale is, so decimal places cannot be
    fixed in advance.

    Parameters
    ----------
    x : float
        The value to round. Zero and negatives pass through unchanged, since
        neither has a leading digit to count from.
    figures : int, optional
        Significant figures to keep. Defaults to :data:`SIG_FIGS`.

    Returns
    -------
    float
    """
    if not (x > 0) or not math.isfinite(x):
        return float(x)
    return round(x, -int(math.floor(math.log10(x))) + (figures - 1))


def _layer_grid(obj: Any, attach: float, limit: float):
    """The midpoint grid across one layer, and the lattice step.

    Midpoints rather than endpoints, because the sums below are Riemann sums
    over the lattice cells and the engine's own layering arithmetic reads the
    cell that way. An unlimited limit runs to the end of the lattice, which is
    the whole of what the model knows about.

    Parameters
    ----------
    obj : Any
        A built ``Aggregate``, for its bucket size and lattice extent.
    attach : float
        Bottom of the layer, on the loss axis.
    limit : float
        Width of the layer. ``inf`` runs to the top of the lattice.

    Returns
    -------
    (numpy.ndarray, float)
        The midpoints, and ``bs``.
    """
    bs = float(obj.bs)
    if not math.isfinite(limit):
        top = float(obj.density_df.index[-1])
        limit = max(top - attach, 0.0)
    xs = np.arange(attach, attach + limit, bs) + bs / 2
    return xs, bs


def _survival(obj: Any, tier: str, xs) -> np.ndarray:
    """The survival function the tier's layer is cut out of.

    Occurrence reads the per-claim severity and aggregate the annual loss, which
    is the whole difference between the two tiers: a cession applies either to
    one claim or to the year.

    Parameters
    ----------
    obj : Any
        A built ``Aggregate``.
    tier : {'occurrence', 'aggregate'}
    xs : numpy.ndarray
        Points to evaluate at.

    Returns
    -------
    numpy.ndarray

    Notes
    -----
    The aggregate side interpolates ``density_df.S`` rather than reading it at
    the index, because the midpoint grid falls between lattice points by
    construction. That interpolation is the whole of the aggregate tier's small
    disagreement with the engine's exact per-layer figures, which lands in the
    fourth or fifth significant figure.
    """
    if tier == "occurrence":
        return np.asarray(obj.sev.sf(xs), dtype=float)
    index = obj.density_df.index.to_numpy()
    return np.interp(xs, index, obj.density_df.S.to_numpy())


def layer_moments(obj: Any, tier: str, attach: float, limit: float,
                  share: float = 1.0) -> tuple[float, float]:
    """Mean and standard deviation of the annual loss in one layer.

    Closed form off the **gross** object, with no build, which is what lets the
    Quick Re row quote live as the boxes are typed.

    Parameters
    ----------
    obj : Any
        A built ``Aggregate``, read for its severity, its frequency and its
        lattice. The gross object, not a ceded one.
    tier : {'occurrence', 'aggregate'}
        Which distribution the layer is cut out of.
    attach : float
        Bottom of the layer, on the loss axis.
    limit : float
        Width of the layer. ``inf`` runs to the top of the lattice.
    share : float, optional
        Placed share, which scales the mean linearly and the standard deviation
        linearly, so it leaves the cv alone.

    Returns
    -------
    (float, float)
        ``(mean, sd)``. A layer the model places no mass in returns
        ``(0.0, 0.0)`` rather than a nan, which is the honest answer for a
        capacity layer above the severity limit and is what lets the minimum
        rate on line quote it anyway.

    Notes
    -----
    With ``S`` the tier's survival function, ``m1`` the integral of ``S`` over
    ``[a, a + y]`` and ``m2 = 2 * integral of (x - a) S(x) dx`` over the same
    range, ``m1`` and ``m2`` are the first two moments of the layered loss. The
    second uses the identity ``E[Y^2] = 2 * integral of y P(Y > y) dy``, applied
    to the layered variable ``Y = min(max(X - a, 0), y)``, which is why the
    integrand carries the ``(x - a)`` factor and the range is the layer rather
    than the half line.

    On the occurrence tier the layered severity is then compounded through the
    frequency, taking ``f1`` and ``f2`` from ``frequency.freq_moms(n)``:

    .. code-block:: text

        mean = s * f1 * m1
        var  = s^2 * (f1 * (m2 - m1^2) + (f2 - f1^2) * m1^2)

    which is the usual compound variance, the within-claim term plus the term
    the frequency's own dispersion contributes. On the aggregate tier the layer
    is cut out of the annual loss directly, so ``mean = s * m1`` and
    ``var = s^2 * (m2 - m1^2)`` with no compounding.

    Measured against the engine's own exact per-layer figures from
    ``Aggregate.reins_stats_df``, which computes each layer's annual
    distribution by FFT, on ``agg G 100 claims 20000 xs 0 sev lognorm 50 cv 4``
    at log2 19:

    .. code-block:: text

        layer           el        cv     relative error, el / cv
        100 xs 100     704.1686  0.3515      5.2e-11 / 7.7e-08
        300 xs 200     758.9755  0.5598      4.4e-11 / 2.4e-08
        500 xs 500     385.7024  1.0270      1.3e-10 / 4.1e-08
        1000 xs 1000   231.9494  1.8441      2.3e-10 / 3.8e-08
        3000 xs 2000   141.8330  3.8117      7.0e-10 / 4.4e-08
        5000 xs 5000    39.1135  9.6663      4.7e-10 / 1.7e-08

    The agreement holds for a mixed frequency as well as for Poisson, since the
    frequency enters only through its first two moments. The aggregate tier
    agrees to four or five significant figures, the small loss being the grid
    interpolation noted on :func:`_survival`.
    """
    if tier not in _TIERS:
        raise ValueError(f"tier is one of {_TIERS}, got {tier!r}")
    xs, bs = _layer_grid(obj, attach, limit)
    if not xs.size:
        return 0.0, 0.0
    sf = _survival(obj, tier, xs)
    m1 = float(np.sum(sf) * bs)
    m2 = float(2.0 * np.sum((xs - attach) * sf) * bs)
    if tier == "occurrence":
        f1, f2 = (float(m) for m in obj.frequency.freq_moms(obj.n)[:2])
        mean = share * f1 * m1
        var = share ** 2 * (f1 * (m2 - m1 ** 2) + (f2 - f1 ** 2) * m1 ** 2)
    else:
        mean = share * m1
        var = share ** 2 * (m2 - m1 ** 2)
    return float(mean), float(math.sqrt(max(var, 0.0)))


def attachment_probability(obj: Any, tier: str, attach: float) -> float:
    """Probability that the layer is hit at all this year.

    Parameters
    ----------
    obj : Any
        A built ``Aggregate``, the gross object.
    tier : {'occurrence', 'aggregate'}
    attach : float
        Bottom of the layer.

    Returns
    -------
    float

    Notes
    -----
    The aggregate tier reads ``S`` off ``density_df`` and is exact: the annual
    loss exceeding the attachment *is* the layer being hit.

    The occurrence tier answers ``1 - exp(-n * S_sev(a))``, the chance that at
    least one of the year's claims pierces the attachment. That is exact for
    Poisson and a close reading otherwise, since a mixed frequency has the same
    mean and more dispersion, so the true figure is a little lower. Exactness is
    not needed: the only decision this number makes is whether the quote is
    spelled ``deposit`` or ``rol``, a threshold comparison at
    :data:`ROL_THRESHOLD`, and it is reported on the form as a reading of how
    remote the layer is.

    This is deliberately **not** the ``pr_attach`` of
    ``Aggregate.reins_stats_df``, which on the occurrence tier is the severity
    survival ``S_sev(a)``, the chance that *one claim* pierces the attachment.
    For a book with a hundred claims a year the two differ by two orders of
    magnitude, and it is the annual reading that says whether a layer is a
    working one.
    """
    if tier not in _TIERS:
        raise ValueError(f"tier is one of {_TIERS}, got {tier!r}")
    if tier == "aggregate":
        index = obj.density_df.index.to_numpy()
        return float(np.clip(
            np.interp(attach, index, obj.density_df.S.to_numpy()), 0.0, 1.0))
    expected = float(obj.n) * float(obj.sev.sf(attach))
    return float(-np.expm1(-expected))


def _expected_count(obj: Any, tier: str, attach: float) -> float | None:
    """Expected number of claims reaching the layer in a year.

    Occurrence only. On the aggregate tier a layer is pierced by the year's
    total, so a claim count to the layer is not a quantity that means anything
    and the answer is ``None`` rather than a number nobody should read.

    Parameters
    ----------
    obj : Any
        A built ``Aggregate``, the gross object.
    tier : {'occurrence', 'aggregate'}
    attach : float
        Bottom of the layer.

    Returns
    -------
    float or None
    """
    if tier != "occurrence":
        return None
    return float(obj.n) * float(obj.sev.sf(attach))


def _min_rol_premium(share: float, limit: float) -> float | None:
    """The minimum-rate-on-line premium for one layer, or ``None``.

    One place computes it, because it is read twice: as the fourth candidate in
    :func:`layer_quotes`, and as the floor :func:`_finish` applies on the
    indication path, which has no distortion candidates to compare it against.

    Parameters
    ----------
    share, limit : float
        The layer as placed. ``limit`` may be ``inf``.

    Returns
    -------
    float or None
        ``None`` on an unlimited layer: a fraction of an infinite limit is not
        a number, and a rate on line is not how such a cover is quoted anyway.
    """
    base = share * limit
    return MIN_ROL * base if math.isfinite(base) else None


def _spelling(attach_pr: float, limit: float) -> str:
    """How this layer's premium is written: ``deposit`` or ``rol``.

    An unlimited layer is always a deposit, because the parser refuses a rate on
    line without a finite limit, a rate on line being a fraction of
    ``share * limit``. Otherwise a layer remote enough to clear
    :data:`ROL_THRESHOLD` quotes on a rate, which is how a capacity layer is
    actually quoted.
    """
    if not math.isfinite(limit):
        return "deposit"
    return "rol" if attach_pr < ROL_THRESHOLD else "deposit"


def _finish(el: float, sd: float, technical: float, tier: str,
            attach: float, limit: float, share: float, attach_pr: float,
            cede: float) -> dict:
    """Floor, gross up, round, and describe one layer's quote.

    The tail shared by the no-build indication and the full quote, so the floor,
    the gross-up, the rounding and the spelling decision cannot drift between
    what the form promises and what the press writes.

    **What gets rounded follows the spelling.** A ``deposit`` layer carries its
    premium in the clause, so the premium is the quote-sheet number and the rate
    is its quotient. A ``rol`` layer carries its rate, so the rate rounds to
    :data:`ROL_FIGS` and the premium follows from it. Either way the clause and
    this row agree to the digit, which is the point: the clause states one of
    the pair and the quote sheet is where the other is checked.

    Parameters
    ----------
    el, sd : float
        The layer's annual mean and standard deviation.
    technical : float
        The reinsurer's net risk-loaded premium before the floor.
    tier : {'occurrence', 'aggregate'}
    attach, limit, share : float
        The layer as placed.
    attach_pr : float
        Annual attachment probability, which decides the spelling.
    cede : float
        Ceding commission. The technical premium is the reinsurer's net, so the
        written premium is ``technical / (1 - cede)``.

    Returns
    -------
    dict
        One quote row. ``cv`` and ``loss_ratio`` are ``None`` on a layer the
        model places no mass in, rather than a nan that no serializer and no
        reader handles well, and ``limit`` is ``None`` on an unlimited cover,
        matching how the request spells one. The rate-on-line floor does not
        apply to an unlimited layer: a fraction of an infinite limit is not a
        number, and a rate on line is not how such a cover is quoted anyway.
    """
    if not (0.0 <= cede < 1.0):
        raise ValueError(f"cede is a fraction below 1, got {cede!r}")
    base = share * limit
    min_rol = _min_rol_premium(share, limit)
    floor = min_rol if min_rol is not None else 0.0
    premium = max(technical, floor)
    spelling = _spelling(attach_pr, limit)
    gross = premium / (1.0 - cede)
    if spelling == "rol" and base > 0:
        rol = _round_sig(gross / base, ROL_FIGS)
        written = rol * base
    else:
        written = _round_sig(gross)
        rol = (written / base) if math.isfinite(base) and base > 0 else None
    return {
        "tier": tier,
        "attach": float(attach),
        "limit": float(limit) if math.isfinite(limit) else None,
        "share": float(share),
        "el": el,
        "sd": sd,
        "cv": (sd / el) if el > 0 else None,
        "pr_attach": attach_pr,
        "lol": (el / base) if base > 0 and math.isfinite(base) else None,
        "floored": premium <= floor and floor > 0,
        "premium": written,
        "rol": rol,
        "spelling": spelling,
        "cede": float(cede),
        "loss_ratio": (el / written) if written > 0 else None,
    }


def indication(obj: Any, tier: str, attach: float, limit: float,
               share: float = 1.0, cede: float = CEDE) -> dict:
    """The no-build quote for one layer, for the form to show as you type.

    The standard deviation load, the floor and the gross-up, with no distortion
    term and so no build. Cheap enough to recompose on every settled keystroke,
    which is what it is for.

    Parameters
    ----------
    obj : Any
        A built ``Aggregate``, the gross object.
    tier : {'occurrence', 'aggregate'}
    attach, limit : float
        The layer, on the loss axis. ``limit`` may be ``inf``.
    share : float, optional
        Placed share.
    cede : float, optional
        Ceding commission.

    Returns
    -------
    dict
        The layer's expected loss, standard deviation, cv, expected claim count
        on the occurrence tier, loss on line, annual attachment probability,
        indicated premium (as ``premium``, the same key the full quote uses),
        rate on line, spelling and loss ratio.

    Notes
    -----
    **The indication can only be revised upward by the press**, never down,
    which is what makes showing it on the form honest. The full quote is a
    maximum that includes this same standard deviation load and is then floored
    by the same floor, so it is bounded below by what was shown. The moments the
    press uses are these same closed-form ones, so the bound is exact rather
    than approximate.
    """
    el, sd = layer_moments(obj, tier, attach, limit, share)
    attach_pr = attachment_probability(obj, tier, attach)
    row = _finish(el, sd, el + LAMBDA * sd, tier, attach, limit, share,
                  attach_pr, cede)
    row["count"] = _expected_count(obj, tier, attach)
    return row


def _layer_decl(share: float, limit: float, attach: float,
                label: str | None = None,
                premium: tuple[str, float] | None = None) -> str:
    """One layer as DecL, with its placement, its name and its price.

    The tier and the ``net of`` / ``ceded to`` keyword open the clause and are
    the caller's, so they are not arguments here: this writes one layer, and
    every layer in a clause is spelled the same way whichever tier it sits on.

    Parameters
    ----------
    share : float
        Placed share. A whole-layer share emits no placement head, since
        ``100% po`` is a clause saying nothing. The percentage is emitted as a
        literal with its ``%``, which is what tells the grammar this is a share
        and not an absolute amount of cover.
    limit, attach : float
        The layer. An unlimited limit is spelled ``inf``.
    label : str, optional
        The ``as "..."`` name. Load bearing where present: these become the
        ``Step`` labels on every P&L exhibit.
    premium : (str, float), optional
        ``('deposit', amount)`` or ``('rol', fraction)``.

    Returns
    -------
    str

    Notes
    -----
    **A rate on line is written as a bare fraction, never as a percentage.**
    That is the library's own canonical spelling, and
    ``decl_writer._render_reins_clause`` says what it is for: a bare number
    re-parses identically, with no float dust. The ``%`` form does not. The
    parser computes ``12.1705 / 100``, which is ``0.12170500000000001``, and
    ``decl_writer._fmt_num`` renders a non-integral float with ``repr``, the
    shortest string that round-trips, so a layer written ``rol 12.1705%`` comes
    back out of ``reins_program`` as ``rol 0.12170500000000001``. Written
    ``rol 0.121705`` it comes back verbatim.
    """
    head = "" if abs(share - 1.0) < 1e-9 else f"{share * 100:g}% po "
    span = "inf" if not math.isfinite(limit) else f"{limit:g}"
    text = f"{head}{span} xs {attach:g}"
    if premium is not None:
        keyword, value = premium
        text += (f" rol {value:g}" if keyword == "rol"
                 else f" deposit {value:g}")
    if label:
        text += f' as "{label}"'
    return text


def layer_quotes(uw: Any, obj: Any, layers, cede: float = CEDE,
                 labels=None) -> list[dict]:
    """One quote per layer: three measures and the minimum rate on line.

    Parameters
    ----------
    uw : aggregate.underwriter.Underwriter
        The caller's own base, used for the auxiliary pricing builds. Passed in
        rather than reached for, for the reason every build path here takes it:
        which base builds a program is the whole of what keeps one user's
        declarations out of another user's.
    obj : Any
        A built ``Aggregate``, the gross object the layers are cut out of.
    layers : iterable of tuple
        ``(tier, share, limit, attach)`` per layer, which is the library's own
        ordering in ``occ_reins`` and ``agg_reins`` with the tier prepended.
    cede : float, optional
        Ceding commission, applied to every layer.
    labels : sequence of (str or None), optional
        The ``as "..."`` name of each layer, in the order given. A missing or
        empty entry falls back to ``Occ n`` / ``Agg n``, numbered within its own
        tier in the order the layers arrive, which is the order the clause
        spells them. Shorter than ``layers`` is not an error; the tail falls
        back.

    Returns
    -------
    list of dict
        One row per layer in the order given, each carrying every component and
        not only the winner: ``sd_load``, ``ph``, ``dual``, ``min_rol``, which
        of the four bound, the layer's ``label``, and then the grossed-up and
        rounded ``premium``. The components are what the Reins quote table
        shows, and the demo is more interesting for having them side by side.

    Notes
    -----
    **The minimum rate on line is the fourth candidate, not a floor after the
    fact.** Through a197 it was applied inside :func:`_finish` after the three
    measures had been compared, so a layer priced off the minimum reported
    ``binds = 'dual'`` beside a premium the dual transform did not produce, and
    the only signal that the minimum had bitten was the ``floored`` boolean.
    The premium is the same number; ``binds`` now names what set it.

    ``label`` and ``min_rol`` are attached here rather than inside
    :func:`_finish`, which the indication path shares. The response models carry
    ``extra="forbid"``, and ``LayerIndication`` declares neither, so a row
    carrying them would fail validation on the preview route. They belong
    beside ``sd_load``, ``ph``, ``dual`` and ``binds`` in any case: all six are
    the full quote's, and the indication has no clause to take a name from.

    The expected loss and standard deviation come from :func:`layer_moments` off
    the gross object rather than from the auxiliary build's own ``est_m`` and
    ``est_sd``. Two reasons: the closed form is exact where the auxiliary
    build's figures carry the discretization of a log2 16 lattice, and using the
    same moments the form used makes :func:`indication` an exact lower bound on
    this result rather than an approximate one. The auxiliary build is used for
    the two distortion prices alone, which is the one thing it is needed for.

    The auxiliary pmf carries numerical noise of order 1e-16 negative, which
    trips ``choquet_weights`` with "distorted atom weights materially
    negative", so it is clipped at zero and renormalized before pricing.
    """
    given = list(labels or ())
    counts: dict[str, int] = {}
    rows = []
    for i, (tier, share, limit, attach) in enumerate(layers):
        el, sd = layer_moments(obj, tier, attach, limit, share)
        attach_pr = attachment_probability(obj, tier, attach)
        sd_load = el + LAMBDA * sd
        ph_price, dual_price = _distortion_prices(
            uw, obj, tier, share, limit, attach)
        candidates = {"sd": sd_load, "ph": ph_price, "dual": dual_price}
        min_rol = _min_rol_premium(share, limit)
        if min_rol is not None:
            candidates["min_rol"] = min_rol
        binds = max(candidates, key=candidates.__getitem__)
        counts[tier] = counts.get(tier, 0) + 1
        label = (given[i] if i < len(given) else None) or (
            f"{'Occ' if tier == 'occurrence' else 'Agg'} {counts[tier]}")
        row = _finish(el, sd, candidates[binds], tier, attach, limit, share,
                      attach_pr, cede)
        row.update(sd_load=sd_load, ph=ph_price, dual=dual_price, binds=binds,
                   min_rol=min_rol, label=label,
                   count=_expected_count(obj, tier, attach))
        rows.append(row)
    return rows


def _distortion_prices(uw: Any, obj: Any, tier: str, share: float,
                       limit: float, attach: float) -> tuple[float, float]:
    """The proportional hazard and dual prices of one layer's annual loss.

    One auxiliary build per layer, at :data:`PRICE_LOG2`. See the module Notes
    for why ``ceded to`` isolates the layer and why the cap is enough.

    Parameters
    ----------
    uw : aggregate.underwriter.Underwriter
        The caller's base.
    obj : Any
        The gross object, for its ``reins_program``.
    tier : {'occurrence', 'aggregate'}
    share, limit, attach : float
        The layer as placed.

    Returns
    -------
    (float, float)
        ``(ph, dual)``. A layer the model places no mass in prices at zero on
        both, which lets the minimum rate on line take over cleanly.
    """
    clause = f"{tier} ceded to " + _layer_decl(share, limit, attach)
    aux = uw(obj.reins_program(clause), log2=PRICE_LOG2, bs=0)
    pmf = aux.density_df.p.clip(lower=0.0)
    total = float(pmf.sum())
    if not total > 0:
        return 0.0, 0.0
    pmf = pmf / total
    return float(_PH.price(pmf).ask), float(_DUAL.price(pmf).ask)


def price_clause(uw: Any, obj: Any, cession, cede: float = CEDE
                 ) -> tuple[str, list[dict]]:
    """Rewrite one composed cession clause with a premium on every layer.

    Parameters
    ----------
    uw : aggregate.underwriter.Underwriter
        The caller's base.
    obj : Any
        The gross object being ceded.
    cession : str or list of str
        The clause, or one per tier, exactly as ``reins_program`` takes it.
    cede : float, optional
        Ceding commission, applied to every layer.

    Returns
    -------
    (str or list of str, list of dict)
        The priced clause, one entry per tier the cession named, and the quote
        rows behind it in the order the clause spells them.

    Notes
    -----
    **The library's reading of the clause is authoritative.** The layers are
    read back off the spec rather than scraped out of the caller's string, so a
    placement or a limit the Quick Re row spelled loosely cannot diverge from
    what gets priced, and the returned clause is recomposed from those same
    triples. That is the point of the round trip rather than an accident of it.

    The spec is read with ``uw(program, update=False)``, which parses and builds
    the spec without the FFT, measured at 13 ms. The alternative is the full
    build, which ``post_reins`` then does again on the priced program, so this
    saves a build of the net object rather than paying for one.
    """
    program = obj.reins_program(cession)
    spec = uw(program, update=False)
    clauses, rows = [], []
    for tier in _TIERS:
        prefix = "occ" if tier == "occurrence" else "agg"
        triples = getattr(spec, f"{prefix}_reins", None)
        if not triples:
            continue
        kind = getattr(spec, f"{prefix}_kind", "") or "net of"
        labels = spec.spec.get(f"{prefix}_reins_label") or [None] * len(triples)
        quotes = layer_quotes(
            uw, obj, [(tier, s, y, a) for s, y, a in triples], cede=cede,
            labels=labels)
        parts = [
            _layer_decl(share, limit, attach, label,
                        (quote["spelling"],
                         quote["premium"] if quote["spelling"] == "deposit"
                         else quote["rol"]))
            for (share, limit, attach), label, quote
            in zip(triples, labels, quotes)
        ]
        # The clause keeps the spec's own label, which is `None` where the
        # cession wrote no `as "..."`; the fallback name belongs to the quote
        # sheet's `Layer` column and not to the program text, where an invented
        # name would come back out of `reins_program` as if it had been typed.
        clauses.append(f"{tier} {kind} " + " and ".join(parts))
        rows.extend(quotes)
    if not clauses:
        return cession, []
    return (clauses[0] if len(clauses) == 1 else clauses), rows


def policy_limit(obj: Any) -> float | None:
    """The largest occurrence limit the program declares, or ``None``.

    The per-claim window, which is what bounds any occurrence cession: a layer
    attaching at or above it covers nothing, because no single claim can reach
    it. Read off the object's own ``exp_limit``, taking the maximum over a
    profile, which is the same reading the library's
    ``charts._emit_reins._claim_window`` takes.

    Parameters
    ----------
    obj : Any
        Any built object. Only an ``Aggregate`` carries an ``exp_limit``.

    Returns
    -------
    float or None
        ``None`` where the cover is unlimited, where any one line of a profile
        is unlimited (the book's per-claim cover is then unbounded, whatever the
        other lines say), or where the object declares no such clause at all.
        An infinite limit is not a window, so it is reported as the absence of
        one rather than as ``inf``: the caller's question is "is there a ceiling
        here", and ``None`` is the honest answer when there is not.
    """
    spec = getattr(obj, "spec", None)
    if not isinstance(spec, dict):
        return None
    limit = spec.get("exp_limit", math.inf)
    try:
        limit = float(max(limit)) if hasattr(limit, "__len__") else float(limit)
    except (TypeError, ValueError):
        return None
    return limit if math.isfinite(limit) else None
