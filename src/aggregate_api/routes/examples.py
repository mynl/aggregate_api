"""Example-library routes.

Two endpoints over ``aggregate``'s recipe base (``library.agg``):

* ``GET /v1/examples``: the whole library, one flat list in file order.
* ``GET /v1/examples/heroes``: just the ``role:hero`` entries, for the
  landing gallery.

Both loaders are ``lru_cache``d in :mod:`aggregate_api.examples`, so the recipe
base is walked once per process. The routes are thin wrappers.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from .. import models
from ..examples import (
    filter_examples, load_examples, load_hero_sparklines, load_heroes,
)


router = APIRouter()


@router.get("/examples", response_model=models.ExamplesResponse)
def list_examples(
    kind: list[str] | None = Query(
        None, description="Keep only these recipe kinds (agg, port, sev, ...)."
    ),
    topic: list[str] | None = Query(
        None, description="Keep only these topic: values, unprefixed."
    ),
    role: list[str] | None = Query(
        None, description="Keep only these role: values, unprefixed."
    ),
) -> dict:
    """Return the example library, one flat list in the library's own order.

    See :class:`ExamplesResponse` for the payload shape. Every entry appears
    exactly once, in the order ``library.agg`` declares it.

    Notes
    -----
    The three filters are repeatable and compose as OR within a namespace and
    AND across them, so ``?role=intro&role=intermediate&topic=severity`` is the
    easy half of the severity entries.

    **The SPA does not pass them.** The whole payload is 151 entries fetched
    once and filtered in the browser, where the pills and the list stay in step
    with no round trip. These exist for a notebook reading the api directly.

    ``?group=topic|kind|role`` stood here through a121 and is gone rather than
    deprecated: the api is private and pre-release, so a clean break costs
    nothing and leaving a grouped view behind would have kept the ordering
    tables it needed.
    """
    return filter_examples(load_examples(), kind=kind, topic=topic, role=role)


@router.get("/examples/heroes", response_model=models.HeroesResponse)
def list_heroes() -> dict:
    """Return the entries tagged ``role:hero``, the landing-page gallery.

    Nothing is built here: ``discover``'s directory path filters the recipe
    frame, so this is as cheap as the full listing.
    """
    return load_heroes()


@router.get("/examples/heroes/sparklines", response_model=models.SparklinesResponse)
def hero_sparklines() -> dict:
    """Density silhouettes for the hero cards, keyed by entry name.

    **Slow on the first call**, which is the whole reason it is a separate
    endpoint: it builds every hero, and one of them carries ``hints{log2=16}``.
    Cached for the process afterwards.

    The SPA calls this *after* first paint and leaves the cards on their
    placeholder art until it resolves, so the landing page never waits on it.
    """
    return load_hero_sparklines()
