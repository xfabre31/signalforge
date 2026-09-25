from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


class EventCreate(BaseModel):
    service: str = Field(min_length=2, max_length=60)
    event_type: str = Field(default="request", min_length=2, max_length=40)
    status: Literal["success", "warning", "error"] = "success"
    latency_ms: int = Field(ge=0, le=120_000)
    message: str = Field(default="Request completed", min_length=2, max_length=240)


class Event(EventCreate):
    id: int
    created_at: datetime


class ServiceSummary(BaseModel):
    service: str
    requests: int
    error_rate: float | None
    average_latency_ms: float | None
    p95_latency_ms: int | None
    status: Literal["healthy", "degraded", "critical"]


class DashboardSummary(BaseModel):
    window_minutes: int
    window_start: datetime
    total_events: int
    error_rate: float | None
    average_latency_ms: float | None
    p95_latency_ms: int | None
    active_incidents: int
    services: list[ServiceSummary]
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))



class Incident(BaseModel):
    id: int
    service: str
    status: Literal["open", "acknowledged", "resolved"]
    message: str
    error_count: int
    opened_at: datetime
    last_seen_at: datetime
    acknowledged_at: datetime | None
    resolved_at: datetime | None


class IncidentUpdate(BaseModel):
    status: Literal["acknowledged", "resolved"]
