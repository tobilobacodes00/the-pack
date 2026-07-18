"""Engine startup helpers — called from the FastAPI lifespan, not from route code."""

from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI

from app.db.repo import Repo
from app.engine.core import Emitter
from app.engine.registry import HuntRegistry
from app.events.models import Event

_RESTART_REASON = "The engine restarted before this hunt could finish — start a new one."

# A hunt whose most recent event is newer than this is given one grace pass instead of being reaped
# immediately: a graceful reload can bounce the process while a Supervisor is mid-flush, and we don't
# want to declare that hunt dead a heartbeat too early. A genuinely crashed hunt is stale by far more
# than this, so it's still reaped on the very same startup.
_REAP_GRACE_S = 8.0

logger = logging.getLogger("pack")


async def recover_stranded_hunts(app: FastAPI, repo: Repo) -> None:
    """A previous engine stop leaves in-flight hunts with no Supervisor (state lived in-process).
    On startup:
    - `halted_boundary` → RE-REGISTERED and resumed (B11): rebuilds from the event log and
      waits for the Packmaster's /resume command.
    - Any other in-flight state → closed with an honest `hunt_failed`.
    Best-effort — never blocks startup; a bad row is skipped."""
    try:
        stranded = await repo.list_unfinished_hunts()
    except Exception:  # noqa: BLE001
        logger.exception("stranded-hunt recovery failed to list; skipping")
        return

    # Import here to avoid a circular dependency at module level
    from app.engine.supervisor import Supervisor

    registry: HuntRegistry = app.state.registry
    for h in stranded:
        hid = h["hunt_id"]
        try:
            if h.get("state") == "halted_boundary":
                handle = registry.register(hid)
                sup = Supervisor(hid, Emitter(hid, repo), repo, app.state.client, handle.commands)
                handle.task = asyncio.create_task(sup.resume_run(), name=f"resume-{hid}")
                logger.info("re-registered halted hunt %s for resume", hid)
                continue
            # Grace window: a hunt that emitted an event in the last few seconds may have been
            # mid-flush during a fast, graceful reload — skip it this pass rather than reap it a
            # heartbeat early. A crashed hunt is far staler than the grace and is reaped now.
            if float(h.get("last_event_age_s") or 0.0) < _REAP_GRACE_S:
                logger.info(
                    "stranded hunt %s still fresh (%.1fs) — leaving for grace pass",
                    hid,
                    h.get("last_event_age_s") or 0.0,
                )
                continue
            seq = (await repo.get_last_seq(hid)) + 1
            await repo.append_event(
                Event(
                    hunt_id=hid,
                    seq=seq,
                    type="hunt_failed",
                    actor="engine",
                    payload={"reason": "engine_restarted", "reason_plain_english": _RESTART_REASON},
                )
            )
            await repo.set_hunt_state(hid, "failed")
        except Exception:  # noqa: BLE001
            logger.warning("could not reconcile stranded hunt %s", hid)
            continue
