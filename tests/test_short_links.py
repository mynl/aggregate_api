"""Short links, ``/x/<entry code><view code>``, and their preview card page.

Printed links depend on the entry code never changing, so its value for one
entry is pinned. The view code is the page's, pinned in
``web/test/short-link.test.js``.
"""

from __future__ import annotations

import re

import pytest

from aggregate_api.short_links import ALPHABET, ENTRY_LENGTH, entry_code

ELT_CODE = "GTDNc"


def test_the_alphabet_is_57_characters_without_the_confusable_five():
    """``a-zA-Z0-9`` less ``0 O 1 l I``, each once; the same string as
    ``short-links.js``."""
    assert ALPHABET == "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    assert len(set(ALPHABET)) == len(ALPHABET) == 57
    assert not set("0O1lI") & set(ALPHABET)


def test_the_entry_code_is_pinned():
    """A change here breaks every short link already printed."""
    assert entry_code("library", "EventLossTable") == ELT_CODE


def test_the_database_is_part_of_the_code():
    """``decl-testers.agg`` reuses library names; each file gets its own code."""
    assert entry_code("decl-testers", "EventLossTable") != ELT_CODE


def test_no_two_shipped_entries_share_a_code(client):
    """Over every shipped file, distinct ``(file, name)`` pairs get distinct
    codes, so the lookup order in ``find_entry`` never decides anything.

    Takes ``client`` for its fresh settings and underwriter, so a custom
    library an earlier test installed is not the default here."""
    from aggregate_api.examples import load_examples
    from aggregate_api.library import shipped_databases

    seen: dict[str, tuple[str, str]] = {}
    for row in shipped_databases():
        for item in load_examples(None if row["default"] else row["name"])["items"]:
            key = (row["name"], item["name"])
            assert item["link_code"] == entry_code(*key)
            other = seen.setdefault(item["link_code"], key)
            assert other == key, f"{key} and {other} share {item['link_code']}"
    assert len(seen) > 1000


def test_the_listing_and_the_heroes_carry_the_code(client):
    """Each item of ``/v1/examples`` and of the heroes comes with its
    ``link_code``, computed against the file it was read from."""
    items = client.get("/v1/examples").json()["items"]
    elt = next(item for item in items if item["name"] == "EventLossTable")
    assert elt["link_code"] == ELT_CODE
    first = client.get("/v1/examples?database=reproductions").json()["items"][0]
    assert first["link_code"] == entry_code("reproductions", first["name"])
    for hero in client.get("/v1/examples/heroes").json()["items"]:
        assert hero["link_code"] == entry_code("library", hero["name"])


def _meta(text: str, key: str) -> str:
    """The content of the ``<meta>`` keyed `key` in `text`."""
    found = re.search(rf'<meta (?:property|name)="{re.escape(key)}" content="([^"]*)">', text)
    assert found, f"no {key} in the page"
    return found.group(1)


def test_a_short_link_returns_the_card_and_the_redirect(client):
    """The page holds the entry's card and replaces itself with the long link,
    the view travelling as ``~<view code>``."""
    response = client.get(f"/x/{ELT_CODE}k7Q")
    assert response.status_code == 200
    page = response.text
    assert _meta(page, "og:title") == "EventLossTable · aggregate Loss Lab"
    assert _meta(page, "og:description").startswith(
        "A catastrophe event loss table of eight events")
    assert len(_meta(page, "og:description")) <= 201
    assert _meta(page, "og:url") == f"https://agg.mynl.com/x/{ELT_CODE}k7Q"
    assert _meta(page, "og:image") == "https://agg.mynl.com/social-card.png"
    assert _meta(page, "twitter:card") == "summary_large_image"
    assert ('location.replace("../?database=library&example=EventLossTable'
            '&view=~k7Q");') in page


def test_a_short_link_without_a_view_opens_the_default_tab(client):
    """Five characters are the entry alone; the long link has no ``view``."""
    page = client.get(f"/x/{ELT_CODE}").text
    assert 'location.replace("../?database=library&example=EventLossTable");' in page


def test_a_short_link_into_another_file(client):
    """An entry from a non-default file resolves with that file's stem."""
    first = client.get("/v1/examples?database=reproductions").json()["items"][0]
    page = client.get(f"/x/{first['link_code']}").text
    assert "database=reproductions&example=" in page


def test_the_card_uses_the_request_base_when_the_public_url_is_cleared(client, monkeypatch):
    """With ``AGGAPI_PUBLIC_URL`` empty the card points at the server it came
    from, so its addresses still resolve."""
    from aggregate_api.config import get_settings

    monkeypatch.setenv("AGGAPI_PUBLIC_URL", "")
    get_settings.cache_clear()
    try:
        page = client.get(f"/x/{ELT_CODE}").text
    finally:
        get_settings.cache_clear()
    assert _meta(page, "og:image") == "http://testserver/social-card.png"


@pytest.mark.parametrize("code", [
    "zzzzz",        # well formed, matches no entry
    "GTDN0",        # a character outside the alphabet
    "GTDNcab",      # seven characters: neither 5 nor 8
    "GTDNck7Q9",    # nine
])
def test_an_unknown_or_malformed_code_is_a_404_page(client, code):
    """A page with a link home rather than the SPA shell or a JSON error."""
    response = client.get(f"/x/{code}")
    assert response.status_code == 404
    assert "No example on this server has the short link" in response.text
    assert 'href="../"' in response.text


def test_head_is_accepted(client):
    """Some preview fetchers send ``HEAD`` first."""
    assert client.head(f"/x/{ELT_CODE}").status_code == 200


def test_x_is_reserved_for_short_links():
    """No front end in ``AGGAPI_APPS`` can take ``/x/``."""
    from aggregate_api.apps import RESERVED_NAMES

    assert "x" in RESERVED_NAMES
    assert len(ELT_CODE) == ENTRY_LENGTH
