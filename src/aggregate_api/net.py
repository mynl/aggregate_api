"""Where a request came from, behind exactly one trusted proxy.

The api runs on ``127.0.0.1:8001`` behind two Caddy front doors, one public
(``agg.mynl.com``) and one on the VPN (``10.8.0.1:19456``), and both of them
``reverse_proxy`` to that same address. So ``request.client.host`` is
``127.0.0.1`` for a visitor from the public internet exactly as much as for one
on the VPN, and any code reading the peer address to decide who is asking gets
the same answer for both. Two things follow, and this module is both of them.

**The audit log has been recording a constant.** ``_client_ip`` in
``routes/objects.py`` read ``request.client.host`` and nothing else, so every
production row carries ``ip = '127.0.0.1'``, the ``builds_ip`` index indexes one
value, and :meth:`aggregate_api.audit.AuditLog.by_ip` cannot answer the question
it exists for. Rows written before this module are not retroactively meaningful.

**And a private-origin gate cannot be written on the peer.** "Allow if the peer
is loopback" would test green on a laptop, test green over the VPN, and publish
the page it guards to the entire internet. The gate reads the forwarded chain
instead, and it reads it from the correct end.

The correct end
---------------

Caddy **appends** the address it observed to whatever ``X-Forwarded-For``
arrived, so the **last** element is the one Caddy saw and everything before it
is whatever the client chose to send. A public visitor who sends
``X-Forwarded-For: 10.8.0.2`` produces ``10.8.0.2, <their real address>``, and
reading the first element hands them the page. Every function here reads the
last, and :func:`forwarded_chain` flattens repeated header lines in arrival
order first, because ``Headers.get`` returns only the first occurrence and a
client can send its own line ahead of Caddy's.

**Reading the last element is correct for exactly one trusted proxy**, which is
the deployment ``human-hints.md`` describes. Put a second proxy in front and the
last element becomes that proxy's view of the first, the index is off by one,
and the gate opens. Nothing here can detect that, so it is a deployment
invariant rather than a check: one hop, and a change to the topology is a change
to this module.

Fail closed
-----------

Anything unparseable is neither private nor a client address. A present but
empty header, a garbled element, an unexpected format: each answers "no" rather
than falling back to the peer, because the peer is loopback and loopback is what
the private list allows.
"""

from __future__ import annotations

import ipaddress
from typing import Iterable

#: The forwarded-for header, spelled once. Compared case-insensitively by
#: Starlette's ``Headers``, so the casing here is presentation only.
FORWARDED_FOR = "X-Forwarded-For"

#: What ``AGGAPI_PRIVATE_CIDRS`` defaults to: loopback, the IPv6 loopback, and
#: the VPN subnet from ``human-hints.md``. A setting rather than a constant
#: because the VPN subnet is a deployment fact.
DEFAULT_PRIVATE_CIDRS = "127.0.0.0/8, ::1, 10.8.0.0/24"

#: Returned when no client address can be established. Matches what
#: ``_client_ip`` has always written for a request with no peer.
UNKNOWN = "-"

Network = ipaddress.IPv4Network | ipaddress.IPv6Network


def parse_cidrs(raw: str) -> tuple[Network, ...]:
    """Parse a comma-separated CIDR list into networks.

    Parameters
    ----------
    raw : str
        Comma-separated networks or bare addresses, for example
        ``"127.0.0.0/8, ::1, 10.8.0.0/24"``. A bare address becomes a single
        host network (``::1`` is ``::1/128``).

    Returns
    -------
    tuple
        The parsed networks, in the order given.

    Raises
    ------
    ValueError
        If any element fails to parse. Deliberately loud: a typo in this
        setting is a gate that silently allows less, or nothing, and a server
        that refuses to start reports that better than a page which has quietly
        stopped answering.

    Notes
    -----
    ``strict=False`` so an entry written with host bits set (``10.8.0.1/24``,
    which is how an operator naturally writes the VPN address they can see) is
    read as the network containing it rather than rejected.
    """
    networks: list[Network] = []
    for element in raw.split(","):
        text = element.strip()
        if not text:
            continue
        networks.append(ipaddress.ip_network(text, strict=False))
    return tuple(networks)


def as_ip(text: str | None):
    """Parse one forwarded element into an address, or ``None``.

    Parameters
    ----------
    text : str or None
        One element of a forwarded chain, or a peer address.

    Returns
    -------
    ipaddress.IPv4Address or ipaddress.IPv6Address or None
        ``None`` for anything that does not parse, which every caller reads as
        "not private" and "not a client address".

    Notes
    -----
    Three decorations are unwrapped, and only three. ``[::1]:443`` is the
    bracketed IPv6-with-port form; ``1.2.3.4:5678`` is the IPv4 one, told apart
    by having exactly one colon, since a bare IPv6 address always has at least
    two; and an IPv4-mapped IPv6 address (``::ffff:10.8.0.2``, which a
    dual-stack listener can report) is reduced to the IPv4 address it carries,
    without which a genuine VPN peer would be compared against an IPv4 network
    as a v6 address and refused.

    Anything else fails closed rather than being guessed at. That direction is
    the whole point: an unrecognized format costs a legitimate request a 404, an
    over-clever parse costs the page.
    """
    if not text:
        return None
    candidate = text.strip()
    if not candidate:
        return None
    if candidate.startswith("["):
        end = candidate.find("]")
        if end < 0:
            return None
        candidate = candidate[1:end]
    elif candidate.count(":") == 1:
        candidate = candidate.split(":", 1)[0]
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    if address.version == 6 and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def is_private(text: str | None, networks: Iterable[Network]) -> bool:
    """True when ``text`` parses to an address inside one of ``networks``.

    Parameters
    ----------
    text : str or None
        A candidate address.
    networks : iterable
        Networks from :func:`parse_cidrs`.

    Returns
    -------
    bool

    Notes
    -----
    The version is checked before the membership test because
    ``IPv4Address in IPv6Network`` raises :class:`TypeError` rather than
    answering False, and a gate that raises on a mixed-family list is a gate
    that 500s instead of refusing.
    """
    address = as_ip(text)
    if address is None:
        return False
    return any(address.version == net.version and address in net
               for net in networks)


def forwarded_chain(request) -> list[str]:
    """Every ``X-Forwarded-For`` element, in arrival order.

    Parameters
    ----------
    request : starlette.requests.Request

    Returns
    -------
    list of str
        Stripped elements, earliest hop first. Empty **only** when the header is
        absent, so an empty list means "nothing proxied this request" and never
        "a proxy said nothing".

    Notes
    -----
    ``getlist`` rather than ``get``. Repeated header lines are equivalent to one
    comma-joined line, and ``Headers.get`` returns only the first occurrence, so
    a client sending its own ``X-Forwarded-For`` line ahead of the proxy's would
    have its own line read as the whole chain. Flattening every occurrence in
    order puts the proxy's observation last, where the rest of this module
    expects it.

    **Empty elements are kept, deliberately.** ``"10.8.0.2,"`` yields
    ``['10.8.0.2', '']`` and the last element is the empty string, which parses
    to nothing and is therefore refused. Dropping empties would make the last
    element ``10.8.0.2``, a value the client chose, and a proxy that had stopped
    appending would then admit whatever a visitor cared to send. The degenerate
    case has to fail closed, and keeping the empty element is what makes it.
    """
    elements: list[str] = []
    for value in request.headers.getlist(FORWARDED_FOR):
        elements.extend(part.strip() for part in value.split(","))
    return elements


def client_address(request) -> str:
    """The address this request came from, honoring one trusted proxy.

    Parameters
    ----------
    request : starlette.requests.Request

    Returns
    -------
    str
        The client address, or :data:`UNKNOWN` when none can be established.

    Notes
    -----
    Two cases, and the header's **presence** decides which applies, because the
    peer is loopback either way. With no ``X-Forwarded-For`` nothing proxied the
    request, so the peer *is* the client, which is the local-development and
    direct-curl case. With the header present the request came through Caddy and
    the last element is what Caddy observed: the module docstring says why it is
    the last and not the first.

    A present but unusable header does **not** fall back to the peer, which is
    why the branch turns on presence rather than on whether an address was
    recovered. Falling back would report ``127.0.0.1`` for a public visitor,
    which is the bug this function exists to fix, and in
    :func:`aggregate_api.routes.status.require_private` it would be the
    difference between refusing and admitting.
    """
    chain = forwarded_chain(request)
    if chain:
        address = as_ip(chain[-1])
        return str(address) if address is not None else UNKNOWN
    if request.client and request.client.host:
        address = as_ip(request.client.host)
        return str(address) if address is not None else request.client.host
    return UNKNOWN


def is_private_request(request, networks: Iterable[Network]) -> tuple[bool, str]:
    """Whether this request demonstrably came from a private origin.

    Parameters
    ----------
    request : starlette.requests.Request
    networks : iterable
        Networks from :func:`parse_cidrs`.

    Returns
    -------
    (bool, str)
        The verdict, and the address it was judged on, for the log line and the
        refusal buffer.

    Notes
    -----
    Deny by default: False unless an address was established *and* it falls
    inside the list. :data:`UNKNOWN` is in no network, so the two failure modes
    (no address, wrong address) converge on one refusal with no special case.
    """
    address = client_address(request)
    return is_private(address, networks), address
