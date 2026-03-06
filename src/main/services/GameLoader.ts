import { dialog, app } from "electron";
import fs from "fs";
import path from "path";
import semver from "semver";
import {
  GameManifestSchema,
  type GameManifest,
} from "../../shared/game-manifest";
import { storeService } from "./StoreService";
import type { GameRecord } from "../../shared/types";
import { logger } from "../utils/logger";
import { copyFolderRecursiveSync } from "../utils/fileUtils";
import { getGamesDir } from "../utils/appPath";

export class GameLoader {
  private static cache: GameManifest[] | null = null;

  private static resolveImportDirectory(sourcePath: string): string | null {
    if (!sourcePath || typeof sourcePath !== "string") {
      return null;
    }

    const normalized = sourcePath.trim().replace(/^"(.*)"$/, "$1");
    if (!normalized || !fs.existsSync(normalized)) {
      return null;
    }

    const stat = fs.statSync(normalized);
    if (stat.isDirectory()) {
      return normalized;
    }

    let currentDir = path.dirname(normalized);
    while (true) {
      const manifestPath = path.join(currentDir, "game.json");
      if (fs.existsSync(manifestPath)) {
        return currentDir;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        return null;
      }
      currentDir = parent;
    }
  }

  static async loadGameFromDialog(): Promise<{
    success: boolean;
    manifest?: GameManifest;
    error?: string;
    params?: Record<string, any>;
  }> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Select Game Directory",
      properties: ["openDirectory"],
      filters: [],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, error: "canceled" };
    }

    return this.loadGameFromPath(filePaths[0]);
  }

  static async loadGameFromPath(sourcePath: string): Promise<{
    success: boolean;
    manifest?: GameManifest;
    error?: string;
    params?: Record<string, any>;
  }> {
    const resolvedSourcePath = this.resolveImportDirectory(sourcePath);
    if (!resolvedSourcePath) {
      return { success: false, error: "notDirectory" };
    }

    try {
      const manifest = await this.validateManifestFile(resolvedSourcePath);
      this.checkPlatformVersion(manifest);
      this.checkEntryFile(resolvedSourcePath, manifest);

      const targetPath = this.installGameFiles(resolvedSourcePath, manifest);
      await this.updateGameRecord(manifest, targetPath);

      this.cache = null;
      return { success: true, manifest };
    } catch (err: any) {
      if (err.code) {
        return { success: false, error: err.code, params: err.params };
      }
      logger.error("Failed to load game:", err);
      return {
        success: false,
        error: "unknown",
        params: { message: err.message || "Unknown error" },
      };
    }
  }

  private static async validateManifestFile(
    sourcePath: string,
  ): Promise<GameManifest> {
    const jsonPath = path.join(sourcePath, "game.json");
    if (!fs.existsSync(jsonPath)) {
      throw { code: "noManifest" };
    }

    try {
      return this.loadManifest(jsonPath);
    } catch (e: any) {
      logger.warn(`Invalid manifest at ${jsonPath}`, e);
      const { z } = await import("zod");
      let msg = e.message;

      if (e instanceof z.ZodError) {
        msg = e.errors
          .map((err) => `${err.path.join(".")}: ${err.message}`)
          .join("; ");
      }

      throw {
        code: "manifestInvalid",
        params: { message: msg },
      };
    }
  }

  private static checkPlatformVersion(manifest: GameManifest): void {
    const currentVersion = app.getVersion();
    let isCompatible = false;

    if (Array.isArray(manifest.platformVersion)) {
      const [min, max] = manifest.platformVersion;
      isCompatible =
        semver.gte(currentVersion, min) && semver.lte(currentVersion, max);
    } else {
      isCompatible = semver.satisfies(currentVersion, manifest.platformVersion);
    }

    if (!isCompatible) {
      throw {
        code: "platformVersionMismatch",
        params: { required: manifest.platformVersion, current: currentVersion },
      };
    }
  }

  private static checkEntryFile(
    sourcePath: string,
    manifest: GameManifest,
  ): void {
    const entryPath = path.join(sourcePath, manifest.entry);
    if (!fs.existsSync(entryPath)) {
      throw { code: "entryNotFound", params: { entry: manifest.entry } };
    }
  }

  private static loadManifest(jsonPath: string): GameManifest {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    return GameManifestSchema.parse(raw);
  }

  private static installGameFiles(
    sourcePath: string,
    manifest: GameManifest,
  ): string {
    const gamesDir = getGamesDir();
    if (!fs.existsSync(gamesDir)) {
      fs.mkdirSync(gamesDir, { recursive: true });
    }

    // Target path: <AppRoot>/games/<gameId>/<version>
    const gameRootDir = path.join(gamesDir, manifest.id);
    const targetPath = path.join(gameRootDir, manifest.version);

    // Remove existing version directory if it exists
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    // Copy game files
    logger.info(`Copying game files from ${sourcePath} to ${targetPath}`);
    copyFolderRecursiveSync(sourcePath, targetPath);

    return targetPath;
  }

  private static async updateGameRecord(
    manifest: GameManifest,
    targetPath: string,
  ): Promise<void> {
    const games = await storeService.getGames();
    let record = games.find((g) => g.id === manifest.id);

    if (record) {
      // Update existing record
      const versionExists = record.versions.some(
        (v) => v.version === manifest.version,
      );
      if (versionExists) {
        // Update path and addedAt for existing version
        record.versions = record.versions.map((v) =>
          v.version === manifest.version
            ? { ...v, path: targetPath, addedAt: Date.now() }
            : v,
        );
      } else {
        // Add new version
        record.versions.push({
          version: manifest.version,
          path: targetPath,
          addedAt: Date.now(),
          stats: {},
          unlockedAchievements: [],
          playtime: 0,
        });
      }

      // Update latest version
      record.latestVersion = record.versions.sort((a, b) =>
        b.version.localeCompare(a.version, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      )[0].version;
    } else {
      // Create new record
      record = {
        id: manifest.id,
        versions: [
          {
            version: manifest.version,
            path: targetPath,
            addedAt: Date.now(),
            stats: {},
            unlockedAchievements: [],
            playtime: 0,
          },
        ],
        latestVersion: manifest.version,
        addedAt: Date.now(),
      };
    }

    await storeService.addGame(record);
  }

  static async getAllGames(): Promise<GameManifest[]> {
    // Always scan and sync with disk to ensure paths are correct (portability)
    await this.scanAndSyncGames();

    if (this.cache) return this.cache;

    const records = await storeService.getGames();
    const manifests: GameManifest[] = [];

    for (const record of records) {
      // Find the path for the latest version
      const latest = record.versions.find(
        (v) => v.version === record.latestVersion,
      );
      if (latest) {
        const jsonPath = path.join(latest.path, "game.json");
        if (fs.existsSync(jsonPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
            manifests.push(GameManifestSchema.parse(raw));
          } catch (e) {
            logger.warn(`Failed to parse ${jsonPath}`);
          }
        }
      }
    }
    this.cache = manifests;
    return manifests;
  }

  private static async scanAndSyncGames(): Promise<void> {
    const gamesDir = getGamesDir();
    const records = await storeService.getGames();
    const diskGames = new Map<string, Set<string>>(); // gameId -> Set<version>

    // 1. Scan disk
    if (fs.existsSync(gamesDir)) {
      try {
        const gameDirs = fs.readdirSync(gamesDir);
        for (const gameId of gameDirs) {
          const gameRoot = path.join(gamesDir, gameId);
          if (!fs.statSync(gameRoot).isDirectory()) continue;

          const versions = fs.readdirSync(gameRoot);
          for (const version of versions) {
            const versionPath = path.join(gameRoot, version);
            if (!fs.statSync(versionPath).isDirectory()) continue;

            // Check if it looks like a game
            if (fs.existsSync(path.join(versionPath, "game.json"))) {
              if (!diskGames.has(gameId)) diskGames.set(gameId, new Set());
              diskGames.get(gameId)!.add(version);
            }
          }
        }
      } catch (e) {
        logger.error("Failed to scan games directory", e);
      }
    }

    // 2. Reconcile records
    const newRecords: GameRecord[] = [];

    // Process existing records
    for (const record of records) {
      const diskVersions = diskGames.get(record.id);
      if (!diskVersions) {
        // Game not found on disk, skip (remove)
        continue;
      }

      // Keep only versions that exist on disk
      const validVersions = record.versions.filter((v) =>
        diskVersions.has(v.version),
      );

      // Update paths for valid versions to current absolute path
      for (const v of validVersions) {
        v.path = path.join(gamesDir, record.id, v.version);
        diskVersions.delete(v.version); // Mark as handled
      }

      // Add any new versions found on disk
      for (const ver of diskVersions) {
        const versionPath = path.join(gamesDir, record.id, ver);
        validVersions.push({
          version: ver,
          path: versionPath,
          addedAt: Date.now(),
          stats: {},
          unlockedAchievements: [],
          playtime: 0,
        });
      }

      if (validVersions.length > 0) {
        // Sort versions descending
        validVersions.sort((a, b) =>
          b.version.localeCompare(a.version, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );

        record.versions = validVersions;
        record.latestVersion = validVersions[0].version;
        newRecords.push(record);
      }

      diskGames.delete(record.id); // Mark game as handled
    }

    // 3. Add completely new games found on disk
    for (const [gameId, versions] of diskGames) {
      const versionList = Array.from(versions);
      const gameVersions = versionList.map((ver) => ({
        version: ver,
        path: path.join(gamesDir, gameId, ver),
        addedAt: Date.now(),
        stats: {},
        unlockedAchievements: [],
        playtime: 0,
      }));

      // Sort versions
      gameVersions.sort((a, b) =>
        b.version.localeCompare(a.version, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );

      newRecords.push({
        id: gameId,
        versions: gameVersions,
        latestVersion: gameVersions[0].version,
        addedAt: Date.now(),
      });
    }

    // Save if changed (simple comparison or just save)
    // For simplicity and robustness, just save.
    // But we need to be careful not to overwrite if StoreService.saveGames is not available or behaves differently.
    // Assuming saveGames overwrites the 'games' array.
    await storeService.saveGames(newRecords);
    this.cache = null; // Invalidate cache
  }

  static async removeGame(id: string, versions?: string[]): Promise<void> {
    await storeService.removeGame(id, versions);
    this.cache = null;
  }

  static async getGameRecord(id: string): Promise<GameRecord | undefined> {
    const games = await storeService.getGames();
    return games.find((g) => g.id === id);
  }

  static async getVersionPath(
    gameId: string,
    version?: string,
  ): Promise<string | null> {
    const record = await this.getGameRecord(gameId);
    if (!record) return null;

    const targetVersion = version || record.latestVersion;
    const versionRecord = record.versions.find(
      (v) => v.version === targetVersion,
    );

    if (!versionRecord) return null;

    // Check if stored path exists
    if (fs.existsSync(versionRecord.path)) {
      return versionRecord.path;
    }

    // Fallback: Try standard path in games directory (fixes moved folders issue)
    const standardPath = path.join(getGamesDir(), gameId, targetVersion);
    if (fs.existsSync(standardPath)) {
      return standardPath;
    }

    return null;
  }

  static async getManifest(
    gameId: string,
    version?: string,
  ): Promise<GameManifest | null> {
    const versionPath = await this.getVersionPath(gameId, version);
    if (!versionPath) return null;

    const jsonPath = path.join(versionPath, "game.json");
    if (!fs.existsSync(jsonPath)) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      return GameManifestSchema.parse(raw);
    } catch (e) {
      logger.warn(
        `Failed to parse manifest for ${gameId} version ${version || "latest"}`,
        e,
      );
      return null;
    }
  }
}
