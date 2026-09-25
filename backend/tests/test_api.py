from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import connect, initialize_database


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_PATH', str(tmp_path / 'test.db'))
    with TestClient(app) as client:
        with connect() as db:
            db.execute('DELETE FROM incidents')
            db.execute('DELETE FROM events')
        yield client


def post_error(client, service='checkout-api'):
    return client.post('/api/events', json=dict(service=service, status='error', latency_ms=900, message='Timeout'))


def test_health_and_empty_metrics(client):
    assert client.get('/health').json() == {'status': 'ok'}
    summary = client.get('/api/summary').json()
    assert summary['total_events'] == 0
    assert summary['error_rate'] is None
    assert summary['p95_latency_ms'] is None
    assert summary['average_latency_ms'] is None
    assert summary['services'] == []
    assert summary['active_incidents'] == 0
    for window in [0, 1441, 'bad']:
        assert client.get(f'/api/summary?window_minutes={window}').status_code == 422


def test_window_metrics_not_capped_and_nearest_rank(client, monkeypatch):
    now = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)
    class Clock:
        @staticmethod
        def now(tz):
            return now
    monkeypatch.setattr('app.main.datetime', Clock)
    with connect() as db:
        for i in range(1, 301):
            db.execute('INSERT INTO events(service,event_type,status,latency_ms,message,created_at) VALUES (?,?,?,?,?,?)',
                       ('checkout-api', 'request', 'error' if i <= 30 else 'success', i, 'Test', (now-timedelta(minutes=15)).isoformat()))
        for time, kind in [(now-timedelta(minutes=15, microseconds=1), 'request'), (now+timedelta(microseconds=1), 'request'), (now, 'heartbeat')]:
            db.execute('INSERT INTO events(service,event_type,status,latency_ms,message,created_at) VALUES (?,?,?,?,?,?)',
                       ('ignored', kind, 'error', 99999, 'Test', time.isoformat()))
    summary = client.get('/api/summary?window_minutes=15').json()
    assert summary['total_events'] == 300
    assert summary['error_rate'] == 10
    assert summary['average_latency_ms'] == 150.5
    assert summary['p95_latency_ms'] == 285
    assert summary['services'][0]['status'] == 'degraded'
    assert summary['services'][0]['p95_latency_ms'] == 285
    assert client.get('/api/summary?window_minutes=60').json()['total_events'] == 301


def test_incident_lifecycle_and_recurrence(client):
    assert post_error(client).status_code == 201
    post_error(client)
    incident, = client.get('/api/incidents').json()
    assert incident['error_count'] == 2
    assert incident['status'] == 'open'
    url = f"/api/incidents/{incident['id']}"
    assert client.patch(url, json={'status': 'resolved'}).status_code == 409
    acknowledged = client.patch(url, json={'status': 'acknowledged'}).json()
    assert acknowledged['acknowledged_at']
    assert client.patch(url, json={'status': 'acknowledged'}).json() == acknowledged
    post_error(client)
    assert client.get('/api/incidents').json()[0]['status'] == 'acknowledged'
    assert client.get('/api/summary').json()['active_incidents'] == 1
    resolved = client.patch(url, json={'status': 'resolved'}).json()
    assert resolved['resolved_at']
    assert resolved['error_count'] == 3
    assert client.get('/api/summary').json()['active_incidents'] == 0
    assert client.patch(url, json={'status': 'acknowledged'}).status_code == 409
    initialize_database()
    assert client.get('/api/incidents').json()[0] == resolved
    post_error(client)
    incidents = client.get('/api/incidents').json()
    assert len(incidents) == 2
    assert incidents[0]['id'] != incident['id']
    assert incidents[0]['error_count'] == 1
    assert client.patch('/api/incidents/999999', json={'status': 'resolved'}).status_code == 404
    assert client.patch(url, json={'status': 'open'}).status_code == 422


def test_success_and_services_and_broadcast(client):
    client.post('/api/events', json={'service': 'healthy', 'latency_ms': 12})
    assert client.get('/api/incidents').json() == []
    with client.websocket_connect('/ws/events') as socket:
        post_error(client)
        assert socket.receive_json()['service'] == 'checkout-api'
        incident = client.get('/api/incidents').json()[0]
        client.patch(f"/api/incidents/{incident['id']}", json={'status': 'acknowledged'})
        assert socket.receive_json()['type'] == 'incidents_updated'
    post_error(client, 'catalog')
    assert client.get('/api/summary').json()['active_incidents'] == 2
    assert len(client.get('/api/incidents').json()) == 2
    client.post('/api/demo/reset')
    first = client.get('/api/incidents').json()
    client.post('/api/demo/reset')
    second = client.get('/api/incidents').json()
    assert sum(i['error_count'] for i in first) == sum(i['error_count'] for i in second) == 4
