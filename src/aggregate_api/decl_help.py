"""DecL help pages, as the installed ``aggregate`` library renders them.

The one place in this package that knows the library's help entry point, so a
rename upstream is one edit here. The library owns the words, the styles and the
syntax coloring; this module only asks which forms exist and fetches one.

Nothing is copied. A library without help (``aggregate`` 1.0.1, the floor of the
pin) offers no forms, and the route and the SPA say so rather than falling back
to a page of their own.
"""

from __future__ import annotations

import aggregate


def available_forms() -> list[str]:
    """The help forms the installed library offers.

    Returns
    -------
    list of str
        ``aggregate.DECL_HELP_FORMS`` as a list, such as
        ``['anatomy', 'card']``, or ``[]`` when the library has no help.

    Notes
    -----
    Feature-detected rather than gated on a version, so the pin's floor need
    not move: the help arrived in ``aggregate`` 1.2.0a15 and ships in 1.2.0,
    while the pin admits 1.0.1. Asking for the attribute cannot go wrong the way
    a version comparison can when the library backports or renames.
    """
    return list(getattr(aggregate, "DECL_HELP_FORMS", ()))


def fragment(form: str) -> str:
    """One help page as the library renders it, an HTML fragment.

    Parameters
    ----------
    form : str
        A form from :func:`available_forms`. The library raises ``ValueError``
        on one it does not know, so callers check first.

    Returns
    -------
    str
        One ``<section class="decl-help dh-{form}">`` carrying its own scoped
        ``<style>``, exactly as ``aggregate.decl_help`` returned it.

    Notes
    -----
    No cache here: the library caches the render per process already.
    ``str()`` drops the ``DeclHelp`` subclass, which exists for Jupyter's
    ``_repr_html_`` and means nothing to a web response.
    """
    return str(aggregate.decl_help(form))
