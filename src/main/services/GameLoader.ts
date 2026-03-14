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

export interface ImportPreparationResult {
  sourcePath: string;
  hasManifest: boolean;
  currentPlatformVersion: string;
  suggestedId: string;
  suggestedName: string;
  suggestedEntry: string;
}

export interface ManualManifestDraft {
  id: string;
  name: string;
  version: string;
  description?: string;
  author: string;
  entry?: string;
  platformVersion?: string;
  icon?: string;
  cover?: string;
  type: "singleplayer" | "multiplayer" | "singlemultiple";
  minPlayers?: number;
  maxPlayers?: number;
}

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
    return path.dirname(normalized);
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
      this.verifyManifestVersion(manifest.version);
      this.checkPlatformVersion(manifest);
      this.checkEntryFile(resolvedSourcePath, manifest);
      await this.ensureVersionNotExists(manifest.id, manifest.version);
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

  static async prepareImportFromPath(
    sourcePath: string,
  ): Promise<ImportPreparationResult | null> {
    const resolvedSourcePath = this.resolveImportDirectory(sourcePath);
    if (!resolvedSourcePath) {
      return null;
    }

    const folderName = path.basename(resolvedSourcePath);
    const hasManifest = fs.existsSync(path.join(resolvedSourcePath, "game.json"));
    const suggestedEntry = (() => {
      try {
        return this.detectEntryFile(resolvedSourcePath);
      } catch {
        return "";
      }
    })();
    return {
      sourcePath: resolvedSourcePath,
      hasManifest,
      currentPlatformVersion: app.getVersion(),
      suggestedId: this.normalizeSuggestedId(folderName),
      suggestedName: folderName,
      suggestedEntry,
    };
  }

  static async loadGameFromPathWithManifest(
    sourcePath: string,
    draft: ManualManifestDraft,
  ): Promise<{
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
      const manifest = this.buildManualManifestDraft(draft);
      this.verifyManifestVersion(manifest.version);
      this.checkPlatformVersion(manifest);
      this.checkEntryFile(resolvedSourcePath, manifest);
      this.checkOptionalFile(resolvedSourcePath, manifest.icon, "iconNotFound");
      this.checkOptionalFile(resolvedSourcePath, manifest.cover, "coverNotFound");
      await this.ensureGameIdNotExists(manifest.id);
      await this.ensureVersionNotExists(manifest.id, manifest.version);

      const targetPath = this.installGameFiles(resolvedSourcePath, manifest);
      fs.writeFileSync(
        path.join(targetPath, "game.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );
      await this.updateGameRecord(manifest, targetPath);

      this.cache = null;
      return { success: true, manifest };
    } catch (err: any) {
      if (err.code) {
        return { success: false, error: err.code, params: err.params };
      }
      logger.error("Failed to load game with draft manifest:", err);
      return {
        success: false,
        error: "unknown",
        params: { message: err.message || "Unknown error" },
      };
    }
  }

  static async checkGameIdExists(gameId: string): Promise<boolean> {
    const id = gameId.trim();
    if (!id) return false;
    const games = await storeService.getGames();
    return games.some((g) => g.id === id);
  }

  private static async validateManifestFile(
    sourcePath: string,
  ): Promise<GameManifest> {
    const jsonPath = path.join(sourcePath, "game.json");
    if (!fs.existsSync(jsonPath)) {
      throw { code: "noManifest", params: { sourcePath } };
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

  private static normalizeSuggestedId(name: string): string {
    const segment = name
      .toLowerCase()
      .replace(/[^a-z0-9\-\.]/g, "-")
      .replace(/^\.+|\.+$/g, "")
      .replace(/\.+/g, ".")
      .replace(/-+/g, "-");
    if (!segment) {
      return "local.game.untitled";
    }
    if (segment.includes(".")) {
      return segment;
    }
    return `local.game.${segment}`;
  }

  private static detectEntryFile(sourcePath: string): string {
    const preferred = [
      "index.html",
      "main.html",
      "game.html",
      "game.exe",
      "main.exe",
      "start.bat",
      "start.cmd",
    ];
    for (const candidate of preferred) {
      if (fs.existsSync(path.join(sourcePath, candidate))) {
        return candidate;
      }
    }
    const files = fs.readdirSync(sourcePath);
    const exe = files.find((f) => f.toLowerCase().endsWith(".exe"));
    if (exe) return exe;
    const html = files.find((f) => f.toLowerCase().endsWith(".html"));
    if (html) return html;
    throw { code: "entryNotFound", params: { entry: "index.html | *.exe" } };
  }

  private static buildManualManifestDraft(draft: ManualManifestDraft): GameManifest {
    const entry = draft.entry?.trim();
    if (!entry || path.isAbsolute(entry) || entry.includes("..")) {
      throw { code: "entryNotFound", params: { entry: entry || "" } };
    }
    const minPlayers = draft.minPlayers || 2;
    const maxPlayers = draft.maxPlayers || Math.max(minPlayers, 4);
    if (
      draft.type !== "singleplayer" &&
      (!Number.isInteger(minPlayers) ||
        !Number.isInteger(maxPlayers) ||
        minPlayers < 2 ||
        maxPlayers < minPlayers)
    ) {
      throw { code: "playersInvalid" };
    }
    const parsed = GameManifestSchema.parse({
      id: draft.id.trim(),
      name: draft.name.trim(),
      version: draft.version.trim(),
      description: draft.description?.trim() || "",
      author: draft.author.trim(),
      platformVersion: app.getVersion(),
      entry,
      icon: draft.icon?.trim() || undefined,
      cover: draft.cover?.trim() || undefined,
      type: draft.type,
      multiplayer:
        draft.type === "singleplayer"
          ? undefined
          : {
              minPlayers,
              maxPlayers,
            },
    });
    return parsed;
  }

  private static verifyManifestVersion(version: string): void {
    if (!semver.valid(version)) {
      throw { code: "versionInvalid" };
    }
  }

  private static checkOptionalFile(
    sourcePath: string,
    filePath: string | undefined,
    code: string,
  ): void {
    if (!filePath) return;
    if (path.isAbsolute(filePath) || filePath.includes("..")) {
      throw { code };
    }
    const absolute = path.join(sourcePath, filePath);
    if (!fs.existsSync(absolute)) {
      throw { code, params: { file: filePath } };
    }
  }

  private static async ensureVersionNotExists(
    id: string,
    version: string,
  ): Promise<void> {
    const games = await storeService.getGames();
    const existingRecord = games.find((g) => g.id === id);
    const versionExists = existingRecord?.versions.some((v) => v.version === version);
    if (versionExists) {
      throw { code: "versionExists", params: { version } };
    }
  }

  private static async ensureGameIdNotExists(id: string): Promise<void> {
    const exists = await this.checkGameIdExists(id);
    if (exists) {
      throw { code: "idExists", params: { id } };
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
    const scanRoots = storeService.getGameStorageRoots();
    const records = await storeService.getGames();
    const diskGames = new Map<string, Map<string, string>>();

    for (const root of scanRoots) {
      if (!fs.existsSync(root)) continue;
      try {
        const gameDirs = fs.readdirSync(root);
        for (const gameId of gameDirs) {
          const gameRoot = path.join(root, gameId);
          if (!fs.statSync(gameRoot).isDirectory()) continue;
          const versions = fs.readdirSync(gameRoot);
          for (const version of versions) {
            const versionPath = path.join(gameRoot, version);
            if (!fs.statSync(versionPath).isDirectory()) continue;
            if (!fs.existsSync(path.join(versionPath, "game.json"))) continue;
            if (!diskGames.has(gameId)) {
              diskGames.set(gameId, new Map());
            }
            const versionMap = diskGames.get(gameId)!;
            if (!versionMap.has(version)) {
              versionMap.set(version, versionPath);
            }
          }
        }
      } catch (e) {
        logger.error(`Failed to scan games directory: ${root}`, e);
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
      const validVersions = record.versions
        .filter((v) => diskVersions.has(v.version))
        .map((v) => ({
          ...v,
          path: diskVersions.get(v.version)!,
        }));

      for (const v of validVersions) {
        diskVersions.delete(v.version);
      }

      // Add any new versions found on disk
      for (const [ver, versionPath] of diskVersions.entries()) {
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
    for (const [gameId, versions] of diskGames.entries()) {
      const gameVersions = Array.from(versions.entries()).map(
        ([version, versionPath]) => ({
          version,
          path: versionPath,
          addedAt: Date.now(),
          stats: {},
          unlockedAchievements: [],
          playtime: 0,
        }),
      );

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

    const fallbackRoots = storeService.getGameStorageRoots();
    for (const root of fallbackRoots) {
      const standardPath = path.join(root, gameId, targetVersion);
      if (fs.existsSync(standardPath)) {
        return standardPath;
      }
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
