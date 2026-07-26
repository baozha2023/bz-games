import { ChildProcess, spawn } from "child_process";
import { BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { createServer, Server } from "http";
import serveStatic from "serve-static";
import { GameLoader } from "./GameLoader";
import { GameApiServer } from "../game-api/GameApiServer";
import { storeService } from "../storage/StoreService";
import { GameEnvironment } from "./GameEnvironment";
import {
  GameType,
  type GameMessageAckPayload,
  type GameRelayPayload,
  type RoomMessage,
  type GameLaunchFailurePayload,
} from "../../../shared/types";
import { roomClient } from "../room/RoomClient";
import { roomServer } from "../room/RoomServer";
import { mainWindow } from "../../window";
import { IPC } from "../../../shared/ipc-channels";
import type { GameManifest } from "../../../shared/game-manifest";
import { playSessionDatabaseService } from "../storage/database/PlaySessionDatabaseService";
import { openExternalHttpUrl } from "../../utils/externalUrl";
import { gameWindowIdentityRegistry } from "./GameWindowIdentityRegistry";
import { resolveGameEntryMode } from "../../../shared/game-launch";
import { findMatchingRoom } from "../room/RoomContext";

class GameManager {
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private activeWindows: Map<string, BrowserWindow> = new Map();
  private activeServers: Map<string, Server> = new Map();
  private activeConfigPaths: Map<string, string> = new Map();
  private gameApiServers: Map<string, GameApiServer> = new Map();
  private launchingGames: Set<string> = new Set();
  private finishingGames: Set<string> = new Set();
  private startTimes: Map<
    string,
    { start: number; version: string; sessionId: string }
  > = new Map();

  constructor() {
    this.initializeHandlers();
  }

  private initializeHandlers() {
    roomClient.setMsgHandler((gameId, msg) => this.relayToGame(gameId, msg));
    roomServer.setLocalRelayHandler((gameId, msg) =>
      this.relayToGame(gameId, msg),
    );
    roomClient.setStartGameHandler((gameId, version) =>
      this.launch(gameId, version),
    );
    roomClient.setStopGameHandler((gameId) => this.stop(gameId));
  }

  async launch(id: string, version?: string): Promise<boolean> {
    if (this.isGameRunning(id) || this.launchingGames.has(id)) {
      return false;
    }

    this.launchingGames.add(id);
    try {
      const { path: versionPath, manifest } = await this.prepareGame(
        id,
        version,
      );
      if (manifest.type === GameType.Multiplayer) {
        const room = findMatchingRoom(manifest.id, manifest.version);
        const localPlayerId = storeService.getSettings().playerId;
        if (
          !room ||
          !room.players.some((player) => player.id === localPlayerId)
        ) {
          throw {
            code: "roomRequired",
            params: {
              gameId: manifest.id,
              version: manifest.version,
            },
          };
        }
      }

      const entryMode = resolveGameEntryMode(manifest.entry);
      if (entryMode === "url") {
        return this.launchRemoteWebGame(id, versionPath, manifest);
      }

      const { port, token } = await this.startApiServer(id, manifest.version);

      const settings = storeService.getSettings();

      if (entryMode === "serve") {
        this.writeWebGameConfig(
          id,
          versionPath,
          manifest,
          port,
          token,
          settings,
        );
        return this.launchServeGame(id, versionPath, manifest);
      } else if (entryMode === "html") {
        this.writeWebGameConfig(
          id,
          versionPath,
          manifest,
          port,
          token,
          settings,
        );
        return this.launchWebGame(id, versionPath, manifest);
      } else {
        const env = GameEnvironment.prepare(
          id,
          manifest,
          port,
          token,
          settings,
        );
        return this.spawnGameProcess(id, versionPath, manifest, env);
      }
    } catch (error: any) {
      this.notifyLaunchFailure(
        id,
        error?.code || "unknown",
        error?.params,
        error?.message,
      );
      this.cleanup(id);
      return false;
    } finally {
      this.launchingGames.delete(id);
    }
  }

  stop(id: string): void {
    if (this.isGameRunning(id) || this.startTimes.has(id)) {
      this.handleProcessExit(id, null);
    } else {
      this.cleanup(id);
    }
  }

  isRunning(id: string): boolean {
    return this.isGameRunning(id);
  }

  relayToGame(gameId: string, msg: RoomMessage) {
    const api = this.gameApiServers.get(gameId);
    if (api) {
      if (msg.type === "game:message:ack") {
        api.sendMessageAck(msg.payload as GameMessageAckPayload);
        return;
      }
      const payload = msg.payload as GameRelayPayload;
      if (payload.mode === "batch" && Array.isArray(payload.messages)) {
        for (const message of payload.messages as GameRelayPayload[]) {
          if (payload.channel && !message.channel)
            message.channel = payload.channel;
          api.sendEvent("event.message", message);
        }
        return;
      }
      api.sendEvent("event.message", payload);
    }
  }

  private isGameRunning(id: string): boolean {
    return this.activeProcesses.has(id) || this.activeWindows.has(id);
  }

  private async prepareGame(
    id: string,
    version?: string,
  ): Promise<{ path: string; manifest: GameManifest }> {
    const versionPath = await GameLoader.getVersionPath(id, version);
    if (!versionPath) {
      throw {
        code: "versionNotFound",
        params: { gameId: id, version: version || "latest" },
      };
    }

    const manifest = await GameLoader.getManifest(id, version);
    if (!manifest) {
      throw {
        code: "manifestInvalid",
        params: { gameId: id, version: version || "latest" },
      };
    }
    const expectedVersion = version || path.basename(versionPath);
    if (manifest.id !== id || manifest.version !== expectedVersion) {
      throw {
        code: "manifestIdentityMismatch",
        params: { gameId: id, version: expectedVersion },
      };
    }
    GameLoader.assertPlatformCompatible(manifest);

    return { path: versionPath, manifest };
  }

  private async startApiServer(
    id: string,
    version: string,
  ): Promise<{ port: number; token: string }> {
    const apiServer = new GameApiServer();

    apiServer.setOnStop(() => {
      this.cleanupApiOnly(id);
    });

    const { port, token } = await apiServer.start();
    apiServer.gameId = id;
    apiServer.gameVersion = version;
    this.gameApiServers.set(id, apiServer);

    return { port, token };
  }

  private writeWebGameConfig(
    id: string,
    versionPath: string,
    manifest: GameManifest,
    port: number,
    token: string,
    settings: ReturnType<typeof storeService.getSettings>,
  ): void {
    GameEnvironment.writeConfig(
      versionPath,
      id,
      manifest,
      port,
      token,
      settings,
    );
    this.activeConfigPaths.set(id, versionPath);
  }

  private async launchServeGame(
    id: string,
    versionPath: string,
    manifest: GameManifest,
  ): Promise<boolean> {
    let serveOrigin = "";
    const staticFiles = serveStatic(versionPath, {
      cacheControl: false,
      etag: false,
      fallthrough: false,
      index: ["index.html"],
      setHeaders(response) {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        response.setHeader("Pragma", "no-cache");
        response.setHeader("Expires", "0");
      },
    });

    const server = createServer((request, response) => {
      const fetchSite = request.headers["sec-fetch-site"];
      const origin = request.headers.origin;
      if (
        fetchSite === "cross-site" ||
        (origin !== undefined && origin !== serveOrigin)
      ) {
        response.statusCode = 403;
        response.end("Forbidden");
        return;
      }
      staticFiles(request, response, (error?: unknown) => {
        if (response.headersSent) return;

        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : 500;
        response.statusCode = statusCode;
        response.end(
          statusCode === 404 ? "Not Found" : "Internal Server Error",
        );
      });
    });

    const port = await new Promise<number>((resolve, reject) => {
      const handleError = (error: Error) => {
        server.off("listening", handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off("error", handleError);
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Failed to resolve the static server listen port"));
          return;
        }
        resolve(address.port);
      };
      server.once("error", handleError);
      server.once("listening", handleListening);
      server.listen(0, "127.0.0.1");
    });

    serveOrigin = `http://127.0.0.1:${port}`;
    this.activeServers.set(id, server);

    const url = `${serveOrigin}/?gameId=${encodeURIComponent(id)}&version=${encodeURIComponent(manifest.version)}`;
    await this.createGameWindow(id, manifest, versionPath, url, false);
    return true;
  }

  private async launchWebGame(
    id: string,
    versionPath: string,
    manifest: GameManifest,
  ): Promise<boolean> {
    const entryPath = path.join(versionPath, manifest.entry);

    if (!fs.existsSync(entryPath)) {
      throw { code: "entryNotFound", params: { entry: manifest.entry } };
    }

    await this.createGameWindow(id, manifest, versionPath, entryPath, true);
    return true;
  }

  private async launchRemoteWebGame(
    id: string,
    versionPath: string,
    manifest: GameManifest,
  ): Promise<boolean> {
    if (!manifest.web_url) {
      throw { code: "webUrlMissing" };
    }
    await this.createGameWindow(
      id,
      manifest,
      versionPath,
      manifest.web_url,
      false,
    );
    return true;
  }

  private async createGameWindow(
    id: string,
    manifest: GameManifest,
    versionPath: string,
    urlOrPath: string,
    isFile: boolean,
  ): Promise<BrowserWindow> {
    const win = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      title: manifest.name,
      icon: manifest.icon ? path.join(versionPath, manifest.icon) : undefined,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false,
        preload: path.join(__dirname, "../preload/game.js"),
        partition: `persist:game_${id}_${manifest.version}`,
        additionalArguments: [
          `--bz-game-id=${id}`,
          `--bz-game-version=${manifest.version}`,
        ],
      },
    });
    const webContentsId = win.webContents.id;
    gameWindowIdentityRegistry.register(webContentsId, {
      gameId: id,
      version: manifest.version,
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      void openExternalHttpUrl(url);
      return { action: "deny" };
    });

    this.activeWindows.set(id, win);
    let launchCompleted = false;
    win.on("closed", () => {
      gameWindowIdentityRegistry.unregister(webContentsId);
      if (launchCompleted && this.activeWindows.get(id) === win) {
        this.handleProcessExit(id, 0);
      } else if (this.activeWindows.get(id) === win) {
        this.activeWindows.delete(id);
      }
    });

    if (isFile) {
      await win.loadFile(urlOrPath, {
        search: `gameId=${encodeURIComponent(id)}&version=${encodeURIComponent(manifest.version)}`,
      });
    } else {
      await win.loadURL(urlOrPath);
    }

    const sessionStart = Date.now();
    const sessionId = playSessionDatabaseService.startSession(
      id,
      manifest.name,
      manifest.version,
      sessionStart,
    );
    this.startTimes.set(id, {
      start: sessionStart,
      version: manifest.version,
      sessionId,
    });

    launchCompleted = true;
    win.show();
    mainWindow?.webContents.send(IPC.GAME_PROCESS_STARTED, id);

    return win;
  }

  private async spawnGameProcess(
    id: string,
    versionPath: string,
    manifest: GameManifest,
    env: NodeJS.ProcessEnv,
  ): Promise<boolean> {
    const entryPath = path.join(versionPath, manifest.entry);

    if (!fs.existsSync(entryPath)) {
      throw { code: "entryNotFound", params: { entry: manifest.entry } };
    }

    const isWindows = process.platform === "win32";
    const normalizedExtension = path.extname(entryPath).toLowerCase();
    const isBatch =
      normalizedExtension === ".bat" || normalizedExtension === ".cmd";

    const cp = spawn(entryPath, manifest.args || [], {
      cwd: versionPath,
      env: env,
      detached: true,
      stdio: "ignore",
      shell: isWindows && isBatch,
      windowsHide: false,
    });

    let processTracked = false;
    let exitedBeforeTracking = false;
    let earlyExitCode: number | null = null;
    cp.once("exit", (code) => {
      if (!processTracked) {
        exitedBeforeTracking = true;
        earlyExitCode = code;
        return;
      }
      if (this.activeProcesses.get(id) === cp) {
        this.handleProcessExit(id, code);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => {
        cp.off("spawn", handleSpawn);
        reject(error);
      };
      const handleSpawn = () => {
        cp.off("error", handleError);
        resolve();
      };
      cp.once("error", handleError);
      cp.once("spawn", handleSpawn);
    });

    cp.on("error", (error) => {
      this.notifyLaunchFailure(id, "processLaunchFailed", undefined, error.message);
      if (this.activeProcesses.get(id) === cp) {
        this.handleProcessExit(id, null);
      }
    });
    cp.unref();
    this.activeProcesses.set(id, cp);
    const sessionStart = Date.now();
    const sessionId = playSessionDatabaseService.startSession(
      id,
      manifest.name,
      manifest.version,
      sessionStart,
    );
    this.startTimes.set(id, {
      start: sessionStart,
      version: manifest.version,
      sessionId,
    });
    processTracked = true;

    mainWindow?.webContents.send(IPC.GAME_PROCESS_STARTED, id);
    if (exitedBeforeTracking) {
      this.handleProcessExit(id, earlyExitCode);
    }

    return true;
  }

  private handleProcessExit(id: string, _code: number | null) {
    if (this.finishingGames.has(id)) return;
    this.finishingGames.add(id);
    try {
      this.recordPlaytime(id);
      this.notifyRoomGameEnd(id);
      this.notifyRoomReconnectNeeded(id);
      this.cleanup(id);
      mainWindow?.webContents.send(IPC.GAME_PROCESS_ENDED, id);
      import("../../window").then(({ updateTrayMenu }) => updateTrayMenu());
    } finally {
      this.finishingGames.delete(id);
    }
  }

  private notifyRoomReconnectNeeded(gameId: string) {
    // 仅客户端（非房主）在 playing 状态下通知服务器
    if (roomServer.room) return; // 自己是 Host，不需要通知
    if (!roomClient.room || roomClient.room.state !== "playing") return;
    if (roomClient.room.gameId !== gameId) return;
    const playerId = storeService.getSettings().playerId;
    roomClient.send({
      type: "room:player:reconnect-needed",
      payload: { playerId },
    });
  }

  private recordPlaytime(id: string) {
    const startTimeData = this.startTimes.get(id);
    if (startTimeData) {
      const durationMs = Date.now() - startTimeData.start;
      storeService.updatePlaytime(id, startTimeData.version, durationMs);
      playSessionDatabaseService.endSession(
        startTimeData.sessionId,
        startTimeData.start,
      );
    }
    this.startTimes.delete(id);
  }

  private notifyRoomGameEnd(id: string) {
    if (
      roomServer.room &&
      roomServer.room.gameId === id &&
      (roomServer.room.state === "starting" ||
        roomServer.room.state === "playing")
    ) {
      roomServer.room.state = "waiting";
      roomServer.room.reconnectPlayerIds = [];
      roomServer.broadcast({ type: "room:game:end", payload: {} });
      roomServer.broadcastState();
    }
  }

  private cleanup(id: string) {
    const activeConfigPath = this.activeConfigPaths.get(id);
    if (activeConfigPath) {
      GameEnvironment.removeConfig(activeConfigPath);
      this.activeConfigPaths.delete(id);
    }

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

  private cleanupApiOnly(id: string) {
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

  private notifyLaunchFailure(
    id: string,
    code: string,
    params?: Record<string, unknown>,
    detail?: string,
  ) {
    const payload: GameLaunchFailurePayload = {
      id,
      code,
      params,
      detail,
    };
    mainWindow?.webContents.send(IPC.GAME_LAUNCH_FAILED, payload);
  }
}

export const gameManager = new GameManager();
