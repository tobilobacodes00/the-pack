"""Keyless general web search — DuckDuckGo's HTML endpoint.

Free, no API key: the fallback that lets the pack do real web research without paying for Tavily/Exa.
It scrapes the `html.duckduckgo.com/html/` results page (title + link + snippet). Best-effort like
every sub-provider — any error (rate-limit, layout change, block) returns [] and the rest still answer.
Note: heavy automated use from a single IP can get throttled; pair it with the keyless DirectReader
for deep reads, and add a paid provider later if you outgrow it.
"""

from __future__ import annotations

import asyncio
import random
import re
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.tools.providers.base import SearchHit, _clip, _strip_html, random_ua

# Result anchors and snippets on the DDG HTML page, in document order (one snippet per result).
_ANCHOR_RE = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_SNIPPET_RE = re.compile(r'class="result__snippet"[^>]*>(.*?)</a>', re.S)


def _real_url(href: str) -> str:
    """DDG wraps external links as //duckduckgo.com/l/?uddg=<encoded>; decode to the true URL."""
    if "uddg=" in href:
        parsed = urlparse(href if href.startswith("http") else "https:" + href)
        vals = parse_qs(parsed.query).get("uddg")
        if vals:
            return unquote(vals[0])
    return href


class DuckDuckGoSearch:
    name = "duckduckgo"
    _URL = "https://html.duckduckgo.com/html/"

    async def search(self, query: str, *, max_results: int) -> list[SearchHit]:
        # DuckDuckGo is now the pack's ONLY web engine, so a 5-scout pack all posting at once is
        # exactly the synchronized burst that trips DDG's per-IP throttle (it returns an empty/blocked
        # page, which surfaced as scouts "hitting dead ends"). Defend on three axes so scouts never
        # rate-limit each other:
        #   1. rotated User-Agent per call — each scout looks like a different client;
        #   2. a wide random pre-jitter — spreads a simultaneous pack across ~2.5s so the requests
        #      arrive staggered, not as one identical wall of traffic;
        #   3. one bounded retry with a longer backoff if the first attempt comes back empty (a
        #      transient throttle usually clears on the second, offset try).
        await asyncio.sleep(random.uniform(0.0, 2.5))
        body = ""
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(
                    timeout=9.0, follow_redirects=True, headers={"User-Agent": random_ua()}
                ) as client:
                    resp = await client.post(self._URL, data={"q": query, "kl": "us-en"})
                    resp.raise_for_status()
                    body = resp.text
                if _ANCHOR_RE.search(body):
                    break  # got real results — stop
                body = ""  # empty/blocked page: fall through to the backoff retry
            except Exception:  # noqa: BLE001 — one dead upstream must never sink the search
                body = ""
            if attempt == 0:
                await asyncio.sleep(random.uniform(1.0, 2.5))  # backoff before the one retry
        if not body:
            return []
        anchors = _ANCHOR_RE.findall(body)
        snippets = _SNIPPET_RE.findall(body)
        out: list[SearchHit] = []
        for i, (href, title) in enumerate(anchors[:max_results]):
            url = _real_url(href)
            if not url.startswith("http"):
                continue
            snippet = _strip_html(snippets[i]) if i < len(snippets) else ""
            out.append(
                SearchHit(
                    title=_strip_html(title),
                    url=url,
                    snippet=_clip(snippet),
                    score=round(1.0 - i * 0.03, 3),  # rank-order score, top hit highest
                    provider=self.name,
                )
            )
        return out
