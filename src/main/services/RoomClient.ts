import { WebSocket } from "ws";
import type {
  RoomMessage,
  RoomJoinPayload,
  RoomJoinAckPayload,
  RoomJoinRefusedPayload,
  RoomInfo,
  RoomConnectionStatusPayload,
  GameRelayPayload,
} from "../../shared/types";
import { storeService } from "./StoreService";
import { mainWindow } from "../window";
import { sendRoomEventToChat } from "../chat-window";
import { IPC } from "../../shared/ipc-channels";
import {
  decodeBinaryEnvelope,
  encodeBinaryEnvelope,
} from "../../shared/binary-protocol";
import { RoomCommunicationConstants } from "./RoomCommunicationConstants";
import { DEFAULT_RELAY_PUBLIC_HOST, DEFAULT_RELAY_SERVER_URL, DEFAULT_RELAY_TOKEN } from "../../shared/constants";

type ConnectResult = { success: boolean; error?: string; message?: string };
type BinaryRelayPayload = GameRelayPayload & { binaryData?: Buffer };

export class RoomClient {
  private ws: WebSocket | null = null;
  public address = "";
  public room: RoomInfo | null = null;
  private gameId = "";
  private gameVersion = "";
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = false;
  private manuallyDisconnected = false;
  private hasJoinedRoom = false;
  private relayMode = false;
  private relayRoomCode = "";
  private relayHostId = "";
  private readonly maxReconnectAttempts = RoomCommunicationConstants.ROOM_MAX_RECONNECT_ATTEMPTS;

  private connectionResolver: ((result: ConnectResult) => void) | null = null;
  private msgHandler: ((gameId: string, msg: RoomMessage) => void) | null =
    null;
  private recentMessageIds: string[] = [];
  private recentMessageIdSet: Set<string> = new Set();
  private onGameStart: ((gameId: string, version?: string) => void) | null =
    null;
  private onGameStop: ((gameId: string) => void) | null = null;

  async connect(
    address: string,
    gameId: string,
    gameVersion?: string,
  ): Promise<ConnectResult> {
    this.manuallyDisconnected = true;
    this.shouldReconnect = false;
    this.cleanup();
    this.resetRelayState();

    let url = address.trim();
    this.relayMode = this.isRelayAddress(url);
    this.relayRoomCode = this.relayMode ? this.resolveRelayRoomCode(url) : "";
    this.relayHostId = "";
    if (this.relayMode) {
      url = DEFAULT_RELAY_SERVER_URL.trim();
    }
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      if (url.startsWith("https://")) url = `wss://${url.slice("https://".length)}`;
      else if (url.startsWith("http://")) url = `ws://${url.slice("http://".length)}`;
      else url = `ws://${url}`;
    }

    this.address = url;
    this.gameId = gameId;
    this.gameVersion = gameVersion || "";
    this.reconnectAttempts = 0;
    this.manuallyDisconnected = false;
    this.shouldReconnect = true;
    this.hasJoinedRoom = false;
    this.emitConnectionStatus({
      status: "connecting",
      attempts: 0,
      maxAttempts: this.maxReconnectAttempts,
    });

    return new Promise((resolve) => {
      this.connectionResolver = resolve;
      this.openSocket();
      setTimeout(() => {
        if (this.connectionResolver) {
          this.emitConnectionStatus({
            status: "failed",
            attempts: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            reason: "连接超时 (15s)",
          });
          this.cleanup();
          this.resolveConnection({ success: false, error: "连接超时 (15s)" });
        }
      }, RoomCommunicationConstants.ROOM_CONNECT_TIMEOUT_MS);
    });
  }

  private openSocket() {
    try {
      const options = { rejectUnauthorized: false };
      this.ws = new WebSocket(this.address, options);
      this.setupWebSocketListeners();
    } catch {
      this.resolveConnection({ success: false, error: "连接异常" });
      this.scheduleReconnect();
    }
  }

  private setupWebSocketListeners() {
    if (!this.ws) return;

    this.ws.on("open", () => this.handleOpen());
    this.ws.on("error", (err) => this.handleError(err));
    this.ws.on("close", () => this.handleClose());
    this.ws.on("message", (data, isBinary) => this.handleIncomingMessage(data, isBinary));
  }

  private handleOpen() {
    this.clearReconnectTimer();
    if (this.relayMode) {
      const settings = storeService.getSettings();
      this.sendRaw({
        type: "relay:join",
        payload: {
          token: DEFAULT_RELAY_TOKEN,
          roomCode: this.relayRoomCode,
          playerId: settings.playerId,
        },
      });
      return;
    }
    this.sendJoinRequest();
  }

  private sendJoinRequest() {
    const settings = storeService.getSettings();
    const userData = storeService.getUserData();
    const joinPayload: RoomJoinPayload = {
      playerId: settings.playerId,
      playerName: settings.playerName,
      playerAvatar: settings.avatar,
      playerAvatarFrame: userData.equippedFrame,
      gameId: this.gameId,
      gameVersion: this.gameVersion,
    };
    this.send({ type: "room:join", payload: joinPayload });
  }

  private handleError(err: Error) {
    if (this.connectionResolver) {
      this.emitConnectionStatus({
        status: "failed",
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        reason: err.message || "连接错误",
      });
      this.resolveConnection({
        success: false,
        error: err.message || "连接错误",
      });
    }
  }

  private handleClose() {
    const shouldReconnect =
      !this.manuallyDisconnected && this.shouldReconnect && this.hasJoinedRoom;

    if (this.connectionResolver) {
      this.emitConnectionStatus({
        status: "failed",
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        reason: "Closed before join",
      });
      this.resolveConnection({ success: false, error: "Closed before join" });
    }
    if (shouldReconnect) {
      this.scheduleReconnect();
    } else {
      this.room = null;
      this.hasJoinedRoom = false;
      this.emitConnectionStatus({
        status: this.manuallyDisconnected ? "disconnected" : "failed",
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
      });
    }
    mainWindow?.webContents.send(IPC.ROOM_EVENT, {
      type: "room:disconnected",
      payload: {},
    });
    sendRoomEventToChat({
      type: "room:disconnected",
      payload: {},
    });
  }

  private handleIncomingMessage(data: WebSocket.RawData, isBinary: boolean) {
    try {
      if (this.relayMode && !isBinary) {
        const relayMsg = JSON.parse(this.rawDataToBuffer(data).toString()) as RoomMessage;
        if (relayMsg.type === "relay:join:ack" as RoomMessage["type"]) {
          this.relayHostId = String((relayMsg.payload as any)?.hostId || "");
          this.sendJoinRequest();
          return;
        }
        if (relayMsg.type === "relay:error" as RoomMessage["type"]) {
          this.shouldReconnect = false;
          this.hasJoinedRoom = false;
          this.resolveConnection({ success: false, error: String((relayMsg.payload as any)?.code || "relay_error") });
          this.cleanup();
          return;
        }
        if (relayMsg.type === "relay:closed" as RoomMessage["type"]) {
          this.processMessage({ type: "room:disbanded", payload: {} });
          this.cleanup();
          return;
        }
      }
      const msg = this.deserializeRoomMessage(data, isBinary);
      if (!msg) return;
      this.processMessage(msg);
    } catch {}
  }

  private processMessage(msg: RoomMessage) {
    // 1. Update local cache
    if (msg.type === "room:state:sync") {
      this.room = msg.payload as RoomInfo;
    } else if (msg.type === "room:disbanded" || msg.type === "room:kicked") {
      this.room = null;
      this.shouldReconnect = false;
      this.hasJoinedRoom = false;
    }

    // 2. Handle handshake
    if (this.connectionResolver) {
      this.handleHandshake(msg);
    }

    if (this.isGameRelayMessage(msg)) {
      if (this.shouldDropDuplicateRelay(msg)) return;
      this.handleGameLifecycle(msg);
      return;
    }

    mainWindow?.webContents.send(IPC.ROOM_EVENT, msg);
    sendRoomEventToChat(msg);

    this.handleGameLifecycle(msg);
  }

  private handleHandshake(msg: RoomMessage) {
    if (msg.type === "room:join:ack") {
      const ack = msg.payload as RoomJoinAckPayload;
      this.room = ack.room;
      this.relayHostId = this.relayMode ? ack.room.hostId : "";
      this.hasJoinedRoom = true;
      this.reconnectAttempts = 0;
      this.emitConnectionStatus({
        status: "connected",
        attempts: 0,
        maxAttempts: this.maxReconnectAttempts,
      });
      this.resolveConnection({ success: true });
      mainWindow?.webContents.send(IPC.ROOM_EVENT, {
        type: "room:state:sync",
        payload: ack.room,
      });
      sendRoomEventToChat({
        type: "room:state:sync",
        payload: ack.room,
      });
    } else if (msg.type === "room:state:sync") {
      const state = msg.payload as RoomInfo;
      const localPlayerId = storeService.getSettings().playerId;
      const joined = state.players.some((p) => p.id === localPlayerId);
      const sameGame = state.gameId === this.gameId;
      if (joined && sameGame) {
        this.room = state;
        this.relayHostId = this.relayMode ? state.hostId : "";
        this.hasJoinedRoom = true;
        this.reconnectAttempts = 0;
        this.emitConnectionStatus({
          status: "connected",
          attempts: 0,
          maxAttempts: this.maxReconnectAttempts,
        });
        this.resolveConnection({ success: true });
      }
    } else if (msg.type === "room:join:refused") {
      const payload = msg.payload as RoomJoinRefusedPayload;
      this.shouldReconnect = false;
      this.hasJoinedRoom = false;
      this.emitConnectionStatus({
        status: "failed",
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        reason: payload.message || payload.reason,
      });
      this.resolveConnection({
        success: false,
        error: payload.reason,
        message: payload.message,
      });
    }
  }

  private handleGameLifecycle(msg: RoomMessage) {
    if (msg.type === "room:game:start") {
      this.onGameStart?.(this.gameId, this.room?.gameVersion);
    } else if (msg.type === "room:game:end") {
      this.onGameStop?.(this.gameId);
    } else if (
      msg.type === "game:message:relay" ||
      msg.type === "game:broadcast:relay" ||
      msg.type === "game:message:ack"
    ) {
      this.msgHandler?.(this.gameId, msg);
    }
  }

  private isGameRelayMessage(msg: RoomMessage) {
    return (
      msg.type === "game:message:relay" ||
      msg.type === "game:broadcast:relay" ||
      msg.type === "game:message:ack"
    );
  }

  private shouldDropDuplicateRelay(msg: RoomMessage) {
    if (msg.type === "game:message:ack") return false;
    const payload = msg.payload as GameRelayPayload;
    if (!payload.messageId) return false;
    if (this.recentMessageIdSet.has(payload.messageId)) return true;
    this.rememberMessageId(payload.messageId);
    if (Array.isArray(payload.messages)) {
      for (const message of payload.messages as GameRelayPayload[]) {
        this.rememberMessageId(message.messageId);
      }
    }
    return false;
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

  private resetRelayState() {
    this.recentMessageIds = [];
    this.recentMessageIdSet.clear();
  }

  private resolveConnection(result: ConnectResult) {
    if (this.connectionResolver) {
      this.connectionResolver(result);
      this.connectionResolver = null;
    }
  }

  send(msg: RoomMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(this.serializeRoomMessage(msg, this.relayMode ? this.getRelayHostId() : undefined));
    }
  }

  private sendRaw(msg: RoomMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    this.manuallyDisconnected = true;
    this.shouldReconnect = false;
    this.hasJoinedRoom = false;
    this.cleanup();
    this.resetRelayState();
    this.room = null;
    this.emitConnectionStatus({
      status: "disconnected",
      attempts: 0,
      maxAttempts: this.maxReconnectAttempts,
    });
    mainWindow?.webContents.send(IPC.ROOM_EVENT, {
      type: "room:disconnected",
      payload: {},
    });
    sendRoomEventToChat({
      type: "room:disconnected",
      payload: {},
    });
  }

  private cleanup() {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connectionResolver = null;
  }

  private getRelayHostId() {
    return this.room?.hostId || this.relayHostId || undefined;
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || !this.hasJoinedRoom) return;
    if (this.connectionResolver) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.shouldReconnect = false;
      this.hasJoinedRoom = false;
      this.room = null;
      this.emitConnectionStatus({
        status: "failed",
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        reason: "重连次数已达上限",
      });
      return;
    }
    this.clearReconnectTimer();
    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.reconnectAttempts * RoomCommunicationConstants.ROOM_RECONNECT_BASE_DELAY_MS,
      RoomCommunicationConstants.ROOM_RECONNECT_MAX_DELAY_MS,
    );
    this.emitConnectionStatus({
      status: "reconnecting",
      attempts: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      nextRetryMs: delay,
    });
    this.reconnectTimer = setTimeout(() => {
      if (!this.shouldReconnect || this.manuallyDisconnected) return;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  setMsgHandler(handler: (gameId: string, msg: RoomMessage) => void) {
    this.msgHandler = handler;
  }

  setStartGameHandler(handler: (gameId: string, version?: string) => void) {
    this.onGameStart = handler;
  }

  setStopGameHandler(handler: (gameId: string) => void) {
    this.onGameStop = handler;
  }

  private emitConnectionStatus(payload: RoomConnectionStatusPayload) {
    mainWindow?.webContents.send(IPC.ROOM_EVENT, {
      type: "room:connection-status",
      payload,
    });
    sendRoomEventToChat({
      type: "room:connection-status",
      payload,
    });
  }

  private serializeRoomMessage(msg: RoomMessage, relayTo?: string): string | Buffer {
    const payload = msg.payload as BinaryRelayPayload;
    const header = relayTo ? { ...msg, __relayTo: relayTo } : msg;
    if (!payload?.binaryData) return JSON.stringify(header);
    return encodeBinaryEnvelope(
      {
        ...header,
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
      if (this.isGameRelayMessage(msg) && rawData.byteLength > RoomCommunicationConstants.MAX_GAME_RELAY_MESSAGE_BYTES) {
        return null;
      }
      return msg;
    }
    const decoded = decodeBinaryEnvelope<RoomMessage>(rawData);
    if (!decoded) return null;
    if (
      this.isGameRelayMessage(decoded.header) &&
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

  private stripBinaryData(payload: BinaryRelayPayload): GameRelayPayload {
    const clone = { ...payload };
    delete clone.binaryData;
    return clone;
  }

  private isRelayAddress(address: string) {
    return new RegExp(`^${this.escapeRegExp(DEFAULT_RELAY_PUBLIC_HOST)}:\\d+$`, "i").test(address.trim());
  }

  private resolveRelayRoomCode(address: string) {
    return address.trim().split(":").pop() || "";
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export const roomClient = new RoomClient();
