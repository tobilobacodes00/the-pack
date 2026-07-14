"""Scout-quality logic: the finding-usability predicate, the drop/keep helpers, real facet queries,
and the depth-scaled scout tier. All pure — no model, no network."""

from __future__ import annotations

import pytest

from app.engine.roster import ROLE_SPEC, scout_spec
from app.engine.search_query import FACETS, facet_query
from app.engine.strategies.base import Finding, drop_empty, keep_findings


def _f(wolf_id="scout-1", summary="found stuff", sources=None, confidence=0.7):
    return Finding(wolf_id=wolf_id, summary=summary, sources=sources or [], confidence=confidence)


class TestIsUsable:
    def test_verified_source_is_always_usable(self) -> None:
        f = _f(sources=[{"url": "u", "verified": True}], summary="", confidence=0.0)
        assert f.is_usable()  # a READ page stands even with no summary/low confidence

    def test_snippet_only_below_floor_is_not_usable(self) -> None:
        f = _f(sources=[{"url": "u", "verified": False}], summary="thin", confidence=0.3)
        assert not f.is_usable()  # 0.3 < 0.35 floor, no verified source

    def test_empty_failed_finding_is_not_usable(self) -> None:
        assert not _f(summary="", sources=[], confidence=0.0).is_usable()

    def test_strong_summary_without_source_is_usable(self) -> None:
        assert _f(summary="real synthesis", sources=[], confidence=0.6).is_usable()

    def test_verified_sources_property_filters(self) -> None:
        f = _f(sources=[{"url": "a", "verified": True}, {"url": "b", "verified": False}])
        assert [s["url"] for s in f.verified_sources] == ["a"]


class TestDropEmpty:
    def test_drops_none_and_unusable_keeps_full_thin_set(self) -> None:
        # the retry gate must see EVERY thin-but-usable scout — no best-collapse here.
        results = [
            _f("scout-1", confidence=0.36),  # thin but usable (>= floor)
            _f("scout-2", confidence=0.40),
            None,  # a scout that died
            _f("scout-3", summary="", sources=[], confidence=0.0),  # empty → dropped
        ]
        kept = drop_empty(results)
        assert {f.wolf_id for f in kept} == {"scout-1", "scout-2"}

    def test_drop_empty_can_return_empty(self) -> None:
        assert drop_empty([None, _f(summary="", sources=[], confidence=0.0)]) == []


class TestKeepFindings:
    def test_returns_strongest_first(self) -> None:
        kept = keep_findings([_f("a", confidence=0.5), _f("b", confidence=0.9)])
        assert [f.wolf_id for f in kept] == ["b", "a"]

    def test_never_empty_when_any_present_keeps_best(self) -> None:
        # all sub-floor → keep_findings still returns the single best (a thin-but-real hunt drafts).
        low = [
            _f("a", summary="x", sources=[], confidence=0.1),
            _f("b", summary="y", sources=[], confidence=0.2),
        ]
        kept = keep_findings(low)
        assert len(kept) == 1 and kept[0].wolf_id == "b"

    def test_empty_when_nothing_present(self) -> None:
        assert keep_findings([None, None]) == []


class TestFacetQuery:
    def test_is_a_real_angle_not_a_placeholder(self) -> None:
        q = facet_query("solid state batteries", 0)
        assert "angle" not in q.lower()
        assert "solid state batteries" in q
        assert q.endswith(FACETS[0])

    def test_distinct_across_indices(self) -> None:
        qs = {facet_query("topic", i) for i in range(len(FACETS))}
        assert len(qs) == len(FACETS)

    def test_wraps_around(self) -> None:
        assert facet_query("t", len(FACETS)) == facet_query("t", 0)


class TestScoutSpecByDepth:
    def test_brief_and_standard_fall_through_to_base(self) -> None:
        base = ROLE_SPEC["scout"]
        assert scout_spec("brief") == base
        assert scout_spec("standard") == base

    def test_deep_upgrades_to_plus_thinking(self) -> None:
        tier, thinking, budget = scout_spec("deep")
        assert tier == "plus" and thinking is True and budget == 0.15

    def test_monkeypatched_base_still_governs_standard(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # the per-wolf-budget relief test patches ROLE_SPEC["scout"] — standard must read it live.
        monkeypatch.setitem(ROLE_SPEC, "scout", ("flash", False, 0.001))
        assert scout_spec("standard") == ("flash", False, 0.001)
        # deep stays upgraded, budget max-guarded above the (now tiny) base
        assert scout_spec("deep") == ("plus", True, 0.15)

    def test_unknown_depth_is_base(self) -> None:
        assert scout_spec("weird") == ROLE_SPEC["scout"]
