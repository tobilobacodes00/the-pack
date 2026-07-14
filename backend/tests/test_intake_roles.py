"""Regression lock for THE intake launch bug (2026-07-14): the frontend tags Alpha's turns with the
role "alpha", but DashScope/OpenAI only accept system|assistant|user|tool|function. Sending "alpha"
back in the conversation history 400'd the whole call ("alpha is not one of [...]"), which surfaced to
the user as an intermittent "Something went wrong" and Alpha never launching the hunt. `_model_history`
normalizes roles before any history reaches the model; these pin that it does."""

from __future__ import annotations

from app.routers.hunts import _model_history

_STANDARD_ROLES = {"system", "assistant", "user", "tool", "function"}


def test_alpha_role_is_mapped_to_assistant() -> None:
    out = _model_history([{"role": "alpha", "content": "Hey, what are you working on?"}])
    assert out == [{"role": "assistant", "content": "Hey, what are you working on?"}]


def test_user_role_is_preserved() -> None:
    out = _model_history([{"role": "user", "content": "research the BNPL market"}])
    assert out == [{"role": "user", "content": "research the BNPL market"}]


def test_every_output_role_is_a_provider_accepted_role() -> None:
    """The exact multi-turn shape that used to 400: a conversation carrying prior 'alpha' turns. Every
    role that leaves the normalizer MUST be one DashScope accepts, or the whole completion 400s."""
    convo = [
        {"role": "user", "content": "hi"},
        {"role": "alpha", "content": "Hey — what are you working on?"},
        {"role": "user", "content": "a tech startup, research it and fetch me a report"},
        {"role": "alpha", "content": "On it — I'll put the pack on that."},
        {"role": "assistant", "content": "already-standard role stays"},
    ]
    out = _model_history(convo)
    assert len(out) == len(convo)
    assert all(m["role"] in _STANDARD_ROLES for m in out)
    # No "alpha" survives anywhere.
    assert not any(m["role"] == "alpha" for m in out)
    # Content is preserved verbatim, in order.
    assert [m["content"] for m in out] == [m["content"] for m in convo]


def test_empty_and_contentless_messages_are_dropped() -> None:
    out = _model_history(
        [
            {"role": "user", "content": "keep"},
            {"role": "alpha", "content": ""},
            {"role": "user"},  # no content key
            {"role": "alpha", "content": None},
        ]
    )
    assert out == [{"role": "user", "content": "keep"}]


def test_unknown_role_defaults_to_user() -> None:
    out = _model_history([{"role": "packmaster", "content": "custom role"}])
    assert out == [{"role": "user", "content": "custom role"}]
