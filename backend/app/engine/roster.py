"""Team/roster composition — how a task becomes a concrete pack of wolves.

Extracted from the Supervisor to keep that file focused on the hunt loop. Pure data + functions:
Beta proposes only the SHAPE (mainly how many scouts); this expands it to the canonical team with
each role's tier/thinking/budget filled from ROLE_SPEC, and flattens a team into the rows to spawn.
"""

from __future__ import annotations

# v2: Alpha builds the team per task. Each role's tier/thinking/default per-wolf budget cap is fixed
# here (parsing prose from the prompt frontmatter is unreliable); Beta proposes only the SHAPE — how
# many scouts, mainly. Alpha + Beta lead every hunt; the support roles always join; scouts vary.
ROLE_SPEC: dict[str, tuple[str, bool, float]] = {
    # role:    (model_tier, thinking, default per-wolf budget cap USD)
    "alpha": ("max", True, 0.15),
    "beta": ("plus", True, 0.10),
    "scout": ("flash", False, 0.10),
    "tracker": ("plus", True, 0.15),
    "sentinel": ("max", True, 0.20),
    "howler": ("plus", False, 0.15),
    "elder": ("flash", False, 0.05),  # v2 memory agent — wired in Phase 2.6
    "doctor": ("flash", False, 0.05),  # v2 field medic — heals faulted agents (Phase 2.5)
}

# Canvas order: leads → the variable scouts → support (incl. the v2 Elder, the memory agent).
LEAD_ROLES = ["alpha", "beta"]
SUPPORT_ROLES = ["tracker", "sentinel", "howler", "elder"]
DEFAULT_SCOUTS = 3
MIN_SCOUTS = 1
MAX_SCOUTS = 5


def wolf_ids(role: str, count: int) -> list[str]:
    """Mint ids for a role. Scouts are always suffixed (scout-1..N, the canonical convention); a
    singleton of any other role keeps its bare role name; clones get -1..-N."""
    if role == "scout":
        return [f"scout-{i + 1}" for i in range(max(1, count))]
    if count <= 1:
        return [role]
    return [f"{role}-{i + 1}" for i in range(count)]


def build_team(parsed: dict) -> list[dict]:
    """Beta proposes the SHAPE (mainly scout count); expand to the canonical team — each role's
    tier/thinking/budget filled from ROLE_SPEC. Alpha + Beta always lead (×1); scouts vary 1..5;
    support roles default to 1 but honor a higher requested count (a cloned tracker, 1..3)."""
    proposed = {
        str(e.get("role")): int(e.get("count") or 0)
        for e in (parsed.get("team") or [])
        if isinstance(e, dict)
    }
    team: list[dict] = []
    for role in [*LEAD_ROLES, "scout", *SUPPORT_ROLES]:
        tier, thinking, budget = ROLE_SPEC[role]
        if role in LEAD_ROLES:
            count = 1
        elif role == "scout":
            want = proposed.get("scout", DEFAULT_SCOUTS) or DEFAULT_SCOUTS
            count = max(MIN_SCOUTS, min(MAX_SCOUTS, want))
        else:
            count = max(1, min(3, proposed.get(role, 1) or 1))
        team.append(
            {
                "role": role,
                "count": count,
                "tier": tier,
                "thinking": thinking,
                "budget_usd": round(budget, 4),
            }
        )
    return team


def roster_from_team(team: list[dict]) -> list[tuple[str, str, str, bool, float]]:
    """Flatten the team spec into (wolf_id, role, tier, thinking, budget_usd) rows to spawn."""
    rows: list[tuple[str, str, str, bool, float]] = []
    for entry in team:
        role = str(entry.get("role"))
        if role not in ROLE_SPEC:
            continue
        count = max(1, int(entry.get("count") or 1))
        tier = str(entry.get("tier") or ROLE_SPEC[role][0])
        thinking = bool(entry.get("thinking", ROLE_SPEC[role][1]))
        budget = float(entry.get("budget_usd") or ROLE_SPEC[role][2])
        for wid in wolf_ids(role, count):
            rows.append((wid, role, tier, thinking, budget))
    return rows
