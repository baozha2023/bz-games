import { app, ipcMain, dialog, nativeImage, shell } from "electron";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { storeService } from "../services/storage/StoreService";
import { updateService } from "../services/system/UpdateService";
import { logger } from "../utils/logger";
import type { AppSettings, NicknameStyle } from "../../shared/types";
import { createFloatBallWindow, destroyFloatBallWindow } from "../window";
import { getAppRoot } from "../utils/appPath";

let sensitiveWordCache: string[] | null = null;

function loadSensitiveWords(): string[] {
  if (sensitiveWordCache) return sensitiveWordCache;
  const vocabularyDir = path.join(getAppRoot(), "resources", "vocabulary");
  try {
    const words = fs
      .readdirSync(vocabularyDir)
      .filter((fileName) => fileName.endsWith(".txt"))
      .flatMap((fileName) => {
        const filePath = path.join(vocabularyDir, fileName);
        return fs
          .readFileSync(filePath, "utf8")
          .split(/\r?\n/)
          .map((word) => word.trim())
          .filter(Boolean);
      });
    sensitiveWordCache = Array.from(new Set(words)).sort((a, b) => b.length - a.length);
  } catch (error) {
    logger.error("[SystemIPC] Failed to load sensitive vocabulary:", error);
    sensitiveWordCache = [];
  }
  return sensitiveWordCache;
}

export function registerSystemIpc() {
  updateService.init();

  function applyFloatBallSetting(settings: AppSettings | Partial<AppSettings>) {
    if (!("downloadFloatBall" in settings)) return;
    if (settings.downloadFloatBall) {
      createFloatBallWindow();
    } else {
      destroyFloatBallWindow();
    }
  }

  ipcMain.handle(IPC.SYSTEM_GET_SETTINGS, async () => {
    return storeService.getSettings();
  });

  ipcMain.handle(IPC.SYSTEM_GET_APP_VERSION, async () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC.SYSTEM_GET_SENSITIVE_WORDS, async () => {
    return loadSensitiveWords();
  });

  ipcMain.handle(IPC.SYSTEM_SAVE_SETTINGS, async (_, settings: AppSettings) => {
    logger.info("[SystemIPC] Saving settings:", settings);
    try {
      storeService.saveSettings(settings);
      app.setLoginItemSettings({
        openAtLogin: settings.autoLaunch,
      });
      applyFloatBallSetting(settings);
      return true;
    } catch (error) {
      logger.error("[SystemIPC] Failed to save settings:", error);
      throw error;
    }
  });

  ipcMain.handle(
    IPC.SYSTEM_SAVE_PARTIAL_SETTINGS,
    async (_, partial: Partial<AppSettings>) => {
      storeService.saveSettings(partial);
      applyFloatBallSetting(partial);
    },
  );

  ipcMain.handle(IPC.SYSTEM_SET_IGNORED_UPDATE_VERSION, async (_, version: string) => {
    storeService.performIgnoreUpdateVersion(version);
    return true;
  });

  ipcMain.handle(IPC.SYSTEM_SAVE_NICKNAME_STYLE, async (_, style: NicknameStyle) => {
    return storeService.performSaveNicknameStyle(style, 30);
  });

  ipcMain.handle(IPC.SYSTEM_UPLOAD_AVATAR, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["jpg", "png", "jpeg", "webp"] }],
    });

    if (canceled || filePaths.length === 0) {
      return null;
    }

    const sourcePath = filePaths[0];

    try {
      const buffer = fs.readFileSync(sourcePath);
      const image = nativeImage.createFromBuffer(buffer);

      if (image.isEmpty()) {
        logger.error("[SystemIPC] Failed to load image from path:", sourcePath);
        return null;
      }

      const resized = image.resize({ width: 256, height: 256 });
      const jpegBuffer = resized.toJPEG(80);
      const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString("base64")}`;
      logger.info("[SystemIPC] Avatar processed, length:", dataUrl.length);
      return dataUrl;
    } catch (e) {
      logger.error("[SystemIPC] Failed to process avatar file:", e);
      return null;
    }
  });

  ipcMain.handle(IPC.SYSTEM_SELECT_GAME_STORAGE_PATH, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Select Game Storage Directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    const selectedPath = filePaths[0];
    const entries = fs.readdirSync(selectedPath);
    if (entries.length > 0) {
      return { path: selectedPath, error: "directory_not_empty" };
    }
    return { path: selectedPath };
  });

  ipcMain.handle(IPC.SYSTEM_SELECT_GAME_STORAGE_PATH_RELAXED, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Select Game Storage Directory",
      properties: ["openDirectory", "createDirectory"],
    });
    if (canceled || filePaths.length === 0) {
      return null;
    }
    return { path: filePaths[0] };
  });

  ipcMain.handle(IPC.SYSTEM_GET_DEFAULT_GAMES_MIGRATION_STATUS, async () => {
    return storeService.getDefaultGamesMigrationStatus();
  });

  ipcMain.handle(IPC.SYSTEM_GET_GAME_STORAGE_PATHS, async () => {
    return storeService.getGameStoragePathItems();
  });

  ipcMain.handle(IPC.SYSTEM_ADD_GAME_STORAGE_PATH, async (_, targetPath: string) => {
    return storeService.addGameStoragePath(targetPath);
  });

  ipcMain.handle(IPC.SYSTEM_SET_DEFAULT_GAME_STORAGE_PATH, async (_, targetPath: string) => {
    return storeService.setDefaultGameStoragePath(targetPath);
  });

  ipcMain.handle(
    IPC.SYSTEM_MIGRATE_DEFAULT_GAMES_LIBRARY,
    async (_, payload?: { targetPath?: string; ignore?: boolean }) => {
      try {
        if (payload?.ignore) {
          storeService.ignoreDefaultGamesMigrationPrompt();
          return { success: true, ignored: true };
        }

        if (!payload?.targetPath) {
          return { success: false, error: "target_path_required" };
        }

        const result = await storeService.migrateDefaultGamesLibrary(payload.targetPath);
        return { success: true, ...result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.SYSTEM_MIGRATE_GAME_STORAGE_LIBRARY,
    async (_, payload?: { sourcePath?: string; targetPath?: string }) => {
      try {
        if (!payload?.sourcePath || !payload?.targetPath) {
          return { success: false, error: "migration_path_required" };
        }

        const result = await storeService.migrateGameStorageLibrary(
          payload.sourcePath,
          payload.targetPath,
        );
        return { success: true, ...result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.SYSTEM_OPEN_PATH, async (_, targetPath: string) => {
    if (!targetPath || typeof targetPath !== "string") {
      return false;
    }
    const result = await shell.openPath(targetPath);
    return result === "";
  });

  ipcMain.handle(IPC.SYSTEM_OPEN_URL, async (_, url: string) => {
    if (!url || typeof url !== "string") {
      return false;
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle(
    IPC.SYSTEM_REMOVE_GAME_STORAGE_PATH,
    async (_, targetPath: string) => {
      try {
        const result = await storeService.removeGameStoragePath(targetPath);
        return { success: true, ...result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(IPC.SYSTEM_GET_USER_DATA, async () => {
    return storeService.getUserData();
  });

  ipcMain.handle(IPC.SYSTEM_BUY_FRAME, async (_, frameId: string, coinCost: number) => {
    return storeService.performBuyFrame(frameId, coinCost);
  });

  ipcMain.handle(IPC.SYSTEM_EQUIP_FRAME, async (_, frameId: string) => {
    storeService.performEquipFrame(frameId);
    return true;
  });

  ipcMain.handle(IPC.SYSTEM_UNEQUIP_FRAME, async (_, frameId: string) => {
    storeService.performUnequipFrame(frameId);
    return true;
  });

  ipcMain.handle(IPC.SYSTEM_CHECK_IN, async () => {
    return storeService.performCheckIn();
  });

  ipcMain.handle(IPC.SYSTEM_GET_AVATAR_FRAME_IMAGE, async (_, fileName: string) => {
    try {
      const framePath = path.join(app.getAppPath(), "resources", "avatar-frames", fileName);
      if (!fs.existsSync(framePath)) {
        logger.warn(`[SystemIPC] Avatar frame image not found: ${framePath}`);
        return null;
      }
      const buffer = fs.readFileSync(framePath);
      const ext = path.extname(fileName).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/png";
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      return dataUrl;
    } catch (e) {
      logger.error("[SystemIPC] Failed to load avatar frame image:", e);
      return null;
    }
  });

  ipcMain.handle(IPC.SYSTEM_DATA_HEALTH_CHECK, async () => {
    return await storeService.healthCheck();
  });

  ipcMain.handle(IPC.SYSTEM_GET_UPDATE_STATUS, async () => {
    return updateService.getState();
  });

  ipcMain.handle(IPC.SYSTEM_CHECK_UPDATE, async () => {
    return await updateService.checkForUpdates();
  });

  ipcMain.handle(IPC.SYSTEM_DOWNLOAD_UPDATE, async () => {
    return await updateService.downloadUpdate();
  });

  ipcMain.handle(IPC.SYSTEM_INSTALL_UPDATE, async () => {
    updateService.installUpdate();
    return true;
  });

  ipcMain.handle(IPC.SYSTEM_UNINSTALL, async (_, payload?: { deleteGames?: boolean }) => {
    const exeDir = path.dirname(app.getPath("exe"));
    const uninstaller = path.join(exeDir, "Uninstall BZ-Games.exe");
    if (!fs.existsSync(uninstaller)) {
      return { success: false, error: "uninstaller_not_found" };
    }
    if (payload?.deleteGames) {
      const roots = storeService.getGameStorageRoots();
      for (const root of roots) {
        try {
          fs.rmSync(root, { recursive: true, force: true });
          logger.info(`[SystemIPC] Removed storage root before uninstall: ${root}`);
        } catch (error) {
          logger.warn(`[SystemIPC] Failed to remove storage root: ${root}`, error);
        }
      }
    }
    shell.openPath(uninstaller);
    app.quit();
    return { success: true };
  });

  ipcMain.handle(IPC.SYSTEM_CLEAR_CACHE, async () => {
    const targets: string[] = [
      path.join(app.getPath("appData"), "bz-launcher"),
      path.join(app.getPath("home"), "AppData", "Local", "bz-launcher-updater"),
      path.join(app.getPath("userData"), ".market-cache"),
    ];

    let totalSize = 0;
    let clearedSize = 0;

    function calcDirSize(dirPath: string): number {
      let size = 0;
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          try {
            if (entry.isDirectory()) {
              size += calcDirSize(fullPath);
            } else {
              size += fs.statSync(fullPath).size;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      return size;
    }

    for (const target of targets) {
      if (fs.existsSync(target)) {
        totalSize += calcDirSize(target);
      }
    }

    for (const target of targets) {
      if (!fs.existsSync(target)) continue;
      try {
        const entries = fs.readdirSync(target, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(target, entry.name);
          try {
            const entrySize = entry.isDirectory() ? calcDirSize(fullPath) : fs.statSync(fullPath).size;
            fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
            clearedSize += entrySize;
          } catch {
            logger.warn(`[SystemIPC] Cache clear skipped: ${fullPath}`);
          }
        }
      } catch {
        logger.warn(`[SystemIPC] Cache clear failed to read: ${target}`);
      }
    }

    return { totalSize, clearedSize };
  });
}
