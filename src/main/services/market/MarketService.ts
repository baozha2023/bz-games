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
  parseGameManifest,
  type GameManifest,
} from "../../../shared/game-manifest";
import {
  GameType,
  isGitHubReleaseUrl,
  type DownloadTaskSnapshot,
  type FloatBallProgress,
  type GameManifestOverride,
  type MarketErrorCode,
  type MarketDirectory,
  type MarketIndex,
  type RawMarketIndex,
  type RawMarketGame,
  type RawMarketGameVersion,
  type MarketTaskState,
  type MarketTaskStatus,
  resolveMarketIndex,
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
  MarketCatalogError,
  type MarketCatalogClient,
  type OfficialMarketCatalog,
} from "./MarketCatalogClient";
import { backupActivityGuard } from "../backup/BackupActivityGuard";
import { lifecycleOperationGuard } from "../system/LifecycleOperationGuard";
import { storeService } from "../storage/StoreService";
import { writeEncryptedGameManifestFile } from "../game/GameManifestFileService";
import { MarketCacheCleaner } from "./MarketCacheCleaner";
import { canTransitionMarketTask } from "./MarketTaskStateMachine";

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
    message.includes("market_cache_cleanup") ||
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
    const stat = await fsp.lstat(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

async function assertDownloadSpaceAvailable(
  downloadPath: string,
  totalBytes: number,
): Promise<void> {
  if (totalBytes <= 0) return;
  const downloadDirectory = path.dirname(downloadPath);
  await ensureDir(downloadDirectory);
  const partialBytes = Math.min(
    totalBytes,
    await getPartialFileSize(downloadPath),
  );
  const requiredBytes = BigInt(totalBytes - partialBytes);
  if (requiredBytes === 0n) return;
  const stats = await fsp.statfs(downloadDirectory);
  const availableBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
  if (availableBytes < requiredBytes) {
    throw new Error(
      `market_insufficient_disk_space:${requiredBytes}:${availableBytes}`,
    );
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
  private readonly cacheCleaner = new MarketCacheCleaner();
  private officialCatalogCache: OfficialMarketCatalog | null = null;
  private officialCatalogInFlight: Promise<OfficialMarketCatalog> | null = null;
  private externalIndexCache = new Map<
    string,
    { index: RawMarketIndex; at: number }
  >();
  private externalIndexInFlight = new Map<string, Promise<RawMarketIndex>>();
  private cachedImages = new Map<string, { dataUrl: string; at: number }>();
  private resolvedAssets = new Map<
    string,
    { sha256?: string; size: number; at: number }
  >();
  private static readonly CACHE_TTL_MS = 60 * 60 * 1000;
  private static readonly IMAGE_FETCH_TIMEOUT_MS = 15_000;

  hasRetainedTasks(): boolean {
    return Array.from(this.tasks.values()).some((task) =>
      [...ACTIVE_STATUSES, "paused", "interrupted"].includes(task.state.status),
    );
  }

  clearMemoryCaches(): void {
    this.officialCatalogCache = null;
    this.externalIndexCache.clear();
    this.cachedImages.clear();
    this.resolvedAssets.clear();
  }

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
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (snapshot): snapshot is DownloadTaskSnapshot =>
            !!snapshot &&
            typeof snapshot === "object" &&
            typeof snapshot.marketId === "string" &&
            snapshot.marketId.length > 0,
        );
      }
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
      marketId: meta.marketId,
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
    if (!task || !ACTIVE_STATUSES.includes(task.state.status)) return;
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

  /** The only status mutation entry point. */
  private transition(
    taskId: string,
    status: MarketTaskStatus,
    extra?: Partial<MarketTaskState>,
  ): MarketTaskState | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.error("[MarketService] Rejected transition for missing task", {
        taskId,
        next: status,
      });
      return null;
    }
    const current = task.state.status;

    if (!canTransitionMarketTask(current, status)) {
      logger.error("[MarketService] Rejected illegal task transition", {
        taskId,
        current,
        next: status,
      });
      return null;
    }

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
      marketId: meta.marketId,
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
    game: RawMarketGame,
    targetVersion: RawMarketGameVersion,
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
        this.cacheCleaner.reclaim(downloadPath),
        this.cacheCleaner.reclaim(extractRoot),
      ]);
      return;
    }

    await Promise.all([
      this.cacheCleaner.reclaim(downloadPath),
      this.cacheCleaner.reclaim(extractRoot),
    ]);

    setTimeout(() => {
      if (this.tasks.get(taskId) !== task) return;
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
    if (
      backupActivityGuard.isActive() ||
      lifecycleOperationGuard.blocksNewActivity()
    ) {
      throw new Error("migration_export_in_progress");
    }
    const snapshots = await this.loadSnapshots();
    const snap = snapshots.find((s) => s.taskId === taskId);
    if (!snap) return null;

    const existing = this.tasks.get(taskId);
    if (existing && ACTIVE_STATUSES.includes(existing.state.status)) {
      return existing.state;
    }

    // Validate the snapshot is still valid
    const rawIndex = await this.getRawIndex(snap.marketId, false);
    const game = rawIndex.games.find((item) => item.id === snap.gameId);
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

    const localizedIndex = resolveMarketIndex(
      rawIndex,
      storeService.getSettings().language,
    );
    const localizedGame = localizedIndex.games.find(
      (item) => item.id === snap.gameId,
    )!;
    const meta: TaskMeta = {
      gameId: game.id,
      version: targetVersion.version,
      gameName: localizedGame.name,
      downloadUrl: resolveMarketDownloadUrl(snap.downloadUrl),
      catalogDownloadUrl: snap.downloadUrl,
      sha256: snap.sha256,
      size: snap.size,
      downloadPath: snap.downloadPath,
      archiveType: snap.archiveType,
      marketId: rawIndex.marketId,
    };
    await assertDownloadSpaceAvailable(meta.downloadPath, meta.size);
    if (
      backupActivityGuard.isActive() ||
      lifecycleOperationGuard.blocksNewActivity()
    ) {
      throw new Error("migration_export_in_progress");
    }

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
        marketId: snap.marketId,
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
        marketId: snap.marketId,
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
    marketId: string,
  ): Promise<MarketTaskState> {
    if (
      backupActivityGuard.isActive() ||
      lifecycleOperationGuard.blocksNewActivity()
    ) {
      throw new Error("migration_export_in_progress");
    }
    const taskId = toTaskId(gameId, version);
    const existing = this.tasks.get(taskId)?.state;
    if (
      existing &&
      [...ACTIVE_STATUSES, "paused", "interrupted"].includes(existing.status)
    ) {
      return existing;
    }

    const rawIndex = await this.getRawIndex(marketId, false);
    const game = rawIndex.games.find((item) => item.id === gameId);
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
    const manifestOnly =
      game.type === GameType.NetworkGame &&
      !targetVersion.downloadUrl &&
      !!targetVersion.gameManifest;
    const resolvedDownloadUrl = targetVersion.downloadUrl
      ? resolveMarketDownloadUrl(targetVersion.downloadUrl)
      : "";
    const archiveType = manifestOnly
      ? "zip"
      : inferArchiveType(resolvedDownloadUrl);
    const downloadPath = path.join(
      cacheRoot,
      "downloads",
      `${game.id}-${targetVersion.version}.${archiveType}`,
    );

    let sha256 = targetVersion.sha256;
    let size = manifestOnly ? 0 : targetVersion.size;
    const catalogDownloadUrl = targetVersion.downloadUrl;

    if (!manifestOnly && catalogDownloadUrl && (!sha256 || size == null)) {
      const cached = this.resolvedAssets.get(catalogDownloadUrl);
      if (cached && Date.now() - cached.at < MarketService.CACHE_TTL_MS) {
        sha256 = sha256 ?? cached.sha256;
        size = size ?? cached.size;
      }
    }

    const isGitHub = catalogDownloadUrl
      ? isGitHubReleaseUrl(catalogDownloadUrl)
      : false;

    if (size == null && isGitHub) {
      try {
        const info = await resolveGitHubAssetInfo(catalogDownloadUrl!);
        size = info.size;
        sha256 = sha256 ?? info.sha256;
        this.resolvedAssets.set(catalogDownloadUrl!, {
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

    const localizedIndex = resolveMarketIndex(
      rawIndex,
      storeService.getSettings().language,
    );
    const localizedGame = localizedIndex.games.find(
      (item) => item.id === gameId,
    )!;
    const meta: TaskMeta = {
      gameId: game.id,
      version: targetVersion.version,
      gameName: localizedGame.name,
      downloadUrl: resolvedDownloadUrl,
      catalogDownloadUrl: catalogDownloadUrl || "",
      sha256,
      size,
      downloadPath,
      archiveType,
      marketId: rawIndex.marketId,
    };
    if (!manifestOnly) {
      await assertDownloadSpaceAvailable(downloadPath, size);
    }
    if (
      backupActivityGuard.isActive() ||
      lifecycleOperationGuard.blocksNewActivity()
    ) {
      throw new Error("migration_export_in_progress");
    }
    const state = this.startTask(taskId, meta);
    this.startPipeline(taskId, game, targetVersion);
    return state;
  }

  private isFresh(timestamp: number): boolean {
    return Date.now() - timestamp < MarketService.CACHE_TTL_MS;
  }

  private pruneExternalIndexCache(
    directory: MarketDirectory,
    officialMarketId: string,
  ): void {
    const activeKeys = new Set(
      directory.sources
        .filter(({ marketId }) => marketId !== officialMarketId)
        .map(getMarketSourceKey),
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
      this.pruneExternalIndexCache(catalog.directory, catalog.index.marketId);
      return catalog;
    } finally {
      if (this.officialCatalogInFlight === request) {
        this.officialCatalogInFlight = null;
      }
    }
  }

  async getSources(forceRefresh = false): Promise<MarketDirectory> {
    if (forceRefresh) this.cachedImages.clear();
    const catalog = await this.getOfficialCatalog(forceRefresh);
    const checks = await Promise.all(
      catalog.directory.sources.map(async (source) => {
        if (source.marketId === catalog.index.marketId) return source;
        try {
          await this.getRawExternalIndex(source, forceRefresh);
          return source;
        } catch (error) {
          if (
            error instanceof MarketCatalogError &&
            ["schema", "json", "business"].includes(error.kind)
          ) {
            logger.warn(
              `[MarketService] Hiding incompatible market ${source.marketId}`,
              { kind: error.kind },
            );
            return null;
          }
          return source;
        }
      }),
    );
    return {
      ...catalog.directory,
      sources: checks.filter((source) => source !== null),
    };
  }

  async getIndex(marketId: string, forceRefresh = false): Promise<MarketIndex> {
    const rawIndex = await this.getRawIndex(marketId, forceRefresh);
    return resolveMarketIndex(rawIndex, storeService.getSettings().language);
  }

  private async getRawIndex(
    marketId: string,
    forceRefresh: boolean,
  ): Promise<RawMarketIndex> {
    if (!marketId || typeof marketId !== "string") {
      throw new Error("market_source_not_found");
    }
    if (forceRefresh) this.cachedImages.clear();

    const catalog = await this.getOfficialCatalog(forceRefresh);
    const source = catalog.directory.sources.find(
      (candidate) => candidate.marketId === marketId,
    );
    if (!source) throw new Error("market_source_not_found");
    return source.marketId === catalog.index.marketId
      ? catalog.index
      : await this.getRawExternalIndex(source, forceRefresh);
  }

  private async getRawExternalIndex(
    source: MarketDirectory["sources"][number],
    forceRefresh: boolean,
  ): Promise<RawMarketIndex> {
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
        throw new MarketCatalogError(
          "business",
          "github",
          source.repository,
          undefined,
          {
            cause: new Error(
              `market_id_mismatch:expected=${source.marketId};actual=${index.marketId}`,
            ),
          },
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
    game: RawMarketGame,
    targetVersion: RawMarketGameVersion,
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

    if (!meta.downloadUrl) {
      await this.cacheCleaner.prepare(extractRoot, "extract_preflight");
      await ensureDir(extractRoot);
      signal.throwIfAborted();
      await this.installGame(
        taskId,
        game,
        targetVersion,
        extractRoot,
        meta.marketId,
        signal,
      );
      this.transition(taskId, "completed", { progress: 100 });
      this.finalize(taskId);
      return;
    }

    const partialSize = await getPartialFileSize(meta.downloadPath);
    if (partialSize === 0) {
      await this.cacheCleaner.prepare(
        meta.downloadPath,
        "download_preflight",
      );
    }
    await this.cacheCleaner.prepare(extractRoot, "extract_preflight");

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
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`market_download_request_failed:${response.status}`);
    }
    if (!response.body) throw new Error("market_download_response_empty");

    let received: number;
    let writer: fs.WriteStream;

    if (response.status === 206) {
      writer = fs.createWriteStream(meta.downloadPath, { flags: "a" });
      received = partialSize;
    } else if (response.status === 200) {
      if (isResuming) {
        try {
          await this.cacheCleaner.prepare(meta.downloadPath, "resume_restart");
        } catch (error: unknown) {
          await response.body.cancel().catch(() => undefined);
          throw error;
        }
        this.transition(taskId, "downloading", {
          progress: 0,
          bytesReceived: 0,
        });
      }
      writer = fs.createWriteStream(meta.downloadPath);
      received = 0;
    } else {
      await response.body.cancel().catch(() => undefined);
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
            if (meta.size > 0 && received > meta.size) {
              await reader.cancel();
              throw new Error("market_download_size_mismatch");
            }
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
          writer.destroy();
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
    game: RawMarketGame,
    targetVersion: RawMarketGameVersion,
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

    if ("manifestVersion" in gm && gm.manifestVersion === 2) {
      const v2 = gm as Extract<GameManifestOverride, { manifestVersion: 2 }>;
      const marketLocales = Object.keys(game.localizations);
      const manifestLocales = Object.keys(v2.localizations ?? {});
      if (manifestLocales.some((locale) => !game.localizations[locale])) {
        throw new Error("market_manifest_locale_mismatch");
      }
      return parseGameManifest({
        manifestVersion: 2,
        id: game.id,
        version: targetVersion.version,
        defaultLocale: v2.defaultLocale || game.defaultLocale,
        localizations: Object.fromEntries(
          marketLocales.map((locale) => {
            const localization = game.localizations[locale];
            const manifestLocalization = v2.localizations?.[locale];
            return [
              locale,
              {
                name: manifestLocalization?.name || localization.name,
                description:
                  manifestLocalization?.description || localization.summary,
                achievements: manifestLocalization?.achievements ?? {},
                statistics: manifestLocalization?.statistics ?? {},
              },
            ];
          }),
        ),
        author: v2.author || game.author,
        author_url:
          v2.author_url !== undefined ? v2.author_url : game.author_url,
        platformVersion: v2.platformVersion || targetVersion.platformVersion,
        entry,
        web_url: v2.web_url,
        icon: v2.icon,
        cover: v2.cover,
        video: v2.video,
        encryptLocalStorage: v2.encryptLocalStorage,
        type,
        statistics: v2.statistics ?? [],
        multiplayer:
          v2.multiplayer ||
          (needsMultiplayer && game.minPlayers != null
            ? {
                minPlayers: game.minPlayers,
                maxPlayers: game.maxPlayers || game.minPlayers,
              }
            : undefined),
        args: v2.args,
        env: v2.env,
        windowedFullscreen: v2.windowedFullscreen,
        achievements: v2.achievements ?? [],
      });
    }

    const v1 = gm as Exclude<GameManifestOverride, { manifestVersion: 2 }>;
    const defaultLocalization = game.localizations[game.defaultLocale];
    return parseGameManifest({
      id: game.id,
      name: v1.name || defaultLocalization.name,
      version: targetVersion.version,
      description: v1.description || defaultLocalization.summary,
      author: v1.author || game.author,
      author_url: v1.author_url !== undefined ? v1.author_url : game.author_url,
      platformVersion: v1.platformVersion || targetVersion.platformVersion,
      entry,
      web_url: v1.web_url,
      icon: v1.icon,
      cover: v1.cover,
      video: v1.video,
      encryptLocalStorage: v1.encryptLocalStorage,
      type,
      statistics: v1.statistics,
      multiplayer:
        v1.multiplayer ||
        (needsMultiplayer && game.minPlayers != null
          ? {
              minPlayers: game.minPlayers,
              maxPlayers: game.maxPlayers || game.minPlayers,
            }
          : undefined),
      args: v1.args,
      env: v1.env,
      windowedFullscreen: v1.windowedFullscreen,
      achievements: v1.achievements,
    });
  }

  private async prepareManifestForInstall(
    game: RawMarketGame,
    targetVersion: RawMarketGameVersion,
    importDir: string,
  ): Promise<GameManifest> {
    const manifestPath = path.join(importDir, "game.json");
    if (targetVersion.gameManifest) {
      await fsp.rm(manifestPath, { force: true });
      const manifest = this.buildManifestFromMarket(
        game,
        targetVersion,
        importDir,
      );
      await fsp.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
      return manifest;
    }
    return parseGameManifest(
      JSON.parse(await fsp.readFile(manifestPath, "utf8")),
    );
  }

  private async installGame(
    taskId: string,
    game: RawMarketGame,
    targetVersion: RawMarketGameVersion,
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
      }

      const manifestPath = path.join(importDir, "game.json");
      const manifest = await this.prepareManifestForInstall(
        game,
        targetVersion,
        importDir,
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

      writeEncryptedGameManifestFile(manifestPath, manifest);

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
