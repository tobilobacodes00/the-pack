# AGENTS.md — engineering policy for Pack

Tool-agnostic rules for any coding agent or contributor working in this repo. (Claude Code reads its
own config from `CLAUDE.md`/`~/.claude`; this file is the substantive policy those should point at.)

## Architecture invariants (enforced — do not break)

`backend/scripts/check_architecture.py` runs in CI and pre-commit and will FAIL a change that breaks
these. They exist because each was a real bug once:

- **Every LLM call goes through `QwenClient`** (`backend/app/qwen/client.py`). Never call
  `chat.completions.create(...)` anywhere else — that chokepoint owns retries, the per-hunt circuit
  breaker, request-size preflight, token/latency accounting, and the `on_payload` seam. The one
  documented exception (`tools/vision.py`, multimodal) is listed explicitly in the guard.
- **The SSRF blocklist keeps the CGNAT range** (`backend/app/tools/_ssrf.py` `_is_blocked` references
  `_CGNAT`). Python's `ipaddress` stdlib doesn't flag `100.64.0.0/10`, but Alibaba's metadata IP
  (`100.100.100.200`, our own deploy target) lives there.

## Security posture

- **Server-side fetches of any caller-supplied URL** must be SSRF-safe: validate + IP-pin
  (`app/tools/_ssrf.py`), and screen the URL through `content_guard.is_fetchable_url` before any reader
  runs (fail-closed).
- **Scraped third-party content is untrusted.** It's screened for prompt-injection
  (`content_guard.scan_content`) before it enters a wolf's prompt, because wolves are single-turn and
  can't refuse a poisoned instruction mid-reasoning.
- **Secrets never get logged or exported.** `app/tools/redact.py` runs on every log line and the Tracks
  export — regex shapes plus an exact-value registry seeded from configured secrets. Never add a code
  path that prints a raw key/exception without going through the logging chokepoint.
- **No secrets in git.** gitleaks runs pre-commit. Secrets live in `.env` / the environment only.

## The event contract

`backend/schema/events.schema.json` is FROZEN. Extend it **additively only** — new event types or new
**optional** payload fields, never rename/remove/re-type an existing one. Every emit validates against
it at write time. Mirror any additive field into the frontend zod schema (`frontend/src/events/schema.ts`).

## Testing discipline

- The offline suite must stay green: `cd backend && uv run pytest -q`. FakeQwen (no key) makes it
  hermetic; a live Qwen/Postgres key is never required for the default suite.
- CI pins `--randomly-seed=0` (pytest-randomly) for a reproducible non-file order that surfaces
  shared-state leaks. Two `test_outbox_relay.py` tests need a live Postgres and are expected to skip/fail
  without one — that is environmental, not a regression.
- A bug fix ships with a test that pins the exact regression. A new invariant ships with a test proving
  its guard FIRES on a violation, not just passes today.
- Run before every commit: `uv run ruff check . && uv run ruff format --check . && uv run mypy app &&
  uv run python scripts/check_architecture.py`. Frontend: `pnpm lint && pnpm typecheck`.

## Health sweep

`cd backend && uv run python scripts/pack_doctor.py` — a proactive PASS/WARN/FAIL sweep (pricing,
secrets, schema, prompts, SSRF blocklist, cache-flag coherence). Run it before a deploy; exits non-zero
on any FAIL.

## Commits

Conventional-commit style (`feat(scope):`, `fix(scope):`). Write commits as if authored solo — **no bot
attribution / Co-Authored-By footers.** Commit only files relevant to the logical change.
