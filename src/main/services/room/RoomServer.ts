import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import type {
  RoomInfo,
  RoomMessage,
  RoomJoinPayload,
  RoomJoinAckPayload,
  RoomJoinRefusedPayload,
  PlayerInRoom,
  RoomKickedPayload,
  GameRelayPayload,
  GameMessageAckPayload,
} from "../../../shared/types";
import { storeService } from "../storage/StoreService";
import { GameLoader } from "../game/GameLoader";
import {
  decodeBinaryEnvelope,
  encodeBinaryEnvelope,
} from "../../../shared/binary-protocol";
import { RoomCommunicationConstants } from "./RoomCommunicationConstants";

type BinaryRelayPayload = GameRelayPayload & { binaryData?: Buffer };
type RelaySocket = {
  readyState: number;
  send: (data: string | Buffer) => void;
  close: () => void;
};
type RoomSocket = WebSocket | RelaySocket;

export class RoomServer {
  private wss: WebSocketServer | null = null;
  public room: RoomInfo | null = null;
  private playerConnections: Map<string, RoomSocket> = new Map();
  private relayConnections: Set<RelaySocket> = new Set();
  private kickedPlayers: Set<string> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private localRelayHandler:
    | ((gameId: string, msg: RoomMessage) => void)
    | null = null;
  private stateSyncHandler: (() => void) | null = null;
  private recentMessageIds: string[] = [];
  private recentMessageIdSet: Set<string> = new Set();
  private orderedSeqBySenderChannel: Map<string, number> = new Map();

  async start(gameId: string, version?: string): Promise<number> {
    const port = storeService.getSettings().defaultRoomPort;
    const maxPlayers = await this.getMaxPlayers(gameId, version);
    const gameVersion = await this.getGameVersion(gameId, version);

    this.initializeRoom(gameId, gameVersion, maxPlayers);
    this.kickedPlayers.clear();
    this.resetRelayState();

    const startedPort = await this.startWebSocketServer(port);
    this.startHeartbeat();
    return startedPort;
  }

  private resetRelayState() {
    this.recentMessageIds = [];
    this.recentMessageIdSet.clear();
    this.orderedSeqBySenderChannel.clear();
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.stateSyncHandler = null;

    if (this.wss) {
      if (this.room) {
        this.broadcast({ type: "room:disbanded", payload: {} });
      }
      await new Promise((resolve) => setTimeout(resolve, RoomCommunicationConstants.ROOM_DISBAND_BROADCAST_DELAY_MS));

      await new Promise<void>((resolve) => {
        this.wss?.close(() => {
          this.wss = null;
          resolve();
        });

        this.playerConnections.forEach((ws) => ws.close());
        this.playerConnections.clear();
      });
    }

    this.room = null;
    this.playerConnections.clear();
    this.relayConnections.clear();
    this.stateSyncHandler = null;
  }

  broadcast(msg: RoomMessage, exclude?: RoomSocket) {
    const data = this.serializeRoomMessage(msg);
    this.wss?.clients.forEach((c) => {
      if (c !== exclude && c.readyState === WebSocket.OPEN) {
        c.send(data);
      }
    });
    this.relayConnections.forEach((c) => {
      if (c !== exclude && c.readyState === WebSocket.OPEN) {
        c.send(data);
      }
    });
  }

  setLocalRelayHandler(handler: ((gameId: string, msg: RoomMessage) => void) | null) {
    this.localRelayHandler = handler;
  }

  setStateSyncHandler(handler: (() => void) | null) {
    this.stateSyncHandler = handler;
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

        this.wss.on("listening", () => {
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

  private handleServerError(
    err: any,
    port: number,
    reject: (reason?: any) => void,
  ) {
    if (err.code === "EADDRINUSE") {
      reject(new Error(`端口 ${port} 被占用，请检查是否有其他房间正在运行`));
    } else {
      reject(err);
    }
  }

  private handleConnection(ws: WebSocket) {
    (ws as any).isAlive = true;
    ws.on("pong", () => {
      (ws as any).isAlive = true;
    });

    ws.on("message", (data, isBinary) => {
      try {
        const msg = this.deserializeRoomMessage(data, isBinary);
        if (!msg) return;
        this.handleMessage(ws, msg);
      } catch {}
    });

    ws.on("close", () => this.handleDisconnect(ws));
    ws.on("error", () => {});
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
    }, RoomCommunicationConstants.ROOM_HEARTBEAT_INTERVAL_MS);
  }

  public handleRelayRawMessage(data: WebSocket.RawData, isBinary: boolean, sendToRelay: (data: string | Buffer, targetPlayerId?: string) => void) {
    const msg = this.deserializeRoomMessage(data, isBinary);
    if (!msg) return;
    const playerId = this.resolveRelaySenderId(msg);
    const relaySocket = this.createRelaySocket(playerId, sendToRelay);
    if (msg.type !== "room:join") {
      if (!playerId) return;
      const existingSocket = this.playerConnections.get(playerId);
      if (!existingSocket || !this.relayConnections.has(existingSocket as RelaySocket)) return;
      this.handleMessage(existingSocket, msg);
      return;
    }
    this.handleMessage(relaySocket, msg);
  }

  private handleMessage(ws: RoomSocket, msg: RoomMessage) {
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
          msg.payload as GameRelayPayload,
        );
        break;
      case "game:broadcast:relay":
        this.relayBroadcast(
          this.getPlayerIdByWs(ws),
          msg.payload as GameRelayPayload,
        );
        break;
    }
  }

  private handleJoin(ws: RoomSocket, payload: RoomJoinPayload) {
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
      avatarFrame: payload.playerAvatarFrame,
      nicknameStyle: payload.playerNicknameStyle,
      isHost: isHost,
      isReady: isHost,
      joinedAt: Date.now(),
    };

    this.room.players = this.room.players.filter(
      (p) => p.id !== payload.playerId,
    );
    this.room.players.push(newPlayer);
    this.playerConnections.set(payload.playerId, ws);
    if (this.isRelaySocket(ws)) {
      this.relayConnections.add(ws);
    }
    this.send(ws, {
      type: "room:join:ack",
      payload: {
        room: this.room,
        yourPlayerId: payload.playerId,
      } as RoomJoinAckPayload,
    });
    this.broadcast(
      {
        type: "room:player:joined",
        payload: newPlayer,
      },
      ws,
    );
    this.broadcastState(ws);
  }

  private validateJoin(
    payload: RoomJoinPayload,
  ): RoomJoinRefusedPayload | null {
    if (!this.room) return { reason: "room_closed", message: "Room closed" };
    if (this.kickedPlayers.has(payload.playerId)) {
      return {
        reason: "kicked",
        message: "You have been removed from this room by host",
      };
    }

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

  private handlePlayerReady(ws: RoomSocket) {
    const playerId = this.getPlayerIdByWs(ws);
    this.updatePlayerState(playerId, { isReady: true });
    if (playerId) {
      this.broadcast({ type: "room:player:ready", payload: { playerId } });
      this.broadcastState();
    }
  }

  private handlePlayerUnready(ws: RoomSocket) {
    const playerId = this.getPlayerIdByWs(ws);
    this.updatePlayerState(playerId, { isReady: false });
    if (playerId) {
      this.broadcast({ type: "room:player:unready", payload: { playerId } });
      this.broadcastState();
    }
  }

  private updatePlayerState(playerId: string | undefined, updates: Partial<PlayerInRoom>) {
    if (!this.room) return;
    if (playerId) {
      const player = this.room.players.find((p) => p.id === playerId);
      if (player) {
        Object.assign(player, updates);
      }
    }
  }

  private handleDisconnect(ws: RoomSocket) {
    if (!this.room) return;
    const playerId = this.getPlayerIdByWs(ws);
    if (playerId) {
      const isHost = this.room.hostId === playerId;
      this.playerConnections.delete(playerId);
      if (this.isRelaySocket(ws)) {
        this.relayConnections.delete(ws);
      }
      this.room.players = this.room.players.filter((p) => p.id !== playerId);
      this.broadcast({
        type: "room:player:left",
        payload: { playerId },
      });
      if (isHost) {
        this.broadcast({ type: "room:disbanded", payload: {} });
        this.stop();
        return;
      }
      this.broadcastState();
    }
  }

  kickPlayer(byPlayerId: string, targetPlayerId: string): boolean {
    if (!this.room) return false;
    if (byPlayerId !== this.room.hostId) return false;
    if (targetPlayerId === this.room.hostId) return false;
    const targetPlayer = this.room.players.find((p) => p.id === targetPlayerId);
    if (!targetPlayer) return false;

    this.kickedPlayers.add(targetPlayerId);
    this.room.players = this.room.players.filter((p) => p.id !== targetPlayerId);
    const targetSocket = this.playerConnections.get(targetPlayerId);
    this.playerConnections.delete(targetPlayerId);
    if (targetSocket && this.isRelaySocket(targetSocket)) {
      this.relayConnections.delete(targetSocket);
    }

    const kickedPayload: RoomKickedPayload = {
      roomId: this.room.id,
      byPlayerId,
    };
    if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
      this.send(targetSocket, { type: "room:kicked", payload: kickedPayload });
      targetSocket.close();
    }

    this.broadcast({
      type: "room:player:kicked",
      payload: { playerId: targetPlayerId, byPlayerId, name: targetPlayer.name },
    });
    this.broadcastState();
    return true;
  }

  private getPlayerIdByWs(ws: RoomSocket): string | undefined {
    for (const [id, socket] of this.playerConnections.entries()) {
      if (socket === ws) return id;
    }
    return undefined;
  }

  public getSocketByPlayerId(playerId?: string): RoomSocket | undefined {
    if (!playerId) return undefined;
    return this.playerConnections.get(playerId);
  }

  public disconnectRemotePlayersForModeSwitch() {
    if (!this.room) return;
    const hostId = this.room.hostId;
    for (const [playerId, socket] of this.playerConnections.entries()) {
      if (playerId === hostId) continue;
      this.send(socket, { type: "room:disbanded", payload: {} });
      socket.close();
      this.playerConnections.delete(playerId);
    }
    this.relayConnections.forEach((socket) => socket.close());
    this.relayConnections.clear();
    this.room.players = this.room.players.filter((player) => player.id === hostId);
    this.broadcastState();
  }

  public disconnectRelayPlayer(playerId: string) {
    const socket = this.playerConnections.get(playerId);
    if (!socket || !this.relayConnections.has(socket as RelaySocket)) return;
    this.handleDisconnect(socket);
    socket.close();
  }

  private normalizeRelayPayload(
    senderId: string | undefined,
    payload: GameRelayPayload,
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
    payload: BinaryRelayPayload,
  ) {
    if (!this.room) return;
    if (!senderId) return;
    if (this.hasProcessedMessage(payload.messageId)) return;
    this.rememberMessageId(payload.messageId);
    const normalizedPayload = this.normalizeRelayPayload(senderId, payload);
    const shouldRelay = this.trackDelivery(normalizedPayload);
    if (!shouldRelay) return;
    const targetPlayerId = this.resolveTargetPlayerId(normalizedPayload);
    if (!targetPlayerId) {
      return;
    }
    if (senderId && targetPlayerId === senderId) return;
    if (targetPlayerId === this.room.hostId) {
      this.localRelayHandler?.(this.room.gameId, {
        type: "game:message:relay",
        payload: normalizedPayload,
      });
      this.sendAckToSender(senderId, normalizedPayload);
      return;
    }
    const targetSocket = this.getSocketByPlayerId(targetPlayerId);
    if (!targetSocket) return;
    this.send(targetSocket, {
      type: "game:message:relay",
      payload: normalizedPayload,
    });
    this.sendAckToSender(senderId, normalizedPayload);
  }

  private relayBroadcast(
    senderId: string | undefined,
    payload: BinaryRelayPayload,
  ) {
    if (!this.room) return;
    if (!senderId) return;
    if (this.hasProcessedMessage(payload.messageId)) return;
    this.rememberMessageId(payload.messageId);
    const normalizedPayload = this.normalizeRelayPayload(senderId, payload);
    const shouldRelay = this.trackDelivery(normalizedPayload);
    if (!shouldRelay) return;
    const batchMessages = Array.isArray(normalizedPayload.messages)
      ? (normalizedPayload.messages as GameRelayPayload[])
      : undefined;
    const senderSocket = this.getSocketByPlayerId(senderId);
    if (senderId !== this.room.hostId) {
      this.localRelayHandler?.(this.room.gameId, {
        type: "game:broadcast:relay",
        payload: normalizedPayload,
      });
    }
    this.broadcast(
      {
        type: "game:broadcast:relay",
        payload: normalizedPayload,
      },
      senderSocket,
    );
    if (batchMessages) {
      for (const message of batchMessages) {
        this.rememberMessageId(message.messageId);
      }
    }
    this.sendAckToSender(senderId, normalizedPayload);
  }

  private relayAck(payload: GameMessageAckPayload) {
    if (!this.room) return;
    if (payload.to === this.room.hostId) {
      this.localRelayHandler?.(this.room.gameId, {
        type: "game:message:ack",
        payload,
      });
      return;
    }
    const targetSocket = this.getSocketByPlayerId(payload.to);
    if (targetSocket) {
      this.send(targetSocket, { type: "game:message:ack", payload });
    }
  }

  private sendAckToSender(senderId: string | undefined, payload: GameRelayPayload) {
    if (
      !senderId ||
      (payload.reliable !== true && payload.delivery !== "reliable") ||
      !payload.messageId
    ) {
      return;
    }
    const ackPayload: GameMessageAckPayload = {
      messageId: payload.messageId,
      senderId: payload.senderId,
      to: senderId,
      sentAt: Date.now(),
    };
    this.relayAck(ackPayload);
  }

  private hasProcessedMessage(messageId: string | undefined) {
    return !!messageId && this.recentMessageIdSet.has(messageId);
  }

  private rememberMessageId(messageId: string | undefined) {
    if (!messageId || this.recentMessageIdSet.has(messageId)) return;
    this.recentMessageIds.push(messageId);
    this.recentMessageIdSet.add(messageId);
    while (this.recentMessageIds.length > RoomCommunicationConstants.MAX_RECENT_MESSAGE_IDS) {
      const expired = this.recentMessageIds.shift();
      if (expired) this.recentMessageIdSet.delete(expired);
    }
  }

  private trackDelivery(payload: GameRelayPayload) {
    if (payload.delivery !== "ordered" || !payload.channel || typeof payload.seq !== "number") {
      return true;
    }
    const key = `${payload.senderId}:${payload.channel}`;
    const lastSeq = this.orderedSeqBySenderChannel.get(key);
    if (typeof lastSeq === "number" && payload.seq <= lastSeq) {
      return false;
    }
    this.orderedSeqBySenderChannel.set(key, payload.seq);
    return true;
  }

  public relayMessageFromLocal(
    senderId: string,
    payload: BinaryRelayPayload,
  ) {
    this.relayMessage(senderId, payload);
  }

  public relayBroadcastFromLocal(
    senderId: string,
    payload: BinaryRelayPayload,
  ) {
    this.relayBroadcast(senderId, payload);
  }

  public broadcastState(exclude?: RoomSocket) {
    if (this.room) {
      this.broadcast({
        type: "room:state:sync",
        payload: this.room,
      }, exclude);
      this.stateSyncHandler?.();
    }
  }

  private send(ws: RoomSocket, msg: RoomMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(this.serializeRoomMessage(msg));
    }
  }

  private serializeRoomMessage(msg: RoomMessage): string | Buffer {
    const payload = msg.payload as BinaryRelayPayload;
    if (!payload?.binaryData) return JSON.stringify(msg);
    return encodeBinaryEnvelope(
      {
        ...msg,
        payload: this.stripBinaryData(payload),
      },
      payload.binaryData,
    );
  }

  private deserializeRoomMessage(data: WebSocket.RawData, isBinary: boolean): RoomMessage | null {
    const rawData = this.rawDataToBuffer(data);
    if (rawData.byteLength > RoomCommunicationConstants.MAX_ROOM_MESSAGE_BYTES) return null;
    if (!isBinary) {
      const msg = JSON.parse(rawData.toString()) as RoomMessage;
      if (this.isGameRelayMessageType(msg.type) && rawData.byteLength > RoomCommunicationConstants.MAX_GAME_RELAY_MESSAGE_BYTES) {
        return null;
      }
      return msg;
    }
    const decoded = decodeBinaryEnvelope<RoomMessage>(rawData);
    if (!decoded) return null;
    if (
      this.isGameRelayMessageType(decoded.header.type) &&
      rawData.byteLength > RoomCommunicationConstants.MAX_GAME_RELAY_MESSAGE_BYTES
    ) {
      return null;
    }
    const payload = decoded.header.payload as BinaryRelayPayload;
    return {
      ...decoded.header,
      payload: {
        ...payload,
        binary: true,
        byteLength: decoded.body.byteLength,
        binaryData: decoded.body,
      },
    };
  }

  private rawDataToBuffer(data: WebSocket.RawData): Buffer {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    return Buffer.concat(data);
  }

  private isGameRelayMessageType(type: RoomMessage["type"]) {
    return (
      type === "game:message:relay" ||
      type === "game:broadcast:relay" ||
      type === "game:message:ack"
    );
  }

  private stripBinaryData(payload: BinaryRelayPayload): GameRelayPayload {
    const clone = { ...payload };
    delete clone.binaryData;
    return clone;
  }

  private resolveRelaySenderId(msg: RoomMessage): string | undefined {
    const payload = msg.payload as Record<string, unknown> | undefined;
    if (msg.type === "room:join" && typeof payload?.playerId === "string") return payload.playerId;
    if (typeof payload?.senderId === "string") return payload.senderId;
    if (typeof payload?.playerId === "string") return payload.playerId;
    return undefined;
  }

  private createRelaySocket(playerId: string | undefined, sendToRelay: (data: string | Buffer, targetPlayerId?: string) => void): RelaySocket {
    const existing = playerId ? this.playerConnections.get(playerId) : undefined;
    if (existing && this.relayConnections.has(existing as RelaySocket)) return existing as RelaySocket;
    const relaySocket: RelaySocket = {
      readyState: WebSocket.OPEN,
      send: (data) => sendToRelay(data, playerId),
      close: () => {
        relaySocket.readyState = WebSocket.CLOSED;
        this.relayConnections.delete(relaySocket);
        if (playerId) this.playerConnections.delete(playerId);
      },
    };
    return relaySocket;
  }

  private isRelaySocket(socket: RoomSocket): socket is RelaySocket {
    return !(socket instanceof WebSocket);
  }
}

export const roomServer = new RoomServer();
