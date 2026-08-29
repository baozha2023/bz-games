import { WebSocket } from "ws";
import type {
  RoomMessage,
  RoomJoinPayload,
  RoomJoinAckPayload,
  RoomJoinRefusedPayload,
  RoomInfo,
  RoomConnectionStatusPayload,
  GameRelayPayload,
  RoomRelayLatencyPayload,
  RoomConnectResult,
} from "../../../shared/types";
import { storeService } from "../storage/StoreService";
import { mainWindow } from "../../window";
import { sendRoomEventToChat } from "../../chat-window";
import { IPC } from "../../../shared/ipc-channels";
import crypto from "crypto";
import {
  decodeBinaryEnvelope,
  encodeBinaryEnvelope,
} from "../../../shared/binary-protocol";
import { RoomConstants } from "../../../shared/RoomConstants";
import {
  DEFAULT_RELAY_PUBLIC_HOST,
  DEFAULT_RELAY_SERVER_URL,
  DEFAULT_RELAY_TOKEN,
} from "../../../shared/AppConstants";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { toRelayWebSocketUrl } from "./relayWebSocketUrl";
import { mapRelayCloseError } from "../../utils/relayCloseError";

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
  private roomPassword = "";
  private latencyTimer: NodeJS.Timeout | null = null;
  private pendingLatencyProbes: Map<string, NodeJS.Timeout> = new Map();
  private readonly maxReconnectAttempts =
    RoomConstants.ROOM_MAX_RECONNECT_ATTEMPTS;

  private connectionResolver: ((result: RoomConnectResult) => void) | null =
    null;
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
    password?: string,
  ): Promise<RoomConnectResult> {
    this.manuallyDisconnected = true;
    this.shouldReconnect = false;
    this.cleanup();
    this.resetRelayState();

    let url = address.trim();
    this.relayMode = this.isRelayAddress(url);
    this.relayRoomCode = this.relayMode ? this.resolveRelayRoomCode(url) : "";
    this.relayHostId = "";
    if (this.relayMode) {
      url = toRelayWebSocketUrl(DEFAULT_RELAY_SERVER_URL);
      if (!url) {
        return { success: false, error: "relay_not_configured" };
      }
    }
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      if (url.startsWith("https://"))
        url = `wss://${url.slice("https://".length)}`;
      else if (url.startsWith("http://"))
        url = `ws://${url.slice("http://".length)}`;
      else url = `ws://${url}`;
    }

    this.address = url;
    this.gameId = gameId;
    this.gameVersion = gameVersion || "";
    this.roomPassword = password?.trim() || "";
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
      }, RoomConstants.ROOM_CONNECT_TIMEOUT_MS);
    });
  }

  hasActiveOperation(): boolean {
    return (
      this.room !== null ||
      this.connectionResolver !== null ||
      this.shouldReconnect
    );
  }

  private openSocket() {
    try {
      const options = { rejectUnauthorized: false };
      this.ws = new WebSocket(
        requestInterceptor.buildWebSocketUrl(this.address),
        options,
      );
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
    this.ws.on("close", (code, reason) => this.handleClose(code, reason));
    this.ws.on("message", (data, isBinary) =>
      this.handleIncomingMessage(data, isBinary),
    );
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
          password: this.roomPassword || undefined,
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
      playerNicknameStyle: settings.nicknameStyle,
      gameId: this.gameId,
      gameVersion: this.gameVersion,
      password: this.relayMode ? undefined : this.roomPassword || undefined,
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

  private handleClose(code: number, reason: Buffer) {
    const shouldReconnect =
      !this.manuallyDisconnected && this.shouldReconnect && this.hasJoinedRoom;

    if (this.connectionResolver) {
      const closeReason =
        mapRelayCloseError(code, reason, "") || "Closed before join";
      this.emitConnectionStatus({
        status: "failed",
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        reason: closeReason,
      });
      this.resolveConnection({ success: false, error: closeReason });
    }
    this.stopLatencyProbe();
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
        const relayMsg = JSON.parse(
          this.rawDataToBuffer(data).toString(),
        ) as RoomMessage;
        if (relayMsg.type === ("relay:join:ack" as RoomMessage["type"])) {
          this.relayHostId = String((relayMsg.payload as any)?.hostId || "");
          this.sendJoinRequest();
          return;
        }
        if (relayMsg.type === ("relay:error" as RoomMessage["type"])) {
          this.shouldReconnect = false;
          this.hasJoinedRoom = false;
          const payload = relayMsg.payload as any;
          const error =
            payload?.code === "capacity_full" &&
            typeof payload?.reason === "string"
              ? payload.reason
              : String(payload?.code || "relay_error");
          this.resolveConnection({ success: false, error });
          this.cleanup();
          return;
        }
        if (relayMsg.type === ("relay:closed" as RoomMessage["type"])) {
          this.processMessage({ type: "room:disbanded", payload: {} });
          this.cleanup();
          return;
        }
        if (relayMsg.type === ("relay:latency:pong" as RoomMessage["type"])) {
          this.handleLatencyPong(relayMsg.payload);
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
      if (this.relayMode) this.startLatencyProbe();
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
        if (this.relayMode) this.startLatencyProbe();
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
    while (
      this.recentMessageIds.length > RoomConstants.MAX_RECENT_MESSAGE_IDS
    ) {
      const expired = this.recentMessageIds.shift();
      if (expired) this.recentMessageIdSet.delete(expired);
    }
  }

  private resetRelayState() {
    this.recentMessageIds = [];
    this.recentMessageIdSet.clear();
  }

  private startLatencyProbe() {
    if (!this.relayMode || this.latencyTimer) return;
    this.sendLatencyProbe();
    this.latencyTimer = setInterval(
      () => this.sendLatencyProbe(),
      RoomConstants.RELAY_LATENCY_REFRESH_INTERVAL_MS,
    );
  }

  private stopLatencyProbe(emitOffline = true) {
    const wasRunning = Boolean(
      this.latencyTimer || this.pendingLatencyProbes.size > 0,
    );
    if (this.latencyTimer) {
      clearInterval(this.latencyTimer);
      this.latencyTimer = null;
    }
    this.pendingLatencyProbes.forEach((timer) => clearTimeout(timer));
    this.pendingLatencyProbes.clear();
    if (emitOffline && wasRunning) this.emitLatency(null);
  }

  private sendLatencyProbe() {
    if (!this.relayMode || !this.ws || this.ws.readyState !== WebSocket.OPEN)
      return;
    const hostId = this.getRelayHostId();
    if (!hostId) return;
    const settings = storeService.getSettings();
    const probeId = crypto.randomUUID();
    const sentAt = Date.now();
    const timeout = setTimeout(() => {
      this.pendingLatencyProbes.delete(probeId);
      this.emitLatency(null);
    }, RoomConstants.RELAY_LATENCY_TIMEOUT_MS);
    this.pendingLatencyProbes.set(probeId, timeout);
    this.sendRaw({
      type: "relay:latency:probe",
      payload: {
        probeId,
        sentAt,
        fromPlayerId: settings.playerId,
        __relayTo: hostId,
      },
    });
  }

  private handleLatencyPong(payload: any) {
    const probeId = typeof payload?.probeId === "string" ? payload.probeId : "";
    const sentAt = typeof payload?.sentAt === "number" ? payload.sentAt : 0;
    const timeout = this.pendingLatencyProbes.get(probeId);
    if (!timeout || !sentAt) return;
    clearTimeout(timeout);
    this.pendingLatencyProbes.delete(probeId);
    this.emitLatency(Math.max(0, Date.now() - sentAt));
  }

  private emitLatency(latencyMs: number | null) {
    const payload: RoomRelayLatencyPayload = {
      latencyMs,
      mode: "guest",
      measuredAt: Date.now(),
    };
    mainWindow?.webContents.send(IPC.ROOM_EVENT, {
      type: "room:relay:latency",
      payload,
    });
  }

  private resolveConnection(result: RoomConnectResult) {
    if (this.connectionResolver) {
      this.connectionResolver(result);
      this.connectionResolver = null;
    }
  }

  send(msg: RoomMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        this.serializeRoomMessage(
          msg,
          this.relayMode ? this.getRelayHostId() : undefined,
        ),
      );
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
    this.stopLatencyProbe();
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
      this.reconnectAttempts * RoomConstants.ROOM_RECONNECT_BASE_DELAY_MS,
      RoomConstants.ROOM_RECONNECT_MAX_DELAY_MS,
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

  private serializeRoomMessage(
    msg: RoomMessage,
    relayTo?: string,
  ): string | Buffer {
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

  private deserializeRoomMessage(
    data: WebSocket.RawData,
    isBinary: boolean,
  ): RoomMessage | null {
    const rawData = this.rawDataToBuffer(data);
    if (rawData.byteLength > RoomConstants.MAX_ROOM_MESSAGE_BYTES) return null;
    if (!isBinary) {
      const msg = JSON.parse(rawData.toString()) as RoomMessage;
      if (
        this.isGameRelayMessage(msg) &&
        rawData.byteLength > RoomConstants.MAX_GAME_RELAY_MESSAGE_BYTES
      ) {
        return null;
      }
      return msg;
    }
    const decoded = decodeBinaryEnvelope<RoomMessage>(rawData);
    if (!decoded) return null;
    if (
      this.isGameRelayMessage(decoded.header) &&
      rawData.byteLength > RoomConstants.MAX_GAME_RELAY_MESSAGE_BYTES
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
    return new RegExp(
      `^${this.escapeRegExp(DEFAULT_RELAY_PUBLIC_HOST)}:\\d+$`,
      "i",
    ).test(address.trim());
  }

  private resolveRelayRoomCode(address: string) {
    return address.trim().split(":").pop() || "";
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export const roomClient = new RoomClient();
