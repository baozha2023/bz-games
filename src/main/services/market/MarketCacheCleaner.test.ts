import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: loggerMocks.error,
    warn: loggerMocks.warn,
  },
}));

import { MarketCacheCleaner } from "./MarketCacheCleaner";

describe("MarketCacheCleaner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats preflight cleanup as an installation precondition", async () => {
    const removePath = vi.fn().mockRejectedValue(new Error("EPERM"));
    const cleaner = new MarketCacheCleaner(removePath);

    await expect(
      cleaner.prepare("C:/cache/extract", "extract_preflight"),
    ).rejects.toThrow("market_cache_cleanup_failed:extract_preflight");
    expect(loggerMocks.error).toHaveBeenCalledOnce();
  });

  it("removes and verifies an existing staging tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bz-market-cleanup-"));
    const staging = path.join(root, "extract");
    await mkdir(staging);
    await writeFile(path.join(staging, "stale.bin"), "stale");

    try {
      await new MarketCacheCleaner().prepare(staging, "extract_preflight");
      await expect(stat(staging)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not change a terminal task result when cache reclamation fails", async () => {
    const removePath = vi.fn().mockRejectedValue(new Error("EBUSY"));
    const cleaner = new MarketCacheCleaner(removePath);

    await expect(cleaner.reclaim("C:/cache/extract")).resolves.toBeUndefined();
    expect(loggerMocks.error).toHaveBeenCalledOnce();
  });
});
