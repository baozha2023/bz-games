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

type ConnectResult = { success: boolean; error?: string; message?: string };

export class RoomClient {
  private static readonly MAX_RECENT_MESSAGE_IDS = 1000;
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
  private readonly maxReconnectAttempts = 5;

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
    if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      url = `ws://${url}`;
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
      }, 15000);
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
    this.ws.on("message", (data) => this.handleIncomingMessage(data));
  }

  private handleOpen() {
    this.clearReconnectTimer();
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

  private handleIncomingMessage(data: any) {
    try {
      const msg = JSON.parse(data.toString()) as RoomMessage;
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
    while (this.recentMessageIds.length > RoomClient.MAX_RECENT_MESSAGE_IDS) {
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
    const delay = Math.min(this.reconnectAttempts * 2000, 10000);
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
}

export const roomClient = new RoomClient();
