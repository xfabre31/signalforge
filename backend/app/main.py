from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from math import ceil

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .database import fetch_events, initialize_database, insert_event, reset_database, window_requests, fetch_incidents, transition_incident
from .models import DashboardSummary, Event, EventCreate, ServiceSummary, Incident, IncidentUpdate


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.connections:
            self.connections.remove(websocket)

    async def broadcast(self, event: dict) -> None:
        disconnected: list[WebSocket] = []
        for connection in self.connections:
            try:
                await connection.send_json(event)
            except RuntimeError:
                disconnected.append(connection)
        for connection in disconnected:
            self.disconnect(connection)


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="SignalForge API",
    description="Telemetry ingestion and real-time reliability monitoring prototype.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/events", response_model=list[Event])
def list_events(
    limit: int = Query(default=50, ge=1, le=200),
    service: str | None = None,
) -> list[dict]:
    return fetch_events(limit=limit, service=service)


@app.post("/api/events", response_model=Event, status_code=201)
async def create_event(event: EventCreate) -> dict:
    saved = insert_event(event)
    await manager.broadcast(saved)
    return saved


@app.get("/api/summary", response_model=DashboardSummary)
def dashboard_summary(window_minutes: int = Query(default=60, ge=1, le=1440)) -> DashboardSummary:
    now = datetime.now(timezone.utc)
    start = now - timedelta(minutes=window_minutes)
    events = window_requests(start.isoformat(), now.isoformat())

    def metrics(rows):
        latencies = sorted(row["latency_ms"] for row in rows)
        return dict(
            error_rate=round(sum(row["status"] == "error" for row in rows) / len(rows) * 100, 1) if rows else None,
            average_latency_ms=round(sum(latencies) / len(latencies), 1) if rows else None,
            p95_latency_ms=latencies[ceil(.95 * len(latencies)) - 1] if rows else None,
        )

    services = []
    for name in sorted({event["service"] for event in events}):
        rows = [event for event in events if event["service"] == name]
        rate = sum(row["status"] == "error" for row in rows) / len(rows)
        services.append(ServiceSummary(service=name, requests=len(rows), **metrics(rows),
            status="critical" if rate >= .2 else "degraded" if rate >= .08 else "healthy"))
    return DashboardSummary(window_minutes=window_minutes, window_start=start, generated_at=now,
        total_events=len(events), **metrics(events), services=services,
        active_incidents=sum(row["status"] != "resolved" for row in fetch_incidents()))


@app.get("/api/incidents", response_model=list[Incident])
def list_incidents():
    return fetch_incidents()


@app.patch("/api/incidents/{incident_id}", response_model=Incident)
async def update_incident(incident_id: int, update: IncidentUpdate):
    try:
        incident = transition_incident(incident_id, update.status)
    except KeyError:
        raise HTTPException(status_code=404, detail="Incident not found")
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error))
    await manager.broadcast({"type": "incidents_updated"})
    return incident


@app.post("/api/demo/reset")
async def reset_demo() -> dict[str, str]:
    reset_database()
    await manager.broadcast({"type": "demo_reset"})
    return {"status": "reset"}


@app.websocket("/ws/events")
async def events_socket(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

