import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { GameLoader } from './GameLoader';
import { GameApiServer } from './GameApiServer';
import { storeService } from './StoreService';
import { logger } from '../utils/logger';
import type { RoomMessage } from '../../shared/types';
import { roomClient } from './RoomClient';
import { roomServer } from './RoomServer';
import { mainWindow } from '../window';
import { IPC } from '../../shared/ipc-channels';
import type { GameManifest } from '../../shared/game-manifest';

class GameManager {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private gameApiServers: Map<string, GameApiServer> = new Map();
  private startTimes: Map<string, number> = new Map();

  constructor() {
    this.initializeHandlers();
  }

  private initializeHandlers() {
    roomClient.setMsgHandler((gameId, msg) => this.relayToGame(gameId, msg));
    roomClient.setStartGameHandler((gameId, version) => this.launch(gameId, version));
    roomClient.setStopGameHandler((gameId) => this.stop(gameId));
  }

  async launch(id: string, version?: string): Promise<boolean> {
    logger.info(`[GameManager] Launching game: ${id} (version: ${version || 'latest'})`);

    if (this.isGameRunning(id)) {
      logger.info(`[GameManager] Game ${id} is already running`);
      return false;
    }

    try {
      const { path: versionPath, manifest } = await this.prepareGame(id, version);
      
      const { port, token } = await this.startApiServer(id);
      
      const settings = storeService.getSettings();
      const env = this.prepareEnvironment(id, manifest, port, token, settings);
      
      this.writeBzConfig(versionPath, port, token, settings);
      
      return this.spawnGameProcess(id, versionPath, manifest, env);

    } catch (error: any) {
      logger.error(`[GameManager] Launch failed for ${id}:`, error);
      this.notifyLaunchFailure(id, error.message || 'Unknown error');
      this.cleanup(id);
      return false;
    }
  }

  stop(id: string): void {
    this.cleanup(id);
  }

  relayToGame(gameId: string, msg: RoomMessage) {
    const api = this.gameApiServers.get(gameId);
    if (api) {
      api.sendEvent('event.message', msg.payload);
    }
  }

  private isGameRunning(id: string): boolean {
    return this.activeProcesses.has(id);
  }

  private async prepareGame(id: string, version?: string): Promise<{ path: string, manifest: GameManifest }> {
    const versionPath = await GameLoader.getVersionPath(id, version);
    if (!versionPath) {
      throw new Error(`Game version not found: ${id} @ ${version || 'latest'}`);
    }

    const manifest = await GameLoader.getManifest(id, version);
    if (!manifest) {
      throw new Error(`Manifest missing or invalid for ${id}`);
    }

    return { path: versionPath, manifest };
  }

  private async startApiServer(id: string): Promise<{ port: number, token: string }> {
    const apiServer = new GameApiServer();
    
    apiServer.setOnStop(() => {
      logger.info(`[GameManager] API Server stopped for ${id}`);
      this.stop(id);
      mainWindow?.webContents.send(IPC.GAME_PROCESS_ENDED, id);
    });

    const { port, token } = await apiServer.start();
    apiServer.gameId = id;
    this.gameApiServers.set(id, apiServer);
    
    return { port, token };
  }

  private prepareEnvironment(id: string, manifest: GameManifest, port: number, token: string, settings: any) {
    const isHost = roomClient.room && roomClient.room.hostId === settings.playerId;
    
    return Object.assign({}, process.env, manifest.env || {}, {
      BZ_PLATFORM: '1',
      BZ_PLATFORM_VERSION: '1.0.0',
      BZ_API_PORT: port.toString(),
      BZ_API_TOKEN: token,
      BZ_PLAYER_ID: settings.playerId,
      BZ_PLAYER_NAME: settings.playerName,
      BZ_GAME_ID: id,
      BZ_ROOM_ID: roomClient.room ? roomClient.room.id : '',
      BZ_IS_HOST: isHost ? '1' : '0',
    });
  }

  private writeBzConfig(versionPath: string, port: number, token: string, settings: any) {
    try {
      const configPath = path.join(versionPath, 'bz-config.js');
      const configContent = `window.BZ_CONFIG = { 
        apiPort: '${port}', 
        token: '${token}',
        playerId: '${settings.playerId}',
        playerName: ${JSON.stringify(settings.playerName)}
      };`;
      fs.writeFileSync(configPath, configContent);
    } catch (e) {
      logger.warn(`[GameManager] Failed to write config file`, e);
    }
  }

  private spawnGameProcess(id: string, versionPath: string, manifest: GameManifest, env: any): boolean {
    const entryPath = path.join(versionPath, manifest.entry);
    
    if (!fs.existsSync(entryPath)) {
      throw new Error(`Entry file not found: ${manifest.entry}`);
    }

    const isWindows = process.platform === 'win32';
    const isBatch = entryPath.endsWith('.bat') || entryPath.endsWith('.cmd');
    
    const cp = spawn(entryPath, manifest.args || [], {
      cwd: versionPath,
      env: env,
      detached: true,
      stdio: 'ignore',
      shell: isWindows && isBatch,
      windowsHide: false
    });
    
    cp.unref(); 
    this.activeProcesses.set(id, cp);
    this.startTimes.set(id, Date.now());
    
    logger.info(`[GameManager] Process started for ${id}`);
    mainWindow?.webContents.send(IPC.GAME_PROCESS_STARTED, id);
    
    cp.on('exit', (code) => this.handleProcessExit(id, code));

    return true;
  }

  private handleProcessExit(id: string, code: number | null) {
    logger.info(`[GameManager] Game ${id} exited with code ${code}`);
    
    this.recordPlaytime(id);
    this.notifyRoomGameEnd(id);
    this.stop(id); // Ensure cleanup
    mainWindow?.webContents.send(IPC.GAME_PROCESS_ENDED, id);
  }

  private recordPlaytime(id: string) {
    const startTime = this.startTimes.get(id);
    if (startTime) {
      const duration = Math.round((Date.now() - startTime) / 1000);
      storeService.updateGameStats(id, duration);
      this.startTimes.delete(id);
    }
  }

  private notifyRoomGameEnd(id: string) {
    if (roomServer.room && roomServer.room.gameId === id && roomServer.room.state === 'playing') {
      roomServer.room.state = 'waiting';
      roomServer.broadcast({ type: 'room:game:end', payload: {} });
      roomServer.broadcastState();
    }
  }

  private cleanup(id: string) {
    const cp = this.activeProcesses.get(id);
    if (cp) {
      cp.kill();
      this.activeProcesses.delete(id);
    }

    const api = this.gameApiServers.get(id);
    if (api) {
      api.stop();
      this.gameApiServers.delete(id);
    }
  }

  private notifyLaunchFailure(id: string, reason: string) {
    mainWindow?.webContents.send(IPC.GAME_LAUNCH_FAILED, { id, reason });
  }
}

export const gameManager = new GameManager();
