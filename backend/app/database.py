import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .models import EventCreate


DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[1] / "signalforge.db"


def database_path() -> Path:
    return Path(os.getenv("DATABASE_PATH", DEFAULT_DATABASE_PATH))


def connect() -> sqlite3.Connection:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service TEXT NOT NULL,
                event_type TEXT NOT NULL,
                status TEXT NOT NULL,
                latency_ms INTEGER NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute("CREATE INDEX IF NOT EXISTS events_time ON events(created_at)")
        connection.execute("""CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT NOT NULL,
            status TEXT NOT NULL, message TEXT NOT NULL, error_count INTEGER NOT NULL,
            opened_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
            acknowledged_at TEXT, resolved_at TEXT
        )""")
        connection.execute("""CREATE UNIQUE INDEX IF NOT EXISTS incident_active_service
            ON incidents(service) WHERE status != 'resolved'""")
        count = connection.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        if count == 0:
            seed_database(connection)


def seed_database(connection: sqlite3.Connection) -> None:
    now = datetime.now(timezone.utc)
    services = ["checkout-api", "catalog-service", "auth-service"]
    for index in range(36):
        service = services[index % len(services)]
        is_error = index in {4, 11, 23, 31}
        is_warning = index in {7, 18, 29}
        status = "error" if is_error else "warning" if is_warning else "success"
        baseline = {"checkout-api": 310, "catalog-service": 145, "auth-service": 95}[service]
        latency = baseline + ((index * 37) % 180) + (900 if is_error else 0)
        message = (
            "Upstream request timed out"
            if is_error
            else "Latency exceeded service target"
            if is_warning
            else "Request completed"
        )
        created_at = (now - timedelta(minutes=(35 - index) * 3)).isoformat()
        connection.execute(
            """
            INSERT INTO events (service, event_type, status, latency_ms, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (service, "request", status, latency, message, created_at),
        )
        if is_error:
            record_incident(connection, service, message, created_at)
    connection.commit()


def record_incident(connection, service, message, created_at):
    connection.execute("""INSERT INTO incidents
        (service, status, message, error_count, opened_at, last_seen_at)
        VALUES (?, 'open', ?, 1, ?, ?)
        ON CONFLICT(service) WHERE status != 'resolved' DO UPDATE SET
        error_count = error_count + 1, last_seen_at = excluded.last_seen_at,
        message = excluded.message""", (service, message, created_at, created_at))


def insert_event(event: EventCreate) -> dict:
    created_at = datetime.now(timezone.utc).isoformat()
    with connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO events (service, event_type, status, latency_ms, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event.service,
                event.event_type,
                event.status,
                event.latency_ms,
                event.message,
                created_at,
            ),
        )
        if event.status == "error":
            record_incident(connection, event.service, event.message, created_at)
        connection.commit()
        row = connection.execute("SELECT * FROM events WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


def fetch_events(limit: int = 50, service: str | None = None) -> list[dict]:
    query = "SELECT * FROM events"
    parameters: list[object] = []
    if service:
        query += " WHERE service = ?"
        parameters.append(service)
    query += " ORDER BY created_at DESC LIMIT ?"
    parameters.append(limit)
    with connect() as connection:
        rows = connection.execute(query, parameters).fetchall()
    return [dict(row) for row in rows]


def reset_database() -> None:
    with connect() as connection:
        connection.execute("DELETE FROM incidents")
        connection.execute("DELETE FROM events")
        seed_database(connection)



def window_requests(start: str, end: str) -> list[dict]:
    with connect() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT * FROM events WHERE event_type = 'request' AND created_at >= ? AND created_at <= ?",
            (start, end),
        )]


def fetch_incidents() -> list[dict]:
    with connect() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT * FROM incidents ORDER BY (status = 'resolved'), last_seen_at DESC, id DESC"
        )]


def transition_incident(incident_id: int, status: str) -> dict:
    with connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone()
        if row is None:
            raise KeyError(incident_id)
        if row["status"] == status:
            return dict(row)
        if (row["status"], status) not in {("open", "acknowledged"), ("acknowledged", "resolved")}:
            raise ValueError("Acknowledge an open incident before resolving it; resolved incidents stay closed.")
        field = "acknowledged_at" if status == "acknowledged" else "resolved_at"
        connection.execute(f"UPDATE incidents SET status = ?, {field} = ? WHERE id = ?",
                           (status, datetime.now(timezone.utc).isoformat(), incident_id))
        return dict(connection.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,)).fetchone())
