"""Wire-level tests for QwenClient's REAL path (_complete_real/_once/_stream/retries/breaker).

`tests/conftest.py`'s `_force_offline` fixture pins every other test to FakeQwen, so this file is
the only place the client's non-streaming call, streaming/SSE assembly, retry-with-backoff loop,
circuit breaker, and request-size preflight ever actually run. respx mocks the httpx transport
`AsyncOpenAI` is built on — no real network, no real key needed.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.qwen.client import CircuitOpenError, QwenClient
from app.qwen.types import CallSpec

_BASE_URL = "https://test.invalid/v1"


def _client(monkeypatch, *, sleep_calls: list[float] | None = None, **overrides) -> QwenClient:
    """A real (online) QwenClient pointed at the test URL, with resilience knobs overridable
    per test so retry/breaker tests don't have to wait out the real defaults, and with
    asyncio.sleep replaced by a recorder so backoff tests run instantly."""
    monkeypatch.setattr("app.config.settings.qwen_api_key", "test-key", raising=False)
    monkeypatch.setattr("app.config.settings.qwen_base_url", _BASE_URL, raising=False)
    for key, value in overrides.items():
        monkeypatch.setattr(f"app.config.settings.{key}", value, raising=False)

    calls = sleep_calls if sleep_calls is not None else []

    async def _sleep(seconds: float) -> None:
        calls.append(seconds)

    monkeypatch.setattr("asyncio.sleep", _sleep)
    return QwenClient()


def _spec(**overrides) -> CallSpec:
    base = dict(
        hunt_id="hunt_1",
        wolf_id="scout-1",
        tier="flash",
        messages=[
            {"role": "system", "content": "You are a scout."},
            {"role": "user", "content": "Task: research widgets"},
        ],
    )
    base.update(overrides)
    return CallSpec(**base)


def _chat_completion(text: str) -> dict:
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": 0,
        "model": "qwen-flash",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}
        ],
        "usage": {"prompt_tokens": 50, "completion_tokens": 10, "total_tokens": 60},
    }


def _sse_chunk(
    content: str | None, *, finish_reason: str | None = None, usage: dict | None = None
) -> str:
    choices = []
    if content is not None or finish_reason is not None:
        choices = [
            {
                "index": 0,
                "delta": {"content": content} if content else {},
                "finish_reason": finish_reason,
            }
        ]
    payload = {
        "id": "chatcmpl-1",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "qwen-flash",
        "choices": choices,
    }
    if usage is not None:
        payload["usage"] = usage
    return f"data: {json.dumps(payload)}\n\n"


def _sse_stream(chunks: list[str]) -> str:
    return "".join(chunks) + "data: [DONE]\n\n"


@pytest.mark.respx(base_url=_BASE_URL)
async def test_non_streaming_structured_call_parses_body(monkeypatch, respx_mock):
    client = _client(monkeypatch)
    respx_mock.post("/chat/completions").mock(
        return_value=httpx.Response(200, json=_chat_completion('{"ok": true, "n": 3}'))
    )

    result = await client.complete(_spec(response_schema={"type": "object"}))

    assert result.parsed == {"ok": True, "n": 3}
    assert result.in_tokens == 50
    assert result.out_tokens == 10
    assert result.retry_count == 0


@pytest.mark.respx(base_url=_BASE_URL)
async def test_streaming_thinking_call_assembles_chunks_and_streams_deltas(monkeypatch, respx_mock):
    client = _client(monkeypatch)
    body = _sse_stream(
        [
            _sse_chunk("Hello"),
            _sse_chunk(" world"),
            _sse_chunk(None, finish_reason="stop"),
            _sse_chunk(
                None, usage={"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}
            ),
        ]
    )
    respx_mock.post("/chat/completions").mock(
        return_value=httpx.Response(
            200, content=body, headers={"content-type": "text/event-stream"}
        )
    )
    seen: list[str] = []

    async def on_delta(text: str) -> None:
        seen.append(text)

    result = await client.complete(_spec(thinking=True, thinking_budget=100), on_delta=on_delta)

    assert result.text == "Hello world"
    assert seen == ["Hello", " world"]
    assert result.in_tokens == 120
    assert result.out_tokens == 30


@pytest.mark.respx(base_url=_BASE_URL)
async def test_thinking_and_schema_never_send_response_format_together(monkeypatch, respx_mock):
    """THE THINKING FIX (client.py's _response_format): DashScope 400s on response_format while
    enable_thinking is on. Assert the outgoing body never carries both."""
    client = _client(monkeypatch)
    body = _sse_stream([_sse_chunk('{"ok": true}'), _sse_chunk(None, finish_reason="stop")])
    route = respx_mock.post("/chat/completions").mock(
        return_value=httpx.Response(
            200, content=body, headers={"content-type": "text/event-stream"}
        )
    )

    await client.complete(_spec(thinking=True, response_schema={"type": "object"}))

    sent = json.loads(route.calls.last.request.content)
    # The SDK sends the key explicitly as null rather than omitting it; either way, no
    # response_format was actually requested.
    assert sent.get("response_format") is None
    assert sent.get("enable_thinking") is True


@pytest.mark.respx(base_url=_BASE_URL)
async def test_transient_error_retries_then_succeeds(monkeypatch, respx_mock):
    sleep_calls: list[float] = []
    client = _client(
        monkeypatch, sleep_calls=sleep_calls, qwen_max_retries=3, qwen_backoff_base_s=0.1
    )
    route = respx_mock.post("/chat/completions").mock(
        side_effect=[
            httpx.ConnectError("boom"),
            httpx.ConnectError("boom"),
            httpx.Response(200, json=_chat_completion("ok")),
        ]
    )

    result = await client.complete(_spec())

    assert route.call_count == 3
    assert result.retry_count == 2
    assert len(sleep_calls) == 2
    # Jittered: base * 2**attempt <= observed < base * 2**attempt + base
    assert 0.1 <= sleep_calls[0] < 0.2
    assert 0.2 <= sleep_calls[1] < 0.3


@pytest.mark.respx(base_url=_BASE_URL)
async def test_circuit_breaker_opens_after_threshold_and_fails_fast(monkeypatch, respx_mock):
    client = _client(monkeypatch, qwen_max_retries=0, qwen_breaker_threshold=1)
    route = respx_mock.post("/chat/completions").mock(side_effect=httpx.ConnectError("boom"))

    with pytest.raises(Exception):  # noqa: B017 - the first call surfaces the raw transient error
        await client.complete(_spec())
    assert route.call_count == 1

    with pytest.raises(CircuitOpenError):
        await client.complete(_spec())
    assert route.call_count == 1  # breaker failed fast — no second HTTP call


@pytest.mark.respx(base_url=_BASE_URL, assert_all_called=False)
async def test_oversized_request_rejected_before_any_http_call(monkeypatch, respx_mock):
    client = _client(monkeypatch, qwen_max_request_bytes=200)
    route = respx_mock.post("/chat/completions").mock(
        return_value=httpx.Response(200, json=_chat_completion("ok"))
    )

    huge = _spec(messages=[{"role": "user", "content": "x" * 1000}])
    with pytest.raises(ValueError):
        await client.complete(huge)
    assert route.call_count == 0
