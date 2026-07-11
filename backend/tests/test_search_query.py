"""Query hygiene helpers (app/engine/search_query.py) — pure, so tested directly."""

from __future__ import annotations

from app.engine.search_query import broaden, plain_query


def test_plain_query_strips_dorks_and_operators() -> None:
    out = plain_query('site:spacex.com OR "starship" launch past week')
    low = out.lower()
    assert "site:" not in low
    assert " or " not in f" {low} "
    assert '"' not in out and "'" not in out
    assert "past week" not in low
    assert "starship" in low and "launch" in low  # the real keywords survive


def test_plain_query_falls_back_when_stripping_empties_it() -> None:
    # A query that is ONLY operators must not become empty — better a dork than nothing.
    assert plain_query("site:foo.com") == "site:foo.com".strip() or plain_query("site:foo.com")


def test_broaden_is_deterministic_and_capped() -> None:
    task = "the solid-state battery market in 2026"
    query = "solid-state battery supplier roadmap documentation github"
    a = broaden(task, query)
    assert a == broaden(task, query)  # no clock, no randomness
    assert 0 < len(a.split()) <= 7  # short enough to actually return hits
    assert "github" not in a.lower() and "documentation" not in a.lower()  # filler dropped
    assert "battery" in a.lower()  # subject preserved


def test_broaden_falls_back_to_task_when_query_is_all_filler() -> None:
    out = broaden("quantum networking", "the and of for with docs overview")
    assert out  # never empty
    assert "quantum" in out.lower()
