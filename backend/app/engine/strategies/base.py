"""Strategy contract — the shape every research strategy plugs into (Doc 04 §04).

A strategy owns the EXECUTION phase of a hunt: after the user approves Beta's plan and the
pack is spawned, the Supervisor hands control to the chosen strategy's `execute(engine)`. The
strategy orchestrates a sequence of real research primitives — scout, merge, hold, critique,
standoff, draft — exposed by the `Engine` it's handed. The Supervisor IS the engine; this
Protocol keeps the strategies import-clean (no dependency back on the Supervisor module).

The differences between strategies live ONLY in how they sequence those primitives:
  * orchestrate — dynamic: scout → merge → (hold on conflict) → draft, rerouting on a Stray.
  * deep_dive   — iterative: scout → merge → find gaps → scout again → merge → draft.
  * critique    — rigorous: scout → merge → Sentinel critique → (standoff) → draft.

Each primitive is REAL (a live Qwen call + real web search) or its deterministic offline
twin (FakeQwen + the canned search provider) — the strategy can't tell and doesn't care.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

# --- data passed between primitives -------------------------------------------------------


@dataclass
class Finding:
    """One scout's contribution: a summary plus the REAL sources it rests on (never invented —
    sources come from the web_search tool result, not the model)."""

    wolf_id: str
    summary: str
    sources: list[dict] = field(default_factory=list)
    confidence: float = 0.75
    output_ref: str | None = None

    @property
    def verified_sources(self) -> list[dict]:
        """Sources whose page we actually READ (web_fetch text), not snippet-only hits."""
        return [s for s in self.sources if s.get("verified")]

    def is_usable(self, floor: float = 0.35) -> bool:
        """Usable = rests on ground: a verified (read) source, OR a non-empty summary at/above the
        floor. An empty/failed/hallucinated finding (confidence 0.0, sources [], empty summary)
        fails this and is dropped from the merge."""
        if self.verified_sources:
            return True
        return bool(self.summary.strip()) and self.confidence >= floor


def drop_empty(results: Sequence[Finding | None], floor: float = 0.35) -> list[Finding]:
    """Strategy-internal keep: drop None + unusable findings. NO best-fallback — the retry gate must
    see the full thin set (every thin scout's wolf_id survives to be re-ranged)."""
    return [f for f in results if f is not None and f.is_usable(floor)]


def keep_findings(results: Sequence[Finding | None], floor: float = 0.35) -> list[Finding]:
    """Merge-boundary keep: like drop_empty, but NEVER returns empty when any finding came back —
    keeps the single highest-confidence one so a thin-but-real hunt still drafts instead of
    false-tripping the no_sources notice. Returns strongest ground first (so a clipped context
    budget keeps the best)."""
    present = [f for f in results if f is not None]
    usable = drop_empty(present, floor)
    if usable:
        return sorted(usable, key=lambda f: f.confidence, reverse=True)
    return [max(present, key=lambda f: f.confidence)] if present else []


@dataclass
class Conflict:
    """A genuine disagreement Tracker surfaced in the findings — becomes a Hold for the human."""

    question: str
    options: list[str]
    recommended: str
    context_ref: str | None = None


@dataclass
class Merged:
    """Tracker's synthesis: a cross-referenced summary, the extracted claims, and any conflict."""

    summary: str
    claims: list[str] = field(default_factory=list)
    # Parallel to `claims` (same index) — the numbered source(s) backing each claim, from the same
    # registry `numbered_sources(sources)` mints. A claim with no backing source is `[]`. Kept
    # parallel rather than folding {text, source_ids} into `claims` itself so every existing string
    # consumer (refine.py, benchmark.py, stored artifacts) keeps working unchanged.
    claims_src: list[list[int]] = field(default_factory=list)
    conflict: Conflict | None = None
    output_ref: str | None = None
    sources: list[dict] = field(default_factory=list)
    # Set only when the merge stalled/faulted: each scout finding's real summary text + that
    # finding's sources' registry numbers, so the honest fallback brief can quote what was actually
    # read instead of raw search snippets.
    stalled_findings: list[tuple[str, list[int]]] = field(default_factory=list)


@dataclass
class CritiqueResult:
    """Sentinel's verdict on the merged claims."""

    ok: bool
    issues: list[dict] = field(default_factory=list)  # [{claim, problem}]


# --- structured-output schemas the wolves are asked to fill (json_schema response format) ---

PLAN_SCHEMA: dict = {
    "type": "object",
    # est_cost/est_time are NOT asked of Beta — it can't ground token pricing or search latency, and
    # its guess used to override the correct per-depth default. The engine derives them in
    # _normalize_plan and keeps them on the emitted payload. Beta spends its budget on angles + depth.
    "required": ["summary", "queries", "assumptions", "depth"],
    "properties": {
        "summary": {"type": "string"},
        # one search angle per scout — this is what makes the hunt topic-aware.
        "queries": {"type": "array", "items": {"type": "string"}},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        # v3: how deep the brief should go — Beta sizes depth to the task like it sizes the scouts.
        # Required so a real model commits to a judgment; _clamp_depth still defaults a missing/
        # invalid value to "standard". Scales the merge/draft targets and can upgrade the strategy.
        "depth": {"type": "string", "enum": ["brief", "standard", "deep"]},
        # v2: the team Alpha should build — Beta sizes the pack to the task (mainly the scout count).
        "team": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"role": {"type": "string"}, "count": {"type": "integer"}},
            },
        },
    },
}

FINDINGS_SCHEMA: dict = {
    "type": "object",
    "required": ["summary", "confidence"],
    "properties": {
        "summary": {"type": "string"},
        "confidence": {"type": "number"},
    },
}

MERGE_SCHEMA: dict = {
    "type": "object",
    "required": ["summary", "claims"],
    "properties": {
        "summary": {"type": "string"},
        # Each claim names the NUMBER(s) of the source(s) (from the numbered Sources list) that back
        # it, so the citation survives into the draft instead of being re-guessed by Howler. A plain
        # string claim (legacy / a model that ignores the shape) is still accepted — merge() coerces
        # either shape; this schema is documentary (the client never validates against it at runtime).
        "claims": {
            "type": "array",
            "items": {
                "type": ["object", "string"],
                "properties": {
                    "text": {"type": "string"},
                    "source_ids": {"type": "array", "items": {"type": "integer"}},
                },
            },
        },
        "conflict": {
            "type": ["object", "null"],
            "properties": {
                "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}},
                "recommended": {"type": "string"},
            },
        },
    },
}

CRITIQUE_SCHEMA: dict = {
    "type": "object",
    "required": ["ok", "issues"],
    "properties": {
        "ok": {"type": "boolean"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"claim": {"type": "string"}, "problem": {"type": "string"}},
            },
        },
    },
}

GAPS_SCHEMA: dict = {
    "type": "object",
    "required": ["gaps"],
    "properties": {"gaps": {"type": "array", "items": {"type": "string"}}},
}

# v2: Howler writes the brief as TAGGED BLOCKS so every line carries its sources (the gate for
# click-any-line → source). `source_ids` index the numbered source list given in the draft context.
DRAFT_SCHEMA: dict = {
    "type": "object",
    "required": ["title", "blocks"],
    "properties": {
        "title": {"type": "string"},
        "blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["text"],
                "properties": {
                    "text": {"type": "string"},
                    "source_ids": {"type": "array", "items": {"type": "integer"}},
                },
            },
        },
    },
}

# v2 (deepened): the Elder's end-of-hunt distillation — ONE typed, durable lesson for next time.
# `kind` types the lesson so recall can surface it as guidance (a preference vs. a topic insight),
# not a flat log line; `lesson` is one specific, reusable sentence.
DISTILL_SCHEMA: dict = {
    "type": "object",
    "required": ["kind", "lesson"],
    "properties": {
        "kind": {
            "type": "string",
            "enum": ["preference", "what-worked", "what-failed", "topic-insight"],
        },
        "lesson": {"type": "string"},
    },
}


# --- the engine surface a strategy drives -------------------------------------------------


@runtime_checkable
class Engine(Protocol):
    """The research primitives a strategy orchestrates. Implemented by the Supervisor."""

    @property
    def task(self) -> str: ...

    @property
    def plan(self) -> dict: ...

    def scout_ids(self) -> list[str]: ...

    def queries(self) -> list[str]: ...

    async def scout(self, wolf_id: str, query: str, step_id: str = "s1") -> Finding: ...

    async def merge(self, findings: list[Finding], step_id: str = "s2") -> Merged: ...

    async def resolve_conflict(self, conflict: Conflict) -> str: ...

    async def find_gaps(self, merged: Merged) -> list[str]: ...

    async def critique(self, merged: Merged) -> CritiqueResult: ...

    async def apply_critique(self, merged: Merged, verdict: CritiqueResult) -> Merged: ...

    def standoff_evidence(self, merged: Merged, issue: dict) -> str: ...

    async def standoff(
        self,
        challenger: str,
        defendant: str,
        claim_ref: str,
        rationale: str,
        *,
        evidence: str = "",
    ) -> None: ...

    async def draft(
        self, merged: Merged, decision: str | None = None, step_id: str = "s3"
    ) -> str: ...

    async def finish(self, draft_text: str, merged: Merged) -> None: ...

    async def progress(self, wolf_id: str, phase: str, text: str) -> None: ...

    async def clone(self, wolf_id: str) -> str: ...

    async def spawn(self, role: str) -> str: ...


# --- the strategy base --------------------------------------------------------------------


class Strategy:
    """Base class. `name` keys the registry; `pattern` is the plan_proposed coordination shape."""

    name: str = "base"
    pattern: str = "parallel_then_merge"
    label: str = "Base"

    async def execute(self, engine: Engine) -> None:  # pragma: no cover - overridden
        raise NotImplementedError
