"""Local-only pack memory (v2, deepened) — what the pack LEARNED across hunts, no accounts.

The Elder reads recent lessons to seed planning (so the next hunt starts smarter) and, at the end of
a hunt, distills ONE durable lesson for next time. Each lesson is TYPED by kind — what worked, what
failed, a Packmaster preference, or a topic insight — so recall can surface it as guidance rather than
a log line. This module is the thin facade the Supervisor uses; the lessons live in the device's
Postgres `memory` table (its `kind` column carries the type). Memory must NEVER break a hunt — every
call is best-effort and degrades to "no memory" on any error.
"""

from __future__ import annotations

import re
from typing import Protocol

_CAP = 4  # at most this many past lessons injected — keep the context lean but let a few kinds show

# The lesson kinds the Elder writes. `takeaway` is the legacy/untyped kind (older rows + the
# deterministic fallback) — still recalled, just grouped last. Order here is the recall display order.
KINDS: tuple[str, ...] = ("preference", "what-worked", "what-failed", "topic-insight", "takeaway")

# How each kind reads when whispered to Beta. Preferences lead — they're standing instructions, not
# topic-bound — so they surface even when the topic words don't overlap (see `_relevant`).
_KIND_HEADER: dict[str, str] = {
    "preference": "What the Packmaster prefers",
    "what-worked": "What worked on similar hunts",
    "what-failed": "What to avoid (bit the pack before)",
    "topic-insight": "What the pack already knows about this",
    "takeaway": "From past hunts",
}


class MemoryStore(Protocol):
    async def recent_memory(self, limit: int = 5) -> list[dict]: ...
    async def save_memory(self, hunt_id: str | None, kind: str, text: str) -> None: ...


def _words(text: str) -> set[str]:
    return {w for w in re.split(r"[^a-z0-9]+", (text or "").lower()) if len(w) > 2}


def normalize_kind(kind: str | None) -> str:
    k = (kind or "").strip().lower()
    return k if k in KINDS else "takeaway"


def _relevant(rows: list[dict], task: str) -> list[dict]:
    """Rank past lessons for THIS task. A global recency dump would pollute every hunt with unrelated
    lessons (and burn tokens), so topic-bound kinds are kept only when they share keywords with the
    task. Preferences are the exception — they're standing instructions, not topic-bound, so they
    always carry. Ranked by (kind priority, keyword overlap, recency), capped at `_CAP`.

    `rows` arrives newest-first (repo order); enumeration index is the recency rank."""
    task_words = _words(task)
    scored: list[tuple[int, int, int, dict]] = []
    for recency, row in enumerate(rows):
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        kind = normalize_kind(row.get("kind"))
        overlap = len(task_words & _words(text))
        # Preferences carry even with no overlap; every other kind needs a topic signal to surface.
        if kind != "preference" and overlap == 0:
            continue
        priority = KINDS.index(kind)  # lower = shown first
        scored.append((priority, -overlap, recency, row))
    scored.sort(key=lambda t: (t[0], t[1], t[2]))
    return [row for *_ignore, row in scored[:_CAP]]


async def recall_items(repo: MemoryStore, task: str = "", limit: int = 12) -> list[dict]:
    """The recalled lessons THEMSELVES (id/kind/text rows), ranked and capped exactly as recall()
    injects them. The supervisor uses these to also register each recalled lesson as a citable
    source (memory://<id>) — so a brief that leaned on the pack's memory says so, with a receipt."""
    try:
        rows = await repo.recent_memory(limit)  # active only — a vetoed lesson never steers a hunt
    except Exception:  # noqa: BLE001 — memory is best-effort; never sink a hunt
        return []
    return _relevant(rows, task)


def render_note(picked: list[dict]) -> str:
    """The whisper to Beta: recalled lessons grouped by kind, phrased as guidance. '' when empty."""
    if not picked:
        return ""
    by_kind: dict[str, list[str]] = {}
    for row in picked:
        kind = normalize_kind(row.get("kind"))
        by_kind.setdefault(kind, []).append(str(row.get("text") or "").strip())
    lines = ["What the pack learned on past hunts (weigh it if relevant):"]
    for kind in KINDS:
        for text in by_kind.get(kind, []):
            lines.append(f"- [{_KIND_HEADER[kind]}] {text}")
    return "\n".join(lines)


def as_sources(picked: list[dict]) -> list[dict]:
    """Recalled lessons as injectable source dicts — memory:// mirrors the library's lib://
    pattern (tools/knowledge.py), so a lesson the brief leaned on gets a stable [N] and shows up
    in the Sources list and the Receipts credited to the Elder. Rows without a real id are
    skipped (nothing citable to point at)."""
    out: list[dict] = []
    for row in picked:
        text = str(row.get("text") or "").strip()
        rid = row.get("id")
        if not text or rid is None:
            continue
        kind = normalize_kind(row.get("kind"))
        out.append(
            {
                "title": f"Pack memory — {_KIND_HEADER[kind]}",
                "url": f"memory://{rid}",  # synthetic, stable — survives source de-dupe
                "snippet": text[:400],
                "text": text,
                "by": "elder",
                "verified": True,
            }
        )
    return out


async def recall(repo: MemoryStore, task: str = "", limit: int = 12) -> str:
    """A short note of what the pack LEARNED on past hunts, relevant to THIS task, to seed planning.
    Grouped by kind and phrased as guidance for Beta. Empty on a first hunt or when nothing relevant."""
    return render_note(await recall_items(repo, task, limit))


async def remember(repo: MemoryStore, hunt_id: str, text: str, kind: str = "takeaway") -> None:
    """Write one durable, typed lesson from this hunt for next time (best-effort). `kind` is one of
    KINDS; anything else is stored as the legacy `takeaway`."""
    text = (text or "").strip()
    if not text:
        return
    try:
        await repo.save_memory(hunt_id, normalize_kind(kind), text)
    except Exception:  # noqa: BLE001
        pass
