import { ChildProcess, spawn } from "child_process";
import { BrowserWindow, screen } from "electron";
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
import { logger } from "../../utils/logger";
import {
  applyWebWindowStartupState,
  resolveWebWindowStartupOptions,
} from "./WebWindowStartup";
import { processTreeService } from "./ProcessTreeService";
import { migrationActivityGuard } from "../system/MigrationActivityGuard";

type GameRuntimeKind = "native" | "web";

interface GameRuntime {
  id: string;
  kind: GameRuntimeKind;
  pid: number;
  process?: ChildProcess;
  window?: BrowserWindow;
  knownPids: Set<number>;
  rootExited: boolean;
  monitorTimer?: NodeJS.Timeout;
  monitorInFlight: boolean;
  treeQueryFailures: number;
  treeMonitoringDegraded: boolean;
}

const PROCESS_TREE_POLL_INTERVAL_MS = 1_000;

class GameManager {
  private activeRuntimes: Map<string, GameRuntime> = new Map();
  private activeServers: Map<string, Server> = new Map();
  private activeConfigPaths: Map<string, string> = new Map();
  private gameApiServers: Map<string, GameApiServer> = new Map();
  private launchingGames: Set<string> = new Set();
  private finishingGames: Set<string> = new Set();
  private shuttingDownForUninstall = false;
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
    if (
      migrationActivityGuard.isExporting() ||
      this.shuttingDownForUninstall ||
      this.isGameRunning(id) ||
      this.launchingGames.has(id)
    ) {
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
        return this.launchRemoteWebGame(
          id,
          versionPath,
          manifest,
          manifest.windowedFullscreen === true,
        );
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
        return this.launchServeGame(
          id,
          versionPath,
          manifest,
          manifest.windowedFullscreen === true,
        );
      } else if (entryMode === "html") {
        this.writeWebGameConfig(
          id,
          versionPath,
          manifest,
          port,
          token,
          settings,
        );
        return this.launchWebGame(
          id,
          versionPath,
          manifest,
          manifest.windowedFullscreen === true,
        );
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
      this.cleanup(id, true);
      return false;
    } finally {
      this.launchingGames.delete(id);
    }
  }

  stop(id: string): void {
    if (this.isGameRunning(id) || this.startTimes.has(id)) {
      void this.stopRuntime(id);
    } else {
      this.cleanup(id);
    }
  }

  isRunning(id: string): boolean {
    return this.isGameRunning(id);
  }

  async shutdownForUninstall(): Promise<void> {
    this.shuttingDownForUninstall = true;
    const launchDeadline = Date.now() + 5000;
    while (this.launchingGames.size > 0 && Date.now() < launchDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.launchingGames.size > 0) {
      throw new Error("game_shutdown_timeout");
    }

    const gameIds = new Set([
      ...this.activeRuntimes.keys(),
      ...this.activeServers.keys(),
      ...this.gameApiServers.keys(),
      ...this.startTimes.keys(),
    ]);

    await Promise.all(
      Array.from(gameIds).map((gameId) => this.stopRuntime(gameId)),
    );
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
    const runtime = this.activeRuntimes.get(id);
    if (!runtime) return false;
    if (runtime.kind === "web") {
      return !!runtime.window && !runtime.window.isDestroyed();
    }
    return true;
  }

  getRunningGameIds(): string[] {
    return Array.from(this.activeRuntimes.keys()).filter((id) =>
      this.isGameRunning(id),
    );
  }

  hasActiveOrLaunchingGames(): boolean {
    return this.launchingGames.size > 0 || this.getRunningGameIds().length > 0;
  }

  private startNativeRuntimeMonitor(id: string): void {
    const runtime = this.activeRuntimes.get(id);
    if (!runtime || runtime.kind !== "native") return;

    runtime.monitorTimer = setInterval(() => {
      void this.refreshNativeRuntime(id);
    }, PROCESS_TREE_POLL_INTERVAL_MS);
    runtime.monitorTimer.unref?.();
    void this.refreshNativeRuntime(id);
  }

  private async refreshNativeRuntime(
    id: string,
    exitCode: number | null = null,
  ): Promise<void> {
    const runtime = this.activeRuntimes.get(id);
    if (!runtime || runtime.kind !== "native" || runtime.monitorInFlight) {
      return;
    }

    runtime.monitorInFlight = true;
    try {
      if (runtime.treeMonitoringDegraded) {
        if (runtime.rootExited) this.handleProcessExit(id, exitCode);
        return;
      }

      if (!runtime.rootExited) {
        const tree = await processTreeService.listTree(runtime.pid);
        for (const pid of tree) runtime.knownPids.add(pid);
        runtime.treeQueryFailures = 0;
        return;
      }

      const alive = await processTreeService.isTreeAlive(
        runtime.pid,
        runtime.knownPids,
      );
      runtime.treeQueryFailures = 0;
      if (!alive) {
        this.handleProcessExit(id, exitCode);
      }
    } catch (error) {
      runtime.treeQueryFailures += 1;
      logger.warn(
        `[GameManager] Failed to inspect process tree for ${id}`,
        error,
      );
      if (runtime.treeQueryFailures >= 3) {
        runtime.treeMonitoringDegraded = true;
        logger.warn(
          `[GameManager] Falling back to root process tracking for ${id}`,
        );
        if (runtime.rootExited) this.handleProcessExit(id, exitCode);
      }
    } finally {
      runtime.monitorInFlight = false;
    }
  }

  private async stopRuntime(id: string): Promise<void> {
    const runtime = this.activeRuntimes.get(id);
    if (!runtime) {
      if (this.startTimes.has(id)) this.handleProcessExit(id, null);
      else this.cleanup(id);
      return;
    }

    if (runtime.kind === "web") {
      this.handleProcessExit(id, null);
      return;
    }

    await processTreeService.killTree(runtime.pid, runtime.knownPids);
    if (this.activeRuntimes.has(id) || this.startTimes.has(id)) {
      this.handleProcessExit(id, null);
    }
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
    windowedFullscreen: boolean,
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
    await this.createGameWindow(
      id,
      manifest,
      versionPath,
      url,
      false,
      windowedFullscreen,
    );
    return true;
  }

  private async launchWebGame(
    id: string,
    versionPath: string,
    manifest: GameManifest,
    windowedFullscreen: boolean,
  ): Promise<boolean> {
    const entryPath = path.join(versionPath, manifest.entry);

    if (!fs.existsSync(entryPath)) {
      throw { code: "entryNotFound", params: { entry: manifest.entry } };
    }

    await this.createGameWindow(
      id,
      manifest,
      versionPath,
      entryPath,
      true,
      windowedFullscreen,
    );
    return true;
  }

  private async launchRemoteWebGame(
    id: string,
    versionPath: string,
    manifest: GameManifest,
    windowedFullscreen: boolean,
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
      windowedFullscreen,
    );
    return true;
  }

  private async createGameWindow(
    id: string,
    manifest: GameManifest,
    versionPath: string,
    urlOrPath: string,
    isFile: boolean,
    windowedFullscreen: boolean,
  ): Promise<BrowserWindow> {
    const startupOptions = resolveWebWindowStartupOptions(
      windowedFullscreen,
      windowedFullscreen ? this.getWebWindowWorkArea() : undefined,
    );
    const win = new BrowserWindow({
      width: startupOptions.width,
      height: startupOptions.height,
      ...(startupOptions.x !== undefined && startupOptions.y !== undefined
        ? { x: startupOptions.x, y: startupOptions.y }
        : {}),
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

    const rendererPid = win.webContents.getOSProcessId();
    const runtime: GameRuntime = {
      id,
      kind: "web",
      pid: rendererPid,
      window: win,
      knownPids: new Set(rendererPid > 0 ? [rendererPid] : []),
      rootExited: false,
      monitorInFlight: false,
      treeQueryFailures: 0,
      treeMonitoringDegraded: false,
    };
    this.activeRuntimes.set(id, runtime);
    let launchCompleted = false;
    win.on("closed", () => {
      gameWindowIdentityRegistry.unregister(webContentsId);
      if (launchCompleted && this.activeRuntimes.get(id)?.window === win) {
        this.handleProcessExit(id, 0);
      } else if (this.activeRuntimes.get(id)?.window === win) {
        this.activeRuntimes.delete(id);
      }
    });

    win.webContents.on("render-process-gone", (_event, details) => {
      if (this.activeRuntimes.get(id)?.window !== win) return;
      if (!launchCompleted) {
        this.activeRuntimes.delete(id);
        return;
      }
      logger.warn(`[GameManager] Web game renderer exited for ${id}`, {
        reason: details.reason,
        exitCode: details.exitCode,
      });
      this.handleProcessExit(id, details.exitCode);
    });

    if (isFile) {
      await win.loadFile(urlOrPath, {
        search: `gameId=${encodeURIComponent(id)}&version=${encodeURIComponent(manifest.version)}`,
      });
    } else {
      await win.loadURL(urlOrPath);
    }

    applyWebWindowStartupState(win, startupOptions);

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

  private getWebWindowWorkArea() {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        return screen.getDisplayMatching(mainWindow.getBounds()).workArea;
      }
      return screen.getPrimaryDisplay().workArea;
    } catch {
      return undefined;
    }
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
      const runtime = this.activeRuntimes.get(id);
      if (runtime?.process === cp) {
        runtime.rootExited = true;
        void this.refreshNativeRuntime(id, code);
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
      this.notifyLaunchFailure(
        id,
        "processLaunchFailed",
        undefined,
        error.message,
      );
      const runtime = this.activeRuntimes.get(id);
      if (runtime?.process === cp) {
        runtime.rootExited = true;
        void this.refreshNativeRuntime(id, null);
      }
    });
    cp.unref();
    const rootPid = cp.pid;
    if (!rootPid || rootPid <= 0) {
      throw new Error("Failed to resolve game process id");
    }
    const runtime: GameRuntime = {
      id,
      kind: "native",
      pid: rootPid,
      process: cp,
      knownPids: new Set([rootPid]),
      rootExited: exitedBeforeTracking,
      monitorInFlight: false,
      treeQueryFailures: 0,
      treeMonitoringDegraded: false,
    };
    this.activeRuntimes.set(id, runtime);
    this.startNativeRuntimeMonitor(id);
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
      void this.refreshNativeRuntime(id, earlyExitCode);
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
      void storeService
        .updatePlaytime(id, startTimeData.version, durationMs)
        .catch((error) =>
          logger.error("Failed to update playtime rewards", error),
        );
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

  private cleanup(id: string, terminateRuntime = false) {
    const activeConfigPath = this.activeConfigPaths.get(id);
    if (activeConfigPath) {
      GameEnvironment.removeConfig(activeConfigPath);
      this.activeConfigPaths.delete(id);
    }

    const runtime = this.activeRuntimes.get(id);
    if (runtime?.monitorTimer) {
      clearInterval(runtime.monitorTimer);
      runtime.monitorTimer = undefined;
    }
    this.activeRuntimes.delete(id);

    if (runtime?.kind === "native" && terminateRuntime) {
      void processTreeService.killTree(runtime.pid, runtime.knownPids);
    }

    const win = runtime?.window;
    if (win) {
      if (!win.isDestroyed()) {
        win.close();
      }
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
