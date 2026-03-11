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
import { getAppRoot, getExecutableDir, isPortableMode } from "../utils/appPath";
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
  ignoredUpdateVersion: "",
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

const CONFIG_ENCRYPTION_SEED = "bz-games-config:v1";

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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfMissing(sourcePath: string, targetPath: string) {
  if (await pathExists(targetPath)) return;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function moveOrCopyDirectory(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error: any) {
    if (error?.code === "EXDEV" || error?.code === "EACCES" || error?.code === "EPERM") {
      await fs.cp(sourcePath, targetPath, { recursive: true });
    } else {
      throw error;
    }
  }
}

async function mergeLegacyDirectory(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(sourcePath, entry.name);
    const dst = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      if (await pathExists(dst)) {
        await mergeLegacyDirectory(src, dst);
      } else {
        await moveOrCopyDirectory(src, dst);
      }
    } else {
      if (!(await pathExists(dst))) {
        await fs.copyFile(src, dst);
      }
    }
  }
}

async function migrateLegacyData(
  legacyRoot: string,
  dataRoot: string,
): Promise<void> {
  if (legacyRoot === dataRoot) return;
  const legacyConfigPath = path.join(legacyRoot, "config.json");
  const dataConfigPath = path.join(dataRoot, "config.json");
  if (await pathExists(legacyConfigPath)) {
    await copyIfMissing(legacyConfigPath, dataConfigPath);
  }

  const legacyGamesDir = path.join(legacyRoot, "games");
  const dataGamesDir = path.join(dataRoot, "games");
  if (await pathExists(legacyGamesDir)) {
    if (await pathExists(dataGamesDir)) {
      await mergeLegacyDirectory(legacyGamesDir, dataGamesDir);
    } else {
      await moveOrCopyDirectory(legacyGamesDir, dataGamesDir);
    }
  }
}

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
        const dataRoot = getAppRoot();
        const legacyRoot = getExecutableDir();
        if (!isPortableMode()) {
          await migrateLegacyData(legacyRoot, dataRoot);
        }

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

    const cycleDay = ((userData.checkIn.consecutiveDays - 1) % 7) + 1;
    let reward = cycleDay * 10;
    if (cycleDay === 7) {
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
