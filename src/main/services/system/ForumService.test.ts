import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("electron", () => ({
  dialog: { showOpenDialog: mocks.showOpenDialog },
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 1, height: 1 }),
    }),
  },
}));

vi.mock("fs/promises", () => ({
  default: { stat: mocks.stat, readFile: mocks.readFile },
}));

vi.mock("../../../shared/AppConstants", () => ({
  DEFAULT_RELAY_SERVER_URL: "https://relay.example.com",
}));

vi.mock("../../utils/requestInterceptor", () => ({
  requestInterceptor: { buildHeaders: vi.fn() },
}));

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn() },
}));

vi.mock("../storage/StoreService", () => ({
  storeService: {
    getSettings: () => ({ cloudSessionToken: "session-token" }),
  },
}));

vi.mock("./CloudSyncService", () => ({
  cloudSyncService: { handleAuthFailure: vi.fn() },
}));

import { ForumService } from "./ForumService";

describe("ForumService image selection", () => {
  beforeEach(() => {
    mocks.showOpenDialog.mockReset();
    mocks.stat.mockReset();
    mocks.readFile.mockReset();
  });

  it("rejects duplicate images selected in the same batch", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    mocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["first.png", "duplicate.png"],
    });
    mocks.stat.mockResolvedValue({ isFile: () => true, size: png.length });
    mocks.readFile.mockResolvedValue(png);

    await expect(new ForumService().selectImages()).resolves.toEqual({
      success: false,
      error: "duplicate_image",
    });
  });
});
