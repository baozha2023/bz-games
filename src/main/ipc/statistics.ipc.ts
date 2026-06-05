import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { databaseService } from "../services/storage/DatabaseService";

export function registerStatisticsIpc() {
  ipcMain.handle(IPC.STATS_GET_DAILY_PLAY_DURATIONS, async (_, days?: number) => {
    return databaseService.getDailyPlayDurations(days ?? 365);
  });

  ipcMain.handle(IPC.STATS_GET_RECENT_SESSIONS, async (_, limit?: number) => {
    return databaseService.getRecentSessions(limit ?? 20);
  });
}
