import type { WebSocket } from "ws";
import crypto from "crypto";
import { GameApiErrorCode, type GameApiRequest, type GameRelayPayload } from "../../../shared/types";
import { decodeBinaryEnvelope, toBinaryBody } from "../../../shared/binary-protocol";
import type { GameApiServer } from "./GameApiServer";
import { storeService } from "../storage/StoreService";
import { roomServer } from "../room/RoomServer";
import { roomClient } from "../room/RoomClient";
import { RoomConstants } from "../../../shared/RoomConstants";

type BinaryRelayPayload = GameRelayPayload & { binaryData?: Buffer };

export class V2GameApiProtocol {
  constructor(private readonly server: GameApiServer) {}

  handleRequest(ws: WebSocket, req: GameApiRequest) {
    switch (req.action) {
      case "message.send":
      case "message.broadcast":
      case "message.publish":
      case "message.batch":
        this.handleRelayMessage(ws, req);
        break;
      case "message.subscribe":
        this.handleSubscribe(ws, req);
        break;
      case "message.unsubscribe":
        this.handleUnsubscribe(ws, req);
        break;
      default:
        this.server.sendError(ws, req.id, req.action, {
          code: GameApiErrorCode.UnknownAction,
          message: "Unknown v2 communication action",
          detail: { action: req.action },
        });
    }
  }

  handleBinaryRequest(ws: WebSocket, data: Buffer) {
    if (data.length > RoomConstants.GAME_API_MAX_BINARY_BYTES) {
      this.server.sendError(ws, "", "message.publish", {
        code: GameApiErrorCode.MessageTooLarge,
        message: "Binary message payload is too large",
        detail: { maxBinaryBytes: RoomConstants.GAME_API_MAX_BINARY_BYTES },
      });
      return;
    }
    const decoded = decodeBinaryEnvelope<GameApiRequest>(data);
    if (!decoded) {
      this.server.sendError(ws, "", "message.publish", {
        code: GameApiErrorCode.InvalidPayload,
        message: "Invalid binary message payload",
      });
      return;
    }
    const { header, body } = decoded;
    if (
      header.type !== "request" ||
      (header.action !== "message.send" &&
        header.action !== "message.broadcast" &&
        header.action !== "message.publish")
    ) {
      this.server.sendError(ws, header.id || "", header.action || "message.publish", {
        code: GameApiErrorCode.InvalidPayload,
        message: "Binary frames only support message.send/message.broadcast/message.publish",
      });
      return;
    }
    this.handleRelayMessage(ws, header, body);
  }

  private handleRelayMessage(ws: WebSocket, req: GameApiRequest, binaryBody?: Buffer) {
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
      binaryBody,
    );
    if (req.action === "message.send") {
      const toPlayerId = this.resolveTo(relayPayload);
      if (!toPlayerId) {
        this.server.sendError(ws, req.id, req.action, {
          code: GameApiErrorCode.MissingTarget,
          message: "Missing target player id (to)",
        });
        return;
      }
      if (toPlayerId === settings.playerId) {
        this.server.sendError(ws, req.id, req.action, {
          code: GameApiErrorCode.TargetSelf,
          message: "Cannot send to self",
          detail: { to: toPlayerId },
        });
        return;
      }
      if (!this.hasPlayer(room, toPlayerId)) {
        this.server.sendError(ws, req.id, req.action, {
          code: GameApiErrorCode.TargetNotFound,
          message: "Target player is not in room",
          detail: { to: toPlayerId },
        });
        return;
      }
    }

    this.relayMessage(isHost, settings.playerId, relayType, relayPayload);
    this.server.sendResponse(ws, req.id, req.action, { success: true });
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
      this.server.sendError(ws, req.id, req.action, {
        code: GameApiErrorCode.EmptyBatch,
        message: "Missing messages",
      });
      return;
    }
    if (messages.length > RoomConstants.GAME_API_MAX_BATCH_MESSAGES) {
      this.server.sendError(ws, req.id, req.action, {
        code: GameApiErrorCode.BatchTooLarge,
        message: "Too many messages in batch",
        detail: { maxBatchMessages: RoomConstants.GAME_API_MAX_BATCH_MESSAGES },
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
    mode: GameRelayPayload["mode"],
    binaryBody?: Buffer,
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
    const inlineBinary = toBinaryBody(rawPayload.data);
    const finalBinaryBody = binaryBody || inlineBinary || undefined;
    const contentType = finalBinaryBody
      ? "binary"
      : this.normalizeContentType(rawPayload.contentType, rawPayload.data);
    const normalized: BinaryRelayPayload = {
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
    if (finalBinaryBody) {
      normalized.binary = true;
      normalized.byteLength = finalBinaryBody.byteLength;
      normalized.binaryData = finalBinaryBody;
      delete normalized.data;
    } else {
      delete normalized.binary;
      delete normalized.byteLength;
      delete normalized.binaryData;
    }
    delete normalized.targetPlayerId;
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
    return value.length > RoomConstants.BASE64_DETECTION_MIN_LENGTH && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  private handleSubscribe(ws: WebSocket, req: GameApiRequest) {
    const channels = this.getChannelsFromPayload(req.payload);
    if (!channels.length) {
      this.server.sendError(ws, req.id, req.action, {
        code: GameApiErrorCode.InvalidPayload,
        message: "Missing channels",
      });
      return;
    }
    const current = this.server.getClientChannels(ws);
    channels.forEach((channel) => current.add(channel));
    this.server.setClientChannels(ws, current);
    this.server.sendResponse(ws, req.id, req.action, { success: true, channels: Array.from(current) });
  }

  private handleUnsubscribe(ws: WebSocket, req: GameApiRequest) {
    const channels = this.getChannelsFromPayload(req.payload);
    const current = this.server.getClientChannels(ws);
    channels.forEach((channel) => current.delete(channel));
    if (current.size === 0) current.add("*");
    this.server.setClientChannels(ws, current);
    this.server.sendResponse(ws, req.id, req.action, { success: true, channels: Array.from(current) });
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

  private resolveTo(payload: Record<string, unknown>) {
    const to = payload.to;
    if (typeof to === "string" && to.length > 0) return to;
    return undefined;
  }

  private hasPlayer(room: { players?: Array<{ id: string }> }, playerId: string) {
    return Array.isArray(room.players) && room.players.some((player) => player.id === playerId);
  }
}
