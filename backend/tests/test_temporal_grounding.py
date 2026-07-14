"""Every wolf must know what 'today' is — otherwise it reasons from a frozen training cutoff and
can't tell what "latest"/"recent"/"since January" mean or whether a source is stale. These pin that
the real date is injected into a dispatch's system prompt (deterministically, via the injectable
`now`) and that the conversational/refine paths get it too."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.engine.prompt_context import messages, temporal_grounding


def test_temporal_grounding_names_the_injected_date() -> None:
    fixed = datetime(2026, 7, 14, 9, 30, tzinfo=UTC)
    text = temporal_grounding(fixed)
    assert "2026" in text
    assert "July" in text
    # It must actively tell the model to prefer the date over its training cutoff.
    assert "training cutoff" in text.lower()
    assert "latest" in text.lower()


def test_temporal_grounding_defaults_to_real_clock() -> None:
    # No arg → a real, current year (not a hardcoded string). Just assert it's a plausible 4-digit
    # year in the block, proving it read the clock rather than a frozen constant.
    text = temporal_grounding()
    assert str(datetime.now(UTC).year) in text


@dataclass
class _StubWolf:
    role: str = "scout"
    wolf_id: str = "scout-1"


def test_dispatch_system_prompt_leads_with_the_stable_persona(monkeypatch) -> None:
    """The STABLE persona must come first and the VOLATILE date grounding last — a provider's
    prompt cache keys on the longest common prefix, so date-first (the old order) poisoned the
    cache on every single call. Reordering doesn't drop the date, it just moves it to the tail.

    Caching is ON by default now (proven live), which makes the system content a block LIST; this
    test pins the plain-STRING ordering, so force caching off here — the block-shape ordering has its
    own test below (test_system_content_becomes_cache_marked_blocks...)."""
    monkeypatch.setattr("app.config.settings.qwen_prompt_cache_enabled", False)
    msgs = messages(
        _StubWolf(),  # type: ignore[arg-type]  # messages() only reads .role/.wolf_id
        raw_input="What are the latest AI models?",
        wolf_notes={},
        intent="search",
        context="",
    )
    system = msgs[0]["content"]
    assert msgs[0]["role"] == "system"
    assert not system.startswith("Today is ")  # date grounding is no longer the prefix
    assert system.startswith("# Scout")  # the persona body leads instead
    assert "Today is " in system  # still present — just at the end, not the start
    assert str(datetime.now(UTC).year) in system
    assert system.rindex("Today is ") > len(system) // 2  # concretely: in the back half


def test_dated_helper_prepends_to_any_system_prompt() -> None:
    from app.core.intake import ALPHA_INTAKE, dated

    grounded = dated(ALPHA_INTAKE)
    assert grounded.startswith("Today is ")
    assert ALPHA_INTAKE in grounded  # the original prompt is preserved intact after the date


def test_system_content_stays_a_plain_string_when_caching_is_off(monkeypatch) -> None:
    monkeypatch.setattr("app.config.settings.qwen_prompt_cache_enabled", False)
    msgs = messages(_StubWolf(), raw_input="x", wolf_notes={}, intent="search", context="")  # type: ignore[arg-type]
    assert isinstance(msgs[0]["content"], str)


def test_system_content_becomes_cache_marked_blocks_when_enabled_and_long_enough(
    monkeypatch,
) -> None:
    monkeypatch.setattr("app.config.settings.qwen_prompt_cache_enabled", True)
    monkeypatch.setattr(
        "app.config.settings.qwen_prompt_cache_min_chars", 10
    )  # scout persona clears this
    msgs = messages(_StubWolf(), raw_input="x", wolf_notes={}, intent="search", context="")  # type: ignore[arg-type]
    content = msgs[0]["content"]
    assert isinstance(content, list)
    assert len(content) == 2
    persona_block, temporal_block = content
    assert persona_block["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in temporal_block  # only the STABLE block is marked
    assert persona_block["text"].startswith("# Scout")
    assert "Today is " in temporal_block["text"]


def test_short_persona_skips_the_cache_marker_even_when_enabled(monkeypatch) -> None:
    """DashScope's minimum cacheable block is real (see scripts/check_prompt_cache.py) — marking a
    persona that will never actually be served from cache just wastes the attempt."""
    monkeypatch.setattr("app.config.settings.qwen_prompt_cache_enabled", True)
    monkeypatch.setattr("app.config.settings.qwen_prompt_cache_min_chars", 10_000_000)
    msgs = messages(_StubWolf(), raw_input="x", wolf_notes={}, intent="search", context="")  # type: ignore[arg-type]
    assert isinstance(msgs[0]["content"], str)  # falls back to the plain-string shape


def test_real_personas_clear_the_shipped_cache_threshold() -> None:
    """REGRESSION GUARD for the recalibration: with the shipped default min_chars (400) and caching ON
    (both proven live 2026-07-14), every real wolf persona MUST cache-mark. A 4096 threshold silently
    disabled caching on every wolf (all personas are 481-2831 chars) — this fails if that regresses."""
    from app.config import settings
    from app.prompts import load_prompt

    assert settings.qwen_prompt_cache_enabled is True  # ON by default (proven on the live key)
    for role in ("scout", "tracker", "sentinel", "howler", "beta", "alpha", "elder", "warden"):
        persona = load_prompt(role).body
        assert len(persona) >= settings.qwen_prompt_cache_min_chars, (
            f"{role} persona ({len(persona)} chars) is under the {settings.qwen_prompt_cache_min_chars}"
            "-char cache threshold — it would never cache-mark; lower the threshold or it's a no-op"
        )

    # And the shipped config actually produces the block shape for a real dispatch.
    msgs = messages(_StubWolf(), raw_input="x", wolf_notes={}, intent="search", context="")  # type: ignore[arg-type]
    assert isinstance(msgs[0]["content"], list), "caching ON + real persona must yield cache blocks"
