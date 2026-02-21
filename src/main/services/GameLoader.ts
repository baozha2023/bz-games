import { dialog, app } from 'electron';
import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { GameManifestSchema, type GameManifest } from '../../shared/game-manifest';
import { storeService } from './StoreService';
import type { GameRecord } from '../../shared/types';
import { logger } from '../utils/logger';
import { getGamesDir } from '../utils/appPath';

/**
 * Manually copy a folder recursively to avoid fs.cpSync issues with non-ASCII paths or specific file systems.
 */
function copyFolderRecursiveSync(source: string, target: string) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  if (fs.lstatSync(source).isDirectory()) {
    const files = fs.readdirSync(source);
    for (const file of files) {
      const curSource = path.join(source, file);
      const curTarget = path.join(target, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, curTarget);
      } else {
        fs.copyFileSync(curSource, curTarget);
      }
    }
  }
}

export class GameLoader {
  private static cache: GameManifest[] | null = null;

  static async loadGameFromDialog(): Promise<{ success: boolean; manifest?: GameManifest; error?: string; params?: Record<string, any> }> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select Game Directory',
      properties: ['openDirectory'],
      filters: []
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, error: 'canceled' };
    }

    const sourcePath = filePaths[0];
    let tempDir = '';

    try {
      // 1. Validate Selection
      if (!this.isValidDirectory(sourcePath)) {
        return { success: false, error: 'notDirectory' };
      }

      // 2. Check for Manifest
      const jsonPath = path.join(sourcePath, 'game.json');
      if (!fs.existsSync(jsonPath)) {
        return { success: false, error: 'noManifest' };
      }

      // 3. Parse and Validate Manifest
      const manifest = this.loadManifest(jsonPath);
      if (!manifest) {
        return { success: false, error: 'manifestInvalid' };
      }

      // 4. Check Platform Version
      const currentVersion = app.getVersion();
      if (manifest.platformVersion && !semver.satisfies(currentVersion, manifest.platformVersion)) {
        return { 
          success: false, 
          error: 'platformVersionMismatch',
          params: { required: manifest.platformVersion, current: currentVersion }
        };
      }

      // 5. Verify Entry Point
      const entryPath = path.join(sourcePath, manifest.entry);
      if (!fs.existsSync(entryPath)) {
        return { success: false, error: 'entryNotFound', params: { entry: manifest.entry } };
      }

      // 6. Install Game Files
      const targetPath = this.installGameFiles(sourcePath, manifest);

      // 7. Update Store
      await this.updateGameRecord(manifest, targetPath);

      this.cache = null; // Invalidate cache
      return { success: true, manifest };

    } catch (err: any) {
      logger.error('Failed to load game:', err);
      return { success: false, error: 'unknown', params: { message: err.message || 'Unknown error' } };
    } finally {
      // Clean up temp dir if we ever use one (currently not using temp dir for folder import)
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
          logger.warn(`Failed to clean up temp dir: ${tempDir}`, e);
        }
      }
    }
  }

  private static isValidDirectory(dirPath: string): boolean {
    try {
      return fs.lstatSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  }

  private static loadManifest(jsonPath: string): GameManifest | null {
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return GameManifestSchema.parse(raw);
    } catch (e) {
      logger.warn(`Invalid manifest at ${jsonPath}`, e);
      return null;
    }
  }

  private static installGameFiles(sourcePath: string, manifest: GameManifest): string {
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

  private static async updateGameRecord(manifest: GameManifest, targetPath: string): Promise<void> {
    const games = await storeService.getGames();
    let record = games.find(g => g.id === manifest.id);

    if (record) {
      // Update existing record
      const versionExists = record.versions.some(v => v.version === manifest.version);
      if (versionExists) {
        // Update path and addedAt for existing version
        record.versions = record.versions.map(v => 
          v.version === manifest.version 
            ? { ...v, path: targetPath, addedAt: Date.now() } 
            : v
        );
      } else {
        // Add new version
        record.versions.push({
          version: manifest.version,
          path: targetPath,
          addedAt: Date.now()
        });
      }
      
      // Update latest version (simple semantic version comparison)
      record.latestVersion = record.versions.sort((a, b) => 
        b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' })
      )[0].version;
    } else {
      // Create new record
      record = {
        id: manifest.id,
        versions: [{
          version: manifest.version,
          path: targetPath,
          addedAt: Date.now()
        }],
        latestVersion: manifest.version,
        addedAt: Date.now(),
        playtime: 0,
        unlockedAchievements: []
      };
    }

    await storeService.addGame(record);
  }

  static async getAllGames(): Promise<GameManifest[]> {
    if (this.cache) return this.cache;

    const records = await storeService.getGames();
    const manifests: GameManifest[] = [];

    for (const record of records) {
      // Find the path for the latest version
      const latest = record.versions.find(v => v.version === record.latestVersion);
      if (latest) {
        const jsonPath = path.join(latest.path, 'game.json');
        if (fs.existsSync(jsonPath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
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
  
  static async removeGame(id: string): Promise<void> {
    await storeService.removeGame(id);
    this.cache = null;
  }
  
  static async getGameRecord(id: string): Promise<GameRecord | undefined> {
    const games = await storeService.getGames();
    return games.find(g => g.id === id);
  }

  static async getVersionPath(gameId: string, version?: string): Promise<string | null> {
    const record = await this.getGameRecord(gameId);
    if (!record) return null;

    const targetVersion = version || record.latestVersion;
    const versionRecord = record.versions.find(v => v.version === targetVersion);
    
    return versionRecord ? versionRecord.path : null;
  }

  static async getManifest(gameId: string, version?: string): Promise<GameManifest | null> {
    const versionPath = await this.getVersionPath(gameId, version);
    if (!versionPath) return null;

    const jsonPath = path.join(versionPath, 'game.json');
    if (!fs.existsSync(jsonPath)) return null;

    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      return GameManifestSchema.parse(raw);
    } catch (e) {
      logger.warn(`Failed to parse manifest for ${gameId} version ${version || 'latest'}`, e);
      return null;
    }
  }
}
