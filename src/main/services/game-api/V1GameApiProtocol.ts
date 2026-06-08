import type { WebSocket } from "ws";
import crypto from "crypto";
import { GameApiErrorCode, type GameApiRequest, type GameRelayPayload } from "../../../shared/types";
import type { GameApiServer } from "./GameApiServer";
import { storeService } from "../storage/StoreService";
import { roomServer } from "../room/RoomServer";
import { roomClient } from "../room/RoomClient";
import { RoomConstants } from "../../../shared/RoomConstants";

type BinaryRelayPayload = GameRelayPayload & { binaryData?: Buffer };

export class V1GameApiProtocol {
  constructor(private readonly server: GameApiServer) {}

  handleRequest(ws: WebSocket, req: GameApiRequest) {
    if (req.action !== "message.send" && req.action !== "message.broadcast") {
      this.server.sendError(ws, req.id, req.action, {
        code: GameApiErrorCode.UnknownAction,
        message: "Unknown v1 communication action",
        detail: { action: req.action },
      });
      return;
    }
    this.handleRelayMessage(ws, req);
  }

  private handleRelayMessage(ws: WebSocket, req: GameApiRequest) {
    const settings = storeService.getSettings();
    const isHost = roomServer.room?.hostId === settings.playerId;
    const room = isHost ? roomServer.room : roomClient.room;
    if (!room) {
      this.server.sendError(ws, req.id, req.action, {
        code: GameApiErrorCode.NotInRoom,
        message: "Not in room",
      });
      return;
    }

    const relayType =
      req.action === "message.send" ? "game:message:relay" : "game:broadcast:relay";
    const relayPayload = this.normalizeRelayPayload(
      req.payload,
      settings.playerId,
    );

    if (req.action === "message.send") {
      const targetPlayerId = this.resolveTargetPlayerId(relayPayload);
      if (!targetPlayerId) {
        this.server.sendError(ws, req.id, req.action, {
          code: GameApiErrorCode.MissingTarget,
          message: "Missing target player id (to/targetPlayerId)",
        });
        return;
      }
      if (targetPlayerId === settings.playerId) {
        this.server.sendError(ws, req.id, req.action, {
          code: GameApiErrorCode.TargetSelf,
          message: "Cannot send to self",
          detail: { targetPlayerId },
        });
        return;
      }
      if (!this.hasPlayer(room, targetPlayerId)) {
        this.server.sendError(ws, req.id, req.action, {
          code: GameApiErrorCode.TargetNotFound,
          message: "Target player is not in room",
          detail: { targetPlayerId },
        });
        return;
      }
    }

    this.relayMessage(isHost, settings.playerId, relayType, relayPayload);
    this.server.sendResponse(ws, req.id, req.action, { success: true });
  }

  private relayMessage(
    isHost: boolean,
    senderId: string,
    relayType: "game:message:relay" | "game:broadcast:relay",
    relayPayload: BinaryRelayPayload,
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

  private normalizeRelayPayload(
    payload: unknown,
    senderId: string,
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
    const contentType = this.normalizeContentType(rawPayload.contentType, rawPayload.data);
    const normalized: BinaryRelayPayload = {
      ...rawPayload,
      senderId,
      messageId,
      sentAt,
      contentType,
    };
    delete normalized.reliable;
    delete normalized.binary;
    delete normalized.byteLength;
    delete normalized.messages;
    delete normalized.channel;
    delete normalized.mode;
    delete normalized.delivery;
    delete normalized.seq;
    delete normalized.binaryData;
    return normalized;
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
    return value.length > RoomConstants.BASE64_DETECTION_MIN_LENGTH && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
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

  private hasPlayer(room: { players?: Array<{ id: string }> }, playerId: string) {
    return Array.isArray(room.players) && room.players.some((player) => player.id === playerId);
  }
}
