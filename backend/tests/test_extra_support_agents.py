"""Adding a second (or third) support agent must never crash the hunt.

The bug: `roster.wolf_ids` renamed the PRIMARY of a cloned support role to `tracker-1`, but the
merge/critique/draft steps address it by the bare id (`self._wolves["tracker"]`), so the moment a
Packmaster added a second tracker/sentinel/howler in the formation editor the hunt died with
`KeyError: 'tracker'` right after the scouts finished. These pin the fix end to end: the primary keeps
its bare id, and a support step resolves defensively so no formation edit can crash setup.
"""

from __future__ import annotations

import asyncio

from app.engine.core import Emitter
from app.engine.roster import build_team, wolf_ids
from app.engine.supervisor import Supervisor
from app.qwen.client import QwenClient

from ._fakes import FakeRepo


# --- the id convention (unit) ---------------------------------------------------------------------


def test_primary_support_keeps_bare_id_extras_suffixed_from_2() -> None:
    # The load-bearing invariant: instance #1 is always the bare role, so self._wolves[role] resolves.
    for role in ("tracker", "sentinel", "howler"):
        assert wolf_ids(role, 1) == [role]
        assert wolf_ids(role, 2) == [role, f"{role}-2"]
        assert wolf_ids(role, 3) == [role, f"{role}-2", f"{role}-3"]
        assert wolf_ids(role, 2)[0] == role  # primary never renamed to role-1


def test_scouts_still_all_suffixed() -> None:
    assert wolf_ids("scout", 3) == ["scout-1", "scout-2", "scout-3"]


# --- end-to-end: a hunt with doubled support agents completes -------------------------------------


def _team_with_doubled_support() -> list[dict]:
    """The canonical team, but tracker/sentinel/howler each at count 2 — the exact formation edit that
    used to KeyError the hunt."""
    team = build_team({})
    for entry in team:
        if entry["role"] in ("tracker", "sentinel", "howler"):
            entry["count"] = 2
    return team


async def _run_with_team(team: list[dict], strategy: str = "critique") -> list:
    repo = FakeRepo()
    hunt_id = f"hunt_extra_{strategy}"
    client = QwenClient()
    assert client.offline
    commands: asyncio.Queue = asyncio.Queue()
    commands.put_nowait({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 2.0})
    sup = Supervisor(
        hunt_id,
        Emitter(hunt_id, repo),
        repo,
        client,
        commands,
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy=strategy,
        seed_team=team,
    )
    await asyncio.wait_for(sup.run(), timeout=20)
    return repo.all_events(hunt_id)


async def test_hunt_with_two_trackers_completes_not_crashes() -> None:
    events = await _run_with_team(_team_with_doubled_support(), strategy="orchestrate")
    kinds = [e.type for e in events]
    assert "hunt_completed" in kinds, f"expected completion, got tail {kinds[-3:]}"
    assert "hunt_failed" not in kinds
    # the primary tracker actually ran the merge (its bare id resolved)
    assert any(e.actor == "tracker" and e.type == "step_completed" for e in events)


async def test_critique_strategy_with_doubled_support_completes() -> None:
    # critique exercises sentinel + a possible standoff — the sentinel bare-id path.
    events = await _run_with_team(_team_with_doubled_support(), strategy="critique")
    kinds = [e.type for e in events]
    assert "hunt_completed" in kinds and "hunt_failed" not in kinds


async def test_deep_dive_with_doubled_support_completes() -> None:
    events = await _run_with_team(_team_with_doubled_support(), strategy="deep_dive")
    kinds = [e.type for e in events]
    assert "hunt_completed" in kinds and "hunt_failed" not in kinds
