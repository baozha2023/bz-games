import { ipcMain, dialog, nativeImage } from "electron";
import fs from "fs";
import { IPC } from "../../shared/ipc-channels";
import { storeService } from "../services/StoreService";
import { logger } from "../utils/logger";
import type { AppSettings } from "../../shared/types";

export function registerSystemIpc() {
  ipcMain.handle(IPC.SYSTEM_GET_SETTINGS, async () => {
    return storeService.getSettings();
  });

  ipcMain.handle(IPC.SYSTEM_SAVE_SETTINGS, async (_, settings: AppSettings) => {
    logger.info("[SystemIPC] Saving settings:", settings);
    try {
      storeService.saveSettings(settings);
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

  ipcMain.handle(IPC.SYSTEM_GET_USER_DATA, async () => {
    return storeService.getUserData();
  });

  ipcMain.handle(IPC.SYSTEM_CHECK_IN, async () => {
    return storeService.performCheckIn();
  });

  ipcMain.handle(IPC.SYSTEM_GET_BEIJING_DATE, async () => {
    return storeService.getBeijingDate();
  });
}
