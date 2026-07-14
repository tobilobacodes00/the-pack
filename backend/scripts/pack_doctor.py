"""`pack doctor` — a proactive static health sweep (run: `python scripts/pack_doctor.py`).

The Warden heals a fault REACTIVELY, mid-hunt, once something has already broken. This is the opposite:
a checklist run BEFORE anything breaks, so a config gap or a drifted invariant is found on purpose
rather than discovered when a hunt fails. It enumerates every check as PASS / WARN / FAIL (it does NOT
fail-fast — every check runs so you see the whole picture), and exits non-zero if any check FAILs so it
can gate CI or a deploy.

Design: each check is a small function returning (status, detail). Checks reuse the app's OWN
validators (pricing, secrets, schema, prompts) so the doctor and the running app can't disagree. Add a
check by writing a function and listing it in CHECKS — keep each one cheap and offline (no network, no
DB) so `pack doctor` runs anywhere, anytime.
"""

from __future__ import annotations

from collections.abc import Callable

# Status constants — ordered by severity for the summary.
PASS, WARN, FAIL = "PASS", "WARN", "FAIL"

Check = Callable[[], tuple[str, str]]


def check_pricing_table() -> tuple[str, str]:
    """The per-tier pricing must be sane — a mis-set rate silently mis-bills every hunt's Boundary."""
    from app.qwen.pricing import validate_pricing

    problems = validate_pricing()
    if problems:
        return WARN, "pricing looks off: " + "; ".join(problems)
    return PASS, "pricing table sane for all tiers"


def check_secrets() -> tuple[str, str]:
    """Default/blank secrets are fine for local dev (WARN) but must never ship — surface them."""
    from app.core.auth import validate_secrets

    problems = validate_secrets()
    if problems:
        return WARN, "; ".join(problems) + " (fine for local dev; set them before prod)"
    return PASS, "no default/blank secrets"


def check_event_schema_loads_and_is_valid() -> tuple[str, str]:
    """The frozen event schema must load and itself be a valid JSON Schema — every emit validates
    against it, so a corrupt schema breaks every hunt."""
    from jsonschema import Draft202012Validator

    from app.events.models import load_event_schema

    try:
        schema = load_event_schema()
        Draft202012Validator.check_schema(schema)
    except Exception as exc:  # noqa: BLE001 — report, don't crash the sweep
        return FAIL, f"event schema failed to load/validate: {exc!r}"
    n = len(schema.get("$defs", {}).get("eventType", {}).get("enum", []))
    return PASS, f"event schema valid ({n} event types)"


def check_every_wolf_prompt_loads() -> tuple[str, str]:
    """Every standing wolf's prompt file must load — a missing/renamed prompt crashes that wolf's
    first dispatch, mid-hunt, instead of here."""
    from app.prompts import load_prompt

    roles = ("scout", "tracker", "sentinel", "howler", "beta", "alpha", "elder", "warden")
    missing: list[str] = []
    for role in roles:
        try:
            body = load_prompt(role).body
            if not body.strip():
                missing.append(f"{role} (empty)")
        except Exception:  # noqa: BLE001
            missing.append(f"{role} (missing)")
    if missing:
        return FAIL, "prompt problems: " + ", ".join(missing)
    return PASS, f"all {len(roles)} wolf prompts load"


def check_ssrf_blocklist_covers_metadata() -> tuple[str, str]:
    """The SSRF blocklist must reject the cloud-metadata IPs — this is the exact proactive check that
    would have caught the Alibaba-metadata hole before it shipped (per the study)."""
    import ipaddress

    from app.tools._ssrf import _is_blocked
    from app.tools.content_guard import is_fetchable_url

    must_block = ["169.254.169.254", "100.100.100.200", "127.0.0.1", "10.0.0.1"]
    leaked = [ip for ip in must_block if not _is_blocked(ipaddress.ip_address(ip))]
    if leaked:
        return FAIL, "SSRF blocklist LETS THROUGH: " + ", ".join(leaked)
    # Confirm the content-guard's synchronous fetch gate agrees on the metadata IP.
    if is_fetchable_url("http://100.100.100.200/"):
        return FAIL, "content-guard fetch gate lets through the Alibaba metadata IP"
    return PASS, "SSRF + fetch gate reject all metadata/internal IPs"


def check_prompt_cache_flag_consistency() -> tuple[str, str]:
    """If prompt caching is ON, the min-chars threshold must be > 0 or the cache marker attaches to
    everything (including short personas that never cache) — a config foot-gun worth flagging."""
    from app.config import settings

    if settings.qwen_prompt_cache_enabled and settings.qwen_prompt_cache_min_chars <= 0:
        return (
            WARN,
            "prompt cache ON but min_chars <= 0 — marker will attach to un-cacheable personas",
        )
    state = "on" if settings.qwen_prompt_cache_enabled else "off (pending live-key proof)"
    return PASS, f"prompt cache config coherent (cache {state})"


CHECKS: tuple[tuple[str, Check], ...] = (
    ("pricing", check_pricing_table),
    ("secrets", check_secrets),
    ("event-schema", check_event_schema_loads_and_is_valid),
    ("wolf-prompts", check_every_wolf_prompt_loads),
    ("ssrf-blocklist", check_ssrf_blocklist_covers_metadata),
    ("prompt-cache", check_prompt_cache_flag_consistency),
)

# ASCII markers (not ✓/✗) so output encodes on a cp1252 Windows console — this project's primary OS.
_ICON = {PASS: "[ok]", WARN: "[!!]", FAIL: "[XX]"}


def run() -> int:
    results: list[tuple[str, str, str]] = []
    for name, check in CHECKS:
        try:
            status, detail = check()
        except Exception as exc:  # noqa: BLE001 — a check that itself blows up is a FAIL, not a crash
            status, detail = FAIL, f"check raised: {exc!r}"
        results.append((name, status, detail))

    print("pack doctor — static health sweep\n")
    for name, status, detail in results:
        print(f"  {_ICON[status]} {status:4} {name:16} {detail}")

    fails = sum(1 for _n, s, _d in results if s == FAIL)
    warns = sum(1 for _n, s, _d in results if s == WARN)
    print(
        f"\n{len(results)} checks: {len(results) - fails - warns} pass, {warns} warn, {fails} fail"
    )
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(run())
