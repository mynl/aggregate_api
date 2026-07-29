"""Example-library routes.

Two endpoints over ``aggregate``'s recipe base (``library.agg``):

* ``GET /v1/examples?group=topic|kind|role``: the whole library, grouped.
* ``GET /v1/examples/heroes``: just the ``role:hero`` entries, for the
  landing gallery.

Both loaders are ``lru_cache``d in :mod:`aggregate_api.examples`, so the recipe
base is walked once per process per view. The routes are thin wrappers.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from .. import models
from ..examples import load_examples, load_hero_sparklines, load_heroes


router = APIRouter()


@router.get("/examples", response_model=models.ExamplesResponse)
def list_examples(
    group: Literal["topic", "kind", "role"] = Query(
        "topic",
        description=(
            "Grouping axis: 'topic' (the topic: tag namespace, the default), "
            "'kind' (object type), or 'role' (the role: namespace)."
        ),
    ),
) -> dict:
    """Return the example library grouped on one axis.

    See :class:`ExamplesResponse` for the payload shape. An entry carrying two
    tags in the grouping namespace appears under both.
    """
    return load_examples(group)


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
