"""The CacheEntry lock refuses rather than waiting forever.

An unbounded wait on this lock could take the whole process down, not just the
one request. FastAPI runs a sync dependency and a sync handler in two separate
``run_in_threadpool`` calls, each needing one of anyio's 40 thread-limiter
tokens, so a request that holds the lock still needs a *second* token to reach
its handler and release it. Let forty requests block on one lock and every token
belongs to a thread that cannot progress, the holder never gets a token, and the
process parks at 0% CPU with every sync route unreachable.

Measured at a200, concurrent reads of one object from a fresh server: 39 callers
survived, 45 killed it, the cliff sitting at the token count. See
``dev/plan-demo-load.md`` item 0.

This file holds the lock from the test thread, which is the same situation as
far as the route is concerned, and asserts the refusal. It cannot reproduce the
40-token exhaustion itself: ``TestClient`` drives the app in one portal thread,
so the harness that would be needed is a live server and fifty sockets, which is
what ``dev/scripts/loadtest/blitz.ps1`` is for.
"""

from __future__ import annotations


def _tiny(client) -> str:
    """Build the smallest honest object and return its id."""
    response = client.post("/v1/objects", json={"decl": "agg Dice dfreq [3] dsev [1:6]"})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _entry(oid: str):
    """The live CacheEntry for ``oid``, reached past the Depends plumbing."""
    from aggregate_api.config import get_settings
    from aggregate_api.routes import objects as objects_routes

    # ``_get_cache``'s default is a ``Depends`` marker, so the settings have to
    # be passed explicitly when calling it as a plain function.
    cache = objects_routes._get_cache(get_settings())
    entry = cache.get(oid)
    assert entry is not None, "the object just built is not in the cache"
    return entry


def test_busy_object_returns_503_rather_than_hanging(client, monkeypatch):
    """A read of a locked object refuses, and says when to come back."""
    from aggregate_api.config import get_settings

    oid = _tiny(client)

    # A quarter second, so the test spends no real time waiting. The route reads
    # the setting per request, so clearing the cache is enough to apply it.
    monkeypatch.setenv("AGGAPI_ENTRY_LOCK_TIMEOUT_S", "0.25")
    get_settings.cache_clear()

    entry = _entry(oid)
    assert entry.lock.acquire(timeout=5), "could not take the lock to set the test up"
    try:
        response = client.get(f"/v1/objects/{oid}/summary")
    finally:
        entry.lock.release()

    assert response.status_code == 503
    assert response.headers.get("Retry-After") == "2"
    assert "busy" in response.json()["detail"]

    get_settings.cache_clear()


def test_the_lock_survives_the_refusal(client, monkeypatch):
    """A refused request must not leave the lock held or released twice.

    The acquire is checked *before* the ``try``, so a failed acquire cannot
    reach the ``finally`` and release a lock it never took. Were that wrong, this
    object would be readable by exactly one later caller and then permanently
    stuck, or the release would raise.
    """
    from aggregate_api.config import get_settings

    oid = _tiny(client)
    monkeypatch.setenv("AGGAPI_ENTRY_LOCK_TIMEOUT_S", "0.25")
    get_settings.cache_clear()

    entry = _entry(oid)
    assert entry.lock.acquire(timeout=5)
    try:
        assert client.get(f"/v1/objects/{oid}/summary").status_code == 503
    finally:
        entry.lock.release()

    # Twice, because one success could be a lock that was released once too
    # often and is now permanently open.
    assert client.get(f"/v1/objects/{oid}/summary").status_code == 200
    assert client.get(f"/v1/objects/{oid}/summary").status_code == 200

    get_settings.cache_clear()


def test_locked_entry_waits_on_the_loop_not_in_a_thread():
    """``_locked_entry`` must stay an async generator, or the livelock returns.

    A sync dependency waits for the lock in a worker thread that is holding one
    of anyio's 40 tokens. The request that *has* the lock then cannot get a
    token to run its handler and release it, so nothing progresses until the
    timeouts fire. Measured at a201, with the wait bounded but still in a
    thread: 50 concurrent reads gave 33 refusals and a 10 s wall, the 17 winners
    averaging 590 ms against a 46 ms critical section. As an async dependency
    the same 50 all answered in 1.42 s.

    Structural rather than behavioral because reproducing it needs more than 40
    real sockets, which ``TestClient`` cannot provide from one portal thread.
    ``dev/scripts/loadtest/blitz.ps1`` is the behavioral check.
    """
    import inspect

    from aggregate_api.routes.objects import _locked_entry

    assert inspect.isasyncgenfunction(_locked_entry), (
        "_locked_entry must be `async def` with a yield: a sync version waits "
        "for the lock while holding a thread token and livelocks the process"
    )


def test_health_needs_no_thread_token(client):
    """``/v1/health`` is async and dependency-free, so it answers when the pool is not.

    Asserted structurally rather than by exhausting the pool, which ``TestClient``
    cannot do: a sync route or a sync dependency would reintroduce the token
    requirement, and this is the route somebody hits to ask whether the server
    is alive at exactly the moment it is not.
    """
    import inspect

    from aggregate_api.routes import meta as meta_routes

    assert inspect.iscoroutinefunction(meta_routes.health)
    assert inspect.iscoroutinefunction(meta_routes.meta)

    for route in ("/v1/health", "/v1/meta"):
        found = [r for r in client.app.routes if getattr(r, "path", None) == route]
        assert found, f"{route} is not mounted"
        assert not found[0].dependant.dependencies, (
            f"{route} grew a dependency; a sync one needs a thread token and "
            "would make it unreachable under exhaustion"
        )
