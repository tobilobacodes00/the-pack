"""The research retrieval layer behind the Scout's web_search/web_fetch.

A `SearchProvider` turns a query into ranked hits and a url into readable text. Two shapes ship:

* `CannedProvider` — DETERMINISTIC synthetic hits, no network, so the offline hunt stays
  reproducible with no keys (and tests stay hermetic).
* `MultiProvider` — fans every query out to ALL configured upstreams (web search, news, academic,
  community, knowledge graph — see `app/tools/providers/`), merges + dedupes the hits, and walks a
  reader chain (Jina → Firecrawl → Tavily → Apify) for deep page reads. Each upstream is failure-
  isolated: a timeout or rate-limit on one returns nothing and the rest still answer.

`make_search_provider()` builds the MultiProvider from whichever keys are present; if NO real key is
configured it returns Canned, so the engine still runs end to end offline (Doc 04 §07).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Protocol

from app.config import settings
from app.tools.cache import TTLCache
from app.tools.content_guard import is_fetchable_url, scan_content
from app.tools.providers.academic import CoreSearch, OpenAlexSearch
from app.tools.providers.base import (
    _BLOCKED_HOSTS,
    Reader,
    SearchHit,
    SearchResults,
    SubProvider,
    canonical_url,
    host_key,
)
from app.tools.providers.community import GitHubSearch, HackerNewsSearch
from app.tools.providers.duckduckgo import DuckDuckGoSearch
from app.tools.providers.kg import DBpediaSearch, GoogleKgSearch, WikidataSearch
from app.tools.providers.news import GNewsSearch, NewsApiSearch, NewsDataSearch
from app.tools.providers.readers import (
    ApifyReader,
    DirectReader,
    FirecrawlReader,
    JinaReader,
    TavilyExtractReader,
)
from app.tools.providers.web import ExaSearch, SerpApiSearch, TavilySearch, YouSearch

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


# Fan-out timing — defaults mirror config, but read from `settings` at call time so a .env override
# (or a test monkeypatch of these module globals) takes effect. BUDGET is the hard ceiling; SOFT is
# the early return once we have ground, so a hung upstream can't make every search wait it out —
# which, under parallel scouts, pileup-throttles most of them to zero hits.
_SEARCH_BUDGET_S = settings.search_budget_s
_SEARCH_SOFT_S = settings.search_soft_s

# Cross-provider ranking: raw `score` is incommensurate (Tavily/Exa emit 0-1 relevance, DDG emits
# rank-position, GitHub emits star COUNT, Serp/You emit 0.0). We never compare raw scores across
# providers — we blend a within-provider RANK component with a relevance component that is trusted
# ONLY from providers that emit real 0-1 relevance. Providers absent from _REAL_SCORE degrade to pure
# rank (so their best hit floats instead of always sinking on a 0.0 score).
_REAL_SCORE = frozenset({"tavily", "exa", "canned"})
_RANK_W = 0.6
_REL_W = 0.4
_DIVERSITY_PENALTY = 0.85  # a 2nd+ hit from the same host is nudged down (never dropped)

# Cap concurrent calls to the SAME upstream across parallel scouts — light rate-limit politeness.
_PROVIDER_SEM: dict[str, asyncio.Semaphore] = {}


def _sem(name: str) -> asyncio.Semaphore:
    # Cap concurrent calls to the SAME upstream. Sized so a full pack (3-5 scouts, each searching +
    # broadening) doesn't serialize on one fast provider — that pileup, not the providers, is what
    # left most scouts with zero hits while one got them all. Tunable via settings.
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
                        continue  # junk-domain blocklist (link shorteners) — exact host match
                    # Position within THIS provider's own list (its own relevance order), captured
                    # per-hit so a shared sub name / non-deterministic task order can't confuse it.
                    rank[id(h)] = 1.0 - idx / max(1, n)
                    key = canonical_url(h.url)
                    cur = best.get(key)
                    # Keep the higher RAW score on a cross-provider collision (unchanged survivor rule
                    # — blending decides ORDER, never which duplicate wins).
                    if cur is None or h.score > cur.score:
                        best[key] = h

        # Phase 1 — gather whatever returns within the soft window (never longer than the hard budget,
        # so a patched/tiny budget still bounds the whole fan-out). The soft window is sized in config
        # to clear the enabled providers' measured latency (DuckDuckGo answers well inside it), so a
        # first attempt gets its real ground HERE — that sizing, not a Phase-2 change, is what fixed
        # the "dead ends" timeout. Once we hold ANY ground we return promptly and never block on a
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
        emit real relevance, else it degrades to the rank component (so 0.0-score providers don't
        always sink). Then a soft, gated domain-diversity nudge. Neither ever DROPS a hit."""

        def blended(h: SearchHit) -> float:
            rc = rank.get(id(h), 0.0)
            rel = max(0.0, min(1.0, h.score)) if h.provider in _REAL_SCORE else rc
            return _RANK_W * rc + _REL_W * rel

        ordered = sorted(hits, key=blended, reverse=True)
        # Soft domain diversity: nudge the 2nd+ hit from the same host down (never drop). Gated so it
        # can't bury a legitimately single-source narrow topic.
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
        # Fail-closed pre-fetch gate: screen the URL BEFORE any reader (including the paid ones that
        # fetch server-side) touches it — an internal/metadata/non-http URL is denied here rather than
        # relying on each reader's own ad-hoc protection (only DirectReader had one).
        if not is_fetchable_url(url):
            logging.getLogger("pack").warning("content guard blocked unsafe fetch URL: %s", url)
            return ""
        # Priority chain (Jina → Firecrawl → Tavily → Apify): first reader to return text wins. Each
        # reader carries its own timeout, so the chain is bounded even if an early one is slow.
        for reader in self._readers:
            text = await reader.read(url)
            if text:
                # Screen scraped third-party text for prompt-injection before it's cached and fed into
                # a single-turn wolf's prompt — a hostile page can't slip "ignore your instructions"
                # into the reasoning turn. Masks offending spans; real content is untouched.
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
    """Assemble the enabled upstreams from config. Real web search is FREE by default now: DuckDuckGo
    and the keyless providers always run, and the keyless DirectReader deep-reads pages — no paid key
    required. Paid providers/readers join when their key is present. Only a pure offline demo (no
    model key → FakeQwen brain) falls back to Canned so the no-key run stays deterministic.
    """
    s = settings
    if not s.qwen_api_key:  # offline/demo: FakeQwen brain + deterministic Canned search
        return CannedProvider()

    # Every upstream we CAN build (keyless ones always constructible; keyed ones only when their key
    # is present). This is the full menu — `search_providers_enabled` decides which actually run.
    candidates: list[SubProvider] = [DuckDuckGoSearch(), OpenAlexSearch(s.openalex_mailto)]
    candidates.append(HackerNewsSearch())
    candidates.append(WikidataSearch())
    candidates.append(DBpediaSearch())
    if s.search_api_key:
        candidates.append(TavilySearch(s.search_api_key))
    if s.exa_api_key:
        candidates.append(ExaSearch(s.exa_api_key))
    if s.serpapi_api_key:
        candidates.append(SerpApiSearch(s.serpapi_api_key))
    if s.youcom_api_key:
        candidates.append(YouSearch(s.youcom_api_key))
    if s.newsapi_key:
        candidates.append(NewsApiSearch(s.newsapi_key))
    if s.gnews_api_key:
        candidates.append(GNewsSearch(s.gnews_api_key))
    if s.newsdata_api_key:
        candidates.append(NewsDataSearch(s.newsdata_api_key))
    if s.core_api_key:
        candidates.append(CoreSearch(s.core_api_key))
    if s.github_token:
        candidates.append(GitHubSearch(s.github_token))
    if s.google_kg_api_key:
        candidates.append(GoogleKgSearch(s.google_kg_api_key))

    # Allow-list filter: keep only the enabled providers, in the order they're named. An empty setting
    # means "run everything constructible" (the legacy fan-out). Default is DuckDuckGo only — the one
    # engine the live audit proved reliable and fast; the rest 403'd, moved, or timed out to 0 hits.
    enabled = [n.strip().lower() for n in s.search_providers_enabled.split(",") if n.strip()]
    if enabled:
        by_name = {c.name.lower(): c for c in candidates}
        subs: list[SubProvider] = [by_name[n] for n in enabled if n in by_name]
        if not subs:  # misconfigured to nothing real → fall back to DuckDuckGo so the pack can hunt
            subs = [DuckDuckGoSearch()]
    else:
        subs = candidates

    # Deep-read chain (first to return text wins). Jina Reader leads — it renders JS + clean-extracts
    # and its free tier works KEYLESS, so most pages read for free; a key just lifts its rate limit.
    # Paid readers are extra fallbacks; DirectReader (raw fetch) is the last resort.
    readers: list[Reader] = [JinaReader(s.jina_api_key)]  # "" ⇒ keyless free tier
    if s.firecrawl_api_key:
        readers.append(FirecrawlReader(s.firecrawl_api_key))
    if s.search_api_key:
        readers.append(TavilyExtractReader(s.search_api_key))
    if s.apify_api_key:
        readers.append(ApifyReader(s.apify_api_key))
    readers.append(DirectReader())

    return MultiProvider(subs, readers)


# Process-wide default (mirrors how pricing.py reads settings at import). Tests force Canned.
SEARCH_PROVIDER: SearchProvider = make_search_provider()
