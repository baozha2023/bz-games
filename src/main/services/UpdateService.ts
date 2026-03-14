import { app } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs/promises";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { mainWindow } from "../window";
import { logger } from "../utils/logger";
import { getAppRoot } from "../utils/appPath";
import { storeService } from "./StoreService";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up_to_date"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  message?: string;
}

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
      this.setState({
        status: "downloaded",
        latestVersion: info.version,
        progress: 100,
        message: "",
      });
    });

    autoUpdater.on("error", (err) => {
      this.setState({
        status: "error",
        message: err?.message || String(err),
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
      });
      return this.state;
    }
    try {
      await autoUpdater.checkForUpdates();
      return this.state;
    } catch (error: any) {
      logger.error("[UpdateService] checkForUpdates failed", error);
      this.setState({
        status: "error",
        message: error?.message || String(error),
      });
      return this.state;
    }
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!app.isPackaged) {
      this.setState({
        status: "unsupported",
        message: "not-packaged",
      });
      return this.state;
    }
    try {
      await this.createDataSnapshot("before-download");
      await autoUpdater.downloadUpdate();
      return this.state;
    } catch (error: any) {
      logger.error("[UpdateService] downloadUpdate failed", error);
      this.setState({
        status: "error",
        message: error?.message || String(error),
      });
      return this.state;
    }
  }

  installUpdate() {
    if (!app.isPackaged) {
      this.setState({
        status: "unsupported",
        message: "not-packaged",
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

  private async createDataSnapshot(stage: string): Promise<void> {
    const root = getAppRoot();
    const configPath = path.join(root, "config.json");
    const snapshotRoot = path.join(root, ".update-snapshots");
    const stamp = `${Date.now()}-${stage}`;
    const targetDir = path.join(snapshotRoot, stamp);
    await fs.mkdir(targetDir, { recursive: true });

    const metadata: {
      createdAt: number;
      stage: string;
      appRoot: string;
      configPath: string;
      gameRoots: string[];
    } = {
      createdAt: Date.now(),
      stage,
      appRoot: root,
      configPath,
      gameRoots: [],
    };

    try {
      await fs.copyFile(configPath, path.join(targetDir, "config.json.backup"));
      metadata.configPath = configPath;
    } catch {}

    const gameRoots = Array.from(
      new Set(storeService.getGameStorageRoots().map((p) => path.resolve(p))),
    );
    for (const gameRoot of gameRoots) {
      const label = gameRoot
        .replace(/[:\\\/]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
      const target = path.join(targetDir, `games_${label}`);
      try {
        await fs.cp(gameRoot, target, { recursive: true });
        metadata.gameRoots.push(gameRoot);
      } catch {}
    }

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
    this.state = {
      ...this.state,
      ...patch,
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
}

export const updateService = new UpdateService();
