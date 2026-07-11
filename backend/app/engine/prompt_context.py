"""Prompt + context assembly for a wolf's dispatch — pure, model-free string building.

Extracted from the Supervisor so the hunt loop isn't carrying prompt plumbing. Every function here is
pure: it takes the few hunt fields it needs (the task, handler notes, findings, sources, library
picks, extra inputs) and returns the message list or context string to hand the model. The Supervisor
keeps thin wrappers that pass its state in, so the Engine-primitive call sites are unchanged.
"""

from __future__ import annotations

from app.config import settings
from app.engine.strategies import Conflict, Finding, Merged
from app.engine.wolves import Wolf
from app.prompts import load_prompt
from app.qwen.context_budget import fit_context

# What each dispatch asks its wolf to do. The role's prompt file is the system message; this is
# the task-specific instruction appended to the user message.
INTENT_INSTRUCTIONS: dict[str, str] = {
    "plan": (
        "Break this into a research plan and size the pack to the task. Respond with ONLY JSON: a "
        "one-line `summary`; a `team` array of {role, count} — pick 1-5 `scout`s (more for a broad "
        "topic, fewer for a narrow one); a `queries` array with ONE plain-keyword search query per "
        "scout (match the scout count); an `assumptions` array; and numeric `est_cost` (USD) and "
        "`est_time` (seconds). Queries: plain keywords only — NO operators (site:, OR/AND, quotes, "
        "'past week'); the engine handles recency. Keep each query BROAD enough to return results — "
        "2-5 common head keywords (the topic plus ONE facet), not a hyper-specific phrase."
    ),
    "search": (
        "Using ONLY the search results and full-text provided, write a SUBSTANTIVE summary of the "
        "findings for your angle — capture the specific facts, figures, named entities, and dates the "
        "pages actually contain, not a one-line gist. Respond with ONLY JSON: `summary` (string, "
        "several sentences) and `confidence` (0-1). Never invent a source or a fact not on the pages."
    ),
    "merge": (
        "Cross-reference the scouts' findings into a rich set of claims. Respond with ONLY JSON: a "
        "`summary`; a `claims` array of 6-12 DISTINCT, specific claims — each a concrete finding with "
        "the figures / names / dates the sources give, not a vague generality; and `conflict` — a "
        "genuine disagreement as {question, options, recommended}, or null when the sources agree. "
        "Only raise a conflict that is really there."
    ),
    "critique": (
        "Check that every claim carries a real source and is supported. Respond with ONLY JSON: "
        "`ok` (boolean) and `issues` (array of {claim, problem}). Be strict but fair."
    ),
    "gaps": (
        "Name what is still missing to answer the task well. Respond with ONLY JSON: `gaps` "
        "(array of focused follow-up search queries). Empty array if nothing is missing."
    ),
    "draft": (
        "Write a THOROUGH final briefing as ONLY JSON: a `title` and a `blocks` array. Aim for one "
        "substantive paragraph per major claim or theme (typically 5-9 blocks), each with the concrete "
        "specifics — figures, names, dates — the sources support. Each block is {text, source_ids}: "
        "`text` is one paragraph of clear prose, `source_ids` are the NUMBERS of the sources (from the "
        "numbered Sources list) that back it. Cite real sources only; if a paragraph isn't supported "
        "by a listed source, leave its source_ids empty. Don't pad, but don't leave real, sourced "
        "detail out. Build on the merged claims and honor the resolved decision if one is given."
    ),
    "standoff_challenge": (
        "You are challenging a weak claim. In one or two sentences, state plainly why it doesn't "
        "yet stand — what evidence is missing or thin. Be specific, not rude."
    ),
    "standoff_defend": (
        "You are defending your claim against a challenge. In one or two sentences, either "
        "concede and say how you'll strengthen it, or defend it with the evidence you have."
    ),
    "standoff_judge": (
        "You are Alpha settling a standoff. In one or two sentences, make the call: keep, drop, or "
        "qualify the claim, and say why. Plain English."
    ),
}


def messages(
    wolf: Wolf, raw_input: str, wolf_notes: dict[str, str], intent: str, context: str
) -> list[dict]:
    """The role's prompt file is the system message; the task + intent instruction + any upstream
    context is the user message."""
    system = load_prompt(wolf.role).body
    user = f"Task: {raw_input or 'Research the topic and produce a briefing.'}\n\n"
    user += INTENT_INSTRUCTIONS.get(intent, intent)
    note = wolf_notes.get(wolf.wolf_id)
    if note:
        user += f"\n\nHandler's note for you (honor this): {note}"
    if context:
        user += f"\n\nContext:\n{context}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def hits_context(query: str, hits: list[dict]) -> str:
    if not hits:
        return f"Your angle: {query}\n(No results returned.)"
    lines = []
    for h in hits:
        line = f"- {h.get('title', '')} — {h.get('url', '')}: {h.get('snippet', '')}"
        if h.get("text"):  # the deep-read full page (web_fetch), when available
            line += f"\n    [full text] {h['text'][:2500]}"
        lines.append(line)
    return f"Your angle: {query}\nSearch results:\n" + "\n".join(lines)


def extra_inputs_block(extra_inputs: list[str]) -> str:
    if not extra_inputs:
        return ""
    joined = "\n".join(f"- {t[:800]}" for t in extra_inputs)
    return f"\n\nThe Packmaster also provided this input — weigh it:\n{joined}"


def findings_context(findings: list[Finding], memory_note: str, extra_inputs: list[str]) -> str:
    blocks = []
    for f in findings:
        srcs = "; ".join(f"{s.get('title', '')} ({s.get('url', '')})" for s in f.sources[:4])
        blocks.append(f"[{f.wolf_id}] {f.summary}\nSources: {srcs or 'none'}")
    parts = ["\n\n".join(blocks) or "No findings."]
    if memory_note:  # v4.1: the Elder's recall informs the merge too, not just the plan
        parts.append(memory_note)
    extra = extra_inputs_block(extra_inputs).strip()
    if extra:
        parts.append(extra)
    return fit_context(parts, settings.qwen_context_budget_tokens)


def merged_context(merged: Merged) -> str:
    claims = "\n".join(f"- {c}" for c in merged.claims)
    return f"Summary: {merged.summary}\nClaims:\n{claims}"


def draft_context(
    merged: Merged, decision: str | None, kb_picks: list[dict], extra_inputs: list[str]
) -> str:
    parts = [merged_context(merged)]
    if decision:
        parts.append(f"Resolved decision: {decision}")
    sources = dedupe_sources(merged.sources)
    if sources:
        numbered = "\n".join(
            f"[{i + 1}] {s.get('title', '') or s.get('url', '')} — {s.get('url', '')}"
            for i, s in enumerate(sources)
        )
        parts.append(f"Sources (cite each block by number):\n{numbered}")
    if kb_picks:  # v4.2: give Howler the library text so it can actually cite it
        lib = "\n".join(f"- {p['title']}: {p['text'][:600]}" for p in kb_picks)
        parts.append(f"From your library:\n{lib}")
    block = extra_inputs_block(extra_inputs)
    if block:
        parts.append(block.strip())
    # Priority order (highest first) matches `parts` above: summary/claims and the resolved decision
    # are never dropped; the library and extra-inputs blocks are the first to go if the combined
    # context outgrows the budget (app/qwen/context_budget.py).
    return fit_context(parts, settings.qwen_context_budget_tokens)


def conflict_from(obj: object) -> Conflict | None:
    if not isinstance(obj, dict):
        return None
    question = str(obj.get("question") or "").strip()
    options = [str(o).strip() for o in (obj.get("options") or []) if str(o).strip()]
    if not question or len(options) < 2:
        return None
    return Conflict(
        question=question,
        options=options,
        recommended=str(obj.get("recommended") or options[0]),
        context_ref=None,
    )


def dedupe_sources(sources: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for s in sources:
        url = s.get("url", "")
        if url and url not in seen:
            seen.add(url)
            out.append(s)
    return out
