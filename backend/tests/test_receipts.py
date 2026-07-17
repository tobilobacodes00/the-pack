"""The Receipts — per-claim provenance for a delivered brief.

Two layers of proof:
1. HTTP end-to-end: a real offline hunt (FakeQwen's Sentinel always raises one challenge, so the
   enforcement path runs for real) → GET /hunts/{id}/receipts and the share-scoped variant.
2. Unit: build_receipts composed over hand-seeded artifacts/events, pinning the exact join
   semantics (claim → merge claims_src → final sources; issue → claim via the engine's matcher).
"""

from __future__ import annotations

import asyncio

import httpx

from app.dependencies import get_background, get_client, get_registry, get_repo
from app.engine.receipts import build_receipts
from app.engine.registry import HuntRegistry
from app.events.models import Event
from app.main import app
from app.qwen.client import QwenClient

from ._fakes import FakeRepo


def _make_deps() -> tuple[FakeRepo, HuntRegistry, QwenClient]:
    repo = FakeRepo()
    registry = HuntRegistry()
    client = QwenClient()
    assert client.offline
    return repo, registry, client


def _override(repo: FakeRepo, registry: HuntRegistry, client: QwenClient) -> None:
    app.dependency_overrides[get_repo] = lambda: repo
    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[get_client] = lambda: client
    app.dependency_overrides[get_background] = lambda: set()


async def _run_hunt(ac: httpx.AsyncClient, registry: HuntRegistry) -> str:
    r = await ac.post("/hunts", json={"input": "the BNPL market in Nigeria"})
    assert r.status_code == 202
    hunt_id: str = r.json()["hunt_id"]
    handle = registry.get(hunt_id)
    assert handle is not None and handle.task is not None
    await handle.commands.put({"type": "approve_plan", "mode": "on_signal", "boundary_usd": 1.0})
    await asyncio.wait_for(handle.task, timeout=15)
    return hunt_id


VALID_STATUSES = {"verified", "cited", "unsourced", "challenged_kept"}


async def test_receipts_end_to_end_offline_hunt() -> None:
    """A real offline hunt delivers receipts: one row per final claim, statuses in the enum,
    cited source numbers resolving into the final registry, and the critique on record."""
    repo, registry, client = _make_deps()
    _override(repo, registry, client)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        hunt_id = await _run_hunt(ac, registry)
        r = await ac.get(f"/hunts/{hunt_id}/receipts")
        assert r.status_code == 200
        body = r.json()

    # every claim in the delivered brief has a receipt row, verbatim
    final = await repo.get_final_artifact(hunt_id)
    assert final is not None
    final_claims = [c for c in final["content"].get("claims", []) if str(c).strip()]
    assert [row["text"] for row in body["claims"]] == final_claims

    n_sources = len(final["content"].get("sources") or [])
    for row in body["claims"]:
        assert row["status"] in VALID_STATUSES
        for s in row["sources"]:
            assert 1 <= s["n"] <= n_sources, "citation numbers must resolve into the registry"
            assert s["url"]
            assert isinstance(s["verified"], bool)

    # the Sentinel genuinely ran (FakeQwen's critique always raises one challenge offline)
    assert body["critique_ran"] is True
    assert body["totals"]["claims"] == len(final_claims)
    # enforcement is on the receipt: the flagged claim was either kept-with-challenge or dropped
    assert body["totals"]["challenged_kept"] + body["totals"]["dropped"] >= 1


async def test_receipts_404_before_a_brief_exists() -> None:
    repo, registry, client = _make_deps()
    _override(repo, registry, client)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        r = await ac.post("/hunts", json={"input": "anything"})
        hunt_id = r.json()["hunt_id"]
        # don't approve — no brief, no receipts
        rec = await ac.get(f"/hunts/{hunt_id}/receipts")
        assert rec.status_code == 404
        unknown = await ac.get("/hunts/not-a-hunt/receipts")
        assert unknown.status_code == 404
        # let the pending supervisor task finish cleanly (it awaits approval; stop it)
        handle = registry.get(hunt_id)
        if handle is not None and handle.task is not None:
            await handle.commands.put({"type": "stop"})
            await asyncio.wait_for(handle.task, timeout=15)


async def test_share_receipts_public_variant() -> None:
    """The share token unlocks the same receipts publicly — an answer travels with its proof."""
    repo, registry, client = _make_deps()
    _override(repo, registry, client)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as ac:
        hunt_id = await _run_hunt(ac, registry)
        token = (await ac.post(f"/hunts/{hunt_id}/share")).json()["token"]
        pub = await ac.get(f"/share/{token}/receipts")
        auth = await ac.get(f"/hunts/{hunt_id}/receipts")
        assert pub.status_code == 200
        assert pub.json() == auth.json()
        assert (await ac.get("/share/bad-token/receipts")).status_code == 404


# ---------------------------------------------------------------------------
# Unit: the exact join semantics over seeded records
# ---------------------------------------------------------------------------


def _event(hunt_id: str, seq: int, type_: str, actor: str, payload: dict) -> Event:
    return Event(
        event_id=f"ev_{seq}",
        hunt_id=hunt_id,
        seq=seq,
        ts="2026-07-16T00:00:00Z",
        actor=actor,
        type=type_,
        payload=payload,
    )


async def _seed(repo: FakeRepo, hunt_id: str) -> None:
    await repo.create_hunt(hunt_id, "typed", "solar adoption in Kenya")
    sources = [
        {"title": "IEA report", "url": "https://iea.org/x", "by": "scout-1", "verified": True},
        {"title": "News piece", "url": "https://news.com/y", "by": "scout-2", "verified": False},
        {"title": "My notes", "url": "lib://42", "by": "your library", "verified": True},
    ]
    await repo.save_artifact(
        "art_merge",
        hunt_id,
        "draft",
        "tracker",
        {
            "summary": "merged",
            "claims": [
                "Kenya added 300MW of solar in 2025",  # verified source
                "Adoption is driven by falling panel prices",  # unverified source only
                "A vendor claims 90% market share",  # flagged + dropped
                "Grid instability accelerates home solar",  # library-cited
            ],
            "claims_src": [[1], [2], [], [3]],
        },
    )
    await repo.save_artifact(
        "art_critique",
        hunt_id,
        "critique",
        "sentinel",
        {
            "ok": False,
            "issues": [{"claim": "A vendor claims 90% market share", "problem": "no source"}],
        },
    )
    # the final brief: the flagged claim did NOT survive
    await repo.save_artifact(
        "art_final",
        hunt_id,
        "final",
        "howler",
        {
            "text": "brief",
            "blocks": [],
            "claims": [
                "Kenya added 300MW of solar in 2025",
                "Adoption is driven by falling panel prices",
                "Grid instability accelerates home solar",
            ],
            "sources": sources,
        },
    )
    await repo.append_event(
        _event(
            hunt_id,
            0,
            "standoff_opened",
            "sentinel",
            {
                "standoff_id": "s1",
                "challenger": "sentinel",
                "defendant": "tracker",
                "claim_ref": "art_merge",
            },
        )
    )
    await repo.append_event(
        _event(
            hunt_id,
            1,
            "standoff_resolved",
            "alpha",
            {"standoff_id": "s1", "outcome": "alpha_call", "rationale": "no source held up"},
        )
    )


async def test_build_receipts_join_semantics() -> None:
    repo = FakeRepo()
    await _seed(repo, "h_r1")
    data = await build_receipts(repo, "h_r1", task="solar adoption in Kenya")
    assert data is not None

    by_text = {r["text"]: r for r in data["claims"]}
    # verified: cites source 1 (fetched), found by scout-1
    row = by_text["Kenya added 300MW of solar in 2025"]
    assert row["status"] == "verified"
    assert row["sources"][0]["n"] == 1
    assert row["sources"][0]["by"] == "scout-1"
    # cited-but-not-read: source 2 is snippet-level
    assert by_text["Adoption is driven by falling panel prices"]["status"] == "cited"
    # library coverage: the doc is credited and counted
    lib_row = by_text["Grid instability accelerates home solar"]
    assert lib_row["sources"][0]["library"] is True
    assert data["documents"] == [{"doc_id": "42", "title": "My notes", "cited_by_claims": 1}]
    # the dropped claim is on the receipt with the Sentinel's reason
    assert data["dropped"] == [{"text": "A vendor claims 90% market share", "problem": "no source"}]
    # the standoff is on record
    assert data["standoff"] == {
        "challenger": "sentinel",
        "defendant": "tracker",
        "outcome": "alpha_call",
        "rationale": "no source held up",
    }
    # division of labor
    assert data["wolves"]["scout-1"] == {"sources": 1, "verified": 1}
    assert data["wolves"]["scout-2"] == {"sources": 1, "verified": 0}
    # claim 1 → verified (read web source); claim 2 → cited (snippet only); claim 3 → verified
    # (library sources are injected as verified — the pack genuinely read the excerpt)
    statuses = [r["status"] for r in data["claims"]]
    assert statuses == ["verified", "cited", "verified"]
    assert data["totals"] == {
        "claims": 3,
        "verified": 2,
        "cited": 1,
        "unsourced": 0,
        "challenged_kept": 0,
        "dropped": 1,
    }


async def test_build_receipts_none_without_final() -> None:
    repo = FakeRepo()
    await repo.create_hunt("h_r2", "typed", "anything")
    assert await build_receipts(repo, "h_r2") is None


# ---------------------------------------------------------------------------
# Regression: two claims with IDENTICAL text but DIFFERENT sources must each keep their own
# citation (the text-`.index()` join collapsed both onto the first occurrence — wrong URL/wolf).
# ---------------------------------------------------------------------------


async def test_duplicate_claim_text_keeps_its_own_source_exact_path() -> None:
    """The final artifact carries `claims_src` in lockstep with `claims`; two rows of the same text
    but different sources each resolve to THEIR OWN source, by position — not both to the first."""
    repo = FakeRepo()
    hunt_id = "h_dup"
    await repo.create_hunt(hunt_id, "typed", "widget market")
    sources = [
        {"title": "Source A", "url": "https://a.example/x", "by": "scout-1", "verified": True},
        {"title": "Source C", "url": "https://c.example/z", "by": "scout-3", "verified": True},
    ]
    # The merge draft has the same fact twice, cited to two DIFFERENT sources.
    await repo.save_artifact(
        "art_merge",
        hunt_id,
        "draft",
        "tracker",
        {
            "summary": "m",
            "claims": ["Widget sales grew 20% in Q1", "Widget sales grew 20% in Q1"],
            "claims_src": [[1], [2]],
        },
    )
    # The final brief keeps BOTH — and (the fix) persists claims_src in lockstep.
    await repo.save_artifact(
        "art_final",
        hunt_id,
        "final",
        "howler",
        {
            "text": "brief",
            "blocks": [],
            "claims": ["Widget sales grew 20% in Q1", "Widget sales grew 20% in Q1"],
            "claims_src": [[1], [2]],
            "sources": sources,
        },
    )
    data = await build_receipts(repo, hunt_id, task="widget market")
    assert data is not None
    rows = data["claims"]
    assert len(rows) == 2
    # First occurrence → source #1 (scout-1); second → source #2 (scout-3). NOT both source #1.
    assert [s["n"] for s in rows[0]["sources"]] == [1]
    assert rows[0]["sources"][0]["by"] == "scout-1"
    assert [s["n"] for s in rows[1]["sources"]] == [2]
    assert rows[1]["sources"][0]["by"] == "scout-3"


async def test_duplicate_claim_text_dropped_is_multiset_not_set() -> None:
    """Two identical merge rows, only ONE survives → exactly one drop counted (not zero, not two)."""
    repo = FakeRepo()
    hunt_id = "h_dupdrop"
    await repo.create_hunt(hunt_id, "typed", "x")
    await repo.save_artifact(
        "art_merge",
        hunt_id,
        "draft",
        "tracker",
        {"summary": "m", "claims": ["Same fact", "Same fact"], "claims_src": [[1], [2]]},
    )
    await repo.save_artifact(
        "art_final",
        hunt_id,
        "final",
        "howler",
        {
            "text": "b",
            "blocks": [],
            "claims": ["Same fact"],  # only one survived
            "claims_src": [[1]],
            "sources": [{"title": "A", "url": "https://a/x", "by": "scout-1", "verified": True}],
        },
    )
    data = await build_receipts(repo, hunt_id, task="x")
    assert data is not None
    assert data["totals"]["dropped"] == 1
    assert [d["text"] for d in data["dropped"]] == ["Same fact"]


async def test_legacy_final_without_claims_src_uses_consume_on_match() -> None:
    """A final artifact predating the claims_src field still attributes duplicate-text claims
    correctly, via the consume-on-match fallback against the merge draft (no positional ids)."""
    repo = FakeRepo()
    hunt_id = "h_legacy"
    await repo.create_hunt(hunt_id, "typed", "x")
    sources = [
        {"title": "A", "url": "https://a/x", "by": "scout-1", "verified": True},
        {"title": "C", "url": "https://c/z", "by": "scout-3", "verified": True},
    ]
    await repo.save_artifact(
        "art_merge",
        hunt_id,
        "draft",
        "tracker",
        {"summary": "m", "claims": ["Dup fact", "Dup fact"], "claims_src": [[1], [2]]},
    )
    # NOTE: no "claims_src" on the final artifact → forces the legacy path.
    await repo.save_artifact(
        "art_final",
        hunt_id,
        "final",
        "howler",
        {"text": "b", "blocks": [], "claims": ["Dup fact", "Dup fact"], "sources": sources},
    )
    data = await build_receipts(repo, hunt_id, task="x")
    assert data is not None
    rows = data["claims"]
    # consume-on-match: first claim → merge row 0 (src 1), second → merge row 1 (src 2)
    assert [s["n"] for s in rows[0]["sources"]] == [1]
    assert [s["n"] for s in rows[1]["sources"]] == [2]


# ---------------------------------------------------------------------------
# Regression: a critique that never COMPLETED must read as "did not run", not a silent pass.
# ---------------------------------------------------------------------------


async def test_unverified_critique_reads_as_not_run() -> None:
    """The Sentinel timed out/faulted → `_unverified()` persists a critique artifact with
    completed=False. The receipt must say verification did NOT run and carry the reason."""
    repo = FakeRepo()
    hunt_id = "h_unv"
    await repo.create_hunt(hunt_id, "typed", "x")
    await repo.save_artifact(
        "art_merge",
        hunt_id,
        "draft",
        "tracker",
        {"summary": "m", "claims": ["A claim"], "claims_src": [[1]]},
    )
    await repo.save_artifact(
        "art_final",
        hunt_id,
        "final",
        "howler",
        {
            "text": "b",
            "blocks": [],
            "claims": ["A claim"],
            "claims_src": [[1]],
            "sources": [{"title": "A", "url": "https://a/x", "by": "scout-1", "verified": True}],
        },
    )
    # The Sentinel's non-completion placeholder, exactly as supervisor._unverified() persists it.
    await repo.save_artifact(
        "art_critique",
        hunt_id,
        "critique",
        "sentinel",
        {
            "ok": False,
            "completed": False,
            "issues": [
                {"claim": "", "problem": "verification did not complete — claims are unverified"}
            ],
        },
    )
    data = await build_receipts(repo, hunt_id, task="x")
    assert data is not None
    assert data["critique_ran"] is False
    assert "did not complete" in data["review_note"]


async def test_completed_critique_reads_as_run() -> None:
    """A genuine, completed critique (completed=True) reads as verification-ran, with no note."""
    repo = FakeRepo()
    await _seed(repo, "h_ran")
    # _seed's critique artifact predates the completed flag → defaults to True (a real completion).
    data = await build_receipts(repo, "h_ran", task="solar adoption in Kenya")
    assert data is not None
    assert data["critique_ran"] is True
    assert data["review_note"] == ""
