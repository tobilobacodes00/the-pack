"""Deep-read readers — turn a URL into readable text. Tried in order by the MultiProvider until
one returns content. Each returns None on any failure so the chain falls through.

Keyless only, by design (see search_provider.py) — no paid reader vendor."""

from __future__ import annotations

import httpx

from app.tools._ssrf import safe_fetch
from app.tools.providers.base import _strip_html, random_ua


class JinaReader:
    """Deep-read via Jina Reader (r.jina.ai): renders JS and returns clean text — far more reliable
    than raw HTML scraping. Keyless free tier (rate-limited ~20 RPM). This is the workhorse
    deep-reader; DirectReader is the keyless fallback when it can't read a page."""

    name = "jina"
    _BASE = "https://r.jina.ai/"

    async def read(self, url: str) -> str | None:
        headers = {"Accept": "text/plain", "User-Agent": random_ua()}
        try:
            async with httpx.AsyncClient(
                timeout=25.0, follow_redirects=True, headers=headers
            ) as client:
                resp = await client.get(f"{self._BASE}{url}")
                resp.raise_for_status()
                text = resp.text
        except Exception:  # noqa: BLE001 — unreadable; fall through to the next reader
            return None
        return text.strip() or None


class DirectReader:
    """Keyless deep-read — fetch the page yourself (SSRF-safe) and strip it to text. The fallback
    when Jina can't read a page. Tried last."""

    name = "direct"

    async def read(self, url: str) -> str | None:
        try:
            # safe_fetch validates + IP-pins (these URLs come from search results, i.e. untrusted).
            resp = await safe_fetch(url, headers={"User-Agent": random_ua()}, timeout=12.0)
        except Exception:  # noqa: BLE001 — unreadable page; fall through
            return None
        text = _strip_html(resp.text)
        return text or None
