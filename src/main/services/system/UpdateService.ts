import { app } from "electron";
import { fork, type ChildProcess } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { UpdateManager, type UpdateInfo } from "velopack";
import { IPC } from "../../../shared/ipc-channels";
import type { UpdateErrorCode, UpdateState } from "../../../shared/types";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { mainWindow } from "../../window";
import { backupActivityGuard } from "../backup/BackupActivityGuard";
import { gameImportTaskService } from "../game/GameImportTaskService";
import { gameManager } from "../game/GameManager";
import { marketService } from "../market/MarketService";
import { bzGamesDatabase } from "../storage/database/BzGamesDatabase";
import { storeService } from "../storage/StoreService";
import { cloudSyncService } from "./CloudSyncService";
import { lifecycleOperationGuard } from "./LifecycleOperationGuard";
import { roomClient } from "../room/RoomClient";
import { roomServer } from "../room/RoomServer";
import {
  createRollbackPoint,
  preserveRollbackPackage,
} from "./UpdateRollbackService";

const UPDATE_FEED_URL =
  "https://github.com/baozha2023/bz-games/releases/latest/download";
const AUTOMATIC_CHECK_DELAY_MS = 30_000;

type WorkerMessage =
  | { type: "progress"; progress: number }
  | { type: "complete" }
  | { type: "error"; message: string };

export class UpdateService {
  private manager: UpdateManager | null = null;
  private availableUpdate: UpdateInfo | null = null;
  private automaticCheckScheduled = false;
  private automaticTimer: NodeJS.Timeout | null = null;
  private downloadWorker: ChildProcess | null = null;
  private state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
  };

  getState(): UpdateState {
    return { ...this.state };
  }

  hasActiveOperation(): boolean {
    return (
      this.downloadWorker !== null ||
      ["checking", "downloading", "verifying", "applying"].includes(
        this.state.status,
      )
    );
  }

  rendererHealthy(): void {
    if (this.automaticCheckScheduled) return;
    this.automaticCheckScheduled = true;
    const suppressed =
      storeService.getSettings().updatePromptSuppressedForAppVersion;
    if (suppressed === app.getVersion()) {
      logger.info(
        "[UpdateService] Automatic check suppressed for this app version",
      );
      return;
    }
    this.automaticTimer = setTimeout(() => {
      this.automaticTimer = null;
      void this.checkForUpdates(true);
    }, AUTOMATIC_CHECK_DELAY_MS);
  }

  suppressForCurrentVersion(): UpdateState {
    storeService.saveSettings({
      updatePromptSuppressedForAppVersion: app.getVersion(),
    });
    return this.getState();
  }

  async checkForUpdates(automatic = false): Promise<UpdateState> {
    if (!this.isSupported()) return this.unsupported(automatic);
    if (lifecycleOperationGuard.blocksNewActivity()) {
      this.setState({
        status: "error",
        errorCode: "task_active",
        message: "update_task_active",
        automatic,
      });
      return this.getState();
    }
    if (this.downloadWorker) return this.getState();
    this.setState({
      status: "checking",
      automatic,
      progress: undefined,
      errorCode: undefined,
      message: undefined,
    });
    try {
      const update = await this.getManager().checkForUpdatesAsync();
      this.availableUpdate = update;
      if (!update) {
        this.setState({
          status: "up_to_date",
          latestVersion: app.getVersion(),
          releaseNotesMarkdown: undefined,
          automatic,
        });
      } else {
        this.setState({
          status: "available",
          latestVersion: update.TargetFullRelease.Version,
          releaseNotesMarkdown: update.TargetFullRelease.NotesMarkdown || "",
          automatic,
        });
      }
    } catch (error) {
      const classified = this.classifyError(error);
      if (automatic) {
        logger.warn("[UpdateService] Automatic update check failed", error);
      } else {
        logger.error("[UpdateService] Manual update check failed", error);
      }
      this.setState({ status: "error", automatic, ...classified });
    }
    return this.getState();
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!this.isSupported()) return this.unsupported(false);
    if (lifecycleOperationGuard.blocksNewActivity()) {
      this.setState({
        status: "error",
        errorCode: "task_active",
        message: "update_task_active",
        automatic: false,
      });
      return this.getState();
    }
    if (!this.availableUpdate) {
      this.setState({
        status: "error",
        errorCode: "feed_invalid",
        message: "update_target_missing",
        automatic: false,
      });
      return this.getState();
    }
    if (this.downloadWorker) return this.getState();
    this.setState({ status: "downloading", progress: 0, automatic: false });
    try {
      await preserveRollbackPackage({
        dataRoot: getAppRoot(),
        sourceVersion: app.getVersion(),
        targetVersion: this.availableUpdate.TargetFullRelease.Version,
      });
      await this.runDownloadWorker(this.availableUpdate);
      this.setState({ status: "verifying", progress: 100 });
      const pending = this.getManager().getUpdatePendingRestart();
      if (
        !pending ||
        pending.Version !== this.availableUpdate.TargetFullRelease.Version
      ) {
        throw new Error("update_download_verification_failed");
      }
      this.setState({ status: "ready", progress: 100 });
    } catch (error) {
      if (this.state.status === "canceled") return this.getState();
      logger.error("[UpdateService] Download failed", error);
      this.setState({ status: "error", ...this.classifyError(error) });
    }
    return this.getState();
  }

  cancelDownload(): UpdateState {
    if (!this.downloadWorker) return this.getState();
    this.downloadWorker.kill();
    this.setState({ status: "canceled", progress: 0, message: undefined });
    return this.getState();
  }

  async applyUpdate(): Promise<UpdateState> {
    if (!this.isSupported()) return this.unsupported(false);
    const pending = this.getManager().getUpdatePendingRestart();
    if (!pending) {
      this.setState({
        status: "error",
        errorCode: "verify_failed",
        message: "update_package_not_ready",
      });
      return this.getState();
    }
    if (this.hasBlockingTask() || !lifecycleOperationGuard.tryBegin("update")) {
      this.setState({
        status: "error",
        errorCode: "task_active",
        message: "update_task_active",
      });
      return this.getState();
    }
    if (!backupActivityGuard.tryBegin()) {
      lifecycleOperationGuard.end("update");
      this.setState({
        status: "error",
        errorCode: "task_active",
        message: "update_task_active",
      });
      return this.getState();
    }
    let databaseSuspended = false;
    try {
      this.setState({ status: "applying", progress: 100 });
      await bzGamesDatabase.suspendForSnapshot();
      databaseSuspended = true;
      await this.prepareUpdateRollback(pending.Version);
      this.getManager().waitExitThenApplyUpdate(pending, false, true, [
        "--bz-handoff-root",
      ]);
      app.quit();
    } catch (error) {
      if (databaseSuspended) bzGamesDatabase.resumeAfterSnapshot();
      backupActivityGuard.end();
      lifecycleOperationGuard.end("update");
      logger.error("[UpdateService] Apply failed", error);
      this.setState({ status: "error", ...this.classifyError(error) });
    }
    return this.getState();
  }

  shutdown(): void {
    if (this.automaticTimer) clearTimeout(this.automaticTimer);
    this.automaticTimer = null;
    if (this.downloadWorker) this.downloadWorker.kill();
    this.downloadWorker = null;
  }

  private isSupported(): boolean {
    return app.isPackaged && process.platform === "win32";
  }

  private getManager(): UpdateManager {
    this.manager ??= new UpdateManager(UPDATE_FEED_URL);
    return this.manager;
  }

  private unsupported(automatic: boolean): UpdateState {
    this.setState({
      status: "unsupported",
      errorCode: "unsupported_dev_mode",
      message: "not_packaged",
      automatic,
    });
    return this.getState();
  }

  private hasBlockingTask(): boolean {
    return (
      gameManager.hasActiveOrLaunchingGames() ||
      gameImportTaskService.hasActiveTasks() ||
      marketService.computeTotalProgress().activeTaskCount > 0 ||
      cloudSyncService.hasActiveOperation() ||
      storeService.hasActiveStorageMigration() ||
      roomServer.hasActiveOperation() ||
      roomClient.hasActiveOperation() ||
      backupActivityGuard.isActive()
    );
  }

  private async prepareUpdateRollback(targetVersion: string): Promise<void> {
    const dataRoot = getAppRoot();
    const stateRoot = path.join(dataRoot, ".runtime", "state");
    await fs.mkdir(stateRoot, { recursive: true });
    await createRollbackPoint({
      dataRoot,
      sourceVersion: app.getVersion(),
      targetVersion,
    });
    const pendingPath = path.join(stateRoot, "pending-update.json");
    const temporaryPath = `${pendingPath}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({
        format: "bz-games-pending-update",
        sourceVersion: app.getVersion(),
        targetVersion,
        failureCount: 0,
        createdAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    await fs.rename(temporaryPath, pendingPath);
  }

  private runDownloadWorker(update: UpdateInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, "updateDownloadWorker.js");
      const worker = fork(workerPath, [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      this.downloadWorker = worker;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (this.downloadWorker === worker) this.downloadWorker = null;
        error ? reject(error) : resolve();
      };
      worker.on("message", (message: WorkerMessage) => {
        if (message.type === "progress") {
          this.setState({
            status: "downloading",
            progress: Math.max(0, Math.min(100, message.progress)),
          });
        } else if (message.type === "complete") {
          finish();
        } else if (message.type === "error") {
          finish(new Error(message.message));
        }
      });
      worker.once("error", (error) => finish(error));
      worker.once("exit", (code, signal) => {
        if (this.state.status === "canceled")
          finish(new Error("update_canceled"));
        else if (code !== 0)
          finish(new Error(`update_worker_exit:${code}:${signal || ""}`));
      });
      worker.send({ type: "download", feedUrl: UPDATE_FEED_URL, update });
    });
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
    };
    try {
      mainWindow?.webContents.send(IPC.SYSTEM_UPDATE_EVENT, this.state);
    } catch (error) {
      logger.warn("[UpdateService] Failed to emit state", error);
    }
  }

  private classifyError(error: unknown): {
    errorCode: UpdateErrorCode;
    message: string;
  } {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (
      /\b404\b/.test(lower) ||
      /releases\.[a-z0-9._-]+\.json/.test(lower) ||
      (/\.nupkg\b/.test(lower) && /not found|missing|404/.test(lower))
    ) {
      return {
        errorCode: "feed_missing",
        message: "velopack_feed_missing",
      };
    }
    if (/network|timeout|econn|socket|http/.test(lower)) {
      return { errorCode: "network_error", message };
    }
    if (/hash|sha|verify|checksum/.test(lower)) {
      return { errorCode: "verify_failed", message };
    }
    if (/access|eperm|eacces|denied/.test(lower)) {
      return { errorCode: "permission_denied", message };
    }
    if (/download|worker/.test(lower)) {
      return { errorCode: "download_failed", message };
    }
    return { errorCode: "unknown", message };
  }
}

export const updateService = new UpdateService();
