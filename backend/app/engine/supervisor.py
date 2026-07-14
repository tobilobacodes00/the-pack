"""The Supervisor — Alpha's loop, one async task per hunt (Doc 04 §04).

This drives a REAL hunt end to end and narrates every step as a typed event through the one
Emitter. Beta plans from the actual task (structured output), the user approves, the pack
spawns, and the chosen **strategy** drives the research: Scouts run real web searches on
task-derived angles, Tracker merges the findings, a Hold surfaces only on a genuine conflict,
Sentinel can challenge a weak claim in a Standoff, and Howler drafts the cited brief.

The Supervisor IS the `Engine` (app/engine/strategies): it owns the shared primitives
(spawn, scout, merge, hold, critique, standoff, draft, the boundary-gated `_dispatch`) and
hands control to the strategy's `execute(self)`. Strategies differ only in how they sequence
those primitives — orchestrate (dynamic), deep_dive (iterative), critique (rigorous).

Two human gates arrive as commands on the per-hunt queue (REST returns 202; the truth lands
here on the stream): `approve_plan` after the plan, `resolve_hold` on a Hold. `stop` ends the
hunt at any await.

THE BOUNDARY IS A GATE, NOT A GRAPH: every model dispatch goes through `_dispatch`, which
checks PROJECTED spend BEFORE the call — warn at 70%, downgrade tier at 85%, halt + checkpoint
at 100% (no call). That pre-dispatch enforcement is the whole point.

The model brain is swappable: offline it's FakeQwen (deterministic, topic-aware structured
output), live it's Qwen. Nothing in this file changes when the key lands.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import time
from collections.abc import Set as AbstractSet
from dataclasses import replace

from app.config import settings
from app.db.repo import Repo
from app.engine import prompt_context
from app.engine.boundary import Boundary
from app.engine.core import Emitter
from app.engine.dispatch_gate import decide_and_reserve
from app.engine.forge import MIME, forge
from app.engine.healing import Healer
from app.engine.ids import new_artifact_id, new_checkpoint_id, new_hold_id, new_standoff_id
from app.engine.roster import (
    DEFAULT_SCOUTS,
    ROLE_SPEC,
    build_team,
    roster_from_team,
    scout_spec,
    wolf_ids,
)
from app.engine.search_query import FACETS, broaden, facet_query, plain_query
from app.engine.strategies import Conflict, CritiqueResult, Finding, Merged, get_strategy
from app.engine.strategies.base import (
    CONFLICT_DECIDE_SCHEMA,
    CRITIQUE_SCHEMA,
    DISTILL_SCHEMA,
    DRAFT_SCHEMA,
    FINDINGS_SCHEMA,
    GAPS_SCHEMA,
    MERGE_SCHEMA,
    PLAN_SCHEMA,
    STANDOFF_JUDGE_SCHEMA,
    StandoffOutcome,
)
from app.engine.stray import StrayDetector
from app.engine.wolves import Wolf
from app.prompts import load_prompt
from app.qwen.client import CircuitOpenError, OnDelta, QwenClient
from app.qwen.types import CompletionResult
from app.storage import store_forged_content
from app.tools.knowledge import select_relevant
from app.tools.memory import normalize_kind, recall, remember
from app.tools.providers.base import canonical_url
from app.tools.web import WEB_FETCH, WEB_SEARCH

# When research comes back empty the pack must NOT fabricate a brief — it says so plainly. Two honest
# cases: the providers errored / were rate-limited, or they genuinely found nothing.
_NO_SOURCES_NOTE = (
    "The pack couldn't find sources for this one. The topic may be too sparse or the wording too "
    "narrow — try rephrasing it, or drop in your own material, and send the pack again."
)
_SEARCH_UNAVAILABLE_NOTE = (
    "Search came back empty — the providers may be rate-limited or down right now. Give it a few "
    "minutes and try again, or add your own material for the pack to work from."
)

# Matching a Sentinel-flagged claim back to a merge claim so the flag has teeth. Sentinel paraphrases
# (a max-tier critic rarely echoes the merge text verbatim), so a substring match drops nothing — it's
# content-token overlap instead. Task-topic words are stripped too: every claim on a hunt about "the
# BNPL market in Nigeria" shares those words, so leaving them in would match (and drop) every claim.
_CRITIQUE_STOPWORDS = frozenset(
    "a an and are as at be but by for from has have in into is it its of on or that the their this to "
    "was were will with not no's these those which who whose what when where why how than then over "
    "under about between within across per each all any some more most less least may might can could "
    "would should about only also just very".split()
)
# Coverage above which a flagged claim's content tokens are considered "the same claim" as a merge
# claim. 0.75 clears the real paraphrase (coverage 1.00 on the flagged claim) without catching claims
# that merely share a couple of task words (which land ~0.5 even after task-word stripping).
_CRITIQUE_MATCH_COVERAGE = 0.75


def _content_tokens(text: str, extra_stop: AbstractSet[str] = frozenset()) -> set[str]:
    """Lowercase word tokens minus stopwords and any extra (task-topic) words — the meaningful
    content of a claim, for overlap matching."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if w not in _CRITIQUE_STOPWORDS and w not in extra_stop and len(w) > 1}


def _claim_matches(issue_claim: str, merge_claim: str, task_stop: AbstractSet[str]) -> bool:
    """True when the flagged claim's content tokens are ≥ _CRITIQUE_MATCH_COVERAGE covered by the
    merge claim's tokens — a paraphrase-tolerant 'these name the same claim' test."""
    issue_tokens = _content_tokens(issue_claim, task_stop)
    if not issue_tokens:
        return False
    merge_tokens = _content_tokens(merge_claim, task_stop)
    covered = len(issue_tokens & merge_tokens) / len(issue_tokens)
    return covered >= _CRITIQUE_MATCH_COVERAGE


class StopHunt(Exception):
    """The user stopped the hunt."""


class BoundaryHalt(Exception):
    """The Boundary halted the hunt before the next spend."""


class Supervisor:
    """Drives one hunt and serves as the `Engine` the chosen strategy orchestrates."""

    def __init__(
        self,
        hunt_id: str,
        emitter: Emitter,
        repo: Repo,
        client: QwenClient,
        commands: asyncio.Queue,
        *,
        source: str = "typed",
        raw_input: str = "",
        strategy: str | None = None,
        seed_team: list[dict] | None = None,
    ) -> None:
        self._hunt_id = hunt_id
        self._emitter = emitter
        self._repo = repo
        self._client = client
        self._commands = commands
        self._source = source
        self._raw_input = raw_input
        self._strategy = get_strategy(strategy)
        # v3: did the caller pin a strategy? If not, a "deep" plan may auto-upgrade orchestrate →
        # deep_dive (an explicit Door choice always wins).
        self._strategy_explicit = strategy is not None
        self._wolves: dict[str, Wolf] = {}
        self._team: list[dict] = []  # v2: the per-task formation Beta proposes / the user edits
        self._wolf_notes: dict[
            str, str
        ] = {}  # v6: per-wolf handler note from the Edit Formations panel
        self._seed_team = seed_team or []  # v5.1: a saved Instinct's formation overrides Beta's
        self._wolf_budget: dict[str, float] = {}  # v2: per-wolf spend cap
        self._wolf_spend: dict[str, float] = {}  # v2: per-wolf cumulative spend
        self._relieved: set[str] = set()  # v2: wolves stood down at their own cap
        # v2: Doctor + Stray healing lives in a collaborator (owns faulted/doctor bookkeeping);
        # it emits + spawns through this Supervisor so seq assignment and the roster stay in one place.
        self._healer = Healer(self._emit, self._spawn_wolf)
        self._memory_note: str = ""  # v2: what the Elder recalled to seed the plan
        self._search_attempts = 0  # v2: web searches run (to tell "no results" from "search down")
        self._search_ok = 0  # v2: web searches that succeeded
        self._no_sources = False  # v2: the hunt found no traceable ground — never fabricate
        self._blocks: list[dict] = []  # v3: Howler's tagged blocks [{text, source_ids}] for trace
        self._kb_picks: list[dict] = []  # v4.2: your-library docs injected as sources this hunt
        self._kb_absorbed = False  # v4.2: absorb the KB once, not per merge() (deep_dive/critique)
        # Alpha's lead node (s0-lead) is opened in _open_pack and closed in finish(); on an abnormal
        # terminal exit (stop/fail) it must ALSO settle so it doesn't hang "active" forever. Two flags
        # so we never emit an orphan close (stop before _open_pack) or close during a resumable halt.
        self._lead_opened = False
        self._lead_closed = False
        self._boundary = Boundary(boundary_usd=0.0)
        self._stray = StrayDetector()
        self._warned = False
        self._dispatch_lock = asyncio.Lock()  # serialises check+reserve; think() runs outside
        self._plan: dict = {}
        self._queries: list[str] = []
        self._sources: list[dict] = []
        self._extra_inputs: list[str] = []  # mid-hunt inputs absorbed without a restart (A7)
        self._mode = "on_signal"  # autonomy: how tightly the Packmaster holds the leash
        self._step_timeout: float = settings.step_timeout_s
        # The two heavy synthesis calls (merge, draft) get their own longer budget — they were the
        # calls silently timing out and collapsing the brief to a raw-findings paste.
        self._synthesis_timeout: float = settings.synthesis_timeout_s
        # Wall-clock anchor for the hunt's measured runtime. Set the moment the pack starts
        # working (plan approved / resume raised), NOT at run() entry — the plan-approval gate is
        # unbounded human think-time and must not count against the hunt's elapsed. `time_s` in the
        # completion totals is `monotonic() - this`, so the final clock matches the live counter the
        # user watched (both start when the hunt goes `running`).
        self._run_started_monotonic: float | None = None

    # --- the run -----------------------------------------------------------------------

    async def run(self) -> None:
        try:
            await self._emit(
                "hunt_created",
                "user",
                {"source": self._source, "raw_input_ref": f"art_{self._hunt_id}_raw"},
            )
            await self._repo.set_hunt_state(self._hunt_id, "planning")

            await self._propose_plan()
            approve = await self._await_command("approve_plan")
            await self._approve(approve)

            await self._spawn_roster()
            await self._open_pack()
            await self._strategy.execute(self)
        except StopHunt:
            with contextlib.suppress(Exception):
                await self._close_lead_if_open()  # settle Alpha's node on a stop
                await self._emit("hunt_stopped", "user", {"by": "user"})
                await self._repo.set_hunt_state(self._hunt_id, "stopped_by_user")
        except BoundaryHalt:
            await self._repo.set_hunt_state(self._hunt_id, "halted_boundary")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a hunt must fail as an event, not a crash
            logging.getLogger("pack").exception("hunt %s failed", self._hunt_id)  # keep the trace
            with contextlib.suppress(Exception):
                await self._close_lead_if_open()  # settle Alpha's node on a failure
                await self._emit(
                    "hunt_failed",
                    "engine",
                    {
                        "reason_plain_english": f"The hunt hit an error: {exc}",
                        "exc": type(exc).__name__,
                    },
                )
                await self._repo.set_hunt_state(self._hunt_id, "failed")

    async def resume_run(self) -> None:
        """Continue a hunt that survived an engine restart in `halted_boundary` (B11). Events are
        the source of truth: rebuild the plan, team, and cumulative spend from the log, stay paused,
        and wait for the Packmaster's `/resume` (a raised Boundary) before re-running the strategy
        from the saved plan. Re-scouting reuses the search cache, so resuming is cheap; prior
        spend carries over so the Boundary is honored across the restart."""
        try:
            await self._rehydrate_from_events()
            await self._repo.set_hunt_state(self._hunt_id, "halted_boundary")  # stay paused
            cmd = await self._await_command("resume")  # blocks until the user raises the Boundary
            raised = float(cmd.get("boundary_usd", self._boundary.boundary_usd))
            spent = self._boundary.cumulative_usd
            self._boundary = Boundary(boundary_usd=raised)
            self._boundary.cumulative_usd = spent
            await self._repo.set_boundary(self._hunt_id, raised)
            # Resuming after a halt: the pack starts working again now, so re-anchor the runtime
            # clock (the pause + the human raising the Boundary is wait time, not hunt work).
            self._run_started_monotonic = time.monotonic()
            await self._repo.set_hunt_state(self._hunt_id, "hunting")
            await self._spawn_roster()
            await self._open_pack()
            await self._strategy.execute(self)
        except StopHunt:
            with contextlib.suppress(Exception):
                await self._close_lead_if_open()
                await self._emit("hunt_stopped", "user", {"by": "user"})
                await self._repo.set_hunt_state(self._hunt_id, "stopped_by_user")
        except BoundaryHalt:
            await self._repo.set_hunt_state(self._hunt_id, "halted_boundary")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - resume must fail as an event, not a crash
            logging.getLogger("pack").exception("resume of hunt %s failed", self._hunt_id)
            with contextlib.suppress(Exception):
                await self._close_lead_if_open()
                await self._emit(
                    "hunt_failed", "engine", {"reason_plain_english": f"Resume failed: {exc}"}
                )
                await self._repo.set_hunt_state(self._hunt_id, "failed")

    async def _rehydrate_from_events(self) -> None:
        """Restore plan, team, queries, autonomy mode, and the Boundary's cumulative spend from the
        hunt's event log so a resumed Supervisor picks up where the prior process left off."""
        events = await self._repo.replay_events(self._hunt_id, 0)
        plan_ev = next((e for e in reversed(events) if e.type == "plan_proposed"), None)
        appr_ev = next((e for e in reversed(events) if e.type == "plan_approved"), None)
        spent_ev = next((e for e in reversed(events) if e.type == "tokens_spent"), None)
        if plan_ev is not None:
            self._plan = dict(plan_ev.payload)
            self._team = build_team(plan_ev.payload)
            self._queries = [str(q).strip() for q in (plan_ev.payload.get("queries") or []) if q]
            # v3: re-resolve the strategy from the restored plan — a hunt that auto-upgraded to
            # deep_dive (or was started with an explicit strategy) would otherwise silently revert to
            # the __init__ default on resume.
            self._strategy = get_strategy(self._plan.get("strategy"))
        # Restore the user's per-wolf notes from the last plan_edited so a resumed hunt keeps them.
        edit_ev = next((e for e in reversed(events) if e.type == "plan_edited"), None)
        if edit_ev is not None:
            notes = (edit_ev.payload.get("diff") or {}).get("notes")
            if isinstance(notes, dict):
                self._wolf_notes = {str(k): str(v) for k, v in notes.items()}
        if appr_ev is not None:
            self._mode = str(appr_ev.payload.get("mode") or "on_signal")
            # v3: the user may have overridden depth at approval; that choice (persisted on
            # plan_approved) wins over Beta's proposed depth on resume.
            approved_depth = appr_ev.payload.get("depth")
            if approved_depth in ("brief", "standard", "deep"):
                self._plan["depth"] = approved_depth
        base = float((appr_ev.payload.get("boundary_usd") if appr_ev else None) or 0.5)
        self._boundary = Boundary(boundary_usd=base)
        if spent_ev is not None:
            self._boundary.cumulative_usd = float(spent_ev.payload.get("cumulative_usd") or 0)

    # --- planning + approval -----------------------------------------------------------

    async def _propose_plan(self) -> None:
        """Beta turns the real task into a plan (structured output). Pre-budget, so this call is NOT
        boundary-gated. The Elder first recalls past lessons and whispers them to Beta.

        Beta plans in THINKING mode — a 60–120s streamed reasoning trace before the plan lands.
        We feed that stream through the same `_progress_sink` every step uses, plus one immediate
        beat, so the forming state narrates live on Beta's node instead of sitting frozen for a
        minute-plus while the pack forms."""
        self._memory_note = await recall(self._repo, self.task)
        beta = self._make_wolf("beta", "beta", "plus", True)
        context = f"Coordination strategy: {self._strategy.label} ({self._strategy.pattern})."
        if self._memory_note:
            context += f"\n\n{self._memory_note}"
        # Light Beta up the instant planning starts — the sink's first coalesced beat only lands
        # after Beta's first full sentence, which on a cold thinking call can be several seconds.
        await self.progress("beta", "thinking", "Reading your task and drawing up the plan…")
        parsed: dict = {}
        try:
            res = await beta.think(
                "plan",
                messages=self._messages(beta, "plan", context=context),
                response_schema=PLAN_SCHEMA,
                on_delta=self._progress_sink("beta", "thinking"),
            )
            parsed = res.parsed or {}
        except Exception as exc:  # noqa: BLE001 — a failed planner falls back, never sinks the hunt
            # The fallback plan (3 facet queries, standard depth) is genuinely usable, but a total
            # Beta failure must not masquerade as a bland-but-fine plan — log it so a systematically
            # broken planner is visible.
            logging.getLogger("pack").warning(
                "beta plan call failed — using facet fallback: %r", exc
            )
        if not parsed:
            logging.getLogger("pack").warning("beta plan empty — using facet fallback")
        # v3: a "deep" task auto-upgrades orchestrate → deep_dive (a second scout round) when the
        # caller didn't pin a strategy. Must happen BEFORE _normalize_plan, which stamps the plan's
        # pattern/strategy off self._strategy (self._plan is still empty here, so the helper mutates
        # only self._strategy — normalize does the stamping).
        self._resolve_strategy_for_depth(parsed.get("depth"))
        self._plan = self._normalize_plan(parsed)
        self._queries = list(self._plan["queries"])
        await self._emit("plan_proposed", "beta", self._plan)
        # Settle Beta's node the instant the plan lands — otherwise its `thinking` phase spins
        # through the whole approval wait (the clearing step lands only in _open_pack, post-approval).
        # Reuse the in-enum `thinking` phase with settled text; a "" / "ready" phase would fail the
        # frozen wolf_progress.phase enum and sink the offline schema check.
        await self.progress("beta", "thinking", "Plan ready — review and approve.")
        await self._repo.set_hunt_state(self._hunt_id, "plan_ready")

    def _scout_count(self) -> int:
        """How many scouts the team carries (pre-spawn — reads the spec, not live wolves)."""
        n = next((int(e.get("count") or 0) for e in self._team if e.get("role") == "scout"), 0)
        return n or DEFAULT_SCOUTS

    @staticmethod
    def _clamp_depth(value: object) -> str:
        """v3: coerce any model/user depth to the enum, defaulting to 'standard'. An out-of-enum value
        must never reach the wire — the frontend's z.enum would reject the whole plan_proposed event
        and drop the plan on the floor."""
        d = str(value or "standard").strip().lower()
        return d if d in ("brief", "standard", "deep") else "standard"

    @staticmethod
    def _dedup_and_fill(queries: object, n: int, task: str) -> list[str]:
        """The N scout angles: take the model/user queries, drop blanks and case-insensitive
        duplicates (order-preserving), then backfill to N with distinct facet angles. Two identical
        Beta queries used to BOTH survive and shrink real coverage without triggering a backfill;
        this collapses them and fills the freed slots with real, non-colliding facets so N scouts
        always range N distinct angles. Always returns exactly N queries."""
        seen: set[str] = set()
        out: list[str] = []
        for raw in queries if isinstance(queries, list) else []:
            q = str(raw).strip()
            if not q or q.casefold() in seen:
                continue
            seen.add(q.casefold())
            out.append(q)
            if len(out) >= n:
                return out
        # Backfill with facet angles, skipping any that collide with a query already kept. FACETS is
        # finite (5); once exhausted, an index suffix guarantees uniqueness so the loop always ends.
        k = 0
        while len(out) < n:
            cand = facet_query(task, k)
            if k >= len(FACETS) or cand.casefold() in seen:
                cand = f"{facet_query(task, k)} {len(out) + 1}"
            if cand.casefold() not in seen:
                seen.add(cand.casefold())
                out.append(cand)
            k += 1
        return out

    def _resolve_strategy_for_depth(self, depth: str | None = None) -> None:
        """Re-drive the coordination strategy from the current depth: a `deep` hunt auto-upgrades
        orchestrate → deep_dive (a second scout round); a downgrade off `deep` reverts an
        auto-upgrade back to orchestrate. An EXPLICIT strategy choice always wins and is never
        touched. Called from two seams: `_propose_plan` (Beta's proposed depth, before the plan dict
        exists — mutates only self._strategy) and `_approve` (the user's depth override, where the
        normalized plan exists — also re-stamps self._plan['strategy'] so a resumed hunt restores
        the right strategy)."""
        if self._strategy_explicit:
            return
        d = self._clamp_depth(depth) if depth is not None else self.depth
        if d == "deep" and self._strategy.name == "orchestrate":
            self._strategy = get_strategy("deep_dive")
        elif d != "deep" and self._strategy.name == "deep_dive":
            self._strategy = get_strategy("orchestrate")
        if self._plan:  # only where a normalized plan exists (the _approve seam)
            self._plan["strategy"] = self._strategy.name

    def _normalize_plan(self, parsed: dict) -> dict:
        """Coerce the model's plan into a schema-valid plan_proposed payload: build the per-task
        TEAM, then derive the scout angles/steps/worker-roster from it (additive canvas fields)."""
        task = self._raw_input or "the topic"
        # v5.1: a saved Instinct's formation seeds the team (overrides Beta's sizing); else Beta's.
        # NOTE: when a seed is present the queries below are re-sized to the SEED's scout count, so
        # Beta's extra angles beyond the seed are trimmed by design — the Instinct's formation wins.
        self._team = build_team({"team": self._seed_team} if self._seed_team else parsed)
        scout_ids = wolf_ids("scout", self._scout_count())
        n = len(scout_ids)
        # Dedup Beta's queries, then backfill to n with distinct facet angles — n scouts always range
        # n distinct angles (duplicates no longer silently shrink coverage).
        queries = self._dedup_and_fill(parsed.get("queries"), n, task)
        assumptions = [str(a).strip() for a in (parsed.get("assumptions") or []) if str(a).strip()]
        summary = str(parsed.get("summary") or "").strip()
        # v3: adaptive depth — Beta's judgment, clamped. Coherence floor: a team carrying ≥4 scouts
        # (whatever Beta or an Instinct seed set) is not a "brief" fact-check — floor brief→standard.
        # (Only brief→standard: never auto-force `deep`, which spends a whole second scout round on a
        # sizing heuristic instead of Beta's explicit scope judgment.)
        depth = self._clamp_depth(parsed.get("depth"))
        if depth == "brief" and n >= 4:
            depth = "standard"
        # est_cost/est_time are UI-preview numbers (the spend gate reserves from pricing.estimate, not
        # these). ALWAYS derive them per depth — Beta can't ground token pricing/latency, and its guess
        # used to override the correct default (or propagate an absurd/negative value).
        est_cost = {"brief": 0.4, "standard": 0.7, "deep": 1.4}[depth]
        est_time = {"brief": 150, "standard": 220, "deep": 340}[depth]
        return {
            "steps": [
                {
                    "step_id": "s1",
                    "summary": f"Range on {n} angles of {task}",
                    "wolves": list(scout_ids),
                },
                {
                    "step_id": "s2",
                    "summary": "Cross-reference the findings and extract claims",
                    "wolves": ["tracker"],
                },
                {
                    "step_id": "s3",
                    "summary": "Draft the briefing with citations",
                    "wolves": ["howler"],
                },
            ],
            "wolves": [*scout_ids, "tracker", "sentinel", "howler", "elder", "warden"],
            "pattern": self._strategy.pattern,
            # Empty when Beta surfaced no real ambiguity — reads honestly as "nothing to resolve"
            # instead of the old non-editable boilerplate triple.
            "assumptions": assumptions,
            "est_cost": est_cost,
            "est_time": est_time,
            # additive (schema allows extra fields): the canvas + Door + Edit Panel read these.
            # `summary` is carried for observability — a real plan has one, a fallback (empty parsed)
            # doesn't, so the two are distinguishable in the event log.
            "summary": summary,
            "queries": queries,
            "strategy": self._strategy.name,
            "depth": depth,
            "team": self._team,
        }

    async def _approve(self, cmd: dict) -> None:
        # v3: the user may have overridden depth on the plan card. Apply it BEFORE spawn/execute so
        # merge/draft honor it. Ignore anything not in the enum (keeps Beta's proposed depth).
        override = cmd.get("depth")
        if override in ("brief", "standard", "deep"):
            self._plan["depth"] = override
            # Re-drive the strategy for the overridden depth: bumping to `deep` must actually run the
            # deep_dive second round (not just scale merge/draft targets), and a downgrade reverts an
            # auto-upgrade. Also re-stamps self._plan['strategy'] so a resumed hunt restores it.
            self._resolve_strategy_for_depth()
        await self._apply_edits(cmd.get("edits") or {})

        approved = float(cmd.get("boundary_usd", 1.0))
        from app.config import settings

        # First-hunt silent cap: never spend past the cap, whatever was approved.
        effective = min(approved, settings.first_hunt_cap_usd)
        self._boundary = Boundary(boundary_usd=effective)
        await self._repo.set_boundary(self._hunt_id, effective)
        self._mode = str(cmd.get("mode") or "on_signal")
        await self._emit(
            "plan_approved",
            "user",
            # v3: persist the (possibly overridden) depth so a resumed hunt keeps it.
            {"mode": self._mode, "boundary_usd": effective, "depth": self.depth},
        )
        # The pack starts working now — anchor the measured runtime here (the approval gate before
        # this is human wait time and is deliberately excluded). Mirrors the live client clock, which
        # also starts ticking on the plan_approved → running transition.
        self._run_started_monotonic = time.monotonic()
        await self._repo.set_hunt_state(self._hunt_id, "hunting")

    async def _apply_edits(self, edits: dict) -> None:
        """Apply the user's plan edits (queries/assumptions) before the hunt runs and record the
        change as a plan_edited event."""
        if not isinstance(edits, dict) or not edits:
            return
        diff: dict = {}
        # The user reshaped the formation in the Edit Panel — rebuild the canonical team from it.
        raw_team = edits.get("team")
        if isinstance(raw_team, list) and raw_team:
            self._team = build_team({"team": raw_team})
            self._plan["team"] = self._team
            scouts = wolf_ids("scout", self._scout_count())
            self._plan["wolves"] = [*scouts, "tracker", "sentinel", "howler", "elder", "warden"]
            diff["team"] = self._team
        raw_queries = edits.get("queries")
        if isinstance(raw_queries, list):
            # Only rewrite queries when the user actually supplied some — editing team/assumptions
            # alone must not touch queries or emit a spurious diff. When they did, dedup-and-fill to
            # n with the same logic _normalize_plan uses (distinct angles, no duplicates).
            if any(str(q).strip() for q in raw_queries):
                qs = self._dedup_and_fill(raw_queries, self._scout_count(), self.task)
                self._plan["queries"] = qs
                self._queries = list(qs)
                diff["queries"] = qs
        raw_assumptions = edits.get("assumptions")
        if isinstance(raw_assumptions, list):
            a = [str(x).strip() for x in raw_assumptions if str(x).strip()]
            self._plan["assumptions"] = a
            diff["assumptions"] = a
        # Per-wolf handler notes from the Edit Formations panel, keyed by wolf_id
        # (scout-4, tracker-2, …). Injected into that wolf's prompts in `_messages`.
        raw_notes = edits.get("notes")
        if isinstance(raw_notes, dict):
            self._wolf_notes = {
                str(k): str(v).strip() for k, v in raw_notes.items() if str(v).strip()
            }
            if self._wolf_notes:
                diff["notes"] = self._wolf_notes
        if diff:
            await self._emit("plan_edited", "user", {"diff": diff})

    async def _absorb_inputs(self) -> None:
        """Drain any mid-hunt `add_input` commands (non-blocking), persist each as an artifact,
        record it on the hunt's context, and emit input_added. A `stop` seen here still stops."""
        held: list[dict] = []
        while True:
            try:
                cmd = self._commands.get_nowait()
            except asyncio.QueueEmpty:
                break
            ctype = cmd.get("type")
            if ctype == "add_input":
                text = str(cmd.get("text") or "").strip()
                if text:
                    aid = new_artifact_id()
                    await self._repo.save_artifact(
                        aid, self._hunt_id, "input", "user", {"text": text}
                    )
                    self._extra_inputs.append(text)
                    kind = str(cmd.get("kind") or "text")
                    if cmd.get("transcript"):  # audio that was transcribed → fire transcript_ready
                        await self._emit(
                            "transcript_ready",
                            "engine",
                            {
                                "artifact_id": aid,
                                "provider": str(cmd.get("provider") or "qwen_asr"),
                                "duration_s": float(cmd.get("duration_s") or 0.0),
                            },
                        )
                    await self._emit(
                        "input_added", "user", {"artifact_id": aid, "kind": kind, "mid_hunt": True}
                    )
            elif ctype == "stop":
                raise StopHunt()
            else:
                held.append(cmd)
        for c in held:
            self._commands.put_nowait(c)

    async def _spawn_roster(self) -> None:
        roster = roster_from_team(self._team or build_team({}))
        # v3: scouts run a stronger tier on a deep hunt (real fact-extraction with reasoning). Resolve
        # here — depth is final after _approve, and build_team/roster_from_team stay depth-agnostic
        # (reused by rehydrate/apply_edits/resume). wolf_spawned then reports the truth to the canvas.
        s_tier, s_think, s_budget = scout_spec(self.depth)
        for wolf_id, role, tier, thinking, budget in roster:
            if role == "scout":
                tier, thinking, budget = s_tier, s_think, s_budget
            self._wolves[wolf_id] = self._make_wolf(wolf_id, role, tier, thinking)
            self._wolf_budget[wolf_id] = budget
            await self._emit(
                "wolf_spawned",
                "engine",
                {
                    "wolf_id": wolf_id,
                    "role": role,
                    "model_tier": tier,
                    "thinking": thinking,
                    "prompt_version": load_prompt(role).version,
                    "budget_usd": budget,
                    "parent_wolf_id": None,
                },
            )

    async def _spawn_wolf(
        self,
        role: str,
        *,
        parent: str | None = None,
        tier: str | None = None,
        thinking: bool | None = None,
        budget: float | None = None,
    ) -> str:
        """Spawn ONE wolf mid-hunt (a clone or a fresh role) and emit wolf_spawned. Returns its id.
        Ids follow the roster convention: the bare role, then role-2, role-3 … as copies appear."""
        d_tier, d_think, d_budget = ROLE_SPEC.get(role, ("flash", False, 0.05))
        if role == "scout":
            # A fresh mid-hunt scout matches the depth-appropriate tier (a clone passes explicit
            # tier/thinking/budget from its source, so it never falls through to these defaults).
            d_tier, d_think, d_budget = scout_spec(self.depth)
        tier = tier or d_tier
        thinking = d_think if thinking is None else thinking
        budget = d_budget if budget is None else budget
        kin = [w for w in self._wolves if w == role or w.startswith(f"{role}-")]
        wid = role if not kin else f"{role}-{len(kin) + 1}"
        self._wolves[wid] = self._make_wolf(wid, role, tier, thinking)
        self._wolf_budget[wid] = budget
        await self._emit(
            "wolf_spawned",
            "engine",
            {
                "wolf_id": wid,
                "role": role,
                "model_tier": tier,
                "thinking": thinking,
                "prompt_version": load_prompt(role).version,
                "budget_usd": budget,
                "parent_wolf_id": parent,
            },
        )
        return wid

    async def clone(self, wolf_id: str) -> str:
        """Mid-hunt: clone an existing wolf (same role/tier) to add capacity. Returns the new id."""
        src = self._wolves.get(wolf_id)
        if src is None:
            return ""
        return await self._spawn_wolf(
            src.role,
            parent=wolf_id,
            tier=src.tier,
            thinking=src.thinking,
            budget=self._wolf_budget.get(wolf_id),
        )

    async def spawn(self, role: str) -> str:
        """Mid-hunt: add a fresh wolf of a role (Alpha widening the pack). Returns the new id."""
        return await self._spawn_wolf(role)

    async def _open_pack(self) -> None:
        """Wake the pack's leadership on the canvas at kickoff. Alpha takes the lead and stays active
        until finish; Beta hands the approved plan to the pack (its planning is already done). Both
        emit real lifecycle events so their nodes light up and the edges leaving them flow — without
        this, Alpha/Beta sit dormant the whole hunt and their edges never animate."""
        await self._emit(
            "step_started",
            "alpha",
            {"step_id": "s0-lead", "wolf_id": "alpha", "summary": "Leading the hunt"},
        )
        self._lead_opened = True
        self._lead_closed = False  # a resume re-opens the lead → allow it to close again
        await self._emit(
            "step_started",
            "beta",
            {"step_id": "s0-brief", "wolf_id": "beta", "summary": "Briefed the pack on the plan"},
        )
        await self._emit(
            "step_completed",
            "beta",
            {
                "step_id": "s0-brief",
                "wolf_id": "beta",
                "output_ref": f"art_{self._hunt_id}_plan",
                "confidence": 0.9,
            },
        )
        # The Elder consulted the pack's memory before the plan — light its node with what it recalled.
        recalled = "Recalled past lessons." if self._memory_note else "No past hunts yet."
        await self._emit(
            "step_started",
            "elder",
            {"step_id": "s0-elder", "wolf_id": "elder", "summary": recalled},
        )
        await self._emit(
            "step_completed",
            "elder",
            {
                "step_id": "s0-elder",
                "wolf_id": "elder",
                "output_ref": f"art_{self._hunt_id}_memory",
                "confidence": 0.9,
            },
        )

    async def _close_lead_if_open(self) -> None:
        """Settle Alpha's s0-lead node on a genuinely-terminal exit (stop/fail) so it doesn't hang
        'active' forever. No-op if the lead never opened (a stop DURING plan approval, before
        _open_pack) or was already closed by finish() — never emit an orphan or double close. NOT
        called on a BoundaryHalt: that's a pause, the hunt resumes and re-opens the lead."""
        if not self._lead_opened or self._lead_closed:
            return
        self._lead_closed = True
        await self._emit(
            "step_completed",
            "alpha",
            {
                "step_id": "s0-lead",
                "wolf_id": "alpha",
                "output_ref": f"art_{self._hunt_id}_lead",
                "confidence": 0.0,
            },
        )

    # --- Engine surface (the primitives strategies orchestrate) ------------------------

    @property
    def task(self) -> str:
        return self._raw_input or "the topic"

    @property
    def plan(self) -> dict:
        return self._plan

    @property
    def depth(self) -> str:
        """v3: adaptive research depth (brief|standard|deep) — the single source the merge/draft
        targets and slice scaling read. Lives on self._plan, so it survives rehydrate and a user
        override applied in _approve."""
        return self._clamp_depth(self._plan.get("depth"))

    def scout_ids(self) -> list[str]:
        # Live scouts in spawn order — N is whatever Alpha built / the user edited, not a fixed 3.
        return [wid for wid, w in self._wolves.items() if w.role == "scout"]

    def _lead_of(self, role: str) -> Wolf:
        """The wolf that runs a support STEP for `role` (merge→tracker, critique→sentinel,
        draft→howler). Normally the primary keeps the bare id (`roster.wolf_ids`), but NEVER index
        `self._wolves[role]` directly: a formation edit that removed/renamed the primary, or added a
        second instance ahead of it, would KeyError and crash the whole hunt at step setup — outside
        `_dispatch`'s heal-don't-fail guard. Resolve defensively: bare id → else the first instance of
        the role → else mint one on the fly so the step (and the hunt) always proceeds."""
        w = self._wolves.get(role)
        if w is not None:
            return w
        for wolf in self._wolves.values():
            if wolf.role == role:
                return wolf
        # No instance at all (a stripped formation) — spawn one so the step can still run.
        tier, thinking, _budget = ROLE_SPEC.get(role, ("plus", False, 0.05))
        self._wolves[role] = self._make_wolf(role, role, tier, thinking)
        self._wolf_budget.setdefault(role, _budget)
        return self._wolves[role]

    def _wolves_of(self, role: str) -> list[Wolf]:
        """Every live instance of a support role, primary first — so an added second tracker/sentinel/
        howler (a distinct editable agent with its own note) actually contributes instead of idling."""
        primary = self._wolves.get(role)
        extras = [w for wid, w in self._wolves.items() if w.role == role and w is not primary]
        return ([primary] if primary is not None else []) + extras

    def queries(self) -> list[str]:
        return list(self._queries)

    async def progress(self, wolf_id: str, phase: str, text: str) -> None:
        """A live progress beat to a wolf's node on the canvas (throttled, never per-token)."""
        await self._emit(
            "wolf_progress", wolf_id, {"wolf_id": wolf_id, "phase": phase, "text": text[:200]}
        )

    async def scout(self, wolf_id: str, query: str, step_id: str = "s1") -> Finding:
        """One scout's range — resilient wrapper. A scout may only return a Finding or raise the hunt's
        control-flow (Stop/Boundary). Any OTHER error is contained here so a single stray scout can
        never sink the whole hunt (the pack's core resilience promise) — no matter the scout count.
        This is what makes running a bigger formation safe."""
        wolf = self._wolves.get(wolf_id)
        if wolf is None:
            return Finding(wolf_id=wolf_id, summary="", sources=[], confidence=0.0)
        try:
            return await self._scout_impl(wolf, wolf_id, query, step_id)
        except (StopHunt, BoundaryHalt, asyncio.CancelledError):
            raise  # control-flow must propagate so halt/stop still work
        except Exception as exc:  # noqa: BLE001 — a stray scout is contained, not fatal
            logging.getLogger("pack").warning("scout %s errored: %r", wolf_id, exc)
            with contextlib.suppress(Exception):
                await self._stray_event(wolf_id, "error", None)
                await self._emit(
                    "step_completed",
                    wolf_id,
                    {
                        "step_id": step_id,
                        "wolf_id": wolf_id,
                        "output_ref": f"art_{wolf_id}_out",
                        "confidence": 0.0,
                    },
                )
            return Finding(
                wolf_id=wolf_id, summary=f"(failed on {query})", sources=[], confidence=0.0
            )

    async def _scout_impl(self, wolf: Wolf, wolf_id: str, query: str, step_id: str) -> Finding:
        """One scout's range: real web search → summarize the hits with their sources → hand off."""
        # Plain keywords reach the APIs — covers Beta's plan and the user's edited angles.
        query = plain_query(query)
        await self._emit(
            "step_started",
            wolf_id,
            {"step_id": step_id, "wolf_id": wolf_id, "summary": f"Searching: {query}"},
        )
        await self.progress(wolf_id, "searching", f"Searching: {query}")

        hits, ok, ref, stray = await self._scout_search(wolf, query)
        if stray:  # the tools kept failing — Alpha reroutes this scout
            await self._stray_event(wolf_id, stray, ref)
        await self.progress(wolf_id, "reading", f"Reading {len(hits)} sources")

        out_ref = ref or f"art_{wolf_id}_out"
        if not hits:
            # No ground to read → do NOT dispatch the model. Handed "(No results returned.)", a flash
            # model invents a plausible summary from prior knowledge with sources=[] — a hallucination
            # stamped with fake confidence. Emit an honest completion and return an empty finding so
            # keep_findings() drops it; the no_sources path in draft()/finish() handles a dry hunt.
            await self._emit(
                "step_completed",
                wolf_id,
                {"step_id": step_id, "wolf_id": wolf_id, "output_ref": out_ref, "confidence": 0.0},
            )
            return Finding(
                wolf_id=wolf_id, summary="", sources=[], confidence=0.0, output_ref=out_ref
            )
        try:
            # A wolf that stalls past the step timeout is a Stray; reroute and move on.
            res = await asyncio.wait_for(
                self._dispatch(
                    wolf,
                    "search",
                    context=self._hits_context(query, hits),
                    phase="reading",
                    response_schema=FINDINGS_SCHEMA,
                ),
                timeout=self._step_timeout,
            )
        except TimeoutError:
            await self._stray_event(wolf_id, "timeout", ref)
            await self._emit(
                "step_completed",
                wolf_id,
                {"step_id": step_id, "wolf_id": wolf_id, "output_ref": out_ref, "confidence": 0.2},
            )
            return Finding(
                wolf_id=wolf_id,
                summary=f"(stalled on {query})",
                sources=hits,
                confidence=0.2,
                output_ref=out_ref,
            )

        parsed = res.parsed or {}
        summary = str(parsed.get("summary") or res.text or f"Findings on {query}")
        # Default confidence from whether we actually READ pages, not from `ok` (which only means
        # "hits came back"). Pages read → 0.7; snippet-only → 0.3 (below the 0.35 usability floor, so
        # a model-silent snippet-only finding drops). The model's explicit confidence still wins.
        verified = any(h.get("verified") for h in hits)
        default_conf = 0.7 if verified else 0.3
        confidence = float(parsed.get("confidence", default_conf) or 0.0)

        await self._emit(
            "step_completed",
            wolf_id,
            {
                "step_id": step_id,
                "wolf_id": wolf_id,
                "output_ref": out_ref,
                "confidence": round(confidence, 2),
            },
        )
        await self._emit(
            "message_passed",
            wolf_id,
            {
                "from_wolf": wolf_id,
                "to_wolf": "tracker",
                "intent": "handoff_findings",
                "summary": summary[:140],
                "ref": out_ref,
            },
        )
        return Finding(
            wolf_id=wolf_id,
            summary=summary,
            sources=hits,
            confidence=confidence,
            output_ref=out_ref,
        )

    async def merge(self, findings: list[Finding], step_id: str = "s2") -> Merged:
        """Tracker cross-references the findings into claims and surfaces any real conflict."""
        await self._absorb_inputs()  # A7: fold in anything the Packmaster added mid-hunt
        tracker = self._lead_of("tracker")
        await self._emit(
            "step_started",
            "tracker",
            {
                "step_id": step_id,
                "wolf_id": "tracker",
                "summary": "Cross-referencing the scouts' findings",
            },
        )
        await self.progress("tracker", "merging", f"Cross-referencing {len(findings)} findings")

        # Absorb the library BEFORE building the registry (on both branches below) so the KB docs get
        # stable [N]s too — building the registry from findings alone would leave KB sources unnumbered
        # in the prompt even though draft()/finish() dedupe them into the same list afterward.
        raw_sources = [s for f in findings for s in f.sources]
        raw_sources.extend(await self._absorb_knowledge())
        reg_sources, registry = prompt_context.numbered_sources(raw_sources)

        # The merge is the single heaviest call — a plus+thinking model synthesizing every finding
        # into claims. It legitimately runs 90-180s+; the old per-step timeout clipped it and the
        # whole synthesis silently collapsed to a raw-findings paste. Give it the synthesis budget and
        # retry ONCE (a single transient slow call shouldn't lose the whole brief) before the honest
        # fallback.
        res = None
        for attempt in range(settings.synthesis_retries + 1):
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        tracker,
                        "merge",
                        context=self._findings_context(findings, registry),
                        phase="merging",
                        response_schema=MERGE_SCHEMA,
                        instruction_override=prompt_context.merge_instruction(self.depth),
                    ),
                    timeout=self._synthesis_timeout,
                )
                break
            except TimeoutError:
                if attempt < settings.synthesis_retries:
                    await self.progress(
                        "tracker",
                        "merging",
                        "Synthesis is taking a while — giving it another pass…",
                    )
                    continue
                res = None
        if res is None:
            await self._stray_event("tracker", "timeout", None)
            out_ref = new_artifact_id()
            # Map each finding's OWN sources to their registry number, so the honest fallback brief
            # can cite exactly what that finding read — not a bare, unsourced snippet list.
            index = {canonical_url(s.get("url", "")): i + 1 for i, s in enumerate(reg_sources)}
            stalled = [
                (
                    f.summary,
                    sorted(
                        {
                            index[canonical_url(s.get("url", ""))]
                            for s in f.sources
                            if canonical_url(s.get("url", "")) in index
                        }
                    ),
                )
                for f in findings
                if f.summary.strip()
            ]
            summary = "(tracker stalled — using scout summaries)"
            await self._repo.save_artifact(
                out_ref, self._hunt_id, "draft", "tracker", {"summary": summary, "claims": []}
            )
            await self._emit(
                "step_completed",
                "tracker",
                {
                    "step_id": step_id,
                    "wolf_id": "tracker",
                    "output_ref": out_ref,
                    "confidence": 0.0,
                },
            )
            return Merged(
                summary=summary,
                claims=[],
                conflict=None,
                output_ref=out_ref,
                sources=reg_sources,
                stalled_findings=stalled,
            )
        parsed = res.parsed or {}
        summary = str(parsed.get("summary") or res.text or "Merged the findings.")
        claims, claims_src = self._coerce_claims(parsed.get("claims"), len(reg_sources))
        conflict = self._conflict_from(parsed.get("conflict"))
        out_ref = new_artifact_id()
        await self._repo.save_artifact(
            out_ref,
            self._hunt_id,
            "draft",
            "tracker",
            {"summary": summary, "claims": claims, "claims_src": claims_src},
        )
        await self._emit(
            "step_completed",
            "tracker",
            {"step_id": step_id, "wolf_id": "tracker", "output_ref": out_ref, "confidence": 0.9},
        )
        await self._emit(
            "message_passed",
            "tracker",
            {
                "from_wolf": "tracker",
                "to_wolf": "howler",
                "intent": "handoff_merge",
                "summary": summary[:140],
                "ref": out_ref,
            },
        )
        return Merged(
            summary=summary,
            claims=claims,
            claims_src=claims_src,
            conflict=conflict,
            output_ref=out_ref,
            sources=reg_sources,
        )

    @staticmethod
    def _coerce_claims(raw: object, n_sources: int) -> tuple[list[str], list[list[int]]]:
        """Coerce Tracker's claims into (text, source_ids) pairs. Accepts either shape: an object
        {text, source_ids} (the shape asked for) or a plain string (legacy / a model that ignores the
        schema — FakeQwen included) which coerces to an empty source list. source_ids are clamped to
        the registry's real range so an out-of-bounds or non-numeric id never corrupts a citation."""
        claims: list[str] = []
        claims_src: list[list[int]] = []
        for c in raw if isinstance(raw, list) else []:
            if isinstance(c, dict):
                text = str(c.get("text") or "").strip()
                ids = prompt_context.coerce_source_ids(c.get("source_ids"), n_sources)
            else:
                text, ids = str(c).strip(), []
            if text:
                claims.append(text)
                claims_src.append(ids)
        return claims, claims_src

    async def _absorb_knowledge(self) -> list[dict]:
        """v4.2: pick the most relevant of your library docs and return them as injectable sources
        (synthetic lib:// url so de-dupe keeps them). Absorbed ONCE per hunt — deep_dive/critique
        call merge() twice. Best-effort — never sink a hunt."""
        if self._kb_absorbed:
            return list(self._kb_picks)
        self._kb_absorbed = True
        try:
            docs = await self._repo.list_documents(with_text=True)
        except Exception:  # noqa: BLE001 — the knowledge base is best-effort
            return []
        self._kb_picks = select_relevant(docs, self.task, self.depth)
        return list(self._kb_picks)

    async def resolve_conflict(self, conflict: Conflict, sources: list[dict]) -> str:
        """Open a Hold for the human and block until they decide — unless the Packmaster set the leash
        to On Wild, in which case ALPHA actually reasons about the conflict (weighs the options against
        the numbered sources, via a real boundary-gated model call) and records WHY it chose. It used
        to just echo Tracker's `recommended` with Alpha's name on it and no rationale."""
        hold_id = new_hold_id()
        await self._emit(
            "hold_opened",
            "alpha",
            {
                "hold_id": hold_id,
                "question": conflict.question,
                "context_ref": conflict.context_ref,
                "options": conflict.options,
                "recommended": conflict.recommended,
            },
        )
        if self._mode == "wild":
            resolution, why = await self._alpha_decides_conflict(conflict, sources)
            await self._emit(
                "hold_resolved",
                "alpha",
                {"hold_id": hold_id, "resolution": resolution, "auto": True, "rationale": why},
            )
            return resolution
        await self._repo.set_hunt_state(self._hunt_id, "holding")
        try:
            cmd = await self._await_command("resolve_hold")
        except StopHunt:
            # A stop during the human Hold must still pair the open hold_resolved (no dangling Hold),
            # then let the stop unwind.
            with contextlib.suppress(Exception):
                await self._emit(
                    "hold_resolved",
                    "user",
                    {"hold_id": hold_id, "resolution": "Stopped by the Packmaster"},
                )
            raise
        resolution = str(cmd.get("resolution") or conflict.recommended)
        await self._emit(
            "hold_resolved",
            "user",
            {"hold_id": hold_id, "resolution": resolution, "edited_text": cmd.get("edited_text")},
        )
        await self._repo.set_hunt_state(self._hunt_id, "hunting")
        return resolution

    async def _alpha_decides_conflict(
        self, conflict: Conflict, sources: list[dict]
    ) -> tuple[str, str]:
        """Wild mode: Alpha weighs the options against the numbered sources and returns (choice,
        rationale). Falls back to Tracker's `recommended` (with an honest note) when Alpha can't be
        reached / times out / returns an off-menu choice — never a blank or a hallucinated option."""
        fallback = (
            conflict.recommended,
            "Auto-resolved to the recommended option — Alpha's call could not be completed.",
        )
        alpha = self._wolves.get("alpha")
        if alpha is None:
            return fallback
        _, registry = prompt_context.numbered_sources(sources)
        context = (
            f"Conflict: {conflict.question}\nOptions:\n"
            + "\n".join(f"- {o}" for o in conflict.options)
            + (f"\n\nSources on the table:\n{registry}" if registry else "")
        )
        try:
            res = await asyncio.wait_for(
                self._dispatch(
                    alpha,
                    "conflict_decide",
                    context=context,
                    phase="thinking",
                    response_schema=CONFLICT_DECIDE_SCHEMA,
                ),
                timeout=self._step_timeout,
            )
        except TimeoutError:
            return fallback
        if res.model in ("(faulted)", "(relieved)"):
            return fallback
        parsed = res.parsed or {}
        choice = str(parsed.get("choice") or "").strip()
        rationale = str(parsed.get("rationale") or res.text or "").strip()
        # Membership check — Alpha must pick one of the OFFERED options; an off-menu paraphrase falls
        # back to the recommended (never ship an option that wasn't on the table).
        if choice in conflict.options and rationale:
            return choice, rationale
        return fallback

    async def find_gaps(self, merged: Merged) -> list[str]:
        """Tracker names what's still missing — the queries for a second deep-dive round."""
        tracker = self._lead_of("tracker")
        try:
            res = await asyncio.wait_for(
                self._dispatch(
                    tracker,
                    "gaps",
                    context=self._merged_context(merged),
                    phase="thinking",
                    response_schema=GAPS_SCHEMA,
                ),
                timeout=self._step_timeout,
            )
        except TimeoutError:
            await self._stray_event("tracker", "timeout", None)
            return []
        parsed = res.parsed or {}
        # v3: a deeper hunt closes more gaps (a second scout round). The cap lives here (not in the
        # strategy) so it's the single source of truth. self.depth is clamped, so no KeyError.
        cap = {"brief": 1, "standard": 2, "deep": 4}[self.depth]
        return [str(g).strip() for g in (parsed.get("gaps") or []) if str(g).strip()][:cap]

    async def critique(self, merged: Merged) -> CritiqueResult:
        """Sentinel checks every claim carries a real source."""
        sentinel = self._lead_of("sentinel")
        await self._emit(
            "step_started",
            "sentinel",
            {"step_id": "s-critique", "wolf_id": "sentinel", "summary": "Verifying the claims"},
        )
        await self.progress("sentinel", "critiquing", "Checking every claim carries a source")

        # A critique that didn't actually run must read as UNVERIFIED, not passed. The old code
        # returned ok=True on timeout (blanket approval) and — worse — on a faulted/oversize dispatch
        # (parsed=None) it fell through to ok=bool({}.get("ok", True))=True with confidence 0.9: a
        # false clean bill. Both now return an honest "did not complete" verdict at confidence 0.0.
        # The critique carries the whole merge context (all claims + registry), so it gets the same
        # synthesis budget + one retry as merge/draft.
        def _unverified() -> CritiqueResult:
            # Empty `claim` so apply_critique flags the STATE (ok=False opens the standoff) without
            # matching — and thus dropping — every claim in the brief.
            return CritiqueResult(
                ok=False,
                issues=[
                    {
                        "claim": "",
                        "problem": "verification did not complete — claims are unverified",
                    }
                ],
            )

        res = None
        for attempt in range(settings.synthesis_retries + 1):
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        sentinel,
                        "critique",
                        context=self._merged_context(merged, sources=merged.sources),
                        phase="critiquing",
                        response_schema=CRITIQUE_SCHEMA,
                    ),
                    timeout=self._synthesis_timeout,
                )
                break
            except TimeoutError:
                if attempt < settings.synthesis_retries:
                    await self.progress(
                        "sentinel", "critiquing", "Still verifying — one more pass…"
                    )
                    continue
                res = None
        # Faulted/relieved dispatch returns a CompletionResult with parsed=None + empty text (no raise).
        faulted = res is not None and res.parsed is None and not (res.text or "").strip()
        if res is None or faulted:
            await self._stray_event(
                "sentinel", "timeout" if res is None else "provider_error", None
            )
            await self._emit(
                "step_completed",
                "sentinel",
                {
                    "step_id": "s-critique",
                    "wolf_id": "sentinel",
                    "output_ref": f"art_{self._hunt_id}_critique",
                    "confidence": 0.0,
                },
            )
            return _unverified()
        parsed = res.parsed or {}
        issues = [i for i in (parsed.get("issues") or []) if isinstance(i, dict)]
        await self._emit(
            "step_completed",
            "sentinel",
            {
                "step_id": "s-critique",
                "wolf_id": "sentinel",
                "output_ref": f"art_{self._hunt_id}_critique",
                "confidence": 0.9,
            },
        )
        return CritiqueResult(ok=bool(parsed.get("ok", True)), issues=issues)

    async def apply_critique(
        self,
        merged: Merged,
        verdict: CritiqueResult,
        *,
        ruling: StandoffOutcome | None = None,
    ) -> Merged:
        """Give Sentinel's verdict TEETH: deterministically drop the flagged claims from the merge
        before it reaches the draft. Pure, no model call — Sentinel's own bar is 'every claim carries
        a real, supporting source', so enforcing it in code is honest and can never invent a fact.
        Without this the verdict was theatre: a flagged claim shipped to the brief unchanged.

        When Alpha adjudicated a standoff (`ruling`), its call is HONORED: a `keep`/`qualify` verdict
        exempts the challenged claim from the drop (Alpha overruled Sentinel with a real ruling); a
        `drop`/`unresolved`/no-ruling leaves Sentinel's deterministic removal in force.

        Never empties a non-empty brief — if every claim is flagged, keep the sourced ones (or the
        single strongest) so a thin-but-real hunt still drafts instead of collapsing to nothing."""
        if verdict.ok or not verdict.issues or not merged.claims:
            return merged
        # The flagged claim STRINGS (skip empty ones — a "verification didn't complete" verdict flags
        # state with an empty claim and must not nuke the whole brief).
        flagged = [str(i.get("claim") or "").strip() for i in verdict.issues]
        flagged = [c for c in flagged if c]
        if not flagged:
            return merged
        task_stop = _content_tokens(self.task)  # strip the hunt's own topic words from the match
        # Alpha ruled to KEEP/QUALIFY the challenged claim → it is exempt from Sentinel's drop.
        spared = (
            ruling.claim
            if ruling is not None and ruling.verdict in ("keep", "qualify") and ruling.claim
            else None
        )
        claims_src = merged.claims_src or [[] for _ in merged.claims]
        kept: list[str] = []
        kept_src: list[list[int]] = []
        for claim, src in zip(merged.claims, claims_src, strict=False):
            if spared is not None and _claim_matches(spared, claim, task_stop):
                kept.append(claim)  # Alpha overruled Sentinel — keep it
                kept_src.append(src)
                continue
            if any(_claim_matches(f, claim, task_stop) for f in flagged):
                continue  # Sentinel flagged this one — drop it
            kept.append(claim)
            kept_src.append(src)
        if not kept:
            # Everything was flagged — never ship an empty brief. Prefer the claims that DO rest on a
            # source; failing that, keep the single first claim so the draft still has ground.
            pairs = list(zip(merged.claims, claims_src, strict=False))
            sourced = [(c, s) for c, s in pairs if s]
            keep_pairs = sourced or pairs[:1]
            kept = [c for c, _ in keep_pairs]
            kept_src = [s for _, s in keep_pairs]
        if len(kept) == len(merged.claims):
            return merged  # nothing matched — leave the merge untouched
        await self.progress(
            "sentinel",
            "critiquing",
            f"Dropped {len(merged.claims) - len(kept)} unverified claim(s) from the brief.",
        )
        return replace(merged, claims=kept, claims_src=kept_src)

    def standoff_evidence(self, merged: Merged, issue: dict) -> str:
        """Ground the standoff in the ACTUAL flagged claim + its backing sources + the numbered source
        registry — so every debater presses/answers/judges a concrete claim ("X, cited to [2]") with
        the real sources in front of it, not an abstract "a claim needs a source." Matches the flagged
        claim to the merge (token-overlap, paraphrase-tolerant) so the real source numbers ride along;
        falls back to the issue's own text when no match is found."""
        flagged = str(issue.get("claim") or "").strip()
        task_stop = _content_tokens(self.task)
        claim_line = f"The claim under challenge: {flagged}" if flagged else ""
        for claim, ids in zip(merged.claims, merged.claims_src or [], strict=False):
            if flagged and _claim_matches(flagged, claim, task_stop):
                cite = f" [cited to {', '.join(map(str, ids))}]" if ids else " [no source cited]"
                claim_line = f"The claim under challenge: {claim}{cite}"
                break
        if not claim_line:
            return ""
        _, registry = prompt_context.numbered_sources(merged.sources)
        if registry:
            return f"{claim_line}\n\nSources on the table:\n{registry}"
        return claim_line

    async def standoff(
        self,
        challenger: str,
        defendant: str,
        claim_ref: str,
        rationale: str,
        *,
        evidence: str = "",
        claim: str | None = None,
    ) -> StandoffOutcome:
        """A real, bounded debate over a weak claim: the challenger presses it, the defendant
        answers, Alpha adjudicates — each a model call, each boundary-gated. `evidence`, when given,
        grounds the challenger in the specific flagged claim + its sources (see standoff_evidence).
        Returns Alpha's RULING (keep/drop/qualify) so it actually decides the claim's fate — not just
        narration. `claim` is the challenged claim text, threaded to apply_critique's keep-exemption."""
        sid = new_standoff_id()
        await self._repo.set_hunt_state(self._hunt_id, "standoff")
        await self._emit(
            "standoff_opened",
            challenger,
            {
                "standoff_id": sid,
                "challenger": challenger,
                "defendant": defendant,
                "claim_ref": claim_ref,
            },
        )

        # Turn 1 — the challenger states why the claim doesn't yet stand. Ground it in the specific
        # flagged claim + its sources when the strategy passed evidence; else fall back to rationale.
        chal_text = rationale
        chal_wolf = self._wolves.get(challenger)
        if chal_wolf is not None:
            challenge_ctx = evidence or f"The claim under challenge: {rationale}"
            if evidence:
                challenge_ctx += f"\nWhy it's weak: {rationale}"
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        chal_wolf,
                        "standoff_challenge",
                        context=challenge_ctx,
                        phase="critiquing",
                    ),
                    timeout=self._step_timeout,
                )
                chal_text = res.text or rationale
            except TimeoutError:
                pass  # chal_text stays as rationale fallback
        await self._emit(
            "standoff_turn",
            challenger,
            {"standoff_id": sid, "turn_no": 1, "argument_summary": chal_text[:140]},
        )

        # Turn 2 — the defendant answers, with the same evidence in front of it.
        def_text = "Fair — I'll back it with a second source."
        def_wolf = self._wolves.get(defendant)
        if def_wolf is not None:
            defend_ctx = f"The challenge to answer: {chal_text}"
            if evidence:
                defend_ctx = f"{evidence}\n\n{defend_ctx}"
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        def_wolf,
                        "standoff_defend",
                        context=defend_ctx,
                        phase="thinking",
                    ),
                    timeout=self._step_timeout,
                )
                def_text = res.text or def_text
            except TimeoutError:
                pass  # def_text stays as fallback
        await self._emit(
            "standoff_turn",
            defendant,
            {"standoff_id": sid, "turn_no": 2, "argument_summary": def_text[:140]},
        )

        # Alpha adjudicates — with the evidence, the challenge, and the defense — and returns a
        # STRUCTURED keep/drop/qualify verdict so the ruling is load-bearing (apply_critique honors it)
        # instead of being prose the engine ignores. `judged` stays False unless Alpha actually ruled
        # (a timeout/faulted/relieved call leaves no real verdict → "unresolved", never a fake alpha_call).
        rationale_out = "Keep the claim only once a second source backs it."
        judged = False
        verdict_out: str | None = None
        alpha = self._wolves.get("alpha")
        if alpha is not None:
            judge_ctx = f"Challenge: {chal_text}\nDefense: {def_text}"
            if evidence:
                judge_ctx = f"{evidence}\n\n{judge_ctx}"
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        alpha,
                        "standoff_judge",
                        context=judge_ctx,
                        phase="thinking",
                        response_schema=STANDOFF_JUDGE_SCHEMA,
                    ),
                    timeout=self._step_timeout,
                )
                parsed = res.parsed or {}
                v = str(parsed.get("verdict") or "").strip().lower()
                if res.model not in ("(faulted)", "(relieved)") and v in (
                    "keep",
                    "drop",
                    "qualify",
                ):
                    verdict_out = v
                    rationale_out = str(parsed.get("rationale") or res.text or rationale_out)
                    judged = True
            except TimeoutError:
                pass  # judged stays False → outcome "unresolved" below
        if judged:
            outcome, rationale = "alpha_call", rationale_out
        else:
            # Alpha never actually ruled — say so honestly and treat the claim as unverified rather
            # than rendering a debate that looks adjudicated. (apply_critique still drops it.)
            outcome = "unresolved"
            rationale = "Standoff could not be adjudicated — the claim is treated as unverified."
            await self._stray_event("alpha", "timeout", None)
        await self._emit(
            "standoff_resolved",
            "alpha",
            {"standoff_id": sid, "outcome": outcome, "rationale": rationale[:200]},
        )
        await self._repo.set_hunt_state(self._hunt_id, "hunting")
        return StandoffOutcome(outcome=outcome, verdict=verdict_out, claim=claim)

    async def _confirm_draft(self) -> None:
        """On Command only: Alpha checks in before the final write-up so the Packmaster can add
        anything first. Loops until they say go (each pass folds in any mid-hunt input)."""
        while True:
            hold_id = new_hold_id()
            await self._emit(
                "hold_opened",
                "alpha",
                {
                    "hold_id": hold_id,
                    "question": "Ready for the pack to write up the brief?",
                    "options": ["Write the brief", "Wait — I'll add something first"],
                    "recommended": "Write the brief",
                },
            )
            await self._repo.set_hunt_state(self._hunt_id, "holding")
            cmd = await self._await_command("resolve_hold")
            resolution = str(cmd.get("resolution") or "Write the brief")
            await self._emit(
                "hold_resolved", "user", {"hold_id": hold_id, "resolution": resolution}
            )
            await self._repo.set_hunt_state(self._hunt_id, "hunting")
            await self._absorb_inputs()
            if resolution == "Write the brief":
                return

    async def draft(self, merged: Merged, decision: str | None = None, step_id: str = "s3") -> str:
        """Howler writes the final briefing from the merged claims and the chosen decision. With NO
        sources there is no traceable ground — we don't ask Howler to write (it would only refuse);
        we return an honest notice instead."""
        await self._absorb_inputs()  # A7: last chance to fold in mid-hunt input before drafting
        if not self._dedupe_sources(merged.sources):
            self._no_sources = True
            unavailable = self._search_attempts > 0 and self._search_ok == 0
            await self._emit(
                "step_started",
                "howler",
                {"step_id": step_id, "wolf_id": "howler", "summary": "No sources to write up"},
            )
            await self._emit(
                "step_completed",
                "howler",
                {
                    "step_id": step_id,
                    "wolf_id": "howler",
                    "output_ref": f"art_{self._hunt_id}_draft",
                    "confidence": 0.0,
                },
            )
            note = _SEARCH_UNAVAILABLE_NOTE if unavailable else _NO_SOURCES_NOTE
            self._blocks = [{"text": note, "source_ids": []}]
            return note
        if not merged.claims:
            # We gathered sources but the merge produced NO claims (tracker timed out or its model
            # call faulted). Do NOT ask Howler to synthesize a narrative from empty claims — that
            # invents structure. Hand back an honest, cited source-list at reduced confidence.
            self._blocks = self._blocks_from_sources(merged)
            await self._emit(
                "step_started",
                "howler",
                {
                    "step_id": step_id,
                    "wolf_id": "howler",
                    "summary": "Merge incomplete — listing the sources gathered",
                },
            )
            await self._emit(
                "step_completed",
                "howler",
                {
                    "step_id": step_id,
                    "wolf_id": "howler",
                    "output_ref": merged.output_ref or f"art_{self._hunt_id}_draft",
                    "confidence": 0.3,
                },
            )
            return "\n\n".join(b["text"] for b in self._blocks)
        if self._mode == "on_command":
            await self._confirm_draft()
        howler = self._lead_of("howler")
        await self._emit(
            "step_started",
            "howler",
            {
                "step_id": step_id,
                "wolf_id": "howler",
                "summary": "Drafting the briefing with citations",
            },
        )
        await self.progress("howler", "writing", "Drafting the briefing")
        # Drafting the whole brief is the other heavy synthesis call — give it the same generous
        # budget + one retry as the merge, so a slow draft doesn't collapse to the bare merge summary.
        res = None
        for attempt in range(settings.synthesis_retries + 1):
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        howler,
                        "draft",
                        context=self._draft_context(merged, decision),
                        phase="writing",
                        response_schema=DRAFT_SCHEMA,
                        instruction_override=prompt_context.draft_instruction(self.depth),
                    ),
                    timeout=self._synthesis_timeout,
                )
                break
            except TimeoutError:
                if attempt < settings.synthesis_retries:
                    await self.progress(
                        "howler",
                        "writing",
                        "The briefing is taking a while — giving it another pass…",
                    )
                    continue
                res = None
        if res is None:
            await self._stray_event("howler", "timeout", None)
            self._blocks = self._blocks_from_claims(merged)
            await self._emit(
                "step_completed",
                "howler",
                {
                    "step_id": step_id,
                    "wolf_id": "howler",
                    "output_ref": f"art_{self._hunt_id}_draft",
                    "confidence": 0.0,
                },
            )
            return merged.summary
        self._blocks = self._blocks_from(res, self._dedupe_sources(merged.sources), merged)
        await self._emit(
            "step_completed",
            "howler",
            {
                "step_id": step_id,
                "wolf_id": "howler",
                "output_ref": f"art_{self._hunt_id}_draft",
                "confidence": 0.86,
            },
        )
        return "\n\n".join(b["text"] for b in self._blocks) or res.text or merged.summary

    def _blocks_from_claims(self, merged: Merged) -> list[dict]:
        """The honest fallback when Howler's OWN draft call times out: merge already succeeded, so
        `merged.claims`/`claims_src` are fully populated — reuse them (cited) instead of collapsing to
        one uncited summary blob. Falls back to the bare summary only when there are no claims either
        (mirrors `_blocks_from_sources`'s no-claims contract)."""
        if not merged.claims:
            return [{"text": merged.summary, "source_ids": []}]
        src = merged.claims_src or [[] for _ in merged.claims]
        return [
            {"text": f"# {self.task}: brief incomplete (the write-up timed out)", "source_ids": []},
            *({"text": c, "source_ids": ids} for c, ids in zip(merged.claims, src, strict=False)),
        ]

    def _blocks_from(
        self, res: CompletionResult, sources: list[dict], merged: Merged
    ) -> list[dict]:
        """Normalize Howler's tagged output into [{text, source_ids}] blocks. Falls back to the merge's
        own cited claims (mirroring `_blocks_from_sources`'s honesty) when Howler returned no real body
        blocks, or — only if there are no claims either — to wrapping whatever free text came back."""
        parsed = res.parsed or {}
        out: list[dict] = []
        title = str(parsed.get("title") or "").strip()
        if title:
            out.append({"text": f"# {title}", "source_ids": []})
        for b in parsed.get("blocks") or []:
            if not isinstance(b, dict):
                continue
            text = str(b.get("text") or "").strip()
            if not text:
                continue
            ids = prompt_context.coerce_source_ids(b.get("source_ids"), len(sources))
            out.append({"text": text, "source_ids": ids})
        if not any(b["text"] and not b["text"].startswith("# ") for b in out):
            # No real body blocks came back. Prefer the merge's own cited claims (honest, per-claim
            # attribution) over blanket-crediting every source to one blob — and never append an
            # empty-text blob (e.g. a breaker-open `_faulted_result`'s text="") that would still
            # register as a real provenance entry in finish()'s span map.
            if merged.claims:
                src = merged.claims_src or [[] for _ in merged.claims]
                out.extend(
                    {"text": c, "source_ids": ids}
                    for c, ids in zip(merged.claims, src, strict=False)
                )
            else:
                text = (res.text or "").strip()
                if text:
                    out.append({"text": text, "source_ids": list(range(1, len(sources) + 1))})
        return out

    async def finish(self, draft_text: str, merged: Merged) -> None:
        """Save the final artifact + a provenance span map, then close the hunt."""
        artifact_id = new_artifact_id()
        # Drop the full fetched/library `text` before persisting — the UI shows snippet, not text,
        # and keeping it bloats the artifact (web fetch ≤web_fetch_max_chars, KB ≤_PER_DOC per source).
        deduped = self._dedupe_sources(merged.sources)
        sources = [{k: v for k, v in s.items() if k != "text"} for s in deduped]
        blocks = self._blocks or [{"text": draft_text, "source_ids": []}]

        # v3 — a BLOCK-LEVEL provenance map: each block → its exact sources (the click-any-line
        # → source gate). Replaces the coarse claim map.
        spanmap_ref: str | None = None
        if any(b.get("source_ids") for b in blocks):
            spanmap_ref = new_artifact_id()
            spans = [
                {
                    "block": i,
                    "source_ids": b.get("source_ids", []),
                    "source_refs": [
                        sources[j - 1].get("url", "")
                        for j in b.get("source_ids", [])
                        if 1 <= j <= len(sources)
                    ],
                }
                for i, b in enumerate(blocks)
            ]
            await self._repo.save_artifact(
                spanmap_ref, self._hunt_id, "provenance_map", "howler", {"spans": spans}
            )

        await self._repo.save_artifact(
            artifact_id,
            self._hunt_id,
            "final",
            "howler",
            {
                "text": draft_text,
                "blocks": blocks,  # v3: tagged blocks for click-any-line → source
                "claims": merged.claims,
                "sources": sources,
                "span_map_ref": spanmap_ref,
                "no_sources": self._no_sources or not sources,  # honest empty state
            },
        )
        await self._emit(
            "artifact_created",
            "howler",
            {
                "artifact_id": artifact_id,
                "kind": "final",
                "produced_by": "howler",
                "provenance_span_map_ref": spanmap_ref,
            },
        )

        # v3 — the Forge: render the brief into real files (the "making the file" phase). Skipped when
        # there's no real brief (no sources). Best-effort: a render failure never blocks completion.
        if blocks and not (self._no_sources or not sources):
            await self.progress("howler", "forge", "Making your files")
            await self._emit("forge_started", "howler", {"formats": list(MIME)})
            forged_ids: list[str] = []
            for fmt, data in forge(blocks, sources).items():  # v-fix: exports carry their Sources
                fid = new_artifact_id()
                mime = MIME.get(fmt, "application/octet-stream")
                # Offload the bytes to the artifact store (Alibaba OSS in prod, disk offline).
                content = await store_forged_content(f"{fid}.{fmt}", data, mime)
                await self._repo.save_artifact(fid, self._hunt_id, fmt, "howler", content)
                await self._emit(
                    "artifact_created",
                    "howler",
                    {"artifact_id": fid, "kind": fmt, "produced_by": "howler"},
                )
                forged_ids.append(fid)
            await self._emit(
                "forge_completed", "howler", {"formats": list(MIME), "artifact_ids": forged_ids}
            )

        # REAL measured runtime (wall clock), not the plan's est_time guess: monotonic elapsed since
        # the pack started working. Falls back to 0 only if the anchor was never set (defensive — the
        # hunt cannot complete without having gone through _approve/resume, which set it).
        elapsed_s = (
            time.monotonic() - self._run_started_monotonic
            if self._run_started_monotonic is not None
            else 0.0
        )
        totals = {
            "cost_usd": round(self._boundary.cumulative_usd, 6),
            "time_s": round(max(0.0, elapsed_s), 1),
            "sources": len(sources),
            "wolves": len(self._wolves),
        }
        # Alpha closes out — its node settles to done (green) instead of glowing forever.
        await self._emit(
            "step_completed",
            "alpha",
            {
                "step_id": "s0-lead",
                "wolf_id": "alpha",
                "output_ref": artifact_id,
                "confidence": 0.95,
            },
        )
        self._lead_closed = True
        # The Elder distills ONE durable, typed lesson for next time. This is a real Elder model call
        # (its prompt drives the lesson), run UNGATED — like recall, it sits outside the hunt Boundary
        # so the pack always learns something, even on a hunt that spent its budget. Best-effort: any
        # failure (offline quirk, empty parse, model error) degrades to a deterministic template so a
        # broken memory step can never sink a completed hunt.
        await self._distill_and_remember(merged, len(sources))
        await self._emit(
            "hunt_completed", "engine", {"final_artifact_id": artifact_id, "totals": totals}
        )
        await self._repo.set_hunt_state(self._hunt_id, "returned")

    async def _distill_and_remember(self, merged: Merged, source_count: int) -> None:
        """The Elder's end-of-hunt memory write: a real (ungated, best-effort) model call that distills
        ONE typed lesson, persisted for the next hunt. The Elder's node lights up a second time here so
        the memory bank has visible presence at BOTH ends of the hunt (recall at the start, this now).

        Never raises: a distill failure falls back to the legacy deterministic template so the lesson
        is always written and a completed hunt is never sunk by the memory step."""
        strategy = self._plan.get("strategy", "orchestrate")
        scout_n = sum(1 for w in self._wolves.values() if w.role == "scout")
        # Deterministic fallback — the old templated takeaway, kept as the safety net.
        got = 0 if self._no_sources else source_count
        outcome = f"{got} sources" if got else "no sourced ground"
        fallback = f"Topic '{self.task}': {strategy} strategy, {scout_n} scouts, {outcome}."

        kind, lesson = "takeaway", fallback
        try:
            elder = self._make_wolf("elder", "elder", "flash", False)
            res = await elder.think(
                "distill",
                messages=self._messages(
                    elder, "distill", context=self._distill_context(merged, source_count)
                ),
                response_schema=DISTILL_SCHEMA,
            )
            parsed = res.parsed or {}
            got_lesson = str(parsed.get("lesson") or "").strip()
            if got_lesson:  # only adopt the model's lesson when it actually returned one
                kind = normalize_kind(parsed.get("kind"))
                lesson = got_lesson
        except Exception as exc:  # noqa: BLE001 — memory is best-effort; never sink a completed hunt
            logging.getLogger("pack").info("elder distill fell back to template: %s", exc)

        # Light the Elder's node: it consulted memory at the start; here it records the lesson.
        await self._emit(
            "step_started",
            "elder",
            {"step_id": "s9-elder", "wolf_id": "elder", "summary": "Noted a lesson for next time."},
        )
        await remember(self._repo, self._hunt_id, lesson, kind)
        await self._emit(
            "step_completed",
            "elder",
            {
                "step_id": "s9-elder",
                "wolf_id": "elder",
                "output_ref": f"art_{self._hunt_id}_lesson",
                "confidence": 0.9,
            },
        )

    # --- dispatch (the gate) + tools ---------------------------------------------------

    async def _dispatch(
        self,
        wolf: Wolf,
        intent: str,
        context: str = "",
        *,
        phase: str | None = None,
        response_schema: dict | None = None,
        instruction_override: str | None = None,
    ) -> CompletionResult:
        """The one path a model call takes. Per-wolf cap + hunt Boundary gate BEFORE, account AFTER.

        Check-and-reserve are atomic under _dispatch_lock so parallel scouts (asyncio.gather in
        strategies) cannot all clear the gate against the same stale cumulative_usd. wolf.think()
        runs OUTSIDE the lock so scouts genuinely execute in parallel. Reconcile to actual spend
        under the lock after think() returns. Halt/resume loop replaces the old recursion.
        """
        # A wolf already relieved (it blew its own cap at the floor tier) makes no further calls.
        if wolf.wolf_id in self._relieved:
            return self._relieved_result(wolf)

        while True:
            # Check + reserve atomically so parallel scouts can't clear the gate against a stale
            # cumulative_usd. The DECISION is a pure, unit-tested function (app/engine/dispatch_gate);
            # the Supervisor performs the I/O (emits, halt/resume) after the lock is released.
            async with self._dispatch_lock:
                decision = decide_and_reserve(
                    wolf,
                    self._boundary,
                    self._wolf_budget,
                    self._wolf_spend,
                    self._relieved,
                    self._warned,
                )
                if decision.warn is not None:
                    self._warned = True
            est = decision.est
            _cap_downgrade = decision.cap_downgrade
            _do_relieve = decision.relieve
            _do_halt = decision.halt
            _boundary_downgrade = decision.boundary_downgrade
            _warn_info = decision.warn
            # Lock released — all I/O happens below.

            if _cap_downgrade:
                from_tier, thinking_off = _cap_downgrade
                await self._emit(
                    "boundary_downgrade",
                    "engine",
                    {
                        "wolf_id": wolf.wolf_id,
                        "from_tier": from_tier,
                        "to_tier": "flash",
                        "thinking_off": thinking_off,
                    },
                )

            if _do_relieve:
                await self.progress(
                    wolf.wolf_id, phase or "thinking", "Hit its budget — standing down."
                )
                return self._relieved_result(wolf)

            if _do_halt:
                # Halt is a PAUSE: checkpoint, surface the choice, wait for human to raise the
                # Boundary (resume) or stop. On resume, loop back and re-check the gate.
                await self._halt()
                await self._await_resume()
                continue

            if _boundary_downgrade:
                from_tier, thinking_off = _boundary_downgrade
                await self._emit(
                    "boundary_downgrade",
                    "engine",
                    {
                        "wolf_id": wolf.wolf_id,
                        "from_tier": from_tier,
                        "to_tier": "flash",
                        "thinking_off": thinking_off,
                    },
                )

            if _warn_info:
                await self._emit("boundary_warning", "engine", _warn_info)

            on_delta = (
                self._progress_sink(wolf.wolf_id, phase) if (phase and wolf.thinking) else None
            )
            try:
                result = await wolf.think(
                    intent,
                    messages=self._messages(wolf, intent, context, instruction_override),
                    response_schema=response_schema,
                    on_delta=on_delta,
                )
            except Exception as exc:  # noqa: BLE001 — breaker/oversize/provider/parse/any model error
                # ANY failed model call (not just breaker/oversize) is refunded and routed down this
                # wolf's Stray path instead of crashing the whole hunt. This is what keeps a bigger
                # formation from failing: when one wolf's call errors (e.g. tracker/sentinel/howler on
                # a large findings context), the pack degrades gracefully and still brings a brief home.
                # (CancelledError is a BaseException — not caught here — so cancellation still propagates.)
                async with self._dispatch_lock:
                    self._boundary.cumulative_usd -= est
                    self._wolf_spend[wolf.wolf_id] = self._wolf_spend.get(wolf.wolf_id, 0.0) - est
                if isinstance(exc, CircuitOpenError):
                    pattern = "provider_error"
                elif isinstance(exc, ValueError):
                    pattern = "size_exceeded"
                else:
                    pattern = "provider_error"
                    logging.getLogger("pack").warning(
                        "dispatch for %s errored: %r", wolf.wolf_id, exc
                    )
                await self._stray_event(wolf.wolf_id, pattern, evidence_ref=None)
                return self._faulted_result(wolf)

            # RECONCILE: correct reserved estimate to actual spend.
            async with self._dispatch_lock:
                delta = result.cost_usd - est
                self._boundary.cumulative_usd += delta
                self._wolf_spend[wolf.wolf_id] = self._wolf_spend.get(wolf.wolf_id, 0.0) + delta

            await self._emit(
                "tokens_spent",
                wolf.wolf_id,
                {
                    "wolf_id": wolf.wolf_id,
                    "model": result.model,
                    "in_tokens": result.in_tokens,
                    "out_tokens": result.out_tokens,
                    "cost_usd": round(result.cost_usd, 6),
                    "cumulative_usd": round(self._boundary.cumulative_usd, 6),
                    "retry_count": result.retry_count,
                },
            )
            return result

    def _relieved_result(self, wolf: Wolf) -> CompletionResult:
        """An empty result for a wolf relieved at its budget cap — no spend, no model call. Callers
        fall back to their defaults, so a relieved wolf simply contributes nothing further."""
        return CompletionResult(
            text="",
            model="(relieved)",
            tier=wolf.tier,
            in_tokens=0,
            out_tokens=0,
            cost_usd=0.0,
            parsed=None,
        )

    def _faulted_result(self, wolf: Wolf) -> CompletionResult:
        """An empty result after the client rejected a call outright (breaker open / oversized
        request) — no spend, no model call. Same shape as `_relieved_result`; callers already
        treat an empty/low-confidence result as "this wolf came back with nothing"."""
        return CompletionResult(
            text="",
            model="(faulted)",
            tier=wolf.tier,
            in_tokens=0,
            out_tokens=0,
            cost_usd=0.0,
            parsed=None,
        )

    async def _one_search(
        self, wolf: Wolf, query: str
    ) -> tuple[list[dict], bool, str | None, str | None]:
        """One real web_search: emit tool events, account for it, persist hits. No fetch here."""
        await self._emit(
            "tool_called",
            wolf.wolf_id,
            {"wolf_id": wolf.wolf_id, "tool": "web_search", "args_summary": query},
        )
        res = await WEB_SEARCH.run(wolf_id=wolf.wolf_id, query=query)
        self._search_attempts += 1
        if res.ok:
            self._search_ok += 1
        stray = self._stray.record_tool_result(wolf.wolf_id, res.ok)
        hits = (res.data or {}).get("hits", []) if isinstance(res.data, dict) else []
        ref: str | None = None
        if hits:
            ref = new_artifact_id()
            await self._repo.save_artifact(
                ref, self._hunt_id, "search", wolf.wolf_id, {"query": query, "hits": hits}
            )
            self._sources.extend(hits)
        await self._emit(
            "tool_result",
            wolf.wolf_id,
            {
                "wolf_id": wolf.wolf_id,
                "tool": "web_search",
                "ok": res.ok,
                "result_ref": ref,
                "latency_ms": res.latency_ms,
                "hits": len(hits),  # additive: lets the canvas show a per-wolf source count
            },
        )
        return hits, res.ok, ref, stray

    async def _scout_search(
        self, wolf: Wolf, query: str
    ) -> tuple[list[dict], bool, str | None, str | None]:
        """Run the real web_search, deep-read the top hit (web_fetch), persist the hits, emit the
        tool events. Returns (hits, ok, artifact_ref, stray_pattern-or-None).

        If the scout's own angle comes back DRY, walk a bounded 3-step ladder (broaden, then a real
        facet angle) before giving up — this keeps every scout productive instead of the pack
        collapsing onto one, and exhausting it cleanly hands an empty result to the honest-empty guard.
        """
        hits, ok, ref, stray = await self._one_search(wolf, query)
        # Bounded fallback ladder (deterministic, capped): each rung fires only if every prior rung
        # returned nothing, and only if it differs from what we've already tried. This scout's OWN
        # index picks a distinct facet so parallel scouts fan to different angles.
        tried = {plain_query(query).lower()}
        m = re.search(r"(\d+)$", wolf.wolf_id)
        scout_idx = int(m.group(1)) - 1 if m else 0
        ladder = [broaden(self.task, query), facet_query(self.task, scout_idx)]
        for rung in ladder:
            if hits:
                break
            if not rung or rung.lower() in tried:
                continue
            tried.add(rung.lower())
            await self.progress(wolf.wolf_id, "searching", f"Broadening: {rung}")
            hits, ok2, ref2, stray2 = await self._one_search(wolf, rung)
            ok = ok or ok2
            ref = ref2 or ref
            stray = stray2 or stray

        # A4 — deep-read the top FEW hits (in parallel) so findings rest on full pages, not just the
        # #1 snippet. Reading only one hit left most sources unverified and made briefs thin.
        to_read = [h for h in hits[: settings.scout_deep_reads] if h.get("url")]
        if to_read:
            for h in to_read:
                await self._emit(
                    "tool_called",
                    wolf.wolf_id,
                    {"wolf_id": wolf.wolf_id, "tool": "web_fetch", "args_summary": str(h["url"])},
                )
            fetched = await asyncio.gather(
                *(WEB_FETCH.run(wolf_id=wolf.wolf_id, url=str(h["url"])) for h in to_read)
            )
            for h, fres in zip(to_read, fetched, strict=False):
                stray = stray or self._stray.record_tool_result(wolf.wolf_id, fres.ok)
                text = (fres.data or {}).get("text", "") if isinstance(fres.data, dict) else ""
                if (
                    text
                ):  # in-place so the persisted source (self._sources holds the same dict) gets it
                    h["text"] = text[: settings.web_fetch_max_chars]
                await self._emit(
                    "tool_result",
                    wolf.wolf_id,
                    {
                        "wolf_id": wolf.wolf_id,
                        "tool": "web_fetch",
                        "ok": fres.ok,
                        "result_ref": None,
                        "latency_ms": fres.latency_ms,
                        "hits": 1 if text else 0,
                    },
                )

        # Provenance tags (B3): which scout brought it back, whether we actually read the page, and
        # whether it came from the offline CannedProvider (so it's never cited in a live brief).
        for h in hits:
            h["by"] = wolf.wolf_id
            h["verified"] = bool(h.get("text"))
            h["canned"] = h.get("provider") == "canned"
        return hits, ok, ref, stray

    def _progress_sink(self, wolf_id: str, phase: str) -> OnDelta:
        """Coalesce streamed text into a few sentence-bounded `wolf_progress` beats (never one
        per token), so a thinking wolf's evolving thought lands on its node without flooding
        the log. Deterministic: no clock — it throttles on sentence boundaries and length."""
        acc = ""
        mark = 0
        beats = 0

        async def on_delta(delta: str) -> None:
            nonlocal acc, mark, beats
            acc += delta
            pending = acc[mark:]
            sentence_end = pending.endswith((".", "!", "?", "\n")) and len(pending.strip()) >= 40
            overflow = len(pending) >= 160
            if (sentence_end or overflow) and beats < 8:
                mark = len(acc)
                beats += 1
                await self.progress(wolf_id, phase, pending.strip())

        return on_delta

    async def _await_resume(self) -> None:
        """Block at a Boundary halt until the human raises the Boundary (resume) or stops."""
        await self._repo.set_hunt_state(self._hunt_id, "halted_boundary")
        while True:
            cmd = await self._commands.get()
            ctype = cmd.get("type")
            if ctype == "stop":
                raise StopHunt()
            if ctype == "resume":
                raised = float(cmd.get("boundary_usd", self._boundary.boundary_usd * 2))
                self._boundary.boundary_usd = max(raised, self._boundary.boundary_usd)
                self._warned = False  # let a fresh warning fire against the new ceiling
                await self._repo.set_boundary(self._hunt_id, self._boundary.boundary_usd)
                await self._repo.set_hunt_state(self._hunt_id, "hunting")
                return
            # Re-queue anything else (e.g. add_input) so it isn't lost while paused.
            self._commands.put_nowait(cmd)

    async def _halt(self) -> None:
        ckpt = new_checkpoint_id()
        await self._repo.save_checkpoint(
            ckpt,
            self._hunt_id,
            self._emitter.last_seq,
            {"cumulative_usd": self._boundary.cumulative_usd},
        )
        await self._emit(
            "boundary_halt",
            "engine",
            {
                "checkpoint_id": ckpt,
                "spend_breakdown": {"cumulative_usd": round(self._boundary.cumulative_usd, 6)},
                "resume_options": ["raise_boundary", "stop"],
            },
        )

    async def _stray_event(self, wolf_id: str, pattern: str, evidence_ref: str | None) -> None:
        """Narrate a Stray and the Doctor's recovery (delegated to the Healer collaborator)."""
        await self._healer.stray_event(wolf_id, pattern, evidence_ref)

    # --- prompt + context builders -----------------------------------------------------

    # Prompt/context assembly delegates to app/engine/prompt_context.py (pure builders); these thin
    # wrappers pass the hunt's state in, keeping the Engine-primitive call sites unchanged.
    def _messages(
        self, wolf: Wolf, intent: str, context: str, instruction_override: str | None = None
    ) -> list[dict]:
        return prompt_context.messages(
            wolf, self._raw_input, self._wolf_notes, intent, context, instruction_override
        )

    def _hits_context(self, query: str, hits: list[dict]) -> str:
        return prompt_context.hits_context(query, hits)

    def _findings_context(self, findings: list[Finding], sources_registry: str = "") -> str:
        return prompt_context.findings_context(
            findings, self._memory_note, self._extra_inputs, self.depth, sources_registry
        )

    def _merged_context(self, merged: Merged, *, sources: list[dict] | None = None) -> str:
        return prompt_context.merged_context(merged, sources=sources)

    def _draft_context(self, merged: Merged, decision: str | None) -> str:
        return prompt_context.draft_context(
            merged, decision, self._kb_picks, self._extra_inputs, self.depth
        )

    def _distill_context(self, merged: Merged, source_count: int) -> str:
        strategy = self._plan.get("strategy", "orchestrate")
        scout_n = sum(1 for w in self._wolves.values() if w.role == "scout")
        # The brief title is the first block when it's a heading (see _blocks_from's `# {title}`).
        title = ""
        if self._blocks and self._blocks[0].get("text", "").startswith("# "):
            title = self._blocks[0]["text"][2:].strip()
        return prompt_context.distill_context(
            strategy, scout_n, source_count, title, list(merged.claims), self._no_sources
        )

    def _conflict_from(self, obj: object) -> Conflict | None:
        return prompt_context.conflict_from(obj)

    def _dedupe_sources(self, sources: list[dict]) -> list[dict]:
        return prompt_context.dedupe_sources(sources)

    def _blocks_from_sources(self, merged: Merged) -> list[dict]:
        """An honest, cited source-list brief for when the merge produced no claims but we DID gather
        sources — numbered identically to `finish`'s span map. When the merge stalled/faulted,
        `stalled_findings` carries each scout's real read summary (not a bare snippet) — use that; a
        source-only fallback (no timeout, just an empty-claims merge) falls back to the raw snippets."""
        blocks: list[dict] = [
            {
                "text": f"# {self.task}: sources gathered (the merge was incomplete)",
                "source_ids": [],
            }
        ]
        if merged.stalled_findings:
            for summary, source_ids in merged.stalled_findings:
                blocks.append({"text": summary, "source_ids": source_ids})
            return blocks
        sources = self._dedupe_sources(merged.sources)
        for i, s in enumerate(sources):
            title = s.get("title") or s.get("url") or "source"
            snippet = (s.get("snippet") or "").strip()
            text = f"{title} — {snippet}" if snippet else str(title)
            blocks.append({"text": text, "source_ids": [i + 1]})
        return blocks

    # --- helpers -----------------------------------------------------------------------

    def _make_wolf(self, wolf_id: str, role: str, tier: str, thinking: bool) -> Wolf:
        return Wolf(
            hunt_id=self._hunt_id,
            wolf_id=wolf_id,
            role=role,
            tier=tier,
            thinking=thinking,
            prompt_version=load_prompt(role).version,
            client=self._client,
        )

    async def _emit(self, type: str, actor: str, payload: dict) -> None:
        await self._emitter.emit(type, actor, payload)  # type: ignore[arg-type]

    async def _await_command(self, expected: str) -> dict:
        """Block until the expected command arrives. `stop` ends the hunt from any await."""
        while True:
            cmd = await self._commands.get()
            ctype = cmd.get("type")
            if ctype == "stop":
                raise StopHunt()
            if ctype == expected:
                return cmd
            # Unexpected command for this phase (e.g. a mid-plan input) — ignore for now (NEXT).
