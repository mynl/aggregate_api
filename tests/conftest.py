"""Shared fixtures for the api test suite.

The ``client`` fixture builds a fresh FastAPI app per test against a
temp-directory audit DB and a clean cache. Each test gets isolation
from cross-test cache leakage and pollution of the user's
``~/.aggregate/api/audit.db``.

FastAPI's :class:`fastapi.testclient.TestClient` is a thin
synchronous wrapper around the ASGI app -- no actual HTTP server,
no port binding, no event-loop choreography. ``client.post(...)``
returns a ``httpx.Response``.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def _nttagg_is_supported() -> bool:
    """Whether the installed ``aggregate`` knows the ``nttagg`` kind.

    Returns
    -------
    bool
        True when a trivial ``nttagg`` program parses.

    Notes
    -----
    A capability probe rather than a version comparison, deliberately. The kind
    arrived in ``aggregate`` 1.1.0 while the pin is ``>=1.0.1,<2``, so the suite
    has to stay green on a library that has never heard of it. Comparing version
    strings would be a second declaration of the same fact, and it would be
    wrong the day the library backports the kind or renames it; asking the
    parser cannot be.
    """
    try:
        from aggregate import build

        build.parser.parse("nttagg Gate.Probe dfreq [1 2] dsev [1 2]")
    except Exception:
        return False
    return True


#: Gate for the exact-compound tests. Parsing, not building: the question is
#: whether the grammar carries the keyword, and a build costs a grid.
NTTAGG_SUPPORTED = _nttagg_is_supported()

#: Marker form, for the tests and the parametrize cases behind the gate.
requires_nttagg = pytest.mark.skipif(
    not NTTAGG_SUPPORTED,
    reason="the installed aggregate has no 'nttagg' kind (arrived in 1.1.0)",
)


def _chfagg_is_supported() -> bool:
    """Whether the installed ``aggregate`` knows the ``chfagg`` kind.

    Returns
    -------
    bool
        True when a trivial ``chfagg`` program parses.

    Notes
    -----
    The same capability probe as ``_nttagg_is_supported`` and for the same
    reason: the kind arrived in ``aggregate`` 1.30.0 while the floor is 1.11.0.
    The ``mean cv`` form parses in every release that has the kind, so the gate
    asks only whether the kind exists. A probe in the positional form skipped
    every ``chfagg`` test, silently, when ``aggregate`` 1.35.0 moved scale and
    location to arithmetic; a spelling the library drops should fail here.
    """
    try:
        from aggregate import build

        build.parser.parse("chfagg Gate.Probe gamma 100 cv 0.5")
    except Exception:
        return False
    return True


#: Gate for the characteristic function law tests.
CHFAGG_SUPPORTED = _chfagg_is_supported()

#: Marker form of the gate above.
requires_chfagg = pytest.mark.skipif(
    not CHFAGG_SUPPORTED,
    reason="the installed aggregate has no 'chfagg' kind (arrived in 1.30.0)",
)


def _exact_tail_is_supported() -> bool:
    """Whether the installed ``aggregate`` registers the ``exact_tail`` chart.

    Returns
    -------
    bool
        True when ``exact_tail`` is in the public ``aggregate.charts.CHARTS``
        registry.

    Notes
    -----
    The same capability probe as ``_nttagg_is_supported`` and for the same
    reason: the chart arrived in ``aggregate`` 1.5.0, the pin stays
    ``>=1.0.1,<2``, and against an older library the More / Exact tail leaf is
    simply dark, so the tests that assert the chart is listed have to skip
    rather than fail.
    """
    try:
        from aggregate.charts import CHARTS
    except Exception:
        return False
    return "exact_tail" in CHARTS


#: Gate for the tests asserting an nttagg lists the exact log10 chart.
EXACT_TAIL_SUPPORTED = _exact_tail_is_supported()

#: Marker form of the gate above.
requires_exact_tail = pytest.mark.skipif(
    not EXACT_TAIL_SUPPORTED,
    reason="the installed aggregate has no 'exact_tail' chart (arrived in 1.5.0)",
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Fresh app + cache per test, audit DB in tmp_path."""
    # Push env vars *before* importing the app modules so
    # ``get_settings`` reads the patched values.
    monkeypatch.setenv("AGGAPI_AUDIT_DB", str(tmp_path / "audit.db"))
    monkeypatch.setenv("AGGAPI_LOG2_CAP", "20")
    # Default to no CORS for the common case; ``test_cors`` overrides.
    monkeypatch.setenv("AGGAPI_CORS_ORIGINS", "")

    # Import after monkeypatching so the cache_clear inside
    # create_app() picks up the new env.
    from aggregate_api.app import create_app

    app = create_app()
    with TestClient(app) as client_obj:
        yield client_obj
