"""DecL completion + lex helpers for the editor pane.

Two endpoints feed off this module:

* ``POST /v1/decl/complete`` -- given DecL text and a cursor
  position, return the set of terminals that could legally appear
  next (keyword completions for the SPA's CodeMirror integration).
* ``POST /v1/decl/lex`` -- given DecL text, return the token stream
  produced by Lark's lexer (used by syntax-highlighting UIs that
  prefer server-side tokenization).

Both go through Lark's :meth:`Lark.parse_interactive` API, which
returns an :class:`~lark.parsers.lalr_interactive_parser.InteractiveParser`
that exposes the live parse state. ``.accepts()`` returns the set
of terminal names that would succeed at the current position --
that's the completion menu.

V1 ships keyword/terminal completions only. Knowledge-base
identifier completions (severity names, calibrated distortions)
are flagged in the plan as a v1.1 enhancement.
"""

from __future__ import annotations

import re

from lark.exceptions import UnexpectedInput

# Reuse the parser instance already constructed by ``parser.py`` so
# we don't duplicate the (somewhat expensive) Lark.open() call.
# (Currently only used by the lex endpoint -- see notes on
# ``complete`` for why interactive parsing isn't available.)
from aggregate.parser import _PARSER

# Reuse the curated terminal -> label table from Plan B so suggestion
# labels are consistent with parse-error displays.
from aggregate.parser_errors import _TERMINAL_LABELS


# ----------------------------------------------------------------------
# Completion classification
# ----------------------------------------------------------------------
# Terminals that represent generic value categories rather than fixed
# strings. Used to tag a Completion's ``kind`` so the editor can render
# (e.g.) keyword pills differently from "expects a number" hints.
_LITERAL_TERMINALS = {
    "NUMBER", "SIGNED_NUMBER", "INT", "SIGNED_INT", "FLOAT",
    "STRING", "ESCAPED_STRING",
}
_IDENTIFIER_TERMINALS = {"NAME", "CNAME", "ID"}


def _classify(terminal: str) -> str:
    """Map a terminal name to ``'keyword' | 'identifier' | 'literal'``.

    Anything not in the explicit identifier/literal sets is treated
    as a keyword (it's either a curated DecL keyword from
    ``decl.lark`` or an anonymous terminal -- the editor renders
    both as "keyword" tokens).
    """
    if terminal in _LITERAL_TERMINALS:
        return "literal"
    if terminal in _IDENTIFIER_TERMINALS:
        return "identifier"
    return "keyword"


#: A curated label that **starts with a quoted token**, and whatever follows it.
#: The three shapes in the table, in the order they matter here:
#:
#: * ``"'agg'"``, a bare token;
#: * ``"'approximate' (or 'approx')"``, a token and a parenthesized gloss;
#: * ``"'**' or '^'"``, a token and an unparenthesized alternative.
#:
#: A fourth shape has no quoted token at all and is a **description** rather
#: than a literal: ``"a builtin aggregate (agg.X)"``, ``"a frequency name
#: (poisson, binomial, ...)"``. Those name a category the static pool cannot
#: enumerate, so there is nothing to insert and :func:`complete` drops them.
_LABEL_TOKEN = re.compile(r"^'(?P<token>[^']*)'\s*(?P<rest>.*)$")


def _split_label(terminal: str) -> tuple[str, str | None]:
    """Split a curated label into the token to insert and its gloss.

    Parameters
    ----------
    terminal : str
        Lark terminal name.

    Returns
    -------
    (str, str or None)
        The bare token, and the gloss with any wrapping parentheses removed.
        The token is ``''`` when there is nothing insertable, which is an
        anonymous terminal (``__ANON_*``) or a descriptive label; callers drop
        those rather than offering a phrase as if it were DecL.

    Notes
    -----
    This used to be ``_TERMINAL_LABELS[terminal].strip("'")``, and ``strip``
    cannot do the job: it removes matching characters from the **ends** of a
    string, so a label ending in ``)`` kept its interior quote and
    ``'after' (profit-commission allowance)`` came back as
    ``after' (profit-commission allowance)``. That string was then handed to
    editors as the text to insert, so accepting the completion put a stray
    apostrophe and a parenthetical into the program. It reads as a formatting
    slip and it was a correctness one.

    Where a label offers alternatives (``'**' or '^'``) the **first** is the
    token and the rest becomes the gloss: both spellings parse, so either is a
    defensible insertion, and the one the label leads with is the house form.
    """
    if terminal.startswith("__"):
        return "", None
    raw = _TERMINAL_LABELS.get(terminal)
    if raw is None:
        return terminal.lower(), None
    m = _LABEL_TOKEN.match(raw.strip())
    if m is None:
        return "", None          # a description, not a token
    rest = m.group("rest").strip()
    if rest.startswith("(") and rest.endswith(")"):
        rest = rest[1:-1].strip()
    return m.group("token"), rest or None


# Lark's ``parse_interactive`` is LALR-only; DecL uses Earley + dynamic
# lexer, so we can't ask the live parser "what accepts next?". V1 ships
# a static keyword set sourced from Plan B's terminal-label table --
# good enough for the SPA's "show me available keywords" dropdown but
# not context-aware. Grammar-driven completions are flagged in the plan
# as a v1.1 enhancement (would require building a parallel LALR
# grammar or stepping through token-by-token).
_STATIC_KEYWORDS = sorted(
    {
        t for t in _TERMINAL_LABELS
        if t.isupper() and t.isascii() and not t.startswith("__")
    }
)


def complete(decl: str, cursor: int) -> list[dict]:
    """Return completion candidates for the given cursor position.

    V1 implementation: filter the static keyword pool against the
    identifier-shaped word ending at ``cursor`` (case-insensitive
    prefix match). When the cursor sits on whitespace / start of
    input, the full keyword pool is returned.

    Parameters
    ----------
    decl : str
        Current editor content.
    cursor : int
        Zero-indexed character position.

    Returns
    -------
    list[dict]
        Sorted list of ``{text, label, detail, terminal, kind}`` dicts. Empty
        only when no keyword starts with the current prefix.

    Notes
    -----
    ``text`` is the bare token and is what an editor inserts; ``label`` is the
    same token (they differ only in that ``label`` is what a menu shows) and
    ``detail`` carries the gloss where the terminal has one. Matching is on the
    **token**, never on the gloss, so typing ``pr`` offers ``premium`` and does
    not also offer everything whose parenthetical happens to contain a ``pr``.
    """
    prefix = decl[:cursor]
    # Identify the word the cursor is currently inside (or at the
    # end of). Walk backwards while we still see identifier chars.
    i = len(prefix)
    while i > 0 and (prefix[i - 1].isalnum() or prefix[i - 1] in "._-:~"):
        i -= 1
    word = prefix[i:].lower()

    out: list[dict] = []
    for term in _STATIC_KEYWORDS:
        text, detail = _split_label(term)
        if not text:
            continue
        if word and not text.lower().startswith(word):
            continue
        out.append({"text": text, "label": text, "detail": detail,
                    "terminal": term, "kind": _classify(term)})
    return out


def lex(decl: str) -> list[dict]:
    """Tokenize ``decl`` via Lark's lexer and return token records.

    Returns one dict per token::

        {"type": "MIXED", "value": "mixed", "start": 7, "end": 12,
         "line": 1, "column": 8}

    A failure to tokenize (e.g. an unexpected character partway
    through) surfaces an empty list -- callers should hit
    ``/v1/objects`` for a proper :class:`ErrorReport`.
    """
    try:
        tokens = list(_PARSER.lex(decl))
    except UnexpectedInput:
        return []
    except Exception:
        return []
    out: list[dict] = []
    for tok in tokens:
        out.append({
            "type": tok.type,
            "value": str(tok),
            "start": tok.start_pos or 0,
            "end": tok.end_pos or 0,
            "line": tok.line or 1,
            "column": tok.column or 1,
        })
    return out
