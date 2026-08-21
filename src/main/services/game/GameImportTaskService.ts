import { app } from "electron";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import type {
  GameImportStartResult,
  GameImportTaskEvent,
  GameImportTaskState,
} from "../../../shared/types";
import { GameType } from "../../../shared/types";
import { logger } from "../../utils/logger";
import { storeService } from "../storage/StoreService";
import { GameLoader, type ManualManifestDraft } from "./GameLoader";

interface InternalImportTask {
  state: GameImportTaskState;
  draft?: ManualManifestDraft;
  stagingPath: string;
  controller?: AbortController;
  lastProgressAt?: number;
}

interface PersistedImportTask {
  state: GameImportTaskState;
  draft?: ManualManifestDraft;
  stagingPath: string;
}

type TaskListener = (event: GameImportTaskEvent) => void;

const ACTIVE_STATUSES = new Set([
  "queued",
  "validating",
  "scanning",
  "copying",
  "finalizing",
]);

export class GameImportTaskService {
  private readonly tasks = new Map<string, InternalImportTask>();
  private readonly listeners = new Set<TaskListener>();
  private activeCount = 0;
  private persistChain: Promise<void> = Promise.resolve();
  private readonly running = new Set<Promise<void>>();
  private shuttingDown = false;

  private get snapshotPath(): string {
    return path.join(app.getPath("userData"), "pending-import-tasks.json");
  }

  onEvent(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getTasks(): GameImportTaskState[] {
    return Array.from(this.tasks.values())
      .map(({ state }) => ({ ...state }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async restoreTasks(): Promise<void> {
    try {
      const raw = await fsp.readFile(this.snapshotPath, "utf8");
      const persisted = JSON.parse(raw) as PersistedImportTask[];
      for (const item of persisted) {
        if (!item?.state?.taskId || !item.stagingPath) continue;
        if (ACTIVE_STATUSES.has(item.state.status)) {
          if (item.state.status === "finalizing") {
            await GameLoader.cleanupInterruptedImportTarget(
              path.dirname(path.dirname(item.stagingPath)),
              item.state.gameId,
              item.state.version,
              item.state.taskId,
            );
          }
          await this.safeRemoveStaging(item.stagingPath);
          item.state = {
            ...item.state,
            status: "interrupted",
            progress: null,
            error: "interrupted",
            updatedAt: Date.now(),
          };
        }
        item.state.source = "manual";
        if (item.state.status === "canceled") continue;
        this.tasks.set(item.state.taskId, { ...item });
      }
      await this.persist();
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        logger.warn("[GameImport] Failed to restore import tasks", error);
      }
    }
  }

  async startImport(
    sourcePath: string,
    draft?: ManualManifestDraft,
  ): Promise<GameImportStartResult> {
    try {
      const prepared = await GameLoader.prepareGameImport(sourcePath, draft);
      const duplicate = this.hasActiveDuplicate(
        prepared.manifest.id,
        prepared.manifest.version,
        prepared.manifest.type === GameType.NetworkGame,
      );
      if (duplicate) {
        return {
          success: false,
          error:
            prepared.manifest.type === GameType.NetworkGame
              ? "idExists"
              : "versionExists",
          params: {
            id: prepared.manifest.id,
            version: prepared.manifest.version,
          },
        };
      }

      const taskId = crypto.randomUUID();
      const now = Date.now();
      const stagingPath = path.join(
        storeService.getGameStoragePath(),
        ".imports",
        taskId,
      );
      const state: GameImportTaskState = {
        taskId,
        sourcePath: prepared.sourcePath,
        gameId: prepared.manifest.id,
        gameName: prepared.manifest.name,
        version: prepared.manifest.version,
        existingGame: prepared.existingGame,
        source: "manual",
        status: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.tasks.set(taskId, { state, draft, stagingPath });
      this.emit(state);
      await this.persist();
      this.pump();
      return { success: true, task: { ...state } };
    } catch (error) {
      return this.errorResult(error);
    }
  }

  async cancelImport(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || !ACTIVE_STATUSES.has(task.state.status)) return false;
    if (task.state.status === "finalizing") return false;
    const wasQueued = task.state.status === "queued";
    task.controller?.abort();
    this.update(task, { status: "canceled", progress: null });
    if (wasQueued) {
      await this.safeRemoveStaging(task.stagingPath);
    }
    await this.persist();
    setTimeout(() => void this.dismissImport(taskId), 500);
    this.pump();
    return true;
  }

  async retryImport(taskId: string): Promise<GameImportStartResult> {
    const task = this.tasks.get(taskId);
    if (!task || !["failed", "interrupted"].includes(task.state.status)) {
      return { success: false, error: "taskNotRetryable" };
    }
    if (!fs.existsSync(task.state.sourcePath)) {
      this.update(task, { error: "notDirectory", params: undefined });
      await this.persist();
      return { success: false, error: "notDirectory" };
    }
    try {
      const prepared = await GameLoader.prepareGameImport(
        task.state.sourcePath,
        task.draft,
      );
      if (!["failed", "interrupted"].includes(task.state.status)) {
        return { success: false, error: "taskNotRetryable" };
      }
      if (
        this.hasActiveDuplicate(
          prepared.manifest.id,
          prepared.manifest.version,
          prepared.manifest.type === GameType.NetworkGame,
          taskId,
        )
      ) {
        return {
          success: false,
          error:
            prepared.manifest.type === GameType.NetworkGame
              ? "idExists"
              : "versionExists",
        };
      }
      task.state = {
        ...task.state,
        gameId: prepared.manifest.id,
        gameName: prepared.manifest.name,
        version: prepared.manifest.version,
        existingGame: prepared.existingGame,
        status: "queued",
        progress: 0,
        processedBytes: undefined,
        totalBytes: undefined,
        processedFiles: undefined,
        totalFiles: undefined,
        error: undefined,
        params: undefined,
        updatedAt: Date.now(),
      };
      this.emit(task.state);
      await this.persist();
      this.pump();
      return { success: true, task: { ...task.state } };
    } catch (error) {
      const result = this.errorResult(error);
      this.update(task, { error: result.error, params: result.params });
      await this.persist();
      return result;
    }
  }

  async dismissImport(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || ACTIVE_STATUSES.has(task.state.status)) return false;
    this.tasks.delete(taskId);
    await this.safeRemoveStaging(task.stagingPath);
    await this.persist();
    return true;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const task of this.tasks.values()) {
      if (!ACTIVE_STATUSES.has(task.state.status)) continue;
      if (task.state.status === "finalizing") continue;
      task.controller?.abort();
      this.update(task, {
        status: "interrupted",
        progress: null,
        error: "interrupted",
      });
      await this.safeRemoveStaging(task.stagingPath);
    }
    await Promise.allSettled(Array.from(this.running));
    await this.persist();
  }

  private pump(): void {
    if (this.shuttingDown) return;
    while (this.activeCount < 2) {
      const task = Array.from(this.tasks.values()).find(
        ({ state }) => state.status === "queued",
      );
      if (!task) return;
      this.activeCount += 1;
      const running = this.run(task).finally(() => {
        this.activeCount -= 1;
        this.running.delete(running);
        this.pump();
      });
      this.running.add(running);
    }
  }

  private async run(task: InternalImportTask): Promise<void> {
    const controller = new AbortController();
    task.controller = controller;
    this.update(task, { status: "scanning", progress: null });
    await this.persist();

    const onProgress = (progress: {
      phase: "scanning" | "copying" | "finalizing";
      processedBytes: number;
      totalBytes: number;
      processedFiles: number;
      totalFiles: number;
    }): void | Promise<void> => {
      const now = Date.now();
      const shouldEmit =
        progress.phase !== "copying" ||
        now - (task.lastProgressAt || 0) >= 100 ||
        progress.processedBytes >= progress.totalBytes;
      if (!shouldEmit) return undefined;
      task.lastProgressAt = now;
      const phaseChanged = task.state.status !== progress.phase;
      const percentage =
        progress.phase === "copying"
          ? progress.totalBytes > 0
            ? 5 +
              Math.round((progress.processedBytes / progress.totalBytes) * 85)
            : 90
          : progress.phase === "finalizing"
            ? 95
            : null;
      this.update(task, {
        status: progress.phase,
        progress: percentage,
        ...(progress.totalBytes > 0 || progress.phase !== "finalizing"
          ? {
              processedBytes: progress.processedBytes,
              totalBytes: progress.totalBytes,
              processedFiles: progress.processedFiles,
              totalFiles: progress.totalFiles,
            }
          : {}),
      });
      if (phaseChanged) return this.persist();
      return undefined;
    };

    const result = task.draft
      ? await GameLoader.loadGameFromPathWithManifest(
          task.state.sourcePath,
          task.draft,
          {
            taskId: task.state.taskId,
            storagePath: path.dirname(path.dirname(task.stagingPath)),
            signal: controller.signal,
            onProgress,
          },
        )
      : await GameLoader.loadGameFromPath(
          task.state.sourcePath,
          { installSource: "manual", marketId: null },
          {
            taskId: task.state.taskId,
            storagePath: path.dirname(path.dirname(task.stagingPath)),
            signal: controller.signal,
            onProgress,
          },
        );

    task.controller = undefined;
    if (
      task.state.status === "canceled" ||
      task.state.status === "interrupted"
    ) {
      return;
    }
    if (result.success) {
      this.update(task, { status: "completed", progress: 100 });
    } else {
      this.update(task, {
        status: "failed",
        progress: null,
        error: result.error || "unknown",
        params: result.params,
      });
    }
    await this.persist();
  }

  private update(
    task: InternalImportTask,
    patch: Partial<GameImportTaskState>,
  ): void {
    task.state = { ...task.state, ...patch, updatedAt: Date.now() };
    this.emit(task.state);
  }

  private hasActiveDuplicate(
    gameId: string,
    version: string,
    networkGame: boolean,
    excludedTaskId?: string,
  ): boolean {
    return Array.from(this.tasks.values()).some(({ state }) => {
      if (
        state.taskId === excludedTaskId ||
        !ACTIVE_STATUSES.has(state.status)
      ) {
        return false;
      }
      return (
        state.gameId === gameId && (networkGame || state.version === version)
      );
    });
  }

  private emit(state: GameImportTaskState): void {
    const event = { task: { ...state } };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn("[GameImport] Import event listener failed", error);
      }
    }
  }

  private persist(): Promise<void> {
    const snapshot = Array.from(this.tasks.values()).map(
      ({ state, draft, stagingPath }) => ({ state, draft, stagingPath }),
    );
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(async () => {
        await fsp.mkdir(path.dirname(this.snapshotPath), { recursive: true });
        const temporaryPath = `${this.snapshotPath}.tmp`;
        await fsp.writeFile(
          temporaryPath,
          JSON.stringify(snapshot, null, 2),
          "utf8",
        );
        await fsp.rename(temporaryPath, this.snapshotPath);
      })
      .catch((error) => {
        logger.error("[GameImport] Failed to persist import tasks", error);
      });
    return this.persistChain;
  }

  private async safeRemoveStaging(stagingPath: string): Promise<void> {
    const storageRoots = new Set([
      storeService.getGameStoragePath(),
      ...storeService.getGameStorageRoots(),
    ]);
    const allowed = Array.from(storageRoots).some((root) => {
      const importRoot = path.resolve(root, ".imports");
      const relative = path.relative(importRoot, path.resolve(stagingPath));
      return (
        relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative)
      );
    });
    if (!allowed) {
      logger.warn(`[GameImport] Refusing to clean unsafe path: ${stagingPath}`);
      return;
    }
    await fsp.rm(stagingPath, { recursive: true, force: true, maxRetries: 3 });
  }

  private errorResult(error: any): GameImportStartResult {
    if (error?.code) {
      return { success: false, error: error.code, params: error.params };
    }
    logger.error("[GameImport] Import task failed", error);
    return {
      success: false,
      error: "unknown",
      params: { message: error?.message || "Unknown error" },
    };
  }
}

export const gameImportTaskService = new GameImportTaskService();
