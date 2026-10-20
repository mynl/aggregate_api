"""The /use page: its worked example is true, and the server serves it.

The page (``web/use/index.html``) tells a newcomer how to run ``aggregate``
from Jupyter, R, Excel and Google Sheets, and every tab ends on one program and
the quantiles it gives. Those numbers are written into the page as text, so a
library release that moved them would leave the page quietly wrong. Building
the program here and finding its numbers on the page turns that into a failing
test. See ``dev/done/plan-use-page.md``.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[1]
_PAGE_SOURCE = _REPO / "web" / "use" / "index.html"
_PAGE_BUILT = _REPO / "src" / "aggregate_api" / "static" / "use" / "index.html"

# The worked example, wherever it appears in full. The pictures shorten it to
# "agg Gross 20 claims ..." on purpose, and those do not match.
_PROGRAM = re.compile(r"agg Gross [^'\"<]*?gamma 0\.4")


@pytest.fixture(scope="module")
def page() -> str:
    """The page's source, as text."""
    return _PAGE_SOURCE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def gross(page):
    """The page's program, built by the installed library."""
    from aggregate import build

    return build(_PROGRAM.search(page).group(0))


def test_every_tab_carries_the_same_program(page: str) -> None:
    """Jupyter, R, both Excel routes and Sheets: one program, one string."""
    found = _PROGRAM.findall(page)
    # Jupyter's code, R's code, three worksheet steps and two worksheet
    # pictures at the least.
    assert len(found) >= 7, found
    assert len(set(found)) == 1, set(found)


def test_the_quantiles_on_the_page_are_the_library_s(page: str, gross) -> None:
    """The 50%, 90% and 99% quantiles appear as the page prints them.

    Plain for the notebook, R and Sheets; with thousands separators for the
    Excel picture. A miss means the library moved them and every tab is now
    wrong; recapture the outputs from real runs rather than editing numbers.
    """
    for value in gross.q([0.5, 0.9, 0.99]):
        assert f"{value:.0f}" in page, value
        assert f"{value:,.0f}" in page, value


def test_the_r_handle_print_is_the_library_s(page: str, gross) -> None:
    """The R picture's mean and cv are the object's, as aggregateR rounds them.

    ``format.agg_handle`` prints the mean to six significant figures and the cv
    to three, which is why the picture reads ``4672.52`` where ``qd`` reads
    ``4672.5``.
    """
    assert f"mean, cv    {gross.est_m:.6g}, {gross.est_cv:.3g}" in page


def test_the_sheets_template_link_is_the_same_everywhere() -> None:
    """The page's copy button and both READMEs send a reader to one template.

    Copies never update, so a stale link hands out an old script for good.
    Replacing the template means editing all three, and this fails on a miss.
    """
    copy_link = re.compile(r"https://docs\.google\.com/spreadsheets/d/[\w-]+/copy")
    script = (_REPO / "web" / "src" / "use.js").read_text(encoding="utf-8")
    declared = re.search(r"SHEETS_TEMPLATE_URL = '([^']*)'", script).group(1)
    assert copy_link.fullmatch(declared), declared
    for readme in ("README.md", "sheets/README.md"):
        text = (_REPO / readme).read_text(encoding="utf-8")
        assert set(copy_link.findall(text)) == {declared}, readme


def test_use_redirects_to_the_folder_and_serves_the_page(client) -> None:
    """``/use`` redirects to ``/use/``, which serves the page.

    Starlette's ``StaticFiles(html=True)`` does both for any folder holding an
    ``index.html``, so this guards the mount order and the build rather than
    code of ours. Skipped without a built bundle, as ``test_packaging.py`` is.
    """
    if not _PAGE_BUILT.exists():
        pytest.skip("static/use/index.html is not built; run scripts/build-web.ps1")
    bare = client.get("/use", follow_redirects=False)
    assert bare.status_code in (301, 302, 307, 308)
    assert bare.headers["location"].endswith("/use/")
    page = client.get("/use/")
    assert page.status_code == 200
    assert "How to use" in page.text
