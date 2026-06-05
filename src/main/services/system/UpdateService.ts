import { app } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs/promises";
import path from "path";
import { IPC } from "../../../shared/ipc-channels";
import { mainWindow } from "../../window";
import { logger } from "../../utils/logger";
import { getAppRoot } from "../../utils/appPath";
import type { UpdateErrorCode, UpdateState } from "../../../shared/types";

class UpdateService {
  private inited = false;
  private state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
  };

  init() {
    if (this.inited) return;
    this.inited = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

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
      this.createDataSnapshot("update-downloaded").catch(() => {});
      this.setState({
        status: "downloaded",
        latestVersion: info.version,
        progress: 100,
        message: "",
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
      await this.createDataSnapshot("before-download");
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
    this.createDataSnapshot("before-install")
      .catch((error) => {
        logger.warn("[UpdateService] Failed to create snapshot before install", error);
      })
      .finally(() => {
        autoUpdater.quitAndInstall();
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

  private async createDataSnapshot(stage: string): Promise<void> {
    const appRoot = getAppRoot();
    const snapshotRoot = path.join(this.getSnapshotBaseRoot(), ".update-snapshots");
    const stamp = `${Date.now()}-${stage}`;
    const targetDir = path.join(snapshotRoot, stamp);
    await fs.mkdir(targetDir, { recursive: true });

    const metadata: {
      createdAt: number;
      stage: string;
      appRoot: string;
      configPath?: string;
      gameRoots: string[];
    } = {
      createdAt: Date.now(),
      stage,
      appRoot,
      gameRoots: [],
    };

    const configPath = path.resolve(path.join(appRoot, "config.json"));
    const configLabel = this.toSnapshotLabel(configPath);
    try {
      await fs.copyFile(configPath, path.join(targetDir, `config_${configLabel}.backup`));
      metadata.configPath = configPath;
    } catch {}

    const defaultGamesRoot = path.resolve(path.join(appRoot, "games"));
    const gamesLabel = this.toSnapshotLabel(defaultGamesRoot);
    try {
      await fs.cp(defaultGamesRoot, path.join(targetDir, `games_${gamesLabel}`), {
        recursive: true,
      });
      metadata.gameRoots.push(defaultGamesRoot);
    } catch {}

    const dbPath = path.resolve(path.join(appRoot, "db"));
    const dbLabel = this.toSnapshotLabel(dbPath);
    try {
      await fs.cp(dbPath, path.join(targetDir, `db_${dbLabel}`), {
        recursive: true,
      });
    } catch {}

    try {
      await fs.writeFile(
        path.join(targetDir, "snapshot-meta.json"),
        JSON.stringify(metadata, null, 2),
        "utf-8",
      );
    } catch {}
    logger.info(`[UpdateService] Snapshot created: ${targetDir}`);
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
      error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
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
