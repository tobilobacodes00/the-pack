"""Adaptive depth (v3) — the pure, model-free scaling that makes a brief comprehensive when the task
needs it and tight when it doesn't. These assert the builders/tables directly (no model, no hunt), so
they prove the wording scales UP and DOWN independent of FakeQwen's fixed offline output."""

from __future__ import annotations

import pytest

from app.engine import prompt_context as pc


def test_merge_instruction_scales_by_depth() -> None:
    # the claim count is a CEILING ("up to ~N"), not a lo-hi target to pad toward or shrink to hit.
    assert "~6" in pc.merge_instruction("brief")
    assert "~14" in pc.merge_instruction("standard")
    assert "~28" in pc.merge_instruction("deep")
    for depth in ("brief", "standard", "deep"):
        instr = pc.merge_instruction(depth)
        assert "6-12" not in instr, "the old fixed cap is gone"
        assert "aim for roughly" not in instr, "no lo-hi target phrasing — a pure ceiling"
        assert "never pad" in instr
        assert "source_ids" in instr, "each claim must name its backing source number(s)"
        assert "READ" in instr, "state as fact only what a read source supports"
        assert "at least 2 options" in instr, "a raised conflict must offer real distinct positions"


def test_draft_instruction_scales_by_depth() -> None:
    assert "3-5" in pc.draft_instruction("brief")
    assert "7-12" in pc.draft_instruction("standard")
    assert "14-24" in pc.draft_instruction("deep")
    for depth in ("brief", "standard", "deep"):
        d = pc.draft_instruction(depth)
        assert "COMPREHENSIVE" in d
        assert "Cover EVERY distinct sourced point" in d
        # the old shallow caps are gone
        assert "5-9" not in d
        assert "Don't pad" not in d
    # only 'deep' gets the extra "expand fully" nudge
    assert "Expand every theme" in pc.draft_instruction("deep")
    assert "Expand every theme" not in pc.draft_instruction("brief")
    # anchors Howler to Tracker's own claims_src map instead of re-deriving citations from scratch
    assert "already names its own backing source" in pc.draft_instruction("standard")
    assert "never drop a claim" in pc.draft_instruction("standard")


def test_unknown_depth_falls_back_to_standard() -> None:
    assert pc.merge_instruction("weird") == pc.merge_instruction("standard")
    assert pc.draft_instruction("weird") == pc.draft_instruction("standard")
    assert pc.depth_mult("weird") == pc.depth_mult("standard") == 1.0


def test_depth_mult_is_monotonic() -> None:
    assert pc.depth_mult("brief") < pc.depth_mult("standard") < pc.depth_mult("deep")


def test_ranges_are_monotonic() -> None:
    # brief tighter than standard tighter than deep, on both axes
    assert (
        pc._MERGE_CLAIMS["brief"][1] < pc._MERGE_CLAIMS["standard"][1] < pc._MERGE_CLAIMS["deep"][1]
    )
    assert (
        pc._DRAFT_BLOCKS["brief"][1] < pc._DRAFT_BLOCKS["standard"][1] < pc._DRAFT_BLOCKS["deep"][1]
    )


def test_messages_uses_instruction_override_when_given() -> None:
    from app.engine.wolves import Wolf
    from app.qwen.client import QwenClient

    wolf = Wolf(
        hunt_id="h",
        wolf_id="tracker",
        role="tracker",
        tier="plus",
        thinking=True,
        prompt_version="tracker/v1",
        client=QwenClient(),
    )
    override = "CUSTOM DEPTH-SCALED INSTRUCTION XYZ"
    msgs = pc.messages(wolf, "a task", {}, "merge", "", instruction_override=override)
    user = msgs[1]["content"]
    assert override in user
    # the static fallback text is NOT used when an override is supplied
    assert pc.INTENT_INSTRUCTIONS["merge"] not in user


def test_messages_falls_back_without_override() -> None:
    from app.engine.wolves import Wolf
    from app.qwen.client import QwenClient

    wolf = Wolf(
        hunt_id="h",
        wolf_id="tracker",
        role="tracker",
        tier="plus",
        thinking=True,
        prompt_version="tracker/v1",
        client=QwenClient(),
    )
    msgs = pc.messages(wolf, "a task", {}, "merge", "")
    assert pc.INTENT_INSTRUCTIONS["merge"] in msgs[1]["content"]


@pytest.mark.parametrize("depth", ["brief", "standard", "deep"])
def test_rehearse_scales_cost_and_time_with_depth(depth: str) -> None:
    from app.engine.rehearse import rehearse

    team = [{"role": "scout", "count": 3}]
    base = rehearse(team, "orchestrate", "standard")
    got = rehearse(team, "orchestrate", depth)
    if depth == "deep":
        assert got["est_cost_usd"] > base["est_cost_usd"]
        assert got["est_time_s"] > base["est_time_s"]
    elif depth == "brief":
        assert got["est_cost_usd"] < base["est_cost_usd"]
