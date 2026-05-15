import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { marketService } from "../services/MarketService";

export function registerMarketIpc() {
  ipcMain.handle(IPC.MARKET_GET_INDEX, async () => {
    return await marketService.getIndex();
  });

  ipcMain.handle(
    IPC.MARKET_DOWNLOAD_AND_INSTALL,
    async (_, gameId: string, version: string) => {
      return await marketService.downloadAndInstall(gameId, version);
    },
  );

  ipcMain.handle(IPC.MARKET_GET_TASK_STATE, async (_, taskId: string) => {
    return marketService.getTaskState(taskId);
  });

  ipcMain.handle(IPC.MARKET_CANCEL_TASK, async (_, taskId: string) => {
    return marketService.cancelTask(taskId);
  });
}
