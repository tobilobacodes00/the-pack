"""Elder memory v6 — visible, vetoable, and CITABLE cross-hunt memory.

Three layers:
1. tools/memory.py unit: recall_items ranking is recall()'s exact input; as_sources mirrors the
   library's lib:// pattern with memory://<id>.
2. Engine e2e (offline): a seeded lesson relevant to the task lands in the FINAL artifact's
   sources as memory://<id> — the brief can cite the pack's memory like any other source — and an
   ARCHIVED (vetoed) lesson never does.
3. HTTP: GET /memory exposes id/status (archived included), PATCH edits/vetoes/restores,
   DELETE /memory/{id} forgets one lesson; recall honors the veto.
"""

from __future__ import annotations

import asyncio

import httpx

from app.dependencies import get_background, get_client, get_registry, get_repo
from app.engine.registry import HuntRegistry
from app.main import app
from app.qwen.client import QwenClient
from app.tools.memory import as_sources, recall, recall_items

from ._fakes import FakeRepo

TASK = "the BNPL market in Nigeria"


async def _seed_lessons(repo: FakeRepo) -> None:
    # relevant + active → must be recalled and citable
    await repo.save_memory("h_old1", "topic-insight", "Nigeria BNPL adoption doubled in 2025")
    # a standing preference → always recalled
    await repo.save_memory("h_old2", "preference", "prefers primary sources over aggregators")
    # relevant but VETOED → must never steer or be cited again
    await repo.save_memory("h_old3", "what-worked", "BNPL vendor blogs in Nigeria are reliable")
    await repo.update_memory(3, status="archived")
    # irrelevant to the task → filtered by ranking
    await repo.save_memory("h_old4", "what-failed", "quantum annealing benchmarks are noisy")


# ---------------------------------------------------------------------------
# 1. tools/memory.py unit
# ---------------------------------------------------------------------------


async def test_recall_items_respect_the_veto_and_the_topic() -> None:
    repo = FakeRepo()
    await _seed_lessons(repo)
    items = await recall_items(repo, TASK)
    texts = [i["text"] for i in items]
    assert "Nigeria BNPL adoption doubled in 2025" in texts
    assert "prefers primary sources over aggregators" in texts  # preferences always carry
    assert "BNPL vendor blogs in Nigeria are reliable" not in texts  # archived = vetoed
    assert "quantum annealing benchmarks are noisy" not in texts  # no topic overlap
    # recall() is exactly the rendered form of these items
    note = await recall(repo, TASK)
    for t in texts:
        assert t in note


async def test_as_sources_mirrors_the_library_pattern() -> None:
    repo = FakeRepo()
    await _seed_lessons(repo)
    items = await recall_items(repo, TASK)
    sources = as_sources(items)
    assert sources, "recalled lessons must be citable"
    for s in sources:
        assert s["url"].startswith("memory://")
        assert s["by"] == "elder"
        assert s["verified"] is True
        assert s["title"].startswith("Pack memory")
        assert s["text"]
    # ids are real row ids — the memory page can resolve a citation back to the lesson
    assert {s["url"] for s in sources} == {"memory://1", "memory://2"}


# ---------------------------------------------------------------------------
# 2. Engine e2e: the citation path
# ---------------------------------------------------------------------------


def _override(repo: FakeRepo, registry: HuntRegistry, client: QwenClient) -> None:
    app.dependency_overrides[get_repo] = lambda: repo
    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[get_client] = lambda: client
    app.dependency_overrides[get_background] = lambda: set()


async def _run_hunt(ac: httpx.AsyncClient, registry: HuntRegistry) -> str:
    r = await ac.post("/hunts", json={"input": TASK})
    assert r.status_code == 202
    hunt_id: str = r.json()["hunt_id"]
    handle = registry.get(hunt_id)
    assert handle is not None and handle.task is not None
    await handle.commands.put({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    await asyncio.wait_for(handle.task, timeout=15)
    return hunt_id


async def test_recalled_lessons_are_citable_in_the_final_brief() -> None:
    repo = FakeRepo()
    registry = HuntRegistry()
    client = QwenClient()
    assert client.offline
    await _seed_lessons(repo)
    _override(repo, registry, client)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        hunt_id = await _run_hunt(ac, registry)

    final = await repo.get_final_artifact(hunt_id)
    assert final is not None
    urls = {str(s.get("url") or "") for s in final["content"].get("sources", [])}
    # the ACTIVE relevant lessons entered the registry — the pack's memory is a first-class source
    assert "memory://1" in urls
    assert "memory://2" in urls
    # the vetoed lesson did NOT
    assert "memory://3" not in urls


# ---------------------------------------------------------------------------
# 3. HTTP: the visible, vetoable memory surface
# ---------------------------------------------------------------------------


async def test_memory_http_surface() -> None:
    repo = FakeRepo()
    registry = HuntRegistry()
    client = QwenClient()
    await _seed_lessons(repo)
    _override(repo, registry, client)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        # the page sees EVERYTHING, id'd and status'd — archived included, for the record
        r = await ac.get("/memory")
        assert r.status_code == 200
        rows = r.json()["memory"]
        assert {m["id"] for m in rows} == {1, 2, 3, 4}
        assert {m["status"] for m in rows} == {"active", "archived"}

        # edit a lesson's text
        assert (
            await ac.patch("/memory/1", json={"text": "Nigeria BNPL adoption tripled in 2025"})
        ).status_code == 200
        # veto one; restore it; veto again
        assert (await ac.patch("/memory/2", json={"status": "archived"})).status_code == 200
        assert (await ac.patch("/memory/2", json={"status": "active"})).status_code == 200

        # invalid edits are rejected loudly
        assert (await ac.patch("/memory/1", json={})).status_code == 422
        assert (await ac.patch("/memory/1", json={"status": "banished"})).status_code == 422
        assert (await ac.patch("/memory/1", json={"text": "   "})).status_code == 422
        assert (await ac.patch("/memory/999", json={"status": "archived"})).status_code == 404

        # forget one for good
        assert (await ac.delete("/memory/4")).status_code == 200
        assert (await ac.delete("/memory/4")).status_code == 404
        rows = (await ac.get("/memory")).json()["memory"]
        assert {m["id"] for m in rows} == {1, 2, 3}
        edited = next(m for m in rows if m["id"] == 1)
        assert edited["text"] == "Nigeria BNPL adoption tripled in 2025"

    # and the veto is honored by recall itself
    await repo.update_memory(1, status="archived")
    items = await recall_items(repo, TASK)
    assert all(i["id"] != 1 for i in items)
