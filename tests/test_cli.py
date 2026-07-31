"""Tests for the ``aggregate-api`` console script.

Only the parts that can be exercised without launching uvicorn: the
``--library`` path check, which is the flag's whole point.
"""

from __future__ import annotations

import pytest

from aggregate_api.__main__ import resolve_library


def test_library_resolves_to_an_absolute_path(tmp_path):
    """A relative path is made absolute before it reaches the Underwriter.

    The api resolves a library through an ``Underwriter`` pointed at the file's
    directory, by which point the working directory may be anything.
    """
    lib = tmp_path / "short.agg"
    lib.write_text("agg Tiny dfreq [1] dsev [1]\n", encoding="utf-8")

    resolved = resolve_library(str(lib))
    assert resolved == str(lib.resolve())


def test_library_refuses_a_missing_file(tmp_path):
    """The flag fails rather than falling back, and names the path.

    ``AGGAPI_EXAMPLES_FILE`` warns and falls back to the shipped library when the
    path is wrong, which is right for a stale setting on a server. It is wrong
    for a flag typed on purpose: silently loading the full library is exactly
    what someone passing ``--library`` is trying to avoid.
    """
    missing = tmp_path / "nope.agg"
    with pytest.raises(SystemExit) as excinfo:
        resolve_library(str(missing))
    assert "nope.agg" in str(excinfo.value)


def test_library_refuses_a_directory(tmp_path):
    """A directory resolves fine and is still not a library."""
    with pytest.raises(SystemExit) as excinfo:
        resolve_library(str(tmp_path))
    assert "not a file" in str(excinfo.value)
