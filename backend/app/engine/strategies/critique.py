"""Plan-execute-critique — Sentinel keeps the pack honest.

Scouts range, Tracker merges, then Sentinel challenges the weakest claim in a Standoff. The
pack takes one corrective pass before drafting. Best when the answer must be defensible.
"""

from __future__ import annotations

import asyncio

from app.engine.strategies.base import Engine, Strategy, drop_empty, keep_findings


class CritiqueStrategy(Strategy):
    name = "critique"
    pattern = "standoff"
    label = "Plan-execute-critique"

    async def execute(self, engine: Engine) -> None:
        ids = engine.scout_ids()
        queries = engine.queries()

        # The scouts range in parallel before Sentinel scrutinizes the merge.
        results = await asyncio.gather(
            *(engine.scout(w, q) for w, q in zip(ids, queries, strict=False))
        )
        findings = drop_empty(results)

        merged = await engine.merge(keep_findings(findings))

        # The critique core: Sentinel challenges the weakest claim in a grounded standoff, then the
        # verdict is ENFORCED — apply_critique drops the flagged claims so a claim Sentinel couldn't
        # stand up never reaches the brief (the old re-merge changed nothing — verify was theatre).
        verdict = await engine.critique(merged)
        ruling = None
        if not verdict.ok and verdict.issues:
            issue = verdict.issues[0]
            ruling = await engine.standoff(
                challenger="sentinel",
                defendant="tracker",
                claim_ref=merged.output_ref or f"art_{engine.task[:8]}_merge",
                rationale=issue.get("problem") or "A claim needs a stronger source.",
                evidence=engine.standoff_evidence(merged, issue),
                claim=issue.get("claim") or None,
            )
        # Alpha's ruling decides the challenged claim's fate: apply_critique drops the flagged claims
        # UNLESS Alpha ruled keep/qualify on the debated one.
        merged = await engine.apply_critique(merged, verdict, ruling=ruling)

        decision = None
        if merged.conflict:
            decision = await engine.resolve_conflict(merged.conflict, merged.sources)

        draft = await engine.draft(merged, decision)
        await engine.finish(draft, merged)
