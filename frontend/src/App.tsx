import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Gauge,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { startLiveUpdates, type LiveStatus } from "./live";
import type { DashboardSummary, TelemetryEvent, Incident } from "./types";

const emptySummary: DashboardSummary = {
  window_minutes: 60,
  window_start: new Date().toISOString(),
  p95_latency_ms: null,
  total_events: 0,
  error_rate: 0,
  average_latency_ms: 0,
  active_incidents: 0,
  services: [],
  generated_at: new Date().toISOString(),
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(
    new Date(value),
  );
}

function App() {
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [selectedService, setSelectedService] = useState("all");
  const [connection, setConnection] = useState<LiveStatus>("connecting");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const reconnect = useRef<() => void>(() => {});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [windowMinutes, setWindowMinutes] = useState(60);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [pending, setPending] = useState(false);
  const requestId = useRef(0);

  const loadDashboard = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const [summaryResponse, incidentsResponse, eventsResponse] = await Promise.all([
        fetch(`/api/summary?window_minutes=${windowMinutes}`, { signal: AbortSignal.timeout(10000) }),
        fetch("/api/incidents", { signal: AbortSignal.timeout(10000) }),
        fetch("/api/events?limit=60", { signal: AbortSignal.timeout(10000) }),
      ]);
      if (!summaryResponse.ok || !eventsResponse.ok || !incidentsResponse.ok) throw new Error("The API did not respond successfully.");
      const [nextSummary, nextIncidents, nextEvents] = await Promise.all([
        summaryResponse.json(), incidentsResponse.json(), eventsResponse.json(),
      ]);
      if (id !== requestId.current) return;
      setLastUpdated(new Date());
      setSummary(nextSummary);
      setIncidents(nextIncidents);
      setEvents(nextEvents);
      setError("");
    } catch (caught) {
      if (id !== requestId.current) return;
      setError(caught instanceof Error ? caught.message : "Unable to load dashboard data.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [windowMinutes]);

  useEffect(() => {
    const requests = requestId;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const live = startLiveUpdates({
      url: `${protocol}://${window.location.host}/ws/events`,
      onStatus: setConnection,
      refresh: loadDashboard,
    });
    reconnect.current = live.reconnect;
    const resume = () => live.reconnect();
    const visible = () => { if (document.visibilityState === "visible") live.reconnect(); };
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    document.addEventListener("visibilitychange", visible);
    return () => {
      ++requests.current;
      live.stop();
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [loadDashboard]);


  const services = useMemo(() => ["all", ...Array.from(new Set(events.map((event) => event.service)))], [events]);
  const visibleEvents = selectedService === "all" ? events : events.filter((event) => event.service === selectedService);
  const chartData = [...visibleEvents]
    .reverse()
    .slice(-24)
    .map((event) => ({ time: formatTime(event.created_at), latency: event.latency_ms, status: event.status }));

  async function mutate(url: string, status?: string) {
    setPending(true);
    try {
      const response = await fetch(url, status ? {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      } : { method: "POST" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "Unable to save changes.");
      }
      await loadDashboard();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save changes.");
    } finally { setPending(false); }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><Activity size={21} /></div>
        <div className="brand-copy">
          <strong>SignalForge</strong>
          <span>Reliability console</span>
        </div>
        <div className={`connection ${connection === "live" ? "online" : "offline"}`}>
          <Radio size={15} /> <span role="status">{{ live: "Live stream connected", connecting: "Connecting…", reconnecting: "Reconnecting automatically…", offline: "Offline" }[connection]}</span>
        </div>
      </header>

      <main>
        <section className="page-heading">
          <div>
            <p className="eyebrow">Production overview</p>
            <h1>System health</h1>
            <p>Monitor request latency and failures across every service.</p>
          </div>
          <button className="secondary-button" disabled={pending || connection === "offline"} onClick={() => void mutate("/api/demo/reset")}><RefreshCw size={16} /> Reset demo</button>
        </section>

        {error && <div className="error-banner"><AlertTriangle size={18} /> {error}</div>}

        <div className="live-status" role="status">
          <span>{lastUpdated ? `Last refreshed ${lastUpdated.toLocaleTimeString()}` : loading ? "Loading dashboard…" : "Waiting for API data."}
            {(error || connection !== "live") && lastUpdated ? " · Showing last available data; updates may be delayed." : ""}</span>
          <button className="secondary-button" onClick={() => reconnect.current()}>Reconnect now</button>
        </div>
        <label className="window-control">Metrics window <select aria-label="Metrics window" value={windowMinutes} onChange={(event) => { setLoading(true); setWindowMinutes(Number(event.target.value)); }}>
          <option value={15}>Last 15 minutes</option><option value={60}>Last hour</option><option value={1440}>Last 24 hours</option>
        </select></label>
        <section className="metric-grid" aria-label="System metrics">
          <MetricCard icon={<Activity />} label="Requests" value={loading ? "—" : summary.total_events.toString()} detail={`Last ${summary.window_minutes} minutes`} />
          <MetricCard icon={<Gauge />} label="Average latency" value={loading || summary.average_latency_ms === null ? "—" : `${summary.average_latency_ms} ms`} detail={summary.p95_latency_ms === null ? "No requests in window" : `p95: ${summary.p95_latency_ms} ms`} />
          <MetricCard icon={<AlertTriangle />} label="Error rate" value={loading || summary.error_rate === null ? "—" : `${summary.error_rate}%`} detail="Errors / requests in window" tone={(summary.error_rate ?? 0) > 10 ? "danger" : "default"} />
          <MetricCard icon={<ShieldCheck />} label="Active incidents" value={loading ? "—" : summary.active_incidents.toString()} detail="Open + acknowledged · all time" tone={summary.active_incidents > 0 ? "warning" : "default"} />
        </section>

        <section className="content-grid">
          <article className="panel chart-panel">
            <div className="panel-heading">
              <div><h2>Latency stream</h2><p>Latest request duration in milliseconds</p></div>
              <select value={selectedService} onChange={(event) => setSelectedService(event.target.value)} aria-label="Filter latency by service">
                {services.map((service) => <option key={service} value={service}>{service === "all" ? "All services" : service}</option>)}
              </select>
            </div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
                  <defs><linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#62e6c4" stopOpacity={0.4} /><stop offset="100%" stopColor="#62e6c4" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="#253044" vertical={false} />
                  <XAxis dataKey="time" stroke="#7d8aa3" tickLine={false} axisLine={false} minTickGap={34} />
                  <YAxis stroke="#7d8aa3" tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #2a3851", borderRadius: 8 }} />
                  <Area type="monotone" dataKey="latency" stroke="#62e6c4" strokeWidth={2} fill="url(#latencyFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </article>

          <article className="panel services-panel">
            <div className="panel-heading"><div><h2>Services</h2><p>Health by error rate</p></div><Server size={19} /></div>
            <div className="service-list">
              {!summary.services.length && <p>No requests in this window.</p>}
              {summary.services.map((service) => (
                <div className="service-row" key={service.service}>
                  <span className={`status-dot ${service.status}`} />
                  <div className="service-name"><strong>{service.service}</strong><span>{service.requests} requests</span></div>
                  <div className="service-metric"><strong>{service.average_latency_ms} ms</strong><span>{service.error_rate}% errors · p95 {service.p95_latency_ms} ms</span></div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="panel event-panel" aria-label="Incidents">
          <div className="panel-heading"><div><h2>Incidents</h2><p>One active incident per service. Resolution is manual; new errors after resolution open a new incident.</p></div></div>
          <div className="event-table-wrap"><table>
            <thead><tr><th>Status</th><th>Service</th><th>Latest error</th><th>Errors</th><th>Last seen</th><th>Action</th></tr></thead>
            <tbody>{incidents.map((incident) => <tr key={incident.id}>
              <td>{incident.status}</td><td>{incident.service}</td><td>{incident.message}</td><td>{incident.error_count}</td>
              <td>{new Date(incident.last_seen_at).toLocaleString()}</td>
              <td>{incident.status !== "resolved" && <button className="secondary-button" disabled={pending || connection === "offline"} onClick={() => void mutate(`/api/incidents/${incident.id}`, incident.status === "open" ? "acknowledged" : "resolved")}>
                {incident.status === "open" ? "Acknowledge" : "Resolve"}
              </button>}</td>
            </tr>)}</tbody>
          </table>{!incidents.length && <p>No incidents recorded.</p>}</div>
        </section>

        <section className="panel event-panel">
          <div className="panel-heading"><div><h2>Recent events</h2><p>Live telemetry received by the ingestion API</p></div><span className="event-count">{visibleEvents.length} shown</span></div>
          <div className="event-table-wrap">
            <table>
              <thead><tr><th>Status</th><th>Service</th><th>Message</th><th>Latency</th><th>Time</th></tr></thead>
              <tbody>
                {!visibleEvents.length && <tr><td colSpan={5}>{loading ? "Loading events…" : "No recent events for this service."}</td></tr>}
                {visibleEvents.slice(0, 12).map((event) => (
                  <tr key={event.id}>
                    <td><span className={`status-pill ${event.status}`}>{event.status}</span></td>
                    <td className="service-cell">{event.service}</td>
                    <td>{event.message}</td>
                    <td>{event.latency_ms} ms</td>
                    <td>{formatTime(event.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function MetricCard({ icon, label, value, detail, tone = "default" }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

export default App;

