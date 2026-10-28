# SignalForge v 0.1.0

SignalForge is a local-first prototype of a real-time software reliability dashboard. It accepts telemetry events through a FastAPI API, stores them in SQLite, broadcasts new events over WebSockets, and displays live service health in a React + TypeScript dashboard.

This first version is intentionally small and stable. It is the baseline you can return to before adding PostgreSQL, Redis, Kafka, anomaly detection, authentication, or AI-assisted incident analysis.


## What works now

- REST telemetry ingestion and validation
- SQLite persistence with seeded demo data
- Live WebSocket event updates
- Service health summaries and incident feed
- React/TypeScript dashboard with charts and filters
- Backend API tests
- VS Code tasks and recommended extensions
- Docker Compose and native macOS setup

## Architecture

```text
Demo generator / SDK / curl
            |
            v
      FastAPI REST API ----> SQLite
            |
            v
      WebSocket broadcast
            |
            v
   React + TypeScript dashboard
```

## Fastest setup on macOS in VS Code

Requirements: Python 3.12, Node.js 20+, Git, and VS Code.

1. Open the `signalforge` folder in VS Code.
2. Open the Command Palette with `Cmd+Shift+P` and run **Tasks: Run Task**.
3. Run **Setup: Full project** once.
4. Run **Dev: SignalForge**. VS Code opens two terminals for the API and dashboard.
5. Visit <http://localhost:5173>.

The API docs are at <http://localhost:8000/docs>.

## Manual setup

On macOS, install Python 3.12 with `brew install python@3.12` first. The pinned backend dependencies use Python 3.12, matching the Docker image.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt

cd frontend
npm install
cd ..
```

Run the backend:

```bash
source .venv/bin/activate
python -m uvicorn app.main:app --reload --app-dir backend --host 127.0.0.1 --port 8000
```

In a second terminal, run the frontend:

```bash
cd frontend
npm run dev
```

## Generate live traffic

With the API running, execute:

```bash
source .venv/bin/activate
.venv/bin/python scripts/generate_events.py
```

Or send one event yourself:

```bash
curl -X POST http://localhost:8000/api/events \
  -H "Content-Type: application/json" \
  -d '{"service":"checkout-api","event_type":"request","status":"error","latency_ms":1240,"message":"Payment provider timed out"}'
```

## Tests and builds

```bash
source .venv/bin/activate
pytest backend/tests

cd frontend
npm run lint
npm run build
```

## Docker option

If Docker Desktop is installed:

```bash
docker compose up --build
```

Then open <http://localhost:5173>.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | API health check |
| `GET` | `/api/summary` | Aggregate dashboard metrics |
| `GET` | `/api/events` | Recent events, optionally filtered by service |
| `POST` | `/api/events` | Ingest and broadcast a telemetry event |
| `POST` | `/api/demo/reset` | Reset the database to deterministic demo data |
| `WS` | `/ws/events` | Stream newly ingested events |


## Troubleshooting local proxy errors

Vite `ECONNREFUSED` errors on `/api` and `/ws` mean the dashboard cannot reach
its API at `127.0.0.1:8000`. A mobile hotspot is not required for this local
connection. Check the **Dev: API** terminal for the underlying startup error.
Setup installs dependencies; it does not start the servers.

After moving the project, virtual-environment executable scripts can still point
to the old absolute path. The API task uses `.venv/bin/python -m uvicorn` to avoid
the stale launcher. Setup also reinstalls the Uvicorn launcher. For a fully fresh
environment after a move, stop the dev tasks and run from the project root:

```bash
python3.12 -m venv --clear .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

This recreates only the Python environment; it preserves the application database.
Dependency installation needs internet access. Start **Dev: SignalForge** after
setup, wait for **Application startup complete**, and refresh the dashboard.
Check the API directly with `curl http://127.0.0.1:8000/health`.

The telemetry generator also supports direct execution with `./scripts/generate_events.py`. Stop it with Ctrl+C. If a downloaded copy loses executable permissions, use `.venv/bin/python scripts/generate_events.py` from the project root.

## Resilient live updates (v0.1.1)

Start **Dev: SignalForge** and open http://localhost:5173. Live recovery is automatic;
no configuration is required. Use Node.js 22.18+ (or Node 24) to run the frontend tests.

- The header shows Connecting, Live stream connected, Reconnecting automatically,
  or Offline. The last-refresh time indicates when REST data last loaded successfully.
- Failed connections retry with exponential backoff (about 1, 2, 4, 8, 16, then
  up to 30 seconds, with jitter). Heartbeat pings every 20 seconds detect a stalled
  socket after a 10-second response timeout. Initial connections also time out.
- Reconnecting fetches the latest metrics, incidents, and 60 recent events from
  SQLite. This recovers the current dashboard state, not a replay of every missed
  WebSocket message; older events remain stored but outside the recent feed.
- REST refreshes continue every 15 seconds as a fallback. Requests time out after
  10 seconds, and live notification bursts are coalesced while a refresh is running.
- Existing data stays visible during failures with a delayed-data message. The
  browser's online event and returning to the tab trigger an immediate reconnect.
  **Reconnect now** lets you retry manually. Offline incident actions are disabled.

### Try recovery

1. Start both servers and run `.venv/bin/python scripts/generate_events.py`.
2. Open the dashboard and confirm **Live stream connected**.
3. Stop just the API with Ctrl+C. The dashboard keeps its previous data and retries.
4. Restart **Dev: API**. The dashboard reconnects and refreshes without a page reload.
5. For missed-event recovery, put the dashboard browser in offline mode using its
   developer tools while leaving the API and generator running. Restore online mode:
   the latest events, metrics, and incidents should appear automatically. A stopped
   API cannot accept events; restart the generator if it exited during step 3.

Validation: `.venv/bin/python -m pytest backend/tests`, `npm --prefix frontend test`,
`npm --prefix frontend run lint`, and `npm --prefix frontend run build`.
