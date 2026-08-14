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


def _registers(name: str) -> bool:
    """Does the installed ``aggregate`` register this exhibit?"""
    from aggregate import exhibits as agg_exhibits

    return name in agg_exhibits.EXHIBITS


#: **Temporary, and it deletes itself.** ``dev/plan-pricing-natural-allocation.md``
#: phase B1 codes against a library that splits ``pricing.allocate`` into
#: ``pricing.stand_alone`` (each part priced on its own) and ``pricing.allocate``
#: (one premium split across the parts), which is that plan's LIB phases N1 to
#: N4. The api half went first by the author's instruction, so until the sibling
#: checkout carries those phases the calibrate bundle names an exhibit that is
#: not registered and every test touching it would fail for a reason that is not
#: a defect here.
#:
#: Read off the registry rather than off a version number: the phases land under
#: numbers assigned at execution, and what these tests actually need is the
#: registration.
#:
#: Delete this and every use of it in the commit that syncs against the landed
#: library. A skip that outlives its cause is a test that stopped running.
needs_split_allocation = pytest.mark.skipif(
    not _registers("pricing.stand_alone"),
    reason=("needs an aggregate registering pricing.stand_alone "
            "(plan-pricing-natural-allocation, LIB phases N1 to N4)"),
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
