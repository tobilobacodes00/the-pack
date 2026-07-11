"""Prometheus metrics — the RED signals (Rate, Errors, Duration) an SRE needs in prod.

Instrumented in the HTTP middleware (every request) and scraped at GET /metrics. Kept intentionally
small: a request counter + latency histogram labelled by the *route template* (not the raw path, so
hunt ids don't explode label cardinality), plus a live-hunts gauge read from the registry at scrape
time. Domain observability still lives in the typed event stream; this is the infra layer.
"""

from __future__ import annotations

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

REQUESTS = Counter(
    "pack_http_requests_total",
    "HTTP requests handled.",
    ["method", "route", "status"],
)
REQUEST_LATENCY = Histogram(
    "pack_http_request_duration_seconds",
    "HTTP request latency.",
    ["method", "route"],
)
ACTIVE_HUNTS = Gauge(
    "pack_active_hunts",
    "Hunts currently registered as running.",
)


def observe_request(method: str, route: str, status: int, seconds: float) -> None:
    REQUESTS.labels(method, route, str(status)).inc()
    REQUEST_LATENCY.labels(method, route).observe(seconds)


def render() -> tuple[bytes, str]:
    """Serialize the registry to the Prometheus text exposition format."""
    return generate_latest(), CONTENT_TYPE_LATEST
