"""Tracker's merge attribution — claims carry the source_ids that back them, Sentinel's critique
context actually contains the sources it's asked to verify, a mangled conflict is salvaged or
constrained, and a stalled merge falls back to the scouts' real summaries, not raw snippets.

All hermetic (no model, no network) — driven by stubbing `Wolf.think` directly."""

from __future__ import annotations

import asyncio

import pytest

from app.engine import prompt_context as pc
from app.engine.boundary import Boundary
from app.engine.core import Emitter
from app.engine.strategies.base import Finding, Merged
from app.engine.supervisor import Supervisor
from app.engine.wolves import Wolf
from app.qwen.client import QwenClient
from app.qwen.types import CompletionResult

from ._fakes import FakeRepo


def _sup(repo: FakeRepo, hunt_id: str) -> Supervisor:
    sup = Supervisor(
        hunt_id,
        Emitter(hunt_id, repo),
        repo,
        QwenClient(),
        asyncio.Queue(),
        source="typed",
        raw_input="the BNPL market in Nigeria",
        strategy="orchestrate",
    )
    # merge() dispatches through the real Boundary/per-wolf-budget gate — give it real room so the
    # dispatch actually reaches the stubbed Wolf.think instead of halting/relieving pre-dispatch.
    sup._boundary = Boundary(boundary_usd=5.0)
    sup._wolves["tracker"] = sup._make_wolf("tracker", "tracker", "plus", False)
    sup._wolf_budget["tracker"] = 5.0
    return sup


def _result(parsed: dict) -> CompletionResult:
    return CompletionResult(
        text="merged",
        model="stub",
        tier="plus",
        in_tokens=1,
        out_tokens=1,
        cost_usd=0.0,
        parsed=parsed,
    )


def _findings() -> list[Finding]:
    return [
        Finding(
            wolf_id="scout-1",
            summary="OpenAI reports 4.2M active users in the region.",
            sources=[
                {"url": "https://openai.com/report", "title": "OpenAI report", "verified": True}
            ],
            confidence=0.8,
        ),
        Finding(
            wolf_id="scout-2",
            summary="A rival study puts adoption closer to 2.1M.",
            sources=[{"url": "https://rival.com/study", "title": "Rival study", "verified": True}],
            confidence=0.75,
        ),
    ]


async def test_merge_schema_accepts_object_and_string_claims() -> None:
    """MERGE_SCHEMA.claims documents BOTH shapes — an object {text, source_ids} and a plain string
    (legacy / FakeQwen) — so a real model isn't punished for either shape, even though the client
    never validates it at runtime (this only pins the documented contract)."""
    from jsonschema import Draft202012Validator

    from app.engine.strategies.base import MERGE_SCHEMA

    validator = Draft202012Validator(MERGE_SCHEMA)
    ok_object = {"summary": "s", "claims": [{"text": "a claim", "source_ids": [1, 2]}]}
    ok_string = {"summary": "s", "claims": ["a plain claim"]}
    ok_mixed = {"summary": "s", "claims": ["plain", {"text": "obj", "source_ids": [1]}]}
    for doc in (ok_object, ok_string, ok_mixed):
        assert not list(validator.iter_errors(doc)), doc
    bad = {"summary": "s", "claims": [42]}
    assert list(validator.iter_errors(bad)), "a bare number is neither shape"


async def test_merge_coerces_object_claims_to_text_plus_srcids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An object-claim {text, source_ids} coerces to (claims, claims_src); an out-of-range id is
    dropped; a plain string claim (legacy shape) still survives with an empty source list."""
    repo = FakeRepo()
    sup = _sup(repo, "hunt_coerce")

    async def fake_think(self, intent, **kwargs):
        assert intent == "merge"
        return _result(
            {
                "summary": "Two sources on adoption.",
                "claims": [
                    {"text": "OpenAI reports 4.2M users.", "source_ids": [1, 99, "x"]},
                    "A plain string claim with no ids.",
                ],
            }
        )

    monkeypatch.setattr(Wolf, "think", fake_think)
    merged = await sup.merge(_findings())

    assert merged.claims == ["OpenAI reports 4.2M users.", "A plain string claim with no ids."]
    assert merged.claims_src[0] == [1], "id 99 is out of range and 'x' isn't numeric — both dropped"
    assert merged.claims_src[1] == [], "a legacy string claim carries no source_ids"


async def test_findings_and_draft_share_one_numbering() -> None:
    """The registry findings_context/merge sees and the citation list draft_context renders are
    built by the SAME function on the SAME sources — identical order, identical numbers."""
    findings = _findings()
    all_sources = [s for f in findings for s in f.sources]
    reg_sources, merge_registry = pc.numbered_sources(all_sources)
    draft_sources, draft_registry = pc.numbered_sources(all_sources)
    assert reg_sources == draft_sources
    assert merge_registry == draft_registry
    assert "[1]" in merge_registry and "[2]" in merge_registry


async def test_critique_context_contains_numbered_sources() -> None:
    """Sentinel's critique context carries the numbered registry AND each claim's [sources: N] —
    without this it is asked to verify claims against sources it never sees."""
    from app.engine.strategies.base import Merged

    findings = _findings()
    sources = [s for f in findings for s in f.sources]
    merged = Merged(
        summary="s", claims=["A claim.", "Another."], claims_src=[[1], [2]], sources=sources
    )
    with_sources = pc.merged_context(merged, sources=merged.sources)
    assert "[1]" in with_sources and "openai.com" in with_sources
    assert "[sources: 1]" in with_sources and "[sources: 2]" in with_sources

    sourceless = pc.merged_context(merged)  # the find_gaps call path — no sources param
    assert "Sources (" not in sourceless


async def test_conflict_recommended_falls_back_when_off_menu() -> None:
    """An off-menu 'recommended' (not one of the offered options) falls back to the first option —
    a wild-mode hunt must never auto-decide on a paraphrase that isn't a real choice."""
    c = pc.conflict_from({"question": "q", "options": ["A", "B"], "recommended": "Z"})
    assert c is not None and c.recommended == "A"


async def test_conflict_salvaged_from_single_option() -> None:
    """A conflict that comes back as one option + a distinct 'recommended' is really 2 positions
    split across the two fields — salvage it instead of silently dropping for '< 2 options'."""
    c = pc.conflict_from({"question": "2M vs 3.4M?", "options": ["3.4M"], "recommended": "2M"})
    assert c is not None
    assert set(c.options) == {"3.4M", "2M"}
    assert c.recommended in c.options


async def test_conflict_still_none_with_no_real_second_position() -> None:
    """A single option with no distinct recommended (or none at all) has nothing to choose between —
    stays None, not manufactured into a fake 2-way choice."""
    assert pc.conflict_from({"question": "q", "options": ["A"]}) is None
    assert pc.conflict_from({"question": "q", "options": ["A"], "recommended": "A"}) is None
    assert pc.conflict_from({"question": "", "options": ["A", "B"]}) is None


async def test_merge_timeout_fallback_carries_finding_summaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A merge that times out must not discard the scouts' real read summaries — the honest fallback
    brief quotes each finding's actual summary, cited to that finding's own sources, not a bare
    title/snippet listing."""
    repo = FakeRepo()
    sup = _sup(repo, "hunt_timeout")

    async def hang_forever(self, intent, **kwargs):
        await asyncio.sleep(10)
        raise AssertionError("unreachable")

    monkeypatch.setattr(Wolf, "think", hang_forever)
    # the merge runs under the SYNTHESIS budget now (not the per-step one); force it tiny and skip the
    # retry pass so the timeout fallback fires immediately.
    monkeypatch.setattr(sup, "_synthesis_timeout", 0.05)
    monkeypatch.setattr("app.config.settings.synthesis_retries", 0)

    merged = await sup.merge(_findings())
    assert merged.claims == []
    assert len(merged.stalled_findings) == 2
    texts = {t for t, _ in merged.stalled_findings}
    assert "OpenAI reports 4.2M active users in the region." in texts
    assert "A rival study puts adoption closer to 2.1M." in texts
    for _text, ids in merged.stalled_findings:
        assert ids, "each stalled finding cites its own source's registry number"

    blocks = sup._blocks_from_sources(merged)
    block_texts = [b["text"] for b in blocks]
    assert any("OpenAI reports 4.2M active users" in t for t in block_texts)
    assert not any("openai.com/report —" in t for t in block_texts), (
        "the fallback quotes the finding's SUMMARY, not a bare title/snippet line"
    )


# --- Howler (draft) fixes ------------------------------------------------------------------


def test_coerce_source_ids_drops_nan_infinity_bool_and_out_of_range() -> None:
    """json.loads(..., strict=False) accepts the non-standard NaN/Infinity literals, and
    isinstance(nan, float) is True — so a naive int(i) comprehension crashes on int(float('nan')).
    The shared coercer must silently drop anything that isn't a finite, in-range int, never raise."""
    got = pc.coerce_source_ids([1, float("nan"), float("inf"), float("-inf"), 2, True, "x", 99], 3)
    assert got == [1, 2], "NaN/Infinity/bool/non-numeric/out-of-range all dropped, no crash"
    assert pc.coerce_source_ids(None, 3) == []
    assert pc.coerce_source_ids([], 3) == []
    assert pc.coerce_source_ids([1.9, 2.1], 3) == [1, 2], "floats truncate like the old int(i) did"


async def test_draft_timeout_fallback_carries_claims_and_source_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Howler's OWN draft dispatch timing out must not discard merge's claims/claims_src — the
    fallback brief must cite each claim, not collapse to one uncited summary blob (the same bug
    class Tracker's merge-timeout fallback was already fixed for)."""
    repo = FakeRepo()
    sup = _sup(repo, "hunt_draft_timeout")
    sup._wolves["howler"] = sup._make_wolf("howler", "howler", "plus", False)
    sup._wolf_budget["howler"] = 5.0

    async def hang_forever(self, intent, **kwargs):
        await asyncio.sleep(10)
        raise AssertionError("unreachable")

    monkeypatch.setattr(Wolf, "think", hang_forever)
    # draft runs under the SYNTHESIS budget now — force it tiny and skip the retry pass.
    monkeypatch.setattr(sup, "_synthesis_timeout", 0.05)
    monkeypatch.setattr("app.config.settings.synthesis_retries", 0)

    merged = Merged(
        summary="Two sources on adoption.",
        claims=["OpenAI reports 4.2M users.", "A rival study reports 2.1M."],
        claims_src=[[1], [2]],
        sources=[
            {"url": "https://openai.com/report", "title": "OpenAI report", "verified": True},
            {"url": "https://rival.com/study", "title": "Rival study", "verified": True},
        ],
    )
    await sup.draft(merged)

    texts = [b["text"] for b in sup._blocks]
    assert "OpenAI reports 4.2M users." in texts
    assert "A rival study reports 2.1M." in texts
    by_text = {b["text"]: b["source_ids"] for b in sup._blocks}
    assert by_text["OpenAI reports 4.2M users."] == [1]
    assert by_text["A rival study reports 2.1M."] == [2]


def test_blocks_from_claims_falls_back_to_summary_when_no_claims() -> None:
    """Parity with `_blocks_from_sources`'s own contract: with no claims at all, the draft-timeout
    fallback helper degrades to the bare summary rather than an empty block list. (In `draft()`
    itself this branch of `merged.claims` being empty is actually intercepted earlier by the
    no-claims early-out before Howler is ever dispatched — this pins the helper's own contract
    directly, since defensive code should still behave correctly if ever reached another way.)"""
    repo = FakeRepo()
    sup = _sup(repo, "hunt_blocks_from_claims_empty")
    merged = Merged(
        summary="Just a summary, merge produced no claims.",
        claims=[],
        claims_src=[],
        sources=[{"url": "https://openai.com/report", "title": "OpenAI report", "verified": True}],
    )
    assert sup._blocks_from_claims(merged) == [{"text": merged.summary, "source_ids": []}]


def test_blocks_from_falls_back_to_claims_not_blanket_credit() -> None:
    """When Howler's structured `blocks` come back empty/malformed but `merged.claims` exist,
    the fallback must cite per-claim (honest) instead of blanket-crediting every source to one blob."""
    repo = FakeRepo()
    sup = _sup(repo, "hunt_blocks_from")
    sources = [
        {"url": "https://openai.com/report", "title": "OpenAI report", "verified": True},
        {"url": "https://rival.com/study", "title": "Rival study", "verified": True},
    ]
    merged = Merged(
        summary="s",
        claims=["OpenAI reports 4.2M users.", "A rival study reports 2.1M."],
        claims_src=[[1], [2]],
        sources=sources,
    )
    res = CompletionResult(
        text="some free text the model returned instead of structured blocks",
        model="stub",
        tier="plus",
        in_tokens=1,
        out_tokens=1,
        cost_usd=0.0,
        parsed={"title": "Adoption", "blocks": []},
    )
    blocks = sup._blocks_from(res, sources, merged)
    body = [b for b in blocks if not b["text"].startswith("# ")]
    assert {b["text"] for b in body} == {
        "OpenAI reports 4.2M users.",
        "A rival study reports 2.1M.",
    }
    assert not any(b["source_ids"] == [1, 2] for b in body), (
        "must not blanket-credit every source to one blob when per-claim attribution exists"
    )


def test_blocks_from_no_claims_no_body_blocks_falls_back_to_free_text() -> None:
    """With no claims AND no structured body blocks, fall back to the old blanket-credit blob —
    but never append an empty-text blob (e.g. a breaker-open `_faulted_result`'s text='')."""
    repo = FakeRepo()
    sup = _sup(repo, "hunt_blocks_from_empty")
    sources = [{"url": "https://openai.com/report", "title": "OpenAI report", "verified": True}]
    merged = Merged(summary="s", claims=[], claims_src=[], sources=sources)

    res_with_text = CompletionResult(
        text="free text fallback",
        model="stub",
        tier="plus",
        in_tokens=1,
        out_tokens=1,
        cost_usd=0.0,
        parsed={},
    )
    blocks = sup._blocks_from(res_with_text, sources, merged)
    body = [b for b in blocks if not b["text"].startswith("# ")]
    assert body == [{"text": "free text fallback", "source_ids": [1]}]

    res_empty = CompletionResult(
        text="",
        model="(faulted)",
        tier="plus",
        in_tokens=0,
        out_tokens=0,
        cost_usd=0.0,
        parsed=None,
    )
    blocks_empty = sup._blocks_from(res_empty, sources, merged)
    assert blocks_empty == [], (
        "an empty faulted result must not register a spurious provenance entry"
    )


def test_howler_prompt_version_matches_what_load_prompt_actually_loads() -> None:
    """`load_prompt` always reads `v1.md` regardless of what the frontmatter CLAIMS its version is
    (app/prompts.py:47 hardcodes the v1 path) — pins the frontmatter honesty fix so a stale
    'howler/v2' string (describing a schema DRAFT_SCHEMA/_blocks_from never reads) can't creep back."""
    from app.prompts import load_prompt

    p = load_prompt("howler")
    assert p.version == "howler/v1"
    assert "produced_by" not in p.body, "no dead span-map instruction the engine never reads"
    assert "standoff_ids" not in p.body
    assert "transcript_ts" not in p.body


def test_coerce_claims_uses_shared_coercer_and_survives_nan() -> None:
    """`_coerce_claims` (Tracker's merge-claim coercion) must not crash on the same NaN input that
    would crash a naive int(i) comprehension — it now delegates to the shared coercer."""
    from app.engine.supervisor import Supervisor as Sup

    claims, claims_src = Sup._coerce_claims(
        [{"text": "a claim", "source_ids": [1, float("nan"), 99]}], 2
    )
    assert claims == ["a claim"]
    assert claims_src == [[1]]
