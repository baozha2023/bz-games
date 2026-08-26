import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: { cloudSessionToken: "session-token" },
  clearLegacyFeedbackHistory: vi.fn(),
  addFeedbackHistory: vi.fn(),
  buildHeaders: vi.fn(
    (_url: string, authorization?: Record<string, string>) => ({
      "x-relay-token": "test-relay-token",
      ...authorization,
    }),
  ),
  handleAuthFailure: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "3.2.3" },
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
}));

vi.mock("../../../shared/AppConstants", () => ({
  DEFAULT_RELAY_SERVER_URL: "https://relay.example.com",
}));

vi.mock("../../utils/requestInterceptor", () => ({
  requestInterceptor: { buildHeaders: mocks.buildHeaders },
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../storage/StoreService", () => ({
  storeService: {
    getSettings: () => mocks.settings,
    clearLegacyFeedbackHistory: mocks.clearLegacyFeedbackHistory,
    addFeedbackHistory: mocks.addFeedbackHistory,
  },
}));

vi.mock("./CloudSyncService", () => ({
  cloudSyncService: { handleAuthFailure: mocks.handleAuthFailure },
}));

import { FeedbackService } from "./FeedbackService";

describe("FeedbackService remote history", () => {
  beforeEach(() => {
    mocks.settings.cloudSessionToken = "session-token";
    mocks.clearLegacyFeedbackHistory.mockClear();
    mocks.addFeedbackHistory.mockClear();
    mocks.buildHeaders.mockClear();
    mocks.handleAuthFailure.mockClear();
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears legacy local history before loading the remote list", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              submittedAt: 1_735_689_600_000,
            },
          ],
          nextCursor: "cursor-1",
          hasMore: true,
        }),
        { status: 200 },
      ),
    );

    const service = new FeedbackService();
    await expect(service.getHistory()).resolves.toEqual({
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          submittedAt: 1_735_689_600_000,
        },
      ],
      nextCursor: "cursor-1",
      hasMore: true,
    });

    expect(mocks.clearLegacyFeedbackHistory).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(
      mocks.clearLegacyFeedbackHistory.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.fetch.mock.invocationCallOrder[0]);
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://relay.example.com/api/v1/feedback?limit=10",
    );
  });

  it("passes the cursor when loading the next history page", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        { status: 200 },
      ),
    );

    const service = new FeedbackService();
    await expect(service.getHistory("cursor+/=")).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });

    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://relay.example.com/api/v1/feedback?limit=10&cursor=cursor%2B%2F%3D",
    );
    expect(mocks.clearLegacyFeedbackHistory).not.toHaveBeenCalled();
  });

  it("clears legacy local history even when the account is not logged in", async () => {
    mocks.settings.cloudSessionToken = "";

    const service = new FeedbackService();
    await expect(service.getHistory()).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });

    expect(mocks.clearLegacyFeedbackHistory).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed remote history without restoring local data", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "not-a-uuid",
              submittedAt: 1_735_689_600_000,
            },
          ],
          nextCursor: null,
          hasMore: false,
        }),
        { status: 200 },
      ),
    );

    const service = new FeedbackService();
    await expect(service.getHistory()).rejects.toThrow(
      "feedback_invalid_response",
    );
    expect(mocks.clearLegacyFeedbackHistory).toHaveBeenCalledOnce();
  });

  it("does not write feedback history after a successful submission", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, id: "feedback-id" }), {
        status: 201,
      }),
    );

    const service = new FeedbackService();
    await expect(service.submit({ content: "test feedback" })).resolves.toEqual(
      {
        success: true,
        id: "feedback-id",
      },
    );
    expect(mocks.addFeedbackHistory).not.toHaveBeenCalled();
  });
});
