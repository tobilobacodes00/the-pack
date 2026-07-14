"""The QA scoreboard (scripts/qa_scoreboard.py) generates docs/QA_SCOREBOARD.md from repo facts. These
prove it renders every wolf, is deterministic (so `--check` is meaningful), and that the committed file
is up to date — if a wolf gains/loses a prompt or test, regenerate and commit."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "qa_scoreboard.py"


def _load():
    spec = importlib.util.spec_from_file_location("qa_scoreboard", _SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_render_lists_every_standing_wolf() -> None:
    board = _load()
    out = board.render()
    for wolf in board.WOLVES:
        assert f"| {wolf} |" in out, f"{wolf} missing from the scoreboard"


def test_render_is_deterministic() -> None:
    """Two renders must be byte-identical or `--check` (used to detect a stale committed file) would
    flap. No timestamps, no set ordering leaking through."""
    board = _load()
    assert board.render() == board.render()


def test_committed_scoreboard_is_up_to_date() -> None:
    """The committed docs/QA_SCOREBOARD.md must match a fresh render — regenerate and commit if a wolf
    gains or loses a prompt / test file. This is the same check `--check` runs in CI."""
    board = _load()
    assert board.OUT.exists(), "docs/QA_SCOREBOARD.md not generated — run scripts/qa_scoreboard.py"
    assert board.OUT.read_text(encoding="utf-8").strip() == board.render().strip(), (
        "docs/QA_SCOREBOARD.md is stale — regenerate with `python scripts/qa_scoreboard.py`"
    )
