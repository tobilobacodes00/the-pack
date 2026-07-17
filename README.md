# A Pack

**A multi-agent research orchestrator you can watch — and audit.**

You give the pack a task; a team of AI wolves — Alpha (orchestrator), Beta (planner), Scouts
(researchers), Tracker (analyst), Sentinel (critic), Howler (writer), Elder (memory) — plan it,
run it, and surface every decision to you live on a visual canvas (the Territory). Every action
is a typed, append-only event, and the UI is a pure function of that event stream — so nothing
happens off-screen.

What sets it apart from a single agent is **accountability**: every claim in the brief carries a
**receipt** (its source, who found it, whether the page was read); you see the **price before it
spends a cent**; you can run it **head-to-head against a lone agent** and score both; **replay**
every decision; and its **memory is yours to veto**.

> Built for the Qwen Cloud Global AI Hackathon. All inference runs on **Qwen models via Alibaba
> Cloud Model Studio / DashScope** (`backend/app/qwen/client.py`), and every generated artifact is
> stored in **Alibaba Cloud OSS** (`backend/app/storage/oss.py`).

## Architecture

```
 Browser (React)            Python engine (FastAPI)              Rust gateway (Axum)
 ┌───────────────┐  REST   ┌──────────────────────────┐        ┌──────────────────┐
 │ Door / Territory│──────▶│ commands → Supervisor      │        │ read-only WS      │
 │ pure reducer    │  202   │ Emitter → Postgres (truth) │        │ fan-out (tail)    │
 │ over events     │        │ outbox relay → Redis ──────┼──XADD─▶│ XRANGE + XREAD    │
 │        ▲        │        └──────────────────────────┘        └────────┬─────────┘
 │        └──────────────────────── WS event stream ───────────────────────┘
 └───────────────┘
```

- **Engine (Python)** owns all logic and all writes. It assigns a dense, per-hunt `seq`,
  validates every event against the **frozen** schema (`backend/schema/events.schema.json`),
  and writes to Postgres in one transaction.
- **Transactional outbox.** Postgres is the single source of truth. A relay tails committed
  events and republishes them to Redis Streams — no dual-write inconsistency window. Delivery
  is at-least-once; the frontend reducer drops `seq <= lastSeq`, so duplicates are no-ops.
- **Gateway (Rust)** is a read-only WebSocket fan-out that tails Redis and streams events to
  browsers. It never writes.
- **Frontend (React)** renders only from the event stream via a pure reducer (CQRS read model).

The wolf brain and the web tools are **swappable**: with no API key the engine runs on a
deterministic offline provider (`FakeQwen`); the moment a real `QWEN_API_KEY` lands it uses
Qwen — with zero change to the orchestrator or the event stream.

## Run it locally

Prerequisites: Docker (Redis + Postgres), Python 3.12+, Rust/cargo (for the gateway), Node +
pnpm (for the frontend).

```bash
# 1. Infrastructure
docker compose up -d redis postgres        # pack/pack/pack

# 2. Engine (Python) — http://localhost:8000
cd backend
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000

# 3. Gateway (Rust) — ws://localhost:8080
cd gateway && cargo run

# 4. Frontend — http://localhost:5173
cd frontend
pnpm install
cp .env.example .env.local                 # points at the engine + gateway
pnpm dev
```

Then open the app → **Territory**:
- **Replay** mode plays any committed fixture into the canvas (no backend needed).
- **Live** mode (or the Door) starts a real hunt: `POST /hunts` → approve the plan → watch the
  pack work → answer the Hold → the final artifact returns.

`make test` runs the backend suite, the frontend tests, and a gateway check. The DB-backed
backend tests skip automatically if Postgres isn't running.

## API docs

The contract is simple: **commands return `202 Accepted`; the result arrives on the stream.**
A command nudges the running Supervisor, which emits the resulting events (in seq order). To
see what happened, watch the gateway WebSocket.

**Swagger / OpenAPI** — with the engine running, open:
- Swagger UI: <http://localhost:8000/docs>
- OpenAPI JSON: <http://localhost:8000/openapi.json>

**Postman** — import both files from `docs/postman/`:
1. `Pack.postman_collection.json` — every endpoint, with example bodies and saved example
   responses, plus a WebSocket entry for the stream.
2. `Pack.postman_environment.json` — `engineUrl`, `gatewayWs`, `hunt_id`, `hold_id`.

Select the **Pack — Local** environment. Run **Create hunt** first — its test script captures
`hunt_id` into the environment, so every other request is ready to fire. Then open a Postman
WebSocket request to `{{gatewayWs}}/hunts/{{hunt_id}}/stream?from_seq=0` and approve the plan.

### Endpoints

| Method | Path | What |
| --- | --- | --- |
| POST | `/hunts` | Open a hunt (202; starts planning) |
| GET | `/hunts/:id` | Snapshot — `state` + `last_seq` |
| POST | `/hunts/:id/rehearse` | Price + time a plan before running (the Estimate) |
| POST | `/hunts/:id/plan/approve` | Approve plan, set the Boundary |
| POST | `/hunts/:id/inputs` | Add input mid-hunt |
| POST | `/hunts/:id/stop` | Stop the hunt |
| POST | `/hunts/:id/resume` | Resume from checkpoint |
| POST | `/hunts/:id/benchmark` · GET `/scorecard` | Lone Wolf vs Pack, scored |
| GET | `/hunts/:id/receipts` | Per-claim provenance for the brief (the Receipts) |
| GET | `/hunts/:id/tracks/export` | Full event log — replayed by the Flight Recorder |
| POST | `/hunts/:id/share` · GET `/share/:token` | Public, shareable brief + receipts |
| GET / PATCH / DELETE | `/memory` | The Elder's lessons — visible, editable, vetoable |
| WS | `/hunts/:id/stream?from_seq=n` | **(gateway)** live event stream |

## Going live with Qwen

Put `QWEN_API_KEY` in `backend/.env` (copy `backend/.env.example`). The client auto-detects it
and switches off the offline provider — no code change. Then run
`python scripts/hello_qwen.py` to confirm the base URL, auth, the real model names for the
max/plus/flash tiers (update `QWEN_MODEL_*` if they differ), and the thinking-requires-streaming
behaviour.
