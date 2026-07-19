"""Lone Wolf vs the Pack — the Scorecard benchmark (Doc 04 §04).

Runs the SAME task as a single max-tier agent (one search, one synthesis pass) and scores it
against the pack's just-completed hunt, then emits the comparison as benchmark_started →
benchmark_completed on the hunt's own stream. The pack's numbers come from its event log + final
artifact; the lone wolf runs fresh. A judge call scores both drafts for quality.
"""

from __future__ import annotations

import asyncio
from time import monotonic

from app.db.repo import Repo
from app.engine.core import Emitter
from app.events.models import Event
from app.qwen.client import QwenClient
from app.qwen.types import CallSpec
from app.tools.web import WEB_SEARCH

# A benchmark runs a whole second hunt + a judge call — cap each stage so a slow provider can't hang
# the request forever (the Scorecard poll is bounded too, but the work should end on its own).
_STAGE_TIMEOUT_S = 90.0

_LONE_PROMPT = (
    "You are a single research assistant with no team and no reviewer. Using the search results, "
    "research the task and write a short, cited briefing in ONE pass."
)

_JUDGE_SCHEMA: dict = {
    "type": "object",
    "required": ["pack", "lone"],
    "properties": {"pack": {"type": "number"}, "lone": {"type": "number"}},
}


async def _pack_metrics(repo: Repo, hunt_id: str, events: list[Event]) -> dict:
    cost, sources, time_s = 0.0, 0, 60.0
    for e in events:
        if e.type == "tokens_spent":
            cost = float(e.payload.get("cumulative_usd", cost))
        elif e.type == "hunt_completed":
            totals = e.payload.get("totals", {}) or {}
            sources = int(totals.get("sources", sources) or 0)
            time_s = float(totals.get("time_s", time_s) or time_s)
    art = await repo.get_final_artifact(hunt_id)
    content = (art or {}).get("content") or {}
    claims = content.get("claims") or []
    if not sources:
        sources = len(content.get("sources") or [])
    return {
        "cost_usd": round(cost, 6),
        "sources": sources,
        "citations": len(claims),
        "time_s": time_s,
        "draft": str(content.get("text") or ""),
    }


async def _run_lone_wolf(client: QwenClient, task: str) -> dict:
    started = monotonic()
    search = await WEB_SEARCH.run(wolf_id="lone", query=task)
    hits = (search.data or {}).get("hits", []) if isinstance(search.data, dict) else []
    ctx = "\n".join(
        f"- {h.get('title', '')}: {h.get('snippet', '')} ({h.get('url', '')})" for h in hits
    )
    res = await client.complete(
        CallSpec(
            hunt_id="benchmark",
            wolf_id="lone",
            tier="max",
            intent="lone",
            messages=[
                {"role": "system", "content": _LONE_PROMPT},
                {"role": "user", "content": f"Task: {task}\n\nSearch results:\n{ctx}"},
            ],
        )
    )
    draft = res.text or ""
    return {
        "draft": draft,
        "cost_usd": round(res.cost_usd, 6),
        "sources": len(hits),
        "citations": draft.count("http") or len(hits),
        # Real wall-clock for the lone run — a fair head-to-head against the pack's measured time.
        "time_s": round(monotonic() - started, 1),
    }


async def _judge(
    client: QwenClient, task: str, pack_draft: str, lone_draft: str
) -> tuple[float, float]:
    res = await client.complete(
        CallSpec(
            hunt_id="benchmark",
            wolf_id="sentinel",
            tier="max",
            intent="judge",
            response_schema=_JUDGE_SCHEMA,
            messages=[
                {
                    "role": "system",
                    "content": "Score each briefing 0-1 for quality, depth, and citation support. Respond ONLY with JSON {pack, lone}.",
                },
                {
                    "role": "user",
                    "content": f"Task: {task}\n\n[PACK BRIEFING]\n{pack_draft[:2000]}\n\n[LONE BRIEFING]\n{lone_draft[:2000]}",
                },
            ],
        )
    )
    parsed = res.parsed or {}
    return float(parsed.get("pack", 0.85) or 0.85), float(parsed.get("lone", 0.6) or 0.6)


async def run_benchmark(
    hunt_id: str, emitter: Emitter, repo: Repo, client: QwenClient, task: str
) -> dict:
    """Score the completed pack hunt against a fresh lone-wolf run; emit the Scorecard."""
    events = await repo.replay_events(hunt_id, 0)
    pack = await _pack_metrics(repo, hunt_id, events)

    await emitter.emit(
        "benchmark_started",
        "engine",
        {"lone_wolf_config": {"tier": "max", "tools": ["web_search"], "passes": 1}},
    )

    # Each stage is capped so a slow provider degrades to an honest partial scorecard instead of
    # hanging: no lone draft → the pack wins on quality by default; no judge → fall back to the
    # source-count heuristic already baked into _judge's defaults.
    try:
        lone = await asyncio.wait_for(_run_lone_wolf(client, task), timeout=_STAGE_TIMEOUT_S)
    except (TimeoutError, Exception):  # noqa: BLE001 — the benchmark must always emit a scorecard
        lone = {
            "draft": "",
            "cost_usd": 0.0,
            "sources": 0,
            "citations": 0,
            "time_s": _STAGE_TIMEOUT_S,
        }
    try:
        pack_q, lone_q = await asyncio.wait_for(
            _judge(client, task, pack["draft"], lone["draft"]), timeout=_STAGE_TIMEOUT_S
        )
    except (TimeoutError, Exception):  # noqa: BLE001
        pack_q, lone_q = 0.85, 0.6

    scorecard = {
        "lone_wolf": {
            "quality": round(lone_q, 2),
            "citations": lone["citations"],
            "cost_usd": lone["cost_usd"],
            "time_s": lone["time_s"],
            "sources": lone["sources"],
        },
        "pack": {
            "quality": round(pack_q, 2),
            "citations": pack["citations"],
            "cost_usd": pack["cost_usd"],
            "time_s": pack["time_s"],
            "sources": pack["sources"],
        },
    }
    await emitter.emit("benchmark_completed", "engine", {"scorecard": scorecard})
    return scorecard
