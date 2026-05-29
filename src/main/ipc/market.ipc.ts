import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { marketService } from "../services/MarketService";

export function registerMarketIpc() {
  ipcMain.handle(IPC.MARKET_GET_SOURCES, async (_, forceRefresh?: boolean) => {
    return await marketService.getSources(!!forceRefresh);
  });

  ipcMain.handle(IPC.MARKET_GET_INDEX, async (_, sourceIdx: number, forceRefresh?: boolean) => {
    return await marketService.getIndex(sourceIdx, !!forceRefresh);
  });

  ipcMain.handle(IPC.MARKET_GET_CACHED_IMAGE, async (_, url: string) => {
    return await marketService.getCachedImageDataUrl(url);
  });

  ipcMain.handle(
    IPC.MARKET_DOWNLOAD_AND_INSTALL,
    async (_, gameId: string, version: string, sourceIdx: number) => {
      return await marketService.downloadAndInstall(gameId, version, sourceIdx);
    },
  );

  ipcMain.handle(IPC.MARKET_GET_TASK_STATE, async (_, taskId: string) => {
    return marketService.getTaskState(taskId);
  });

  ipcMain.handle(IPC.MARKET_CANCEL_TASK, async (_, taskId: string) => {
    return marketService.cancelTask(taskId);
  });

  ipcMain.handle(IPC.MARKET_PAUSE_TASK, async (_, taskId: string) => {
    return marketService.pauseTask(taskId);
  });

  ipcMain.handle(IPC.MARKET_RESUME_TASK, async (_, taskId: string) => {
    return marketService.resumeTask(taskId);
  });

  ipcMain.handle(IPC.MARKET_GET_PENDING_TASKS, async () => {
    return marketService.getPendingTasks();
  });

  ipcMain.handle(IPC.MARKET_RESOLVE_ASSET_INFO, async (_, downloadUrl: string) => {
    return marketService.resolveAssetInfo(downloadUrl);
  });
}
