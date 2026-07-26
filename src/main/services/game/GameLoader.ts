import { dialog, app } from "electron";
import fs from "fs";
import path from "path";
import semver from "semver";
import {
  GameManifestSchema,
  compareGameVersionsDescending,
  type GameManifest,
} from "../../../shared/game-manifest";
import { storeService } from "../storage/StoreService";
import { GameType, type GameRecord } from "../../../shared/types";
import { logger } from "../../utils/logger";
import { copyFolderRecursiveSync } from "../../utils/fileUtils";
import {
  GameManifestFileError,
  readGameManifestFile,
  writeEncryptedGameManifestFile,
} from "./GameManifestFileService";

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
  web_url?: string;
  platformVersion?: string;
  icon?: string;
  cover?: string;
  type: GameType;
  minPlayers?: number;
  maxPlayers?: number;
}

type EntryCandidate = {
  relativePath: string;
  name: string;
  extension: string;
  depth: number;
  size: number;
};

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
      this.verifyManifestVersion(manifest);
      this.assertPlatformCompatible(manifest);
      this.checkEntryFile(resolvedSourcePath, manifest);
      this.checkOptionalManifestFiles(resolvedSourcePath, manifest);
      if (manifest.type === GameType.NetworkGame) {
        await this.ensureGameIdNotExists(manifest.id);
      } else {
        await this.ensureVersionNotExists(manifest.id, manifest.version);
      }
      await this.installAndRecordGame(resolvedSourcePath, manifest);

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
    const hasManifest = fs.existsSync(
      path.join(resolvedSourcePath, "game.json"),
    );
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
      this.verifyManifestVersion(manifest);
      this.assertPlatformCompatible(manifest);
      this.checkEntryFile(resolvedSourcePath, manifest);
      this.checkOptionalManifestFiles(resolvedSourcePath, manifest);
      await this.ensureGameIdNotExists(manifest.id);
      if (manifest.type !== GameType.NetworkGame) {
        await this.ensureVersionNotExists(manifest.id, manifest.version);
      }

      await this.installAndRecordGame(resolvedSourcePath, manifest);

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
      if (e instanceof GameManifestFileError) {
        throw { code: e.code, params: { message: e.message } };
      }
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

  static detectEntryFile(sourcePath: string): string {
    const folderName = path.basename(sourcePath).toLowerCase();
    const preferredNames = [
      "index.html",
      "main.html",
      "game.html",
      "play.html",
      "index.htm",
      "main.htm",
      "game.htm",
      `${folderName}.exe`,
      "game.exe",
      "main.exe",
      "launcher.exe",
      "launch.exe",
      "start.exe",
      "play.exe",
      "start.bat",
      "launch.bat",
      "start.cmd",
      "launch.cmd",
    ];
    const entries = this.collectEntryCandidates(sourcePath);
    const preferred = entries.find((entry) =>
      preferredNames.includes(entry.relativePath.toLowerCase()),
    );
    if (preferred) return preferred.relativePath;

    const html = this.pickBestEntryCandidate(
      entries,
      [".html", ".htm"],
      folderName,
    );
    if (html) return html.relativePath;

    const executable = this.pickBestEntryCandidate(
      entries,
      [".exe", ".bat", ".cmd"],
      folderName,
    );
    if (executable) return executable.relativePath;

    throw {
      code: "entryNotFound",
      params: { entry: "index.html | *.exe | start.bat" },
    };
  }

  private static collectEntryCandidates(sourcePath: string): EntryCandidate[] {
    const ignoredDirectories = new Set([
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      "__macosx",
      "cache",
      "logs",
      "log",
      "tmp",
      "temp",
      "save",
      "saves",
      "screenshots",
    ]);
    const allowedExtensions = new Set([
      ".html",
      ".htm",
      ".exe",
      ".bat",
      ".cmd",
    ]);
    const candidates: EntryCandidate[] = [];
    const walk = (directory: string, depth: number) => {
      if (depth > 3) return;
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name.toLowerCase())) {
            walk(absolutePath, depth + 1);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) continue;
        const relativePath = path
          .relative(sourcePath, absolutePath)
          .split(path.sep)
          .join("/");
        candidates.push({
          relativePath,
          name: entry.name,
          extension,
          depth,
          size: fs.statSync(absolutePath).size,
        });
      }
    };
    walk(sourcePath, 0);
    return candidates;
  }

  private static pickBestEntryCandidate(
    candidates: EntryCandidate[],
    extensions: string[],
    folderName: string,
  ): EntryCandidate | undefined {
    const extensionSet = new Set(extensions);
    const ignoredExecutableNames = new Set([
      "unins000.exe",
      "uninstall.exe",
      "uninstaller.exe",
      "setup.exe",
      "install.exe",
      "installer.exe",
      "crashhandler.exe",
      "crashreporter.exe",
      "unitycrashhandler32.exe",
      "unitycrashhandler64.exe",
      "vcredist_x86.exe",
      "vcredist_x64.exe",
    ]);
    return candidates
      .filter((candidate) => extensionSet.has(candidate.extension))
      .filter(
        (candidate) =>
          candidate.extension !== ".exe" ||
          !ignoredExecutableNames.has(candidate.name.toLowerCase()),
      )
      .sort(
        (a, b) =>
          this.scoreEntryCandidate(b, folderName) -
          this.scoreEntryCandidate(a, folderName),
      )[0];
  }

  private static scoreEntryCandidate(
    candidate: EntryCandidate,
    folderName: string,
  ) {
    const lowerName = candidate.name.toLowerCase();
    const baseName = path
      .basename(candidate.name, candidate.extension)
      .toLowerCase();
    const lowerPath = candidate.relativePath.toLowerCase();
    let score = 100 - candidate.depth * 18;
    if (lowerName === "index.html" || lowerName === "index.htm") score += 80;
    if (
      ["main", "game", "play", "start", "launch", "launcher"].includes(baseName)
    ) {
      score += 65;
    }
    if (baseName === folderName) score += 70;
    if (
      lowerPath.includes("/bin/") ||
      lowerPath.includes("/build/") ||
      lowerPath.includes("/release/")
    ) {
      score += 18;
    }
    if (candidate.extension === ".exe")
      score += Math.min(35, Math.floor(candidate.size / 1024 / 1024));
    if (
      lowerName.includes("unins") ||
      lowerName.includes("setup") ||
      lowerName.includes("install")
    )
      score -= 120;
    return score;
  }

  private static buildManualManifestDraft(
    draft: ManualManifestDraft,
  ): GameManifest {
    const entry = draft.entry?.trim();
    if (!entry) {
      throw { code: "entryNotFound", params: { entry: entry || "" } };
    }
    if (
      entry !== "serve" &&
      entry !== "url" &&
      (path.isAbsolute(entry) || entry.includes(".."))
    ) {
      throw { code: "entryNotFound", params: { entry } };
    }
    const minPlayers = draft.minPlayers || 2;
    const maxPlayers = draft.maxPlayers || Math.max(minPlayers, 4);
    const needsMultiplayerConfig =
      draft.type === GameType.Multiplayer ||
      draft.type === GameType.SingleMultiple;
    if (
      needsMultiplayerConfig &&
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
      web_url: draft.web_url?.trim() || undefined,
      icon: draft.icon?.trim() || undefined,
      cover: draft.cover?.trim() || undefined,
      type: draft.type,
      multiplayer: needsMultiplayerConfig
        ? {
            minPlayers,
            maxPlayers,
          }
        : undefined,
    });
    return parsed;
  }

  private static verifyManifestVersion(manifest: GameManifest): void {
    if (!semver.valid(manifest.version)) {
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
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw { code, params: { file: filePath } };
    }
  }

  private static checkOptionalManifestFiles(
    sourcePath: string,
    manifest: GameManifest,
  ): void {
    this.checkOptionalFile(sourcePath, manifest.icon, "iconNotFound");
    this.checkOptionalFile(sourcePath, manifest.cover, "coverNotFound");
    this.checkOptionalFile(sourcePath, manifest.video, "videoNotFound");
    for (const achievement of manifest.achievements || []) {
      this.checkOptionalFile(sourcePath, achievement.icon, "iconNotFound");
    }
  }

  private static async ensureVersionNotExists(
    id: string,
    version: string,
  ): Promise<void> {
    const games = await storeService.getGames();
    const existingRecord = games.find((g) => g.id === id);
    const versionExists = existingRecord?.versions.some(
      (v) => v.version === version,
    );
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

  static assertPlatformCompatible(manifest: GameManifest): void {
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
    if (manifest.entry === "url") {
      return;
    }
    const relativeEntry =
      manifest.entry === "serve" ? "index.html" : manifest.entry;
    const entryPath = path.join(sourcePath, relativeEntry);
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
      throw { code: "entryNotFound", params: { entry: relativeEntry } };
    }
  }

  private static loadManifest(jsonPath: string): GameManifest {
    return readGameManifestFile(jsonPath);
  }

  private static installGameFiles(
    sourcePath: string,
    manifest: GameManifest,
  ): string {
    const gamesDir = storeService.getGameStoragePath();
    if (!fs.existsSync(gamesDir)) {
      fs.mkdirSync(gamesDir, { recursive: true });
    }

    const gameRootDir = path.join(gamesDir, manifest.id);

    if (fs.existsSync(gameRootDir) && !fs.statSync(gameRootDir).isDirectory()) {
      throw {
        code: "versionExists",
        params: { id: manifest.id, version: manifest.version },
      };
    }

    const targetPath = path.join(gameRootDir, manifest.version);

    if (fs.existsSync(targetPath)) {
      throw {
        code: "versionExists",
        params: { id: manifest.id, version: manifest.version },
      };
    }

    logger.info(`Copying game files from ${sourcePath} to ${targetPath}`);
    try {
      copyFolderRecursiveSync(sourcePath, targetPath);
      writeEncryptedGameManifestFile(
        path.join(targetPath, "game.json"),
        manifest,
      );
      return targetPath;
    } catch (error) {
      this.removeIncompleteInstall(targetPath);
      throw error;
    }
  }

  private static async installAndRecordGame(
    sourcePath: string,
    manifest: GameManifest,
  ): Promise<void> {
    const targetPath = this.installGameFiles(sourcePath, manifest);
    try {
      await this.updateGameRecord(manifest, targetPath);
    } catch (error) {
      this.removeIncompleteInstall(targetPath);
      throw error;
    }
  }

  private static removeIncompleteInstall(targetPath: string): void {
    try {
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 500,
        });
      }
    } catch (error) {
      logger.error(`Failed to clean incomplete install: ${targetPath}`, error);
      return;
    }

    const gameRootDir = path.dirname(targetPath);
    try {
      if (
        fs.existsSync(gameRootDir) &&
        fs.statSync(gameRootDir).isDirectory() &&
        fs.readdirSync(gameRootDir).length === 0
      ) {
        fs.rmdirSync(gameRootDir);
      }
    } catch (error) {
      logger.warn(
        `Failed to clean empty game directory: ${gameRootDir}`,
        error,
      );
    }
  }

  private static async updateGameRecord(
    manifest: GameManifest,
    targetPath: string,
  ): Promise<void> {
    const games = await storeService.getGames();
    let record = games.find((g) => g.id === manifest.id);

    if (manifest.type === GameType.NetworkGame) {
      const versionRecord = {
        version: manifest.version,
        path: targetPath,
        addedAt: Date.now(),
        stats: {},
        unlockedAchievements: [],
        playtime: 0,
      };
      if (record) {
        record.versions = [versionRecord];
        record.latestVersion = manifest.version;
        record.addedAt = Date.now();
      } else {
        record = {
          id: manifest.id,
          versions: [versionRecord],
          latestVersion: manifest.version,
          addedAt: Date.now(),
        };
      }
    } else if (record) {
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
        compareGameVersionsDescending(a.version, b.version),
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
            manifests.push(
              readGameManifestFile(jsonPath, { migratePlaintext: true }),
            );
          } catch (e) {
            logger.warn(`Failed to parse ${jsonPath}`, e);
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
          compareGameVersionsDescending(a.version, b.version),
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
        compareGameVersionsDescending(a.version, b.version),
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
      return readGameManifestFile(jsonPath, { migratePlaintext: true });
    } catch (e) {
      logger.warn(
        `Failed to parse manifest for ${gameId} version ${version || "latest"}`,
        e,
      );
      if (e instanceof GameManifestFileError) throw e;
      return null;
    }
  }
}
