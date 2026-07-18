"""The Receipts — per-claim provenance for a delivered brief.

Every claim in the final brief gets an audit row: the sources it cites (with WHICH wolf found
each one and whether the page was actually read), whether the Sentinel challenged it, and how
that challenge resolved. Claims the Sentinel killed are listed too — enforcement is part of the
receipt. Composes ONLY from durable records (the final artifact, the Tracker's merge draft, the
Sentinel's critique artifact, and the standoff events): no model calls, no re-derivation. If the
pack couldn't verify something, the receipts say so — they never invent a status.

Field notes on the join (why this is exact, not fuzzy):
- `numbered_sources()` is THE single numbering function; both the merge registry and the final
  artifact's persisted `sources` come from the same deterministic dedupe of the same underlying
  list, so a claim's source ids resolve 1-based into `final.content.sources` directly.
- The final artifact persists `claims_src` IN LOCKSTEP with `claims`, so a claim's citation ids
  are read BY POSITION (`claims[i] ↔ claims_src[i]`) — never re-derived by matching claim text.
  Two claims of identical text but different sources therefore resolve to their own ids.
- Legacy artifacts predating that field fall back to a CONSUME-ON-MATCH join against the merge
  draft (pair each claim to the first unconsumed merge row of the same text).
- `dropped` is a MULTISET difference of merge vs final claims (pair off survivors, report the
  leftovers) — so dropping one of two identical-text merge rows is counted exactly once.
- Only the challenge join reuses the engine's own fuzzy matcher (`_claim_matches`) — the exact
  semantics `apply_critique` enforced with, so the receipt reports what actually happened.
"""

from __future__ import annotations

from typing import Any

from app.db.repo import Repo
from app.engine.supervisor import _claim_matches, _content_tokens

# Synthetic source schemes: library documents (tools/knowledge.py) and the pack's recalled
# lessons (tools/memory.py). The receipt labels both — neither is a navigable web page.
_LIB_PREFIX = "lib://"
_MEMORY_PREFIX = "memory://"


def _coerce_src_rows(raw: object) -> list[list[int]]:
    """Normalize a persisted `claims_src` (list of int-lists) — drop bools, coerce numerics, treat
    any non-list row as empty. Used for both the final artifact and the merge draft."""
    if not isinstance(raw, list):
        return []
    return [
        [int(n) for n in row if isinstance(n, int | float) and not isinstance(n, bool)]
        if isinstance(row, list)
        else []
        for row in raw
    ]


def _slim_source(n: int, s: dict[str, Any]) -> dict[str, Any]:
    """One citation, receipt-shaped: number, where it points, who found it, was it read."""
    url = str(s.get("url") or "")
    return {
        "n": n,
        "title": str(s.get("title") or "") or url,
        "url": url,
        "by": str(s.get("by") or ""),
        "verified": bool(s.get("verified")),
        "library": url.startswith(_LIB_PREFIX),
        "memory": url.startswith(_MEMORY_PREFIX),
    }


async def _artifact_content(repo: Repo, hunt_id: str, kind: str) -> dict[str, Any]:
    """Content of the LAST artifact of `kind` for this hunt ({} if none). Last wins: a deep_dive
    hunt merges twice, and the final brief is drafted from the last merge."""
    rows = await repo.list_artifacts(hunt_id)
    for row in reversed(rows):
        if row.get("kind") == kind:
            art = await repo.get_artifact_row(str(row["artifact_id"]))
            content = (art or {}).get("content")
            return content if isinstance(content, dict) else {}
    return {}


async def build_receipts(repo: Repo, hunt_id: str, task: str = "") -> dict[str, Any] | None:
    """Compose the receipts for a delivered hunt, or None if there's no final brief yet."""
    final = await repo.get_final_artifact(hunt_id)
    content = (final or {}).get("content")
    if not isinstance(content, dict):
        return None

    # Pair each final claim with ITS citation ids by position — the exact, identity-preserving join.
    # `finish()` persists `claims`/`claims_src` in lockstep; zip them BEFORE filtering so a blank
    # claim can never shift the pairing (avoids the old text `.index()` join bug).
    raw_claims = [str(c) for c in (content.get("claims") or [])]
    raw_claims_src = _coerce_src_rows(content.get("claims_src"))
    have_final_src = bool(raw_claims_src)  # older artifacts (pre-fix) won't carry claims_src
    paired: list[tuple[str, list[int]]] = [
        (c, raw_claims_src[i] if i < len(raw_claims_src) else [])
        for i, c in enumerate(raw_claims)
        if c.strip()
    ]
    claims = [c for c, _ in paired]
    final_src_by_pos = [ids for _, ids in paired]
    sources = [s for s in (content.get("sources") or []) if isinstance(s, dict)]

    merge = await _artifact_content(repo, hunt_id, "draft")
    merge_claims = [str(c) for c in (merge.get("claims") or [])]
    merge_src: list[list[int]] = _coerce_src_rows(merge.get("claims_src"))

    # The Sentinel persists a critique artifact on BOTH a genuine review AND a timeout/faulted
    # placeholder, so artifact-existence alone isn't proof it ran — the completed flag is the honest
    # signal (older artifacts predate the flag and default True).
    critique = await _artifact_content(repo, hunt_id, "critique")
    critique_ran = bool(critique) and bool(critique.get("completed", True))
    issues: list[dict[str, Any]] = [
        i for i in (critique.get("issues") or []) if isinstance(i, dict)
    ]
    # Surface WHY when the Sentinel didn't complete, not just a bare "did not run".
    review_note = ""
    if critique and not critique_ran:
        review_note = next(
            (str(i.get("problem") or "") for i in issues if str(i.get("problem") or "").strip()),
            "verification did not complete — claims are unverified",
        )

    # The standoff, if one happened: who challenged whom, and how it ended.
    events = await repo.replay_events(hunt_id, 0)
    opened = next((e for e in reversed(events) if e.type == "standoff_opened"), None)
    resolved = next((e for e in reversed(events) if e.type == "standoff_resolved"), None)
    standoff: dict[str, Any] | None = None
    if opened is not None or resolved is not None:
        standoff = {
            "challenger": str((opened.payload if opened else {}).get("challenger") or "sentinel"),
            "defendant": str((opened.payload if opened else {}).get("defendant") or "tracker"),
            "outcome": str((resolved.payload if resolved else {}).get("outcome") or "unresolved"),
            "rationale": str((resolved.payload if resolved else {}).get("rationale") or ""),
        }

    task_stop = _content_tokens(task)

    def _issue_for(claim: str) -> dict[str, Any] | None:
        for i in issues:
            flagged = str(i.get("claim") or "").strip()
            if flagged and _claim_matches(flagged, claim, task_stop):
                return i
        return None

    # Fallback join for legacy artifacts that predate `claims_src`: pair each final claim against the
    # merge rows CONSUME-ON-MATCH (the first unconsumed merge row whose text equals the claim), so
    # repeated claims pair off in order instead of collapsing onto the first.
    _unconsumed = list(range(len(merge_claims)))

    def _consume_src_for(claim: str) -> list[int]:
        for pos, idx in enumerate(_unconsumed):
            if merge_claims[idx] == claim:
                _unconsumed.pop(pos)
                return merge_src[idx] if idx < len(merge_src) else []
        return []

    def _src_ids_for(i: int, claim: str) -> list[int]:
        # Exact path: the final artifact carries this claim's own ids by position.
        if have_final_src:
            return final_src_by_pos[i] if i < len(final_src_by_pos) else []
        # Legacy path: consume-on-match against the merge draft.
        return _consume_src_for(claim)

    rows: list[dict[str, Any]] = []
    for i, claim in enumerate(claims):
        ids = _src_ids_for(i, claim)
        cited = [_slim_source(n, sources[n - 1]) for n in ids if 1 <= n <= len(sources)]
        issue = _issue_for(claim)
        if issue is not None:
            status = (
                "challenged_kept"  # flagged by the Sentinel, yet it's in the brief: it survived
            )
        elif any(s["verified"] for s in cited):
            status = "verified"  # at least one cited page was actually fetched and read
        elif cited:
            status = "cited"  # sourced from search results, none deep-read
        else:
            status = "unsourced"  # in the brief with no citation — the receipt says so
        rows.append(
            {
                "text": claim,
                "status": status,
                "sources": cited,
                "challenge": (
                    {"problem": str(issue.get("problem") or "")} if issue is not None else None
                ),
            }
        )

    # Merge claims that never reached the brief were dropped (Sentinel verdict or re-merge). This is
    # a MULTISET difference, not a set one: two merge rows of identical text where the brief kept
    # only one means exactly one was dropped. Pair each surviving final claim off against one
    # unconsumed merge occurrence; whatever remains unpaired are the genuine drops.
    survivors = list(claims)
    remaining = list(range(len(merge_claims)))
    for claim in survivors:
        for pos, idx in enumerate(remaining):
            if merge_claims[idx] == claim:
                remaining.pop(pos)
                break
    dropped: list[dict[str, Any]] = []
    for idx in remaining:
        mc = merge_claims[idx]
        if not mc.strip():
            continue
        issue = _issue_for(mc)
        dropped.append(
            {
                "text": mc,
                "problem": str((issue or {}).get("problem") or "did not survive verification"),
            }
        )

    # Division of labor, from the sources' own `by` tags.
    wolves: dict[str, dict[str, int]] = {}
    for s in sources:
        by = str(s.get("by") or "")
        if not by:
            continue
        w = wolves.setdefault(by, {"sources": 0, "verified": 0})
        w["sources"] += 1
        if s.get("verified"):
            w["verified"] += 1

    # Your-documents coverage: which library documents the brief actually drew on.
    documents: list[dict[str, Any]] = []
    for i, s in enumerate(sources):
        url = str(s.get("url") or "")
        if not url.startswith(_LIB_PREFIX):
            continue
        n = i + 1
        documents.append(
            {
                "doc_id": url[len(_LIB_PREFIX) :],
                "title": str(s.get("title") or ""),
                "cited_by_claims": sum(1 for r in rows if any(c["n"] == n for c in r["sources"])),
            }
        )

    statuses = [r["status"] for r in rows]
    return {
        "hunt_id": hunt_id,
        "critique_ran": critique_ran,
        "review_note": review_note,
        "claims": rows,
        "dropped": dropped,
        "standoff": standoff,
        "wolves": wolves,
        "documents": documents,
        "totals": {
            "claims": len(rows),
            "verified": statuses.count("verified"),
            "cited": statuses.count("cited"),
            "unsourced": statuses.count("unsourced"),
            "challenged_kept": statuses.count("challenged_kept"),
            "dropped": len(dropped),
        },
    }
