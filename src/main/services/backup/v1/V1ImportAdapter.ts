import crypto from "crypto";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import Database from "better-sqlite3-multiple-ciphers";
import { z } from "zod";
import {
  BZ_GAMES_DB_FILE_NAME,
  CONFIG_ENCRYPTION_SEED,
  DATABASE_ENCRYPTION_SEED,
} from "../../../../shared/AppConstants";
import { GameManifestV1Schema } from "../../../../shared/game-manifest";
import {
  NICKNAME_EFFECTS,
  type AppSettings,
  type AppStore,
  type UserData,
} from "../../../../shared/types";
import type { BackupImportPreview } from "../../../../shared/types";
import { copyFolderRecursive } from "../../../utils/fileUtils";
import {
  GameManifestFileError,
  readGameManifestFile,
  writeEncryptedGameManifestFile,
} from "../../game/GameManifestFileService";
import {
  BUILTIN_LIBRARY_ID,
  assertCanonicalGameVersionRelativePath,
  normalizeGameLibraryRoot,
  V4_SCHEMA_SQL,
} from "../../storage/database/BzGamesDatabase";
import {
  appStoreSchema,
  createDefaultV4Store,
  serializeV4Config,
} from "../../storage/ConfigCodec";

type SqlValue = string | number | bigint | Buffer | null;

export interface V1ManifestInput {
  format: "bzgames-migration";
  formatVersion: 1;
  sourceAppVersion: string;
  sourceGamesRoot: string;
}

const v1ArchiveManifestSchema = z
  .object({
    format: z.literal("bzgames-migration"),
    formatVersion: z.literal(1),
    exportedAt: z.string().datetime(),
    sourceAppVersion: z.literal("3.4.2"),
    sourcePlatform: z.literal("win32"),
    sourceArch: z.literal("x64"),
    sourceAppRoot: z.string().min(1),
    sourceGamesRoot: z.string().min(1),
    entries: z.tuple([
      z.literal("config.json"),
      z.literal("games"),
      z.literal("db"),
    ]),
    totalFiles: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  })
  .strict();

export interface V1ConversionSummary {
  games: number;
  versions: number;
  installedVersions: number;
  removedVersions: number;
  playSessions: number;
  achievements: number;
  statsEvents: number;
  encryptedBuiltinManifests: number;
  externalLibraryCount: number;
  inaccessibleExternalLibraries: string[];
  externalManifestPaths: string[];
}

export const V1_ARCHIVE_MANIFEST = "migration-manifest.json";

export interface V1PreparedImport {
  preview: BackupImportPreview;
  externalManifestPaths: string[];
}

interface V1GameRow {
  id: string;
  added_at: number;
  is_favorite: number;
  sort_order: number;
  is_present: number;
}

interface V1VersionRow {
  game_id: string;
  version: string;
  path: string;
  added_at: number;
  install_source?: string;
  market_id?: string | null;
  is_present: number;
}

interface LibraryMapping {
  id: string;
  kind: "builtin" | "external";
  sourceRoot: string;
  targetRoot: string;
  normalizedRoot: string;
  displayName: string;
  isDefault: number;
}

function encryptionKey(): Buffer {
  return crypto.createHash("sha256").update(DATABASE_ENCRYPTION_SEED).digest();
}

function deserializeV1ConfigForImport(content: string): unknown {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    throw new Error("v1_config_json_invalid", { cause: error });
  }
  if (
    !envelope ||
    envelope.__encrypted !== true ||
    envelope.algorithm !== "aes-256-gcm" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.payload !== "string"
  ) {
    throw new Error("v1_config_envelope_invalid");
  }
  try {
    const key = crypto
      .createHash("sha256")
      .update(CONFIG_ENCRYPTION_SEED)
      .digest();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.payload, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch (error) {
    throw new Error("v1_config_decrypt_failed", { cause: error });
  }
}

function openEncryptedDatabase(
  databasePath: string,
  options: Database.Options = {},
): Database.Database {
  const database = new Database(databasePath, options);
  database.pragma("cipher='chacha20'");
  database.key(encryptionKey());
  database.pragma("foreign_keys = ON");
  database.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
  return database;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function normalizeRoot(root: string): string {
  return normalizeGameLibraryRoot(root);
}

function assertSafeLibraryRoot(root: string): string {
  const resolved = path.resolve(root);
  if (resolved === path.parse(resolved).root) {
    throw new Error("v1_external_library_root_invalid");
  }
  return resolved;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      )
    : [];
}

function finitePositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function convertNicknameStyle(
  value: unknown,
  fallback: AppSettings["nicknameStyle"],
): AppSettings["nicknameStyle"] {
  const source = asRecord(value);
  return {
    color: stringValue(source.color, fallback.color),
    ...(typeof source.gradientStart === "string"
      ? { gradientStart: source.gradientStart }
      : {}),
    ...(typeof source.gradientEnd === "string"
      ? { gradientEnd: source.gradientEnd }
      : {}),
    font: ["system", "rounded", "serif", "mono", "fantasy"].includes(
      String(source.font),
    )
      ? (source.font as AppSettings["nicknameStyle"]["font"])
      : fallback.font,
    effect: NICKNAME_EFFECTS.includes(
      source.effect as (typeof NICKNAME_EFFECTS)[number],
    )
      ? (source.effect as AppSettings["nicknameStyle"]["effect"])
      : "none",
    weight: ["normal", "semibold", "bold"].includes(String(source.weight))
      ? (source.weight as AppSettings["nicknameStyle"]["weight"])
      : fallback.weight,
  };
}

function convertV1Config(raw: unknown): {
  store: AppStore;
  legacyStorageRoots: string[];
  legacyDefaultRoot: string;
} {
  const source = asRecord(raw);
  const sourceSettings = asRecord(source.settings);
  const sourceUserData = asRecord(source.userData);
  const sourceCheckIn = asRecord(sourceUserData.checkIn);
  const defaults = createDefaultV4Store();
  const settings: AppSettings = {
    ...defaults.settings,
    playerName: stringValue(
      sourceSettings.playerName,
      defaults.settings.playerName,
    ),
    playerId: stringValue(sourceSettings.playerId, crypto.randomUUID()),
    language: ["zh-CN", "en-US", "ja-JP", "zh-TW", "de-DE"].includes(
      String(sourceSettings.language),
    )
      ? (sourceSettings.language as AppSettings["language"])
      : defaults.settings.language,
    theme: ["dark", "light", "auto"].includes(String(sourceSettings.theme))
      ? (sourceSettings.theme as AppSettings["theme"])
      : defaults.settings.theme,
    defaultRoomPort: Math.min(
      65535,
      Math.max(
        1,
        Math.trunc(finiteNumber(sourceSettings.defaultRoomPort, 38080)),
      ),
    ),
    closeBehavior: sourceSettings.closeBehavior === "exit" ? "exit" : "tray",
    autoLaunch: booleanValue(sourceSettings.autoLaunch, false),
    sensitiveWordFilter: booleanValue(
      sourceSettings.sensitiveWordFilter ?? sourceSettings.filterSensitiveWords,
      true,
    ),
    libraryLayout: ["card", "icon", "steam"].includes(
      String(sourceSettings.libraryLayout ?? sourceSettings.libraryLayoutMode),
    )
      ? ((sourceSettings.libraryLayout ??
          sourceSettings.libraryLayoutMode) as AppSettings["libraryLayout"])
      : "card",
  };
  for (const key of ["avatar", "lastJoinRoomAddress"] as const) {
    if (typeof sourceSettings[key] === "string") {
      settings[key] = sourceSettings[key] as never;
    }
  }
  settings.nicknameStyle = convertNicknameStyle(
    sourceSettings.nicknameStyle,
    defaults.settings.nicknameStyle,
  );
  const chatBounds = asRecord(sourceSettings.chatWindowBounds);
  if (
    [chatBounds.x, chatBounds.y, chatBounds.width, chatBounds.height].every(
      (item) => typeof item === "number" && Number.isFinite(item),
    ) &&
    Number(chatBounds.width) > 0 &&
    Number(chatBounds.height) > 0
  ) {
    settings.chatWindowBounds = {
      x: Number(chatBounds.x),
      y: Number(chatBounds.y),
      width: Number(chatBounds.width),
      height: Number(chatBounds.height),
    };
  }
  const floatPosition = asRecord(sourceSettings.floatBallPosition);
  if (
    [floatPosition.x, floatPosition.y].every(
      (item) => typeof item === "number" && Number.isFinite(item),
    )
  ) {
    settings.floatBallPosition = {
      x: Number(floatPosition.x),
      y: Number(floatPosition.y),
    };
  }
  settings.chatInputHeight = finitePositiveNumber(
    sourceSettings.chatInputHeight,
    defaults.settings.chatInputHeight,
  );
  if (typeof sourceSettings.downloadFloatBall === "boolean") {
    settings.downloadFloatBall = sourceSettings.downloadFloatBall;
  }

  const consecutiveDays = Math.max(
    0,
    Math.trunc(finiteNumber(sourceCheckIn.consecutiveDays, 0)),
  );
  const userData: UserData = {
    bzCoins: Math.max(0, finiteNumber(sourceUserData.bzCoins, 0)),
    checkIn: {
      lastCheckInDate: stringValue(sourceCheckIn.lastCheckInDate, ""),
      consecutiveDays,
      maxConsecutiveDays: Math.max(
        consecutiveDays,
        Math.trunc(finiteNumber(sourceCheckIn.maxConsecutiveDays, 0)),
      ),
      totalDays: Math.max(
        0,
        Math.trunc(finiteNumber(sourceCheckIn.totalDays, 0)),
      ),
    },
    ownedFrames: stringArray(sourceUserData.ownedFrames),
    ownedGameCardProducts: stringArray(sourceUserData.ownedGameCardProducts),
  };
  if (typeof sourceUserData.equippedFrame === "string") {
    userData.equippedFrame = sourceUserData.equippedFrame;
  }
  if (typeof sourceUserData.equippedGameCardProduct === "string") {
    userData.equippedGameCardProduct = sourceUserData.equippedGameCardProduct;
  }

  const legacyStorageRoots = stringArray(sourceSettings.gameStorageHistory);
  const legacyDefaultRoot = stringValue(sourceSettings.gameStoragePath, "");
  if (legacyDefaultRoot) legacyStorageRoots.unshift(legacyDefaultRoot);
  return {
    store: appStoreSchema.parse({ settings, userData }),
    legacyStorageRoots: Array.from(
      new Set(legacyStorageRoots.map((root) => path.resolve(root))),
    ),
    legacyDefaultRoot,
  };
}

function validateV1Schema(database: Database.Database): void {
  const schemas: Record<string, { required: string[]; optional?: string[] }> = {
    games: {
      required: ["id", "added_at", "is_favorite", "sort_order", "is_present"],
    },
    game_versions: {
      required: [
        "game_id",
        "version",
        "path",
        "added_at",
        "install_source",
        "market_id",
        "is_present",
      ],
    },
    play_sessions: {
      required: [
        "id",
        "game_id",
        "game_name",
        "version",
        "start_time",
        "end_time",
        "duration_ms",
      ],
    },
    achievement_unlocks: {
      required: [
        "game_id",
        "game_name",
        "version",
        "achievement_id",
        "achievement_name",
        "unlocked_at",
      ],
    },
    stats_reports: {
      required: [
        "event_id",
        "game_id",
        "game_name",
        "version",
        "stat_id",
        "stat_name",
        "reported_value",
        "report_mode",
        "reported_at",
      ],
      optional: ["event_sequence"],
    },
  };
  for (const [table, schema] of Object.entries(schemas)) {
    const columns = database
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((row) => String((row as { name: unknown }).name));
    const actual = new Set(columns);
    const allowed = new Set([...schema.required, ...(schema.optional || [])]);
    if (
      schema.required.some((column) => !actual.has(column)) ||
      columns.some((column) => !allowed.has(column))
    ) {
      throw new Error(`v1_database_schema_invalid:${table}`);
    }
  }
  const integrity = database.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error("v1_database_integrity_failed");
  }
}

function copyRows(
  source: Database.Database,
  destination: Database.Database,
  table: string,
  columns: string[],
): number {
  const rows = source
    .prepare(
      `SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "${table}"`,
    )
    .all() as Array<Record<string, SqlValue>>;
  const insert = destination.prepare(
    `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) insert.run(...columns.map((column) => row[column]));
  return rows.length;
}

function convertManifestIfNeeded(manifestPath: string): boolean {
  try {
    readGameManifestFile(manifestPath);
    return false;
  } catch (error) {
    if (
      !(error instanceof GameManifestFileError) ||
      error.code !== "manifestPlaintextUnsupported"
    ) {
      throw error;
    }
  }
  const parsed = GameManifestV1Schema.parse(
    JSON.parse(fs.readFileSync(manifestPath, "utf8")),
  );
  writeEncryptedGameManifestFile(manifestPath, parsed);
  return true;
}

export async function convertExtractedV1ToV4(
  extractedRoot: string,
  stagingDataRoot: string,
  manifest: V1ManifestInput,
): Promise<V1ConversionSummary> {
  const sourceDbPath = path.join(extractedRoot, BZ_GAMES_DB_FILE_NAME);
  const sourceConfigPath = path.join(extractedRoot, "config.json");
  const stagingGamesRoot = path.join(stagingDataRoot, "games");
  const stagingDbPath = path.join(stagingDataRoot, BZ_GAMES_DB_FILE_NAME);
  const stagingDbRoot = path.dirname(stagingDbPath);

  // V1 packages may contain database files left by versions older than 3.4.2.
  // The conversion target is disposable staging data: rebuild its db directory
  // from the sole authoritative 3.4.2 database instead of copying any legacy
  // database, journal, WAL, SHM or import residue.
  await fsPromises.rm(stagingDbRoot, { recursive: true, force: true });
  await fsPromises.mkdir(stagingDbRoot, { recursive: true });

  const rawConfig = deserializeV1ConfigForImport(
    await fsPromises.readFile(sourceConfigPath, "utf8"),
  );
  const convertedConfig = convertV1Config(rawConfig);
  await fsPromises.writeFile(
    path.join(stagingDataRoot, "config.json"),
    serializeV4Config(convertedConfig.store),
    { encoding: "utf8", mode: 0o600 },
  );

  const source = openEncryptedDatabase(sourceDbPath, { readonly: true });
  const destination = openEncryptedDatabase(stagingDbPath);
  const externalManifestPaths: string[] = [];
  const inaccessibleExternalLibraries: string[] = [];
  let encryptedBuiltinManifests = 0;
  let summary: V1ConversionSummary | undefined;
  try {
    validateV1Schema(source);
    destination.exec("BEGIN IMMEDIATE");
    try {
      for (const sql of V4_SCHEMA_SQL) destination.exec(sql);
      destination
        .prepare(
          "INSERT INTO bz_schema_meta (singleton, schema_fingerprint) VALUES (1, ?)",
        )
        .run(
          crypto
            .createHash("sha256")
            .update(V4_SCHEMA_SQL.join("\n"))
            .digest("hex"),
        );

      const sourceGamesRoot = assertSafeLibraryRoot(manifest.sourceGamesRoot);
      const libraryByRoot = new Map<string, LibraryMapping>();
      const externalRoots = convertedConfig.legacyStorageRoots
        .filter(
          (root) => normalizeRoot(root) !== normalizeRoot(sourceGamesRoot),
        )
        .map((root) => path.resolve(root));
      const defaultNormalized = convertedConfig.legacyDefaultRoot
        ? normalizeRoot(convertedConfig.legacyDefaultRoot)
        : "";
      const ensureExternalLibrary = (root: string): LibraryMapping => {
        const safeRoot = assertSafeLibraryRoot(root);
        const normalized = normalizeRoot(safeRoot);
        const existing = libraryByRoot.get(normalized);
        if (existing) return existing;
        const library: LibraryMapping = {
          id: crypto.randomUUID(),
          kind: "external",
          sourceRoot: safeRoot,
          targetRoot: safeRoot,
          normalizedRoot: normalized,
          displayName: path.basename(safeRoot),
          isDefault: normalized === defaultNormalized ? 1 : 0,
        };
        libraryByRoot.set(normalized, library);
        if (library.isDefault === 1) {
          destination
            .prepare("UPDATE game_libraries SET is_default = 0 WHERE id = ?")
            .run(BUILTIN_LIBRARY_ID);
        }
        destination
          .prepare(
            `INSERT INTO game_libraries
            (id, kind, root_path, normalized_root, display_name, is_default, created_at)
            VALUES (?, 'external', ?, ?, ?, ?, ?)`,
          )
          .run(
            library.id,
            library.targetRoot,
            library.normalizedRoot,
            library.displayName,
            library.isDefault,
            Date.now(),
          );
        return library;
      };
      for (const root of externalRoots) ensureExternalLibrary(root);

      const games = source.prepare("SELECT * FROM games").all() as V1GameRow[];
      const versions = source
        .prepare("SELECT * FROM game_versions")
        .all() as V1VersionRow[];
      const insertGame = destination.prepare(`INSERT INTO games
        (id, added_at, is_favorite, sort_order) VALUES (?, ?, ?, ?)`);
      for (const game of games) {
        insertGame.run(
          game.id,
          game.added_at,
          game.is_favorite,
          game.sort_order,
        );
      }
      const insertVersion = destination.prepare(`INSERT INTO game_versions
        (game_id, version, library_id, relative_path, added_at,
         install_source, market_id, lifecycle_state, removed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const version of versions) {
        const absolutePath = path.resolve(version.path);
        let libraryId = BUILTIN_LIBRARY_ID;
        let relativePath: string;
        let targetManifestPath: string;
        if (isWithin(sourceGamesRoot, absolutePath)) {
          relativePath = path.relative(sourceGamesRoot, absolutePath);
          targetManifestPath = path.join(
            stagingGamesRoot,
            relativePath,
            "game.json",
          );
        } else {
          const matchedRoot = externalRoots
            .filter((root) => isWithin(root, absolutePath))
            .sort((a, b) => b.length - a.length)[0];
          const inferredRoot =
            matchedRoot || path.dirname(path.dirname(absolutePath));
          const library = ensureExternalLibrary(inferredRoot);
          libraryId = library.id;
          relativePath = path.relative(library.sourceRoot, absolutePath);
          targetManifestPath = path.join(absolutePath, "game.json");
          if (fs.existsSync(targetManifestPath)) {
            externalManifestPaths.push(targetManifestPath);
          } else if (
            !inaccessibleExternalLibraries.includes(library.targetRoot)
          ) {
            inaccessibleExternalLibraries.push(library.targetRoot);
          }
        }
        const normalizedRelative = relativePath.split(path.sep).join("/");
        try {
          assertCanonicalGameVersionRelativePath(normalizedRelative, {
            gameId: version.game_id,
            version: version.version,
          });
        } catch {
          throw new Error(
            `v1_game_path_invalid:${version.game_id}:${version.version}`,
          );
        }
        const installed = version.is_present === 1;
        if (
          installed &&
          libraryId === BUILTIN_LIBRARY_ID &&
          !fs.existsSync(targetManifestPath)
        ) {
          throw new Error(
            `v1_installed_game_missing:${version.game_id}:${version.version}`,
          );
        }
        insertVersion.run(
          version.game_id,
          version.version,
          libraryId,
          normalizedRelative,
          version.added_at,
          version.install_source === "market" ? "market" : "manual",
          typeof version.market_id === "string" ? version.market_id : null,
          installed ? "installed" : "removed",
          installed ? null : Date.now(),
        );
        if (
          libraryId === BUILTIN_LIBRARY_ID &&
          fs.existsSync(targetManifestPath)
        ) {
          if (convertManifestIfNeeded(targetManifestPath))
            encryptedBuiltinManifests += 1;
        }
      }

      const playSessions = copyRows(source, destination, "play_sessions", [
        "id",
        "game_id",
        "game_name",
        "version",
        "start_time",
        "end_time",
        "duration_ms",
      ]);
      const achievements = copyRows(
        source,
        destination,
        "achievement_unlocks",
        [
          "game_id",
          "game_name",
          "version",
          "achievement_id",
          "achievement_name",
          "unlocked_at",
        ],
      );
      const statsEvents = copyRows(source, destination, "stats_reports", [
        "event_id",
        "game_id",
        "game_name",
        "version",
        "stat_id",
        "stat_name",
        "reported_value",
        "report_mode",
        "reported_at",
      ]);
      destination.exec("COMMIT");

      const integrity = destination.pragma("integrity_check") as Array<{
        integrity_check: string;
      }>;
      if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
        throw new Error("v4_staging_database_integrity_failed");
      }
      summary = {
        games: games.length,
        versions: versions.length,
        installedVersions: versions.filter((row) => row.is_present === 1)
          .length,
        removedVersions: versions.filter((row) => row.is_present !== 1).length,
        playSessions,
        achievements,
        statsEvents,
        encryptedBuiltinManifests,
        externalLibraryCount: libraryByRoot.size,
        inaccessibleExternalLibraries,
        externalManifestPaths: Array.from(new Set(externalManifestPaths)),
      };
    } catch (error) {
      if (destination.inTransaction) destination.exec("ROLLBACK");
      throw error;
    }
  } finally {
    source.close();
    destination.close();
  }

  for (const entry of await fsPromises.readdir(stagingDbRoot)) {
    if (entry !== path.basename(stagingDbPath)) {
      await fsPromises.rm(path.join(stagingDbRoot, entry), {
        recursive: true,
        force: true,
      });
    }
  }
  if (!summary) throw new Error("v1_conversion_summary_missing");
  return summary;
}

export async function encryptExternalV1ManifestsWithRollback(
  manifestPaths: string[],
  rollbackRoot: string,
): Promise<number> {
  let converted = 0;
  const changes: Array<{ source: string; backup: string }> = [];
  await fsPromises.mkdir(rollbackRoot, { recursive: true });
  try {
    for (const [index, manifestPath] of manifestPaths.entries()) {
      try {
        readGameManifestFile(manifestPath);
        continue;
      } catch (error) {
        if (
          !(error instanceof GameManifestFileError) ||
          error.code !== "manifestPlaintextUnsupported"
        ) {
          throw error;
        }
      }
      const backupPath = path.join(rollbackRoot, `${index}.game.json`);
      await fsPromises.copyFile(manifestPath, backupPath);
      changes.push({ source: manifestPath, backup: backupPath });
      const parsed = GameManifestV1Schema.parse(
        JSON.parse(await fsPromises.readFile(manifestPath, "utf8")),
      );
      writeEncryptedGameManifestFile(manifestPath, parsed);
      converted += 1;
    }
    return converted;
  } catch (error) {
    for (const change of changes.reverse()) {
      await fsPromises
        .copyFile(change.backup, change.source)
        .catch(() => undefined);
    }
    throw error;
  }
}

export async function restoreExternalV1Manifests(
  manifestPaths: string[],
  rollbackRoot: string,
): Promise<void> {
  for (const [index, manifestPath] of manifestPaths.entries()) {
    const backupPath = path.join(rollbackRoot, `${index}.game.json`);
    if (await fsPromises.stat(backupPath).catch(() => null)) {
      await fsPromises.copyFile(backupPath, manifestPath);
    }
  }
}

export async function tryPrepareV1Import(
  extractedRoot: string,
  convertedRoot: string,
  fallback: { totalFiles: number; totalBytes: number },
): Promise<V1PreparedImport | null> {
  const manifestPath = path.join(extractedRoot, V1_ARCHIVE_MANIFEST);
  if (!(await fsPromises.stat(manifestPath).catch(() => null))) return null;
  const parsedManifest = v1ArchiveManifestSchema.safeParse(
    JSON.parse(await fsPromises.readFile(manifestPath, "utf8")),
  );
  if (!parsedManifest.success) {
    throw new Error("backup_v1_manifest_invalid");
  }
  const manifest = parsedManifest.data;

  await fsPromises.mkdir(convertedRoot, { recursive: true });
  const sourceGames = path.join(extractedRoot, "games");
  const convertedGames = path.join(convertedRoot, "games");
  await fsPromises.mkdir(convertedGames, { recursive: true });
  if (await fsPromises.stat(sourceGames).catch(() => null)) {
    await copyFolderRecursive(sourceGames, convertedGames);
  }
  await fsPromises.rm(path.join(convertedGames, ".imports"), {
    recursive: true,
    force: true,
  });
  const summary = await convertExtractedV1ToV4(
    extractedRoot,
    convertedRoot,
    manifest,
  );
  return {
    preview: {
      token: "",
      formatVersion: 1,
      dataModelVersion: 1,
      sourceAppVersion: manifest.sourceAppVersion,
      exportedAt: manifest.exportedAt,
      totalFiles: manifest.totalFiles || fallback.totalFiles,
      totalBytes: manifest.totalBytes || fallback.totalBytes,
      externalLibraryCount: summary.externalLibraryCount,
    },
    externalManifestPaths: summary.externalManifestPaths,
  };
}
