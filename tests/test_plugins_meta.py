"""The plugin manifest on ``/v1/meta``, and the settings that gate loading.

What is under test is this repo's half: that the app runs discovery when the
setting says to, that the allowlist is threaded through, and that the manifest is
shaped the way the SPA reads it, with a **one-line** error rather than a
traceback.

The plugins themselves are faked. Whether ``aggregate.plugins`` discovers and
registers correctly is the library's question and its own suite answers it; what
matters here is the shaping, and a test that depended on a particular plugin
package being installed would be testing the environment.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from aggregate import plugins as agg_plugins
from aggregate.plugins import LoadedPlugin, PluginLeaf

from aggregate_api import app as app_module
from aggregate_api.config import Settings
from aggregate_api.routes import meta as meta_routes

LEAF = PluginLeaf(name="relativity", kind="exhibit", label="Relativity",
                  hint="each cover against the gross book",
                  why="needs an extended P&L")

GOOD = LoadedPlugin(name="relativity", version="0.1.0", source="entry_point",
                    leaves=(LEAF,), exhibits=("relativity",))

BROKEN = LoadedPlugin(
    name="halfbaked", version=None, source="env",
    error='Traceback (most recent call last):\n  File "x.py", line 1\n'
          "RuntimeError: this plugin is deliberately broken\n")


@pytest.fixture
def fake_manifest(monkeypatch):
    """Report a loaded plugin and a broken one, without installing either."""
    monkeypatch.setattr(agg_plugins, "loaded_plugins", lambda: [GOOD, BROKEN])


# --- the manifest on meta ----------------------------------------------------

def test_meta_always_carries_the_field(client):
    """The field is always present, so the SPA never has to guard for it."""
    assert isinstance(client.get("/v1/meta").json()["plugins"], list)


def test_meta_reports_an_empty_manifest(client, monkeypatch):
    """Empty is what suppresses the Lab tab, so it is worth pinning.

    The manifest is faked empty rather than read from a stock environment. An
    assertion that this process happens to have no plugin installed would break
    the moment one is installed for a demo, and it would be testing the
    environment rather than the route.
    """
    monkeypatch.setattr(agg_plugins, "loaded_plugins", lambda: [])
    assert client.get("/v1/meta").json()["plugins"] == []


def test_meta_reports_the_manifest(client, fake_manifest):
    body = client.get("/v1/meta").json()
    names = [p["name"] for p in body["plugins"]]
    assert names == ["relativity", "halfbaked"]

    good = body["plugins"][0]
    assert good["version"] == "0.1.0"
    assert good["source"] == "entry_point"
    assert good["error"] is None
    leaf, = good["leaves"]
    assert leaf == {
        "name": "relativity",
        "kind": "exhibit",
        "label": "Relativity",
        "hint": "each cover against the gross book",
        "why": "needs an extended P&L",
    }


def test_a_failed_plugin_travels_as_one_line(client, fake_manifest):
    """The traceback goes to the log; meta carries the exception line.

    Meta already holds five other facts and is fetched on every page load, so it
    must not become the place tracebacks accumulate. A failed plugin still has to
    be visible somewhere a human looks, which is what this one line is for.
    """
    broken = client.get("/v1/meta").json()["plugins"][1]
    assert broken["leaves"] == []
    assert broken["version"] is None
    assert broken["error"] == "RuntimeError: this plugin is deliberately broken"
    assert "Traceback" not in broken["error"]
    assert "\n" not in broken["error"]


def test_one_line_handles_an_absent_error():
    assert meta_routes._one_line(None) is None
    assert meta_routes._one_line("") is None
    assert meta_routes._one_line("ValueError: x\n\n") == "ValueError: x"


# --- the settings ------------------------------------------------------------

def test_plugins_are_enabled_by_default():
    assert Settings().plugins_enabled is True


def test_an_empty_allowlist_means_all_of_them():
    """None, not an empty list: the library reads them oppositely.

    ``allow=None`` admits everything discovered and ``allow=[]`` admits nothing,
    so collapsing the empty string to a falsy list would silently disable every
    plugin.
    """
    assert Settings(AGGAPI_PLUGINS_ALLOW="").plugins_allow is None


def test_the_allowlist_parses_a_comma_separated_list():
    settings = Settings(AGGAPI_PLUGINS_ALLOW=" relativity , other ,, ")
    assert settings.plugins_allow == ["relativity", "other"]


# --- what create_app does with them ------------------------------------------

@dataclass
class _Call:
    """What ``load`` was handed, if it was called at all."""

    called: bool = False
    allow: object = "unset"


@pytest.fixture
def load_spy(monkeypatch):
    """Record the ``load`` call instead of running discovery."""
    seen = _Call()

    def _load(*, allow=None, **kwargs):
        seen.called = True
        seen.allow = allow
        return []

    monkeypatch.setattr(app_module.agg_plugins, "load", _load)
    return seen


def test_create_app_loads_plugins(load_spy):
    app_module.create_app(Settings())
    assert load_spy.called is True
    assert load_spy.allow is None


def test_create_app_threads_the_allowlist(load_spy):
    app_module.create_app(Settings(AGGAPI_PLUGINS_ALLOW="relativity"))
    assert load_spy.allow == ["relativity"]


def test_the_setting_turns_loading_off(load_spy):
    app_module.create_app(Settings(plugins_enabled=False))
    assert load_spy.called is False


def test_the_env_vars_reach_the_settings(monkeypatch):
    """The names in the environment, which is how a deployment sets them.

    Worth pinning separately from the fields: ``plugins_enabled`` takes its own
    name as a constructor kwarg while ``plugins_allow`` is reached through a
    ``validation_alias``, so the two are wired differently and only the
    environment exercises both the way a deployment does.
    """
    monkeypatch.setenv("AGGAPI_PLUGINS_ENABLED", "false")
    monkeypatch.setenv("AGGAPI_PLUGINS_ALLOW", "relativity")
    settings = Settings()
    assert settings.plugins_enabled is False
    assert settings.plugins_allow == ["relativity"]


def test_a_failing_plugin_does_not_break_the_app(monkeypatch, caplog):
    """One broken experiment must not take the server down, and must be logged."""
    monkeypatch.setattr(app_module.agg_plugins, "load",
                        lambda *, allow=None, **kw: [BROKEN])
    with caplog.at_level("WARNING"):
        app = app_module.create_app(Settings())
    assert app is not None
    assert any("halfbaked" in r.getMessage() for r in caplog.records), caplog.text
