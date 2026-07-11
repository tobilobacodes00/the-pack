"""Configuration — loaded from the environment, never hard-coded (Doc 04 §04).

Real model names, the region endpoint, and all secrets live in .env / the environment,
not in code. Verify the real Qwen model names in Model Studio on day 1 (F14).
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Qwen / Model Studio (OpenAI-compatible endpoint, region nearest Nigeria — D6).
    qwen_api_key: str = ""
    qwen_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    qwen_region: str = "ap-southeast-1"

    # Model-tier registry — pinned to what dashscope-intl serves, verified on a real key to accept
    # enable_thinking + prompt-JSON (Phase 1). The intl region exposes a dated snapshot for `plus`
    # but only floating aliases for `max`/`flash`, so those stay aliases. All are .env-overridable.
    qwen_model_max: str = "qwen-max"
    qwen_model_plus: str = "qwen-plus-2025-12-01"
    qwen_model_flash: str = "qwen-flash"
    qwen_model_vision: str = "qwen-vl-max"  # multimodal — reads images (Qwen-VL)

    # Voice (transcription) — access checked now, contract freezes Jun 16.
    qwen_voice_api_key: str = ""
    qwen_voice_base_url: str = ""
    qwen_voice_model: str = "paraformer-realtime-v2"

    # Seam + durable store.
    redis_url: str = "redis://localhost:6379/0"
    postgres_url: str = "postgresql://pack:pack@localhost:5432/pack"
    # Cloud Postgres (ApsaraDB RDS) usually wants TLS. Empty = no TLS (local Docker). Set to a
    # libpq sslmode — "require" (encrypt, no cert check) or "verify-full" (with a CA) — for prod.
    postgres_sslmode: str = ""

    # Artifact object store — Alibaba Cloud OSS (Object Storage Service). When all four are set the
    # engine offloads forged files (PDF/DOCX/PNG/…) to an OSS bucket instead of inlining base64 in
    # Postgres; the DB then holds only a small pointer, and downloads stream the bytes back from OSS.
    # ALL EMPTY → the local-disk fallback (oss_local_dir), so the whole app still runs with zero
    # cloud config. This is the pack's use of an Alibaba Cloud infrastructure API — see app/storage/oss.py.
    oss_bucket: str = ""
    oss_endpoint: str = ""  # e.g. https://oss-ap-southeast-1.aliyuncs.com (region nearest Nigeria)
    oss_access_key_id: str = ""
    oss_access_key_secret: str = ""
    oss_prefix: str = "artifacts/"  # key namespace inside the bucket
    oss_local_dir: str = ".artifact-store"  # disk fallback root when OSS is unconfigured

    # App.
    session_secret: str = "change-me-in-prod"
    engine_host: str = "0.0.0.0"
    engine_port: int = 8000
    # Optional shared bearer token gating every route (health/ready/share/docs stay open). Empty =
    # OFF (local-first, no login — D5). When set, requires `Authorization: Bearer <token>` — defense
    # in depth if the engine is reached directly. Browser traffic is gated at the edge by nginx Basic
    # auth (see deploy/), so the SPA never carries this token.
    api_auth_token: str = ""
    # Ops surface (all .env-overridable). CORS defaults open for local-only; lock down to expose.
    cors_origins: str = "*"  # comma-separated origin list, or "*"
    max_upload_mb: int = 25  # cap on uploaded files (/documents, /parse, /transcribe) — DoS guard
    db_pool_max_size: int = 10
    rate_limit_per_min: int = 0  # per-IP cap on expensive POSTs (0 = off; set >0 when exposed)
    # Ceiling on concurrently-running hunts. Each hunt is a long-lived background task holding DB
    # connections + LLM concurrency; without a cap an unbounded POST /hunts loop exhausts them. Hunts
    # past the cap get 429 (the dollar Boundary caps cost, not resources). 0 = off.
    max_concurrent_hunts: int = 20
    # Outbox relay: how many times to retry publishing one event before quarantining it to
    # dead_events (so a poison row can't wedge a hunt's tail forever). Retries are per sweep (~1s).
    max_relay_attempts: int = 5

    # Refuse to start if the pricing table looks misconfigured (rates below a sane floor). OFF by
    # default so a mis-set rate is a loud warning, not a boot failure; flip on in prod to hard-gate.
    strict_pricing: bool = False
    # Refuse to start if the app is left with default/blank secrets. OFF by default (local dev only
    # warns); set STRICT_SECRETS=true in prod so an unconfigured box can't boot wide open.
    strict_secrets: bool = False

    # Boundary — hard safety ceiling on a hunt's spend (the approved boundary is honored to this cap).
    # Must exceed the per-wolf budget sum of the largest team (~$1.30 for 5 scouts + support) so a
    # bigger formation isn't silently throttled/halted. Lower via .env for cheap demos.
    first_hunt_cap_usd: float = 3.00

    # A wolf's single dispatch may not exceed this wall-clock before it's ruled a Stray and
    # rerouted (anomaly path — generous so only true hangs trip it).
    step_timeout_s: float = 120.0

    # Web search (real research). An empty key falls back to the deterministic canned
    # provider, so the whole engine still runs offline end to end (Doc 04 §07).
    search_provider: str = "tavily"
    search_api_key: str = ""  # Tavily (the primary web-search vendor)
    search_max_results: int = 8
    search_cache_ttl_s: float = 3600.0  # reuse identical searches/URL reads within the window
    # Fan-out timing: return at the SOFT deadline once we have any ground, extend to the hard
    # BUDGET only when still empty, and let CONCURRENCY parallel scouts hit one upstream at once
    # (sized so a full pack doesn't pile up to zero hits). Tunable per environment via .env.
    search_soft_s: float = 2.5
    search_budget_s: float = 7.0
    search_provider_concurrency: int = 6
    # Depth: how many of a scout's top hits to actually deep-read (web_fetch the full page), and how
    # much of each page to keep. Reading only the #1 hit left most sources snippet-only ("unverified")
    # and made briefs thin; reading the top few full pages gives the pack real material to write from.
    # Fetches run in parallel, and the assembled context is still bounded by qwen_context_budget_tokens
    # and the dollar Boundary — so deeper reads cost more per hunt but can't run away.
    scout_deep_reads: int = 3
    web_fetch_max_chars: int = 5000

    # Multi-source research — every provider with a key present joins the fan-out; keyless ones
    # (Hacker News, Wikidata, DBpedia, OpenAlex) always run. ALL empty → canned offline provider.
    exa_api_key: str = ""
    serpapi_api_key: str = ""
    youcom_api_key: str = ""
    newsapi_key: str = ""
    gnews_api_key: str = ""
    newsdata_api_key: str = ""
    jina_api_key: str = ""
    firecrawl_api_key: str = ""
    apify_api_key: str = ""
    core_api_key: str = ""
    github_token: str = ""
    google_kg_api_key: str = ""
    openalex_mailto: str = ""

    # Research strategy — the selectable engine modes. ORTHOGONAL to the autonomy `mode`
    # (wild | on_signal | on_command): strategy shapes the plan, mode shapes execution.
    # One of: orchestrate | deep_dive | critique.
    default_strategy: str = "orchestrate"

    # Pricing — USD per 1M tokens (input, output) per tier. Placeholders in the right ballpark
    # for Qwen on Model Studio; confirm real numbers when the key lands and override via env.
    price_max_in_per_m: float = 1.60
    price_max_out_per_m: float = 6.40
    price_plus_in_per_m: float = 0.40
    price_plus_out_per_m: float = 1.20
    price_flash_in_per_m: float = 0.10
    price_flash_out_per_m: float = 0.40

    # LLM client resilience.
    qwen_max_retries: int = 3
    qwen_backoff_base_s: float = 0.5
    qwen_breaker_threshold: int = 5  # consecutive failures before the breaker opens
    qwen_breaker_cooldown_s: float = 30.0
    # DashScope's own documented cap is what should govern this in production; this default is a
    # starting point pending confirmation against the pack's actual account/region limit.
    qwen_max_request_bytes: int = 6_291_456  # 6 MB

    # Context sizing.
    qwen_context_budget_tokens: int = 24_000  # soft cap on the assembled context string, not a
    # hard token count — see app/qwen/context_budget.py.

    # Prompt caching — OFF by default. DashScope's context-cache feature is unverified against
    # the pack's actual endpoint/workspace; flip this on only after scripts/check_prompt_cache.py
    # confirms real cache hits (see PACK plan notes on prompt caching).
    qwen_prompt_cache_enabled: bool = False


settings = Settings()

# Tier name -> configured model id. The Qwen client resolves tiers through this.
TIER_REGISTRY = {
    "max": settings.qwen_model_max,
    "plus": settings.qwen_model_plus,
    "flash": settings.qwen_model_flash,
}
