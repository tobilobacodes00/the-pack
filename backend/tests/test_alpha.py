"""Alpha (the lead) — its two decisions are now LOAD-BEARING, not theatre.

The standoff ruling (keep/drop/qualify) actually decides the challenged claim's fate: a `keep`
overrides Sentinel and the claim survives; `drop`/`unresolved` lets Sentinel's deterministic removal
stand. The wild-mode conflict is a real, reasoned Alpha model call (choice ∈ options + a recorded
rationale), not a blind echo of Tracker's recommendation. And Alpha's lead node settles on every
terminal exit — but never orphaned (stopped before open) or during a resumable halt.

All hermetic — no model, no network."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest

import app.engine.strategies.orchestrate as orch
from app.engine.boundary import Boundary
from app.engine.core import Emitter
from app.engine.strategies.base import Conflict, CritiqueResult, Merged
from app.engine.supervisor import BoundaryHalt, StopHunt, Supervisor
from app.qwen.client import QwenClient
from app.qwen.types import CompletionResult

from ._fakes import FakeRepo

TASK = "the BNPL market in Nigeria"


def _sup(repo: FakeRepo, hunt_id: str = "hunt_alpha", mode: str = "wild") -> Supervisor:
    sup = Supervisor(
        hunt_id,
        Emitter(hunt_id, repo),
        repo,
        QwenClient(),
        asyncio.Queue(),
        source="typed",
        raw_input=TASK,
        strategy="critique",
    )
    sup._boundary = Boundary(boundary_usd=5.0)
    sup._mode = mode
    for role in ("sentinel", "tracker", "alpha"):
        sup._wolves[role] = sup._make_wolf(role, role, "max", False)
        sup._wolf_budget[role] = 5.0
    return sup


def _merged(claims, claims_src=None, sources=None, conflict=None) -> Merged:
    return Merged(
        summary="s",
        claims=list(claims),
        claims_src=claims_src if claims_src is not None else [[] for _ in claims],
        sources=sources or [{"url": "https://a.com/1", "title": "A", "verified": True}],
        conflict=conflict,
    )


def _res(parsed: dict, text: str = "ruled", model: str = "stub") -> CompletionResult:
    return CompletionResult(
        text=text, model=model, tier="max", in_tokens=1, out_tokens=1, cost_usd=0.0, parsed=parsed
    )


# --- the standoff ruling is load-bearing ------------------------------------------------------


async def test_standoff_returns_keep_verdict_exempts_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    """Alpha rules KEEP → the Sentinel-flagged claim SURVIVES apply_critique (Alpha overrode Sentinel).
    This is the P0 regression guard: the ruling actually changes the brief."""
    sup = _sup(FakeRepo())

    async def judge_keeps(wolf, intent, **kwargs):
        if intent == "standoff_judge":
            return _res({"verdict": "keep", "rationale": "source 1 backs it"})
        return _res({}, text="ok")  # challenger/defendant prose

    monkeypatch.setattr(sup, "_dispatch", judge_keeps)
    ruling = await sup.standoff(
        "sentinel", "tracker", "ref", "weak", evidence="ev", claim="Contested claim."
    )
    assert ruling.outcome == "alpha_call" and ruling.verdict == "keep"

    merged = _merged(["Contested claim.", "Other claim."], [[1], [2]])
    verdict = CritiqueResult(ok=False, issues=[{"claim": "Contested claim.", "problem": "x"}])
    out = await sup.apply_critique(merged, verdict, ruling=ruling)
    assert "Contested claim." in out.claims, "Alpha's KEEP overrides Sentinel's flag"


async def test_standoff_drop_verdict_drops_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    sup = _sup(FakeRepo())

    async def judge_drops(wolf, intent, **kwargs):
        if intent == "standoff_judge":
            return _res({"verdict": "drop", "rationale": "no source"})
        return _res({}, text="ok")

    monkeypatch.setattr(sup, "_dispatch", judge_drops)
    ruling = await sup.standoff(
        "sentinel", "tracker", "ref", "weak", evidence="ev", claim="Bad claim."
    )
    assert ruling.verdict == "drop"
    merged = _merged(["Bad claim.", "Good claim."], [[1], [2]])
    verdict = CritiqueResult(ok=False, issues=[{"claim": "Bad claim.", "problem": "x"}])
    out = await sup.apply_critique(merged, verdict, ruling=ruling)
    assert out.claims == ["Good claim."]


async def test_standoff_qualify_keeps_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    sup = _sup(FakeRepo())

    async def judge_qualifies(wolf, intent, **kwargs):
        if intent == "standoff_judge":
            return _res({"verdict": "qualify", "rationale": "partly"})
        return _res({}, text="ok")

    monkeypatch.setattr(sup, "_dispatch", judge_qualifies)
    ruling = await sup.standoff("sentinel", "tracker", "ref", "weak", evidence="ev", claim="C.")
    assert ruling.verdict == "qualify"
    merged = _merged(["C.", "D."], [[1], [2]])
    verdict = CritiqueResult(ok=False, issues=[{"claim": "C.", "problem": "x"}])
    out = await sup.apply_critique(merged, verdict, ruling=ruling)
    assert "C." in out.claims, "a qualify keeps the claim"


async def test_apply_critique_without_ruling_unchanged() -> None:
    """orchestrate/deep_dive pass no ruling → apply_critique drops exactly as before."""
    sup = _sup(FakeRepo())
    merged = _merged(["Flagged one.", "Kept one."], [[1], [2]])
    verdict = CritiqueResult(ok=False, issues=[{"claim": "Flagged one.", "problem": "x"}])
    out = await sup.apply_critique(merged, verdict)  # no ruling kwarg
    assert out.claims == ["Kept one."]


async def test_standoff_unresolved_verdict_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """A faulted judge → outcome unresolved AND verdict None (so apply_critique still drops)."""
    sup = _sup(FakeRepo())

    async def faulted(wolf, intent, **kwargs):
        return sup._faulted_result(wolf)

    monkeypatch.setattr(sup, "_dispatch", faulted)
    ruling = await sup.standoff("sentinel", "tracker", "ref", "weak", evidence="ev", claim="C.")
    assert ruling.outcome == "unresolved" and ruling.verdict is None


# --- wild-mode conflict is a real reasoned Alpha call -----------------------------------------


async def test_wild_conflict_calls_alpha_and_records_rationale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Wild mode: Alpha REASONS (picks an option != recommended based on evidence) and the rationale
    is recorded on hold_resolved — not a blind echo of Tracker's recommended."""
    sup = _sup(FakeRepo(), mode="wild")
    conflict = Conflict(question="2M or 3.4M?", options=["2M", "3.4M"], recommended="2M")

    async def alpha_reasons(wolf, intent, **kwargs):
        assert intent == "conflict_decide"
        return _res({"choice": "3.4M", "rationale": "source 2 is the primary filing"})

    monkeypatch.setattr(sup, "_dispatch", alpha_reasons)
    resolution = await sup.resolve_conflict(conflict, sources=[{"url": "u", "title": "t"}])
    assert resolution == "3.4M", "Alpha chose on the evidence, not the recommended default"
    resolved = next(e for e in sup._repo.all_events(sup._hunt_id) if e.type == "hold_resolved")
    assert resolved.payload["auto"] is True
    assert "primary filing" in resolved.payload["rationale"]


async def test_wild_conflict_falls_back_on_fault(monkeypatch: pytest.MonkeyPatch) -> None:
    """A faulted Alpha call falls back to recommended with an honest note, schema-valid, non-empty."""
    sup = _sup(FakeRepo(), mode="wild")
    conflict = Conflict(question="q", options=["A", "B"], recommended="A")

    async def faulted(wolf, intent, **kwargs):
        return sup._faulted_result(wolf)

    monkeypatch.setattr(sup, "_dispatch", faulted)
    resolution = await sup.resolve_conflict(conflict, sources=[])
    assert resolution == "A"
    resolved = next(e for e in sup._repo.all_events(sup._hunt_id) if e.type == "hold_resolved")
    assert resolved.payload["rationale"], "a fallback still carries an honest rationale"
    assert resolved.payload["resolution"] == "A"


async def test_wild_conflict_choice_clamped_to_options(monkeypatch: pytest.MonkeyPatch) -> None:
    """An off-menu choice from Alpha falls back to recommended (never ship an unoffered option)."""
    sup = _sup(FakeRepo(), mode="wild")
    conflict = Conflict(question="q", options=["A", "B"], recommended="A")

    async def off_menu(wolf, intent, **kwargs):
        return _res({"choice": "Z (not offered)", "rationale": "..."})

    monkeypatch.setattr(sup, "_dispatch", off_menu)
    assert await sup.resolve_conflict(conflict, sources=[]) == "A"


# --- lead node + hold pairing on abnormal exits -----------------------------------------------


async def test_lead_closed_on_stop() -> None:
    """A stop AFTER the pack opens settles Alpha's s0-lead node (one step_completed)."""
    repo = FakeRepo()
    c: asyncio.Queue = asyncio.Queue()
    c.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        "hunt_stop",
        Emitter("hunt_stop", repo),
        repo,
        QwenClient(),
        c,
        source="typed",
        raw_input=TASK,
        strategy="orchestrate",
    )

    async def stop_after_open(self, engine) -> None:
        raise StopHunt()

    # Let the hunt open the pack, then stop inside the strategy (execute is called as
    # self._strategy.execute(engine), so the patched method takes (self, engine)).
    with patch.object(orch.OrchestrateStrategy, "execute", stop_after_open):
        await asyncio.wait_for(sup.run(), timeout=15)
    events = repo.all_events("hunt_stop")
    lead_done = [
        e for e in events if e.type == "step_completed" and e.payload.get("step_id") == "s0-lead"
    ]
    assert len(lead_done) == 1, "the lead node settles exactly once on a stop"
    assert any(e.type == "hunt_stopped" for e in events)


async def test_lead_not_closed_when_stopped_before_open() -> None:
    """A stop DURING plan approval (before _open_pack) must NOT emit an orphan s0-lead close."""
    repo = FakeRepo()
    c: asyncio.Queue = asyncio.Queue()
    c.put_nowait({"type": "stop"})  # stop before approving the plan
    sup = Supervisor(
        "hunt_early_stop",
        Emitter("hunt_early_stop", repo),
        repo,
        QwenClient(),
        c,
        source="typed",
        raw_input=TASK,
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)
    events = repo.all_events("hunt_early_stop")
    assert not any(
        e.type == "step_completed" and e.payload.get("step_id") == "s0-lead" for e in events
    ), "no orphan lead close when the lead never opened"


async def test_lead_not_closed_on_boundary_halt() -> None:
    """A BoundaryHalt is a PAUSE — the lead node must NOT settle (it re-opens on resume). The strategy
    raises BoundaryHalt after the pack opened; the halt branch must leave s0-lead un-closed."""
    repo = FakeRepo()
    c: asyncio.Queue = asyncio.Queue()
    c.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        "hunt_halt",
        Emitter("hunt_halt", repo),
        repo,
        QwenClient(),
        c,
        source="typed",
        raw_input=TASK,
        strategy="orchestrate",
    )

    async def halt_after_open(self, engine) -> None:
        raise BoundaryHalt()

    with patch.object(orch.OrchestrateStrategy, "execute", halt_after_open):
        await asyncio.wait_for(sup.run(), timeout=15)
    events = repo.all_events("hunt_halt")
    assert not any(e.type == "hunt_completed" for e in events)
    assert not any(
        e.type == "step_completed" and e.payload.get("step_id") == "s0-lead" for e in events
    ), "the lead stays paused on a halt, not closed"


async def test_hold_paired_on_stop_during_hold(monkeypatch: pytest.MonkeyPatch) -> None:
    """A stop while blocked on a human Hold still emits a hold_resolved for the open hold (no dangling
    Hold), then unwinds."""
    sup = _sup(FakeRepo(), mode="on_signal")  # non-wild → opens a human Hold
    conflict = Conflict(question="q", options=["A", "B"], recommended="A")

    async def stop_awaiting(kind: str):
        raise StopHunt()

    monkeypatch.setattr(sup, "_await_command", stop_awaiting)
    with pytest.raises(StopHunt):
        await sup.resolve_conflict(conflict, sources=[])
    events = sup._repo.all_events(sup._hunt_id)
    opened = [e for e in events if e.type == "hold_opened"]
    resolved = [e for e in events if e.type == "hold_resolved"]
    assert opened and resolved, "the open Hold is paired with a hold_resolved on stop"
    assert resolved[-1].payload["hold_id"] == opened[-1].payload["hold_id"]
