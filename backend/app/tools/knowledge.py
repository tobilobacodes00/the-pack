"""Local knowledge base (v4.2) — your own documents, woven into a hunt's research.

Uploaded files are parsed to text and stored (the `documents` table). When a hunt runs, the most
relevant docs are selected by simple keyword overlap with the task and injected as SOURCES — each
with a synthetic `lib://<id>` url so the source de-dupe (which keys on url) keeps them, and
`by="your library", verified=True` so they read as first-class, traceable ground in the brief.

Deterministic (no model call) so the offline path stays green. Best-effort: never sink a hunt.
"""

from __future__ import annotations

import re

from app.engine.prompt_context import depth_mult

_MAX_DOCS = 4  # standard base — scaled by depth in select_relevant
_PER_DOC = 1800  # chars of a doc injected
_BUDGET = 5000  # total chars across all injected docs (keeps context bounded), standard base


def _words(text: str) -> set[str]:
    return {w for w in re.split(r"[^a-z0-9]+", (text or "").lower()) if len(w) > 2}


def select_relevant(docs: list[dict], task: str, depth: str = "standard") -> list[dict]:
    """Pick the docs sharing keywords with the task; return them as injectable source dicts. Deeper
    hunts carry more library ground (more docs, larger budget)."""
    task_words = _words(task)
    if not task_words:
        return []
    # int() cast is mandatory — depth_mult returns a float and a float slice/count is a TypeError.
    max_docs = max(1, int(_MAX_DOCS * depth_mult(depth)))
    budget = int(_BUDGET * depth_mult(depth))
    scored: list[tuple[int, dict]] = []
    for d in docs:
        overlap = len(task_words & _words(str(d.get("text") or "")))
        if overlap:
            scored.append((overlap, d))
    scored.sort(key=lambda t: t[0], reverse=True)

    out: list[dict] = []
    used = 0
    for _score, d in scored[:max_docs]:
        excerpt = str(d.get("text") or "")[:_PER_DOC]
        if used + len(excerpt) > budget:
            excerpt = excerpt[: max(0, budget - used)]
        if not excerpt:
            break
        used += len(excerpt)
        out.append(
            {
                "title": str(d.get("name") or "document"),
                "url": f"lib://{d.get('id')}",  # synthetic, stable — survives source de-dupe
                "snippet": excerpt[:400],
                "text": excerpt,
                "by": "your library",
                "verified": True,
            }
        )
    return out
