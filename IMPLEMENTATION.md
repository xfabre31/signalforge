# SignalForge Implementation Guide

This is the cumulative implementation and usage reference for SignalForge, current
through **v0.1.1 — Resilient Live Updates**. Earlier features remain documented here
as the project evolves. See [README.md](README.md) for a brief overview and
[CHANGELOG.md](CHANGELOG.md) for the release history.

## Implementation map

| Area | Main files | Responsibility |
|---|---|---|
| API and live transport | `backend/app/main.py` | Routes, metrics, WebSocket connections and heartbeat replies |
| Persistence | `backend/app/database.py` | SQLite tables, event queries, incident transitions, demo seeds |
| Validation | `backend/app/models.py` | Request validation and response schemas |
| Dashboard | `frontend/src/App.tsx` | REST snapshots, charts, metric window, incident controls, status display |
| Live recovery | `frontend/src/live.ts` | Reconnect scheduling, heartbeat deadlines, polling, refresh coalescing |
| Demo traffic | `scripts/generate_events.py` | Synthetic requests sent every two seconds |
| Verification | `backend/tests/test_api.py`, `frontend/tests/live.test.mjs` | API behavior and simulated connection failures |

## Telemetry ingestion and persistence — v0.1.0

`POST /api/events` validates an event, writes it to SQLite, updates an incident if
its status is `error`, then broadcasts the saved event to connected dashboards.
The server assigns the event ID and UTC ingestion timestamp. Client event timestamps
are not part of the input schema.

| Field | Accepted values |
|---|---|
| `service` | String of 2–60 characters |
| `event_type` | String of 2–40 characters; defaults to `request` |
| `status` | `success`, `warning`, or `error`; defaults to `success` |
| `latency_ms` | Integer from 0 through 120,000 |
| `message` | String of 2–240 characters; defaults to `Request completed` |

The default database is `backend/signalforge.db`. Set `DATABASE_PATH` to use a
different file. Startup creates missing tables and indexes and seeds 36 demo events
when the event table is empty. Existing events are preserved on normal startup.
The explicit demo-reset operation clears both events and incidents before reseeding.

`GET /api/events` returns newest events first. `limit` defaults to 50 and accepts
1–200; `service` optionally filters by service name. The dashboard requests the
latest 60, charts up to 24, and displays up to 12 rows. Its service selector filters
this recent feed and chart, not the global metric cards or incident table.

## Time-windowed metrics — v0.1.0

`GET /api/summary?window_minutes=60` accepts windows from 1 through 1,440 minutes.
The dashboard offers 15 minutes, one hour, and 24 hours. The API captures one UTC
response time and includes request events from the window start through that time,
including both boundaries. It uses every matching request, independent of the
recent-event API's limit. Other event types do not contribute to request metrics.

- **Requests:** number of matching request events (`total_events` in the response).
- **Error rate:** error requests divided by all requests, multiplied by 100 and
  rounded to one decimal. Warning requests remain in the denominator.
- **Average latency:** mean request latency, rounded to one decimal millisecond.
- **p95 latency:** sort latencies ascending and select the one-based rank
  `ceil(0.95 × count)`. For 100 requests, this is the 95th sorted latency.
- **Service health:** calculated from the unrounded error rate; critical at 20%
  or above, degraded at 8% or above, healthy below 8%.

An empty window returns zero requests and null error-rate/latency values, rendered
as dashes. Services without requests in that window are omitted rather than labeled
healthy. The response includes `window_start`, `window_minutes`, and `generated_at`.
Active incidents are counted across all time, independently of the selected window.

## Incident tracking — v0.1.0

Every newly ingested error opens an incident for its service or adds to the active
incident's error count. This also applies to errors whose event type is not `request`.
A partial unique SQLite index permits only one unresolved incident per service.
Event insertion and the associated incident update share a database transaction.

An incident records its service, latest error message, error count, opened time,
last-seen time, acknowledgement time, and resolution time. Repeated errors update
the latest message and last-seen time without discarding an acknowledgement.

| Current status | Action | Result |
|---|---|---|
| Open | Acknowledge | Acknowledged; remains active |
| Acknowledged | Resolve | Resolved; excluded from active count |
| Any | Repeat current supported status | No change; idempotent response |
| Resolved | New error event | Opens a new incident with a different ID |

Use **Acknowledge** and then **Resolve** in the dashboard. The corresponding API
requests are `PATCH /api/incidents/{id}` with `{"status":"acknowledged"}` or
`{"status":"resolved"}`. A direct open-to-resolved transition returns 409, an
unknown ID returns 404, and an unsupported status returns 422. A resolved incident
cannot be reopened through this endpoint.

Resolution is manual: a successful request does not prove sustained recovery and
does not automatically close an incident. `GET /api/incidents` returns active
incidents first, followed by resolved history. Incident changes notify all connected
dashboards. Persisted events from before incident tracking was installed are not
retroactively converted into incidents.

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

Requirements: Python 3.12, Node.js 24, Git, and VS Code. Node 24 is the locally verified runtime and supports the frontend test runner.

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
.venv/bin/python -m pytest backend/tests
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
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
| `GET` | `/api/incidents` | Active incidents followed by resolved history |
| `PATCH` | `/api/incidents/{id}` | Acknowledge or resolve an incident |
| `POST` | `/api/demo/reset` | Replace event and incident history with seeded demo data |
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

## Verification coverage

Backend tests cover empty windows, validation, window boundaries, aggregation beyond
200 requests, nearest-rank p95, incident grouping and transitions, recurrence,
persistence, demo reset, broadcasts, heartbeat replies, and reading stored state
after a disconnect. Frontend tests simulate time and sockets to exercise backoff,
connection/heartbeat timeouts, snapshot refresh, offline recovery, burst coalescing,
and cleanup. They do not replace browser testing; use the recovery walkthrough above
to check the UI end to end.

## Current limitations

- SQLite and the in-memory WebSocket connection list suit a local, single-process
  prototype. Multiple API workers do not share a broadcast channel.
- There is no authentication, project isolation, automatic incident resolution,
  retention policy, or incident-history pagination yet.
- Recovery reloads the current dashboard snapshot; it does not replay an unlimited
  event history. Requests made while the API is stopped are not queued by the generator.
- Snapshot endpoints are separate requests, so their results may reflect slightly
  different instants during continuous ingestion.
- Browser offline status is a hint, not proof that the local API is unreachable.
  Background tabs can delay timers; returning to the tab triggers recovery.
- Source releases do not back up the ignored SQLite database. Preserve that file
  separately if its telemetry and incident history matter.

## Documentation and release maintenance

For every future release:

1. Update the first README heading to `SignalForge vX.Y.Z — Update Name`.
2. Replace the README's current-update highlights with a brief description of that release.
3. Extend this guide with implementation details, usage, API changes, verification,
   and limitations. Preserve older feature descriptions; revise behavior that changes.
4. Add a release entry to `CHANGELOG.md` and keep the frontend package, lockfile,
   backend API version, and guide's current-version line aligned.
5. Run the documented checks before committing and publishing a new version tag.
   Keep existing published tags unchanged.

Documentation-only edits to the current release do not require inventing a new
application version. The current README title remains v0.1.1 until the next release.
