import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {
    playerName: "玩家",
    accountSessionToken: "session-token",
    accountSessionExpiresAt: "",
    accountUserLogin: "tester",
    accountUserName: "Test User",
    accountUserProfileUrl: "https://github.com/tester",
  },
  fetch: vi.fn(),
  send: vi.fn(),
  saveSettings: vi.fn(),
  buildHeaders: vi.fn((_url: string, extra?: Record<string, string>) => ({
    "x-relay-token": "test-relay-token",
    ...extra,
  })),
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
  openExternalHttpUrl: vi.fn(async () => true),
}));

vi.mock("../../window", () => ({
  mainWindow: {
    isDestroyed: () => false,
    webContents: { send: mocks.send },
  },
}));

vi.mock("../storage/StoreService", () => ({
  storeService: {
    getSettings: () => mocks.settings,
    saveSettings: mocks.saveSettings,
    init: vi.fn(),
  },
}));

import { AccountService } from "./AccountService";

function successfulResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  };
}

beforeEach(() => {
  Object.assign(mocks.settings, {
    playerName: "玩家",
    accountSessionToken: "session-token",
    accountSessionExpiresAt: "",
    accountUserLogin: "tester",
    accountUserName: "Test User",
    accountUserProfileUrl: "https://github.com/tester",
  });
  mocks.fetch.mockReset();
  mocks.send.mockClear();
  mocks.buildHeaders.mockClear();
  mocks.saveSettings.mockReset();
  mocks.saveSettings.mockImplementation((partial: Record<string, string>) => {
    Object.assign(mocks.settings, partial);
  });
  mocks.warn.mockClear();
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("AccountService account and profile", () => {
  it("stores the account session and synchronizes playerName after OAuth", async () => {
    mocks.settings.playerName = "登录昵称";
    mocks.fetch.mockResolvedValue(successfulResponse());

    const service = new AccountService();
    await expect(
      service.completeOAuth(
        "bzgames://oauth-complete#session_token=new-session&expires_at=2030-01-01T00%3A00%3A00.000Z&login=new-user",
      ),
    ).resolves.toBe(true);

    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        accountSessionToken: "new-session",
        accountUserLogin: "new-user",
      }),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://relay.example.com/api/v1/me/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ nickname: "登录昵称" }),
      }),
    );
    expect(mocks.send).toHaveBeenCalledWith(
      "system:account:authChanged",
      expect.objectContaining({ reason: "login" }),
    );
  });

  it("does not synchronize a nickname without a session", async () => {
    mocks.settings.accountSessionToken = "";
    await new AccountService().syncPlayerName("新的昵称");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps profile synchronization failures non-blocking", async () => {
    mocks.fetch.mockRejectedValue(new Error("offline"));
    await expect(
      new AccountService().syncPlayerName("新的昵称"),
    ).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});

describe("AccountService online presence", () => {
  it("sends an immediate online request and periodic heartbeat", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValue(successfulResponse());
    const service = new AccountService();

    await service.setPresenceEnabled(true);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
      online: true,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    await service.setPresenceEnabled(false);
    expect(JSON.parse(mocks.fetch.mock.calls[2][1].body)).toEqual({
      online: false,
    });
    vi.useRealTimers();
  });

  it("clears the full local account identity when presence finds it expired", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "session_expired" }),
    });

    await expect(
      new AccountService().setPresenceEnabled(true),
    ).resolves.toEqual({ enabled: false });
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      accountSessionToken: "",
      accountSessionExpiresAt: "",
      accountUserLogin: "",
      accountUserName: "",
      accountUserProfileUrl: "",
    });
  });

  it("serializes rapid presence transitions and keeps the final state", async () => {
    const pending: Array<
      (value: ReturnType<typeof successfulResponse>) => void
    > = [];
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const service = new AccountService();

    const online = service.setPresenceEnabled(true);
    const offline = service.setPresenceEnabled(false);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()!(successfulResponse());
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending.shift()!(successfulResponse());

    await expect(Promise.all([online, offline])).resolves.toEqual([
      { enabled: true },
      { enabled: false },
    ]);
    expect(service.getPresenceStatus()).toEqual({ enabled: false });
    expect(
      mocks.fetch.mock.calls.map((call) => JSON.parse(call[1].body).online),
    ).toEqual([true, false]);
  });
});

describe("AccountService logout", () => {
  it("revokes the server session and clears all local account identity", async () => {
    mocks.fetch.mockResolvedValue(successfulResponse());

    await expect(new AccountService().logout()).resolves.toEqual({
      success: true,
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0]).toBe(
      "https://relay.example.com/api/v1/me/session",
    );
    expect(mocks.fetch.mock.calls[1][1].method).toBe("DELETE");
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      accountSessionToken: "",
      accountSessionExpiresAt: "",
      accountUserLogin: "",
      accountUserName: "",
      accountUserProfileUrl: "",
    });
    expect(mocks.send).toHaveBeenCalledWith("system:account:authChanged", {
      reason: "logout",
      status: expect.objectContaining({ authenticated: false }),
    });
  });

  it("keeps the local session when the server is unreachable", async () => {
    mocks.fetch.mockRejectedValue(new Error("offline"));

    await expect(new AccountService().logout()).resolves.toEqual({
      success: false,
      error: "logout_network_error",
    });
    expect(mocks.settings.accountSessionToken).toBe("session-token");
  });

  it("does not call the server when already logged out", async () => {
    mocks.settings.accountSessionToken = "";

    await expect(new AccountService().logout()).resolves.toEqual({
      success: true,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
