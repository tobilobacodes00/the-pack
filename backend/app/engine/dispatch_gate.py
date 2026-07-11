"""The boundary gate — the pure decision at the heart of every model dispatch (Doc 04 §04, F7).

This is the flagship spend-safety logic, lifted out of the Supervisor so it can be unit-tested in
isolation: given a wolf and the hunt's spend state, decide — BEFORE the call — whether to downgrade
the tier, relieve the wolf at its own cap, halt at the Boundary, or warn, and RESERVE the estimated
cost. It is pure of I/O: it mutates the passed-in spend state (the Boundary, the per-wolf spend, the
relieved set) and returns a `GateDecision` describing what the caller must emit/act on. The caller
holds the dispatch lock around this call, so check-and-reserve stays atomic against parallel scouts.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.engine.boundary import Boundary, Verdict
from app.engine.wolves import Wolf
from app.qwen import pricing


@dataclass
class GateDecision:
    """What the gate decided — the caller emits the events and performs the I/O."""

    est: float  # reserved (estimated) spend for this call
    relieve: bool = False  # the wolf blew its own cap even at flash — stands down, no call
    halt: bool = False  # the hunt Boundary would be crossed — pause + checkpoint, no call
    cap_downgrade: tuple[str, bool] | None = (
        None  # (from_tier, thinking) dropped to flash on wolf cap
    )
    boundary_downgrade: tuple[str, bool] | None = (
        None  # (from_tier, thinking) dropped on Boundary 85%
    )
    warn: dict | None = None  # boundary_warning payload if the 70% line was first crossed here


def decide_and_reserve(
    wolf: Wolf,
    boundary: Boundary,
    wolf_budget: dict[str, float],
    wolf_spend: dict[str, float],
    relieved: set[str],
    warned: bool,
) -> GateDecision:
    """Per-wolf cap + hunt Boundary gate BEFORE a model call, reserving the estimate. Mutates
    `wolf.tier`/`wolf.thinking` on a downgrade, adds to `relieved` on relief, and reserves `est` into
    `boundary`/`wolf_spend`. Returns the decisions the caller acts on. No I/O — call under the lock.

    Note (preserved behavior): a Boundary DOWNGRADE drops the wolf to flash but does NOT re-estimate,
    so it reserves the original (higher) estimate and reconciles to actual after the call — a
    conservative over-reserve. Only a per-WOLF-cap downgrade re-estimates, because that estimate is
    what the cap comparison then hinges on.
    """
    est = pricing.estimate(wolf.tier)
    d = GateDecision(est=est)

    # Per-wolf cap: one runaway wolf must not drain the whole hunt. Drop to flash once; if still over
    # cap, relieve it — the pack carries on, the hunt never halts for one wolf.
    cap = wolf_budget.get(wolf.wolf_id)
    if cap is not None and wolf_spend.get(wolf.wolf_id, 0.0) + est > cap:
        if wolf.tier != "flash":
            d.cap_downgrade = (wolf.tier, wolf.thinking)
            wolf.tier, wolf.thinking = "flash", False
            est = d.est = pricing.estimate("flash")
        if wolf_spend.get(wolf.wolf_id, 0.0) + est > cap:
            relieved.add(wolf.wolf_id)
            d.relieve = True

    if not d.relieve:
        verdict = boundary.check(est)
        if verdict is Verdict.HALT:
            d.halt = True
        else:
            if verdict is Verdict.DOWNGRADE and wolf.tier != "flash":
                d.boundary_downgrade = (wolf.tier, wolf.thinking)
                wolf.tier, wolf.thinking = "flash", False
            if verdict is Verdict.WARN and not warned:
                d.warn = {
                    "pct": round(boundary.projected_pct(est), 2),
                    "cumulative_usd": round(boundary.cumulative_usd, 6),
                }
            # RESERVE estimated spend atomically — reconciled to actual after the call.
            boundary.cumulative_usd += est
            wolf_spend[wolf.wolf_id] = wolf_spend.get(wolf.wolf_id, 0.0) + est

    return d
