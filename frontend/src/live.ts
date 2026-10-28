export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

type Options = {
  url: string;
  onStatus: (status: LiveStatus) => void;
  refresh: () => Promise<void>;
  socket?: (url: string) => WebSocket;
  online?: () => boolean;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  random?: () => number;
};

// Socket notifications invalidate the REST snapshot; they are not an event log.
export function startLiveUpdates(options: Options) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  const online = options.online ?? (() => navigator.onLine);
  const createSocket = options.socket ?? ((url) => new WebSocket(url));
  const random = options.random ?? Math.random;
  let stopped = false;
  let socket: WebSocket | undefined;
  let attempts = 0;
  let refreshing = false;
  let dirty = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;

  async function refresh() {
    if (stopped) return;
    if (refreshing) { dirty = true; return; }
    refreshing = true;
    try { await options.refresh(); }
    catch { /* The view reports request errors; polling will retry. */ }
    finally {
      refreshing = false;
      if (dirty && !stopped) { dirty = false; void refresh(); }
    }
  }

  function closeSocket() {
    if (deadline !== undefined) cancel(deadline);
    if (heartbeat !== undefined) cancel(heartbeat);
    deadline = heartbeat = undefined;
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
      socket.close();
      socket = undefined;
    }
  }

  function failed() {
    if (stopped) return;
    closeSocket();
    if (retry !== undefined) cancel(retry);
    options.onStatus(online() ? "reconnecting" : "offline");
    if (online()) {
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) * (0.8 + random() * 0.2);
      retry = schedule(connect, delay);
    }
  }

  function ping() {
    if (stopped || !socket) return;
    deadline = schedule(failed, 10000);
    try { socket.send("ping"); } catch { failed(); }
  }

  function connect() {
    retry = undefined;
    if (stopped) return;
    if (!online()) { options.onStatus("offline"); return; }
    options.onStatus(attempts ? "reconnecting" : "connecting");
    try {
      socket = createSocket(options.url);
      deadline = schedule(failed, 10000);
      socket.onopen = () => {
        if (deadline !== undefined) cancel(deadline);
        void refresh(); // Catch up after every connection, even without new events.
        ping();
      };
      socket.onerror = failed;
      socket.onclose = failed;
      socket.onmessage = (message) => {
        let payload;
        try { payload = JSON.parse(message.data); } catch { return; }
        if (payload?.type === "pong") {
          if (deadline !== undefined) cancel(deadline);
          if (heartbeat !== undefined) cancel(heartbeat);
          attempts = 0;
          options.onStatus("live");
          heartbeat = schedule(ping, 20000);
        } else {
          void refresh();
        }
      };
    } catch { failed(); }
  }

  function pollAgain() {
    if (stopped) return;
    if (online()) void refresh();
    poll = schedule(pollAgain, 15000);
  }

  function reconnect() {
    if (stopped) return;
    if (retry !== undefined) cancel(retry);
    closeSocket();
    attempts = 0;
    connect();
    if (online()) void refresh();
  }

  void refresh();
  connect();
  poll = schedule(pollAgain, 15000);
  return {
    reconnect,
    stop() {
      stopped = true;
      if (retry !== undefined) cancel(retry);
      if (poll !== undefined) cancel(poll);
      closeSocket();
    },
  };
}
