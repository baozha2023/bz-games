import crypto from "crypto";
import { logger } from "../../../utils/logger";
import { bzGamesDatabase } from "./BzGamesDatabase";

export interface PlaySession {
  id: string;
  game_id: string;
  game_name: string;
  version: string;
  start_time: number;
  end_time: number | null;
  duration_ms: number | null;
}

export interface DailyPlayDuration {
  date: string;
  total_duration_ms: number;
}

class PlaySessionDatabaseService {
  private readonly database = bzGamesDatabase;

  startSession(gameId: string, gameName: string, version: string, startTime = Date.now()): string {
    const id = crypto.randomUUID();
    void this.database.run(
      "INSERT INTO play_sessions (id, game_id, game_name, version, start_time) VALUES (?, ?, ?, ?, ?)",
      [id, gameId, gameName, version, startTime],
    ).catch((error) => {
      logger.error(`[PlaySessionDatabaseService] Failed to start session: ${id}`, error);
    });
    return id;
  }

  endSession(sessionId: string, startTime: number, endTime = Date.now()): void {
    const durationMs = Math.max(0, endTime - startTime);
    void this.database.run(
      "UPDATE play_sessions SET end_time = ?, duration_ms = ? WHERE id = ?",
      [endTime, durationMs, sessionId],
    ).catch((error) => {
      logger.error(`[PlaySessionDatabaseService] Failed to end session: ${sessionId}`, error);
    });
  }

  getRecentSessions(limit = 10): Promise<PlaySession[]> {
    return this.database.all<PlaySession>("SELECT * FROM play_sessions ORDER BY start_time DESC LIMIT ?", [limit]);
  }

  getSessionsByDate(date: string): Promise<PlaySession[]> {
    return this.database.all<PlaySession>(
      `SELECT * FROM play_sessions
       WHERE date(start_time / 1000, 'unixepoch', 'localtime') = ?
         AND duration_ms IS NOT NULL
       ORDER BY start_time DESC`,
      [date],
    );
  }

  getRecentGames(limit = 5): Promise<{ game_id: string; game_name: string; version: string; last_played: number }[]> {
    return this.database.all<{ game_id: string; game_name: string; version: string; last_played: number }>(
      `SELECT game_id, game_name, version, MAX(start_time) as last_played
       FROM play_sessions
       GROUP BY game_id
       ORDER BY last_played DESC
       LIMIT ?`,
      [limit],
    );
  }

  getDailyPlayDurations(days = 365): Promise<DailyPlayDuration[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    return this.database.all<DailyPlayDuration>(
      `SELECT date(start_time / 1000, 'unixepoch', 'localtime') as date, SUM(duration_ms) as total_duration_ms
       FROM play_sessions
       WHERE start_time >= ? AND duration_ms IS NOT NULL
       GROUP BY date(start_time / 1000, 'unixepoch', 'localtime')
       ORDER BY date ASC`,
      [since],
    );
  }

  async getTotalPlayDuration(): Promise<number> {
    const row = await this.database.get<{ total: number }>("SELECT COALESCE(SUM(duration_ms), 0) as total FROM play_sessions WHERE duration_ms IS NOT NULL");
    return row?.total || 0;
  }

}

export const playSessionDatabaseService = new PlaySessionDatabaseService();
