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
