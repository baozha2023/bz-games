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
  UserData,
  NicknameStyle,
  ManualUnlockCondition,
  ManualUnlockResult,
} from "../../../shared/types";
import { getAppRoot } from "../../utils/appPath";
import { logger } from "../../utils/logger";
import { AVATAR_FRAMES } from "../../../shared/avatar-frames";
import { getGameCardProduct } from "../../../shared/game-card-products";
import {
  PLAYTIME_REWARD_AMOUNT,
  PLAYTIME_REWARD_INTERVAL_MS,
} from "../../../shared/AppConstants";
import {
  GameManifestFileError,
  readGameManifestFileWithMetadata,
} from "../game/GameManifestFileService";
import {
  BUILTIN_LIBRARY_ID,
  assertCanonicalGameVersionRelativePath,
  bzGamesDatabase,
  normalizeGameLibraryRoot,
  type GameLibraryRecord,
} from "./database/BzGamesDatabase";
import { playSessionDatabaseService } from "./database/PlaySessionDatabaseService";
import {
  createDefaultV4Store,
  deserializeV4Config,
  serializeV4Config,
} from "./ConfigCodec";
import { lifecycleOperationGuard } from "../system/LifecycleOperationGuard";
import { backupActivityGuard } from "../backup/BackupActivityGuard";

const defaultStore = createDefaultV4Store();
const defaultSettings = defaultStore.settings;
const STORAGE_MIGRATION_MAX_ATTEMPTS = 3;
const STORAGE_MIGRATION_RETRY_DELAY_MS = 500;

interface QuarantinedGameVersion {
  originalPath: string;
  quarantinedPath: string;
  transactionRoot: string;
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function normalizeNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value.filter((item): item is string => typeof item === "string"),
        ),
      )
    : [];
}

function normalizeUserData(value: unknown): UserData {
  const source =
    value && typeof value === "object"
      ? (value as Partial<UserData>)
      : ({} as Partial<UserData>);
  const sourceCheckIn: Partial<UserData["checkIn"]> =
    source.checkIn && typeof source.checkIn === "object" ? source.checkIn : {};
  const consecutiveDays = normalizeNonNegativeInteger(
    sourceCheckIn.consecutiveDays,
  );

  return {
    bzCoins: normalizeNonNegativeNumber(source.bzCoins),
    checkIn: {
      lastCheckInDate:
        typeof sourceCheckIn.lastCheckInDate === "string"
          ? sourceCheckIn.lastCheckInDate
          : "",
      consecutiveDays,
      maxConsecutiveDays: Math.max(
        consecutiveDays,
        normalizeNonNegativeInteger(sourceCheckIn.maxConsecutiveDays),
      ),
      totalDays: normalizeNonNegativeInteger(sourceCheckIn.totalDays),
    },
    ownedFrames: normalizeStringArray(source.ownedFrames),
    equippedFrame:
      typeof source.equippedFrame === "string"
        ? source.equippedFrame
        : undefined,
    ownedGameCardProducts: normalizeStringArray(source.ownedGameCardProducts),
    equippedGameCardProduct:
      typeof source.equippedGameCardProduct === "string"
        ? source.equippedGameCardProduct
        : undefined,
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

export class StoreService {
  private store: ElectronStore<AppStore> | null = null;
  private _initPromise: Promise<void> | null = null;
  private gamesCache: GameRecord[] = [];
  private gameLibrariesCache: GameLibraryRecord[] = [];
  private manualUnlockChain: Promise<void> = Promise.resolve();
  private gameStorageMigrationRunning = false;

  private enqueueManualUnlock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.manualUnlockChain.then(operation, operation);
    this.manualUnlockChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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

        await bzGamesDatabase.initialize();
        const Store = (await import("electron-store")).default;
        this.store = new Store<AppStore>({
          name: "config",
          defaults: defaultStore,
          cwd: dataRoot,
          serialize: (data) => serializeV4Config(data),
          deserialize: (content) => deserializeV4Config(content),
        });
        logger.info(`[StoreService] Store initialized at: ${this.store.path}`);

        [this.gamesCache, this.gameLibrariesCache] = await Promise.all([
          bzGamesDatabase.getGames(),
          bzGamesDatabase.getGameLibraries(),
        ]);
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
    [this.gamesCache, this.gameLibrariesCache] = await Promise.all([
      bzGamesDatabase.getGames(),
      bzGamesDatabase.getGameLibraries(),
    ]);
  }

  private async persistGamesAndRefresh(games: GameRecord[]): Promise<void> {
    await bzGamesDatabase.saveGames(games);
    await this.refreshGameDerivedData();
  }

  getUserData(): UserData {
    return normalizeUserData(this.getStore().get("userData"));
  }

  async performUnlockFrame(frameId: string): Promise<ManualUnlockResult> {
    return this.enqueueManualUnlock(async () => {
      const userData = this.getUserData();
      const frame = AVATAR_FRAMES.find((candidate) => candidate.id === frameId);

      if (!frame) return { success: false, code: "invalid_item" };
      return this.unlockCosmetic(
        userData,
        frameId,
        frame.unlock,
        userData.ownedFrames,
        (id) => {
          userData.equippedFrame = id;
        },
      );
    });
  }

  async performUnlockGameCardProduct(
    productId: string,
  ): Promise<ManualUnlockResult> {
    return this.enqueueManualUnlock(async () => {
      const userData = this.getUserData();
      const product = getGameCardProduct(productId);

      if (!product) return { success: false, code: "invalid_item" };
      return this.unlockCosmetic(
        userData,
        productId,
        product.unlock,
        userData.ownedGameCardProducts,
        (id) => {
          userData.equippedGameCardProduct = id;
        },
      );
    });
  }

  async getGameCardProductUnlockProgress(
    productId: string,
  ): Promise<ManualUnlockResult> {
    const userData = this.getUserData();
    const product = getGameCardProduct(productId);
    if (!product) return { success: false, code: "invalid_item" };
    if (userData.ownedGameCardProducts.includes(productId)) {
      return { success: true, code: "already_owned" };
    }
    return this.checkManualUnlockCondition(product.unlock, userData);
  }

  private async unlockCosmetic(
    userData: UserData,
    itemId: string,
    condition: ManualUnlockCondition,
    ownedItems: string[],
    equip: (itemId: string) => void,
  ): Promise<ManualUnlockResult> {
    if (ownedItems.includes(itemId)) {
      return { success: false, code: "already_owned" };
    }

    const result = await this.checkManualUnlockCondition(condition, userData);
    if (!result.success) return result;

    if (condition.type === "bzcoin") {
      userData.bzCoins -= condition.amount;
    }
    ownedItems.push(itemId);
    equip(itemId);
    this.getStore().set("userData", userData);
    return { success: true };
  }

  private async checkManualUnlockCondition(
    condition: ManualUnlockCondition,
    userData: UserData,
  ): Promise<ManualUnlockResult> {
    switch (condition.type) {
      case "bzcoin":
        return {
          success: userData.bzCoins >= condition.amount,
          code:
            userData.bzCoins >= condition.amount
              ? undefined
              : "insufficient_coins",
          current: userData.bzCoins,
          required: condition.amount,
        };
      case "playtime": {
        const current = await playSessionDatabaseService.getTotalPlayDuration();
        return current >= condition.durationMs
          ? { success: true }
          : {
              success: false,
              code: "condition_not_met",
              current,
              required: condition.durationMs,
            };
      }
      case "total_checkin": {
        const current = userData.checkIn.totalDays;
        return current >= condition.days
          ? { success: true }
          : {
              success: false,
              code: "condition_not_met",
              current,
              required: condition.days,
            };
      }
      case "consecutive_checkin": {
        const current = userData.checkIn.maxConsecutiveDays;
        return current >= condition.days
          ? { success: true }
          : {
              success: false,
              code: "condition_not_met",
              current,
              required: condition.days,
            };
      }
      case "date_playtime": {
        const current = await playSessionDatabaseService.getPlayDurationForDate(
          condition.date,
        );
        return current >= condition.durationMs
          ? { success: true }
          : {
              success: false,
              code: "condition_not_met",
              current,
              required: condition.durationMs,
              targetDate: condition.date,
            };
      }
    }
  }

  performSaveNicknameStyle(
    style: NicknameStyle,
    coinCost: number,
  ): {
    success: boolean;
    code?: string;
  } {
    const store = this.getStore();
    const userData = this.getUserData();

    if (userData.bzCoins < coinCost) {
      return { success: false, code: "insufficient_coins" };
    }

    userData.bzCoins -= coinCost;
    store.set("userData", userData);
    this.saveSettings({ nicknameStyle: style });
    return { success: true };
  }

  performEquipFrame(frameId: string): void {
    const store = this.getStore();
    const userData = this.getUserData();

    if (!userData.ownedFrames.includes(frameId)) return;

    userData.equippedFrame = frameId;
    store.set("userData", userData);
  }

  performEquipGameCardProduct(productId: string): void {
    const store = this.getStore();
    const userData = this.getUserData();
    if (!getGameCardProduct(productId)) return;
    if (!userData.ownedGameCardProducts.includes(productId)) return;
    userData.equippedGameCardProduct = productId;
    store.set("userData", userData);
  }

  performUnequipFrame(frameId: string): void {
    const store = this.getStore();
    const userData = this.getUserData();

    if (userData.equippedFrame === frameId) {
      userData.equippedFrame = undefined;
      store.set("userData", userData);
    }
  }

  performUnequipGameCardProduct(productId: string): void {
    const store = this.getStore();
    const userData = this.getUserData();
    if (userData.equippedGameCardProduct === productId) {
      userData.equippedGameCardProduct = undefined;
      store.set("userData", userData);
    }
  }

  addBzCoins(amount: number): number {
    const store = this.getStore();
    const userData = this.getUserData();
    userData.bzCoins += amount;
    store.set("userData", userData);
    return userData.bzCoins;
  }

  private applyPlaytimeRewards(oldTime: number, newTime: number): number {
    const store = this.getStore();
    const userData = this.getUserData();

    const oldIntervals = Math.floor(oldTime / PLAYTIME_REWARD_INTERVAL_MS);
    const newIntervals = Math.floor(newTime / PLAYTIME_REWARD_INTERVAL_MS);

    const rewardCount = newIntervals - oldIntervals;
    if (rewardCount > 0) {
      const reward = rewardCount * PLAYTIME_REWARD_AMOUNT;
      userData.bzCoins += reward;
      logger.info(`[StoreService] Awarded ${reward} coins for playtime.`);
    }

    store.set("userData", userData);
    return rewardCount * PLAYTIME_REWARD_AMOUNT;
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
    const userData = this.getUserData();

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
    userData.checkIn.maxConsecutiveDays = Math.max(
      userData.checkIn.maxConsecutiveDays,
      userData.checkIn.consecutiveDays,
    );

    const cycleDay = ((userData.checkIn.consecutiveDays - 1) % 7) + 1;
    let reward = cycleDay * 10;
    if (cycleDay === 7) {
      reward = 100;
    }

    userData.checkIn.lastCheckInDate = todayStr;
    userData.checkIn.totalDays += 1;
    userData.bzCoins += reward;

    store.set("userData", userData);
    return {
      success: true,
      coins: reward,
      days: userData.checkIn.consecutiveDays,
    };
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

  private async quarantineVersionDirectories(
    versions: GameVersion[],
  ): Promise<QuarantinedGameVersion[]> {
    const operationId = crypto.randomUUID();
    const quarantined: QuarantinedGameVersion[] = [];
    try {
      for (const [index, version] of versions.entries()) {
        const originalPath = this.resolveGameVersionPath(version);
        try {
          await fs.lstat(originalPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        const library = this.gameLibrariesCache.find(
          (item) => item.id === version.libraryId,
        );
        if (!library) throw new Error("game_library_not_found");
        const transactionRoot = path.join(
          this.getLibraryRoot(library),
          ".bz-games-trash",
          operationId,
        );
        const quarantinedPath = path.join(transactionRoot, String(index));
        await fs.mkdir(transactionRoot, { recursive: true });
        await fs.rename(originalPath, quarantinedPath);
        quarantined.push({ originalPath, quarantinedPath, transactionRoot });
      }
      return quarantined;
    } catch (error) {
      try {
        await this.restoreQuarantinedVersionDirectories(quarantined);
      } catch (rollbackError) {
        throw new Error("game_delete_rollback_failed", {
          cause: rollbackError,
        });
      }
      throw new Error("game_delete_prepare_failed", { cause: error });
    }
  }

  private async restoreQuarantinedVersionDirectories(
    quarantined: QuarantinedGameVersion[],
  ): Promise<void> {
    for (const item of quarantined.slice().reverse()) {
      await fs.mkdir(path.dirname(item.originalPath), { recursive: true });
      await fs.rename(item.quarantinedPath, item.originalPath);
    }
    await this.removeQuarantineTransactionRoots(quarantined);
  }

  private async removeQuarantineTransactionRoots(
    quarantined: QuarantinedGameVersion[],
  ): Promise<void> {
    const roots = new Set(quarantined.map((item) => item.transactionRoot));
    for (const root of roots) {
      try {
        await this.removePath(root, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 200,
        });
        await fs.rmdir(path.dirname(root)).catch((error) => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
        });
      } catch (error) {
        logger.error(
          `[StoreService] Failed to clean quarantined game files: ${root}`,
          error,
        );
      }
    }
  }

  private async finalizeQuarantinedVersionDirectories(
    quarantined: QuarantinedGameVersion[],
  ): Promise<void> {
    await this.removeQuarantineTransactionRoots(quarantined);
    const gameRoots = new Set(
      quarantined.map((item) => path.dirname(item.originalPath)),
    );
    for (const gameRoot of gameRoots) {
      try {
        await fs.rmdir(gameRoot);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY") {
          logger.warn(
            `[StoreService] Could not remove empty game root: ${gameRoot}`,
            error,
          );
        }
      }
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
    const quarantined = await this.quarantineVersionDirectories(removing);
    try {
      if (remaining.length === 0) {
        await bzGamesDatabase.softDelete(id);
      } else {
        await bzGamesDatabase.softDelete(
          id,
          removing.map((version) => version.version),
        );
      }
    } catch (error) {
      await this.restoreQuarantinedVersionDirectories(quarantined);
      throw new Error("game_delete_database_failed", { cause: error });
    }
    try {
      await this.refreshGameDerivedData();
    } finally {
      await this.finalizeQuarantinedVersionDirectories(quarantined);
    }
  }

  getSettings(): AppSettings {
    const store = this.getStore();
    const settings = store.get("settings", defaultSettings);

    const merged = { ...settings };
    let shouldPersist = false;

    if (!merged.playerId) {
      merged.playerId = crypto.randomUUID();
      logger.info(`[StoreService] Generated new playerId: ${merged.playerId}`);

      const initialLangFile = path.join(getAppRoot(), ".initial-language");
      try {
        const langContent = fsSync.readFileSync(initialLangFile, "utf-8");
        const lang = langContent.trim();
        if (["zh-CN", "en-US", "ja-JP", "zh-TW", "de-DE"].includes(lang)) {
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

  getDefaultGameStoragePath(): string {
    const selected =
      this.gameLibrariesCache.find((library) => library.is_default === 1) ||
      this.gameLibrariesCache.find(
        (library) => library.id === BUILTIN_LIBRARY_ID,
      );
    if (!selected) {
      throw new Error("game_storage_path_not_configured");
    }
    return this.getLibraryRoot(selected);
  }

  private getLibraryRoot(library: GameLibraryRecord): string {
    return library.kind === "builtin"
      ? path.join(getAppRoot(), "games")
      : library.root_path || "";
  }

  private getConfiguredGameStoragePaths(): string[] {
    return this.gameLibrariesCache.map((library) =>
      this.getLibraryRoot(library),
    );
  }

  getGameStorageRoots(): string[] {
    return this.getConfiguredGameStoragePaths();
  }

  hasActiveStorageMigration(): boolean {
    return this.gameStorageMigrationRunning;
  }

  getGameVersionLocation(versionPath: string): {
    libraryId: string;
    relativePath: string;
  } {
    const resolvedPath = path.resolve(versionPath);
    const candidates = this.gameLibrariesCache
      .map((library) => ({
        library,
        root: path.resolve(this.getLibraryRoot(library)),
      }))
      .sort((left, right) => right.root.length - left.root.length);

    for (const candidate of candidates) {
      const relativePath = path.relative(candidate.root, resolvedPath);
      if (
        relativePath &&
        !relativePath.startsWith("..") &&
        !path.isAbsolute(relativePath)
      ) {
        const canonicalRelativePath = relativePath.split(path.sep).join("/");
        assertCanonicalGameVersionRelativePath(canonicalRelativePath);
        return {
          libraryId: candidate.library.id,
          relativePath: canonicalRelativePath,
        };
      }
    }
    throw new Error(`game_version_outside_registered_library:${versionPath}`);
  }

  resolveGameVersionPath(
    version: Pick<GameVersion, "libraryId" | "relativePath">,
  ): string {
    const library = this.gameLibrariesCache.find(
      (candidate) => candidate.id === version.libraryId,
    );
    if (!library) {
      throw new Error(`game_library_not_found:${version.libraryId}`);
    }
    assertCanonicalGameVersionRelativePath(version.relativePath);
    const segments = version.relativePath.split("/");
    const root = path.resolve(this.getLibraryRoot(library));
    const resolvedPath = path.resolve(root, ...segments);
    const relativeToRoot = path.relative(root, resolvedPath);
    if (
      !relativeToRoot ||
      relativeToRoot.startsWith("..") ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new Error(
        `game_version_path_outside_library:${version.relativePath}`,
      );
    }
    this.assertNoReparsePoints(resolvedPath);
    return resolvedPath;
  }

  getGameStoragePathItems(): { path: string; isDefault: boolean }[] {
    const defaultPath = this.getDefaultGameStoragePath();
    return this.getConfiguredGameStoragePaths().map((storagePath) => ({
      path: storagePath,
      isDefault:
        normalizeGameLibraryRoot(storagePath) ===
        normalizeGameLibraryRoot(defaultPath),
    }));
  }

  async addGameStoragePath(storagePath: string): Promise<void> {
    this.beginGameLibraryMutation();
    try {
      const normalizedPath = this.normalizeStoragePath(storagePath);
      this.ensureStorageDirectoryEmpty(normalizedPath);
      await bzGamesDatabase.addExternalGameLibrary(normalizedPath);
      this.gameLibrariesCache = await bzGamesDatabase.getGameLibraries();
    } finally {
      backupActivityGuard.end();
    }
  }

  async setDefaultGameStoragePath(storagePath: string): Promise<void> {
    this.beginGameLibraryMutation();
    try {
      const normalizedPath = this.normalizeStoragePath(storagePath);
      const library = this.gameLibrariesCache.find(
        (item) =>
          normalizeGameLibraryRoot(this.getLibraryRoot(item)) ===
          normalizeGameLibraryRoot(normalizedPath),
      );
      if (!library) {
        throw new Error("storage_path_not_registered");
      }
      await bzGamesDatabase.setDefaultGameLibrary(library.id);
      this.gameLibrariesCache = await bzGamesDatabase.getGameLibraries();
    } finally {
      backupActivityGuard.end();
    }
  }

  getGameVersionStoragePath(gameId: string, version: string): string {
    const targetVersion = version || "latest";
    const record = this.getGamesList().find((game) => game.id === gameId);
    const versionRecord = record?.versions.find(
      (item) => item.version === targetVersion,
    );
    if (versionRecord) {
      return this.resolveGameVersionPath(versionRecord);
    }
    return path.join(this.getDefaultGameStoragePath(), gameId, targetVersion);
  }

  private normalizeStoragePath(input: string): string {
    if (typeof input !== "string" || !input.trim()) {
      throw new Error("invalid_storage_path");
    }
    const normalized = path.resolve(input.trim());
    if (normalized === path.parse(normalized).root) {
      throw new Error("invalid_storage_path");
    }
    this.assertNoReparsePoints(normalized);
    return normalized;
  }

  private beginGameLibraryMutation(): void {
    if (
      lifecycleOperationGuard.blocksNewActivity() ||
      !backupActivityGuard.tryBegin()
    ) {
      throw new Error("storage_migration_active");
    }
  }

  private assertNoReparsePoints(targetPath: string): void {
    let currentPath = path.resolve(targetPath);
    while (true) {
      try {
        if (fsSync.lstatSync(currentPath).isSymbolicLink()) {
          throw new Error("invalid_storage_path");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "invalid_storage_path"
        ) {
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error("invalid_storage_path", { cause: error });
        }
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) return;
      currentPath = parentPath;
    }
  }

  private ensureStorageDirectoryEmpty(storagePath: string): void {
    this.assertNoReparsePoints(storagePath);
    if (!fsSync.existsSync(storagePath)) {
      fsSync.mkdirSync(storagePath, { recursive: true });
      this.assertNoReparsePoints(storagePath);
      return;
    }
    if (!fsSync.lstatSync(storagePath).isDirectory()) {
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

  private async retryStorageMigration<T>(
    stage: string,
    operation: (attempt: number) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 1;
      attempt <= STORAGE_MIGRATION_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
        logger.warn(
          `[StoreService] Storage migration ${stage} attempt ${attempt}/${STORAGE_MIGRATION_MAX_ATTEMPTS} failed`,
          error,
        );
        if (attempt < STORAGE_MIGRATION_MAX_ATTEMPTS) {
          await new Promise((resolve) =>
            setTimeout(resolve, STORAGE_MIGRATION_RETRY_DELAY_MS),
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`storage_migration_${stage}_failed`);
  }

  private async getDirectorySignature(rootPath: string): Promise<string[]> {
    const signature: string[] = [];
    const visit = async (
      currentPath: string,
      relativeRoot: string,
    ): Promise<void> => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const absolutePath = path.join(currentPath, entry.name);
        const relativePath = path.join(relativeRoot, entry.name);
        const stats = await fs.lstat(absolutePath);
        if (entry.isSymbolicLink()) {
          signature.push(
            `${relativePath}\0link\0${await fs.readlink(absolutePath)}`,
          );
        } else if (entry.isDirectory()) {
          signature.push(`${relativePath}\0directory`);
          await visit(absolutePath, relativePath);
        } else if (entry.isFile()) {
          signature.push(`${relativePath}\0file\0${stats.size}`);
        } else {
          signature.push(`${relativePath}\0special\0${stats.mode}`);
        }
      }
    };
    await visit(rootPath, "");
    return signature;
  }

  private async assertStorageDirectoriesEquivalent(
    sourceRoot: string,
    targetRoot: string,
  ): Promise<void> {
    const [sourceSignature, targetSignature] = await Promise.all([
      this.getDirectorySignature(sourceRoot),
      this.getDirectorySignature(targetRoot),
    ]);
    if (
      sourceSignature.length !== targetSignature.length ||
      sourceSignature.some((entry, index) => entry !== targetSignature[index])
    ) {
      throw new Error("storage_migration_copy_verification_failed");
    }
  }

  private async copyStorageDirectoryWithRetry(
    sourceRoot: string,
    targetRoot: string,
  ): Promise<void> {
    try {
      await this.retryStorageMigration("copy", async () => {
        await this.clearDirectoryContents(targetRoot);
        await this.copyPath(sourceRoot, targetRoot, {
          recursive: true,
          force: true,
          errorOnExist: false,
          preserveTimestamps: true,
        });
        await this.assertStorageDirectoriesEquivalent(sourceRoot, targetRoot);
      });
    } catch (error) {
      try {
        await this.retryStorageMigration("copy-cleanup", () =>
          this.clearDirectoryContents(targetRoot),
        );
      } catch (cleanupError) {
        logger.error(
          `[StoreService] Failed to clean migration target after copy failure: ${targetRoot}`,
          cleanupError,
        );
        throw new Error("storage_migration_rollback_failed", {
          cause: cleanupError,
        });
      }
      if (this.isFileBusyError(error)) {
        throw new Error("storage_migration_file_busy", { cause: error });
      }
      throw new Error("storage_migration_copy_failed", { cause: error });
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
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const code = (cause as NodeJS.ErrnoException | undefined)?.code;
    return code === "EBUSY" || code === "EPERM";
  }

  private async updateLibraryRootWithRetry(
    libraryId: string,
    rootPath: string,
    expectedVersionCount: number,
  ): Promise<void> {
    await this.retryStorageMigration("database", async () => {
      await bzGamesDatabase.updateExternalGameLibrary(libraryId, rootPath);
      const [libraries, referenced] = await Promise.all([
        bzGamesDatabase.getGameLibraries(),
        bzGamesDatabase.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM game_versions WHERE library_id = ?",
          [libraryId],
        ),
      ]);
      const updated = libraries.find((item) => item.id === libraryId);
      if (
        !updated ||
        updated.kind !== "external" ||
        normalizeGameLibraryRoot(updated.root_path || "") !==
          normalizeGameLibraryRoot(rootPath) ||
        (referenced?.count || 0) !== expectedVersionCount
      ) {
        throw new Error("storage_migration_database_verification_failed");
      }
      await this.refreshGameDerivedData();
    });
  }

  private async rollbackStorageMigration(
    libraryId: string,
    sourceRoot: string,
    targetRoot: string,
    expectedVersionCount: number,
    restoreSource: boolean,
  ): Promise<void> {
    try {
      if (restoreSource) {
        await fs.mkdir(sourceRoot, { recursive: true });
        await this.retryStorageMigration("source-restore", async () => {
          await this.clearDirectoryContents(sourceRoot);
          await this.copyPath(targetRoot, sourceRoot, {
            recursive: true,
            force: true,
            errorOnExist: false,
            preserveTimestamps: true,
          });
          await this.assertStorageDirectoriesEquivalent(targetRoot, sourceRoot);
        });
      }
      await this.updateLibraryRootWithRetry(
        libraryId,
        sourceRoot,
        expectedVersionCount,
      );
      await this.retryStorageMigration("rollback-cleanup", () =>
        this.clearDirectoryContents(targetRoot),
      );
    } catch (error) {
      logger.error(
        "[StoreService] Failed to roll back game library migration",
        error,
      );
      throw new Error("storage_migration_rollback_failed", { cause: error });
    }
  }

  saveSettings(settings: Partial<AppSettings>): void {
    const store = this.getStore();
    const current = this.getSettings();
    logger.info(`[StoreService] Updating settings`);
    store.set("settings", {
      ...current,
      ...settings,
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
    if (this.gameStorageMigrationRunning) {
      throw new Error("storage_migration_active");
    }
    this.beginGameLibraryMutation();
    this.gameStorageMigrationRunning = true;
    try {
      const normalizedSource = this.normalizeStoragePath(sourceRoot);
      const normalizedTarget = this.normalizeStoragePath(targetRoot);
      const library = this.gameLibrariesCache.find(
        (item) =>
          normalizeGameLibraryRoot(this.getLibraryRoot(item)) ===
          normalizeGameLibraryRoot(normalizedSource),
      );
      if (!library) {
        throw new Error("storage_path_not_registered");
      }
      if (library.kind === "builtin") {
        throw new Error("builtin_library_path_is_fixed");
      }
      if (
        this.gameLibrariesCache.some(
          (item) =>
            item.id !== library.id &&
            normalizeGameLibraryRoot(this.getLibraryRoot(item)) ===
              normalizeGameLibraryRoot(normalizedTarget),
        )
      ) {
        throw new Error("target_storage_path_already_registered");
      }
      if (!fsSync.existsSync(normalizedSource)) {
        throw new Error("source_storage_path_not_found");
      }
      if (!fsSync.statSync(normalizedSource).isDirectory()) {
        throw new Error("source_storage_path_not_directory");
      }
      this.assertMigrationTargetAllowed(normalizedSource, normalizedTarget);
      this.ensureStorageDirectoryEmpty(normalizedTarget);

      const referenced = await bzGamesDatabase.get<{
        count: number;
        installed_count: number;
        installed_game_count: number;
      }>(
        `SELECT COUNT(*) AS count,
         COALESCE(SUM(CASE WHEN lifecycle_state = 'installed' THEN 1 ELSE 0 END), 0)
           AS installed_count,
         COUNT(DISTINCT CASE WHEN lifecycle_state = 'installed' THEN game_id END)
           AS installed_game_count
         FROM game_versions WHERE library_id = ?`,
        [library.id],
      );
      const expectedVersionCount = referenced?.count || 0;
      const migratedVersions = referenced?.installed_count || 0;
      const migratedGames = referenced?.installed_game_count || 0;

      await fs.mkdir(normalizedTarget, { recursive: true });
      await this.copyStorageDirectoryWithRetry(
        normalizedSource,
        normalizedTarget,
      );

      try {
        await this.updateLibraryRootWithRetry(
          library.id,
          normalizedTarget,
          expectedVersionCount,
        );
      } catch (error) {
        await this.rollbackStorageMigration(
          library.id,
          normalizedSource,
          normalizedTarget,
          expectedVersionCount,
          false,
        );
        throw new Error("storage_migration_database_failed", { cause: error });
      }

      try {
        await this.retryStorageMigration("source-delete", async () => {
          await this.removePath(normalizedSource, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 200,
          });
          if (await pathExists(normalizedSource)) {
            throw new Error("storage_migration_source_delete_incomplete");
          }
        });
      } catch (error) {
        await this.rollbackStorageMigration(
          library.id,
          normalizedSource,
          normalizedTarget,
          expectedVersionCount,
          true,
        );
        throw new Error("storage_migration_source_delete_failed", {
          cause: error,
        });
      }

      return {
        migratedGames,
        migratedVersions,
        gameStoragePath: normalizedTarget,
      };
    } finally {
      this.gameStorageMigrationRunning = false;
      backupActivityGuard.end();
    }
  }

  async removeGameStoragePath(storagePath: string): Promise<{
    removedGames: number;
    removedVersions: number;
    nextStoragePath: string;
  }> {
    this.beginGameLibraryMutation();
    try {
      const normalizedTarget = this.normalizeStoragePath(storagePath);
      const library = this.gameLibrariesCache.find(
        (item) =>
          normalizeGameLibraryRoot(this.getLibraryRoot(item)) ===
          normalizeGameLibraryRoot(normalizedTarget),
      );
      if (!library) {
        throw new Error("storage_path_not_registered");
      }
      if (library.kind === "builtin") {
        throw new Error("builtin_library_cannot_be_removed");
      }
      const installedVersions = this.gamesCache.flatMap((game) =>
        game.versions
          .filter((version) => version.libraryId === library.id)
          .map((version) => ({ gameId: game.id, version })),
      );
      const quarantined = await this.quarantineVersionDirectories(
        installedVersions.map((item) => item.version),
      );
      try {
        await bzGamesDatabase.deactivateExternalGameLibraryAndVersions(
          library.id,
        );
      } catch (error) {
        await this.restoreQuarantinedVersionDirectories(quarantined);
        throw new Error("storage_library_database_failed", { cause: error });
      }
      try {
        await this.refreshGameDerivedData();
      } finally {
        await this.finalizeQuarantinedVersionDirectories(quarantined);
      }

      return {
        removedGames: new Set(installedVersions.map((item) => item.gameId))
          .size,
        removedVersions: installedVersions.length,
        nextStoragePath: this.getDefaultGameStoragePath(),
      };
    } finally {
      backupActivityGuard.end();
    }
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
        try {
          deserializeV4Config(rawText);
        } catch (error) {
          issues.push({
            level: "error",
            code: "config_decrypt_failed",
            message: (error as Error).message,
            target: configPath,
          });
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

        let versionPath: string;
        try {
          versionPath = this.resolveGameVersionPath(version);
        } catch (error) {
          issues.push({
            level: "error",
            code: "version_path_invalid",
            message: `Game version location is invalid: ${(error as Error).message}`,
            params: {
              gameId: game.id,
              version: version.version,
              reason: (error as Error).message,
            },
            target: `${version.libraryId}:${version.relativePath}`,
          });
          continue;
        }
        const manifestPath = path.join(versionPath, "game.json");
        if (!(await pathExists(versionPath))) {
          issues.push({
            level: "error",
            code: "version_path_missing",
            message: `Game version directory does not exist: ${game.id}@${version.version}`,
            params: { gameId: game.id, version: version.version },
            target: versionPath,
          });
          continue;
        }
        try {
          if (!(await fs.stat(versionPath)).isDirectory()) {
            issues.push({
              level: "error",
              code: "version_path_not_directory",
              message: `Game version path is not a directory: ${game.id}@${version.version}`,
              params: { gameId: game.id, version: version.version },
              target: versionPath,
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
            target: versionPath,
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
              versionPath,
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
