import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:/tmp/bz-games-test",
    getVersion: () => "3.2.0",
    isPackaged: false,
  },
}));
vi.mock("7zip-bin", () => ({ path7za: "7za" }));
vi.mock("../game/GameLoader", () => ({
  GameLoader: { loadGameFromPath: vi.fn() },
}));
vi.mock("../../window", () => ({
  mainWindow: null,
  floatBallWindow: null,
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../utils/requestInterceptor", () => ({
  requestInterceptor: { buildHeaders: vi.fn(() => ({})) },
}));
vi.mock("./HostedGameUrl", () => ({
  resolveMarketDownloadUrl: (url: string) => url,
  resolveMarketImageUrl: (url: string) => url,
}));
vi.mock("../../../shared/AppConstants", () => ({
  GITHUB_API_BASE: "https://api.github.com/",
  GITHUB_RAW_BASE: "https://raw.githubusercontent.com/",
  MARKET_GITHUB_INDEX_URL: "https://github.test/market.json",
  MARKET_OSS_INDEX_URL: "https://oss.test/market.json",
}));

import { MarketService } from "./MarketService";
import type {
  MarketDirectory,
  MarketIndex,
  MarketSource,
} from "../../../shared/types";
import type { OfficialMarketCatalog } from "./MarketCatalogClient";

function source(
  repository = "https://github.com/example/community",
): MarketSource {
  return {
    marketId: "community",
    marketName: "Community",
    generatedAt: "2026-08-09T00:00:00.000Z",
    repository,
    branch: "main",
  };
}

function index(marketId: string): MarketIndex {
  return {
    schemaVersion: "1.0.0",
    marketId,
    marketName: marketId,
    generatedAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    games: [],
  };
}

function catalog(
  externalSource = source(),
  fetchedAt = Date.now(),
): OfficialMarketCatalog {
  const directory: MarketDirectory = {
    schemaVersion: "1.0.0",
    sources: [
      {
        marketId: "official",
        marketName: "Official",
        generatedAt: "2026-08-09T00:00:00.000Z",
        repository: "https://github.com/example/official",
        branch: "main",
      },
      externalSource,
    ],
  };
  return { directory, index: index("official"), fetchedAt };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("MarketService catalog cache", () => {
  it("coalesces concurrent official directory and index requests", async () => {
    const pending = deferred<OfficialMarketCatalog>();
    const client = {
      fetchOfficialCatalog: vi.fn(() => pending.promise),
      fetchExternalIndex: vi.fn(),
    };
    const service = new MarketService(client);

    const sourcesPromise = service.getSources();
    const indexPromise = service.getIndex(0);
    pending.resolve(catalog());

    await expect(sourcesPromise).resolves.toMatchObject({
      schemaVersion: "1.0.0",
    });
    await expect(indexPromise).resolves.toMatchObject({ marketId: "official" });
    expect(client.fetchOfficialCatalog).toHaveBeenCalledTimes(1);
  });

  it("uses fresh cache and keeps it after a failed forced refresh", async () => {
    const firstCatalog = catalog();
    const client = {
      fetchOfficialCatalog: vi
        .fn()
        .mockResolvedValueOnce(firstCatalog)
        .mockRejectedValueOnce(new Error("offline")),
      fetchExternalIndex: vi.fn(),
    };
    const service = new MarketService(client);

    await service.getSources();
    await service.getSources();
    expect(client.fetchOfficialCatalog).toHaveBeenCalledTimes(1);
    await expect(service.getSources(true)).rejects.toThrow("offline");
    await expect(service.getSources()).resolves.toBe(firstCatalog.directory);
    expect(client.fetchOfficialCatalog).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent requests for the same external source", async () => {
    const pending = deferred<MarketIndex>();
    const client = {
      fetchOfficialCatalog: vi.fn(async () => catalog()),
      fetchExternalIndex: vi.fn(() => pending.promise),
    };
    const service = new MarketService(client);

    const first = service.getIndex(1);
    const second = service.getIndex(1);
    pending.resolve(index("community"));

    await expect(first).resolves.toMatchObject({ marketId: "community" });
    await expect(second).resolves.toMatchObject({ marketId: "community" });
    expect(client.fetchExternalIndex).toHaveBeenCalledTimes(1);
  });

  it("does not reuse an external index after its repository changes", async () => {
    const firstSource = source("https://github.com/example/community-a");
    const secondSource = source("https://github.com/example/community-b");
    const client = {
      fetchOfficialCatalog: vi
        .fn()
        .mockResolvedValueOnce(catalog(firstSource))
        .mockResolvedValueOnce(catalog(secondSource)),
      fetchExternalIndex: vi.fn(async (_source: MarketSource) =>
        index("community"),
      ),
    };
    const service = new MarketService(client);

    await service.getIndex(1);
    await service.getIndex(1, true);

    expect(client.fetchExternalIndex).toHaveBeenCalledTimes(2);
    expect(client.fetchExternalIndex.mock.calls[1][0].repository).toContain(
      "community-b",
    );
  });

  it("rejects a mismatched external market without replacing its cache", async () => {
    const client = {
      fetchOfficialCatalog: vi.fn(async () => catalog()),
      fetchExternalIndex: vi
        .fn()
        .mockResolvedValueOnce(index("community"))
        .mockResolvedValueOnce(index("wrong")),
    };
    const service = new MarketService(client);
    const cached = await service.getIndex(1);

    await expect(service.getIndex(1, true)).rejects.toThrow(
      "market_id_mismatch",
    );
    await expect(service.getIndex(1)).resolves.toBe(cached);
  });
});
