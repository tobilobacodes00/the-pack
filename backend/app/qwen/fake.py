"""FakeQwen — the deterministic, offline brain.

When there is no API key, the whole system still runs end to end: REST → Supervisor →
Emitter → Postgres → relay → Redis → gateway → canvas. The only thing swapped out is the
model call. FakeQwen returns canned-but-plausible text AND, for the structured calls the real
engine makes (plan, findings, merge, critique, gaps), a deterministic object SHAPED LIKE the
requested `response_schema` and woven from the actual task — so the dynamic engine exercises
the same code path offline, topic-aware, with realistic synthetic usage so the Boundary moves.

Deterministic: same spec in, same result out (no clocks, no randomness). The moment a real
`QWEN_API_KEY` lands, `QwenClient` stops routing here — zero change to the Supervisor or the
event stream.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable

from app.config import TIER_REGISTRY
from app.qwen import pricing
from app.qwen.types import CallSpec, CompletionResult

# Sized so cost is visible on the Boundary meter but a full hunt stays inside the $0.50
# first-hunt cap. Real Qwen calls are cheaper still.
_USAGE_BY_TIER: dict[str, tuple[int, int]] = {
    "flash": (20_000, 5_000),
    "plus": (28_000, 7_000),
    "max": (16_000, 4_000),
}


def _task_of(spec: CallSpec) -> str:
    """Pull the task out of the user message the Supervisor builds ("Task: …")."""
    for m in reversed(spec.messages or []):
        if m.get("role") == "user":
            content = str(m.get("content", ""))
            if content.startswith("Task:"):
                return content[len("Task:") :].split("\n", 1)[0].strip() or "the topic"
            return (content.split("\n", 1)[0].strip() or "the topic")[:120]
    return "the topic"


def _user_content_of(spec: CallSpec) -> str:
    """The full latest user message — deep_scout_step needs the whole running context, not just
    the one-line task, to return a stateful-looking-but-pure decision."""
    for m in reversed(spec.messages or []):
        if m.get("role") == "user":
            return str(m.get("content", ""))
    return ""


def _deep_scout_step(task: str, context: str) -> dict:
    """A deterministic decision for one turn of the bounded deep_scout loop. FakeQwen is STATELESS,
    so it dispatches on the running context (grows one "[turn N] …" line per turn) instead of
    counting turns. Scripted arc: turn 1 search → turn 2 fetch the first hit → turn 3+ finish."""
    did_search = "] searched " in context
    did_fetch = "] fetched " in context
    if not did_search:
        return {"action": "search", "query": f"{task} overview", "reason": "start broad"}
    if not did_fetch:
        # Matches what the canned search would surface.
        return {"action": "fetch", "url": "https://example.com/1", "reason": "read the top hit"}
    return {
        "action": "finish",
        "summary": f"deep_scout gathered sources on {task} across a search and a deep read.",
        "reason": "enough gathered",
    }


def _offline_result(intent: str, task: str) -> tuple[str, dict | None]:
    """Deterministic (text, parsed) for one intent, woven from the task. parsed is None for
    free-text intents (draft, chat) and a schema-shaped object for the structured ones."""
    if intent == "plan":
        summary = f"A parallel research plan on {task}: range on three angles, merge, draft."
        parsed: dict[str, object] = {
            "summary": summary,
            "team": [{"role": "scout", "count": 3}],
            "queries": [
                f"{task} — overview and key players",
                f"{task} — latest data and figures",
                f"{task} — risks, context, and outlook",
            ],
            "assumptions": [f"scope: {task}", "recent sources", "briefing format"],
            # No est_cost/est_time — the engine derives them per depth.
            "depth": "standard",
        }
        return summary, parsed
    if intent == "search":
        text = f"Found and summarized the key findings on {task}, each tied to a source."
        return text, {"summary": text, "confidence": 0.82}
    if intent == "merge":
        text = f"Cross-referenced the scouts' findings on {task}; the sources line up."
        parsed = {
            "summary": text,
            "claims": [
                f"{task}: the leading players and the shape of the landscape.",
                f"{task}: the most recent figures the sources agree on.",
                f"{task}: the key risk and what to watch next.",
            ],
            "conflict": None,
        }
        return text, parsed
    if intent == "critique":
        # Offline, Sentinel raises one challenge so the critique mode visibly does its job.
        parsed = {
            "ok": False,
            "issues": [
                {
                    "claim": f"the most recent figures on {task}",
                    "problem": "rests on a single source — needs a second to stand.",
                }
            ],
        }
        return "Challenged the weakest claim: it needs a second source.", parsed
    if intent == "gaps":
        parsed = {
            "gaps": [
                f"{task} — the missing quantitative detail",
                f"{task} — the most recent development",
            ]
        }
        return "Two gaps remain; sending the pack back in.", parsed
    if intent == "distill":
        # The Elder's end-of-hunt lesson — a typed, reusable line woven from the task.
        lesson = f"On {task}, primary sources beat aggregators — start there next time."
        return lesson, {"kind": "what-worked", "lesson": lesson}
    if intent == "standoff_challenge":
        return f"That claim on {task} leans on a single source — it needs a second to stand.", None
    if intent == "standoff_defend":
        return "Fair point — I'll pull a corroborating source before it goes in the brief.", None
    if intent == "standoff_judge":
        # "drop" keeps the offline flagged claim removed — the brief is unchanged by the ruling.
        return (
            "Alpha's call: drop — no second source stands this claim up.",
            {"verdict": "drop", "rationale": "No source on the table backs the claim."},
        )
    if intent == "conflict_decide":
        # Offline never actually hits this (merge returns conflict=None); kept for tests that drive
        # it directly.
        return (
            f"Alpha weighs the options on {task} and takes the better-sourced call.",
            {"choice": "", "rationale": "The evidence best supports this option."},
        )
    if intent == "lone":
        text = (
            f"# {task}\n\nA single-pass briefing on {task}. One researcher, one read: the broad "
            "strokes are here, but with less cross-checking and fewer sources than a full pack hunt."
        )
        return text, None
    if intent == "route_intent":
        # A deterministic keyword heuristic so the offline conversation still routes sensibly —
        # the live model does this far better; this just keeps hermetic tests meaningful.
        low = task.lower()
        if any(
            w in low
            for w in (
                "start again",
                "run it again",
                "retry",
                "try again",
                "do it over",
                "re-run",
                "rerun",
            )
        ):
            route = "retry"
        elif any(
            w in low for w in ("add ", "also research", "also look", "dig deeper", "expand on")
        ):
            route = "new_subhunt"
        elif any(
            w in low for w in ("redo", "rewrite", "restructure", "tighten", "shorten", "reword")
        ):
            route = "refine_rewrite"
        elif any(w in low for w in ("fix", "change the", "swap", "correct")):
            route = "refine_patch"
        elif any(w in low for w in ("thanks", "thank you", "nice", "great", "cool", "awesome")):
            route = "chatter"
        elif "?" in task:
            route = "question_about_brief"
        else:
            route = "new_hunt"
        return route, {"route": route, "confidence": 0.9, "requires_clarification": False}
    if intent == "judge":
        # The pack should win on depth + citations — that's the whole point of the Scorecard.
        return "Scored both briefings.", {"pack": 0.88, "lone": 0.62}
    if intent == "draft":
        # Howler writes TAGGED blocks so each line carries its sources (trace).
        blocks: list[dict[str, object]] = [
            {"text": f"What the pack found on {task}, from cited sources.", "source_ids": [1]},
            {"text": f"The leading players in {task} are taking shape.", "source_ids": [1, 2]},
            {"text": f"The key risk in {task}, and what changes next.", "source_ids": [2]},
        ]
        parsed = {"title": f"Briefing: {task}", "blocks": blocks}
        text = "\n\n".join(str(b["text"]) for b in blocks)
        return text, parsed
    return f"[offline] {intent} on {task}.", None


class FakeQwen:
    """Stands in for the real model. Same `complete` signature as QwenClient."""

    async def complete(
        self,
        spec: CallSpec,
        on_delta: Callable[[str], Awaitable[None]] | None = None,
    ) -> CompletionResult:
        in_tokens, out_tokens = _USAGE_BY_TIER.get(spec.tier, _USAGE_BY_TIER["plus"])
        model = TIER_REGISTRY.get(spec.tier, spec.tier)
        task = _task_of(spec)
        text: str
        parsed: dict | None
        if (spec.intent or "") == "deep_scout_step":
            decision = _deep_scout_step(task, _user_content_of(spec))
            text, parsed = json.dumps(decision), decision
        else:
            text, parsed = _offline_result(spec.intent or "", task)
        # Structured calls must return a parsed object; free-text calls return None.
        if spec.response_schema is None:
            parsed = None
        if on_delta and text:  # mirror the live path: surface one progress beat offline too
            await on_delta(text)
        return CompletionResult(
            text=text,
            model=model,
            tier=spec.tier,
            in_tokens=in_tokens,
            out_tokens=out_tokens,
            cost_usd=pricing.cost(spec.tier, in_tokens, out_tokens),
            parsed=parsed,
        )
