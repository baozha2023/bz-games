import { WebSocket } from "ws";

import { decodeBinaryEnvelope, normalizeBuffer, resolveTargetPlayerId } from "../utils/protocol.js";

const FILTERABLE_CHAT_CONTENT_TYPES = new Set([undefined, "text", "mixed"]);
const BLOCKED_RELAY_CHAT_CONTENT_TYPES = new Set(["image"]);

export function createMessageRouter({ config, roomService, send, sensitiveWordService }) {
  function resolveTargets(client, payload) {
    const room = roomService.getRoom(client.roomId);
    if (!room) return [];
    const targetPlayerId = resolveTargetPlayerId(payload);
    if (!client.isHost) {
      if (targetPlayerId !== room.hostId) return [];
      const host = roomService.getClient(room.hostId);
      return host ? [host] : [];
    }
    if (targetPlayerId) {
      if (!room.clients.has(targetPlayerId)) return [];
      const target = roomService.getClient(targetPlayerId);
      return target ? [target] : [];
    }
    return Array.from(room.clients)
      .filter((playerId) => playerId !== client.playerId)
      .map((playerId) => roomService.getClient(playerId))
      .filter(Boolean);
  }

  function forwardText(client, message, rawText) {
    const targets = resolveTargets(client, message);
    const outgoingText = filterRelayChatMessage(message, rawText);
    for (const target of targets) {
      if (target.ws.readyState === WebSocket.OPEN) target.ws.send(outgoingText);
    }
    roomService.touchRoom(client.roomId);
  }

  function filterRelayChatMessage(message, rawText) {
    if (message.type !== "room:chat") return rawText;
    const payload = message.payload;
    if (!payload || typeof payload !== "object") return rawText;
    if (!FILTERABLE_CHAT_CONTENT_TYPES.has(payload.contentType)) return rawText;
    if (typeof payload.content !== "string" || !payload.content) return rawText;
    const filteredContent = sensitiveWordService.filterText(payload.content);
    if (filteredContent === payload.content) return rawText;
    return JSON.stringify({
      ...message,
      payload: {
        ...payload,
        content: filteredContent,
      },
    });
  }

  function isBlockedRelayChatMessage(message) {
    if (message.type !== "room:chat") return false;
    const payload = message.payload;
    if (!payload || typeof payload !== "object") return true;
    if (BLOCKED_RELAY_CHAT_CONTENT_TYPES.has(payload.contentType)) return true;
    if (typeof payload.content === "string" && payload.content.startsWith("data:image/")) return true;
    return Array.isArray(payload.images) && payload.images.length > 0;
  }

  function canFilterRelayChatMessage(message) {
    if (message.type !== "room:chat") return true;
    const payload = message.payload;
    if (!payload || typeof payload !== "object") return false;
    if (!FILTERABLE_CHAT_CONTENT_TYPES.has(payload.contentType)) return true;
    return sensitiveWordService.hasWords();
  }

  function forwardBinary(client, data) {
    const buffer = normalizeBuffer(data);
    if (!buffer || buffer.length > config.MAX_BINARY_BYTES) return;
    const envelope = decodeBinaryEnvelope(buffer);
    const routePayload = envelope?.header || {};
    const targets = resolveTargets(client, routePayload);
    for (const target of targets) {
      if (target.ws.readyState === WebSocket.OPEN) target.ws.send(buffer, { binary: true });
    }
    roomService.touchRoom(client.roomId);
  }

  function handleRoomControlMessage(client, message) {
    const room = roomService.getRoom(client.roomId);
    if (!room) return false;
    if (client.isHost && message.type === "room:state:sync") {
      roomService.updateRoomState(room, message.payload || {});
      return !resolveTargetPlayerId(message);
    }
    if (client.isHost && message.type === "relay:room:password:update") {
      roomService.updateRoomPassword(room, message.payload || {});
      return true;
    }
    if (client.isHost && message.type === "room:disbanded") {
      setTimeout(() => roomService.closeRoom(room.id, "relay:closed"), 50);
      return false;
    }
    if (client.isHost && (message.type === "room:kicked" || message.type === "room:join:refused")) {
      const targetPlayerId = resolveTargetPlayerId(message);
      if (targetPlayerId) {
        setTimeout(() => roomService.removeClient(roomService.getClient(targetPlayerId), false), 50);
      }
    }
    return false;
  }

  function handleTextMessage(client, message, rawText) {
    if (message.type === "relay:host") {
      roomService.registerHost(client, message.payload || {});
      return;
    }
    if (message.type === "relay:join") {
      roomService.registerGuest(client, message.payload || {});
      return;
    }
    if (message.type === "relay:room:password:probe") {
      roomService.replyRoomPasswordProbe(client.ws, message.payload || {});
      return;
    }
    if (message.type === "relay:leave") {
      roomService.removeClient(client);
      return;
    }
    if (message.type === "relay:latency:ping") {
      send(client.ws, { type: "relay:latency:pong", payload: message.payload || {} });
      roomService.touchRoom(client.roomId);
      return;
    }
    if (message.type === "relay:latency:probe" || message.type === "relay:latency:pong") {
      forwardText(client, message, rawText);
      return;
    }
    if (handleRoomControlMessage(client, message)) return;
    if (isBlockedRelayChatMessage(message)) return;
    if (!canFilterRelayChatMessage(message)) return;
    forwardText(client, message, rawText);
  }

  return {
    forwardBinary,
    handleTextMessage,
  };
}
