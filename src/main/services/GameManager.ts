import {ChildProcess, spawn} from 'child_process';
import {BrowserWindow, shell} from 'electron';
import path from 'path';
import fs from 'fs';
import { createServer, Server } from 'http';
import handler from 'serve-handler';
import { findAvailablePort } from '../utils/portUtils';
import {GameLoader} from './GameLoader';
import {GameApiServer} from './GameApiServer';
import {storeService} from './StoreService';
import {GameEnvironment} from './GameEnvironment';
import {logger} from '../utils/logger';
import type {RoomMessage} from '../../shared/types';
import {roomClient} from './RoomClient';
import {roomServer} from './RoomServer';
import {mainWindow} from '../window';
import {IPC} from '../../shared/ipc-channels';
import type {GameManifest} from '../../shared/game-manifest';

class GameManager {
    private activeProcesses: Map<string, ChildProcess> = new Map();
    private activeWindows: Map<string, BrowserWindow> = new Map();
    private activeServers: Map<string, Server> = new Map();
    private gameApiServers: Map<string, GameApiServer> = new Map();
    private startTimes: Map<string, { start: number, version: string }> = new Map();

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
            const {path: versionPath, manifest} = await this.prepareGame(id, version);

            const {port, token} = await this.startApiServer(id, manifest.version);

            const settings = storeService.getSettings();
            const env = GameEnvironment.prepare(id, manifest, port, token, settings);

            GameEnvironment.writeConfig(versionPath, port, token, settings);

            if (manifest.entry === 'serve') {
                return this.launchServeGame(id, versionPath, manifest);
            } else if (manifest.entry.endsWith('.html')) {
                return this.launchWebGame(id, versionPath, manifest);
            } else {
                return this.spawnGameProcess(id, versionPath, manifest, env);
            }

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
        return this.activeProcesses.has(id) || this.activeWindows.has(id);
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

        return {path: versionPath, manifest};
    }

    private async startApiServer(id: string, version: string): Promise<{ port: number, token: string }> {
        const apiServer = new GameApiServer();

        apiServer.setOnStop(() => {
            logger.info(`[GameManager] API Server stopped for ${id}`);
            this.stop(id);
            mainWindow?.webContents.send(IPC.GAME_PROCESS_ENDED, id);
        });

        const {port, token} = await apiServer.start();
        apiServer.gameId = id;
        apiServer.gameVersion = version;
        this.gameApiServers.set(id, apiServer);

        return {port, token};
    }

    private async launchServeGame(id: string, versionPath: string, manifest: GameManifest): Promise<boolean> {
        const port = await findAvailablePort();
        
        const server = createServer((request, response) => {
            return handler(request, response, {
                public: versionPath,
                headers: [
                    { source: '**', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] }
                ]
            });
        });

        server.listen(port, () => {
            logger.info(`[GameManager] Static server running at http://localhost:${port}`);
        });

        this.activeServers.set(id, server);

        const win = new BrowserWindow({
            width: 1280,
            height: 720,
            title: manifest.name,
            icon: manifest.icon ? path.join(versionPath, manifest.icon) : undefined,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: false, // Allow localStorage override
                preload: path.join(__dirname, '../preload/game.js'),
                // partition: `persist:game_${id}_${manifest.version}` // Removed partition to rely on our own storage
            }
        });

        win.loadURL(`http://localhost:${port}?gameId=${id}&version=${manifest.version}`);

        // Open external links in default browser
        win.webContents.setWindowOpenHandler(({url}) => {
            shell.openExternal(url);
            return {action: 'deny'};
        });

        this.activeWindows.set(id, win);
        this.startTimes.set(id, { 
            start: Date.now(), 
            version: manifest.version
        });

        logger.info(`[GameManager] Window started for ${id} (serve mode)`);
        mainWindow?.webContents.send(IPC.GAME_PROCESS_STARTED, id);

        win.on('closed', () => {
            this.handleProcessExit(id, 0);
            this.activeWindows.delete(id);
        });

        return true;
    }

    private launchWebGame(id: string, versionPath: string, manifest: GameManifest): boolean {
        const entryPath = path.join(versionPath, manifest.entry);

        if (!fs.existsSync(entryPath)) {
            throw new Error(`Entry file not found: ${manifest.entry}`);
        }

        const win = new BrowserWindow({
            width: 1280,
            height: 720,
            title: manifest.name,
            icon: manifest.icon ? path.join(versionPath, manifest.icon) : undefined,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: false, // Allow localStorage override
                preload: path.join(__dirname, '../preload/game.js'),
                // partition: `persist:game_${id}_${manifest.version}` // Removed partition to rely on our own storage
            }
        });

        win.loadFile(entryPath, { search: `gameId=${id}&version=${manifest.version}` });

        // Open external links in default browser
        win.webContents.setWindowOpenHandler(({url}) => {
            shell.openExternal(url);
            return {action: 'deny'};
        });

        this.activeWindows.set(id, win);
        this.startTimes.set(id, { 
            start: Date.now(), 
            version: manifest.version
        });

        logger.info(`[GameManager] Window started for ${id}`);
        mainWindow?.webContents.send(IPC.GAME_PROCESS_STARTED, id);

        win.on('closed', () => {
            this.handleProcessExit(id, 0);
            this.activeWindows.delete(id);
        });

        return true;
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
        this.startTimes.set(id, { 
            start: Date.now(), 
            version: manifest.version
        });

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
        const startTimeData = this.startTimes.get(id);
        if (startTimeData) {
            const durationMs = Date.now() - startTimeData.start;
            storeService.updatePlaytime(id, startTimeData.version, durationMs);
        }
        this.startTimes.delete(id);
    }

    private notifyRoomGameEnd(id: string) {
        if (roomServer.room && roomServer.room.gameId === id && roomServer.room.state === 'playing') {
            roomServer.room.state = 'waiting';
            roomServer.broadcast({type: 'room:game:end', payload: {}});
            roomServer.broadcastState();
        }
    }

    private cleanup(id: string) {
        const cp = this.activeProcesses.get(id);
        if (cp) {
            cp.kill();
            this.activeProcesses.delete(id);
        }

        const win = this.activeWindows.get(id);
        if (win) {
            if (!win.isDestroyed()) {
                win.close();
            }
            this.activeWindows.delete(id);
        }

        const server = this.activeServers.get(id);
        if (server) {
            server.close();
            this.activeServers.delete(id);
        }

        const api = this.gameApiServers.get(id);
        if (api) {
            api.stop();
            this.gameApiServers.delete(id);
        }
    }

    private notifyLaunchFailure(id: string, reason: string) {
        mainWindow?.webContents.send(IPC.GAME_LAUNCH_FAILED, {id, reason});
    }
}

export const gameManager = new GameManager();
