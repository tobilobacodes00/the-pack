"""Tests for app.qwen.context_budget — the soft cap on a dispatch's assembled context string."""

from __future__ import annotations

from app.qwen.context_budget import estimate_tokens, fit_context


def test_estimate_tokens_scales_with_length():
    assert estimate_tokens("") == 1
    short = estimate_tokens("a" * 40)
    long = estimate_tokens("a" * 4000)
    assert long > short


def test_fit_context_returns_full_join_when_under_budget():
    parts = ["Summary: x", "Sources:\n[1] a", "From your library:\n- b"]
    out = fit_context(parts, budget_tokens=10_000)
    assert out == "\n\n".join(parts)


def test_fit_context_drops_lowest_priority_parts_first():
    high = "Summary: the important part that must survive."
    mid_sources = "Sources:\n[1] a source"
    low_extra = "Packmaster input:\n" + ("filler " * 2000)  # far over budget alone

    # Budget fits `high` + `mid_sources` comfortably but not `low_extra` too — the lowest
    # priority (last) part must be the one dropped, never the higher-priority ones.
    budget = estimate_tokens(high + "\n\n" + mid_sources) + 5
    out = fit_context([high, mid_sources, low_extra], budget_tokens=budget)

    assert out == f"{high}\n\n{mid_sources}"
    assert "Packmaster input" not in out


def test_fit_context_never_drops_only_to_empty_when_one_part_given():
    huge = "line one\n\nline two\n\n" + ("word " * 5000)
    out = fit_context([huge], budget_tokens=20)
    assert out  # truncated, not empty
    assert out.endswith("…[truncated]")


def test_fit_context_truncation_prefers_paragraph_boundary_over_mid_entry():
    parts = ["First entry, short.\n\nSecond entry is " + ("quite long " * 500)]
    out = fit_context(parts, budget_tokens=15)
    # The truncated text ends either at the paragraph break or is the marker-suffixed remainder —
    # either way it should not end mid-word inside "Second".
    body = out.rsplit("\n…[truncated]", 1)[0]
    assert not body.endswith("quite long")  # didn't get cut mid phrase-repeat awkwardly
    assert body == "First entry, short." or body.startswith("First entry, short.")


def test_fit_context_is_deterministic():
    parts = ["a" * 100, "b" * 100, "c" * 5000]
    first = fit_context(parts, budget_tokens=50)
    second = fit_context(parts, budget_tokens=50)
    assert first == second


def test_fit_context_empty_parts_returns_empty_string():
    assert fit_context([], budget_tokens=1000) == ""
    assert fit_context(["", "   ", None or ""], budget_tokens=1000) == ""
