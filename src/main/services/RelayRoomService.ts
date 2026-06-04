import { WebSocket } from "ws";
import crypto from "crypto";
import { DEFAULT_RELAY_PUBLIC_HOST, DEFAULT_RELAY_SERVER_URL, DEFAULT_RELAY_TOKEN } from "../../shared/constants";
import { roomServer } from "./RoomServer";
import { storeService } from "./StoreService";
import { GameLoader } from "./GameLoader";
import { decodeBinaryEnvelope, encodeBinaryEnvelope } from "../../shared/binary-protocol";
import type { RoomMessage } from "../../shared/types";

export interface RelayHostResult {
  success: boolean;
  publicAddress?: string;
  error?: string;
}

export class RelayRoomService {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
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
      const ws = new WebSocket(relayUrl, { rejectUnauthorized: false });
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
            maxPlayers: roomServer.room?.maxPlayers || 4,
            state: roomServer.room?.state || "waiting",
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
          roomServer.broadcastState();
        }
        this.startHeartbeat();
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
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "relay:leave", payload: {} }));
      }
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.relayRoomId = "";
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "relay:heartbeat", payload: { roomId: this.relayRoomId } }));
    }, 25000);
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
