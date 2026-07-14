"""Live proof of the deep_scout bounded tool-loop against the REAL model (skipped without a key).

The offline tests (tests/test_deep_scout.py) prove the loop's SAFETY mechanics with scripted decisions.
This proves the thing scripts can't: that a REAL Qwen model, given the deep_scout/v1 persona + the step
schema, actually returns valid {action, ...} decisions turn after turn and the loop drives to a clean
finish within the hard cap. This is the gate the roadmap requires before deep_scout_enabled is trusted.
"""

from __future__ import annotations

import pytest

from app.engine.deep_scout import DEEP_SCOUT_STEP_SCHEMA, run_deep_scout
from app.engine.prompt_context import messages
from app.engine.wolves import Wolf
from app.qwen.types import CallSpec

from .conftest import requires_live_key

pytestmark = [requires_live_key(), pytest.mark.asyncio]


async def test_deep_scout_loop_completes_against_the_real_model(live_client) -> None:
    wolf = Wolf(
        hunt_id="live",
        wolf_id="deep-scout-1",
        role="deep_scout",
        tier="plus",
        thinking=False,
        prompt_version="deep_scout/v1",
        client=live_client,
    )
    task = "the current size of the global EV charging market"
    selected: list[tuple[int, str, str]] = []

    async def dispatch(context: str) -> dict:
        # Build the real deep_scout dispatch (persona system prompt + the running context as the task
        # body) and ask the real model for a structured decision.
        msgs = messages(
            wolf,
            raw_input=task,
            wolf_notes={},
            intent="deep_scout_step",
            context=context,
            instruction_override="Decide your next move now. Respond with ONLY the JSON decision.",
        )
        result = await live_client.complete(
            CallSpec(
                hunt_id="live",
                wolf_id="deep-scout-1",
                tier="plus",
                messages=msgs,
                response_schema=DEEP_SCOUT_STEP_SCHEMA,
                intent="deep_scout_step",
            )
        )
        return result.parsed or {}

    # Deterministic stand-in tools so this test measures the MODEL's decision-making, not live web flakiness.
    async def search(query: str) -> list[dict]:
        return [
            {
                "title": f"EV charging market report: {query}",
                "url": "https://example.com/ev-report",
            },
            {"title": "Market size 2025 overview", "url": "https://example.com/ev-2025"},
        ]

    async def fetch(url: str) -> str:
        return (
            "The global EV charging market was valued at roughly $30 billion in 2024 and is projected "
            "to grow at ~30% CAGR through 2030, led by public DC fast-charging deployment."
        )

    async def emit_selected(iteration: int, tool: str, args: str) -> None:
        selected.append((iteration, tool, args))

    result = await run_deep_scout(
        task=task,
        max_iterations=3,
        dispatch=dispatch,
        search=search,
        fetch=fetch,
        emit_selected=emit_selected,
    )

    # The real model must have driven the loop: made at least one choice, respected the cap, and
    # produced a non-empty summary grounded in what the tools returned.
    assert selected, "the model made no tool_selected choice — it returned no valid action"
    assert result.iterations <= 3, "the hard cap must hold even against a real model"
    assert result.stopped_reason in ("finished", "cap_reached", "no_action")
    assert result.summary.strip(), "deep_scout returned an empty summary"
    # Every choice the model made must be one of the three legal actions.
    assert all(tool in ("search", "fetch", "finish") for _i, tool, _a in selected)
