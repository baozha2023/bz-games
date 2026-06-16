import { ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";
import { normalizeRendererLogPayload, serializeLogArgs, type LogSource, type RendererLogContext, type RendererLogPayload } from "../shared/log-serialization";

const MAIN_WORLD_BRIDGE_SOURCE = `(() => {
  if (window.__bzGamesErrorForwardingInstalled) return;
  window.__bzGamesErrorForwardingInstalled = true;
  const nativeConsoleError = console.error.bind(console);
  const forward = (args) => window.dispatchEvent(new CustomEvent("bz-games:renderer-error", { detail: Array.from(args) }));
  console.error = (...args) => {
    nativeConsoleError(...args);
    forward(args);
  };
  window.addEventListener("error", (event) => console.error("[Window] Unhandled error", event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => console.error("[Window] Unhandled rejection", event.reason));
})();`;

function resolveGameIdentity() {
  const params = new URLSearchParams(window.location.search);
  return {
    gameId: params.get("gameId") || process.argv.find((arg) => arg.startsWith("--bz-game-id="))?.slice("--bz-game-id=".length),
    version: params.get("version") || process.argv.find((arg) => arg.startsWith("--bz-game-version="))?.slice("--bz-game-version=".length),
  };
}

function resolveSource(defaultSource: LogSource): LogSource {
  const hash = window.location.hash;
  if (hash.startsWith("#/chat-popout")) return "chat-window";
  if (hash.startsWith("#/float-ball")) return "float-ball";
  if (hash.startsWith("#/notification")) return "notification-window";
  return defaultSource;
}

function buildContext(defaultSource: LogSource): RendererLogContext {
  const identity: { gameId?: string; version?: string } = defaultSource === "game-window" ? resolveGameIdentity() : {};
  return {
    source: resolveSource(defaultSource),
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    gameId: identity.gameId,
    version: identity.version,
  };
}

function sendRendererLog(payload: RendererLogPayload) {
  ipcRenderer.send(IPC.SYSTEM_LOG_ERROR, payload);
}

function buildPayload(defaultSource: LogSource, args: unknown[]): RendererLogPayload {
  return {
    context: buildContext(defaultSource),
    args: serializeLogArgs(args),
  };
}

function installPreloadWorldForwarding(defaultSource: LogSource) {
  const nativeConsoleError = console.error.bind(console);
  const shouldWriteErrorToConsole = process.env.NODE_ENV === "development" || !!process.env.ELECTRON_RENDERER_URL;
  console.error = (...args: unknown[]) => {
    if (shouldWriteErrorToConsole) nativeConsoleError(...args);
    sendRendererLog(buildPayload(defaultSource, args));
  };
}

function installMainWorldForwarding(defaultSource: LogSource) {
  window.addEventListener("bz-games:renderer-error", (event) => {
    const detail = (event as CustomEvent).detail;
    const payload = normalizeRendererLogPayload(detail) || buildPayload(defaultSource, Array.isArray(detail) ? detail : [detail]);
    sendRendererLog(payload);
  });
  const inject = () => {
    const script = document.createElement("script");
    script.textContent = MAIN_WORLD_BRIDGE_SOURCE;
    document.documentElement.appendChild(script);
    script.remove();
  };
  if (document.documentElement) inject();
  else window.addEventListener("DOMContentLoaded", inject, { once: true });
}

function installPreloadUnhandledForwarding() {
  window.addEventListener("error", (event) => {
    console.error("[Window] Unhandled error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[Window] Unhandled rejection", event.reason);
  });
}

export function installErrorForwarding(defaultSource: LogSource) {
  installPreloadWorldForwarding(defaultSource);
  if (process.contextIsolated) {
    installMainWorldForwarding(defaultSource);
  } else {
    installPreloadUnhandledForwarding();
  }
}
