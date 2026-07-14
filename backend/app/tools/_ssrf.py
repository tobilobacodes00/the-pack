"""SSRF-safe URL validation and fetch — shared by every server-side fetch of a caller-supplied URL.

`assert_public_url` validates a URL's resolved IPs against the private/loopback/reserved blocklist and
returns them. `safe_fetch` then:
  * re-validates on EVERY redirect hop, so a 302 to 169.254.169.254 can't sneak past the first check
    (the classic redirect bypass); and
  * PINS the connection to the IP it just validated — it dials that exact address while sending the
    original Host header and setting the TLS `sni_hostname` to the original host, so cert verification
    still checks the hostname. This closes the DNS-rebinding TOCTOU: httpx never gets to re-resolve
    the name to a private address between validation and connect.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

_REDIRECTS = (301, 302, 303, 307, 308)

# Carrier-grade NAT (RFC 6598) — Python's ipaddress stdlib does NOT classify 100.64.0.0/10 as
# private/reserved, but cloud providers squat their instance-metadata service in it. Alibaba Cloud's
# ECS metadata endpoint (100.100.100.200 — Pack's own deploy target) lives here; AWS/GCP's classic
# 169.254.169.254 is link-local and already caught below. Block the whole range explicitly.
_CGNAT = ipaddress.ip_network("100.64.0.0/10")


def _is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv4Address) and ip in _CGNAT)
    )


async def assert_public_url(url: str) -> list[str]:
    """Allow only http/https and reject any URL resolving to a private / loopback / reserved
    address (localhost, 10.x, 169.254.169.254 metadata, ::1). Returns the validated IPs."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("only http/https URLs are allowed")
    host = parsed.hostname
    if not host:
        raise ValueError("missing host")
    try:
        infos = await asyncio.get_event_loop().getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"could not resolve host: {exc}") from exc
    ips: list[str] = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if _is_blocked(ip):
            raise ValueError("URL resolves to a non-public address")
        ips.append(str(ip))
    if not ips:
        raise ValueError("host did not resolve to any address")
    return ips


async def _pinned_get(url: str, ip: str, headers: dict, timeout: float) -> httpx.Response:
    """GET `url` but dial the pre-validated `ip`, preserving Host + TLS server name for the original
    host. This is the pin that defeats DNS rebinding — the name is never re-resolved for the connect."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    host_header = host if parsed.port is None else f"{host}:{parsed.port}"
    ip_authority = f"[{ip}]" if ":" in ip else ip
    netloc = ip_authority if parsed.port is None else f"{ip_authority}:{parsed.port}"
    pinned_url = parsed._replace(netloc=netloc).geturl()

    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        request = httpx.Request(
            "GET",
            pinned_url,
            headers={**headers, "Host": host_header},
            # httpcore uses sni_hostname as the TLS server_hostname, so the cert is verified against
            # the real host even though we connected to the IP literal.
            extensions={"sni_hostname": host},
        )
        return await client.send(request)


async def safe_fetch(
    url: str,
    *,
    headers: dict | None = None,
    timeout: float = 20.0,
    max_redirects: int = 5,
) -> httpx.Response:
    """SSRF-safe HTTP GET: validates the resolved IPs on every redirect hop AND pins the connection
    to a validated IP, so neither a redirect nor a DNS rebind can reach an internal address."""
    current = url
    for _ in range(max_redirects + 1):
        ips = await assert_public_url(current)
        resp = await _pinned_get(current, ips[0], headers or {}, timeout)
        if resp.status_code in _REDIRECTS:
            location = resp.headers.get("location", "")
            if not location:
                break
            current = urljoin(current, location)
            continue
        resp.raise_for_status()
        return resp
    raise ValueError(f"too many redirects fetching {url}")
