"""Deep-read readers — turn a URL into readable text. Tried in order by the MultiProvider until
one returns content. Each returns None on any failure so the chain falls through."""

from __future__ import annotations

import httpx

from app.tools._ssrf import safe_fetch
from app.tools.providers.base import _post_json, _strip_html, random_ua


class JinaReader:
    """Deep-read via Jina Reader (r.jina.ai): renders JS and returns clean text — far more reliable
    than raw HTML scraping. Works KEYLESS on the free tier (rate-limited ~20 RPM); a key raises the
    limit. This is the workhorse free deep-reader."""

    name = "jina"
    _BASE = "https://r.jina.ai/"

    def __init__(self, api_key: str = "") -> None:
        self._key = api_key

    async def read(self, url: str) -> str | None:
        headers = {"Accept": "text/plain", "User-Agent": random_ua()}
        if self._key:  # a key lifts the free-tier rate limit
            headers["Authorization"] = f"Bearer {self._key}"
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


class FirecrawlReader:
    name = "firecrawl"
    _URL = "https://api.firecrawl.dev/v1/scrape"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    async def read(self, url: str) -> str | None:
        data = await _post_json(
            self._URL,
            headers={"Authorization": f"Bearer {self._key}"},
            json={"url": url, "formats": ["markdown"]},
            timeout=20.0,
        )
        if not isinstance(data, dict):
            return None
        md = (data.get("data") or {}).get("markdown") or ""
        return md.strip() or None


class TavilyExtractReader:
    name = "tavily-extract"
    _URL = "https://api.tavily.com/extract"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    async def read(self, url: str) -> str | None:
        data = await _post_json(self._URL, json={"api_key": self._key, "urls": [url]}, timeout=20.0)
        if not isinstance(data, dict):
            return None
        results = data.get("results", [])
        if not results:
            return None
        return str(results[0].get("raw_content", "")).strip() or None


class DirectReader:
    """Keyless deep-read — fetch the page yourself (SSRF-safe) and strip it to text. The free
    fallback so pages still get read with zero paid readers. Tried LAST, so a paid reader (Jina/
    Firecrawl/Tavily) wins when configured; this catches everything else."""

    name = "direct"

    async def read(self, url: str) -> str | None:
        try:
            # safe_fetch validates + IP-pins (these URLs come from search results, i.e. untrusted).
            resp = await safe_fetch(url, headers={"User-Agent": random_ua()}, timeout=12.0)
        except Exception:  # noqa: BLE001 — unreadable page; fall through
            return None
        text = _strip_html(resp.text)
        return text or None


class ApifyReader:
    """Best-effort — Apify actor runs are slow; usually times out and the chain moves on. Last."""

    name = "apify"
    _URL = "https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items"

    def __init__(self, api_key: str) -> None:
        self._key = api_key

    async def read(self, url: str) -> str | None:
        data = await _post_json(
            f"{self._URL}?token={self._key}",
            json={"startUrls": [{"url": url}], "maxCrawlPages": 1},
            timeout=25.0,
        )
        if not isinstance(data, list) or not data:
            return None
        return str((data[0] or {}).get("text", "")).strip() or None
