"""The research retrieval layer behind the Scout's web_search/web_fetch.

A `SearchProvider` turns a query into ranked hits and a url into readable text. Two shapes ship:

* `CannedProvider` — DETERMINISTIC synthetic hits, no network, so the offline hunt stays
  reproducible with no keys (and tests stay hermetic).
* `MultiProvider` — DuckDuckGo only (free, keyless, the one engine proven reliable), deep-reading
  via a keyless reader chain (Jina free tier → DirectReader raw fetch).

`make_search_provider()` builds the MultiProvider when a model key is configured; if NO real key is
configured it returns Canned, so the engine still runs end to end offline. There is deliberately no
other search vendor wired in — DuckDuckGo + keyless readers is the whole research retrieval layer.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Protocol

from app.config import settings
from app.tools.cache import TTLCache
from app.tools.content_guard import is_fetchable_url, scan_content
from app.tools.providers.base import (
    _BLOCKED_HOSTS,
    Reader,
    SearchHit,
    SearchResults,
    SubProvider,
    canonical_url,
    host_key,
)
from app.tools.providers.duckduckgo import DuckDuckGoSearch
from app.tools.providers.readers import DirectReader, JinaReader

__all__ = [
    "SearchHit",
    "SearchResults",
    "SearchProvider",
    "CannedProvider",
    "MultiProvider",
    "make_search_provider",
]


class SearchProvider(Protocol):
    name: str

    async def search(self, query: str, *, max_results: int = 5) -> SearchResults: ...

    async def fetch(self, url: str) -> str: ...


def _slug(text: str, limit: int = 48) -> str:
    out = "".join(c if c.isalnum() else "-" for c in text.lower())
    return out.strip("-")[:limit] or "q"


class CannedProvider:
    """Deterministic offline provider — same query in, same hits out, no network, no clock."""

    name = "canned"

    async def search(self, query: str, *, max_results: int = 5) -> SearchResults:
        slug = _slug(query)
        hits = [
            SearchHit(
                title=f"{query} — source {i + 1}",
                url=f"https://example.com/{slug}/{i + 1}",
                snippet=f"A relevant passage about {query} (source {i + 1}).",
                score=round(1.0 - i * 0.1, 2),
                provider="canned",
            )
            for i in range(min(3, max(1, max_results)))
        ]
        return SearchResults(query=query, hits=hits, latency_ms=2100)

    async def fetch(self, url: str) -> str:
        return f"[offline] readable text extracted from {url}."


# Read from `settings` at call time so a .env override / test monkeypatch takes effect. BUDGET is the
# hard ceiling; SOFT is the early return once we have ground, so a hung upstream can't pileup-throttle
# every parallel scout to zero hits.
_SEARCH_BUDGET_S = settings.search_budget_s
_SEARCH_SOFT_S = settings.search_soft_s

# Raw `score` is provider-specific and not comparable across sources — DuckDuckGo emits rank-position
# only, no real 0-1 relevance, so it degrades to pure rank below. `canned` is the one source that does
# emit trustworthy 0-1 relevance.
_REAL_SCORE = frozenset({"canned"})
_RANK_W = 0.6
_REL_W = 0.4
_DIVERSITY_PENALTY = 0.85  # a 2nd+ hit from the same host is nudged down (never dropped)

# Cap concurrent calls to the SAME upstream across parallel scouts — light rate-limit politeness.
_PROVIDER_SEM: dict[str, asyncio.Semaphore] = {}


def _sem(name: str) -> asyncio.Semaphore:
    # Sized so a full pack (3-5 scouts) doesn't serialize on one fast provider — that pileup, not the
    # providers, is what left most scouts with zero hits while one got them all.
    return _PROVIDER_SEM.setdefault(name, asyncio.Semaphore(settings.search_provider_concurrency))


class MultiProvider:
    """Fan a query out to every upstream; merge, dedupe, rank. Deep-read via the reader chain."""

    name = "multi"

    def __init__(self, subs: list[SubProvider], readers: list[Reader]) -> None:
        self._subs = subs
        self._readers = readers
        # Per-instance so the singleton caches across scouts + hunts in-process, while tests that
        # build their own MultiProvider stay isolated. Single-flight collapses concurrent dups.
        self._search_cache: TTLCache[list[SearchHit]] = TTLCache(settings.search_cache_ttl_s)
        self._fetch_cache: TTLCache[str] = TTLCache(settings.search_cache_ttl_s)

    async def _guarded(self, sub: SubProvider, query: str, per: int) -> list[SearchHit]:
        async with _sem(sub.name):
            return await sub.search(query, max_results=per)

    async def _fan_out(self, query: str, max_results: int) -> list[SearchHit]:
        per = max(3, max_results // 2)
        tasks = [asyncio.create_task(self._guarded(s, query, per)) for s in self._subs]
        best: dict[str, SearchHit] = {}  # canonical url -> highest RAW-score hit (survivor rule)
        rank: dict[int, float] = {}  # id(hit) -> within-provider rank component (0..1)

        def collect(finished: set) -> None:
            for t in finished:
                try:
                    r = t.result()
                except Exception:  # noqa: BLE001 — an upstream errored; already isolated, skip it
                    continue
                n = len(r)
                for idx, h in enumerate(r):
                    if not h.url or host_key(h.url) in _BLOCKED_HOSTS:
                        continue  # junk-domain blocklist (link shorteners), exact host match
                    # Position within THIS provider's own list, captured per-hit so a shared sub name
                    # / non-deterministic task order can't confuse it.
                    rank[id(h)] = 1.0 - idx / max(1, n)
                    key = canonical_url(h.url)
                    cur = best.get(key)
                    # Keep the higher RAW score on a cross-provider collision — blending decides
                    # ORDER, never which duplicate wins.
                    if cur is None or h.score > cur.score:
                        best[key] = h

        # Phase 1 — gather whatever returns within the soft window (never longer than the hard budget).
        # The soft window is sized to clear the enabled providers' measured latency, so a first attempt
        # gets its real ground HERE. Once we hold ANY ground we return promptly and never block on a
        # hung upstream (the pileup that used to starve parallel scouts to zero).
        soft = min(_SEARCH_SOFT_S, _SEARCH_BUDGET_S)
        done, pending = await asyncio.wait(set(tasks), timeout=soft)
        collect(done)
        # Phase 2 — only if we still have nothing, wait out the stragglers to the hard ceiling.
        if not best and pending:
            done, pending = await asyncio.wait(pending, timeout=_SEARCH_BUDGET_S - soft)
            collect(done)
        for t in pending:
            t.cancel()
        return self._rank(list(best.values()), rank, max_results)

    def _rank(
        self, hits: list[SearchHit], rank: dict[int, float], max_results: int
    ) -> list[SearchHit]:
        """Order hits by a coherent blended score (never the raw cross-provider score). rank_component
        = within-provider position; relevance_component = the raw 0-1 score ONLY from providers that
        emit real relevance, else it degrades to the rank component. Then a soft, gated domain-
        diversity nudge. Neither ever DROPS a hit."""

        def blended(h: SearchHit) -> float:
            rc = rank.get(id(h), 0.0)
            rel = max(0.0, min(1.0, h.score)) if h.provider in _REAL_SCORE else rc
            return _RANK_W * rc + _REL_W * rel

        ordered = sorted(hits, key=blended, reverse=True)
        # Nudge the 2nd+ hit from the same host down (never drop) — gated so it can't bury a
        # legitimately single-source narrow topic.
        if settings.search_domain_diversity and len({host_key(h.url) for h in ordered}) >= 3:
            seen: dict[str, int] = {}
            scored = []
            for h in ordered:
                hk = host_key(h.url)
                seen[hk] = seen.get(hk, 0) + 1
                penalty = _DIVERSITY_PENALTY ** (seen[hk] - 1)
                scored.append((blended(h) * penalty, h))
            scored.sort(key=lambda t: t[0], reverse=True)
            ordered = [h for _s, h in scored]
        return ordered[:max_results]

    async def search(self, query: str, *, max_results: int = 8) -> SearchResults:
        start = time.monotonic()
        key = f"{max_results}:{query.strip().lower()}"
        hits = await self._search_cache.get_or_compute(
            key, lambda: self._fan_out(query, max_results)
        )
        return SearchResults(
            query=query, hits=hits, latency_ms=int((time.monotonic() - start) * 1000)
        )

    async def _read_chain(self, url: str) -> str:
        # Fail-closed: screen the URL BEFORE any reader (incl. paid ones that fetch server-side)
        # touches it, rather than relying on each reader's own ad-hoc protection.
        if not is_fetchable_url(url):
            logging.getLogger("pack").warning("content guard blocked unsafe fetch URL: %s", url)
            return ""
        # First reader to return text wins; each carries its own timeout so the chain stays bounded.
        for reader in self._readers:
            text = await reader.read(url)
            if text:
                # Screen for prompt-injection before it's cached and fed into a single-turn wolf's
                # prompt — a hostile page can't slip "ignore your instructions" into the reasoning turn.
                result = scan_content(text)
                if result.hits:
                    logging.getLogger("pack").warning(
                        "content guard masked %d possible prompt-injection span(s) in %s",
                        result.hits,
                        url,
                    )
                return result.text
        return ""

    async def fetch(self, url: str) -> str:
        return await self._fetch_cache.get_or_compute(url, lambda: self._read_chain(url))


def make_search_provider() -> SearchProvider:
    """DuckDuckGo (free, keyless) is the only search upstream — no other vendor is wired in. Deep
    reads go through the keyless reader chain: Jina's free tier first, DirectReader as the fallback.
    Only a pure offline demo (no model key) falls back to Canned so the no-key run stays deterministic.
    """
    if not settings.qwen_api_key:  # offline/demo: FakeQwen brain + deterministic Canned search
        return CannedProvider()

    subs: list[SubProvider] = [DuckDuckGoSearch()]
    readers: list[Reader] = [JinaReader(), DirectReader()]
    return MultiProvider(subs, readers)


# Process-wide default (mirrors how pricing.py reads settings at import). Tests force Canned.
SEARCH_PROVIDER: SearchProvider = make_search_provider()
