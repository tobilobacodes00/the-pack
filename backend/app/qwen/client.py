"""The Qwen client — the single chokepoint every model call passes through.

One place, so every call gets: tier resolution, per-call thinking mode, real token
accounting, retries + backoff, a circuit breaker, and structured output. We point the
OpenAI Python SDK at Qwen's OpenAI-compatible base URL.

OFFLINE SWITCH: if there is no `QWEN_API_KEY`, the client routes every call to the
deterministic `FakeQwen` instead of the network — zero change to the Supervisor or the
event stream once a real key lands.

THE GOTCHA: turning thinking ON requires streaming — a non-streamed thinking call FAILS on
Qwen. So thinking-mode wolves stream, which also yields live token counts.

The client RETURNS a `CompletionResult` (text + usage + cost). It never emits events itself
— the Supervisor turns the result into a `tokens_spent` event through the one Emitter, so
seq assignment stays in one place.
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    InternalServerError,
    RateLimitError,
)

from app.config import TIER_REGISTRY, settings
from app.qwen import pricing
from app.qwen.fake import FakeQwen
from app.qwen.types import CallSpec, CompletionResult

# Errors worth retrying: transient/transport/5xx/rate-limit. Never 4xx (bad request) —
# retrying a malformed call just wastes budget.
_TRANSIENT = (APIConnectionError, APITimeoutError, RateLimitError, InternalServerError)


def is_transient_provider_error(exc: BaseException) -> bool:
    """True only for a genuine provider failure (retry-exhausted transient error, or the breaker
    refusing to call) — False for a code defect (KeyError, schema-parse bug, etc). Lets the
    Supervisor tell real bugs apart from an actual DashScope outage in logs, even though the wire
    `stray_detected.pattern` enum only has room for one shared 'provider_error' value."""
    return isinstance(exc, (*_TRANSIENT, CircuitOpenError))


# A streaming sink the caller (Supervisor) supplies to observe text as it arrives, so it can
# emit throttled `wolf_progress` beats to the canvas. None => no streaming observation.
OnDelta = Callable[[str], Awaitable[None]]

# A single synchronous seam over the outgoing wire payload, run right before `create(**payload)`.
# Given the assembled kwargs dict, it may return a replacement dict (to mutate the request) or None
# (to leave it unchanged). One hook, not a chain — kept deliberately minimal. None => no interception.
OnPayload = Callable[[dict], "dict | None"]


def _loads_lenient(text: str, require: Callable[[dict], bool] | None = None) -> dict | None:
    """Parse a model's structured-output JSON, tolerating what strict json.loads rejects: real
    newlines/control chars inside string values (strict=False), and a stray ```fence or prose
    around the object. Returns None only if there's no usable object.

    `require`, if given, is an extra acceptance predicate — the first candidate that both parses
    AND satisfies it wins. The ONE lenient-model-output parser; `app.core.intake.parse_intake`
    reuses it rather than reimplementing the same fence/brace loop."""
    if not text:
        return None
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`").split("\n", 1)[-1]
    candidates = [stripped]
    if "{" in stripped and "}" in stripped:
        candidates.append(stripped[stripped.find("{") : stripped.rfind("}") + 1])
    for candidate in candidates:
        try:
            obj = json.loads(candidate, strict=False)
            if isinstance(obj, dict) and (require is None or require(obj)):
                return obj
        except json.JSONDecodeError:
            continue
    return None


def _cached_tokens(usage: object) -> int:
    """Extract `prompt_tokens_details.cached_tokens` off an OpenAI-SDK usage object. Never raises;
    degrades to 0 ("unknown/none served from cache") if the provider omits the field."""
    details = getattr(usage, "prompt_tokens_details", None)
    cached = getattr(details, "cached_tokens", None) if details is not None else None
    return cached if isinstance(cached, int) else 0


def _retry_after_seconds(exc: BaseException) -> float | None:
    """Parse a `Retry-After` header off a provider error (RFC 9110 §10.2.3) — delay-seconds or an
    HTTP-date. Returns seconds (clamped ≥0), or None with no honorable hint. A 429/503 naming its
    own cooldown should be honored rather than guessed at with blind backoff."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    raw = headers.get("retry-after")
    if not raw:
        return None
    raw = raw.strip()
    if raw.isdigit():  # delay-seconds form
        return float(raw)
    try:  # HTTP-date form
        when = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if when is None:
        return None
    if when.tzinfo is None:  # HTTP-date is GMT; treat a naive parse as UTC
        when = when.replace(tzinfo=UTC)
    return max(0.0, (when - datetime.now(UTC)).total_seconds())


class CircuitOpenError(RuntimeError):
    """Raised when the breaker is open — fail fast instead of hammering a dead endpoint."""


class _Breaker:
    """A tiny circuit breaker: open after N consecutive failures, cool down, then retry."""

    def __init__(self, threshold: int, cooldown_s: float) -> None:
        self._threshold = threshold
        self._cooldown_s = cooldown_s
        self._failures = 0
        self._opened_at: float | None = None

    def before(self) -> None:
        if self._opened_at is None:
            return
        if time.monotonic() - self._opened_at < self._cooldown_s:
            raise CircuitOpenError("Qwen circuit breaker is open")
        # Cooldown elapsed — allow one trial call (half-open).
        self._opened_at = None

    def on_success(self) -> None:
        self._failures = 0
        self._opened_at = None

    def on_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold:
            self._opened_at = time.monotonic()

    def is_idle(self) -> bool:
        """True once this breaker has no failures on record and isn't (or is no longer) open — safe
        to evict."""
        if self._opened_at is not None:
            return time.monotonic() - self._opened_at >= self._cooldown_s
        return self._failures == 0


class QwenClient:
    def __init__(self, on_payload: OnPayload | None = None) -> None:
        self.offline = not settings.qwen_api_key
        self._fake = FakeQwen()
        # The ONE seam over the request dict for both streaming and non-streaming paths — a caller can
        # supply request logging / header injection without editing the two create() call sites.
        self._on_payload = on_payload
        # One breaker PER HUNT, not a shared singleton — otherwise one hunt's 5 consecutive transient
        # failures would fail-fast every OTHER concurrent hunt for the full cooldown. Evicted once idle
        # so this dict never grows unbounded.
        self._breakers: dict[str, _Breaker] = {}
        self._client: AsyncOpenAI | None = None
        if not self.offline:
            self._client = AsyncOpenAI(
                api_key=settings.qwen_api_key,
                base_url=settings.qwen_base_url,
                # The SDK's own default retries would silently absorb transient failures before our
                # _TRANSIENT retry loop / breaker ever see them — we own retries end to end instead.
                max_retries=0,
            )

    def _model(self, tier: str) -> str:
        try:
            return TIER_REGISTRY[tier]
        except KeyError as exc:  # pragma: no cover - guardrail
            raise ValueError(f"unknown model tier: {tier!r}") from exc

    def _breaker_for(self, hunt_id: str) -> _Breaker:
        """Fetch (or create) this hunt's breaker, evicting any idle OTHER hunt's breaker — keeps the
        dict bounded without a background sweep."""
        for key in [k for k, b in self._breakers.items() if k != hunt_id and b.is_idle()]:
            del self._breakers[key]
        breaker = self._breakers.get(hunt_id)
        if breaker is None:
            breaker = _Breaker(settings.qwen_breaker_threshold, settings.qwen_breaker_cooldown_s)
            self._breakers[hunt_id] = breaker
        return breaker

    async def complete(self, spec: CallSpec, on_delta: OnDelta | None = None) -> CompletionResult:
        """Run one completion through the chokepoint. Offline → FakeQwen; online → Qwen.

        `on_delta`, if given, is awaited with each text fragment as it streams (and once with
        the full text for non-streamed calls), so the Supervisor can narrate live progress.
        """
        if self.offline:
            return await self._fake.complete(spec, on_delta)
        return await self._complete_real(spec, on_delta)

    def _check_request_size(self, messages: list[dict]) -> None:
        """Reject an oversized request before it reaches the network — a ValueError, not one of the
        _TRANSIENT retry-worthy errors, since a retry can't fix a payload that's too big."""
        size = len(json.dumps(messages).encode("utf-8"))
        if size > settings.qwen_max_request_bytes:
            raise ValueError(
                f"request body is {size} bytes, over the {settings.qwen_max_request_bytes}-byte "
                "limit for this provider"
            )

    async def _complete_real(
        self, spec: CallSpec, on_delta: OnDelta | None = None
    ) -> CompletionResult:
        self._check_request_size(spec.messages or [])
        model = self._model(spec.tier)
        extra_body: dict = {}
        if spec.thinking:
            extra_body["enable_thinking"] = True
            if spec.thinking_budget is not None:
                extra_body["thinking_budget"] = spec.thinking_budget

        response_format = self._response_format(spec)
        must_stream = (
            spec.thinking or spec.force_stream
        )  # thinking always needs stream; force_stream opts in without thinking

        breaker = self._breaker_for(spec.hunt_id)
        last_exc: Exception | None = None
        for attempt in range(settings.qwen_max_retries + 1):
            breaker.before()
            try:
                if must_stream:
                    result = await self._stream(model, spec, extra_body, response_format, on_delta)
                else:
                    result = await self._once(model, spec, extra_body, response_format, on_delta)
                breaker.on_success()
                result.retry_count = attempt
                return result
            except _TRANSIENT as exc:  # retry these
                last_exc = exc
                breaker.on_failure()
                if attempt < settings.qwen_max_retries:
                    # Jittered exponential backoff — bare 2**attempt would let every wolf retrying the
                    # same outage wake up in lockstep and thundering-herd the endpoint.
                    backoff = settings.qwen_backoff_base_s * (2**attempt)
                    backoff += random.uniform(0, settings.qwen_backoff_base_s)
                    # Never retry sooner than a provider-named cooldown (429/503 Retry-After); jitter
                    # on top so honoring wolves still don't sync up.
                    retry_after = _retry_after_seconds(exc)
                    if retry_after is not None:
                        backoff = max(
                            backoff, retry_after + random.uniform(0, settings.qwen_backoff_base_s)
                        )
                    await asyncio.sleep(backoff)
                continue
        assert last_exc is not None
        raise last_exc

    def _response_format(self, spec: CallSpec) -> dict | None:
        # THE THINKING FIX: DashScope 400s on a response_format while enable_thinking is on. Thinking
        # wolves send NO response_format and rely on their "ONLY JSON" prompt + the lenient parse in
        # _account. Non-thinking structured calls use json_object (json_schema support is spotty).
        if spec.response_schema is None or spec.thinking:
            return None
        return {"type": "json_object"}

    def _build_payload(
        self,
        model: str,
        spec: CallSpec,
        extra_body: dict,
        response_format: dict | None,
        *,
        stream: bool,
    ) -> dict:
        """Assemble the exact kwargs handed to `chat.completions.create` — the ONE place both
        `_once` and `_stream` build their wire payload, so a cross-cutting concern has a single seam
        instead of two divergent call sites. `on_payload`, if configured, runs on the assembled dict
        and may return a replacement (None leaves the payload as-is)."""
        payload: dict = {
            "model": model,
            "messages": spec.messages or [],
            "extra_body": extra_body or None,
            "response_format": response_format,
        }
        if stream:
            payload["stream"] = True
            payload["stream_options"] = {"include_usage": True}
        if self._on_payload is not None:
            mutated = self._on_payload(payload)
            if mutated is not None:
                payload = mutated
        return payload

    async def _once(
        self,
        model: str,
        spec: CallSpec,
        extra_body: dict,
        response_format: dict | None,
        on_delta: OnDelta | None = None,
    ) -> CompletionResult:
        payload = self._build_payload(model, spec, extra_body, response_format, stream=False)
        started = time.perf_counter()
        resp = await self._client.chat.completions.create(**payload)  # type: ignore[union-attr,call-overload]
        latency_ms = int((time.perf_counter() - started) * 1000)
        text = resp.choices[0].message.content or ""
        if on_delta and text:  # non-streamed call still surfaces one progress beat
            await on_delta(text)
        usage = resp.usage
        cached = _cached_tokens(usage)
        return self._account(
            spec, model, text, usage.prompt_tokens, usage.completion_tokens, cached, latency_ms
        )

    async def _stream(
        self,
        model: str,
        spec: CallSpec,
        extra_body: dict,
        response_format: dict | None,
        on_delta: OnDelta | None = None,
    ) -> CompletionResult:
        chunks: list[str] = []
        in_tokens = out_tokens = cached_tokens = 0
        payload = self._build_payload(model, spec, extra_body, response_format, stream=True)
        started = time.perf_counter()
        stream: AsyncIterator = await self._client.chat.completions.create(**payload)  # type: ignore[union-attr,call-overload]
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                delta = chunk.choices[0].delta.content
                chunks.append(delta)
                if on_delta:
                    await on_delta(delta)
            if getattr(chunk, "usage", None):  # final chunk carries usage
                in_tokens = chunk.usage.prompt_tokens
                out_tokens = chunk.usage.completion_tokens
                cached_tokens = _cached_tokens(chunk.usage)
        latency_ms = int(
            (time.perf_counter() - started) * 1000
        )  # wall-clock incl. full stream drain
        return self._account(
            spec, model, "".join(chunks), in_tokens, out_tokens, cached_tokens, latency_ms
        )

    def _account(
        self,
        spec: CallSpec,
        model: str,
        text: str,
        in_tokens: int,
        out_tokens: int,
        cached_tokens: int = 0,
        latency_ms: int = 0,
    ) -> CompletionResult:
        parsed: dict | None = None
        if spec.response_schema is not None:
            parsed = _loads_lenient(text)  # caller decides how to handle a non-JSON answer
        return CompletionResult(
            text=text,
            model=model,
            tier=spec.tier,
            in_tokens=in_tokens,
            out_tokens=out_tokens,
            cost_usd=pricing.cost(spec.tier, in_tokens, out_tokens),
            parsed=parsed,
            cached_tokens=cached_tokens,
            latency_ms=latency_ms,
        )
