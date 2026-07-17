"""Shadow Hunt rehearsal (v2) — a pure, deterministic cost/time estimate + team validation."""

from __future__ import annotations

import httpx

from app.dependencies import get_client, get_registry, get_repo
from app.engine.registry import HuntRegistry
from app.engine.rehearse import rehearse, validate_team
from app.main import app
from app.qwen.client import QwenClient

from ._fakes import FakeRepo


def test_rehearse_scales_with_scouts() -> None:
    one = rehearse([{"role": "scout", "count": 1}], "orchestrate")
    five = rehearse([{"role": "scout", "count": 5}], "orchestrate")
    assert one["scouts"] == 1 and five["scouts"] == 5
    assert five["est_cost_usd"] > one["est_cost_usd"] > 0
    assert five["est_time_s"] > 0


def test_rehearse_deep_dive_costs_more() -> None:
    team = [{"role": "scout", "count": 3}]
    deep = rehearse(team, "deep_dive")["est_cost_usd"]
    shallow = rehearse(team, "orchestrate")["est_cost_usd"]
    assert deep > shallow


def test_validate_team_flags_issues() -> None:
    assert any("cap" in w for w in validate_team([{"role": "scout", "count": 9}]))
    assert validate_team([{"role": "scout", "count": 3}]) == []
    assert any("dropped" in w for w in validate_team([{"role": "wizard", "count": 1}]))


# ---------------------------------------------------------------------------
# The HTTP route (POST /hunts/{id}/rehearse) — the endpoint the PlanCard editor calls live.
# A malformed team must 422 at the boundary, never crash rehearse() with an uncaught 500.
# ---------------------------------------------------------------------------


def _override() -> None:
    app.dependency_overrides[get_repo] = lambda: FakeRepo()
    app.dependency_overrides[get_registry] = lambda: HuntRegistry()
    app.dependency_overrides[get_client] = lambda: QwenClient()


async def test_rehearse_route_ok() -> None:
    _override()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post(
            "/hunts/anyhunt/rehearse",
            json={"team": [{"role": "scout", "count": 3}], "strategy": "orchestrate"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["scouts"] == 3
    assert body["est_cost_usd"] > 0


async def test_rehearse_route_malformed_count_is_422_not_500() -> None:
    """A non-numeric count used to crash _scout_count() with an uncaught ValueError → 500.
    RehearseBody.TeamEntry now validates it, so the boundary returns a clean 422."""
    _override()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post(
            "/hunts/anyhunt/rehearse",
            json={
                "team": [{"role": "scout", "count": "abc"}],
                "strategy": "orchestrate",
                "depth": "standard",
            },
        )
    assert r.status_code == 422


async def test_rehearse_route_default_team_when_absent() -> None:
    _override()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post("/hunts/anyhunt/rehearse", json={})
    assert r.status_code == 200
    assert r.json()["scouts"] == 3  # the built-in default formation
