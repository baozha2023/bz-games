import { app } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import semver from "semver";
import { path7za } from "7zip-bin";
import {
  IPC,
} from "../../shared/ipc-channels";
import { GameManifestSchema, type GameManifest } from "../../shared/game-manifest";
import type {
  DownloadTaskSnapshot,
  MarketErrorCode,
  MarketDirectory,
  MarketGame,
  MarketGameVersion,
  MarketIndex,
  MarketTaskState,
  MarketTaskStatus,
} from "../../shared/types";
import { MarketDirectorySchema, MarketIndexSchema } from "../../shared/types";
import { GameLoader } from "./GameLoader";
import { logger } from "../utils/logger";
import { mainWindow } from "../window";

const PRIMARY_MARKET_INDEX_URL =
  "https://raw.githubusercontent.com/baozha2023/bz-games-market/master/market.json";
const FALLBACK_MARKET_INDEX_URL =
  "https://web-bz.oss-cn-beijing.aliyuncs.com/market.json";

function gitToRawUrl(repository: string, branch: string): string {
  const match = repository.match(/github\.com\/(.+?)\/(.+?)(?:\.git)?$/);
  if (!match) throw new Error(`market_unsupported_repo:${repository}`);
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${branch}/market.json`;
}

const REFERER = "https://bz-game-client.local";

interface TaskMeta {
  gameId: string;
  version: string;
  gameName: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  downloadPath: string;
  archiveType: MarketArchiveType;
  sourceIdx: number;
}

interface ActiveTask {
  state: MarketTaskState;
  meta: TaskMeta;
  abort: AbortController;
}

type MarketArchiveType = "zip" | "7z";

function buildMeta(
  game: MarketGame,
  targetVersion: MarketGameVersion,
  downloadPath: string,
  archiveType: MarketArchiveType,
  sourceIdx: number,
): TaskMeta {
  return {
    gameId: game.id,
    version: targetVersion.version,
    gameName: game.name,
    downloadUrl: targetVersion.downloadUrl,
    sha256: targetVersion.sha256,
    size: targetVersion.size,
    downloadPath,
    archiveType,
    sourceIdx,
  };
}

function toTaskId(gameId: string, version: string): string {
  return `${gameId}@${version}`;
}

const ACTIVE_STATUSES: MarketTaskStatus[] = [
  "idle", "downloading", "verifying", "extracting", "installing",
];

const PAUSABLE_STATUSES: MarketTaskStatus[] = [
  "downloading", "verifying",
];

const TERMINAL_STATUSES: MarketTaskStatus[] = [
  "completed", "error", "canceled",
];

function now(): number {
  return Date.now();
}

function classifyErrorCode(error: unknown): MarketErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("market_download_size_mismatch") || message.includes("market_download_sha256_mismatch")) {
    return "verify";
  }
  if (message.includes("market_manifest")) {
    return "manifest";
  }
  if (message.includes("market_download")) {
    return "download";
  }
  if (message.includes("market_extract") || message.includes("market_archive")) {
    return "extract";
  }
  return "install";
}

async function ensureDir(dirPath: string): Promise<void> {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function getPartialFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fsp.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function removeIfExists(targetPath: string): Promise<void> {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    if (code === "EBUSY" || code === "EPERM") {
      logger.warn(`[MarketService] could not remove ${targetPath}: ${code}`);
      return;
    }
    throw err;
  }
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

async function extractArchiveFile(
  archivePath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDir(destinationPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path7za, [
      "x",
      archivePath,
      `-o${destinationPath}`,
      "-y",
    ], {
      stdio: "ignore",
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new Error("market_7z_not_installed"));
      } else {
        reject(new Error(`market_extract_7z_failed:${err.message}`));
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`market_extract_7z_failed:exit_code_${code}`));
      }
    });
  });
}

async function resolveExtractedImportDir(extractRoot: string): Promise<string | null> {
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

  return null;
}

async function resolveImportRoot(extractRoot: string): Promise<string> {
  const entries = await fsp.readdir(extractRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => !entry.isDirectory());
  if (dirs.length === 1 && files.length === 0) {
    return path.join(extractRoot, dirs[0].name);
  }
  return extractRoot;
}

export class MarketService {
  private readonly tasks = new Map<string, ActiveTask>();
  private cachedIndexes = new Map<number, { index: MarketIndex; at: number }>();
  private cachedSources: MarketDirectory | null = null;
  private cachedSourcesAt = 0;
  private cachedImages = new Map<string, { dataUrl: string; at: number }>();
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000;
  private static readonly IMAGE_FETCH_TIMEOUT_MS = 15_000;

  // ── Snapshot persistence ──

  private get pendingTasksFile(): string {
    return path.join(app.getPath("userData"), ".market-cache", "pending-tasks.json");
  }

  private async loadSnapshots(): Promise<DownloadTaskSnapshot[]> {
    try {
      const raw = await fsp.readFile(this.pendingTasksFile, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* file not found or corrupt */ }
    return [];
  }

  private async saveSnapshots(snapshots: DownloadTaskSnapshot[]): Promise<void> {
    await ensureDir(path.dirname(this.pendingTasksFile));
    await fsp.writeFile(this.pendingTasksFile, JSON.stringify(snapshots, null, 2));
  }

  private async writeSnapshot(taskId: string, bytesReceived: number, status: "paused" | "interrupted"): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const { meta } = task;
    const snapshot: DownloadTaskSnapshot = {
      taskId,
      gameId: meta.gameId,
      version: meta.version,
      sourceIdx: meta.sourceIdx,
      downloadUrl: meta.downloadUrl,
      sha256: meta.sha256,
      size: meta.size,
      downloadPath: meta.downloadPath,
      archiveType: meta.archiveType,
      bytesReceived,
      status,
      updatedAt: now(),
    };
    const snapshots = await this.loadSnapshots();
    const idx = snapshots.findIndex((s) => s.taskId === taskId);
    if (idx >= 0) snapshots[idx] = snapshot;
    else snapshots.push(snapshot);
    await this.saveSnapshots(snapshots);
  }

  private async removeSnapshot(taskId: string): Promise<void> {
    const snapshots = await this.loadSnapshots();
    const filtered = snapshots.filter((s) => s.taskId !== taskId);
    if (filtered.length !== snapshots.length) {
      await this.saveSnapshots(filtered);
    }
  }

  // ── State transitions (single source of truth) ──

  private emit(state: MarketTaskState): void {
    mainWindow?.webContents.send(IPC.MARKET_EVENT, { task: state });
  }

  private tickProgress(taskId: string, progress: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.state = { ...task.state, progress, updatedAt: now() };
    this.emit(task.state);
  }

  private startProgressSim(
    taskId: string,
    signal: AbortSignal,
    from: number,
    to: number,
    estimatedSeconds: number,
  ): () => void {
    const delta = to - from;
    const intervalMs = 500;
    const totalSteps = (estimatedSeconds * 1000) / intervalMs;
    const perStep = delta / totalSteps;
    let step = 0;

    const timer = setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer);
        return;
      }
      step++;
      const pct = Math.round(from + perStep * step);
      if (pct <= to) {
        this.tickProgress(taskId, pct);
      }
      if (pct >= to) {
        clearInterval(timer);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }

  /**
   * The ONE AND ONLY method that mutates task state.
   * Enforces valid transitions — silent no-op for invalid ones.
   */
  private transition(taskId: string, status: MarketTaskStatus, extra?: Partial<MarketTaskState>): MarketTaskState | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    const current = task.state.status;

    if (TERMINAL_STATUSES.includes(current)) return null;

    task.state = {
      ...task.state,
      ...extra,
      status,
      updatedAt: now(),
    };
    this.tasks.set(taskId, task);
    this.emit(task.state);
    return task.state;
  }

  // ── Task lifecycle ──

  private startTask(taskId: string, meta: TaskMeta): MarketTaskState {
    const timestamp = now();
    const state: MarketTaskState = {
      taskId, gameId: meta.gameId, version: meta.version,
      status: "idle", progress: 0,
      createdAt: timestamp, updatedAt: timestamp,
    };
    const abort = new AbortController();
    this.tasks.set(taskId, { state, meta, abort });
    this.emit(state);
    return state;
  }

  private startPipeline(taskId: string, game: MarketGame, targetVersion: MarketGameVersion): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.runPipeline(taskId, game, targetVersion, task.abort.signal).catch((error) => {
      if (task.abort.signal.aborted) return;
      logger.error("[MarketService] Pipeline error", error);
      const msg = error instanceof Error ? error.message : String(error);
      this.transition(taskId, "error", {
        error: msg,
        errorCode: classifyErrorCode(error),
        progress: 0,
      });
      this.finalize(taskId);
    });
  }

  /**
   * Clean up temp files for terminal states, then remove task from memory.
   */
  private async finalize(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const { downloadPath } = task.meta;
    const cacheRoot = path.join(app.getPath("userData"), ".market-cache");
    const extractRoot = path.join(cacheRoot, "extract", `${task.meta.gameId}-${task.meta.version}`);
    await Promise.all([
      removeIfExists(downloadPath).catch(() => undefined),
      removeIfExists(extractRoot).catch(() => undefined),
    ]);
    // Keep in memory 30s for UI to read final state, then drop
    setTimeout(() => { this.tasks.delete(taskId); }, 30_000);
  }

  getTaskState(taskId: string): MarketTaskState | null {
    return this.tasks.get(taskId)?.state ?? null;
  }

  getPendingTasks(): Promise<DownloadTaskSnapshot[]> {
    return this.loadSnapshots();
  }

  // ── Public API: pause / resume / cancel ──

  async pauseTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (!PAUSABLE_STATUSES.includes(task.state.status)) return false;

    const bytesReceived = task.state.bytesReceived || 0;

    // CRITICAL: set status BEFORE abort, so the pipeline's catch block
    // sees "paused" and silently returns without overwriting state.
    this.transition(taskId, "paused", { bytesReceived });
    task.abort.abort();

    await this.writeSnapshot(taskId, bytesReceived, "paused");
    return true;
  }

  async resumeTask(taskId: string): Promise<MarketTaskState | null> {
    const snapshots = await this.loadSnapshots();
    const snap = snapshots.find((s) => s.taskId === taskId);
    if (!snap) return null;

    const existing = this.tasks.get(taskId);
    if (existing && ACTIVE_STATUSES.includes(existing.state.status)) {
      return existing.state;
    }

    // Validate the snapshot is still valid
    const index = await this.getIndex(snap.sourceIdx);
    const game = index.games.find((item) => item.id === snap.gameId);
    const targetVersion = game?.versions.find((item) => item.version === snap.version);
    if (!game || !targetVersion) {
      await this.removeSnapshot(taskId);
      throw new Error("market_version_not_found");
    }

    const record = await GameLoader.getGameRecord(snap.gameId);
    if (game.type === "networkgame") {
      if (record) {
        await this.removeSnapshot(taskId);
        throw new Error("market_version_already_installed");
      }
    } else if (record?.versions.some((item) => item.version === snap.version)) {
      await this.removeSnapshot(taskId);
      throw new Error("market_version_already_installed");
    }

    const currentVersion = app.getVersion();
    if (!semver.satisfies(currentVersion, targetVersion.platformVersion)) {
      throw new Error("market_platform_version_mismatch");
    }

    const meta = buildMeta(
      game, targetVersion,
      snap.downloadPath, snap.archiveType,
      snap.sourceIdx,
    );

    const state = this.startTask(taskId, meta);
    this.startPipeline(taskId, game, targetVersion);
    return state;
  }

  async restorePendingTasks(): Promise<void> {
    const snapshots = await this.loadSnapshots();
    for (const snap of snapshots) {
      if (this.tasks.has(snap.taskId)) continue;
      const state: MarketTaskState = {
        taskId: snap.taskId,
        gameId: snap.gameId,
        version: snap.version,
        status: "interrupted",
        progress: snap.size > 0 ? Math.min(65, Math.round((snap.bytesReceived / snap.size) * 65)) : 0,
        bytesReceived: snap.bytesReceived,
        totalBytes: snap.size,
        createdAt: snap.updatedAt,
        updatedAt: now(),
      };
      // Placeholder meta — will be replaced on resume
      const meta: TaskMeta = {
        gameId: snap.gameId, version: snap.version, gameName: snap.gameId,
        downloadUrl: snap.downloadUrl, sha256: snap.sha256, size: snap.size,
        downloadPath: snap.downloadPath, archiveType: snap.archiveType, sourceIdx: snap.sourceIdx,
      };
      const abort = new AbortController();
      this.tasks.set(snap.taskId, { state, meta, abort });
      this.emit(state);
    }
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.state.status === "paused" || task.state.status === "interrupted") {
      this.removeSnapshot(taskId).catch(() => undefined);
      this.transition(taskId, "canceled");
      this.finalize(taskId);
      return true;
    }

    if (!ACTIVE_STATUSES.includes(task.state.status)) return false;

    this.transition(taskId, "canceled");
    task.abort.abort();
    this.finalize(taskId);
    return true;
  }

  // ── Public API: start download ──

  async downloadAndInstall(gameId: string, version: string, sourceIdx: number): Promise<MarketTaskState> {
    const taskId = toTaskId(gameId, version);
    const existing = this.tasks.get(taskId)?.state;
    if (existing && [...ACTIVE_STATUSES, "paused", "interrupted"].includes(existing.status)) {
      return existing;
    }

    const index = await this.getIndex(sourceIdx);
    const game = index.games.find((item) => item.id === gameId);
    const targetVersion = game?.versions.find((item) => item.version === version);
    if (!game || !targetVersion) throw new Error("market_version_not_found");

    const currentVersion = app.getVersion();
    if (!semver.satisfies(currentVersion, targetVersion.platformVersion)) {
      throw new Error("market_platform_version_mismatch");
    }

    const record = await GameLoader.getGameRecord(gameId);
    if (game.type === "networkgame") {
      if (record) {
        throw new Error("market_version_already_installed");
      }
    } else if (record?.versions.some((item) => item.version === version)) {
      throw new Error("market_version_already_installed");
    }

    const cacheRoot = path.join(app.getPath("userData"), ".market-cache");
    const archiveType = inferArchiveType(targetVersion.downloadUrl);
    const downloadPath = path.join(cacheRoot, "downloads", `${game.id}-${targetVersion.version}.${archiveType}`);

    const meta = buildMeta(game, targetVersion, downloadPath, archiveType, sourceIdx);
    const state = this.startTask(taskId, meta);
    this.startPipeline(taskId, game, targetVersion);
    return state;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Referer: REFERER,
      },
    });
    if (!response.ok) {
      throw new Error(`market_index_request_failed:${response.status}`);
    }
    return await response.json();
  }

  private async fetchIndexFromUrl(url: string): Promise<MarketIndex> {
    const raw = await this.fetchJson(url);
    const parsed = MarketIndexSchema.parse(raw);
    return {
      ...parsed,
      games: parsed.games.filter((game) => game.visibility !== "hidden"),
    };
  }

  private async fetchDirectory(): Promise<MarketDirectory> {
    try {
      const raw = await this.fetchJson(PRIMARY_MARKET_INDEX_URL);
      return MarketDirectorySchema.parse(raw);
    } catch (primaryError) {
      logger.warn("[MarketService] Failed to load market directory from GitHub, falling back to OSS", primaryError);
      try {
        const raw = await this.fetchJson(FALLBACK_MARKET_INDEX_URL);
        return MarketDirectorySchema.parse(raw);
      } catch (fallbackError) {
        logger.error("[MarketService] Failed to load market directory from OSS fallback", fallbackError);
        const primaryMessage =
          primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          `market_directory_all_sources_failed:github=${primaryMessage};oss=${fallbackMessage}`,
        );
      }
    }
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

  private async fetchIndexForSource(sourceIdx: number): Promise<MarketIndex> {
    const sources = await this.getSources();
    const source = sources.sources[sourceIdx];
    if (!source) throw new Error("market_source_not_found");
    const url = gitToRawUrl(source.repository, source.branch);
    return await this.fetchIndexFromUrl(url);
  }

  async getSources(forceRefresh = false): Promise<MarketDirectory> {
    if (forceRefresh) {
      this.cachedImages.clear();
    }
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedSources &&
      now - this.cachedSourcesAt < MarketService.CACHE_TTL_MS
    ) {
      return this.cachedSources;
    }
    const parsed = await this.fetchDirectory();
    this.cachedSources = parsed;
    this.cachedSourcesAt = now;
    return parsed;
  }

  async getIndex(sourceIdx: number, forceRefresh = false): Promise<MarketIndex> {
    if (forceRefresh) {
      this.cachedImages.clear();
    }
    const now = Date.now();
    const cached = this.cachedIndexes.get(sourceIdx);
    if (
      !forceRefresh &&
      cached &&
      now - cached.at < MarketService.CACHE_TTL_MS
    ) {
      logger.info(`[MarketService] Returning cached market index for source ${sourceIdx}`);
      return cached.index;
    }
    logger.info(`[MarketService] Fetching fresh market index for source ${sourceIdx}`);

    const directory = await this.getSources();
    const source = directory.sources[sourceIdx];
    if (!source) throw new Error("market_source_not_found");

    const index = sourceIdx === 0
      ? await this.fetchIndexInternal()
      : await this.fetchIndexForSource(sourceIdx);

    if (index.marketId !== source.marketId) {
      throw new Error(
        `market_id_mismatch:expected=${source.marketId};actual=${index.marketId}`,
      );
    }

    this.cachedIndexes.set(sourceIdx, { index, at: now });
    return index;
  }

  async getCachedImageDataUrl(url: string): Promise<string> {
    const now = Date.now();
    const cached = this.cachedImages.get(url);
    if (cached && now - cached.at < MarketService.CACHE_TTL_MS) {
      return cached.dataUrl;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MarketService.IMAGE_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { Referer: REFERER },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`market_image_fetch_failed:${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        throw new Error(`market_image_fetch_failed:empty_body`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        throw new Error(`market_image_fetch_failed:not_image`);
      }
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const dataUrl = `data:${contentType};base64,${base64}`;

      this.cachedImages.set(url, { dataUrl, at: now });
      return dataUrl;
    } finally {
      clearTimeout(timeoutId);
    }
  }



  // ── Pipeline stages (throw on abort at each stage boundary) ──

  private async runPipeline(
    taskId: string,
    game: MarketGame,
    targetVersion: MarketGameVersion,
    signal: AbortSignal,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("market_task_not_found");
    const { meta } = task;

    const cacheRoot = path.join(app.getPath("userData"), ".market-cache");
    const extractRoot = path.join(cacheRoot, "extract", `${game.id}-${targetVersion.version}`);

    await ensureDir(path.dirname(meta.downloadPath));
    await ensureDir(path.dirname(extractRoot));

    const partialSize = await getPartialFileSize(meta.downloadPath);
    if (partialSize === 0) await removeIfExists(meta.downloadPath);
    await removeIfExists(extractRoot);

    await this.downloadArchive(taskId, meta, signal, partialSize);
    signal.throwIfAborted();

    await this.verifyArchive(taskId, meta, signal);
    signal.throwIfAborted();

    await this.extractArchive(taskId, meta, extractRoot, signal);
    signal.throwIfAborted();

    await this.installGame(taskId, game, targetVersion, extractRoot, signal);

    await this.removeSnapshot(taskId);
    this.transition(taskId, "completed", { progress: 100 });
    this.finalize(taskId);
  }

  private async downloadArchive(
    taskId: string,
    meta: TaskMeta,
    signal: AbortSignal,
    partialSize: number,
  ): Promise<void> {
    const headers: Record<string, string> = {
      "Cache-Control": "no-cache",
      Referer: REFERER,
    };

    let isResuming = false;
    if (partialSize > 0 && partialSize < meta.size) {
      headers["Range"] = `bytes=${partialSize}-`;
      isResuming = true;
    }

    this.transition(taskId, "downloading", {
      progress: isResuming ? Math.min(65, Math.round((partialSize / meta.size) * 65)) : 0,
      error: undefined,
      totalBytes: meta.size,
      bytesReceived: isResuming ? partialSize : 0,
    });

    const response = await fetch(meta.downloadUrl, { signal, headers });
    if (!response.ok || !response.body) {
      throw new Error(`market_download_request_failed:${response.status}`);
    }

    let received: number;
    let writer: fs.WriteStream;

    if (response.status === 206) {
      writer = fs.createWriteStream(meta.downloadPath, { flags: "a" });
      received = partialSize;
    } else if (response.status === 200) {
      if (isResuming) {
        await removeIfExists(meta.downloadPath);
        this.transition(taskId, "downloading", { progress: 0, bytesReceived: 0 });
      }
      writer = fs.createWriteStream(meta.downloadPath);
      received = 0;
    } else {
      throw new Error(`market_download_unexpected_status:${response.status}`);
    }

    await new Promise<void>((resolve, reject) => {
      const reader = response.body!.getReader();
      let settled = false;

      const onAbort = () => {
        writer.destroy(new Error("market_download_aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const settleReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      };

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
            this.transition(taskId, "downloading", {
              progress: meta.size ? Math.min(65, Math.round((received / meta.size) * 65)) : 0,
              bytesReceived: received,
            });
          }
          writer.end(() => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", onAbort);
            resolve();
          });
        } catch (error) {
          settleReject(error);
        }
      };

      writer.on("error", (err) => settleReject(err));
      void pump();
    });
  }

  private async verifyArchive(
    taskId: string,
    meta: TaskMeta,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    this.transition(taskId, "verifying", { progress: 65 });

    const stopSim = this.startProgressSim(taskId, signal, 65, 69, 5);
    try {
      const stat = await fsp.stat(meta.downloadPath);
      if (stat.size !== meta.size) throw new Error("market_download_size_mismatch");

      const sha256 = await computeSha256(meta.downloadPath);
      if (sha256.toLowerCase() !== meta.sha256.toLowerCase()) {
        throw new Error("market_download_sha256_mismatch");
      }
    } finally {
      stopSim();
    }

    signal.throwIfAborted();
    this.transition(taskId, "verifying", { progress: 70 });
  }

  private async extractArchive(
    taskId: string,
    meta: TaskMeta,
    extractRoot: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    this.transition(taskId, "extracting", { progress: 70 });

    const stopSim = this.startProgressSim(taskId, signal, 70, 94, 60);
    try {
      await extractArchiveFile(meta.downloadPath, extractRoot);
    } finally {
      stopSim();
    }

    signal.throwIfAborted();
    this.transition(taskId, "extracting", { progress: 95 });
  }

  private buildManifestFromMarket(
    game: MarketGame,
    targetVersion: MarketGameVersion,
    importDir: string,
  ): GameManifest {
    const gm = targetVersion.gameManifest!;

    const entry = gm.entry || (() => {
      try { return GameLoader.detectEntryFile(importDir); }
      catch { return ""; }
    })();

    if (!entry) {
      throw new Error("market_manifest_entry_required");
    }

    const type = gm.type || game.type;
    const needsMultiplayer = type === "multiplayer" || type === "singlemultiple";

    return GameManifestSchema.parse({
      id: game.id,
      name: gm.name || game.name,
      version: targetVersion.version,
      description: gm.description || game.summary,
      author: gm.author || game.author,
      author_url: gm.author_url !== undefined ? gm.author_url : game.author_url,
      platformVersion: gm.platformVersion || targetVersion.platformVersion,
      entry,
      web_url: gm.web_url,
      icon: gm.icon,
      cover: gm.cover,
      video: gm.video,
      encryptLocalStorage: gm.encryptLocalStorage,
      type,
      statistics: gm.statistics,
      multiplayer: gm.multiplayer || (needsMultiplayer && game.minPlayers != null ? {
        minPlayers: game.minPlayers,
        maxPlayers: game.maxPlayers || game.minPlayers,
      } : undefined),
      args: gm.args,
      env: gm.env,
      achievements: gm.achievements,
    });
  }

  private async installGame(
    taskId: string,
    game: MarketGame,
    targetVersion: MarketGameVersion,
    extractRoot: string,
    signal: AbortSignal,
  ): Promise<void> {
    this.transition(taskId, "installing", { progress: 95 });

    const stopSim = this.startProgressSim(taskId, signal, 95, 99, 10);
    let importDir: string | null = null;

    try {
      importDir = await resolveExtractedImportDir(extractRoot);

      if (!importDir) {
        if (!targetVersion.gameManifest) {
          throw new Error("market_manifest_missing");
        }
        importDir = await resolveImportRoot(extractRoot);
        const builtManifest = this.buildManifestFromMarket(game, targetVersion, importDir);
        await fsp.writeFile(
          path.join(importDir, "game.json"),
          JSON.stringify(builtManifest, null, 2),
          "utf8",
        );
      }

      const manifestPath = path.join(importDir, "game.json");
      const manifest = GameManifestSchema.parse(
        JSON.parse(await fsp.readFile(manifestPath, "utf8")),
      );
      if (manifest.id !== game.id) {
        throw new Error("market_manifest_mismatch");
      }
      if (game.type !== "networkgame" && manifest.version !== targetVersion.version) {
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
     } finally {
       stopSim();
     }
  }
}

export const marketService = new MarketService();
