import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { getAppRoot } from "../utils/appPath";
import { logger } from "../utils/logger";

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

const DB_DIR = "db";
const DB_FILE_NAME = "db/play_sessions.db";

class DatabaseService {
  private db: Database.Database | null = null;

  init(): void {
    if (this.db) return;

    const appRoot = getAppRoot();
    const dbDir = path.join(appRoot, DB_DIR);
    fs.mkdirSync(dbDir, { recursive: true });

    const dbPath = path.join(appRoot, DB_FILE_NAME);
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS play_sessions (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        game_name TEXT NOT NULL,
        version TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration_ms INTEGER
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_play_sessions_game_id ON play_sessions(game_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_play_sessions_start_time ON play_sessions(start_time)
    `);
    logger.info(`[DatabaseService] Initialized at: ${dbPath}`);
  }

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error("DatabaseService not initialized! Call init() first.");
    }
    return this.db;
  }

  startSession(gameId: string, gameName: string, version: string): string {
    const db = this.getDb();
    const id = crypto.randomUUID();
    const now = Date.now();
    const stmt = db.prepare(
      "INSERT INTO play_sessions (id, game_id, game_name, version, start_time) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(id, gameId, gameName, version, now);
    logger.info(`[DatabaseService] Session started: ${id} (${gameId} v${version})`);
    return id;
  }

  endSession(sessionId: string): void {
    const db = this.getDb();
    const now = Date.now();
    const session = db
      .prepare("SELECT start_time FROM play_sessions WHERE id = ?")
      .get(sessionId) as { start_time: number } | undefined;
    if (!session) {
      logger.warn(`[DatabaseService] Session not found: ${sessionId}`);
      return;
    }
    const durationMs = now - session.start_time;
    db.prepare(
      "UPDATE play_sessions SET end_time = ?, duration_ms = ? WHERE id = ?",
    ).run(now, durationMs, sessionId);
    logger.info(
      `[DatabaseService] Session ended: ${sessionId}, duration: ${Math.round(durationMs / 1000)}s`,
    );
  }

  getRecentSessions(limit: number = 10): PlaySession[] {
    const db = this.getDb();
    return db
      .prepare(
        "SELECT * FROM play_sessions ORDER BY start_time DESC LIMIT ?",
      )
      .all(limit) as PlaySession[];
  }

  getRecentGames(limit: number = 5): { game_id: string; game_name: string; version: string; last_played: number }[] {
    const db = this.getDb();
    return db
      .prepare(
        `SELECT game_id, game_name, version, MAX(start_time) as last_played
         FROM play_sessions
         GROUP BY game_id
         ORDER BY last_played DESC
         LIMIT ?`,
      )
      .all(limit) as { game_id: string; game_name: string; version: string; last_played: number }[];
  }

  getDailyPlayDurations(days: number = 365): DailyPlayDuration[] {
    const db = this.getDb();
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const rows = db
      .prepare(
        `SELECT date(start_time / 1000, 'unixepoch', 'localtime') as date, SUM(duration_ms) as total_duration_ms
         FROM play_sessions
         WHERE start_time >= ? AND duration_ms IS NOT NULL
         GROUP BY date(start_time / 1000, 'unixepoch', 'localtime')
         ORDER BY date ASC`,
      )
      .all(since) as DailyPlayDuration[];
    return rows;
  }

  getTotalPlayDuration(): number {
    const db = this.getDb();
    const row = db
      .prepare("SELECT COALESCE(SUM(duration_ms), 0) as total FROM play_sessions WHERE duration_ms IS NOT NULL")
      .get() as { total: number };
    return row.total;
  }

  close(): void {
    if (!this.db) return;
    this.db.close();
    this.db = null;
    logger.info("[DatabaseService] Closed");
  }
}

export const databaseService = new DatabaseService();
