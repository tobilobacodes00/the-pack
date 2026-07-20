<div align="center">

# 🐺 A Pack

**A multi-agent research team you can watch — and audit.**

Give it a question. A pack of AI wolves plans the work, researches the web, argues over weak
claims, and writes you a cited brief — every move streaming live on a canvas, every claim
carrying a receipt, and the price shown before a cent is spent.

*Built for the Qwen Cloud Global AI Hackathon — all inference on Qwen models via Alibaba Cloud.*

</div>

---

## 🏁 For judges

**Track:** Agent Society

| | |
|---|---|
| 🎥 **Demo video** (< 3 min) | **[▶ Watch the pack hunt](https://youtu.be/MeKEBFDTc4U)** |
| 🌐 **Live app** | **[http://47.237.4.147](http://47.237.4.147)** — running on Alibaba Cloud ECS, no login needed |
| 🏗️ **Architecture diagram** | [`docs/pack-architecture.png`](docs/pack-architecture.png) · [full write-up](docs/ARCHITECTURE.md) |

**Proof the backend runs on Alibaba Cloud** — the code, not just a claim:

| Alibaba Cloud service | Where it's used |
|---|---|
| **Qwen / Model Studio (DashScope)** — all LLM inference | [`backend/app/qwen/client.py`](backend/app/qwen/client.py) · endpoint pinned at [`config.py:17`](backend/app/config.py#L17) (`dashscope-intl.aliyuncs.com`), model tiers at [`config.py:20`](backend/app/config.py#L20) |
| **Alibaba Cloud OSS** — artifact object storage | [`backend/app/storage/oss.py:108-128`](backend/app/storage/oss.py#L108-L128) — official [`oss2`](backend/pyproject.toml#L27) SDK (`Auth` / `Bucket` / `put_object`) |
| **Alibaba Cloud ECS** — the deployed backend | [`deploy/ECS_DEPLOY_GUIDE.md`](deploy/ECS_DEPLOY_GUIDE.md) · [`deploy/docker-compose.prod.yml`](deploy/docker-compose.prod.yml) |

> **Short on time?** The live app already has **completed hunts** you can open immediately — no
> waiting for a run. Try the *"Map the BNPL market in Nigeria"* hunt to see a finished cited brief,
> then click any claim to see its **receipt** (which wolf found it, which source, and whether the
> Sentinel challenged it). Several claims there are marked `challenged_kept` — the Sentinel
> contested them and they survived on evidence.

> **Prefer to run it yourself?** `make install && make infra`, then `make backend` / `make gateway` /
> `make frontend`. It boots with **no API key required** — the engine falls back to a deterministic
> offline provider, so you can explore the full UI, canvas, and event stream for free. Add a
> `QWEN_API_KEY` to switch to real Qwen inference with zero code change.

---

## Why it's different

Most "AI research" is a black box: one prompt in, one wall of text out, and no way to know whether
it read a real source or made it up. A Pack is built the opposite way — **every action is visible,
attributable, and reversible.**

| | A single agent | **A Pack** |
|---|---|---|
| **What you see** | A spinner, then text | The whole team working, live, on a canvas |
| **Trust** | "Trust me" | Every claim links to **who found it and where** (a *receipt*) |
| **Cost** | Found out after | **Priced before it runs** — a hard spend cap you set |
| **Quality** | Take it or leave it | A **Sentinel** challenges any claim not traced to a source, and drops it |
| **Proof** | None | **Benchmark** the pack head-to-head against a lone agent, scored |
| **Memory** | Hidden or none | The **Elder** remembers past hunts — and you can read, edit, or veto every lesson |
| **Auditability** | None | **Replay** every decision from an append-only event log |

Nothing happens off-screen. The UI is a **pure function of an append-only event stream** — so if it
wasn't an event, it didn't happen.

---

## Meet the pack

Eight roles, each a distinct wolf with its own job. A hunt uses the ones the task needs; Scouts scale
with the work (usually several at once).

| Wolf | Role | What it does |
|---|---|---|
| 🌟 **Alpha** | Orchestrator | Reads your task, keeps the pack on track, talks to you |
| 📊 **Beta** | Planner | Breaks the goal into a plan and forms the pack before the hunt begins |
| 🔍 **Scout** | Researcher | Ranges ahead and runs real web searches for ground truth (usually several at once) |
| 🐾 **Tracker** | Analyst | Reads what the Scouts bring back and gives it shape |
| 🛡️ **Sentinel** | Critic | Challenges any claim not traceable to a Scout finding — and drops it if it can't be backed |
| 📣 **Howler** | Writer | Crafts the final cited brief from verified findings |
| 🧠 **Elder** | Memory | Recalls lessons from past hunts, records one for next time |
| 🩹 **Warden** | Field medic | Roams to faulted wolves and reroutes them so the hunt never stalls |

---

## The hunt, end to end

1. **Talk to Alpha.** Type, speak, or drop a file. Alpha scopes a real job from the conversation.
2. **Beta forms the pack.** A plan and a formation appear — you can **edit the team** or pick a
   depth (*Brief → Standard → Deep*). You see the **estimated cost and time before approving**.
3. **Approve → the pack runs.** Scouts search, the Tracker merges, the Sentinel challenges weak
   claims, the Howler drafts — all narrated live on the canvas and in the chat.
4. **Get a brief you can trust.** Every claim carries a **receipt** (source, who found it, whether
   the page was read). Download as PDF/DOCX, save the winning formation as an **Instinct** to reuse,
   or ask Alpha a follow-up.

Extras that make it a system, not a demo: **Boundary** (a hard, pre-checked spend cap that warns →
downgrades model tier → halts with a checkpoint), **Benchmark** (pack vs. lone agent, scored),
**Flight Recorder** (replay the full event log), **Instincts** (reuse a proven formation on a fresh
task), and **shareable** read-only briefs.

---

## Architecture

```
 Browser (React)              Python engine (FastAPI)              Rust gateway (Axum)
 ┌─────────────────┐   REST  ┌──────────────────────────┐        ┌──────────────────┐
 │ Door / Territory│───────▶ │ commands → Supervisor      │        │ read-only WS      │
 │ pure reducer    │   202   │ Emitter → Postgres (truth) │        │ fan-out (tail)    │
 │ over events     │         │ outbox relay → Redis ──────┼──XADD─▶│ XRANGE + XREAD    │
 │        ▲        │         └──────────────────────────┘        └────────┬─────────┘
 │        └───────────────────────── WS event stream ───────────────────────┘
 └─────────────────┘
```

- **Engine (Python / FastAPI)** owns all logic and all writes. Alpha's Supervisor loop drives each
  hunt; it assigns a dense per-hunt `seq`, validates every event against the **frozen** schema
  (`backend/schema/events.schema.json`), and commits to Postgres in one transaction.
- **Transactional outbox.** Postgres is the single source of truth. A relay tails committed events
  and republishes them to Redis Streams — no dual-write window. Delivery is at-least-once; the
  frontend reducer drops `seq <= lastSeq`, so duplicates are no-ops.
- **Gateway (Rust / Axum)** is a read-only WebSocket fan-out that tails Redis and streams events to
  browsers. It never writes.
- **Frontend (React)** renders only from the event stream via a pure reducer (a CQRS read model).

The wolf brain and the web tools are **swappable**: with no API key the engine runs a deterministic
offline provider (`FakeQwen`); the moment a real `QWEN_API_KEY` lands it uses **Qwen** — with zero
change to the orchestrator or the event stream.

### On Alibaba Cloud

- **Inference** — Qwen models via Alibaba Cloud Model Studio / DashScope (`backend/app/qwen/client.py`),
  across `max` / `plus` / `flash` tiers the Boundary can downgrade between under pressure.
- **Artifact storage** — forged files (PDF/DOCX/…) stored in Alibaba Cloud OSS
  (`backend/app/storage/oss.py`); falls back to local disk when unconfigured.
- **Deploy** — the backend runs on Alibaba Cloud ECS (see [`deploy/`](deploy/)).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full write-up and diagrams.

---

## Run it locally

**Prerequisites:** Docker (Redis + Postgres), Python 3.12+, Rust/cargo (gateway), Node + pnpm
(frontend). `uv` is used if present, else pip.

```bash
make install     # backend + frontend + gateway deps
make infra       # start Redis + Postgres (docker compose)
```

Then run the three services — separate terminals (or `make -j3`):

```bash
make backend     # FastAPI engine   → http://localhost:8000
make gateway     # Rust WS gateway  → ws://localhost:8080
make frontend    # Vite dev server  → http://localhost:5173
```

On **Windows** (no native `make`): `pwsh scripts/dev.ps1`, or run each `make` target's command by
hand. Note Postgres/Redis may be portable/local rather than Docker on some setups.

Open the app and start a hunt from the **Door**: chat with Alpha → approve the plan → watch the
pack work → get the brief. No API key needed — it runs on the deterministic offline brain until you
add one.

```bash
make test        # backend contract tests + frontend reducer tests + cargo check
```

DB-backed backend tests skip automatically if Postgres isn't running.

### Going live with Qwen

Copy `backend/.env.example` → `backend/.env` and set `QWEN_API_KEY`. The client auto-detects it and
switches off the offline provider — no code change. Then, from `backend/`, run
`python scripts/hello_qwen.py` to confirm the base URL, auth, and the real model names for the
max/plus/flash tiers (update `QWEN_MODEL_*` if they differ).

---

## API

The contract is simple: **commands return `202 Accepted`; the result arrives on the stream.** A
command nudges the running Supervisor, which emits the resulting events in `seq` order — to see what
happened, watch the gateway WebSocket.

With the engine running: **Swagger UI** at <http://localhost:8000/docs> · **OpenAPI** at
<http://localhost:8000/openapi.json>. A **Postman** collection + environment live in
[`docs/postman/`](docs/postman/) — run *Create hunt* first (its test script captures `hunt_id`),
then open a WS request to `{{gatewayWs}}/hunts/{{hunt_id}}/stream?from_seq=0` and approve the plan.

| Method | Path | What |
| --- | --- | --- |
| POST | `/hunts/intake` | Chat with Alpha; scopes a real job from the conversation |
| POST | `/hunts` | Open a hunt (202; Beta starts planning) |
| GET | `/hunts` · `/hunts/:id` | List hunts · snapshot (`state` + `last_seq`) |
| POST | `/hunts/:id/rehearse` | Price + time a plan before running (the Estimate) |
| POST | `/hunts/:id/plan/approve` | Approve the plan, set the Boundary, pick depth |
| POST | `/hunts/:id/stop` · `/resume` | Stop, or resume from a Boundary checkpoint |
| POST | `/hunts/:id/benchmark` · GET `/scorecard` | Lone Wolf vs. Pack, scored |
| GET | `/hunts/:id/artifact` · `/artifacts` | The final brief · the forged export files |
| GET | `/hunts/:id/receipts` | Per-claim provenance for the brief |
| GET | `/hunts/:id/tracks/export` | Full event log — replayed by the Flight Recorder |
| POST | `/hunts/:id/share` · GET `/share/:token` | Public, shareable brief + receipts |
| GET/POST/DELETE | `/instincts` | Save and reuse proven formations |
| GET/PATCH/DELETE | `/memory` | The Elder's lessons — visible, editable, vetoable |
| WS | `/hunts/:id/stream?from_seq=n` | **(gateway)** live event stream |

---

## The team

Built by [**Tobiloba Sulaimon**](https://tobilobasulaimon.com) (fullstack + engine),
[**AbdulQudus**](https://dribbble.com/abdul_uxui) (product & UI/UX design), and **Joanna**
(frontend) for the Qwen Cloud Global AI Hackathon.

Built with **Qwen models on Qwen Cloud**, backend on **Alibaba Cloud**.
