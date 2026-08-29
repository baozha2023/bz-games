import { app, dialog } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { path7za } from "7zip-bin";
import { z } from "zod";
import { BZ_GAMES_DB_FILE_NAME } from "../../../shared/AppConstants";
import { IPC } from "../../../shared/ipc-channels";
import type {
  BackupErrorCode,
  BackupImportPreview,
  BackupImportSelectionResult,
  BackupManifestV2,
  BackupResult,
  BackupState,
} from "../../../shared/types";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { mainWindow } from "../../window";
import { gameManager } from "../game/GameManager";
import { gameImportTaskService } from "../game/GameImportTaskService";
import { marketService } from "../market/MarketService";
import { bzGamesDatabase } from "../storage/database/BzGamesDatabase";
import { backupActivityGuard } from "./BackupActivityGuard";
import { lifecycleOperationGuard } from "../system/LifecycleOperationGuard";
import {
  encryptExternalV1ManifestsWithRollback,
  restoreExternalV1Manifests,
  tryPrepareV1Import,
  V1_ARCHIVE_MANIFEST,
} from "./v1/V1ImportAdapter";
import { validateV4DataRoot } from "./V4DataValidator";

const MAX_ARCHIVE_ENTRIES = 200_000;
const MAX_EXPANDED_BYTES = 2 * 1024 ** 4;
const MAX_EXPANSION_RATIO = 200;
const SPACE_RESERVE_BYTES = 256 * 1024 * 1024;
const ROOT_ENTRIES = new Set([
  "backup-manifest.json",
  V1_ARCHIVE_MANIFEST,
  "config.json",
  "games",
  "db",
]);
const backupManifestV2Schema = z
  .object({
    format: z.literal("bzgames-backup"),
    formatVersion: z.literal(2),
    dataModelVersion: z.literal(4),
    exportedAt: z.string().datetime(),
    sourceAppVersion: z.string().min(1).max(64),
    sourcePlatform: z.literal("win32"),
    sourceArch: z.literal("x64"),
    entries: z.tuple([
      z.literal("config.json"),
      z.literal("games"),
      z.literal("db"),
    ]),
    totalFiles: z.number().int().nonnegative().max(MAX_ARCHIVE_ENTRIES),
    totalBytes: z.number().int().nonnegative().max(MAX_EXPANDED_BYTES),
    externalLibraryCount: z.number().int().nonnegative(),
  })
  .strict();

interface PendingImport {
  token: string;
  archivePath: string;
  workRoot: string;
  convertedRoot: string;
  preview: BackupImportPreview;
  legacyExternalManifestPaths?: string[];
}

interface ArchiveEntry {
  path: string;
  size: number;
  attributes: string;
  symbolicLink?: string;
}

class BackupImportError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function get7zaPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "7za", "7za.exe")
    : path7za;
}

function parseSltRecords(output: string): Array<Record<string, string>> {
  return output
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const record: Record<string, string> = {};
      for (const line of block.split(/\r?\n/)) {
        const separator = line.indexOf(" = ");
        if (separator <= 0) continue;
        record[line.slice(0, separator)] = line.slice(separator + 3);
      }
      return record;
    })
    .filter((record) => typeof record.Path === "string");
}

function validateArchivePath(entryPath: string): string {
  const normalized = entryPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.includes("\0") ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":"),
    ) ||
    !ROOT_ENTRIES.has(segments[0])
  ) {
    throw new BackupImportError(
      "backup_validation_failed",
      `backup_entry_path_invalid:${entryPath}`,
    );
  }
  return normalized;
}

async function run7zaCapture(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(get7zaPath(), args, { cwd, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) {
        child.kill();
        reject(new BackupImportError("archive_failed", "7za_output_too_large"));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) =>
      reject(new BackupImportError("archive_failed", error.message)),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new BackupImportError(
            "archive_failed",
            Buffer.concat(stderr).toString("utf8") || `7za_failed:${code}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

async function inspectArchive(archivePath: string): Promise<{
  entries: ArchiveEntry[];
  totalBytes: number;
}> {
  const archiveStat = await fs.stat(archivePath);
  if (!archiveStat.isFile()) {
    throw new BackupImportError("backup_validation_failed", "backup_not_file");
  }
  await run7zaCapture(
    ["t", "-bso0", "-bsp0", "-bb0", archivePath],
    path.dirname(archivePath),
  );
  const output = await run7zaCapture(
    ["l", "-slt", "-ba", archivePath],
    path.dirname(archivePath),
  );
  const seen = new Set<string>();
  const entries: ArchiveEntry[] = [];
  for (const record of parseSltRecords(output)) {
    if (path.resolve(record.Path) === path.resolve(archivePath)) continue;
    const safePath = validateArchivePath(record.Path);
    const key = safePath.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      throw new BackupImportError(
        "backup_validation_failed",
        `backup_duplicate_entry:${safePath}`,
      );
    }
    seen.add(key);
    const size = Number(record.Size || 0);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new BackupImportError(
        "backup_validation_failed",
        "backup_entry_size_invalid",
      );
    }
    const attributes = record.Attributes || "";
    if (
      record["Symbolic Link"] ||
      record["Hard Link"] ||
      /\bL\b/i.test(attributes)
    ) {
      throw new BackupImportError(
        "backup_validation_failed",
        `backup_link_unsupported:${safePath}`,
      );
    }
    entries.push({
      path: safePath,
      size,
      attributes,
      symbolicLink: record["Symbolic Link"],
    });
  }
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (
    entries.length === 0 ||
    entries.length > MAX_ARCHIVE_ENTRIES ||
    totalBytes > MAX_EXPANDED_BYTES ||
    totalBytes > Math.max(archiveStat.size, 1) * MAX_EXPANSION_RATIO
  ) {
    throw new BackupImportError(
      "backup_validation_failed",
      "backup_archive_limits_exceeded",
    );
  }
  return { entries, totalBytes };
}

async function assertExtractedTreeSafe(root: string): Promise<void> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) {
        throw new BackupImportError(
          "backup_validation_failed",
          `backup_link_extracted:${entryPath}`,
        );
      }
      if (stat.isDirectory()) pending.push(entryPath);
      else if (!stat.isFile()) {
        throw new BackupImportError(
          "backup_validation_failed",
          `backup_special_entry:${entryPath}`,
        );
      }
    }
  }
}

async function assertV2ExtractedLayout(root: string): Promise<void> {
  const rootEntries = await fs.readdir(root, { withFileTypes: true });
  const rootShape = rootEntries
    .map((entry) => `${entry.name}:${entry.isDirectory() ? "d" : "f"}`)
    .sort();
  if (
    rootShape.join(",") !== "backup-manifest.json:f,config.json:f,db:d,games:d"
  ) {
    throw new BackupImportError(
      "backup_validation_failed",
      "backup_v2_root_layout_invalid",
    );
  }
  const databaseEntries = await fs.readdir(path.join(root, "db"), {
    withFileTypes: true,
  });
  if (
    databaseEntries.length !== 1 ||
    databaseEntries[0].name !== BZ_GAMES_DB_FILE_NAME ||
    !databaseEntries[0].isFile()
  ) {
    throw new BackupImportError(
      "backup_validation_failed",
      "backup_v2_database_layout_invalid",
    );
  }
}

async function measureV2Payload(root: string): Promise<{
  totalFiles: number;
  totalBytes: number;
}> {
  let totalFiles = 0;
  let totalBytes = 0;
  const pending = [
    path.join(root, "config.json"),
    path.join(root, "games"),
    path.join(root, "db"),
  ];
  while (pending.length > 0) {
    const candidate = pending.pop()!;
    const stat = await fs.lstat(candidate);
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(candidate)) {
        pending.push(path.join(candidate, entry));
      }
    } else if (stat.isFile()) {
      totalFiles += 1;
      totalBytes += stat.size;
    } else {
      throw new BackupImportError(
        "backup_validation_failed",
        "backup_v2_payload_entry_invalid",
      );
    }
  }
  return { totalFiles, totalBytes };
}

async function ensureFreeSpace(
  directory: string,
  bytes: number,
): Promise<void> {
  const stats = await fs.statfs(directory);
  if (stats.bavail * stats.bsize < bytes + SPACE_RESERVE_BYTES) {
    throw new BackupImportError(
      "insufficient_space",
      "backup_insufficient_space",
    );
  }
}

function busyError(): BackupErrorCode | null {
  if (gameManager.hasActiveOrLaunchingGames()) return "game_running";
  if (marketService.computeTotalProgress().activeTaskCount > 0) {
    return "market_task_active";
  }
  if (gameImportTaskService.hasActiveTasks()) return "import_task_active";
  return null;
}

export class BackupImportService {
  private pending: PendingImport | null = null;
  private state: BackupState = {
    status: "idle",
    progress: 0,
    processedBytes: 0,
    totalBytes: 0,
    processedFiles: 0,
    totalFiles: 0,
  };

  getState(): BackupState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.pending !== null;
  }

  async selectImport(): Promise<BackupImportSelectionResult> {
    if (
      this.pending ||
      backupActivityGuard.isActive() ||
      lifecycleOperationGuard.blocksNewActivity()
    ) {
      return this.failure("backup_task_active");
    }
    const busy = busyError();
    if (busy) return this.failure(busy);
    const options = {
      title: "Import BZ-Games Backup",
      properties: ["openFile"] as Array<"openFile">,
      filters: [{ name: "BZ-Games Backup", extensions: ["bzgames"] }],
    };
    const selection = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length !== 1) {
      return {
        success: false,
        canceled: true,
        state: this.setState({ status: "canceled" }),
      };
    }
    if (
      lifecycleOperationGuard.blocksNewActivity() ||
      !backupActivityGuard.tryBegin()
    )
      return this.failure("backup_task_active");
    try {
      return await this.prepareImport(selection.filePaths[0]);
    } catch (error) {
      logger.error("[BackupImport] Failed to prepare import", error);
      await this.cleanupPending();
      backupActivityGuard.end();
      return this.failure(
        error instanceof BackupImportError
          ? error.code
          : "backup_validation_failed",
      );
    }
  }

  async confirmImport(token: unknown): Promise<BackupResult> {
    if (!this.pending || token !== this.pending.token) {
      return this.failure("backup_validation_failed");
    }
    const busy = busyError();
    if (busy) {
      await this.cleanupPending();
      backupActivityGuard.end();
      return this.failure(busy);
    }
    const pending = this.pending;
    try {
      return await this.commitImport(pending);
    } catch (error) {
      logger.error("[BackupImport] Failed to commit import", error);
      return this.failure(
        error instanceof BackupImportError ? error.code : "replacement_failed",
      );
    } finally {
      await this.cleanupPending();
      backupActivityGuard.end();
    }
  }

  async cancel(): Promise<boolean> {
    if (!this.pending) return false;
    await this.cleanupPending();
    backupActivityGuard.end();
    this.setState({ status: "canceled", progress: 0 });
    return true;
  }

  private async prepareImport(
    archivePath: string,
  ): Promise<BackupImportSelectionResult> {
    const dataRoot = getAppRoot();
    const workRoot = path.join(dataRoot, `.backup-work-${crypto.randomUUID()}`);
    const extractedRoot = path.join(workRoot, "extracted");
    const convertedRoot = path.join(workRoot, "converted");
    await fs.mkdir(extractedRoot, { recursive: true });
    this.pending = {
      token: crypto.randomUUID(),
      archivePath,
      workRoot,
      convertedRoot,
      preview: {} as BackupImportPreview,
    };
    this.setState({
      operation: "import",
      status: "verifying",
      progress: 5,
      outputPath: archivePath,
      errorCode: undefined,
    });
    const inspection = await inspectArchive(archivePath);
    await ensureFreeSpace(dataRoot, inspection.totalBytes * 2);
    await run7zaCapture(
      ["x", "-y", `-o${extractedRoot}`, archivePath],
      workRoot,
    );
    await assertExtractedTreeSafe(extractedRoot);
    this.setState({ status: "preparing", progress: 35 });

    const v2ManifestPath = path.join(extractedRoot, "backup-manifest.json");
    let preview: BackupImportPreview;
    if (await fs.stat(v2ManifestPath).catch(() => null)) {
      const parsedManifest = backupManifestV2Schema.safeParse(
        JSON.parse(await fs.readFile(v2ManifestPath, "utf8")),
      );
      if (!parsedManifest.success) {
        throw new BackupImportError(
          "unsupported_backup",
          "backup_v2_manifest_invalid",
        );
      }
      const manifest: BackupManifestV2 = parsedManifest.data;
      await assertV2ExtractedLayout(extractedRoot);
      const [payload, validation] = await Promise.all([
        measureV2Payload(extractedRoot),
        validateV4DataRoot(extractedRoot),
      ]);
      if (
        payload.totalFiles !== manifest.totalFiles ||
        payload.totalBytes !== manifest.totalBytes ||
        validation.externalLibraryCount !== manifest.externalLibraryCount
      ) {
        throw new BackupImportError(
          "backup_validation_failed",
          "backup_v2_manifest_summary_mismatch",
        );
      }
      preview = {
        token: this.pending.token,
        formatVersion: 2,
        dataModelVersion: 4,
        sourceAppVersion: manifest.sourceAppVersion,
        exportedAt: manifest.exportedAt,
        totalFiles: manifest.totalFiles,
        totalBytes: manifest.totalBytes,
        externalLibraryCount: manifest.externalLibraryCount,
      };
      this.pending.convertedRoot = extractedRoot;
    } else {
      const legacy = await tryPrepareV1Import(extractedRoot, convertedRoot, {
        totalFiles: inspection.entries.length,
        totalBytes: inspection.totalBytes,
      }).catch((error) => {
        throw new BackupImportError(
          "unsupported_backup",
          error instanceof Error ? error.message : "backup_v1_invalid",
        );
      });
      if (!legacy) {
        throw new BackupImportError(
          "unsupported_backup",
          "backup_manifest_missing",
        );
      }
      await validateV4DataRoot(convertedRoot);
      this.pending.legacyExternalManifestPaths = legacy.externalManifestPaths;
      preview = { ...legacy.preview, token: this.pending.token };
    }
    this.pending.preview = preview;
    const state = this.setState({
      status: "awaiting_confirmation",
      progress: 0,
      processedBytes: 0,
      totalBytes: preview.totalBytes,
      processedFiles: 0,
      totalFiles: preview.totalFiles,
    });
    return { success: true, state, preview };
  }

  private async commitImport(pending: PendingImport): Promise<BackupResult> {
    const dataRoot = getAppRoot();
    const rollbackRoot = path.join(
      dataRoot,
      ".backup-rollback",
      `import-${Date.now()}-${crypto.randomUUID()}`,
    );
    const failedRoot = path.join(rollbackRoot, "failed-commit");
    const entries = ["config.json", "games", "db"] as const;
    await fs.mkdir(rollbackRoot, { recursive: true });
    this.setState({ status: "importing", progress: 50 });
    await bzGamesDatabase.suspendForSnapshot();
    let committed = false;
    let rollbackComplete = false;
    const backedUpEntries = new Set<(typeof entries)[number]>();
    const installedEntries = new Set<(typeof entries)[number]>();
    try {
      for (const entry of entries) {
        const current = path.join(dataRoot, entry);
        if (await fs.stat(current).catch(() => null)) {
          await fs.rename(current, path.join(rollbackRoot, entry));
          backedUpEntries.add(entry);
        }
      }
      for (const entry of entries) {
        await fs.rename(
          path.join(pending.convertedRoot, entry),
          path.join(dataRoot, entry),
        );
        installedEntries.add(entry);
      }
      if (pending.legacyExternalManifestPaths?.length) {
        await encryptExternalV1ManifestsWithRollback(
          pending.legacyExternalManifestPaths,
          path.join(rollbackRoot, "external-manifests"),
        );
      }
      await fs.writeFile(
        path.join(rollbackRoot, "pending-health.json"),
        `${JSON.stringify({
          format: "bzgames-import-rollback",
          createdAt: new Date().toISOString(),
          sourceBackup: pending.archivePath,
          externalManifestPaths: pending.legacyExternalManifestPaths || [],
        })}\n`,
        "utf8",
      );
      bzGamesDatabase.resumeAfterSnapshot();
      await bzGamesDatabase.initialize();
      await validateV4DataRoot(dataRoot);
      committed = true;
      const state = this.setState({
        status: "completed",
        progress: 0,
        processedBytes: pending.preview.totalBytes,
        totalBytes: pending.preview.totalBytes,
        processedFiles: pending.preview.totalFiles,
        totalFiles: pending.preview.totalFiles,
      });
      return { success: true, restartRequired: true, state };
    } catch (error) {
      await bzGamesDatabase.close().catch(() => undefined);
      try {
        if (pending.legacyExternalManifestPaths?.length) {
          await restoreExternalV1Manifests(
            pending.legacyExternalManifestPaths,
            path.join(rollbackRoot, "external-manifests"),
          );
        }
        await fs.mkdir(failedRoot, { recursive: true });
        for (const entry of installedEntries) {
          const current = path.join(dataRoot, entry);
          if (await fs.stat(current).catch(() => null)) {
            await fs.rename(current, path.join(failedRoot, entry));
          }
        }
        for (const entry of backedUpEntries) {
          await fs.rename(
            path.join(rollbackRoot, entry),
            path.join(dataRoot, entry),
          );
        }
        bzGamesDatabase.resumeAfterSnapshot();
        await bzGamesDatabase.initialize();
        rollbackComplete = true;
      } catch (rollbackError) {
        logger.error(
          "[BackupImport] Failed to restore rollback",
          rollbackError,
        );
        throw new BackupImportError(
          "replacement_failed",
          `backup_rollback_failed:${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
      throw new BackupImportError(
        "replacement_failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (!committed && rollbackComplete) {
        await fs
          .rm(rollbackRoot, { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
  }

  private async cleanupPending(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      await fs
        .rm(pending.workRoot, { recursive: true, force: true, maxRetries: 3 })
        .catch((error) =>
          logger.warn("[BackupImport] Failed to clean work directory", error),
        );
    }
  }

  private failure(errorCode: BackupErrorCode): BackupImportSelectionResult {
    return {
      success: false,
      state: this.setState({ status: "error", errorCode, progress: 0 }),
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

export const backupImportService = new BackupImportService();
