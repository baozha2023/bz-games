import crypto from "crypto";
import ElectronStore from "electron-store";
import fs from "fs/promises";
import path from "path";
import type {
  AppStore,
  AppSettings,
  GameRecord,
  GameVersion,
  UserData,
} from "../../shared/types";
import { getAppRoot } from "../utils/appPath";
import { logger } from "../utils/logger";

const defaultSettings: AppSettings = {
  playerName: "玩家",
  playerId: "",
  lastJoinRoomAddress: "",
  language: "zh-CN",
  theme: "dark",
  defaultRoomPort: 38080,
  closeBehavior: "tray",
  autoLaunch: false,
};

const defaultUserData: UserData = {
  bzCoins: 0,
  cumulativePlayTime: 0,
  checkIn: {
    lastCheckInDate: "",
    consecutiveDays: 0,
  },
};

const defaultStore: AppStore = {
  games: [],
  settings: defaultSettings,
  userData: defaultUserData,
  recentPlayed: [],
};

class StoreService {
  private store: ElectronStore<AppStore> | null = null;
  private _initPromise: Promise<void> | null = null;

  /**
   * Initialize the store.
   * This must be called after app.whenReady() because electron-store
   * requires access to app.getPath('userData').
   */
  async init(): Promise<void> {
    if (this.store) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        const Store = (await import("electron-store")).default;
        this.store = new Store<AppStore>({
          name: "config",
          defaults: defaultStore,
          cwd: getAppRoot(),
        });
        logger.info(`[StoreService] Store initialized at: ${this.store.path}`);
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

    // 10 minutes = 600,000 ms
    const REWARD_INTERVAL = 10 * 60 * 1000;
    const REWARD_AMOUNT = 10;

    const oldIntervals = Math.floor(oldTime / REWARD_INTERVAL);
    const newIntervals = Math.floor(newTime / REWARD_INTERVAL);

    const rewardCount = newIntervals - oldIntervals;
    if (rewardCount > 0) {
      const reward = rewardCount * REWARD_AMOUNT;
      userData.bzCoins = (userData.bzCoins || 0) + reward;
      logger.info(`[StoreService] Awarded ${reward} coins for playtime.`);
    }

    userData.cumulativePlayTime = newTime;
    store.set("userData", userData);
    return rewardCount * REWARD_AMOUNT;
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

    if (userData.checkIn.consecutiveDays > 7) {
      userData.checkIn.consecutiveDays = 1;
    }

    let reward = userData.checkIn.consecutiveDays * 10;
    if (userData.checkIn.consecutiveDays === 7) {
      reward = 100;
    }

    userData.checkIn.lastCheckInDate = todayStr;
    userData.bzCoins = (userData.bzCoins || 0) + reward;

    store.set("userData", userData);
    return {
      success: true,
      coins: reward,
      days: userData.checkIn.consecutiveDays,
    };
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
        await fs.rm(v.path, { recursive: true, force: true });
        logger.info(`[StoreService] Removed game version directory: ${v.path}`);
      } catch (e) {
        logger.error(
          `[StoreService] Failed to remove game version directory for ${id} ${v.version}`,
          e,
        );
      }
    }
  }

  private async removeGameRootByVersionPath(
    versionPath: string | undefined,
    level: "warn" | "error",
  ): Promise<void> {
    if (!versionPath) return;
    const parentDir = path.dirname(versionPath);

    try {
      await fs.rm(parentDir, { recursive: true, force: true });
      logger.info(`[StoreService] Removed game root directory: ${parentDir}`);
    } catch (e) {
      const log = level === "error" ? logger.error : logger.warn;
      log(`[StoreService] Failed to remove game root directory`, e);
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
      await this.removeGameRootByVersionPath(
        game.versions[0]?.path,
        versions === undefined ? "error" : "warn",
      );
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

    const merged = { ...defaultSettings, ...settings };

    if (!merged.playerId) {
      merged.playerId = crypto.randomUUID();
      logger.info(`[StoreService] Generated new playerId: ${merged.playerId}`);
      store.set("settings", merged);
    }

    return merged;
  }

  saveSettings(settings: Partial<AppSettings>): void {
    const store = this.getStore();
    const current = this.getSettings();

    logger.info(`[StoreService] Updating settings`);
    store.set("settings", { ...current, ...settings });
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
