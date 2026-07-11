"""A single stray scout must never sink the hunt — the pack's core resilience promise.

Regression: running a bigger formation used to FAIL the hunt because one scout raising an
unhandled exception propagated through `asyncio.gather` (no `return_exceptions`) → `run()`'s
`except Exception` → `hunt_failed`. `scout()` now contains any non-control-flow error and returns a
low-confidence Finding, while control-flow (Stop/Boundary) still propagates.
"""

from __future__ import annotations

import asyncio

import pytest

from app.engine.core import Emitter
from app.engine.supervisor import BoundaryHalt, Supervisor
from app.engine.wolves import Wolf
from app.qwen.client import QwenClient

from ._fakes import FakeRepo


async def _run_with_flaky_scout(monkeypatch, exc: Exception) -> list:
    repo = FakeRepo()
    hunt_id = "hunt_stray_scout"
    emitter = Emitter(hunt_id, repo)
    client = QwenClient()
    assert client.offline, "test env has no key, so the brain must be FakeQwen"

    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 2.0})

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

    orig = Supervisor._scout_impl

    async def flaky(self, wolf, wolf_id, query, step_id):
        if wolf_id == "scout-1":  # one scout always blows up; the rest range normally
            raise exc
        return await orig(self, wolf, wolf_id, query, step_id)

    monkeypatch.setattr(Supervisor, "_scout_impl", flaky)
    await asyncio.wait_for(sup.run(), timeout=15)
    return repo.all_events(hunt_id)


async def test_one_erroring_scout_does_not_fail_the_hunt(monkeypatch) -> None:
    events = await _run_with_flaky_scout(monkeypatch, RuntimeError("provider 500 boom"))
    types = {e.type for e in events}
    assert "hunt_completed" in types, "a single stray scout must not sink the hunt"
    assert "hunt_failed" not in types
    assert events[-1].type == "hunt_completed"


async def test_scout_reraises_control_flow(monkeypatch) -> None:
    """A Boundary/Stop raised inside a scout must still propagate — not be swallowed as a stray."""
    repo = FakeRepo()
    sup = Supervisor(
        "hb_ctrl",
        Emitter("hb_ctrl", repo),
        repo,
        QwenClient(),
        asyncio.Queue(),
        source="typed",
        raw_input="x",
        strategy="orchestrate",
    )
    sup._wolves["scout-1"] = sup._make_wolf("scout-1", "scout", "flash", False)

    async def boom(self, wolf, wolf_id, query, step_id):
        raise BoundaryHalt()

    monkeypatch.setattr(Supervisor, "_scout_impl", boom)
    with pytest.raises(BoundaryHalt):
        await sup.scout("scout-1", "q")


async def test_a_failing_downstream_model_call_does_not_fail_the_hunt(monkeypatch) -> None:
    """A model error in a post-scout phase (tracker/sentinel/howler) must degrade, not sink the hunt —
    the exact path that broke bigger formations (more scouts → larger context → the call errors)."""
    repo = FakeRepo()
    hunt_id = "hunt_bad_merge"
    emitter = Emitter(hunt_id, repo)
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 2.0})
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

    orig_think = Wolf.think

    async def flaky_think(self, intent, **kwargs):
        if self.role == "tracker":  # the merge call always errors
            raise RuntimeError("merge model boom")
        return await orig_think(self, intent, **kwargs)

    monkeypatch.setattr(Wolf, "think", flaky_think)
    await asyncio.wait_for(sup.run(), timeout=15)
    types = {e.type for e in repo.all_events(hunt_id)}
    assert "hunt_completed" in types, "a failed downstream call must degrade, not fail the hunt"
    assert "hunt_failed" not in types
