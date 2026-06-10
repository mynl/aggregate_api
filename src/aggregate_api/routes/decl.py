"""DecL-helpers routes: completions, lex, and grammar export.

Routes
------

* ``POST /v1/decl/complete`` -- accepts ``(decl, cursor)`` and
  returns terminal-level completion candidates for the editor.
* ``POST /v1/decl/lex`` -- accepts ``decl`` and returns the token
  stream (for client-side syntax-highlighting that prefers
  authoritative tokens over a TextMate / language-server clone).
* ``GET  /v1/decl/grammar`` -- serves ``decl.lark`` verbatim as
  ``text/plain``. Lets a future docs page embed the live grammar
  without a build-time include step.
"""

from __future__ import annotations

from importlib.resources import files

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from .. import models
from ..completion import complete, lex


router = APIRouter()


def _format_decl(decl: str) -> str:
    """Canonicalize a DecL program, echoing the original on any failure.

    ``format_program`` lives in ``aggregate.decl_writer`` and parses/builds
    the program internally, so it can raise on malformed input -- we never
    want that to 500 the format helper, so failures fall back to the input.
    """
    try:
        from aggregate.decl_writer import format_program
        out = format_program(decl, fmt="text")
        return out or decl
    except Exception:  # noqa: BLE001 -- formatting is best-effort
        return decl


@router.post("/decl/complete", response_model=models.CompletionsResponse)
def decl_complete(req: models.DeclCompleteRequest) -> dict:
    """Return completion candidates for ``decl[:cursor]``.

    FastAPI deserializes the JSON body into ``req`` automatically;
    we just unpack and call into the completion module.
    """
    return {"completions": complete(req.decl, req.cursor)}


@router.post("/decl/lex", response_model=models.LexResponse)
def decl_lex(req: models.DeclLexRequest) -> dict:
    """Return the token stream for ``req.decl``.

    On a tokenization error returns an empty list -- callers
    should hit ``POST /v1/objects`` to see the structured
    :class:`ErrorReport`.
    """
    return {"tokens": lex(req.decl)}


@router.post("/decl/format", response_model=models.DeclFormatResponse)
def decl_format(req: models.DeclFormatRequest) -> dict:
    """Return ``req.decl`` re-rendered in canonical form.

    Used by the SPA to standardize a program when it's loaded from the
    Examples library. Best-effort: malformed input echoes back unchanged.
    """
    return {"decl": _format_decl(req.decl)}


@router.get(
    "/decl/grammar",
    response_class=PlainTextResponse,
    responses={200: {"content": {"text/plain": {}}}},
)
def decl_grammar() -> PlainTextResponse:
    """Return the bundled ``decl.lark`` as plain text.

    Reads via ``importlib.resources`` so the result is the
    installed package's grammar -- works whether the package is
    installed as a regular site-package, a zip, or an editable
    install.
    """
    text = files("aggregate").joinpath("decl.lark").read_text(encoding="utf-8")
    return PlainTextResponse(text)
