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
    # Must exceed the per-wolf budget sum of the largest boundary-gated team so a bigger/deeper
    # formation isn't silently throttled/halted. Worst case (5 scouts×0.10 + tracker 0.30 + sentinel
    # 0.20 + howler 0.40 + elder 0.05) = $1.45 (beta's plan call is NOT boundary-gated); 4.00 leaves
    # >2.5× headroom for reserve-then-reconcile. Lower via .env for cheap demos.
    first_hunt_cap_usd: float = 4.00

    # A wolf's single dispatch may not exceed this wall-clock before it's ruled a Stray and
    # rerouted (anomaly path — generous so only true hangs trip it). Measured: a plus+thinking scout
    # search runs ~4-6s, a critique ~6s, but Beta's plan call ~50s and a rich merge over 5 findings
    # ~90-130s — so 120s clipped the merge on real deep hunts, collapsing the whole synthesis to a
    # raw-findings paste. 180 gives the common calls headroom; the two big SYNTHESIS calls (merge,
    # draft) get the longer dedicated budget below.
    step_timeout_s: float = 180.0

    # The Tracker MERGE and Howler DRAFT are the two heaviest calls — a plus+thinking model
    # synthesizing every finding/claim into the whole brief. They legitimately take 90-180s+ and are
    # the calls that were silently timing out. Give them their own generous budget so the pack
    # actually produces its synthesis instead of falling back to pasting raw findings.
    synthesis_timeout_s: float = 300.0

    # Per-step budget for graceful shutdown (registry drain, background-task cancel, relay stop, bus
    # close, pool close). Each step races this timeout independently and a failing/hanging step is
    # logged and skipped rather than blocking the steps after it — so a stuck DB write on redeploy
    # can't also leak the connection pool by never reaching pool.close().
    shutdown_step_timeout_s: float = 10.0

    # A merge/draft that overruns even the synthesis budget is retried ONCE before the honest
    # fallback — a single transient slow call shouldn't collapse the whole brief to a raw-findings
    # paste. The retry runs under the same synthesis budget.
    synthesis_retries: int = 1

    # Web search (real research) — DuckDuckGo only (free, keyless; see search_provider.py). No model
    # key at all → the deterministic canned provider, so the whole engine still runs offline end to
    # end (Doc 04 §07).
    search_cache_ttl_s: float = 3600.0  # reuse identical searches/URL reads within the window
    # Fan-out timing: return at the SOFT deadline once we have any ground, extend to the hard
    # BUDGET only when still short, and let CONCURRENCY parallel scouts hit one upstream at once.
    # Sized to the MEASURED latency of DuckDuckGo (the sole default engine): ~5-6s per scout under a
    # full parallel pack for a first attempt, so the SOFT window clears that and a good first hit
    # returns promptly. The BUDGET is wider to cover DDG's own de-throttle path (pre-jitter up to
    # ~2.5s + request + one backed-off retry) without the fan-out guillotining a scout mid-retry —
    # that premature cutoff to 0 hits was the "dead ends" bug. Concurrency is generous so a 5-scout
    # pack never serialises on the one engine. Tighten these only if you re-enable faster upstreams.
    search_soft_s: float = 12.0
    search_budget_s: float = 20.0
    search_provider_concurrency: int = 12
    # Soft domain-diversity nudge in the cross-provider rank (a 2nd+ hit from the same host is pushed
    # down, never dropped; only kicks in with ≥3 distinct hosts so a single-source topic isn't hurt).
    search_domain_diversity: bool = True
    # Depth: how many of a scout's top hits to actually deep-read (web_fetch the full page), and how
    # much of each page to keep. Reading only the #1 hit left most sources snippet-only ("unverified")
    # and made briefs thin; reading the top few full pages gives the pack real material to write from.
    # Fetches run in parallel, and the assembled context is still bounded by qwen_context_budget_tokens
    # and the dollar Boundary — so deeper reads cost more per hunt but can't run away.
    scout_deep_reads: int = 5
    web_fetch_max_chars: int = 8000
    # How much of each deep-read page's full text to carry into the scout's summarization context,
    # and how many named sources per finding reach the merge. Loosened from the old 2500/4 that
    # starved the brief. `findings_sources_max` is depth-scaled (deeper → more) at the call site.
    hits_fulltext_chars: int = 3500
    findings_sources_max: int = 6
    # Chars kept per library doc injected into the draft, and per mid-hunt Packmaster input line.
    kb_pick_chars: int = 1000
    extra_input_chars: int = 1200

    # Research strategy — the selectable engine modes. ORTHOGONAL to the autonomy `mode`
    # (wild | on_signal | on_command): strategy shapes the plan, mode shapes execution.
    # One of: orchestrate | deep_dive | critique.
    default_strategy: str = "orchestrate"

    # Pricing — USD per 1M tokens (input, output) per tier. Entry-tier rates from Alibaba Cloud Model
    # Studio, international/Singapore endpoint (the deploy region). Long-prompt tiers cost more; these
    # are the conservative floor the Boundary projects against. Override via env if rates change.
    price_max_in_per_m: float = 1.60
    price_max_out_per_m: float = 6.40
    price_plus_in_per_m: float = 0.40
    price_plus_out_per_m: float = 1.20
    price_flash_in_per_m: float = 0.05
    price_flash_out_per_m: float = 0.40

    # LLM client resilience.
    qwen_max_retries: int = 3
    qwen_backoff_base_s: float = 0.5
    qwen_breaker_threshold: int = 5  # consecutive failures before the breaker opens
    qwen_breaker_cooldown_s: float = 30.0
    # DashScope's own documented cap is what should govern this in production; this default is a
    # starting point pending confirmation against the pack's actual account/region limit.
    qwen_max_request_bytes: int = 6_291_456  # 6 MB

    # Context sizing. Raised 24k→48k (≈192k chars, well under qwen_max_request_bytes) so the richer
    # 5-scout deep findings + numbered sources aren't silently truncated by fit_context's tail-drop.
    qwen_context_budget_tokens: int = 48_000  # soft cap on the assembled context string, not a
    # hard token count — see app/qwen/context_budget.py.

    # Prompt caching — PROVEN on the pack's real DashScope key/endpoint in the production shape
    # (tests/live/test_live_qwen.py + a live persona probe, 2026-07-14): the reordered, cache-marked
    # system prompt built by prompt_context._system_content is genuinely served from cache on turn 2.
    # The endpoint's real minimum is MUCH lower than the docs' 1024-token floor — the actual scout
    # persona (~325 tokens) served 256 tokens from cache. So this is ON, and the min-chars gate below
    # was RECALIBRATED down: at 4096 it suppressed caching on EVERY real wolf (all personas are
    # 481-2831 chars), making the flag a silent no-op.
    qwen_prompt_cache_enabled: bool = True
    # Attach the cache_control marker to any persona at/above this length. Set to 400 (~100 tokens) so
    # every real wolf persona — warden (481) through beta (2831) — gets marked; the live probe showed
    # personas this size DO cache on this endpoint (the docs' 1024-token floor does not apply here). A
    # block too short to cache just doesn't (no error, no cost), so err on the low side. NOT 4096: that
    # cleared no real persona and disabled caching entirely.
    qwen_prompt_cache_min_chars: int = 400

    # deep_scout — the ONE bounded model-driven tool-loop (app/engine/deep_scout.py), the study's
    # opt-in architecture bet. A deep_scout wolf gets up to `deep_scout_max_iterations` turns to CHOOSE
    # (search again / fetch a URL / finish) instead of the single-turn engine-scripted ladder. OFF by
    # default and gated the same way prompt caching is: it must be PROVEN on the live-key harness
    # (tests/live) before being trusted, because it changes cost/latency shape. The hard iteration cap
    # bounds spend regardless — each iteration still passes the per-wolf Boundary meter.
    deep_scout_enabled: bool = False
    deep_scout_max_iterations: int = 3


settings = Settings()

# Tier name -> configured model id. The Qwen client resolves tiers through this.
TIER_REGISTRY = {
    "max": settings.qwen_model_max,
    "plus": settings.qwen_model_plus,
    "flash": settings.qwen_model_flash,
}
