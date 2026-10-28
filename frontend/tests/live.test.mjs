import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveUpdates } from '../src/live.ts';

function harness(refresh = async () => {}) {
  let now = 0, next = 0, online = true;
  const timers = new Map(), sockets = [], statuses = [];
  const live = startLiveUpdates({
    url: 'ws://test', refresh, onStatus: s => statuses.push(s),
    online: () => online, random: () => 1,
    schedule(fn, delay) { timers.set(++next, { fn, at: now + delay }); return next; },
    cancel(id) { timers.delete(id); },
    socket() {
      const s = { closed: false, sent: [], send(v) { this.sent.push(v); }, close() { this.closed = true; } };
      sockets.push(s); return s;
    },
  });
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const entry = [...timers].sort((a,b) => a[1].at - b[1].at).find(([,v]) => v.at <= end);
      if (!entry) break;
      const [id, { fn, at }] = entry;
      now = at; timers.delete(id); fn();
    }
    now = end;
  }
  return { live, sockets, statuses, timers, advance, offline: () => { online = false; }, online: () => { online = true; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('reconnect backs off, catches up without a notification, and cleans up', async () => {
  let refreshes = 0;
  const h = harness(async () => { refreshes++; });
  await tick();
  h.sockets[0].onclose();
  h.advance(999); assert.equal(h.sockets.length, 1);
  h.advance(1); assert.equal(h.sockets.length, 2);
  h.sockets[1].onclose();
  h.advance(1999); assert.equal(h.sockets.length, 2);
  h.advance(1); assert.equal(h.sockets.length, 3);
  h.sockets[2].onopen(); await tick();
  assert.equal(refreshes, 2);
  assert.deepEqual(h.sockets[2].sent, ['ping']);
  h.sockets[2].onmessage({ data: '{"type":"pong"}' });
  assert.equal(h.statuses.at(-1), 'live');
  h.live.stop(); assert.equal(h.timers.size, 0);
  h.advance(60000); assert.equal(h.sockets.length, 3);
});

test('silent connections time out; polling continues and heartbeat detects stalls', async () => {
  let refreshes = 0;
  const h = harness(async () => { refreshes++; });
  h.advance(10000); assert.equal(h.sockets[0].closed, true);
  h.advance(1000); h.sockets[1].onopen(); await tick();
  h.sockets[1].onmessage({ data: '{"type":"pong"}' });
  h.advance(20000); assert.equal(h.sockets[1].sent.length, 2);
  h.advance(10000); assert.equal(h.sockets[1].closed, true);
  await tick(); assert.ok(refreshes >= 3);
  h.live.stop();
});

test('offline pauses retries; online and manual retry reconnect immediately', () => {
  const h = harness(); h.offline(); h.live.reconnect();
  assert.equal(h.statuses.at(-1), 'offline');
  h.advance(60000); assert.equal(h.sockets.length, 1);
  h.online(); h.live.reconnect(); assert.equal(h.sockets.length, 2);
  h.live.reconnect(); assert.equal(h.sockets[1].closed, true);
  assert.equal(h.sockets.length, 3);
  h.live.stop();
});

test('bursts coalesce and stopped controllers do not process queued refreshes', async () => {
  let finish, count = 0;
  const h = harness(() => { count++; return new Promise(resolve => { finish = resolve; }); });
  for (let i = 0; i < 100; i++) h.sockets[0].onmessage({ data: '{"id":1}' });
  assert.equal(count, 1);
  finish(); await tick(); assert.equal(count, 2);
  h.sockets[0].onmessage({ data: 'malformed' });
  h.sockets[0].onmessage({ data: '{"id":2}' });
  h.live.stop(); finish(); await tick(); assert.equal(count, 2);
});

test('repeated failures cap retry delay at 30 seconds', () => {
  const h = harness();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    const count = h.sockets.length;
    h.sockets.at(-1).onclose();
    h.advance(delay - 1); assert.equal(h.sockets.length, count);
    h.advance(1); assert.equal(h.sockets.length, count + 1);
  }
  h.live.stop();
});
