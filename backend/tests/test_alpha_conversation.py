"""One state-aware Alpha across the whole lifecycle.

Proves the fix for the three disconnected "Alphas": the intake gate now sees a running/delivered hunt
and won't re-scope or relaunch; the ask side-chat classifies each message against live state and
refines the brief, steers a running hunt, or launches a scoped follow-up. Hermetic (offline FakeQwen +
FakeRepo); the router's offline branch is a deterministic keyword heuristic so routes are assertable.
"""

from __future__ import annotations

import httpx
import pytest

from app.core.alpha_state import hunt_state_header, route_intent
from app.dependencies import get_client, get_hunt_slots, get_registry, get_repo
from app.engine.registry import HuntRegistry
from app.main import app
from app.qwen.client import QwenClient

from ._fakes import FakeRepo


def _deps() -> tuple[FakeRepo, HuntRegistry, QwenClient]:
    repo, registry, client = FakeRepo(), HuntRegistry(), QwenClient()
    assert client.offline
    return repo, registry, client


def _override(repo: FakeRepo, registry: HuntRegistry, client: QwenClient) -> None:
    app.dependency_overrides[get_repo] = lambda: repo
    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[get_client] = lambda: client
    app.dependency_overrides[get_hunt_slots] = lambda: None


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def _seed_delivered(repo: FakeRepo, hunt_id: str = "h_done") -> str:
    await repo.create_hunt(hunt_id, "chat", "EU battery subsidies 2026", "orchestrate")
    await repo.set_hunt_state(hunt_id, "completed")
    await repo.save_artifact(
        "art_1",
        hunt_id,
        "final",
        "howler",
        {
            "text": "The subsidy pool grew to €4bn.",
            "blocks": [{"text": "Subsidy pool: €4bn", "source_ids": [1]}],
            "sources": [{"title": "EC", "url": "https://ec.europa.eu/x"}],
        },
    )
    return hunt_id


# --- state header buckets -------------------------------------------------------------------------


class TestStateHeader:
    async def test_no_hunt_is_none_bucket(self) -> None:
        repo, *_ = _deps()
        header, bucket = await hunt_state_header(repo, None)
        assert bucket == "none"
        assert "NO ACTIVE HUNT" in header

    async def test_running_hunt_forbids_relaunch(self) -> None:
        repo, *_ = _deps()
        await repo.create_hunt("h1", "chat", "the topic", "orchestrate")
        await repo.set_hunt_state("h1", "hunting")
        header, bucket = await hunt_state_header(repo, "h1")
        assert bucket == "active"
        assert (
            "ALREADY under way" in header
            and "do NOT start a new hunt" in header.lower()
            or "not start a new hunt" in header.lower()
        )

    async def test_delivered_hunt_carries_brief_summary(self) -> None:
        repo, *_ = _deps()
        hid = await _seed_delivered(repo)
        header, bucket = await hunt_state_header(repo, hid)
        assert bucket == "delivered"
        assert "delivered" in header and "€4bn" in header

    async def test_failed_hunt_is_dead_bucket(self) -> None:
        repo, *_ = _deps()
        await repo.create_hunt("h2", "chat", "t", "orchestrate")
        await repo.set_hunt_state("h2", "failed")
        _header, bucket = await hunt_state_header(repo, "h2")
        assert bucket == "dead"


# --- router (offline heuristic) -------------------------------------------------------------------


class TestRouter:
    @pytest.mark.parametrize(
        "msg,expected",
        [
            ("nice, thanks!", "chatter"),
            ("also research the US equivalent", "new_subhunt"),
            ("redo the intro to be punchier", "refine_rewrite"),
            ("fix the figure in section 2", "refine_patch"),
            ("what does it say about pricing?", "question_about_brief"),
        ],
    )
    async def test_offline_routes_by_keyword(self, msg: str, expected: str) -> None:
        repo, _reg, client = _deps()
        hid = await _seed_delivered(repo)
        route = await route_intent(client, repo, hid, msg, [])
        assert route["route"] == expected


# --- the dispatcher end-to-end via /ask -----------------------------------------------------------


class TestAskDispatcher:
    async def test_chatter_after_delivery_does_not_relaunch(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        hid = await _seed_delivered(repo)
        async with _client() as c:
            r = await c.post(f"/hunts/{hid}/ask", json={"question": "nice, thank you!"})
        assert r.status_code == 200
        body = r.json()
        assert body["action"] == "answer"  # acknowledgement, no new work
        assert body["hunt_id"] is None
        app.dependency_overrides.clear()

    async def test_refine_reworks_the_brief(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        hid = await _seed_delivered(repo)
        finals_before = len(
            [a for a in repo.artifacts if a["hunt_id"] == hid and a["kind"] == "final"]
        )
        async with _client() as c:
            r = await c.post(
                f"/hunts/{hid}/ask", json={"question": "tighten it and lead with the figure"}
            )
        body = r.json()
        assert body["action"] == "refined"
        # refine_brief re-drafts AND re-forges the download formats; the load-bearing check is that a
        # NEW final artifact was persisted (the reward now shows the re-worked brief).
        finals_after = len(
            [a for a in repo.artifacts if a["hunt_id"] == hid and a["kind"] == "final"]
        )
        assert finals_after == finals_before + 1
        app.dependency_overrides.clear()

    async def test_new_subhunt_launches_a_child_hunt(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        hid = await _seed_delivered(repo)
        async with _client() as c:
            r = await c.post(
                f"/hunts/{hid}/ask",
                json={"question": "also research the US battery subsidy program"},
            )
        body = r.json()
        assert body["action"] == "subhunt"
        child = body["hunt_id"]
        assert child and child != hid
        # the child is a real hunt, parented to the original
        snap = await repo.get_hunt_snapshot(child)
        assert snap is not None and snap["parent_hunt_id"] == hid
        app.dependency_overrides.clear()

    async def test_steer_while_running_does_not_spawn_a_duplicate(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        await repo.create_hunt("h_live", "chat", "live topic", "orchestrate")
        await repo.set_hunt_state("h_live", "hunting")
        registry.register("h_live")  # so add_input has somewhere to go
        async with _client() as c:
            r = await c.post(
                "/hunts/h_live/ask", json={"question": "also add a section on pricing"}
            )
        body = r.json()
        assert body["action"] == "steer"  # folded into the running hunt, not a new one
        assert body["hunt_id"] is None
        app.dependency_overrides.clear()

    async def test_retry_on_a_failed_hunt_relaunches_the_same_task(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        await repo.create_hunt("h_fail", "chat", "roadmap to software engineer 2027", "orchestrate")
        await repo.set_hunt_state("h_fail", "failed")
        async with _client() as c:
            r = await c.post("/hunts/h_fail/ask", json={"question": "start again"})
        body = r.json()
        assert body["action"] == "retry"  # Alpha actually re-ran it, didn't just offer to
        child = body["hunt_id"]
        assert child and child != "h_fail"
        snap = await repo.get_hunt_snapshot(child)
        # same task, threaded under the failed original
        assert snap is not None
        assert snap["raw_input"] == "roadmap to software engineer 2027"
        assert snap["parent_hunt_id"] == "h_fail"
        app.dependency_overrides.clear()

    async def test_retry_with_an_adjustment_folds_it_into_the_task(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        await repo.create_hunt("h_fail2", "chat", "roadmap to software engineer", "orchestrate")
        await repo.set_hunt_state("h_fail2", "failed")
        async with _client() as c:
            r = await c.post(
                "/hunts/h_fail2/ask", json={"question": "retry but focus on React and TypeScript"}
            )
        body = r.json()
        assert body["action"] == "retry"
        snap = await repo.get_hunt_snapshot(body["hunt_id"])
        assert snap is not None
        # the base task is preserved AND the adjustment rides along
        assert "roadmap to software engineer" in snap["raw_input"]
        assert "React and TypeScript" in snap["raw_input"]
        app.dependency_overrides.clear()


# --- intake relaunch-suppression ------------------------------------------------------------------


class TestIntakeStateAware:
    async def test_intake_with_running_hunt_never_readies(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        await repo.create_hunt("h_run", "chat", "topic", "orchestrate")
        await repo.set_hunt_state("h_run", "hunting")
        async with _client() as c:
            r = await c.post(
                "/hunts/intake",
                json={
                    "messages": [{"role": "user", "content": "research the whole thing now"}],
                    "hunt_id": "h_run",
                },
            )
        body = r.json()
        assert body["ready"] is False  # a hunt is already running — no relaunch
        app.dependency_overrides.clear()

    async def test_fresh_intake_still_launches(self) -> None:
        repo, registry, client = _deps()
        _override(repo, registry, client)
        async with _client() as c:
            r = await c.post(
                "/hunts/intake",
                json={
                    "messages": [
                        {
                            "role": "user",
                            "content": "research the BNPL market in Nigeria and write a brief",
                        }
                    ]
                },
            )
        body = r.json()
        assert body["ready"] is True  # no hunt yet → a real task launches
        app.dependency_overrides.clear()


class TestStripTrailingQuestion:
    """A launch turn must never end with a question — the composer locks the moment the pack starts,
    so a dangling 'what's most relevant — X, Y, or Z?' strands the Packmaster (the bug the user hit)."""

    def test_drops_a_dangling_final_question(self) -> None:
        from app.core.intake import strip_trailing_question

        s = strip_trailing_question(
            "On it — I'll pull the latest SpaceX news since July 2026. "
            "What's most relevant for you — technical progress, business moves, or policy?"
        )
        assert not s.endswith("?")
        assert "On it" in s and "SpaceX" in s  # the commitment survives

    def test_keeps_a_plain_commitment(self) -> None:
        from app.core.intake import strip_trailing_question

        s = "On it — I'll get the pack on Nigeria's BNPL market and bring back a clean brief."
        assert strip_trailing_question(s) == s  # no question → untouched

    def test_never_returns_empty_when_reply_is_all_question(self) -> None:
        from app.core.intake import strip_trailing_question

        assert strip_trailing_question("What do you want?").strip() != ""
