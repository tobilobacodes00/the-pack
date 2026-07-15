"""Hermetic tests for the research retrieval layer — no network. DuckDuckGo is the only search
upstream (see search_provider.py); these test the MultiProvider merge/dedupe/rank/budget mechanics
directly against fakes, plus the offline fallback."""

from __future__ import annotations

from app.tools.providers.base import SearchHit
from app.tools.search_provider import CannedProvider, MultiProvider, make_search_provider


class _FakeSub:
    name = "fake"

    def __init__(self, hits):
        self._hits = hits

    async def search(self, query, *, max_results):
        return self._hits


async def test_multiprovider_merges_dedupes_and_ranks():
    a = SearchHit("A", "https://x.com", "s", score=0.5, provider="p1")
    a_dup = SearchHit(
        "A2", "https://x.com", "s", score=0.9, provider="p2"
    )  # same url, higher score
    b = SearchHit("B", "https://y.com", "s", score=0.7, provider="p1")
    mp = MultiProvider([_FakeSub([a, b]), _FakeSub([a_dup])], readers=[])
    res = await mp.search("q", max_results=8)
    urls = [h.url for h in res.hits]
    assert urls == ["https://x.com", "https://y.com"]  # deduped, ranked by score
    assert res.hits[0].score == 0.9  # kept the higher-scored duplicate


async def test_multiprovider_isolates_a_failing_sub():
    class _Boom:
        name = "boom"

        async def search(self, query, *, max_results):
            raise RuntimeError("down")

    ok = SearchHit("A", "https://x.com", "s", score=0.5)
    mp = MultiProvider([_Boom(), _FakeSub([ok])], readers=[])
    res = await mp.search("q", max_results=8)
    assert [h.url for h in res.hits] == ["https://x.com"]  # the crash didn't sink the search


async def test_multiprovider_returns_within_budget(monkeypatch):
    import asyncio

    import app.tools.search_provider as sp

    monkeypatch.setattr(sp, "_SEARCH_BUDGET_S", 0.2)

    class _Slow:
        name = "slow"

        async def search(self, query, *, max_results):
            await asyncio.sleep(2)
            return [SearchHit("slow", "https://slow.com", "s")]

    fast = SearchHit("F", "https://fast.com", "s", score=0.5)
    mp = sp.MultiProvider([_Slow(), _FakeSub([fast])], readers=[])
    res = await mp.search("q", max_results=8)
    assert [h.url for h in res.hits] == ["https://fast.com"]  # slow upstream cancelled at budget


async def test_multiprovider_returns_at_soft_deadline_with_ground(monkeypatch):
    """The fix: once we have ANY ground, don't block on a hung upstream — return at the soft
    deadline instead of waiting out the whole budget (what was starving parallel scouts)."""
    import asyncio
    import time

    import app.tools.search_provider as sp

    monkeypatch.setattr(sp, "_SEARCH_SOFT_S", 0.15)
    monkeypatch.setattr(sp, "_SEARCH_BUDGET_S", 5.0)  # generous hard ceiling, should NOT be hit

    class _Hung:
        name = "hung"

        async def search(self, query, *, max_results):
            await asyncio.sleep(3)
            return [SearchHit("hung", "https://hung.com", "s")]

    fast = SearchHit("F", "https://fast.com", "s", score=0.5)
    mp = sp.MultiProvider([_Hung(), _FakeSub([fast])], readers=[])
    start = time.monotonic()
    res = await mp.search("q", max_results=8)
    elapsed = time.monotonic() - start
    assert [h.url for h in res.hits] == ["https://fast.com"]  # didn't wait on the hung provider
    assert elapsed < 1.0  # returned at the soft deadline, not the 3s sub / 5s budget


async def test_multiprovider_extends_to_budget_when_nothing_fast(monkeypatch):
    """Desperate path: if nothing returns inside the soft window, wait out the stragglers to the
    hard ceiling rather than giving up empty."""
    import asyncio

    import app.tools.search_provider as sp

    monkeypatch.setattr(sp, "_SEARCH_SOFT_S", 0.1)
    monkeypatch.setattr(sp, "_SEARCH_BUDGET_S", 2.0)

    class _Late:
        name = "late"

        async def search(self, query, *, max_results):
            await asyncio.sleep(0.3)  # past the soft window, within the budget
            return [SearchHit("L", "https://late.com", "s")]

    mp = sp.MultiProvider([_Late()], readers=[])
    res = await mp.search("q", max_results=8)
    assert [h.url for h in res.hits] == ["https://late.com"]  # the budget path waited it out


def test_offline_fallback_when_no_qwen_key(monkeypatch):
    monkeypatch.setattr("app.config.settings.qwen_api_key", "", raising=False)
    assert isinstance(make_search_provider(), CannedProvider)


def test_live_provider_is_duckduckgo_only(monkeypatch):
    """DuckDuckGo is the ONLY search upstream — no other vendor is wired in, by design."""
    monkeypatch.setattr("app.config.settings.qwen_api_key", "test-key", raising=False)
    provider = make_search_provider()
    assert isinstance(provider, MultiProvider)
    assert [s.name for s in provider._subs] == ["duckduckgo"]
    assert [r.name for r in provider._readers] == ["jina", "direct"]
