"""The built SPA is whole, and the distribution is told to carry all of it.

Two failures this file exists to catch, both of which leave a server that starts
cleanly, answers ``/`` with a 200, paints the page shell and then does nothing at
all:

1. A half-built or stale bundle in development, where ``index.html`` names an
   asset hash that is no longer on disk. Vite renames every file on every build,
   so an interrupted build can leave exactly this.
2. A distribution that ships ``index.html`` without ``static/assets/``. The
   ``package_data`` glob was ``static/*`` through 1.0.0a202, and a
   ``package_data`` glob matches one directory and does not recurse, so the
   wheel carried the shell and none of the thirteen files it loads.

The first is asserted directly. The second cannot be: it is a property of the
*built wheel*, and this suite runs against a source checkout. ``package_data``
is read here instead, which catches the pattern regressing; the wheel itself is
checked by ``scripts/release-check.ps1``, which builds one and looks inside.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

_PACKAGE_ROOT = Path(__file__).resolve().parents[1] / "src" / "aggregate_api"
_PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"

# src="..." / href="..." on anything the document loads. Only local references
# matter here: an absolute URL is somebody else's to serve.
_REFERENCE = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""")


def _local_references(html: str) -> list[str]:
    """Local paths an HTML document loads, with any query or fragment dropped.

    Kept as written, `./` and `../` included: the caller resolves each against
    the page's own folder, which is what a browser does. Through 1.30.0 this
    stripped leading dots and slashes, which was harmless while every page sat
    at the top of ``static/`` and would read the /use page's ``../assets/x.js``
    as ``use/assets/x.js``.
    """
    out = []
    for raw in _REFERENCE.findall(html):
        if raw.startswith(("http://", "https://", "//", "data:", "mailto:", "#")):
            continue
        out.append(raw.split("?", 1)[0].split("#", 1)[0])
    return out


@pytest.mark.parametrize("document", ["index.html", "lite.html", "use/index.html"])
def test_built_bundle_references_only_files_that_exist(document: str) -> None:
    """Every local asset the built page loads is present where it points.

    Skipped when the bundle is absent, which is the honest state of a fresh
    clone: ``static/index.html`` is build output and gitignored, so a checkout
    that has never run ``scripts/build-web.ps1`` has nothing to check.
    """
    static = _PACKAGE_ROOT / "static"
    page = static / document
    if not page.exists():
        pytest.skip(f"{document} is not built; run scripts/build-web.ps1")

    def target(ref: str) -> Path:
        # A root-relative reference is the server's root, which is static/.
        return static / ref.lstrip("/") if ref.startswith("/") else page.parent / ref

    missing = [ref for ref in _local_references(page.read_text(encoding="utf-8"))
               if not target(ref).exists()]
    assert not missing, (
        f"{document} loads {len(missing)} file(s) that are not on disk: "
        f"{missing}. The bundle is stale or half built; rerun "
        "scripts/build-web.ps1"
    )


def test_package_data_carries_the_asset_directory() -> None:
    """``package_data`` names ``static/assets/*`` explicitly, or recurses.

    The glob does not recurse on its own. Without this entry the wheel ships
    ``static/index.html`` and no script or stylesheet, which is a dead page
    rather than a missing one and is correspondingly hard to diagnose. See
    ``dev/done/plan-1.0.0-release.md``.
    """
    with _PYPROJECT.open("rb") as fh:
        config = tomllib.load(fh)

    patterns = config["tool"]["setuptools"]["package-data"]["aggregate_api"]
    assert any(p in ("static/assets/*", "static/**/*") for p in patterns), (
        "package-data must carry static/assets/* (or static/**/*); "
        f"it currently reads {patterns}"
    )
    # The /use page is a folder of its own, for the same reason (1.31.0).
    assert any(p in ("static/use/*", "static/**/*") for p in patterns), (
        "package-data must carry static/use/* (or static/**/*); "
        f"it currently reads {patterns}"
    )
