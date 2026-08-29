import { app, dialog } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { path7za } from "7zip-bin";
import { IPC } from "../../../shared/ipc-channels";
import type {
  BackupErrorCode,
  BackupResult,
  BackupState,
  BackupManifestV2,
} from "../../../shared/types";
import { gameManager } from "../game/GameManager";
import { gameImportTaskService } from "../game/GameImportTaskService";
import { marketService } from "../market/MarketService";
import { deserializeV4Config, serializeV4Config } from "../storage/ConfigCodec";
import { bzGamesDatabase } from "../storage/database/BzGamesDatabase";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { mainWindow } from "../../window";
import { backupActivityGuard } from "./BackupActivityGuard";
import { lifecycleOperationGuard } from "../system/LifecycleOperationGuard";

const DESTINATION_RESERVE_BYTES = 256 * 1024 * 1024;
const TEMP_RESERVE_BYTES = 64 * 1024 * 1024;

interface TreeStats {
  files: number;
  bytes: number;
}

class BackupExportError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function createPortableConfig(content: string): string {
  const data = deserializeV4Config(content);
  data.settings.accountSessionToken = "";
  data.settings.accountSessionExpiresAt = "";
  data.settings.accountUserLogin = "";
  data.settings.accountUserName = "";
  data.settings.accountUserProfileUrl = "";
  data.settings.githubToken = "";
  return serializeV4Config(data);
}

function abortError(): Error {
  return Object.assign(new Error("backup_export_canceled"), {
    name: "AbortError",
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function isBackupDestinationUnsafe(
  parent: string,
  candidate: string,
): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export async function isBackupDestinationUnsafeOnDisk(
  parent: string,
  candidate: string,
): Promise<boolean> {
  if (isBackupDestinationUnsafe(parent, candidate)) return true;
  try {
    const [realParent, realCandidateDirectory] = await Promise.all([
      fs.realpath(parent),
      fs.realpath(path.dirname(candidate)),
    ]);
    return isBackupDestinationUnsafe(
      realParent,
      path.join(realCandidateDirectory, path.basename(candidate)),
    );
  } catch {
    // Both directories must already exist at this point. Fail closed if their
    // canonical locations cannot be resolved.
    return true;
  }
}

export async function scanBackupTree(
  root: string,
  signal: AbortSignal,
): Promise<TreeStats> {
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw new BackupExportError(
      "unsafe_source_entry",
      `backup_source_link_unsupported:${root}`,
    );
  }
  if (!rootStat.isDirectory()) {
    throw new BackupExportError(
      "unsafe_source_entry",
      `backup_source_not_directory:${root}`,
    );
  }

  let files = 0;
  let bytes = 0;
  const directories = [root];
  while (directories.length > 0) {
    throwIfAborted(signal);
    const directory = directories.pop()!;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      throwIfAborted(signal);
      const entryPath = path.join(directory, entry.name);
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) {
        throw new BackupExportError(
          "unsafe_source_entry",
          `backup_source_link_unsupported:${entryPath}`,
        );
      }
      if (stat.isDirectory()) {
        directories.push(entryPath);
      } else if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
      } else {
        throw new BackupExportError(
          "unsafe_source_entry",
          `backup_source_entry_unsupported:${entryPath}`,
        );
      }
    }
  }
  return { files, bytes };
}

function get7zaPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "7za", "7za.exe")
    : path7za;
}

async function getFreeBytes(targetDirectory: string): Promise<number> {
  const stats = await fs.statfs(targetDirectory);
  return stats.bavail * stats.bsize;
}

async function ensureFreeSpace(
  directory: string,
  requiredBytes: number,
): Promise<void> {
  const freeBytes = await getFreeBytes(directory);
  if (freeBytes < requiredBytes) {
    throw new BackupExportError(
      "insufficient_space",
      `backup_insufficient_space:${requiredBytes}:${freeBytes}`,
    );
  }
}

async function replaceVerifiedFile(
  partialPath: string,
  outputPath: string,
): Promise<void> {
  // partialPath is created beside outputPath, so rename is a same-volume
  // atomic replacement. If it fails, the existing valid backup remains.
  await fs.rename(partialPath, outputPath);
}

export class BackupExportService {
  private state: BackupState = {
    status: "idle",
    progress: 0,
    processedBytes: 0,
    totalBytes: 0,
    processedFiles: 0,
    totalFiles: 0,
  };
  private controller: AbortController | null = null;
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private activeExport: Promise<BackupResult> | null = null;
  private exportRequestActive = false;

  getState(): BackupState {
    return { ...this.state };
  }

  async exportBundle(): Promise<BackupResult> {
    if (this.exportRequestActive) {
      return {
        success: false,
        state: {
          ...this.getState(),
          status: "error",
          errorCode: "backup_task_active",
        },
      };
    }
    this.exportRequestActive = true;
    try {
      return await this.handleExportRequest();
    } catch (error) {
      logger.error("[BackupExport] Export request failed", error);
      return this.failure("unknown");
    } finally {
      this.exportRequestActive = false;
    }
  }

  private async handleExportRequest(): Promise<BackupResult> {
    const busy = this.getBusyError();
    if (busy) return this.failure(busy.code);

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    const options = {
      title: "Export BZ-Games Backup",
      defaultPath: path.join(
        app.getPath("documents"),
        `BZ-Games-Backup-v${app.getVersion()}-${timestamp}.bzgames`,
      ),
      filters: [{ name: "BZ-Games Backup", extensions: ["bzgames"] }],
    };
    const selection = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) {
      return {
        success: false,
        canceled: true,
        state: this.setState({
          status: "canceled",
          progress: 0,
          processedBytes: 0,
          totalBytes: 0,
          processedFiles: 0,
          totalFiles: 0,
          outputPath: undefined,
          errorCode: undefined,
        }),
      };
    }

    const outputPath = selection.filePath.toLowerCase().endsWith(".bzgames")
      ? selection.filePath
      : `${selection.filePath}.bzgames`;
    if (await isBackupDestinationUnsafeOnDisk(getAppRoot(), outputPath)) {
      return this.failure("unsafe_destination");
    }
    const existingOutputStat = await fs.lstat(outputPath).catch(() => null);
    if (
      existingOutputStat &&
      (existingOutputStat.isSymbolicLink() || !existingOutputStat.isFile())
    ) {
      return this.failure("unsafe_destination");
    }
    if (
      lifecycleOperationGuard.blocksNewActivity() ||
      !backupActivityGuard.tryBegin()
    ) {
      return this.failure("backup_task_active");
    }

    const busyAfterLock = this.getBusyError();
    if (busyAfterLock) {
      backupActivityGuard.end();
      return this.failure(busyAfterLock.code);
    }

    this.controller = new AbortController();
    this.activeExport = this.performExport(outputPath, this.controller.signal);
    try {
      return await this.activeExport;
    } finally {
      this.activeExport = null;
      this.controller = null;
      this.activeProcess = null;
      backupActivityGuard.end();
    }
  }

  cancel(): boolean {
    if (!this.controller || this.controller.signal.aborted) return false;
    this.controller.abort();
    return true;
  }

  async shutdown(): Promise<void> {
    if (!this.activeExport) return;
    this.cancel();
    await this.activeExport.catch(() => undefined);
  }

  private async performExport(
    outputPath: string,
    signal: AbortSignal,
  ): Promise<BackupResult> {
    const appRoot = getAppRoot();
    const configPath = path.join(appRoot, "config.json");
    const gamesPath = path.join(appRoot, "games");
    const dbPath = path.join(appRoot, "db");
    const partialPath = `${outputPath}.partial-${crypto.randomUUID()}`;
    let stagingRoot = "";

    try {
      this.setState({
        status: "preparing",
        progress: 1,
        processedBytes: 0,
        totalBytes: 0,
        processedFiles: 0,
        totalFiles: 0,
        outputPath,
        errorCode: undefined,
      });
      throwIfAborted(signal);

      const databaseFilePath = bzGamesDatabase.getDatabasePath();
      const [configStat, dbStat, databaseFileStat, gamesStat] =
        await Promise.all([
          fs.lstat(configPath).catch(() => null),
          fs.lstat(dbPath).catch(() => null),
          fs.lstat(databaseFilePath).catch(() => null),
          fs.lstat(gamesPath).catch(() => null),
        ]);
      if (!configStat || !dbStat || !databaseFileStat) {
        throw new BackupExportError(
          "source_missing",
          "backup_required_source_missing",
        );
      }
      if (
        configStat.isSymbolicLink() ||
        dbStat.isSymbolicLink() ||
        databaseFileStat.isSymbolicLink() ||
        gamesStat?.isSymbolicLink() ||
        !configStat.isFile() ||
        !dbStat.isDirectory() ||
        !databaseFileStat.isFile() ||
        (gamesStat !== null && !gamesStat.isDirectory())
      ) {
        throw new BackupExportError(
          "unsafe_source_entry",
          "backup_database_source_invalid",
        );
      }

      const gamesExists = gamesStat !== null;
      const gamesStats = await (gamesExists
        ? scanBackupTree(gamesPath, signal)
        : Promise.resolve({ files: 0, bytes: 0 }));
      const estimatedBytes =
        configStat.size + databaseFileStat.size + gamesStats.bytes;
      const snapshotEstimateBytes = configStat.size + databaseFileStat.size;
      const outputDirectory = path.dirname(outputPath);
      const tempDirectory = os.tmpdir();
      const outputVolume = path.parse(path.resolve(outputDirectory)).root;
      const tempVolume = path.parse(path.resolve(tempDirectory)).root;
      if (outputVolume.toLowerCase() === tempVolume.toLowerCase()) {
        await ensureFreeSpace(
          outputDirectory,
          estimatedBytes +
            snapshotEstimateBytes +
            DESTINATION_RESERVE_BYTES +
            TEMP_RESERVE_BYTES,
        );
      } else {
        await ensureFreeSpace(
          outputDirectory,
          estimatedBytes + DESTINATION_RESERVE_BYTES,
        );
        await ensureFreeSpace(
          tempDirectory,
          snapshotEstimateBytes + TEMP_RESERVE_BYTES,
        );
      }
      throwIfAborted(signal);

      stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bzgames-export-"));
      await fs.mkdir(path.join(stagingRoot, "games"), { recursive: true });
      await fs.mkdir(path.join(stagingRoot, "db"), { recursive: true });
      await bzGamesDatabase.suspendForSnapshot();
      try {
        const portableConfig = createPortableConfig(
          await fs.readFile(configPath, "utf8"),
        );
        await fs.writeFile(
          path.join(stagingRoot, "config.json"),
          portableConfig,
          { encoding: "utf8", mode: 0o600 },
        );
        throwIfAborted(signal);
        await fs.copyFile(
          databaseFilePath,
          path.join(stagingRoot, "db", path.basename(databaseFilePath)),
        );
      } catch (error) {
        if ((error as Error)?.name === "AbortError") throw error;
        throw new BackupExportError(
          "database_snapshot_failed",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        bzGamesDatabase.resumeAfterSnapshot();
      }

      const snapshotConfigStat = await fs.stat(
        path.join(stagingRoot, "config.json"),
      );
      const snapshotDbStats = await scanBackupTree(
        path.join(stagingRoot, "db"),
        signal,
      );
      const totalFiles = 1 + snapshotDbStats.files + gamesStats.files;
      const totalBytes =
        snapshotConfigStat.size + snapshotDbStats.bytes + gamesStats.bytes;
      const externalLibraryCount = (
        await bzGamesDatabase.getGameLibraries()
      ).filter((library) => library.kind === "external").length;
      const manifest: BackupManifestV2 = {
        format: "bzgames-backup",
        formatVersion: 2,
        dataModelVersion: 4,
        exportedAt: new Date().toISOString(),
        sourceAppVersion: app.getVersion(),
        sourcePlatform: "win32",
        sourceArch: "x64",
        entries: ["config.json", "games", "db"],
        totalFiles,
        totalBytes,
        externalLibraryCount,
      };
      await fs.writeFile(
        path.join(stagingRoot, "backup-manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      this.setState({
        status: "archiving",
        progress: 10,
        totalBytes,
        totalFiles,
      });

      const snapshotBytes = snapshotConfigStat.size + snapshotDbStats.bytes;
      const snapshotWeight = totalBytes > 0 ? snapshotBytes / totalBytes : 1;
      await this.run7za(
        [
          "a",
          "-t7z",
          "-mx=0",
          "-bsp1",
          "-bb0",
          "-y",
          partialPath,
          "backup-manifest.json",
          "config.json",
          "db",
          "games",
        ],
        stagingRoot,
        signal,
        (percentage) => {
          const fraction = snapshotWeight * (percentage / 100);
          this.reportArchiveProgress(fraction, totalBytes, totalFiles);
        },
      );

      if (gamesExists && gamesStats.files > 0) {
        await this.run7za(
          ["a", "-t7z", "-mx=0", "-bsp1", "-bb0", "-y", partialPath, "games"],
          appRoot,
          signal,
          (percentage) => {
            const fraction =
              snapshotWeight + (1 - snapshotWeight) * (percentage / 100);
            this.reportArchiveProgress(fraction, totalBytes, totalFiles);
          },
        );
      }

      throwIfAborted(signal);
      this.setState({
        status: "verifying",
        progress: 96,
        processedBytes: totalBytes,
        processedFiles: totalFiles,
      });
      await this.run7za(
        ["t", "-bso0", "-bsp0", "-bb0", partialPath],
        appRoot,
        signal,
      );
      throwIfAborted(signal);
      await replaceVerifiedFile(partialPath, outputPath);
      const completed = this.setState({
        status: "completed",
        progress: 100,
        processedBytes: totalBytes,
        totalBytes,
        processedFiles: totalFiles,
        totalFiles,
        outputPath,
      });
      return { success: true, state: completed };
    } catch (error) {
      if ((error as Error)?.name === "AbortError" || signal.aborted) {
        const state = this.setState({
          status: "canceled",
          errorCode: undefined,
        });
        return { success: false, canceled: true, state };
      }
      const code = error instanceof BackupExportError ? error.code : "unknown";
      logger.error("[BackupExport] Export failed", error);
      return this.failure(code, true);
    } finally {
      await fs.rm(partialPath, { force: true }).catch(() => undefined);
      if (stagingRoot) {
        await fs
          .rm(stagingRoot, { recursive: true, force: true, maxRetries: 3 })
          .catch((error) =>
            logger.warn("[BackupExport] Failed to remove staging data", error),
          );
      }
    }
  }

  private getBusyError(): BackupExportError | null {
    if (gameManager.hasActiveOrLaunchingGames()) {
      return new BackupExportError("game_running", "backup_game_running");
    }
    if (marketService.computeTotalProgress().activeTaskCount > 0) {
      return new BackupExportError(
        "market_task_active",
        "backup_market_task_active",
      );
    }
    if (gameImportTaskService.hasActiveTasks()) {
      return new BackupExportError(
        "import_task_active",
        "backup_import_task_active",
      );
    }
    return null;
  }

  private reportArchiveProgress(
    fraction: number,
    totalBytes: number,
    totalFiles: number,
  ): void {
    const bounded = Math.max(0, Math.min(1, fraction));
    this.setState({
      status: "archiving",
      progress: Math.min(95, Math.round(10 + bounded * 85)),
      processedBytes: Math.round(totalBytes * bounded),
      totalBytes,
      processedFiles: Math.min(totalFiles, Math.round(totalFiles * bounded)),
      totalFiles,
    });
  }

  private run7za(
    args: string[],
    cwd: string,
    signal: AbortSignal,
    onPercentage?: (percentage: number) => void,
  ): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      let abortRequested = false;
      const child = spawn(get7zaPath(), args, { cwd });
      this.activeProcess = child;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (this.activeProcess === child) this.activeProcess = null;
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => {
        abortRequested = true;
        try {
          child.kill();
        } catch {
          finish(abortError());
        }
      };
      const parseProgress = (chunk: Buffer) => {
        const matches = chunk.toString().matchAll(/(\d{1,3})%/g);
        for (const match of matches) {
          onPercentage?.(Math.min(100, Number(match[1])));
        }
      };
      child.stdout.on("data", parseProgress);
      child.stderr.on("data", parseProgress);
      child.on("error", (error) =>
        finish(
          abortRequested
            ? abortError()
            : new BackupExportError(
                "archive_failed",
                `backup_7za_start_failed:${error.message}`,
              ),
        ),
      );
      child.on("close", (code) => {
        if (abortRequested || signal.aborted) {
          finish(abortError());
        } else if (code === 0) {
          finish();
        } else {
          finish(
            new BackupExportError(
              "archive_failed",
              `backup_7za_failed:${code}`,
            ),
          );
        }
      });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  private failure(
    errorCode: BackupErrorCode,
    preserveProgress = false,
  ): BackupResult {
    return {
      success: false,
      state: this.setState({
        status: "error",
        errorCode,
        ...(preserveProgress
          ? {}
          : {
              progress: 0,
              processedBytes: 0,
              totalBytes: 0,
              processedFiles: 0,
              totalFiles: 0,
              outputPath: undefined,
            }),
      }),
    };
  }

  private setState(patch: Partial<BackupState>): BackupState {
    this.state = { ...this.state, ...patch };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.BACKUP_EVENT, this.state);
    }
    return this.getState();
  }
}

export const backupExportService = new BackupExportService();
