"""Live-key harness — the ONE place tests run against the REAL Qwen model, gated behind a key.

The rest of the suite is hermetic: `tests/conftest.py`'s autouse `_force_offline` blanks the key so
every test uses FakeQwen. This directory is the deliberate opposite — real calls, real assertions (not
print-and-eyeball), so a live regression fails a test run the same way an offline one does. It is GATED:

  * every live test SKIPS cleanly when QWEN_API_KEY is unset (so the default `pytest -q` is unaffected —
    a laptop or CI without a key just skips this dir), and
  * CI runs it only as a SEPARATE, opt-in job that first requires the offline suite to be green
    ("gated behind executable-green"), so a live flake can never mask an offline regression.

Run locally (with a key in .env or the environment):
    QWEN_API_KEY=... uv run pytest -q tests/live
"""

from __future__ import annotations

import os

import pytest
import pytest_asyncio

_REAL_KEY = os.environ.get("QWEN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY") or ""


def requires_live_key() -> pytest.MarkDecorator:
    """A skip marker each live test module applies (module-level `pytestmark = requires_live_key()`).
    A `pytestmark` defined in a conftest does NOT propagate to test modules, so the gate lives here as a
    reusable marker the modules opt into — keeps the default offline run green when no key is present."""
    return pytest.mark.skipif(
        not _REAL_KEY, reason="no QWEN_API_KEY/DASHSCOPE_API_KEY — live tests need a real key"
    )


@pytest_asyncio.fixture
async def live_client():
    """A QwenClient pointed at the REAL model. Skips (belt-and-braces, alongside the module marker) if
    no key. Overrides the autouse `_force_offline` by restoring the real key onto settings before
    constructing the client (offline is decided at construction from settings.qwen_api_key), so this
    client is genuinely online for the duration of the test."""
    if not _REAL_KEY:
        pytest.skip("no QWEN_API_KEY/DASHSCOPE_API_KEY — live tests need a real key")
    from app.config import settings
    from app.qwen.client import QwenClient

    saved = settings.qwen_api_key
    settings.qwen_api_key = _REAL_KEY
    try:
        client = QwenClient()
        assert not client.offline, "live_client must be online — check QWEN_API_KEY is a real key"
        yield client
    finally:
        settings.qwen_api_key = saved
