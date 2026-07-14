"""PII redaction — the Tracks export AND every process log line (Doc 04).

Regex-based masking for emails, phone numbers, long digit runs (card/account-like), and
secret-ish tokens (API keys, JWTs, AWS access keys). Deliberately conservative — it over-masks
rather than leaks. Two call sites: `redact_event` for the exported Tracks copy (the event log
itself is never mutated), and `app.core.logging.JsonFormatter` for every live log line — a raw
exception message or a scraped page's content can carry the same PII/secrets, and the log stream
had no redaction at all until this second wiring.
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


def redact_text(text: str) -> str:
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
