"""Example-library routes.

Endpoints over ``aggregate``'s recipe base (``library.agg``):

* ``GET /v1/examples``: the whole library, one flat list in file order, or with
  ``?database=<stem>`` another shipped ``.agg`` file's.
* ``GET /v1/examples/databases``: the stems ``?database=`` accepts.
* ``GET /v1/examples/heroes``: just the ``role:hero`` entries, for the
  landing gallery.

The loaders are ``lru_cache``d in :mod:`aggregate_api.examples`, so each recipe
base is walked once per process. The routes are thin wrappers.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from .. import models
from ..examples import (
    filter_examples, load_examples, load_hero_sparklines, load_heroes,
)
from ..library import shipped_databases

logger = logging.getLogger(__name__)

router = APIRouter()


def _database_key(database: str | None) -> str | None:
    """The loader key for a requested stem: ``None`` for the default file.

    Parameters
    ----------
    database : str or None
        The ``?database=`` value as sent.

    Returns
    -------
    str or None
        The stem of a non-default listed file, or ``None`` when absent or when
        it names the default, so ``?database=library`` and no parameter share
        one cache entry.

    Raises
    ------
    HTTPException
        422 for anything the listing does not carry. The value is compared with
        listed stems and never touches a path, so ``../x`` is refused here.
    """
    if database is None:
        return None
    for row in shipped_databases():
        if row["name"] == database:
            return None if row["default"] else database
    raise HTTPException(
        status_code=422,
        detail=(f"unknown example database {database!r}; "
                "GET /v1/examples/databases lists them"),
    )


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
    database: str | None = Query(
        None, description="A stem from /v1/examples/databases; absent is the default file."
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

    ``database`` is a **view parameter**, held per viewer in the browser. The
    process base is shared by every user of a public server, so switching it
    would change everyone's menu at once; builds keep resolving against it
    whichever file the menu reads.

    A non-default file that fails to load is a 422 carrying the parse message,
    since ``Underwriter.load`` stops at the file's first bad statement. The
    default file's path is untouched by that handling.
    """
    key = _database_key(database)
    if key is None:
        payload = load_examples()
    else:
        try:
            payload = load_examples(key)
        except Exception as exc:  # noqa: BLE001 (any load failure is the file's)
            # A few library failures carry no message (an unbalanced bracket
            # trips a bare assert in the lexer), and an empty reason is worse
            # than the exception's name.
            reason = str(exc) or type(exc).__name__
            logger.warning("example database %s did not load: %s", key, reason)
            raise HTTPException(
                status_code=422, detail=f"{key}.agg could not be loaded: {reason}",
            ) from None
    return filter_examples(payload, kind=kind, topic=topic, role=role)


@router.get("/examples/databases", response_model=models.DatabasesResponse)
def list_databases() -> dict:
    """The shipped ``.agg`` files the Examples menu can read, default first.

    Only the package's own directory, minus names starting with ``_``: see
    :func:`aggregate_api.library.shipped_databases` for why the ``cwd`` and
    user rows are excluded. Nothing is parsed, so this is cheap and carries no
    counts.
    """
    return {"databases": [{"name": row["name"], "default": row["default"]}
                          for row in shipped_databases()]}


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
