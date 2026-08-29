import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { getAppRoot } from "../utils/appPath";
import { mainWindow } from "../window";
import { backupExportService } from "../services/backup/BackupExportService";
import { backupImportService } from "../services/backup/BackupImportService";

function assertMainWindowSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender.id !== mainWindow.webContents.id
  ) {
    throw new Error("backup_ipc_sender_not_allowed");
  }
}

export function registerBackupIpc(): void {
  ipcMain.handle(IPC.BACKUP_EXPORT, (event) => {
    assertMainWindowSender(event);
    return backupExportService.exportBundle();
  });
  ipcMain.handle(IPC.BACKUP_IMPORT, (event) => {
    assertMainWindowSender(event);
    return backupImportService.selectImport();
  });
  ipcMain.handle(IPC.BACKUP_IMPORT_CONFIRM, async (event, token: unknown) => {
    assertMainWindowSender(event);
    const result = await backupImportService.confirmImport(token);
    if (result.success && result.restartRequired) {
      setTimeout(() => {
        const rootLauncher = path.join(getAppRoot(), "BZ-Games.exe");
        if (app.isPackaged && fs.existsSync(rootLauncher)) {
          app.relaunch({ execPath: rootLauncher, args: [] });
        } else {
          app.relaunch();
        }
        app.quit();
      }, 1_000);
    }
    return result;
  });
  ipcMain.handle(IPC.BACKUP_CANCEL, async (event) => {
    assertMainWindowSender(event);
    if (await backupImportService.cancel()) return true;
    return backupExportService.cancel();
  });
  ipcMain.handle(IPC.BACKUP_GET_STATUS, (event) => {
    assertMainWindowSender(event);
    return backupImportService.isActive()
      ? backupImportService.getState()
      : backupExportService.getState();
  });
}
