import { afterEach, describe, expect, it, vi } from "vitest";

const windowMocks = vi.hoisted(() => {
  let floatBallVisible = false;
  const mainSend = vi.fn();
  const floatBallSend = vi.fn();

  return {
    mainSend,
    floatBallSend,
    mainWindow: {
      isDestroyed: vi.fn(() => false),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: mainSend,
      },
    },
    floatBallWindow: {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => floatBallVisible),
      showInactive: vi.fn(() => {
        floatBallVisible = true;
      }),
      hide: vi.fn(() => {
        floatBallVisible = false;
      }),
      webContents: {
        isDestroyed: vi.fn(() => false),
        send: floatBallSend,
      },
    },
    reset: () => {
      floatBallVisible = false;
    },
  };
});

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
  mainWindow: windowMocks.mainWindow,
  floatBallWindow: windowMocks.floatBallWindow,
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
import type { GameManifest } from "../../../shared/game-manifest";
import { GameType } from "../../../shared/types";
import type {
  MarketDirectory,
  MarketGame,
  MarketIndex,
  MarketGameVersion,
  MarketSource,
  MarketTaskState,
  MarketTaskStatus,
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
  windowMocks.reset();
});

function taskMeta() {
  return {
    gameId: "top.bzgames.test",
    version: "1.0.0",
    gameName: "Test Game",
    downloadUrl: "https://example.com/game.zip",
    catalogDownloadUrl: "https://example.com/game.zip",
    sha256: undefined,
    size: 1024,
    downloadPath: "C:/tmp/game.zip",
    archiveType: "zip",
    sourceIdx: 0,
    marketId: "official",
  };
}

interface MarketServiceTestAccess {
  buildManifestFromMarket(
    game: MarketGame,
    targetVersion: MarketGameVersion,
    importDir: string,
  ): GameManifest;
  startTask(
    taskId: string,
    meta: ReturnType<typeof taskMeta>,
    initial?: Partial<MarketTaskState>,
  ): MarketTaskState;
  transition(
    taskId: string,
    status: MarketTaskStatus,
    extra?: Partial<MarketTaskState>,
  ): MarketTaskState | null;
}

function accessInternals(service: MarketService): MarketServiceTestAccess {
  return service as unknown as MarketServiceTestAccess;
}

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

describe("MarketService Manifest conversion", () => {
  it("preserves Web windowed fullscreen configuration", () => {
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const targetVersion: MarketGameVersion = {
      version: "1.0.0",
      description: "Web game",
      platformVersion: ">=1.0.0",
      downloadUrl: "https://example.com/game.zip",
      gameManifest: {
        entry: "url",
        web_url: "https://example.com/game",
        windowedFullscreen: true,
      },
    };
    const game: MarketGame = {
      id: "com.example.market-game",
      name: "Market Game",
      author: "Example",
      type: GameType.Singleplayer,
      summary: "A market game",
      latestVersion: targetVersion.version,
      versions: [targetVersion],
    };

    const manifest = accessInternals(service).buildManifestFromMarket(
      game,
      targetVersion,
      "C:/tmp/game",
    );

    expect(manifest.windowedFullscreen).toBe(true);
  });
});

describe("MarketService progress events", () => {
  it("hides the float ball immediately when the final task completes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const internals = accessInternals(service);

    internals.startTask("top.bzgames.test@1.0.0", taskMeta());
    expect(windowMocks.floatBallWindow.showInactive).toHaveBeenCalledOnce();

    internals.transition("top.bzgames.test@1.0.0", "completed", {
      progress: 100,
    });

    expect(windowMocks.floatBallWindow.hide).toHaveBeenCalledOnce();
    expect(windowMocks.floatBallSend).toHaveBeenLastCalledWith(
      "market:floatBall:event",
      expect.objectContaining({ activeTaskCount: 0 }),
    );
  });

  it("coalesces high-frequency progress while retaining the trailing state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const internals = accessInternals(service);
    const taskId = "top.bzgames.test@1.0.0";

    internals.startTask(taskId, taskMeta());
    internals.transition(taskId, "downloading", { progress: 0 });
    for (let progress = 1; progress <= 20; progress++) {
      internals.transition(taskId, "downloading", { progress });
    }

    expect(windowMocks.mainSend).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(windowMocks.mainSend).toHaveBeenCalledTimes(3);
    expect(windowMocks.mainSend).toHaveBeenLastCalledWith(
      "market:event",
      expect.objectContaining({
        task: expect.objectContaining({ progress: 20 }),
      }),
    );
  });
});
