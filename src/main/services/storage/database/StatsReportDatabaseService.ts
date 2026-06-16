import crypto from "crypto";
import { AsyncSqliteDatabase } from "./AsyncSqliteDatabase";
import { STATS_REPORTS_DB_FILE_NAME } from "../../../../shared/AppConstants";
import { logger } from "../../../utils/logger";

const CLOUD_SQL_DUMP_HEADER = "-- BZ-Games stats reports cloud SQL dump v1";
const CLOUD_SYNC_TABLES = ["stats_reports"];

export interface StatsReportRecord {
  game_id: string;
  game_name: string;
  version: string;
  stat_id: string;
  stat_name: string;
  reported_at: number;
}

class StatsReportDatabaseService {
  private readonly database = new AsyncSqliteDatabase("StatsReportDatabaseService", STATS_REPORTS_DB_FILE_NAME, [
    `CREATE TABLE IF NOT EXISTS stats_reports (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      game_name TEXT NOT NULL,
      version TEXT NOT NULL,
      stat_id TEXT NOT NULL,
      stat_name TEXT NOT NULL,
      reported_at INTEGER NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_stats_reports_game_id ON stats_reports(game_id)",
    "CREATE INDEX IF NOT EXISTS idx_stats_reports_reported_at ON stats_reports(reported_at)",
  ]);

  init(): void {
    this.database.init();
  }

  recordReport(record: StatsReportRecord): Promise<void> {
    const id = crypto.randomUUID();
    return this.database.run(
      "INSERT INTO stats_reports (id, game_id, game_name, version, stat_id, stat_name, reported_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, record.game_id, record.game_name, record.version, record.stat_id, record.stat_name, record.reported_at],
    ).catch((error) => {
      logger.error(`[StatsReportDatabaseService] Failed to record stats report: ${id}`, error);
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

export const statsReportDatabaseService = new StatsReportDatabaseService();
