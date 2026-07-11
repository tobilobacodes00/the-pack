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
    wolf_ids,
)
from app.engine.search_query import broaden, plain_query
from app.engine.strategies import Conflict, CritiqueResult, Finding, Merged, get_strategy
from app.engine.strategies.base import (
    CRITIQUE_SCHEMA,
    DRAFT_SCHEMA,
    FINDINGS_SCHEMA,
    GAPS_SCHEMA,
    MERGE_SCHEMA,
    PLAN_SCHEMA,
)
from app.engine.stray import StrayDetector
from app.engine.wolves import Wolf
from app.prompts import load_prompt
from app.qwen.client import CircuitOpenError, OnDelta, QwenClient
from app.qwen.types import CompletionResult
from app.storage import store_forged_content
from app.tools.knowledge import select_relevant
from app.tools.memory import recall, remember
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
                await self._emit("hunt_stopped", "user", {"by": "user"})
                await self._repo.set_hunt_state(self._hunt_id, "stopped_by_user")
        except BoundaryHalt:
            await self._repo.set_hunt_state(self._hunt_id, "halted_boundary")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - a hunt must fail as an event, not a crash
            logging.getLogger("pack").exception("hunt %s failed", self._hunt_id)  # keep the trace
            with contextlib.suppress(Exception):
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
            await self._repo.set_hunt_state(self._hunt_id, "hunting")
            await self._spawn_roster()
            await self._open_pack()
            await self._strategy.execute(self)
        except StopHunt:
            with contextlib.suppress(Exception):
                await self._emit("hunt_stopped", "user", {"by": "user"})
                await self._repo.set_hunt_state(self._hunt_id, "stopped_by_user")
        except BoundaryHalt:
            await self._repo.set_hunt_state(self._hunt_id, "halted_boundary")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - resume must fail as an event, not a crash
            logging.getLogger("pack").exception("resume of hunt %s failed", self._hunt_id)
            with contextlib.suppress(Exception):
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
        # Restore the user's per-wolf notes from the last plan_edited so a resumed hunt keeps them.
        edit_ev = next((e for e in reversed(events) if e.type == "plan_edited"), None)
        if edit_ev is not None:
            notes = (edit_ev.payload.get("diff") or {}).get("notes")
            if isinstance(notes, dict):
                self._wolf_notes = {str(k): str(v) for k, v in notes.items()}
        if appr_ev is not None:
            self._mode = str(appr_ev.payload.get("mode") or "on_signal")
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
        with contextlib.suppress(Exception):
            res = await beta.think(
                "plan",
                messages=self._messages(beta, "plan", context=context),
                response_schema=PLAN_SCHEMA,
                on_delta=self._progress_sink("beta", "thinking"),
            )
            parsed = res.parsed or {}
        self._plan = self._normalize_plan(parsed)
        self._queries = list(self._plan["queries"])
        await self._emit("plan_proposed", "beta", self._plan)
        await self._repo.set_hunt_state(self._hunt_id, "plan_ready")

    def _scout_count(self) -> int:
        """How many scouts the team carries (pre-spawn — reads the spec, not live wolves)."""
        n = next((int(e.get("count") or 0) for e in self._team if e.get("role") == "scout"), 0)
        return n or DEFAULT_SCOUTS

    def _normalize_plan(self, parsed: dict) -> dict:
        """Coerce the model's plan into a schema-valid plan_proposed payload: build the per-task
        TEAM, then derive the scout angles/steps/worker-roster from it (additive canvas fields)."""
        task = self._raw_input or "the topic"
        # v5.1: a saved Instinct's formation seeds the team (overrides Beta's sizing); else Beta's.
        self._team = build_team({"team": self._seed_team} if self._seed_team else parsed)
        scout_ids = wolf_ids("scout", self._scout_count())
        n = len(scout_ids)
        queries = [str(q).strip() for q in (parsed.get("queries") or []) if str(q).strip()][:n]
        while len(queries) < n:
            queries.append(f"{task} — angle {len(queries) + 1}")
        assumptions = [str(a).strip() for a in (parsed.get("assumptions") or []) if str(a).strip()]
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
            "wolves": [*scout_ids, "tracker", "sentinel", "howler", "elder"],
            "pattern": self._strategy.pattern,
            "assumptions": assumptions or [f"scope: {task}", "recent sources", "briefing format"],
            "est_cost": float(parsed.get("est_cost") or 0.6),
            "est_time": int(parsed.get("est_time") or 210),
            # additive (schema allows extra fields): the canvas + Door + Edit Panel read these.
            "queries": queries,
            "strategy": self._strategy.name,
            "team": self._team,
        }

    async def _approve(self, cmd: dict) -> None:
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
            {"mode": self._mode, "boundary_usd": effective},
        )
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
            self._plan["wolves"] = [*scouts, "tracker", "sentinel", "howler", "elder"]
            diff["team"] = self._team
        raw_queries = edits.get("queries")
        if isinstance(raw_queries, list):
            n = self._scout_count()
            qs = [str(q).strip() for q in raw_queries if str(q).strip()][:n]
            if qs:
                while len(qs) < n:
                    qs.append(f"{self.task} — angle {len(qs) + 1}")
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
        for wolf_id, role, tier, thinking, budget in roster:
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

    # --- Engine surface (the primitives strategies orchestrate) ------------------------

    @property
    def task(self) -> str:
        return self._raw_input or "the topic"

    @property
    def plan(self) -> dict:
        return self._plan

    def scout_ids(self) -> list[str]:
        # Live scouts in spawn order — N is whatever Alpha built / the user edited, not a fixed 3.
        return [wid for wid, w in self._wolves.items() if w.role == "scout"]

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
        confidence = float(parsed.get("confidence", 0.8 if ok else 0.3) or 0.0)

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
        tracker = self._wolves["tracker"]
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

        try:
            res = await asyncio.wait_for(
                self._dispatch(
                    tracker,
                    "merge",
                    context=self._findings_context(findings),
                    phase="merging",
                    response_schema=MERGE_SCHEMA,
                ),
                timeout=self._step_timeout,
            )
        except TimeoutError:
            await self._stray_event("tracker", "timeout", None)
            out_ref = new_artifact_id()
            sources = [s for f in findings for s in f.sources]
            sources.extend(await self._absorb_knowledge())
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
                summary="(tracker stalled — using scout summaries)",
                claims=[],
                conflict=None,
                output_ref=out_ref,
                sources=sources,
            )
        parsed = res.parsed or {}
        summary = str(parsed.get("summary") or res.text or "Merged the findings.")
        claims = [str(c).strip() for c in (parsed.get("claims") or []) if str(c).strip()]
        conflict = self._conflict_from(parsed.get("conflict"))
        out_ref = new_artifact_id()
        await self._repo.save_artifact(
            out_ref, self._hunt_id, "draft", "tracker", {"summary": summary, "claims": claims}
        )
        await self._emit(
            "step_completed",
            "tracker",
            {"step_id": step_id, "wolf_id": "tracker", "output_ref": out_ref, "confidence": 0.9},
        )
        sources = [s for f in findings for s in f.sources]
        sources.extend(await self._absorb_knowledge())  # v4.2: weave in your library docs
        return Merged(
            summary=summary, claims=claims, conflict=conflict, output_ref=out_ref, sources=sources
        )

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
        self._kb_picks = select_relevant(docs, self.task)
        return list(self._kb_picks)

    async def resolve_conflict(self, conflict: Conflict) -> str:
        """Open a Hold for the human and block until they decide — unless the Packmaster set the
        leash to On Wild, in which case Alpha takes his own recommended call and keeps running."""
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
            resolution = conflict.recommended
            await self._emit(
                "hold_resolved",
                "alpha",
                {"hold_id": hold_id, "resolution": resolution, "auto": True},
            )
            return resolution
        await self._repo.set_hunt_state(self._hunt_id, "holding")
        cmd = await self._await_command("resolve_hold")
        resolution = str(cmd.get("resolution") or conflict.recommended)
        await self._emit(
            "hold_resolved",
            "user",
            {"hold_id": hold_id, "resolution": resolution, "edited_text": cmd.get("edited_text")},
        )
        await self._repo.set_hunt_state(self._hunt_id, "hunting")
        return resolution

    async def find_gaps(self, merged: Merged) -> list[str]:
        """Tracker names what's still missing — the queries for a second deep-dive round."""
        tracker = self._wolves["tracker"]
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
        return [str(g).strip() for g in (parsed.get("gaps") or []) if str(g).strip()][:2]

    async def critique(self, merged: Merged) -> CritiqueResult:
        """Sentinel checks every claim carries a real source."""
        sentinel = self._wolves["sentinel"]
        await self._emit(
            "step_started",
            "sentinel",
            {"step_id": "s-critique", "wolf_id": "sentinel", "summary": "Verifying the claims"},
        )
        await self.progress("sentinel", "critiquing", "Checking every claim carries a source")
        try:
            res = await asyncio.wait_for(
                self._dispatch(
                    sentinel,
                    "critique",
                    context=self._merged_context(merged),
                    phase="critiquing",
                    response_schema=CRITIQUE_SCHEMA,
                ),
                timeout=self._step_timeout,
            )
        except TimeoutError:
            await self._stray_event("sentinel", "timeout", None)
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
            return CritiqueResult(ok=True, issues=[])
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

    async def standoff(
        self, challenger: str, defendant: str, claim_ref: str, rationale: str
    ) -> None:
        """A real, bounded debate over a weak claim: the challenger presses it, the defendant
        answers, Alpha adjudicates — each a model call, each boundary-gated."""
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

        # Turn 1 — the challenger states why the claim doesn't yet stand.
        chal_text = rationale
        chal_wolf = self._wolves.get(challenger)
        if chal_wolf is not None:
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        chal_wolf,
                        "standoff_challenge",
                        context=f"The claim under challenge: {rationale}",
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

        # Turn 2 — the defendant answers.
        def_text = "Fair — I'll back it with a second source."
        def_wolf = self._wolves.get(defendant)
        if def_wolf is not None:
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        def_wolf,
                        "standoff_defend",
                        context=f"The challenge to answer: {chal_text}",
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

        # Alpha adjudicates.
        rationale_out = "Keep the claim only once a second source backs it."
        alpha = self._wolves.get("alpha")
        if alpha is not None:
            try:
                res = await asyncio.wait_for(
                    self._dispatch(
                        alpha,
                        "standoff_judge",
                        context=f"Challenge: {chal_text}\nDefense: {def_text}",
                        phase="thinking",
                    ),
                    timeout=self._step_timeout,
                )
                rationale_out = res.text or rationale_out
            except TimeoutError:
                pass  # rationale_out stays as fallback
        await self._emit(
            "standoff_resolved",
            "alpha",
            {"standoff_id": sid, "outcome": "alpha_call", "rationale": rationale_out[:200]},
        )
        await self._repo.set_hunt_state(self._hunt_id, "hunting")

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
        if self._mode == "on_command":
            await self._confirm_draft()
        howler = self._wolves["howler"]
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
        try:
            res = await asyncio.wait_for(
                self._dispatch(
                    howler,
                    "draft",
                    context=self._draft_context(merged, decision),
                    phase="writing",
                    response_schema=DRAFT_SCHEMA,
                ),
                timeout=self._step_timeout,
            )
        except TimeoutError:
            await self._stray_event("howler", "timeout", None)
            self._blocks = [{"text": merged.summary, "source_ids": []}]
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
        self._blocks = self._blocks_from(res, self._dedupe_sources(merged.sources))
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

    def _blocks_from(self, res: CompletionResult, sources: list[dict]) -> list[dict]:
        """Normalize Howler's tagged output into [{text, source_ids}] blocks. Falls back to wrapping
        free text as one block (all sources) if the model didn't return structured blocks."""
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
            ids = [
                int(i)
                for i in (b.get("source_ids") or [])
                if isinstance(i, int | float) and 1 <= int(i) <= len(sources)
            ]
            out.append({"text": text, "source_ids": sorted(set(ids))})
        if not any(b["text"] and not b["text"].startswith("# ") for b in out):
            # No real body blocks — wrap whatever free text came back, crediting all sources.
            out.append(
                {"text": (res.text or "").strip(), "source_ids": list(range(1, len(sources) + 1))}
            )
        return out

    async def finish(self, draft_text: str, merged: Merged) -> None:
        """Save the final artifact + a provenance span map, then close the hunt."""
        artifact_id = new_artifact_id()
        # Drop the full fetched/library `text` before persisting — the UI shows snippet, not text,
        # and keeping it bloats the artifact (web fetch ≤1500, KB ≤1200 chars per source).
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

        totals = {
            "cost_usd": round(self._boundary.cumulative_usd, 6),
            "time_s": int(self._plan.get("est_time", 210)),
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
        # The Elder records one durable takeaway for next time (best-effort, local-only).
        strategy = self._plan.get("strategy", "orchestrate")
        scout_n = sum(1 for w in self._wolves.values() if w.role == "scout")
        got = 0 if self._no_sources else len(sources)
        outcome = f"{got} sources" if got else "no sourced ground"
        takeaway = f"Topic '{self.task}': {strategy} strategy, {scout_n} scouts, {outcome}."
        await remember(self._repo, self._hunt_id, takeaway)
        await self._emit(
            "hunt_completed", "engine", {"final_artifact_id": artifact_id, "totals": totals}
        )
        await self._repo.set_hunt_state(self._hunt_id, "returned")

    # --- dispatch (the gate) + tools ---------------------------------------------------

    async def _dispatch(
        self,
        wolf: Wolf,
        intent: str,
        context: str = "",
        *,
        phase: str | None = None,
        response_schema: dict | None = None,
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
                    messages=self._messages(wolf, intent, context),
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

        If the scout's own angle comes back DRY, broaden ONCE and range again before giving up —
        this is what keeps every scout productive instead of the pack collapsing onto one."""
        hits, ok, ref, stray = await self._one_search(wolf, query)
        if not hits:
            broad = broaden(self.task, query)
            if broad and broad.lower() != plain_query(query).lower():
                await self.progress(wolf.wolf_id, "searching", f"Broadening: {broad}")
                hits, ok2, ref2, stray2 = await self._one_search(wolf, broad)
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

        # Provenance tags (B3): which scout brought it back, and whether we actually read the page.
        for h in hits:
            h["by"] = wolf.wolf_id
            h["verified"] = bool(h.get("text"))
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
    def _messages(self, wolf: Wolf, intent: str, context: str) -> list[dict]:
        return prompt_context.messages(wolf, self._raw_input, self._wolf_notes, intent, context)

    def _hits_context(self, query: str, hits: list[dict]) -> str:
        return prompt_context.hits_context(query, hits)

    def _findings_context(self, findings: list[Finding]) -> str:
        return prompt_context.findings_context(findings, self._memory_note, self._extra_inputs)

    def _merged_context(self, merged: Merged) -> str:
        return prompt_context.merged_context(merged)

    def _draft_context(self, merged: Merged, decision: str | None) -> str:
        return prompt_context.draft_context(merged, decision, self._kb_picks, self._extra_inputs)

    def _conflict_from(self, obj: object) -> Conflict | None:
        return prompt_context.conflict_from(obj)

    def _dedupe_sources(self, sources: list[dict]) -> list[dict]:
        return prompt_context.dedupe_sources(sources)

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
