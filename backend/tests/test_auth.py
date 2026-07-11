"""The optional bearer-token gate + boot-time secret validation (app/core/auth.py)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core import auth
from app.core.auth import require_auth, validate_secrets


def _req(path: str, method: str = "POST", auth_header: str | None = None):
    headers = {} if auth_header is None else {"authorization": auth_header}
    return SimpleNamespace(url=SimpleNamespace(path=path), method=method, headers=headers)


async def test_gate_is_noop_when_token_unset(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "api_auth_token", "")
    await require_auth(_req("/hunts"))  # no raise — local-first default


async def test_gate_rejects_missing_and_wrong_token(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "api_auth_token", "s3cret")
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as e1:
        await require_auth(_req("/hunts"))  # no header
    assert e1.value.status_code == 401
    with pytest.raises(HTTPException):
        await require_auth(_req("/hunts", auth_header="Bearer nope"))


async def test_gate_allows_correct_token_and_open_paths(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "api_auth_token", "s3cret")
    await require_auth(_req("/hunts", auth_header="Bearer s3cret"))  # correct → ok
    await require_auth(_req("/health", method="GET"))  # health always open
    await require_auth(_req("/share/abc", method="GET"))  # public share view open
    await require_auth(_req("/hunts", method="OPTIONS"))  # CORS preflight open


def test_validate_secrets_flags_default_session_secret(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "session_secret", "change-me-in-prod")
    monkeypatch.setattr(auth.settings, "strict_secrets", False)
    problems = validate_secrets()
    assert any("SESSION_SECRET" in p for p in problems)


def test_validate_secrets_strict_requires_token_and_cors(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "session_secret", "a-real-secret")
    monkeypatch.setattr(auth.settings, "strict_secrets", True)
    monkeypatch.setattr(auth.settings, "api_auth_token", "")
    monkeypatch.setattr(auth.settings, "cors_origins", "*")
    problems = validate_secrets()
    assert any("API_AUTH_TOKEN" in p for p in problems)
    assert any("CORS_ORIGINS" in p for p in problems)


def test_validate_secrets_clean_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(auth.settings, "session_secret", "a-real-secret")
    monkeypatch.setattr(auth.settings, "strict_secrets", True)
    monkeypatch.setattr(auth.settings, "api_auth_token", "tok")
    monkeypatch.setattr(auth.settings, "cors_origins", "https://example.com")
    assert validate_secrets() == []
