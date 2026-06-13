import type { Session } from "electron";
import { storeService } from "../services/storage/StoreService";
import {
  CDN_BASE,
  DEFAULT_RELAY_SERVER_URL,
  DEFAULT_RELAY_TOKEN,
  GITHUB_API_BASE,
  GITHUB_RAW_BASE,
  OSS_BASE,
  REFERER,
} from "../../shared/AppConstants";

const REFERER_DOMAINS = [CDN_BASE, OSS_BASE] as const;

const TOKEN_DOMAINS = [GITHUB_API_BASE, GITHUB_RAW_BASE] as const;

function normalizeHttpBase(url: string): string {
  const value = url.trim();
  if (!value) return "";
  if (value.startsWith("wss://")) return `https://${value.slice("wss://".length)}`.replace(/\/+$/, "");
  if (value.startsWith("ws://")) return `http://${value.slice("ws://".length)}`.replace(/\/+$/, "");
  return value.replace(/\/+$/, "");
}

function normalizeWebSocketBase(url: string): string {
  const value = url.trim();
  if (!value) return "";
  if (value.startsWith("https://")) return `wss://${value.slice("https://".length)}`.replace(/\/+$/, "");
  if (value.startsWith("http://")) return `ws://${value.slice("http://".length)}`.replace(/\/+$/, "");
  if (value.startsWith("ws://") || value.startsWith("wss://")) return value.replace(/\/+$/, "");
  return `ws://${value}`.replace(/\/+$/, "");
}

const RELAY_HTTP_BASE = normalizeHttpBase(DEFAULT_RELAY_SERVER_URL);
const RELAY_WS_BASE = normalizeWebSocketBase(DEFAULT_RELAY_SERVER_URL);

export class RequestInterceptor {
  private getTokenFn: () => string | null;

  constructor(getToken: () => string | null) {
    this.getTokenFn = getToken;
  }

  buildHeaders(url: string, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };

    if (REFERER_DOMAINS.some((d) => url.startsWith(d))) {
      headers["Referer"] = REFERER;
    }

    if (TOKEN_DOMAINS.some((d) => url.startsWith(d))) {
      const token = this.getTokenFn();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    if (RELAY_HTTP_BASE && url.startsWith(RELAY_HTTP_BASE) && DEFAULT_RELAY_TOKEN) {
      headers["x-relay-token"] = DEFAULT_RELAY_TOKEN;
    }

    return headers;
  }

  buildWebSocketUrl(url: string): string {
    if (!RELAY_WS_BASE || !url.startsWith(RELAY_WS_BASE) || !DEFAULT_RELAY_TOKEN) return url;
    const target = new URL(url);
    target.searchParams.set("relayToken", DEFAULT_RELAY_TOKEN);
    return target.toString();
  }

  registerSessionHandler(session: Session): void {
    session.webRequest.onBeforeSendHeaders(
      { urls: REFERER_DOMAINS.map((d) => `${d}*`) },
      (details, callback) => {
        details.requestHeaders["Referer"] = REFERER;
        callback({ requestHeaders: details.requestHeaders });
      },
    );
  }
}

export const requestInterceptor = new RequestInterceptor(() => {
  try {
    return storeService.getSettings().githubToken?.trim() ?? null;
  } catch {
    return null;
  }
});
