import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {
    playerName: "玩家",
    cloudSessionToken: "session-token",
    cloudSessionExpiresAt: "",
  },
  fetch: vi.fn(),
  buildHeaders: vi.fn(
    (_url: string, extra?: Record<string, string>) => ({
      "x-relay-token": "test-relay-token",
      ...extra,
    }),
  ),
  saveSettings: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../../shared/AppConstants", () => ({
  DEFAULT_RELAY_SERVER_URL: "https://relay.example.com",
  OAUTH_RETURN_URL: "bzgames://oauth-complete",
}));

vi.mock("../../utils/requestInterceptor", () => ({
  requestInterceptor: { buildHeaders: mocks.buildHeaders },
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../utils/externalUrl", () => ({
  openExternalHttpUrl: vi.fn(),
}));

vi.mock("../../window", () => ({ mainWindow: null }));

vi.mock("../storage/StoreService", () => ({
  storeService: {
    getSettings: () => mocks.settings,
    saveSettings: mocks.saveSettings,
    init: vi.fn(),
  },
}));

vi.mock("../storage/database/BzGamesDatabase", () => ({
  exportCloudSqlDump: vi.fn(),
  importCloudSqlDump: vi.fn(),
}));

import { CloudSyncService } from "./CloudSyncService";

describe("CloudSyncService playerName synchronization", () => {
  beforeEach(() => {
    mocks.settings.playerName = "玩家";
    mocks.settings.cloudSessionToken = "session-token";
    mocks.fetch.mockReset();
    mocks.buildHeaders.mockClear();
    mocks.saveSettings.mockReset();
    mocks.saveSettings.mockImplementation((partial: Record<string, string>) => {
      Object.assign(mocks.settings, partial);
    });
    mocks.warn.mockClear();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("uploads the current playerName with the cloud bearer token", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const service = new CloudSyncService();
    await service.syncPlayerName("新的昵称");

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0]).toEqual([
      "https://relay.example.com/api/v1/me/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ nickname: "新的昵称" }),
      }),
    ]);
    expect(mocks.buildHeaders).toHaveBeenCalledWith(
      "https://relay.example.com/api/v1/me/profile",
      {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: "Bearer session-token",
      },
    );
  });

  it("uploads the current playerName after OAuth login completes", async () => {
    mocks.settings.playerName = "登录昵称";
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    const service = new CloudSyncService();
    await expect(
      service.completeOAuth(
        "bzgames://oauth-complete#session_token=new-session&expires_at=2030-01-01T00%3A00%3A00.000Z",
      ),
    ).resolves.toBe(true);

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      nickname: "登录昵称",
    });
  });

  it("does not upload when the client is not logged in", async () => {
    mocks.settings.cloudSessionToken = "";
    const service = new CloudSyncService();

    await service.syncPlayerName("新的昵称");

    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps synchronization failures silent to the caller", async () => {
    mocks.fetch.mockRejectedValue(new Error("offline"));
    const service = new CloudSyncService();

    await expect(service.syncPlayerName("新的昵称")).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});

describe("CloudSyncService online presence", () => {
  beforeEach(() => {
    mocks.settings.playerName = "玩家";
    mocks.settings.cloudSessionToken = "session-token";
    mocks.fetch.mockReset();
    mocks.buildHeaders.mockClear();
    mocks.saveSettings.mockReset();
    mocks.saveSettings.mockImplementation((partial: Record<string, string>) => {
      Object.assign(mocks.settings, partial);
    });
    mocks.warn.mockClear();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("starts offline and does not persist the presence state", async () => {
    const first = new CloudSyncService();
    expect(first.getPresenceStatus()).toEqual({ enabled: false });

    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    await first.setPresenceEnabled(true);
    await first.setPresenceEnabled(false);

    const second = new CloudSyncService();
    expect(second.getPresenceStatus()).toEqual({ enabled: false });
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it("sends an immediate online request and one heartbeat per minute", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const service = new CloudSyncService();

    await service.setPresenceEnabled(true);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      online: true,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({
      online: true,
    });

    await service.setPresenceEnabled(false);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toEqual({
      online: false,
    });
    vi.useRealTimers();
  });

  it("does not start online when unauthenticated and resets stale server state on startup", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    mocks.settings.cloudSessionToken = "";
    const unauthenticated = new CloudSyncService();
    await unauthenticated.resetPresenceOnStartup();
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.settings.cloudSessionToken = "session-token";
    const service = new CloudSyncService();
    await service.resetPresenceOnStartup();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      online: false,
    });
  });

  it("stops presence when the session expires", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "session_expired" }),
    });
    const service = new CloudSyncService();

    await expect(service.setPresenceEnabled(true)).resolves.toEqual({
      enabled: false,
    });
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      cloudSessionToken: "",
      cloudSessionExpiresAt: "",
    });
  });
});
