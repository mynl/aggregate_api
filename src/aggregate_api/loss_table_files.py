"""Loss table files are read for private requests only.

Since ``aggregate`` 1.13.0 an ``elt`` or ``ylt`` source may be a quoted file
path, and the library reads it from the disk of the process that builds the
program: an absolute path anywhere, a relative one against the server's working
directory. On a public server that disk is the host's. A visitor could probe it
(the library's error distinguishes a missing file from one lacking columns, and
includes the resolved absolute path) and pull the numbers out of any file shaped
like a loss table, a column named ``loss`` being enough for a ``ylt``.

So a request from outside ``AGGAPI_PRIVATE_CIDRS`` may not name a file. Private
means what it means for the status page, judged by
:func:`aggregate_api.net.is_private_request`, and ``net.py`` explains the
forwarded chain that judgment rests on. Inline tables, ``elt [[...]]`` and
``ylt [...]``, are untouched and open to everyone.

One test, three places
----------------------

**The test is a suffix.** The library picks a reader by the path's suffix after
``.lower()`` and refuses any other suffix before the disk is touched, and a DecL
quoted string has no escapes, so a readable path contains one of
:data:`READABLE_SUFFIXES` literally. Neither preprocessing pass can assemble one:
``collapse_program`` replaces continuations and whitespace with spaces and
deletes nothing, and the library lifts quoted strings out before it strips
comments. The test ignores position, so labels, ``unit`` clauses, ``note{}``
bodies and comments cannot hide a path from it. A scan for a quoted string in
the source position would have to agree with the library on where every string
begins and ends; this one cannot be misled. A false positive (a comment that
mentions ``.csv``) costs a visitor a 422 and nothing else.

1. **The request text**, by :func:`refuse_file_text`, a dependency on every
   ``/v1`` router: each query value and each string in a JSON body, decoded, so
   a ``\\u002e`` escape does not slip past. Pure string work, before anything
   reaches the library.
2. **The resolved program**, by :func:`preview_names_file`, on the build route.
   ``agg.NAME`` holds no path in its text yet may resolve to a recipe that does.
   The route already previews every program before keying it, and the preview
   parses without reading any file (checked on 1.18.0), so the same test runs
   over the parsed statements, which hold an inlined referent's sources, and the
   spec of every entry the preview resolved, which covers the deferred
   ``sev agg.NAME`` and the chain behind it.
3. **The object cache.** An object id is a hash anyone can compute from the
   program, so a private build that read a file is marked
   (``CacheEntry.reads_files``), and the lookup, the cache listing and the
   session download hide it from everyone else.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Iterator

from fastapi import HTTPException, Request

from .config import get_settings
from .net import is_private_request

log = logging.getLogger(__name__)

#: The suffixes ``aggregate`` has a reader for. ``tests/test_loss_table_files.py``
#: checks this against the list the library's own refusal message gives, so a
#: reader added upstream fails the suite rather than opening a gap.
READABLE_SUFFIXES = (".csv", ".tsv", ".parquet", ".feather")

#: The refusal, shown in the SPA's error pane.
REFUSAL = ("loss table files are read only for requests from this server's "
           "private network; write the table inline, as elt [[id rate mean] ...] "
           "or ylt [loss ...]")


def mentions_readable_file(text: str) -> bool:
    """True when ``text`` contains a suffix the library has a reader for.

    Parameters
    ----------
    text : str

    Returns
    -------
    bool

    Notes
    -----
    ``str.lower`` because that is what the library applies to the suffix, so
    ``"X.CSV"`` matches here exactly when it would be read there.
    """
    lowered = text.lower()
    return any(suffix in lowered for suffix in READABLE_SUFFIXES)


def _strings(node: Any) -> Iterator[str]:
    """Every string inside nested dicts, lists and tuples, keys excluded.

    A path-like value is included as its string, so a spec that one day holds a
    ``pathlib.Path`` rather than a ``str`` is still seen.
    """
    if isinstance(node, str):
        yield node
    elif isinstance(node, os.PathLike):
        yield os.fspath(node)
    elif isinstance(node, dict):
        for value in node.values():
            yield from _strings(value)
    elif isinstance(node, (list, tuple)):
        for value in node:
            yield from _strings(value)


def spec_names_file(spec: Any) -> bool:
    """True when any string in a parsed spec contains a readable suffix.

    Parameters
    ----------
    spec : object
        A recipe spec, walked through nested dicts, lists and tuples.

    Returns
    -------
    bool
    """
    return any(mentions_readable_file(s) for s in _strings(spec))


def preview_names_file(uw, preview) -> bool:
    """True when a previewed program, or anything it resolves to, names a file.

    Parameters
    ----------
    uw : aggregate.underwriter.Underwriter
        The caller's base, the one the preview ran against.
    preview : aggregate.underwriter.ProgramPreview
        From ``uw.preview(program)``.

    Returns
    -------
    bool

    Raises
    ------
    aggregate.underwriter.RecipeNotFound
        A resolved entry was dropped between the preview and this lookup. The
        build route answers it as any other missing name.

    Notes
    -----
    The statements alone are not enough. An inlined reference brings the
    referent's sources into the statement's spec, but ``sev agg.NAME`` is
    deferred to build time and leaves only ``sev_ref`` behind. ``resolved``
    lists that target and everything behind it, so looking each one up covers
    the chain.
    """
    if any(spec_names_file(getattr(s, "spec", None)) for s in preview.statements):
        return True
    return any(spec_names_file(uw.recipe(ref.name, kind=ref.kind).spec)
               for ref in preview.resolved)


def request_is_private(request: Request) -> bool:
    """Whether ``request`` came from ``AGGAPI_PRIVATE_CIDRS``.

    Parameters
    ----------
    request : starlette.requests.Request

    Returns
    -------
    bool

    Notes
    -----
    Settings are read directly rather than injected, as in
    ``routes.objects._locked_entry``: a sync dependency costs a thread token,
    and ``get_settings`` is a cached singleton.
    """
    allowed, _ = is_private_request(request, get_settings().private_cidrs)
    return allowed


async def refuse_file_text(request: Request) -> None:
    """Dependency: refuse a request from outside whose text names a file.

    Parameters
    ----------
    request : starlette.requests.Request

    Raises
    ------
    HTTPException
        422 with :data:`REFUSAL`.

    Notes
    -----
    Mounted on every ``/v1`` router except the status router, which is private
    already. Asynchronous so it costs no thread token.

    The URL path is not scanned: ``frame/{which}.csv`` is a route, not a
    program, and no route takes DecL in its path.

    The body is read twice over, as raw text and as the strings of its JSON. A
    body that does not parse as JSON is judged on the raw text alone.
    FastAPI has already read and cached the body by the time a dependency runs,
    so ``request.body()`` costs nothing more.
    """
    texts = list(request.query_params.values())
    body = await request.body()
    if body:
        raw = body.decode("utf-8", errors="replace")
        texts.append(raw)
        try:
            texts.extend(_strings(json.loads(raw)))
        except ValueError:
            pass
    if not any(mentions_readable_file(t) for t in texts):
        return
    allowed, address = is_private_request(request, get_settings().private_cidrs)
    if allowed:
        return
    log.warning("loss table file refused: address=%s path=%s",
                address, request.url.path)
    raise HTTPException(status_code=422, detail=REFUSAL)
