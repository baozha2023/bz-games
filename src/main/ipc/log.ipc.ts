import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { logger } from "../utils/logger";

export function registerLogIpc() {
  ipcMain.on(IPC.SYSTEM_LOG_ERROR, (_, payload: unknown) => {
    logger.captureRendererError(payload);
  });
}
