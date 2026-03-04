import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import net from "net";
import type {
  RoomInfo,
  RoomMessage,
  RoomJoinPayload,
  RoomJoinAckPayload,
  RoomJoinRefusedPayload,
  PlayerInRoom,
} from "../../shared/types";
import { storeService } from "./StoreService";
import { logger } from "../utils/logger";
import { GameLoader } from "./GameLoader";

export class RoomServer {
  private wss: WebSocketServer | null = null;
  public room: RoomInfo | null = null;
  private playerConnections: Map<string, WebSocket> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  async start(gameId: string, version?: string): Promise<number> {
    const port = storeService.getSettings().defaultRoomPort;
    const maxPlayers = await this.getMaxPlayers(gameId, version);
    const gameVersion = await this.getGameVersion(gameId, version);

    this.initializeRoom(gameId, gameVersion, maxPlayers);

    const startedPort = await this.startWebSocketServer(port);
    this.startHeartbeat();
    return startedPort;
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.wss) {
      if (this.room) {
        this.broadcast({ type: "room:disbanded", payload: {} });
      }

      await new Promise<void>((resolve) => {
        this.wss?.close(() => {
          logger.info("[RoomServer] Stopped");
          this.wss = null;
          resolve();
        });

        this.playerConnections.forEach((ws) => ws.terminate());
        this.playerConnections.clear();
      });
    }

    this.room = null;
    this.playerConnections.clear();
  }

  broadcast(msg: RoomMessage, exclude?: WebSocket) {
    if (!this.wss) return;
    const data = JSON.stringify(msg);
    this.wss.clients.forEach((c) => {
      if (c !== exclude && c.readyState === WebSocket.OPEN) {
        c.send(data);
      }
    });
  }

  private async getMaxPlayers(
    gameId: string,
    version?: string,
  ): Promise<number> {
    const manifest = await GameLoader.getManifest(gameId, version);
    return manifest?.multiplayer?.maxPlayers || 4;
  }

  private async getGameVersion(
    gameId: string,
    version?: string,
  ): Promise<string> {
    if (version) return version;
    const manifest = await GameLoader.getManifest(gameId);
    return manifest?.version || "unknown";
  }

  private initializeRoom(
    gameId: string,
    gameVersion: string,
    maxPlayers: number,
  ) {
    const settings = storeService.getSettings();
    this.room = {
      id: crypto.randomUUID(),
      gameId,
      gameVersion,
      hostId: settings.playerId,
      players: [],
      maxPlayers,
      state: "waiting",
      createdAt: Date.now(),
    };
  }

  private startWebSocketServer(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port });

        this.wss.on("headers", (_headers, req) => {
          logger.info(
            `[RoomServer] Incoming connection request from ${req.socket.remoteAddress}`,
          );
        });

        this.wss.on("listening", () => {
          logger.info(`[RoomServer] Started on port ${port}`);
          this.performSelfCheck(port);
          resolve(port);
        });

        this.wss.on("error", (err: any) =>
          this.handleServerError(err, port, reject),
        );
        this.wss.on("connection", (ws: WebSocket) => this.handleConnection(ws));
      } catch (e) {
        reject(e);
      }
    });
  }

  private performSelfCheck(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("connect", () => {
      logger.info(`[RoomServer] Self-check: 127.0.0.1:${port} is reachable.`);
      socket.end();
    });
    socket.on("error", (err) => {
      logger.error(
        `[RoomServer] Self-check FAILED: Cannot connect to 127.0.0.1:${port}`,
        err,
      );
      logger.warn(
        `[RoomServer] This may cause issues with local proxies like SakuraFrp.`,
      );
    });
  }

  private handleServerError(
    err: any,
    port: number,
    reject: (reason?: any) => void,
  ) {
    if (err.code === "EADDRINUSE") {
      logger.error(`[RoomServer] Port ${port} is already in use`);
      reject(new Error(`端口 ${port} 被占用，请检查是否有其他房间正在运行`));
    } else {
      logger.error("[RoomServer] Server error", err);
      reject(err);
    }
  }

  private handleConnection(ws: WebSocket) {
    (ws as any).isAlive = true;
    ws.on("pong", () => {
      (ws as any).isAlive = true;
    });

    ws.on("message", (data: string) => {
      try {
        const msg = JSON.parse(data.toString()) as RoomMessage;
        this.handleMessage(ws, msg);
      } catch (e) {
        logger.error("[RoomServer] Failed to parse message", e);
      }
    });

    ws.on("close", () => this.handleDisconnect(ws));
    ws.on("error", (err) =>
      logger.error("[RoomServer] Client connection error", err),
    );
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;

      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) return ws.terminate();

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  private handleMessage(ws: WebSocket, msg: RoomMessage) {
    if (!this.room) return;

    switch (msg.type) {
      case "room:join":
        this.handleJoin(ws, msg.payload as RoomJoinPayload);
        break;
      case "room:player:ready":
        this.handlePlayerReady(ws);
        break;
      case "room:player:unready":
        this.handlePlayerUnready(ws);
        break;
      case "room:chat":
        this.broadcast(msg);
        break;
      case "game:message:relay":
        this.relayMessage(
          this.getPlayerIdByWs(ws),
          msg.payload as Record<string, unknown>,
        );
        break;
      case "game:broadcast:relay":
        this.relayBroadcast(
          this.getPlayerIdByWs(ws),
          msg.payload as Record<string, unknown>,
        );
        break;
    }
  }

  private handleJoin(ws: WebSocket, payload: RoomJoinPayload) {
    if (!this.room) return;

    const rejection = this.validateJoin(payload);
    if (rejection) {
      this.send(ws, {
        type: "room:join:refused",
        payload: rejection,
      });
      return;
    }

    const isHost = this.room.hostId === payload.playerId;
    const newPlayer: PlayerInRoom = {
      id: payload.playerId,
      name: payload.playerName,
      avatar: payload.playerAvatar,
      isHost: isHost,
      isReady: isHost,
      joinedAt: Date.now(),
    };

    // Remove if exists (rejoin)
    this.room.players = this.room.players.filter(
      (p) => p.id !== payload.playerId,
    );
    this.room.players.push(newPlayer);
    this.playerConnections.set(payload.playerId, ws);

    // Ack to joiner
    this.send(ws, {
      type: "room:join:ack",
      payload: {
        room: this.room,
        yourPlayerId: payload.playerId,
      } as RoomJoinAckPayload,
    });

    // Broadcast to others
    this.broadcast(
      {
        type: "room:player:joined",
        payload: newPlayer,
      },
      ws,
    );
    this.broadcastState();
  }

  private validateJoin(
    payload: RoomJoinPayload,
  ): RoomJoinRefusedPayload | null {
    if (!this.room) return { reason: "room_closed", message: "Room closed" };

    const isRejoin = this.room.players.some((p) => p.id === payload.playerId);
    if (!isRejoin && this.room.players.length >= this.room.maxPlayers) {
      return { reason: "room_full", message: "Room is full" };
    }

    if (this.room.state !== "waiting") {
      return { reason: "game_started", message: "Game already started" };
    }

    if (this.room.gameId !== payload.gameId) {
      return { reason: "game_id_mismatch", message: "Game ID mismatch" };
    }

    if (payload.gameVersion && payload.gameVersion !== this.room.gameVersion) {
      return {
        reason: "version_mismatch",
        message: `Version mismatch: Room is ${this.room.gameVersion}, you are ${payload.gameVersion}`,
      };
    }

    return null;
  }

  private handlePlayerReady(ws: WebSocket) {
    this.updatePlayerState(ws, { isReady: true });
    const playerId = this.getPlayerIdByWs(ws);
    if (playerId) {
      this.broadcast({ type: "room:player:ready", payload: { playerId } });
      this.broadcastState();
    }
  }

  private handlePlayerUnready(ws: WebSocket) {
    this.updatePlayerState(ws, { isReady: false });
    const playerId = this.getPlayerIdByWs(ws);
    if (playerId) {
      this.broadcast({ type: "room:player:unready", payload: { playerId } });
      this.broadcastState();
    }
  }

  private updatePlayerState(ws: WebSocket, updates: Partial<PlayerInRoom>) {
    if (!this.room) return;
    const playerId = this.getPlayerIdByWs(ws);
    if (playerId) {
      const player = this.room.players.find((p) => p.id === playerId);
      if (player) {
        Object.assign(player, updates);
      }
    }
  }

  private handleDisconnect(ws: WebSocket) {
    if (!this.room) return;
    const playerId = this.getPlayerIdByWs(ws);
    if (playerId) {
      this.playerConnections.delete(playerId);
      this.room.players = this.room.players.filter((p) => p.id !== playerId);
      this.broadcast({
        type: "room:player:left",
        payload: { playerId },
      });
      this.broadcastState();
    }
  }

  private getPlayerIdByWs(ws: WebSocket): string | undefined {
    for (const [id, socket] of this.playerConnections.entries()) {
      if (socket === ws) return id;
    }
    return undefined;
  }

  private getSocketByPlayerId(playerId?: string): WebSocket | undefined {
    if (!playerId) return undefined;
    return this.playerConnections.get(playerId);
  }

  private normalizeRelayPayload(
    senderId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const senderIdFromPayload =
      typeof payload.senderId === "string" ? payload.senderId : undefined;
    const finalSenderId = senderId || senderIdFromPayload || "";
    return {
      ...payload,
      senderId: finalSenderId,
    };
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

  private relayMessage(
    senderId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const normalizedPayload = this.normalizeRelayPayload(senderId, payload);
    const targetPlayerId = this.resolveTargetPlayerId(normalizedPayload);
    if (!targetPlayerId) {
      this.relayBroadcast(senderId, normalizedPayload);
      return;
    }
    if (senderId && targetPlayerId === senderId) return;
    const targetSocket = this.getSocketByPlayerId(targetPlayerId);
    if (!targetSocket) return;
    this.send(targetSocket, {
      type: "game:message:relay",
      payload: normalizedPayload,
    });
  }

  private relayBroadcast(
    senderId: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const normalizedPayload = this.normalizeRelayPayload(senderId, payload);
    const senderSocket = this.getSocketByPlayerId(senderId);
    this.broadcast(
      {
        type: "game:broadcast:relay",
        payload: normalizedPayload,
      },
      senderSocket,
    );
  }

  public relayMessageFromLocal(
    senderId: string,
    payload: Record<string, unknown>,
  ) {
    this.relayMessage(senderId, payload);
  }

  public relayBroadcastFromLocal(
    senderId: string,
    payload: Record<string, unknown>,
  ) {
    this.relayBroadcast(senderId, payload);
  }

  public broadcastState() {
    if (this.room) {
      this.broadcast({
        type: "room:state:sync",
        payload: this.room,
      });
    }
  }

  private send(ws: WebSocket, msg: RoomMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}

export const roomServer = new RoomServer();
