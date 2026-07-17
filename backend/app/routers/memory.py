"""Memory and spend routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from app.db.repo import Repo
from app.dependencies import get_repo
from app.schemas import (
    ClearedResponse,
    MemoryDeleteResponse,
    MemoryPatch,
    MemoryPatchResponse,
    MemoryResponse,
    SpendResponse,
)
from app.tools.memory import normalize_kind

router = APIRouter(tags=["memory"])

_STATUSES = ("active", "archived")


@router.get("/memory", response_model=MemoryResponse)
async def get_memory(repo: Repo = Depends(get_repo)) -> dict:
    """Everything the pack learned across hunts (the Elder's typed lessons), most recent first —
    INCLUDING archived (vetoed) lessons, so the record stays visible. Only active lessons are
    recalled into hunts."""
    rows = await repo.recent_memory(50, include_archived=True)
    return {
        "memory": [
            {
                "id": int(r.get("id") or 0),
                "text": str(r.get("text") or ""),
                "kind": normalize_kind(r.get("kind")),
                "hunt_id": r.get("hunt_id"),
                "status": str(r.get("status") or "active"),
            }
            for r in rows
            if str(r.get("text") or "").strip()
        ]
    }


@router.patch("/memory/{memory_id}", response_model=MemoryPatchResponse)
async def patch_memory(memory_id: int, body: MemoryPatch, repo: Repo = Depends(get_repo)) -> dict:
    """Edit one lesson: rewrite its text and/or veto it (status=archived) / restore it
    (status=active). A vetoed lesson is never recalled into a hunt again."""
    if body.text is None and body.status is None:
        raise HTTPException(status_code=422, detail="nothing to change")
    if body.status is not None and body.status not in _STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {_STATUSES}")
    text = body.text.strip() if body.text is not None else None
    if text is not None and not text:
        raise HTTPException(status_code=422, detail="text cannot be empty")
    ok = await repo.update_memory(memory_id, text=text, status=body.status)
    if not ok:
        raise HTTPException(status_code=404, detail="no such lesson")
    return {"ok": True}


@router.delete("/memory/{memory_id}", response_model=MemoryDeleteResponse)
async def delete_memory_row(memory_id: int, repo: Repo = Depends(get_repo)) -> dict:
    """Forget ONE lesson for good."""
    deleted = await repo.delete_memory_row(memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="no such lesson")
    return {"deleted": True}


@router.delete("/memory", response_model=ClearedResponse)
async def clear_memory(repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Forget everything the pack learned (wired to Settings → Clear all saved data)."""
    await repo.clear_memory()
    return JSONResponse({"cleared": True})


@router.get("/spend", tags=["hunts"], response_model=SpendResponse)
async def get_spend(repo: Repo = Depends(get_repo)) -> dict:
    """Total spend across all hunts + a per-hunt breakdown, read from each hunt's final totals."""
    items = await repo.spend_summary()
    return {"total_usd": round(sum(i["cost_usd"] for i in items), 4), "hunts": items}
