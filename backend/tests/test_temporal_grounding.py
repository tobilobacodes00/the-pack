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


def test_dispatch_system_prompt_leads_with_the_date() -> None:
    msgs = messages(
        _StubWolf(),  # type: ignore[arg-type]  # messages() only reads .role/.wolf_id
        raw_input="What are the latest AI models?",
        wolf_notes={},
        intent="search",
        context="",
    )
    system = msgs[0]["content"]
    assert msgs[0]["role"] == "system"
    # The date grounding is PREPENDED, so it's the first thing the model reads.
    assert system.startswith("Today is ")
    assert str(datetime.now(UTC).year) in system


def test_dated_helper_prepends_to_any_system_prompt() -> None:
    from app.core.intake import ALPHA_INTAKE, dated

    grounded = dated(ALPHA_INTAKE)
    assert grounded.startswith("Today is ")
    assert ALPHA_INTAKE in grounded  # the original prompt is preserved intact after the date
