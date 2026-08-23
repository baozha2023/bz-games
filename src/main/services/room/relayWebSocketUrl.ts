export function toRelayWebSocketUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const candidate = trimmed.startsWith("ws://") || trimmed.startsWith("wss://")
    ? trimmed
    : trimmed.startsWith("https://")
      ? `wss://${trimmed.slice("https://".length)}`
      : trimmed.startsWith("http://")
        ? `ws://${trimmed.slice("http://".length)}`
        : `ws://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return "";
    url.pathname = "/ws/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
