import { app, ipcMain, dialog, nativeImage, shell } from "electron";
import fs from "fs";
import { IPC } from "../../shared/ipc-channels";
import { storeService } from "../services/StoreService";
import { updateService } from "../services/UpdateService";
import { logger } from "../utils/logger";
import type { AppSettings } from "../../shared/types";
import { setCustomGamesDir } from "../utils/appPath";

export function registerSystemIpc() {
  updateService.init();

  ipcMain.handle(IPC.SYSTEM_GET_SETTINGS, async () => {
    return storeService.getSettings();
  });

  ipcMain.handle(IPC.SYSTEM_SAVE_SETTINGS, async (_, settings: AppSettings) => {
    logger.info("[SystemIPC] Saving settings:", settings);
    try {
      storeService.saveSettings(settings);
      setCustomGamesDir(settings.gameStoragePath || null);
      app.setLoginItemSettings({
        openAtLogin: settings.autoLaunch,
      });
      return true;
    } catch (error) {
      logger.error("[SystemIPC] Failed to save settings:", error);
      throw error;
    }
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
    return filePaths[0];
  });

  ipcMain.handle(IPC.SYSTEM_OPEN_PATH, async (_, targetPath: string) => {
    if (!targetPath || typeof targetPath !== "string") {
      return false;
    }
    const result = await shell.openPath(targetPath);
    return result === "";
  });

  ipcMain.handle(
    IPC.SYSTEM_REMOVE_GAME_STORAGE_PATH,
    async (_, targetPath: string) => {
      const result = await storeService.removeGameStoragePath(targetPath);
      setCustomGamesDir(result.nextStoragePath || null);
      return result;
    },
  );

  ipcMain.handle(IPC.SYSTEM_GET_USER_DATA, async () => {
    return storeService.getUserData();
  });

  ipcMain.handle(IPC.SYSTEM_CHECK_IN, async () => {
    return storeService.performCheckIn();
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
}
