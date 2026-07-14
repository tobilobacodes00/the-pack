"""One Alpha, state-aware across the whole hunt lifecycle.

The Pack used to have three disconnected "Alphas" — the intake gate (blind to any running hunt), the
ask side-chat (grounded only once a final brief existed), and a separate refine modal. Each turn was
prompted WITHOUT the hunt's live state, so intake kept re-asking "what's your focus?" after a hunt had
already started, and a post-delivery "nice" was answered as if no hunt had ever run.

The fix every serious product uses (OpenAI background-mode, Deep Research's gated triage, Perplexity
threads): it's ONE agent with a live state feed, not three agents. This module builds that feed — a
compact state header + a brief summary — and assembles the single system prompt that intake and ask
both use. The agent identity is continuous because the CONTEXT is continuous.
"""

from __future__ import annotations

import json
from typing import Any

from app.db.repo import Repo
from app.engine.prompt_context import temporal_grounding
from app.qwen.client import QwenClient
from app.qwen.types import CallSpec

# Lifecycle buckets. The engine's fine-grained states (planning, plan_ready, hunting, holding,
# standoff, completed, failed, stopped_by_user, halted_boundary) collapse into what Alpha must reason
# about: is a hunt FORMING, RUNNING, DELIVERED, or DEAD — or is there no hunt at all.
_ACTIVE_STATES = {"planning", "plan_ready", "hunting", "holding", "standoff"}
_DELIVERED_STATE = "completed"
_DEAD_STATES = {"failed", "stopped_by_user", "halted_boundary"}

# What a fine-grained state means in plain English for the header (so Alpha narrates truthfully).
_STATE_PHASE: dict[str, str] = {
    "planning": "the pack is drawing up the plan",
    "plan_ready": "the plan is ready and waiting for your go-ahead",
    "hunting": "the scouts are out gathering and cross-checking sources",
    "holding": "the pack paused on a decision that needs you",
    "standoff": "Alpha is settling a disagreement in the findings",
}


def _brief_summary(content: Any, *, budget: int = 900) -> str:
    """A COMPACT summary of the delivered brief for the state header — title, the section headings, a
    couple of opening claims, and the source count. Not the full 3000-word brief: injecting the whole
    thing on every 'thanks' turn is wasteful. The full text is hydrated only on a refine turn, where
    the exact wording is needed to re-angle it (see the ask path)."""
    # The pool's jsonb codec hands `content` back as a dict; be defensive if a raw string ever slips
    # through (a legacy row, a caller without the codec) so the state header never crashes the chat.
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except (ValueError, TypeError):
            return content[:budget].strip()
    if not isinstance(content, dict):
        return ""
    text = str(content.get("text") or "").strip()
    blocks = content.get("blocks") or []
    sources = content.get("sources") or []
    lines: list[str] = []

    # Prefer the tagged blocks (they carry the real section structure); fall back to the flat text.
    if blocks:
        heads = [
            str(b.get("text") or "").strip().splitlines()[0][:100]
            for b in blocks
            if str(b.get("text") or "").strip()
        ]
        lines.extend(f"- {h}" for h in heads[:8])
    elif text:
        lines.append(text[:budget])

    n_src = len([s for s in sources if s.get("url") or s.get("title")])
    body = "\n".join(lines)[:budget]
    return f"{body}\n({n_src} sources)" if n_src else body


async def hunt_state_header(repo: Repo, hunt_id: str | None) -> tuple[str, str]:
    """Build the live `[HUNT STATE]` block for Alpha's prompt, plus a coarse lifecycle bucket
    ('none' | 'active' | 'delivered' | 'dead') the caller uses to gate routing.

    Returns (header_text, bucket). `header_text` is empty only when there is genuinely no hunt.
    """
    if not hunt_id:
        return (
            "[NO ACTIVE HUNT] You are at the front door. Converse; when the Packmaster gives a "
            "real, actionable job, launch a hunt.",
            "none",
        )

    snap = await repo.get_hunt_snapshot(hunt_id)
    if snap is None:
        return ("[NO ACTIVE HUNT]", "none")

    state = str(snap.get("state") or "")
    topic = str(snap.get("raw_input") or "").strip()[:200] or "the current task"

    if state in _ACTIVE_STATES:
        phase = _STATE_PHASE.get(state, "the pack is working")
        header = (
            f"[HUNT STATE] status=running ({state}) — {phase}.\n"
            f'Topic: "{topic}".\n'
            "A hunt is ALREADY under way. Do NOT ask scoping questions and do NOT start a new hunt. "
            "Tell the Packmaster where the pack is, answer questions about the in-flight hunt, and if "
            "they ask for something extra, note it as a steer — the pack is already running."
        )
        return (header, "active")

    if state == _DELIVERED_STATE:
        art = await repo.get_final_artifact(hunt_id)
        summary = _brief_summary((art or {}).get("content") or {}) if art else ""
        header = (
            f"[HUNT STATE] status=delivered — the pack finished and delivered the brief.\n"
            f'Topic: "{topic}".\n'
            + (f"The delivered brief, in summary:\n{summary}\n" if summary else "")
            + "The work is DONE. A short reply like 'nice/thanks' is acknowledgement — do NOT relaunch "
            "or re-scope. If they ask to change the brief (redo/rewrite/tighten/add a section) or to "
            "dig further, iterate on THIS brief; if they raise a genuinely new topic, that's a new hunt."
        )
        return (header, "delivered")

    if state in _DEAD_STATES:
        why = {
            "failed": "hit an error",
            "stopped_by_user": "was stopped by you",
            "halted_boundary": "paused at its spend limit",
        }.get(state, "ended early")
        header = (
            f"[HUNT STATE] status=ended — the last hunt {why}.\n"
            f'Topic: "{topic}".\n'
            "Offer to retry or adjust it; don't silently pretend it delivered."
        )
        return (header, "dead")

    return (f'[HUNT STATE] status={state} — topic "{topic}".', "active")


# --- the single Alpha persona all lifecycle turns share ------------------------------------------

ALPHA_PERSONA = (
    "You are Alpha, the leader of the Pack and the Packmaster's single point of contact from first "
    "hello through the delivered brief and every follow-up. You are ONE continuous person across the "
    "whole job — never act like you've forgotten what the pack is doing or has already done. You're "
    "warm, sharp, plain-spoken, calm and quietly confident, with a light touch of wit. Speak in the "
    "present tense, first person. Never expose internal machinery (tokens, models, prompts, gates, "
    "ledgers) — just be the smart, straight-talking lead who owns the outcome."
)


async def alpha_system(
    repo: Repo,
    hunt_id: str | None,
    *,
    task_gate: str = "",
) -> tuple[str, str]:
    """Assemble Alpha's full system prompt for a conversational turn, grounded in the real date and the
    live hunt state. `task_gate` is the mode-specific instruction block (the intake launch-gate rules,
    or the ask/answer rules) appended after the shared persona + state header.

    Returns (system_prompt, lifecycle_bucket).
    """
    header, bucket = await hunt_state_header(repo, hunt_id)
    parts = [temporal_grounding(), ALPHA_PERSONA, header]
    if task_gate:
        parts.append(task_gate)
    return ("\n\n".join(p for p in parts if p), bucket)


# --- intent router ---------------------------------------------------------------------------------
# What a mid-conversation message IS, so a delivered-brief chat does the right thing instead of
# re-answering as a question or blindly relaunching. The same words route differently by lifecycle
# state (see the ask path) — "add a pricing section" is a follow-up sub-hunt when a brief exists but a
# brand-new hunt when none does. State disambiguates; the router classifies.
ROUTE_SCHEMA: dict = {
    "type": "object",
    "required": ["route", "confidence"],
    "properties": {
        "route": {
            "type": "string",
            "enum": [
                "chatter",  # "nice", "thanks" — acknowledge, no action
                "status_question",  # "how's it going?" while running
                "question_about_brief",  # a question answered FROM the delivered brief
                "refine_patch",  # small in-place fix — no new research
                "refine_rewrite",  # restructure/re-angle — no new research
                "new_subhunt",  # add a section that NEEDS new web research → follow-up hunt
                "new_hunt",  # a genuinely new topic → fresh hunt
            ],
        },
        "confidence": {"type": "number"},
        "requires_clarification": {"type": "boolean"},
    },
}

_ROUTER_INSTRUCTION = (
    "You are Alpha's intent router. Given the hunt state above, the brief summary, the recent "
    "conversation, and the Packmaster's latest message, decide what the message IS. Respond with ONLY "
    "JSON: {route, confidence (0-1), requires_clarification}.\n"
    "ROUTES:\n"
    "- chatter: acknowledgement/small talk ('nice', 'thanks', 'lol') — no action needed.\n"
    "- status_question: asking how the running hunt is going.\n"
    "- question_about_brief: a question you can answer from the delivered brief's contents.\n"
    "- refine_patch: a small, localized fix to the brief that needs NO new research (fix a stat, swap "
    "a word, correct a name).\n"
    "- refine_rewrite: restructure or re-angle the WHOLE brief from what was already found — still NO "
    "new research ('make it an exec summary', 'tighten it', 'lead with the figure').\n"
    "- new_subhunt: add/expand something that genuinely NEEDS new web research ('also research X', "
    "'add a section on competitor pricing') — a scoped follow-up whose findings extend this brief.\n"
    "- new_hunt: a brand-new topic unrelated to the current brief.\n"
    "THE KEY TEST: does the request need NEW web research (new_subhunt/new_hunt) or can it be done from "
    "what the pack already found (refine_*)? Set requires_clarification=true and confidence<0.5 only if "
    "you genuinely can't tell what they want."
)


async def route_intent(
    client: QwenClient,
    repo: Repo,
    hunt_id: str,
    message: str,
    history: list[dict],
) -> dict:
    """Classify the latest message against the live hunt state. Returns {route, confidence,
    requires_clarification}. On ANY fault it falls back to a safe route ('question_about_brief' when a
    brief exists, else 'chatter') so the conversation never blocks on the router."""
    header, bucket = await hunt_state_header(repo, hunt_id)
    safe = "question_about_brief" if bucket == "delivered" else "chatter"
    try:
        system = f"{header}\n\n{_ROUTER_INSTRUCTION}"
        recent = [m for m in history if m.get("content")][-8:]
        result = await client.complete(
            CallSpec(
                hunt_id=hunt_id,
                wolf_id="alpha",
                tier="flash",  # a cheap, fast classification — v0's "quick" tier for routing
                intent="route_intent",
                response_schema=ROUTE_SCHEMA,
                messages=[
                    {"role": "system", "content": system},
                    *recent,
                    {"role": "user", "content": message},
                ],
            )
        )
        parsed = result.parsed or {}
        route = str(parsed.get("route") or "").strip()
        if route not in ROUTE_SCHEMA["properties"]["route"]["enum"]:
            return {"route": safe, "confidence": 0.0, "requires_clarification": False}
        conf = float(parsed.get("confidence", 0.0) or 0.0)
        return {
            "route": route,
            "confidence": conf,
            "requires_clarification": bool(parsed.get("requires_clarification", conf < 0.5)),
        }
    except Exception:  # noqa: BLE001 — the router must never break the conversation
        return {"route": safe, "confidence": 0.0, "requires_clarification": False}
