"""Optional shared-token auth gate (Doc 04 §04, D5).

Accounts are deliberately out of scope for this build (`PARKING_LOT.md` — "accounts/login (D5)").
This is the proportionate stand-in: when `settings.api_auth_token` is set, every request must carry
`Authorization: Bearer <token>` except a small allowlist (health probes, the public share view, and
the OpenAPI docs). Empty token ⇒ the gate is a no-op, so local-first development is unaffected.

The primary gate for browser traffic is nginx HTTP Basic auth at the edge (see deploy/nginx.conf) —
this dependency is defense in depth for any path that reaches the engine directly.
"""

from __future__ import annotations

import logging
import secrets

from fastapi import HTTPException, Request, status

from app.config import settings

_LOG = logging.getLogger("pack")

# Prefix-matched paths that must stay reachable without the token.
_OPEN_PREFIXES = ("/health", "/ready", "/metrics", "/share/", "/docs", "/redoc", "/openapi.json")

_DEFAULT_SESSION_SECRET = "change-me-in-prod"


def validate_secrets() -> list[str]:
    """Boot-time secret sanity check. Returns human-readable problems (empty if fine). The lifespan
    logs a loud WARNING and — under settings.strict_secrets — refuses to start. Stops an unconfigured
    box (default session secret, no auth, open CORS) from silently going live."""
    problems: list[str] = []
    if settings.session_secret == _DEFAULT_SESSION_SECRET:
        problems.append("SESSION_SECRET is still the default placeholder — generate a real one")
    if settings.strict_secrets:
        # In a hardened deployment we also want a positive access gate, not the local-first defaults.
        if not settings.api_auth_token:
            problems.append("API_AUTH_TOKEN is empty — the engine has no bearer gate")
        if settings.cors_origins.strip() == "*":
            problems.append("CORS_ORIGINS is '*' — lock it to your real origin(s)")
    if problems:
        _LOG.warning("SECRETS LOOK UNCONFIGURED — %s", "; ".join(problems))
    return problems


async def require_auth(request: Request) -> None:
    token = settings.api_auth_token
    if not token:  # gate disabled — local-first default
        return
    path = request.url.path
    if request.method == "OPTIONS" or path.startswith(_OPEN_PREFIXES):
        return
    header = request.headers.get("authorization", "")
    scheme, _, presented = header.partition(" ")
    # Constant-time compare so a wrong token can't be timed out character by character.
    if scheme.lower() != "bearer" or not secrets.compare_digest(presented, token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing or invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
