"""Shared building blocks for the multi-source research providers.

A *sub-provider* turns a query into a list of `SearchHit`s for one upstream API (Tavily, Exa,
NewsAPI, OpenAlex, …). A *reader* turns a URL into readable text (Jina, Firecrawl, …). The
`MultiProvider` in `search_provider.py` fans a query out to every enabled sub-provider and walks
the reader chain for deep reads.

Every network call goes through `_get_json` / `_post_json` / `_get_text`, which swallow ALL errors
(timeouts, non-2xx, bad JSON) and return `None`. That isolation is the whole point: with ~16
upstreams on free tiers, one slow or rate-limited API must never sink the others.
"""

from __future__ import annotations

import html as _html
import re as _re
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urlsplit, urlunsplit

import httpx

DEFAULT_TIMEOUT = 8.0

# Browser-ish UAs — some free endpoints (DuckDuckGo, plain page reads) refuse a default client UA.
# A pool so parallel scouts don't all present the SAME client to DuckDuckGo (which reads a burst of
# identical requests as one bot and throttles); each request rotates. See random_ua().
BROWSER_UAS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
)
BROWSER_UA = BROWSER_UAS[0]


def random_ua() -> str:
    """A randomly chosen browser UA — rotate per request so parallel scouts look like distinct
    clients to rate-limiters (they still share an IP, but this avoids the identical-burst signal)."""
    import random

    return random.choice(BROWSER_UAS)


_BLOCK_TAGS = _re.compile(r"(?is)<(script|style|noscript|head|svg)[^>]*>.*?</\1>")
_ANY_TAG = _re.compile(r"(?s)<[^>]+>")


def _strip_html(raw: str) -> str:
    """Crude HTML → readable text: drop scripts/styles, strip tags, unescape, collapse whitespace.
    Good enough to feed a model; not a full renderer."""
    without_blocks = _BLOCK_TAGS.sub(" ", raw or "")
    text = _ANY_TAG.sub(" ", without_blocks)
    return _html.unescape(_re.sub(r"\s+", " ", text)).strip()


# Tracking/junk query params that never change page identity — dropped before dedup so the same
# article shared with different UTM tags collapses to one source.
_TRACKING_PARAMS = frozenset(
    {
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
        "mc_eid",
        "mc_cid",
        "igshid",
        "ref",
        "ref_src",
        "spm",
    }
)
# Small, high-confidence junk-domain blocklist (link shorteners). Kept tiny on purpose — an
# over-aggressive blocklist is worse than the disease. Extend via settings.search_blocked_hosts_extra.
_BLOCKED_HOSTS = frozenset({"t.co", "bit.ly", "buff.ly", "ow.ly", "tinyurl.com", "goo.gl"})


def host_key(url: str) -> str:
    """The lowercased host minus a leading www. — a cheap domain key for dedup-diversity and the
    blocklist. Treats a.example.com / b.example.com as DISTINCT (no eTLD+1 / PSL dependency)."""
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return ""
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def canonical_url(url: str) -> str:
    """A deterministic dedup KEY for a URL (never for display — the original url is kept for the
    reader chain). Collapses http/https, www./m./amp./mobile. host prefixes, trailing slash + /amp,
    and tracking params (survivors re-sorted so param order can't defeat dedup); drops #fragments but
    keeps #! hashbangs. Non-http(s) schemes (e.g. lib://) are returned UNCHANGED. Fail-open: any parse
    error returns the input untouched — never lose a source to a canonicalizer bug."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        return url  # lib://, mailto:, data:, … — leave identity intact
    host = (parts.hostname or "").lower()
    for prefix in ("www.", "m.", "amp.", "mobile."):
        if host.startswith(prefix):
            host = host[len(prefix) :]
            break
    if parts.port:
        host = f"{host}:{parts.port}"
    path = _re.sub(r"//+", "/", parts.path)
    path = _re.sub(r"(?:/amp|\.amp)$", "", path)
    if len(path) > 1:
        path = path.rstrip("/")
    kept = sorted(
        f"{k}={v}"
        for k, v in (
            pair.split("=", 1) if "=" in pair else (pair, "")
            for pair in parts.query.split("&")
            if pair
        )
        if k.lower() not in _TRACKING_PARAMS
    )
    fragment = parts.fragment if parts.fragment.startswith("!") else ""
    return urlunsplit(("https", host, path, "&".join(kept), fragment))


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str
    score: float = 0.0
    provider: str = ""  # which upstream brought it back (provenance / source diversity)

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "score": self.score,
            "provider": self.provider,
        }


@dataclass
class SearchResults:
    query: str
    hits: list[SearchHit] = field(default_factory=list)
    latency_ms: int = 0

    def as_dict(self) -> dict:
        return {"query": self.query, "hits": [h.as_dict() for h in self.hits]}


class SubProvider(Protocol):
    name: str

    async def search(self, query: str, *, max_results: int) -> list[SearchHit]: ...


class Reader(Protocol):
    name: str

    async def read(self, url: str) -> str | None: ...


async def _get_json(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any | None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception:  # noqa: BLE001 — one dead upstream must never sink the search
        return None


async def _post_json(
    url: str,
    *,
    json: dict | None = None,
    headers: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> Any | None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=json, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except Exception:  # noqa: BLE001
        return None


async def _get_text(url: str, *, headers: dict | None = None, timeout: float = 12.0) -> str | None:
    # follow_redirects stays FALSE: an upstream that 30x-redirects to an internal address would be a
    # blind SSRF hop. Readers here target fixed vendor hosts, so a redirect means the read failed —
    # fall through to the next reader rather than chase it.
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.text
    except Exception:  # noqa: BLE001
        return None


def _clip(text: str, limit: int = 400) -> str:
    text = " ".join((text or "").split())
    return text[:limit]
