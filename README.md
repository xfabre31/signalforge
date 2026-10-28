# SignalForge v0.1.1 — Resilient Live Updates

SignalForge is a local-first software reliability dashboard built with FastAPI,
SQLite, React, and TypeScript. It ingests telemetry and shows live service health,
request latency, errors, and incidents.

## What it can do

- Store validated telemetry and generate demo traffic.
- Calculate time-windowed error rates, average latency, and p95 latency.
- Track incidents through open, acknowledged, and resolved states.
- Display live charts, service health, and recent events with automatic recovery.

## Current update: v0.1.1

- Automatic WebSocket reconnect with backoff and heartbeat checks.
- Refresh metrics, incidents, and recent events after reconnecting.
- Connection status, last-refresh time, delayed-data notice, and **Reconnect now**.
- Fixes for launching a moved project and running the telemetry generator directly.

## Quick start

Requirements: Python 3.12, Node.js 24, and VS Code.

1. Open the project folder in VS Code.
2. Run **Tasks: Run Task → Setup: Full project** once to install dependencies.
3. Run **Tasks: Run Task → Dev: SignalForge** to start the API and dashboard.
4. Open [the dashboard](http://localhost:5173). API documentation is at
   [localhost:8000/docs](http://localhost:8000/docs).
5. From the project root, generate traffic with:

   ```bash
   .venv/bin/python scripts/generate_events.py
   ```

Press Ctrl+C to stop the generator. Live recovery works automatically; use
**Reconnect now** to trigger an immediate retry.

## Documentation

- [Implementation guide](IMPLEMENTATION.md): feature details, architecture, manual
  and Docker setup, API reference, recovery walkthrough, testing, and troubleshooting.
- [Changelog](CHANGELOG.md): version-by-version release history.

For each release, update this README's version and update name, summarize the new
changes here, and keep cumulative implementation details in `IMPLEMENTATION.md`.
