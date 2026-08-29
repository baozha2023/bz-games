import fs from "fs/promises";
import path from "path";
import { BZ_GAMES_DB_FILE_NAME } from "../../../shared/AppConstants";
import { readGameManifestFile } from "../game/GameManifestFileService";
import { deserializeV4Config } from "../storage/ConfigCodec";
import {
  BUILTIN_LIBRARY_ID,
  BzGamesDatabase,
  assertCanonicalGameVersionRelativePath,
  normalizeGameLibraryRoot,
  V4_USER_VERSION,
} from "../storage/database/BzGamesDatabase";

export interface V4DataValidationSummary {
  totalGames: number;
  totalVersions: number;
  installedVersions: number;
  removedVersions: number;
  externalLibraryCount: number;
}

export async function validateV4DataRoot(
  dataRoot: string,
): Promise<V4DataValidationSummary> {
  const config = deserializeV4Config(
    await fs.readFile(path.join(dataRoot, "config.json"), "utf8"),
  );
  const settings = config.settings;
  if (
    settings.accountSessionToken ||
    settings.accountSessionExpiresAt ||
    settings.accountUserLogin ||
    settings.accountUserName ||
    settings.accountUserProfileUrl ||
    settings.githubToken
  ) {
    throw new Error("backup_config_credentials_forbidden");
  }
  const database = new BzGamesDatabase(
    path.join(dataRoot, BZ_GAMES_DB_FILE_NAME),
  );
  try {
    await database.initialize();
    const version = await database.get<{ user_version: number }>(
      "PRAGMA user_version",
    );
    if (version?.user_version !== V4_USER_VERSION) {
      throw new Error("backup_database_version_invalid");
    }
    const integrity = await database.checkIntegrity();
    if (integrity.length > 0)
      throw new Error("backup_database_integrity_failed");
    const libraries = await database.all<{
      id: string;
      kind: "builtin" | "external";
      root_path: string | null;
      normalized_root: string;
      lifecycle_state: "active" | "removed";
    }>(`SELECT id, kind, root_path, normalized_root, lifecycle_state
        FROM game_libraries`);
    for (const library of libraries) {
      if (library.kind === "builtin") {
        if (
          library.id !== BUILTIN_LIBRARY_ID ||
          library.root_path !== null ||
          library.normalized_root !== "builtin://games" ||
          library.lifecycle_state !== "active"
        ) {
          throw new Error("backup_builtin_library_invalid");
        }
      } else if (
        !library.root_path ||
        library.normalized_root !== normalizeGameLibraryRoot(library.root_path)
      ) {
        throw new Error(`backup_external_library_invalid:${library.id}`);
      }
    }
    const versions = await database.all<{
      game_id: string;
      version: string;
      library_id: string;
      relative_path: string;
      lifecycle_state: "installed" | "removed";
    }>(`SELECT game_id, version, library_id, relative_path, lifecycle_state
      FROM game_versions`);
    for (const row of versions) {
      try {
        assertCanonicalGameVersionRelativePath(row.relative_path, {
          gameId: row.game_id,
          version: row.version,
        });
      } catch {
        throw new Error(`backup_database_relative_path_invalid:${row.game_id}`);
      }
      const segments = row.relative_path.split("/");
      if (
        row.library_id === BUILTIN_LIBRARY_ID &&
        row.lifecycle_state === "installed"
      ) {
        readGameManifestFile(
          path.join(dataRoot, "games", ...segments, "game.json"),
        );
      }
    }
    const [gameCount, externalCount] = await Promise.all([
      database.get<{ count: number }>("SELECT COUNT(*) AS count FROM games"),
      database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM game_libraries WHERE kind = 'external'",
      ),
    ]);
    return {
      totalGames: gameCount?.count || 0,
      totalVersions: versions.length,
      installedVersions: versions.filter(
        (row) => row.lifecycle_state === "installed",
      ).length,
      removedVersions: versions.filter(
        (row) => row.lifecycle_state === "removed",
      ).length,
      externalLibraryCount: externalCount?.count || 0,
    };
  } finally {
    await database.close();
  }
}
