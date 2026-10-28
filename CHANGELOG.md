# Changelog

## v0.1.1

- Automatically reconnect live updates with capped exponential backoff and jitter.
- Detect stalled WebSockets with heartbeat replies and connection timeouts.
- Refresh metrics, incidents, and recent events after reconnecting; retain polling fallback.
- Show connection state, last successful refresh, delayed data, and manual reconnect control.
- Coalesce live refresh bursts and ignore obsolete responses after window changes.
- Fix API launch after moving the project, use an explicit loopback proxy, and enable direct execution of the telemetry generator.
- Document recovery behavior and manual testing in the README.
- Add automated reconnect, heartbeat, offline, cleanup, and catch-up tests.

## v0.1.0

- Initial telemetry dashboard with time-windowed metrics, p95 latency, and incident lifecycle tracking.
