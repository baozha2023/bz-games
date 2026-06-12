export function createRelayState() {
  let eventLoopDelayMs = 0;
  let lastEventLoopCheckAt = Date.now();

  return {
    rooms: new Map(),
    clients: new Map(),
    getEventLoopDelayMs() {
      return eventLoopDelayMs;
    },
    updateEventLoopDelay() {
      const now = Date.now();
      eventLoopDelayMs = Math.max(0, now - lastEventLoopCheckAt - 1000);
      lastEventLoopCheckAt = now;
    },
  };
}
