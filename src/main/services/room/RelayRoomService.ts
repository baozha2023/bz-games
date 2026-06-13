import { WebSocket } from "ws";
import crypto from "crypto";
import { DEFAULT_RELAY_PUBLIC_HOST, DEFAULT_RELAY_SERVER_URL, DEFAULT_RELAY_TOKEN } from "../../../shared/AppConstants";
import { roomServer } from "./RoomServer";
import { storeService } from "../storage/StoreService";
import { GameLoader } from "../game/GameLoader";
import { decodeBinaryEnvelope, encodeBinaryEnvelope } from "../../../shared/binary-protocol";
import type { RoomMessage, RoomRelayLatencyPayload } from "../../../shared/types";
import { RoomConstants } from "../../../shared/RoomConstants";
import { mainWindow } from "../../window";
import { IPC } from "../../../shared/ipc-channels";
import { requestInterceptor } from "../../utils/requestInterceptor";

export interface RelayHostResult {
  success: boolean;
  publicAddress?: string;
  error?: string;
}

export class RelayRoomService {
  private ws: WebSocket | null = null;
  private latencyTimer: NodeJS.Timeout | null = null;
  private pendingLatencyProbes: Map<string, NodeJS.Timeout> = new Map();
  private relayRoomId = "";

  async enableHostRoom(): Promise<RelayHostResult> {
    if (!roomServer.room) {
      return { success: false, error: "no_room" };
    }
    this.disconnect();
    const relayUrl = this.toWebSocketUrl(DEFAULT_RELAY_SERVER_URL);
    if (!relayUrl) {
      return { success: false, error: "relay_not_configured" };
    }
    const gameName = roomServer.room?.gameId
      ? (await GameLoader.getManifest(roomServer.room.gameId, roomServer.room.gameVersion))?.name
      : undefined;

    return new Promise((resolve) => {
      const ws = new WebSocket(requestInterceptor.buildWebSocketUrl(relayUrl), { rejectUnauthorized: false });
      this.ws = ws;
      const timeout = setTimeout(() => {
        this.disconnect();
        resolve({ success: false, error: "relay_timeout" });
      }, 10000);

      ws.once("open", () => {
        const settings = storeService.getSettings();
        const hostPlayer = roomServer.room?.players.find((player) => player.id === roomServer.room?.hostId);
        this.relayRoomId = `relay-${roomServer.room?.id || crypto.randomUUID()}`;
        ws.send(JSON.stringify({
          type: "relay:host",
          payload: {
            token: DEFAULT_RELAY_TOKEN,
            roomId: this.relayRoomId,
            playerId: settings.playerId,
            gameId: roomServer.room?.gameId,
            gameName,
            gameVersion: roomServer.room?.gameVersion,
            hostName: hostPlayer?.name || settings.playerName,
            hostStyle: hostPlayer?.nicknameStyle || settings.nicknameStyle,
            maxPlayers: roomServer.room?.maxPlayers || 4,
            state: roomServer.room?.state || "waiting",
            roomPassword: roomServer.getRoomPassword(),
          },
        }));
      });

      const handleHostAck = (data: WebSocket.RawData) => {
        clearTimeout(timeout);
        const message = this.parseMessage(data);
        if (message?.type !== "relay:host:ack") {
          this.disconnect();
          resolve({ success: false, error: message?.payload?.code || "relay_rejected" });
          return;
        }
        const roomCode = message.payload?.roomCode;
        const publicAddress = typeof roomCode === "string" ? this.toPublicAddress(roomCode) : "";
        if (roomServer.room && publicAddress) {
          roomServer.room.hostPublicAddress = publicAddress;
        }
        roomServer.setStateSyncHandler(() => this.syncRoomState());
        roomServer.broadcastState();
        this.startLatencyProbe();
        ws.off("message", handleHostAck);
        ws.on("message", (relayData, isBinary) => this.handleRelayMessage(relayData, isBinary));
        resolve({
          success: true,
          publicAddress,
        });
      };
      ws.on("message", handleHostAck);

      ws.once("error", (error) => {
        clearTimeout(timeout);
        this.disconnect();
        resolve({ success: false, error: error.message || "relay_error" });
      });
    });
  }

  disconnect() {
    this.stopLatencyProbe();
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "relay:leave", payload: {} }));
      }
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    roomServer.setStateSyncHandler(null);
    this.relayRoomId = "";
  }

  syncRoomState() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !roomServer.room) return;
    this.ws.send(JSON.stringify({ type: "room:state:sync", payload: roomServer.room }));
  }

  syncRoomPassword(password: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: "relay:room:password:update",
      payload: {
        roomId: this.relayRoomId,
        roomPassword: password.trim(),
      },
    }));
  }

  private startLatencyProbe() {
    this.stopLatencyProbe(false);
    this.sendLatencyProbe();
    this.latencyTimer = setInterval(() => this.sendLatencyProbe(), RoomConstants.RELAY_LATENCY_REFRESH_INTERVAL_MS);
  }

  private stopLatencyProbe(emitOffline = true) {
    if (this.latencyTimer) {
      clearInterval(this.latencyTimer);
      this.latencyTimer = null;
    }
    this.pendingLatencyProbes.forEach((timer) => clearTimeout(timer));
    this.pendingLatencyProbes.clear();
    if (emitOffline) this.emitLatency(null);
  }

  private sendLatencyProbe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const probeId = crypto.randomUUID();
    const sentAt = Date.now();
    const timeout = setTimeout(() => {
      this.pendingLatencyProbes.delete(probeId);
      this.emitLatency(null);
    }, RoomConstants.RELAY_LATENCY_TIMEOUT_MS);
    this.pendingLatencyProbes.set(probeId, timeout);
    this.ws.send(JSON.stringify({
      type: "relay:latency:ping",
      payload: { probeId, sentAt },
    }));
  }

  private handleRelayMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!isBinary) {
      const message = this.parseMessage(data);
      if (!message || typeof message.type !== "string") return;
      if (message.type === "relay:peer:left") {
        const playerId = message.payload?.playerId;
        if (typeof playerId === "string") roomServer.disconnectRelayPlayer(playerId);
        return;
      }
      if (message.type === "relay:latency:pong") {
        this.handleLatencyPong(message.payload);
        return;
      }
      if (message.type === "relay:latency:probe") {
        this.replyLatencyProbe(message.payload);
        return;
      }
      if (message.type.startsWith("relay:")) return;
    }
    roomServer.handleRelayRawMessage(data, isBinary, (outgoing, targetPlayerId) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Buffer.isBuffer(outgoing)) {
        this.ws.send(this.addRelayTargetToBinary(outgoing, targetPlayerId), { binary: true });
        return;
      }
      this.ws.send(this.addRelayTargetToText(outgoing, targetPlayerId));
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

  private replyLatencyProbe(payload: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const fromPlayerId = typeof payload?.fromPlayerId === "string" ? payload.fromPlayerId : "";
    if (!fromPlayerId) return;
    this.ws.send(JSON.stringify({
      type: "relay:latency:pong",
      __relayTo: fromPlayerId,
      payload: {
        probeId: payload?.probeId,
        sentAt: payload?.sentAt,
        fromPlayerId,
      },
    }));
  }

  private emitLatency(latencyMs: number | null) {
    const payload: RoomRelayLatencyPayload = {
      latencyMs,
      mode: "host",
      measuredAt: Date.now(),
    };
    mainWindow?.webContents.send(IPC.ROOM_EVENT, {
      type: "room:relay:latency",
      payload,
    });
  }

  private addRelayTargetToText(data: string, targetPlayerId?: string) {
    if (!targetPlayerId) return data;
    try {
      return JSON.stringify({ ...JSON.parse(data), __relayTo: targetPlayerId });
    } catch {
      return data;
    }
  }

  private addRelayTargetToBinary(data: Buffer, targetPlayerId?: string) {
    if (!targetPlayerId) return data;
    const decoded = decodeBinaryEnvelope<RoomMessage & { __relayTo?: string }>(data);
    if (!decoded) return data;
    return encodeBinaryEnvelope({ ...decoded.header, __relayTo: targetPlayerId }, decoded.body);
  }

  private toWebSocketUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) return trimmed;
    if (trimmed.startsWith("https://")) return `wss://${trimmed.slice("https://".length)}`;
    if (trimmed.startsWith("http://")) return `ws://${trimmed.slice("http://".length)}`;
    return `ws://${trimmed}`;
  }

  private toPublicAddress(roomCode: string) {
    return `${DEFAULT_RELAY_PUBLIC_HOST}:${roomCode}`;
  }

  private parseMessage(data: WebSocket.RawData): any {
    try {
      const raw = Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.concat(data as Buffer[]).toString("utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

export const relayRoomService = new RelayRoomService();
