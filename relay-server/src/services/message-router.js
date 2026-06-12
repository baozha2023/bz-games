import { WebSocket } from "ws";

import { decodeBinaryEnvelope, normalizeBuffer, resolveTargetPlayerId } from "../utils/protocol.js";

export function createMessageRouter({ config, roomService, send }) {
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
    for (const target of targets) {
      if (target.ws.readyState === WebSocket.OPEN) target.ws.send(rawText);
    }
    roomService.touchRoom(client.roomId);
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
    forwardText(client, message, rawText);
  }

  return {
    forwardBinary,
    handleTextMessage,
  };
}
