"""The AST architecture guard (scripts/check_architecture.py) is only worth having if it actually
FIRES on a violation — a guard that always returns 'ok' is worse than none (false confidence). These
prove each invariant catches its own violation, and that the real tree passes. If the guard's own
logic rots into a no-op, one of these fails."""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

_GUARD = Path(__file__).resolve().parent.parent / "scripts" / "check_architecture.py"


def _load_guard():
    spec = importlib.util.spec_from_file_location("check_architecture", _GUARD)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_real_tree_passes_every_invariant() -> None:
    guard = _load_guard()
    errors: list[str] = []
    for check in guard.CHECKS:
        errors.extend(check())
    assert errors == [], f"architecture invariants broke: {errors}"


def test_llm_funnel_check_fires_on_a_stray_create_call(tmp_path, monkeypatch) -> None:
    """A `.completions.create(...)` in a NEW file (not client.py, not the vision exception) must be
    flagged — that's the whole point: a new bypass of the chokepoint gets caught at authoring time."""
    guard = _load_guard()
    fake_app = tmp_path / "app"
    (fake_app / "engine").mkdir(parents=True)
    (fake_app / "engine" / "rogue.py").write_text(
        "async def go(client):\n    return await client.chat.completions.create(model='x')\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(guard, "APP", fake_app)
    errors = guard.check_llm_call_is_funneled()
    assert any("rogue.py" in e and "completions.create" in e for e in errors)


def test_llm_funnel_check_allows_the_listed_exceptions(tmp_path, monkeypatch) -> None:
    """The documented allow-list (client.py + the vision exception) must NOT be flagged, or the guard
    would block the intended chokepoint itself."""
    guard = _load_guard()
    fake_app = tmp_path / "app"
    (fake_app / "qwen").mkdir(parents=True)
    (fake_app / "tools").mkdir(parents=True)
    body = "async def go(client):\n    return await client.chat.completions.create(model='x')\n"
    (fake_app / "qwen" / "client.py").write_text(body, encoding="utf-8")
    (fake_app / "tools" / "vision.py").write_text(body, encoding="utf-8")
    monkeypatch.setattr(guard, "APP", fake_app)
    assert guard.check_llm_call_is_funneled() == []


def test_ssrf_check_fires_when_cgnat_reference_is_dropped(tmp_path, monkeypatch) -> None:
    """If a refactor removes the `_CGNAT` reference from `_is_blocked`, the guard must flag it — that
    exact deletion reopens the Alibaba-metadata SSRF hole."""
    guard = _load_guard()
    fake_app = tmp_path / "app"
    (fake_app / "tools").mkdir(parents=True)
    # A plausible 'simplified' _is_blocked that dropped the CGNAT clause.
    (fake_app / "tools" / "_ssrf.py").write_text(
        "def _is_blocked(ip):\n    return ip.is_private or ip.is_loopback\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(guard, "APP", fake_app)
    errors = guard.check_ssrf_blocklist_keeps_cgnat()
    assert any("_CGNAT" in e for e in errors)


def test_ssrf_check_passes_when_cgnat_reference_is_present(tmp_path, monkeypatch) -> None:
    guard = _load_guard()
    fake_app = tmp_path / "app"
    (fake_app / "tools").mkdir(parents=True)
    (fake_app / "tools" / "_ssrf.py").write_text(
        "_CGNAT = object()\n\n\ndef _is_blocked(ip):\n    return ip.is_private or ip in _CGNAT\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(guard, "APP", fake_app)
    assert guard.check_ssrf_blocklist_keeps_cgnat() == []


def test_guard_script_is_syntactically_valid() -> None:
    """Cheap smoke: the guard itself parses (it's run by `python`, not imported, in CI)."""
    ast.parse(_GUARD.read_text(encoding="utf-8"), filename=str(_GUARD))
