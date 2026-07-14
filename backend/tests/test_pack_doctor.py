"""`pack doctor` (scripts/pack_doctor.py) is a proactive health sweep — it's only useful if its checks
actually run and correctly distinguish PASS/WARN/FAIL. These prove the sweep runs green on a healthy
tree and that the SSRF check would FAIL loudly if the blocklist regressed (the check that would have
caught the Alibaba-metadata hole)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_DOCTOR = Path(__file__).resolve().parent.parent / "scripts" / "pack_doctor.py"


def _load():
    spec = importlib.util.spec_from_file_location("pack_doctor", _DOCTOR)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_doctor_runs_and_returns_an_exit_code() -> None:
    doctor = _load()
    rc = doctor.run()
    assert rc in (0, 1)  # 0 if no FAIL, 1 if any FAIL — never a crash


def test_no_check_hard_fails_on_a_healthy_offline_tree() -> None:
    """Offline (no keys) the sweep may WARN (default secrets) but must not FAIL — a FAIL means a real
    structural problem (broken schema, missing prompt, leaking SSRF blocklist)."""
    doctor = _load()
    fails = []
    for name, check in doctor.CHECKS:
        status, detail = check()
        assert status in (doctor.PASS, doctor.WARN, doctor.FAIL)
        if status == doctor.FAIL:
            fails.append((name, detail))
    assert not fails, f"pack doctor FAILed on a healthy tree: {fails}"


def test_ssrf_check_passes_because_metadata_ips_are_blocked() -> None:
    """This is the concrete regression check: the SSRF/metadata check must PASS today (the CGNAT +
    link-local ranges are covered). If someone drops the blocklist, this check flips to FAIL."""
    doctor = _load()
    status, detail = doctor.check_ssrf_blocklist_covers_metadata()
    assert status == doctor.PASS, detail


def test_event_schema_and_prompts_checks_pass() -> None:
    doctor = _load()
    assert doctor.check_event_schema_loads_and_is_valid()[0] == doctor.PASS
    assert doctor.check_every_wolf_prompt_loads()[0] == doctor.PASS
