"""AST-based architecture-invariant guard — runs in CI (see .github/workflows/backend.yml).

Ruff + mypy catch style and types; the pytest suite catches behavior. Neither catches *structural*
drift — a new call site that quietly bypasses a load-bearing chokepoint, or a safety check silently
dropped in a refactor. Those regress a live invariant while every existing test still passes (the new
code just isn't exercised by them yet). This script inspects the source tree with Python's `ast`
module and fails CI (exit 1) the moment a known invariant is violated, at authoring/review time.

Deliberately NARROW — two concrete invariants, each mapping to a real bug already fixed once. It is a
tripwire, not a general architecture linter. Add an invariant here only when (a) violating it reopens a
specific known hole and (b) no cheaper gate (a unit test) already covers the structural shape itself.

Run:  python scripts/check_architecture.py    (from backend/)
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"


class Violation(Exception):
    """One broken invariant, with a message explaining what regressed and why it matters."""


def _iter_py_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)


# The ONE text-path chokepoint. Plus a SINGLE, DELIBERATE, DOCUMENTED exception: the multimodal
# vision tool. `describe_image` (app/tools/vision.py) calls Qwen-VL directly with `image_url` content
# that CallSpec/Wolf don't model today, so it can't ride QwenClient yet. This is a KNOWN GAP, not an
# oversight — that call currently gets NO breaker/retry/size-preflight and its tokens are invisible to
# the Boundary. It's listed here (not silently skipped) so the exemption is greppable and intentional;
# remove this entry the day CallSpec grows multimodal support and vision routes through the client.
_LLM_CALL_ALLOWED = (
    "qwen/client.py",  # the intended chokepoint
    "tools/vision.py",  # documented exception — see note above; TODO: fold into QwenClient
)


def check_llm_call_is_funneled() -> list[str]:
    """INVARIANT: `chat.completions.create(...)` is called only in QwenClient (app/qwen/client.py),
    plus the one explicitly-listed multimodal exception. That chokepoint owns retries, the per-hunt
    circuit breaker, request-size preflight, token/latency accounting, and the on_payload seam. A
    `.create()` added anywhere ELSE (a new tool, a new engine primitive, a quick script-in-app)
    silently skips ALL of that — no breaker, no retry, no cost accounting, no timing. Keep it funneled;
    a genuinely new exception must be added to `_LLM_CALL_ALLOWED` with a written justification."""
    errors: list[str] = []
    for path in _iter_py_files(APP):
        rel_posix = path.relative_to(APP).as_posix()
        if rel_posix in _LLM_CALL_ALLOWED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            # Match attribute chains ending in `.completions.create` (e.g. `x.chat.completions.create`).
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "create"
                and isinstance(node.func.value, ast.Attribute)
                and node.func.value.attr == "completions"
            ):
                rel = path.relative_to(APP.parent)
                errors.append(
                    f"{rel}:{node.lineno} calls `.completions.create(...)` outside app/qwen/client.py "
                    "— every model call MUST go through QwenClient so it gets the breaker, retries, "
                    "size preflight, and token/latency accounting. Route it through the client instead."
                )
    return errors


def check_ssrf_blocklist_keeps_cgnat() -> list[str]:
    """INVARIANT: app/tools/_ssrf.py's `_is_blocked` still references `_CGNAT`. Python's ipaddress
    stdlib does NOT classify 100.64.0.0/10 (RFC 6598 CGNAT) as private/reserved, but Alibaba Cloud's
    ECS metadata IP (100.100.100.200 — Pack's own deploy target) lives there. Dropping the explicit
    `_CGNAT` check in a refactor reopens a live SSRF hole. This guards the code STRUCTURE (a unit test
    in test_ssrf.py guards the behavior — belt and braces, since a test can be deleted too)."""
    path = APP / "tools" / "_ssrf.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_is_blocked":
            names = {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}
            if "_CGNAT" not in names:
                return [
                    "app/tools/_ssrf.py `_is_blocked` no longer references `_CGNAT` — the CGNAT range "
                    "(100.64.0.0/10, incl. Alibaba's 100.100.100.200 metadata IP) is not caught by the "
                    "ipaddress stdlib flags, so removing this check reopens the metadata-SSRF hole."
                ]
            return []
    return [
        "app/tools/_ssrf.py has no `_is_blocked` function — the SSRF blocklist may have moved; "
        "update this guard to point at the new location."
    ]


CHECKS = (check_llm_call_is_funneled, check_ssrf_blocklist_keeps_cgnat)


def main() -> int:
    all_errors: list[str] = []
    for check in CHECKS:
        all_errors.extend(check())
    if all_errors:
        print("Architecture-invariant violations found:\n", file=sys.stderr)
        for err in all_errors:
            print(f"  ✗ {err}\n", file=sys.stderr)
        return 1
    print(f"Architecture invariants OK ({len(CHECKS)} checks passed).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
