"""Team/roster composition — how a task becomes a concrete pack of wolves.

Extracted from the Supervisor to keep that file focused on the hunt loop. Pure data + functions:
Beta proposes only the SHAPE (mainly how many scouts); this expands it to the canonical team with
each role's tier/thinking/budget filled from ROLE_SPEC, and flattens a team into the rows to spawn.
"""

from __future__ import annotations

# Alpha builds the team per task. Each role's tier/thinking/default per-wolf budget cap is fixed here
# (parsing prose from the prompt frontmatter is unreliable); Beta proposes only the SHAPE — how many
# scouts, mainly. Alpha + Beta lead every hunt; the support roles always join; scouts vary.
ROLE_SPEC: dict[str, tuple[str, bool, float]] = {
    # role:    (model_tier, thinking, default per-wolf budget cap USD)
    "alpha": ("max", True, 0.15),
    "beta": ("plus", True, 0.10),
    "scout": ("flash", False, 0.10),
    "tracker": ("plus", True, 0.30),  # deep_dive merges twice + find_gaps = 3 plus calls
    "sentinel": ("max", True, 0.20),
    "howler": (
        "plus",
        False,
        0.40,
    ),  # headroom for a comprehensive deep draft (single dispatch)
    "elder": ("flash", False, 0.05),  # memory agent
    "doctor": ("flash", False, 0.05),  # retired, superseded by the Warden
    "warden": ("flash", False, 0.05),  # roaming healer — spawned on-demand to heal faults
}

# The scout tier scales with the brief's depth — a deep hunt does real fact-extraction with reasoning
# (plus + thinking), not snippet-skimming on flash. brief/standard fall through to ROLE_SPEC["scout"]
# at CALL time (a test monkeypatch of that entry still governs them). Resolved at spawn (post-approve),
# never baked into the team (which stays depth-agnostic).
SCOUT_DEPTH_SPEC: dict[str, tuple[str, bool, float]] = {"deep": ("plus", True, 0.15)}


def scout_spec(depth: str) -> tuple[str, bool, float]:
    """(tier, thinking, budget) for a scout at this depth. Deep → plus+thinking+0.15; brief/standard
    fall through to ROLE_SPEC['scout'] read live (so a monkeypatch of it still governs). The budget is
    never lowered below the base cap (tier + cap move together — a plus scout can't spawn flash-sized)."""
    base = ROLE_SPEC["scout"]
    override = SCOUT_DEPTH_SPEC.get(depth)
    if override is None:
        return base
    tier, thinking, budget = override
    return (tier, thinking, max(budget, base[2]))


# Canvas order: leads → the variable scouts → support (incl. the Elder, the memory agent).
LEAD_ROLES = ["alpha", "beta"]
SUPPORT_ROLES = ["tracker", "sentinel", "howler", "elder"]
# The Warden (field-medic) is a STANDING member of every pack — always ×1, on the canvas from the
# start, idle until an agent faults (then it roams to heal). It is FIXED (like the leads): the user
# can't remove or clone it in the editor, but the engine still auto-clones it for simultaneous faults.
FIXED_ROLES = ["warden"]
DEFAULT_SCOUTS = 3
MIN_SCOUTS = 1
MAX_SCOUTS = 5


def wolf_ids(role: str, count: int) -> list[str]:
    """Mint ids for a role. Scouts are always suffixed (scout-1..N, the canonical convention). Every
    OTHER role keeps its bare role name for the PRIMARY instance and suffixes only the extras —
    "tracker", "tracker-2", "tracker-3". This is load-bearing: the merge/critique/draft steps address
    the primary by its bare id (self._wolves["tracker"], ["sentinel"], ["howler"]), so if a second
    instance renamed the primary to "tracker-1" the bare lookup would KeyError and the whole hunt would
    fail the moment a support role was cloned in the formation editor."""
    if role == "scout":
        return [f"scout-{i + 1}" for i in range(max(1, count))]
    n = max(1, count)
    return [role] + [f"{role}-{i}" for i in range(2, n + 1)]


def build_team(parsed: dict) -> list[dict]:
    """Beta proposes the SHAPE (mainly scout count); expand to the canonical team — each role's
    tier/thinking/budget filled from ROLE_SPEC. Alpha + Beta always lead (×1); scouts vary 1..5;
    support roles default to 1 but honor a higher requested count (a cloned tracker, 1..3); the
    Warden is a FIXED ×1 standing medic (always present, not user-editable)."""
    proposed = {
        str(e.get("role")): int(e.get("count") or 0)
        for e in (parsed.get("team") or [])
        if isinstance(e, dict)
    }
    team: list[dict] = []
    for role in [*LEAD_ROLES, "scout", *SUPPORT_ROLES, *FIXED_ROLES]:
        tier, thinking, budget = ROLE_SPEC[role]
        if role in LEAD_ROLES or role in FIXED_ROLES:
            count = 1  # leads + the Warden are locked at exactly one
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
