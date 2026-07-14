"""Graceful shutdown — each step is isolated so one failing/hanging step can't skip the rest.

Before this, `lifespan`'s `finally` block was one flat sequence: `registry.shutdown()` →
cancel background tasks → `relay.stop()` → `bus.close()` → `pool.close()`. A raise anywhere in
that chain skipped every step after it, including `pool.close()` — leaking the DB pool on a
botched redeploy. These tests exercise `_graceful_shutdown`/`_shutdown_step` directly (no real
Postgres/Redis; `lifespan` itself is never run hermetically elsewhere in this suite).
"""

from __future__ import annotations

import asyncio

from app.main import _graceful_shutdown, _shutdown_step


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def ok(self, name: str) -> None:
        self.calls.append(name)

    async def boom(self, name: str) -> None:
        self.calls.append(name)
        raise RuntimeError(f"{name} blew up")

    async def hangs(self, name: str) -> None:
        self.calls.append(name)
        await asyncio.sleep(999)


async def test_shutdown_step_swallows_a_raised_exception() -> None:
    rec = _Recorder()
    await _shutdown_step("boom-step", rec.boom("boom-step"))  # must not raise
    assert rec.calls == ["boom-step"]


async def test_shutdown_step_times_out_a_hanging_step(monkeypatch) -> None:
    monkeypatch.setattr("app.config.settings.shutdown_step_timeout_s", 0.05)
    rec = _Recorder()
    await _shutdown_step("hangs", rec.hangs("hangs"))  # must not raise or block forever
    assert rec.calls == ["hangs"]


class _FakeRegistry:
    def __init__(self, fail: bool) -> None:
        self.fail = fail
        self.called = False

    async def shutdown(self) -> None:
        self.called = True
        if self.fail:
            raise RuntimeError("registry.shutdown blew up")


class _FakeRelay:
    def __init__(self) -> None:
        self.called = False

    async def stop(self) -> None:
        self.called = True


class _FakeBus:
    def __init__(self) -> None:
        self.called = False

    async def close(self) -> None:
        self.called = True


class _FakePool:
    def __init__(self) -> None:
        self.called = False

    async def close(self) -> None:
        self.called = True


async def test_a_failing_early_step_does_not_skip_pool_close() -> None:
    """The exact regression this fixes: registry.shutdown() raising used to skip every step after
    it, including pool.close() — leaking the connection pool."""
    registry = _FakeRegistry(fail=True)
    relay = _FakeRelay()
    bus = _FakeBus()
    pool = _FakePool()

    await _graceful_shutdown(registry, set(), relay, bus, pool)  # type: ignore[arg-type]

    assert registry.called is True
    assert relay.called is True
    assert bus.called is True
    assert pool.called is True  # <- the regression: this used to be False


async def test_background_task_cancellation_does_not_block_later_steps() -> None:
    registry = _FakeRegistry(fail=False)
    relay = _FakeRelay()
    bus = _FakeBus()
    pool = _FakePool()

    async def _never_finishes() -> None:
        await asyncio.sleep(999)

    task = asyncio.ensure_future(_never_finishes())
    background = {task}

    await _graceful_shutdown(registry, background, relay, bus, pool)  # type: ignore[arg-type]

    assert task.cancelled() or task.done()
    assert relay.called is True
    assert bus.called is True
    assert pool.called is True


async def test_a_clean_shutdown_runs_every_step_once() -> None:
    registry = _FakeRegistry(fail=False)
    relay = _FakeRelay()
    bus = _FakeBus()
    pool = _FakePool()

    await _graceful_shutdown(registry, set(), relay, bus, pool)  # type: ignore[arg-type]

    assert registry.called and relay.called and bus.called and pool.called
