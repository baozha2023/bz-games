import type { Session } from "electron";
import { CDN_BASE, GITHUB_API_BASE, GITHUB_RAW_BASE, OSS_BASE, REFERER } from "../../shared/AppConstants";

const REFERER_DOMAINS = [CDN_BASE, OSS_BASE] as const;

const TOKEN_DOMAINS = [GITHUB_API_BASE, GITHUB_RAW_BASE] as const;

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

    return headers;
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
