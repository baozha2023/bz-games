import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { IPC } from "../../../shared/ipc-channels";
import { mainWindow } from "../../window";
import { logger } from "../../utils/logger";
import { getAppRoot } from "../../utils/appPath";
import type { UpdateErrorCode, UpdateState } from "../../../shared/types";

export class UpdateService {
  private inited = false;
  private snapshotPromises = new Map<string, Promise<string>>();
  private state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
  };

  init() {
    if (this.inited) return;
    this.inited = true;

    autoUpdater.autoDownload = false;
    // Installation is always explicit so snapshot creation cannot be bypassed
    // by quitting the application while an update is ready.
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("checking-for-update", () => {
      this.setState({ status: "checking", message: "" });
    });

    autoUpdater.on("update-available", (info) => {
      this.setState({
        status: "available",
        latestVersion: info.version,
        message: "",
      });
    });

    autoUpdater.on("update-not-available", () => {
      this.setState({
        status: "up_to_date",
        latestVersion: app.getVersion(),
        progress: 100,
        message: "",
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.setState({
        status: "downloading",
        progress: progress.percent,
        message: progress.bytesPerSecond
          ? `${Math.round(progress.bytesPerSecond / 1024)} KB/s`
          : "",
      });
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.setState({
        status: "downloaded",
        latestVersion: info.version,
        progress: 100,
        message: "",
      });
      this.ensureDataSnapshot(info.version).catch((error) => {
        logger.warn(
          `[UpdateService] Failed to create snapshot for ${info.version}`,
          error,
        );
      });
    });

    autoUpdater.on("error", (err) => {
      const { errorCode, message } = this.classifyError(err);
      this.setState({
        status: "error",
        errorCode,
        message,
      });
    });
  }

  getState(): UpdateState {
    return this.state;
  }

  async checkForUpdates(): Promise<UpdateState> {
    if (!app.isPackaged) {
      this.setState({
        status: "unsupported",
        message: "not-packaged",
        errorCode: "unsupported_dev_mode",
      });
      return this.state;
    }
    try {
      await autoUpdater.checkForUpdates();
      return this.state;
    } catch (error: any) {
      logger.error("[UpdateService] checkForUpdates failed", error);
      const { errorCode, message } = this.classifyError(error);
      this.setState({
        status: "error",
        errorCode,
        message,
      });
      return this.state;
    }
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!app.isPackaged) {
      this.setState({
        status: "unsupported",
        message: "not-packaged",
        errorCode: "unsupported_dev_mode",
      });
      return this.state;
    }
    try {
      await autoUpdater.downloadUpdate();
      return this.state;
    } catch (error: any) {
      logger.error("[UpdateService] downloadUpdate failed", error);
      const { errorCode, message } = this.classifyError(error);
      this.setState({
        status: "error",
        errorCode,
        message,
      });
      return this.state;
    }
  }

  installUpdate() {
    if (!app.isPackaged) {
      this.setState({
        status: "unsupported",
        message: "not-packaged",
        errorCode: "unsupported_dev_mode",
      });
      return;
    }
    const targetVersion = this.state.latestVersion;
    const ensureSnapshot = targetVersion
      ? this.ensureDataSnapshot(targetVersion)
      : Promise.reject(new Error("update_target_version_missing"));
    ensureSnapshot
      .then(() => {
        autoUpdater.quitAndInstall();
      })
      .catch((error: unknown) => {
        logger.error(
          "[UpdateService] Failed to ensure snapshot before install",
          error,
        );
        const message = error instanceof Error ? error.message : String(error);
        this.setState({
          status: "error",
          errorCode: "unknown",
          message,
        });
      });
  }

  private getSnapshotBaseRoot(): string {
    return app.getPath("userData");
  }

  private toSnapshotLabel(targetPath: string): string {
    return targetPath
      .replace(/[:\\\/]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private getSnapshotDir(targetVersion: string): string {
    const readableVersion = targetVersion.replace(/[^0-9A-Za-z._-]/g, "_");
    const versionHash = createHash("sha256")
      .update(targetVersion)
      .digest("hex")
      .slice(0, 12);
    return path.join(
      this.getSnapshotBaseRoot(),
      ".update-snapshots",
      `version-${readableVersion}-${versionHash}`,
    );
  }

  private async isCompletedSnapshot(
    targetDir: string,
    targetVersion: string,
  ): Promise<boolean> {
    try {
      const raw = await fs.readFile(
        path.join(targetDir, "snapshot-meta.json"),
        "utf-8",
      );
      const metadata = JSON.parse(raw) as { targetVersion?: unknown };
      return metadata.targetVersion === targetVersion;
    } catch {
      return false;
    }
  }

  private ensureDataSnapshot(targetVersion: string): Promise<string> {
    const normalizedVersion = targetVersion.trim();
    if (!normalizedVersion) {
      return Promise.reject(new Error("update_target_version_missing"));
    }

    const pending = this.snapshotPromises.get(normalizedVersion);
    if (pending) return pending;

    const promise = this.createDataSnapshot(normalizedVersion).finally(() => {
      if (this.snapshotPromises.get(normalizedVersion) === promise) {
        this.snapshotPromises.delete(normalizedVersion);
      }
    });
    this.snapshotPromises.set(normalizedVersion, promise);
    return promise;
  }

  private async createDataSnapshot(targetVersion: string): Promise<string> {
    const appRoot = getAppRoot();
    const targetDir = this.getSnapshotDir(targetVersion);
    if (await this.isCompletedSnapshot(targetDir, targetVersion)) {
      logger.info(`[UpdateService] Reusing snapshot: ${targetDir}`);
      return targetDir;
    }

    const tempDir = `${targetDir}.tmp-${process.pid}-${Date.now()}`;
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.mkdir(tempDir, { recursive: true });

    const metadata: {
      createdAt: number;
      targetVersion: string;
      appRoot: string;
      configPath?: string;
      gameRoots: string[];
    } = {
      createdAt: Date.now(),
      targetVersion,
      appRoot,
      gameRoots: [],
    };

    try {
      const configPath = path.resolve(path.join(appRoot, "config.json"));
      const configLabel = this.toSnapshotLabel(configPath);
      await fs.copyFile(
        configPath,
        path.join(tempDir, `config_${configLabel}.backup`),
      );
      metadata.configPath = configPath;

      const defaultGamesRoot = path.resolve(path.join(appRoot, "games"));
      const gamesLabel = this.toSnapshotLabel(defaultGamesRoot);
      await fs.cp(defaultGamesRoot, path.join(tempDir, `games_${gamesLabel}`), {
        recursive: true,
      });
      metadata.gameRoots.push(defaultGamesRoot);

      const dbPath = path.resolve(path.join(appRoot, "db"));
      const dbLabel = this.toSnapshotLabel(dbPath);
      await fs.cp(dbPath, path.join(tempDir, `db_${dbLabel}`), {
        recursive: true,
      });

      await fs.writeFile(
        path.join(tempDir, "snapshot-meta.json"),
        JSON.stringify(metadata, null, 2),
        "utf-8",
      );
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.rename(tempDir, targetDir);
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    logger.info(`[UpdateService] Snapshot created: ${targetDir}`);
    return targetDir;
  }

  private setState(patch: Partial<UpdateState>) {
    const normalizedPatch =
      patch.status && patch.status !== "error" && patch.errorCode === undefined
        ? { ...patch, errorCode: undefined }
        : patch;
    this.state = {
      ...this.state,
      ...normalizedPatch,
      currentVersion: app.getVersion(),
    };
    this.emit();
  }

  private emit() {
    try {
      mainWindow?.webContents.send(IPC.SYSTEM_UPDATE_EVENT, this.state);
    } catch (error) {
      logger.warn("[UpdateService] emit update event failed", error);
    }
  }

  private classifyError(error: unknown): {
    errorCode: UpdateErrorCode;
    message: string;
  } {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error);
    const lower = message.toLowerCase();

    if (
      lower.includes("net::") ||
      lower.includes("network") ||
      lower.includes("socket") ||
      lower.includes("timeout") ||
      lower.includes("econn") ||
      lower.includes("unable to find latest version")
    ) {
      return { errorCode: "network_error", message };
    }
    if (
      lower.includes("yml") ||
      lower.includes("latest.yml") ||
      lower.includes("sha") ||
      lower.includes("checksum")
    ) {
      return { errorCode: "feed_invalid", message };
    }
    if (
      lower.includes("download") ||
      lower.includes("status code") ||
      lower.includes("http error")
    ) {
      return { errorCode: "download_failed", message };
    }
    if (
      lower.includes("signature") ||
      lower.includes("verify") ||
      lower.includes("blockmap")
    ) {
      return { errorCode: "verify_failed", message };
    }
    if (
      lower.includes("eacces") ||
      lower.includes("eperm") ||
      lower.includes("access is denied")
    ) {
      return { errorCode: "permission_denied", message };
    }

    return { errorCode: "unknown", message };
  }
}

export const updateService = new UpdateService();
