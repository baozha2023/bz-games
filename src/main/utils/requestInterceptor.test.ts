import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));
vi.mock("../services/storage/StoreService", () => ({
  storeService: { getSettings: vi.fn() },
}));
vi.mock("../../shared/AppConstants", () => ({
  CDN_BASE: "https://cdn.example/assets/",
  OSS_BASE: "https://oss.example/",
  GITHUB_API_BASE: "https://api.github.com/",
  GITHUB_RAW_BASE: "https://raw.githubusercontent.com/",
  REFERER: "https://launcher.example/",
  DEFAULT_RELAY_SERVER_URL: "https://relay.example/base/",
  DEFAULT_RELAY_TOKEN: "relay-token",
}));

import { RequestInterceptor } from "./requestInterceptor";

describe("RequestInterceptor", () => {
  const interceptor = new RequestInterceptor(() => "github-token");

  it("injects credentials only for exact origins and path boundaries", () => {
    expect(interceptor.buildHeaders("https://cdn.example/assets/image.png")).toEqual({
      Referer: "https://launcher.example/",
    });
    expect(interceptor.buildHeaders("https://cdn.example/assets-extra/image.png")).toEqual({});
    expect(interceptor.buildHeaders("https://cdn.example.evil/assets/image.png")).toEqual({});
    expect(interceptor.buildHeaders("https://api.github.com/repos/example/project")).toEqual({
      Authorization: "Bearer github-token",
    });
    expect(interceptor.buildHeaders("https://api.github.com.evil/repos/example/project")).toEqual({});
    expect(interceptor.buildHeaders("https://user:pass@api.github.com/repos/example/project")).toEqual({});
  });

  it("injects Relay credentials only inside the configured HTTP and WebSocket bases", () => {
    expect(interceptor.buildHeaders("https://relay.example/base/api/v1/forum/posts")).toEqual({
      "x-relay-token": "relay-token",
    });
    expect(interceptor.buildHeaders("https://relay.example/baseball/api/v1/forum/posts")).toEqual({});
    expect(interceptor.buildHeaders("https://relay.example.evil/base/api/v1/forum/posts")).toEqual({});

    expect(interceptor.buildWebSocketUrl("wss://relay.example/base/room?id=1")).toBe(
      "wss://relay.example/base/room?id=1&relayToken=relay-token",
    );
    expect(interceptor.buildWebSocketUrl("wss://relay.example/baseball/room?id=1")).toBe(
      "wss://relay.example/baseball/room?id=1",
    );
    expect(interceptor.buildWebSocketUrl("wss://relay.example.evil/base/room?id=1")).toBe(
      "wss://relay.example.evil/base/room?id=1",
    );
  });
});
