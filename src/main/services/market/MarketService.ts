import { app } from "electron";
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import semver from "semver";
import { path7za } from "7zip-bin";
import { IPC } from "../../../shared/ipc-channels";
import {
  GameManifestSchema,
  type GameManifest,
} from "../../../shared/game-manifest";
import {
  GameType,
  isGitHubReleaseUrl,
  type DownloadTaskSnapshot,
  type FloatBallProgress,
  type MarketErrorCode,
  type MarketDirectory,
  type MarketGame,
  type MarketGameVersion,
  type MarketIndex,
  type MarketTaskState,
  type MarketTaskStatus,
} from "../../../shared/types";
import { GameLoader } from "../game/GameLoader";
import { logger } from "../../utils/logger";
import { mainWindow, floatBallWindow } from "../../window";
import { GITHUB_API_BASE } from "../../../shared/AppConstants";
import { requestInterceptor } from "../../utils/requestInterceptor";
import {
  resolveMarketDownloadUrl,
  resolveMarketImageUrl,
} from "./HostedGameUrl";
import {
  getMarketSourceKey,
  marketCatalogClient,
  type MarketCatalogClient,
  type OfficialMarketCatalog,
} from "./MarketCatalogClient";

interface TaskMeta {
  gameId: string;
  version: string;
  gameName: string;
  downloadUrl: string;
  catalogDownloadUrl: string;
  sha256: string | undefined;
  size: number;
  downloadPath: string;
  archiveType: MarketArchiveType;
  sourceIdx: number;
  marketId: string;
}

interface ActiveTask {
  state: MarketTaskState;
  meta: TaskMeta;
  abort: AbortController;
}

type MarketArchiveType = "zip" | "7z";

function toTaskId(gameId: string, version: string): string {
  return `${gameId}@${version}`;
}

const ACTIVE_STATUSES: MarketTaskStatus[] = [
  "idle",
  "downloading",
  "verifying",
  "extracting",
  "installing",
];

const PAUSABLE_STATUSES: MarketTaskStatus[] = ["downloading", "verifying"];

const TERMINAL_STATUSES: MarketTaskStatus[] = [
  "completed",
  "error",
  "canceled",
];

function now(): number {
  return Date.now();
}

function classifyErrorCode(error: unknown): MarketErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("fetch failed") ||
    message.includes("getaddrinfo") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENOTFOUND")
  ) {
    return "network";
  }
  if (
    message.includes("market_download_size_mismatch") ||
    message.includes("market_download_sha256_mismatch")
  ) {
    return "verify";
  }
  if (message.includes("market_manifest")) {
    return "manifest";
  }
  if (message.includes("market_download_aborted")) {
    return "download";
  }
  if (message.includes("market_download")) {
    return "download";
  }
  if (
    message.includes("market_extract") ||
    message.includes("market_archive")
  ) {
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
    fs.rmSync(targetPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
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

function parseGitHubReleaseUrl(
  url: string,
): { owner: string; repo: string; tag: string; assetName: string } | null {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/,
  );
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
    tag: match[3],
    assetName: decodeURIComponent(match[4]),
  };
}

async function resolveGitHubAssetInfo(
  downloadUrl: string,
): Promise<{ sha256?: string; size: number }> {
  const parsed = parseGitHubReleaseUrl(downloadUrl);
  if (!parsed) throw new Error("market_not_github_release_url");

  const apiUrl = `${GITHUB_API_BASE}repos/${parsed.owner}/${parsed.repo}/releases/tags/${parsed.tag}`;
  const response = await fetch(apiUrl, {
    headers: requestInterceptor.buildHeaders(apiUrl, {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    }),
  });

  if (!response.ok) {
    throw new Error(`market_github_api_failed:${response.status}`);
  }

  const release = (await response.json()) as {
    assets?: Array<{ name: string; size: number; digest?: string }>;
  };

  const asset = release.assets?.find((a) => a.name === parsed.assetName);
  if (!asset) throw new Error("market_github_asset_not_found");

  const digest = asset.digest?.replace(/^sha256:/i, "") || "";
  const sha256 =
    digest.length === 64 && /^[a-fA-F0-9]+$/.test(digest) ? digest : undefined;

  return { sha256, size: asset.size };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function get7zaPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "7za", "7za.exe");
  }
  return path7za;
}

async function extractArchiveFile(
  archivePath: string,
  destinationPath: string,
): Promise<void> {
  await ensureDir(destinationPath);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      get7zaPath(),
      ["x", archivePath, `-o${destinationPath}`, "-y"],
      {
        stdio: "ignore",
      },
    );

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

async function resolveExtractedImportDir(
  extractRoot: string,
): Promise<string | null> {
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
  constructor(
    private readonly catalogClient: Pick<
      MarketCatalogClient,
      "fetchOfficialCatalog" | "fetchExternalIndex"
    > = marketCatalogClient,
  ) {}

  private readonly tasks = new Map<string, ActiveTask>();
  private officialCatalogCache: OfficialMarketCatalog | null = null;
  private officialCatalogInFlight: Promise<OfficialMarketCatalog> | null = null;
  private externalIndexCache = new Map<
    string,
    { index: MarketIndex; at: number }
  >();
  private externalIndexInFlight = new Map<string, Promise<MarketIndex>>();
  private cachedImages = new Map<string, { dataUrl: string; at: number }>();
  private resolvedAssets = new Map<
    string,
    { sha256?: string; size: number; at: number }
  >();
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000;
  private static readonly IMAGE_FETCH_TIMEOUT_MS = 15_000;

  // ── Snapshot persistence ──

  private get pendingTasksFile(): string {
    return path.join(
      app.getPath("userData"),
      ".market-cache",
      "pending-tasks.json",
    );
  }

  private async loadSnapshots(): Promise<DownloadTaskSnapshot[]> {
    try {
      const raw = await fsp.readFile(this.pendingTasksFile, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* file not found or corrupt */
    }
    return [];
  }

  private async saveSnapshots(
    snapshots: DownloadTaskSnapshot[],
  ): Promise<void> {
    await ensureDir(path.dirname(this.pendingTasksFile));
    await fsp.writeFile(
      this.pendingTasksFile,
      JSON.stringify(snapshots, null, 2),
    );
  }

  private async writeSnapshot(
    taskId: string,
    bytesReceived: number,
    status: "paused" | "interrupted",
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const { meta } = task;
    const snapshot: DownloadTaskSnapshot = {
      taskId,
      gameId: meta.gameId,
      version: meta.version,
      gameName: meta.gameName,
      sourceIdx: meta.sourceIdx,
      downloadUrl: meta.catalogDownloadUrl,
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

  private lastFloatBallEmitTime = 0;
  private floatBallEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastMarketEmitTimes = new Map<string, number>();
  private readonly marketEmitTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingMarketStates = new Map<string, MarketTaskState>();
  private static readonly FLOAT_BALL_THROTTLE_MS = 100;
  private static readonly MARKET_EVENT_THROTTLE_MS = 100;

  // ── State transitions (single source of truth) ──

  private emit(state: MarketTaskState, forceMarketEvent = false): void {
    this.emitMarketEvent(state, forceMarketEvent);
    this.emitFloatBallProgress(false);
  }

  private emitMarketEvent(
    state: MarketTaskState,
    forceMarketEvent: boolean,
  ): void {
    const taskId = state.taskId;
    const send = (nextState: MarketTaskState): void => {
      const window = mainWindow;
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
      }
      this.lastMarketEmitTimes.set(taskId, now());
      window.webContents.send(IPC.MARKET_EVENT, { task: nextState });
    };

    const timer = this.marketEmitTimers.get(taskId);
    if (forceMarketEvent) {
      if (timer) clearTimeout(timer);
      this.marketEmitTimers.delete(taskId);
      this.pendingMarketStates.delete(taskId);
      send(state);
      return;
    }

    const elapsed = now() - (this.lastMarketEmitTimes.get(taskId) ?? 0);
    if (elapsed >= MarketService.MARKET_EVENT_THROTTLE_MS) {
      if (timer) clearTimeout(timer);
      this.marketEmitTimers.delete(taskId);
      this.pendingMarketStates.delete(taskId);
      send(state);
      return;
    }

    this.pendingMarketStates.set(taskId, { ...state });
    if (timer) return;

    this.marketEmitTimers.set(
      taskId,
      setTimeout(() => {
        this.marketEmitTimers.delete(taskId);
        const pendingState = this.pendingMarketStates.get(taskId);
        this.pendingMarketStates.delete(taskId);
        if (pendingState) send(pendingState);
      }, MarketService.MARKET_EVENT_THROTTLE_MS - elapsed),
    );
  }

  private clearTaskEmission(taskId: string): void {
    const timer = this.marketEmitTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this.marketEmitTimers.delete(taskId);
    this.pendingMarketStates.delete(taskId);
    this.lastMarketEmitTimes.delete(taskId);
  }

  private emitFloatBallProgress(force = false): void {
    const window = floatBallWindow;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      if (this.floatBallEmitTimer) {
        clearTimeout(this.floatBallEmitTimer);
        this.floatBallEmitTimer = null;
      }
      return;
    }

    const progress = this.computeTotalProgress();

    // Window visibility must follow the live task state immediately. Terminal
    // tasks intentionally remain in `tasks` for the main UI's history, but
    // must never keep the float ball visible.
    if (progress.activeTaskCount > 0) {
      if (!window.isVisible()) window.showInactive();
    } else if (window.isVisible()) {
      window.hide();
    }

    const now_ = now();
    const elapsed = now_ - this.lastFloatBallEmitTime;
    const shouldEmitImmediately =
      force ||
      progress.activeTaskCount === 0 ||
      elapsed >= MarketService.FLOAT_BALL_THROTTLE_MS;

    if (shouldEmitImmediately) {
      if (this.floatBallEmitTimer) {
        clearTimeout(this.floatBallEmitTimer);
        this.floatBallEmitTimer = null;
      }
      this.lastFloatBallEmitTime = now_;
      window.webContents.send(IPC.MARKET_FLOAT_BALL_EVENT, progress);
      return;
    }

    // Keep one trailing update. A leading-edge-only throttle can lose the
    // final state when a small download starts and finishes inside one window.
    if (this.floatBallEmitTimer) return;
    this.floatBallEmitTimer = setTimeout(() => {
      this.floatBallEmitTimer = null;
      this.emitFloatBallProgress(true);
    }, MarketService.FLOAT_BALL_THROTTLE_MS - elapsed);
  }

  private getTaskWeight(task: ActiveTask): number {
    return task.state.totalBytes || task.meta.size || 0;
  }

  computeTotalProgress(): FloatBallProgress {
    let weightedProgressSum = 0;
    let totalWeight = 0;
    let activeTaskCount = 0;
    let completedTaskCount = 0;
    let totalTaskCount = 0;

    for (const task of this.tasks.values()) {
      if (TERMINAL_STATUSES.includes(task.state.status)) {
        if (task.state.status === "completed") {
          completedTaskCount++;
        }
        totalTaskCount++;
        continue;
      }
      totalTaskCount++;
      activeTaskCount++;
      const weight = this.getTaskWeight(task);
      if (weight > 0) {
        weightedProgressSum +=
          Math.max(0, Math.min(100, task.state.progress)) * weight;
        totalWeight += weight;
      }
    }

    const totalProgress =
      totalWeight === 0
        ? 0
        : Math.min(100, Math.round(weightedProgressSum / totalWeight));

    return {
      totalProgress,
      activeTaskCount,
      completedTaskCount,
      totalTaskCount,
    };
  }

  getAllTaskStates(): MarketTaskState[] {
    const states: MarketTaskState[] = [];
    for (const task of this.tasks.values()) {
      states.push({ ...task.state });
    }
    return states;
  }

  private tickProgress(taskId: string, progress: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.state = {
      ...task.state,
      progress: Math.max(task.state.progress, progress),
      updatedAt: now(),
    };
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
  private transition(
    taskId: string,
    status: MarketTaskStatus,
    extra?: Partial<MarketTaskState>,
  ): MarketTaskState | null {
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
    this.emit(task.state, current !== status);
    return task.state;
  }

  // ── Task lifecycle ──

  private startTask(
    taskId: string,
    meta: TaskMeta,
    initial?: Partial<MarketTaskState>,
  ): MarketTaskState {
    const timestamp = now();
    const state: MarketTaskState = {
      taskId,
      gameId: meta.gameId,
      version: meta.version,
      gameName: meta.gameName,
      sourceIdx: meta.sourceIdx,
      status: "idle",
      progress: 0,
      ...initial,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const abort = new AbortController();
    this.tasks.set(taskId, { state, meta, abort });
    this.emit(state, true);
    return state;
  }

  private startPipeline(
    taskId: string,
    game: MarketGame,
    targetVersion: MarketGameVersion,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.runPipeline(taskId, game, targetVersion, task.abort.signal).catch(
      (error) => {
        if (task.abort.signal.aborted) return;
        logger.error("[MarketService] Pipeline error", error);
        const msg = error instanceof Error ? error.message : String(error);
        this.transition(taskId, "error", {
          error: msg,
          errorCode: classifyErrorCode(error),
          progress: 0,
        });
        this.finalize(taskId);
      },
    );
  }

  private async finalize(
    taskId: string,
    removeTaskImmediately = false,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const { downloadPath } = task.meta;
    const cacheRoot = path.join(app.getPath("userData"), ".market-cache");
    const extractRoot = path.join(
      cacheRoot,
      "extract",
      `${task.meta.gameId}-${task.meta.version}`,
    );
    if (removeTaskImmediately) {
      this.tasks.delete(taskId);
      this.clearTaskEmission(taskId);
      this.emitFloatBallProgress(true);
      await Promise.all([
        removeIfExists(downloadPath).catch(() => undefined),
        removeIfExists(extractRoot).catch(() => undefined),
      ]);
      return;
    }

    await Promise.all([
      removeIfExists(downloadPath).catch(() => undefined),
      removeIfExists(extractRoot).catch(() => undefined),
    ]);

    setTimeout(() => {
      this.tasks.delete(taskId);
      this.clearTaskEmission(taskId);
      this.emitFloatBallProgress(true);
    }, 30_000);
  }

  getTaskState(taskId: string): MarketTaskState | null {
    return this.tasks.get(taskId)?.state ?? null;
  }

  getPendingTasks(): Promise<DownloadTaskSnapshot[]> {
    return this.loadSnapshots();
  }

  async resolveAssetInfo(
    downloadUrl: string,
  ): Promise<{ sha256?: string; size?: number }> {
    const cached = this.resolvedAssets.get(downloadUrl);
    if (cached && Date.now() - cached.at < MarketService.CACHE_TTL_MS) {
      return { sha256: cached.sha256, size: cached.size };
    }
    if (!isGitHubReleaseUrl(downloadUrl)) return {};
    try {
      const info = await withRetry(
        () => resolveGitHubAssetInfo(downloadUrl),
        5,
        1000,
      );
      this.resolvedAssets.set(downloadUrl, { ...info, at: Date.now() });
      return info;
    } catch {
      return {};
    }
  }

  // ── Public API: pause / resume / cancel ──

  async pauseTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (!PAUSABLE_STATUSES.includes(task.state.status)) return false;

    const bytesReceived = task.state.bytesReceived || 0;

    // CRITICAL: set status BEFORE abort, so the pipeline's catch block
    // sees "paused" and silently returns without overwriting state.
    this.transition(taskId, "paused", {
      bytesReceived,
      totalBytes: task.state.totalBytes || task.meta.size,
    });
    this.emitFloatBallProgress(true);
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
    const targetVersion = game?.versions.find(
      (item) => item.version === snap.version,
    );
    if (!game || !targetVersion) {
      await this.removeSnapshot(taskId);
      throw new Error("market_version_not_found");
    }

    const record = await GameLoader.getGameRecord(snap.gameId);
    if (game.type === GameType.NetworkGame) {
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

    const meta: TaskMeta = {
      gameId: game.id,
      version: targetVersion.version,
      gameName: game.name,
      downloadUrl: resolveMarketDownloadUrl(snap.downloadUrl),
      catalogDownloadUrl: snap.downloadUrl,
      sha256: snap.sha256,
      size: snap.size,
      downloadPath: snap.downloadPath,
      archiveType: snap.archiveType,
      sourceIdx: snap.sourceIdx,
      marketId: index.marketId,
    };

    const state = this.startTask(taskId, meta, {
      progress:
        snap.size > 0
          ? Math.min(65, Math.round((snap.bytesReceived / snap.size) * 65))
          : 0,
      bytesReceived: snap.bytesReceived,
      totalBytes: snap.size,
    });
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
        gameName: snap.gameName || snap.gameId,
        sourceIdx: snap.sourceIdx,
        status: "interrupted",
        progress:
          snap.size > 0
            ? Math.min(65, Math.round((snap.bytesReceived / snap.size) * 65))
            : 0,
        bytesReceived: snap.bytesReceived,
        totalBytes: snap.size,
        createdAt: snap.updatedAt,
        updatedAt: now(),
      };
      // Placeholder meta — will be replaced on resume
      const meta: TaskMeta = {
        gameId: snap.gameId,
        version: snap.version,
        gameName: snap.gameId,
        downloadUrl: snap.downloadUrl,
        catalogDownloadUrl: snap.downloadUrl,
        sha256: snap.sha256,
        size: snap.size,
        downloadPath: snap.downloadPath,
        archiveType: snap.archiveType,
        sourceIdx: snap.sourceIdx,
        marketId: "",
      };
      const abort = new AbortController();
      this.tasks.set(snap.taskId, { state, meta, abort });
      this.emit(state, true);
    }
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.state.status === "paused" || task.state.status === "interrupted") {
      this.removeSnapshot(taskId).catch(() => undefined);
      this.transition(taskId, "canceled");
      this.finalize(taskId, true);
      return true;
    }

    if (!ACTIVE_STATUSES.includes(task.state.status)) return false;

    this.transition(taskId, "canceled");
    task.abort.abort();
    this.finalize(taskId, true);
    return true;
  }

  async dismissTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || !TERMINAL_STATUSES.includes(task.state.status)) return false;
    await this.finalize(taskId, true);
    return true;
  }

  // ── Public API: start download ──

  async downloadAndInstall(
    gameId: string,
    version: string,
    sourceIdx: number,
  ): Promise<MarketTaskState> {
    const taskId = toTaskId(gameId, version);
    const existing = this.tasks.get(taskId)?.state;
    if (
      existing &&
      [...ACTIVE_STATUSES, "paused", "interrupted"].includes(existing.status)
    ) {
      return existing;
    }

    const index = await this.getIndex(sourceIdx);
    const game = index.games.find((item) => item.id === gameId);
    const targetVersion = game?.versions.find(
      (item) => item.version === version,
    );
    if (!game || !targetVersion) throw new Error("market_version_not_found");

    const currentVersion = app.getVersion();
    if (!semver.satisfies(currentVersion, targetVersion.platformVersion)) {
      throw new Error("market_platform_version_mismatch");
    }

    const record = await GameLoader.getGameRecord(gameId);
    if (game.type === GameType.NetworkGame) {
      if (record) {
        throw new Error("market_version_already_installed");
      }
    } else if (record?.versions.some((item) => item.version === version)) {
      throw new Error("market_version_already_installed");
    }

    const cacheRoot = path.join(app.getPath("userData"), ".market-cache");
    const resolvedDownloadUrl = resolveMarketDownloadUrl(
      targetVersion.downloadUrl,
    );
    const archiveType = inferArchiveType(resolvedDownloadUrl);
    const downloadPath = path.join(
      cacheRoot,
      "downloads",
      `${game.id}-${targetVersion.version}.${archiveType}`,
    );

    let sha256 = targetVersion.sha256;
    let size = targetVersion.size;

    if (!sha256 || size == null) {
      const cached = this.resolvedAssets.get(targetVersion.downloadUrl);
      if (cached && Date.now() - cached.at < MarketService.CACHE_TTL_MS) {
        sha256 = sha256 ?? cached.sha256;
        size = size ?? cached.size;
      }
    }

    const isGitHub = isGitHubReleaseUrl(targetVersion.downloadUrl);

    if (size == null && isGitHub) {
      try {
        const info = await resolveGitHubAssetInfo(targetVersion.downloadUrl);
        size = info.size;
        sha256 = sha256 ?? info.sha256;
        this.resolvedAssets.set(targetVersion.downloadUrl, {
          sha256: info.sha256,
          size: info.size,
          at: Date.now(),
        });
      } catch {
        /* ignore resolution failure, will be caught below */
      }
    }

    if (size == null) {
      throw new Error("market_missing_size");
    }

    const meta: TaskMeta = {
      gameId: game.id,
      version: targetVersion.version,
      gameName: game.name,
      downloadUrl: resolvedDownloadUrl,
      catalogDownloadUrl: targetVersion.downloadUrl,
      sha256,
      size,
      downloadPath,
      archiveType,
      sourceIdx,
      marketId: index.marketId,
    };
    const state = this.startTask(taskId, meta);
    this.startPipeline(taskId, game, targetVersion);
    return state;
  }

  private isFresh(timestamp: number): boolean {
    return Date.now() - timestamp < MarketService.CACHE_TTL_MS;
  }

  private pruneExternalIndexCache(directory: MarketDirectory): void {
    const activeKeys = new Set(
      directory.sources.slice(1).map(getMarketSourceKey),
    );
    for (const key of this.externalIndexCache.keys()) {
      if (!activeKeys.has(key)) this.externalIndexCache.delete(key);
    }
  }

  private async getOfficialCatalog(
    forceRefresh: boolean,
  ): Promise<OfficialMarketCatalog> {
    if (
      !forceRefresh &&
      this.officialCatalogCache &&
      this.isFresh(this.officialCatalogCache.fetchedAt)
    ) {
      return this.officialCatalogCache;
    }
    if (this.officialCatalogInFlight) return this.officialCatalogInFlight;

    const request = this.catalogClient.fetchOfficialCatalog();
    this.officialCatalogInFlight = request;
    try {
      const catalog = await request;
      this.officialCatalogCache = catalog;
      this.pruneExternalIndexCache(catalog.directory);
      return catalog;
    } finally {
      if (this.officialCatalogInFlight === request) {
        this.officialCatalogInFlight = null;
      }
    }
  }

  async getSources(forceRefresh = false): Promise<MarketDirectory> {
    if (forceRefresh) this.cachedImages.clear();
    return (await this.getOfficialCatalog(forceRefresh)).directory;
  }

  async getIndex(
    sourceIdx: number,
    forceRefresh = false,
  ): Promise<MarketIndex> {
    if (!Number.isInteger(sourceIdx) || sourceIdx < 0) {
      throw new Error("market_source_not_found");
    }
    if (forceRefresh) this.cachedImages.clear();

    const catalog = await this.getOfficialCatalog(forceRefresh);
    const source = catalog.directory.sources[sourceIdx];
    if (!source) throw new Error("market_source_not_found");
    if (sourceIdx === 0) return catalog.index;

    const key = getMarketSourceKey(source);
    const cached = this.externalIndexCache.get(key);
    if (!forceRefresh && cached && this.isFresh(cached.at)) {
      return cached.index;
    }
    const inFlight = this.externalIndexInFlight.get(key);
    if (inFlight) return inFlight;

    const request = this.catalogClient.fetchExternalIndex(source);
    this.externalIndexInFlight.set(key, request);
    try {
      const index = await request;
      if (index.marketId !== source.marketId) {
        throw new Error(
          `market_id_mismatch:expected=${source.marketId};actual=${index.marketId}`,
        );
      }
      const isCurrentSource = this.officialCatalogCache?.directory.sources
        .slice(1)
        .some((currentSource) => getMarketSourceKey(currentSource) === key);
      if (isCurrentSource) {
        this.externalIndexCache.set(key, { index, at: Date.now() });
      }
      return index;
    } finally {
      if (this.externalIndexInFlight.get(key) === request) {
        this.externalIndexInFlight.delete(key);
      }
    }
  }

  async getCachedImageDataUrl(url: string): Promise<string> {
    const now = Date.now();
    const cached = this.cachedImages.get(url);
    if (cached && now - cached.at < MarketService.CACHE_TTL_MS) {
      return cached.dataUrl;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      MarketService.IMAGE_FETCH_TIMEOUT_MS,
    );

    try {
      const resolvedUrl = resolveMarketImageUrl(url);
      const response = await fetch(resolvedUrl, {
        headers: requestInterceptor.buildHeaders(resolvedUrl),
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
    const extractRoot = path.join(
      cacheRoot,
      "extract",
      `${game.id}-${targetVersion.version}`,
    );

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

    await this.installGame(
      taskId,
      game,
      targetVersion,
      extractRoot,
      meta.marketId,
      signal,
    );

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
    const headers: Record<string, string> = requestInterceptor.buildHeaders(
      meta.downloadUrl,
      {
        "Cache-Control": "no-cache",
      },
    );

    let isResuming = false;
    if (partialSize > 0 && partialSize < meta.size) {
      headers["Range"] = `bytes=${partialSize}-`;
      isResuming = true;
    }

    this.transition(taskId, "downloading", {
      progress: isResuming
        ? Math.min(65, Math.round((partialSize / meta.size) * 65))
        : 0,
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
        this.transition(taskId, "downloading", {
          progress: 0,
          bytesReceived: 0,
        });
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
              progress: meta.size
                ? Math.min(65, Math.round((received / meta.size) * 65))
                : 0,
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
      if (meta.size > 0 && stat.size !== meta.size)
        throw new Error("market_download_size_mismatch");

      if (meta.sha256) {
        const computed = await computeSha256(meta.downloadPath);
        if (computed.toLowerCase() !== meta.sha256.toLowerCase()) {
          throw new Error("market_download_sha256_mismatch");
        }
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

    const entry =
      gm.entry ||
      (() => {
        try {
          return GameLoader.detectEntryFile(importDir);
        } catch {
          return "";
        }
      })();

    if (!entry) {
      throw new Error("market_manifest_entry_required");
    }

    const type = gm.type || game.type;
    const needsMultiplayer =
      type === GameType.Multiplayer || type === GameType.SingleMultiple;

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
      multiplayer:
        gm.multiplayer ||
        (needsMultiplayer && game.minPlayers != null
          ? {
              minPlayers: game.minPlayers,
              maxPlayers: game.maxPlayers || game.minPlayers,
            }
          : undefined),
      args: gm.args,
      env: gm.env,
      windowedFullscreen: gm.windowedFullscreen,
      achievements: gm.achievements,
    });
  }

  private async installGame(
    taskId: string,
    game: MarketGame,
    targetVersion: MarketGameVersion,
    extractRoot: string,
    marketId: string,
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
        const builtManifest = this.buildManifestFromMarket(
          game,
          targetVersion,
          importDir,
        );
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
      if (
        game.type !== GameType.NetworkGame &&
        manifest.version !== targetVersion.version
      ) {
        throw new Error("market_manifest_mismatch");
      }

      const currentVersion = app.getVersion();
      let manifestVersionOk = false;
      if (Array.isArray(manifest.platformVersion)) {
        const [min, max] = manifest.platformVersion;
        manifestVersionOk =
          semver.gte(currentVersion, min) && semver.lte(currentVersion, max);
      } else {
        manifestVersionOk = semver.satisfies(
          currentVersion,
          manifest.platformVersion,
        );
      }
      if (!manifestVersionOk) {
        throw new Error("market_platform_version_manifest_mismatch");
      }

      this.transition(taskId, "installing", { installStarted: true });
      const result = await GameLoader.loadGameFromPath(
        importDir,
        {
          installSource: "market",
          marketId,
        },
        {
          signal,
          onProgress: (progress) => {
            if (progress.phase !== "copying") return;
            const ratio =
              progress.totalBytes > 0
                ? progress.processedBytes / progress.totalBytes
                : 1;
            this.tickProgress(taskId, 95 + Math.min(1, ratio) * 4);
          },
        },
      );
      if (!result.success || !result.manifest) {
        throw new Error(result.error || "market_install_failed");
      }
    } finally {
      stopSim();
    }
  }
}

export const marketService = new MarketService();
