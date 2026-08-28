import { app } from "electron";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import semver from "semver";
import {
  GameManifestV2Schema,
  compareGameVersionsDescending,
  parseGameManifest,
  resolveGameManifest,
  type GameManifest,
  type ResolvedGameManifest,
} from "../../../shared/game-manifest";
import type { SupportedLocale } from "../../../shared/localization";
import { storeService } from "../storage/StoreService";
import {
  GameType,
  type GameInstallProvenance,
  type GameRecord,
  type GameVersion,
} from "../../../shared/types";
import { logger } from "../../utils/logger";
import {
  copyFolderRecursive,
  type FolderCopyProgress,
} from "../../utils/fileUtils";
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

export interface GameImportProgress extends Omit<FolderCopyProgress, "phase"> {
  phase: "scanning" | "copying" | "finalizing";
}

export interface GameImportExecutionOptions {
  taskId?: string;
  storagePath?: string;
  signal?: AbortSignal;
  onProgress?: (progress: GameImportProgress) => void | Promise<void>;
}

export interface PreparedGameImport {
  sourcePath: string;
  manifest: GameManifest;
  existingGame: boolean;
}

type EntryCandidate = {
  relativePath: string;
  name: string;
  extension: string;
  depth: number;
  size: number;
};

const IMPORT_TASK_MARKER = ".bz-import-task";

export class GameLoader {
  private static cache: ResolvedGameManifest[] | null = null;
  private static cacheLocale: SupportedLocale | null = null;
  private static finalizationChain: Promise<void> = Promise.resolve();

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

  static async loadGameFromPath(
    sourcePath: string,
    provenance: GameInstallProvenance = {
      installSource: "manual",
      marketId: null,
    },
    options: GameImportExecutionOptions = {},
  ): Promise<{
    success: boolean;
    manifest?: ResolvedGameManifest;
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
      await this.installAndRecordGame(
        resolvedSourcePath,
        manifest,
        provenance,
        options,
      );

      this.cache = null;
      return {
        success: true,
        manifest: this.resolveManifest(manifest),
      };
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
    const suggestedEntry = hasManifest
      ? ""
      : (() => {
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
    options: GameImportExecutionOptions = {},
  ): Promise<{
    success: boolean;
    manifest?: ResolvedGameManifest;
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

      await this.installAndRecordGame(
        resolvedSourcePath,
        manifest,
        {
          installSource: "manual",
          marketId: null,
        },
        options,
      );

      this.cache = null;
      return {
        success: true,
        manifest: this.resolveManifest(manifest),
      };
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

  static async prepareGameImport(
    sourcePath: string,
    draft?: ManualManifestDraft,
  ): Promise<PreparedGameImport> {
    const resolvedSourcePath = this.resolveImportDirectory(sourcePath);
    if (!resolvedSourcePath) {
      throw { code: "notDirectory" };
    }
    const manifest = draft
      ? this.buildManualManifestDraft(draft)
      : await this.validateManifestFile(resolvedSourcePath);
    this.verifyManifestVersion(manifest);
    this.assertPlatformCompatible(manifest);
    this.checkEntryFile(resolvedSourcePath, manifest);
    this.checkOptionalManifestFiles(resolvedSourcePath, manifest);
    const existingGame = await this.checkGameIdExists(manifest.id);
    if (draft || manifest.type === GameType.NetworkGame) {
      await this.ensureGameIdNotExists(manifest.id);
    }
    if (manifest.type !== GameType.NetworkGame) {
      await this.ensureVersionNotExists(manifest.id, manifest.version);
    }
    return { sourcePath: resolvedSourcePath, manifest, existingGame };
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
        if (entry.isSymbolicLink()) continue;
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
    const locale = storeService.getSettings().language;
    const parsed = GameManifestV2Schema.parse({
      manifestVersion: 2,
      id: draft.id.trim(),
      version: draft.version.trim(),
      defaultLocale: locale,
      localizations: {
        [locale]: {
          name: draft.name.trim(),
          description: draft.description?.trim() || "",
          achievements: {},
          statistics: {},
        },
      },
      author: draft.author.trim(),
      platformVersion: app.getVersion(),
      entry,
      web_url: draft.web_url?.trim() || undefined,
      icon: draft.icon?.trim() || undefined,
      cover: draft.cover?.trim() || undefined,
      type: draft.type,
      achievements: [],
      statistics: [],
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
    try {
      return readGameManifestFile(jsonPath);
    } catch (error) {
      if (
        !(error instanceof GameManifestFileError) ||
        error.code !== "manifestPlaintextUnsupported"
      ) {
        throw error;
      }
    }
    // 导入源目录按契约使用明文清单（游戏包 game.json 始终为明文）；
    // 此处仅解析不改写源文件，落盘加密由 installGameFiles 统一完成，
    // 游戏库内运行时读取仍只认密文（readGameManifestFile 保持严格）。
    return parseGameManifest(JSON.parse(fs.readFileSync(jsonPath, "utf8")));
  }

  private static resolveManifest(
    manifest: GameManifest,
  ): ResolvedGameManifest {
    return resolveGameManifest(manifest, storeService.getSettings().language);
  }

  private static async installGameFiles(
    sourcePath: string,
    manifest: GameManifest,
    options: GameImportExecutionOptions,
  ): Promise<string> {
    const gamesDir =
      options.storagePath || storeService.getDefaultGameStoragePath();
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
    const stagingRoot = path.join(gamesDir, ".imports");
    const stagingPath = path.join(
      stagingRoot,
      options.taskId || crypto.randomUUID(),
    );

    if (fs.existsSync(targetPath)) {
      throw {
        code: "versionExists",
        params: { id: manifest.id, version: manifest.version },
      };
    }

    logger.info(`Copying game files from ${sourcePath} to ${targetPath}`);
    try {
      await fsp.rm(stagingPath, { recursive: true, force: true });
      await copyFolderRecursive(sourcePath, stagingPath, {
        signal: options.signal,
        onProgress: options.onProgress,
      });
      await options.onProgress?.({
        phase: "finalizing",
        processedBytes: 0,
        totalBytes: 0,
        processedFiles: 0,
        totalFiles: 0,
      });
      writeEncryptedGameManifestFile(
        path.join(stagingPath, "game.json"),
        manifest,
      );
      if (options.taskId) {
        await fsp.writeFile(
          path.join(stagingPath, IMPORT_TASK_MARKER),
          options.taskId,
          "utf8",
        );
      }
      await fsp.mkdir(gameRootDir, { recursive: true });
      if (fs.existsSync(targetPath)) {
        throw { code: "versionExists", params: { version: manifest.version } };
      }
      await fsp.rename(stagingPath, targetPath);
      return targetPath;
    } catch (error) {
      await this.removeIncompleteInstall(stagingPath);
      throw error;
    }
  }

  private static async installAndRecordGame(
    sourcePath: string,
    manifest: GameManifest,
    provenance: GameInstallProvenance,
    options: GameImportExecutionOptions,
  ): Promise<void> {
    const targetPath = await this.installGameFiles(
      sourcePath,
      manifest,
      options,
    );
    try {
      const finalize = this.finalizationChain.then(() =>
        this.updateGameRecord(manifest, targetPath, provenance),
      );
      this.finalizationChain = finalize.catch(() => undefined);
      await finalize;
    } catch (error) {
      await this.removeIncompleteInstall(targetPath);
      throw error;
    }
    if (options.taskId) {
      try {
        await fsp.rm(path.join(targetPath, IMPORT_TASK_MARKER), { force: true });
      } catch (error) {
        logger.warn(
          `[GameLoader] Failed to remove completed import marker ${options.taskId}`,
          error,
        );
      }
    }
  }

  private static async removeIncompleteInstall(
    targetPath: string,
  ): Promise<void> {
    try {
      if (fs.existsSync(targetPath)) {
        await fsp.rm(targetPath, {
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

  static async cleanupInterruptedImportTarget(
    storagePath: string,
    gameId: string,
    version: string,
    taskId: string,
  ): Promise<void> {
    const storageRoot = path.resolve(storagePath);
    const targetPath = path.resolve(storageRoot, gameId, version);
    const relative = path.relative(storageRoot, targetPath);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).length !== 2
    ) {
      logger.warn(
        `[GameLoader] Refusing to clean unsafe interrupted import path: ${targetPath}`,
      );
      return;
    }
    try {
      const marker = await fsp.readFile(
        path.join(targetPath, IMPORT_TASK_MARKER),
        "utf8",
      );
      if (marker !== taskId) return;
      await this.removeIncompleteInstall(targetPath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        logger.warn(
          `[GameLoader] Failed to inspect interrupted import ${taskId}`,
          error,
        );
      }
    }
  }

  private static async updateGameRecord(
    manifest: GameManifest,
    targetPath: string,
    provenance: GameInstallProvenance,
  ): Promise<void> {
    const games = await storeService.getGames();
    let record = games.find((g) => g.id === manifest.id);
    const location = storeService.getGameVersionLocation(targetPath);

    if (manifest.type === GameType.NetworkGame) {
      const versionRecord = {
        version: manifest.version,
        ...location,
        addedAt: Date.now(),
        ...provenance,
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
            ? { ...v, ...location, addedAt: Date.now(), ...provenance }
            : v,
        );
      } else {
        // Add new version
        record.versions.push({
          version: manifest.version,
          ...location,
          addedAt: Date.now(),
          ...provenance,
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
            ...location,
            addedAt: Date.now(),
            ...provenance,
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

  static async getAllGames(): Promise<ResolvedGameManifest[]> {
    // Always scan and sync with disk to ensure paths are correct (portability)
    await this.scanAndSyncGames();

    const locale = storeService.getSettings().language;
    if (this.cache && this.cacheLocale === locale) return this.cache;

    const records = await storeService.getGames();
    const manifests: ResolvedGameManifest[] = [];

    for (const record of records) {
      // Find the path for the latest version
      const latest = record.versions.find(
        (v) => v.version === record.latestVersion,
      );
      if (latest) {
        const jsonPath = path.join(
          storeService.resolveGameVersionPath(latest),
          "game.json",
        );
        if (fs.existsSync(jsonPath)) {
          try {
            manifests.push(resolveGameManifest(readGameManifestFile(jsonPath), locale));
          } catch (e) {
            logger.warn(`Failed to parse ${jsonPath}`, e);
          }
        }
      }
    }
    this.cache = manifests;
    this.cacheLocale = locale;
    return manifests;
  }

  private static async scanAndSyncGames(): Promise<void> {
    const scanRoots = storeService.getGameStorageRoots();
    const records = await storeService.getGames();
    const diskGames = new Map<
      string,
      Map<string, Pick<GameVersion, "libraryId" | "relativePath">>
    >();

    for (const root of scanRoots) {
      if (!fs.existsSync(root)) continue;
      try {
        const gameDirs = fs.readdirSync(root);
        for (const gameId of gameDirs) {
          if (gameId === ".imports") continue;
          const gameRoot = path.join(root, gameId);
          const gameRootStat = fs.lstatSync(gameRoot);
          if (!gameRootStat.isDirectory() || gameRootStat.isSymbolicLink()) {
            continue;
          }
          const versions = fs.readdirSync(gameRoot);
          for (const version of versions) {
            const versionPath = path.join(gameRoot, version);
            const versionStat = fs.lstatSync(versionPath);
            if (!versionStat.isDirectory() || versionStat.isSymbolicLink()) {
              continue;
            }
            if (!fs.existsSync(path.join(versionPath, "game.json"))) continue;
            if (!diskGames.has(gameId)) {
              diskGames.set(gameId, new Map());
            }
            const versionMap = diskGames.get(gameId)!;
            if (!versionMap.has(version)) {
              versionMap.set(
                version,
                storeService.getGameVersionLocation(versionPath),
              );
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
          ...diskVersions.get(v.version)!,
        }));

      for (const v of validVersions) {
        diskVersions.delete(v.version);
      }

      // Add any new versions found on disk
      for (const [ver, location] of diskVersions.entries()) {
        validVersions.push({
          version: ver,
          ...location,
          addedAt: Date.now(),
          installSource: "manual",
          marketId: null,
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
      const gameVersions: GameVersion[] = Array.from(versions.entries()).map(
        ([version, location]) => ({
          version,
          ...location,
          addedAt: Date.now(),
          installSource: "manual",
          marketId: null,
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

    // Persist the current on-disk presence set. Missing entities remain in SQLite
    // with lifecycle_state='removed' and can be reactivated when discovered again.
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

    const versionPath = storeService.resolveGameVersionPath(versionRecord);
    return fs.existsSync(versionPath) ? versionPath : null;
  }

  static async getManifest(
    gameId: string,
    version?: string,
  ): Promise<ResolvedGameManifest | null> {
    const versionPath = await this.getVersionPath(gameId, version);
    if (!versionPath) return null;

    const jsonPath = path.join(versionPath, "game.json");
    if (!fs.existsSync(jsonPath)) return null;

    try {
      return this.resolveManifest(readGameManifestFile(jsonPath));
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
