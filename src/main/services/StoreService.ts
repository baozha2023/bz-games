import crypto from 'crypto';
import ElectronStore from 'electron-store';
import fs from 'fs/promises';
import path from 'path';
import type { AppStore, AppSettings, GameRecord } from '../../shared/types';
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

  unlockAchievement(gameId: string, achievementId: string): boolean {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const gameIndex = games.findIndex(g => g.id === gameId);
    
    if (gameIndex === -1) return false;
    
    const game = games[gameIndex];
    if (!game.unlockedAchievements) {
      game.unlockedAchievements = [];
    }
    
    // Check if already unlocked
    if (game.unlockedAchievements.some(a => a.id === achievementId)) {
      return false; // Already unlocked
    }
    
    game.unlockedAchievements.push({
      id: achievementId,
      unlockedAt: Date.now()
    });
    
    games[gameIndex] = game;
    store.set('games', games);
    return true; // Newly unlocked
  }

  async removeGame(id: string): Promise<void> {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const game = games.find(g => g.id === id);
    
    if (game && game.versions?.length > 0) {
      try {
        // Assuming versions are stored in games/<id>/<version>/
        // We want to delete games/<id>/
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

  updateGameStats(id: string, duration: number): void {
    const store = this.getStore();
    const games = store.get('games', []) || [];
    const index = games.findIndex(g => g.id === id);
    
    if (index !== -1) {
      games[index].playtime = (games[index].playtime || 0) + duration;
      games[index].lastPlayedAt = Date.now();
      store.set('games', games);
    }
  }
}

export const storeService = new StoreService();
