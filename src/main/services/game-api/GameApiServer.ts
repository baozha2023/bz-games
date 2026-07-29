import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { nativeImage } from "electron";
import type {
  GameApiMessage,
  GameApiRequest,
  GameApiEventAction,
  GameRelayPayload,
  GameApiCapabilities,
  GameApiError,
  GameReportPayload,
  GameReportScoreboardConfig,
  GameReportScoreboardData,
  GameReportStructuredPayload,
  ChatPayload,
} from "../../../shared/types";
import { GameApiErrorCode } from "../../../shared/types";
import { storeService } from "../storage/StoreService";
import { roomServer } from "../room/RoomServer";
import { roomClient } from "../room/RoomClient";
import { mainWindow } from "../../window";
import { IPC } from "../../../shared/ipc-channels";
import { notificationService } from "../system/NotificationService";
import { GameLoader } from "../game/GameLoader";
import { encodeBinaryEnvelope } from "../../../shared/binary-protocol";
import { V1GameApiProtocol } from "./V1GameApiProtocol";
import { V2GameApiProtocol } from "./V2GameApiProtocol";
import { RoomConstants } from "../../../shared/RoomConstants";
import type { GameManifest } from "../../../shared/game-manifest";
import { logger } from "../../utils/logger";

type BinaryRelayPayload = GameRelayPayload & { binaryData?: Buffer };
type GameApiProtocolVersion = 1 | 2;

type GameStatDefinition = NonNullable<GameManifest["statistics"]>[number];

function resolveStatName(stat: GameStatDefinition, statId: string): string {
  if (typeof stat === "string") return stat === statId ? stat : "";
  if (!stat || typeof stat !== "object") return "";
  const entries = Object.entries(stat as Record<string, unknown>);
  const match = entries.find(([key]) => key === statId);
  if (!match) return "";
  const value = match[1];
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const label = (value as { label?: unknown }).label;
    if (typeof label === "string" && label.trim()) return label;
  }
  return statId;
}

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
  private channelSubscriptions: Map<WebSocket, Set<string>> = new Map();
  private protocolVersions: Map<WebSocket, GameApiProtocolVersion> = new Map();
  private readonly v1Protocol = new V1GameApiProtocol(this);
  private readonly v2Protocol = new V2GameApiProtocol(this);

  setOnStop(callback: () => void) {
    this.onStopCallback = callback;
  }

  async start(): Promise<{ port: number; token: string }> {
    this.token = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });

        this.wss.once("listening", () => {
          const address = this.wss?.address();
          if (!address || typeof address === "string") {
            this.wss?.close();
            this.wss = null;
            reject(new Error("Failed to resolve the Game API listen port"));
            return;
          }
          this.port = address.port;
          this.startAutoShutdownTimer();
          resolve({ port: this.port, token: this.token });
        });

        this.wss.once("error", (err) => reject(err));
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
    }, RoomConstants.GAME_API_STARTUP_TIMEOUT_MS);
  }

  private handleConnection(ws: WebSocket) {
    this.clients.add(ws);

    this.clearTimers();

    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close();
      }
    }, RoomConstants.GAME_API_AUTH_TIMEOUT_MS);

    ws.on("ping", () => ws.pong());

    ws.on("message", (data, isBinary) => {
      try {
        if (isBinary) {
          if (!authenticated) return;
          this.handleBinaryRequest(ws, Buffer.from(data as Buffer));
          return;
        }
        const rawData = data.toString();
        if (
          Buffer.byteLength(rawData, "utf8") >
          RoomConstants.GAME_API_MAX_MESSAGE_BYTES
        ) {
          if (authenticated) {
            this.sendError(ws, "", "message.publish", {
              code: GameApiErrorCode.MessageTooLarge,
              message: "Message payload is too large",
              detail: {
                maxMessageBytes: RoomConstants.GAME_API_MAX_MESSAGE_BYTES,
              },
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
            code: GameApiErrorCode.InvalidPayload,
            message: "Invalid message payload",
          });
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      this.clients.delete(ws);
      this.channelSubscriptions.delete(ws);
      this.protocolVersions.delete(ws);
      if (this.clients.size === 0) {
        this.scheduleShutdown();
      }
    });
  }

  private handleAuth(ws: WebSocket, msg: GameApiMessage): boolean {
    if (msg.type !== "request" || msg.action !== "auth") return false;

    const payload = msg.payload as
      | { token?: string; protocolVersion?: number }
      | undefined;
    if (payload?.token === this.token) {
      const settings = storeService.getSettings();
      const isHost = roomServer.room?.hostId === settings.playerId;
      const protocolVersion: GameApiProtocolVersion =
        payload.protocolVersion === 2 ? 2 : 1;

      this.sendResponse(ws, msg.id, "auth", {
        success: true,
        player: { id: settings.playerId, name: settings.playerName, isHost },
        protocolVersion,
        capabilities:
          protocolVersion === 2 ? this.getCapabilities() : undefined,
      });
      this.channelSubscriptions.set(
        ws,
        new Set([RoomConstants.GAME_API_CHANNEL_ALL]),
      );
      this.protocolVersions.set(ws, protocolVersion);
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
        case "message.subscribe":
        case "message.unsubscribe":
          this.getProtocol(ws).handleRequest(ws, req);
          break;
        case "game.end":
          this.handleGameEnd(ws, req);
          break;
        case "game.report":
          this.handleGameReport(ws, req);
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
            code: GameApiErrorCode.UnknownAction,
            message: "Unknown action",
            detail: { action: req.action },
          });
      }
    } catch (error) {
      this.sendError(ws, req.id, req.action, {
        code: GameApiErrorCode.InvalidPayload,
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
      maxMessageBytes: RoomConstants.GAME_API_MAX_MESSAGE_BYTES,
      maxBinaryBytes: RoomConstants.GAME_API_MAX_BINARY_BYTES,
      maxBatchMessages: RoomConstants.GAME_API_MAX_BATCH_MESSAGES,
      supportsPublish: true,
      supportsBatch: true,
      supportsAck: true,
      supportsSubscribe: true,
      supportsDelivery: true,
      supportsBinaryContentType: true,
      supportsBinaryFrames: true,
    };
  }

  private getProtocolVersion(ws: WebSocket): GameApiProtocolVersion {
    return this.protocolVersions.get(ws) || 1;
  }

  private getProtocol(ws: WebSocket): V1GameApiProtocol | V2GameApiProtocol {
    return this.getProtocolVersion(ws) === 2
      ? this.v2Protocol
      : this.v1Protocol;
  }

  private handleBinaryRequest(ws: WebSocket, data: Buffer) {
    if (this.getProtocolVersion(ws) !== 2) {
      this.sendError(ws, "", "message.publish", {
        code: GameApiErrorCode.InvalidPayload,
        message: "Binary frames require protocolVersion: 2 in auth payload",
      });
      return;
    }
    this.v2Protocol.handleBinaryRequest(ws, data);
  }

  public getClientChannels(ws: WebSocket) {
    return this.channelSubscriptions.get(ws) || new Set<string>();
  }

  public setClientChannels(ws: WebSocket, channels: Set<string>) {
    this.channelSubscriptions.set(ws, channels);
  }

  private handleGameEnd(ws: WebSocket, req: GameApiRequest) {
    this.sendResponse(ws, req.id, "game.end", { success: true });
  }

  private handleGameReport(ws: WebSocket, req: GameApiRequest) {
    const payload = req.payload as GameReportPayload | undefined;
    if (!payload) {
      this.sendError(ws, req.id, "game.report", {
        code: GameApiErrorCode.InvalidPayload,
        message: "Missing payload",
      });
      return;
    }

    // Validate custom mode — prevent oversized HTML/CSS
    if (payload.mode === "custom") {
      const htmlLen = payload.html?.length ?? 0;
      const cssLen = payload.css?.length ?? 0;
      if (htmlLen + cssLen > RoomConstants.GAME_REPORT_HTML_MAX_BYTES) {
        this.sendError(ws, req.id, "game.report", {
          code: GameApiErrorCode.MessageTooLarge,
          message: `Custom report html+css must be under ${RoomConstants.GAME_REPORT_HTML_MAX_BYTES / 1024}KB`,
        });
        return;
      }
    }

    const messagePayload = this.withReportPlayerSnapshot(payload);

    // Reply to game
    this.sendResponse(ws, req.id, "game.report", { success: true });

    // Build system chat message
    const settings = storeService.getSettings();
    const chatPayload: ChatPayload = {
      id: crypto.randomUUID(),
      senderId: "system",
      senderName: "System",
      content: JSON.stringify(messagePayload),
      contentType: "game_report",
      timestamp: Date.now(),
      isSystem: true,
    };

    const roomMsg = { type: "room:chat" as const, payload: chatPayload };

    // Route through room infrastructure
    const isHost = roomServer.room?.hostId === settings.playerId;
    if (isHost) {
      // Host: broadcast to all clients (excluding self), then deliver to own renderer directly
      const hostSocket = roomServer.getSocketByPlayerId(settings.playerId);
      roomServer.broadcast(roomMsg, hostSocket);
      mainWindow?.webContents.send(IPC.ROOM_EVENT, roomMsg);
    } else if (roomClient.room) {
      // Client: send via room client — message will be relayed back by server and delivered to renderer
      roomClient.send(roomMsg);
    }
  }

  private withReportPlayerSnapshot(
    payload: GameReportPayload,
  ): GameReportPayload {
    if (payload.mode !== "structured") return payload;
    if (payload.data.layout !== "scoreboard") return payload;
    const room = roomServer.room || roomClient.room;
    if (!room) return payload;
    const structuredPayload = payload as GameReportStructuredPayload;
    const data = structuredPayload.data as GameReportScoreboardData;
    const config = structuredPayload.config as
      | GameReportScoreboardConfig
      | undefined;
    const playerColumns = (config?.columns || []).filter(
      (column) => column.render === "avatar" || column.render === "playerName",
    );
    if (!playerColumns.length) return payload;
    const referencedPlayerIds = new Set<string>();
    for (const row of data.rows) {
      for (const column of playerColumns) {
        const value = row[column.key];
        if (typeof value === "string" && value) referencedPlayerIds.add(value);
      }
    }
    if (!referencedPlayerIds.size) return payload;
    return {
      ...structuredPayload,
      playerSnapshot: room.players
        .filter((player) => referencedPlayerIds.has(player.id))
        .map((player) => ({
          id: player.id,
          name: player.name,
          avatar: player.avatar,
          avatarFrame: player.avatarFrame,
          nicknameStyle: player.nicknameStyle,
        })),
    };
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
    const manifest = await GameLoader.getManifest(
      this.gameId,
      this.gameVersion,
    );
    const achievement = manifest?.achievements?.find(
      (item) => item.id === achievementId,
    );

    if (playerId && playerId !== currentSettings.playerId) {
      this.sendResponse(ws, req.id, "achievement.unlock", {
        success: false,
        reason: "Player mismatch",
      });
      return;
    }
    if (!achievement) {
      this.sendResponse(ws, req.id, "achievement.unlock", {
        success: false,
        reason: "Achievement is not declared in game.json",
      });
      return;
    }

    const unlocked = await storeService.unlockAchievement(
      this.gameId,
      this.gameVersion,
      achievementId,
      manifest?.name || this.gameId,
      achievement?.title || achievementId,
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
    const stats = req.payload;
    if (stats && typeof stats === "object" && !Array.isArray(stats)) {
      const manifest = await GameLoader.getManifest(
        this.gameId,
        this.gameVersion,
      );
      const modes: Record<string, "increment" | "full"> = {};
      const declaredStatIds = new Set<string>();
      if (manifest?.statistics) {
        manifest.statistics.forEach((stat) => {
          if (typeof stat === "string") {
            declaredStatIds.add(stat);
            return;
          }
          for (const [key, value] of Object.entries(stat)) {
            declaredStatIds.add(key);
            if (value && typeof value === "object" && value.mode) {
              modes[key] = value.mode === "full" ? "full" : "increment";
            }
          }
        });
      }
      const entries = Object.entries(stats as Record<string, unknown>);
      const hasInvalidStat = entries.some(
        ([key, value]) =>
          !declaredStatIds.has(key) ||
          key === "time" ||
          typeof value !== "number" ||
          !Number.isFinite(value),
      );
      if (entries.length === 0 || hasInvalidStat) {
        this.sendError(ws, req.id, "stats.report", {
          code: GameApiErrorCode.InvalidPayload,
          message:
            "Stats must be finite numbers declared in game.json; time is platform-managed",
        });
        return;
      }
      const validatedStats = Object.fromEntries(entries) as Record<
        string,
        number
      >;
      const statNames: Record<string, string> = {};
      for (const statId of Object.keys(validatedStats)) {
        statNames[statId] =
          manifest?.statistics
            ?.map((stat) => resolveStatName(stat, statId))
            .find(Boolean) || statId;
      }
      await storeService.updateGameStats(
        this.gameId,
        this.gameVersion,
        validatedStats,
        modes,
        manifest?.name || this.gameId,
        statNames,
      );
      this.sendResponse(ws, req.id, "stats.report", { success: true });
    } else {
      this.sendError(ws, req.id, "stats.report", {
        code: GameApiErrorCode.InvalidPayload,
        message: "Invalid payload",
      });
    }
  }

  private async showAchievementNotification(achievementId: string) {
    try {
      const manifest = await GameLoader.getManifest(
        this.gameId,
        this.gameVersion,
      );
      if (manifest) {
        const achievement = manifest.achievements?.find(
          (a) => a.id === achievementId,
        );
        if (achievement) {
          let iconDataUrl = "";
          const icon = achievement.icon || manifest.icon;
          if (icon) {
            const versionPath = await GameLoader.getVersionPath(
              this.gameId,
              this.gameVersion,
            );
            if (versionPath) {
              const iconPath = path.join(versionPath, icon);
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
    } catch (error) {
      logger.warn(
        `[GameApiServer] Failed to show achievement notification for ${this.gameId} @ ${this.gameVersion} / ${achievementId}`,
        error,
      );
    }
  }

  public sendResponse(ws: WebSocket, id: string, action: string, payload: any) {
    ws.send(JSON.stringify({ id, type: "response", action, payload }));
  }

  public sendError(
    ws: WebSocket,
    id: string,
    action: string,
    error: string | GameApiError,
  ) {
    ws.send(JSON.stringify({ id, type: "response", action, error }));
  }

  private scheduleShutdown() {
    this.shutdownTimer = setTimeout(() => {
      this.triggerStop();
    }, RoomConstants.GAME_API_SHUTDOWN_DELAY_MS);
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
    this.channelSubscriptions.clear();
    this.protocolVersions.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  sendEvent(action: GameApiEventAction, payload: any) {
    const binaryBody = (payload as BinaryRelayPayload)?.binaryData;
    const event = {
      id: crypto.randomUUID(),
      type: "event",
      action,
      payload: this.stripBinaryData(payload),
    };
    const jsonMsg = JSON.stringify(event);
    this.clients.forEach((c) => {
      if (
        c.readyState === WebSocket.OPEN &&
        (action !== "event.message" ||
          this.shouldDeliverEventToClient(c, payload as GameRelayPayload))
      ) {
        const msg =
          binaryBody && this.getProtocolVersion(c) === 2
            ? encodeBinaryEnvelope(event, binaryBody)
            : jsonMsg;
        c.send(msg);
      }
    });
  }

  sendMessageAck(payload: {
    messageId: string;
    senderId: string;
    to: string;
    sentAt: number;
  }) {
    this.sendEvent("event.messageAck", payload);
  }

  private shouldDeliverEventToClient(ws: WebSocket, payload: GameRelayPayload) {
    if (!payload.channel) return true;
    const channels = this.channelSubscriptions.get(ws);
    if (!channels || channels.size === 0) return true;
    return (
      channels.has(RoomConstants.GAME_API_CHANNEL_ALL) ||
      channels.has(payload.channel)
    );
  }

  private stripBinaryData<T>(payload: T): T {
    if (!payload || typeof payload !== "object") return payload;
    const clone = { ...(payload as Record<string, unknown>) };
    delete clone.binaryData;
    return clone as T;
  }
}
