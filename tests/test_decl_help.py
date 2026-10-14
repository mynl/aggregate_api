"""Tests for ``GET /v1/decl/help`` and the ``decl_help`` field on ``/v1/meta``.

The library's entry point is monkeypatched in both directions, so the suite is
green whether the installed ``aggregate`` has help (1.2.0a15 on) or not (1.0.1,
the floor of the pin). The last test runs only against a library that has it,
and is the check that the contract between the two packages holds.
"""

from __future__ import annotations

import aggregate
import pytest

FAKE = ('<section class="decl-help dh-anatomy" data-decl-version="9.9">'
        '<style>.decl-help.dh-anatomy { color: red; }</style>'
        '<pre class="dh-code" data-load="agg A 1 claim dsev [1] fixed">'
        'agg A 1 claim dsev [1] fixed</pre></section>')


@pytest.fixture
def with_help(monkeypatch):
    """A library offering both forms, whose ``decl_help`` records its calls."""
    calls = []

    def fake_decl_help(form="anatomy"):
        calls.append(form)
        return FAKE
    monkeypatch.setattr(aggregate, "DECL_HELP_FORMS", ("anatomy", "card"), raising=False)
    monkeypatch.setattr(aggregate, "decl_help", fake_decl_help, raising=False)
    return calls


@pytest.fixture
def without_help(monkeypatch):
    """A library with no help at all, as ``aggregate`` 1.0.1 is."""
    monkeypatch.delattr(aggregate, "DECL_HELP_FORMS", raising=False)
    monkeypatch.delattr(aggregate, "decl_help", raising=False)


def test_help_served_as_html(client, with_help):
    r = client.get("/v1/decl/help?form=anatomy")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/html")
    assert r.text == FAKE
    assert r.headers["cache-control"] == "public, max-age=3600"
    assert with_help == ["anatomy"]


def test_help_form_defaults_to_anatomy(client, with_help):
    r = client.get("/v1/decl/help")
    assert r.status_code == 200
    assert with_help == ["anatomy"]


def test_help_absent_is_404_naming_the_library(client, without_help):
    import aggregate
    r = client.get("/v1/decl/help?form=anatomy")
    assert r.status_code == 404
    assert aggregate.__version__ in r.json()["detail"]
    meta = client.get("/v1/meta").json()
    assert meta["decl_help"] == []


def test_meta_lists_the_forms(client, with_help):
    assert client.get("/v1/meta").json()["decl_help"] == ["anatomy", "card"]


def test_unknown_form_is_404_and_never_asks_the_library(client, with_help):
    r = client.get("/v1/decl/help?form=walkthrough")
    assert r.status_code == 404
    assert "anatomy, card" in r.json()["detail"]
    assert with_help == []


def test_version_parameter_is_ignored(client, with_help):
    plain = client.get("/v1/decl/help?form=card").text
    versioned = client.get("/v1/decl/help?form=card&v=1.2.0a15").text
    assert plain == versioned == FAKE


@pytest.mark.skipif(not hasattr(aggregate, "decl_help"),
                    reason="the installed aggregate has no DecL help")
def test_contract_with_the_installed_library(client):
    """Each form the library lists is served as its one scoped section.

    What the SPA depends on, from the plan's fragment contract: one
    ``section.decl-help.dh-{form}`` stamped with the library version, and on the
    anatomy at least one valued ``data-load``.
    """
    import re
    forms = client.get("/v1/meta").json()["decl_help"]
    assert forms == list(aggregate.DECL_HELP_FORMS)
    for form in forms:
        r = client.get(f"/v1/decl/help?form={form}")
        assert r.status_code == 200
        html = r.text
        assert html.lstrip().startswith(f'<section class="decl-help dh-{form}"')
        assert html.count("<section") == 1
        assert f'data-decl-version="{aggregate.__version__}"' in html
        assert "<script" not in html
    anatomy = client.get("/v1/decl/help?form=anatomy").text
    assert re.search(r'data-load="[^"]+"', anatomy)
