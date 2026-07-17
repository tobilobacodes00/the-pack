"""Hunt lifecycle routes — create, approve, command, artifact, share, and Alpha chat."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from openai import APIStatusError, RateLimitError

from app.config import settings
from app.core.alpha_state import (
    alpha_system,
    hunt_state_header,
    route_intent,
)
from app.core.intake import (
    _SSE_HEADERS,
    ALPHA_INTAKE,
    cancel_task,
    last_user,
    looks_like_task,
    parse_intake,
    safe_reply,
    stream_tokens,
    strip_trailing_question,
)
from app.db.repo import Repo
from app.dependencies import (
    _accepted,
    get_background,
    get_client,
    get_draining,
    get_hunt_slots,
    get_registry,
    get_repo,
)
from app.engine.benchmark import run_benchmark
from app.engine.core import Emitter
from app.engine.ids import new_hunt_id
from app.engine.receipts import build_receipts
from app.engine.refine import refine_brief
from app.engine.registry import HuntRegistry
from app.engine.rehearse import rehearse
from app.engine.supervisor import Supervisor
from app.qwen.client import QwenClient
from app.qwen.types import CallSpec
from app.schemas import (
    AddInput,
    ApprovePlan,
    ArtifactResponse,
    ArtifactsListResponse,
    AskAlpha,
    AskReply,
    ClearedResponse,
    CommandAccepted,
    CreateHunt,
    FeedbackBody,
    FeedbackResponse,
    HuntCreated,
    HuntDeleteResponse,
    HuntListResponse,
    HuntPatch,
    HuntPatchResponse,
    HuntSnapshot,
    IntakeBody,
    IntakeReply,
    MessageIn,
    MessagesResponse,
    OkResponse,
    ReceiptsResponse,
    RefineBody,
    RefineResponse,
    RehearseBody,
    RehearseResponse,
    ResolveHold,
    ResumeHunt,
    ScorecardResponse,
    SharedResponse,
    SharedTracksResponse,
    ShareResponse,
    TracksResponse,
)
from app.storage import load_artifact_bytes
from app.tools.redact import redact_event

router = APIRouter(tags=["hunts"])

# Allowed download formats — must stay in sync with forge._RENDERERS (guarded by a test).
_DOWNLOADABLE = {"md", "html", "pdf", "docx", "xlsx", "pptx", "png"}


# ---------------------------------------------------------------------------
# Hunt CRUD
# ---------------------------------------------------------------------------


@router.post("/hunts", status_code=202, response_model=HuntCreated)
async def create_hunt(
    body: CreateHunt,
    repo: Repo = Depends(get_repo),
    registry: HuntRegistry = Depends(get_registry),
    client: QwenClient = Depends(get_client),
    slots: asyncio.Semaphore | None = Depends(get_hunt_slots),
    draining: bool = Depends(get_draining),
) -> JSONResponse:
    """Open a hunt. Returns 202 with the new hunt_id; the Supervisor starts planning at once.

    Watch `hunt_created` → `plan_proposed` arrive on the stream, then POST `/plan/approve`.
    """
    # Admission gate: once shutdown has begun, refuse new work with 503 so a hunt isn't spawned into a
    # process whose pool/registry is being torn down (a load balancer retries the 503 elsewhere).
    if draining:
        return JSONResponse(
            status_code=503, content={"detail": "pack is shutting down — try again shortly"}
        )
    # Concurrency gate: reject rather than spawn an unbounded background task under load. No await
    # between locked() and acquire(), so the check-then-acquire can't race (single-threaded loop).
    if slots is not None:
        if slots.locked():
            return JSONResponse(
                status_code=429, content={"detail": "pack is busy — too many hunts running"}
            )
        await slots.acquire()

    hunt_id = new_hunt_id()
    strategy = body.strategy or settings.default_strategy
    raw_input = body.input or ""
    seed_team: list[dict] | None = body.team if body.team else None

    if body.instinct_id:
        inst = await repo.get_instinct(body.instinct_id)
        if inst is not None:
            spec = inst.get("spec") or {}
            raw_input = body.input or str(spec.get("task") or inst.get("label") or "").strip()
            strategy = body.strategy or str(spec.get("strategy") or strategy)
            team = spec.get("team")
            if isinstance(team, list) and team:
                seed_team = team

    try:
        await _launch_hunt(
            hunt_id,
            repo,
            registry,
            client,
            source=body.source,
            raw_input=raw_input,
            strategy=strategy,
            seed_team=seed_team,
            slots=slots,
            parent_hunt_id=None,
        )
    except BaseException:
        if slots is not None:  # nothing will run → don't leak the slot
            slots.release()
        raise
    return _accepted({"hunt_id": hunt_id, "state": "planning"})


async def _launch_hunt(
    hunt_id: str,
    repo: Repo,
    registry: HuntRegistry,
    client: QwenClient,
    *,
    source: str,
    raw_input: str,
    strategy: str,
    seed_team: list[dict] | None,
    slots: asyncio.Semaphore | None,
    parent_hunt_id: str | None,
) -> None:
    """Create a hunt row + spawn its Supervisor task. Shared by the front-door `POST /hunts` and the
    chat-driven follow-up sub-hunt, so a hunt launched from a conversation is a first-class hunt with
    the same lifecycle, events, and slot accounting. `parent_hunt_id` records provenance when this is a
    follow-up spun off an existing brief (so the frontend can thread it under the original)."""
    await repo.create_hunt(hunt_id, source, raw_input, strategy)
    if parent_hunt_id:
        await repo.set_parent_hunt(hunt_id, parent_hunt_id)
    handle = registry.register(hunt_id)
    emitter = Emitter(hunt_id, repo)
    supervisor = Supervisor(
        hunt_id,
        emitter,
        repo,
        client,
        handle.commands,
        source=source,
        raw_input=raw_input,
        strategy=strategy,
        seed_team=seed_team,
    )
    handle.task = asyncio.create_task(supervisor.run(), name=f"hunt-{hunt_id}")
    # From here the task owns the slot: free it whenever the hunt ends (done / failed / cancelled).
    if slots is not None:
        handle.task.add_done_callback(lambda _t: slots.release())


@router.get("/hunts", response_model=HuntListResponse)
async def list_hunts(
    project_id: str | None = None,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    repo: Repo = Depends(get_repo),
) -> dict:
    """Recent hunts, newest first — the Den's Past Hunts list. Optionally scoped to a project.
    Cursor pagination: pass the returned `next_cursor` to page older (null when no more)."""
    hunts = await repo.list_hunts(limit=limit + 1, project_id=project_id, cursor=cursor)
    has_more = len(hunts) > limit
    hunts = hunts[:limit]
    # Composite cursor: "{created_at}|{hunt_id}" — stable across identical timestamps.
    next_cursor = (
        f"{hunts[-1]['created_at']}|{hunts[-1]['hunt_id']}" if (has_more and hunts) else None
    )
    return {"hunts": hunts, "next_cursor": next_cursor}


@router.delete("/hunts", response_model=ClearedResponse)
async def clear_hunts(repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Clear all hunt history (Settings → Clear hunt history). Leaves documents/memory/instincts."""
    await repo.clear_all_hunts()
    return JSONResponse({"cleared": True})


@router.get("/hunts/{hunt_id}", response_model=HuntSnapshot)
async def get_hunt(hunt_id: str, repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Snapshot: state plus last_seq (for reconnect/replay). 404 if the hunt is unknown."""
    snap = await repo.get_hunt_snapshot(hunt_id)
    if snap is None:
        return JSONResponse(status_code=404, content={"detail": "hunt not found"})
    created = snap.get("created_at")
    updated = snap.get("updated_at")
    return JSONResponse(
        content={
            "hunt_id": snap["hunt_id"],
            "state": snap["state"],
            "last_seq": snap["last_seq"],
            "task": snap["raw_input"],
            "strategy": snap.get("strategy", "orchestrate"),
            "project_id": snap.get("project_id"),
            "created_at": created.isoformat() if created else None,
            "updated_at": updated.isoformat() if updated else None,
        }
    )


@router.patch("/hunts/{hunt_id}", response_model=HuntPatchResponse)
async def patch_hunt(hunt_id: str, body: HuntPatch, repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Rename or archive a hunt (Den history management)."""
    if body.title is not None:
        await repo.rename_hunt(hunt_id, body.title.strip()[:120])
    if body.archived is not None:
        await repo.set_archived(hunt_id, body.archived)
    if "project_id" in body.model_fields_set:
        await repo.assign_hunt(hunt_id, body.project_id)
    return JSONResponse({"hunt_id": hunt_id, "ok": True})


@router.delete("/hunts/{hunt_id}", response_model=HuntDeleteResponse)
async def delete_hunt(hunt_id: str, repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Delete a hunt and everything hanging off it."""
    await repo.delete_hunt(hunt_id)
    return JSONResponse({"hunt_id": hunt_id, "deleted": True})


# ---------------------------------------------------------------------------
# Hunt commands (202 → stream)
# ---------------------------------------------------------------------------


@router.post("/hunts/{hunt_id}/plan/approve", status_code=202, response_model=CommandAccepted)
async def approve_plan(
    hunt_id: str,
    body: ApprovePlan,
    registry: HuntRegistry = Depends(get_registry),
) -> JSONResponse:
    """Approve the plan and set the Boundary. The hunt begins; events flow on the stream."""
    ok = await registry.send(
        hunt_id,
        {
            "type": "approve_plan",
            "mode": body.mode,
            "boundary_usd": body.boundary_usd,
            "edits": body.edits,
            "depth": body.depth,  # v3: user's depth override (None keeps Beta's)
        },
    )
    if not ok:
        return JSONResponse(status_code=404, content={"detail": "hunt not running here"})
    return _accepted({"hunt_id": hunt_id, "accepted": True})


@router.post("/hunts/{hunt_id}/inputs", status_code=202, response_model=CommandAccepted)
async def add_input(
    hunt_id: str,
    body: AddInput,
    registry: HuntRegistry = Depends(get_registry),
) -> JSONResponse:
    """Mid-hunt input. The pack absorbs it at the next synthesis step without restarting."""
    ok = await registry.send(hunt_id, {"type": "add_input", "text": body.text, "kind": body.kind})
    if not ok:
        return JSONResponse(status_code=404, content={"detail": "hunt not running here"})
    return _accepted({"hunt_id": hunt_id, "accepted": True})


@router.post(
    "/hunts/{hunt_id}/holds/{hold_id}/resolve",
    status_code=202,
    response_model=CommandAccepted,
)
async def resolve_hold(
    hunt_id: str,
    hold_id: str,
    body: ResolveHold,
    registry: HuntRegistry = Depends(get_registry),
) -> JSONResponse:
    """Answer an open Hold. The hunt resumes from where it paused."""
    ok = await registry.send(
        hunt_id,
        {
            "type": "resolve_hold",
            "hold_id": hold_id,
            "resolution": body.resolution,
            "edited_text": body.edited_text,
        },
    )
    if not ok:
        return JSONResponse(status_code=404, content={"detail": "hunt not running here"})
    return _accepted({"hunt_id": hunt_id, "hold_id": hold_id, "accepted": True})


@router.post("/hunts/{hunt_id}/stop", status_code=202, response_model=CommandAccepted)
async def stop_hunt(hunt_id: str, registry: HuntRegistry = Depends(get_registry)) -> JSONResponse:
    """Stop the hunt. Emits `hunt_stopped` and winds the Supervisor down."""
    ok = await registry.send(hunt_id, {"type": "stop"})
    if not ok:
        return JSONResponse(status_code=404, content={"detail": "hunt not running here"})
    return _accepted({"hunt_id": hunt_id, "accepted": True})


@router.post("/hunts/{hunt_id}/resume", status_code=202, response_model=CommandAccepted)
async def resume_hunt(
    hunt_id: str,
    body: ResumeHunt,
    registry: HuntRegistry = Depends(get_registry),
) -> JSONResponse:
    """Resume a Boundary-halted hunt by raising the Boundary."""
    ok = await registry.send(hunt_id, {"type": "resume", "boundary_usd": body.boundary_usd})
    if not ok:
        return JSONResponse(status_code=404, content={"detail": "hunt not running here"})
    return _accepted({"hunt_id": hunt_id, "accepted": True})


@router.post("/hunts/{hunt_id}/benchmark", status_code=202, response_model=CommandAccepted)
async def benchmark(
    hunt_id: str,
    repo: Repo = Depends(get_repo),
    client: QwenClient = Depends(get_client),
    background: set = Depends(get_background),
) -> JSONResponse:
    """Run the Lone Wolf vs the Pack. Launches a background scorer."""
    snap = await repo.get_hunt_snapshot(hunt_id)
    if snap is None:
        return JSONResponse(status_code=404, content={"detail": "hunt not found"})
    emitter = Emitter(hunt_id, repo)
    task_desc = snap.get("raw_input", "") or "the task"

    async def _guarded() -> None:
        # A fire-and-forget benchmark that raises after the 202 must fail LOUDLY, not vanish: without
        # this, an exception in run_benchmark (a provider error, a non-numeric judge response) kills
        # the task silently, no benchmark_completed ever lands, and the Scorecard poll spins forever.
        # We log it so it's diagnosable; the frontend poll is separately bounded so the UI recovers.
        try:
            await run_benchmark(hunt_id, emitter, repo, client, task_desc)
        except Exception:  # noqa: BLE001 — background boundary: never let it die unlogged
            logging.getLogger("pack").exception("benchmark failed for hunt %s", hunt_id)

    task_obj = asyncio.create_task(_guarded(), name=f"benchmark-{hunt_id}")
    background.add(task_obj)
    task_obj.add_done_callback(background.discard)
    return _accepted({"hunt_id": hunt_id, "accepted": True})


# ---------------------------------------------------------------------------
# Hunt reads
# ---------------------------------------------------------------------------


@router.get("/hunts/{hunt_id}/messages", response_model=MessagesResponse)
async def get_messages(hunt_id: str, repo: Repo = Depends(get_repo)) -> dict:
    """The saved Alpha conversation for a hunt (durable, cross-device)."""
    return {"messages": await repo.list_messages(hunt_id)}


@router.post("/hunts/{hunt_id}/messages", status_code=202, response_model=OkResponse)
async def post_message(
    hunt_id: str, body: MessageIn, repo: Repo = Depends(get_repo)
) -> JSONResponse:
    """Append one conversation turn to a hunt's durable chat."""
    await repo.save_message(hunt_id, body.role, body.content)
    return JSONResponse(status_code=202, content={"ok": True})


@router.post("/hunts/{hunt_id}/feedback", response_model=OkResponse)
async def submit_feedback(
    hunt_id: str, body: FeedbackBody, repo: Repo = Depends(get_repo)
) -> JSONResponse:
    """Record a thumbs-up or thumbs-down vote for one Alpha turn."""
    await repo.save_feedback(hunt_id, body.turn_index, body.vote)
    return JSONResponse({"ok": True})


@router.get("/hunts/{hunt_id}/feedback", response_model=FeedbackResponse)
async def get_feedback(hunt_id: str, repo: Repo = Depends(get_repo)) -> dict:
    """The votes recorded on a hunt's Alpha turns + up/down tallies."""
    return await repo.feedback_for_hunt(hunt_id)


@router.get("/hunts/{hunt_id}/scorecard", response_model=ScorecardResponse)
async def get_scorecard(hunt_id: str, repo: Repo = Depends(get_repo)) -> JSONResponse:
    """The latest benchmark Scorecard for a hunt (Lone Wolf vs Pack), or 404 if none yet."""
    events = await repo.replay_events(hunt_id, 0)
    for e in reversed(events):
        if e.type == "benchmark_completed":
            return JSONResponse(content={"hunt_id": hunt_id, "scorecard": e.payload["scorecard"]})
    return JSONResponse(status_code=404, content={"detail": "no benchmark yet"})


@router.get("/hunts/{hunt_id}/tracks/export", response_model=TracksResponse)
async def export_tracks(hunt_id: str, repo: Repo = Depends(get_repo)) -> dict:
    """Redacted Tracks export — the full event log with PII masked in every payload."""
    events = await repo.replay_events(hunt_id, 0)
    redacted = [redact_event(e.model_dump()) for e in events]
    return {"hunt_id": hunt_id, "events": redacted, "redacted": True}


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------


@router.get("/hunts/{hunt_id}/artifact", response_model=ArtifactResponse)
async def get_artifact(hunt_id: str, repo: Repo = Depends(get_repo)) -> JSONResponse:
    """The hunt's final artifact (Howler's draft) for the reading view. 404 if none yet."""
    artifact = await repo.get_final_artifact(hunt_id)
    if artifact is None:
        return JSONResponse(status_code=404, content={"detail": "no final artifact yet"})
    return JSONResponse(content=artifact)


@router.post("/hunts/{hunt_id}/refine", status_code=202, response_model=RefineResponse)
async def refine_hunt(
    hunt_id: str,
    body: RefineBody,
    repo: Repo = Depends(get_repo),
    client: QwenClient = Depends(get_client),
) -> JSONResponse:
    """Re-draft + re-forge the brief from its existing claims/sources (no re-scout). The new files
    land on the event stream; the Reward refreshes. 404 if no brief, 400 if it had no sources."""
    art = await repo.get_final_artifact(hunt_id)
    if art is None:
        return JSONResponse(status_code=404, content={"detail": "no brief to refine yet"})
    artifact_id = await refine_brief(repo, client, hunt_id, body.instruction)
    if artifact_id is None:
        return JSONResponse(status_code=400, content={"detail": "no sources to refine"})
    return _accepted({"hunt_id": hunt_id, "artifact_id": artifact_id, "accepted": True})


@router.get("/hunts/{hunt_id}/artifacts", response_model=ArtifactsListResponse)
async def list_artifacts(hunt_id: str, repo: Repo = Depends(get_repo)) -> dict:
    """The forged files for this hunt (the Reward's format tabs) — id + kind only."""
    rows = await repo.list_artifacts(hunt_id)
    return {"artifacts": [r for r in rows if r["kind"] in _DOWNLOADABLE]}


@router.get("/hunts/{hunt_id}/artifacts/{artifact_id}")
async def download_artifact(
    hunt_id: str,
    artifact_id: str,
    request: Request,
    repo: Repo = Depends(get_repo),
) -> Response:
    """Download one forged file — resolved from the artifact store (Alibaba OSS in prod, disk
    offline; legacy rows carry the bytes inline), with the right content-type and a filename.
    Artifacts are immutable so we issue a strong ETag and honor If-None-Match → 304."""
    row = await repo.get_artifact_row(artifact_id)
    if row is None or row["hunt_id"] != hunt_id:
        return JSONResponse(status_code=404, content={"detail": "artifact not found"})
    content = row.get("content") or {}
    etag = f'"{artifact_id}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    resolved = await load_artifact_bytes(content)
    if resolved is None:
        return JSONResponse(status_code=404, content={"detail": "not a downloadable file"})
    data, mime = resolved
    filename = f"pack-brief.{row['kind']}"
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "ETag": etag,
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    )


# ---------------------------------------------------------------------------
# Share
# ---------------------------------------------------------------------------


@router.post("/hunts/{hunt_id}/share", response_model=ShareResponse)
async def share_hunt(hunt_id: str, repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Mint (or reuse) a public read-only token for this hunt's brief."""
    token = secrets.token_urlsafe(9)
    await repo.set_share_token(hunt_id, token)
    return JSONResponse({"token": token})


@router.get("/share/{token}", response_model=SharedResponse)
async def get_share(token: str, repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Public read-only view of a shared brief (no hunt id, no chat)."""
    data = await repo.get_shared(token)
    if data is None:
        return JSONResponse(status_code=404, content={"detail": "not found"})
    return JSONResponse(content=data)


@router.get("/share/{token}/tracks", response_model=SharedTracksResponse)
async def get_share_tracks(token: str, repo: Repo = Depends(get_repo)) -> dict:
    """The public Flight Recorder: the shared hunt's full redacted event log, so anyone with the
    link can REPLAY how the brief was produced — every decision, every challenge, every dollar.
    Keyed by the share token (scope: exactly this hunt), with the same PII/secret redaction as the
    authenticated Tracks export."""
    meta = await repo.get_shared_meta(token)
    if meta is None:
        raise HTTPException(status_code=404, detail="not found")
    events = await repo.replay_events(meta["hunt_id"], 0)
    redacted = [redact_event(e.model_dump()) for e in events]
    return {"title": meta["title"], "events": redacted, "redacted": True}


@router.get("/share/{token}/receipts", response_model=ReceiptsResponse)
async def get_share_receipts(token: str, repo: Repo = Depends(get_repo)) -> dict:
    """Public Receipts for a shared brief — the same per-claim audit trail the owner sees, scoped
    by the share token. A shared answer travels with its proof."""
    meta = await repo.get_shared_meta(token)
    if meta is None:
        raise HTTPException(status_code=404, detail="not found")
    snap = await repo.get_hunt_snapshot(meta["hunt_id"])
    data = await build_receipts(repo, meta["hunt_id"], task=(snap or {}).get("raw_input") or "")
    if data is None:
        raise HTTPException(status_code=404, detail="no receipts yet — no brief delivered")
    return data


# ---------------------------------------------------------------------------
# Receipts
# ---------------------------------------------------------------------------


@router.get("/hunts/{hunt_id}/receipts", response_model=ReceiptsResponse)
async def get_receipts(hunt_id: str, repo: Repo = Depends(get_repo)) -> dict:
    """The Receipts — per-claim provenance for this hunt's delivered brief: every claim's sources
    (who found each, was the page actually read), the Sentinel's challenges and outcomes, the
    claims that were dropped in verification, and your-documents coverage. 404 until a brief
    exists."""
    snap = await repo.get_hunt_snapshot(hunt_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="unknown hunt")
    data = await build_receipts(repo, hunt_id, task=snap.get("raw_input") or "")
    if data is None:
        raise HTTPException(status_code=404, detail="no receipts yet — no brief delivered")
    return data


# ---------------------------------------------------------------------------
# Rehearse
# ---------------------------------------------------------------------------


@router.post("/hunts/{hunt_id}/rehearse", response_model=RehearseResponse)
async def rehearse_hunt(hunt_id: str, body: RehearseBody) -> dict:
    """Shadow Hunt (safety rail): estimate this team's cost + time before the pack runs.

    The team is validated/coerced by RehearseBody.TeamEntry, so a malformed payload (e.g. a
    non-numeric count) 422s at the boundary rather than crashing rehearse() with a 500."""
    strategy = body.strategy or settings.default_strategy
    team = [e.model_dump() for e in body.team] if body.team else [{"role": "scout", "count": 3}]
    return rehearse(team, strategy, body.depth or "standard")


# ---------------------------------------------------------------------------
# Alpha intake (clarify-gate)
# ---------------------------------------------------------------------------


# The frontend tags Alpha's turns with role "alpha" (its own UI convention). DashScope/OpenAI only
# accept system|assistant|user|tool|function — sending "alpha" (or any other custom role) back in the
# history 400s the whole call ("alpha is not one of [...]"), which surfaced as an intermittent
# "Something went wrong" the moment a conversation had any prior Alpha turn. Map roles to the standard
# set before ANY history reaches the model: alpha/assistant → assistant, everything else → user.
def _model_history(messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        content = m.get("content")
        if not content:
            continue
        role = str(m.get("role") or "user").lower()
        norm = "assistant" if role in ("alpha", "assistant") else "user"
        out.append({"role": norm, "content": content})
    return out


@router.post("/hunts/intake", response_model=IntakeReply)
async def intake(
    body: IntakeBody,
    client: QwenClient = Depends(get_client),
    repo: Repo = Depends(get_repo),
) -> JSONResponse:
    """Front-door gate, now state-aware: Alpha is ONE continuous lead. If the conversation already has
    a running or delivered hunt (body.hunt_id), the injected [HUNT STATE] header stops it re-asking
    scoping questions or relaunching — it converses about the live/finished hunt instead. Only a fresh,
    hunt-less turn can signal ready. No hunt is created here — the frontend creates one on ready=true."""
    msgs = [m for m in body.messages if m.get("content")]
    last = last_user(msgs)

    # Coarse lifecycle bucket for THIS conversation — gates whether a launch is even allowed.
    _header, bucket = await hunt_state_header(repo, body.hunt_id)
    hunt_in_flight = bucket in ("active", "delivered", "dead")

    if client.offline:
        # A hunt already exists for this thread → never relaunch; just acknowledge (the state-aware
        # live model gives a real reply; offline stays deterministic).
        if hunt_in_flight:
            ack = {
                "active": "The pack is on it right now — I'll bring back what they find.",
                "delivered": "That one's done — the brief's ready. Want me to refine it or dig further?",
                "dead": "That hunt ended early — want me to retry or adjust it?",
            }[bucket]
            return JSONResponse({"reply": ack, "ready": False, "brief": ""})
        if looks_like_task(last):
            return JSONResponse(
                {
                    "reply": "On it — I'll get the Pack on that.",
                    "ready": True,
                    "brief": last.strip()[:200],
                }
            )
        return JSONResponse(
            {
                "reply": "I'm Alpha — I lead the Pack. Ask me anything, or tell me what you'd"
                " like looked into, written, or sorted.",
                "ready": False,
                "brief": "",
            }
        )

    system, _bucket = await alpha_system(repo, body.hunt_id, task_gate=ALPHA_INTAKE)
    try:
        result = await client.complete(
            CallSpec(
                hunt_id=body.hunt_id or "intake",
                wolf_id="alpha",
                tier="plus",
                intent="intake",
                messages=[{"role": "system", "content": system}, *_model_history(msgs)],
            )
        )
    except RateLimitError as exc:
        raise HTTPException(429, detail="rate_limit") from exc
    except APIStatusError as e:
        if "content_filter" in str(e):
            raise HTTPException(400, detail="content_filter") from e
        raise HTTPException(500, detail=str(e)) from e

    text = (result.text or "").strip()
    parsed = parse_intake(text)
    if parsed is not None:
        _fallback = "Tell me what you want the pack to hunt down."
        reply = str(parsed.get("reply") or "").strip() or _fallback
        ready = bool(parsed.get("ready"))
        brief = str(parsed.get("brief") or "").strip()
    else:
        reply = safe_reply(text)
        ready = False
        brief = ""
    # Safety net: a hunt already in flight for this thread must never trigger a second launch, even if
    # the model slips and says ready=true — the state header should prevent it, but belt-and-braces.
    if hunt_in_flight:
        ready, brief = False, ""
    if ready and not brief:
        brief = last.strip()[:200]
    if ready:
        # On launch the composer locks — a trailing question would strand the Packmaster. The prompt
        # forbids it; this guarantees it (drops a dangling final question if the model slipped).
        reply = strip_trailing_question(reply)
    return JSONResponse({"reply": reply, "ready": ready, "brief": brief})


@router.post("/hunts/intake/stream")
async def intake_stream(
    request: Request,
    body: IntakeBody,
    client: QwenClient = Depends(get_client),
    repo: Repo = Depends(get_repo),
) -> StreamingResponse:
    """SSE variant of /intake — yields `token` events as text arrives, then a `done` event.
    State-aware like /intake: an in-flight hunt for this thread suppresses relaunch."""
    msgs = [m for m in body.messages if m.get("content")]
    last = last_user(msgs)
    _header, bucket = await hunt_state_header(repo, body.hunt_id)
    hunt_in_flight = bucket in ("active", "delivered", "dead")

    if client.offline:
        if hunt_in_flight:
            reply = {
                "active": "The pack is on it right now — I'll bring back what they find.",
                "delivered": "That one's done — the brief's ready. Want me to refine it or dig deeper?",
                "dead": "That hunt ended early — want me to retry or adjust it?",
            }[bucket]
            ready, brief = False, ""
        elif looks_like_task(last):
            reply, ready, brief = "On it — I'll get the Pack on that.", True, last.strip()[:200]
        else:
            reply = "I'm Alpha — I lead the Pack. Ask me anything, or tell me what to look into."
            ready, brief = False, ""

        async def _offline_gen():
            yield f"data: {json.dumps({'type': 'token', 'text': reply})}\n\n"
            done = {"type": "done", "reply": reply, "ready": ready, "brief": brief}
            yield f"data: {json.dumps(done)}\n\n"

        return StreamingResponse(
            _offline_gen(), media_type="text/event-stream", headers=_SSE_HEADERS
        )

    system, _b = await alpha_system(repo, body.hunt_id, task_gate=ALPHA_INTAKE)
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def _on_delta(delta: str) -> None:
        await queue.put(delta)

    async def _gen():
        async def _run():
            r = await client.complete(
                CallSpec(
                    hunt_id=body.hunt_id or "intake",
                    wolf_id="alpha",
                    tier="plus",
                    intent="intake",
                    force_stream=True,
                    messages=[{"role": "system", "content": system}, *_model_history(msgs)],
                ),
                on_delta=_on_delta,
            )
            await queue.put(None)
            return r

        task = asyncio.create_task(_run())
        try:
            async for frame in stream_tokens(queue, request):
                yield frame
            try:
                result = await task
            except RateLimitError:
                yield f"data: {json.dumps({'type': 'error', 'kind': 'rate_limit'})}\n\n"
                return
            except APIStatusError as e:
                kind = "content_filter" if "content_filter" in str(e) else "unknown"
                yield f"data: {json.dumps({'type': 'error', 'kind': kind})}\n\n"
                return
            text = (result.text or "").strip()
            parsed = parse_intake(text)
            if parsed is not None:
                reply = str(parsed.get("reply") or "").strip() or "Tell me what you want the pack."
                ready = bool(parsed.get("ready"))
                brief = str(parsed.get("brief") or "").strip()
            else:
                reply, ready, brief = safe_reply(text), False, ""
            if hunt_in_flight:  # never relaunch over a live/finished hunt
                ready, brief = False, ""
            if ready and not brief:
                brief = last.strip()[:200]
            if ready:
                reply = strip_trailing_question(reply)
            # On a launch turn the streamed tokens may have included a trailing question; signal the
            # client to REPLACE the streamed text with this cleaned reply so nothing dangles.
            done = {
                "type": "done",
                "reply": reply,
                "ready": ready,
                "brief": brief,
                "replace": bool(ready),
            }
            yield f"data: {json.dumps(done)}\n\n"
        finally:
            await cancel_task(task)

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


# ---------------------------------------------------------------------------
# Alpha ask (side-chat about a hunt)
# ---------------------------------------------------------------------------

# How much of the delivered brief Alpha carries into the side-chat (chars). Enough for a full
# report's substance without blowing the context on a plus-tier chat call.
_ASK_BRIEF_BUDGET = 6_000


async def _ask_system(repo: Repo, hunt_id: str, *, full_brief: bool = False) -> str:
    """Alpha's side-chat system prompt, built on the ONE state-aware Alpha (persona + live [HUNT STATE]
    header via alpha_system) plus the chat rules. The state header already carries a SUMMARY of the
    delivered brief; `full_brief=True` additionally injects the brief's FULL text + sources — used on a
    refine turn where Alpha needs the exact wording to re-angle it (the sliding-window-plus-summary
    pattern: cheap by default, full fidelity only when editing)."""
    chat_gate = (
        "You're in the side-chat about this hunt. Answer in plain English, present tense, warm and "
        "concise. Never expose internal machinery. Ground answers in the hunt's real findings; if a "
        "question goes beyond them, say so plainly and offer what the pack could dig into next."
    )
    system, _bucket = await alpha_system(repo, hunt_id, task_gate=chat_gate)

    if full_brief:
        art = await repo.get_final_artifact(hunt_id)
        content = (art or {}).get("content") or {}
        text = str(content.get("text") or "").strip()
        if not text:  # older artifacts may carry only blocks
            blocks = content.get("blocks") or []
            text = "\n\n".join(
                str(b.get("text") or "").strip() for b in blocks if b.get("text")
            ).strip()
        if text:
            sources = content.get("sources") or []
            src_lines = "\n".join(
                f"[{i}] {s.get('title') or s.get('url') or ''}".strip()
                for i, s in enumerate(sources[:12], start=1)
                if s.get("title") or s.get("url")
            )
            system += f"\n\nThe delivered brief, in full:\n{text[:_ASK_BRIEF_BUDGET]}" + (
                f"\n\nIts sources:\n{src_lines}" if src_lines else ""
            )
    return system


# Routes that DO something to the brief vs. routes that just talk. Only the "act" routes run the
# router's side effects (refine / sub-hunt / steer); everything else is a plain grounded reply.
_ACT_ROUTES = {"refine_patch", "refine_rewrite", "new_subhunt", "new_hunt", "retry"}


async def _act_on_intent(
    route: dict,
    hunt_id: str,
    message: str,
    repo: Repo,
    client: QwenClient,
    registry: HuntRegistry,
    slots: asyncio.Semaphore | None,
    draining: bool = False,
) -> dict:
    """Carry out what the router decided, INTERPRETED THROUGH the live hunt state. Returns
    {action, hunt_id?, reply_hint} — reply_hint is a short truthful line Alpha weaves into its reply so
    the Packmaster knows what just happened. Falls back to a plain answer on anything it can't do."""
    r = route["route"]
    _header, bucket = await hunt_state_header(repo, hunt_id)
    # Steering a live hunt (add_input) stays allowed during drain — that hunt is already in-flight and
    # will drain normally. Only SPAWNING a NEW follow-up hunt is refused below (same 503 posture as
    # create_hunt), phrased as a graceful chat answer rather than an HTTP error since this is the chat path.
    _draining_answer = {
        "action": "answer",
        "hunt_id": None,
        "reply_hint": "The pack's winding down for a moment — ask me again shortly and I'll launch that.",
    }

    # A hunt still running: a "do more" request STEERS the live hunt instead of spawning a duplicate
    # or being ignored (Cursor's addFollowup pattern), routed through the existing add_input command.
    if bucket == "active" and r in ("new_subhunt", "refine_patch", "refine_rewrite"):
        await registry.send(hunt_id, {"type": "add_input", "text": message, "kind": "note"})
        return {
            "action": "steer",
            "hunt_id": None,
            "reply_hint": "I've passed that to the pack while they're still out — they'll fold it in.",
        }

    # Delivered brief + a refine → re-draft from the SAME findings (no re-scout). Cheap and fast.
    if bucket == "delivered" and r in ("refine_patch", "refine_rewrite"):
        art = await repo.get_final_artifact(hunt_id)
        if art is not None:
            new_id = await refine_brief(repo, client, hunt_id, message)
            if new_id is not None:
                return {
                    "action": "refined",
                    "hunt_id": None,
                    "reply_hint": "Done — I've re-worked the brief; it's updated above.",
                }
        # nothing to refine → fall through to a plain answer

    # A request that needs NEW research → a scoped follow-up hunt that extends this brief.
    if r in ("new_subhunt", "new_hunt"):
        if draining:
            return _draining_answer
        if slots is not None and slots.locked():
            return {
                "action": "answer",
                "hunt_id": None,
                "reply_hint": "The pack's at capacity right now — give it a moment and I'll launch that.",
            }
        parent = hunt_id if r == "new_subhunt" else None
        # A sub-hunt's task is scoped by the follow-up message + what it extends; a new_hunt stands alone.
        if r == "new_subhunt":
            snap = await repo.get_hunt_snapshot(hunt_id)
            topic = str((snap or {}).get("raw_input") or "").strip()
            task = (
                f"{message.strip()} (extending the earlier brief on: {topic})"
                if topic
                else message.strip()
            )
        else:
            task = message.strip()
        new_id = new_hunt_id()
        if slots is not None:
            await slots.acquire()
        try:
            await _launch_hunt(
                new_id,
                repo,
                registry,
                client,
                source="chat",
                raw_input=task,
                strategy=settings.default_strategy,
                seed_team=None,
                slots=slots,
                parent_hunt_id=parent,
            )
        except BaseException:
            if slots is not None:
                slots.release()
            raise
        hint = (
            "On it — I've sent the pack to dig into that and I'll fold it into the brief."
            if r == "new_subhunt"
            else "On it — I've put the pack on that fresh."
        )
        return {
            "action": "subhunt" if r == "new_subhunt" else "new_hunt",
            "hunt_id": new_id,
            "reply_hint": hint,
        }

    # RETRY — re-run the same job from the beginning. The load-bearing case: a hunt that FAILED or was
    # stopped before delivering, where the Packmaster says "start again / try it again". Alpha actually
    # relaunches (a fresh hunt with the same task) instead of only offering to. If they asked to adjust
    # the focus ("retry but narrow to React"), the message rides along so the re-run is steered.
    if r == "retry":
        if draining:
            return _draining_answer
        if slots is not None and slots.locked():
            return {
                "action": "answer",
                "hunt_id": None,
                "reply_hint": "The pack's at capacity right now — give it a moment and I'll run it again.",
            }
        snap = await repo.get_hunt_snapshot(hunt_id)
        base_task = str((snap or {}).get("raw_input") or "").strip()
        if not base_task:
            return {"action": "answer", "hunt_id": None, "reply_hint": ""}
        # Fold an adjustment into the re-run task only when the message clearly adds direction (more
        # than a bare "retry"/"start again"); otherwise re-run the task verbatim.
        adjust = message.strip()
        bare = {
            "",
            "retry",
            "start again",
            "try again",
            "run it again",
            "do it over",
            "yes",
            "go",
            "again",
        }
        task = base_task if adjust.lower() in bare else f"{base_task} — {adjust}"
        strategy = str((snap or {}).get("strategy") or settings.default_strategy)
        new_id = new_hunt_id()
        if slots is not None:
            await slots.acquire()
        try:
            await _launch_hunt(
                new_id,
                repo,
                registry,
                client,
                source="chat",
                raw_input=task,
                strategy=strategy,
                seed_team=None,
                slots=slots,
                parent_hunt_id=hunt_id,  # thread the re-run under the original
            )
        except BaseException:
            if slots is not None:
                slots.release()
            raise
        return {
            "action": "retry",
            "hunt_id": new_id,
            "reply_hint": "On it — I'm running it again from the top; you'll see the pack move now.",
        }

    return {"action": "answer", "hunt_id": None, "reply_hint": ""}


async def _compose_ask_reply(
    hunt_id: str,
    history: list[dict],
    message: str,
    outcome: dict,
    repo: Repo,
    client: QwenClient,
    *,
    full_brief: bool,
) -> str:
    """Generate Alpha's spoken reply. When the router took an action, its truthful `reply_hint` is
    handed to Alpha to phrase in its own voice (so 'I've re-worked the brief' is real, not invented)."""
    system = await _ask_system(repo, hunt_id, full_brief=full_brief)
    hint = outcome.get("reply_hint") or ""
    turns = _model_history(history)
    if hint:
        system += (
            f"\n\nYou JUST did this for the Packmaster: {hint} "
            "Reply in your own warm voice confirming it — do not contradict it or offer to do it again."
        )
    result = await client.complete(
        CallSpec(
            hunt_id=hunt_id,
            wolf_id="alpha",
            tier="plus",
            intent="chat",
            messages=[{"role": "system", "content": system}, *turns],
        )
    )
    return (result.text or "").strip()


@router.post("/hunts/{hunt_id}/ask", response_model=AskReply)
async def ask_alpha(
    hunt_id: str,
    body: AskAlpha,
    repo: Repo = Depends(get_repo),
    client: QwenClient = Depends(get_client),
    registry: HuntRegistry = Depends(get_registry),
    slots: asyncio.Semaphore | None = Depends(get_hunt_slots),
    draining: bool = Depends(get_draining),
) -> JSONResponse:
    """The ONE Alpha side-chat, now a smart dispatcher: it classifies each message against the live
    hunt state and either answers, refines the brief in place, steers a running hunt, or launches a
    scoped follow-up — then replies in Alpha's voice. Multi-turn; carries the full history."""
    history = [m for m in body.messages if m.get("content")]
    message = body.question or last_user(history) or ""
    if not history and message:
        history = [{"role": "user", "content": message}]

    route = await route_intent(client, repo, hunt_id, message, history)
    outcome = {"action": "answer", "hunt_id": None, "reply_hint": ""}
    # Only act on a confident classification (research's confidence cascade: <0.5 → treat as a plain
    # answer/ask rather than firing an expensive/irreversible action on a guess).
    if (
        route["route"] in _ACT_ROUTES
        and route["confidence"] >= 0.5
        and not route["requires_clarification"]
    ):
        try:
            outcome = await _act_on_intent(
                route, hunt_id, message, repo, client, registry, slots, draining
            )
        except (RateLimitError, APIStatusError):
            raise
        except Exception:  # noqa: BLE001 — a failed action degrades to a plain answer, never a 500
            outcome = {"action": "answer", "hunt_id": None, "reply_hint": ""}

    full_brief = route["route"] in ("refine_patch", "refine_rewrite")
    try:
        reply = await _compose_ask_reply(
            hunt_id, history, message, outcome, repo, client, full_brief=full_brief
        )
    except RateLimitError as exc:
        raise HTTPException(429, detail="rate_limit") from exc
    except APIStatusError as e:
        if "content_filter" in str(e):
            raise HTTPException(400, detail="content_filter") from e
        raise HTTPException(500, detail=str(e)) from e
    return JSONResponse(
        content={"reply": reply, "action": outcome["action"], "hunt_id": outcome.get("hunt_id")}
    )


@router.post("/hunts/{hunt_id}/ask/stream")
async def ask_stream(
    hunt_id: str,
    request: Request,
    body: AskAlpha,
    repo: Repo = Depends(get_repo),
    client: QwenClient = Depends(get_client),
    registry: HuntRegistry = Depends(get_registry),
    slots: asyncio.Semaphore | None = Depends(get_hunt_slots),
    draining: bool = Depends(get_draining),
) -> StreamingResponse:
    """SSE variant of the smart dispatcher: classify the message against live hunt state, take the
    action (refine / steer / follow-up hunt), THEN stream Alpha's reply and emit the action + any new
    hunt_id on the `done` frame so the frontend can refresh the brief or track the sub-hunt."""
    history = [m for m in body.messages if m.get("content")]
    message = body.question or last_user(history) or ""
    if not history and message:
        history = [{"role": "user", "content": message}]

    route = await route_intent(client, repo, hunt_id, message, history)
    outcome = {"action": "answer", "hunt_id": None, "reply_hint": ""}
    if (
        route["route"] in _ACT_ROUTES
        and route["confidence"] >= 0.5
        and not route["requires_clarification"]
    ):
        try:
            outcome = await _act_on_intent(
                route, hunt_id, message, repo, client, registry, slots, draining
            )
        except Exception:  # noqa: BLE001 — degrade to a plain answer, never break the stream
            outcome = {"action": "answer", "hunt_id": None, "reply_hint": ""}

    full_brief = route["route"] in ("refine_patch", "refine_rewrite")
    system = await _ask_system(repo, hunt_id, full_brief=full_brief)
    hint = outcome.get("reply_hint") or ""
    if hint:
        system += (
            f"\n\nYou JUST did this for the Packmaster: {hint} "
            "Reply in your own warm voice confirming it — do not contradict it or offer to do it again."
        )
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def _on_delta(delta: str) -> None:
        await queue.put(delta)

    async def _gen():
        async def _run():
            r = await client.complete(
                CallSpec(
                    hunt_id=hunt_id,
                    wolf_id="alpha",
                    tier="plus",
                    intent="chat",
                    force_stream=True,
                    messages=[{"role": "system", "content": system}, *_model_history(history)],
                ),
                on_delta=_on_delta,
            )
            await queue.put(None)
            return r

        task = asyncio.create_task(_run())
        try:
            async for frame in stream_tokens(queue, request):
                yield frame
            try:
                result = await task
            except RateLimitError:
                yield f"data: {json.dumps({'type': 'error', 'kind': 'rate_limit'})}\n\n"
                return
            except APIStatusError as e:
                kind = "content_filter" if "content_filter" in str(e) else "unknown"
                yield f"data: {json.dumps({'type': 'error', 'kind': kind})}\n\n"
                return
            done = {
                "type": "done",
                "reply": result.text,
                "action": outcome["action"],
                "hunt_id": outcome.get("hunt_id"),
            }
            yield f"data: {json.dumps(done)}\n\n"
        finally:
            await cancel_task(task)

    return StreamingResponse(_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
