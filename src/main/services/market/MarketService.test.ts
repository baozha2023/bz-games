import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
vi.mock("../storage/StoreService", () => ({
  storeService: { getSettings: () => ({ language: "zh-CN" }) },
}));
vi.mock("./HostedGameUrl", () => ({
  resolveMarketDownloadUrl: (url: string) => url,
  resolveMarketImageUrl: (url: string) => url,
}));
vi.mock("../../../shared/AppConstants", () => ({
  BZ_GAMES_DB_FILE_NAME: "db/bz_games.db",
  CONFIG_ENCRYPTION_SEED: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  DATABASE_ENCRYPTION_SEED: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  GAME_MANIFEST_ENCRYPTION_SEED: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  GITHUB_API_BASE: "https://api.github.com/",
  GITHUB_RAW_BASE: "https://raw.githubusercontent.com/",
  MARKET_GITHUB_INDEX_URL: "https://github.test/market.json",
  MARKET_OSS_INDEX_URL: "https://oss.test/market.json",
}));

import { MarketService } from "./MarketService";
import { logger } from "../../utils/logger";
import {
  resolveGameManifest,
  type GameManifest,
} from "../../../shared/game-manifest";
import { GameType } from "../../../shared/types";
import type {
  MarketDirectory,
  MarketSource,
  MarketTaskState,
  MarketTaskStatus,
  RawMarketIndex,
  RawMarketGame,
  RawMarketGameVersion,
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

function index(marketId: string): RawMarketIndex {
  return {
    schemaVersion: 2,
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
    schemaVersion: 2,
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
    marketId: "official",
  };
}

interface MarketServiceTestAccess {
  buildManifestFromMarket(
    game: RawMarketGame,
    targetVersion: RawMarketGameVersion,
    importDir: string,
  ): GameManifest;
  prepareManifestForInstall(
    game: RawMarketGame,
    targetVersion: RawMarketGameVersion,
    importDir: string,
  ): Promise<GameManifest>;
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
  finalize(taskId: string, removeTaskImmediately?: boolean): Promise<void>;
}

function accessInternals(service: MarketService): MarketServiceTestAccess {
  return service as unknown as MarketServiceTestAccess;
}

describe("MarketService catalog cache", () => {
  it("preflights external sources without depending on directory order", async () => {
    const reordered = catalog();
    reordered.directory.sources.reverse();
    const client = {
      fetchOfficialCatalog: vi.fn(async () => reordered),
      fetchExternalIndex: vi.fn(async () => index("community")),
    };
    const service = new MarketService(client);

    await expect(service.getSources()).resolves.toEqual(reordered.directory);
    expect(client.fetchExternalIndex).toHaveBeenCalledOnce();
    expect(client.fetchExternalIndex).toHaveBeenCalledWith(
      expect.objectContaining({ marketId: "community" }),
    );
  });

  it("coalesces concurrent official directory and index requests", async () => {
    const pending = deferred<OfficialMarketCatalog>();
    const client = {
      fetchOfficialCatalog: vi.fn(() => pending.promise),
      fetchExternalIndex: vi.fn(),
    };
    const service = new MarketService(client);

    const sourcesPromise = service.getSources();
    const indexPromise = service.getIndex("official");
    pending.resolve(catalog());

    await expect(sourcesPromise).resolves.toMatchObject({
      schemaVersion: 2,
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
    await expect(service.getSources()).resolves.toEqual(firstCatalog.directory);
    expect(client.fetchOfficialCatalog).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent requests for the same external source", async () => {
    const pending = deferred<RawMarketIndex>();
    const client = {
      fetchOfficialCatalog: vi.fn(async () => catalog()),
      fetchExternalIndex: vi.fn(() => pending.promise),
    };
    const service = new MarketService(client);

    const first = service.getIndex("community");
    const second = service.getIndex("community");
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

    await service.getIndex("community");
    await service.getIndex("community", true);

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
    const cached = await service.getIndex("community");

    await expect(service.getIndex("community", true)).rejects.toThrow(
      "market_catalog_business",
    );
    await expect(service.getIndex("community")).resolves.toEqual(cached);
  });
});

describe("MarketService Manifest conversion", () => {
  function rawGame(targetVersion: RawMarketGameVersion): RawMarketGame {
    return {
      id: "com.example.market-game",
      defaultLocale: "zh-CN",
      localizations: {
        "zh-CN": { name: "市场游戏", summary: "中文简介", tags: [] },
        "en-US": { name: "Market Game", summary: "English summary", tags: [] },
      },
      author: "Example",
      type: GameType.Singleplayer,
      latestVersion: targetVersion.version,
      versions: [targetVersion],
    };
  }

  it("generates a V1 manifest for a V1 override", () => {
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const targetVersion: RawMarketGameVersion = {
      version: "1.0.0",
      platformVersion: ">=1.0.0",
      downloadUrl: "https://example.com/game.zip",
      localizations: {
        "zh-CN": { description: "网页游戏" },
        "en-US": { description: "Web game" },
      },
      gameManifest: {
        entry: "url",
        web_url: "https://example.com/game",
        windowedFullscreen: true,
      },
    };
    const game = rawGame(targetVersion);

    const manifest = accessInternals(service).buildManifestFromMarket(
      game,
      targetVersion,
      "C:/tmp/game",
    );

    expect(manifest.windowedFullscreen).toBe(true);
    expect("manifestVersion" in manifest).toBe(false);
    expect("name" in manifest && manifest.name).toBe("市场游戏");
  });

  it("injects every market localization into a V2 override", () => {
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const targetVersion: RawMarketGameVersion = {
      version: "1.0.0",
      platformVersion: ">=1.0.0",
      downloadUrl: "https://example.com/game.zip",
      localizations: {
        "zh-CN": { description: "网页游戏" },
        "en-US": { description: "Web game" },
      },
      gameManifest: {
        manifestVersion: 2,
        entry: "url",
        web_url: "https://example.com/game",
        windowedFullscreen: true,
        statistics: [{ id: "score", mode: "full" }],
        achievements: [{ id: "first", icon: "first.png" }],
        localizations: {
          "zh-CN": {
            statistics: { score: "得分" },
            achievements: {
              first: { title: "第一次", description: "完成第一次操作" },
            },
          },
          "en-US": {
            statistics: { score: "Score" },
            achievements: {
              first: {
                title: "First",
                description: "Complete the first action",
              },
            },
          },
        },
      },
    };
    const manifest = accessInternals(service).buildManifestFromMarket(
      rawGame(targetVersion),
      targetVersion,
      "C:/tmp/game",
    );
    expect(manifest).toMatchObject({
      manifestVersion: 2,
      defaultLocale: "zh-CN",
      localizations: {
        "zh-CN": { name: "市场游戏", description: "中文简介" },
        "en-US": { name: "Market Game", description: "English summary" },
      },
      statistics: [{ id: "score", mode: "full" }],
      achievements: [{ id: "first", icon: "first.png" }],
    });
    expect(resolveGameManifest(manifest, "en-US")).toMatchObject({
      name: "Market Game",
      description: "English summary",
      statistics: [{ score: { label: "Score", mode: "full" } }],
      achievements: [
        {
          id: "first",
          title: "First",
          description: "Complete the first action",
        },
      ],
    });
  });

  it("deletes a packaged game.json and creates the override version from scratch", async () => {
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const importDir = await mkdtemp(path.join(os.tmpdir(), "bz-market-"));
    const targetVersion: RawMarketGameVersion = {
      version: "1.0.0",
      platformVersion: ">=1.0.0",
      downloadUrl: "https://example.com/game.zip",
      localizations: {
        "zh-CN": { description: "网页游戏" },
        "en-US": { description: "Web game" },
      },
      gameManifest: {
        manifestVersion: 2,
        entry: "url",
        web_url: "https://example.com/game",
      },
    };
    await writeFile(
      path.join(importDir, "game.json"),
      JSON.stringify({ legacyOnly: true }),
      "utf8",
    );

    try {
      const manifest = await accessInternals(service).prepareManifestForInstall(
        rawGame(targetVersion),
        targetVersion,
        importDir,
      );
      const written = JSON.parse(
        await readFile(path.join(importDir, "game.json"), "utf8"),
      );
      expect("manifestVersion" in manifest && manifest.manifestVersion).toBe(2);
      expect(written).toEqual(manifest);
      expect(written).not.toHaveProperty("legacyOnly");
    } finally {
      await rm(importDir, { recursive: true, force: true });
    }
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

    internals.transition("top.bzgames.test@1.0.0", "installing", {
      progress: 95,
    });
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

  it("does not let a completed task timer delete a newer retry", async () => {
    vi.useFakeTimers();
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const internals = accessInternals(service);
    const taskId = "top.bzgames.test@1.0.0";

    internals.startTask(taskId, taskMeta());
    internals.transition(taskId, "installing", { progress: 95 });
    internals.transition(taskId, "completed", { progress: 100 });
    await internals.finalize(taskId);
    const retry = internals.startTask(taskId, taskMeta());

    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.getTaskState(taskId)).toBe(retry);
  });

  it("rejects and logs an illegal status transition without applying extras", () => {
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const internals = accessInternals(service);
    const taskId = "top.bzgames.test@1.0.0";

    internals.startTask(taskId, taskMeta());
    const result = internals.transition(taskId, "completed", {
      progress: 100,
    });

    expect(result).toBeNull();
    expect(service.getTaskState(taskId)).toMatchObject({
      status: "idle",
      progress: 0,
    });
    expect(logger.error).toHaveBeenCalledWith(
      "[MarketService] Rejected illegal task transition",
      { taskId, current: "idle", next: "completed" },
    );
  });

  it("does not let an old pipeline overwrite a paused task", () => {
    const service = new MarketService({
      fetchOfficialCatalog: vi.fn(),
      fetchExternalIndex: vi.fn(),
    });
    const internals = accessInternals(service);
    const taskId = "top.bzgames.test@1.0.0";

    internals.startTask(taskId, taskMeta());
    internals.transition(taskId, "downloading");
    internals.transition(taskId, "paused");
    const result = internals.transition(taskId, "verifying");

    expect(result).toBeNull();
    expect(service.getTaskState(taskId)?.status).toBe("paused");
    expect(logger.error).toHaveBeenCalledWith(
      "[MarketService] Rejected illegal task transition",
      { taskId, current: "paused", next: "verifying" },
    );
  });
});
