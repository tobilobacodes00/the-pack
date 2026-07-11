"""The SSRF guard. IP literals resolve without DNS, so these stay hermetic."""

from __future__ import annotations

import httpx
import pytest

from app.tools._ssrf import assert_public_url, safe_fetch
from app.tools.providers.base import _get_text


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/admin",
        "http://10.0.0.1/",
        "http://192.168.1.1/",
        "http://169.254.169.254/latest/meta-data/",  # cloud metadata
        "ftp://example.com/file",  # non-http scheme
        "file:///etc/passwd",
        "http://[::1]/",  # IPv6 loopback
    ],
)
async def test_rejects_unsafe_urls(url):
    with pytest.raises(ValueError):
        await assert_public_url(url)


async def test_allows_public_ip_and_returns_it():
    ips = await assert_public_url("http://8.8.8.8/")  # public — no raise
    assert ips == ["8.8.8.8"]


def _patch_client(monkeypatch, module, transport: httpx.MockTransport) -> None:
    """Make every httpx.AsyncClient in `module` use the mock transport (restored after the test)."""
    orig = httpx.AsyncClient

    def _client(*args, **kwargs):
        kwargs["transport"] = transport
        return orig(*args, **kwargs)

    monkeypatch.setattr(module.httpx, "AsyncClient", _client)


async def test_safe_fetch_revalidates_redirect_to_internal(monkeypatch):
    """A 302 pointing at cloud metadata must be refused on the next hop, not followed."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        if request.url.host == "8.8.8.8":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"})
        return httpx.Response(200, text="SECRET")  # internal target — must never be reached

    import app.tools._ssrf as ssrf

    _patch_client(monkeypatch, ssrf, httpx.MockTransport(handler))
    with pytest.raises(ValueError):
        await safe_fetch("http://8.8.8.8/")
    assert "169.254.169.254" not in seen  # re-validated and refused before the second fetch


async def test_safe_fetch_pins_to_the_validated_ip(monkeypatch):
    """The request must dial the IP that assert_public_url validated (defeating a rebind), while
    keeping the original Host header and TLS server name for cert verification."""
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["dialed_host"] = request.url.host
        seen["host_header"] = request.headers.get("host")
        seen["sni"] = request.extensions.get("sni_hostname")
        return httpx.Response(200, text="ok")

    import app.tools._ssrf as ssrf

    # Validation resolves the name to a specific public IP (no real DNS in the test).
    async def _fake_validate(url: str):
        return ["93.184.216.34"]

    monkeypatch.setattr(ssrf, "assert_public_url", _fake_validate)
    _patch_client(monkeypatch, ssrf, httpx.MockTransport(handler))

    resp = await safe_fetch("https://example.com/path")
    assert resp.status_code == 200
    assert seen["dialed_host"] == "93.184.216.34"  # connected to the validated IP, not the name
    assert seen["host_header"] == "example.com"  # Host preserved for routing
    assert seen["sni"] == "example.com"  # TLS still verifies against the real hostname


async def test_get_text_does_not_follow_redirects(monkeypatch):
    """A reader hitting a vendor host that 302s must not chase the redirect (blind-SSRF hop)."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        if request.url.host == "169.254.169.254":
            return httpx.Response(200, text="SECRET")
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})

    import app.tools.providers.base as base

    _patch_client(monkeypatch, base, httpx.MockTransport(handler))
    result = await _get_text("https://r.jina.ai/https://example.com")
    assert "169.254.169.254" not in seen  # never followed
    assert result != "SECRET"
