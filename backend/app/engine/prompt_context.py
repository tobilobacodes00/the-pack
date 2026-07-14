"""Prompt + context assembly for a wolf's dispatch — pure, model-free string building.

Extracted from the Supervisor so the hunt loop isn't carrying prompt plumbing. Every function here is
pure: it takes the few hunt fields it needs (the task, handler notes, findings, sources, library
picks, extra inputs) and returns the message list or context string to hand the model. The Supervisor
keeps thin wrappers that pass its state in, so the Engine-primitive call sites are unchanged.
"""

from __future__ import annotations

import math

from app.config import settings
from app.engine.strategies import Conflict, Finding, Merged
from app.engine.wolves import Wolf
from app.prompts import load_prompt
from app.qwen.context_budget import fit_context
from app.tools.providers.base import canonical_url

# v3: adaptive depth — the merge/draft targets and material-slice scaling all key off one enum
# (brief|standard|deep) so the brief is comprehensive when the task needs it and tight when it
# doesn't. The ranges are runaway CEILINGS the model fills to the sources' real extent, not targets:
# brief is genuinely tighter than the old fixed 6-12/5-9; deep is ~2.5-3x.
_MERGE_CLAIMS: dict[str, tuple[int, int]] = {"brief": (4, 6), "standard": (8, 14), "deep": (16, 28)}
_DRAFT_BLOCKS: dict[str, tuple[int, int]] = {"brief": (3, 5), "standard": (7, 12), "deep": (14, 24)}
_DEPTH_MULT: dict[str, float] = {"brief": 0.7, "standard": 1.0, "deep": 1.6}


def depth_mult(depth: str) -> float:
    """Slice multiplier for a depth — how much source material to carry (deeper → more)."""
    return _DEPTH_MULT.get(depth, 1.0)


def merge_instruction(depth: str) -> str:
    """The Tracker's merge instruction, scaled to depth. The claim count is a CEILING anchored to how
    much the findings actually support, never a target to pad toward or shrink to hit."""
    _, hi = _MERGE_CLAIMS.get(depth, _MERGE_CLAIMS["standard"])
    return (
        "Cross-reference the scouts' findings into a rich, comprehensive set of claims. Extract every "
        f"DISTINCT, specific sourced point the findings genuinely support — up to ~{hi} claims, each a "
        "concrete finding with the figures / names / dates the sources give, not a vague generality. "
        "Fewer is correct when the sources are thin — never pad to a number, and never merge two "
        "separate facts into one claim to hit a lower count. State as fact only what a [READ] source "
        "supports; treat an [UNREAD] or (unverified) source as a lead, not a fact. Attach to each claim "
        "the NUMBER(s) of the source(s) that back it as `source_ids` (from the numbered Sources list) — "
        "a claim with no backing source is not a claim, drop it. Respond with ONLY JSON: a `summary`; a "
        "`claims` array of {text, source_ids}; and `conflict` — a genuine disagreement as {question, "
        "options, recommended}, or null when the sources agree. Only raise a conflict that is really "
        "there, and give it at least 2 options (the distinct positions, not one)."
    )


def draft_instruction(depth: str) -> str:
    """The Howler's draft instruction, scaled to depth. Removes the old 'typically 5-9 blocks' /
    'Don't pad' cap that made every brief shallow."""
    lo, hi = _DRAFT_BLOCKS.get(depth, _DRAFT_BLOCKS["standard"])
    tail = " Expand every theme the sources support fully." if depth == "deep" else ""
    return (
        "Write a COMPREHENSIVE, thorough final briefing as ONLY JSON: a `title` and a `blocks` array. "
        "Cover EVERY distinct sourced point — one substantive paragraph per major claim or theme, "
        f"roughly {lo}-{hi} blocks, scaled to how much the sources actually cover, each with the "
        f"concrete specifics (figures, names, dates) the sources support.{tail} Each block is "
        "{text, source_ids}: `text` is one paragraph of clear prose, `source_ids` are the NUMBERS of "
        "the sources (from the numbered Sources list) that back it. Each claim below already names "
        "its own backing source(s) as `[sources: N, M]` — when a block folds in that claim, reuse "
        "those same numbers rather than re-deriving from scratch; only assign a fresh number when "
        "writing content not tied to any single listed claim. Cite real sources only; if a paragraph "
        "isn't backed by a listed source, leave its source_ids empty — never pad with unsourced "
        "filler, never leave real sourced detail out, and never drop a claim from the brief just "
        "because folding it in is awkward. Build on the merged claims and honor the resolved decision "
        "if one is given."
    )


# What each dispatch asks its wolf to do. The role's prompt file is the system message; this is
# the task-specific instruction appended to the user message. NOTE: the "merge"/"draft" entries here
# are neutral fallbacks — the live call sites pass a depth-scaled `merge_instruction`/`draft_instruction`
# as an instruction_override (see supervisor.merge()/draft()).
INTENT_INSTRUCTIONS: dict[str, str] = {
    "plan": (
        "Break this into a research plan and size the pack to the task. Respond with ONLY JSON: a "
        "one-line `summary`; a `team` array of {role, count}; a `queries` array (ONE search query per "
        "scout, matching the scout count); an `assumptions` array; and a `depth`.\n"
        "ANGLES — the queries are the heart of the plan. Each scout must own a DIFFERENT facet of the "
        "task — no two queries on the same angle. Treat the angles as a spanning set: current "
        "data/figures, key players, how-it-works/mechanism, risks/limitations, comparisons/"
        "alternatives, outlook/what-changes-next. Pick the handful that actually fit THIS task; a "
        "well-angled plan covers the task from several sides instead of asking one question three ways.\n"
        "QUERY WORDING — plain keywords, and KEEP the concrete entity/metric terms the task names: "
        "model names, version numbers, figures, dates, product names. The ONLY thing to strip is "
        "search OPERATORS (site:, OR/AND, quotes, 'past week') — never the specific nouns. The engine "
        "handles recency; you handle specificity.\n"
        "PACK SIZE — one scout per distinct sub-question or entity you must answer. 1-2 scouts for a "
        "single narrow fact; 3 for a normal briefing; 4-5 for a multi-part comparison, a survey of "
        "several options, or a multi-facet landscape. A `deep` brief carries at least 3 scouts.\n"
        'DEPTH (required) — "brief": a single fact-check or narrow yes/no with one findable answer '
        '(e.g. "Is Postgres 16 released yet?"). "standard": a normal briefing on one topic (e.g. '
        '"State of the EU AI Act in 2026"). "deep": the task names multiple sub-topics, is a decision '
        'with money or risk on it, or asks for a comparison/survey (e.g. "Compare the top 5 EV '
        "charging networks on price, coverage, reliability\"). Judge by the task's real scope.\n"
        "ASSUMPTIONS — one chip for each ambiguity you resolved from vague input, phrased as a choice "
        "the user can correct. Good: 'assuming a small team (<20 seats)', 'assuming B2B use'. Bad: "
        "'recent sources', 'briefing format' (not correctable, not an inference). If the task is fully "
        "specified, return an empty array — do not invent chips."
    ),
    "search": (
        "Using ONLY the search results and full-text provided, write a SUBSTANTIVE summary of the "
        "findings for your angle — capture the specific facts, figures, named entities, and dates the "
        "pages actually contain, not a one-line gist. Respond with ONLY JSON: `summary` (string, "
        "several sentences) and `confidence` (0-1). Never invent a source or a fact not on the pages."
    ),
    "merge": (
        "Cross-reference the scouts' findings into a rich, comprehensive set of claims — capture every "
        "distinct sourced point with the figures / names / dates the sources give, never a vague "
        "generality and never unsourced padding. Respond with ONLY JSON: a `summary`; a `claims` array; "
        "and `conflict` — a genuine disagreement as {question, options, recommended}, or null when the "
        "sources agree. Only raise a conflict that is really there."
    ),
    "critique": (
        "Verify each claim against the numbered Sources list in your context. For every claim, read "
        "its `[sources: N]` and check: (1) it actually cites a source — a claim with an EMPTY citation "
        "is unsupported; (2) each cited number exists in the Sources list; (3) prefer [READ]/verified "
        "sources — a claim resting only on an `(unverified)` snippet is weak; (4) the cited source "
        "plausibly SUPPORTS the specific claim — flag over-claiming (source says 'may reach $500M by "
        "2027', claim says 'will hit $500M'), stale data, or a claim that contradicts another. Respond "
        "with ONLY JSON: `ok` (boolean — true only if NO claim has an issue) and `issues` (array of "
        "{claim, problem}), where `claim` is the offending claim's TEXT and `problem` names the defect. "
        "Be strict but fair — flag real problems, not stylistic nits."
    ),
    "gaps": (
        "Name what is still missing to answer the task well. Respond with ONLY JSON: `gaps` "
        "(array of focused follow-up search queries). Empty array if nothing is missing."
    ),
    "draft": (
        "Write a COMPREHENSIVE, thorough final briefing as ONLY JSON: a `title` and a `blocks` array. "
        "Cover every distinct sourced point — one substantive paragraph per major claim or theme, each "
        "with the concrete specifics (figures, names, dates) the sources support. Each block is "
        "{text, source_ids}: `text` is one paragraph of clear prose, `source_ids` are the NUMBERS of "
        "the sources (from the numbered Sources list) that back it. Cite real sources only; if a "
        "paragraph isn't supported by a listed source, leave its source_ids empty — never pad with "
        "unsourced filler, and never leave real sourced detail out. Build on the merged claims and "
        "honor the resolved decision if one is given."
    ),
    "distill": (
        "The hunt is done. Distill the SINGLE most useful lesson to carry into the next similar hunt "
        "— not a recap of what happened, but something reusable. Respond with ONLY JSON: `kind` (one "
        'of "preference", "what-worked", "what-failed", "topic-insight") and `lesson` (one '
        "specific, reusable sentence). Never a bland recap like 'researched the topic and found "
        "sources' — write the thing that would actually make the next hunt better."
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
        "You are Alpha settling a standoff. Weigh the challenge and the defense against the numbered "
        'sources on the table. Respond with ONLY JSON: `verdict` (exactly one of "keep", "drop", '
        '"qualify") and `rationale` (one sentence citing the source number(s)). KEEP only if a listed '
        "source genuinely backs the claim; DROP if none does; QUALIFY if it's only partly supported. "
        "Rule on the evidence, not on volume."
    ),
    "conflict_decide": (
        "You are Alpha resolving a genuine conflict for the Packmaster in Wild mode. Weigh the offered "
        "options against the numbered sources on the table. Respond with ONLY JSON: `choice` (exactly "
        "one of the offered options, copied verbatim) and `rationale` (one sentence citing the source "
        "number(s) that decide it). Pick the option the evidence best supports — never invent a new one."
    ),
}


def messages(
    wolf: Wolf,
    raw_input: str,
    wolf_notes: dict[str, str],
    intent: str,
    context: str,
    instruction_override: str | None = None,
) -> list[dict]:
    """The role's prompt file is the system message; the task + intent instruction + any upstream
    context is the user message. `instruction_override`, when given, replaces the static
    INTENT_INSTRUCTIONS text for this dispatch (used to pass depth-scaled merge/draft wording while
    keeping intent='merge'/'draft' for FakeQwen dispatch + pricing)."""
    system = load_prompt(wolf.role).body
    user = f"Task: {raw_input or 'Research the topic and produce a briefing.'}\n\n"
    user += (
        instruction_override
        if instruction_override is not None
        else INTENT_INSTRUCTIONS.get(intent, intent)
    )
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
        # Label read vs unread so the model can't treat a one-line SEO snippet as a verified fact.
        read = bool(h.get("text"))
        tag = "[READ]" if read else "[UNREAD — snippet only, treat as a lead, do NOT state as fact]"
        line = f"- {tag} {h.get('title', '')} — {h.get('url', '')}: {h.get('snippet', '')}"
        if read:  # the deep-read full page (web_fetch)
            line += f"\n    [full text] {h['text'][: settings.hits_fulltext_chars]}"
        lines.append(line)
    header = (
        f"Your angle: {query}\nSearch results (only [READ] pages are verified — cite facts from those;"
        " [UNREAD] results are leads, not evidence):\n"
    )
    return header + "\n".join(lines)


def extra_inputs_block(extra_inputs: list[str]) -> str:
    if not extra_inputs:
        return ""
    joined = "\n".join(f"- {t[: settings.extra_input_chars]}" for t in extra_inputs)
    return f"\n\nThe Packmaster also provided this input — weigh it:\n{joined}"


def findings_context(
    findings: list[Finding],
    memory_note: str,
    extra_inputs: list[str],
    depth: str = "standard",
    sources_registry: str = "",
) -> str:
    # Deeper hunts carry more named sources per finding into the merge. int() cast is mandatory —
    # depth_mult returns a float and a float slice index is a TypeError.
    n_sources = max(1, int(settings.findings_sources_max * depth_mult(depth)))
    blocks = []
    for f in findings:
        srcs = "; ".join(
            f"{s.get('title', '')} ({s.get('url', '')})" for s in f.sources[:n_sources]
        )
        blocks.append(f"[{f.wolf_id}] {f.summary}\nSources: {srcs or 'none'}")
    parts = ["\n\n".join(blocks) or "No findings."]
    if sources_registry:
        # The SAME numbered list draft_context will cite from — Tracker attaches claim.source_ids
        # against these numbers so the citation survives unchanged into the draft.
        parts.append(f"Sources (cite each claim by number):\n{sources_registry}")
    if memory_note:  # v4.1: the Elder's recall informs the merge too, not just the plan
        parts.append(memory_note)
    extra = extra_inputs_block(extra_inputs).strip()
    if extra:
        parts.append(extra)
    return fit_context(parts, settings.qwen_context_budget_tokens)


def merged_context(merged: Merged, *, sources: list[dict] | None = None) -> str:
    """Sentinel's (and Howler's) view of the merge. `sources`, when given, appends the numbered
    registry and renders each claim's `[sources: N, M]` — without it Sentinel is asked to verify
    claims carry a real source while never being shown any source (the bug this fixes)."""
    src_ids = merged.claims_src or [[]] * len(merged.claims)
    lines = "\n".join(
        f"- {c}" + (f" [sources: {', '.join(map(str, ids))}]" if ids else "")
        for c, ids in zip(merged.claims, src_ids, strict=False)
    )
    out = f"Summary: {merged.summary}\nClaims:\n{lines}"
    if sources:
        _, block = numbered_sources(sources)
        if block:
            out += f"\n\nSources (each claim cites these by number):\n{block}"
    return out


def draft_context(
    merged: Merged,
    decision: str | None,
    kb_picks: list[dict],
    extra_inputs: list[str],
    depth: str = "standard",
) -> str:
    # merged_context WITHOUT sources here — the numbered block below is labeled "cite each BLOCK",
    # not "claim"; passing merged.sources would double-render the identical registry under two labels.
    parts = [merged_context(merged)]
    if decision:
        parts.append(f"Resolved decision: {decision}")
    sources, numbered = numbered_sources(merged.sources)
    if sources:
        # Same numbering merge saw (numbered_sources is deterministic) — Howler's block citations
        # land on the identical [N] Tracker already attached to each claim.
        parts.append(f"Sources (cite each block by number):\n{numbered}")
    if kb_picks:  # v4.2: give Howler the library text so it can actually cite it
        kb_chars = max(1, int(settings.kb_pick_chars * depth_mult(depth)))
        lib = "\n".join(f"- {p['title']}: {p['text'][:kb_chars]}" for p in kb_picks)
        parts.append(f"From your library:\n{lib}")
    block = extra_inputs_block(extra_inputs)
    if block:
        parts.append(block.strip())
    # Priority order (highest first) matches `parts` above: summary/claims and the resolved decision
    # are never dropped; the library and extra-inputs blocks are the first to go if the combined
    # context outgrows the budget (app/qwen/context_budget.py).
    return fit_context(parts, settings.qwen_context_budget_tokens)


def distill_context(
    strategy: str,
    scout_n: int,
    source_count: int,
    brief_title: str,
    claims: list[str],
    no_sources: bool,
) -> str:
    """What the Elder sees to distill one lesson: how the hunt was run and what it produced. Kept
    compact — the Elder writes a single reusable sentence, not another brief. Claims are capped so a
    deep hunt's long merge doesn't blow the flash-tier context."""
    outcome = (
        "found no sources — the topic was too sparse or the wording too narrow"
        if no_sources or source_count == 0
        else f"produced a brief from {source_count} source(s)"
    )
    parts = [
        f"How this hunt ran: {strategy} strategy, {scout_n} scout(s); it {outcome}.",
    ]
    if brief_title:
        parts.append(f"Brief title: {brief_title}")
    if claims:
        joined = "\n".join(f"- {c}" for c in claims[:6])
        parts.append(f"Key claims the pack landed:\n{joined}")
    return "\n".join(parts)


def conflict_from(obj: object) -> Conflict | None:
    if not isinstance(obj, dict):
        return None
    question = str(obj.get("question") or "").strip()
    if not question:
        return None
    options = [str(o).strip() for o in (obj.get("options") or []) if str(o).strip()]
    rec = str(obj.get("recommended") or "").strip()
    # A genuine conflict sometimes comes back as one option + a distinct `recommended` — the two
    # positions were split across the fields instead of both landing in `options`. Salvage it as a
    # real 2-way conflict rather than silently dropping it for having "< 2 options".
    if len(options) == 1 and rec and rec != options[0]:
        options = [options[0], rec]
    if len(options) < 2:
        return None
    # `recommended` must be one of the offered options — an off-menu paraphrase would render an
    # unselectable choice on the Hold and could auto-decide on a wild-mode hunt with no real option
    # behind it.
    recommended = rec if rec in options else options[0]
    return Conflict(
        question=question,
        options=options,
        recommended=recommended,
        context_ref=None,
    )


def dedupe_sources(sources: list[dict]) -> list[dict]:
    """Dedup by canonical URL (http/https, trailing slash, tracking params, m./amp collapse to one),
    keeping the ORIGINAL dict for display, then order verified (read) sources first — one canonical
    order all consumers share (the span map, block numbering, and draft citations must agree). A
    source with no url is dropped (url is the citation identity)."""
    # Never cite the offline CannedProvider's fabricated example.com sources in a LIVE brief. Offline
    # (no key) this is a no-op — the canned hunt has nothing else and must keep them.
    drop_canned = bool(settings.qwen_api_key)
    seen: set[str] = set()
    out: list[dict] = []
    for s in sources:
        url = s.get("url", "")
        if not url or (drop_canned and s.get("canned")):
            continue
        key = canonical_url(url)
        if key not in seen:
            seen.add(key)
            out.append(s)
    # verified first (stable) so the numbered list + span map front-load read sources.
    return sorted(out, key=lambda s: not s.get("verified"))


def numbered_sources(sources: list[dict]) -> tuple[list[dict], str]:
    """Dedupe once (verified-first) and return the deduped list + its rendered `[N] title — url`
    block. THE single source-numbering function — the merge registry Tracker cites into and the
    draft citation list Howler cites from must be the same numbering or claims mis-attribute; both
    call this (on the same underlying `sources`), and `dedupe_sources` is deterministic, so they agree."""
    deduped = dedupe_sources(sources)
    block = "\n".join(
        f"[{i + 1}] {'' if s.get('verified') else '(unverified) '}"
        f"{s.get('title', '') or s.get('url', '')} — {s.get('url', '')}"
        for i, s in enumerate(deduped)
    )
    return deduped, block


def coerce_source_ids(raw: object, n_sources: int) -> list[int]:
    """Coerce a model's source_ids list to valid, in-range ints. `json.loads(..., strict=False)`
    (our lenient parser) accepts the non-standard NaN/Infinity/-Infinity literals, and `isinstance(nan,
    float)` is True — so a naive `int(i) for i in ids if isinstance(i, int | float)` comprehension lets
    a NaN through and then crashes on `int(float('nan'))`. Silently drop anything that isn't a finite,
    in-range number (NaN/Infinity/out-of-range/non-numeric/bool) — a bad id degrades to 'uncited'
    rather than crashing the hunt at its very last step."""
    out: set[int] = set()
    for i in raw if isinstance(raw, list) else []:
        if not isinstance(i, int | float) or isinstance(i, bool):
            continue
        if not math.isfinite(i):
            continue
        n = int(i)
        if 1 <= n <= n_sources:
            out.add(n)
    return sorted(out)
