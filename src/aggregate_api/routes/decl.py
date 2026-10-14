"""DecL-helpers routes: the family that asks the grammar about text.

None of these builds anything. They cost a parse, not a convolution, and
they create no object and no cache entry.

Routes
------

* ``POST /v1/decl/complete``: accepts ``(decl, cursor)`` and returns
  terminal-level completion candidates for the editor.
* ``POST /v1/decl/lex``: accepts ``decl`` and returns the token stream,
  for client-side syntax highlighting that prefers authoritative tokens
  over a TextMate or language-server clone.
* ``POST /v1/decl/parse``: accepts ``decl`` and returns the
  ``(kind, name, spec)`` triple the parser understood, one entry per
  statement. Added at a192 for an external client that needs the
  structure of a program and must not read it back out of text.
* ``POST /v1/decl/format``: accepts ``decl`` and returns the program
  re-rendered canonically, echoing the input on any failure.
* ``GET  /v1/decl/grammar``: serves ``decl.lark`` verbatim as
  ``text/plain``. Lets a future docs page embed the live grammar without a
  build-time include step.
* ``GET  /v1/decl/help``: serves one of the library's DecL help pages as an
  HTML fragment, or a 404 naming the library version when it has none.
"""

from __future__ import annotations

from importlib.resources import files

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse

import aggregate
from aggregate.parser_errors import format_error

from .. import decl_help, models
from ..completion import complete, lex
from ..serializers import spec_to_payload


router = APIRouter()


class _StatementParseError(Exception):
    """A statement the parser refused, carrying its index in the program.

    Parameters
    ----------
    index : int
        Zero-based position of the failing statement in the preprocessed
        program. A program that will not even split reports 0.
    statement : str
        The text actually handed to the parser, which is the preprocessed
        statement, or the whole program when the split itself failed. This is
        the right ``source`` for a report, because it is what the column and
        caret are measured against.
    cause : BaseException
        What the parser raised. ``aggregate.parser_errors.format_error`` turns
        it into the rich report.
    """

    def __init__(self, index: int, statement: str, cause: BaseException) -> None:
        super().__init__(f"statement {index} did not parse")
        self.index = index
        self.statement = statement
        self.cause = cause


def _parse_statements(decl: str) -> list[tuple[str, str, dict]]:
    """Split ``decl`` into statements and parse each one, in source order.

    Parameters
    ----------
    decl : str
        A DecL program, one statement or several.

    Returns
    -------
    list of tuple
        One ``(kind, name, spec)`` triple per statement, the parser's own
        return value, untouched.

    Raises
    ------
    _StatementParseError
        On the first statement that will not parse, or when the program will
        not split at all.

    Notes
    -----
    The two library names are both public and both the ones the writer itself
    uses, so this predicts the writer's behavior rather than guessing at it.
    ``UnderwritingLexer.preprocess`` splits on **blank** lines, not on every
    newline: a single newline plus indentation is a continuation and folds into
    one space, which is how a program spread over five lines stays one
    statement.

    Each statement is parsed against ``aggregate.build`` alone, so a name a
    statement declares is not in scope for the statements after it. See
    :func:`_every_statement_parses`, which is where that costs something.
    """
    try:
        from aggregate import build
        from aggregate.parser import UnderwritingLexer
        statements = UnderwritingLexer.preprocess(decl)
    except Exception as exc:  # noqa: BLE001 (a program that will not even split)
        raise _StatementParseError(0, decl, exc) from exc
    parsed: list[tuple[str, str, dict]] = []
    for index, statement in enumerate(statements):
        try:
            parsed.append(build.parser.parse(statement))
        except Exception as exc:  # noqa: BLE001 (parse error, or unresolved name)
            raise _StatementParseError(index, statement, exc) from exc
    return parsed


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
        _parse_statements(decl)
    except _StatementParseError:
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


@router.post("/decl/parse", response_model=models.DeclParseResponse)
def decl_parse(req: models.DeclParseRequest) -> dict:
    """Return what the parser understood about ``req.decl``, as data.

    One ``(kind, name, spec)`` entry per statement, in source order. Nothing is
    built, nothing is cached, nothing is audited as a build: this is the
    grammar answering a question about text, like its three siblings above, and
    it costs a parse rather than a convolution.

    Notes
    -----
    **The spec is the library's vocabulary**, served as an open object rather
    than a mirrored schema, for the reason
    :class:`~aggregate_api.models.ParsedStatement` gives. Two coercions a
    client has to expect, both from
    :func:`~aggregate_api.serializers.spec_to_payload`: a tuple arrives as an
    array, so a reinsurance layer reads as ``[share, limit, attach]``; and a
    non-finite float arrives as the string ``"inf"``, ``"-inf"`` or ``"nan"``,
    which is the spelling the grammar accepts for an unlimited layer and the
    only form that keeps an unlimited limit apart from an absent one. ``inf``
    is not exotic: ``sev_ub`` carries it on the plainest one-line ``agg``.

    **Statements are split on blank lines**, the rule
    ``UnderwritingLexer.preprocess`` has always applied, so a program spread
    over several indented lines is one statement and two programs separated by
    an empty line are two.

    **Each statement resolves against the default underwriter**, as
    :func:`_every_statement_parses` and ``format_program`` both do, so a
    ``sev.X`` or ``agg.X`` reference into the recipe base resolves and a
    builtin reference resolves inline. The consequence worth stating: a program
    whose second statement refers to a name its **first** statement declares
    does not parse, because nothing here feeds the first statement's result
    back into scope for the second.

    **A parse failure is the structured error path**, not a 200 with an empty
    list: HTTP 422 whose ``detail`` is the ``aggregate.parser_errors``
    ``ErrorReport`` dict that ``POST /v1/objects`` already returns, with
    ``line``, ``column``, ``source``, ``caret`` and ``suggestions``, plus one
    added key, ``statement_index``, naming which statement failed. ``source``
    is that statement rather than the whole program, because the column and the
    caret are measured against what the parser was handed.
    """
    try:
        parsed = _parse_statements(req.decl)
    except _StatementParseError as exc:
        detail = format_error(exc.statement, exc.cause).to_dict()
        detail["statement_index"] = exc.index
        raise HTTPException(status_code=422, detail=detail) from None
    return {
        "statements": [
            {"kind": kind, "name": name, "spec": spec_to_payload(spec)}
            for kind, name, spec in parsed
        ]
    }


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


@router.get(
    "/decl/help",
    response_class=HTMLResponse,
    responses={200: {"content": {"text/html": {}}}, 404: {}},
)
def decl_help_page(form: str = "anatomy", v: str | None = None) -> HTMLResponse:
    """Return one DecL help page, as the installed library renders it.

    Parameters
    ----------
    form : str
        Which page: ``anatomy`` (one statement taken apart slot by slot) or
        ``card`` (the one-page reference). Checked against what the library
        offers before the library is asked, so an unknown form is a 404 and
        never a 500.
    v : str, optional
        Accepted and ignored. The SPA sends the library version here so that
        an upgraded library changes the URL, and a browser cannot keep serving
        the old page for the hour the cache header allows.

    Returns
    -------
    HTMLResponse
        The fragment byte for byte, ``text/html``, cacheable for an hour.

    Raises
    ------
    HTTPException
        404 when the installed library has no help or does not offer ``form``.
        The detail names the library version, since that is the whole of the
        explanation and the fix.
    """
    forms = decl_help.available_forms()
    if form not in forms:
        installed = aggregate.__version__
        reason = (f"aggregate {installed} has no DecL help" if not forms
                  else f"aggregate {installed} has no {form!r} help; "
                       f"it offers {', '.join(forms)}")
        raise HTTPException(status_code=404, detail=reason)
    return HTMLResponse(
        decl_help.fragment(form),
        headers={"Cache-Control": "public, max-age=3600"},
    )
