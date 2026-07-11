"""System routes — health probes and strategy catalog."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response

from app.config import settings
from app.core.metrics import ACTIVE_HUNTS, render
from app.db.repo import Repo
from app.dependencies import get_bus, get_pool, get_registry, get_repo
from app.engine.registry import HuntRegistry
from app.engine.strategies import strategy_catalog
from app.schemas import ClearedResponse, HealthResponse, ReadyResponse, StrategiesResponse

router = APIRouter(tags=["system"])


@router.post("/reset", response_model=ClearedResponse)
async def reset_data(repo: Repo = Depends(get_repo)) -> JSONResponse:
    """Reset all local data (Settings → Reset Data): hunts, memory, documents, instincts, projects.

    Gated by the auth token when set (unlike the browser flow, which is gated at the nginx edge)."""
    await repo.reset_all()
    return JSONResponse({"cleared": True})


@router.get("/health", response_model=HealthResponse)
async def health(pool=Depends(get_pool), bus=Depends(get_bus)) -> JSONResponse:
    """Liveness + dependency probe: pings Postgres and Redis so a probe sees 'degraded', not a
    false 'ok', when a backing service is down."""
    detail: dict = {"status": "ok", "service": "pack-engine"}
    try:
        await pool.fetchval("SELECT 1")
    except Exception as exc:  # noqa: BLE001
        detail.update(status="degraded", postgres=f"down: {exc}")
    try:
        await bus.ping()
    except Exception as exc:  # noqa: BLE001
        detail.update(status="degraded", redis=f"down: {exc}")
    code = 200 if detail["status"] == "ok" else 503
    return JSONResponse(status_code=code, content=detail)


@router.get("/ready", response_model=ReadyResponse)
async def ready(pool=Depends(get_pool), bus=Depends(get_bus)) -> JSONResponse:
    """Readiness probe — 503 unless BOTH Postgres (writes) and Redis (the event stream) answer.
    A pod that can't publish events isn't ready to serve, even if Postgres is up."""
    try:
        await pool.fetchval("SELECT 1")
        await bus.ping()
    except Exception:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"ready": False})
    return JSONResponse({"ready": True})


@router.get("/metrics")
async def metrics(registry: HuntRegistry = Depends(get_registry)) -> Response:
    """Prometheus scrape endpoint — RED request metrics plus a live-hunts gauge."""
    ACTIVE_HUNTS.set(registry.count())
    body, content_type = render()
    return Response(content=body, media_type=content_type)


@router.get("/strategies", response_model=StrategiesResponse)
async def strategies() -> dict:
    """The selectable research strategies (the Door's mode picker)."""
    return {"strategies": strategy_catalog(), "default": settings.default_strategy}
