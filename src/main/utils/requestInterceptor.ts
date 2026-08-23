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

function isUrlWithinBase(url: string, base: string): boolean {
  if (!base) return false;

  try {
    const target = new URL(url);
    const trusted = new URL(base);
    const trustedPath = trusted.pathname.replace(/\/+$/, "") || "/";

    if (
      target.origin !== trusted.origin ||
      target.username ||
      target.password ||
      trusted.username ||
      trusted.password
    ) {
      return false;
    }

    return (
      trustedPath === "/" ||
      target.pathname === trustedPath ||
      target.pathname.startsWith(`${trustedPath}/`)
    );
  } catch {
    return false;
  }
}

function isUrlWithinAnyBase(url: string, bases: readonly string[]): boolean {
  return bases.some((base) => isUrlWithinBase(url, base));
}

export class RequestInterceptor {
  private getTokenFn: () => string | null;

  constructor(getToken: () => string | null) {
    this.getTokenFn = getToken;
  }

  buildHeaders(url: string, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };

    if (isUrlWithinAnyBase(url, REFERER_DOMAINS)) {
      headers["Referer"] = REFERER;
    }

    if (isUrlWithinAnyBase(url, TOKEN_DOMAINS)) {
      const token = this.getTokenFn();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    if (isUrlWithinBase(url, RELAY_HTTP_BASE) && DEFAULT_RELAY_TOKEN) {
      headers["x-relay-token"] = DEFAULT_RELAY_TOKEN;
    }

    return headers;
  }

  buildWebSocketUrl(url: string): string {
    if (!isUrlWithinBase(url, RELAY_WS_BASE) || !DEFAULT_RELAY_TOKEN) return url;
    const target = new URL(url);
    target.searchParams.set("relayToken", DEFAULT_RELAY_TOKEN);
    return target.toString();
  }

  registerSessionHandler(session: Session): void {
    session.webRequest.onBeforeSendHeaders(
      { urls: REFERER_DOMAINS.map((d) => `${d}*`) },
      (details, callback) => {
        if (isUrlWithinAnyBase(details.url, REFERER_DOMAINS)) {
          details.requestHeaders["Referer"] = REFERER;
        }
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
