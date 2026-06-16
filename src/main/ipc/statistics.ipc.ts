import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { playSessionDatabaseService } from "../services/storage/database/PlaySessionDatabaseService";

export function registerStatisticsIpc() {
  ipcMain.handle(IPC.STATS_GET_DAILY_PLAY_DURATIONS, async (_, days?: number) => {
    return playSessionDatabaseService.getDailyPlayDurations(days ?? 365);
  });

  ipcMain.handle(IPC.STATS_GET_RECENT_SESSIONS, async (_, limit?: number) => {
    return playSessionDatabaseService.getRecentSessions(limit ?? 20);
  });

  ipcMain.handle(IPC.STATS_GET_SESSIONS_BY_DATE, async (_, date: string) => {
    return playSessionDatabaseService.getSessionsByDate(date);
  });
}
