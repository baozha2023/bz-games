import crypto from "crypto";
import path from "path";
import {
  BZ_GAMES_DB_FILE_NAME,
  DATABASE_ENCRYPTION_SEED,
} from "../../../../shared/AppConstants";
import type { GameRecord } from "../../../../shared/types";
import { compareGameVersionsDescending } from "../../../../shared/game-manifest";
import {
  AsyncSqliteDatabase,
  type SqliteBatchStatement,
} from "./AsyncSqliteDatabase";

export const V4_APPLICATION_ID = 1113219917;
export const V4_USER_VERSION = 40000;
export const BUILTIN_LIBRARY_ID = "builtin";

export const V4_SCHEMA_SQL = [
  `CREATE TABLE bz_schema_meta (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_fingerprint TEXT NOT NULL
  )`,
  `CREATE TABLE game_libraries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('builtin', 'external')),
    root_path TEXT,
    normalized_root TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at INTEGER NOT NULL,
    lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'removed')),
    removed_at INTEGER,
    CHECK ((kind = 'builtin' AND root_path IS NULL) OR
           (kind = 'external' AND root_path IS NOT NULL)),
    CHECK ((lifecycle_state = 'active' AND removed_at IS NULL) OR
           (lifecycle_state = 'removed' AND removed_at IS NOT NULL)),
    CHECK (kind = 'external' OR lifecycle_state = 'active')
  )`,
  "CREATE UNIQUE INDEX idx_game_libraries_default ON game_libraries(is_default) WHERE is_default = 1",
  `CREATE TABLE games (
    id TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE game_versions (
    game_id TEXT NOT NULL,
    version TEXT NOT NULL,
    library_id TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    install_source TEXT NOT NULL DEFAULT 'manual' CHECK (install_source IN ('manual', 'market')),
    market_id TEXT,
    lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('installed', 'removed')),
    removed_at INTEGER,
    PRIMARY KEY (game_id, version),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (library_id) REFERENCES game_libraries(id),
    CHECK ((lifecycle_state = 'installed' AND removed_at IS NULL) OR
           (lifecycle_state = 'removed' AND removed_at IS NOT NULL)),
    CHECK (relative_path <> '' AND relative_path NOT LIKE '/%' AND relative_path NOT LIKE '\\%' AND relative_path NOT LIKE '%..%')
  )`,
  "CREATE INDEX idx_game_versions_lifecycle ON game_versions(game_id, lifecycle_state)",
  "CREATE INDEX idx_game_versions_library ON game_versions(library_id, relative_path)",
  `CREATE TABLE play_sessions (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    version TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    duration_ms INTEGER
  )`,
  "CREATE INDEX idx_play_sessions_game_id ON play_sessions(game_id)",
  "CREATE INDEX idx_play_sessions_start_time ON play_sessions(start_time)",
  `CREATE TABLE achievement_unlocks (
    game_id TEXT NOT NULL,
    game_name TEXT NOT NULL,
    version TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    achievement_name TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, version, achievement_id)
  )`,
  "CREATE INDEX idx_achievement_unlocks_unlocked_at ON achievement_unlocks(unlocked_at)",
  `CREATE TABLE stats_reports (
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
  "CREATE INDEX idx_stats_reports_game ON stats_reports(game_id, version, event_sequence)",
  `INSERT INTO game_libraries
    (id, kind, root_path, normalized_root, display_name, is_default, created_at)
    VALUES ('builtin', 'builtin', NULL, 'builtin://games', 'Built-in Games', 1, 0)`,
  `PRAGMA application_id = ${V4_APPLICATION_ID}`,
  `PRAGMA user_version = ${V4_USER_VERSION}`,
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
  library_id: string;
  relative_path: string;
  added_at: number;
  install_source: "manual" | "market";
  market_id: string | null;
};

export interface GameLibraryRecord {
  id: string;
  kind: "builtin" | "external";
  root_path: string | null;
  normalized_root: string;
  display_name: string;
  is_default: 0 | 1;
  created_at: number;
}

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

export function normalizeGameLibraryRoot(rootPath: string): string {
  const resolved = path.normalize(path.resolve(rootPath));
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
}

export function assertCanonicalGameVersionRelativePath(
  relativePath: string,
  identity?: { gameId: string; version: string },
): string {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new Error(`game_version_relative_path_invalid:${relativePath}`);
  }
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        segment.includes("\\") ||
        /[\0-\x1f]/.test(segment),
    )
  ) {
    throw new Error(`game_version_relative_path_invalid:${relativePath}`);
  }
  if (identity && relativePath !== `${identity.gameId}/${identity.version}`) {
    throw new Error(`game_version_relative_path_invalid:${relativePath}`);
  }
  return relativePath;
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
      V4_SCHEMA_SQL,
      createEncryptionKey(encryptionSeed),
      V4_APPLICATION_ID,
      V4_USER_VERSION,
    );
  }

  async initialize(): Promise<void> {
    this.database.init();
    try {
      await this.database.get("SELECT name FROM sqlite_master LIMIT 1");
      await this.assertV4Invariants();
    } catch (error) {
      await this.database.close().catch(() => undefined);
      throw error;
    }
  }

  private async assertV4Invariants(): Promise<void> {
    const integrityIssues = await this.checkIntegrity();
    if (integrityIssues.length > 0) {
      throw new Error(`database_integrity_failed:${integrityIssues[0]}`);
    }
    const builtinRows = await this.database.all<{
      id: string;
      kind: string;
      root_path: string | null;
      normalized_root: string;
      lifecycle_state: string;
      removed_at: number | null;
    }>(
      `SELECT id, kind, root_path, normalized_root, lifecycle_state, removed_at
       FROM game_libraries WHERE kind = 'builtin'`,
    );
    const builtin = builtinRows[0];
    if (
      builtinRows.length !== 1 ||
      !builtin ||
      builtin.id !== BUILTIN_LIBRARY_ID ||
      builtin.kind !== "builtin" ||
      builtin.root_path !== null ||
      builtin.normalized_root !== "builtin://games" ||
      builtin.lifecycle_state !== "active" ||
      builtin.removed_at !== null
    ) {
      throw new Error("database_builtin_library_invariant_failed");
    }

    const defaults = await this.database.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM game_libraries
       WHERE is_default = 1 AND lifecycle_state = 'active'`,
    );
    if (defaults?.count !== 1) {
      throw new Error("database_default_library_invariant_failed");
    }

    const installedOnRemovedLibrary = await this.database.get<{
      count: number;
    }>(
      `SELECT COUNT(*) AS count
       FROM game_versions v JOIN game_libraries l ON l.id = v.library_id
       WHERE v.lifecycle_state = 'installed' AND l.lifecycle_state <> 'active'`,
    );
    if ((installedOnRemovedLibrary?.count || 0) !== 0) {
      throw new Error("database_installed_library_invariant_failed");
    }

    const externalLibraries = await this.database.all<{
      id: string;
      root_path: string | null;
      normalized_root: string;
    }>(`SELECT id, root_path, normalized_root FROM game_libraries
       WHERE kind = 'external'`);
    for (const library of externalLibraries) {
      if (
        !library.root_path ||
        library.normalized_root !== normalizeGameLibraryRoot(library.root_path)
      ) {
        throw new Error(
          `database_external_library_invariant_failed:${library.id}`,
        );
      }
    }

    const versions = await this.database.all<{
      game_id: string;
      version: string;
      relative_path: string;
    }>("SELECT game_id, version, relative_path FROM game_versions");
    for (const version of versions) {
      assertCanonicalGameVersionRelativePath(version.relative_path, {
        gameId: version.game_id,
        version: version.version,
      });
    }
  }

  close(): Promise<void> {
    return this.database.close();
  }

  suspendForSnapshot(): Promise<void> {
    return this.database.suspendForSnapshot();
  }

  resumeAfterSnapshot(): void {
    this.database.resumeAfterSnapshot();
  }

  getDatabasePath(): string {
    return this.database.getDatabasePath();
  }

  run(
    sql: string,
    params: Array<string | number | bigint | Buffer | null> = [],
  ): Promise<void> {
    return this.database.run(sql, params).then(() => undefined);
  }

  get<T>(
    sql: string,
    params: Array<string | number | bigint | Buffer | null> = [],
  ): Promise<T | undefined> {
    return this.database.get<T>(sql, params);
  }

  all<T>(
    sql: string,
    params: Array<string | number | bigint | Buffer | null> = [],
  ): Promise<T[]> {
    return this.database.all<T>(sql, params);
  }

  batch(statements: SqliteBatchStatement[]): Promise<void> {
    return this.database.batch(statements);
  }

  async getGames(): Promise<GameRecord[]> {
    const [games, versions, achievements, stats, sessions] = await Promise.all([
      this.all<GameRow>(
        `SELECT g.id, g.added_at, g.is_favorite, g.sort_order
         FROM games g WHERE EXISTS (
           SELECT 1 FROM game_versions v
           WHERE v.game_id = g.id AND v.lifecycle_state = 'installed'
         ) ORDER BY g.sort_order, g.added_at`,
      ),
      this.all<VersionRow>(`SELECT v.game_id, v.version, v.library_id,
          v.relative_path, v.added_at, v.install_source, v.market_id
        FROM game_versions v
        WHERE v.lifecycle_state = 'installed'`),
      this.all<AchievementRow>(
        "SELECT game_id, version, achievement_id, unlocked_at FROM achievement_unlocks",
      ),
      this
        .all<StatsRow>(`SELECT game_id, version, stat_id, reported_value, report_mode
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
        libraryId: row.library_id,
        relativePath: row.relative_path,
        addedAt: row.added_at,
        installSource: row.install_source,
        marketId: row.market_id,
        stats: {},
        unlockedAchievements: [],
        playtime: 0,
      });
    }
    for (const row of achievements) {
      const version = gameMap
        .get(row.game_id)
        ?.versions.find((item) => item.version === row.version);
      version?.unlockedAchievements.push({
        id: row.achievement_id,
        unlockedAt: row.unlocked_at,
      });
    }
    for (const row of stats) {
      const version = gameMap
        .get(row.game_id)
        ?.versions.find((item) => item.version === row.version);
      if (!version) continue;
      version.stats[row.stat_id] =
        row.report_mode === "full"
          ? row.reported_value
          : (version.stats[row.stat_id] || 0) + row.reported_value;
    }
    for (const row of sessions) {
      const game = gameMap.get(row.game_id);
      const version = game?.versions.find(
        (item) => item.version === row.version,
      );
      if (version) version.playtime = row.playtime || 0;
      if (
        game &&
        row.last_played_at &&
        (!game.lastPlayedAt || row.last_played_at > game.lastPlayedAt)
      ) {
        game.lastPlayedAt = row.last_played_at;
      }
    }
    for (const game of gameMap.values()) {
      game.versions.sort((a, b) =>
        compareGameVersionsDescending(a.version, b.version),
      );
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
      {
        sql: `UPDATE game_versions SET lifecycle_state = 'removed',
          removed_at = COALESCE(removed_at, ?)`,
        params: [Date.now()],
      },
    ];
    for (const [sortOrder, game] of games.entries()) {
      statements.push({
        sql: `INSERT INTO games (id, added_at, is_favorite, sort_order) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET added_at=excluded.added_at,
          is_favorite=excluded.is_favorite, sort_order=excluded.sort_order`,
        params: [
          game.id,
          game.addedAt,
          game.isFavorite === undefined
            ? existingFavorites.get(game.id) || 0
            : game.isFavorite
              ? 1
              : 0,
          sortOrder,
        ],
      });
      for (const version of game.versions) {
        assertCanonicalGameVersionRelativePath(version.relativePath, {
          gameId: game.id,
          version: version.version,
        });
        statements.push({
          sql: `INSERT INTO game_versions
            (game_id, version, library_id, relative_path, added_at,
             install_source, market_id, lifecycle_state, removed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'installed', NULL)
            ON CONFLICT(game_id, version) DO UPDATE SET
            library_id=excluded.library_id, relative_path=excluded.relative_path,
            added_at=excluded.added_at,
            install_source=excluded.install_source, market_id=excluded.market_id,
            lifecycle_state='installed', removed_at=NULL`,
          params: [
            game.id,
            version.version,
            version.libraryId,
            version.relativePath,
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
    await this.run("UPDATE games SET is_favorite = ? WHERE id = ?", [
      favorite ? 1 : 0,
      gameId,
    ]);
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

  async recordStats(
    records: Array<{
      gameId: string;
      gameName: string;
      version: string;
      statId: string;
      statName: string;
      value: number;
      mode: "full" | "increment";
      reportedAt: number;
    }>,
  ): Promise<void> {
    await this.batch(
      records.map((record) => ({
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
      })),
    );
  }

  async softDelete(gameId: string, versions?: string[]): Promise<void> {
    const statements: SqliteBatchStatement[] = [];
    if (versions === undefined) {
      statements.push({
        sql: `UPDATE game_versions SET lifecycle_state = 'removed', removed_at = ?
          WHERE game_id = ? AND lifecycle_state = 'installed'`,
        params: [Date.now(), gameId],
      });
    } else {
      for (const version of versions) {
        statements.push({
          sql: `UPDATE game_versions SET lifecycle_state = 'removed', removed_at = ?
            WHERE game_id = ? AND version = ? AND lifecycle_state = 'installed'`,
          params: [Date.now(), gameId, version],
        });
      }
    }
    await this.batch(statements);
  }

  async getGameLibraries(): Promise<GameLibraryRecord[]> {
    return this
      .all<GameLibraryRecord>(`SELECT id, kind, root_path, normalized_root,
      display_name, is_default, created_at FROM game_libraries
      WHERE lifecycle_state = 'active'
      ORDER BY is_default DESC, created_at, id`);
  }

  async addExternalGameLibrary(rootPath: string): Promise<GameLibraryRecord> {
    const resolved = path.resolve(rootPath);
    const normalized = normalizeGameLibraryRoot(resolved);
    const existing = await this.get<
      GameLibraryRecord & { lifecycle_state: "active" | "removed" }
    >(
      `SELECT id, kind, root_path, normalized_root, display_name, is_default,
       created_at, lifecycle_state
       FROM game_libraries WHERE normalized_root = ? AND kind = 'external'`,
      [normalized],
    );
    if (existing) {
      if (existing.lifecycle_state === "active") return existing;
      await this.run(
        `UPDATE game_libraries SET root_path = ?, display_name = ?, is_default = 0,
         lifecycle_state = 'active', removed_at = NULL WHERE id = ?`,
        [resolved, path.basename(resolved), existing.id],
      );
      return {
        ...existing,
        root_path: resolved,
        display_name: path.basename(resolved),
        is_default: 0,
      };
    }
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    await this.run(
      `INSERT INTO game_libraries
       (id, kind, root_path, normalized_root, display_name, is_default, created_at)
       VALUES (?, 'external', ?, ?, ?, 0, ?)`,
      [id, resolved, normalized, path.basename(resolved), createdAt],
    );
    return {
      id,
      kind: "external",
      root_path: resolved,
      normalized_root: normalized,
      display_name: path.basename(resolved),
      is_default: 0,
      created_at: createdAt,
    };
  }

  async setDefaultGameLibrary(libraryId: string): Promise<void> {
    const target = await this.get<{ id: string }>(
      `SELECT id FROM game_libraries
       WHERE id = ? AND lifecycle_state = 'active'`,
      [libraryId],
    );
    if (!target) throw new Error("storage_path_not_registered");
    await this.batch([
      {
        sql: `UPDATE game_libraries SET is_default = 0
          WHERE is_default = 1 AND EXISTS (
            SELECT 1 FROM game_libraries
            WHERE id = ? AND lifecycle_state = 'active'
          )`,
        params: [libraryId],
      },
      {
        sql: `UPDATE game_libraries SET is_default = 1
          WHERE id = ? AND lifecycle_state = 'active'`,
        params: [libraryId],
      },
    ]);
  }

  async updateExternalGameLibrary(
    libraryId: string,
    rootPath: string,
  ): Promise<void> {
    const resolved = path.resolve(rootPath);
    await this.run(
      `UPDATE game_libraries SET root_path = ?, normalized_root = ?,
       display_name = ? WHERE id = ? AND kind = 'external'
       AND lifecycle_state = 'active'`,
      [
        resolved,
        normalizeGameLibraryRoot(resolved),
        path.basename(resolved),
        libraryId,
      ],
    );
  }

  async deactivateExternalGameLibraryAndVersions(
    libraryId: string,
  ): Promise<void> {
    const library = await this.get<{ is_default: 0 | 1 }>(
      `SELECT is_default FROM game_libraries
       WHERE id = ? AND kind = 'external' AND lifecycle_state = 'active'`,
      [libraryId],
    );
    if (!library) throw new Error("storage_path_not_registered");
    const timestamp = Date.now();
    const statements: SqliteBatchStatement[] = [
      {
        sql: `UPDATE game_versions SET lifecycle_state = 'removed', removed_at = ?
          WHERE library_id = ? AND lifecycle_state = 'installed'`,
        params: [timestamp, libraryId],
      },
    ];
    if (library.is_default === 1) {
      statements.push(
        {
          sql: "UPDATE game_libraries SET is_default = 0 WHERE id = ?",
          params: [libraryId],
        },
        {
          sql: `UPDATE game_libraries SET is_default = 1
            WHERE id = ? AND lifecycle_state = 'active'`,
          params: [BUILTIN_LIBRARY_ID],
        },
      );
    }
    statements.push({
      sql: `UPDATE game_libraries SET is_default = 0, lifecycle_state = 'removed',
        removed_at = ? WHERE id = ? AND kind = 'external'`,
      params: [timestamp, libraryId],
    });
    await this.batch(statements);
  }

  async checkIntegrity(): Promise<string[]> {
    const [rows, foreignKeys] = await Promise.all([
      this.all<{ integrity_check: string }>("PRAGMA integrity_check"),
      this.all<{
        table: string;
        rowid: number | null;
        parent: string;
        fkid: number;
      }>("PRAGMA foreign_key_check"),
    ]);
    return [
      ...rows
        .map((row) => row.integrity_check)
        .filter((result) => result !== "ok"),
      ...foreignKeys.map(
        (row) =>
          `foreign_key:${row.table}:${row.rowid ?? "unknown"}:${row.parent}:${row.fkid}`,
      ),
    ];
  }
}

export const bzGamesDatabase = new BzGamesDatabase();
