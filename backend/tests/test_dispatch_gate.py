"""The boundary gate (app/engine/dispatch_gate.py) — the flagship spend-safety decision, unit-tested
in isolation. Estimates are read from pricing so the thresholds hold whatever the configured rates."""

from __future__ import annotations

from app.engine.boundary import Boundary
from app.engine.dispatch_gate import decide_and_reserve
from app.engine.wolves import Wolf
from app.qwen import pricing
from app.qwen.client import QwenClient


def _wolf(tier: str = "plus", thinking: bool = True, wolf_id: str = "scout-1") -> Wolf:
    return Wolf(
        hunt_id="h",
        wolf_id=wolf_id,
        role="scout",
        tier=tier,
        thinking=thinking,
        prompt_version="v1",
        client=QwenClient(),
    )


def _boundary_at(pct: float, tier: str) -> Boundary:
    """A Boundary sized so ONE call at `tier` projects to ~pct% of the ceiling."""
    est = pricing.estimate(tier)
    return Boundary(boundary_usd=est / (pct / 100.0))


def test_ok_reserves_and_returns_no_flags() -> None:
    b = _boundary_at(20, "plus")  # ~20% → OK
    wolf = _wolf()
    d = decide_and_reserve(wolf, b, {}, {}, set(), warned=False)
    assert not d.relieve and not d.halt and d.warn is None
    assert d.boundary_downgrade is None and d.cap_downgrade is None
    assert b.cumulative_usd == d.est  # reserved exactly the estimate
    assert wolf.tier == "plus"  # untouched


def test_warn_fires_once_at_70_percent() -> None:
    b = _boundary_at(75, "plus")
    wolf = _wolf()
    d1 = decide_and_reserve(wolf, b, {}, {}, set(), warned=False)
    assert d1.warn is not None and d1.warn["pct"] >= 70
    # A second call with warned=True must NOT warn again (one warning per hunt).
    d2 = decide_and_reserve(_wolf(), b, {}, {}, set(), warned=True)
    assert d2.warn is None


def test_downgrade_at_85_drops_to_flash() -> None:
    b = _boundary_at(90, "plus")
    wolf = _wolf(tier="plus", thinking=True)
    d = decide_and_reserve(wolf, b, {}, {}, set(), warned=False)
    assert d.boundary_downgrade == ("plus", True)
    assert wolf.tier == "flash" and wolf.thinking is False


def test_halt_at_100_reserves_nothing() -> None:
    b = Boundary(boundary_usd=1.0)
    b.cumulative_usd = 1.0  # already at the ceiling
    before = b.cumulative_usd
    d = decide_and_reserve(_wolf(), b, {}, {}, set(), warned=False)
    assert d.halt is True
    assert b.cumulative_usd == before  # a halt never reserves


def test_per_wolf_cap_downgrades_then_relieves() -> None:
    wolf = _wolf(tier="plus")
    tiny = pricing.estimate("flash") / 2  # below even the flash estimate → can't afford any call
    relieved: set[str] = set()
    d = decide_and_reserve(
        wolf, Boundary(boundary_usd=1000.0), {wolf.wolf_id: tiny}, {}, relieved, False
    )
    assert wolf.tier == "flash"  # tried the cheaper tier first
    assert d.relieve is True and wolf.wolf_id in relieved


def test_reconcile_math_nets_out() -> None:
    """Reserve an estimate, then a refund (error path) must return the ledger to zero."""
    b = Boundary(boundary_usd=1000.0)
    wolf = _wolf()
    spend: dict[str, float] = {}
    d = decide_and_reserve(wolf, b, {}, spend, set(), warned=False)
    assert b.cumulative_usd == d.est and spend[wolf.wolf_id] == d.est
    # Simulate the Supervisor's refund on a failed call.
    b.cumulative_usd -= d.est
    spend[wolf.wolf_id] -= d.est
    assert abs(b.cumulative_usd) < 1e-9 and abs(spend[wolf.wolf_id]) < 1e-9
