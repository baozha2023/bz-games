import { app } from "electron";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import semver from "semver";
import extractZip from "extract-zip";
import {
  IPC,
} from "../../shared/ipc-channels";
import { GameManifestSchema } from "../../shared/game-manifest";
import type {
  MarketErrorCode,
  MarketGame,
  MarketGameVersion,
  MarketIndex,
  MarketTaskState,
} from "../../shared/types";
import { MarketIndexSchema } from "../../shared/types";
import { GameLoader } from "./GameLoader";
import { logger } from "../utils/logger";
import { mainWindow } from "../window";

const PRIMARY_MARKET_INDEX_URL =
  "https://raw.githubusercontent.com/baozha2023/bz-games-market/master/market.json";
const FALLBACK_MARKET_INDEX_URL =
  "https://web-bz.oss-cn-beijing.aliyuncs.com/market.json";

interface TaskContext {
  state: MarketTaskState;
  controller?: AbortController;
}

type MarketArchiveType = "zip" | "7z";

function toTaskId(gameId: string, version: string): string {
  return `${gameId}@${version}`;
}

function now(): number {
  return Date.now();
}

function classifyErrorCode(error: unknown): MarketErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("market_download_size_mismatch") || message.includes("market_download_sha256_mismatch")) {
    return "verify";
  }
  if (message.includes("market_download")) {
    return "download";
  }
  if (message.includes("market_extract") || message.includes("market_archive")) {
    return "extract";
  }
  return "install";
}

function createTaskState(gameId: string, version: string): MarketTaskState {
  const timestamp = now();
  return {
    taskId: toTaskId(gameId, version),
    gameId,
    version,
    status: "idle",
    progress: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function removeIfExists(targetPath: string): Promise<void> {
  await fsp.rm(targetPath, { recursive: true, force: true });
}

async function computeSha256(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function inferArchiveType(downloadUrl: string): MarketArchiveType {
  const url = new URL(downloadUrl);
  const lowerPath = url.pathname.toLowerCase();
  if (lowerPath.endsWith(".zip")) {
    return "zip";
  }
  if (lowerPath.endsWith(".7z")) {
    return "7z";
  }
  throw new Error("market_archive_type_unknown");
}

async function extractZipArchive(
  zipPath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDir(destinationPath);
  await extractZip(zipPath, { dir: path.resolve(destinationPath) });
}

async function resolveExtractedImportDir(extractRoot: string): Promise<string> {
  const rootManifest = path.join(extractRoot, "game.json");
  if (fs.existsSync(rootManifest)) {
    return extractRoot;
  }

  const entries = await fsp.readdir(extractRoot, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(extractRoot, entry.name))
    .filter((dirPath) => fs.existsSync(path.join(dirPath, "game.json")));

  if (dirs.length === 1) {
    return dirs[0];
  }

  throw new Error("market_extract_manifest_missing");
}

export class MarketService {
  private readonly tasks = new Map<string, TaskContext>();

  private async fetchIndexFromUrl(url: string): Promise<MarketIndex> {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) {
      throw new Error(`market_index_request_failed:${response.status}`);
    }
    const raw = await response.json();
    const parsed = MarketIndexSchema.parse(raw);
    return {
      ...parsed,
      games: parsed.games.filter((game) => game.visibility !== "hidden"),
    };
  }

  private getTaskContext(taskId: string): TaskContext | undefined {
    return this.tasks.get(taskId);
  }

  private emit(task: MarketTaskState): void {
    mainWindow?.webContents.send(IPC.MARKET_EVENT, { task });
  }

  private updateTask(
    taskId: string,
    patch: Partial<MarketTaskState>,
  ): MarketTaskState {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      throw new Error(`market_task_not_found:${taskId}`);
    }

    existing.state = {
      ...existing.state,
      ...patch,
      updatedAt: now(),
    };
    this.tasks.set(taskId, existing);
    this.emit(existing.state);
    return existing.state;
  }

  private createTask(gameId: string, version: string): MarketTaskState {
    const state = createTaskState(gameId, version);
    this.tasks.set(state.taskId, { state });
    this.emit(state);
    return state;
  }

  private setTaskController(taskId: string, controller: AbortController): void {
    const existing = this.tasks.get(taskId);
    if (!existing) return;
    existing.controller = controller;
    this.tasks.set(taskId, existing);
  }

  private clearTaskController(taskId: string): void {
    const existing = this.tasks.get(taskId);
    if (!existing) return;
    delete existing.controller;
    this.tasks.set(taskId, existing);
    this.scheduleTaskCleanup(taskId);
  }

  private scheduleTaskCleanup(taskId: string): void {
    const ctx = this.tasks.get(taskId);
    if (!ctx) return;
    const terminal = ["completed", "error", "canceled"];
    if (!terminal.includes(ctx.state.status)) return;
    setTimeout(() => {
      this.tasks.delete(taskId);
    }, 30_000);
  }

  private async fetchIndexInternal(): Promise<MarketIndex> {
    try {
      return await this.fetchIndexFromUrl(PRIMARY_MARKET_INDEX_URL);
    } catch (primaryError) {
      logger.warn("[MarketService] Failed to load market index from GitHub, falling back to OSS", primaryError);
      try {
        return await this.fetchIndexFromUrl(FALLBACK_MARKET_INDEX_URL);
      } catch (fallbackError) {
        logger.error("[MarketService] Failed to load market index from OSS fallback", fallbackError);
        const primaryMessage =
          primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          `market_index_all_sources_failed:github=${primaryMessage};oss=${fallbackMessage}`,
        );
      }
    }
  }

  async getIndex(): Promise<MarketIndex> {
    return await this.fetchIndexInternal();
  }

  getTaskState(taskId: string): MarketTaskState | null {
    return this.tasks.get(taskId)?.state ?? null;
  }

  cancelTask(taskId: string): boolean {
    const context = this.tasks.get(taskId);
    if (!context?.controller) {
      return false;
    }
    context.controller.abort();
    this.updateTask(taskId, {
      status: "canceled",
      error: undefined,
    });
    return true;
  }

  async downloadAndInstall(gameId: string, version: string): Promise<MarketTaskState> {
    const taskId = toTaskId(gameId, version);
    const existing = this.getTaskContext(taskId)?.state;
    if (
      existing &&
      ["idle", "downloading", "verifying", "extracting", "installing"].includes(
        existing.status,
      )
    ) {
      return existing;
    }

    const index = await this.fetchIndexInternal();
    const game = index.games.find((item) => item.id === gameId);
    const targetVersion = game?.versions.find((item) => item.version === version);
    if (!game || !targetVersion) {
      throw new Error("market_version_not_found");
    }

    const currentVersion = app.getVersion();
    if (!semver.satisfies(currentVersion, targetVersion.platformVersion)) {
      throw new Error("market_platform_version_mismatch");
    }

    const record = await GameLoader.getGameRecord(gameId);
    if (record?.versions.some((item) => item.version === version)) {
      throw new Error("market_version_already_installed");
    }

    const task = this.createTask(gameId, version);
    void this.runDownloadTask(task.taskId, game, targetVersion).catch((error) => {
      const ctx = this.getTaskContext(task.taskId);
      if (ctx?.state?.status === "canceled") return;
      logger.error("[MarketService] Task failed", error);
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "未知错误";
      const errorCode = classifyErrorCode(error);
      this.updateTask(task.taskId, {
        status: "error",
        error: message,
        errorCode,
        progress: 0,
      });
      this.clearTaskController(task.taskId);
    });
    return task;
  }

  private async runDownloadTask(
    taskId: string,
    game: MarketGame,
    targetVersion: MarketGameVersion,
  ): Promise<void> {
    const cacheRoot = path.join(app.getPath("userData"), ".market-cache");
    const archiveType = inferArchiveType(targetVersion.downloadUrl);
    const downloadPath = path.join(
      cacheRoot,
      "downloads",
      `${game.id}-${targetVersion.version}.${archiveType}`,
    );
    const extractRoot = path.join(
      cacheRoot,
      "extract",
      `${game.id}-${targetVersion.version}`,
    );

    const controller = new AbortController();
    this.setTaskController(taskId, controller);

    try {
      await ensureDir(path.dirname(downloadPath));
      await ensureDir(path.dirname(extractRoot));
      await removeIfExists(downloadPath);
      await removeIfExists(extractRoot);

      await this.downloadArchive(taskId, targetVersion, downloadPath, controller);
      if (controller.signal.aborted) throw new Error("market_download_aborted");
      await this.verifyArchive(taskId, targetVersion, downloadPath, controller);
      if (controller.signal.aborted) throw new Error("market_download_aborted");
      await this.extractArchive(taskId, archiveType, downloadPath, extractRoot, controller);
      if (controller.signal.aborted) throw new Error("market_download_aborted");
      await this.installExtractedGame(taskId, game, targetVersion, extractRoot);
      this.updateTask(taskId, {
        status: "completed",
        progress: 100,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        this.updateTask(taskId, {
          status: "canceled",
          error: undefined,
        });
        return;
      }
      throw error;
    } finally {
      this.clearTaskController(taskId);
      await Promise.all([
        removeIfExists(downloadPath).catch(() => undefined),
        removeIfExists(extractRoot).catch(() => undefined),
      ]);
    }
  }

  private async downloadArchive(
    taskId: string,
    targetVersion: MarketGameVersion,
    downloadPath: string,
    controller: AbortController,
  ): Promise<void> {
    this.updateTask(taskId, {
      status: "downloading",
      progress: 0,
      error: undefined,
      totalBytes: targetVersion.size,
      bytesReceived: 0,
    });

    const response = await fetch(targetVersion.downloadUrl, {
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok || !response.body) {
      throw new Error(`market_download_request_failed:${response.status}`);
    }

    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(downloadPath);
      const reader = response.body!.getReader();
      let received = 0;

      const abortHandler = () => {
        writer.destroy(new Error("market_download_aborted"));
      };
      controller.signal.addEventListener("abort", abortHandler, { once: true });

      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            received += value.byteLength;
            const buf = Buffer.from(value);
            if (!writer.write(buf)) {
              await new Promise<void>((r) => writer.once("drain", r));
            }
            const progress = targetVersion.size
              ? Math.min(60, Math.round((received / targetVersion.size) * 60))
              : 0;
            this.updateTask(taskId, {
              progress,
              bytesReceived: received,
              totalBytes: targetVersion.size,
            });
          }
          writer.end(() => resolve());
        } catch (error) {
          reject(error);
        } finally {
          controller.signal.removeEventListener("abort", abortHandler);
        }
      };

      writer.on("error", reject);
      void pump();
    });
  }

  private async verifyArchive(
    taskId: string,
    targetVersion: MarketGameVersion,
    downloadPath: string,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) throw new Error("market_download_aborted");
    this.updateTask(taskId, {
      status: "verifying",
      progress: 70,
    });

    const stat = await fsp.stat(downloadPath);
    if (stat.size !== targetVersion.size) {
      throw new Error("market_download_size_mismatch");
    }

    const sha256 = await computeSha256(downloadPath);
    if (sha256.toLowerCase() !== targetVersion.sha256.toLowerCase()) {
      throw new Error("market_download_sha256_mismatch");
    }
  }

  private async extractArchive(
    taskId: string,
    archiveType: MarketArchiveType,
    downloadPath: string,
    extractRoot: string,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) throw new Error("market_download_aborted");
    this.updateTask(taskId, {
      status: "extracting",
      progress: 80,
    });

    if (archiveType !== "zip") {
      throw new Error("market_archive_type_not_supported");
    }

    await extractZipArchive(downloadPath, extractRoot);
  }

  private async installExtractedGame(
    taskId: string,
    game: MarketGame,
    targetVersion: MarketGameVersion,
    extractRoot: string,
  ): Promise<void> {
    this.updateTask(taskId, {
      status: "installing",
      progress: 90,
    });

    const importDir = await resolveExtractedImportDir(extractRoot);
    const manifestPath = path.join(importDir, "game.json");
    const manifest = GameManifestSchema.parse(
      JSON.parse(await fsp.readFile(manifestPath, "utf8")),
    );
    if (manifest.id !== game.id || manifest.version !== targetVersion.version) {
      throw new Error("market_manifest_mismatch");
    }

    const currentVersion = app.getVersion();
    let manifestVersionOk = false;
    if (Array.isArray(manifest.platformVersion)) {
      const [min, max] = manifest.platformVersion;
      manifestVersionOk = semver.gte(currentVersion, min) && semver.lte(currentVersion, max);
    } else {
      manifestVersionOk = semver.satisfies(currentVersion, manifest.platformVersion);
    }
    if (!manifestVersionOk) {
      throw new Error("market_platform_version_manifest_mismatch");
    }

    const result = await GameLoader.loadGameFromPath(importDir);
    if (!result.success || !result.manifest) {
      throw new Error(result.error || "market_install_failed");
    }
  }
}

export const marketService = new MarketService();
