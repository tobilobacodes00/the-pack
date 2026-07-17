"""The Flight Recorder — the public, share-scoped replay of a hunt's full event log.

GET /share/{token}/tracks resolves a share token (minted by POST /hunts/{id}/share) to that ONE
hunt's redacted event stream, so anyone with the link can replay how the brief was produced —
without the global API token and without access to any other hunt. Drives a real offline hunt
through the HTTP layer first, so the replayed log is a genuine one, not a fixture.
"""

from __future__ import annotations

import asyncio

import httpx

from app.dependencies import get_background, get_client, get_registry, get_repo
from app.engine.registry import HuntRegistry
from app.main import app
from app.qwen.client import QwenClient

from ._fakes import FakeRepo


def _make_deps() -> tuple[FakeRepo, HuntRegistry, QwenClient]:
    repo = FakeRepo()
    registry = HuntRegistry()
    client = QwenClient()
    assert client.offline, "these tests must run offline (no QWEN_API_KEY in test env)"
    return repo, registry, client


def _override(repo: FakeRepo, registry: HuntRegistry, client: QwenClient) -> None:
    app.dependency_overrides[get_repo] = lambda: repo
    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[get_client] = lambda: client
    app.dependency_overrides[get_background] = lambda: set()


def _transport() -> httpx.ASGITransport:
    return httpx.ASGITransport(app=app)


async def _run_hunt_to_completion(ac: httpx.AsyncClient, registry: HuntRegistry) -> str:
    r = await ac.post("/hunts", json={"input": "the BNPL market in Nigeria"})
    assert r.status_code == 202
    hunt_id: str = r.json()["hunt_id"]
    handle = registry.get(hunt_id)
    assert handle is not None and handle.task is not None
    await handle.commands.put({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    await asyncio.wait_for(handle.task, timeout=15)
    return hunt_id


async def test_share_tracks_replays_the_whole_hunt() -> None:
    """share → /share/{token}/tracks returns the SAME event log as the authenticated export:
    every event, dense seq from 0, redaction flagged — the full replay behind one public token."""
    repo, registry, client = _make_deps()
    _override(repo, registry, client)

    async with httpx.AsyncClient(transport=_transport(), base_url="http://test") as ac:
        hunt_id = await _run_hunt_to_completion(ac, registry)

        shared = await ac.post(f"/hunts/{hunt_id}/share")
        assert shared.status_code == 200
        token = shared.json()["token"]

        public = await ac.get(f"/share/{token}/tracks")
        assert public.status_code == 200
        body = public.json()
        assert body["redacted"] is True
        assert body["title"]  # a human title for the replay page header
        assert "hunt_id" not in body  # the token IS the capability — no id leak in the envelope

        # The public replay carries the entire log, in order, from seq 0.
        auth = await ac.get(f"/hunts/{hunt_id}/tracks/export")
        assert auth.status_code == 200
        auth_events = auth.json()["events"]
        assert len(body["events"]) == len(auth_events) > 0
        seqs = [e["seq"] for e in body["events"]]
        assert seqs == list(range(len(seqs))), "replay must be the dense, ordered log"
        types = [e["type"] for e in body["events"]]
        assert types[0] == "hunt_created" and "hunt_completed" in types


async def test_share_tracks_unknown_token_is_404() -> None:
    repo, registry, client = _make_deps()
    _override(repo, registry, client)
    async with httpx.AsyncClient(transport=_transport(), base_url="http://test") as ac:
        r = await ac.get("/share/not-a-real-token/tracks")
    assert r.status_code == 404


async def test_share_tracks_scope_is_one_hunt() -> None:
    """A token minted for hunt A must never replay hunt B — the capability's scope is the hunt
    it was minted for, full stop."""
    repo, registry, client = _make_deps()
    _override(repo, registry, client)

    async with httpx.AsyncClient(transport=_transport(), base_url="http://test") as ac:
        hunt_a = await _run_hunt_to_completion(ac, registry)
        hunt_b = await _run_hunt_to_completion(ac, registry)
        assert hunt_a != hunt_b

        token_a = (await ac.post(f"/hunts/{hunt_a}/share")).json()["token"]
        body = (await ac.get(f"/share/{token_a}/tracks")).json()
        replayed_hunt_ids = {e["hunt_id"] for e in body["events"]}
        assert replayed_hunt_ids == {hunt_a}, "token A must replay ONLY hunt A's events"
