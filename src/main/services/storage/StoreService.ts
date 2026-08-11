import crypto from "crypto";
import { app } from "electron";
import ElectronStore from "electron-store";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import semver from "semver";
import type {
  AppStore,
  AppSettings,
  DataHealthIssue,
  DataHealthReport,
  GameRecord,
  GameVersion,
  FeedbackHistoryItem,
  UserData,
  NicknameStyle,
} from "../../../shared/types";
import {
  DEFAULT_NICKNAME_STYLE,
  normalizeNicknameEffect,
} from "../../../shared/types";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { AVATAR_FRAMES } from "../../../shared/avatar-frames";
import {
  CONFIG_ENCRYPTION_SEED,
  PLAYTIME_REWARD_AMOUNT,
  PLAYTIME_REWARD_INTERVAL_MS,
} from "../../../shared/AppConstants";
import { compareGameVersionsDescending } from "../../../shared/game-manifest";
import {
  GameManifestFileError,
  readGameManifestFileWithMetadata,
} from "../game/GameManifestFileService";
import { bzGamesDatabase } from "./database/BzGamesDatabase";

const defaultSettings: AppSettings = {
  playerName: "玩家",
  playerId: "",
  cloudSessionToken: "",
  cloudSessionExpiresAt: "",
  cloudUserLogin: "",
  cloudUserName: "",
  cloudUserProfileUrl: "",
  cloudLastUploadedAt: "",
  feedbackHistory: [],
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
  checkIn: {
    lastCheckInDate: "",
    consecutiveDays: 0,
    totalDays: 0,
  },
  ownedFrames: [],
  equippedFrame: undefined,
};

const defaultStore: AppStore = {
  settings: defaultSettings,
  userData: defaultUserData,
};

const CLOUD_SETTINGS_SYNC_BLACKLIST: Array<keyof AppSettings> = [
  "githubToken",
  "cloudSessionToken",
  "cloudSessionExpiresAt",
  "cloudUserLogin",
  "cloudUserName",
  "cloudUserProfileUrl",
];

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

function decryptConfigPayload(raw: unknown): AppStore {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("__encrypted" in raw) ||
    raw.__encrypted !== true
  ) {
    throw new Error("config_encrypted_format_required");
  }

  try {
    const envelope = raw as Record<string, unknown>;
    if (
      typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.payload !== "string"
    ) {
      throw new Error("config_encrypted_format_invalid");
    }
    const key = createConfigCipherKey();
    const iv = Buffer.from(envelope.iv, "base64");
    const tag = Buffer.from(envelope.tag, "base64");
    const payload = Buffer.from(envelope.payload, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("config_invalid_structure");
    }
    return parsed as AppStore;
  } catch (error) {
    if ((error as Error).message === "config_invalid_structure") throw error;
    throw new Error("config_decrypt_failed", { cause: error });
  }
}

function deserializeConfig(content: string): AppStore {
  return decryptConfigPayload(JSON.parse(content));
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
  private gamesCache: GameRecord[] = [];

  private async restoreDataFromSnapshotIfNeeded(
    dataRoot: string,
  ): Promise<void> {
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
    const snapshotRoot = path.join(
      app.getPath("userData"),
      ".update-snapshots",
    );

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

        await bzGamesDatabase.initialize();
        const Store = (await import("electron-store")).default;
        this.store = new Store<AppStore>({
          name: "config",
          defaults: defaultStore,
          cwd: dataRoot,
          serialize: (data) => encryptConfigPayload(data),
          deserialize: (content) => deserializeConfig(content),
        });
        logger.info(`[StoreService] Store initialized at: ${this.store.path}`);

        this.gamesCache = await bzGamesDatabase.getGames();
      } catch (error) {
        logger.error("[StoreService] Failed to initialize store:", error);
        throw error;
      }
    })();

    return this._initPromise;
  }

  createCloudConfigContent(): string {
    const store = this.getStore();
    const data = store.store as AppStore;
    const settings = { ...(data.settings || {}) } as Partial<AppSettings>;
    for (const key of CLOUD_SETTINGS_SYNC_BLACKLIST) {
      delete settings[key];
    }
    return encryptConfigPayload({ ...data, settings } as AppStore);
  }

  parseCloudConfigContent(content: string): Partial<AppStore> {
    return deserializeConfig(content) as Partial<AppStore>;
  }

  applyCloudConfig(cloudData: Partial<AppStore>): void {
    const store = this.getStore();
    const currentSettings = this.getSettings();
    const cloudSettings = { ...(cloudData.settings || {}) };
    for (const key of CLOUD_SETTINGS_SYNC_BLACKLIST) {
      delete cloudSettings[key];
    }

    const currentUserData = this.getUserData();
    const nextUserData = cloudData.userData
      ? {
          ...currentUserData,
          ...cloudData.userData,
          checkIn: {
            ...currentUserData.checkIn,
            ...(cloudData.userData.checkIn || {}),
          },
        }
      : currentUserData;
    store.store = {
      ...store.store,
      userData: nextUserData,
      settings: {
        ...currentSettings,
        ...cloudSettings,
      },
    };
  }

  private getStore(): ElectronStore<AppStore> {
    if (!this.store) {
      throw new Error("StoreService not initialized! Call init() first.");
    }
    return this.store;
  }

  private getGamesList(): GameRecord[] {
    return this.gamesCache;
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

  async refreshGameDerivedData(): Promise<void> {
    this.gamesCache = await bzGamesDatabase.getGames();
  }

  private async persistGamesAndRefresh(games: GameRecord[]): Promise<void> {
    await bzGamesDatabase.saveGames(games);
    await this.refreshGameDerivedData();
  }

  getUserData(): UserData {
    return this.getStore().get("userData") || defaultUserData;
  }

  performBuyFrame(frameId: string): {
    success: boolean;
    code?: string;
  } {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;
    const frame = AVATAR_FRAMES.find((candidate) => candidate.id === frameId);

    if (!frame || frame.unlockMethod !== "bzcoin") {
      return { success: false, code: "invalid_frame" };
    }
    const coinCost = frame.unlockValue;

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

  performSaveNicknameStyle(
    style: NicknameStyle,
    coinCost: number,
  ): {
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

  private applyPlaytimeRewards(oldTime: number, newTime: number): number {
    const store = this.getStore();
    const userData = store.get("userData") || defaultUserData;

    const oldIntervals = Math.floor(oldTime / PLAYTIME_REWARD_INTERVAL_MS);
    const newIntervals = Math.floor(newTime / PLAYTIME_REWARD_INTERVAL_MS);

    const rewardCount = newIntervals - oldIntervals;
    if (rewardCount > 0) {
      const reward = rewardCount * PLAYTIME_REWARD_AMOUNT;
      userData.bzCoins = (userData.bzCoins || 0) + reward;
      logger.info(`[StoreService] Awarded ${reward} coins for playtime.`);
    }

    this.tryUnlockPlaytimeFrames(userData, newTime);

    store.set("userData", userData);
    return rewardCount * PLAYTIME_REWARD_AMOUNT;
  }

  private tryUnlockPlaytimeFrames(
    userData: UserData,
    cumulativePlayTime: number,
  ): void {
    if (!userData.ownedFrames) userData.ownedFrames = [];
    for (const f of AVATAR_FRAMES) {
      if (userData.ownedFrames.includes(f.id)) continue;
      if (
        f.unlockMethod === "playtime" &&
        cumulativePlayTime >= f.unlockValue
      ) {
        userData.ownedFrames.push(f.id);
        logger.info(
          `[StoreService] Auto-unlocked frame: ${f.id} (playtime ${cumulativePlayTime}ms)`,
        );
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
      if (
        f.unlockMethod === "consecutive_checkin" &&
        (userData.checkIn?.consecutiveDays || 0) >= f.unlockValue
      ) {
        userData.ownedFrames.push(f.id);
        logger.info(
          `[StoreService] Auto-unlocked frame: ${f.id} (consecutive ${userData.checkIn?.consecutiveDays}d)`,
        );
      }
      if (
        f.unlockMethod === "total_checkin" &&
        (userData.checkIn?.totalDays || 0) >= f.unlockValue
      ) {
        userData.ownedFrames.push(f.id);
        logger.info(
          `[StoreService] Auto-unlocked frame: ${f.id} (total ${userData.checkIn?.totalDays}d)`,
        );
      }
    }
  }

  async addGame(game: GameRecord): Promise<void> {
    const games = [...this.getGamesList()];
    const index = games.findIndex((g) => g.id === game.id);

    if (index !== -1) {
      games[index] = game;
    } else {
      games.push(game);
    }

    await this.persistGamesAndRefresh(games);
  }

  async saveGames(games: GameRecord[]): Promise<void> {
    await this.persistGamesAndRefresh(games);
  }

  async unlockAchievement(
    gameId: string,
    version: string,
    achievementId: string,
    gameName = gameId,
    achievementName = achievementId,
  ): Promise<boolean> {
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

    const unlockedAt = Date.now();
    const inserted = await bzGamesDatabase.recordAchievement({
      gameId,
      gameName,
      version,
      achievementId,
      achievementName,
      unlockedAt,
    });
    if (!inserted) return false;
    gameVersion.unlockedAchievements.push({ id: achievementId, unlockedAt });

    games[entry.index] = game;
    this.gamesCache = games;
    return true; // Newly unlocked
  }

  async toggleFavorite(id: string): Promise<boolean> {
    const games = this.getGamesList();
    const entry = this.findGameById(games, id);
    if (!entry) return false;

    const favorite = !entry.game.isFavorite;
    await bzGamesDatabase.setFavorite(id, favorite);
    entry.game.isFavorite = favorite;
    games[entry.index] = entry.game;
    this.gamesCache = games;
    return favorite;
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

  private async removeManifestGameVersionDirsInStorageRoot(
    storageRoot: string,
  ): Promise<void> {
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
        logger.info(
          `[StoreService] Removed game version directory by manifest: ${versionPath}`,
        );
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
      logger.warn(
        `[StoreService] Failed to remove empty directory: ${dirPath}`,
        e,
      );
      return false;
    }
  }

  private async removeGameRootByVersionPath(
    versionPath: string | undefined,
  ): Promise<void> {
    if (!versionPath) return;
    const parentDir = path.dirname(versionPath);

    try {
      await this.removePath(parentDir, { recursive: true, force: true });
      logger.info(`[StoreService] Removed game root directory: ${parentDir}`);
    } catch (e) {
      logger.error(`[StoreService] Failed to remove game root directory`, e);
    }
  }

  private async removePath(
    targetPath: string,
    options: Parameters<typeof fs.rm>[1],
  ): Promise<void> {
    const prevNoAsar = process.noAsar;
    process.noAsar = true;
    try {
      await fs.rm(targetPath, options);
    } finally {
      process.noAsar = prevNoAsar;
    }
  }

  private async copyPath(
    sourcePath: string,
    targetPath: string,
    options: Parameters<typeof fs.cp>[2],
  ): Promise<void> {
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
        compareGameVersionsDescending(a.version, b.version),
      )[0].version;
  }

  async removeGame(id: string, versions?: string[]): Promise<void> {
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
      await bzGamesDatabase.softDelete(id);
      await this.refreshGameDerivedData();
      return;
    }

    game.versions = remaining;
    this.ensureLatestVersion(game);
    games[entry.index] = game;
    await bzGamesDatabase.softDelete(id, requestedVersions);
    await this.refreshGameDerivedData();
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

    const normalizedNicknameEffect = normalizeNicknameEffect(
      merged.nicknameStyle.effect,
    );
    if (normalizedNicknameEffect !== merged.nicknameStyle.effect) {
      merged.nicknameStyle.effect = normalizedNicknameEffect;
      shouldPersist = true;
    }

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
        if (
          ["zh-CN", "en-US", "ja-JP", "zh-TW", "lzh", "de-DE"].includes(lang)
        ) {
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
    if (
      preferred &&
      roots.some((root) => path.resolve(root) === path.resolve(preferred))
    ) {
      return preferred;
    }
    const first = roots[0];
    if (!first) {
      throw new Error("game_storage_path_not_configured");
    }
    return first;
  }

  private getConfiguredGameStoragePaths(
    settings = this.getSettings(),
  ): string[] {
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
    const nextHistory = this.toStorageHistory(
      current.gameStorageHistory,
      normalizedPath,
    );
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
    if (
      !this.getConfiguredGameStoragePaths(current).some(
        (item) => path.resolve(item) === normalizedPath,
      )
    ) {
      throw new Error("storage_path_not_registered");
    }
    const nextHistory = this.toStorageHistory(
      current.gameStorageHistory,
      normalizedPath,
    );
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
    const versionRecord = record?.versions.find(
      (item) => item.version === targetVersion,
    );
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

  private assertMigrationTargetAllowed(
    sourceRoot: string,
    targetRoot: string,
  ): void {
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

  private async migrateStorageDirectory(
    sourceRoot: string,
    targetRoot: string,
  ): Promise<void> {
    if (!fsSync.existsSync(sourceRoot)) {
      throw new Error("source_storage_path_not_found");
    }
    if (!fsSync.statSync(sourceRoot).isDirectory()) {
      throw new Error("source_storage_path_not_directory");
    }

    try {
      await this.copyPath(sourceRoot, targetRoot, {
        recursive: true,
        force: true,
      });
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
    const incomingHistory =
      settings.gameStorageHistory || current.gameStorageHistory || [];
    const incomingDefault =
      settings.gameStoragePath?.trim() || current.gameStoragePath || "";
    const nextHistory = this.toStorageHistory(incomingHistory, incomingDefault);
    const finalStoragePath =
      incomingDefault &&
      nextHistory.some(
        (item) => path.resolve(item) === path.resolve(incomingDefault),
      )
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

  getFeedbackHistory(): FeedbackHistoryItem[] {
    const history = this.getSettings().feedbackHistory;
    if (!Array.isArray(history)) return [];
    return history
      .filter((item): item is FeedbackHistoryItem =>
        Boolean(
          item &&
          typeof item.id === "string" &&
          item.id.trim() &&
          Number.isFinite(item.submittedAt) &&
          item.submittedAt > 0,
        ),
      )
      .map((item) => ({
        id: item.id.trim(),
        submittedAt: item.submittedAt,
      }));
  }

  addFeedbackHistory(id: string, submittedAt = Date.now()): void {
    const normalizedId = id.trim();
    if (!normalizedId || !Number.isFinite(submittedAt) || submittedAt <= 0) {
      return;
    }
    const history = this.getFeedbackHistory().filter(
      (item) => item.id !== normalizedId,
    );
    this.saveSettings({
      feedbackHistory: [{ id: normalizedId, submittedAt }, ...history],
    });
  }

  getDefaultGamesMigrationStatus(): {
    shouldPrompt: boolean;
    defaultGamesPath: string;
  } {
    const settings = this.getSettings();
    const defaultGamesPath = path.join(getAppRoot(), "games");
    const defaultGamesRoot = path.resolve(defaultGamesPath);
    const hasDefaultGamesStoragePath = this.getConfiguredGameStoragePaths(
      settings,
    ).some((storagePath) => path.resolve(storagePath) === defaultGamesRoot);

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

  async migrateGameStorageLibrary(
    sourceRoot: string,
    targetRoot: string,
  ): Promise<{
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
    return this.migrateGameStorageLibraryCore(
      normalizedSource,
      normalizedTarget,
    );
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
        return (
          path.resolve(path.dirname(path.dirname(version.path))) ===
          normalizedSource
        );
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
        const versionRoot = path.resolve(
          path.dirname(path.dirname(version.path)),
        );
        if (versionRoot !== normalizedSource) continue;
        version.path = path.join(normalizedTarget, game.id, version.version);
      }
    }

    const currentSettings = this.getSettings();
    const currentPath = currentSettings.gameStoragePath?.trim() || "";
    const nextStoragePath =
      options.forceDefault ||
      (currentPath && path.resolve(currentPath) === normalizedSource)
        ? normalizedTarget
        : currentPath;
    const filteredHistory = (currentSettings.gameStorageHistory || [])
      .map((item) => item.trim())
      .filter((item) => item && path.resolve(item) !== normalizedSource);
    const nextHistory = this.toStorageHistory(
      filteredHistory,
      normalizedTarget,
    );

    await this.persistGamesAndRefresh(games);
    store.set("settings", {
      ...currentSettings,
      gameStoragePath: nextStoragePath,
      gameStorageHistory: nextHistory,
      ignoreDefaultGamesMigrationPrompt:
        options.ignoreDefaultGamesMigrationPrompt
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

    await this.persistGamesAndRefresh(nextGames);
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
        message: "config.json does not exist",
        target: configPath,
      });
    } else {
      try {
        const rawText = await fs.readFile(configPath, "utf-8");
        let parsed: unknown;
        let validJson = true;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          validJson = false;
          issues.push({
            level: "error",
            code: "config_invalid_json",
            message: "config.json is not valid JSON",
            target: configPath,
          });
          parsed = null;
        }

        if (validJson) {
          if (parsed && typeof parsed === "object") {
            try {
              decryptConfigPayload(parsed);
            } catch (error) {
              issues.push({
                level: "error",
                code: "config_decrypt_failed",
                message: (error as Error).message,
                target: configPath,
              });
            }
          } else {
            issues.push({
              level: "error",
              code: "config_invalid_structure",
              message: "config.json has an invalid structure",
              target: configPath,
            });
          }
        }
      } catch (error) {
        issues.push({
          level: "error",
          code: "config_read_failed",
          message: `Failed to read config.json: ${(error as Error).message}`,
          params: { reason: (error as Error).message },
          target: configPath,
        });
      }
    }

    try {
      const integrityErrors = await bzGamesDatabase.checkIntegrity();
      if (integrityErrors.length > 0) {
        issues.push({
          level: "error",
          code: "database_integrity_failed",
          message: "bz_games.db integrity check failed",
          params: { reason: integrityErrors.join("; ") },
          target: bzGamesDatabase.getDatabasePath(),
        });
      }
    } catch (error) {
      issues.push({
        level: "error",
        code: "database_integrity_failed",
        message: `Failed to verify bz_games.db: ${(error as Error).message}`,
        params: { reason: (error as Error).message },
        target: bzGamesDatabase.getDatabasePath(),
      });
    }

    if (!settings.playerId?.trim()) {
      issues.push({
        level: "error",
        code: "player_id_missing",
        message: "Player ID is missing",
      });
    }

    const gameIds = new Set<string>();
    for (const game of games) {
      if (gameIds.has(game.id)) {
        issues.push({
          level: "error",
          code: "duplicate_game_id",
          message: `Duplicate game ID: ${game.id}`,
          params: { gameId: game.id },
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
            message: `Duplicate game version: ${game.id}@${version.version}`,
            params: { gameId: game.id, version: version.version },
            target: `${game.id}@${version.version}`,
          });
        }
        seenVersions.add(version.version);

        const manifestPath = path.join(version.path, "game.json");
        if (!(await pathExists(version.path))) {
          issues.push({
            level: "error",
            code: "version_path_missing",
            message: `Game version directory does not exist: ${game.id}@${version.version}`,
            params: { gameId: game.id, version: version.version },
            target: version.path,
          });
          continue;
        }
        try {
          if (!(await fs.stat(version.path)).isDirectory()) {
            issues.push({
              level: "error",
              code: "version_path_not_directory",
              message: `Game version path is not a directory: ${game.id}@${version.version}`,
              params: { gameId: game.id, version: version.version },
              target: version.path,
            });
            continue;
          }
        } catch (error) {
          issues.push({
            level: "error",
            code: "version_path_read_failed",
            message: `Failed to inspect game version directory: ${(error as Error).message}`,
            params: {
              gameId: game.id,
              version: version.version,
              reason: (error as Error).message,
            },
            target: version.path,
          });
          continue;
        }
        if (!(await pathExists(manifestPath))) {
          issues.push({
            level: "error",
            code: "manifest_missing",
            message: `game.json is missing: ${game.id}@${version.version}`,
            params: { gameId: game.id, version: version.version },
            target: manifestPath,
          });
          continue;
        }

        try {
          const { manifest, encrypted } =
            readGameManifestFileWithMetadata(manifestPath);
          if (!encrypted) {
            issues.push({
              level: "warning",
              code: "manifest_plaintext",
              message: `game.json is not encrypted: ${game.id}@${version.version}`,
              params: { gameId: game.id, version: version.version },
              target: manifestPath,
            });
          }
          if (manifest.id !== game.id || manifest.version !== version.version) {
            issues.push({
              level: "error",
              code: "manifest_identity_mismatch",
              message: `Manifest identity does not match its game record: ${game.id}@${version.version}`,
              params: {
                gameId: game.id,
                version: version.version,
                manifestId: manifest.id,
                manifestVersion: manifest.version,
              },
              target: manifestPath,
            });
          }

          const compatible = Array.isArray(manifest.platformVersion)
            ? semver.gte(app.getVersion(), manifest.platformVersion[0]) &&
              semver.lte(app.getVersion(), manifest.platformVersion[1])
            : semver.satisfies(app.getVersion(), manifest.platformVersion);
          if (!compatible) {
            issues.push({
              level: "warning",
              code: "manifest_platform_incompatible",
              message: `Game requires platform ${String(manifest.platformVersion)}`,
              params: {
                gameId: game.id,
                version: version.version,
                required: String(manifest.platformVersion),
                current: app.getVersion(),
              },
              target: manifestPath,
            });
          }

          const referencedFiles: Array<{
            kind: string;
            relativePath: string | undefined;
          }> = [
            {
              kind: "entry",
              relativePath:
                manifest.entry === "url"
                  ? undefined
                  : manifest.entry === "serve"
                    ? "index.html"
                    : manifest.entry,
            },
            { kind: "icon", relativePath: manifest.icon },
            { kind: "cover", relativePath: manifest.cover },
            { kind: "video", relativePath: manifest.video },
            ...(manifest.achievements || []).map((achievement) => ({
              kind: "achievementIcon",
              relativePath: achievement.icon,
            })),
          ];
          for (const referenced of referencedFiles) {
            if (!referenced.relativePath) continue;
            const referencedPath = path.join(
              version.path,
              referenced.relativePath,
            );
            let isFile = false;
            try {
              isFile = (await fs.stat(referencedPath)).isFile();
            } catch {
              isFile = false;
            }
            if (!isFile) {
              issues.push({
                level: "error",
                code: "manifest_file_missing",
                message: `Manifest ${referenced.kind} file is missing: ${referenced.relativePath}`,
                params: {
                  gameId: game.id,
                  version: version.version,
                  kind: referenced.kind,
                  file: referenced.relativePath,
                },
                target: referencedPath,
              });
            }
          }
        } catch (error) {
          const code =
            error instanceof GameManifestFileError
              ? error.code
              : "manifest_invalid";
          issues.push({
            level: "error",
            code,
            message: `Failed to validate game.json: ${(error as Error).message}`,
            params: {
              gameId: game.id,
              version: version.version,
              reason: (error as Error).message,
            },
            target: manifestPath,
          });
        }
      }

      if (!game.versions.some((v) => v.version === game.latestVersion)) {
        issues.push({
          level: "error",
          code: "latest_version_invalid",
          message: `latestVersion does not reference an installed version: ${game.id}`,
          params: { gameId: game.id, version: game.latestVersion },
          target: `${game.id}@${game.latestVersion}`,
        });
      }
    }

    for (const storageRoot of storageRoots) {
      if (!(await pathExists(storageRoot))) {
        issues.push({
          level: "warning",
          code: "storage_root_missing",
          message: "Game storage path does not exist",
          target: storageRoot,
        });
      }
    }

    const report: DataHealthReport = {
      ok: issues.length === 0,
      checkedAt: Date.now(),
      summary: {
        errors: issues.filter((issue) => issue.level === "error").length,
        warnings: issues.filter((issue) => issue.level === "warning").length,
        gameCount: games.length,
        versionCount: games.reduce(
          (sum, game) => sum + game.versions.length,
          0,
        ),
        storagePathCount: storageRoots.length,
      },
      issues,
    };

    return report;
  }

  async updateGameStats(
    id: string,
    version: string,
    stats: Record<string, number>,
    modes: Record<string, "increment" | "full"> = {},
    gameName = id,
    statNames: Record<string, string> = {},
  ): Promise<void> {
    const games = this.getGamesList();
    const entry = this.findGameById(games, id);
    if (!entry) return;

    const reportedAt = Date.now();
    await bzGamesDatabase.recordStats(
      Object.entries(stats).map(([statId, value]) => ({
        gameId: id,
        gameName,
        version,
        statId,
        statName: statNames[statId] || statId,
        value,
        mode: modes[statId] || "increment",
        reportedAt,
      })),
    );

    const game = entry.game;
    const gameVersion = game.versions.find((v) => v.version === version);
    if (gameVersion) {
      if (!gameVersion.stats) gameVersion.stats = {};
      for (const [key, value] of Object.entries(stats)) {
        const mode = modes[key] || "increment";
        gameVersion.stats[key] =
          mode === "full" ? value : (gameVersion.stats[key] || 0) + value;
      }
    }
    games[entry.index] = game;
    this.gamesCache = games;
  }

  async updatePlaytime(
    id: string,
    version: string,
    durationMs: number,
  ): Promise<void> {
    const total = await bzGamesDatabase.get<{ total: number }>(
      "SELECT COALESCE(SUM(duration_ms), 0) AS total FROM play_sessions WHERE duration_ms IS NOT NULL",
    );
    const oldTime = total?.total || 0;
    this.applyPlaytimeRewards(oldTime, oldTime + durationMs);
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
    this.gamesCache = games;
  }
}

export const storeService = new StoreService();
