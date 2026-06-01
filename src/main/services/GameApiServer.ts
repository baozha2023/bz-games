import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { nativeImage } from "electron";
import { findAvailablePort } from "../utils/portUtils";
import type {
  GameApiMessage,
  GameApiRequest,
  GameApiEventAction,
  GameRelayPayload,
  GameApiCapabilities,
  GameApiError,
} from "../../shared/types";
import { storeService } from "./StoreService";
import { roomServer } from "./RoomServer";
import { roomClient } from "./RoomClient";
import { mainWindow } from "../window";
import { IPC } from "../../shared/ipc-channels";
import { notificationService } from "./NotificationService";
import { GameLoader } from "./GameLoader";

export class GameApiServer {
  private static readonly MAX_MESSAGE_BYTES = 64 * 1024;
  private static readonly MAX_BATCH_MESSAGES = 32;
  private static readonly CHANNEL_ALL = "*";
  private wss: WebSocketServer | null = null;
  private port = 0;
  private token = "";
  private clients: Set<WebSocket> = new Set();
  public gameId = "";
  public gameVersion = "";
  private onStopCallback: (() => void) | null = null;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private channelSubscriptions: Map<WebSocket, Set<string>> = new Map();

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

        this.wss.on("listening", () => resolve({ port: this.port, token: this.token }));

        this.wss.on("error", (err) => reject(err));
        this.wss.on("connection", (ws) => this.handleConnection(ws));
      } catch (error) {
        reject(error);
      }
    });
  }

  private startAutoShutdownTimer() {
    this.startupTimer = setTimeout(() => {
      if (this.clients.size === 0) {
        this.triggerStop();
      }
    }, 60000);
  }

  private handleConnection(ws: WebSocket) {
    this.clients.add(ws);

    this.clearTimers();

    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close();
      }
    }, 60000);

    ws.on("ping", () => ws.pong());

    ws.on("message", (data: string) => {
      try {
        const rawData = data.toString();
        if (Buffer.byteLength(rawData, "utf8") > GameApiServer.MAX_MESSAGE_BYTES) {
          if (authenticated) {
            this.sendError(ws, "", "message.publish", {
              code: "MESSAGE_TOO_LARGE",
              message: "Message payload is too large",
              detail: { maxMessageBytes: GameApiServer.MAX_MESSAGE_BYTES },
            });
          }
          return;
        }
        const msg = JSON.parse(rawData) as GameApiMessage;

        if (!authenticated) {
          if (this.handleAuth(ws, msg)) {
            authenticated = true;
            clearTimeout(authTimeout);
          }
        } else {
          this.handleRequest(ws, msg as GameApiRequest);
        }
      } catch {
        if (authenticated) {
          this.sendError(ws, "", "message.publish", {
            code: "INVALID_PAYLOAD",
            message: "Invalid message payload",
          });
        }
      }
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      this.channelSubscriptions.delete(ws);
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
        capabilities: this.getCapabilities(),
      });
      this.channelSubscriptions.set(ws, new Set([GameApiServer.CHANNEL_ALL]));
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
        case "message.publish":
        case "message.batch":
          this.handleMessage(ws, req);
          break;
        case "message.subscribe":
          this.handleSubscribe(ws, req);
          break;
        case "message.unsubscribe":
          this.handleUnsubscribe(ws, req);
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
          await this.handleStatsReport(ws, req);
          break;
        default:
          this.sendError(ws, req.id, req.action, {
            code: "UNKNOWN_ACTION",
            message: "Unknown action",
            detail: { action: req.action },
          });
      }
    } catch (error) {
      this.sendError(ws, req.id, req.action, {
        code: "INVALID_PAYLOAD",
        message: (error as Error).message,
      });
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

  private getCapabilities(): GameApiCapabilities {
    return {
      protocolVersion: 2,
      protocolName: "bz-game-api-v2",
      maxMessageBytes: GameApiServer.MAX_MESSAGE_BYTES,
      maxBatchMessages: GameApiServer.MAX_BATCH_MESSAGES,
      supportsPublish: true,
      supportsBatch: true,
      supportsAck: true,
      supportsSubscribe: true,
      supportsDelivery: true,
      supportsBinaryContentType: true,
    };
  }

  private handleMessage(ws: WebSocket, req: GameApiRequest) {
    const settings = storeService.getSettings();
    const isHost = roomServer.room?.hostId === settings.playerId;
    const room = isHost ? roomServer.room : roomClient.room;
    if (!room) {
      this.sendError(ws, req.id, req.action, {
        code: "NOT_IN_ROOM",
        message: "Not in room",
      });
      return;
    }
    if (req.action === "message.batch") {
      this.handleMessageBatch(ws, req, settings.playerId, isHost);
      return;
    }

    const relayType =
      req.action === "message.send" ? "game:message:relay" : "game:broadcast:relay";
    const relayPayload = this.normalizeRelayPayload(
      req.payload,
      settings.playerId,
      req.action === "message.send"
        ? "direct"
        : req.action === "message.publish"
          ? "publish"
          : "broadcast",
    );
    if (req.action === "message.send") {
      const targetPlayerId = this.resolveTargetPlayerId(relayPayload);
      if (!targetPlayerId) {
        this.sendError(
          ws,
          req.id,
          req.action,
          {
            code: "MISSING_TARGET",
            message: "Missing target player id (to/targetPlayerId)",
          },
        );
        return;
      }
      if (targetPlayerId === settings.playerId) {
        this.sendError(ws, req.id, req.action, {
          code: "TARGET_SELF",
          message: "Cannot send to self",
          detail: { targetPlayerId },
        });
        return;
      }
      if (!this.hasPlayer(room, targetPlayerId)) {
        this.sendError(ws, req.id, req.action, {
          code: "TARGET_NOT_FOUND",
          message: "Target player is not in room",
          detail: { targetPlayerId },
        });
        return;
      }
    }

    this.relayMessage(isHost, settings.playerId, relayType, relayPayload);
    this.sendResponse(ws, req.id, req.action, { success: true });
  }

  private handleMessageBatch(
    ws: WebSocket,
    req: GameApiRequest,
    senderId: string,
    isHost: boolean,
  ) {
    const rawPayload =
      req.payload && typeof req.payload === "object"
        ? (req.payload as Record<string, unknown>)
        : {};
    const messages = Array.isArray(rawPayload.messages) ? rawPayload.messages : [];
    if (messages.length === 0) {
      this.sendError(ws, req.id, req.action, {
        code: "EMPTY_BATCH",
        message: "Missing messages",
      });
      return;
    }
    if (messages.length > GameApiServer.MAX_BATCH_MESSAGES) {
      this.sendError(ws, req.id, req.action, {
        code: "BATCH_TOO_LARGE",
        message: "Too many messages in batch",
        detail: { maxBatchMessages: GameApiServer.MAX_BATCH_MESSAGES },
      });
      return;
    }

    const relayPayload = this.normalizeRelayPayload(
      {
        ...rawPayload,
        messages: messages.map((message) =>
          this.normalizeRelayPayload(message, senderId, "batch"),
        ),
      },
      senderId,
      "batch",
    );
    this.relayMessage(isHost, senderId, "game:broadcast:relay", relayPayload);
    this.sendResponse(ws, req.id, req.action, { success: true });
  }

  private normalizeRelayPayload(
    payload: unknown,
    senderId: string,
    mode: GameRelayPayload["mode"],
  ): GameRelayPayload {
    const rawPayload =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    const messageId =
      typeof rawPayload.messageId === "string"
        ? rawPayload.messageId
        : crypto.randomUUID();
    const sentAt =
      typeof rawPayload.sentAt === "number" ? rawPayload.sentAt : Date.now();
    const channel =
      typeof rawPayload.channel === "string" && rawPayload.channel.length > 0
        ? rawPayload.channel
        : "default";
    const seq = typeof rawPayload.seq === "number" ? rawPayload.seq : undefined;
    const delivery = this.normalizeDelivery(rawPayload.delivery);
    const contentType = this.normalizeContentType(rawPayload.contentType, rawPayload.data);
    const normalized: GameRelayPayload = {
      ...rawPayload,
      senderId,
      messageId,
      sentAt,
      channel,
      seq,
      mode,
      delivery,
      contentType,
    };
    if (mode !== "batch") {
      delete normalized.messages;
    }
    return normalized;
  }

  private normalizeDelivery(delivery: unknown) {
    if (
      delivery === "reliable" ||
      delivery === "ordered" ||
      delivery === "latest" ||
      delivery === "unreliable"
    ) {
      return delivery;
    }
    return "reliable";
  }

  private normalizeContentType(contentType: unknown, data: unknown) {
    if (
      contentType === "text" ||
      contentType === "audio" ||
      contentType === "binary" ||
      contentType === "json"
    ) {
      return contentType;
    }
    if (typeof data === "string" && this.looksLikeBase64(data)) return "binary";
    return "json";
  }

  private looksLikeBase64(value: string) {
    return value.length > 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  private relayMessage(
    isHost: boolean,
    senderId: string,
    relayType: "game:message:relay" | "game:broadcast:relay",
    relayPayload: GameRelayPayload,
  ) {
    if (isHost) {
      if (relayType === "game:broadcast:relay") {
        roomServer.relayBroadcastFromLocal(senderId, relayPayload);
      } else {
        roomServer.relayMessageFromLocal(senderId, relayPayload);
      }
    } else {
      roomClient.send({ type: relayType, payload: relayPayload });
    }
  }

  private hasPlayer(room: { players?: Array<{ id: string }> }, playerId: string) {
    return Array.isArray(room.players) && room.players.some((player) => player.id === playerId);
  }

  private handleSubscribe(ws: WebSocket, req: GameApiRequest) {
    const channels = this.getChannelsFromPayload(req.payload);
    if (!channels.length) {
      this.sendError(ws, req.id, req.action, {
        code: "INVALID_PAYLOAD",
        message: "Missing channels",
      });
      return;
    }
    const current = this.channelSubscriptions.get(ws) || new Set<string>();
    channels.forEach((channel) => current.add(channel));
    this.channelSubscriptions.set(ws, current);
    this.sendResponse(ws, req.id, req.action, { success: true, channels: Array.from(current) });
  }

  private handleUnsubscribe(ws: WebSocket, req: GameApiRequest) {
    const channels = this.getChannelsFromPayload(req.payload);
    const current = this.channelSubscriptions.get(ws) || new Set<string>();
    channels.forEach((channel) => current.delete(channel));
    if (current.size === 0) current.add(GameApiServer.CHANNEL_ALL);
    this.channelSubscriptions.set(ws, current);
    this.sendResponse(ws, req.id, req.action, { success: true, channels: Array.from(current) });
  }

  private getChannelsFromPayload(payload: unknown) {
    const rawPayload =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const channels = Array.isArray(rawPayload.channels)
      ? rawPayload.channels
      : [rawPayload.channel];
    return channels.filter(
      (channel): channel is string => typeof channel === "string" && channel.length > 0,
    );
  }

  private resolveTargetPlayerId(payload: Record<string, unknown>) {
    const to = payload.to;
    const targetPlayerId = payload.targetPlayerId;
    if (typeof to === "string" && to.length > 0) return to;
    if (typeof targetPlayerId === "string" && targetPlayerId.length > 0) {
      return targetPlayerId;
    }
    return undefined;
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

  private async handleStatsReport(ws: WebSocket, req: GameApiRequest) {
    const stats = req.payload as Record<string, number>;
    if (stats && typeof stats === "object") {
      const manifest = await GameLoader.getManifest(
        this.gameId,
        this.gameVersion,
      );
      const modes: Record<string, "increment" | "full"> = {};
      if (manifest?.statistics) {
        manifest.statistics.forEach((stat) => {
          if (typeof stat === "string") return;
          const key = Object.keys(stat)[0];
          const value = (stat as any)[key];
          if (value && typeof value === "object" && value.mode) {
            modes[key] = value.mode === "full" ? "full" : "increment";
          }
        });
      }
      storeService.updateGameStats(this.gameId, this.gameVersion, stats, modes);
      this.sendResponse(ws, req.id, "stats.report", { success: true });
    } else {
      this.sendError(ws, req.id, "stats.report", {
        code: "INVALID_PAYLOAD",
        message: "Invalid payload",
      });
    }
  }

  private async showAchievementNotification(achievementId: string) {
    try {
      const manifest = await GameLoader.getManifest(this.gameId, this.gameVersion);
      if (manifest) {
        const achievement = manifest.achievements?.find(
          (a) => a.id === achievementId,
        );
        if (achievement) {
          let iconDataUrl = "";
          if (manifest.icon) {
            const versionPath = await GameLoader.getVersionPath(
              this.gameId,
              this.gameVersion,
            );
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
    } catch {}
  }

  private sendResponse(
    ws: WebSocket,
    id: string,
    action: string,
    payload: any,
  ) {
    ws.send(JSON.stringify({ id, type: "response", action, payload }));
  }

  private sendError(ws: WebSocket, id: string, action: string, error: string | GameApiError) {
    ws.send(JSON.stringify({ id, type: "response", action, error }));
  }

  private scheduleShutdown() {
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
      if (
        c.readyState === WebSocket.OPEN &&
        (action !== "event.message" || this.shouldDeliverEventToClient(c, payload as GameRelayPayload))
      ) {
        c.send(msg);
      }
    });
  }

  sendMessageAck(payload: { messageId: string; senderId: string; to: string; sentAt: number }) {
    this.sendEvent("event.messageAck", payload);
  }

  private shouldDeliverEventToClient(ws: WebSocket, payload: GameRelayPayload) {
    if (!payload.channel) return true;
    const channels = this.channelSubscriptions.get(ws);
    if (!channels || channels.size === 0) return true;
    return channels.has(GameApiServer.CHANNEL_ALL) || channels.has(payload.channel);
  }
}
