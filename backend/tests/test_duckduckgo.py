"""Keyless DuckDuckGo search + DirectReader — parsing is mocked so these stay hermetic (no network)."""

from __future__ import annotations

import httpx

from app.tools.providers.duckduckgo import DuckDuckGoSearch, _real_url
from app.tools.providers.readers import DirectReader, JinaReader

_SAMPLE = """
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farm-vs-riscv&rut=z">RISC-V vs <b>Arm</b></a>
  <a class="result__snippet" href="x">A <b>deep</b> comparison of the two architectures &amp; ecosystems.</a>
</div>
<div class="result">
  <a class="result__a" href="https://direct.example.org/page">Direct link title</a>
  <a class="result__snippet" href="y">Second snippet.</a>
</div>
"""


def _mock(monkeypatch, module, handler) -> None:
    orig = httpx.AsyncClient

    def _client(*a, **k):
        k["transport"] = httpx.MockTransport(handler)
        return orig(*a, **k)

    monkeypatch.setattr(module.httpx, "AsyncClient", _client)


def test_real_url_decodes_ddg_redirect() -> None:
    wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx%3Fa%3D1&rut=z"
    assert _real_url(wrapped) == "https://example.com/x?a=1"
    assert _real_url("https://plain.example.com/p") == "https://plain.example.com/p"


async def test_duckduckgo_parses_and_decodes(monkeypatch) -> None:
    import app.tools.providers.duckduckgo as ddg

    _mock(monkeypatch, ddg, lambda req: httpx.Response(200, text=_SAMPLE))
    hits = await DuckDuckGoSearch().search("risc-v vs arm", max_results=5)

    assert len(hits) == 2
    assert hits[0].url == "https://example.com/arm-vs-riscv"  # uddg-decoded, not the redirect
    assert hits[0].title == "RISC-V vs Arm"  # tags stripped
    assert (
        "deep comparison" in hits[0].snippet and "&" in hits[0].snippet
    )  # tags gone, entities back
    assert hits[1].url == "https://direct.example.org/page"  # plain href passes through
    assert hits[0].score > hits[1].score  # rank order preserved


async def test_duckduckgo_isolates_failure(monkeypatch) -> None:
    import app.tools.providers.duckduckgo as ddg

    _mock(monkeypatch, ddg, lambda req: httpx.Response(503, text="rate limited"))
    assert await DuckDuckGoSearch().search("anything", max_results=5) == []


async def test_direct_reader_strips_to_text(monkeypatch) -> None:
    import app.tools.providers.readers as readers

    async def fake_fetch(url, **_):
        return httpx.Response(
            200,
            text="<html><head><style>a{color:red}</style></head>"
            "<body><script>evil()</script><h1>Title</h1><p>Hello &amp; world.</p></body></html>",
        )

    monkeypatch.setattr(readers, "safe_fetch", fake_fetch)
    text = await DirectReader().read("https://example.com/page")
    assert text is not None
    assert "Title" in text and "Hello & world." in text
    assert "evil()" not in text and "color:red" not in text  # script/style dropped


async def test_direct_reader_returns_none_on_error(monkeypatch) -> None:
    import app.tools.providers.readers as readers

    async def boom(url, **_):
        raise RuntimeError("blocked")

    monkeypatch.setattr(readers, "safe_fetch", boom)
    assert await DirectReader().read("https://example.com") is None


async def test_jina_reader_works_keyless_and_omits_auth(monkeypatch) -> None:
    """JinaReader is keyless-only (no paid vendor wiring) — must never send an Authorization header."""
    seen: dict = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        seen["auth"] = req.headers.get("authorization")
        return httpx.Response(200, text="  clean extracted text  ")

    import app.tools.providers.readers as readers

    _mock(monkeypatch, readers, handler)
    text = await JinaReader().read("https://example.com/page")
    assert text == "clean extracted text"
    assert seen["url"] == "https://r.jina.ai/https://example.com/page"
    assert seen["auth"] is None  # keyless → no Authorization header, ever
