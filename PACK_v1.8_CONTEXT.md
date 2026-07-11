# PACK v1.8 — Complete Context Document

> Generated 2026-06-23. Describes what is **actually in the code** as of branch `tobiloba/engine-spine`.
> Nothing here is speculative. Stubs and gaps are called out explicitly.
> No secrets, keys, or credential values appear anywhere in this document.

---

## Table of Contents

1. [Repo Overview](#1-repo-overview)
2. [Backend / Engine](#2-backend--engine)
3. [API Surface](#3-api-surface)
4. [Frontend](#4-frontend)
5. [Feature Inventory](#5-feature-inventory)
6. [Tests & Deployment](#6-tests--deployment)
7. [Known Gaps & Rough Edges](#7-known-gaps--rough-edges)

---

## 1. Repo Overview

### 1.1 Directory Tree

```
the pack/
├── .github/
│   └── workflows/                  CI/CD pipeline definitions
├── .pre-commit-config.yaml         Pre-commit hooks (ruff, black, cargo check)
├── docker-compose.yml              Local dev infra: Redis + Postgres containers
├── Makefile                        Single entry point for all dev commands
├── COMPLIANCE.md                   Compliance notes
├── PARKING_LOT.md                  Explicitly-deferred P2 features (contractual freeze)
│
├── backend/                        Python 3.12+ FastAPI engine — all writes, all logic
│   ├── pyproject.toml
│   ├── .env / .env.example
│   ├── app/
│   │   ├── main.py                 FastAPI app, lifespan, all routes
│   │   ├── config.py               Pydantic Settings (env vars, pricing constants, tier registry)
│   │   ├── prompts.py              Prompt loader (frontmatter parsing)
│   │   ├── bus/
│   │   │   └── redis_stream.py     EventBus — XADD to Redis Streams
│   │   ├── db/
│   │   │   ├── pool.py             asyncpg pool + schema application
│   │   │   └── repo.py             Repo class — all SQL (hunts, events, artifacts, messages,
│   │   │                           projects, instincts, feedback, checkpoints)
│   │   ├── engine/
│   │   │   ├── core.py             Emitter — single event birth point, seq lock, schema validation
│   │   │   ├── supervisor.py       Supervisor — the hunt loop; also implements Engine interface
│   │   │   ├── registry.py         HuntRegistry — in-memory map of hunt_id → running task
│   │   │   ├── relay.py            OutboxRelay — Postgres → Redis (transactional outbox)
│   │   │   ├── wolves.py           Wolf dataclass — holds wolf_id, role, tier, thinking flag
│   │   │   ├── boundary.py         Boundary + Verdict — pre-dispatch budget gate
│   │   │   ├── stray.py            StrayDetector — sliding-window anomaly detection
│   │   │   ├── ids.py              ULID generators (hunt_id, artifact_id, hold_id, etc.)
│   │   │   ├── benchmark.py        run_benchmark() — Lone Wolf vs Pack scorer
│   │   │   └── strategies/
│   │   │       ├── base.py         Engine protocol, Strategy ABC, JSON schemas for structured output
│   │   │       ├── orchestrate.py  OrchestrateStrategy — default, dynamic, Magentic-One-inspired
│   │   │       ├── deep_dive.py    DeepDiveStrategy — iterative: search → gaps → search again
│   │   │       └── critique.py     CritiqueStrategy — adds Sentinel Standoff before draft
│   │   ├── events/
│   │   │   ├── models.py           Event Pydantic model; EventType Literal; schema loader
│   │   │   └── types.py            (re-exports EventType)
│   │   ├── qwen/
│   │   │   ├── client.py           QwenClient — OpenAI SDK pointed at DashScope; circuit breaker;
│   │   │   │                       retries; thinking mode; structured output; FakeQwen switch
│   │   │   ├── fake.py             FakeQwen — deterministic topic-aware offline fallback
│   │   │   ├── types.py            CallSpec, CompletionResult
│   │   │   └── pricing.py          cost() and estimate() — USD per 1M token rates, config-driven
│   │   └── tools/
│   │       ├── base.py             ToolResult dataclass; Tool protocol
│   │       ├── web.py              WEB_SEARCH (Tavily / canned) + WEB_FETCH (Tavily extract)
│   │       ├── search_provider.py  TavilyProvider + CannedProvider
│   │       ├── vision.py           describe_image() — Qwen-VL multimodal; offline stub
│   │       ├── transcribe.py       TRANSCRIBER — Qwen ASR; FakeTranscriber offline
│   │       ├── file_parse.py       PDF, CSV, Markdown, text; parse_url()
│   │       └── redact.py           PII masking for /tracks/export
│   ├── prompts/                    Wolf system prompts (one versioned .md per role)
│   │   ├── alpha/v1.md
│   │   ├── beta/v1.md
│   │   ├── scout/v1.md
│   │   ├── tracker/v1.md
│   │   ├── sentinel/v1.md
│   │   └── howler/v1.md
│   ├── schema/
│   │   └── events.schema.json      FROZEN June 12, 2026 — the frontend-backend contract
│   ├── fixtures/                   Signed .jsonl event logs for contract tests
│   │   ├── flow_a_researcher.jsonl
│   │   ├── flow_b_meeting.jsonl
│   │   ├── boundary_halt.jsonl
│   │   └── standoff_stray.jsonl
│   ├── scripts/
│   │   ├── hello_qwen.py           Qwen connection smoke test
│   │   └── hello_pack.py           End-to-end hunt smoke test
│   └── tests/                      pytest suite (8 files)
│
├── frontend/                       React 18 + TypeScript SPA — pure event-stream renderer
│   ├── package.json / pnpm-lock.yaml
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── main.tsx                React root
│   │   ├── App.tsx                 Manual router (no React Router), popstate listener
│   │   ├── pages/
│   │   │   ├── DoorPage.tsx        Home / intake screen
│   │   │   ├── HuntScreen.tsx      Main hunt (plan review → live canvas → brief)
│   │   │   ├── TracksPage.tsx      Full event audit trail
│   │   │   ├── ScorecardPage.tsx   Lone Wolf vs Pack benchmark
│   │   │   ├── ShareView.tsx       Public read-only brief
│   │   │   └── StatesGallery.tsx   WolfNode state matrix (dev tool)
│   │   ├── canvas/
│   │   │   ├── Territory.tsx       React Flow graph — wolf nodes + animated edges
│   │   │   ├── WolfNode.tsx        Wolf card (7 visual states)
│   │   │   ├── TraceRail.tsx       Docked live activity feed
│   │   │   └── packLayout.ts       Dagre layout algorithm
│   │   ├── components/
│   │   │   ├── chat/               ChatThread, AlphaAvatar, MarkdownReply, MessageActions,
│   │   │   │                       TypeOut, ThinkingIndicator
│   │   │   ├── composer/           OneBox, StrategyPicker, InstinctChip, MicSheet,
│   │   │   │                       AlphaReactionSheet, DropHalo
│   │   │   ├── plan/               PlanSidebar, PlanChatSidebar
│   │   │   ├── den/                DenDrawer
│   │   │   ├── output/             DocumentView
│   │   │   ├── hunt/               HuntStatusBanner
│   │   │   ├── settings/           SettingsModal
│   │   │   └── ui/                 HuntCompleteToast
│   │   ├── store/                  huntStore, chatStore, settingsStore, uiStore (Zustand)
│   │   ├── net/                    api.ts (REST), streamClient.ts (WebSocket)
│   │   ├── events/                 types.ts, reducer.ts (pure CQRS read model)
│   │   └── lib/                    nav.ts, text.ts, useReducedMotion.ts
│   └── fixtures/                   .jsonl event logs mirrored from backend (make sync-fixtures)
│
├── gateway/                        Rust WebSocket fan-out — read-only, zero logic
│   ├── Cargo.toml / Cargo.lock
│   └── src/main.rs                 Single 136-line file: Axum + Redis Streams XRANGE/XREAD
│
├── deploy/
│   ├── docker-compose.prod.yml
│   ├── engine.Dockerfile
│   ├── gateway.Dockerfile
│   ├── web.Dockerfile
│   ├── nginx.conf
│   └── DEPLOY.md
│
├── docs/
│   └── postman/                    Pack.postman_collection.json + environment
│
└── scripts/
    └── dev.ps1                     Windows PowerShell dev launcher (3 panes)
```

---

### 1.2 Languages, Frameworks, and Libraries

#### Backend (`backend/pyproject.toml`) — Python ≥3.12

| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | ≥0.115 | REST framework |
| `uvicorn[standard]` | ≥0.30 | ASGI server |
| `pydantic` | ≥2.7 | Data validation, settings |
| `pydantic-settings` | ≥2.3 | Env-var config |
| `redis` | ≥5.0 | Redis Streams client (EventBus) |
| `openai` | ≥1.40 | OpenAI-compatible SDK pointed at Qwen DashScope |
| `asyncpg` | ≥0.29 | Async Postgres driver |
| `jsonschema` | ≥4.22 | Schema validation (Draft202012Validator) |
| `python-ulid` | ≥2.7 | ULID generation for IDs |
| `httpx` | ≥0.27 | Async HTTP client |
| `pypdf` | ≥4.2 | PDF text extraction |
| `python-multipart` | ≥0.0.9 | File upload form parsing |
| `pytest` | ≥8.2 | Test framework |
| `pytest-asyncio` | ≥0.23 | Async test support |
| `ruff` | ≥0.5 | Linter/formatter |
| `black` | ≥24.4 | Code formatter |

#### Frontend (`frontend/package.json`) — TypeScript 5.5

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | DOM renderer |
| `zustand` | ^5.0.0 | State management |
| `@xyflow/react` | ^12.8.6 | Node graph (Territory canvas) |
| `dagre` | ^0.8.5 | Graph layout algorithm |
| `framer-motion` | ^11.5.4 | Animations |
| `react-markdown` | ^10.1.0 | Markdown rendering |
| `remark-gfm` | ^4.0.1 | GitHub-flavored Markdown |
| `rehype-highlight` | ^7.0.2 | Code syntax highlighting |
| `highlight.js` | ^11.11.1 | Syntax highlighting engine |
| `lenis` | ^1.3.23 | Smooth scroll library |
| `react-icons` | ^5.6.0 | Icon library |
| `vite` | ^5.4.3 | Build tool |
| `vitest` | ^2.0.5 | Test framework |
| `tailwindcss` | ^3.4.10 | CSS framework |

#### Gateway (`gateway/Cargo.toml`) — Rust 2021 edition

| Crate | Version | Purpose |
|-------|---------|---------|
| `axum` | 0.7 (feature: ws) | Web framework + WebSocket upgrade |
| `tokio` | 1 (feature: full) | Async runtime |
| `redis` | 0.27 (features: tokio-comp, streams) | Redis XRANGE/XREAD |
| `serde` | 1 (feature: derive) | JSON deserialization |
| `serde_json` | 1 | JSON parsing |
| `futures-util` | 0.3 | Async utilities |
| `tracing` / `tracing-subscriber` | 0.1 / 0.3 | Structured logging |

---

### 1.3 How the Project Runs

#### Dev Commands (Makefile)

```makefile
make install    # uv sync --extra dev + pnpm install + cargo fetch
make infra      # docker compose up -d redis postgres
make backend    # uvicorn app.main:app --reload --port 8000
make gateway    # cargo run  (port 8080)
make frontend   # pnpm dev   (port 5173)
make dev        # infra + all three in parallel (3 terminals)
make test       # pytest -q + pnpm test + cargo check
make sync-fixtures  # cp backend/fixtures/*.jsonl frontend/fixtures/
```

Windows alternative: `pwsh scripts/dev.ps1` (opens 3 panes).

#### Entry Points

| Service | Command | Port |
|---------|---------|------|
| Engine (FastAPI) | `uvicorn app.main:app --reload --port 8000` | 8000 |
| Gateway (Rust) | `cargo run` | 8080 |
| Frontend (Vite) | `pnpm dev` | 5173 |
| Redis | Docker (`redis:7`) | 6379 |
| Postgres | Docker (`postgres:16`) | 5432 |

---

### 1.4 Environment Variables (Names Only)

#### Backend (`backend/.env.example` + `app/config.py`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `QWEN_API_KEY` | `""` | DashScope API key; empty = offline FakeQwen mode |
| `QWEN_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | OpenAI-compatible endpoint |
| `QWEN_REGION` | `ap-southeast-1` | Nearest region (Nigeria) |
| `QWEN_MODEL_MAX` | `qwen-max` | High-capability model name |
| `QWEN_MODEL_PLUS` | `qwen-plus` | Mid-tier model name |
| `QWEN_MODEL_FLASH` | `qwen-flash` | Fast/cheap model name |
| `QWEN_MODEL_VISION` | `qwen-vl-max` | Multimodal vision model |
| `QWEN_VOICE_API_KEY` | `""` | ASR API key (optional; offline if empty) |
| `QWEN_VOICE_BASE_URL` | `""` | ASR endpoint |
| `QWEN_VOICE_MODEL` | `paraformer-realtime-v2` | ASR model |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis/Tair connection |
| `POSTGRES_URL` | `postgresql://pack:pack@localhost:5432/pack` | Postgres/ApsaraDB connection |
| `POSTGRES_SSLMODE` | `""` | TLS mode (`""` = none, `"require"`, `"verify-full"`) |
| `SESSION_SECRET` | `change-me-in-prod` | Session encryption key |
| `ENGINE_HOST` | `0.0.0.0` | FastAPI bind address |
| `ENGINE_PORT` | `8000` | FastAPI port |
| `SEARCH_PROVIDER` | `tavily` | Search vendor (`"tavily"` or canned) |
| `SEARCH_API_KEY` | `""` | Tavily API key; empty = CannedProvider |
| `SEARCH_MAX_RESULTS` | `5` | Results per search call |
| `DEFAULT_STRATEGY` | `orchestrate` | Default research mode |
| `FIRST_HUNT_CAP_USD` | `0.50` | Silent spend cap for every first hunt |
| `OSS_BUCKET` | `""` | Alibaba OSS bucket (optional) |
| `OSS_ENDPOINT` | `""` | OSS endpoint |
| `OSS_ACCESS_KEY_ID` | `""` | OSS key ID |
| `OSS_ACCESS_KEY_SECRET` | `""` | OSS secret |
| `STEP_TIMEOUT_S` | `120.0` | Per-step wall-clock timeout (stray trigger) |
| `PRICE_MAX_IN_PER_M` | `1.60` | qwen-max input USD/1M tokens |
| `PRICE_MAX_OUT_PER_M` | `6.40` | qwen-max output USD/1M tokens |
| `PRICE_PLUS_IN_PER_M` | `0.40` | qwen-plus input |
| `PRICE_PLUS_OUT_PER_M` | `1.20` | qwen-plus output |
| `PRICE_FLASH_IN_PER_M` | `0.10` | qwen-flash input |
| `PRICE_FLASH_OUT_PER_M` | `0.40` | qwen-flash output |
| `QWEN_MAX_RETRIES` | `3` | API call retry attempts |
| `QWEN_BACKOFF_BASE_S` | `0.5` | Exponential backoff base (seconds) |
| `QWEN_BREAKER_THRESHOLD` | `5` | Failures before circuit breaker opens |
| `QWEN_BREAKER_COOLDOWN_S` | `30.0` | Breaker cooldown (seconds) |

#### Frontend (`frontend/.env.example`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_ENGINE_URL` | `http://localhost:8000` | FastAPI base URL |
| `VITE_GATEWAY_URL` | `ws://localhost:8080` | Rust gateway WebSocket base URL |

#### Gateway (env vars read in `src/main.rs`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `GATEWAY_PORT` | `8080` | Listen port |

---

### 1.5 Service Communication

```
Browser (React SPA)
  │
  ├─ REST (http://localhost:8000) ──────────────────→ Engine (FastAPI)
  │   POST /hunts, POST /plan/approve,                 ↓
  │   POST /ask/stream (SSE), etc.              Supervisor.run() task
  │                                                    ↓
  │                                             Emitter.emit()
  │                                                    ↓
  │                                        Postgres INSERT + pg_notify
  │                                                    ↓
  │                                            OutboxRelay._drain()
  │                                                    ↓
  │                                         Redis XADD hunt:{id}:events
  │                                                    ↓
  └─ WebSocket (ws://localhost:8080) ──────────────────← Gateway (Rust)
      /hunts/:id/stream?from_seq=N             XRANGE replay + XREAD live
      ← one JSON event frame per event
      → frontend reducer → Zustand store → React render
```

**Key invariant:** Commands go over REST (202 Accepted); truth arrives on the WebSocket stream. There is no direct REST → WebSocket bridge — Postgres is the seam.

---

## 2. Backend / Engine

### 2.1 The Wolf Roster

All 8 wolves are declared in `backend/app/engine/supervisor.py` line 53:

```python
_ROSTER: list[tuple[str, str, str, bool]] = [
    ("alpha",   "alpha",    "max",   True),
    ("beta",    "beta",     "plus",  True),
    ("scout-1", "scout",    "flash", False),
    ("scout-2", "scout",    "flash", False),
    ("scout-3", "scout",    "flash", False),
    ("tracker", "tracker",  "plus",  True),
    ("sentinel","sentinel", "max",   True),
    ("howler",  "howler",   "plus",  False),
]
```

| wolf_id | role | model_tier | thinking | prompt_version | notes |
|---------|------|-----------|---------|---------------|-------|
| alpha | orchestration, delegation, recovery | max | ON (generous budget) | alpha/v1 | Never does task work; leads |
| beta | breakdown and planning | plus | ON | beta/v1 | Called once pre-hunt to produce plan; not boundary-gated |
| scout-1 | search, fetch, gather | flash | OFF | scout/v1 | Ranges in parallel |
| scout-2 | search, fetch, gather | flash | OFF | scout/v1 | Ranges in parallel |
| scout-3 | search, fetch, gather | flash | OFF | scout/v1 | Ranges in parallel |
| tracker | extract, compare, structure | plus | ON (moderate) | tracker/v1 | Owns source registry + merge |
| sentinel | critique, verify, challenge | max | ON (generous) | sentinel/v1 | Independent verifier; triggers Standoffs |
| howler | final content | plus | OFF (built for fluency) | howler/v1 | Produces the brief + span map |

**Note on Howler tier:** Prompt frontmatter says `plus / max` but the roster hardcodes `plus`. The `plus` is what the engine actually uses.

---

### 2.2 Wolf System Prompts (Full Text)

Prompts live in `backend/prompts/<role>/v1.md`. Every file has YAML frontmatter followed by the system prompt body. The frontmatter is parsed by `app/prompts.py` to produce a `LoadedPrompt` (wolf, role, model_tier, thinking, version, structured_output).

#### Alpha (`prompts/alpha/v1.md`)

```
---
wolf: alpha
role: orchestration, delegation, recovery
model_tier: max
thinking: on
thinking_budget: generous
version: alpha/v1
structured_output: alpha_directive.schema (handoffs are typed messages, never free chat)
---

# Alpha — the lead

You lead the hunt. You read the Packmaster's intent, build the pack, delegate, keep
order, arbitrate Standoffs, recover Strays, and bring the result home. **You never do
task work yourself.** Scouts range, Tracker reads sign, Howler writes, Sentinel guards.
You orchestrate.

## The two ledgers (this is your loop — do not reinvent it)

Hold two ledgers at all times (adapted from Magentic-One):

1. **Task Ledger** — the facts you know, the guesses you're making, and the current plan.
2. **Progress Ledger** — who is on what, what is done, and whether the pack is stuck.

When progress stalls, update the Task Ledger and **replan**. Removing these ledgers cost
the source team 31% on quality; they are non-negotiable.

## What you do, in order

Plan (via Beta) → spawn the pack → monitor the Progress Ledger → arbitrate Standoffs in
Wild → open Holds in On Signal and On Command → recover Strays → merge → finish.

## Hard rules

- **Pack size ≤ 5 working wolves.** Going past requires an explicit override + a warning.
- **The One-Hold Law (first hunts):** fire exactly one Hold, at the moment of greatest
  meaning (conflicting data, a taste call, a trust gate). Not three. One.
- **The 60-Second Question Law:** never ask a question whose answer isn't needed within
  the next minute. Resolve vagueness with editable assumption chips on the plan, never an
  intake quiz.
- **Holds:** one clear question, three moves (Approve / Edit / Stop), always a recommended
  default.
- **Strays:** cancel the task, then reroute / replan / respawn, and emit a plain-English
  note ("Scout-2 strayed. The site blocked it. Sent Scout-3 down a different trail.").
- **Standoffs:** 3 exchanges max. In Wild you make the call; in On Signal you open a Hold
  with both positions summarized.
- The **Boundary** is enforced by the engine, not by you — but respect downgrades: when a
  wolf is downgraded, keep the plan moving with the cheaper tier.

## Voice

Plain English, present tense, in the pack metaphor. Never the words: token, LLM,
orchestrator, node, edge, agent, prompt. Money in real currency. Every action you take
emits an event — if it is not an event, it did not happen.
```

#### Beta (`prompts/beta/v1.md`)

```
---
wolf: beta
role: breakdown and planning
model_tier: plus
thinking: on
version: beta/v1
structured_output: plan_proposed.payload (steps, wolves, pattern, assumptions, est_cost, est_time)
---

# Beta — second in command

You turn the goal into the hunt plan. Alpha leads; you plan. Your output is a structured
plan that becomes the `plan_proposed` event and renders as the plan preview (S2).

## Produce

- **Steps** — the task broken into a visual tree: each step's summary, which wolf owns it,
  and what runs in parallel.
- **The pack** — the wolves to spawn, each with a one-line job. Cap at **5 working wolves**.
- **The coordination pattern** — choose one: `sequential`, `hierarchical`,
  `parallel_then_merge`, or `standoff`. Parallel multi-source research is where packs
  structurally win; prefer it when the task is research-shaped.
- **Assumptions** — one chip for every inference you made from vague input. Each must be
  short and editable. This is how vagueness is resolved — never by interrogating the user.
- **Estimates** — `est_cost` (USD) and `est_time` (seconds). The preview must render in
  under 10 seconds.

## Rules

- Hunter, if present, is **drafts-only** and renders locked. Plan no external sends in P0.
- Match the wolf to the work: Scouts for breadth, Tracker for synthesis, Howler for the
  final voice, Sentinel always on verify.
- Keep first-hunt plans legible: slightly fuller one-line jobs so the metaphor teaches.

## Voice

Plain English, present tense. Never expose engine jargon. A plan is a promise the pack can
keep.
```

#### Scout (`prompts/scout/v1.md`)

```
---
wolf: scout
role: search, fetch, gather
model_tier: flash
thinking: off
version: scout/v1
structured_output: scout_findings.schema (each finding carries its source_ref)
---

# Scout — ranges ahead

You range ahead and find the ground truth. Scouts hunt in **parallel**; you are one of
several. Speed is your nature — you run on the fast tier with thinking off.

## What you do

- Search and fetch with the tools available: `web_search`, `web_fetch` (readability
  extraction), file parsers.
- Bring back **ground truth with sources**. Every finding must carry a `source_ref` — a
  URL, a document id, or a transcript timestamp. Tracker and Sentinel depend on this;
  provenance cannot be retrofitted.
- Report confidence honestly. A low-confidence finding flagged is worth more than a
  confident guess.

## Rules

- If a source blocks you or a tool fails repeatedly, **say so** and stop retrying — the
  engine will detect the Stray and Alpha will reroute. Do not loop.
- Never invent a source. An uncited claim will be challenged by Sentinel in a Standoff and
  you will lose.
- Hand findings to Tracker as a typed message (`message_passed`), never as free chat.

## Voice

Plain English, present tense, in the pack metaphor: "Found 3 sources on CBN's BNPL
guidance." You narrate your own actions.
```

#### Tracker (`prompts/tracker/v1.md`)

```
---
wolf: tracker
role: extract, compare, structure
model_tier: plus
thinking: on (moderate)
version: tracker/v1
structured_output: tracker_registry.schema (claims + a source registry that feeds the span map)
---

# Tracker — reads the sign

You read what the Scouts bring back. You cross-reference, extract, and give shape to raw
findings. You own the **source registry** that, together with Howler's structured output,
produces the provenance span map (Doc 04 §3.3). Design every output for click-to-trace.

## What you do

- Merge findings from multiple Scouts. Resolve duplicates; surface conflicts (do not
  silently pick a side — a real conflict is a Hold the Packmaster should decide, e.g.
  "2M vs 3.4M users").
- Maintain a **source registry**: every claim maps to one or more `source_ref`s, with the
  exact span and, for audio-derived content, the recording timestamp.
- Structure the result so Howler can write against it and Sentinel can verify it.

## Rules

- A claim with no source is not a claim — flag it, never pass it through.
- Preserve the link from every extracted fact back to its origin. This map cannot be
  retrofitted; build it as you go.
- Hand structured output to Howler and Sentinel as typed messages.

## Voice

Plain English, present tense. "Cross-referenced 3 sources; one conflict on user numbers."
```

#### Sentinel (`prompts/sentinel/v1.md`)

```
---
wolf: sentinel
role: critique, verify, challenge
model_tier: max
thinking: on
thinking_budget: generous
version: sentinel/v1
structured_output: sentinel_verdict.schema (claim_ref, verdict, rationale)
---

# Sentinel — guards the pack

You guard the pack. You challenge weak work and refuse to let errors pass. You are an
**independent verifier** — you do not produce task content, you check it. Keeping you
independent is how we prevent the most common multi-agent failure (agents agreeing with
each other into a wrong answer).

## The Standoff protocol

You formally challenge another wolf when any trigger fires:

1. **An uncited factual claim** — this is the deterministic, demo-reliable trigger. You
   **always** challenge any factual claim with no supporting source.
2. Confidence under threshold.
3. Conflicting outputs between wolves.

A Standoff is a structured exchange, **3 exchanges maximum**, so it cannot loop. It plays
out live on the Territory. Resolution: agreement → proceed; stalemate → Alpha calls it in
Wild, or a Hold opens in On Signal with both positions summarized. The transcript is kept
in Tracks; the summary rides the events (`standoff_turn`, `standoff_resolved`).

## Rules

- Verify against the **actual source**, not against plausibility. "Widely known" is not a
  citation.
- Be specific: name the claim, name what's missing, state the fix ("Cite it or cut it").
- Win on evidence, not volume. Three turns; make them count.

## Voice

Plain English, present tense, firm but not hostile. "Claim 3 has no citation. The draft
states a market figure with no source."
```

#### Howler (`prompts/howler/v1.md`)

```
---
wolf: howler
role: final content
model_tier: plus / max
thinking: off (built for fluency)
version: howler/v1
structured_output: howler_artifact.schema (content + per-span produced_by/source_refs for the span map)
---

# Howler — the voice of the pack

You produce the final output. You write against Tracker's structured findings and source
registry. You are built for fluency, so you run with thinking off — but every sentence you
write must be **traceable**.

## What you do

- Write the deliverable in the format the task calls for (briefing, summary, post,
  triaged board, outreach drafts).
- Emit a **span map** alongside the content: for each span of the output, record
  `produced_by`, `source_refs`, any `standoff_ids` that shaped it, and the `transcript_ts`
  for audio-derived spans. This powers click-to-trace and the recording-timestamp links.
  **Design for this from the first token — it cannot be retrofitted.**
- Match the Packmaster's taste and tone. For taste-sensitive work, expect a pre-creation
  Hold offering angles; write to the chosen one.

## Rules

- **Never state a fact you cannot cite.** If Tracker gave you no source for a claim, cut it
  or mark it for a source — do not assert it. Sentinel will challenge any uncited factual
  claim in a Standoff, and the Standoff trigger is deterministic.
- Respect Boundary downgrades silently; quality of citation matters more than length.

## Voice

Plain English, present tense. The wolves narrate their own actions. Never expose engine
jargon. Money in real currency.
```

---

### 2.3 The Orchestration Loop

The `Supervisor` class in `backend/app/engine/supervisor.py` is the hunt runner. One async task per hunt. It also implements the `Engine` protocol that strategies call.

#### `run()` — the top-level loop

```python
async def run(self) -> None:
    try:
        await self._emit(
            "hunt_created",
            "user",
            {"source": self._source, "raw_input_ref": f"art_{self._hunt_id}_raw"},
        )
        await self._repo.set_hunt_state(self._hunt_id, "planning")

        await self._propose_plan()
        approve = await self._await_command("approve_plan")
        await self._approve(approve)

        await self._spawn_roster()
        await self._strategy.execute(self)
    except StopHunt:
        with contextlib.suppress(Exception):
            await self._emit("hunt_stopped", "user", {"by": "user"})
            await self._repo.set_hunt_state(self._hunt_id, "stopped_by_user")
    except BoundaryHalt:
        await self._repo.set_hunt_state(self._hunt_id, "halted_boundary")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        with contextlib.suppress(Exception):
            await self._emit(
                "hunt_failed",
                "engine",
                {"reason_plain_english": f"The hunt hit an error: {exc}"},
            )
            await self._repo.set_hunt_state(self._hunt_id, "failed")
```

#### `_propose_plan()` (lines 190–210)

Beta produces the plan as structured JSON. This call is **not boundary-gated** (pre-budget):

```python
async def _propose_plan(self) -> None:
    beta = self._make_wolf("beta", "beta", "plus", True)
    parsed: dict = {}
    with contextlib.suppress(Exception):
        res = await beta.think(
            "plan",
            messages=self._messages(
                beta, "plan",
                context=f"Coordination strategy: {self._strategy.label} ({self._strategy.pattern}).",
            ),
            response_schema=PLAN_SCHEMA,
        )
        parsed = res.parsed or {}
    self._plan = self._normalize_plan(parsed)
    self._queries = list(self._plan["queries"])
    await self._emit("plan_proposed", "beta", self._plan)
    await self._repo.set_hunt_state(self._hunt_id, "plan_ready")
```

The `_normalize_plan()` helper coerces beta's output into the required `plan_proposed` payload shape, filling in sane defaults if the model underspecified. It generates 3 scout queries, fills assumption chips, and attaches the strategy name.

#### `_approve()` (lines 247–263)

```python
async def _approve(self, cmd: dict) -> None:
    await self._apply_edits(cmd.get("edits") or {})

    approved = float(cmd.get("boundary_usd", 1.0))
    effective = min(approved, settings.first_hunt_cap_usd)   # FIRST-HUNT SILENT CAP
    self._boundary = Boundary(boundary_usd=effective)
    await self._repo.set_boundary(self._hunt_id, effective)
    self._mode = str(cmd.get("mode") or "on_signal")
    await self._emit(
        "plan_approved",
        "user",
        {"mode": self._mode, "boundary_usd": effective},
    )
    await self._repo.set_hunt_state(self._hunt_id, "hunting")
```

User's approved boundary is silently capped at `FIRST_HUNT_CAP_USD` (default $0.50). The `mode` string is one of `"wild"`, `"on_signal"`, `"on_command"`.

#### `_spawn_roster()` (lines 323–336)

```python
async def _spawn_roster(self) -> None:
    for wolf_id, role, tier, thinking in _ROSTER:
        self._wolves[wolf_id] = self._make_wolf(wolf_id, role, tier, thinking)
        await self._emit(
            "wolf_spawned",
            "engine",
            {
                "wolf_id": wolf_id,
                "role": role,
                "model_tier": tier,
                "thinking": thinking,
                "prompt_version": load_prompt(role).version,
            },
        )
```

All 8 wolves are spawned (each emits `wolf_spawned`) before the strategy takes control.

#### `scout()` — the main research primitive (lines 360–420)

```python
async def scout(self, wolf_id: str, query: str, step_id: str = "s1") -> Finding:
    wolf = self._wolves.get(wolf_id)
    if wolf is None:
        return Finding(wolf_id=wolf_id, summary="", sources=[], confidence=0.0)

    await self._emit("step_started", wolf_id, {"step_id": step_id, "wolf_id": wolf_id, "summary": f"Searching: {query}"})
    await self.progress(wolf_id, "searching", f"Searching: {query}")

    hits, ok, ref, stray = await self._scout_search(wolf, query)
    if stray:
        await self._stray_event(wolf_id, stray, ref)
    await self.progress(wolf_id, "reading", f"Reading {len(hits)} sources")

    out_ref = ref or f"art_{wolf_id}_out"
    try:
        res = await asyncio.wait_for(
            self._dispatch(wolf, "search", context=self._hits_context(query, hits),
                           phase="reading", response_schema=FINDINGS_SCHEMA),
            timeout=self._step_timeout,
        )
    except TimeoutError:
        await self._stray_event(wolf_id, "timeout", ref)
        # … returns low-confidence stub Finding

    parsed = res.parsed or {}
    summary = str(parsed.get("summary") or res.text or f"Findings on {query}")
    confidence = float(parsed.get("confidence", 0.8 if ok else 0.3) or 0.0)

    await self._emit("step_completed", wolf_id, {"step_id": step_id, "wolf_id": wolf_id, "output_ref": out_ref, "confidence": round(confidence, 2)})
    await self._emit("message_passed", wolf_id, {"from_wolf": wolf_id, "to_wolf": "tracker", "intent": "handoff_findings", "summary": summary[:140], "ref": out_ref})
    return Finding(wolf_id=wolf_id, summary=summary, sources=hits, confidence=confidence, output_ref=out_ref)
```

`_scout_search()` runs `WEB_SEARCH` then `WEB_FETCH` on the top URL (A4 — deep-read), emits `tool_called`/`tool_result` pairs, persists hits as an artifact. Each hit gets `by` (wolf_id) and `verified` (bool — whether the page text was actually fetched) tags.

#### `merge()` (lines 422–454)

Tracker cross-references all findings, returns `Merged(summary, claims, conflict, output_ref, sources)`. Calls `_absorb_inputs()` first to fold in any mid-hunt user inputs.

#### `resolve_conflict()` — the Hold gate (lines 456–488)

```python
async def resolve_conflict(self, conflict: Conflict) -> str:
    hold_id = new_hold_id()
    await self._emit("hold_opened", "alpha", {
        "hold_id": hold_id,
        "question": conflict.question,
        "context_ref": conflict.context_ref,
        "options": conflict.options,
        "recommended": conflict.recommended,
    })
    if self._mode == "wild":
        resolution = conflict.recommended
        await self._emit("hold_resolved", "alpha", {"hold_id": hold_id, "resolution": resolution, "auto": True})
        return resolution
    await self._repo.set_hunt_state(self._hunt_id, "holding")
    cmd = await self._await_command("resolve_hold")
    resolution = str(cmd.get("resolution") or conflict.recommended)
    await self._emit("hold_resolved", "user", {"hold_id": hold_id, "resolution": resolution, "edited_text": cmd.get("edited_text")})
    await self._repo.set_hunt_state(self._hunt_id, "hunting")
    return resolution
```

#### `_dispatch()` — the budget gate (lines 661–721)

**This is the most critical function in the engine.** Every LLM call passes through it.

```python
async def _dispatch(self, wolf, intent, context="", *, phase=None, response_schema=None) -> CompletionResult:
    est = pricing.estimate(wolf.tier)
    verdict = self._boundary.check(est)

    if verdict is Verdict.HALT:
        await self._halt()
        await self._await_resume()
        return await self._dispatch(wolf, intent, context, phase=phase, response_schema=response_schema)

    if verdict is Verdict.DOWNGRADE and wolf.tier != "flash":
        from_tier, thinking_off = wolf.tier, wolf.thinking
        wolf.tier, wolf.thinking = "flash", False
        await self._emit("boundary_downgrade", "engine", {
            "wolf_id": wolf.wolf_id, "from_tier": from_tier, "to_tier": "flash", "thinking_off": thinking_off
        })
    elif verdict is Verdict.WARN and not self._warned:
        self._warned = True
        await self._emit("boundary_warning", "engine", {
            "pct": round(self._boundary.projected_pct(est), 2),
            "cumulative_usd": round(self._boundary.cumulative_usd, 6),
        })

    on_delta = self._progress_sink(wolf.wolf_id, phase) if (phase and wolf.thinking) else None
    result = await wolf.think(intent, messages=self._messages(wolf, intent, context),
                               response_schema=response_schema, on_delta=on_delta)
    self._boundary.cumulative_usd += result.cost_usd
    await self._emit("tokens_spent", wolf.wolf_id, {
        "wolf_id": wolf.wolf_id, "model": result.model,
        "in_tokens": result.in_tokens, "out_tokens": result.out_tokens,
        "cost_usd": round(result.cost_usd, 6),
        "cumulative_usd": round(self._boundary.cumulative_usd, 6),
    })
    return result
```

#### `finish()` (lines 618–657)

Saves the final artifact (text + claims + sources + a coarse span map), emits `artifact_created` and `hunt_completed`, sets hunt state to `"returned"`.

The span map is a list of `{claim, source_refs}` objects — one per claim from Tracker. This is the coarse provenance implementation (labeled B3 in comments); the full click-to-trace span map described in Howler's prompt is not yet implemented.

---

### 2.4 Research Strategies

Three strategies exist. The hunt's strategy is chosen at creation time (`strategy` field in `POST /hunts`). All three implement the same `Strategy` ABC and get the same `Engine` (Supervisor).

#### Orchestrate (`strategies/orchestrate.py`) — Default

```python
class OrchestrateStrategy(Strategy):
    name = "orchestrate"
    pattern = "hierarchical"
    label = "Dynamic orchestrator"

    async def execute(self, engine: Engine) -> None:
        ids = engine.scout_ids()
        queries = engine.queries()

        results = await asyncio.gather(*(engine.scout(w, q) for w, q in zip(ids, queries)))
        findings = [f for f in results if f]

        # Adaptive retry: if fewer than 2 findings have confidence ≥ 0.4, broaden.
        if len([f for f in findings if f.confidence >= 0.4]) < 2 and ids:
            await engine.progress("alpha", "thinking", "Findings look thin — sending a scout back out.")
            retry = await engine.scout(ids[0], f"{engine.task} overview and key facts", step_id="s1b")
            if retry:
                findings.append(retry)

        merged = await engine.merge(findings)

        decision = None
        if merged.conflict:
            decision = await engine.resolve_conflict(merged.conflict)

        draft = await engine.draft(merged, decision)
        await engine.finish(draft, merged)
```

#### Deep Dive (`strategies/deep_dive.py`)

Adds a gap-finding second pass after the first merge:

```python
class DeepDiveStrategy(Strategy):
    name = "deep_dive"
    pattern = "parallel_then_merge"
    label = "Iterative deep-research"

    async def execute(self, engine: Engine) -> None:
        # first round
        results = await asyncio.gather(*(engine.scout(w, q) for w, q in zip(ids, queries)))
        merged = await engine.merge(findings)

        # iterative core: find gaps, search again
        gaps = await engine.find_gaps(merged)
        if gaps and ids:
            extra = await asyncio.gather(
                *(engine.scout(ids[i % len(ids)], gap, step_id="s1b") for i, gap in enumerate(gaps[:2]))
            )
            findings.extend(f for f in extra if f)
            merged = await engine.merge(findings, step_id="s2b")

        # same close as orchestrate
        decision = None
        if merged.conflict:
            decision = await engine.resolve_conflict(merged.conflict)
        draft = await engine.draft(merged, decision)
        await engine.finish(draft, merged)
```

#### Critique (`strategies/critique.py`)

Adds Sentinel Standoff before drafting:

```python
class CritiqueStrategy(Strategy):
    name = "critique"
    pattern = "standoff"
    label = "Plan-execute-critique"

    async def execute(self, engine: Engine) -> None:
        # same scout + merge as orchestrate
        results = await asyncio.gather(...)
        merged = await engine.merge(findings)

        # critique core: Sentinel challenges the weakest claim
        verdict = await engine.critique(merged)
        if not verdict.ok and verdict.issues:
            issue = verdict.issues[0]
            await engine.standoff(
                challenger="sentinel",
                defendant="tracker",
                claim_ref=merged.output_ref or f"art_{engine.task[:8]}_merge",
                rationale=issue.get("problem", "A claim needs a stronger source."),
            )
            merged = await engine.merge(findings, step_id="s2b")  # re-merge post-standoff

        # same close
        ...
```

---

### 2.5 Event System

#### The Envelope

`backend/app/events/models.py`:

```python
class Event(BaseModel):
    """The envelope (Doc 04 §3.1). seq is strictly increasing per hunt; append-only."""
    event_id: str = Field(default_factory=lambda: f"evt_{ULID()}")
    hunt_id: str
    seq: int = Field(ge=0)
    ts: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    type: EventType
    actor: str
    payload: dict[str, Any] = Field(default_factory=dict)
```

#### The Emitter

`backend/app/engine/core.py` — the single place an event is born:

```python
class Emitter:
    def __init__(self, hunt_id: str, repo: Repo, *, validate: bool = True) -> None:
        self._hunt_id = hunt_id
        self._repo = repo
        self._lock = asyncio.Lock()
        self._next_seq: int | None = None
        self._validate = validate

    async def emit(self, type: EventType, actor: str, payload: dict[str, Any]) -> Event:
        async with self._lock:
            await self._seed()
            event = Event(hunt_id=self._hunt_id, seq=self._next_seq, type=type, actor=actor, payload=payload)
            if self._validate:
                self._check(event)     # validates against frozen JSON Schema
            await self._repo.append_event(event)
            self._next_seq += 1
            return event
```

- The `asyncio.Lock` serializes concurrent wolf emits so `seq` is gap-free.
- `append_event` does `INSERT INTO events ... + pg_notify('pack_events', hunt_id)` in one transaction.
- The `(hunt_id, seq)` PRIMARY KEY in Postgres is the ultimate backstop against races.

#### The Frozen JSON Schema

`backend/schema/events.schema.json` — frozen June 12, 2026. Quoted in full below (omitting whitespace):

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://sendthepack.com/schema/events/v1.json",
  "title": "Pack Event Envelope v1",
  "description": "FROZEN June 12, 2026. The single source of truth and the frontend-backend contract (Doc 04 §3). seq is strictly increasing per hunt; events are append-only and never edited. If it is not an event, it did not happen.",
  "type": "object",
  "required": ["event_id", "hunt_id", "seq", "ts", "type", "actor", "payload"],
  "properties": {
    "event_id": { "type": "string", "description": "ULID, e.g. evt_01J..." },
    "hunt_id":  { "type": "string", "description": "ULID, e.g. hunt_01J..." },
    "seq":      { "type": "integer", "minimum": 0, "description": "Strictly increasing per hunt." },
    "ts":       { "type": "string", "format": "date-time" },
    "type":     { "type": "string", "$ref": "#/$defs/eventType" },
    "actor":    { "type": "string", "description": "Wolf id (e.g. scout-2) or 'engine' / 'alpha' / 'user'." },
    "payload":  { "type": "object" }
  },
  "additionalProperties": false
}
```

**All event types (the `eventType` enum):**

```
hunt_created, input_added, transcript_ready,
plan_proposed, plan_edited, plan_approved,
wolf_spawned, step_started, step_completed, message_passed, wolf_progress,
tool_called, tool_result, tokens_spent,
hold_opened, hold_resolved,
standoff_opened, standoff_turn, standoff_resolved,
stray_detected, stray_recovered,
boundary_warning, boundary_downgrade, boundary_halt,
artifact_created,
hunt_completed, hunt_failed, hunt_stopped,
benchmark_started, benchmark_completed
```

#### Complete Payload Shapes (from `schema/events.schema.json`)

| Event type | Required payload fields | Notable optional fields |
|------------|------------------------|------------------------|
| `hunt_created` | `source` (`"typed"\|"spoken"\|"dropped"`), `raw_input_ref` | — |
| `input_added` | `artifact_id`, `kind` (`"audio"\|"video"\|"pdf"\|"csv"\|"url"\|"text"`), `mid_hunt` | — |
| `transcript_ready` | `artifact_id`, `provider` (`"qwen_voice"\|"qwen_asr"`), `duration_s` | `language_hint` |
| `plan_proposed` | `steps`, `wolves`, `pattern` (enum), `est_cost`, `est_time` | `assumptions` |
| `plan_edited` | `diff` (object) | — |
| `plan_approved` | `mode` (`"wild"\|"on_signal"\|"on_command"`), `boundary_usd` | — |
| `wolf_spawned` | `wolf_id`, `role` (enum), `model_tier` (enum), `thinking`, `prompt_version` | — |
| `step_started` | `step_id`, `wolf_id`, `summary` | — |
| `step_completed` | `step_id`, `wolf_id`, `output_ref`, `confidence` (0–1) | — |
| `message_passed` | `from_wolf`, `to_wolf`, `intent`, `summary` | `ref` |
| `wolf_progress` | `wolf_id`, `phase` (`"thinking"\|"searching"\|"reading"\|"merging"\|"writing"\|"critiquing"`), `text` | `tokens` |
| `tool_called` | `wolf_id`, `tool` (enum), `args_summary` | — |
| `tool_result` | `wolf_id`, `tool`, `ok`, `latency_ms` | `result_ref`, `hits` (additive) |
| `tokens_spent` | `wolf_id`, `model`, `in_tokens`, `out_tokens`, `cost_usd`, `cumulative_usd` | — |
| `hold_opened` | `hold_id`, `question`, `options`, `recommended` | `context_ref` |
| `hold_resolved` | `hold_id`, `resolution` | `edited_text` |
| `standoff_opened` | `standoff_id`, `challenger`, `defendant`, `claim_ref` | — |
| `standoff_turn` | `standoff_id`, `turn_no` (1–3), `argument_summary` | — |
| `standoff_resolved` | `standoff_id`, `outcome` (`"agreement"\|"alpha_call"\|"hold_opened"`), `rationale` | — |
| `stray_detected` | `wolf_id`, `pattern` (`"repeat_fail"\|"loop"\|"timeout"`), `evidence_ref` | — |
| `stray_recovered` | `wolf_id`, `action` (`"reroute"\|"replan"\|"respawn"`), `note_plain_english` | — |
| `boundary_warning` | `pct`, `cumulative_usd` | — |
| `boundary_downgrade` | `wolf_id`, `from_tier`, `to_tier`, `thinking_off` | — |
| `boundary_halt` | `checkpoint_id`, `spend_breakdown`, `resume_options` | — |
| `artifact_created` | `artifact_id`, `kind` (`"draft"\|"final"\|"scorecard"\|"transcript"`), `produced_by` | `provenance_span_map_ref` |
| `hunt_completed` | `final_artifact_id`, `totals` (object) | — |
| `hunt_failed` | `reason_plain_english` | `partials_ref` |
| `hunt_stopped` | `by` (`"user"`) | — |
| `benchmark_started` | `lone_wolf_config` | — |
| `benchmark_completed` | `scorecard` (`{lone_wolf, pack}`) | — |

The `span` definition (for `artifact_created` provenance):

```json
{
  "span": [start_char, end_char],
  "produced_by": "wolf_id",
  "source_refs": ["url-or-id", ...],
  "standoff_ids": ["..."],
  "transcript_ts": 42.1
}
```

---

### 2.6 Coordination Behaviors

#### Holds — **FULLY WORKING**

- Emitted by `resolve_conflict()` (`hold_opened`) and `_confirm_draft()` (on_command mode).
- Payload: one question + array of options + one recommended default + optional `context_ref`.
- **Wild mode**: Alpha auto-resolves immediately; emits `hold_resolved` with `auto: True`.
- **On Signal / On Command**: hunt state → `"holding"`; `_await_command("resolve_hold")` blocks.
- REST `POST /hunts/{id}/holds/{hold_id}/resolve` sends `{resolution, edited_text}` → commands queue → Supervisor unblocks.

#### Standoffs — **FULLY WORKING**

A structured 3-turn debate: challenger states → defendant responds → Alpha judges. Code in `supervisor.py` `standoff()` method (lines ~524–572). Each turn is a `_dispatch()` call using `standoff_challenge`, `standoff_defend`, `standoff_judge` intents. Events emitted: `standoff_opened`, up to 3× `standoff_turn`, `standoff_resolved`. Outcome is one of `"agreement"`, `"alpha_call"`, `"hold_opened"`.

#### Strays — **FULLY WORKING**

`backend/app/engine/stray.py`:

```python
REPEAT_FAIL_THRESHOLD = 3
LOOP_THRESHOLD = 3

@dataclass
class StrayDetector:
    _fails: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    _recent_outputs: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))

    def record_tool_result(self, wolf_id: str, ok: bool) -> str | None:
        """Returns 'repeat_fail' once a wolf has failed the same tool 3 times."""
        if ok:
            self._fails[wolf_id] = 0
            return None
        self._fails[wolf_id] += 1
        if self._fails[wolf_id] >= REPEAT_FAIL_THRESHOLD:
            return "repeat_fail"
        return None

    def record_output(self, wolf_id: str, fingerprint: str) -> str | None:
        """Returns 'loop' when the last 3 outputs repeat (similarity loop)."""
        window = self._recent_outputs[wolf_id]
        window.append(fingerprint)
        if len(window) > LOOP_THRESHOLD:
            window.pop(0)
        if len(window) == LOOP_THRESHOLD and len(set(window)) == 1:
            return "loop"
        return None
```

Three trigger patterns: `"repeat_fail"` (3 consecutive tool failures), `"loop"` (3 identical outputs), `"timeout"` (step exceeds `STEP_TIMEOUT_S`). On trigger: emits `stray_detected` + `stray_recovered` pair. Recovery action is `"reroute"` (cancel task, Alpha redirects).

#### The Boundary (Budget Enforcement) — **FULLY WORKING — GATE NOT GRAPH**

`backend/app/engine/boundary.py`:

```python
WARN_PCT = 70.0
DOWNGRADE_PCT = 85.0
HALT_PCT = 100.0

@dataclass
class Boundary:
    boundary_usd: float
    cumulative_usd: float = 0.0

    def projected_pct(self, next_call_usd: float) -> float:
        if self.boundary_usd <= 0:
            return 100.0
        return (self.cumulative_usd + next_call_usd) / self.boundary_usd * 100.0

    def check(self, next_call_usd: float) -> Verdict:
        """Decide BEFORE dispatch. The engine must not dispatch on HALT."""
        pct = self.projected_pct(next_call_usd)
        if pct >= HALT_PCT:
            return Verdict.HALT
        if pct >= DOWNGRADE_PCT:
            return Verdict.DOWNGRADE
        if pct >= WARN_PCT:
            return Verdict.WARN
        return Verdict.OK
```

- **70%**: `boundary_warning` (once per hunt; `self._warned = True` gate).
- **85%**: `boundary_downgrade` — mutates `wolf.tier = "flash"`, `wolf.thinking = False`. Emits `boundary_downgrade` per wolf downgraded.
- **100%**: Halt. `_dispatch()` calls `_halt()` (emits `boundary_halt`, saves checkpoint) then `_await_resume()` (blocks on commands queue). On `resume` command, `boundary_usd` is raised; loop re-enters `_dispatch()`.
- First-hunt silent cap: `min(approved, settings.first_hunt_cap_usd)` enforced in `_approve()`.
- All estimates use `pricing.estimate(tier)` — a typical-call USD estimate — not exact post-call cost.

#### Checkpoints — **INFRASTRUCTURE EXISTS; RESUME LOGIC PARTIALLY STUBBED**

- `checkpoints` table exists.
- `_halt()` saves a checkpoint row (`checkpoint_id`, `hunt_id`, `at_seq`, state snapshot).
- `_await_resume()` loop is implemented: receives `resume` command, raises boundary, returns.
- **NOT DONE**: loading the checkpoint and resuming the strategy mid-execution. After a halt and resume, the strategy re-runs from the beginning of the current step (because `_dispatch()` retries recursively), not from a persisted strategy state snapshot. This is documented in comments as `# the resume path is: re-check the gate and proceed`.

#### Autonomy Modes — **FULLY WORKING**

- `"wild"`: Alpha auto-resolves all Holds; Standoffs → Alpha calls it; no `on_command` pre-draft Hold.
- `"on_signal"`: Holds on genuine conflicts; Standoffs may open a Hold.
- `"on_command"`: Like `on_signal` + `_confirm_draft()` blocks before Howler writes.

---

### 2.7 The LLM Client

`backend/app/qwen/client.py`.

**Provider**: Alibaba DashScope, via OpenAI Python SDK (`AsyncOpenAI`) pointed at `QWEN_BASE_URL`.

**Offline switch**: `self.offline = not settings.qwen_api_key`. With no key, every call routes to `FakeQwen` (deterministic, topic-aware structured output). The engine is fully functional offline.

**Thinking mode**: Wired per wolf in the roster. Requires streaming (`extra_body["enable_thinking"] = True`). Non-streamed thinking calls fail on Qwen. Thinking wolves stream, which also delivers live `wolf_progress` beats via `on_delta` callback.

**Structured output**: Via Qwen's `json_schema` response_format. Lenient parser (`_loads_lenient()`) tolerates markdown fences, control characters, and prose around the JSON object.

**Retry + backoff**: Up to `QWEN_MAX_RETRIES` attempts on transient errors (`APIConnectionError`, `APITimeoutError`, `RateLimitError`, `InternalServerError`). Base backoff `QWEN_BACKOFF_BASE_S` with exponential growth. 4xx errors (bad request) are never retried.

**Circuit breaker** (`_Breaker`): Opens after `QWEN_BREAKER_THRESHOLD` consecutive failures. Cooldown `QWEN_BREAKER_COOLDOWN_S`. Half-open: one trial call after cooldown elapses.

**Token + cost accounting**: `CompletionResult.cost_usd` is computed by `pricing.cost(tier, in_tokens, out_tokens)`. The Supervisor accumulates it in `self._boundary.cumulative_usd` and emits `tokens_spent` after each dispatch. The client itself never emits events.

**`CompletionResult`** (`app/qwen/types.py`):

```python
@dataclass
class CompletionResult:
    text: str
    model: str
    tier: str
    in_tokens: int
    out_tokens: int
    cost_usd: float
    parsed: dict | None = None   # populated when response_schema was passed
```

---

### 2.8 Tools Layer

Every tool follows the `Tool` protocol:

```python
@dataclass
class ToolResult:
    ok: bool
    result_ref: str | None
    latency_ms: int
    data: Any = None

class Tool(Protocol):
    name: str
    async def run(self, **kwargs: Any) -> ToolResult: ...
```

| Tool constant | File | What it does |
|--------------|------|--------------|
| `WEB_SEARCH` | `tools/web.py` | Query → ranked hits (title, url, snippet, score). Real: Tavily advanced search. Offline: `CannedProvider` (3 synthetic hits, deterministic). |
| `WEB_FETCH` | `tools/web.py` | URL → readable text (readability extraction). Real: Tavily extract API. Offline: stub text. Returns up to 1500 chars, injected into scout context. |
| `describe_image` | `tools/vision.py` | Image bytes → text (OCR + visual description). Real: Qwen-VL (`QWEN_MODEL_VISION`). Offline: stub note. Prompt: "Read this image for a researcher. Transcribe any text verbatim, then briefly describe charts, tables, diagrams…" |
| `TRANSCRIBER` | `tools/transcribe.py` | Audio bytes → transcript text. Real: Qwen DashScope ASR (`qwen_voice` or `qwen_asr`). Offline: `FakeTranscriber` (duration estimate from byte length). |
| `parse_bytes` / `parse_url` | `tools/file_parse.py` | PDF, CSV, Markdown, text → extracted text. `detect_kind()` detects type from MIME/extension. Used by `/parse` and `/transcribe` REST endpoints. |
| `redact_event` | `tools/redact.py` | PII masking for `/tracks/export`. Not called from within a hunt; called at export time. |

Tools are called directly by the Supervisor (not by the wolves themselves). The wolf receives the search results in its context window, not the raw tool call. The schema `tool_called` / `tool_result` events are emitted by the Supervisor around the tool invocation.

---

### 2.9 The Outbox Relay

`backend/app/engine/relay.py` — the only writer to the Redis stream:

```python
class OutboxRelay:
    async def _run(self) -> None:
        await self._drain()      # clear startup backlog
        while True:
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=self._poll_interval)
            except TimeoutError:
                pass             # periodic safety sweep (~1s)
            self._wake.clear()
            try:
                await self._drain()
            except Exception:
                continue         # never die on transient error

    async def _drain(self) -> None:
        while True:
            batch = await self._repo.fetch_unrelayed()
            if not batch:
                return
            for event in batch:
                await self._bus.append(event)                   # Redis XADD
                await self._repo.mark_relayed(event.hunt_id, event.seq)
```

Wakes via `LISTEN pack_events` (Postgres `pg_notify`) for sub-millisecond latency. The 1s poll is a safety net. Delivery is **at-least-once**: if the process dies between `XADD` and `mark_relayed`, the row is retried. The frontend reducer drops `seq ≤ lastSeq` — duplicates are no-ops.

---

### 2.10 Database Schema

All tables defined in `backend/app/db/pool.py` (applied at startup via `apply_schema()`):

```sql
-- hunts: one row per hunt
CREATE TABLE IF NOT EXISTS hunts (
    hunt_id      TEXT PRIMARY KEY,
    state        TEXT DEFAULT 'planning',
    -- valid states: planning | plan_ready | hunting | holding | standoff |
    --               halted_boundary | returned | stopped_by_user | failed
    source       TEXT DEFAULT 'typed',        -- typed | spoken | dropped
    raw_input    TEXT,
    strategy     TEXT DEFAULT 'orchestrate',  -- orchestrate | deep_dive | critique
    boundary_usd DOUBLE PRECISION,
    title        TEXT,
    archived     BOOLEAN DEFAULT FALSE,
    project_id   TEXT,
    share_token  TEXT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- events: the append-only source of truth
CREATE TABLE IF NOT EXISTS events (
    hunt_id  TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    ts       TEXT NOT NULL,
    type     TEXT NOT NULL,
    actor    TEXT NOT NULL,
    payload  JSONB NOT NULL DEFAULT '{}',
    relayed  BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (hunt_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_events_unrelayed ON events (hunt_id, seq) WHERE relayed = FALSE;

-- artifacts: drafts, finals, scorecards, transcripts, search results, span maps
CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    hunt_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,   -- draft | final | scorecard | transcript | search | input | spanmap
    produced_by TEXT,
    content     JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- messages: durable Alpha conversation history per hunt
CREATE TABLE IF NOT EXISTS messages (
    hunt_id    TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    role       TEXT NOT NULL,    -- user | alpha
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (hunt_id, seq)
);

-- projects: workspace groupings for hunts
CREATE TABLE IF NOT EXISTS projects (
    project_id   TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    instructions TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- instincts: saved plan presets
CREATE TABLE IF NOT EXISTS instincts (
    instinct_id TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    spec        JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- feedback: thumbs up/down on Alpha replies
CREATE TABLE IF NOT EXISTS feedback (
    feedback_id TEXT PRIMARY KEY,
    hunt_id     TEXT NOT NULL,
    turn_index  INT NOT NULL,
    vote        TEXT CHECK (vote IN ('up', 'down')),
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- checkpoints: Boundary-halt snapshots (resume infrastructure; continuation not yet implemented)
CREATE TABLE IF NOT EXISTS checkpoints (
    checkpoint_id TEXT PRIMARY KEY,
    hunt_id       TEXT NOT NULL,
    at_seq        INTEGER NOT NULL,
    state         JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now()
);
```

JSONB codec: `asyncpg` is configured in `pool.py` with `set_type_codec` to auto-encode/decode Python dicts to/from `jsonb`.

---

## 3. API Surface

### 3.1 REST Endpoints (`backend/app/main.py`)

All commands return **202 Accepted**. Truth arrives on the stream, not in the HTTP response.

#### Hunts

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `POST` | `/hunts` | 202 `{hunt_id, state}` | Create hunt, start planning async task |
| `GET` | `/hunts` | 200 `{hunts: [...]}` | List hunts, newest first; filterable by `?project_id=` |
| `GET` | `/hunts/{hunt_id}` | 200 `{hunt_id, state, last_seq, ...}` | Hunt snapshot |
| `PATCH` | `/hunts/{hunt_id}` | 200 `{hunt_id, ok}` | Rename, archive, assign project |
| `DELETE` | `/hunts/{hunt_id}` | 200 `{hunt_id, deleted}` | Delete hunt + all data |

**`POST /hunts` request body:**
```json
{
  "input": "Research BNPL in Nigeria",
  "instinct_id": null,
  "source": "typed",
  "strategy": "orchestrate"
}
```

#### Planning & Execution

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `POST` | `/hunts/{id}/plan/approve` | 202 | Approve plan; set boundary + mode; optionally apply edits |
| `POST` | `/hunts/{id}/inputs` | 202 | Add mid-hunt source (text, URL, transcript) |
| `POST` | `/hunts/{id}/holds/{hold_id}/resolve` | 202 | Answer a Hold |
| `POST` | `/hunts/{id}/stop` | 202 | Stop hunt |
| `POST` | `/hunts/{id}/resume` | 202 | Raise Boundary and resume halted hunt |

**`POST /plan/approve` body:**
```json
{
  "mode": "on_signal",
  "boundary_usd": 1.50,
  "edits": {
    "queries": ["revised angle 1", "revised angle 2", "revised angle 3"],
    "assumptions": ["scope: Nigeria only", "recent sources"]
  }
}
```

#### Alpha Chat & Intake

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `POST` | `/hunts/intake` | 200 `{reply, ready, brief}` | Front-door clarify (non-streaming) |
| `POST` | `/hunts/intake/stream` | SSE | Streaming intake reply |
| `POST` | `/hunts/{id}/ask` | 200 `{reply}` | Side chat with Alpha (non-streaming) |
| `POST` | `/hunts/{id}/ask/stream` | SSE | Streaming Alpha chat |
| `POST` | `/hunts/{id}/messages` | 202 | Save a chat message durably |
| `GET` | `/hunts/{id}/messages` | 200 `{messages: [...]}` | Fetch hunt's durable chat |

SSE format (for `/intake/stream` and `/ask/stream`):
```
data: {"type": "token", "token": "..."}
data: {"type": "done"}
data: {"type": "error", "message": "..."}
```

#### Artifacts & Sharing

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `GET` | `/hunts/{id}/artifact` | 200 `{artifact_id, kind, produced_by, content}` | Final brief |
| `GET` | `/hunts/{id}/tracks/export` | 200 `{hunt_id, events, redacted}` | Full PII-redacted event log |
| `POST` | `/hunts/{id}/share` | 200 `{token}` | Mint public share token |
| `GET` | `/share/{token}` | 200 `{title, content}` | Public read-only brief |

#### Scoring

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `POST` | `/hunts/{id}/benchmark` | 202 | Run Lone Wolf vs Pack in background |
| `GET` | `/hunts/{id}/scorecard` | 200 `{hunt_id, scorecard}` | Retrieve latest scorecard |

#### Parsing & Transcription

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `POST` | `/parse` | 200 `{kind, text, chars, filename}` | Parse file upload (PDF/CSV/MD/text) or URL → text |
| `POST` | `/transcribe` | 200 `{text, provider, duration_s}` | Transcribe audio → new hunt |
| `POST` | `/hunts/{id}/transcribe` | 202 | Transcribe audio → inject into running hunt |

The `/parse` endpoint also accepts images and routes them through `describe_image()` (Qwen-VL). Video files are explicitly declined (returns 400).

#### Projects (Workspaces)

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `GET` | `/projects` | 200 `{projects: [{project_id, label, hunt_count}]}` | List projects |
| `POST` | `/projects` | 202 `{project_id, label}` | Create project |
| `PATCH` | `/projects/{project_id}` | 200 | Update label or instructions |
| `DELETE` | `/projects/{project_id}` | 200 | Delete project (hunts retained, `project_id` nulled) |

#### Instincts (Plan Presets)

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `GET` | `/instincts` | 200 `{instincts: [...]}` | List saved instincts |
| `POST` | `/instincts` | 202 | Save instinct `{label, spec}` |

#### System

| Method | Path | Response | Purpose |
|--------|------|----------|---------|
| `GET` | `/health` | 200 `{status, service}` | Health check |
| `GET` | `/strategies` | 200 `{strategies: [], default}` | Available strategy catalog |

---

### 3.2 Realtime Channels

#### WebSocket — served by Rust Gateway (not FastAPI)

```
GET ws://localhost:8080/hunts/{hunt_id}/stream?from_seq=N
```

**Upgrade**: Standard WebSocket handshake via Axum.

**Protocol** (`gateway/src/main.rs`):

```rust
async fn tail(mut socket: WebSocket, hunt_id: String, from_seq: i64, state: AppState) {
    // --- Replay: XRANGE - + ---
    let range: StreamRangeReply = con.xrange(&key, "-", "+").await;
    for entry in range.ids {
        if event_seq(&raw).is_none_or(|s| s >= from_seq) {
            socket.send(Message::Text(raw)).await;
        }
    }

    // --- Live tail: XREAD BLOCK 0 (count: 64) ---
    loop {
        let reply = con.xread_options(&[&key], &[&last_id], &opts).await;
        for entry in ... {
            socket.send(Message::Text(raw)).await;
        }
    }
}
```

- Each WebSocket frame is one raw JSON event envelope (same shape as the schema).
- Replay filters by `from_seq` — client passes `lastSeq + 1` on reconnect.
- XREAD blocks with `BLOCK 0` (infinite); resolves immediately when new events land.
- Gateway health check: `GET /health` → `"ok"` (plain text).
- **No auth on the gateway**. No logic. No writes. Single Rust source file, 136 lines.

**Frontend auto-reconnect** (`streamClient.ts`): exponential backoff (1s → 2s → 4s → 8s → 10s cap). Resumes from `lastSeq + 1`. Closes on terminal states (`returned`, `failed`, `stopped_by_user`, `halted_boundary`) to avoid unnecessary connections.

#### SSE — served by FastAPI

- `POST /hunts/intake/stream` and `POST /hunts/{id}/ask/stream`
- Content-Type: `text/event-stream`
- Headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`
- Frames: `data: {"type": "token", "token": "..."}` then `data: {"type": "done"}`
- Client uses `AbortController` to cancel mid-stream.

---

## 4. Frontend

### 4.1 Routing

No React Router. Manual routing in `App.tsx`: `window.location.pathname` parsed via `parseRoute()`. Navigation uses `window.history.pushState()`. `popstate` events handle browser back/forward.

| Path | Component | What it shows |
|------|-----------|---------------|
| `/` | `DoorPage` | Chat composer with Alpha; intake conversation; hunt creation |
| `/hunt/:id` | `HuntScreen` | Plan review → live canvas → brief; right-rail chat/controls |
| `/hunt/:id/plan` | `HuntScreen` | Same component; `/plan` suffix dropped after hunt starts |
| `/hunt/:id/tracks` | `TracksPage` | Full event audit trail |
| `/hunt/:id/scorecard` | `ScorecardPage` | Lone Wolf vs Pack benchmark |
| `/share/:token` | `ShareView` | Public read-only brief |
| `/gallery` | `StatesGallery` | WolfNode state matrix (dev/screenshot tool) |

---

### 4.2 State Management

Four Zustand stores:

**`huntStore`** (`store/huntStore.ts`):
- Wraps a pure reducer `reduce(state, event)` — no side effects.
- `apply(event)` is called for every event frame from the WebSocket.
- `HuntView` shape:
  ```typescript
  {
    huntId: string
    state: HuntState    // enum of all hunt states
    lastSeq: number
    wolves: Record<string, WolfView>
    feed: FeedLine[]    // colored activity feed
    boundary: BoundaryView   // { cap, spent, pct, status }
    openHold: HoldView | null
    activeStandoffId: string | null
    finalArtifactId: string | null
    plan: PlanView | null
  }
  ```

**`chatStore`** (`store/chatStore.ts`):
- **Persisted to `localStorage` as `pack-chat`**. Survives page refresh.
- `ChatTurn[]` (role, text). `pending: boolean`. `proposal: {brief: string} | null`.
- `huntId` tracks which hunt owns the thread.
- `abortFn` for canceling active SSE stream.
- Key methods: `addUser`, `addAlpha`, `startAlpha`, `addAlphaToken` (streaming), `commitAlpha`, `dropLastAlpha`, `truncateFrom` (edit & resend).

**`settingsStore`** (`store/settingsStore.ts`):
- **Persisted to `localStorage` as `pack-settings`**.
- `customInstructions: string` — prepended as system message to all Alpha calls.

**`uiStore`** (`store/uiStore.ts`):
- `denOpen: boolean`, `settingsOpen: boolean` — ephemeral UI flags.

---

### 4.3 Event Processing (Pure Reducer)

The frontend is a **CQRS read model** driven entirely by the event stream.

```typescript
// events/reducer.ts
export function reduce(state: HuntView, event: PackEvent): HuntView { ... }
```

Every incoming WebSocket frame calls `huntStore.apply(event)` which calls `reduce()`. The reducer is pure (no side effects, no fetches). All derived state — wolf nodes, feed, boundary percentage, open hold, standoff state, final artifact ID — flows from the reducer.

The `reducer.test.ts` file tests the reducer against fixture `.jsonl` files.

**The only REST calls the UI makes:**
- Commands (POST to engine): `createHunt`, `approvePlan`, `resolveHold`, `stop`, `resume`, `ask`, `addInput`, `saveMessage`, `benchmark`, `share`, `patchHunt`, `deleteHunt`, `createProject`, `patchProject`, `deleteProject`, `saveInstinct`.
- Reads that are not on the stream: `fetchHunts`, `fetchArtifact`, `fetchMessages`, `fetchTracks`, `fetchScorecard`, `fetchShare`, `fetchInstincts`, `fetchProjects`, `fetchStrategies`.

---

### 4.4 Screens

#### DoorPage (`/`)

- Alpha conversation thread (full screen, shared with hunt rail chat).
- `OneBox` composer at bottom (textarea, file tiles, strategy picker, mic button, "Send the pack" button — always visible, not gated on empty composer).
- `InstinctChip` row above composer.
- `DropHalo` wraps entire page — drag a file anywhere to attach.
- `DenDrawer` (slide-in from left, Cmd+K or button).
- On intake reply: `chatStore.proposal` set; chat thread shows Alpha's proposed brief.
- On "Send the pack" click: `POST /hunts` then navigate to `/hunt/:id/plan`.

#### HuntScreen (`/hunt/:id`)

Three sub-states depending on `hunt.state`:

1. **`plan_ready`**: Left `PlanSidebar` + center Territory (idle wolves) + right `PlanChatSidebar` showing approval controls (leash picker, angle editors, budget input).
2. **`hunting` / `holding` / `standoff` / `finishing`**: Left `PlanSidebar` + center Territory (live canvas) + right `PlanChatSidebar` (chat + hold widget + boundary widget).
3. **`returned`**: Left hidden + center `DocumentView` (brief) + right `PlanChatSidebar` (follow-up chat).

`HuntStatusBanner` is shown at top only for `failed` and `stopped_by_user` states.

The URL stays `/hunt/:id` throughout; the `/plan` suffix is only shown during `plan_ready` and is dropped when hunting begins.

#### TracksPage (`/hunt/:id/tracks`)

Fetches `/hunts/{id}/tracks/export`. Renders full event timeline: seq | actor | event type | color-coded dot. Footer: total events, total spend, hunt ID.

#### ScorecardPage (`/hunt/:id/scorecard`)

Fetches `/hunts/{id}/scorecard`. If no scorecard: fires `POST /hunts/{id}/benchmark` and polls. Shows side-by-side comparison: Quality, Sources, Citations, Cost, Time. Pack winner highlighted in green. Export to JSON.

#### ShareView (`/share/:token`)

Fetches `/share/{token}`. Renders markdown brief. No hunt controls. Footer: "Make your own" link to `/`.

#### StatesGallery (`/gallery`)

Dev-only: renders `WolfNode` in all 7 states for design reference.

---

### 4.5 Territory Canvas (`canvas/Territory.tsx`)

Built on `@xyflow/react`. Layout computed by `packLayout.ts` (dagre algorithm).

**Nodes**: One `WolfNode` per spawned wolf. Node ID = `wolf_id`.

**WolfNode states** (7):
- `idle` — dim ring, grey icon, no text.
- `hunting` — solid fill (role color), glow.
- `talking` — solid fill + white pulsing ring (message_passed active).
- `holding` — white ring, paused indicator.
- `stray` — solid red fill (any role).
- `done` — solid green.
- `thinking` — transparent fill, shimmer animation.

**Wolf telemetry** shown on node:
- Tier badge (max/plus/flash).
- Live action text (latest `wolf_progress.text`).
- Source count (from `tool_result.hits` additive field).
- Cumulative spend (from `tokens_spent.cumulative_usd`).

**Edges**:
- Dormant: grey dotted.
- Flowing: role-colored animated stroke.
- Blocked: red (stray on this wolf).

**TraceRail** (docked top-right overlay): scrolling `FeedLine[]` from `huntStore`. Color by event category: searching (blue), handoff (green), hold (amber), standoff (purple), stray (red), boundary (yellow).

---

### 4.6 Key Components

**`OneBox`** (`components/composer/OneBox.tsx`):
- Unified text input for both Door and hunt rail.
- Auto-resize textarea.
- File attachment tiles (showing upload progress states).
- Prop `packAction` — when set (plan_ready state), shows "Send the pack" as the primary button, always visible (not gated on empty text).
- Handles drag-drop; filters folders; debounces file processing.
- Integrates DropHalo, StrategyPicker, MicSheet.

**`PlanChatSidebar`** (`components/plan/PlanChatSidebar.tsx`):
- The right rail present on HuntScreen in all sub-states.
- Top: hunt header, stop button, boundary spend display.
- Plan-ready section: leash mode picker (3 radio buttons), research angle inputs (editable), budget input.
- Chat thread with streaming Alpha responses.
- Pinned gates: HoldView (radio buttons + submit) when `openHold != null`; BoundaryHalt widget when `state == "halted_boundary"`.
- Bottom: toggle between "Ask Alpha" and "Add to Hunt" → OneBox.

**`ChatThread`** (`components/chat/ChatThread.tsx`):
- Auto-scroll (sticky to bottom; does not yank user off history).
- ResizeObserver for streaming content.
- Lenis smooth scroll.
- Per-message: `MarkdownReply`, `MessageActions` (copy, edit user msg, regenerate Alpha, TTS, vote up/down), `AlphaAvatar`.

**`ThinkingIndicator`** (`components/chat/ThinkingIndicator.tsx`):
- 3-stage animated label: Reading → Thinking → Writing.
- Respects `useReducedMotion()`.

**`MicSheet`** (`components/composer/MicSheet.tsx`):
- Canvas waveform animation during recording.
- Browser `SpeechRecognition` (Web Speech API) — continuous, interim results.
- Tunable animation params (speed, bar width, max height ratio).
- Transcript auto-inserts into OneBox on stop.

**`DocumentView`** (`components/output/DocumentView.tsx`):
- Renders final brief as `MarkdownReply`.
- Sources list: title, URL, snippet, `by` wolf, `verified` badge.
- Header actions: close, new hunt, download (.md), copy, more menu.
- More menu: share (mints token, copies URL), save as instinct.

**`DenDrawer`** (`components/den/DenDrawer.tsx`):
- Slide-in from left. Hunt list grouped by recency or project.
- Client-side title search.
- State badges (Draft / Planning / Plan Ready / Hunting / On Hold / etc.).
- New hunt, rename (window.prompt — see §7), delete, archive.
- Saved instincts section.
- Project filter switcher.

**`AlphaReactionSheet`** (`components/composer/AlphaReactionSheet.tsx`):
- Fully coded context-aware "what to do with this file?" sheet.
- Detects file type and suggests contextual actions.
- **Not wired into the main drop/attach flow** — present but not triggered in practice.

---

### 4.7 Working vs Stubbed UI Features

**Fully working:**
- Intake conversation with Alpha on Door.
- Hunt creation and plan review.
- Plan approval (leash mode, budget, angle edits).
- Live Territory canvas with all 7 wolf states.
- Edge animation (dormant → flowing → blocked).
- TraceRail live feed.
- Hold resolution (radio buttons in rail).
- Boundary warning / downgrade / halt UI.
- Alpha chat (streaming, edit, regenerate, vote).
- File drag-drop, parsing (PDF/CSV/text/URL).
- Image parse via Qwen-VL (`/parse`).
- Voice recording (Web Speech API).
- Audio transcription (`/transcribe`).
- Tracks page (audit log).
- Scorecard page (benchmark).
- Share view (public brief).
- Den drawer (hunt list + instincts).
- Settings (custom instructions, data clear).
- Projects (create, assign hunt, filter Den).
- HuntCompleteToast (auto-dismiss, cross-hunt notification).

**Present but broken / stubbed:**
- **Light theme**: SettingsModal says "on the way"; no light-mode CSS exists.
- **AlphaReactionSheet**: Coded, never triggered in main flow.
- **Hunt rename from Den**: Button exists; uses `window.prompt()` stub (no API call wired).
- **Hunt archive from Den**: Button visible; archive API call not confirmed wired.
- **Checkpoint resume continuation**: UI shows "Raise cap / Stop" correctly; backend re-runs from start of current `_dispatch()` call, not from a persisted strategy state (see §2.6 Checkpoints).
- **Instinct editing**: Save works; no edit UI.
- **Full click-to-trace span map**: Coarse claim→sources map exists (B3); character-offset spans in final brief not implemented.

**Not built:**
- Anything in `PARKING_LOT.md`: marketplace, export-as-API, scheduled hunts, hunt forking, version control, accounts/login, billing, mobile apps, CRM integrations, model fine-tuning, SOC2.

---

## 5. Feature Inventory

| Feature | Status | Notes |
|---------|--------|-------|
| Alpha intake conversation (Door) | WORKING | SSE streaming; `ready` flag triggers hunt |
| Hunt creation (POST /hunts) | WORKING | Async task; 202 Accepted |
| Beta plan proposal (structured JSON) | WORKING | Offline-safe; normalized with sane defaults |
| Plan display in UI | WORKING | PlanSidebar: steps, wolves, assumptions, strategy |
| Research angle editing before launch | WORKING | PlanChatSidebar editable query inputs; `plan_edited` event |
| Leash mode picker (wild / signal / command) | WORKING | Sets autonomy mode |
| Budget cap input | WORKING | First-hunt silently capped at $0.50 |
| Wolf spawning (all 8) | WORKING | All emit `wolf_spawned` before strategy runs |
| Territory canvas (React Flow + dagre) | WORKING | |
| Wolf node 7-state animation | WORKING | idle/hunting/talking/holding/stray/done/thinking |
| Edge animation (dormant/flowing/blocked) | WORKING | |
| TraceRail live feed | WORKING | Colored FeedLine[] |
| Scout parallel search (3 scouts) | WORKING | `asyncio.gather` |
| Web search (Tavily) | WORKING | Offline: CannedProvider |
| Web fetch / deep-read top URL | WORKING | Offline: stub; A4 |
| Scout findings structured output | WORKING | `FINDINGS_SCHEMA` |
| Adaptive scout retry (thin findings) | WORKING | OrchestrateStrategy only |
| Tracker merge with conflict detection | WORKING | `MERGE_SCHEMA`; conflict → Hold |
| wolf_progress live beats (canvas) | WORKING | Sentence-throttled; max 8 per step |
| Holds (human decision gates) | WORKING | wild: auto-resolve; signal/command: pause |
| Hold resolution UI (radio + submit) | WORKING | PlanChatSidebar pinned widget |
| Standoffs (3-turn debate) | WORKING | challenge/defend/judge intents |
| Standoff in Critique strategy | WORKING | Sentinel triggers before draft |
| Stray detection (repeat_fail / loop / timeout) | WORKING | StrayDetector + `_stray_event` |
| Boundary warning at 70% | WORKING | Once per hunt |
| Boundary downgrade at 85% (→ flash) | WORKING | Per-wolf; `boundary_downgrade` event |
| Boundary halt at 100% | WORKING | `_halt()` + `_await_resume()` |
| Boundary halt UI (raise cap / stop) | WORKING | PlanChatSidebar pinned widget |
| Checkpoint save on halt | WORKING | Writes `checkpoints` table |
| Checkpoint resume (strategy continuation) | PARTIAL | `_await_resume()` works; strategy restarts from current step, not from saved state |
| Token/cost accounting (per dispatch) | WORKING | `tokens_spent` event after every LLM call |
| Howler draft (cited brief) | WORKING | Free-text intent; `"draft"` |
| Final artifact save + `artifact_created` | WORKING | |
| Coarse span map (claim → sources) | WORKING | B3 implementation |
| Full click-to-trace span map (char offsets) | NOT BUILT | Howler schema exists; engine doesn't populate it |
| `hunt_completed` event + totals | WORKING | |
| Brief display (DocumentView) | WORKING | MarkdownReply + sources list |
| Sources `verified` badge (fetched vs snippet) | WORKING | `h["verified"] = bool(h.get("text"))` in scout |
| Alpha side-chat during hunt (streaming) | WORKING | POST /ask/stream + SSE |
| Custom instructions (prepended system msg) | WORKING | settingsStore → injected in all Alpha calls |
| Mid-hunt input injection (`add_input`) | WORKING | REST + queue; `_absorb_inputs()` in merge |
| Audio transcription (Qwen ASR) | WORKING | Offline: FakeTranscriber |
| Image parse (Qwen-VL) | WORKING | `/parse` routes images to `describe_image()` |
| PDF/CSV/URL parse | WORKING | `file_parse.py`; `detect_kind()` |
| Video files | NOT BUILT | Explicitly declined (400) |
| Voice recording (Web Speech API) | WORKING | MicSheet; canvas waveform |
| Deep Dive strategy (gap iteration) | WORKING | `find_gaps()` → second scout round |
| Critique strategy (Sentinel Standoff) | WORKING | Sentinel → Standoff → re-merge |
| Orchestrate strategy (default) | WORKING | |
| Benchmark (Lone Wolf vs Pack) | WORKING | Background task; `benchmark_started/completed` |
| Scorecard page | WORKING | Side-by-side comparison; export JSON |
| Hunt stop (user-initiated) | WORKING | REST + StopHunt exception |
| Tracks (audit log export, PII redacted) | WORKING | `/tracks/export` + `redact_event` |
| Share (public token + read-only view) | WORKING | `/share` endpoints + ShareView page |
| Den drawer (hunt list, recency grouping) | WORKING | |
| Hunt search (client-side, by title) | WORKING | |
| Hunt archive | PARTIAL | API exists (`PATCH /hunts` with `archived: true`); Den button uses `window.prompt` stub |
| Hunt rename | PARTIAL | API exists; Den button uses `window.prompt` stub |
| Projects (workspaces) | WORKING | Full CRUD + assign hunt + Den filter |
| Instincts (saved plan presets) | WORKING | Save from brief + list in Den + apply at Door |
| Instinct editing | NOT BUILT | No edit UI |
| Feedback (vote on Alpha replies) | WORKING | `feedback` table; `POST /hunts/{id}/messages` implied |
| HuntCompleteToast (cross-hunt notification) | WORKING | Auto-dismiss |
| Light theme | NOT BUILT | SettingsModal placeholder only |
| AlphaReactionSheet | PARTIAL | Fully coded; not triggered in main flow |
| Offline mode (no API keys) | WORKING | FakeQwen + CannedProvider + FakeTranscriber |
| Docker dev infra (Redis + Postgres) | WORKING | `docker-compose.yml` |
| Production Docker images | EXISTS | `deploy/` Dockerfiles; not confirmed deployed |
| Auth / accounts / login | NOT BUILT | Explicitly P2 (PARKING_LOT.md) |
| Billing / payments | NOT BUILT | Explicitly P2 |

**New features relative to v0.5 spec (added to scope):**
- Projects / workspaces (full CRUD + hunt assignment)
- Mid-hunt input injection (audio, PDF, URL during hunt)
- Image parse via Qwen-VL
- Audio transcription (Qwen ASR + FakeTranscriber)
- Research angle editing before launch (editable query inputs + `plan_edited` event)
- "Send the pack" as a persistent launch button in the composer (not hidden on empty)
- Benchmark module (`run_benchmark`, scorecard events)
- AlphaReactionSheet component
- `wolf_progress` live beats (canvas telemetry)
- `transcript_ready` event type
- `input_added.mid_hunt` flag
- Per-wolf source count and spend on wolf nodes (via additive `hits` field in `tool_result`)
- Share token system (`/share`)
- `checkpoints` table
- `feedback` table

**Changed from v0.5 spec:**
- Howler tier hardcoded to `plus` (prompt says `plus / max`; roster uses `plus`).
- `hunter` role listed in the schema's wolf role enum but no `hunter` wolf exists in the roster.
- `elder` role also in schema enum but not built.
- Checkpoint resume is infrastructure-only (no strategy continuation from saved state).
- Full provenance span map is not populated (Howler's prompt and schema describe it; `finish()` only builds a coarse `{claim, source_refs}` list).

---

## 6. Tests & Deployment

### 6.1 Backend Tests (`backend/tests/`)

8 pytest files. All run with `pytest -q`. Integration tests (relay, repo) skip automatically if no Postgres is available.

| File | What it covers |
|------|----------------|
| `test_emitter_seq.py` | Seq is dense, 0-based, gap-free under concurrent emits (50 concurrent emits, in-memory FakeRepo) |
| `test_contract.py` | Every fixture `.jsonl` validates against the frozen JSON schema; all required event types exist; seq is monotonically increasing; all actors are valid strings |
| `test_offline_hunt.py` | Full Supervisor run end-to-end (FakeQwen + in-memory repo): `hunt_created` opens, `hunt_completed` closes; required lifecycle types all present; boundary not exceeded; all events valid against schema |
| `test_outbox_relay.py` | Committed event reaches the Redis bus (real Postgres, skipped if none); re-draining already-relayed rows publishes nothing new |
| `test_repo.py` | CRUD operations on Postgres: create/update hunt, append events, save artifact, messages (real Postgres, skipped if none) |
| `test_pricing.py` | `cost()` and `estimate()` return correct USD values for each tier; config overrides work |
| `test_tools.py` | WEB_SEARCH + WEB_FETCH offline (CannedProvider); `describe_image` offline stub; file_parse for PDF/CSV/text |
| `test_completion.py` | QwenClient offline: structured output returns `parsed` dict; retry + backoff behavior; circuit breaker opens after threshold |

**Fixtures** (`backend/fixtures/`):
- `flow_a_researcher.jsonl` — a full researcher hunt event sequence
- `flow_b_meeting.jsonl` — a meeting-notes hunt event sequence
- `boundary_halt.jsonl` — boundary halt + resume sequence
- `standoff_stray.jsonl` — standoff and stray recovery sequence

The `test_contract.py` gates on `{flow_a_researcher, flow_b_meeting, boundary_halt, standoff_stray}` existing and passing schema validation.

### 6.2 Frontend Tests (`frontend/`)

One test file: `src/events/reducer.test.ts` (Vitest).

- Loads `.jsonl` fixture files from `frontend/src/fixtures/` (mirrored from backend via `make sync-fixtures`).
- Feeds every event through `reduce()` and asserts the resulting `HuntView` matches expected state.
- Run with `pnpm test` (single run) or `pnpm test:watch` (watch mode).

### 6.3 Gateway Tests

No dedicated test file. `make test` runs `cargo check` (type-checks the Rust source, no runtime tests).

### 6.4 Deployment State

**Production artifacts exist in `deploy/`:**
- `engine.Dockerfile`, `gateway.Dockerfile`, `web.Dockerfile`
- `docker-compose.prod.yml`
- `nginx.conf` (reverse proxy: `/` → frontend static, `/api` → engine, `/ws` → gateway)
- `deploy/.env.prod.example` (template for production env vars)
- `DEPLOY.md` (deployment documentation)

**Target infrastructure (from comments and .env.example):**
- Engine + Gateway + Web: Alibaba Cloud ECS (Docker containers)
- Redis: Alibaba Cloud Tair (Redis-compatible)
- Postgres: Alibaba Cloud ApsaraDB RDS
- Object storage: Alibaba OSS (optional; not yet used in engine)

**Current live status:** Not confirmed deployed. The codebase is in active development on branch `tobiloba/engine-spine`. All infra and config files exist; whether a live instance is running is not determinable from the code alone.

---

## 7. Known Gaps & Rough Edges

### Explicit TODOs and FIXMEs

1. **Checkpoint continuation**: `_await_resume()` raises the boundary and returns, so `_dispatch()` re-runs the same call. But the strategy's `execute()` function does not resume from a saved position — if the halt happened during `scout()`, the merged findings so far are still in memory and the dispatch re-runs correctly because it's inside `asyncio.wait_for`. If the process restarts after a halt, the strategy state is lost entirely. The `checkpoints` table and `state` JSONB column exist but are not read on resume.

2. **Full provenance span map**: Howler's prompt (`howler/v1.md`) and the `artifact_created` schema both describe a per-span `{span: [start, end], produced_by, source_refs, standoff_ids, transcript_ts}` map. The engine (`finish()`) builds only a coarse `{claim, source_refs}` list and saves it as `kind="spanmap"`. No character offset tracking is implemented.

3. **`hunter` and `elder` wolf roles**: Both appear in the `wolf_spawned` payload's role enum in `events.schema.json`. Neither has a system prompt in `prompts/`, and neither appears in `_ROSTER`. The schema is forward-reserved but these roles are not built.

4. **Hunt rename / archive from Den**: `DenDrawer` shows rename and archive buttons. The rename action uses `window.prompt()` (a browser synchronous dialog) rather than calling `PATCH /hunts/{id}`. The archive button's wiring is not confirmed in the component.

5. **AlphaReactionSheet not triggered**: `AlphaReactionSheet` is fully coded with context-aware file type detection. It is imported in `OneBox` but the condition that shows it is never met in the normal drop/attach flow. It reads as Phase 2 work that was built but not connected.

6. **Offline ASR provider label**: `transcript_ready` payload `provider` enum is `"qwen_voice" | "qwen_asr"`. The offline `FakeTranscriber` returns `provider="qwen_asr"` regardless. In practice this is indistinguishable.

7. **`plan_proposed` schema says `assumptions` is optional** but `_normalize_plan()` always provides it. The UI (`PlanSidebar`) assumes it is present.

8. **`wolf_progress` beats are not throttled by a timer** — they're throttled by sentence boundaries and a length counter (max 8 per dispatch). Under very short outputs (sentences under 40 chars) no beats are emitted. This is by design but can leave a wolf appearing stuck on the canvas.

9. **No WebSocket auth**: The gateway serves any client that connects with a valid hunt ID. There is no session token or auth check on the WebSocket. `SESSION_SECRET` is defined in config but not yet used on any endpoint (no session-based auth exists anywhere).

10. **CORS is `*`**: `app.add_middleware(CORSMiddleware, allow_origins=["*"])`. Safe for development and same-origin nginx prod setup, but not hardened.

11. **`strategy` field on `plan_proposed`**: Added as an "additive" field in `_normalize_plan()`. The JSON Schema for `plan_proposed` does not require it (the schema says `additionalProperties` is allowed in payload). The canvas reads it but it's not validated.

12. **`hits` field on `tool_result`**: Added as an additive field by the Supervisor. Not in the frozen schema's `tool_result` payload definition. The schema allows extra payload properties, so it passes validation. The canvas reads it for per-wolf source counts.

13. **FakeQwen is topic-aware but not perfectly deterministic under all inputs**: It branches on keywords in the raw input to produce plausible-looking structured output. Edge cases (empty input, very long input) fall back to generic stubs.

14. **`PARKING_LOT.md` is contractually frozen**: The following are explicitly P2 and zero code exists for them: marketplace for instincts, export-a-hunt-as-an-API, scheduled hunts, hunt forking, version control, cross-user collaboration, wolf experience levels, guardrail nodes, accounts/login, native mobile apps, billing/payments, inbox/CRM/calendar integrations, model fine-tuning, SOC2-grade compliance.
