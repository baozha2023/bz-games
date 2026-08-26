import { app, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { MIGRATION_NOTICE_VERSION } from "../../shared/types";
import { migrationExportService } from "../services/system/MigrationExportService";
import { storeService } from "../services/storage/StoreService";

export function registerMigrationIpc(): void {
  ipcMain.handle(IPC.MIGRATION_EXPORT, () =>
    migrationExportService.exportBundle(),
  );
  ipcMain.handle(IPC.MIGRATION_CANCEL, () => migrationExportService.cancel());
  ipcMain.handle(IPC.MIGRATION_GET_STATUS, () =>
    migrationExportService.getState(),
  );
  ipcMain.handle(IPC.MIGRATION_ACKNOWLEDGE_NOTICE, (_, version: unknown) => {
    if (version !== MIGRATION_NOTICE_VERSION || version !== app.getVersion()) {
      return false;
    }
    storeService.acknowledgeMigrationNotice(version);
    return true;
  });
}
