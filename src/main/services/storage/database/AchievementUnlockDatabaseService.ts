import crypto from "crypto";
import { AsyncSqliteDatabase } from "./AsyncSqliteDatabase";
import { ACHIEVEMENT_UNLOCKS_DB_FILE_NAME } from "../../../../shared/AppConstants";
import { logger } from "../../../utils/logger";

const CLOUD_SQL_DUMP_HEADER = "-- BZ-Games achievement unlocks cloud SQL dump v1";
const CLOUD_SYNC_TABLES = ["achievement_unlocks"];

export interface AchievementUnlockRecord {
  game_id: string;
  game_name: string;
  version: string;
  achievement_id: string;
  achievement_name: string;
  unlocked_at: number;
}

class AchievementUnlockDatabaseService {
  private readonly database = new AsyncSqliteDatabase("AchievementUnlockDatabaseService", ACHIEVEMENT_UNLOCKS_DB_FILE_NAME, [
    `CREATE TABLE IF NOT EXISTS achievement_unlocks (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      version TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      achievement_name TEXT NOT NULL,
      unlocked_at INTEGER NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_game_id ON achievement_unlocks(game_id)",
    "CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_unlocked_at ON achievement_unlocks(unlocked_at)",
  ]);

  init(): void {
    this.database.init();
  }

  recordUnlock(record: AchievementUnlockRecord): Promise<void> {
    const id = crypto.randomUUID();
    return this.database.run(
      "INSERT INTO achievement_unlocks (id, game_id, game_name, version, achievement_id, achievement_name, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, record.game_id, record.game_name, record.version, record.achievement_id, record.achievement_name, record.unlocked_at],
    ).catch((error) => {
      logger.error(`[AchievementUnlockDatabaseService] Failed to record achievement unlock: ${id}`, error);
    });
  }

  exportCloudSqlDump(): Promise<string> {
    return this.database.exportSqlDump(CLOUD_SQL_DUMP_HEADER, CLOUD_SYNC_TABLES);
  }

  importCloudSqlDump(sql: string): Promise<void> {
    return this.database.importSqlDump(CLOUD_SQL_DUMP_HEADER, CLOUD_SYNC_TABLES, sql);
  }

  close(): Promise<void> {
    return this.database.close();
  }
}

export const achievementUnlockDatabaseService = new AchievementUnlockDatabaseService();
