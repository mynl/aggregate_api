"""The two private names from ``aggregate`` the api imports, and what it needs of them.

``aggregate_api.completion`` imports ``aggregate.parser._PARSER`` and
``aggregate.parser_errors._TERMINAL_LABELS``. The library's API promise covers
its public surface, and a major release is exactly where a private name moves.
Through 1.41.0 a ``<2`` ceiling on the dependency stood guard; since 1.42.0 this
test does, so a library that moves either name fails here rather than refusing
to install.
"""

from __future__ import annotations


def test_the_parser_lexes():
    """``_PARSER.lex`` is callable and yields tokens, as completion uses it."""
    from aggregate.parser import _PARSER

    assert callable(_PARSER.lex)
    tokens = list(_PARSER.lex("agg A 1 claim dsev [1] fixed"))
    assert tokens and all(hasattr(token, "type") for token in tokens)


def test_the_terminal_labels_map_names_to_labels():
    """``_TERMINAL_LABELS`` is a ``dict`` of ``str`` to ``str``, as completion reads it."""
    from aggregate.parser_errors import _TERMINAL_LABELS

    assert isinstance(_TERMINAL_LABELS, dict) and _TERMINAL_LABELS
    assert all(isinstance(name, str) and isinstance(label, str)
               for name, label in _TERMINAL_LABELS.items())
