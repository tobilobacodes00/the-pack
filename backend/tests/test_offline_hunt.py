"""The offline hunt — the whole engine runs end to end with no key and no infrastructure.

Drives the REAL Supervisor (real Emitter, real Boundary, real QwenClient in offline mode, the
real strategy package) over an in-memory repo and asserts the engine's invariants: dense seq,
every event valid against the FROZEN schema, the Boundary respected, the hunt opens with
`hunt_created` and closes with `hunt_completed`, and the live-research lifecycle is present.

This is the proof that the pipeline is correct before the model key ever arrives. It no longer
pins the exact event MULTISET to a hand-authored fixture (the engine is now dynamic and
strategy-driven); it tests the invariants the contract actually guarantees.
"""

from __future__ import annotations

import asyncio
import contextlib

import pytest
from jsonschema import Draft202012Validator

from app.engine.core import Emitter
from app.engine.roster import build_team
from app.engine.search_query import broaden
from app.engine.supervisor import Supervisor
from app.events.models import load_event_schema
from app.qwen.client import QwenClient

from ._fakes import FakeRepo

# The lifecycle every offline hunt must exhibit, whatever the strategy.
_REQUIRED_TYPES = {
    "hunt_created",
    "plan_proposed",
    "plan_approved",
    "wolf_spawned",
    "step_started",
    "tool_called",
    "tool_result",
    "tokens_spent",
    "wolf_progress",
    "message_passed",
    "step_completed",
    "artifact_created",
    "hunt_completed",
}


async def _run(strategy: str) -> list:
    repo = FakeRepo()
    hunt_id = f"hunt_offline_{strategy}"
    emitter = Emitter(hunt_id, repo)
    client = QwenClient()
    assert client.offline, "test env has no key, so the brain must be FakeQwen"

    commands: asyncio.Queue = asyncio.Queue()
    # Offline findings are clean (no conflict), so orchestrate opens no Hold — only the one
    # human gate is needed. Pre-queue it so the supervisor runs straight through.
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})

    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        client,
        commands,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy=strategy,
    )
    await asyncio.wait_for(sup.run(), timeout=15)
    return repo.all_events(hunt_id)


def _assert_invariants(events: list) -> None:
    # seq is dense, 0-based, gap-free.
    assert [e.seq for e in events] == list(range(len(events)))

    # every emitted event validates against the frozen schema.
    validator = Draft202012Validator(load_event_schema())
    for e in events:
        errors = list(validator.iter_errors(e.model_dump()))
        assert not errors, f"seq {e.seq} ({e.type}) invalid: {[x.message for x in errors]}"

    # it starts created and ends completed.
    assert events[0].type == "hunt_created"
    assert events[-1].type == "hunt_completed"

    # the full live-research lifecycle is present.
    produced = {e.type for e in events}
    assert _REQUIRED_TYPES <= produced, f"missing: {_REQUIRED_TYPES - produced}"

    # the Boundary was respected: no spend event ever exceeds the (first-hunt-capped) budget.
    boundary = next(e for e in events if e.type == "plan_approved").payload["boundary_usd"]
    for e in events:
        if e.type == "tokens_spent":
            assert e.payload["cumulative_usd"] <= boundary + 1e-9

    # the happy path stays well under budget — no boundary events at all.
    assert not any(e.type.startswith("boundary_") for e in events)


async def test_offline_orchestrate_runs_clean() -> None:
    events = await _run("orchestrate")
    _assert_invariants(events)
    # the default strategy never invents a conflict offline, so no Hold fires.
    assert not any(e.type == "hold_opened" for e in events)


async def test_offline_totals_time_s_is_measured_not_the_plan_estimate() -> None:
    """The counter fix: hunt_completed.totals.time_s is the REAL measured wall-clock runtime, not the
    plan's est_time guess (FakeQwen's is 210s). An offline hunt runs in well under a second, so the
    measured value is a small non-negative float — proving it's timed, not the hardcoded estimate."""
    events = await _run("orchestrate")
    totals = next(e for e in events if e.type == "hunt_completed").payload["totals"]
    time_s = totals["time_s"]

    assert isinstance(time_s, (int, float))
    assert time_s >= 0.0, "measured runtime is never negative"
    # The est_time estimate is 210s; the whole offline hunt finishes in a fraction of a second, so a
    # measured clock is unambiguously far below it (and far below any plausible real hunt estimate).
    assert time_s < 60.0, f"time_s={time_s} looks like the plan estimate, not a measured runtime"
    # It's anchored at plan_approved (running start), so it excludes the approval gate but covers the
    # work — for an offline hunt that's a real, tiny, positive elapsed once we ran any awaits.
    plan_approved = next(e for e in events if e.type == "plan_approved")
    completed = next(e for e in events if e.type == "hunt_completed")
    assert completed.seq > plan_approved.seq, (
        "the pack did real work between approval and completion"
    )


async def test_offline_deep_dive_does_a_second_round() -> None:
    events = await _run("deep_dive")
    _assert_invariants(events)
    # the iterative strategy ranges twice — more than three scout step_starts.
    scout_steps = [
        e for e in events if e.type == "step_started" and e.payload["wolf_id"].startswith("scout")
    ]
    assert len(scout_steps) > 3


async def test_offline_critique_opens_a_standoff() -> None:
    events = await _run("critique")
    _assert_invariants(events)
    # Sentinel challenges the weakest claim, and the standoff resolves cleanly.
    assert any(e.type == "standoff_opened" for e in events)
    assert any(e.type == "standoff_resolved" for e in events)


async def test_offline_per_wolf_budget_relieves_a_scout(monkeypatch: pytest.MonkeyPatch) -> None:
    """v2: a scout that would blow its own tiny per-wolf cap stands down — the hunt still finishes
    (one runaway wolf can't drain or halt the whole hunt)."""
    from app.engine import supervisor as sup_mod

    tier, thinking, _ = sup_mod.ROLE_SPEC["scout"]
    monkeypatch.setitem(sup_mod.ROLE_SPEC, "scout", (tier, thinking, 0.001))  # near-zero cap

    repo = FakeRepo()
    hunt_id = "hunt_offline_relief"
    emitter = Emitter(hunt_id, repo)
    client = QwenClient()
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        client,
        commands,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)
    events = repo.all_events(hunt_id)

    assert any(wid.startswith("scout") for wid in sup._relieved), "a scout should be relieved"
    assert events[-1].type == "hunt_completed", "the hunt still finishes despite a relieved scout"
    # seq stays dense and every event is schema-valid even on the relief path.
    assert [e.seq for e in events] == list(range(len(events)))
    validator = Draft202012Validator(load_event_schema())
    for e in events:
        assert not list(validator.iter_errors(e.model_dump()))


async def test_offline_warden_heals_faults_and_clones() -> None:
    """v3: the STANDING Warden (adopted, not re-spawned) heals the first fault; a second concurrent
    fault spawns ONE overflow clone. The heal rides the frozen `doctor_*` event types with the
    Warden's id in `doctor_id`."""
    repo = FakeRepo()
    hunt_id = "hunt_warden"
    emitter = Emitter(hunt_id, repo)
    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        QwenClient(),
        asyncio.Queue(),
        source="typed",
        raw_input="a topic",
        strategy="orchestrate",
    )
    # A real hunt spawns the standing roster (which now includes the ×1 Warden) before any fault.
    sup._team = build_team({})
    await sup._spawn_roster()
    assert "warden" in sup._wolves, "the Warden is a standing member spawned at hunt start"
    roster_warden_spawns = sum(
        1
        for e in repo.all_events(hunt_id)
        if e.type == "wolf_spawned" and e.payload["role"] == "warden"
    )
    assert roster_warden_spawns == 1, "exactly one standing Warden at start"

    await sup._stray_event(
        "scout-1", "timeout", None
    )  # adopts the standing 'warden' — no new spawn
    await sup._stray_event("scout-2", "repeat_fail", None)  # a 2nd concurrent fault → one clone
    events = repo.all_events(hunt_id)
    types = [e.type for e in events]

    assert types.count("doctor_dispatched") == 2
    assert types.count("doctor_healed") == 2
    # The standing Warden (spawned by the roster) is ADOPTED for the first heal — no extra spawn — and
    # exactly ONE overflow clone (warden-2) is spawned for the second concurrent fault.
    spawns = [e.payload for e in events if e.type == "wolf_spawned"]
    wardens = [p for p in spawns if p["role"] == "warden"]
    assert len(wardens) == 2, "the standing Warden + one overflow clone"
    assert {w["wolf_id"] for w in wardens} == {"warden", "warden-2"}
    clone = next(w for w in wardens if w["wolf_id"] == "warden-2")
    assert clone.get("parent_wolf_id") == "warden", (
        "the clone records its parent (the standing Warden)"
    )
    # the two heals are attributed to the standing 'warden' and the clone 'warden-2'.
    healers = {e.payload["doctor_id"] for e in events if e.type == "doctor_dispatched"}
    assert healers == {"warden", "warden-2"}
    assert not any(p["role"] == "doctor" for p in spawns), (
        "the Doctor is retired — nothing spawns it"
    )
    # the dispatch/heal are attributed to the Warden (actor + doctor_id both start 'warden').
    for e in events:
        if e.type in ("doctor_dispatched", "doctor_healed"):
            assert e.actor.startswith("warden"), f"{e.type} should be attributed to the Warden"
            assert e.payload["doctor_id"].startswith("warden")
            assert e.payload["target_wolf_id"] in ("scout-1", "scout-2")
    # the Stray path still fires alongside the Warden, and every event is schema-valid.
    assert types.count("stray_detected") == 2 and types.count("stray_recovered") == 2
    validator = Draft202012Validator(load_event_schema())
    for e in events:
        assert not list(validator.iter_errors(e.model_dump()))


async def test_memory_recall_and_remember_roundtrip() -> None:
    """v2: local memory recalls empty on a first hunt, then surfaces a written takeaway."""
    from app.tools.memory import recall, remember

    repo = FakeRepo()
    assert await recall(repo, "finance") == ""  # nothing learned yet
    await remember(repo, "h1", "Prefer primary sources for finance topics.")
    note = await recall(repo, "a finance topic")  # topic-relevant → recalled
    assert "Prefer primary sources" in note
    assert await recall(repo, "medieval poetry") == ""  # unrelated topic → not recalled


async def test_memory_typed_lessons_recall_as_guidance() -> None:
    """v2 (deepened): lessons are TYPED. A preference is a standing rule (surfaces even with no topic
    overlap); topic-bound kinds surface only on a matching topic; recall groups them as guidance."""
    from app.tools.memory import recall, remember

    repo = FakeRepo()
    await remember(repo, "h1", "The Packmaster wants a tight brief, not a long one.", "preference")
    await remember(repo, "h2", "Vendor docs beat news for API pricing questions.", "what-worked")
    await remember(repo, "h3", "The 2026 BNPL figure is 40M users.", "topic-insight")

    # Unrelated topic: only the standing preference carries; the topic-bound lessons stay out.
    note = await recall(repo, "medieval poetry")
    assert "tight brief" in note and "What the Packmaster prefers" in note
    assert "Vendor docs" not in note and "BNPL" not in note

    # A matching topic pulls the topic-bound lesson in too, grouped under its kind header.
    on_topic = await recall(repo, "the BNPL market in 2026")
    assert "BNPL" in on_topic and "already knows about this" in on_topic
    assert "tight brief" in on_topic  # the preference still leads


async def test_offline_elder_recalls_and_remembers() -> None:
    """v2: the Elder appears, recalls seeded memory into planning, and writes a takeaway."""
    repo = FakeRepo()
    await repo.save_memory(None, "takeaway", "On the BNPL market: prefer primary sources.")
    hunt_id = "hunt_elder"
    emitter = Emitter(hunt_id, repo)
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)
    events = repo.all_events(hunt_id)

    assert any(e.type == "wolf_spawned" and e.payload["role"] == "elder" for e in events)
    elder_steps = [
        e for e in events if e.type == "step_started" and e.payload["wolf_id"] == "elder"
    ]
    # The Elder's node lights at BOTH ends: recall at the start, distilling a lesson at the end.
    assert len(elder_steps) == 2, "the Elder appears for recall AND for the end-of-hunt distill"
    assert "Recalled" in elder_steps[0].payload["summary"], "the seeded memory reached recall"
    assert "lesson" in elder_steps[1].payload["summary"].lower()

    # The Elder wrote a NEW, TYPED lesson (a real distill call, not the old flat template).
    assert len(repo.memory) == 2, "the seeded lesson plus one freshly distilled lesson"
    fresh = repo.memory[-1]
    assert fresh["kind"] in ("preference", "what-worked", "what-failed", "topic-insight")
    assert fresh["text"] and "strategy," not in fresh["text"], "a real lesson, not the old template"


async def test_offline_no_sources_is_honest(monkeypatch: pytest.MonkeyPatch) -> None:
    """v3 (3.0): when search returns nothing, the pack returns an honest notice — never a fabricated
    brief — and flags the artifact so the Reward shows a clear empty state."""
    from app.tools import web

    class _Empty:
        ok = True
        data = {"hits": []}
        latency_ms = 5

    async def _empty_run(**_kwargs):
        return _Empty()

    monkeypatch.setattr(web.WEB_SEARCH, "run", _empty_run)

    repo = FakeRepo()
    hunt_id = "hunt_nosrc"
    emitter = Emitter(hunt_id, repo)
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="an extremely obscure topic",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)

    final = next(a for a in repo.artifacts if a["kind"] == "final")
    assert final["content"]["no_sources"] is True
    assert "couldn't find sources" in final["content"]["text"]  # the honest no-results notice
    assert final["content"]["sources"] == []
    assert repo.all_events(hunt_id)[-1].type == "hunt_completed"  # still finishes cleanly


async def test_memory_recall_is_topic_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    """v4.1 + review M2: the Elder's distilled lesson is recalled into a RELATED next hunt, but NOT
    into an unrelated one (global recency would pollute every hunt with irrelevant lessons)."""

    def _run(hunt_id: str, topic: str, repo: FakeRepo) -> Supervisor:
        commands: asyncio.Queue = asyncio.Queue()
        commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
        return Supervisor(
            hunt_id,
            Emitter(hunt_id, repo),
            repo,
            QwenClient(),
            commands,
            source="typed",
            raw_input=topic,
            strategy="orchestrate",
        )

    repo = FakeRepo()
    await asyncio.wait_for(
        _run("hunt_m1", "the solid-state battery market", repo).run(), timeout=15
    )
    # A real, typed lesson was distilled and stored (offline → a `what-worked` lesson naming the topic).
    assert repo.memory and repo.memory[-1]["kind"] != "takeaway"
    assert "solid-state battery" in repo.memory[-1]["text"]

    related = _run("hunt_m2", "solid-state battery supplier costs", repo)
    await asyncio.wait_for(related.run(), timeout=15)
    assert "solid-state battery" in related._memory_note  # relevant lesson reached planning

    unrelated = _run("hunt_m3", "medieval european poetry", repo)
    await asyncio.wait_for(unrelated.run(), timeout=15)
    assert "solid-state battery" not in unrelated._memory_note  # no cross-topic pollution


async def test_resume_after_restart_completes_the_hunt() -> None:
    """B11: a hunt paused at the Boundary survives a 'restart' — a fresh Supervisor rebuilds from the
    event log, waits for /resume, and runs to completion."""
    repo = FakeRepo()
    c1: asyncio.Queue = asyncio.Queue()
    c1.put_nowait({"type": "approve_plan", "mode": "wild", "boundary_usd": 0.001})  # tiny → halts
    sup1 = Supervisor(
        "hunt_resume",
        Emitter("hunt_resume", repo),
        repo,
        QwenClient(),
        c1,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy="orchestrate",
    )
    t1 = asyncio.create_task(sup1.run())
    for _ in range(100):  # wait until it pauses at the Boundary
        if repo.hunts.get("hunt_resume", {}).get("state") == "halted_boundary":
            break
        await asyncio.sleep(0.02)
    assert repo.hunts["hunt_resume"]["state"] == "halted_boundary"
    t1.cancel()  # simulate the engine dying with the hunt paused
    with contextlib.suppress(asyncio.CancelledError):
        await t1

    # Restart: a fresh Supervisor resumes from the event log + a raised Boundary.
    c2: asyncio.Queue = asyncio.Queue()
    c2.put_nowait({"type": "resume", "boundary_usd": 1.0})
    sup2 = Supervisor("hunt_resume", Emitter("hunt_resume", repo), repo, QwenClient(), c2)
    await asyncio.wait_for(sup2.resume_run(), timeout=20)
    assert repo.hunts["hunt_resume"]["state"] == "returned"
    assert any(a["kind"] == "final" for a in repo.artifacts)


async def test_refine_redrafts_and_reforges(monkeypatch: pytest.MonkeyPatch) -> None:
    """A3: refine re-drafts + re-forges from the stored claims/sources, no re-scout."""
    from app.engine.refine import refine_brief

    repo = FakeRepo()
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        "hunt_refine",
        Emitter("hunt_refine", repo),
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)

    before = len(repo.artifacts)
    new_id = await refine_brief(repo, QwenClient(), "hunt_refine", "make it punchier")
    assert new_id is not None
    final = next(a for a in repo.artifacts if a["artifact_id"] == new_id)
    assert final["content"]["refined"] is True and final["content"]["blocks"]
    # A fresh final + the forged files were produced.
    assert len(repo.artifacts) > before
    kinds = {a["kind"] for a in repo.artifacts if a["produced_by"] == "howler"}
    assert {"final", "pdf", "docx"} <= kinds
    assert "forge_completed" in [e.type for e in repo.all_events("hunt_refine")]


async def test_seed_team_overrides_beta_sizing() -> None:
    """v5.1: a saved Instinct's formation seeds the team instead of Beta's per-task sizing."""
    repo = FakeRepo()
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        "hunt_seed",
        Emitter("hunt_seed", repo),
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="anything at all",
        strategy="orchestrate",
        seed_team=[{"role": "scout", "count": 5}],
    )
    await asyncio.wait_for(sup.run(), timeout=15)
    scouts = [
        e.payload["wolf_id"]
        for e in repo.all_events("hunt_seed")
        if e.type == "wolf_spawned" and e.payload.get("role") == "scout"
    ]
    assert len(scouts) == 5  # the seeded 5 scouts, not FakeQwen's default 3


async def test_knowledge_base_doc_becomes_a_source() -> None:
    """v4.2: a relevant library doc is injected into the hunt and shows up as a cited source."""
    repo = FakeRepo()
    await repo.save_document(
        "battery-notes.md",
        "md",
        "Internal notes on the solid-state battery market: supplier roadmap and the cost curve.",
    )
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        "hunt_kb",
        Emitter("hunt_kb", repo),
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="the solid-state battery market",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)

    final = next(a for a in repo.artifacts if a["kind"] == "final")
    all_sources = final["content"]["sources"]
    libs = [s for s in all_sources if str(s.get("url", "")).startswith("lib://")]
    webs = [s for s in all_sources if not str(s.get("url", "")).startswith("lib://")]
    assert libs, "the library doc should appear as a source"
    assert libs[0]["by"] == "your library"
    assert webs, "web + library sources coexist (mixed de-dup keeps both)"
    assert len({s.get("url") for s in all_sources}) == len(all_sources)  # no dupes


def test_broaden_keeps_the_subject_and_drops_filler() -> None:
    """Part 1: broaden() makes a dry scout's retry query — short, plain, subject preserved."""
    task = "the Qwen3 open-source model family"
    query = "Qwen3 code math variants GitHub release notes"
    out = broaden(task, query)
    assert out == broaden(task, query)  # deterministic
    low = out.lower()
    assert "qwen3" in low  # the task subject survives
    assert "github" not in low and "release" not in low and "notes" not in low  # filler dropped
    assert 0 < len(out.split()) <= 7  # capped short so it actually returns hits


async def test_offline_dry_scout_broadens_and_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Part 1: when the scouts' first (narrow) angles come back dry, each broadens once and ranges
    again — so the pack returns with sources instead of collapsing onto a single working scout."""
    from app.tools import web

    class _R:
        def __init__(self, hits: list[dict]) -> None:
            self.ok = True
            self.data = {"hits": hits}
            self.latency_ms = 5

    calls = {"n": 0}

    async def _flaky_search(**_kwargs):
        calls["n"] += 1
        if calls["n"] <= 3:  # the 3 scouts' first angles return nothing
            return _R([])
        n = calls["n"]
        return _R(
            [{"title": f"Hit {n}", "url": f"https://example.com/{n}", "snippet": "real ground"}]
        )

    class _F:
        ok = False
        data = {"text": ""}
        latency_ms = 1

    async def _no_fetch(**_kwargs):
        return _F()

    monkeypatch.setattr(web.WEB_SEARCH, "run", _flaky_search)
    monkeypatch.setattr(web.WEB_FETCH, "run", _no_fetch)

    repo = FakeRepo()
    hunt_id = "hunt_dry"
    emitter = Emitter(hunt_id, repo)
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="a narrow research topic",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)

    final = next(a for a in repo.artifacts if a["kind"] == "final")
    assert final["content"]["no_sources"] is False
    assert final["content"]["sources"], "the broadened retry recovered real sources"
    assert calls["n"] > 3, "the dry first pass triggered at least one broaden retry"


async def test_offline_draft_is_tagged_with_provenance() -> None:
    """v3 (3.2): the final brief carries tagged blocks + a block-level provenance map."""
    repo = FakeRepo()
    hunt_id = "hunt_prov"
    emitter = Emitter(hunt_id, repo)
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)

    final = next(a for a in repo.artifacts if a["kind"] == "final")
    blocks = final["content"]["blocks"]
    assert blocks and all("text" in b and "source_ids" in b for b in blocks)
    assert any(b["source_ids"] for b in blocks), "at least one block cites a source"

    prov = next(a for a in repo.artifacts if a["kind"] == "provenance_map")
    assert prov["content"]["spans"]
    assert final["content"]["span_map_ref"] == prov["artifact_id"]


async def test_offline_forge_renders_real_files() -> None:
    """v3 (3.4): the Forge turns the brief into real MD/HTML/PDF/DOCX files. The bytes go through
    the artifact store (local-disk fallback offline) and come back out through the same seam the
    download route uses — so this also proves the store round-trips a real forged file."""
    from app.storage import load_artifact_bytes

    repo = FakeRepo()
    hunt_id = "hunt_forge"
    emitter = Emitter(hunt_id, repo)
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    sup = Supervisor(
        hunt_id,
        emitter,
        repo,
        QwenClient(),
        commands,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy="orchestrate",
    )
    await asyncio.wait_for(sup.run(), timeout=15)

    kinds = {a["kind"] for a in repo.artifacts}
    assert {"md", "html", "pdf", "docx", "xlsx", "pptx", "png"} <= kinds  # v5.8: broader formats

    async def body(kind: str) -> bytes:
        content = next(a for a in repo.artifacts if a["kind"] == kind)["content"]
        resolved = await load_artifact_bytes(content)
        assert resolved is not None
        return resolved[0]

    assert (await body("pdf")).startswith(b"%PDF")  # a real PDF
    assert (await body("docx")).startswith(b"PK")  # docx/xlsx/pptx are OOXML zips
    assert (await body("xlsx")).startswith(b"PK")
    assert (await body("pptx")).startswith(b"PK")
    assert (await body("png")).startswith(b"\x89PNG")  # a real PNG
    # M1: the export carries its Sources, not just the on-screen Reward.
    assert "## Sources" in (await body("md")).decode("utf-8")
    types = [e.type for e in repo.all_events(hunt_id)]
    assert "forge_started" in types and "forge_completed" in types


@pytest.mark.parametrize("strategy", ["orchestrate", "deep_dive", "critique"])
async def test_offline_topic_awareness(strategy: str) -> None:
    """The hunt is topic-aware: the scouts' real queries mention the task, not a hardcoded demo."""
    events = await _run(strategy)
    tool_calls = [e for e in events if e.type == "tool_called"]
    assert tool_calls, "scouts must actually search"
    assert any(
        "BNPL" in e.payload["args_summary"] or "Nigeria" in e.payload["args_summary"]
        for e in tool_calls
    )


# --- v3: adaptive depth -----------------------------------------------------------------


def _bare_sup(repo: FakeRepo, hunt_id: str, strategy: str | None = "orchestrate") -> Supervisor:
    return Supervisor(
        hunt_id,
        Emitter(hunt_id, repo),
        repo,
        QwenClient(),
        asyncio.Queue(),
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy=strategy,
    )


async def test_normalize_plan_defaults_depth_standard() -> None:
    """A plan with no depth (and an out-of-enum one) normalizes to 'standard' — never an ungated
    string, which would make the frontend z.enum drop the whole plan_proposed event."""
    sup = _bare_sup(FakeRepo(), "hunt_depth_default")
    assert sup._normalize_plan({})["depth"] == "standard"
    assert sup._normalize_plan({"depth": "DEEP"})["depth"] == "deep"  # case-insensitive
    assert sup._normalize_plan({"depth": "huge"})["depth"] == "standard"  # clamped
    assert sup.depth == "standard"  # property reads self._plan


async def test_offline_hunt_carries_depth_on_plan_proposed() -> None:
    """FakeQwen proposes 'standard'; it lands on plan_proposed and drives self.depth."""
    events = await _run("orchestrate")
    plan_ev = next(e for e in events if e.type == "plan_proposed")
    assert plan_ev.payload["depth"] == "standard"


async def test_deep_depth_auto_upgrades_to_deep_dive(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 'deep' plan with no explicit strategy upgrades orchestrate → deep_dive (a 2nd scout round)."""
    from app.qwen import fake as fake_mod

    orig = fake_mod._offline_result

    def deep_plan(intent, task):
        text, parsed = orig(intent, task)
        if intent == "plan" and parsed is not None:
            parsed = {**parsed, "depth": "deep"}
        return text, parsed

    monkeypatch.setattr(fake_mod, "_offline_result", deep_plan)

    repo = FakeRepo()
    hunt_id = "hunt_deep"
    sup = _bare_sup(repo, hunt_id, strategy=None)  # no explicit strategy → eligible to upgrade
    await sup._propose_plan()
    assert sup.depth == "deep"
    assert sup._plan["strategy"] == "deep_dive"
    assert sup._strategy.name == "deep_dive"


async def test_explicit_strategy_beats_deep_upgrade(monkeypatch: pytest.MonkeyPatch) -> None:
    """An explicitly-chosen strategy is never overridden by a 'deep' plan."""
    from app.qwen import fake as fake_mod

    orig = fake_mod._offline_result

    def deep_plan(intent, task):
        text, parsed = orig(intent, task)
        if intent == "plan" and parsed is not None:
            parsed = {**parsed, "depth": "deep"}
        return text, parsed

    monkeypatch.setattr(fake_mod, "_offline_result", deep_plan)
    sup = _bare_sup(FakeRepo(), "hunt_deep_explicit", strategy="orchestrate")
    await sup._propose_plan()
    assert sup.depth == "deep"
    assert sup._strategy.name == "orchestrate"  # explicit choice wins


async def test_approve_applies_user_depth_override() -> None:
    """The user's depth choice on the plan card reaches self._plan before the pack runs; None keeps
    Beta's; an out-of-enum value is ignored."""
    sup = _bare_sup(FakeRepo(), "hunt_override", strategy=None)
    await sup._propose_plan()  # seeds a 'standard' plan
    await sup._approve({"mode": "on_signal", "boundary_usd": 1.0, "depth": "deep"})
    assert sup.depth == "deep"
    # the override doesn't just scale targets — it re-drives the strategy to the deep second round
    assert sup._strategy.name == "deep_dive"
    assert sup._plan["strategy"] == "deep_dive"
    # the approval emits the applied depth (so resume can restore it)
    appr = next(e for e in sup._repo.all_events(sup._hunt_id) if e.type == "plan_approved")
    assert appr.payload["depth"] == "deep"


async def test_approve_depth_none_keeps_proposed_and_bad_is_ignored() -> None:
    sup = _bare_sup(FakeRepo(), "hunt_override_none")
    await sup._propose_plan()
    await sup._approve({"mode": "on_signal", "boundary_usd": 1.0})  # no depth
    assert sup.depth == "standard"
    sup2 = _bare_sup(FakeRepo(), "hunt_override_bad")
    await sup2._propose_plan()
    await sup2._approve({"mode": "on_signal", "boundary_usd": 1.0, "depth": "huge"})
    assert sup2.depth == "standard"  # bad override ignored


async def test_depth_and_strategy_survive_rehydrate(monkeypatch: pytest.MonkeyPatch) -> None:
    """A resumed hunt restores its depth AND its (possibly upgraded) strategy — not the __init__
    default. This is the resume bug the plan folds in."""
    from app.qwen import fake as fake_mod

    orig = fake_mod._offline_result

    def deep_plan(intent, task):
        text, parsed = orig(intent, task)
        if intent == "plan" and parsed is not None:
            parsed = {**parsed, "depth": "deep"}
        return text, parsed

    monkeypatch.setattr(fake_mod, "_offline_result", deep_plan)

    repo = FakeRepo()
    hunt_id = "hunt_resume_depth"
    sup = _bare_sup(repo, hunt_id, strategy=None)
    await sup._propose_plan()  # emits plan_proposed with depth=deep, strategy=deep_dive
    await sup._approve({"mode": "on_signal", "boundary_usd": 1.0})  # emits plan_approved

    # A fresh Supervisor (new process) rehydrates from the event log — default orchestrate/standard.
    fresh = _bare_sup(repo, hunt_id, strategy=None)
    assert fresh.depth == "standard" and fresh._strategy.name == "orchestrate"  # pre-rehydrate
    await fresh._rehydrate_from_events()
    assert fresh.depth == "deep", "depth restored from the plan"
    assert fresh._strategy.name == "deep_dive", "the upgraded strategy is re-resolved, not reverted"


async def test_offline_hunt_reports_real_measured_time() -> None:
    """hunt_completed.totals.time_s is MEASURED wall clock (monotonic), not the plan's est_time guess.
    The offline run does real awaits between approve and complete, so it's strictly positive and small."""
    events = await _run("orchestrate")
    done = next(e for e in events if e.type == "hunt_completed")
    time_s = done.payload["totals"]["time_s"]
    assert time_s > 0.0, "measured, not a frozen 0.0 fallback"
    assert time_s < 60.0, (
        "a sub-second offline run can't take a minute — proves it's not est_time(210)"
    )


# --- Beta planning quality: query dedup/fill, honest assumptions/estimates, depth floor ----------


def _deep_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    """Monkeypatch FakeQwen's plan to report depth='deep' (everything else unchanged)."""
    from app.qwen import fake as fake_mod

    orig = fake_mod._offline_result

    def deep_plan(intent, task):
        text, parsed = orig(intent, task)
        if intent == "plan" and parsed is not None:
            parsed = {**parsed, "depth": "deep"}
        return text, parsed

    monkeypatch.setattr(fake_mod, "_offline_result", deep_plan)


async def test_normalize_plan_dedups_duplicate_queries() -> None:
    """Two identical Beta queries collapse to one and the freed scout slot is backfilled with a
    distinct facet — n scouts always range n DISTINCT angles (dups no longer shrink coverage)."""
    sup = _bare_sup(FakeRepo(), "hunt_dedup")
    plan = sup._normalize_plan(
        {
            "team": [{"role": "scout", "count": 3}],
            "queries": ["EV batteries", "EV batteries", "grid"],
        }
    )
    qs = plan["queries"]
    assert len(qs) == 3
    assert len({q.casefold() for q in qs}) == 3, "no duplicate angle survives"
    assert "grid" in qs and any(q.casefold() == "ev batteries" for q in qs)


async def test_normalize_plan_fills_short_query_list_with_distinct_facets() -> None:
    """One Beta query for a 3-scout team → 3 distinct queries; the fills are real facet angles that
    differ from the Beta query and from each other."""
    sup = _bare_sup(FakeRepo(), "hunt_fill")
    plan = sup._normalize_plan({"team": [{"role": "scout", "count": 3}], "queries": ["one angle"]})
    qs = plan["queries"]
    assert len(qs) == 3 and len({q.casefold() for q in qs}) == 3
    assert qs[0] == "one angle"
    assert all("angle N" not in q for q in qs), "no old '{task} — angle N' placeholder"


async def test_normalize_plan_empty_assumptions_stay_empty() -> None:
    """No assumptions from Beta → an empty array, NOT the old non-editable boilerplate triple."""
    sup = _bare_sup(FakeRepo(), "hunt_assume")
    assert sup._normalize_plan({})["assumptions"] == []
    assert sup._normalize_plan({"assumptions": []})["assumptions"] == []
    assert sup._normalize_plan({"assumptions": ["assuming a small team"]})["assumptions"] == [
        "assuming a small team"
    ]


async def test_normalize_plan_est_always_depth_derived() -> None:
    """Estimates are ALWAYS derived per depth — a bogus/negative Beta number never wins."""
    sup = _bare_sup(FakeRepo(), "hunt_est")
    std = sup._normalize_plan({"depth": "standard", "est_cost": 0, "est_time": -5})
    assert std["est_cost"] == 0.7 and std["est_time"] == 220
    deep = sup._normalize_plan({"depth": "deep", "est_cost": 999.0, "est_time": 999})
    assert deep["est_cost"] == 1.4 and deep["est_time"] == 340


async def test_normalize_plan_carries_summary() -> None:
    """Beta's summary lands on the payload; an empty plan carries an empty summary so a fallback is
    distinguishable from a real plan in the event log."""
    sup = _bare_sup(FakeRepo(), "hunt_summary")
    assert sup._normalize_plan({"summary": "the real plan"})["summary"] == "the real plan"
    assert sup._normalize_plan({})["summary"] == ""


async def test_normalize_plan_depth_floor_from_scout_count() -> None:
    """A team of ≥4 scouts is not a fact-check → floor brief→standard. deep stays deep; a small
    brief stays brief. The floor never forces `deep` (that would spend a second round on a heuristic)."""
    sup = _bare_sup(FakeRepo(), "hunt_floor")
    assert (
        sup._normalize_plan({"team": [{"role": "scout", "count": 5}], "depth": "brief"})["depth"]
        == "standard"
    )
    assert (
        sup._normalize_plan({"team": [{"role": "scout", "count": 5}], "depth": "deep"})["depth"]
        == "deep"
    )
    assert (
        sup._normalize_plan({"team": [{"role": "scout", "count": 2}], "depth": "brief"})["depth"]
        == "brief"
    )


async def test_normalize_plan_depth_floor_reads_seeded_scout_count() -> None:
    """The floor keys off the EFFECTIVE team — an Instinct seed of 5 scouts floors a brief plan to
    standard even though Beta proposed a small team."""
    sup = Supervisor(
        "hunt_floor_seed",
        Emitter("hunt_floor_seed", FakeRepo()),
        FakeRepo(),
        QwenClient(),
        asyncio.Queue(),
        source="typed",
        raw_input="a broad comparison",
        strategy="orchestrate",
        seed_team=[{"role": "scout", "count": 5}],
    )
    plan = sup._normalize_plan({"team": [{"role": "scout", "count": 1}], "depth": "brief"})
    assert plan["depth"] == "standard"


async def test_apply_edits_dedups_and_fills_queries() -> None:
    """User-edited queries get the same dedup-and-fill as _normalize_plan; editing ONLY assumptions
    leaves queries untouched and emits no spurious query diff."""
    sup = _bare_sup(FakeRepo(), "hunt_edits")
    await sup._propose_plan()  # 3 scouts, 3 queries
    original = list(sup._plan["queries"])
    # edit queries: a dup + a short list → deduped and filled to 3 distinct
    await sup._apply_edits({"queries": ["dup", "dup"]})
    edited = sup._plan["queries"]
    assert len(edited) == 3 and len({q.casefold() for q in edited}) == 3
    # editing only assumptions must not rewrite queries
    await sup._apply_edits({"assumptions": ["assuming X"]})
    assert sup._plan["queries"] == edited, "queries untouched when only assumptions edited"
    assert sup._plan["assumptions"] == ["assuming X"]
    assert original  # sanity: there were queries to begin with


async def test_approve_depth_override_redrives_strategy() -> None:
    """Bumping depth to 'deep' at approval re-drives orchestrate → deep_dive AND re-stamps the plan's
    strategy (so a resumed hunt restores it) — not just the merge/draft scaling."""
    sup = _bare_sup(FakeRepo(), "hunt_redrive", strategy=None)
    await sup._propose_plan()  # standard / orchestrate
    assert sup._strategy.name == "orchestrate"
    await sup._approve({"mode": "on_signal", "boundary_usd": 1.0, "depth": "deep"})
    assert sup.depth == "deep"
    assert sup._strategy.name == "deep_dive", (
        "the strategy actually re-drives, not just the targets"
    )
    assert sup._plan["strategy"] == "deep_dive", "the plan stamp is corrected for resume"


async def test_approve_depth_downgrade_reverts_auto_upgrade(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Downgrading a deep (auto-upgraded) hunt back to standard reverts deep_dive → orchestrate — but
    an EXPLICIT strategy is never reverted."""
    _deep_offline(monkeypatch)
    sup = _bare_sup(FakeRepo(), "hunt_revert", strategy=None)  # auto-upgrade eligible
    await sup._propose_plan()
    assert sup._strategy.name == "deep_dive"
    await sup._approve({"mode": "on_signal", "boundary_usd": 1.0, "depth": "standard"})
    assert sup._strategy.name == "orchestrate", "auto-upgrade reverted on downgrade"

    # an explicitly-chosen deep_dive is NOT reverted by a downgrade
    sup2 = _bare_sup(FakeRepo(), "hunt_revert_explicit", strategy="deep_dive")
    await sup2._propose_plan()
    await sup2._approve({"mode": "on_signal", "boundary_usd": 1.0, "depth": "standard"})
    assert sup2._strategy.name == "deep_dive", "explicit strategy survives a downgrade"


async def test_propose_plan_logs_on_empty_beta_plan(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A Beta call that returns nothing structured logs a warning and still produces a usable fallback
    plan (distinct facet queries, standard depth) — a silent planner failure is not allowed."""
    from app.qwen import fake as fake_mod

    orig = fake_mod._offline_result

    def empty_plan(intent, task):
        text, parsed = orig(intent, task)
        return (text, None) if intent == "plan" else (text, parsed)

    monkeypatch.setattr(fake_mod, "_offline_result", empty_plan)
    sup = _bare_sup(FakeRepo(), "hunt_empty")
    with caplog.at_level("WARNING"):
        await sup._propose_plan()
    assert any("facet fallback" in r.message for r in caplog.records), "empty plan is logged"
    qs = sup._plan["queries"]
    assert len(qs) == 3 and len({q.casefold() for q in qs}) == 3, "usable fallback plan"
    assert sup._plan["depth"] == "standard"


async def test_plan_proposed_emits_beta_ready_beat() -> None:
    """After the plan lands, a 'Plan ready' wolf_progress beat settles Beta's node — on the in-enum
    'thinking' phase so it passes the frozen schema (a '' phase would sink the whole stream)."""
    sup = _bare_sup(FakeRepo(), "hunt_ready_beat")
    await sup._propose_plan()
    beats = [
        e
        for e in sup._repo.all_events(sup._hunt_id)
        if e.type == "wolf_progress" and e.payload["wolf_id"] == "beta"
    ]
    ready = [e for e in beats if "Plan ready" in e.payload["text"]]
    assert ready, "a settle beat is emitted when the plan lands"
    assert ready[-1].payload["phase"] == "thinking", "in-enum phase (not '' / 'ready')"
