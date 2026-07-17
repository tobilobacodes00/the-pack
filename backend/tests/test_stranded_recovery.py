"""Startup recovery of stranded hunts — the grace window that stops a fast, graceful `--reload`
bounce from reaping a hunt that was still flushing events a heartbeat earlier.

`recover_stranded_hunts` runs once in the lifespan. A genuinely crashed hunt is stale by far more
than the grace, so it's still closed with an honest `hunt_failed`; a hunt whose last event is
within the grace is left non-terminal for the next boot to reconcile.
"""

from __future__ import annotations

import types

from app.engine.startup import _REAP_GRACE_S, recover_stranded_hunts


class _FakeRepo:
    def __init__(self, stranded: list[dict]) -> None:
        self._stranded = stranded
        self.failed: list[str] = []
        self.appended: list[dict] = []

    async def list_unfinished_hunts(self) -> list[dict]:
        return self._stranded

    async def get_last_seq(self, hunt_id: str) -> int:
        return 4

    async def append_event(self, event) -> None:  # noqa: ANN001
        self.appended.append({"hunt_id": event.hunt_id, "type": event.type})

    async def set_hunt_state(self, hunt_id: str, state: str) -> None:
        if state == "failed":
            self.failed.append(hunt_id)


def _app() -> types.SimpleNamespace:
    # recover_stranded_hunts only touches app.state.registry for the halted branch; the reap/skip
    # branches never reach it, so a bare namespace is enough for those.
    return types.SimpleNamespace(state=types.SimpleNamespace(registry=None, client=None))


async def test_stale_hunt_is_reaped_as_failed() -> None:
    repo = _FakeRepo([{"hunt_id": "hunt_stale", "state": "running", "last_event_age_s": _REAP_GRACE_S + 60}])
    await recover_stranded_hunts(_app(), repo)  # type: ignore[arg-type]
    assert repo.failed == ["hunt_stale"]
    assert repo.appended == [{"hunt_id": "hunt_stale", "type": "hunt_failed"}]


async def test_fresh_hunt_is_left_for_the_grace_pass() -> None:
    """A hunt that emitted an event a beat ago (mid-flush during a graceful reload) is NOT reaped."""
    repo = _FakeRepo([{"hunt_id": "hunt_fresh", "state": "running", "last_event_age_s": 1.0}])
    await recover_stranded_hunts(_app(), repo)  # type: ignore[arg-type]
    assert repo.failed == []
    assert repo.appended == []


async def test_missing_age_defaults_to_fresh_and_is_skipped() -> None:
    """A payload without last_event_age_s (defensive) is treated as age 0 → skipped, never a crash."""
    repo = _FakeRepo([{"hunt_id": "hunt_noage", "state": "planning"}])
    await recover_stranded_hunts(_app(), repo)  # type: ignore[arg-type]
    assert repo.failed == []


async def test_mixed_batch_reaps_only_the_stale_ones() -> None:
    repo = _FakeRepo(
        [
            {"hunt_id": "old", "state": "running", "last_event_age_s": 999.0},
            {"hunt_id": "new", "state": "running", "last_event_age_s": 2.0},
        ]
    )
    await recover_stranded_hunts(_app(), repo)  # type: ignore[arg-type]
    assert repo.failed == ["old"]
