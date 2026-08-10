"""Pydantic v2 schemas for the api request and response bodies.

Each endpoint takes / returns one of these dataclass-like models.
FastAPI validates incoming JSON against the request model and
serializes outgoing responses through the declared return-type
model -- the trip through OpenAPI is automatic.

Flask users: think Marshmallow / pydantic-flask, but tighter --
the model *is* the function parameter type, not a separate
schema you call ``schema.load(request.json)`` on.

Conventions
-----------

* Field names are ``snake_case``.
* All response models opt into ``ConfigDict(extra="forbid")`` so
  the client can rely on the documented field set -- a typo in
  the server code triggers a serialization error instead of
  silently shipping a malformed payload.
* The plan calls for ``InfoResponse.info`` to be a ``dict``,
  but :attr:`aggregate.distributions.Aggregate.info` is a
  multi-line string. We expose the string verbatim; clients can
  display it monospaced. A future structured form is a v1.1
  enhancement.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ----------------------------------------------------------------------
# Shared response config
# ----------------------------------------------------------------------
# Pulled out into a constant so every response model uses identical
# settings. ``extra="forbid"`` enforces that response models only
# carry declared fields (catches accidental leakage of internal data).
_RESPONSE_CFG = ConfigDict(extra="forbid")


# ======================================================================
# Objects -- POST /v1/objects and friends
# ======================================================================

class BuildRequest(BaseModel):
    """Body for ``POST /v1/objects``.

    ``log2`` and ``bs`` are optional -- the underlying ``build()``
    will choose sensible defaults when they're omitted.
    """

    decl: str = Field(..., min_length=1, description="DecL source text.")
    log2: int | None = Field(
        None,
        ge=4,
        description="log2 of the FFT grid size. None means 'let the library pick'.",
    )
    bs: float | None = Field(
        None,
        gt=0,
        description="Bucket size. None means 'let the library pick'.",
    )


class ExhibitCapability(BaseModel):
    """One exhibit an object can serve, as the capability block reports it."""

    model_config = _RESPONSE_CFG

    name: str
    title: str
    # ``raw`` / ``insurer``; the two with a 1.0 implementation. An exhibit whose
    # predicate fails is absent from the list rather than present with none.
    perspectives: list[str] = []


class Capability(BaseModel):
    """What this object can answer, computed by the library, never declared.

    Rides inline on the build response rather than answering a second request,
    because the navigation has to paint immediately and a round trip per build
    to learn the menu is a round trip too many. ``exhibits`` is the same payload
    ``GET /v1/objects/{id}/exhibits`` serves, from the same helper.

    Two facts are deliberately **not** here. ``kind`` and ``has_reins`` already
    ride on the build response, and one field per fact is the point of the
    block: the app's two hand-written per-kind tables died so that nothing says
    the same thing twice.
    """

    model_config = _RESPONSE_CFG

    exhibits: list[ExhibitCapability] = []
    charts: list[str] = []
    # Which of `charts` is the object's own picture, which is what the Overview
    # Plot leaf draws. `charts` answers what *can* be drawn (a reinsured
    # aggregate answers two things); this answers which one to draw with no
    # other instruction. None where nothing claims the object, and the app then
    # says the picture does not exist yet.
    primary_chart: str | None = None
    # Flags for the leaves that are app behavior rather than a library
    # document; each names its consumer in ``capability.py``.
    has_premium: bool = False
    can_sharpen: bool = False
    # Whether a probe has already **run**, which is a different question from
    # whether running one is worth offering: an object can answer True to both.
    # Gates the More group's Sharpen leaf, since `sharpen_df` is None until then.
    has_sharpen: bool = False
    can_pnl: bool = False
    can_reins: bool = False
    # Can the program be re-read as a gross / ceded / net pair? Gates the action
    # row's GCN control. Narrower than `can_reins` and than `has_reins`: the
    # three view prefixes build the joint *per-occurrence* aggregate, so an
    # occurrence cession is required, not merely some cession.
    can_views: bool = False
    # Which calibration bases the reins pricing form may offer, known at build
    # time so the buttons the object cannot answer grey rather than 400. Empty
    # for an object with no cession.
    reins_bases: list[str] = []
    can_price: bool = False
    can_evaluate: bool = False
    can_bounds: bool = False
    can_allocate: bool = False
    needs_premium: bool = False


class Quantile(BaseModel):
    """One probability and the loss at it, exact and rounded.

    Both, because they answer different questions. ``snapped`` is what the
    reinsurance quick-edit form writes into a program a person then reads, and
    a layer is quoted at three significant figures; ``q`` is what anyone
    checking the arithmetic wants.
    """

    model_config = _RESPONSE_CFG

    p: float
    q: float
    snapped: float


class QuantilesResponse(BaseModel):
    """Quantiles at the requested probabilities, in the order asked."""

    model_config = _RESPONSE_CFG

    quantiles: list[Quantile]


class Component(BaseModel):
    """One half of an object built from a pair: its grid and its moments.

    A ``BivariateAggregate`` measures a grid per axis, so ``bs`` and ``log2``
    are two numbers rather than one and the scalar headline fields cannot
    carry them. This is what the status strip reads to print
    ``bs = (a, b) · log2 = (m, n)``.

    Every field is optional because a component is an ordinary ``Aggregate``
    read through ``getattr``, and a kind that does not carry a moment reports
    ``None`` rather than raising.
    """

    model_config = _RESPONSE_CFG

    name: str
    bs: float | None = None
    log2: int | None = None
    mean: float | None = None
    cv: float | None = None


class BuildResponse(BaseModel):
    """Slim response so the post-build page doesn't pay for unused data.

    The SPA's per-button buttons (info, summary, plot, etc.) each
    hit their own endpoint. With ``cached=True`` the data calls are
    O(1) -- effectively the same as if the build returned everything
    eagerly, minus the wasted serialization.
    """

    model_config = _RESPONSE_CFG

    id: str
    # The parser's own kind vocabulary. ``bvagg`` (not ``bivariate``) because
    # where the api and the library disagree on a name, the library wins.
    kind: Literal["agg", "port", "sev", "distortion", "bvagg", "pnl"]
    name: str
    warnings: list[str] = []
    cached: bool
    elapsed_ms: int
    # Headline stats for the SPA's one-line build summary. Optional so a
    # future object kind without these accessors still serializes. ``bs`` and
    # ``log2`` are the *resolved* grid (the library's auto-pick when the
    # request said "auto"), and they belong together: bs alone says how fine
    # the grid is and log2 says how far it reaches, so a reader given one of
    # them cannot tell whether the window covers the distribution.
    bs: float | None = None
    log2: int | None = None
    mean: float | None = None
    cv: float | None = None
    validation: str | None = None
    # Does this object carry a cession? Two consumers: the SPA greys out the
    # Reins tab when it does not (rather than opening a pane that says "no
    # reinsurance on this object"), and it decides whether Price offers the
    # gross / net basis selector. Cheap: read off the cession specs, never off
    # ``reins_summary_df``, which would materialize a frame on every build.
    has_reins: bool = False
    # The loss / payoff sign convention, on every object that has one.
    #
    # a57 sent it only for ``'payoff'``, to keep the status strip's first line
    # from spending a word to say "normal". The result was that it printed for
    # nothing: an ``Aggregate`` and a ``Portfolio`` both answer ``'loss'`` and
    # were suppressed, and a ``PnL`` carries no ``value_type`` at all, so the
    # field the author asked for never once appeared. ``None`` now means the
    # kind has no orientation to report, not that its orientation is ordinary.
    value_type: str | None = None
    # Per-component grid and moments, for an object built from a pair. Empty
    # for every kind but ``bvagg``, whose ``bs`` is genuinely two numbers (one
    # grid per axis) and whose scalar fields above are therefore all ``None``.
    #
    # Additive on purpose: widening ``bs`` / ``log2`` / ``mean`` / ``cv`` to
    # "scalar or pair" would change the shape every consumer reads, for one
    # kind's benefit. See ``routes.objects._component_fields``.
    components: list[Component] = []
    # What this object can answer. The SPA paints its navigation from this and
    # holds no per-kind table of its own.
    capability: Capability = Field(default_factory=Capability)


class DerivedResponse(BuildResponse):
    """A derivation's result: the program that made it, and the object.

    The build manifest plus the DecL text that produced it, because every
    derivation in this app is a program you can see. The text lands in the
    editor, so you read what was built, you can edit it, and history, sharing
    and rebuild all keep working. No hidden state, and no object mutated behind
    a cached id.

    ``id`` is the id an ordinary build of ``program`` would produce, so
    rebuilding the text from the editor is a cache hit rather than a second
    build.
    """

    model_config = _RESPONSE_CFG

    program: str = Field(..., description="The DecL that builds this object.")
    description: str | None = Field(
        None,
        description=(
            "What the derivation did, when it has something to say. Sharpen "
            "fills it with the probe's verdict; the others leave it empty."
        ),
    )


class PnlProgramRequest(BaseModel):
    """Body for ``POST /v1/objects/{id}/pnl``.

    Both ratios are conventions rather than facts, which is why the library
    puts them in the signature where a caller reads them, and why they are
    request fields here rather than server settings. ``loss_ratio`` sizes the
    premium and is used **only** when the engine states none of its own.
    """

    loss_ratio: float = Field(
        0.70, gt=0, le=1,
        description="Sizes the premium as expected loss over this, when there is none to inherit.")
    expense_ratio: float = Field(
        0.25, ge=0, lt=1,
        description="Gross expense as a fraction of premium; 0 omits the clause.")


class NarrativeSection(BaseModel):
    """One heading in the Narrative pane: a short form and a long one."""

    model_config = _RESPONSE_CFG

    name: str
    description: str = ""
    explanation: str = ""


class NarrativeResponse(BaseModel):
    """``GET /v1/objects/{id}/narrative``: everything the object says in prose.

    The ``info`` block first, then a section per text field the object carries.
    Sections are found by suffix rather than listed, so a narrative the library
    adds upstream appears here on its own.
    """

    model_config = _RESPONSE_CFG

    info: str = ""
    sections: list[NarrativeSection] = []


class BoundsRequest(BaseModel):
    """Body for the two tabular bounds routes.

    ``premium`` is the calibration: the price some distortion puts on this
    object. Everything reported is the range over the distortions consistent
    with it, so without a premium there is no question to ask.
    """

    premium: float = Field(..., gt=0, description="Target premium for this object.")
    assets: float | None = Field(
        None, gt=0,
        description="Asset cap; prices min(X, a). Unbounded when omitted.")
    against: list[str] = Field(
        default_factory=list,
        description=("PricingBounds only: the risks to price against this one. "
                     "Each is a unit of the current portfolio, or a DecL "
                     "fragment for a line that does not exist yet. Empty on a "
                     "portfolio means every unit, which is the question a "
                     "portfolio invites; an aggregate has no units, so empty "
                     "there is an error."),
    )


class BoundsResponse(BaseModel):
    """A bounds table: one row per unit or per named risk.

    ``lower`` and ``upper`` are the ends of the consistent range and ``width``
    is the reading, being how much of the price is decided by the choice of
    distortion rather than by the premium the object was calibrated to.
    """

    model_config = _RESPONSE_CFG

    premium: float
    table: FrameResponse
    ir: dict[str, Any] | None = Field(
        None,
        description="Table document for the static view, keyed 'table'.",
    )


class ReinsProgramRequest(BaseModel):
    """Body for ``POST /v1/objects/{id}/reins``.

    ``cession`` is one clause per tier, each opening with ``occurrence`` or
    ``aggregate``. A clause is authoritative for its own tier and leaves the
    other alone, which is how the grammar reads it too, so composing an
    occurrence and an aggregate cession means sending both rather than sending
    one and then ceding again.
    """

    cession: str | list[str] = Field(
        ...,
        description=("A cession clause, or one per tier: "
                     "'occurrence net of 500 xs 500'."),
    )


class ObjectSummary(BaseModel):
    """One row in ``GET /v1/objects`` (cache listing)."""

    model_config = _RESPONSE_CFG

    id: str
    kind: str
    name: str
    ts: str  # ISO 8601


class ObjectListResponse(BaseModel):
    """Wrapper for ``GET /v1/objects``."""

    model_config = _RESPONSE_CFG

    objects: list[ObjectSummary]


class ObjectManifest(BaseModel):
    """``GET /v1/objects/{id}`` -- metadata about a single cached object."""

    model_config = _RESPONSE_CFG

    id: str
    kind: str
    name: str
    decl: str
    log2: int
    bs: float
    created_at: str  # ISO 8601


class DeleteResponse(BaseModel):
    model_config = _RESPONSE_CFG

    ok: bool


# ======================================================================
# Tabular endpoints -- summary / stats_df / density_df / kappa
# ======================================================================

class FrameResponse(BaseModel):
    """Pandas DataFrame as ``(columns, rows)``.

    Rows are list-of-lists rather than list-of-dicts so a wide
    density_df (50+ columns, 2**16+ rows) doesn't redundantly carry
    the column name string with every cell. Trim payload by an
    order of magnitude vs the dict-per-row form.
    """

    model_config = _RESPONSE_CFG

    columns: list[str]
    rows: list[list[Any]]


# ======================================================================
# Info -- raw multi-line string from Aggregate.info / Portfolio.info
# ======================================================================

class InfoResponse(BaseModel):
    model_config = _RESPONSE_CFG

    info: str


class ObjectMetaResponse(BaseModel):
    """``GET /v1/objects/{id}/meta`` -- the object's own DecL metadata.

    The trailer clauses a first-class citizen carries (``note`` / ``tags`` /
    ``hints``) plus the two program renderings. ``doc{{{...}}}`` is deliberately
    absent: it is the cookbook's long-form recipe, not something the playground
    displays.

    ``program`` is what the parser was handed, after preprocessing (folded onto
    one line, comments stripped, any doc body base64-encoded), not the user's
    keystrokes. ``pprogram`` is what the parser understood, re-rendered
    canonically, and is the one to show a reader.

    Every field is optional. They are read through ``getattr`` so a class that
    does not carry one reports ``None`` rather than raising.
    """

    model_config = _RESPONSE_CFG

    kind: str
    name: str
    note: str | None = None
    tags: list[str] = []
    hints: str | None = None
    program: str | None = None
    pprogram: str | None = None


# ======================================================================
# Reinsurance -- text description block
# ======================================================================

class ReinsDescriptionResponse(BaseModel):
    """``GET /v1/objects/{id}/reins_description``.

    ``available`` is False (and ``text`` empty) when the object carries
    no reinsurance, so the SPA can show a neutral "no reinsurance on this
    object" line rather than an error.
    """

    model_config = _RESPONSE_CFG

    available: bool
    text: str


# ======================================================================
# Pricing
# ======================================================================

class PricingRequest(BaseModel):
    """Body for ``POST /v1/objects/{id}/pricing_at``.

    Either ``(distortion, p|a)`` for full distortion pricing or
    ``(ccoc, p)`` for the constant-CoC shortcut. The server picks
    the dispatch based on which fields are present.
    """

    p: float | None = Field(None, gt=0, le=1, description="VaR probability in (0, 1].")
    a: float | None = Field(None, gt=0, description="Asset level.")
    ccoc: float | None = Field(None, gt=0, description="Constant cost of capital.")
    distortion: str | None = Field(
        None, description="Calibrated distortion name (looked up on the Portfolio)."
    )


class PricingResponse(BaseModel):
    """Per-unit breakdown plus headline totals."""

    model_config = _RESPONSE_CFG

    a: float | None
    p: float | None
    ccoc: float | None
    distortion: str | None
    rows: list[dict[str, Any]]


class PriceRequest(BaseModel):
    """Body for ``POST /v1/objects/{id}/price`` (pentagon pricing).

    Exactly one of ``p`` (a VaR probability) or ``a`` (an asset level) fixes the
    capital level, and exactly one pricing target follows: ``coc`` (cost of
    capital / ROE) or ``lr`` (loss ratio). The server enforces both
    exactly-one rules and returns 400 otherwise.

    ``a`` joined at 1.0.0a44. The library's ``price_pentagon`` has taken either
    anchor since it landed and the app only ever sent ``p``, which is the wrong
    default for the case the Pricing group is really for: a program is written
    to an attachment far more often than to a probability.
    """

    p: float | None = Field(
        None, gt=0, le=1, description="VaR probability in (0, 1] fixing capital.")
    a: float | None = Field(
        None, gt=0, description="Asset level fixing capital; snapped to the grid.")
    coc: float | None = Field(None, gt=0, description="Cost-of-capital (ROE) target.")
    lr: float | None = Field(None, gt=0, description="Loss-ratio target.")


class PriceResponse(BaseModel):
    """``POST /v1/objects/{id}/price`` result.

    ``pentagon`` is the one-row completion (both Aggregate and Portfolio).
    ``distortion_df`` (Portfolio only) is the calibrated-distortions detail --
    one row per standard distortion (ccoc / ph / wang / dual / tvar) from
    ``calibrate_distortions``. ``distortions`` is the per-distortion pricing
    map of stat name (``LR`` / ``P`` / ``PQ`` / ``ROE``) to a frame from
    ``analyze_distortions``; both ``None`` for an Aggregate. ``warnings``
    carries any non-fatal messages (e.g. an allocation skipped on an unbounded
    portfolio).
    """

    model_config = _RESPONSE_CFG

    kind: str
    pentagon: FrameResponse
    distortion_df: FrameResponse | None = None
    distortions: dict[str, FrameResponse] | None = None
    warnings: list[str] = []
    # Flat rather than mirroring the nesting above: the client looks one up by
    # name, and a two level map would buy nothing for four fixed stat keys.
    ir: dict[str, Any] | None = Field(
        None,
        description=(
            "Table documents for the static view, keyed 'pentagon', "
            "'distortion_df', and one per stat (LR / P / PQ / ROE). Present "
            "when the request asks with ?ir=true."
        ),
    )


class EvaluateRequest(BaseModel):
    """Body for ``POST /v1/objects/{id}/evaluate`` (the acceptability panel).

    Empty for a P&L, which carries its premium in its ledger, and for an
    aggregate or portfolio whose exposure states one. ``premium`` is for the
    remaining case: a position with no consideration of its own cannot be
    evaluated, and the library raises rather than guessing, so the app asks.
    """

    premium: float | None = Field(
        None,
        gt=0,
        description=(
            "The consideration held against this position. Omit to use the "
            "object's own; rejected for a P&L, whose ledger carries it."
        ),
    )


class EvaluateResponse(BaseModel):
    """``POST /v1/objects/{id}/evaluate`` result.

    ``panel`` is the tidy breakeven frame: one row per (step, distortion), with
    the shape the caller's kind implies. An aggregate or a portfolio evaluates
    one position; a P&L evaluates every margin row of its ledger, so a tower
    reads down the rows as the gross deal, each layer, and the running net.

    ``warnings`` carries ``DegenerateEvaluationWarning`` verbatim rather than
    swallowing it. A ``NaN`` in the panel means no breakeven level exists, and
    the warning is what says whether that is because the premium does not cover
    the expected loss or because the position cannot lose.
    """

    model_config = _RESPONSE_CFG

    kind: str
    panel: FrameResponse
    warnings: list[str] = []
    ir: dict[str, Any] | None = Field(
        None,
        description=(
            "Table document for the static view, keyed 'panel'. Present when "
            "the request asks with ?ir=true."
        ),
    )


class ReinsPriceRequest(BaseModel):
    """Body for ``POST /v1/objects/{id}/reins_price``.

    Same shape as :class:`PriceRequest` plus ``basis``: which reinsurance basis
    the distortion set is calibrated on. The others are then priced with that
    same set, so the spread between them is attributable to the distribution
    rather than to two different calibrations.

    "Same shape as ``PriceRequest``" became true again at 1.0.0a52. ``p`` was
    required and there was no ``a``, while the form above offers both anchors,
    so choosing assets on a **reinsured** object posted ``a`` and got a 422 from
    the model before any pricing code ran. No library work was needed:
    ``prob_loss_assets`` returns a mutually consistent ``(p, L, a)`` from either
    end, so the route converts an asset level to the probability the bases are
    compared at.
    """

    p: float | None = Field(
        None, gt=0, le=1, description="VaR probability in (0, 1] fixing capital.")
    a: float | None = Field(
        None, gt=0,
        description="Asset level fixing capital, on the calibration basis.")
    coc: float | None = Field(None, gt=0, description="Cost-of-capital (ROE) target.")
    lr: float | None = Field(None, gt=0, description="Loss-ratio target.")
    basis: str = Field(
        "gross",
        description="Calibration basis: 'gross', 'net occ' or 'net'.",
    )


class ReinsPriceResponse(BaseModel):
    """``POST /v1/objects/{id}/reins_price`` result.

    ``table`` carries one row per (distortion, basis) plus a difference row per
    non-calibrated basis: the implied allowance for reinsurance in the rate.
    ``distortion_df`` is the calibrated set's parameters, shown below the table.
    ``a`` and ``roe`` are the calibration basis's own asset level and realized
    cost of capital.
    """

    model_config = _RESPONSE_CFG

    basis: str
    bases: list[str]
    p: float
    roe: float
    a: float
    table: FrameResponse
    distortion_df: FrameResponse | None = None
    warnings: list[str] = []
    ir: dict[str, Any] | None = Field(
        None,
        description=(
            "Table documents for the static view, keyed 'table' and "
            "'distortion_df'. Present when the request asks with ?ir=true."
        ),
    )


# ======================================================================
# DecL helpers
# ======================================================================

class DeclCompleteRequest(BaseModel):
    decl: str
    cursor: int = Field(..., ge=0)


class Completion(BaseModel):
    model_config = _RESPONSE_CFG

    label: str
    terminal: str
    kind: Literal["keyword", "identifier", "literal"]


class CompletionsResponse(BaseModel):
    model_config = _RESPONSE_CFG

    completions: list[Completion]


class DeclLexRequest(BaseModel):
    decl: str


class DeclFormatRequest(BaseModel):
    decl: str


class DeclFormatResponse(BaseModel):
    """``POST /v1/decl/format`` -- canonicalized DecL.

    ``decl`` is the program re-rendered through ``aggregate``'s
    ``format_program`` (canonical clause order / spacing). On a format
    failure the original text is echoed back unchanged.
    """

    model_config = _RESPONSE_CFG

    decl: str


class LexToken(BaseModel):
    model_config = _RESPONSE_CFG

    type: str
    value: str
    start: int
    end: int
    line: int
    column: int


class LexResponse(BaseModel):
    model_config = _RESPONSE_CFG

    tokens: list[LexToken]


# ======================================================================
# Examples (aggregate's library.agg, via the recipe base)
# ======================================================================

class ExampleItem(BaseModel):
    """One library entry.

    ``note`` is preferred but never guaranteed: most entries carry one, and an
    entry without a note is ordinary, not defective. ``decl`` is the entry's
    canonical doc-free declaration (``Recipe.decl``), already in spread layout
    and carrying ``hints{}``, so it drops straight into the editor.
    """

    model_config = _RESPONSE_CFG

    name: str
    kind: str
    tags: list[str] = []
    note: str | None = None
    decl: str


class ExampleCategory(BaseModel):
    """One group of entries. ``key`` is the raw tag / kind, ``title`` is display."""

    model_config = _RESPONSE_CFG

    key: str
    title: str
    items: list[ExampleItem]


class ExamplesResponse(BaseModel):
    """``GET /v1/examples`` -- the library grouped on one axis."""

    model_config = _RESPONSE_CFG

    grouping: Literal["topic", "kind", "role"]
    categories: list[ExampleCategory]


class HeroesResponse(BaseModel):
    """``GET /v1/examples/heroes`` -- the entries tagged ``role:hero``."""

    model_config = _RESPONSE_CFG

    items: list[ExampleItem]


class SparklinesResponse(BaseModel):
    """``GET /v1/examples/heroes/sparklines`` -- thumbnail silhouettes.

    ``sparklines`` maps an entry name to a short list of values in ``[0, 1]``,
    the density binned and scaled so its peak is 1. Shape only: there are no
    axes, no units and no way to read a number off it, which is what a card
    thumbnail should promise.

    A hero that fails to build is simply absent, so the client must treat a
    missing key as ordinary and keep its placeholder.
    """

    model_config = _RESPONSE_CFG

    sparklines: dict[str, list[float]]


# ======================================================================
# Meta / health
# ======================================================================

class StyleResponse(BaseModel):
    """``GET /v1/meta/style`` -- the house plot style from ``aggregate.style``.

    Served so the SPA's interactive charts and the server-rendered matplotlib
    plots share one source for their look. ``colors`` is the ``axes.prop_cycle``
    color list, in order; ``fig_w`` / ``fig_h`` are the house per-panel figure
    size in inches (``aggregate.constants.FIG_W`` / ``FIG_H``), whose ratio the
    SPA uses to shape its own panels.
    """

    model_config = _RESPONSE_CFG

    colors: list[str]
    grid_color: str
    text_color: str
    line_width: float
    font_size: float
    fig_w: float
    fig_h: float


class HealthResponse(BaseModel):
    model_config = _RESPONSE_CFG

    ok: bool
    # ``version`` is this api package's version; ``aggregate_version``
    # is the wrapped library's. Reported separately so a deploy can be
    # pinned/debugged against both.
    version: str
    aggregate_version: str


class MetaResponse(BaseModel):
    model_config = _RESPONSE_CFG

    version: str
    aggregate_version: str
    # The static-table engine. Reported because it is a *front-end* version as
    # much as a backend one: the same install serves the walker the SPA loads
    # from /v1/assets, so this one number covers both halves.
    tables_version: str
    log2_cap: int
    log2_default: int
    build_timeout_s: float
    cache_max: int
