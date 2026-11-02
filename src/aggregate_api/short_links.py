"""Short links, ``/x/<code>``, and the page that holds their preview card.

A short link identifies a library entry and, optionally, the tab it opens on:

* the first 5 characters are the **entry code**, a hash of the database stem
  and the entry name, computed here and served as ``link_code`` on every item of
  ``GET /v1/examples``;
* the optional last 3 are the **view code**, a hash of the tab's keys, computed
  in the page (``web/src/short-links.js``), where the tabs are defined.

Nothing is stored. The code is a pure function of the entry and tab, so every
instance mints the same code for the same entry, a link copied on one machine
opens on another, and a printed link survives a server rebuild. It breaks only
when the long link would: the entry is renamed or moved to another file.

``GET /x/{code}`` returns a small HTML page rather than a redirect. Link
preview fetchers (Facebook, LinkedIn, X, Slack, Teams, iMessage, Outlook) read
``og:`` tags and never run a script, so behind a 302 they would get only the SPA
shell and every card would be the same. The page holds the entry's card and a
``location.replace`` to the long link, which the SPA then opens as it always has.
See ``dev/done/plan-short-links-and-cards.md``.
"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import re
from pathlib import Path
from urllib.parse import urlencode

from starlette.requests import Request
from starlette.responses import HTMLResponse

logger = logging.getLogger(__name__)

#: The 57 characters a code is written in: ``a-zA-Z0-9`` without ``0 O 1 l I``,
#: which a reader typing from a PDF cannot tell apart. ``web/src/short-links.js``
#: holds the same string, and the tests on both sides pin it.
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

#: Characters in the entry part and in the optional view part.
ENTRY_LENGTH = 5
VIEW_LENGTH = 3

_CODE = re.compile(f"[{ALPHABET}]{{{ENTRY_LENGTH}}}(?:[{ALPHABET}]{{{VIEW_LENGTH}}})?")

# The card's fixed text, as `web/index.html` sets it for the site as a whole.
SITE_NAME = "aggregate Loss Lab"
SITE_DESCRIPTION = ("aggregate Loss Lab (aLL): build and explore compound probability "
                    "distributions from a DecL program.")
CARD_IMAGE = "social-card.png"
CARD_WIDTH, CARD_HEIGHT = 1200, 630

# Where a note is cut for the card. Facebook and LinkedIn show two or three
# lines of description and drop the rest, so a longer one only costs bytes.
DESCRIPTION_LIMIT = 200


def entry_code(database: str, name: str) -> str:
    """The 5 character code for the entry `name` in the file `database`.

    Parameters
    ----------
    database : str
        The file's stem, as ``GET /v1/examples/databases`` lists it; the
        default file's own stem (``library``), never ``None``.
    name : str
        The entry's name, as the deep link's ``example`` gives it.

    Returns
    -------
    str
        :data:`ENTRY_LENGTH` characters of :data:`ALPHABET`.

    Notes
    -----
    **Printed links depend on this never changing**, so the test pins its value
    for one entry. SHA-256 rather than Python's ``hash``, which is salted per
    process. The database is part of the input because ``decl-testers.agg``
    reuses library names. The first 8 bytes reduced mod 57^5 have a bias of
    order 57^5 / 2^64, which is nothing.
    """
    digest = hashlib.sha256(f"{database}\n{name}".encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big") % len(ALPHABET) ** ENTRY_LENGTH
    chars = []
    for _ in range(ENTRY_LENGTH):
        value, digit = divmod(value, len(ALPHABET))
        chars.append(ALPHABET[digit])
    return "".join(reversed(chars))


def _lookup_order() -> list[dict]:
    """The shipped databases in the order a code is looked for in them.

    Returns
    -------
    list of dict
        Rows of :func:`aggregate_api.library.shipped_databases`: the default
        first, since it is loaded at startup and most links name it, then the
        others smallest file first.

    Notes
    -----
    The first parse of a file is the whole cost of a lookup, and it grows with
    the file: on DOOB, decl-testers (640 entries) took 2.27 s, reproductions
    0.90 s and recitations 0.34 s. Smallest first means a link into
    reproductions does not wait for decl-testers. The order decides nothing
    else, because the test holds that no two entries share a code.
    """
    from .library import shipped_databases

    def size(row: dict) -> float:
        try:
            return Path(row["path"]).stat().st_size
        except (OSError, TypeError):
            return float("inf")

    rows = shipped_databases()
    return [row for row in rows if row["default"]] + sorted(
        (row for row in rows if not row["default"]), key=size)


def find_entry(code: str) -> tuple[str, dict] | None:
    """The database stem and listing item an entry code points at, or ``None``.

    Parameters
    ----------
    code : str
        The first :data:`ENTRY_LENGTH` characters of a short link.

    Returns
    -------
    (str, dict) or None
        The first item in file order with that ``link_code``, so a name
        repeated in one file opens its first entry, as ``findLinkedExample``
        does for a long link. A file that will not load is skipped and logged,
        since a link into another file can still resolve.

    Notes
    -----
    A plain scan of :func:`aggregate_api.examples.load_examples`, which caches
    each listing for the process. A second cache of codes here would cost a
    second invalidation whenever the listing is cleared, for a scan of about a
    thousand items that takes well under a millisecond.
    """
    from .examples import load_examples

    for row in _lookup_order():
        try:
            items = load_examples(None if row["default"] else row["name"])["items"]
        except Exception as exc:  # noqa: BLE001 (one bad file must not 500 the rest)
            logger.warning("short links: %s.agg did not load: %s", row["name"], exc)
            continue
        for item in items:
            if item["link_code"] == code:
                return row["name"], item
    return None


def _shorten(text: str, limit: int = DESCRIPTION_LIMIT) -> str:
    """`text` on one line, cut at a word boundary before `limit` characters."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0].rstrip(",;:.")
    return f"{cut}…"


def _page(title: str, body: str, tags: dict[str, str], script: str = "") -> str:
    """A whole HTML document: `tags` as ``<meta>``, then `script`, then `body`.

    Parameters
    ----------
    title : str
        The document title, unescaped.
    body : str
        Markup for ``<body>``, already escaped.
    tags : dict
        ``property`` or ``name`` to content, unescaped. Keys starting ``og:``
        are written as ``property``, the rest as ``name``.
    script : str
        JavaScript for the head, already safe to place inside ``<script>``.
    """
    metas = "\n".join(
        f'<meta {"property" if key.startswith("og:") else "name"}="{html.escape(key)}" '
        f'content="{html.escape(value)}">'
        for key, value in tags.items())
    script_tag = f"<script>{script}</script>\n" if script else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
{metas}
<link rel="icon" href="../favicon.ico">
{script_tag}<style>body{{font-family:system-ui,"Segoe UI",sans-serif;color:#031629;background:#fff;margin:3rem 1rem;text-align:center}}a{{color:#a81313}}</style>
</head>
<body>
{body}
</body>
</html>
"""


def _base_url(request: Request) -> str:
    """Where absolute addresses on the card point, with a trailing slash.

    ``AGGAPI_PUBLIC_URL`` when set, as Copy link uses it, else the address the
    request arrived at, so a deployment with the setting cleared still writes a
    card that resolves.
    """
    from .config import get_settings

    base = get_settings().public_url.strip() or str(request.base_url)
    return base if base.endswith("/") else f"{base}/"


def short_link_page(code: str, database: str, item: dict, base: str) -> str:
    """The page ``/x/<code>`` returns when the entry is found.

    Parameters
    ----------
    code : str
        The whole code, entry part and any view part.
    database : str
        The stem of the file holding the entry.
    item : dict
        Its listing item, for ``name`` and ``note``.
    base : str
        The absolute address the card's links start from, ending in ``/``.

    Returns
    -------
    str
        HTML whose head holds the card and a ``location.replace`` to the long
        link, and whose body is a plain link to it for a browser without
        scripts.

    Notes
    -----
    The target is relative, ``../?...``, which from ``/x/<code>`` is the SPA
    at ``/``, and stays right when the whole site sits under a sub-path. The
    view travels as ``view=~<view code>``, which ``resolveView`` reads.
    ``location.replace`` keeps ``/x/`` out of the back button's history.
    """
    name = item["name"]
    params = {"database": database, "example": name}
    if len(code) > ENTRY_LENGTH:
        params["view"] = f"~{code[ENTRY_LENGTH:]}"
    target = f"../?{urlencode(params)}"
    title = f"{name} · {SITE_NAME}"
    tags = {
        "description": _shorten(item.get("note") or SITE_DESCRIPTION),
        "og:type": "website",
        "og:site_name": SITE_NAME,
        "og:title": title,
        "og:url": f"{base}x/{code}",
        "og:image": f"{base}{CARD_IMAGE}",
        "og:image:width": str(CARD_WIDTH),
        "og:image:height": str(CARD_HEIGHT),
        "og:image:alt": f"{SITE_NAME}: description to distribution",
        "twitter:card": "summary_large_image",
    }
    tags["og:description"] = tags["description"]
    # json.dumps writes a valid JavaScript string; `</` is broken so no value
    # could close the script element, though urlencode leaves none to break.
    script = f"location.replace({json.dumps(target)});".replace("</", "<\\/")
    body = (f'<p>Opening <a href="{html.escape(target)}">{html.escape(name)}</a> '
            f"in the {SITE_NAME}.</p>")
    return _page(title, body, tags, script)


def not_found_page(code: str) -> str:
    """The page for a code that matches no entry here, with a link home."""
    return _page(
        f"Short link not found · {SITE_NAME}",
        f"<p>No example on this server has the short link "
        f"<code>{html.escape(code)}</code>.</p>"
        f'<p><a href="../">Open the {SITE_NAME}</a></p>',
        {"description": SITE_DESCRIPTION, "robots": "noindex"},
    )


def open_short_link(request: Request) -> HTMLResponse:
    """``GET /x/{code}``: the entry's card and a redirect to its long link.

    Parameters
    ----------
    request : Request
        Carrying ``code`` in its path parameters.

    Returns
    -------
    HTMLResponse
        200 with :func:`short_link_page`, or 404 with :func:`not_found_page`
        for a code that is malformed or matches no entry.

    Notes
    -----
    A plain Starlette endpoint rather than a FastAPI route, as the trailing
    slash redirect in ``app.py`` is, so it accepts ``HEAD`` as well, which some
    preview fetchers send first. Synchronous, so Starlette runs it in its
    thread pool and the first parse of a database does not hold the event loop.
    """
    code = request.path_params["code"]
    found = find_entry(code[:ENTRY_LENGTH]) if _CODE.fullmatch(code) else None
    if found is None:
        return HTMLResponse(not_found_page(code), status_code=404)
    database, item = found
    return HTMLResponse(short_link_page(code, database, item, _base_url(request)))
