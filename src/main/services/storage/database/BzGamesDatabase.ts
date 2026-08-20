import crypto from "crypto";
import {
  BZ_GAMES_DB_FILE_NAME,
  DATABASE_ENCRYPTION_SEED,
} from "../../../../shared/AppConstants";
import type { GameRecord } from "../../../../shared/types";
import { compareGameVersionsDescending } from "../../../../shared/game-manifest";
import { AsyncSqliteDatabase, type SqliteBatchStatement } from "./AsyncSqliteDatabase";

const CLOUD_SQL_DUMP_HEADER = "-- BZ-Games cloud SQL dump v2";
const CLOUD_SYNC_TABLES = ["play_sessions", "achievement_unlocks", "stats_reports"];
export const BZ_GAMES_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_present INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS game_versions (
    game_id TEXT NOT NULL,
    version TEXT NOT NULL,
    path TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    install_source TEXT NOT NULL DEFAULT 'manual' CHECK (install_source IN ('manual', 'market')),
    market_id TEXT,
    is_present INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (game_id, version)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_game_versions_present ON game_versions(game_id, is_present)",
  `CREATE TABLE IF NOT EXISTS play_sessions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    version TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration_ms INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS idx_play_sessions_game_id ON play_sessions(game_id)",
  "CREATE INDEX IF NOT EXISTS idx_play_sessions_start_time ON play_sessions(start_time)",
  `CREATE TABLE IF NOT EXISTS achievement_unlocks (
    game_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    version TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    achievement_name TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, version, achievement_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_achievement_unlocks_unlocked_at ON achievement_unlocks(unlocked_at)",
  `CREATE TABLE IF NOT EXISTS stats_reports (
    event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    game_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    version TEXT NOT NULL,
    stat_id TEXT NOT NULL,
    stat_name TEXT NOT NULL,
    reported_value REAL NOT NULL,
    report_mode TEXT NOT NULL CHECK (report_mode IN ('full', 'increment')),
    reported_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_stats_reports_game ON stats_reports(game_id, version, event_sequence)",
];

type GameRow = {
  id: string;
  added_at: number;
  is_favorite: number;
  sort_order: number;
};

type FavoriteRow = {
  id: string;
  is_favorite: number;
};

type VersionRow = {
  game_id: string;
  version: string;
  path: string;
  added_at: number;
  install_source: "manual" | "market";
  market_id: string | null;
};

type TableInfoRow = {
  name: string;
};

type AchievementRow = {
  game_id: string;
  version: string;
  achievement_id: string;
  unlocked_at: number;
};

type StatsRow = {
  game_id: string;
  version: string;
  stat_id: string;
  reported_value: number;
  report_mode: "full" | "increment";
};

type SessionAggregate = {
  game_id: string;
  version: string;
  playtime: number;
  last_played_at: number | null;
};

function createEncryptionKey(seed: string): Buffer {
  return crypto.createHash("sha256").update(seed).digest();
}

export class BzGamesDatabase {
  private readonly database: AsyncSqliteDatabase;

  constructor(
    relativeDbPath = BZ_GAMES_DB_FILE_NAME,
    encryptionSeed = DATABASE_ENCRYPTION_SEED,
  ) {
    this.database = new AsyncSqliteDatabase(
      "BzGamesDatabase",
      relativeDbPath,
      BZ_GAMES_SCHEMA_SQL,
      createEncryptionKey(encryptionSeed),
    );
  }

  async initialize(): Promise<void> {
    this.database.init();
    await this.database.get("SELECT name FROM sqlite_master LIMIT 1");
    const columns = new Set(
      (await this.database.all<TableInfoRow>("PRAGMA table_info(game_versions)")).map(
        (column) => column.name,
      ),
    );
    if (!columns.has("install_source")) {
      await this.database.run(
        "ALTER TABLE game_versions ADD COLUMN install_source TEXT NOT NULL DEFAULT 'manual' CHECK (install_source IN ('manual', 'market'))",
      );
    }
    if (!columns.has("market_id")) {
      await this.database.run("ALTER TABLE game_versions ADD COLUMN market_id TEXT");
    }
  }

  close(): Promise<void> {
    return this.database.close();
  }

  getDatabasePath(): string {
    return this.database.getDatabasePath();
  }

  run(sql: string, params: Array<string | number | bigint | Buffer | null> = []): Promise<void> {
    return this.database.run(sql, params).then(() => undefined);
  }

  get<T>(sql: string, params: Array<string | number | bigint | Buffer | null> = []): Promise<T | undefined> {
    return this.database.get<T>(sql, params);
  }

  all<T>(sql: string, params: Array<string | number | bigint | Buffer | null> = []): Promise<T[]> {
    return this.database.all<T>(sql, params);
  }

  batch(statements: SqliteBatchStatement[]): Promise<void> {
    return this.database.batch(statements);
  }

  async getGames(): Promise<GameRecord[]> {
    const [games, versions, achievements, stats, sessions] = await Promise.all([
      this.all<GameRow>("SELECT id, added_at, is_favorite, sort_order FROM games WHERE is_present = 1 ORDER BY sort_order, added_at"),
      this.all<VersionRow>(`SELECT game_id, version, path, added_at, install_source, market_id
        FROM game_versions WHERE is_present = 1`),
      this.all<AchievementRow>("SELECT game_id, version, achievement_id, unlocked_at FROM achievement_unlocks"),
      this.all<StatsRow>(`SELECT game_id, version, stat_id, reported_value, report_mode
        FROM stats_reports ORDER BY reported_at, event_id`),
      this.all<SessionAggregate>(`SELECT game_id, version,
        COALESCE(SUM(duration_ms), 0) AS playtime,
        MAX(start_time) AS last_played_at
        FROM play_sessions GROUP BY game_id, version`),
    ]);

    const gameMap = new Map<string, GameRecord>();
    for (const row of games) {
      gameMap.set(row.id, {
        id: row.id,
        versions: [],
        latestVersion: "",
        addedAt: row.added_at,
        isFavorite: row.is_favorite === 1,
      });
    }
    for (const row of versions) {
      const game = gameMap.get(row.game_id);
      if (!game) continue;
      game.versions.push({
        version: row.version,
        path: row.path,
        addedAt: row.added_at,
        installSource: row.install_source,
        marketId: row.market_id,
        stats: {},
        unlockedAchievements: [],
        playtime: 0,
      });
    }
    for (const row of achievements) {
      const version = gameMap.get(row.game_id)?.versions.find((item) => item.version === row.version);
      version?.unlockedAchievements.push({ id: row.achievement_id, unlockedAt: row.unlocked_at });
    }
    for (const row of stats) {
      const version = gameMap.get(row.game_id)?.versions.find((item) => item.version === row.version);
      if (!version) continue;
      version.stats[row.stat_id] = row.report_mode === "full"
        ? row.reported_value
        : (version.stats[row.stat_id] || 0) + row.reported_value;
    }
    for (const row of sessions) {
      const game = gameMap.get(row.game_id);
      const version = game?.versions.find((item) => item.version === row.version);
      if (version) version.playtime = row.playtime || 0;
      if (game && row.last_played_at && (!game.lastPlayedAt || row.last_played_at > game.lastPlayedAt)) {
        game.lastPlayedAt = row.last_played_at;
      }
    }
    for (const game of gameMap.values()) {
      game.versions.sort((a, b) => compareGameVersionsDescending(a.version, b.version));
      game.latestVersion = game.versions[0]?.version || "";
    }
    return [...gameMap.values()].filter((game) => game.versions.length > 0);
  }

  async saveGames(games: GameRecord[]): Promise<void> {
    const existingFavorites = new Map(
      (await this.all<FavoriteRow>("SELECT id, is_favorite FROM games")).map(
        (row) => [row.id, row.is_favorite],
      ),
    );
    const statements: SqliteBatchStatement[] = [
      { sql: "UPDATE game_versions SET is_present = 0" },
      { sql: "UPDATE games SET is_present = 0" },
    ];
    for (const [sortOrder, game] of games.entries()) {
      const isPresent = game.versions.length > 0 ? 1 : 0;
      statements.push({
        sql: `INSERT INTO games (id, added_at, is_favorite, sort_order, is_present) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET added_at=excluded.added_at,
          is_favorite=excluded.is_favorite, sort_order=excluded.sort_order,
          is_present=excluded.is_present`,
        params: [
          game.id,
          game.addedAt,
          game.isFavorite === undefined
            ? existingFavorites.get(game.id) || 0
            : game.isFavorite
              ? 1
              : 0,
          sortOrder,
          isPresent,
        ],
      });
      for (const version of game.versions) {
        statements.push({
          sql: `INSERT INTO game_versions
            (game_id, version, path, added_at, install_source, market_id, is_present)
            VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(game_id, version) DO UPDATE SET
            path=excluded.path, added_at=excluded.added_at,
            install_source=excluded.install_source, market_id=excluded.market_id,
            is_present=1`,
          params: [
            game.id,
            version.version,
            version.path,
            version.addedAt,
            version.installSource,
            version.marketId,
          ],
        });
      }
    }
    await this.batch(statements);
  }

  async setFavorite(gameId: string, favorite: boolean): Promise<void> {
    await this.run("UPDATE games SET is_favorite = ? WHERE id = ?", [favorite ? 1 : 0, gameId]);
  }

  async recordAchievement(record: {
    gameId: string;
    gameName: string;
    version: string;
    achievementId: string;
    achievementName: string;
    unlockedAt: number;
  }): Promise<boolean> {
    const result = await this.database.run(
      `INSERT OR IGNORE INTO achievement_unlocks
       (game_id, game_name, version, achievement_id, achievement_name, unlocked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.gameId,
        record.gameName,
        record.version,
        record.achievementId,
        record.achievementName,
        record.unlockedAt,
      ],
    );
    return result.changes === 1;
  }

  async recordStats(records: Array<{
    gameId: string;
    gameName: string;
    version: string;
    statId: string;
    statName: string;
    value: number;
    mode: "full" | "increment";
    reportedAt: number;
  }>): Promise<void> {
    await this.batch(records.map((record) => ({
      sql: `INSERT INTO stats_reports
        (event_id, game_id, game_name, version, stat_id, stat_name,
         reported_value, report_mode, reported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        crypto.randomUUID(),
        record.gameId,
        record.gameName,
        record.version,
        record.statId,
        record.statName,
        record.value,
        record.mode,
        record.reportedAt,
      ],
    })));
  }

  async softDelete(gameId: string, versions?: string[]): Promise<void> {
    const statements: SqliteBatchStatement[] = [];
    if (versions === undefined) {
      statements.push(
        { sql: "UPDATE game_versions SET is_present = 0 WHERE game_id = ?", params: [gameId] },
        { sql: "UPDATE games SET is_present = 0 WHERE id = ?", params: [gameId] },
      );
    } else {
      for (const version of versions) {
        statements.push({
          sql: "UPDATE game_versions SET is_present = 0 WHERE game_id = ? AND version = ?",
          params: [gameId, version],
        });
      }
      statements.push({
        sql: `UPDATE games SET is_present = CASE WHEN EXISTS (
          SELECT 1 FROM game_versions WHERE game_id = ? AND is_present = 1
        ) THEN 1 ELSE 0 END WHERE id = ?`,
        params: [gameId, gameId],
      });
    }
    await this.batch(statements);
  }

  async checkIntegrity(): Promise<string[]> {
    const rows = await this.all<{ integrity_check: string }>(
      "PRAGMA integrity_check",
    );
    return rows
      .map((row) => row.integrity_check)
      .filter((result) => result !== "ok");
  }

  exportCloudSqlDump(): Promise<string> {
    return this.database.exportSqlDump(CLOUD_SQL_DUMP_HEADER, CLOUD_SYNC_TABLES, {
      stats_reports: ["event_sequence"],
    });
  }

  importCloudSqlDump(sql: string): Promise<void> {
    return this.database.importSqlDump(sql);
  }

}

export const bzGamesDatabase = new BzGamesDatabase();

export function exportCloudSqlDump(): Promise<string> {
  return bzGamesDatabase.exportCloudSqlDump();
}

export function importCloudSqlDump(sql: string): Promise<void> {
  return bzGamesDatabase.importCloudSqlDump(sql);
}
