"""check-prompt-cache — spike script to verify DashScope prompt caching actually activates on
the pack's real account/endpoint before wiring it into QwenClient for real (Doc: prompt-caching
port from claw-code's ProviderCapabilityReport, gated behind `qwen_prompt_cache_enabled`).

DashScope's own docs (Alibaba Cloud Model Studio, "Context Cache feature for Qwen models")
describe a `cache_control: {"type": "ephemeral"}` marker on a message's content block, a 1024
cacheable-token minimum, and a 5-minute cache TTL — but the docs describe workspace-specific
endpoints that may differ from the pack's `qwen_base_url` (dashscope-intl.aliyuncs.com), so this
needs proving on the real key, not asserting from docs alone (same reason `scripts/hello_qwen.py`
exists for the thinking-mode gotcha).

This talks to the OpenAI SDK directly rather than through QwenClient — CallSpec's `messages` are
plain `{"role", "content": str}` dicts today, and cache_control requires `content` to become a
list of content blocks. Wiring that into the live client is a separate step, only worth doing
once this script confirms real cache hits.

    python scripts/check_prompt_cache.py
"""

from __future__ import annotations

import asyncio

from openai import AsyncOpenAI

from app.config import settings

# DashScope's minimum cacheable block is 1024 tokens (~4096 chars by our chars/4 heuristic) —
# pad the system prompt well past that so a real cache hit is even possible.
_PADDING = (
    "You are a research scout for a multi-agent hunt. Read every source carefully, weigh "
    "recency and credibility, and summarize only what the sources actually support. "
) * 40


async def main() -> None:
    if not settings.qwen_api_key:
        print("No QWEN_API_KEY set — nothing to probe. This script needs a real key.")
        return

    client = AsyncOpenAI(
        api_key=settings.qwen_api_key, base_url=settings.qwen_base_url, max_retries=0
    )
    print(f"base_url={settings.qwen_base_url}")

    system_message = {
        "role": "system",
        "content": [
            {"type": "text", "text": _PADDING, "cache_control": {"type": "ephemeral"}},
        ],
    }

    for turn in (1, 2):
        resp = await client.chat.completions.create(
            model=settings.qwen_model_flash,
            messages=[
                system_message,
                {"role": "user", "content": f"Reply with the word: pack{turn}"},
            ],
        )
        usage = resp.usage
        details = getattr(usage, "prompt_tokens_details", None)
        cached = getattr(details, "cached_tokens", None) if details else None
        print(f"  turn {turn}: prompt_tokens={usage.prompt_tokens} cached_tokens={cached}")

    print()
    print("If turn 2's cached_tokens is > 0, prompt caching works on this account/endpoint —")
    print("safe to wire cache_control into QwenClient behind qwen_prompt_cache_enabled.")
    print("If it's 0 or the field is missing, caching isn't activating here (wrong base_url /")
    print("workspace, model doesn't support it, or padding is still under the 1024-token floor).")


if __name__ == "__main__":
    asyncio.run(main())
