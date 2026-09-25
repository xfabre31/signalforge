export type EventStatus = "success" | "warning" | "error";

export interface TelemetryEvent {
  id: number;
  service: string;
  event_type: string;
  status: EventStatus;
  latency_ms: number;
  message: string;
  created_at: string;
}

export interface ServiceSummary {
  service: string;
  requests: number;
  error_rate: number | null;
  average_latency_ms: number | null;
  p95_latency_ms: number | null;
  status: "healthy" | "degraded" | "critical";
}

export interface DashboardSummary {
  window_minutes: number;
  window_start: string;
  total_events: number;
  error_rate: number | null;
  average_latency_ms: number | null;
  p95_latency_ms: number | null;
  active_incidents: number;
  services: ServiceSummary[];
  generated_at: string;
}


export interface Incident {
  id: number;
  service: string;
  status: "open" | "acknowledged" | "resolved";
  message: string;
  error_count: number;
  opened_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
}
