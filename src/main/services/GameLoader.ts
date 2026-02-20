import { dialog, app } from 'electron';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
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

  static async loadGameFromDialog(): Promise<{ success: boolean; manifest?: GameManifest; error?: string }> {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'dontAddToRecent'],
      filters: [
        { name: 'Game Package', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, error: 'User canceled' };
    }

    let sourcePath = filePaths[0];
    let tempDir = '';

    try {
      // 1. Handle ZIP extraction
      if (fs.statSync(sourcePath).isFile() && sourcePath.endsWith('.zip')) {
        const result = this.extractZip(sourcePath);
        sourcePath = result.sourcePath;
        tempDir = result.tempDir;
      }

      // 2. Find game root
      sourcePath = this.findGameRoot(sourcePath);

      // 3. Ensure manifest exists (or generate default)
      const jsonPath = this.ensureManifest(sourcePath);
      if (!jsonPath) {
        return { success: false, error: '未找到 game.json 或 game.js，请确认这是一个合法的游戏包' };
      }

      // 4. Parse and validate manifest
      const manifest = this.parseManifest(jsonPath);

      // 5. Verify entry point
      const entryPath = path.join(sourcePath, manifest.entry);
      if (!fs.existsSync(entryPath)) {
        return { success: false, error: `入口文件 ${manifest.entry} 不存在` };
      }

      // 6. Install game files
      const targetPath = this.installGameFiles(sourcePath, manifest);

      // 7. Update store
      await this.updateGameRecord(manifest, targetPath);

      this.cache = null; // Invalidate cache
      return { success: true, manifest };

    } catch (err: any) {
      logger.error('Failed to load game:', err);
      return { success: false, error: err.message || '加载失败' };
    } finally {
      // Clean up temp dir
      if (tempDir && fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
          logger.info(`Cleaned up temp dir: ${tempDir}`);
        } catch (e) {
          logger.warn(`Failed to clean up temp dir: ${tempDir}`, e);
        }
      }
    }
  }

  private static extractZip(zipPath: string): { sourcePath: string; tempDir: string } {
    try {
      const zip = new AdmZip(zipPath);
      const tempDir = path.join(app.getPath('temp'), `bz-game-import-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      zip.extractAllTo(tempDir, true);
      logger.info(`Extracted zip to ${tempDir}`);
      return { sourcePath: tempDir, tempDir };
    } catch (e: any) {
      throw new Error(`Failed to extract zip: ${e.message}`);
    }
  }

  private static findGameRoot(sourcePath: string): string {
    const jsonPath = path.join(sourcePath, 'game.json');
    const jsPath = path.join(sourcePath, 'game.js');
    
    // If not in root, check if there is a single subdirectory containing the game
    if (!fs.existsSync(jsonPath) && !fs.existsSync(jsPath)) {
      const files = fs.readdirSync(sourcePath);
      const subDirs = files.filter(f => fs.statSync(path.join(sourcePath, f)).isDirectory());
      if (subDirs.length === 1) {
        const subPath = path.join(sourcePath, subDirs[0]);
        if (fs.existsSync(path.join(subPath, 'game.json')) || fs.existsSync(path.join(subPath, 'game.js'))) {
          return subPath;
        }
      }
    }
    return sourcePath;
  }

  private static ensureManifest(sourcePath: string): string | null {
    const jsonPath = path.join(sourcePath, 'game.json');
    const jsPath = path.join(sourcePath, 'game.js');

    // If game.json missing but game.js exists, generate one
    if (!fs.existsSync(jsonPath) && fs.existsSync(jsPath)) {
      logger.info('game.json not found, but game.js exists. Generating default manifest.');
      const gameId = `com.imported.${crypto.randomUUID().split('-')[0]}`;
      const defaultManifest = {
        id: gameId,
        name: `Imported Game ${new Date().toLocaleDateString()}`,
        version: '1.0.0',
        description: 'Automatically imported from game.js',
        author: 'Unknown',
        platformVersion: '>=1.0.0',
        entry: './game.js',
        type: 'singleplayer'
      };
      fs.writeFileSync(jsonPath, JSON.stringify(defaultManifest, null, 2));
    }

    return fs.existsSync(jsonPath) ? jsonPath : null;
  }

  private static parseManifest(jsonPath: string): GameManifest {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    return GameManifestSchema.parse(raw);
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
      return this.parseManifest(jsonPath);
    } catch (e) {
      logger.warn(`Failed to parse manifest for ${gameId} version ${version || 'latest'}`, e);
      return null;
    }
  }
}
