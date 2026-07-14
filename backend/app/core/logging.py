"""Structured (JSON) logging with a request-correlation id that follows a hunt.

Two moving parts:
  * `request_id_var` — a ContextVar set by the HTTP middleware. Because `asyncio.create_task`
    copies the current context, a hunt spawned inside a request inherits that request's id, so the
    background Supervisor's log lines carry the id of the request that started the hunt (the
    correlation the plaintext logger couldn't provide).
  * `JsonFormatter` + `RequestIdFilter` — every record comes out as one JSON object with the level,
    logger, message, and request_id, so a log aggregator can index and correlate on it.
"""

from __future__ import annotations

import contextvars
import datetime as _dt
import json
import logging

from app.tools.redact import redact_text

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # Every log line passes through here — a hunt's exception messages and scraped page content can
        # carry emails/tokens/secrets, and this was previously the ONLY choke point that DIDN'T redact
        # (redact_event covered only the /tracks export copy, never the live process log). Redacting here
        # covers every current and future logging.getLogger("pack") call site with no per-call-site change.
        payload = {
            "ts": _dt.datetime.fromtimestamp(record.created, _dt.UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "msg": redact_text(record.getMessage()),
        }
        if record.exc_info:
            payload["exc"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    """Install the JSON formatter + request-id filter on the root handler (idempotent)."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIdFilter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
