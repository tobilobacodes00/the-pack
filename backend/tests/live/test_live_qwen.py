"""Real-model assertions (skipped without a key — see tests/live/conftest.py).

These replace the print-and-eyeball smoke scripts (hello_qwen.py) with actual assertions, and add the
one check config.py explicitly waits on before prompt caching can be flipped on in prod: that the
REORDERED, cache-marked system prompt is genuinely served from cache on a live DashScope call.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

import pytest

from app.qwen.types import CallSpec

from .conftest import requires_live_key

# Skip the whole module without a real key AND run every test under asyncio.
pytestmark = [requires_live_key(), pytest.mark.asyncio]


async def _cache_engages(
    client, make_spec: Callable[[str], CallSpec], *, attempts: int = 4
) -> bool:
    """Warm the cache with one call, then probe up to `attempts` times (short gap between) for a hit.
    DashScope's cache WRITE has a small propagation delay, so an instant back-to-back second call can
    read cached=0 even though caching works — that's an endpoint timing race, not a code defect. We
    only need to prove caching ENGAGES on this prompt shape, so we retry rather than assert on the very
    first probe. Returns True as soon as any probe reports cached_tokens > 0."""
    await client.complete(make_spec("warm the cache"))
    for i in range(attempts):
        await asyncio.sleep(1.0)
        result = await client.complete(make_spec(f"probe {i}"))
        if result.cached_tokens > 0:
            return True
    return False


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

    assert await _cache_engages(live_client, _spec), (
        "the reordered cache-marked prompt was NOT served from cache across retries — do not flip "
        "qwen_prompt_cache_enabled on until this passes (DashScope reported cached_tokens=0)"
    )


async def test_real_scout_dispatch_shape_caches_end_to_end(live_client):
    """THE definitive 'in THIS shape' proof: a REAL wolf dispatch — the exact messages
    prompt_context.messages() builds for a scout, through the real QwenClient with the SHIPPED config
    (caching on, min_chars=400) — must be served from cache on the second identical call. This is the
    production path, not synthetic padding: it proves the flip we shipped actually saves tokens live."""
    from app.config import settings
    from app.engine.prompt_context import messages
    from app.engine.wolves import Wolf

    # Force the shipped caching config regardless of test-env overrides.
    settings.qwen_prompt_cache_enabled = True
    settings.qwen_prompt_cache_min_chars = 400

    wolf = Wolf(
        hunt_id="live",
        wolf_id="scout-1",
        role="scout",
        tier="flash",
        thinking=False,
        prompt_version="scout/v1",
        client=live_client,
    )
    built = messages(
        wolf, raw_input="the EV charging market", wolf_notes={}, intent="search", context=""
    )
    assert isinstance(built[0]["content"], list), "real scout persona must produce cache blocks"

    def _spec(user: str) -> CallSpec:
        msgs = [
            built[0],
            {"role": "user", "content": user},
        ]  # same cache-marked system, new user turn
        return CallSpec(hunt_id="live", wolf_id="scout-1", tier="flash", messages=msgs)

    assert await _cache_engages(live_client, _spec), (
        "a REAL scout dispatch never cached across retries in the shipped config — the min_chars gate "
        "or the _system_content ordering may have regressed (not a mere cache-write race)"
    )
