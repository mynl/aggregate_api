"""DecL-helpers routes: completions, lex, and grammar export.

Routes
------

* ``POST /v1/decl/complete``: accepts ``(decl, cursor)`` and returns
  terminal-level completion candidates for the editor.
* ``POST /v1/decl/lex``: accepts ``decl`` and returns the token stream,
  for client-side syntax highlighting that prefers authoritative tokens
  over a TextMate or language-server clone.
* ``GET  /v1/decl/grammar``: serves ``decl.lark`` verbatim as
  ``text/plain``. Lets a future docs page embed the live grammar without a
  build-time include step.
"""

from __future__ import annotations

from importlib.resources import files

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from .. import models
from ..completion import complete, lex


router = APIRouter()


def _every_statement_parses(decl: str) -> bool:
    """Whether every statement in ``decl`` parses, which is what Reformat needs.

    Parameters
    ----------
    decl : str
        A DecL program, one statement or several.

    Returns
    -------
    bool
        True when the writer will canonicalize the whole program, False when
        at least one statement will come back as source text instead.

    Notes
    -----
    **This exists because ``format_program``'s fallback is not the no-op it
    reads as, and a137 is where that cost the author a program.** The writer
    renders statement by statement through ``_render_statement``, which catches
    every exception and returns the statement instead of a render node. The
    statement it returns is not the source, though: it is the source after
    ``UnderwritingLexer.preprocess``, which is what splits the program at all,
    and preprocessing folds every newline and every run of indentation into one
    space. So a program the writer cannot read comes back **collapsed onto one
    line**, the SPA sees text that differs from what it sent, writes it into the
    editor, and the reader's carefully spread program is gone. Pressing the
    button that formats a program is how you lose its formatting.

    Three ways in, all reachable from an ordinary session: a statement using a
    spelling a grammar change retired, a statement naming something the default
    underwriter cannot resolve, and, the one that surprises, a second statement
    referring to a name the **first** statement defines. The writer parses each
    statement against ``aggregate.build`` alone, so ``sev MySev ...`` followed by
    ``agg A ... sev.MySev ...`` renders the first and collapses the second.

    Asking the same parser the same question first is what makes the route's
    standing promise ("a malformed program reformats to itself") true. It parses
    the program twice on the way to a canonical answer, which is the right
    trade for a button a reader presses by hand: correctness for a few
    milliseconds nobody can perceive.

    ``UnderwritingLexer.preprocess`` and ``Underwriter.parser`` are both public
    names, and they are the two the writer itself uses, so this predicts the
    fallback rather than guessing at it. The remaining gap is a statement that
    parses and then fails while rendering; that is a library defect when it
    happens rather than a program the reader can fix, and it is raised upstream
    rather than guarded here.
    """
    try:
        from aggregate import build
        from aggregate.parser import UnderwritingLexer
        statements = UnderwritingLexer.preprocess(decl)
    except Exception:  # noqa: BLE001 (a program that will not even split)
        return False
    for statement in statements:
        try:
            build.parser.parse(statement)
        except Exception:  # noqa: BLE001 (parse error, or an unresolved name)
            return False
    return True


def _format_decl(decl: str) -> str:
    """Canonicalize a DecL program, echoing the original on any failure.

    ``format_program`` lives in ``aggregate.decl_writer`` and parses and builds
    the program internally, so it can raise on malformed input. That must never
    500 the format helper, so a failure falls back to the input and a malformed
    program reformats to itself.

    Notes
    -----
    **The gate in front of it, which is what a137 added.** The echo has to be
    the text that came in, and until a137 it was not: the writer answers an
    unreadable statement with its own preprocessed copy, which is the statement
    with every line break folded into a space, and the SPA wrote that into the
    editor. See :func:`_every_statement_parses` for the three ways a program
    reaches that path and why the answer is to ask the parser first.

    **``trailer=True``, which is the whole of what a126 changed here.** The
    writer's signature is
    ``(spec_or_text, *, fmt='text', layout='spread', trailer=False)`` and it
    emits the trailer as a unit, so at the default every ``note{}``, ``hints{}``
    and ``tags{}`` in the program is silently dropped. That made Reformat delete
    the clause Sharpen had just written: press one to pin a grid, press the
    other to tidy the layout, and the pinning is gone. A grid a program does not
    state is a grid the next build is free to choose differently, so this was
    losing meaning rather than formatting.

    A reader who types their own ``tags{}`` now keeps it through a Reformat too,
    on the same rule as the note (author ruling, 2026-08-24). This does not fight
    the Examples library: a loaded entry arrives with note and tags already
    stripped, so there is nothing on that path for Reformat to restore.

    ``format_program`` still round trips through the spec, so Reformat continues
    to rewrite ``ph 2/3`` as a float and ``dsev [1:6]`` as six values. That is
    the writer working as designed and is tracked upstream as
    ``[Unparser-Reference-Gaps]``; it is why the Examples menu serves
    ``Recipe.as_read`` instead of coming through here.
    """
    if not _every_statement_parses(decl):
        return decl
    try:
        from aggregate.decl_writer import format_program
        out = format_program(decl, fmt="text", trailer=True)
        return out or decl
    except Exception:  # noqa: BLE001 (formatting is best-effort)
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

    On a tokenization error returns an empty list. Callers should hit
    ``POST /v1/objects`` to see the structured :class:`ErrorReport`.
    """
    return {"tokens": lex(req.decl)}


@router.post("/decl/format", response_model=models.DeclFormatResponse)
def decl_format(req: models.DeclFormatRequest) -> dict:
    """Return ``req.decl`` re-rendered in canonical form.

    Notes
    -----
    Two callers, and neither is the one this docstring used to name. It said
    the SPA standardizes a program loaded from the Examples library, which
    stopped being true at a122: a library entry now arrives as its own file's
    text and needs no round trip, and putting it through one would undo the
    spellings the entry exists to teach. What is left is the **Reformat**
    button and the ``grossceded`` prefix path, which reformats on the way
    through because it is rewriting the program anyway.

    Best-effort: malformed input echoes back unchanged.
    """
    return {"decl": _format_decl(req.decl)}


@router.get(
    "/decl/grammar",
    response_class=PlainTextResponse,
    responses={200: {"content": {"text/plain": {}}}},
)
def decl_grammar() -> PlainTextResponse:
    """Return the bundled ``decl.lark`` as plain text.

    Reads via ``importlib.resources`` so the result is the installed
    package's grammar, which works whether the package is installed as a
    regular site-package, a zip, or an editable install.
    """
    text = files("aggregate").joinpath("decl.lark").read_text(encoding="utf-8")
    return PlainTextResponse(text)
