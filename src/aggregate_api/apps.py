"""Other front ends served beside the API, each at ``/<name>/``.

The deployment names them in ``AGGAPI_APPS`` as ``name=folder`` pairs (see
:attr:`aggregate_api.config.Settings.apps`). Each folder is a static
single-page app from its own repository, holding at least ``index.html``, and
optionally an ``app.json`` with the title and description the playground's
Apps menu shows. ``create_app`` mounts what :func:`discover` admits and keeps
the list on ``app.state.apps`` for ``GET /v1/meta``.

The parallel is with plugins. Plugins extend the engine and are admitted by
``AGGAPI_PLUGINS_ALLOW``; apps extend the front and are admitted by this
mapping. In both the deployment declares what it trusts, and in both one bad
entry is logged and skipped rather than allowed to take the server down.

An app runs on the playground's origin, so it can call ``/v1`` as the visitor
and read the playground's ``localStorage``. It is fully trusted, exactly like a
plugin. See ``dev/done/plan-front-end-apps.md``.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

#: A name is a URL segment: lower case, starts with a letter, at most 32
#: characters. No dot, which also keeps every name clear of the SPA's top-level
#: files (``index.html``, ``sw.js``, the icons).
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")

#: Paths this server already answers, or may: the routers, the add-in, FastAPI's
#: documentation, and the SPA's asset and prototype directories. The SPA bundle's
#: actual top-level entries are added by :func:`reserved_names`.
RESERVED_NAMES = frozenset({"v1", "excel", "docs", "redoc", "assets", "dev", "static"})


@dataclass(frozen=True)
class App:
    """One admitted front end.

    Parameters
    ----------
    name : str
        The URL segment it is served under, ``/<name>/``.
    title : str
        The Apps menu label: ``app.json``'s ``title``, else the name.
    description : str
        The menu's muted second line: ``app.json``'s ``description``, else empty.
    directory : pathlib.Path
        The folder served. Never reported outside the process: ``/v1/meta`` is
        public and would otherwise publish a path on the host.
    """

    name: str
    title: str
    description: str
    directory: Path

    @property
    def url(self) -> str:
        """Where the app is served, with the trailing slash its relative paths need."""
        return f"/{self.name}/"


def reserved_names(static_dir: Path | None) -> frozenset[str]:
    """The names no app may take on this server.

    Parameters
    ----------
    static_dir : pathlib.Path or None
        The SPA bundle directory, or None when the server is headless.

    Returns
    -------
    frozenset of str
        :data:`RESERVED_NAMES` plus every top-level entry of the bundle when it
        exists, so a directory a later web build adds cannot be shadowed by an
        app of the same name.
    """
    names = set(RESERVED_NAMES)
    if static_dir is not None and static_dir.is_dir():
        names.update(entry.name for entry in static_dir.iterdir())
    return frozenset(names)


def discover(pairs: list[tuple[str, str]], reserved: frozenset[str]) -> list[App]:
    """Admit the front ends named in ``AGGAPI_APPS``, skipping bad entries.

    Parameters
    ----------
    pairs : list of (str, str)
        ``(name, folder)`` in the order the setting lists them, from
        :attr:`aggregate_api.config.Settings.apps`.
    reserved : frozenset of str
        Names that are taken, from :func:`reserved_names`.

    Returns
    -------
    list of App
        The admitted apps, in the setting's order.

    Notes
    -----
    **A rejected entry is logged at WARNING and skipped; this never raises.**
    That is the plugins' rule: one broken experiment must not take the server
    down. The log line names the entry and the reason, which is the only place
    a rejection is reported, since ``/v1/meta`` is public and the folder path is
    not its business.

    A duplicate is a name an earlier entry was *admitted* under. A first entry
    rejected for, say, a missing folder does not block a corrected second entry
    of the same name, because nothing was mounted at that name.
    """
    admitted: list[App] = []
    taken: set[str] = set()
    for name, folder in pairs:
        reason = _rejection(name, folder, reserved, taken)
        if reason is not None:
            logger.warning("app %r skipped: %s", f"{name}={folder}" if folder else name, reason)
            continue
        directory = Path(folder)
        title, description = _manifest(directory)
        admitted.append(App(name=name, title=title or name, description=description,
                            directory=directory))
        taken.add(name)
    return admitted


def _rejection(name: str, folder: str, reserved: frozenset[str], taken: set[str]) -> str | None:
    """Why the entry ``name=folder`` cannot be served, or None when it can.

    Parameters
    ----------
    name, folder : str
        One parsed entry. An empty ``folder`` means the entry had no ``=``.
    reserved : frozenset of str
        Names that are taken by the server.
    taken : set of str
        Names already admitted from earlier entries.

    Returns
    -------
    str or None
        The reason, worded for the server log.
    """
    if not folder:
        return "expected name=folder"
    if not NAME_PATTERN.match(name):
        return "a name is lower case letters, digits and hyphens, starting with a letter, at most 32"
    if name in reserved:
        return "the name is reserved by this server"
    if name in taken:
        return "an earlier entry already took the name"
    directory = Path(folder)
    if not directory.is_dir():
        return "the folder does not exist"
    if not (directory / "index.html").is_file():
        return "the folder holds no index.html"
    return None


def _manifest(directory: Path) -> tuple[str, str]:
    """The ``title`` and ``description`` from ``app.json``, each empty when absent.

    Parameters
    ----------
    directory : pathlib.Path
        The app's folder.

    Returns
    -------
    (str, str)
        Title and description. A missing file, one that does not parse, one
        that is not an object, and a field that is not a string all read as
        absent, so a typo in ``app.json`` costs the label, never the app.
    """
    try:
        data = json.loads((directory / "app.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "", ""
    if not isinstance(data, dict):
        return "", ""

    def text(key: str) -> str:
        value = data.get(key)
        return value.strip() if isinstance(value, str) else ""

    return text("title"), text("description")
