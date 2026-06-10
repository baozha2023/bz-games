import crypto from "crypto";
import { app } from "electron";
import ElectronStore from "electron-store";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import type {
  AppStore,
  AppSettings,
  DataHealthIssue,
  DataHealthReport,
  GameRecord,
  GameVersion,
  UserData,
  NicknameStyle,
} from "../../../shared/types";
import { DEFAULT_NICKNAME_STYLE } from "../../../shared/types";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { AVATAR_FRAMES } from "../../../shared/avatar-frames";
import {
  CONFIG_ENCRYPTION_SEED,
  PLAYTIME_REWARD_AMOUNT,
  PLAYTIME_REWARD_INTERVAL_MS,
} from "../../../shared/AppConstants";

const defaultSettings: AppSettings = {
  playerName: "玩家",
  playerId: "",
  nicknameStyle: DEFAULT_NICKNAME_STYLE,
  libraryLayout: "card",
  lastJoinRoomAddress: "",
  language: "zh-CN",
  theme: "auto",
  defaultRoomPort: 38080,
  closeBehavior: "tray",
  autoLaunch: false,
  ignoredUpdateVersion: "",
  gameStoragePath: "",
  gameStorageHistory: [],
  lastOpenedAt: undefined,
  ignoreDefaultGamesMigrationPrompt: false,
  chatInputHeight: 204,
  downloadFloatBall: false,
  sensitiveWordFilter: true,
};

const defaultUserData: UserData = {
  bzCoins: 0,
  cumulativePlayTime: 0,
  checkIn: {
    lastCheckInDate: "",
    consecutiveDays: 0,
    totalDays: 0,
  },
  ownedFrames: [],
  equippedFrame: undefined,
};

const defaultStore: AppStore = {
  games: [],
  settings: defaultSettings,
  userData: defaultUserData,
  recentPlayed: [],
};

function createConfigCipherKey(): Buffer {
  return crypto.createHash("sha256").update(CONFIG_ENCRYPTION_SEED).digest();
}

function encryptConfigPayload(data: AppStore): string {
  const key = createConfigCipherKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    __encrypted: true,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    payload: encrypted.toString("base64"),
  });
}

function tryDecryptConfigPayload(raw: any): AppStore | null {
  if (!raw || raw.__encrypted !== true) {
    return null;
  }

  try {
    const key = createConfigCipherKey();
    const iv = Buffer.from(raw.iv, "base64");
    const tag = Buffer.from(raw.tag, "base64");
    const payload = Buffer.from(raw.payload, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted);
    return typeof parsed === "object" && parsed ? (parsed as AppStore) : null;
  } catch {
    return null;
  }
}

function deserializeConfig(content: string): AppStore {
  try {
    const parsed = JSON.parse(content);
    const decrypted = tryDecryptConfigPayload(parsed);
    if (decrypted) return decrypted;
    if (typeof parsed === "object" && parsed) {
      return parsed as AppStore;
    }
  } catch {}
  return defaultStore;
}

function mergeStoreWithDefaults(raw: Partial<AppStore>): AppStore {
  return {
    ...defaultStore,
    ...raw,
    games: raw.games || [],
    recentPlayed: raw.recentPlayed || [],
    settings: {
      ...defaultSettings,
      ...(raw.settings || {}),
    },
    userData: {
      ...defaultUserData,
      ...(raw.userData || {}),
    },
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toSnapshotLabel(targetPath: string): string {
  return targetPath
    .replace(/[:\\\/]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

class StoreService {
  private store: ElectronStore<AppStore> | null = null;
  private _initPromise: Promise<void> | null = null;

  private async restoreDataFromSnapshotIfNeeded(dataRoot: string): Promise<void> {
    const configPath = path.join(dataRoot, "config.json");
    const defaultGamesPath = path.join(dataRoot, "games");
    const dbPath = path.join(dataRoot, "db");

    const needConfig = !(await pathExists(configPath));
    const needGames = !(await pathExists(defaultGamesPath));
    const needDb = !(await pathExists(dbPath));

    if (!needConfig && !needGames && !needDb) {
      return;
    }

    const configBackupName = `config_${toSnapshotLabel(configPath)}.backup`;
    const gamesBackupName = `games_${toSnapshotLabel(defaultGamesPath)}`;
    const dbBackupName = `db_${toSnapshotLabel(dbPath)}`;
    const snapshotRoot = path.join(app.getPath("userData"), ".update-snapshots");

    let snapshots: string[] = [];
    try {
      const entries = await fs.readdir(snapshotRoot, { withFileTypes: true });
      snapshots = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch {
      return;
    }

    for (const dirName of snapshots) {
      const dirPath = path.join(snapshotRoot, dirName);

      if (needConfig) {
        const configBackups = [
          path.join(dirPath, configBackupName),
          path.join(dirPath, "config.json.backup"),
        ];
        for (const backupPath of configBackups) {
          if (await pathExists(backupPath)) {
            await fs.copyFile(backupPath, configPath);
            logger.info(
              `[StoreService] Restored config.json from snapshot: ${dirPath}`,
            );
            break;
          }
        }
      }

      if (needGames) {
        const gamesBackupPath = path.join(dirPath, gamesBackupName);
        if (await pathExists(gamesBackupPath)) {
          await fs.cp(gamesBackupPath, defaultGamesPath, { recursive: true });
          logger.info(
            `[StoreService] Restored games dir from snapshot: ${dirPath}`,
          );
        }
      }

      if (needDb) {
        const dbBackupPath = path.join(dirPath, dbBackupName);
        if (await pathExists(dbBackupPath)) {
          await fs.cp(dbBackupPath, dbPath, { recursive: true });
          logger.info(
            `[StoreService] Restored db dir from snapshot: ${dirPath}`,
          );
        }
      }

      return;
    }
  }

  /**
   * Initialize the store.
   * This must be called after app.whenReady().
   */
  async init(): Promise<void> {
    if (this.store) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        const dataRoot = getAppRoot();
        await fs.mkdir(dataRoot, { recursive: true });
        await this.restoreDataFromSnapshotIfNeeded(dataRoot);

        const configPath = path.join(dataRoot, "config.json");
        let legacyData: AppStore | null = null;
        try {
          const rawText = await fs.readFile(configPath, "utf-8");
          const raw = JSON.parse(rawText);
          if (!raw || raw.__encrypted !== true) {
            if (typeof raw === "object" && raw) {
              legacyData = raw as AppStore;
            }
          }
        } catch {}

        const Store = (await import("electron-store")).default;
        this.store = new Store<AppStore>({
          name: "config",
          defaults: defaultStore,
          cwd: dataRoot,
          serialize: (data) => encryptConfigPayload(data),
          deserialize: (content) => deserializeConfig(content),
        });
        logger.info(`[StoreService] Store initialized at: ${this.store.path}`);

        if (legacyData) {
          const merged = mergeStoreWithDefaults(legacyData);
          this.store.store = merged;
          logger.info("[StoreService] Migrated legacy config.json to encrypted");
        }
      } catch (error) {
        logger.error("[StoreService] Failed to initialize store:", error);
        throw error;
      }
    })();

    return this._initPromise;
  }

  private getStore(): ElectronStore<AppStore> {
    if (!this.store) {
      throw new Error("StoreService not initialized! Call init() first.");
    }
    return this.store;
  }

  private getGamesList(): GameRecord[] {
    return this.getStore().get("games", []) || [];
  }

  private findGameById(
    games: GameRecord[],
    id: string,
  ): { game: GameRecord; index: number } | null {
    const index = games.findIndex((g) => g.id === id);
    if (index === -1) return null;
    return { game: games[index], index };
  }

  getGames(): GameRecord[] {
    return this.getGamesList();
  }

  getUserData(): UserData {
    return this.getStore().get("userData") || defaultUserData;
  }

  performBuyFrame(frameId: string, coinCost: number): {
    success: boolean;
    code?: string;
  } {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;

    if (!userData.ownedFrames) userData.ownedFrames = [];

    if (userData.ownedFrames.includes(frameId)) {
      return { success: false, code: "already_owned" };
    }

    if ((userData.bzCoins || 0) < coinCost) {
      return { success: false, code: "insufficient_coins" };
    }

    userData.bzCoins -= coinCost;
    userData.ownedFrames.push(frameId);
    userData.equippedFrame = frameId;

    store.set("userData", userData);
    return { success: true };
  }

  performSaveNicknameStyle(style: NicknameStyle, coinCost: number): {
    success: boolean;
    code?: string;
  } {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;

    if ((userData.bzCoins || 0) < coinCost) {
      return { success: false, code: "insufficient_coins" };
    }

    userData.bzCoins -= coinCost;
    store.set("userData", userData);
    this.saveSettings({ nicknameStyle: style });
    return { success: true };
  }

  performEquipFrame(frameId: string): void {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;

    if (!userData.ownedFrames) userData.ownedFrames = [];

    if (!userData.ownedFrames.includes(frameId)) return;

    userData.equippedFrame = frameId;
    store.set("userData", userData);
  }

  performUnequipFrame(frameId: string): void {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;

    if (userData.equippedFrame === frameId) {
      userData.equippedFrame = undefined;
      store.set("userData", userData);
    }
  }

  addBzCoins(amount: number): number {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;
    userData.bzCoins = (userData.bzCoins || 0) + amount;
    store.set("userData", userData);
    return userData.bzCoins;
  }

  addPlayTime(durationMs: number): number {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;

    const oldTime = userData.cumulativePlayTime || 0;
    const newTime = oldTime + durationMs;

    const oldIntervals = Math.floor(oldTime / PLAYTIME_REWARD_INTERVAL_MS);
    const newIntervals = Math.floor(newTime / PLAYTIME_REWARD_INTERVAL_MS);

    const rewardCount = newIntervals - oldIntervals;
    if (rewardCount > 0) {
      const reward = rewardCount * PLAYTIME_REWARD_AMOUNT;
      userData.bzCoins = (userData.bzCoins || 0) + reward;
      logger.info(`[StoreService] Awarded ${reward} coins for playtime.`);
    }

    userData.cumulativePlayTime = newTime;

    this.tryUnlockPlaytimeFrames(userData);

    store.set("userData", userData);
    return rewardCount * PLAYTIME_REWARD_AMOUNT;
  }

  private tryUnlockPlaytimeFrames(userData: UserData): void {
    if (!userData.ownedFrames) userData.ownedFrames = [];
    for (const f of AVATAR_FRAMES) {
      if (userData.ownedFrames.includes(f.id)) continue;
      if (f.unlockMethod === 'playtime' && (userData.cumulativePlayTime || 0) >= f.unlockValue) {
        userData.ownedFrames.push(f.id);
        logger.info(`[StoreService] Auto-unlocked frame: ${f.id} (playtime ${userData.cumulativePlayTime}ms)`);
      }
    }
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  private shiftDate(dateStr: string, deltaDays: number): string {
    const base = new Date(`${dateStr}T00:00:00`);
    const shifted = new Date(base.getTime() + deltaDays * 86400000);
    return this.formatDate(shifted);
  }

  async performCheckIn(): Promise<{
    success: boolean;
    coins: number;
    days: number;
    code?: string;
  }> {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;

    const todayStr = this.formatDate(new Date());

    if (userData.checkIn.lastCheckInDate === todayStr) {
      return {
        success: false,
        coins: 0,
        days: userData.checkIn.consecutiveDays,
      };
    }

    const yesterdayStr = this.shiftDate(todayStr, -1);

    if (userData.checkIn.lastCheckInDate === yesterdayStr) {
      userData.checkIn.consecutiveDays += 1;
    } else {
      userData.checkIn.consecutiveDays = 1;
    }

    const cycleDay = ((userData.checkIn.consecutiveDays - 1) % 7) + 1;
    let reward = cycleDay * 10;
    if (cycleDay === 7) {
      reward = 100;
    }

    userData.checkIn.lastCheckInDate = todayStr;
    userData.checkIn.totalDays = (userData.checkIn.totalDays || 0) + 1;
    userData.bzCoins = (userData.bzCoins || 0) + reward;

    this.tryUnlockCheckInFrames(userData);

    store.set("userData", userData);
    return {
      success: true,
      coins: reward,
      days: userData.checkIn.consecutiveDays,
    };
  }

  private tryUnlockCheckInFrames(userData: UserData): void {
    if (!userData.ownedFrames) userData.ownedFrames = [];
    for (const f of AVATAR_FRAMES) {
      if (userData.ownedFrames.includes(f.id)) continue;
      if (f.unlockMethod === 'consecutive_checkin' && (userData.checkIn?.consecutiveDays || 0) >= f.unlockValue) {
        userData.ownedFrames.push(f.id);
        logger.info(`[StoreService] Auto-unlocked frame: ${f.id} (consecutive ${userData.checkIn?.consecutiveDays}d)`);
      }
      if (f.unlockMethod === 'total_checkin' && (userData.checkIn?.totalDays || 0) >= f.unlockValue) {
        userData.ownedFrames.push(f.id);
        logger.info(`[StoreService] Auto-unlocked frame: ${f.id} (total ${userData.checkIn?.totalDays}d)`);
      }
    }
  }

  addGame(game: GameRecord): void {
    const store = this.getStore();
    const games = store.get("games", []) || [];
    const index = games.findIndex((g) => g.id === game.id);

    if (index !== -1) {
      games[index] = game;
    } else {
      games.push(game);
    }

    store.set("games", games);
  }

  saveGames(games: GameRecord[]): void {
    this.getStore().set("games", games);
  }

  unlockAchievement(
    gameId: string,
    version: string,
    achievementId: string,
  ): boolean {
    const store = this.getStore();
    const games = this.getGamesList();
    const entry = this.findGameById(games, gameId);
    if (!entry) return false;

    const game = entry.game;
    const gameVersion = game.versions.find((v) => v.version === version);

    if (!gameVersion) return false;

    if (!gameVersion.unlockedAchievements) {
      gameVersion.unlockedAchievements = [];
    }

    // Check if already unlocked
    if (gameVersion.unlockedAchievements.some((a) => a.id === achievementId)) {
      return false; // Already unlocked
    }

    gameVersion.unlockedAchievements.push({
      id: achievementId,
      unlockedAt: Date.now(),
    });

    games[entry.index] = game;
    store.set("games", games);
    return true; // Newly unlocked
  }

  toggleFavorite(id: string): boolean {
    const store = this.getStore();
    const games = this.getGamesList();
    const entry = this.findGameById(games, id);
    if (!entry) return false;

    entry.game.isFavorite = !entry.game.isFavorite;
    games[entry.index] = entry.game;
    store.set("games", games);
    return entry.game.isFavorite || false;
  }

  private partitionVersions(
    versions: GameVersion[],
    versionsToDelete: Set<string>,
  ): { remaining: GameVersion[]; removing: GameVersion[] } {
    const remaining: GameVersion[] = [];
    const removing: GameVersion[] = [];

    for (const v of versions) {
      if (versionsToDelete.has(v.version)) {
        removing.push(v);
      } else {
        remaining.push(v);
      }
    }

    return { remaining, removing };
  }

  private async removeVersionDirectories(
    id: string,
    versions: GameVersion[],
  ): Promise<void> {
    for (const v of versions) {
      try {
        await this.removePath(v.path, { recursive: true, force: true });
        logger.info(`[StoreService] Removed game version directory: ${v.path}`);
      } catch (e) {
        logger.error(
          `[StoreService] Failed to remove game version directory for ${id} ${v.version}`,
          e,
        );
      }
    }
  }

  private async removeManifestGameVersionDirsInStorageRoot(storageRoot: string): Promise<void> {
    let gameDirs: fsSync.Dirent[];
    try {
      gameDirs = fsSync.readdirSync(storageRoot, { withFileTypes: true });
    } catch {
      return;
    }

    for (const gameDir of gameDirs) {
      if (!gameDir.isDirectory()) continue;
      const gameRoot = path.join(storageRoot, gameDir.name);
      let versionDirs: fsSync.Dirent[];
      try {
        versionDirs = fsSync.readdirSync(gameRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const versionDir of versionDirs) {
        if (!versionDir.isDirectory()) continue;
        const versionPath = path.join(gameRoot, versionDir.name);
        if (!fsSync.existsSync(path.join(versionPath, "game.json"))) continue;
        await this.removePath(versionPath, { recursive: true, force: true });
        logger.info(`[StoreService] Removed game version directory by manifest: ${versionPath}`);
      }

      await this.removeDirectoryIfEmpty(gameRoot);
    }
  }

  private async removeDirectoryIfEmpty(dirPath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(dirPath);
      if (entries.length > 0) return false;
      await fs.rmdir(dirPath);
      logger.info(`[StoreService] Removed empty directory: ${dirPath}`);
      return true;
    } catch (e) {
      logger.warn(`[StoreService] Failed to remove empty directory: ${dirPath}`, e);
      return false;
    }
  }

  private async removeGameRootByVersionPath(versionPath: string | undefined): Promise<void> {
    if (!versionPath) return;
    const parentDir = path.dirname(versionPath);

    try {
      await this.removePath(parentDir, { recursive: true, force: true });
      logger.info(`[StoreService] Removed game root directory: ${parentDir}`);
    } catch (e) {
      logger.error(`[StoreService] Failed to remove game root directory`, e);
    }
  }

  private async removePath(targetPath: string, options: Parameters<typeof fs.rm>[1]): Promise<void> {
    const prevNoAsar = process.noAsar;
    process.noAsar = true;
    try {
      await fs.rm(targetPath, options);
    } finally {
      process.noAsar = prevNoAsar;
    }
  }

  private async copyPath(sourcePath: string, targetPath: string, options: Parameters<typeof fs.cp>[2]): Promise<void> {
    const prevNoAsar = process.noAsar;
    process.noAsar = true;
    try {
      await fs.cp(sourcePath, targetPath, options);
    } finally {
      process.noAsar = prevNoAsar;
    }
  }

  private ensureLatestVersion(game: GameRecord): void {
    if (game.versions.length === 0) return;
    game.latestVersion = game.versions
      .slice()
      .sort((a, b) =>
        b.version.localeCompare(a.version, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      )[0].version;
  }

  async removeGame(id: string, versions?: string[]): Promise<void> {
    const store = this.getStore();
    const games = this.getGamesList();
    const entry = this.findGameById(games, id);
    if (!entry) return;

    const game = entry.game;

    const requestedVersions =
      versions === undefined ? game.versions.map((v) => v.version) : versions;
    if (requestedVersions.length === 0) return;

    const { remaining, removing } = this.partitionVersions(
      game.versions,
      new Set(requestedVersions),
    );
    await this.removeVersionDirectories(id, removing);

    if (remaining.length === 0) {
      await this.removeGameRootByVersionPath(game.versions[0]?.path);
      const newGames = games.filter((g) => g.id !== id);
      store.set("games", newGames);
      return;
    }

    game.versions = remaining;
    this.ensureLatestVersion(game);
    games[entry.index] = game;
    store.set("games", games);
  }

  getSettings(): AppSettings {
    const store = this.getStore();
    const settings = store.get("settings", defaultSettings);

    const merged = {
      ...defaultSettings,
      ...settings,
      nicknameStyle: {
        ...DEFAULT_NICKNAME_STYLE,
        ...(settings.nicknameStyle || {}),
      },
    };
    const defaultGamesPath = path.join(getAppRoot(), "games");
    let shouldPersist = false;

    if (!merged.gameStorageHistory?.length) {
      merged.gameStoragePath = defaultGamesPath;
      merged.gameStorageHistory = [defaultGamesPath];
      shouldPersist = true;
    }

    const previousDefaultPath = merged.gameStoragePath || "";
    const previousHistory = JSON.stringify(merged.gameStorageHistory || []);
    merged.gameStorageHistory = this.toStorageHistory(
      merged.gameStorageHistory,
      merged.gameStoragePath || "",
    );
    if (!merged.gameStoragePath?.trim()) {
      merged.gameStoragePath = merged.gameStorageHistory[0] || defaultGamesPath;
    }
    if (
      previousDefaultPath !== merged.gameStoragePath ||
      previousHistory !== JSON.stringify(merged.gameStorageHistory)
    ) {
      shouldPersist = true;
    }

    if (!merged.playerId) {
      merged.playerId = crypto.randomUUID();
      logger.info(`[StoreService] Generated new playerId: ${merged.playerId}`);

      const initialLangFile = path.join(getAppRoot(), ".initial-language");
      try {
        const langContent = fsSync.readFileSync(initialLangFile, "utf-8");
        const lang = langContent.trim();
        if (["zh-CN", "en-US", "ja-JP"].includes(lang)) {
          merged.language = lang as AppSettings["language"];
          logger.info(`[StoreService] Detected installer language: ${lang}`);
        }
        fsSync.unlinkSync(initialLangFile);
      } catch {
        // File not found or not readable, keep default language
      }

      shouldPersist = true;
    }

    if (shouldPersist) {
      store.set("settings", merged);
    }

    return merged;
  }

  isFirstOpen(): boolean {
    return !this.getSettings().lastOpenedAt;
  }

  recordAppClosed(): void {
    const store = this.getStore();
    const current = this.getSettings();
    store.set("settings", {
      ...current,
      lastOpenedAt: Date.now(),
    });
  }

  getGameStoragePath(): string {
    return this.getDefaultGameStoragePath();
  }

  getDefaultGameStoragePath(): string {
    const settings = this.getSettings();
    const roots = this.getConfiguredGameStoragePaths(settings);
    const preferred = settings.gameStoragePath?.trim();
    if (preferred && roots.some((root) => path.resolve(root) === path.resolve(preferred))) {
      return preferred;
    }
    const first = roots[0];
    if (!first) {
      throw new Error("game_storage_path_not_configured");
    }
    return first;
  }

  private getConfiguredGameStoragePaths(settings = this.getSettings()): string[] {
    const roots = new Set<string>();
    for (const p of settings.gameStorageHistory || []) {
      if (typeof p === "string" && p.trim()) {
        roots.add(p.trim());
      }
    }
    return Array.from(roots);
  }

  getGameStorageRoots(): string[] {
    const roots = new Set<string>(this.getConfiguredGameStoragePaths());
    for (const game of this.getGamesList()) {
      for (const version of game.versions) {
        if (typeof version.path !== "string" || !version.path.trim()) continue;
        roots.add(path.dirname(path.dirname(version.path)));
      }
    }
    return Array.from(roots);
  }

  getGameStoragePathItems(): { path: string; isDefault: boolean }[] {
    const defaultPath = this.getDefaultGameStoragePath();
    return this.getConfiguredGameStoragePaths().map((storagePath) => ({
      path: storagePath,
      isDefault: path.resolve(storagePath) === path.resolve(defaultPath),
    }));
  }

  addGameStoragePath(storagePath: string): AppSettings {
    const normalizedPath = this.normalizeStoragePath(storagePath);
    this.ensureStorageDirectoryEmpty(normalizedPath);
    const store = this.getStore();
    const current = this.getSettings();
    const nextHistory = this.toStorageHistory(current.gameStorageHistory, normalizedPath);
    const nextDefault = current.gameStoragePath?.trim() || normalizedPath;
    const nextSettings = {
      ...current,
      gameStoragePath: nextDefault,
      gameStorageHistory: nextHistory,
    };
    store.set("settings", nextSettings);
    return nextSettings;
  }

  setDefaultGameStoragePath(storagePath: string): AppSettings {
    const normalizedPath = this.normalizeStoragePath(storagePath);
    const store = this.getStore();
    const current = this.getSettings();
    if (!this.getConfiguredGameStoragePaths(current).some((item) => path.resolve(item) === normalizedPath)) {
      throw new Error("storage_path_not_registered");
    }
    const nextHistory = this.toStorageHistory(current.gameStorageHistory, normalizedPath);
    const nextSettings = {
      ...current,
      gameStoragePath: normalizedPath,
      gameStorageHistory: nextHistory,
    };
    store.set("settings", nextSettings);
    return nextSettings;
  }

  getGameVersionStoragePath(gameId: string, version: string): string {
    const targetVersion = version || "latest";
    const record = this.getGamesList().find((game) => game.id === gameId);
    const versionRecord = record?.versions.find((item) => item.version === targetVersion);
    if (versionRecord?.path?.trim()) {
      return versionRecord.path;
    }
    return path.join(this.getDefaultGameStoragePath(), gameId, targetVersion);
  }

  private normalizeStoragePath(input: string): string {
    const normalized = path.resolve(input.trim());
    if (!normalized || normalized === path.parse(normalized).root) {
      throw new Error("invalid_storage_path");
    }
    return normalized;
  }

  private ensureStorageDirectoryEmpty(storagePath: string): void {
    if (!fsSync.existsSync(storagePath)) {
      fsSync.mkdirSync(storagePath, { recursive: true });
      return;
    }
    if (!fsSync.statSync(storagePath).isDirectory()) {
      throw new Error("storage_path_not_directory");
    }
    const entries = fsSync.readdirSync(storagePath);
    if (entries.length > 0) {
      throw new Error("directory_not_empty");
    }
  }

  private assertMigrationTargetAllowed(sourceRoot: string, targetRoot: string): void {
    if (sourceRoot === targetRoot) {
      throw new Error("target_is_source_path");
    }

    const targetRelativeToSource = path.relative(sourceRoot, targetRoot);
    if (
      targetRelativeToSource &&
      !targetRelativeToSource.startsWith("..") &&
      !path.isAbsolute(targetRelativeToSource)
    ) {
      throw new Error("target_inside_source_path");
    }

    const sourceRelativeToTarget = path.relative(targetRoot, sourceRoot);
    if (
      sourceRelativeToTarget &&
      !sourceRelativeToTarget.startsWith("..") &&
      !path.isAbsolute(sourceRelativeToTarget)
    ) {
      throw new Error("source_inside_target_path");
    }
  }

  private async migrateStorageDirectory(sourceRoot: string, targetRoot: string): Promise<void> {
    if (!fsSync.existsSync(sourceRoot)) {
      throw new Error("source_storage_path_not_found");
    }
    if (!fsSync.statSync(sourceRoot).isDirectory()) {
      throw new Error("source_storage_path_not_directory");
    }

    try {
      await this.copyPath(sourceRoot, targetRoot, { recursive: true, force: true });
      await this.removePath(sourceRoot, { recursive: true, force: true });
    } catch (error) {
      try {
        await this.clearDirectoryContents(targetRoot);
      } catch (cleanupError) {
        logger.warn(
          `[StoreService] Failed to clean partial migrated storage: ${targetRoot}`,
          cleanupError,
        );
      }
      if (this.isFileBusyError(error)) {
        throw new Error("storage_migration_file_busy");
      }
      throw error;
    }
  }

  private async clearDirectoryContents(dirPath: string): Promise<void> {
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      await this.removePath(path.join(dirPath, entry.name), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    }
  }

  private isFileBusyError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "EBUSY" || code === "EPERM";
  }

  private toStorageHistory(
    currentHistory: string[] | undefined,
    nextPath: string,
  ): string[] {
    const history = new Set<string>();
    if (nextPath.trim()) {
      history.add(nextPath.trim());
    }
    for (const p of currentHistory || []) {
      if (typeof p === "string" && p.trim()) {
        history.add(p.trim());
      }
      if (history.size >= 20) break;
    }
    return Array.from(history).slice(0, 20);
  }

  saveSettings(settings: Partial<AppSettings>): void {
    const store = this.getStore();
    const current = this.getSettings();
    const incomingHistory = settings.gameStorageHistory || current.gameStorageHistory || [];
    const incomingDefault = settings.gameStoragePath?.trim() || current.gameStoragePath || "";
    const nextHistory = this.toStorageHistory(incomingHistory, incomingDefault);
    const finalStoragePath = incomingDefault && nextHistory.some((item) => path.resolve(item) === path.resolve(incomingDefault))
      ? incomingDefault
      : nextHistory[0] || "";

    logger.info(`[StoreService] Updating settings`);
    store.set("settings", {
      ...current,
      ...settings,
      gameStoragePath: finalStoragePath,
      gameStorageHistory: nextHistory,
    });
  }

  getDefaultGamesMigrationStatus(): {
    shouldPrompt: boolean;
    defaultGamesPath: string;
  } {
    const settings = this.getSettings();
    const defaultGamesPath = path.join(getAppRoot(), "games");
    const defaultGamesRoot = path.resolve(defaultGamesPath);
    const hasDefaultGamesStoragePath = this.getConfiguredGameStoragePaths(settings).some(
      (storagePath) => path.resolve(storagePath) === defaultGamesRoot,
    );

    return {
      shouldPrompt:
        !this.isFirstOpen() &&
        !settings.ignoreDefaultGamesMigrationPrompt &&
        hasDefaultGamesStoragePath,
      defaultGamesPath,
    };
  }

  ignoreDefaultGamesMigrationPrompt(): void {
    const store = this.getStore();
    const current = this.getSettings();
    store.set("settings", {
      ...current,
      ignoreDefaultGamesMigrationPrompt: true,
    });
  }

  async migrateDefaultGamesLibrary(targetRoot: string): Promise<{
    migratedGames: number;
    migratedVersions: number;
    gameStoragePath: string;
  }> {
    const normalizedTarget = this.normalizeStoragePath(targetRoot);
    const defaultRoot = path.resolve(path.join(getAppRoot(), "games"));

    if (normalizedTarget === defaultRoot) {
      throw new Error("target_is_default_games_path");
    }
    return this.migrateGameStorageLibraryCore(defaultRoot, normalizedTarget, {
      forceDefault: true,
      ignoreDefaultGamesMigrationPrompt: true,
    });
  }

  async migrateGameStorageLibrary(sourceRoot: string, targetRoot: string): Promise<{
    migratedGames: number;
    migratedVersions: number;
    gameStoragePath: string;
  }> {
    const normalizedSource = this.normalizeStoragePath(sourceRoot);
    const normalizedTarget = this.normalizeStoragePath(targetRoot);
    const configuredPaths = this.getConfiguredGameStoragePaths();
    const isRegisteredPath = configuredPaths.some(
      (item) => path.resolve(item) === normalizedSource,
    );
    if (!isRegisteredPath) {
      throw new Error("storage_path_not_registered");
    }
    return this.migrateGameStorageLibraryCore(normalizedSource, normalizedTarget);
  }

  private async migrateGameStorageLibraryCore(
    normalizedSource: string,
    normalizedTarget: string,
    options: {
      forceDefault?: boolean;
      ignoreDefaultGamesMigrationPrompt?: boolean;
    } = {},
  ): Promise<{
    migratedGames: number;
    migratedVersions: number;
    gameStoragePath: string;
  }> {
    this.assertMigrationTargetAllowed(normalizedSource, normalizedTarget);
    this.ensureStorageDirectoryEmpty(normalizedTarget);

    await fs.mkdir(normalizedTarget, { recursive: true });

    const store = this.getStore();
    const games = this.getGamesList();
    let migratedGames = 0;
    let migratedVersions = 0;

    for (const game of games) {
      const versionCount = game.versions.filter((version) => {
        if (!version.path?.trim()) return false;
        return path.resolve(path.dirname(path.dirname(version.path))) === normalizedSource;
      }).length;
      if (versionCount > 0) {
        migratedGames += 1;
        migratedVersions += versionCount;
      }
    }

    await this.migrateStorageDirectory(normalizedSource, normalizedTarget);

    for (const game of games) {
      for (const version of game.versions) {
        if (!version.path?.trim()) continue;
        const versionRoot = path.resolve(path.dirname(path.dirname(version.path)));
        if (versionRoot !== normalizedSource) continue;
        version.path = path.join(normalizedTarget, game.id, version.version);
      }
    }

    const currentSettings = this.getSettings();
    const currentPath = currentSettings.gameStoragePath?.trim() || "";
    const nextStoragePath = options.forceDefault || (currentPath && path.resolve(currentPath) === normalizedSource)
      ? normalizedTarget
      : currentPath;
    const filteredHistory = (currentSettings.gameStorageHistory || [])
      .map((item) => item.trim())
      .filter((item) => item && path.resolve(item) !== normalizedSource);
    const nextHistory = this.toStorageHistory(filteredHistory, normalizedTarget);

    store.set("games", games);
    store.set("settings", {
      ...currentSettings,
      gameStoragePath: nextStoragePath,
      gameStorageHistory: nextHistory,
      ignoreDefaultGamesMigrationPrompt: options.ignoreDefaultGamesMigrationPrompt
        ? true
        : currentSettings.ignoreDefaultGamesMigrationPrompt,
    });

    return {
      migratedGames,
      migratedVersions,
      gameStoragePath: nextStoragePath,
    };
  }

  performIgnoreUpdateVersion(version: string): void {
    const store = this.getStore();
    const current = this.getSettings();
    store.set("settings", {
      ...current,
      ignoredUpdateVersion: version,
    });
  }

  async removeGameStoragePath(storagePath: string): Promise<{
    removedGames: number;
    removedVersions: number;
    nextStoragePath: string;
  }> {
    const normalizedTarget = this.normalizeStoragePath(storagePath);
    const store = this.getStore();
    const currentSettings = this.getSettings();
    const configuredPaths = this.getConfiguredGameStoragePaths(currentSettings);
    const isRegisteredPath = configuredPaths.some(
      (item) => path.resolve(item) === normalizedTarget,
    );
    if (!isRegisteredPath) {
      throw new Error("storage_path_not_registered");
    }
    if (configuredPaths.length <= 1) {
      throw new Error("cannot_remove_last_storage_path");
    }

    const games = this.getGamesList();
    const nextGames: GameRecord[] = [];
    let removedGames = 0;
    let removedVersions = 0;

    for (const game of games) {
      const versionsInPath = game.versions.filter((version) => {
        if (!version.path?.trim()) return false;
        const versionRoot = path.dirname(path.dirname(version.path));
        return path.resolve(versionRoot) === normalizedTarget;
      });
      if (versionsInPath.length === 0) {
        nextGames.push(game);
        continue;
      }

      removedVersions += versionsInPath.length;
      await this.removeVersionDirectories(game.id, versionsInPath);
      const remaining = game.versions.filter(
        (version) => !versionsInPath.some((v) => v.version === version.version),
      );

      if (remaining.length === 0) {
        removedGames += 1;
        continue;
      }

      game.versions = remaining;
      this.ensureLatestVersion(game);
      nextGames.push(game);
    }

    await this.removeManifestGameVersionDirsInStorageRoot(normalizedTarget);
    await this.removeDirectoryIfEmpty(normalizedTarget);

    const filteredHistory = (currentSettings.gameStorageHistory || [])
      .map((item) => item.trim())
      .filter((item) => item && path.resolve(item) !== normalizedTarget);

    const currentPath = currentSettings.gameStoragePath?.trim() || "";
    const nextStoragePath =
      currentPath && path.resolve(currentPath) === normalizedTarget
        ? filteredHistory[0] || ""
        : currentPath;
    const nextHistory = this.toStorageHistory(filteredHistory, nextStoragePath);

    store.set("games", nextGames);
    store.set("settings", {
      ...currentSettings,
      gameStoragePath: nextStoragePath,
      gameStorageHistory: nextHistory,
    });

    return {
      removedGames,
      removedVersions,
      nextStoragePath,
    };
  }

  async healthCheck(): Promise<DataHealthReport> {
    const issues: DataHealthIssue[] = [];
    const configPath = path.join(getAppRoot(), "config.json");
    const games = this.getGamesList();
    const settings = this.getSettings();
    const storageRoots = this.getGameStorageRoots();

    if (!(await pathExists(configPath))) {
      issues.push({
        level: "error",
        code: "config_missing",
        message: "config.json 不存在",
        target: configPath,
      });
    } else {
      try {
        const rawText = await fs.readFile(configPath, "utf-8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          issues.push({
            level: "error",
            code: "config_invalid_json",
            message: "config.json 不是有效的 JSON",
            target: configPath,
          });
          parsed = null;
        }

        if (parsed && typeof parsed === "object") {
          const encryptedStore = parsed as { __encrypted?: boolean };
          if (encryptedStore.__encrypted === true) {
            const decrypted = tryDecryptConfigPayload(parsed);
            if (!decrypted) {
              issues.push({
                level: "error",
                code: "config_decrypt_failed",
                message: "config.json 解密失败",
                target: configPath,
              });
            }
          } else {
            const migrated = deserializeConfig(rawText);
            if (!migrated || typeof migrated !== "object") {
              issues.push({
                level: "error",
                code: "config_invalid_structure",
                message: "config.json 结构无效",
                target: configPath,
              });
            } else {
              issues.push({
                level: "warning",
                code: "config_plaintext_legacy",
                message: "config.json 仍为旧版明文格式，建议重新保存设置完成迁移",
                target: configPath,
              });
            }
          }
        }
      } catch (error) {
        issues.push({
          level: "error",
          code: "config_read_failed",
          message: `读取 config.json 失败: ${(error as Error).message}`,
          target: configPath,
        });
      }
    }

    if (!settings.playerId?.trim()) {
      issues.push({
        level: "error",
        code: "player_id_missing",
        message: "玩家 ID 缺失",
      });
    }

    const gameIds = new Set<string>();
    for (const game of games) {
      if (gameIds.has(game.id)) {
        issues.push({
          level: "error",
          code: "duplicate_game_id",
          message: `存在重复的游戏 ID: ${game.id}`,
          target: game.id,
        });
      }
      gameIds.add(game.id);

      const seenVersions = new Set<string>();
      for (const version of game.versions) {
        if (seenVersions.has(version.version)) {
          issues.push({
            level: "warning",
            code: "duplicate_game_version",
            message: `游戏 ${game.id} 存在重复版本记录: ${version.version}`,
            target: `${game.id}@${version.version}`,
          });
        }
        seenVersions.add(version.version);

        const manifestPath = path.join(version.path, "game.json");
        if (!(await pathExists(version.path))) {
          issues.push({
            level: "error",
            code: "version_path_missing",
            message: `游戏版本目录不存在: ${game.id}@${version.version}`,
            target: version.path,
          });
          continue;
        }
        if (!(await pathExists(manifestPath))) {
          issues.push({
            level: "error",
            code: "manifest_missing",
            message: `版本目录缺少 game.json: ${game.id}@${version.version}`,
            target: manifestPath,
          });
        }
      }

      if (!game.versions.some((v) => v.version === game.latestVersion)) {
        issues.push({
          level: "error",
          code: "latest_version_invalid",
          message: `游戏 ${game.id} 的 latestVersion 指向不存在的版本`,
          target: `${game.id}@${game.latestVersion}`,
        });
      }
    }

    for (const storageRoot of storageRoots) {
      if (!(await pathExists(storageRoot))) {
        issues.push({
          level: "warning",
          code: "storage_root_missing",
          message: "游戏存储路径不存在",
          target: storageRoot,
        });
      }
    }

    const report: DataHealthReport = {
      ok: !issues.some((issue) => issue.level === "error"),
      checkedAt: Date.now(),
      summary: {
        errors: issues.filter((issue) => issue.level === "error").length,
        warnings: issues.filter((issue) => issue.level === "warning").length,
        gameCount: games.length,
        versionCount: games.reduce((sum, game) => sum + game.versions.length, 0),
        storagePathCount: storageRoots.length,
      },
      issues,
    };

    return report;
  }

  updateGameStats(
    id: string,
    version: string,
    stats: Record<string, number>,
    modes: Record<string, "increment" | "full"> = {},
  ): void {
    const store = this.getStore();
    const games = this.getGamesList();
    const entry = this.findGameById(games, id);
    if (!entry) return;

    const game = entry.game;
    game.lastPlayedAt = Date.now();

    const gameVersion = game.versions.find((v) => v.version === version);
    if (gameVersion) {
      if (!gameVersion.stats) gameVersion.stats = {};

      for (const [key, value] of Object.entries(stats)) {
        const mode = modes[key] || "increment";
        if (mode === "full") {
          gameVersion.stats[key] = value;
        } else {
          gameVersion.stats[key] = (gameVersion.stats[key] || 0) + value;
        }
      }
    }

    games[entry.index] = game;
    store.set("games", games);
  }

  updatePlaytime(id: string, version: string, durationMs: number): void {
    this.addPlayTime(durationMs);

    const store = this.getStore();
    const games = this.getGamesList();
    const entry = this.findGameById(games, id);
    if (!entry) return;

    const game = entry.game;
    game.lastPlayedAt = Date.now();

    const gameVersion = game.versions.find((v) => v.version === version);
    if (gameVersion) {
      gameVersion.playtime = (gameVersion.playtime || 0) + durationMs;
    }

    games[entry.index] = game;
    store.set("games", games);
  }
}

export const storeService = new StoreService();
