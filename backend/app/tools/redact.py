"""PII + secret redaction — the Tracks export AND every process log line (Doc 04).

Two complementary layers, so nothing slips through EITHER a shape gap or a config gap:

  1. Regex masking (shape-based) for emails, phone numbers, long digit runs (card/account-like),
     and secret-ish tokens (sk-… keys, 32+ char opaque runs, JWTs, AWS access keys).
  2. An exact-value registry (identity-based): the process's OWN configured secrets — the real
     QWEN_API_KEY, SESSION_SECRET, OSS secret, etc. — scrubbed verbatim regardless of shape. A short
     or oddly-punctuated key that the regexes can't match still can't leak once it's registered, and
     we know its exact value at startup.

Deliberately conservative — it over-masks rather than leaks. Two call sites: `redact_event` for the
exported Tracks copy (the event log itself is never mutated), and `app.core.logging.JsonFormatter`
for every live log line — a raw exception message or a scraped page's content can carry the same
PII/secrets, and the log stream had no redaction at all until this second wiring.
"""

from __future__ import annotations

import re
from typing import Any

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
_PHONE = re.compile(r"(?<!\d)\+?\d[\d\s().-]{7,}\d(?!\d)")
# sk-... (OpenAI-style) / a bare 32+ char opaque run / a JWT (3 dot-separated base64url segments,
# each segment individually failing the 32-char floor so a short JWT wasn't caught before) /
# AWS-style access keys (AKIA/ASIA + 16 alnum, 20 chars total — under the 32-char floor).
_TOKEN = re.compile(
    r"\b(?:"
    r"sk-[A-Za-z0-9]{6,}"
    r"|[A-Za-z0-9_-]{32,}"
    r"|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"  # JWT
    r"|(?:AKIA|ASIA)[A-Z0-9]{16}"  # AWS access key id
    r")\b"
)

# Exact configured-secret values to scrub verbatim, longest-first (so a secret that is a substring of
# another is masked by the longer match first). Seeded lazily from `settings` on first use so import
# order and test monkeypatching of settings both work; refreshable via `refresh_secret_registry()`.
_SECRET_VALUES: list[str] | None = None
# Which settings fields hold a real secret. A value shorter than this is ignored — masking a 1-2 char
# "secret" (e.g. an unset/placeholder) would redact swathes of ordinary text. 8 is the shortest a real
# key would plausibly be while staying specific enough not to over-match.
_MIN_SECRET_LEN = 8
_SECRET_FIELDS = (
    "qwen_api_key",
    "qwen_voice_api_key",
    "search_api_key",
    "session_secret",
    "api_auth_token",
    "oss_access_key_secret",
    "oss_access_key_id",
    "exa_api_key",
    "serpapi_api_key",
    "youcom_api_key",
    "newsapi_key",
    "gnews_api_key",
    "newsdata_api_key",
    "jina_api_key",
    "firecrawl_api_key",
    "apify_api_key",
    "core_api_key",
    "github_token",
    "google_kg_api_key",
)

# Obvious non-secret placeholders that ship as defaults — never register these or we'd mask the literal
# string "change-me-in-prod" wherever it appears (including in warnings telling you to change it).
_SECRET_PLACEHOLDERS = frozenset({"change-me-in-prod", ""})


def _secret_values() -> list[str]:
    global _SECRET_VALUES
    if _SECRET_VALUES is None:
        from app.config import settings

        found: set[str] = set()
        for field in _SECRET_FIELDS:
            value = getattr(settings, field, "")
            if (
                isinstance(value, str)
                and len(value) >= _MIN_SECRET_LEN
                and value not in _SECRET_PLACEHOLDERS
            ):
                found.add(value)
        # Longest-first so a secret containing another as a substring masks fully before the shorter one.
        _SECRET_VALUES = sorted(found, key=len, reverse=True)
    return _SECRET_VALUES


def refresh_secret_registry() -> None:
    """Force the exact-value registry to re-read `settings` on next use — for tests that monkeypatch a
    secret after this module was first imported, and for a config reload."""
    global _SECRET_VALUES
    _SECRET_VALUES = None


def redact_text(text: str) -> str:
    # Exact configured secrets FIRST (identity beats shape) — a real key that doesn't match _TOKEN's
    # shape still can't leak once registered.
    for secret in _secret_values():
        if secret in text:
            text = text.replace(secret, "[secret]")
    text = _EMAIL.sub("[email]", text)
    text = _CARD.sub("[redacted-number]", text)
    text = _PHONE.sub("[phone]", text)
    text = _TOKEN.sub("[token]", text)
    return text


def redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {k: redact_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact_value(v) for v in value]
    return value


def redact_event(event: dict) -> dict:
    """Return a copy of the event with its payload redacted."""
    out = dict(event)
    if isinstance(out.get("payload"), dict):
        out["payload"] = redact_value(out["payload"])
    return out
