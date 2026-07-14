# OpenClaw study — quality techniques mapped to Pack

We do not vendor OpenClaw. This is a **pattern study**, in the same spirit as `BORROWING.md`: we read
the real source of a mature, MIT-licensed multi-agent platform (`github.com/openclaw/openclaw`,
Copyright OpenClaw Foundation, MIT), extracted engineering techniques, and judged each one against
Pack's actual code — not against OpenClaw's ambitions. Every item below cites the Pack file that gap
lives in and, where useful, the OpenClaw file the technique was read from.

**Method:** ten parallel deep-reads across OpenClaw's platform (gateway, agent-core loop, sub-agent
spawn/isolation, Workboard, fleet/routing, MCP/skills/hooks, LLM/caching, retry/repair/SSRF,
telemetry, process) and primitives, each independently verified against real code, no pre-filtering —
109 distinct techniques scored for portability, value, and effort. Two findings (the SSRF hole, the
cache-ordering bug) were independently confirmed against Pack's live code before this study ran.

---

## A. The architecture verdict

**Stay single-turn/engine-scripted as the spine. Evolve narrowly, in one bounded place — not
system-wide.**

Pack's `Wolf.think()` (`backend/app/engine/wolves.py`) is one blocking `chat.completions.create` per
call, fresh `[system, user]` every time (`backend/app/qwen/client.py:203,225`). The default strategy
(`backend/app/engine/strategies/orchestrate.py`) is a flat awaited primitive sequence — scout → merge →
critique → draft — with deterministic retry and zero model-issued control flow.

OpenClaw's spine is the opposite: a Gateway multiplexes agents running an agentic tool-calling loop
(`packages/agent-core/src/agent-loop.ts`), spawning isolated sub-agents with scoped context, coordinating
via a Workboard (claim/dispatch/link cards with dependencies), self-healing via fleet health checks and
a standing heartbeat.

**The five big moves, judged against Pack's actual shape:**

1. **Agentic tool-loop** — *consider, prototype only.* Full adoption breaks FakeQwen determinism,
   breaks the Boundary's pre-dispatch single-reservation gate (needs a running meter instead), and needs
   a new event class in the frozen `events.schema.json`. A system-wide swap is the wrong trade for a
   product whose pitch is bounded cost/latency per hunt.
2. **Sub-agent spawning (recursive)** — *no*, beyond a depth-1 "Tracker requests one more scout" slice.
   Pack's fan-out is naturally flat.
3. **Work-board coordination** — *no.* Solves a multi-session/resumable-work problem Pack doesn't have —
   one HTTP-request-scoped Supervisor run has exactly one claimant.
4. **MCP/skills/hooks/permissions** — split. MCP-as-protocol and the permission model: skip (nothing to
   attach to, nothing to gate). Internal event-hook bus: **adopt now** — a same-process refactor, not an
   architecture change.
5. **Autonomous heartbeat/fleet-health** — *partial.* Scheduled re-hunts and nightly memory consolidation
   are genuinely valuable; OpenClaw's full scheduler (phase-jitter, wake-coalescing, active-hours) solves
   multi-tenant thundering-herd problems Pack doesn't have at its scale. Build a plain cron job instead.

**The smallest high-payoff architecture bet — `deep_scout`:** a *new* wolf variant (not Tracker) gets a
bounded tool-loop — hard-capped at 3 calls, choosing only between the two tools the engine already calls
deterministically (`web_search`, `web_fetch`). Boundary's per-wolf budget becomes a running meter instead
of a single reservation. FakeQwen gets a narrow fixed script for just this wolf type. One additive
`tool_selected` event. Opt-in, scoped, reversible. **Not started; gated behind item 94 below.**

**Leave alone entirely:** work-board/two-tier task records, N-level recursive spawn, MCP stdio servers,
route-binding tiers, streaming tool-call repair, cascading cancellation, stale-claim reaping,
wake-coalescing — all presuppose durable/resumable sessions or multi-tenant scale Pack doesn't have.

---

## B. Every portable technique, by category

V = Value, E = Effort. **adopt** = do it as-is; **adapt** = port the idea, not the code; **consider** =
real but sequenced behind a trigger condition; **skip** = not applicable, reason given.

### Security
| # | Technique | Pack gap | V/E | Rec |
|---|---|---|---|---|
| 1 | SSRF: block CGNAT (`100.64.0.0/10`) + Alibaba metadata IP | `_ssrf.py:25-33 _is_blocked` misses this range — `100.100.100.200` (Alibaba's real ECS metadata IP; Pack deploys on Alibaba Cloud) is not `is_private`/`is_reserved` and sails through. | **high/S** | **adopt — today** |
| 2 | Unwrap embedded IPv4-in-IPv6 (5 transition encodings) before classifying | A 6to4/Teredo/ISATAP encoding of the metadata IP bypasses even a fixed blocklist. | high/M | adopt — bundle with #1 |
| 3 | IP-pin the connection + re-validate every redirect hop | **Pack already does this** — see section C. | — | already have |
| 4 | Fail-closed pre-tool-call veto/param-rewrite hook | Zero interception point before search/fetch executes. | high/M | adopt (sync slice only) |
| 5 | Static content-injection scanner (prompt-injection/secret-exfil regex) | Raw scraped web content flows into wolf prompts with zero screening — a live injection vector, sharper for single-turn wolves that get no chance to "notice" a poisoned instruction. | **high/M** | **adopt — one of the highest-value items overall** |
| 6 | Pre-decode size caps + content-addressed receipts on file intake | Unverified whether Pack's upload handling caps before decoding base64. | medium/M | consider — pending audit |
| 7 | Runtime exact-value secret redaction registry | `redact.py` is pattern-only and applied **only to Tracks export** — the event log itself is never scrubbed. | **high/M** | **adopt** |
| 8 | Document a heuristic's known gap in-code | Applies directly to #1. | medium/S | adopt alongside #1 |
| 9–15 | injection-safe parsing / ReDoS analyzer / tool allow-deny inheritance / provenance-tracked policy / deferred approval / confusable-char defense / HMAC audit ledger | All solve problems Pack's deterministic tool dispatch and single-tenant shape don't have. | low | **skip — templates for if the agentic loop or multi-tenant scope ever lands** |

### Caching
| # | Technique | Pack gap | V/E | Rec |
|---|---|---|---|---|
| 16 | Stable-prefix / dynamic-suffix cache boundary marker | `prompt_context.py:212` builds `system = f"{temporal_grounding()}\n\n{persona}"` — the date-changing temporal block sits **ahead of** the stable persona, so no provider-side cache can ever hit. Independently confirmed twice against live code. | **high/S** | **adopt — highest-value item in the whole study: cheap, zero architecture change, fixes a live bug** |
| 17 | Explicit per-role context-propagation modes | One shared chars/4-fitted prompt for every wolf — no per-role choice between "full brief" and "just my query." | **high/M** | **adopt** — doing this properly forces #16's reorder as a side effect |
| 18 | Identity-keyed persona-render caching | Same opportunity as #16/17. | medium/S | adopt |
| 19 | TTL/retention tri-state (none/short/long) | Caching is unwired, no retention concept yet. | low/S | consider — bundle into the real-caching PR |
| 20–22 | 4-marker cache_control budget / runtimeContextCarrier opt-out / cache-retention family classification | Solve multi-turn-transcript or multi-deployment-surface problems; Pack sends one fresh `[system,user]` pair, one provider. | low | **skip — not applicable** |

### Reliability
| # | Technique | Pack gap | V/E | Rec |
|---|---|---|---|---|
| 23 | OS-native process supervision (systemd/Task Scheduler unit) | Zero process-supervision story — matches the recorded pain of manual `pg_ctl` after every reboot. | **high/S** | **adopt** |
| 24 | Layered graceful shutdown, per-step timeout, warn-not-crash | `main.py:37` / `registry.shutdown()` is one call — no per-step timeout, no escalating force-continue. | **high/M** | **adopt** — pairs with #25 |
| 25 | Process-wide admission/quiescence gate ("draining" flag + in-flight counter) | No "stop accepting new hunts, drain in-flight" primitive. | high/M | adopt — a plain counter suffices for Pack's flat call depth |
| 26 | Per-agent (not global) circuit-breaker scoping | `client.py:103-108 _Breaker` is one instance on the process-global `QwenClient` — one hunt's failures trip the breaker for every concurrent hunt. | **high/M** | **adopt** — key by `(provider, hunt_id)` |
| 27 | Typed closed-union error taxonomy for primitive failures | No typed error classes in `supervisor.py`; Warden reroutes on `stray_detected` with no structured "why." | **high/S** | **adopt — cheapest, highest-leverage item on the list** |
| 28 | Sticky-terminal conflict resolution for late results | No precedence check for "a late scout response arrives after Warden already rerouted." | medium/S | adopt |
| 29 | Directional jitter keyed to Retry-After honorability | `client.py:176-180` jitter is purely additive/symmetric, zero Retry-After awareness. | medium/S | adopt — bundle with #30 |
| 30 | RFC 9110 Retry-After parsing | No Retry-After handling at all. | low/M | consider — confirm DashScope sends it first |
| 31 | Failure-path symmetry audit | Unverified whether `forge.py`/`rehearse.py`/`healing.py` clean up as precisely as this requires. | medium/M | consider — route through future quality passes |
| 32–49 | persist-before-mutate audit, ownership guard-rail audit, abort-safe batching, turn-interruption artifacts, read-side row validation, retention pruning, idempotency classification, streaming repair, lenient-JSON grammar, Result-type audit, coercion clamping, surrogate-safe slicing, worker-thread audit writer, session mutex, WS backpressure/heartbeat/lazy-load, capability-ladder degradation | Mostly gated behind cancellation/streaming/multi-turn Pack doesn't have; #36 (read-side event validation) and #42 (timeout/clamp audit) are cheap standalone wins. | mixed | see roadmap |

### Orchestration architecture
| # | Technique | Pack gap | V/E | Rec |
|---|---|---|---|---|
| 50 | Depth-bounded recursive self-delegation | Zero equivalent — scouts are leaves by construction. | medium/XL | consider — cheaper slice: a typed `spawn_request` field on Tracker's output, executed deterministically, capped by Boundary |
| 51 | **Double nested loop: tool-call + queued-message loop** (the agentic engine itself) | No per-wolf multi-call turn concept — this is the architecture fork from §A. | high/XL | **consider — the `deep_scout` prototype, one wolf, opt-in, never system-wide** |
| 52 | Mid-run steering + follow-up queues | Confirmed absent — Hold gate is hard stop-resume, not live injection. | high/XL | adopt, strictly gated on #51 |
| 53 | Session-key namespacing as sandbox boundary | Scouts have no addressable identity distinct from the hunt row. | medium/S | adopt — purely additive, no architecture change |
| 54–74 | resource caps, named-lane concurrency, tool-call funnel, push-completion, ownership split, target-agent policy, streaming reducer, idempotent creation, two-tier task model, background sweep, cron heartbeat, category-based retry, cascading cancellation, wake-coalescing, standing heartbeat scheduler, route binding, hash-phase scheduling, manifest plugin loading | Mostly gated behind #50-52 or scale Pack doesn't have. **Exception:** #55 — replace the bare `asyncio.gather` scout fan-out (`supervisor.py:2072`) with a configurable `Semaphore`, no lane apparatus needed. #69 (standing heartbeat) is high-value but XL — **ship as a plain cron job.** | mixed | see roadmap |
| 75 | Internal event-hook bus | `healing.py`/telemetry are direct function calls at each site. | medium/S | **adopt now** — becomes the hook point for #5's content screening |
| 76–78 | MCP stdio servers, provider registry, per-model compat flags | Presuppose a persistent external-facing process or a second LLM provider. | low | **skip until triggered** |
| 79 | Provider-adapter Protocol seam around `QwenClient` | Single-provider client, no adapter interface — cheap now, expensive to retrofit later. | medium/S | adopt |
| 80 | `on_payload` interceptor (single hook) | `client.py:203` calls `chat.completions.create` directly inline, no pre-send mutation seam. | medium/S | adopt — natural seam for #16's fix |
| 81–82 | dual-interface streaming event model, fine-grained lifecycle bus | Genuine future capability (live per-Wolf progress) but a real cross-cutting streaming rewrite. | medium/XL | consider as a deliberate future item, not piecemeal |

### Memory & telemetry
| # | Technique | Pack gap | V/E | Rec |
|---|---|---|---|---|
| 83–84 | "Commitments" background extraction, cache-aware context-budget accounting | Foreign to single-turn Pack; #84 is a design note for whenever a real tokenizer lands. | low | skip / note |
| 85 | Provider usage-first token accounting | Pure chars/4 heuristic, no `cached_tokens`, never reconciled against real usage. | **high/M** | **adopt — enables measuring whether #16 works** |
| 86 | Normalized Usage record (cache-read/write/reasoning buckets) | `tokens_spent` has `in_tokens/out_tokens/cost_usd/cumulative_usd/retry_count` only. (Pack does compute `cost_usd` per-call via `pricing.py` already — it lacks cache-aware buckets.) | **high/S** | **adopt** |
| 87 | Model-call latency (`duration_ms`) on `tokens_spent` | `tool_result` has `latency_ms`; the LLM-call event has no latency field at all. | **high/S** | **adopt** |
| 88 | Named-stage wall-clock tracker per hunt | No per-primitive timing breakdown, only aggregate duration after the fact. | medium/S | adopt — a log line, not a schema change |
| 89 | Cache-trace diagnostic (message-fingerprint digest) | Direct instrumentation for the #16 bug, currently invisible except by code reading. | **high/S** | **adopt — right after #16 ships** |
| 90 | Tiered cost-estimation rollup | No derived cost rollup beyond raw per-call `cost_usd`. | medium/M | adapt — single static Qwen pricing table, computed at query time (schema is frozen) |
| 91–93 | iteration-aware usage split, provider billing reconciliation, multi-source pricing catalog | Solve multi-provider/multi-turn problems Pack doesn't have. | low | skip / consider only if an Alibaba billing API is confirmed |

### Testing
| # | Technique | Pack gap | V/E | Rec |
|---|---|---|---|---|
| 94 | **Live-key QA harness gated strictly behind executable-green** | FakeQwen-offline-only + one respx wire file — **no live-Qwen-key harness exists.** Directly serves "prove the thinking fix on a real Qwen key first." | **high/L** | **adopt — build BEFORE the `deep_scout` prototype (#51), so that bet is measured, not eyeballed** |
| 95 | Structured JSONL replay scenarios from real incidents | Embryonic (one respx file), no convention for capturing production Warden triggers as fixtures. | medium/S | adopt |
| 96 | Injectable random/sleep in the retry runner | Backoff calls `random.uniform`/`asyncio.sleep` inline, not injectable. | low/S | consider — low leverage until #29 lands |
| 97 | cache_control-forbidden-on-thinking-blocks test lock | Mechanism N/A; fold the lesson (lock #16's split with a unit test) into that item's plan. | — | fold in |

### Process
| # | Technique | Pack gap | V/E | Rec |
|---|---|---|---|---|
| 98 | `NOT_ENOUGH_INFO` grounded-evidence sentinel | No issue templates; more interesting — wolves have no "refuse to fabricate" instruction pattern. | medium/S | adopt — a real prompt-engineering upgrade for a research tool that must never fabricate citations |
| 99 | QA maturity scoreboard (structured, generated) | Wolf-quality tracking lives only in an unstructured memory note today. | **high/M** | **adopt — replaces the ad hoc sweep note with a durable artifact** |
| 100 | AST-based CI architecture-invariant guards | Ruff+mypy exist, no custom invariant guards. Maps precisely onto two already-found bugs (#16, #1). | **high/M** | **adopt — turns two found bugs into structurally-enforced invariants** |
| 101 | AGENTS.md as hard policy, CLAUDE.md as pointer | No tool-agnostic policy split today. | medium/S | adopt |
| 102 | Pre-commit hardening audit | Unconfirmed breadth of Pack's existing pre-commit stack. | medium/S | adopt |
| 103 | Enumerated "doctor" health sweep (pass/warn/fail, not fail-fast) | Warden is reactive per-hunt; no proactive static sweep. This audit would have caught #1 proactively. | medium/M | adopt |
| 104–107 | changelog attribution guard, selective CI by changed-file lane, release-SHA split, PR-volume gates | Solve multi-contributor/monorepo/release-cadence problems Pack doesn't have at single-owner scale. | low | skip |

### Other
| 108–109 | lazy server-import facade, lazy WS handler | One FastAPI backend, not many small CLI entrypoints; no WS handler exists. | low | skip |

---

## C. Pack already does this as well or better

**IP-pinning at TCP-connect layer with per-redirect-hop re-validation.** `backend/app/tools/_ssrf.py`'s
`assert_public_url` + `safe_fetch`'s redirect-loop re-validation + `_pinned_get`'s IP-literal dial with
preserved Host header and `sni_hostname` TLS extension — architecturally equivalent to OpenClaw's own
pinned-lookup approach. The DNS-rebinding TOCTOU is closed the same way. **The only real defect in this
subsystem is the blocklist data gap (items 1-2 above) — the pinning mechanism itself needs no change.**

## D. Genuinely not applicable (22 items)

WS backpressure/heartbeat/lazy-load, wire-protocol reconnect fencing, push-completion anti-poll,
requester/owner spawn split, target-agent policy allowlist, idempotent-task dedup, deferred tool
resolution, provider-aware thinking-level fallback, streaming tool-call repair, 4-marker cache budget,
runtimeContextCarrier, cache-retention family classification, idempotency-aware retry classification,
Unicode-confusable key matching, thinking-block cache stripping, most-specific route binding, MCP stdio
servers, multi-source pricing reconciliation, changed-file CI lanes, release-SHA split, PR-volume gates
— one-liners for each are in the item table above under their respective category; nothing was silently
dropped.

## E. Sequenced roadmap

> **STATUS (updated 2026-07-14): all phases executed.** A live-code audit ran first (Section F below)
> and reshaped the plan — several items were already done or not applicable, and one real bug the study
> missed was found (the `-p no:randomly` gate was never committed). What shipped, in commit order:
>
> - **Batch A** `c45f046` — model-call `latency_ms`, the `on_payload` seam, AST invariant guards
>   (`scripts/check_architecture.py`, in CI), and the consistent `randomly` test-order gate.
> - **Batch B** `9c86dc9` — admission/draining gate on shutdown, RFC-9110 Retry-After honoring,
>   exact-value secret-redaction registry, lenient-JSON dedup.
> - **Batch C** `850a49d` — content-injection scanner + fail-closed pre-fetch URL gate
>   (`content_guard.py`), replay-incident fixture convention (`fixtures/incidents/`).
> - **Batch D** `0a18e2c` — NOT_ENOUGH_INFO anti-fabrication prompts, `pack doctor` health sweep, QA
>   scoreboard (`docs/QA_SCOREBOARD.md`), `AGENTS.md`, mypy+eslint+arch-guard pre-commit hooks.
> - **Batch E** `6c071bf` — the live-key QA harness (`tests/live/`, gated, `backend-live.yml`) and the
>   opt-in `deep_scout` bounded tool-loop (`deep_scout.py`, `deep_scout_enabled` default **off**).
>
> **Already done before this pass (confirmed by audit, not redone):** per-hunt breaker (#26), typed
> error taxonomy (#27), cache-boundary reorder (#16) + token-usage/`cached_tokens` (#85-87), graceful
> shutdown (#24), mid-hunt steering (#52), Boundary running-meter (#50 mechanism), OS process
> supervision (#23, Docker restart policy), IP-pinning SSRF (#3).
>
> **Not applicable as architected:** sticky-terminal conflict resolution (#28 — reroute is cosmetic,
> `asyncio.wait_for` already cancels the task, so no late-result race exists).
>
> **Deferred as documented triggers (decided 2026-07-14, not built):** provider-adapter Protocol (#79),
> session-key namespacing (#53), event-hook bus (#75), cron re-hunts — each is YAGNI until its trigger
> fires. **Read-side event validation (#36)** is a cross-repo concern (the Rust gateway is the real
> consumer) and stays flagged there.
>
> **The two remaining live-key proofs** (need a real Qwen key, harness is built): flip
> `qwen_prompt_cache_enabled` on only after `tests/live` shows `cached_tokens > 0` in this reordered
> shape; prove `deep_scout` on the harness before enabling `deep_scout_enabled`.
>
> The original phase plan is preserved below for reference.

**Phase 0 — today, independent of everything else**
SSRF CGNAT + Alibaba metadata fix (#1-2, one PR) + the in-code limitation comment (#8).

**Phase 1 — days, no architecture change (measurement + correctness)**
Cache-boundary reorder (#16) → cache-trace diagnostic (#89) → token-usage schema extension
(#85-87) → named-stage timing (#88) → typed error taxonomy (#27) → per-hunt breaker (#26) →
`on_payload` seam (#80) → provider-adapter seam (#79) → session-key namespacing (#53) → AST CI guards
locking #16 and #1 as invariants (#100).

**Phase 2 — 1-2 weeks (reliability hardening)**
Graceful shutdown + admission gate (#24-25) → directional jitter + Retry-After (#29-30) → sticky-terminal
conflict resolution (#28) → read-side event validation (#36) → content-injection scanner (#5) →
fail-closed pre-tool-call gate (#4) → secret redaction registry (#7) → event-hook bus (#75) → OS-native
process supervision (#23) → lenient-JSON consolidation (#40) → replay scenario library (#95).

**Phase 3 — the architecture bet, only after Phase 1's measurement infra exists**
Live-DashScope QA harness (#94) **first** → prototype `deep_scout` bounded tool-loop (#51) → if it
proves out: mid-hunt steering (#52), depth-1 dynamic spawn (#50).

**Phase 4 — process/scheduling, parallel low-risk track**
QA maturity scoreboard (#99) → `NOT_ENOUGH_INFO` in Sentinel/Howler prompts (#98) → AGENTS.md split
(#101) → `pack doctor` (#103) → pre-commit audit (#102) → plain cron job for scheduled re-hunts,
explicitly rejecting the full heartbeat scheduler (#69, narrowed).

**Explicitly deferred, revisit only on a stated trigger:** two-tier work model (trigger: resumable hunts
on the roadmap) · full heartbeat scheduler (trigger: plain cron proves insufficient) · provider registry
(trigger: second LLM provider added) · async reconnect bridge (trigger: "reconnect mid-hunt" becomes a
real complaint) · named-lane concurrency (trigger: a second concurrency-bounded workload class exists).

---

**Key Pack files referenced throughout:** `backend/app/tools/_ssrf.py`, `backend/app/engine/
prompt_context.py`, `backend/app/engine/supervisor.py`, `backend/app/engine/healing.py`,
`backend/app/qwen/client.py`, `backend/app/qwen/pricing.py`, `backend/app/tools/redact.py`,
`backend/app/tools/search_provider.py`, `backend/app/qwen/context_budget.py`,
`backend/schema/events.schema.json`, `backend/app/engine/strategies/{orchestrate,critique,
deep_dive,base}.py`, `backend/prompts/howler/v1.md`, `backend/app/main.py`.

**Study scope:** 109 techniques across 10 subsystems, two independently pre-verified findings
(SSRF hole, cache-ordering bug), a dedicated architecture verdict, full sequencing. Conducted on
Sonnet per project convention for research/multi-agent work.

---

## F. Live audit against current code (2026-07-14)

Ran immediately after this doc was written, to confirm nothing had drifted and to catch anything the
study itself missed. **Every item checked was confirmed still true — no false claims, no already-fixed
items.** Three findings sharper than the original study:

- **Shutdown has no fault isolation, not just no timeout.** `backend/app/main.py`'s shutdown `finally`
  block (~lines 72-80) runs `registry.shutdown()` → cancel background tasks → `relay.stop()` →
  `bus.close()` → `pool.close()` with **no try/except between steps**. If any one raises, every step
  after it — including `pool.close()` — never runs. A botched shutdown leaks the DB pool, not just skips
  a timeout. Sharpens #24/#25.
- **The error-taxonomy gap actively mis-classifies real bugs, not just "lacks types."**
  `supervisor.py:1936-1941` buckets every exception that isn't `CircuitOpenError` or `ValueError` —
  including a `KeyError`/`AttributeError` from a genuine code defect — into the same `"provider_error"`
  string used for actual rate-limits/5xx. A real bug is currently indistinguishable from "DashScope was
  briefly down" in the Warden's healing path and in telemetry. Sharpens #27's urgency.
- **The secret-redaction regex has coverage holes independent of its scope problem.**
  `redact.py`'s `_TOKEN` pattern (`sk-[A-Za-z0-9]{6,}` or a bare 32+ char run) misses JWTs (the `.`
  separator breaks the `\b` word boundary mid-token) and AWS-style `AKIA...` keys (20 chars, under the
  32-char floor) — on top of only being wired into the `/tracks` export route (#7's original finding).
  Fixing the regex is now part of #7's scope, not a separate item.

Two things confirmed *not* gaps, correcting the study's framing:
- **Embedded-IPv4-in-IPv6 (part of #2) is already handled** — Python's `ipaddress` stdlib classifies
  `::ffff:169.254.169.254` and `::ffff:127.0.0.1` as link-local/loopback via the same six checks
  `_is_blocked` already runs, no separate unwrap code needed. Only the CGNAT range (#1) is a real gap.
- **Docker-level process supervision is solid** — `deploy/docker-compose.prod.yml` has real
  `healthcheck:`/`depends_on: condition: service_healthy` wiring. #23's gap is specifically bare-metal/
  OS-native supervision (systemd/Task Scheduler), not "no supervision story at all."

Also confirmed: study item numbering in casual references can drift from the table above (#23 is OS
supervision, #75 is the event-hook bus) — cite by technique name, not just number, when filing tickets.
