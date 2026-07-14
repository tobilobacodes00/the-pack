"""deep_scout — the ONE bounded, model-driven tool-loop (the study's opt-in architecture bet).

Every other wolf is strictly single-turn: the engine scripts the tool calls (search → fetch → …) in
Python and the wolf gets exactly one model call to synthesize. A `deep_scout` wolf instead gets up to
N turns to CHOOSE its next move — search again with a refined query, fetch a specific URL it just saw,
or finish — based on what it has read so far. That's the fundamental difference from the rest of the
pack, and the reason it's gated OFF by default and must be proven on the live-key harness first.

WHY THIS IS SAFE TO ADD without destabilizing the single-turn spine:
  * It's OPT-IN (settings.deep_scout_enabled, default False) and lives in its own module — nothing calls
    it unless a strategy explicitly opts a wolf into it.
  * The loop is HARD-CAPPED at settings.deep_scout_max_iterations — a runaway can't happen, and each
    iteration still goes through the caller-supplied `dispatch` (the Supervisor's Boundary-gated
    _dispatch), so the per-wolf spend meter bounds cost exactly as it does for a normal wolf. The
    Boundary is already a running per-wolf-id accumulator, so N calls just accumulate correctly.
  * Tools are limited to the TWO the engine already calls deterministically (web_search, web_fetch),
    passed in as callables — the loop can't reach anything new.
  * FakeQwen returns a deterministic script for the `deep_scout_step` intent, so the whole loop runs
    offline and is fully testable without a key.

It emits an additive `tool_selected` event per turn so the choice sequence is visible on the canvas.
This module does the ORCHESTRATION only; it never calls the model or the tools directly — both are
injected, so the Supervisor keeps owning gating, emission, and seq assignment.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

# The structured decision a deep_scout wolf returns each turn. FakeQwen scripts this offline; live, the
# wolf's prompt instructs it to return exactly this shape.
DEEP_SCOUT_STEP_SCHEMA = {
    "type": "object",
    "required": ["action"],
    "properties": {
        "action": {"type": "string", "enum": ["search", "fetch", "finish"]},
        "query": {"type": "string"},
        "url": {"type": "string"},
        "summary": {"type": "string"},
        "reason": {"type": "string"},
    },
}

# Injected callables — kept as narrow types so the loop can't reach anything but these two tools + one
# model dispatch. Each returns plain data; the Supervisor's real implementations gate and emit.
Dispatch = Callable[[str], Awaitable[dict]]  # (context) -> the wolf's parsed decision dict
SearchFn = Callable[[str], Awaitable[list[dict]]]  # (query) -> hits
FetchFn = Callable[[str], Awaitable[str]]  # (url) -> page text
EmitSelected = Callable[[int, str, str], Awaitable[None]]  # (iteration, tool, args_summary)


@dataclass
class DeepScoutResult:
    summary: str
    hits: list[dict] = field(default_factory=list)  # everything the loop gathered
    iterations: int = 0  # how many turns it actually used (<= the cap)
    stopped_reason: str = ""  # "finished" | "cap_reached" | "no_action"


def _summarize_arg(action: str, decision: dict) -> str:
    if action == "search":
        return str(decision.get("query") or "")[:200]
    if action == "fetch":
        return str(decision.get("url") or "")[:200]
    return ""


async def run_deep_scout(
    *,
    task: str,
    max_iterations: int,
    dispatch: Dispatch,
    search: SearchFn,
    fetch: FetchFn,
    emit_selected: EmitSelected,
) -> DeepScoutResult:
    """Drive the bounded loop. Each turn: ask the wolf for a decision (via `dispatch`, which the
    Supervisor gates + accounts), emit which tool it chose, then execute that tool and fold the result
    back into the running context for the next turn. Stops on `finish`, on the hard iteration cap, or
    on a malformed/empty decision (fail-safe: treat as finish rather than loop). Never exceeds
    `max_iterations` model calls."""
    hits: list[dict] = []
    context_parts = [f"Task: {task}", "You have gathered nothing yet. Decide your first move."]
    summary = ""
    stopped_reason = "cap_reached"
    used = 0

    for turn in range(1, max_iterations + 1):
        used = turn
        decision = await dispatch("\n\n".join(context_parts))
        action = str((decision or {}).get("action") or "").strip().lower()

        if action not in ("search", "fetch", "finish"):
            # Malformed/empty decision — don't spin; take what we have and stop.
            stopped_reason = "no_action"
            summary = str((decision or {}).get("summary") or "").strip()
            break

        await emit_selected(turn, action, _summarize_arg(action, decision))

        if action == "finish":
            summary = str(decision.get("summary") or "").strip()
            stopped_reason = "finished"
            break

        if action == "search":
            query = str(decision.get("query") or task).strip()
            new_hits = await search(query)
            hits.extend(new_hits)
            found = "; ".join(str(h.get("title") or h.get("url") or "") for h in new_hits[:5])
            context_parts.append(
                f"[turn {turn}] searched {query!r} → {len(new_hits)} hits: {found or 'none'}"
            )
        elif action == "fetch":
            url = str(decision.get("url") or "").strip()
            text = await fetch(url) if url else ""
            # Attach the fetched text to a matching gathered hit (so it's marked read) or record a new one.
            matched = next((h for h in hits if h.get("url") == url), None)
            if matched is not None:
                matched["text"] = text
            elif url:
                hits.append({"url": url, "title": url, "text": text})
            context_parts.append(
                f"[turn {turn}] fetched {url!r} → {len(text)} chars"
                + (f": {text[:300]}" if text else " (empty)")
            )

    # If the loop hit the cap without an explicit finish, use whatever the last summary was, or a
    # neutral note — the caller (a strategy) still has `hits` to synthesize from.
    if not summary and stopped_reason == "cap_reached":
        summary = f"Reached the {max_iterations}-step limit with {len(hits)} source(s) gathered."

    return DeepScoutResult(
        summary=summary, hits=hits, iterations=used, stopped_reason=stopped_reason
    )
