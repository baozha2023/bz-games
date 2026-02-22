import crypto from 'crypto';
import ElectronStore from 'electron-store';
import fs from 'fs/promises';
import path from 'path';
import type { AppStore, AppSettings, GameRecord, GameVersion } from '../../shared/types';
import { getAppRoot } from '../utils/appPath';
import { logger } from '../utils/logger';

const defaultSettings: AppSettings = {
  playerName: '玩家',
  playerId: '', // Will be generated on first run
  language: 'zh-CN',
  theme: 'dark',
  defaultRoomPort: 38080,
};

const defaultStore: AppStore = {
  games: [],
  settings: defaultSettings,
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
        const Store = (await import('electron-store')).default;
        this.store = new Store<AppStore>({
          name: 'config',
          defaults: defaultStore,
          cwd: getAppRoot(),
        });
        logger.info(`[StoreService] Store initialized at: ${this.store.path}`);
      } catch (error) {
        logger.error('[StoreService] Failed to initialize store:', error);
        throw error;
      }
    })();

    return this._initPromise;
  }

  private getStore(): ElectronStore<AppStore> {
    if (!this.store) {
      throw new Error('StoreService not initialized! Call init() first.');
    }
    return this.store;
  }

  getGames(): GameRecord[] {
    return this.getStore().get('games', []);
  }

  addGame(game: GameRecord): void {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const index = games.findIndex(g => g.id === game.id);
    
    if (index !== -1) {
      games[index] = game;
    } else {
      games.push(game);
    }
    
    store.set('games', games);
  }

  saveGames(games: GameRecord[]): void {
    this.getStore().set('games', games);
  }

  unlockAchievement(gameId: string, version: string, achievementId: string): boolean {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const gameIndex = games.findIndex(g => g.id === gameId);
    
    if (gameIndex === -1) return false;
    
    const game = games[gameIndex];
    const gameVersion = game.versions.find(v => v.version === version);

    if (!gameVersion) return false;

    if (!gameVersion.unlockedAchievements) {
      gameVersion.unlockedAchievements = [];
    }
    
    // Check if already unlocked
    if (gameVersion.unlockedAchievements.some(a => a.id === achievementId)) {
      return false; // Already unlocked
    }
    
    gameVersion.unlockedAchievements.push({
      id: achievementId,
      unlockedAt: Date.now()
    });
    
    games[gameIndex] = game;
    store.set('games', games);
    return true; // Newly unlocked
  }

  toggleFavorite(id: string): boolean {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const index = games.findIndex(g => g.id === id);

    if (index === -1) return false;

    games[index].isFavorite = !games[index].isFavorite;
    store.set('games', games);
    return games[index].isFavorite || false;
  }

  async removeGame(id: string, versions?: string[]): Promise<void> {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const gameIndex = games.findIndex(g => g.id === id);
    const game = games[gameIndex];
    
    if (!game) return;

    // If versions are specified, delete only those versions
    if (versions !== undefined) {
      if (versions.length === 0) return; // Nothing to delete
      
      const remainingVersions: GameVersion[] = [];
      const versionsToDelete: GameVersion[] = [];

      for (const v of game.versions) {
        if (versions.includes(v.version)) {
          versionsToDelete.push(v);
        } else {
          remainingVersions.push(v);
        }
      }

      for (const v of versionsToDelete) {
        try {
          await fs.rm(v.path, { recursive: true, force: true });
          logger.info(`[StoreService] Removed game version directory: ${v.path}`);
        } catch (e) {
          logger.error(`[StoreService] Failed to remove game version directory for ${id} ${v.version}`, e);
        }
      }

      // If no versions left, remove the whole game record and parent folder
      if (remainingVersions.length === 0) {
        if (game.versions.length > 0) {
          // Try to remove the parent directory (game root)
          const parentDir = path.dirname(game.versions[0].path);
          try {
            await fs.rm(parentDir, { recursive: true, force: true });
            logger.info(`[StoreService] Removed game root directory: ${parentDir}`);
          } catch (e) {
            logger.warn(`[StoreService] Failed to remove game root directory`, e);
          }
        }
        const newGames = games.filter(g => g.id !== id);
        store.set('games', newGames);
      } else {
          // Update the game record with remaining versions
          game.versions = remainingVersions;
          
          // Update latestVersion if needed
          if (!remainingVersions.find(v => v.version === game.latestVersion)) {
              // Fallback to the first available version
              game.latestVersion = remainingVersions[0].version;
          }
          
          games[gameIndex] = game;
          store.set('games', games);
      }
    } else {
      // Remove entire game (legacy behavior or "select all")
      if (game.versions?.length > 0) {
        try {
          const versionPath = game.versions[0].path;
          const gameRoot = path.dirname(versionPath);
          
          await fs.rm(gameRoot, { recursive: true, force: true });
          logger.info(`[StoreService] Removed game directory: ${gameRoot}`);
        } catch (e) {
          logger.error(`[StoreService] Failed to remove game directory for ${id}`, e);
        }
      }
      
      const newGames = games.filter(g => g.id !== id);
      store.set('games', newGames);
    }
  }

  getSettings(): AppSettings {
    const store = this.getStore();
    const settings = store.get('settings', defaultSettings);
    
    const merged = { ...defaultSettings, ...settings };
    
    if (!merged.playerId) {
      merged.playerId = crypto.randomUUID();
      logger.info(`[StoreService] Generated new playerId: ${merged.playerId}`);
      store.set('settings', merged);
    }
    
    return merged;
  }

  saveSettings(settings: Partial<AppSettings>): void {
    const store = this.getStore();
    const current = this.getSettings();
    
    logger.info(`[StoreService] Updating settings`);
    store.set('settings', { ...current, ...settings });
  }

  updateGameStats(id: string, version: string, stats: Record<string, number>): void {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const index = games.findIndex(g => g.id === id);
    
    if (index !== -1) {
      const game = games[index];
      game.lastPlayedAt = Date.now();
      
      const gameVersion = game.versions.find(v => v.version === version);
      if (gameVersion) {
        if (!gameVersion.stats) gameVersion.stats = {};
        
        for (const [key, value] of Object.entries(stats)) {
          // If the value is a number, we accumulate it.
          // If the user wants to set a specific value (like "high score"),
          // the current logic accumulates.
          // However, for "high score", usually the game logic handles "is this higher?" and sends the new high score?
          // OR the game sends "score: 100" and platform accumulates "total_score".
          // The platform usually accumulates stats like "kills", "deaths", "time".
          // For "high score", it's usually a state, not a cumulative stat.
          // The current implementation accumulates. I'll stick to accumulation for "stats".
          // If the game wants to store high score, it might be better to use a different mechanism or just let the game handle it internally (which Fruit Ninja does).
          // But platform might want to show "Total Fruits Cut".
          gameVersion.stats[key] = (gameVersion.stats[key] || 0) + value;
        }
      }

      store.set('games', games);
    }
  }

  updatePlaytime(id: string, version: string, durationMs: number): void {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const index = games.findIndex(g => g.id === id);

    if (index !== -1) {
        const game = games[index];
        const gameVersion = game.versions.find(v => v.version === version);
        
        if (gameVersion) {
            gameVersion.playtime = (gameVersion.playtime || 0) + durationMs;
        }
        
        store.set('games', games);
    }
  }
}

export const storeService = new StoreService();
