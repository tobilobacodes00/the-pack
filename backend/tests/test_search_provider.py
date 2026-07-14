"""Provider-layer quality: URL canonicalization, coherent cross-provider rank, domain blocklist,
and the canned-source guard. All hermetic (no network)."""

from __future__ import annotations

import pytest

from app.tools.providers.base import _BLOCKED_HOSTS, canonical_url, host_key


class TestCanonicalUrl:
    def test_http_and_https_collapse(self) -> None:
        assert canonical_url("http://x.com/a") == canonical_url("https://x.com/a")

    def test_www_m_amp_prefixes_stripped(self) -> None:
        c = canonical_url("https://example.com/p")
        assert canonical_url("https://www.example.com/p") == c
        assert canonical_url("https://m.example.com/p") == c
        assert canonical_url("https://amp.example.com/p") == c

    def test_trailing_slash_and_amp_path_stripped(self) -> None:
        base = canonical_url("https://x.com/story")
        assert canonical_url("https://x.com/story/") == base
        assert canonical_url("https://x.com/story/amp") == base

    def test_tracking_params_dropped_real_params_kept_and_sorted(self) -> None:
        assert canonical_url("https://x.com/p?utm_source=t&fbclid=9") == canonical_url(
            "https://x.com/p"
        )
        # real params survive, order-independent
        assert canonical_url("https://x.com/p?b=2&a=1") == canonical_url("https://x.com/p?a=1&b=2")
        # HN-style identity param is kept
        assert "id=42" in canonical_url("https://news.ycombinator.com/item?id=42")

    def test_fragment_dropped_hashbang_kept(self) -> None:
        assert canonical_url("https://x.com/p#section") == canonical_url("https://x.com/p")
        assert canonical_url("https://x.com/p#!/state") != canonical_url("https://x.com/p")

    def test_non_http_scheme_unchanged(self) -> None:
        # library sources must not be rewritten to https or collapsed
        assert canonical_url("lib://battery-notes.md") == "lib://battery-notes.md"
        assert canonical_url("mailto:a@b.com") == "mailto:a@b.com"

    def test_malformed_returns_input(self) -> None:
        assert canonical_url("not a url at all") == "not a url at all"


class TestHostKey:
    def test_strips_www_and_lowercases(self) -> None:
        assert host_key("https://WWW.Example.COM/p") == "example.com"

    def test_subdomains_distinct(self) -> None:
        assert host_key("https://a.example.com") != host_key("https://b.example.com")

    def test_shorteners_are_blocked(self) -> None:
        assert host_key("https://t.co/abc") in _BLOCKED_HOSTS
        assert host_key("https://bit.ly/abc") in _BLOCKED_HOSTS


# --- fan-out: dedup survivor, coherent rank, blocklist, diversity ---------------------------


def _hit(url: str, score: float, provider: str):
    from app.tools.providers.base import SearchHit

    return SearchHit(title=f"t {url}", url=url, snippet="s", score=score, provider=provider)


class _Sub:
    def __init__(self, name: str, hits):
        self.name = name
        self._hits = hits

    async def search(self, query: str, *, max_results: int = 5):
        return list(self._hits)


def _multi(subs):
    from app.tools.search_provider import MultiProvider

    return MultiProvider(subs=subs, readers=[])


async def test_fanout_dedupes_by_canonical_url_keeping_higher_raw_score() -> None:
    # same article: http+utm vs https — one survivor, the higher RAW score kept, original url intact.
    subs = [
        _Sub("tavily", [_hit("https://x.com/a", 0.9, "tavily")]),
        _Sub("exa", [_hit("http://x.com/a?utm_source=e", 0.4, "exa")]),
    ]
    hits = await _multi(subs)._fan_out("q", max_results=8)
    same = [h for h in hits if "x.com/a" in h.url]
    assert len(same) == 1, "the same article dedupes across providers"
    assert same[0].score == 0.9, "the higher RAW score survives"


async def test_fanout_zero_score_provider_not_always_sunk() -> None:
    # serpapi emits score 0.0; its best hit must not sink below a real-relevance provider's WORST.
    subs = [
        _Sub("serpapi", [_hit("https://s.com/1", 0.0, "serpapi")]),
        _Sub(
            "tavily",
            [_hit("https://t.com/1", 0.9, "tavily"), _hit("https://t.com/2", 0.1, "tavily")],
        ),
    ]
    hits = await _multi(subs)._fan_out("q", max_results=8)
    urls = [h.url for h in hits]
    # serp's best (rank 1.0) beats tavily's 2nd (rank 0.5, rel 0.1) under the blend
    assert urls.index("https://s.com/1") < urls.index("https://t.com/2")


async def test_fanout_star_count_magnitude_does_not_dominate() -> None:
    # github emits a star COUNT (1200); the OLD raw-score sort read that as 1200-relevance and buried
    # every real hit. The blend must NOT let magnitude dominate: exa's lower-ranked 0.9-relevance hit
    # must still beat github's SECOND result (a raw-score sort would have put both g.com far on top).
    subs = [
        _Sub(
            "github",
            [_hit("https://g.com/1", 1200.0, "github"), _hit("https://g.com/2", 900.0, "github")],
        ),
        _Sub("exa", [_hit("https://e.com/1", 0.9, "exa")]),
    ]
    hits = await _multi(subs)._fan_out("q", max_results=8)
    urls = [h.url for h in hits]
    # exa's #1 (rank 1.0, rel 0.9 → 0.96) beats github's #2 (rank 0.5 → 0.5) — magnitude didn't win.
    assert urls.index("https://e.com/1") < urls.index("https://g.com/2")


async def test_fanout_blocks_shortener_hosts() -> None:
    subs = [
        _Sub("ddg", [_hit("https://t.co/x", 0.5, "ddg"), _hit("https://real.com/x", 0.4, "ddg")])
    ]
    hits = await _multi(subs)._fan_out("q", max_results=8)
    assert all("t.co" not in h.url for h in hits)
    assert any("real.com" in h.url for h in hits)


async def test_fanout_diversity_off_restores_plain_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.config.settings.search_domain_diversity", False)
    subs = [
        _Sub(
            "tavily",
            [
                _hit("https://a.com/1", 0.9, "tavily"),
                _hit("https://a.com/2", 0.8, "tavily"),
                _hit("https://b.com/1", 0.7, "tavily"),
            ],
        ),
    ]
    hits = await _multi(subs)._fan_out("q", max_results=8)
    # single provider, best-first, no diversity nudge → raw order preserved
    assert [h.url for h in hits] == ["https://a.com/1", "https://a.com/2", "https://b.com/1"]


class TestProviderAllowList:
    """`search_providers_enabled` decides which upstreams actually run. Default is DuckDuckGo only —
    the one general web engine the live audit proved reliable; the rest 403'd or timed out to 0 hits.
    A live model key is required or make_search_provider short-circuits to the offline Canned provider,
    so these tests set a dummy key and every real-provider key present to prove filtering, not gating."""

    @staticmethod
    def _all_keys(monkeypatch: pytest.MonkeyPatch) -> None:
        # A model key (so we don't hit the offline Canned branch) + every provider key present, so the
        # allow-list is the ONLY thing narrowing the set.
        for attr in (
            "qwen_api_key",
            "search_api_key",
            "exa_api_key",
            "serpapi_api_key",
            "youcom_api_key",
            "newsapi_key",
            "gnews_api_key",
            "newsdata_api_key",
            "core_api_key",
            "github_token",
            "google_kg_api_key",
        ):
            monkeypatch.setattr(f"app.config.settings.{attr}", "x")

    def _sub_names(self) -> list[str]:
        from app.tools.search_provider import MultiProvider, make_search_provider

        prov = make_search_provider()
        assert isinstance(prov, MultiProvider)
        return [s.name for s in prov._subs]

    def test_default_is_duckduckgo_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._all_keys(monkeypatch)
        monkeypatch.setattr("app.config.settings.search_providers_enabled", "duckduckgo")
        assert self._sub_names() == ["duckduckgo"]

    def test_named_allow_list_filters_and_orders(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._all_keys(monkeypatch)
        monkeypatch.setattr(
            "app.config.settings.search_providers_enabled", "tavily, duckduckgo , exa"
        )
        # kept in the order named, whitespace tolerant, only the named ones
        assert self._sub_names() == ["tavily", "duckduckgo", "exa"]

    def test_empty_setting_runs_all_constructible(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._all_keys(monkeypatch)
        monkeypatch.setattr("app.config.settings.search_providers_enabled", "")
        names = self._sub_names()
        # the legacy fan-out-everything behaviour: many providers, DuckDuckGo among them
        assert "duckduckgo" in names and len(names) > 5

    def test_all_unknown_names_falls_back_to_duckduckgo(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._all_keys(monkeypatch)
        monkeypatch.setattr("app.config.settings.search_providers_enabled", "nope,bogus")
        # misconfigured to nothing real must never leave the pack with zero engines
        assert self._sub_names() == ["duckduckgo"]
