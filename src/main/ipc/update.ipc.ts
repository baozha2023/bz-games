import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { updateService } from "../services/system/UpdateService";
import { markApplicationHealthy } from "../services/system/HealthService";
import { mainWindow } from "../window";

let healthCommit: Promise<void> | null = null;

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) {
    throw new Error("update_ipc_sender_not_allowed");
  }
}

export function registerUpdateIpc(): void {
  ipcMain.handle(IPC.SYSTEM_RENDERER_HEALTHY, async (event) => {
    assertMainWindowSender(event);
    healthCommit ??= markApplicationHealthy().catch((error) => {
      healthCommit = null;
      throw error;
    });
    await healthCommit;
    updateService.rendererHealthy();
    return true;
  });
  ipcMain.handle(IPC.SYSTEM_UPDATE_GET_STATUS, (event) => {
    assertMainWindowSender(event);
    return updateService.getState();
  });
  ipcMain.handle(IPC.SYSTEM_UPDATE_CHECK, (event) => {
    assertMainWindowSender(event);
    return updateService.checkForUpdates(false);
  });
  ipcMain.handle(IPC.SYSTEM_UPDATE_DOWNLOAD, (event) => {
    assertMainWindowSender(event);
    return updateService.downloadUpdate();
  });
  ipcMain.handle(IPC.SYSTEM_UPDATE_CANCEL, (event) => {
    assertMainWindowSender(event);
    return updateService.cancelDownload();
  });
  ipcMain.handle(IPC.SYSTEM_UPDATE_APPLY, (event) => {
    assertMainWindowSender(event);
    return updateService.applyUpdate();
  });
  ipcMain.handle(IPC.SYSTEM_UPDATE_SUPPRESS, (event) => {
    assertMainWindowSender(event);
    return updateService.suppressForCurrentVersion();
  });
}
