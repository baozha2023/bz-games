import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { GameRecord } from "../../../shared/types";
import type { StoreService as StoreServiceType } from "./StoreService";
import type { GameLibraryRecord } from "./database/BzGamesDatabase";

type MigrationInternals = {
  ensureStorageDirectoryEmpty(targetPath: string): void;
  copyStorageDirectoryWithRetry(
    sourcePath: string,
    targetPath: string,
  ): Promise<void>;
  copyPath(
    sourcePath: string,
    targetPath: string,
    options: Parameters<typeof fs.cp>[2],
  ): Promise<void>;
  updateLibraryRootWithRetry(
    libraryId: string,
    rootPath: string,
    expectedVersionCount: number,
  ): Promise<void>;
};

describe("StoreService game library migration filesystem", () => {
  let StoreService: (typeof import("./StoreService"))["StoreService"];
  let temporaryRoot: string;
  let sourcePath: string;
  let targetPath: string;
  let service: StoreServiceType;
  let internals: MigrationInternals;
  let database: (typeof import("./database/BzGamesDatabase"))["bzGamesDatabase"];

  beforeAll(async () => {
    vi.doMock("electron", () => ({
      app: {
        isPackaged: false,
        getPath: () => process.cwd(),
        on: vi.fn(),
      },
    }));
    const constants = [
      "__BZ_CDN_BASE__",
      "__BZ_OSS_BASE__",
      "__BZ_MARKET_OSS_INDEX_URL__",
      "__BZ_REFERER__",
      "__BZ_RELAY_SERVER_URL__",
      "__BZ_RELAY_PUBLIC_HOST__",
      "__BZ_RELAY_TOKEN__",
      "__BZ_CONFIG_ENCRYPTION_SEED__",
      "__BZ_DATABASE_ENCRYPTION_SEED__",
      "__BZ_GAME_MANIFEST_ENCRYPTION_SEED__",
      "__BZ_OAUTH_RETURN_URL__",
    ];
    for (const constant of constants) vi.stubGlobal(constant, "test");
    ({ StoreService } = await import("./StoreService"));
    ({ bzGamesDatabase: database } =
      await import("./database/BzGamesDatabase"));
  });

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "bz-storage-migration-"),
    );
    sourcePath = path.join(temporaryRoot, "source");
    targetPath = path.join(temporaryRoot, "target");
    await fs.mkdir(path.join(sourcePath, "game-a", "1.0.0"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(sourcePath, "game-a", "1.0.0", "game.json"),
      "manifest",
    );
    await fs.mkdir(targetPath);
    service = new StoreService();
    internals = service as unknown as MigrationInternals;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  it("rejects a non-empty target before migration", async () => {
    await fs.writeFile(path.join(targetPath, "user-file.txt"), "keep");

    expect(() => internals.ensureStorageDirectoryEmpty(targetPath)).toThrow(
      "directory_not_empty",
    );
    await expect(
      fs.readFile(path.join(targetPath, "user-file.txt"), "utf8"),
    ).resolves.toBe("keep");
  });

  it("retries copying and keeps the source until later commit stages", async () => {
    const realCopy = internals.copyPath.bind(service);
    let attempts = 0;
    vi.spyOn(internals, "copyPath").mockImplementation(async (...args) => {
      attempts += 1;
      if (attempts < 3) {
        await fs.writeFile(
          path.join(targetPath, `partial-${attempts}.tmp`),
          "partial",
        );
        const error = new Error("busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      await realCopy(...args);
    });

    await internals.copyStorageDirectoryWithRetry(sourcePath, targetPath);

    expect(attempts).toBe(3);
    await expect(
      fs.readFile(
        path.join(targetPath, "game-a", "1.0.0", "game.json"),
        "utf8",
      ),
    ).resolves.toBe("manifest");
    await expect(
      fs.readFile(
        path.join(sourcePath, "game-a", "1.0.0", "game.json"),
        "utf8",
      ),
    ).resolves.toBe("manifest");
    await expect(fs.readdir(targetPath)).resolves.not.toContain(
      "partial-1.tmp",
    );
    await expect(fs.readdir(targetPath)).resolves.not.toContain(
      "partial-2.tmp",
    );
  });

  it("clears all partial target data after copy retries are exhausted", async () => {
    let attempts = 0;
    vi.spyOn(internals, "copyPath").mockImplementation(async () => {
      attempts += 1;
      await fs.writeFile(
        path.join(targetPath, `partial-${attempts}.tmp`),
        "partial",
      );
      throw new Error("copy failed");
    });

    await expect(
      internals.copyStorageDirectoryWithRetry(sourcePath, targetPath),
    ).rejects.toThrow("storage_migration_copy_failed");

    expect(attempts).toBe(3);
    await expect(fs.readdir(targetPath)).resolves.toEqual([]);
    await expect(
      fs.readFile(
        path.join(sourcePath, "game-a", "1.0.0", "game.json"),
        "utf8",
      ),
    ).resolves.toBe("manifest");
  });

  it("retries the database commit and verifies stable library references", async () => {
    let updateAttempts = 0;
    vi.spyOn(database, "updateExternalGameLibrary").mockImplementation(
      async () => {
        updateAttempts += 1;
        if (updateAttempts < 3) throw new Error("database busy");
      },
    );
    vi.spyOn(database, "getGameLibraries").mockResolvedValue([
      {
        id: "library-1",
        kind: "external",
        root_path: targetPath,
        normalized_root: targetPath.toLocaleLowerCase("en-US"),
        display_name: "target",
        is_default: 0,
        created_at: 1,
      },
    ]);
    vi.spyOn(database, "get").mockResolvedValue({ count: 4 });
    vi.spyOn(service, "refreshGameDerivedData").mockResolvedValue();

    await internals.updateLibraryRootWithRetry("library-1", targetPath, 4);

    expect(updateAttempts).toBe(3);
    expect(database.get).toHaveBeenCalledWith(
      "SELECT COUNT(*) AS count FROM game_versions WHERE library_id = ?",
      ["library-1"],
    );
    expect(service.refreshGameDerivedData).toHaveBeenCalledOnce();
  });

  it("moves a library by updating its root while version locations stay relative", async () => {
    let committedRoot = sourcePath;
    const library = (): GameLibraryRecord => ({
      id: "library-1",
      kind: "external",
      root_path: committedRoot,
      normalized_root: committedRoot.toLocaleLowerCase("en-US"),
      display_name: path.basename(committedRoot),
      is_default: 1,
      created_at: 1,
    });
    const game: GameRecord = {
      id: "game-a",
      latestVersion: "1.0.0",
      addedAt: 1,
      versions: [
        {
          version: "1.0.0",
          libraryId: "library-1",
          relativePath: "game-a/1.0.0",
          addedAt: 1,
          installSource: "manual",
          marketId: null,
          stats: {},
          unlockedAchievements: [],
          playtime: 0,
        },
      ],
    };
    const state = service as unknown as {
      gameLibrariesCache: GameLibraryRecord[];
      gamesCache: GameRecord[];
    };
    state.gameLibrariesCache = [library()];
    state.gamesCache = [game];

    vi.spyOn(database, "get").mockResolvedValue({
      count: 1,
      installed_count: 1,
      installed_game_count: 1,
    });
    vi.spyOn(database, "updateExternalGameLibrary").mockImplementation(
      async (_libraryId, rootPath) => {
        committedRoot = rootPath;
      },
    );
    vi.spyOn(database, "getGameLibraries").mockImplementation(async () => [
      library(),
    ]);
    vi.spyOn(service, "refreshGameDerivedData").mockImplementation(async () => {
      state.gameLibrariesCache = [library()];
    });

    const result = await service.migrateGameStorageLibrary(
      sourcePath,
      targetPath,
    );

    expect(result).toEqual({
      migratedGames: 1,
      migratedVersions: 1,
      gameStoragePath: targetPath,
    });
    expect(game.versions[0]).toMatchObject({
      libraryId: "library-1",
      relativePath: "game-a/1.0.0",
    });
    expect(service.resolveGameVersionPath(game.versions[0])).toBe(
      path.join(targetPath, "game-a", "1.0.0"),
    );
    await expect(fs.stat(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile(
        path.join(targetPath, "game-a", "1.0.0", "game.json"),
        "utf8",
      ),
    ).resolves.toBe("manifest");
  });

  it("restores quarantined game files when the database transaction fails", async () => {
    const game: GameRecord = {
      id: "game-a",
      latestVersion: "1.0.0",
      addedAt: 1,
      versions: [
        {
          version: "1.0.0",
          libraryId: "library-1",
          relativePath: "game-a/1.0.0",
          addedAt: 1,
          installSource: "manual",
          marketId: null,
          stats: {},
          unlockedAchievements: [],
          playtime: 0,
        },
      ],
    };
    const state = service as unknown as {
      gameLibrariesCache: GameLibraryRecord[];
      gamesCache: GameRecord[];
    };
    state.gameLibrariesCache = [
      {
        id: "library-1",
        kind: "external",
        root_path: sourcePath,
        normalized_root: sourcePath.toLocaleLowerCase("en-US"),
        display_name: "source",
        is_default: 0,
        created_at: 1,
      },
    ];
    state.gamesCache = [game];
    vi.spyOn(database, "softDelete").mockRejectedValue(
      new Error("database busy"),
    );

    await expect(service.removeGame("game-a")).rejects.toThrow(
      "game_delete_database_failed",
    );
    await expect(
      fs.readFile(
        path.join(sourcePath, "game-a", "1.0.0", "game.json"),
        "utf8",
      ),
    ).resolves.toBe("manifest");
    await expect(
      fs.stat(path.join(sourcePath, ".bz-games-trash")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
