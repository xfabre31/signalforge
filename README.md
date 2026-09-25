# SignalForge 0.1

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
uvicorn app.main:app --reload --app-dir backend
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
python scripts/generate_events.py
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

## Suggested build order after this baseline

1. Replace SQLite with PostgreSQL and add migrations.
2. Add API keys and project/workspace isolation.
3. Move ingestion into Redis Streams or Kafka workers.
4. Add statistically grounded anomaly detection.
5. Add incident creation, acknowledgements, and notifications.
6. Build evidence-grounded AI incident summaries.
7. Deploy, load test, and publish measured p95 latency and throughput.

## GitHub first commit

```bash
git init
git add .
git commit -m "Build SignalForge real-time monitoring prototype"
git branch -M main
```

Create an empty GitHub repository, then follow GitHub's commands to add the remote and push. Do not commit `.env`, `.venv`, `node_modules`, or the local database.

