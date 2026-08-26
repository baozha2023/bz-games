import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import crypto from "crypto";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { path7za } from "7zip-bin";

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  suspendForSnapshot: vi.fn(async () => undefined),
  resumeAfterSnapshot: vi.fn(),
  gameActive: false,
  importActive: false,
  marketActive: false,
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getVersion: () => "3.4.2",
    getPath: () => os.tmpdir(),
  },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}));
vi.mock("../game/GameManager", () => ({
  gameManager: { hasActiveOrLaunchingGames: () => mocks.gameActive },
}));
vi.mock("../game/GameImportTaskService", () => ({
  gameImportTaskService: { hasActiveTasks: () => mocks.importActive },
}));
vi.mock("../market/MarketService", () => ({
  marketService: {
    computeTotalProgress: () => ({
      activeTaskCount: mocks.marketActive ? 1 : 0,
    }),
  },
}));
vi.mock("../storage/database/BzGamesDatabase", () => ({
  bzGamesDatabase: {
    getDatabasePath: () => `${process.cwd()}/db/bz_games.db`,
    suspendForSnapshot: mocks.suspendForSnapshot,
    resumeAfterSnapshot: mocks.resumeAfterSnapshot,
  },
}));
vi.mock("../../window", () => ({ mainWindow: null }));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import {
  isMigrationDestinationUnsafe,
  isMigrationDestinationUnsafeOnDisk,
  MigrationExportService,
  scanMigrationTree,
} from "./MigrationExportService";

const tempDirectories: string[] = [];
const execFileAsync = promisify(execFile);

async function makeTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-migration-test-"),
  );
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  mocks.showSaveDialog.mockReset();
  mocks.suspendForSnapshot.mockClear();
  mocks.resumeAfterSnapshot.mockClear();
  mocks.gameActive = false;
  mocks.importActive = false;
  mocks.marketActive = false;
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("migration export filesystem contract", () => {
  it("keeps the deterministic v1 importer fixture valid", async () => {
    const fixturePath = path.resolve(
      "docs/fixtures/BZ-Games-Migration-v1-sample.bzgames",
    );
    const checksumLine = await fs.readFile(`${fixturePath}.sha256`, "utf8");
    const expectedChecksum = checksumLine.trim().split(/\s+/)[0];
    const actualChecksum = crypto
      .createHash("sha256")
      .update(await fs.readFile(fixturePath))
      .digest("hex");

    expect(actualChecksum).toBe(expectedChecksum);
    await expect(
      execFileAsync(path7za, ["t", fixturePath]),
    ).resolves.toBeDefined();
    const extractedRoot = await makeTempDirectory();
    await execFileAsync(path7za, [
      "x",
      "-y",
      `-o${extractedRoot}`,
      fixturePath,
    ]);
    expect((await fs.readdir(extractedRoot)).sort()).toEqual([
      "config.json",
      "db",
      "games",
      "migration-manifest.json",
    ]);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(extractedRoot, "migration-manifest.json"),
        "utf8",
      ),
    );
    const configStat = await fs.stat(path.join(extractedRoot, "config.json"));
    const [dbStats, gamesStats] = await Promise.all([
      scanMigrationTree(
        path.join(extractedRoot, "db"),
        new AbortController().signal,
      ),
      scanMigrationTree(
        path.join(extractedRoot, "games"),
        new AbortController().signal,
      ),
    ]);
    expect(manifest).toMatchObject({
      format: "bzgames-migration",
      formatVersion: 1,
      sourceAppVersion: "3.4.2",
      sourcePlatform: "win32",
      sourceArch: "x64",
      sourceAppRoot: "C:\\BZ-Games",
      sourceGamesRoot: "C:\\BZ-Games\\games",
      entries: ["config.json", "games", "db"],
      totalFiles: 1 + dbStats.files + gamesStats.files,
      totalBytes: configStat.size + dbStats.bytes + gamesStats.bytes,
    });
  });

  it("counts nested files and bytes while accepting empty directories", async () => {
    const root = await makeTempDirectory();
    await fs.mkdir(path.join(root, "中文目录", "empty"), { recursive: true });
    await fs.writeFile(path.join(root, "first.bin"), Buffer.alloc(7));
    await fs.writeFile(
      path.join(root, "中文目录", "second.bin"),
      Buffer.alloc(11),
    );

    await expect(
      scanMigrationTree(root, new AbortController().signal),
    ).resolves.toEqual({ files: 2, bytes: 18 });
  });

  it("rejects links instead of following data outside the migration root", async () => {
    const root = await makeTempDirectory();
    const outside = await makeTempDirectory();
    await fs.symlink(
      outside,
      path.join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      scanMigrationTree(root, new AbortController().signal),
    ).rejects.toMatchObject({ code: "unsafe_source_entry" });
  });

  it("stops scanning after cancellation", async () => {
    const root = await makeTempDirectory();
    const controller = new AbortController();
    controller.abort();

    await expect(
      scanMigrationTree(root, controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("rejects destinations anywhere under the application root", () => {
    const appRoot = path.resolve("D:/BZ-Games");
    expect(
      isMigrationDestinationUnsafe(
        appRoot,
        path.join(appRoot, "backup", "data.bzgames"),
      ),
    ).toBe(true);
    expect(
      isMigrationDestinationUnsafe(
        appRoot,
        path.resolve("E:/Backup/data.bzgames"),
      ),
    ).toBe(false);
  });

  it("rejects an outside path that resolves into the application through a link", async () => {
    const appRoot = await makeTempDirectory();
    const outside = await makeTempDirectory();
    const linkedRoot = path.join(outside, "linked-app-root");
    await fs.symlink(
      appRoot,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      isMigrationDestinationUnsafeOnDisk(
        appRoot,
        path.join(linkedRoot, "backup.bzgames"),
      ),
    ).resolves.toBe(true);
    await expect(
      isMigrationDestinationUnsafeOnDisk(
        appRoot,
        path.join(outside, "backup.bzgames"),
      ),
    ).resolves.toBe(false);
  });

  it("allows only one export request while the save dialog is open", async () => {
    let resolveDialog!: (value: { canceled: boolean }) => void;
    mocks.showSaveDialog.mockReturnValue(
      new Promise((resolve) => {
        resolveDialog = resolve;
      }),
    );
    const service = new MigrationExportService();
    const first = service.exportBundle();

    const duplicate = await service.exportBundle();
    expect(duplicate).toMatchObject({
      success: false,
      state: { errorCode: "export_in_progress" },
    });
    expect(service.getState().status).toBe("idle");

    resolveDialog({ canceled: true });
    await expect(first).resolves.toMatchObject({
      success: false,
      canceled: true,
    });
  });

  it.each([
    ["game_running", "gameActive"],
    ["market_task_active", "marketActive"],
    ["import_task_active", "importActive"],
  ] as const)(
    "rejects export with %s before opening the save dialog",
    async (errorCode, activeFlag) => {
      mocks[activeFlag] = true;

      await expect(
        new MigrationExportService().exportBundle(),
      ).resolves.toMatchObject({
        success: false,
        state: { errorCode },
      });
      expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    },
  );

  it("rejects an existing destination that is not a regular file", async () => {
    const destinationRoot = await makeTempDirectory();
    const outputPath = path.join(destinationRoot, "backup.bzgames");
    await fs.mkdir(outputPath);
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: outputPath,
    });

    await expect(
      new MigrationExportService().exportBundle(),
    ).resolves.toMatchObject({
      success: false,
      state: { errorCode: "unsafe_destination" },
    });
    expect(mocks.suspendForSnapshot).not.toHaveBeenCalled();
  });

  it("creates a testable 7z container with the .bzgames root contract", async () => {
    const root = await makeTempDirectory();
    const payload = path.join(root, "payload");
    const archive = path.join(root, "fixture.bzgames");
    await fs.mkdir(path.join(payload, "games", "demo"), { recursive: true });
    await fs.mkdir(path.join(payload, "db"), { recursive: true });
    await fs.writeFile(path.join(payload, "config.json"), "config");
    await fs.writeFile(path.join(payload, "games", "demo", "game.bin"), "game");
    await fs.writeFile(path.join(payload, "db", "bz_games.db"), "database");
    await fs.writeFile(
      path.join(payload, "migration-manifest.json"),
      JSON.stringify({
        format: "bzgames-migration",
        formatVersion: 1,
        entries: ["config.json", "games", "db"],
      }),
    );

    await execFileAsync(
      path7za,
      [
        "a",
        "-t7z",
        "-mx=0",
        archive,
        "migration-manifest.json",
        "config.json",
        "games",
        "db",
      ],
      { cwd: payload },
    );
    await expect(execFileAsync(path7za, ["t", archive])).resolves.toBeDefined();
    const listing = await execFileAsync(path7za, ["l", "-slt", archive]);
    expect(listing.stdout).toContain("Path = migration-manifest.json");
    expect(listing.stdout).toContain("Path = config.json");
    expect(listing.stdout).toContain(
      `Path = games${path.sep}demo${path.sep}game.bin`,
    );
    expect(listing.stdout).toContain(`Path = db${path.sep}bz_games.db`);
  });

  it("rejects a database path that is not a regular file", async () => {
    const originalCwd = process.cwd();
    const sourceRoot = await makeTempDirectory();
    const destinationRoot = await makeTempDirectory();
    try {
      process.chdir(sourceRoot);
      await fs.mkdir(path.join(sourceRoot, "db", "bz_games.db"), {
        recursive: true,
      });
      await fs.writeFile(path.join(sourceRoot, "config.json"), "config");
      mocks.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: path.join(destinationRoot, "invalid-db.bzgames"),
      });

      await expect(
        new MigrationExportService().exportBundle(),
      ).resolves.toMatchObject({
        success: false,
        state: { errorCode: "unsafe_source_entry" },
      });
      expect(mocks.suspendForSnapshot).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("exports the complete bundle without deleting or changing source data", async () => {
    const originalCwd = process.cwd();
    const sourceRoot = await makeTempDirectory();
    const destinationRoot = await makeTempDirectory();
    const outputPath = path.join(destinationRoot, "backup.bzgames");
    try {
      process.chdir(sourceRoot);
      await fs.mkdir(path.join(sourceRoot, "games", "demo"), {
        recursive: true,
      });
      await fs.mkdir(path.join(sourceRoot, "db"), { recursive: true });
      const sourceFiles = {
        config: Buffer.from("encrypted-config"),
        game: Buffer.from("game-payload"),
        database: Buffer.from("encrypted-database"),
      };
      await fs.writeFile(
        path.join(sourceRoot, "config.json"),
        sourceFiles.config,
      );
      await fs.writeFile(
        path.join(sourceRoot, "games", "demo", "game.bin"),
        sourceFiles.game,
      );
      await fs.writeFile(
        path.join(sourceRoot, "db", "bz_games.db"),
        sourceFiles.database,
      );
      await fs.writeFile(outputPath, "previous-valid-backup-placeholder");
      mocks.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: outputPath,
      });

      const result = await new MigrationExportService().exportBundle();

      expect(result.success).toBe(true);
      expect(await fs.readFile(path.join(sourceRoot, "config.json"))).toEqual(
        sourceFiles.config,
      );
      expect(
        await fs.readFile(path.join(sourceRoot, "games", "demo", "game.bin")),
      ).toEqual(sourceFiles.game);
      expect(
        await fs.readFile(path.join(sourceRoot, "db", "bz_games.db")),
      ).toEqual(sourceFiles.database);
      expect(mocks.suspendForSnapshot).toHaveBeenCalledOnce();
      expect(mocks.resumeAfterSnapshot).toHaveBeenCalledOnce();
      await expect(
        execFileAsync(path7za, ["t", outputPath]),
      ).resolves.toBeDefined();
      expect(
        (await fs.readdir(destinationRoot)).some((name) =>
          name.includes(".previous-"),
        ),
      ).toBe(false);
      const listing = await execFileAsync(path7za, ["l", "-slt", outputPath]);
      expect(listing.stdout).toContain("Path = migration-manifest.json");
      expect(listing.stdout).toContain("Path = config.json");
      expect(listing.stdout).toContain(
        `Path = games${path.sep}demo${path.sep}game.bin`,
      );
      expect(listing.stdout).toContain(`Path = db${path.sep}bz_games.db`);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("exports a missing source games directory as an empty archive directory", async () => {
    const originalCwd = process.cwd();
    const sourceRoot = await makeTempDirectory();
    const destinationRoot = await makeTempDirectory();
    const outputPath = path.join(destinationRoot, "empty-games.bzgames");
    try {
      process.chdir(sourceRoot);
      await fs.mkdir(path.join(sourceRoot, "db"), { recursive: true });
      await fs.writeFile(path.join(sourceRoot, "config.json"), "config");
      await fs.writeFile(
        path.join(sourceRoot, "db", "bz_games.db"),
        "database",
      );
      mocks.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: outputPath,
      });

      const result = await new MigrationExportService().exportBundle();

      expect(result.success).toBe(true);
      await expect(
        fs.access(path.join(sourceRoot, "games")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      const listing = await execFileAsync(path7za, ["l", "-slt", outputPath]);
      expect(listing.stdout).toMatch(
        /Path = games[\s\S]*?Attributes = D(?:\r?\n|$)/,
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("waits for the archiver to stop and removes partial output on cancel", async () => {
    const originalCwd = process.cwd();
    const sourceRoot = await makeTempDirectory();
    const destinationRoot = await makeTempDirectory();
    const outputPath = path.join(destinationRoot, "canceled.bzgames");
    try {
      process.chdir(sourceRoot);
      await fs.mkdir(path.join(sourceRoot, "games"), { recursive: true });
      await fs.mkdir(path.join(sourceRoot, "db"), { recursive: true });
      await fs.writeFile(path.join(sourceRoot, "config.json"), "config");
      await fs.writeFile(
        path.join(sourceRoot, "db", "bz_games.db"),
        "database",
      );
      const largeGamePath = path.join(sourceRoot, "games", "large.bin");
      await fs.writeFile(largeGamePath, "");
      await fs.truncate(largeGamePath, 64 << 20);
      mocks.showSaveDialog.mockResolvedValue({
        canceled: false,
        filePath: outputPath,
      });
      const service = new MigrationExportService();
      const exportPromise = service.exportBundle();
      const deadline = Date.now() + 5_000;
      while (
        !(service as unknown as { activeProcess: unknown }).activeProcess &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      expect(
        (service as unknown as { activeProcess: unknown }).activeProcess,
      ).toBeTruthy();
      expect(service.cancel()).toBe(true);
      await expect(exportPromise).resolves.toMatchObject({
        success: false,
        canceled: true,
      });
      expect(
        (service as unknown as { activeProcess: unknown }).activeProcess,
      ).toBeNull();
      expect(await fs.readdir(destinationRoot)).toEqual([]);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
