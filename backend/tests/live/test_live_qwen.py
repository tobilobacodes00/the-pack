"""Real-model assertions (skipped without a key — see tests/live/conftest.py).

These replace the print-and-eyeball smoke scripts (hello_qwen.py) with actual assertions, and add the
one check config.py explicitly waits on before prompt caching can be flipped on in prod: that the
REORDERED, cache-marked system prompt is genuinely served from cache on a live DashScope call.
"""

from __future__ import annotations

import pytest

from app.qwen.types import CallSpec

from .conftest import requires_live_key

# Skip the whole module without a real key AND run every test under asyncio.
pytestmark = [requires_live_key(), pytest.mark.asyncio]


async def test_each_tier_answers(live_client) -> None:
    """Every configured tier resolves to a real model that returns text and real usage — proves the
    key, base URL, and tier→model mapping are all correct against the live account."""
    for tier in ("flash", "plus", "max"):
        result = await live_client.complete(
            CallSpec(
                hunt_id="live",
                wolf_id="probe",
                tier=tier,
                messages=[{"role": "user", "content": "Reply with the single word: pack"}],
            )
        )
        assert result.text.strip(), f"{tier} returned empty text"
        assert result.in_tokens > 0 and result.out_tokens > 0
        assert result.cost_usd >= 0
        assert result.latency_ms >= 0  # the Batch-A timing must populate on the real path too


async def test_thinking_plus_streaming_works_end_to_end(live_client) -> None:
    """THE THINKING FIX, proven live: enable_thinking requires streaming and must NOT 400 (which it
    does if a response_format sneaks through). A thinking call returns text and real token counts."""
    result = await live_client.complete(
        CallSpec(
            hunt_id="live",
            wolf_id="probe",
            tier="max",
            thinking=True,
            messages=[{"role": "user", "content": "Think briefly, then reply with: ok"}],
        )
    )
    assert result.text.strip()
    assert result.in_tokens > 0 and result.out_tokens > 0


async def test_reordered_prompt_is_served_from_cache_on_the_second_call(live_client, monkeypatch):
    """THE CACHE PROOF config.py waits on. With caching ON, a repeated long system prefix (persona-
    first, per the _system_content reorder) must be served from DashScope's prompt cache on turn 2 —
    result.cached_tokens > 0. This is what must pass before qwen_prompt_cache_enabled is flipped on in
    prod 'in THIS shape'. If DashScope reports no cache hit, this fails LOUD instead of us assuming it.
    """
    monkeypatch.setattr("app.config.settings.qwen_prompt_cache_enabled", True)
    # A system prefix comfortably over the min cacheable block, marked cacheable, identical both calls.
    persona = "You are a meticulous research assistant. " * 200  # ~long, stable prefix
    system = [
        {"type": "text", "text": persona, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": "\n\nRespond with exactly one word."},
    ]

    def _spec(user: str) -> CallSpec:
        return CallSpec(
            hunt_id="live",
            wolf_id="probe",
            tier="plus",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )

    await live_client.complete(_spec("Say: one"))  # warm the cache
    second = await live_client.complete(_spec("Say: two"))  # identical prefix → should hit cache

    assert second.cached_tokens > 0, (
        "the reordered cache-marked prompt was NOT served from cache on turn 2 — do not flip "
        "qwen_prompt_cache_enabled on until this passes (DashScope reported cached_tokens=0)"
    )
