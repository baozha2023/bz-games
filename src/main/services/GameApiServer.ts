import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { nativeImage } from "electron";
import { findAvailablePort } from "../utils/portUtils";
import { logger } from "../utils/logger";
import type {
  GameApiMessage,
  GameApiRequest,
  GameApiEventAction,
} from "../../shared/types";
import { storeService } from "./StoreService";
import { roomServer } from "./RoomServer";
import { roomClient } from "./RoomClient";
import { mainWindow } from "../window";
import { IPC } from "../../shared/ipc-channels";
import { notificationService } from "./NotificationService";
import { GameLoader } from "./GameLoader";

export class GameApiServer {
  private wss: WebSocketServer | null = null;
  private port = 0;
  private token = "";
  private clients: Set<WebSocket> = new Set();
  public gameId = "";
  public gameVersion = "";
  private onStopCallback: (() => void) | null = null;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;

  setOnStop(callback: () => void) {
    this.onStopCallback = callback;
  }

  async start(): Promise<{ port: number; token: string }> {
    this.port = await findAvailablePort();
    this.token = crypto.randomUUID();

    this.startAutoShutdownTimer();

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port, host: "127.0.0.1" });

        this.wss.on("listening", () => {
          logger.info(`[GameApiServer] Started on ws://127.0.0.1:${this.port}`);
          resolve({ port: this.port, token: this.token });
        });

        this.wss.on("error", (err) => reject(err));
        this.wss.on("connection", (ws) => this.handleConnection(ws));
      } catch (e) {
        reject(e);
      }
    });
  }

  private startAutoShutdownTimer() {
    this.startupTimer = setTimeout(() => {
      if (this.clients.size === 0) {
        logger.info(
          "[GameApiServer] No client connected within 60s, stopping...",
        );
        this.triggerStop();
      }
    }, 60000);
  }

  private handleConnection(ws: WebSocket) {
    logger.info(`[GameApiServer] Local client connected.`);
    this.clients.add(ws);

    this.clearTimers();

    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        logger.warn(`[GameApiServer] Unauthenticated local client timeout.`);
        ws.close();
      }
    }, 30000);

    ws.on("ping", () => ws.pong());

    ws.on("message", (data: string) => {
      try {
        const msg = JSON.parse(data.toString()) as GameApiMessage;

        if (!authenticated) {
          if (this.handleAuth(ws, msg)) {
            authenticated = true;
            clearTimeout(authTimeout);
          }
        } else {
          this.handleRequest(ws, msg as GameApiRequest);
        }
      } catch (e) {
        logger.error(`[GameApiServer] Message parse error`, e);
      }
    });

    ws.on("close", () => {
      logger.info(`[GameApiServer] Local client disconnected.`);
      this.clients.delete(ws);
      if (this.clients.size === 0) {
        this.scheduleShutdown();
      }
    });
  }

  private handleAuth(ws: WebSocket, msg: GameApiMessage): boolean {
    if (msg.type !== "request" || msg.action !== "auth") return false;

    const payload = msg.payload as { token?: string } | undefined;
    if (payload?.token === this.token) {
      const settings = storeService.getSettings();
      const isHost = roomServer.room?.hostId === settings.playerId;

      this.sendResponse(ws, msg.id, "auth", {
        success: true,
        player: { id: settings.playerId, name: settings.playerName, isHost },
      });
      return true;
    } else {
      ws.close();
      return false;
    }
  }

  private async handleRequest(ws: WebSocket, req: GameApiRequest) {
    try {
      switch (req.action) {
        case "game.ready":
          this.handleGameReady(ws, req);
          break;
        case "player.getInfo":
          this.handlePlayerGetInfo(ws, req);
          break;
        case "room.getInfo":
          this.handleRoomGetInfo(ws, req);
          break;
        case "message.send":
        case "message.broadcast":
          this.handleMessage(ws, req);
          break;
        case "game.end":
          this.handleGameEnd(ws, req);
          break;
        case "achievement.list":
          await this.handleAchievementList(ws, req);
          break;
        case "achievement.unlock":
          await this.handleAchievementUnlock(ws, req);
          break;
        case "stats.report":
          this.handleStatsReport(ws, req);
          break;
        default:
          this.sendError(ws, req.id, req.action, "Unknown action");
      }
    } catch (e) {
      this.sendError(ws, req.id, req.action, (e as Error).message);
    }
  }

  private handleGameReady(ws: WebSocket, req: GameApiRequest) {
    this.sendResponse(ws, req.id, "game.ready", { acknowledged: true });
  }

  private handlePlayerGetInfo(ws: WebSocket, req: GameApiRequest) {
    const settings = storeService.getSettings();
    this.sendResponse(ws, req.id, "player.getInfo", {
      id: settings.playerId,
      name: settings.playerName,
    });
  }

  private handleRoomGetInfo(ws: WebSocket, req: GameApiRequest) {
    const settings = storeService.getSettings();
    const isHost = roomServer.room?.hostId === settings.playerId;
    const room = isHost ? roomServer.room : roomClient.room;
    this.sendResponse(ws, req.id, "room.getInfo", room);
  }

  private handleMessage(ws: WebSocket, req: GameApiRequest) {
    const settings = storeService.getSettings();
    const isHost = roomServer.room?.hostId === settings.playerId;
    const relayType =
      req.action === "message.broadcast"
        ? "game:broadcast:relay"
        : "game:message:relay";
    const payload = req.payload;

    if (isHost) {
      roomServer.broadcast({ type: relayType, payload });
    } else {
      roomClient.send({ type: relayType, payload });
    }
    this.sendResponse(ws, req.id, req.action, { success: true });
  }

  private handleGameEnd(ws: WebSocket, req: GameApiRequest) {
    this.sendResponse(ws, req.id, "game.end", { success: true });
  }

  private async handleAchievementList(ws: WebSocket, req: GameApiRequest) {
    const manifest = await GameLoader.getManifest(
      this.gameId,
      this.gameVersion,
    );
    const achievements = manifest?.achievements || [];
    const games = storeService.getGames();
    const game = games.find((g) => g.id === this.gameId);

    const gameVersion = game?.versions.find(
      (v) => v.version === this.gameVersion,
    );
    const unlocked = gameVersion?.unlockedAchievements || [];

    const result = achievements.map((a) => {
      const u = unlocked.find((ua) => ua.id === a.id);
      return {
        ...a,
        unlocked: !!u,
        unlockedAt: u?.unlockedAt,
      };
    });

    this.sendResponse(ws, req.id, "achievement.list", result);
  }

  private async handleAchievementUnlock(ws: WebSocket, req: GameApiRequest) {
    const { achievementId, playerId } = req.payload as {
      achievementId: string;
      playerId?: string;
    };
    const currentSettings = storeService.getSettings();

    if (playerId && playerId !== currentSettings.playerId) {
      this.sendResponse(ws, req.id, "achievement.unlock", {
        success: false,
        reason: "Player mismatch",
      });
      return;
    }

    const unlocked = storeService.unlockAchievement(
      this.gameId,
      this.gameVersion,
      achievementId,
    );
    if (unlocked) {
      mainWindow?.webContents.send(IPC.GAME_UNLOCK_ACHIEVEMENT, {
        gameId: this.gameId,
        version: this.gameVersion,
        achievementId,
      });
      this.showAchievementNotification(achievementId);
    }

    this.sendResponse(ws, req.id, "achievement.unlock", {
      success: true,
      new: unlocked,
    });
  }

  private handleStatsReport(ws: WebSocket, req: GameApiRequest) {
    const stats = req.payload as Record<string, number>;
    if (stats && typeof stats === "object") {
      storeService.updateGameStats(this.gameId, this.gameVersion, stats);
      this.sendResponse(ws, req.id, "stats.report", { success: true });
    } else {
      this.sendError(ws, req.id, "stats.report", "Invalid payload");
    }
  }

  private async showAchievementNotification(achievementId: string) {
    try {
      const manifest = await GameLoader.getManifest(this.gameId);
      if (manifest) {
        const achievement = manifest.achievements?.find(
          (a) => a.id === achievementId,
        );
        if (achievement) {
          let iconDataUrl = "";
          if (manifest.icon) {
            const versionPath = await GameLoader.getVersionPath(this.gameId);
            if (versionPath) {
              const iconPath = path.join(versionPath, manifest.icon);
              if (fs.existsSync(iconPath)) {
                iconDataUrl = nativeImage.createFromPath(iconPath).toDataURL();
              }
            }
          }

          notificationService.show(
            achievement.title,
            achievement.description,
            manifest.name,
            iconDataUrl,
          );
        }
      }
    } catch (e) {
      logger.error("[GameApiServer] Failed to show notification", e);
    }
  }

  private sendResponse(
    ws: WebSocket,
    id: string,
    action: string,
    payload: any,
  ) {
    ws.send(JSON.stringify({ id, type: "response", action, payload }));
  }

  private sendError(ws: WebSocket, id: string, action: string, error: string) {
    ws.send(JSON.stringify({ id, type: "response", action, error }));
  }

  private scheduleShutdown() {
    logger.info(
      `[GameApiServer] All clients disconnected. Starting shutdown timer (5s)...`,
    );
    this.shutdownTimer = setTimeout(() => {
      this.triggerStop();
    }, 5000);
  }

  private clearTimers() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
  }

  private triggerStop() {
    this.onStopCallback?.();
  }

  stop() {
    this.clearTimers();
    this.clients.forEach((c) => c.close());
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  sendEvent(action: GameApiEventAction, payload: any) {
    const msg = JSON.stringify({
      id: crypto.randomUUID(),
      type: "event",
      action,
      payload,
    });
    this.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(msg);
      }
    });
  }
}
