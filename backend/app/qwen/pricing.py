"""Token → USD pricing.

The Boundary enforces a *dollar* budget, so every call's token usage must become a cost.
Rates are per-tier, per 1M tokens, sourced from config (env-overridable) — never hard-coded,
because the real Qwen numbers get confirmed in Model Studio when the key lands.
"""

from __future__ import annotations

import logging

from app.config import settings

_LOG = logging.getLogger("pack")

# tier -> (input USD per 1M tokens, output USD per 1M tokens)
RATES: dict[str, tuple[float, float]] = {
    "max": (settings.price_max_in_per_m, settings.price_max_out_per_m),
    "plus": (settings.price_plus_in_per_m, settings.price_plus_out_per_m),
    "flash": (settings.price_flash_in_per_m, settings.price_flash_out_per_m),
}

# Below this per-1M input rate a table is almost certainly misconfigured (real Qwen tiers are
# ~$0.10–$1.60/1M in). A too-low table makes the Boundary under-count and halt far too late.
_PRICE_FLOOR_PER_M = 0.01


def validate_pricing() -> list[str]:
    """Sanity-check the pricing table at boot. Returns a list of human-readable problems (empty if
    fine). Called from the app lifespan: logs a loud WARNING, and — if settings.strict_pricing — the
    caller refuses to start. Cheap insurance against a silent 100–1000× spend under-count."""
    problems: list[str] = []
    for tier, (in_rate, out_rate) in RATES.items():
        if in_rate < _PRICE_FLOOR_PER_M:
            problems.append(
                f"{tier}: input rate ${in_rate}/1M is below the ${_PRICE_FLOOR_PER_M}/1M floor — "
                "the Boundary spend cap will under-count real cost"
            )
        if out_rate < in_rate:
            problems.append(f"{tier}: output rate ${out_rate}/1M < input ${in_rate}/1M (unusual)")
    if problems:
        _LOG.warning("PRICING LOOKS MISCONFIGURED — %s", "; ".join(problems))
    return problems


def cost(tier: str, in_tokens: int, out_tokens: int) -> float:
    """USD for one call. Unknown tiers fall back to 'plus' (the safe middle)."""
    in_rate, out_rate = RATES.get(tier, RATES["plus"])
    usd = in_tokens / 1_000_000 * in_rate + out_tokens / 1_000_000 * out_rate
    return round(usd, 6)


# Typical per-call token footprint per tier, for the Boundary's PRE-dispatch estimate (it
# must project spend before the call, when the real usage isn't known yet).
_EST_TOKENS: dict[str, tuple[int, int]] = {
    "max": (40_000, 9_000),
    "plus": (85_000, 17_000),
    "flash": (60_000, 12_000),
}


def estimate(tier: str) -> float:
    """Projected USD for one call on this tier — what the gate checks before dispatch."""
    in_tokens, out_tokens = _EST_TOKENS.get(tier, _EST_TOKENS["plus"])
    return cost(tier, in_tokens, out_tokens)
