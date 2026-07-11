"""The outbox relay against a real Postgres (skipped if none). All tests require pg_pool.

An event committed to Postgres must appear on the bus with an identical envelope, and
re-draining already-relayed rows must publish nothing new (at-least-once, idempotent at the
read model).
"""

from __future__ import annotations

import asyncio

from app.db.repo import Repo
from app.engine.core import Emitter
from app.engine.ids import new_hunt_id
from app.engine.relay import OutboxRelay

from ._fakes import CollectingBus


async def test_committed_event_reaches_the_bus(pg_pool) -> None:
    repo = Repo(pg_pool)
    bus = CollectingBus()
    relay = OutboxRelay(pg_pool, bus, repo, poll_interval=0.2)

    hunt_id = new_hunt_id()
    await repo.create_hunt(hunt_id, "typed", "x")
    emitter = Emitter(hunt_id, repo)
    await emitter.emit("hunt_stopped", "user", {"by": "user"})

    await relay.start()
    try:
        # The event must get RELAYED (relayed=TRUE). We assert on that flag, not solely on our own
        # in-process bus, because a dev engine running against the same local DB has its own relay
        # that may legitimately publish (and mark) the row first — either way the outbox path fired.
        for _ in range(50):  # up to ~5s
            if any(e.hunt_id == hunt_id for e in bus.published):
                break
            flag = await pg_pool.fetchval(
                "SELECT relayed FROM events WHERE hunt_id = $1 AND seq = 0", hunt_id
            )
            if flag:
                break
            await asyncio.sleep(0.1)
    finally:
        await relay.stop()

    relayed = await pg_pool.fetchval(
        "SELECT relayed FROM events WHERE hunt_id = $1 AND seq = 0", hunt_id
    )
    assert relayed is True, "the committed event was never relayed"

    # When OUR relay is the one that published it, the envelope must be intact.
    mine = [e for e in bus.published if e.hunt_id == hunt_id]
    if mine:
        assert mine[0].seq == 0 and mine[0].type == "hunt_stopped"

    # Idempotent: everything relayed, so another drain publishes nothing new.
    before = len(bus.published)
    await relay._drain()
    assert len(bus.published) == before


async def test_relay_publishes_in_seq_order(pg_pool) -> None:
    """Five events for one hunt must arrive from the relay in seq order, not insertion chaos."""
    repo = Repo(pg_pool)
    bus = CollectingBus()
    relay = OutboxRelay(pg_pool, bus, repo, poll_interval=0.2)

    hunt_id = new_hunt_id()
    await repo.create_hunt(hunt_id, "typed", "ordering test")
    emitter = Emitter(hunt_id, repo, validate=False)
    for i in range(5):
        await emitter.emit("wolf_progress", "test", {"i": i})

    await relay.start()
    try:
        for _ in range(50):
            relayed = await pg_pool.fetchval(
                "SELECT COUNT(*) FROM events WHERE hunt_id = $1 AND relayed = TRUE", hunt_id
            )
            if relayed == 5:
                break
            await asyncio.sleep(0.1)
    finally:
        await relay.stop()

    mine = [e for e in bus.published if e.hunt_id == hunt_id]
    if mine:
        seqs = [e.seq for e in mine]
        assert seqs == sorted(seqs), f"relay broke ordering: {seqs}"


async def test_skip_locked_prevents_double_publish(pg_pool) -> None:
    """Two concurrent drain calls must not publish the same event twice (SKIP LOCKED)."""
    repo = Repo(pg_pool)
    bus = CollectingBus()

    hunt_id = new_hunt_id()
    await repo.create_hunt(hunt_id, "typed", "skip locked test")
    emitter = Emitter(hunt_id, repo, validate=False)
    await emitter.emit("wolf_progress", "test", {"turn": 1})
    await emitter.emit("wolf_progress", "test", {"turn": 2})

    relay = OutboxRelay(pg_pool, bus, repo, poll_interval=999)

    # Two concurrent drains race — SKIP LOCKED means they split the work, not duplicate it.
    await asyncio.gather(relay._drain(), relay._drain())

    event_ids = [e.event_id for e in bus.published if e.hunt_id == hunt_id]
    assert len(event_ids) == len(set(event_ids)), f"duplicate event_ids published: {event_ids}"


class _PoisonBus:
    """Publishes everything except one seq, whose XADD always raises (a poison row)."""

    def __init__(self, poison_seq: int) -> None:
        self.published: list = []
        self._poison = poison_seq

    async def append(self, event) -> None:
        if event.seq == self._poison:
            raise RuntimeError("simulated un-publishable event")
        self.published.append(event)


async def test_poison_event_is_quarantined_and_tail_unblocks(pg_pool) -> None:
    """A row whose publish keeps failing is moved to dead_events after max_attempts and marked
    relayed, so the events after it still get delivered (no head-of-line wedge)."""
    repo = Repo(pg_pool)
    bus = _PoisonBus(poison_seq=1)
    relay = OutboxRelay(pg_pool, bus, repo, poll_interval=999, max_attempts=3)

    hunt_id = new_hunt_id()
    await repo.create_hunt(hunt_id, "typed", "poison test")
    emitter = Emitter(hunt_id, repo, validate=False)
    for i in range(3):
        await emitter.emit("wolf_progress", "test", {"i": i})  # seq 0, 1, 2

    # Each stalled drain bumps the poison event's attempt count; after max_attempts it quarantines.
    for _ in range(5):
        await relay._drain()

    dead = await pg_pool.fetch("SELECT seq FROM dead_events WHERE hunt_id = $1", hunt_id)
    assert {r["seq"] for r in dead} == {1}, "the poison event should be quarantined"

    # Every source row is now relayed (the tail unblocked past the quarantined seq).
    relayed = await pg_pool.fetchval(
        "SELECT COUNT(*) FROM events WHERE hunt_id = $1 AND relayed = TRUE", hunt_id
    )
    assert relayed == 3
    # seq 1 was never published; 0 and 2 were.
    assert sorted(e.seq for e in bus.published) == [0, 2]


async def test_poison_attempt_count_survives_a_relay_restart(pg_pool) -> None:
    """The failure count is persisted on the event row, so a fresh OutboxRelay (a restart) continues
    from where the old one left off rather than resetting to zero."""
    repo = Repo(pg_pool)
    hunt_id = new_hunt_id()
    await repo.create_hunt(hunt_id, "typed", "restart test")
    emitter = Emitter(hunt_id, repo, validate=False)
    for i in range(2):
        await emitter.emit("wolf_progress", "test", {"i": i})  # seq 0 (ok), 1 (poison)

    # Relay #1: two stalled drains → seq 1's persisted count reaches 2 (still below the cap of 3).
    relay1 = OutboxRelay(pg_pool, _PoisonBus(poison_seq=1), repo, poll_interval=999, max_attempts=3)
    await relay1._drain()
    await relay1._drain()
    count = await pg_pool.fetchval(
        "SELECT relay_attempts FROM events WHERE hunt_id = $1 AND seq = 1", hunt_id
    )
    assert count == 2, "the count must be durably persisted, not held in relay memory"

    # Relay #2 (a restart — no in-memory state): ONE more drain tips seq 1 over the cap → quarantine.
    relay2 = OutboxRelay(pg_pool, _PoisonBus(poison_seq=1), repo, poll_interval=999, max_attempts=3)
    await relay2._drain()
    dead = await pg_pool.fetch("SELECT seq FROM dead_events WHERE hunt_id = $1", hunt_id)
    assert {r["seq"] for r in dead} == {1}, (
        "the restarted relay continued the count and quarantined"
    )


async def test_at_least_once_redelivers_after_reset(pg_pool) -> None:
    """Events manually reset to relayed=FALSE are re-published on the next drain (at-least-once)."""
    repo = Repo(pg_pool)
    bus = CollectingBus()
    relay = OutboxRelay(pg_pool, bus, repo, poll_interval=0.2)

    hunt_id = new_hunt_id()
    await repo.create_hunt(hunt_id, "typed", "at-least-once test")
    emitter = Emitter(hunt_id, repo, validate=False)
    await emitter.emit("wolf_progress", "test", {"n": 1})
    await emitter.emit("wolf_progress", "test", {"n": 2})
    await emitter.emit("wolf_progress", "test", {"n": 3})

    # First drain — all three are published and marked.
    await relay.start()
    try:
        for _ in range(50):
            relayed = await pg_pool.fetchval(
                "SELECT COUNT(*) FROM events WHERE hunt_id = $1 AND relayed = TRUE", hunt_id
            )
            if relayed == 3:
                break
            await asyncio.sleep(0.1)
    finally:
        await relay.stop()

    assert (
        await pg_pool.fetchval(
            "SELECT COUNT(*) FROM events WHERE hunt_id = $1 AND relayed = TRUE", hunt_id
        )
        == 3
    )

    # Simulate crash: reset two events back to unrelayed.
    await pg_pool.execute(
        "UPDATE events SET relayed = FALSE WHERE hunt_id = $1 AND seq IN (0, 1)", hunt_id
    )
    before = len([e for e in bus.published if e.hunt_id == hunt_id])

    # Second drain — the two reset events must be re-published.
    await relay._drain()
    after = [e for e in bus.published if e.hunt_id == hunt_id]
    assert len(after) - before == 2, "exactly the two reset events should be re-published"
