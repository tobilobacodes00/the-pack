"""The admission (draining) gate: once graceful shutdown begins, POST /hunts must refuse NEW work with
503 rather than spawn a hunt into a process whose pool/registry is being torn down. In-flight hunts
drain normally; only new hunts are refused. These drive the route with get_draining overridden, no
real lifespan (hermetic), mirroring test_endpoints_v4v5's TestClient-without-context-manager pattern."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.dependencies import get_client, get_draining, get_registry, get_repo
from app.main import app

from ._fakes import FakeRepo


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _client(draining: bool) -> TestClient:
    app.dependency_overrides[get_repo] = lambda: FakeRepo()
    app.dependency_overrides[get_registry] = lambda: None
    app.dependency_overrides[get_client] = lambda: None
    app.dependency_overrides[get_draining] = lambda: draining
    return TestClient(app)


def test_create_hunt_returns_503_while_draining() -> None:
    client = _client(draining=True)
    resp = client.post("/hunts", json={"input": "research widgets"})
    assert resp.status_code == 503
    assert "shutting down" in resp.json()["detail"].lower()


def test_create_hunt_is_refused_before_it_touches_the_registry_while_draining() -> None:
    """The 503 must come from the draining check itself, not from a NoneType registry blowing up — if
    the gate let the request through to `registry` (overridden to None here) it would 500, not 503."""
    client = _client(draining=True)
    resp = client.post("/hunts", json={"input": "anything"})
    assert resp.status_code == 503  # clean refusal, not an incidental crash


def test_get_draining_defaults_false_without_app_state() -> None:
    """A TestClient with no real lifespan has no app.state.draining — the dependency must default to
    False so hermetic tests (and a mis-wired startup) keep admission OPEN rather than 503ing every hunt."""
    from types import SimpleNamespace

    from starlette.requests import Request

    req = Request({"type": "http", "app": SimpleNamespace(state=SimpleNamespace())})
    assert get_draining(req) is False
