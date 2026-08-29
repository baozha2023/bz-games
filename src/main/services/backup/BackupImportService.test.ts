import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  dataRoot: "",
  suspendForSnapshot: vi.fn(async () => undefined),
  resumeAfterSnapshot: vi.fn(),
  initialize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  guardEnd: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock("../../../shared/AppConstants", () => ({
  BZ_GAMES_DB_FILE_NAME: "bz_games.db",
}));
vi.mock("../../utils/appPath", () => ({
  getAppRoot: () => mocks.dataRoot,
}));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../window", () => ({ mainWindow: null }));
vi.mock("../game/GameManager", () => ({
  gameManager: { hasActiveOrLaunchingGames: () => false },
}));
vi.mock("../game/GameImportTaskService", () => ({
  gameImportTaskService: { hasActiveTasks: () => false },
}));
vi.mock("../market/MarketService", () => ({
  marketService: { computeTotalProgress: () => ({ activeTaskCount: 0 }) },
}));
vi.mock("../storage/database/BzGamesDatabase", () => ({
  bzGamesDatabase: {
    suspendForSnapshot: mocks.suspendForSnapshot,
    resumeAfterSnapshot: mocks.resumeAfterSnapshot,
    initialize: mocks.initialize,
    close: mocks.close,
  },
}));
vi.mock("./BackupActivityGuard", () => ({
  backupActivityGuard: {
    isActive: () => false,
    tryBegin: () => true,
    end: mocks.guardEnd,
  },
}));
vi.mock("../system/LifecycleOperationGuard", () => ({
  lifecycleOperationGuard: { blocksNewActivity: () => false },
}));
vi.mock("./v1/V1ImportAdapter", () => ({
  V1_ARCHIVE_MANIFEST: "migration-manifest.json",
  encryptExternalV1ManifestsWithRollback: vi.fn(),
  restoreExternalV1Manifests: vi.fn(),
  tryPrepareV1Import: vi.fn(),
}));
vi.mock("./V4DataValidator", () => ({
  validateV4DataRoot: vi.fn(async () => undefined),
}));

import { BackupImportService } from "./BackupImportService";

const tempDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bz-import-test-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  mocks.suspendForSnapshot.mockClear();
  mocks.resumeAfterSnapshot.mockClear();
  mocks.initialize.mockClear();
  mocks.close.mockClear();
  mocks.guardEnd.mockClear();
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("V2 backup replacement rollback", () => {
  it("does not move untouched originals when the backup phase fails midway", async () => {
    mocks.dataRoot = await tempDirectory();
    const workRoot = await tempDirectory();
    const convertedRoot = path.join(workRoot, "converted");
    for (const root of [mocks.dataRoot, convertedRoot]) {
      await fs.mkdir(path.join(root, "games"), { recursive: true });
      await fs.mkdir(path.join(root, "db"), { recursive: true });
    }
    await fs.writeFile(path.join(mocks.dataRoot, "config.json"), "old-config");
    await fs.writeFile(path.join(mocks.dataRoot, "games", "old"), "old-game");
    await fs.writeFile(path.join(mocks.dataRoot, "db", "old"), "old-db");
    await fs.writeFile(path.join(convertedRoot, "config.json"), "new-config");
    await fs.writeFile(path.join(convertedRoot, "games", "new"), "new-game");
    await fs.writeFile(path.join(convertedRoot, "db", "new"), "new-db");

    const realRename = fs.rename.bind(fs);
    let injected = false;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (
        !injected &&
        path.resolve(String(from)) === path.join(mocks.dataRoot, "games") &&
        String(to).includes(".backup-rollback")
      ) {
        injected = true;
        throw Object.assign(new Error("simulated_backup_failure"), {
          code: "EACCES",
        });
      }
      return realRename(from, to);
    });

    const service = new BackupImportService();
    (service as unknown as { pending: unknown }).pending = {
      token: "test-token",
      archivePath: path.join(workRoot, "backup.bzgames"),
      workRoot,
      convertedRoot,
      preview: {
        token: "test-token",
        formatVersion: 2,
        dataModelVersion: 4,
        sourceAppVersion: "4.0.0",
        exportedAt: "2026-08-29T00:00:00.000Z",
        totalFiles: 3,
        totalBytes: 30,
        externalLibraryCount: 0,
      },
    };

    await expect(service.confirmImport("test-token")).resolves.toMatchObject({
      success: false,
      state: { errorCode: "replacement_failed" },
    });
    await expect(
      fs.readFile(path.join(mocks.dataRoot, "config.json"), "utf8"),
    ).resolves.toBe("old-config");
    await expect(
      fs.readFile(path.join(mocks.dataRoot, "games", "old"), "utf8"),
    ).resolves.toBe("old-game");
    await expect(
      fs.readFile(path.join(mocks.dataRoot, "db", "old"), "utf8"),
    ).resolves.toBe("old-db");
    expect(mocks.resumeAfterSnapshot).toHaveBeenCalledOnce();
    expect(mocks.initialize).toHaveBeenCalledOnce();
  });
});
