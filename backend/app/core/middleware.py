"""HTTP middleware and exception handlers — wired in app/main.py."""

from __future__ import annotations

import logging
import secrets
import time
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.core.logging import request_id_var
from app.core.metrics import observe_request

logger = logging.getLogger("pack")
# A dedicated audit logger so the trail of state-changing actions can be shipped/retained separately
# from ordinary request logs (a tamper-evident record of who did what — the actor is the client IP
# since this build is single-tenant with no accounts).
audit = logging.getLogger("pack.audit")

# Methods that change or delete state — every one is written to the audit trail.
_MUTATING = ("POST", "PATCH", "DELETE", "PUT")

# Per-IP in-process rate limiter for expensive POST paths. Off by default (rate_limit_per_min=0).
_RATE_PREFIXES = ("/hunts", "/parse", "/transcribe", "/documents")
_rate_hits: dict[str, deque[float]] = {}


def _client_ip(request: Request) -> str:
    """The real caller — the first X-Forwarded-For hop when behind nginx, else the socket peer."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "?"


def _rate_limited(ip: str) -> bool:
    limit = settings.rate_limit_per_min
    if limit <= 0:
        return False
    now = time.monotonic()
    dq = _rate_hits.setdefault(ip, deque())
    while dq and now - dq[0] > 60.0:
        dq.popleft()
    if len(dq) >= limit:
        return True
    dq.append(now)
    return False


async def request_context(request: Request, call_next):
    """Per-IP rate limit on expensive POSTs, then stamp every request with a short id (logged +
    returned as X-Request-ID) for tracing."""
    rid = secrets.token_hex(4)
    request.state.request_id = rid
    # Into the ContextVar so it lands on every log record — and, because create_task copies the
    # context, on the background hunt this request may spawn.
    request_id_var.set(rid)
    if request.method == "POST" and request.url.path.startswith(_RATE_PREFIXES):
        if _rate_limited(_client_ip(request)):
            return JSONResponse(
                status_code=429, content={"detail": "rate limit exceeded", "request_id": rid}
            )
    t0 = time.monotonic()
    response = await call_next(request)
    elapsed = time.monotonic() - t0
    response.headers["X-Request-ID"] = rid
    # Audit trail: every state-changing request, with the actor (client IP), outcome, and request id.
    if request.method in _MUTATING:
        audit.info(
            "audit method=%s path=%s status=%s ip=%s request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            _client_ip(request),
            rid,
        )
    # Label metrics by the route TEMPLATE (e.g. /hunts/{hunt_id}), not the raw path, so ids don't
    # blow up label cardinality. Unmatched paths (404s) collapse into one series.
    route = request.scope.get("route")
    route_path = getattr(route, "path", "unmatched")
    observe_request(request.method, route_path, response.status_code, elapsed)
    logger.info(
        "%s %s -> %s  %dms",
        request.method,
        request.url.path,
        response.status_code,
        round(elapsed * 1000),
    )
    return response


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    rid = getattr(request.state, "request_id", "?")
    return JSONResponse(
        status_code=exc.status_code, content={"detail": exc.detail, "request_id": rid}
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = getattr(request.state, "request_id", "?")
    logger.exception("[%s] unhandled error on %s %s", rid, request.method, request.url.path)
    return JSONResponse(
        status_code=500, content={"detail": "internal server error", "request_id": rid}
    )
