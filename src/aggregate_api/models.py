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
    # future object kind without these accessors still serializes. ``bs`` is
    # the *resolved* bucket size (the library's auto-pick when the request
    # said "auto"), shown in the summary line.
    bs: float | None = None
    mean: float | None = None
    cv: float | None = None
    validation: str | None = None


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

    ``p`` fixes the capital level; supply **exactly one** pricing target --
    ``coc`` (cost of capital / ROE) or ``lr`` (loss ratio). The server
    enforces the exactly-one rule and returns 400 otherwise.
    """

    p: float = Field(..., gt=0, le=1, description="VaR probability in (0, 1] fixing capital.")
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


# ======================================================================
# Meta / health
# ======================================================================

class StyleResponse(BaseModel):
    """``GET /v1/meta/style`` -- the house plot style from ``aggregate.style``.

    Served so the SPA's interactive charts and the server-rendered matplotlib
    plots share one source for their look. ``colors`` is the ``axes.prop_cycle``
    color list, in order.
    """

    model_config = _RESPONSE_CFG

    colors: list[str]
    grid_color: str
    text_color: str
    line_width: float
    font_size: float


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
    log2_cap: int
    log2_default: int
    build_timeout_s: float
    cache_max: int
    plot_default_format: str
