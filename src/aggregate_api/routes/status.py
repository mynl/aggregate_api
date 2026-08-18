"""The operator's view: ``GET /v1/status`` and the page that renders it.

Two routes and one gate. ``/v1/status`` is the contract, a JSON document that
is scriptable, curl'able from the VPS, and the thing a future monitor would
poll. ``/v1/status/page`` is one self-contained HTML file that fetches it and
re-renders on a timer. Both are read only, both are private, and neither
appears in the OpenAPI schema.

Private by construction, three layers
-------------------------------------

None of the three is trusted alone, and the first needs no trust in this file
at all.

1. **The public Caddy block answers ``/v1/status*`` with 404**, beside the
   ``/docs`` and ``/openapi.json`` matcher already there. The app is never
   reached, so nothing here can expose the page. One prefix covers both routes
   and every future one, which is why they live under ``/v1`` together.
2. **This module's** :func:`require_private`, for the case where a Caddy block
   is edited, reloaded wrong, or a second front door appears. Deny by default:
   see ``net.py`` for why the peer address cannot be the test and why the
   forwarded chain is read from the last element.
3. **An explicit zone header**, ``X-Aggapi-Zone: private``, set by the VPN Caddy
   block and stripped by the public one. Off by default (author ruling,
   2026-08-18); ``AGGAPI_STATUS_REQUIRE_ZONE_HEADER=true`` turns it on. It is
   the only layer that survives a mistake in the CIDR list, so it ships built
   and documented rather than unwritten.

Refusal is 404 and not 403, so the page's existence is not advertised, and it is
logged at WARNING: a refusal on a correctly configured box means something
changed.

Read only, always
-----------------

**No route under ``/v1/status`` may build, evict, clear, or mutate anything.**
Every number is read off a live structure or queried from the audit log. A
"clear the cache" button would be a separate plan with its own gate, and it is
not this one. ``tests/test_status.py`` asserts the invariant by snapshotting the
cache and the counters around a request.

What it costs
-------------

Tens of milliseconds, and flat in the age of the deployment. The audit queries
are windowed, indexed, limited, and share one connection; the cache sizes are
arithmetic on ``log2`` rather than a walk into numpy
(:func:`aggregate_api.status.estimated_bytes` says why); the resource block
never blocks on a CPU interval. Measured on the Windows development box at 25 to
40 ms, of which ``psutil`` is about 17: reading process memory and handle counts
is markedly more expensive on Windows than the ``/proc`` reads it does on the
Linux VPS, so the deployed number is smaller than the development one. Against a
ten second refresh either is free.

``generated_in_ms`` rides in the payload so the page reports its own cost and a
regression is self evident rather than inferred.
"""

from __future__ import annotations

import logging
import platform
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from importlib.metadata import version as _pkg_version
from importlib.resources import files
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse

from .. import models
from .. import resources as resource_block
from .. import status as status_state
from ..audit import AuditLog
from ..cache import ObjectCache
from ..config import Settings, get_settings
from ..library import get_underwriter
from ..net import is_private_request
from ..sessions import SessionRegistry
from . import objects as objects_routes

log = logging.getLogger(__name__)

router = APIRouter()

#: Layer three's header and the value it must carry. The VPN Caddy block sets
#: it; the public block deletes any inbound one, so it cannot be forged.
ZONE_HEADER = "X-Aggapi-Zone"
ZONE_PRIVATE = "private"

#: Windows the build panel reports over. An hour answers "what is happening
#: now" and a day answers "what has this box been doing", and two numbers side
#: by side say more than either: a busy hour inside a quiet day is a session,
#: and a quiet hour inside a busy day is one that just ended.
BUILD_WINDOWS = (("hour", 3600.0), ("day", 86400.0))

#: What the oversight charter's state snapshot records, so the page can say when
#: the library has moved. Not a check and not a floor: a mismatch is news, not
#: an error, and the direction it moves in is the useful part. See
#: ``T:/worktrees/CLAUDE.md``, "State snapshot".
CHARTER_EXHIBITS = 12
CHARTER_CHARTS = 8

#: How much of a cached program the payload carries. Same limit the key-scope
#: buffer uses, so one pasted portfolio cannot push everything else off the
#: page, and the page offers an expand control for the rest.
PROGRAM_CHARS = status_state.PROGRAM_CHARS


def require_private(request: Request,
                    settings: Settings = Depends(get_settings)) -> str:
    """Admit a request only if it demonstrably came from a private origin.

    Parameters
    ----------
    request : starlette.requests.Request
    settings : Settings
        For ``private_cidrs`` and ``status_require_zone_header``.

    Returns
    -------
    str
        The address the request was admitted on, so a route can report it.

    Raises
    ------
    HTTPException
        404 for anything not admitted.

    Notes
    -----
    **Deny by default.** The verdict comes from
    :func:`aggregate_api.net.is_private_request`, which answers False for an
    address it could not establish as readily as for one outside the list, so
    there is no path where an unexpected shape falls through to allowed.

    **404 rather than 403.** A 403 confirms the route exists, which is
    information this page should not give away; a 404 is what an unmounted
    route would say. The refusal is logged and buffered instead, where the
    operator who is entitled to know can see it.

    **The single-hop assumption is load bearing.** Exactly one trusted proxy
    sits in front of this app, so the last forwarded element is the address
    Caddy observed. Add a second proxy and that index is wrong and the gate
    opens. ``net.py``'s module docstring and ``human-hints.md`` both carry this;
    it is repeated here because this is the function it would break.
    """
    allowed, address = is_private_request(request, settings.private_cidrs)
    reason = None if allowed else "address not in AGGAPI_PRIVATE_CIDRS"
    if allowed and settings.status_require_zone_header:
        zone = (request.headers.get(ZONE_HEADER) or "").strip().lower()
        if zone != ZONE_PRIVATE:
            allowed, reason = False, f"missing or wrong {ZONE_HEADER}"
    if not allowed:
        status_state.record_refusal(address, request.url.path)
        log.warning("status route refused: address=%s path=%s reason=%s",
                    address, request.url.path, reason)
        raise HTTPException(status_code=404, detail="Not Found")
    return address


def _recipe_count(uw) -> int | None:
    """How many recipes a base holds, or ``None`` if it will not say.

    Notes
    -----
    ``len(uw._recipes)`` is a private attribute of a stable-tier library class,
    taken deliberately and recorded in the oversight charter's tolerated list
    (author ruling, 2026-08-18). The public route is ``Underwriter.recipes``,
    which builds a pandas frame per call, and this page calls this once for the
    process base and once per live session on every refresh. The read is
    guarded, so a rename upstream costs one field reading ``None`` rather than a
    broken route.
    """
    if uw is None:
        return None
    try:
        return len(uw._recipes)
    except (AttributeError, TypeError):
        return None


def _loaded_underwriter():
    """The process recipe base, but only if something has already loaded it.

    Returns
    -------
    aggregate.underwriter.Underwriter or None
        ``None`` when nothing in this process has resolved the library yet.

    Notes
    -----
    **Reporting on the library must not cause the library to be read.**
    :func:`aggregate_api.library.get_underwriter` loads on first call, which
    takes about two seconds for a custom ``.agg``, so a status route that simply
    called it would make the first page load on a cold process pay for the read,
    and would report a "boot library load time" that its own request had caused.
    A page that changes what it measures is not an instrument.

    ``lru_cache`` publishes ``cache_info()``, so "has anything loaded this yet"
    is answerable without touching it. Before the first build the page says the
    library is not loaded, which is a true and useful thing to say.
    """
    if get_underwriter.cache_info().currsize == 0:
        return None
    return get_underwriter()


def _identity(settings: Settings) -> dict:
    """Versions, interpreter, process and library, the version-skew block.

    Notes
    -----
    Both package versions come from ``importlib.metadata``, which reports what
    was recorded when the editable install was built rather than what
    ``pyproject.toml`` says now. That is the standing trap in both repos'
    CLAUDE.md: a library bump without ``uv sync --extra dev`` leaves the server
    reporting stale versions indefinitely. Showing both beside the process start
    time is what turns that from an hour of confusion into a glance.
    """
    facts = status_state.process_facts()
    uw = _loaded_underwriter()
    recipes = _recipe_count(uw)
    return {
        "version": _pkg_version("aggregate_api"),
        "aggregate_version": _pkg_version("aggregate"),
        "tables_version": _pkg_version("greater-tables"),
        "python": sys.version.split()[0],
        "platform": platform.platform(terse=True),
        "host": settings.host,
        "port": settings.port,
        "library": settings.library or "aggregate bundled library.agg",
        "library_loaded": uw is not None,
        "library_recipes": recipes,
        **facts,
    }


def _settings_block(settings: Settings) -> dict:
    """The live config knobs, so a deploy's actual settings are readable.

    Notes
    -----
    Every field here is a knob an operator sets, and none of them is a secret:
    the api has no credentials to leak. ``private_cidrs`` is echoed as text
    rather than as parsed networks so what is shown is what was configured,
    which is the form a typo is visible in.
    """
    return {
        "log2_cap": settings.log2_cap,
        "log2_default": settings.log2_default,
        "build_timeout_s": settings.build_timeout_s,
        "cache_max": settings.cache_max,
        "session_max": settings.session_max,
        "session_ttl_s": settings.session_ttl_s,
        "max_chart_detail": settings.max_chart_detail,
        "cors_origins": settings.cors_origins,
        "audit_db": settings.audit_db,
        "serve_spa": settings.serve_spa,
        "private_cidrs": settings.private_cidrs_raw,
        "status_require_zone_header": settings.status_require_zone_header,
        "status_refresh_s": settings.status_refresh_s,
    }


def _cache_block(cache: ObjectCache) -> dict:
    """Counters plus a row per entry, LRU first so the next eviction reads first."""
    block = cache.stats()
    rows = []
    for oid, entry in cache.items():
        program, truncated = status_state.truncate(entry.decl, PROGRAM_CHARS)
        rows.append({
            "id": oid,
            "kind": entry.kind,
            "name": entry.name,
            "log2": entry.log2,
            "bs": entry.bs,
            "created_at": entry.created_at.isoformat(timespec="seconds"),
            "notes": len(entry.notes),
            "estimated_bytes": status_state.estimated_bytes(entry.obj, entry.log2),
            "program": program,
            "truncated": truncated,
        })
    block["rows"] = rows
    return block


def _watch_block(settings: Settings, cache: ObjectCache, audit: AuditLog) -> dict:
    """The small things that earn their place, section 4.7 of the plan.

    Notes
    -----
    Four items, each answering a question nothing else in this process surfaces.

    **Notes volume.** How many cached objects carry a library warning, and which
    warning is most common. A spike means the library started saying something
    new about ordinary programs, which is exactly the ripple the oversight
    charter asks each side to check for and which no route reports.

    **Capability drift.** The live exhibit and chart registry counts against the
    numbers the charter's state snapshot records. A library bump that registers
    a new exhibit announces itself here rather than being noticed when somebody
    goes looking for a tab.

    **Static build freshness.** Whether the SPA bundle is mounted and how old
    its ``index.html`` is. The two-stage build is a documented trap, and "the
    deploy did not rebuild the web app" is otherwise diagnosed by confusion.

    **Dead config.** A standing slot for settings that are read by nothing. It
    is empty today, and the slot is kept so the next one is noticed.
    """
    entries = [entry for _, entry in cache.items()]
    notes = Counter(note for entry in entries for note in entry.notes)
    try:
        from aggregate.charts import CHARTS
        from aggregate.exhibits import EXHIBITS

        registries = {
            "exhibits": len(EXHIBITS),
            "charts": len(CHARTS),
            "charter_exhibits": CHARTER_EXHIBITS,
            "charter_charts": CHARTER_CHARTS,
            "drifted": len(EXHIBITS) != CHARTER_EXHIBITS or len(CHARTS) != CHARTER_CHARTS,
        }
    except Exception as exc:  # noqa: BLE001 (a provisional module, by charter)
        registries = {"unavailable": str(exc)}
    return {
        "notes": {
            "entries_with_notes": sum(1 for entry in entries if entry.notes),
            "distinct": len(notes),
            "most_common": [{"note": text, "count": count}
                            for text, count in notes.most_common(5)],
        },
        "registries": registries,
        "static": _static_freshness(settings),
        "audit_db_bytes": audit.size_bytes(),
        "unused_settings": [],
    }


def _static_freshness(settings: Settings) -> dict:
    """Whether the SPA bundle is mounted, and when its ``index.html`` was written.

    Notes
    -----
    The import of ``_resolve_static_dir`` is function-local because ``app.py``
    imports this module to mount it, so a module-level import would be a cycle.
    Reimplementing the three lines instead would be a second copy of a
    precedence order that has already changed once, which is the worse of the
    two.
    """
    from ..app import _resolve_static_dir

    directory = _resolve_static_dir(settings)
    if directory is None:
        return {"mounted": False, "reason": "serve_spa is off or no directory set"}
    index = Path(directory) / "index.html"
    try:
        stat = index.stat()
    except OSError:
        return {"mounted": False, "directory": str(directory),
                "reason": "no index.html; the web build has not run"}
    built = datetime.fromtimestamp(stat.st_mtime, timezone.utc)
    return {
        "mounted": True,
        "directory": str(directory),
        "index_built_at": built.isoformat(timespec="seconds"),
        "index_age_s": round(time.time() - stat.st_mtime, 1),
    }


@router.get("/status", response_model=models.StatusResponse, include_in_schema=False)
def status(response: Response,
           address: str = Depends(require_private),
           settings: Settings = Depends(get_settings),
           cache: ObjectCache = Depends(objects_routes._get_cache),
           audit: AuditLog = Depends(objects_routes._get_audit),
           sessions: SessionRegistry = Depends(objects_routes._get_sessions)) -> dict:
    """Everything the operator's page shows, as JSON.

    Notes
    -----
    ``no-store`` rather than a short max-age. The whole document is a snapshot
    of a moving process, and a cached copy of it is worse than no copy: an
    operator reading a thirty second old queue depth would draw the wrong
    conclusion and have no way to tell.

    The session baseline is the reference underwriter's recipe count, passed to
    :meth:`aggregate_api.sessions.SessionRegistry.rows` so each session's column
    reads what that session declared rather than the library plus what it
    declared.
    """
    started = time.monotonic()
    response.headers["Cache-Control"] = "no-store"
    baseline = _recipe_count(_loaded_underwriter()) or 0
    session_block = sessions.stats()
    session_block["rows"] = [
        {**row, "session_id": status_state.short_session_id(row["session_id"])}
        for row in sessions.rows(baseline=baseline)
    ]
    builds = {"live": status_state.build_state()}
    builds.update(audit.window_summaries(BUILD_WINDOWS))
    # The slowest-build rows come from the audit log, which stores full session
    # ids on purpose: it is the permanent record. This payload is not, so they
    # are shortened on the way out, and the shortening happens in exactly the
    # three places a session id can reach the wire.
    for label, _ in BUILD_WINDOWS:
        for row in builds[label]["slowest"]:
            row["session_id"] = status_state.short_session_id(row["session_id"])
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generated_in_ms": 0.0,
        "identity": _identity(settings),
        "settings": _settings_block(settings),
        "sessions": session_block,
        "cache": _cache_block(cache),
        "chart_cache": status_state.chart_cache_state(
            len(objects_routes._chart_cache), objects_routes._CHART_CACHE_MAX),
        "builds": builds,
        "key_scope": status_state.key_scope_state(),
        "resources": resource_block.snapshot(settings.audit_db),
        "gate": {**status_state.gate_state(), "admitted_on": address},
        "watch": _watch_block(settings, cache, audit),
    }
    payload["generated_in_ms"] = round((time.monotonic() - started) * 1000, 2)
    return payload


@router.get("/status/page", include_in_schema=False)
def status_page(_: str = Depends(require_private),
                settings: Settings = Depends(get_settings)) -> Response:
    """The operator's page: one self-contained file, no build step.

    Notes
    -----
    **It must not go through Vite and must not live in** ``static/``. The web
    build wipes that directory on every run, so anything placed there is deleted
    by the next deploy, and a status page whose delivery depends on the pipeline
    it exists to report on cannot report on that pipeline failing. So it is one
    HTML file with inline CSS and inline JS, shipped inside the package and
    served by this route.

    The precedent is ``routes/meta.py``'s ``_ASSETS`` allow-list, whose comment
    reads "Deliberately not a StaticFiles mount". Same argument, one file, and
    no path from the request reaches the filesystem at all.

    The refresh interval is substituted into the page rather than fetched,
    because the page's first job on a slow box is to render, and one fewer round
    trip before it can is worth a string replace.
    """
    body = _page_html().replace("__REFRESH_MS__",
                                str(int(settings.status_refresh_s * 1000)))
    return HTMLResponse(content=body, headers={"Cache-Control": "no-store"})


def _page_html() -> str:
    """Read the packaged page. Not cached: it is small, and a reload should show edits."""
    return (files("aggregate_api") / "status_page.html").read_text(encoding="utf-8")
