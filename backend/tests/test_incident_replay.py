"""Replay every captured incident in fixtures/incidents/ as a regression test.

Unlike the golden-path fixtures (fixtures/*.jsonl, schema conformance), these are captured hostile
inputs / real faults. Each file is discovered automatically and dispatched on its `kind`, so dropping
a new fixture of an existing kind adds a test case with zero code change. See
fixtures/incidents/README.md for the convention.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

_INCIDENTS = Path(__file__).resolve().parent.parent / "fixtures" / "incidents"
_FILES = sorted(_INCIDENTS.glob("*.json"))


def test_there_is_at_least_one_incident_fixture() -> None:
    """Guard the convention itself — if the directory is empty, the discovery below silently tests
    nothing and this suite would be a no-op that looks green."""
    assert _FILES, f"no incident fixtures found in {_INCIDENTS}"


@pytest.mark.parametrize("path", _FILES, ids=lambda p: p.stem)
def test_incident_replays_to_its_expected_outcome(path: Path) -> None:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    kind = fixture["kind"]

    if kind == "content_injection":
        from app.tools.content_guard import scan_content

        result = scan_content(fixture["input"]["scraped_text"])
        expect = fixture["expect"]
        for phrase in expect.get("must_mask", []):
            assert phrase not in result.text, f"{path.name}: injection phrase {phrase!r} not masked"
        for phrase in expect.get("must_keep", []):
            assert phrase in result.text, f"{path.name}: real content {phrase!r} was lost"
        assert result.hits >= expect.get("min_hits", 1), (
            f"{path.name}: expected >= {expect.get('min_hits', 1)} matches, got {result.hits}"
        )
    else:
        pytest.fail(
            f"{path.name}: unknown incident kind {kind!r} — add an `elif kind == {kind!r}:` "
            "replay branch in this test (see fixtures/incidents/README.md)."
        )
