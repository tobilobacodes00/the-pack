"""Iterative deep-research — search, read, find the gaps, search again.

Scouts range on the first angles, Tracker merges, then Tracker names what's still missing and
the pack ranges a second time on those gaps before the final synthesis. Best when the topic
rewards depth over breadth.
"""

from __future__ import annotations

import asyncio

from app.engine.strategies.base import Engine, Strategy, drop_empty, keep_findings


class DeepDiveStrategy(Strategy):
    name = "deep_dive"
    pattern = "parallel_then_merge"
    label = "Iterative deep-research"

    async def execute(self, engine: Engine) -> None:
        ids = engine.scout_ids()
        queries = engine.queries()

        # First round: the scouts range in parallel.
        results = await asyncio.gather(
            *(engine.scout(w, q) for w, q in zip(ids, queries, strict=False))
        )
        findings = drop_empty(results)

        merged = await engine.merge(keep_findings(findings))

        # The iterative core: name the gaps, then range again (in parallel) to close them.
        gaps = await engine.find_gaps(merged)
        if gaps and ids:
            await engine.progress(
                "alpha", "thinking", f"Found {len(gaps)} gaps — sending the pack back in."
            )
            # find_gaps already caps the count by depth — range on all of them.
            extra = await asyncio.gather(
                *(engine.scout(ids[i % len(ids)], gap, step_id="s1b") for i, gap in enumerate(gaps))
            )
            findings.extend(drop_empty(extra))
            merged = await engine.merge(keep_findings(findings), step_id="s2b")

        # Sentinel verifies every claim carries a real source before we draft, and the verdict is
        # ENFORCED — apply_critique drops any claim Sentinel couldn't stand up.
        verdict = await engine.critique(merged)
        merged = await engine.apply_critique(merged, verdict)

        decision = None
        if merged.conflict:
            decision = await engine.resolve_conflict(merged.conflict, merged.sources)

        draft = await engine.draft(merged, decision)
        await engine.finish(draft, merged)
