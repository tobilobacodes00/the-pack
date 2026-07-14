"""Unit tests for the new inline tools — file parsing, PII redaction, transcription fallback.
All run with no key and no network."""

from __future__ import annotations

from app.tools import file_parse
from app.tools.redact import redact_event, redact_text
from app.tools.transcribe import FakeTranscriber


def test_detect_kind() -> None:
    assert file_parse.detect_kind("report.pdf") == "pdf"
    assert file_parse.detect_kind("data.csv") == "csv"
    assert file_parse.detect_kind("notes.md") == "md"
    assert file_parse.detect_kind("x.txt") == "text"
    assert file_parse.detect_kind("blob", "application/pdf") == "pdf"


def test_parse_text_and_md() -> None:
    assert file_parse.parse_bytes(b"hello world", "text") == "hello world"
    assert "# Title" in file_parse.parse_bytes(b"# Title\n\nbody", "md")


def test_parse_csv() -> None:
    out = file_parse.parse_bytes(b"a,b,c\n1,2,3\n", "csv")
    assert "a | b | c" in out
    assert "1 | 2 | 3" in out


def test_parse_pdf_is_graceful_on_garbage() -> None:
    # Not a real PDF — must NOT raise; returns a readable note instead.
    out = file_parse.parse_bytes(b"not a pdf at all", "pdf")
    assert isinstance(out, str) and out  # some note, never an exception


def test_redact_pii() -> None:
    raw = "Reach me at jane.doe@example.com, card 4111 1111 1111 1111, key sk-abc123def456."
    out = redact_text(raw)
    assert "jane.doe@example.com" not in out and "[email]" in out
    assert "4111" not in out
    assert "sk-abc123def456" not in out


def test_redact_event_masks_payload_only() -> None:
    ev = {"type": "hunt_created", "payload": {"raw_input": "mail bob@acme.io"}}
    out = redact_event(ev)
    assert out["type"] == "hunt_created"
    assert "bob@acme.io" not in out["payload"]["raw_input"]


def test_redact_pii_catches_jwt_and_aws_key() -> None:
    # A short JWT (each dot-separated segment under the old 32-char floor) and an AWS access key id
    # (20 chars, also under the old floor) both slipped through the original token regex.
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ"
    aws_key = "AKIAABCDEFGHIJKLMNOP"  # AKIA + 16 chars = 20-char AWS access key id
    raw = f"Authorization: Bearer {jwt} and {aws_key}"
    out = redact_text(raw)
    assert jwt not in out
    assert aws_key not in out


def test_logging_redacts_secrets_in_every_log_line() -> None:
    # The JSON formatter is the ONE choke point every logging.getLogger("pack") call passes through —
    # redaction here covers every call site, not just the /tracks export.
    import io
    import logging

    from app.core.logging import JsonFormatter

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("pack.test_redact_logging")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.propagate = False
    logger.setLevel(logging.INFO)

    logger.warning("scout failed for user jane.doe@example.com: sk-abc123def456ghi789jkl012mno")

    out = stream.getvalue()
    assert "jane.doe@example.com" not in out
    assert "sk-abc123def456ghi789jkl012mno" not in out
    assert "[email]" in out and "[token]" in out


async def test_fake_transcriber_is_deterministic() -> None:
    t = FakeTranscriber()
    r1 = await t.transcribe(b"x" * 32_000)
    r2 = await t.transcribe(b"x" * 32_000)
    assert r1 == r2
    assert r1.provider == "qwen_asr"
    assert r1.duration_s == 1.0  # 32000 bytes / 32000 bytes-per-second
