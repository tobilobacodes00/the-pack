# Pack - Start Everything Locally

This is the guide to get every service the app needs running on your machine.

- **Infra:** Postgres + Redis
- **Backend:** Python engine on `:8000`
- **Gateway:** Rust WebSocket server on `:8080`
- **Frontend:** Vite app on `:5173`

If you only want the app to work end to end, start all four. The gateway is what makes the live
canvas/feed update.

> If you do not have a Qwen key yet, the engine still boots in offline mode. The UI and API still
> work, but the agent replies are canned.

## Prerequisites

Install these first:

- Docker Desktop
- Python 3.12+
- Node.js 18+
- pnpm
- Rust stable with `cargo`

If you are on Windows, run the commands from PowerShell or use `pwsh scripts/dev.ps1`.

## Fastest path

From the repo root:

```bash
docker compose up -d redis postgres
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload --port 8000
```

Then, in two more terminals:

```bash
cd gateway
cargo run
```

```bash
cd frontend
pnpm install
pnpm dev
```

If you prefer the repo helpers:

```bash
make infra
make backend
make gateway
make frontend
```

On Windows, the one-shot launcher is:

```powershell
pwsh scripts/dev.ps1
```

## Step-by-step

### 1. Start the database and cache

```bash
docker compose up -d redis postgres
docker compose ps
```

You want both containers to be healthy before starting the app services.

### 2. Start the backend

```bash
cd backend
uv sync --extra dev
cp .env.example .env
uv run uvicorn app.main:app --reload --port 8000
```

If you have the real Qwen values, place them in `backend/.env` before starting the server.

### 3. Start the gateway

```bash
cd gateway
cargo run
```

Leave this running if you want live hunt streaming in the UI.

### 4. Start the frontend

```bash
cd frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

Open the URL Vite prints, usually `http://localhost:5173`.

## Ports

| Port | Service | Needed for |
| --- | --- | --- |
| 5432 | Postgres | backend state |
| 6379 | Redis | backend queue + gateway stream |
| 8000 | Python engine | REST API |
| 8080 | Rust gateway | live WebSocket stream |
| 5173 | Frontend | UI |

## What each service does

- **Postgres** stores the durable app state.
- **Redis** carries the stream that the gateway tails.
- **Backend** owns commands, business logic, and writes.
- **Gateway** only reads Redis and pushes events to the browser.
- **Frontend** renders the Territory and talks to the backend/gateway.

## Troubleshooting

- **Frontend loads but no live updates** - start the gateway with `cargo run`.
- **API errors about the database** - confirm `docker compose ps` shows healthy Postgres and Redis.
- **Backend starts in offline mode** - add the Qwen key to `backend/.env` and restart it.
- **Port already in use** - stop the old process or change the port in the command you are running.

## Short version

If you just want the minimum command list:

```bash
docker compose up -d redis postgres
cd backend && uv run uvicorn app.main:app --reload --port 8000
cd gateway && cargo run
cd frontend && pnpm dev
```
