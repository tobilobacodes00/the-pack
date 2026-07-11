"""Pack Engine — app factory.

Commands return 202 Accepted. Truth arrives on the event stream — connect a WebSocket to the
gateway at /hunts/{hunt_id}/stream?from_seq=0 to watch the hunt unfold.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.bus.redis_stream import EventBus
from app.config import settings
from app.core.auth import require_auth, validate_secrets
from app.core.logging import configure_logging
from app.core.middleware import http_exception_handler, request_context, unhandled_exception_handler
from app.db.migrate import run_migrations
from app.db.pool import create_pool
from app.db.repo import Repo
from app.engine.registry import HuntRegistry
from app.engine.relay import OutboxRelay
from app.engine.startup import recover_stranded_hunts
from app.qwen.client import QwenClient
from app.qwen.pricing import validate_pricing
from app.routers import documents, hunts, instincts, memory, projects, system, tools

configure_logging(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    price_problems = validate_pricing()
    if price_problems and settings.strict_pricing:
        raise RuntimeError("refusing to start: " + "; ".join(price_problems))
    secret_problems = validate_secrets()
    if secret_problems and settings.strict_secrets:
        raise RuntimeError("refusing to start: " + "; ".join(secret_problems))
    pool = await create_pool()
    await run_migrations(pool)
    bus = EventBus(settings.redis_url)
    repo = Repo(pool)
    registry = HuntRegistry()
    relay = OutboxRelay(pool, bus, repo)
    await relay.start()

    app.state.pool = pool
    app.state.bus = bus
    app.state.repo = repo
    app.state.registry = registry
    app.state.relay = relay
    app.state.client = QwenClient()
    background: set[asyncio.Task] = set()
    app.state.background = background
    # Caps concurrently-running hunts (None = unlimited). Acquired per hunt in the create route,
    # released when the Supervisor task finishes.
    app.state.hunt_slots = (
        asyncio.Semaphore(settings.max_concurrent_hunts)
        if settings.max_concurrent_hunts > 0
        else None
    )

    await recover_stranded_hunts(app, repo)

    try:
        yield
    finally:
        await registry.shutdown()
        for bg in list(app.state.background):
            bg.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await bg
        await relay.stop()
        await bus.close()
        await pool.close()


app = FastAPI(
    title="Pack Engine",
    version="0.1.0",
    description=(
        "The Python brain. All REST commands and all writes (Doc 04 §2).\n\n"
        "**Commands return 202.** The result is not in the HTTP response — it lands on the "
        "event stream as the running hunt acts."
    ),
    lifespan=lifespan,
    # Optional shared-token gate (no-op unless api_auth_token is set) applied to every route.
    dependencies=[Depends(require_auth)],
    openapi_tags=[
        {
            "name": "hunts",
            "description": "Create and drive a hunt. Commands are 202; truth is on the stream.",
        },
        {"name": "projects", "description": "Workspaces that group hunts (the Den)."},
        {"name": "instincts", "description": "Saved plan/formation presets."},
        {"name": "documents", "description": "Your local knowledge base."},
        {"name": "memory", "description": "The Elder's cross-hunt learnings."},
        {"name": "system", "description": "Health, readiness, and meta."},
    ],
)

_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)
app.middleware("http")(request_context)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(Exception, unhandled_exception_handler)

app.include_router(hunts.router)
app.include_router(projects.router)
app.include_router(instincts.router)
app.include_router(documents.router)
app.include_router(memory.router)
app.include_router(system.router)
app.include_router(tools.router)
