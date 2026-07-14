"""Sentinel (the critic/standoff wolf) — verification with TEETH.

The verify stage used to be theatre: a flagged claim shipped to the brief unchanged, the standoff
debated an abstract rationale with no evidence, and a timed-out/faulted critique silently green-lit
every claim. These pin the fixes: apply_critique deterministically drops flagged claims (never
emptying the brief), the standoff is grounded in the claim + numbered sources, an un-adjudicated
standoff reads as `unresolved`, and a critique that didn't run reads as unverified (not passed).

All hermetic — no model, no network."""

from __future__ import annotations

import asyncio

import pytest

from app.engine.boundary import Boundary
from app.engine.core import Emitter
from app.engine.strategies.base import CritiqueResult, Merged
from app.engine.supervisor import Supervisor
from app.engine.wolves import Wolf
from app.qwen.client import QwenClient
from app.qwen.types import CompletionResult

from ._fakes import FakeRepo

TASK = "the BNPL market in Nigeria"


def _sup(repo: FakeRepo, hunt_id: str = "hunt_sentinel") -> Supervisor:
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
    for role in ("sentinel", "tracker", "alpha"):
        tier = "max" if role in ("sentinel", "alpha") else "plus"
        sup._wolves[role] = sup._make_wolf(role, role, tier, False)
        sup._wolf_budget[role] = 5.0
    return sup


def _merged(claims, claims_src=None, sources=None) -> Merged:
    return Merged(
        summary="s",
        claims=list(claims),
        claims_src=claims_src if claims_src is not None else [[] for _ in claims],
        sources=sources or [{"url": "https://a.com/1", "title": "A", "verified": True}],
    )


# --- apply_critique: the teeth ----------------------------------------------------------------


async def test_apply_critique_drops_flagged_claim() -> None:
    """A claim Sentinel flags (by paraphrased text) is removed — along with its claims_src entry."""
    sup = _sup(FakeRepo())
    merged = _merged(
        claims=[
            "Fintech adoption in Nigeria grew 40% in 2025.",
            "BNPL defaults reached 12% among young borrowers.",
        ],
        claims_src=[[1], [2]],
        sources=[
            {"url": "https://a.com/1", "title": "A", "verified": True},
            {"url": "https://b.com/2", "title": "B", "verified": True},
        ],
    )
    # Sentinel flags the defaults claim, paraphrased (not verbatim) — token overlap must still match.
    verdict = CritiqueResult(
        ok=False,
        issues=[{"claim": "defaults among young borrowers hit 12%", "problem": "no source"}],
    )
    out = await sup.apply_critique(merged, verdict)
    assert out.claims == ["Fintech adoption in Nigeria grew 40% in 2025."]
    assert out.claims_src == [[1]]


async def test_apply_critique_ok_verdict_is_noop() -> None:
    sup = _sup(FakeRepo())
    merged = _merged(["c1", "c2"], [[1], [2]])
    out = await sup.apply_critique(merged, CritiqueResult(ok=True, issues=[]))
    assert out is merged


async def test_apply_critique_never_empties_the_brief() -> None:
    """Flag EVERY claim → keep the sourced ones (guard rail), never ship nothing."""
    sup = _sup(FakeRepo())
    merged = _merged(
        claims=["Alpha finding one.", "Beta finding two."],
        claims_src=[[1], []],
    )
    verdict = CritiqueResult(
        ok=False,
        issues=[
            {"claim": "Alpha finding one.", "problem": "x"},
            {"claim": "Beta finding two.", "problem": "y"},
        ],
    )
    out = await sup.apply_critique(merged, verdict)
    assert out.claims, "a non-empty brief is never emptied by the critique"
    # the sourced claim is the one kept
    assert out.claims == ["Alpha finding one."] and out.claims_src == [[1]]


async def test_apply_critique_ignores_empty_claim_issue() -> None:
    """FIX-4's 'verification did not complete' verdict flags an EMPTY claim — it must drop nothing."""
    sup = _sup(FakeRepo())
    merged = _merged(["c1", "c2"], [[1], [2]])
    verdict = CritiqueResult(
        ok=False, issues=[{"claim": "", "problem": "verification did not complete"}]
    )
    out = await sup.apply_critique(merged, verdict)
    assert out.claims == ["c1", "c2"]


async def test_apply_critique_paraphrase_not_topic_word_collision() -> None:
    """Two claims sharing only the task words (BNPL/market/Nigeria) must NOT both drop when one is
    flagged — the matcher strips task-topic words, so only the genuinely-matching claim goes."""
    sup = _sup(FakeRepo())
    merged = _merged(
        claims=[
            "the BNPL market in Nigeria: the most recent figures the sources agree on.",
            "the BNPL market in Nigeria: the leading players and the shape of the landscape.",
        ],
        claims_src=[[1], [2]],
    )
    verdict = CritiqueResult(
        ok=False,
        issues=[{"claim": "the most recent figures on the BNPL market in Nigeria", "problem": "x"}],
    )
    out = await sup.apply_critique(merged, verdict)
    assert len(out.claims) == 1
    assert "leading players" in out.claims[0], (
        "only the figures claim was flagged, not the players one"
    )


# --- standoff grounding + honest outcome ------------------------------------------------------


def test_standoff_evidence_carries_claim_and_registry() -> None:
    sup = _sup(FakeRepo())
    merged = _merged(
        claims=["Nigerian BNPL volume reached $1.2B in 2025."],
        claims_src=[[1]],
        sources=[
            {"url": "https://a.com/1", "title": "Report A", "verified": True},
            {"url": "https://b.com/2", "title": "Report B", "verified": False},
        ],
    )
    ev = sup.standoff_evidence(merged, {"claim": "BNPL volume reached $1.2B in 2025"})
    assert "The claim under challenge:" in ev
    assert "cited to 1" in ev
    assert "[1]" in ev and "Report A" in ev  # the numbered registry rides along
    assert "(unverified)" in ev  # the weak source is labeled


def test_standoff_evidence_empty_when_no_claim() -> None:
    sup = _sup(FakeRepo())
    assert sup.standoff_evidence(_merged(["c"]), {"claim": ""}) == ""


async def test_standoff_unresolved_when_judge_faults(monkeypatch: pytest.MonkeyPatch) -> None:
    """If Alpha never actually rules (faulted/timeout), the standoff resolves 'unresolved' + a stray
    fires — it must NOT render as a clean 'alpha_call' that looks adjudicated."""
    sup = _sup(FakeRepo())

    async def faulted_dispatch(wolf, intent, **kwargs):
        return sup._faulted_result(wolf)

    monkeypatch.setattr(sup, "_dispatch", faulted_dispatch)
    await sup.standoff("sentinel", "tracker", "claim_ref", "weak claim", evidence="ev")
    events = sup._repo.all_events(sup._hunt_id)
    resolved = next(e for e in events if e.type == "standoff_resolved")
    assert resolved.payload["outcome"] == "unresolved"
    assert any(e.type == "stray_detected" and e.payload["wolf_id"] == "alpha" for e in events)


# --- critique: a failed critique is unverified, not a silent pass -----------------------------


def _fault(sup: Supervisor):
    async def faulted_dispatch(wolf, intent, **kwargs):
        return sup._faulted_result(wolf)

    return faulted_dispatch


async def test_critique_faulted_result_is_unverified_not_pass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A faulted/oversize critique dispatch (parsed=None) used to compute ok=True at confidence 0.9 —
    a false clean bill. It must now read ok=False (unverified) at confidence 0.0."""
    sup = _sup(FakeRepo())
    monkeypatch.setattr(sup, "_dispatch", _fault(sup))
    verdict = await sup.critique(_merged(["c1", "c2"], [[1], [2]]))
    assert verdict.ok is False
    assert (
        verdict.issues and not verdict.issues[0]["claim"]
    )  # empty claim → flags state, drops nothing
    done = next(
        e
        for e in sup._repo.all_events(sup._hunt_id)
        if e.type == "step_completed" and e.payload["wolf_id"] == "sentinel"
    )
    assert done.payload["confidence"] == 0.0


async def test_critique_timeout_is_unverified_not_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    sup = _sup(FakeRepo())

    async def hang(self, intent, **kwargs):
        await asyncio.sleep(10)
        raise AssertionError("unreachable")

    monkeypatch.setattr(Wolf, "think", hang)
    monkeypatch.setattr(sup, "_synthesis_timeout", 0.05)
    monkeypatch.setattr("app.config.settings.synthesis_retries", 0)
    verdict = await sup.critique(_merged(["c1"], [[1]]))
    assert verdict.ok is False and verdict.issues
    done = next(
        e
        for e in sup._repo.all_events(sup._hunt_id)
        if e.type == "step_completed" and e.payload["wolf_id"] == "sentinel"
    )
    assert done.payload["confidence"] == 0.0


def _cr(parsed: dict) -> CompletionResult:
    return CompletionResult(
        text="", model="stub", tier="max", in_tokens=1, out_tokens=1, cost_usd=0.0, parsed=parsed
    )


async def test_critique_flags_reach_the_brief_via_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    """End-to-end at the method level: critique returns a flag → apply_critique drops that claim, so
    the flagged claim is genuinely absent from what would be drafted (the P0: teeth)."""
    sup = _sup(FakeRepo())
    merged = _merged(["Solid claim with a source.", "Bogus unsourced claim."], [[1], []])

    async def fake_think(self, intent, **kwargs):
        return _cr(
            {"ok": False, "issues": [{"claim": "Bogus unsourced claim.", "problem": "no src"}]}
        )

    monkeypatch.setattr(Wolf, "think", fake_think)
    verdict = await sup.critique(merged)
    out = await sup.apply_critique(merged, verdict)
    assert out.claims == ["Solid claim with a source."]
