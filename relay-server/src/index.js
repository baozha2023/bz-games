import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 38090);
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 60000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
const MAX_TEXT_BYTES = Number(process.env.MAX_TEXT_BYTES || 1024 * 1024);
const MAX_BINARY_BYTES = Number(process.env.MAX_BINARY_BYTES || 12 * 1024 * 1024);
const RELAY_TOKEN = (process.env.RELAY_TOKEN || "").trim();
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 80);
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS || 400);
const MAX_CLIENTS_PER_ROOM = Number(process.env.MAX_CLIENTS_PER_ROOM || 8);
const MAX_EVENT_LOOP_DELAY_MS = Number(process.env.MAX_EVENT_LOOP_DELAY_MS || 250);

const rooms = new Map();
const clients = new Map();
let eventLoopDelayMs = 0;
let lastEventLoopCheckAt = Date.now();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    sendJson(res, 204, null);
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    cleanupExpiredRooms();
    sendJson(res, 200, {
      ok: true,
      acceptingRooms: canAcceptRoom().ok,
      roomCount: rooms.size,
      clientCount: clients.size,
      eventLoopDelayMs,
      limits: {
        maxRooms: MAX_ROOMS,
        maxClients: MAX_CLIENTS,
        maxClientsPerRoom: MAX_CLIENTS_PER_ROOM,
        maxEventLoopDelayMs: MAX_EVENT_LOOP_DELAY_MS,
      },
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/rooms") {
    cleanupExpiredRooms();
    sendJson(res, 200, Array.from(rooms.values()).map(toPublicRoom));
    return;
  }
  sendJson(res, 404, { error: "not_found" });
});

const wss = new WebSocketServer({ server, maxPayload: MAX_BINARY_BYTES });

wss.on("connection", (ws) => {
  const client = {
    ws,
    playerId: "",
    roomId: "",
    isHost: false,
    isAlive: true,
  };

  ws.on("pong", () => {
    client.isAlive = true;
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      forwardBinary(client, data);
      return;
    }
    const text = data.toString("utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) return;
    const message = parseJson(text);
    if (!message || typeof message.type !== "string") return;
    handleTextMessage(client, message, text);
  });

  ws.on("close", () => removeClient(client));
  ws.on("error", () => removeClient(client));
});

server.listen(PORT, () => {
  console.log(`BZ-Games relay server listening on ${PORT}`);
});

setInterval(() => {
  for (const client of clients.values()) {
    if (!client.isAlive) {
      client.ws.terminate();
      removeClient(client);
      continue;
    }
    client.isAlive = false;
    client.ws.ping();
  }
  cleanupExpiredRooms();
}, HEARTBEAT_INTERVAL_MS).unref();

setInterval(() => {
  const now = Date.now();
  eventLoopDelayMs = Math.max(0, now - lastEventLoopCheckAt - 1000);
  lastEventLoopCheckAt = now;
}, 1000).unref();

function handleTextMessage(client, message, rawText) {
  if (message.type === "relay:host") {
    registerHost(client, message.payload || {});
    return;
  }
  if (message.type === "relay:join") {
    registerGuest(client, message.payload || {});
    return;
  }
  if (message.type === "relay:leave") {
    removeClient(client);
    return;
  }
  if (message.type === "relay:latency:ping") {
    send(client.ws, { type: "relay:latency:pong", payload: message.payload || {} });
    touchRoom(client.roomId);
    return;
  }
  if (message.type === "relay:latency:probe" || message.type === "relay:latency:pong") {
    forwardText(client, message, rawText);
    return;
  }
  if (handleRoomControlMessage(client, message)) return;
  forwardText(client, message, rawText);
}

function handleRoomControlMessage(client, message) {
  const room = rooms.get(client.roomId);
  if (!room) return false;
  if (client.isHost && message.type === "room:state:sync") {
    updateRoomState(room, message.payload || {});
    return !resolveTargetPlayerId(message);
  }
  if (client.isHost && message.type === "room:disbanded") {
    setTimeout(() => closeRoom(room.id, "relay:closed"), 50);
    return false;
  }
  if (client.isHost && (message.type === "room:kicked" || message.type === "room:join:refused")) {
    const targetPlayerId = resolveTargetPlayerId(message);
    if (targetPlayerId) setTimeout(() => removeClient(clients.get(targetPlayerId), false), 50);
  }
  return false;
}

function updateRoomState(room, state) {
  if (typeof state.gameId === "string") room.gameId = state.gameId;
  if (typeof state.gameName === "string") room.gameName = state.gameName;
  if (typeof state.gameVersion === "string") room.gameVersion = state.gameVersion;
  if (typeof state.hostId === "string") room.hostId = state.hostId;
  if (typeof state.maxPlayers === "number") room.maxPlayers = state.maxPlayers;
  if (typeof state.state === "string") room.state = state.state;
  if (Array.isArray(state.players)) {
    const hostPlayer = state.players.find((player) => player?.id === room.hostId);
    room.hostName = hostPlayer?.name || room.hostName;
    room.hostStyle = hostPlayer?.nicknameStyle || room.hostStyle;
    room.name = `${room.hostName} 的房间`;
    room.playerCount = state.players.length;
  }
  room.updatedAt = Date.now();
}

function registerHost(client, payload) {
  if (!verifyRelayToken(payload)) {
    send(client.ws, { type: "relay:error", payload: { code: "unauthorized" } });
    return;
  }
  if (
    typeof payload.roomId !== "string" ||
    typeof payload.playerId !== "string" ||
    typeof payload.gameId !== "string" ||
    typeof payload.gameVersion !== "string"
  ) {
    send(client.ws, { type: "relay:error", payload: { code: "invalid_host_payload" } });
    return;
  }

  const existingRoom = rooms.get(payload.roomId);
  if (!existingRoom) {
    const capacity = canAcceptRoom();
    if (!capacity.ok) {
      send(client.ws, { type: "relay:error", payload: { code: "capacity_full", reason: capacity.reason } });
      return;
    }
  }

  closeExistingClient(payload.playerId, client.ws);
  removeClient(client, false);
  client.playerId = payload.playerId;
  client.roomId = payload.roomId;
  client.isHost = true;
  clients.set(client.playerId, client);

  const roomCode = existingRoom?.roomCode || generateRoomCode();
  rooms.set(client.roomId, {
    id: payload.roomId,
    source: "relay",
    roomCode,
    name: `${payload.hostName || payload.playerId} 的房间`,
    gameId: payload.gameId,
    gameName: payload.gameName || payload.gameId,
    gameVersion: payload.gameVersion,
    hostId: payload.playerId,
    hostName: payload.hostName || payload.playerId,
    hostStyle: payload.hostStyle,
    playerCount: Number(payload.playerCount || 1),
    maxPlayers: Number(payload.maxPlayers || 4),
    state: payload.state || "waiting",
    updatedAt: Date.now(),
    clients: new Set([payload.playerId]),
  });

  send(client.ws, {
    type: "relay:host:ack",
    payload: {
      roomCode,
    },
  });
}

function registerGuest(client, payload) {
  if (!verifyRelayToken(payload)) {
    send(client.ws, { type: "relay:error", payload: { code: "unauthorized" } });
    return;
  }
  if (typeof payload.roomCode !== "string" || typeof payload.playerId !== "string") {
    send(client.ws, { type: "relay:error", payload: { code: "invalid_join_payload" } });
    return;
  }
  const room = resolveRoom(payload.roomCode);
  if (!room) {
    send(client.ws, { type: "relay:error", payload: { code: "room_not_found" } });
    return;
  }
  if (payload.playerId === room.hostId) {
    send(client.ws, { type: "relay:error", payload: { code: "own_room" } });
    return;
  }
  if (!clients.get(room.hostId)) {
    closeRoom(room.id, "relay:closed");
    send(client.ws, { type: "relay:error", payload: { code: "room_not_found" } });
    return;
  }
  if (room.state !== "waiting") {
    send(client.ws, { type: "relay:error", payload: { code: "game_started" } });
    return;
  }

  const capacity = canAcceptClient(room);
  if (!capacity.ok) {
    send(client.ws, { type: "relay:error", payload: { code: "capacity_full", reason: capacity.reason } });
    return;
  }

  closeExistingClient(payload.playerId, client.ws);
  removeClient(client, false);
  client.playerId = payload.playerId;
  client.roomId = room.id;
  client.isHost = false;
  clients.set(client.playerId, client);
  room.clients.add(client.playerId);
  room.playerCount = room.clients.size;
  room.updatedAt = Date.now();

  send(client.ws, { type: "relay:join:ack", payload: { hostId: room.hostId } });
}

function forwardText(client, message, rawText) {
  const targets = resolveTargets(client, message);
  for (const target of targets) {
    if (target.ws.readyState === WebSocket.OPEN) target.ws.send(rawText);
  }
  touchRoom(client.roomId);
}

function forwardBinary(client, data) {
  const buffer = normalizeBuffer(data);
  if (!buffer || buffer.length > MAX_BINARY_BYTES) return;
  const envelope = decodeBinaryEnvelope(buffer);
  const routePayload = envelope?.header || {};
  const targets = resolveTargets(client, routePayload);
  for (const target of targets) {
    if (target.ws.readyState === WebSocket.OPEN) target.ws.send(buffer, { binary: true });
  }
  touchRoom(client.roomId);
}

function resolveTargets(client, payload) {
  const room = rooms.get(client.roomId);
  if (!room) return [];
  const targetPlayerId = resolveTargetPlayerId(payload);
  if (!client.isHost) {
    if (targetPlayerId !== room.hostId) return [];
    const host = clients.get(room.hostId);
    return host ? [host] : [];
  }
  if (targetPlayerId) {
    if (!room.clients.has(targetPlayerId)) return [];
    const target = clients.get(targetPlayerId);
    return target ? [target] : [];
  }
  return Array.from(room.clients)
    .filter((playerId) => playerId !== client.playerId)
    .map((playerId) => clients.get(playerId))
    .filter(Boolean);
}

function resolveTargetPlayerId(payload) {
  return payload.__relayTo || payload.relayTo || payload.to || payload.targetPlayerId || payload.payload?.__relayTo;
}

function removeClient(client, notifyHost = true) {
  if (!client) return;
  if (!client.playerId) return;
  clients.delete(client.playerId);
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.clients.delete(client.playerId);
  room.playerCount = room.clients.size;
  room.updatedAt = Date.now();

  if (client.isHost || room.clients.size === 0) {
    closeRoom(room.id, "relay:closed");
    return;
  }

  if (notifyHost) {
    send(clients.get(room.hostId)?.ws, {
      type: "relay:peer:left",
      payload: { roomId: room.id, playerId: client.playerId },
    });
  }
}

function closeRoom(roomId, type) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const playerId of room.clients) {
    const target = clients.get(playerId);
    send(target?.ws, { type, payload: { roomId } });
    target?.ws.close();
    clients.delete(playerId);
  }
  rooms.delete(roomId);
}

function closeExistingClient(playerId, currentWs) {
  const existing = clients.get(playerId);
  if (!existing || existing.ws === currentWs) return;
  removeClient(existing, false);
  existing.ws.close();
}

function verifyRelayToken(payload) {
  if (!RELAY_TOKEN) return true;
  return payload.token === RELAY_TOKEN;
}

function resolveRoom(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  return Array.from(rooms.values()).find((room) => room.roomCode === normalized) || null;
}

function canAcceptRoom() {
  if (rooms.size >= MAX_ROOMS) return { ok: false, reason: "max_rooms" };
  if (clients.size >= MAX_CLIENTS) return { ok: false, reason: "max_clients" };
  if (eventLoopDelayMs >= MAX_EVENT_LOOP_DELAY_MS) return { ok: false, reason: "server_busy" };
  return { ok: true };
}

function canAcceptClient(room) {
  if (clients.size >= MAX_CLIENTS) return { ok: false, reason: "max_clients" };
  if (room.playerCount >= room.maxPlayers) return { ok: false, reason: "room_full" };
  if (room.clients.size >= Math.min(room.maxPlayers || MAX_CLIENTS_PER_ROOM, MAX_CLIENTS_PER_ROOM)) {
    return { ok: false, reason: "room_full" };
  }
  if (eventLoopDelayMs >= MAX_EVENT_LOOP_DELAY_MS) return { ok: false, reason: "server_busy" };
  return { ok: true };
}

function generateRoomCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!Array.from(rooms.values()).some((room) => room.roomCode === code)) return code;
  }
  return `${Date.now()}`.slice(-6);
}

function cleanupExpiredRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.updatedAt <= ROOM_TTL_MS) continue;
    closeRoom(roomId, "relay:closed");
  }
}

function touchRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) room.updatedAt = Date.now();
}

function toPublicRoom(room) {
  return {
    id: room.roomCode,
    source: room.source,
    roomCode: room.roomCode,
    name: room.name,
    gameId: room.gameId,
    gameName: room.gameName,
    gameVersion: room.gameVersion,
    hostId: room.hostId,
    hostName: room.hostName,
    hostStyle: room.hostStyle,
    playerCount: room.playerCount,
    maxPlayers: room.maxPlayers,
    state: room.state,
    updatedAt: room.updatedAt,
  };
}

function decodeBinaryEnvelope(buffer) {
  if (buffer.length < 4) return null;
  const headerLength = buffer.readUInt32BE(0);
  if (headerLength <= 0 || headerLength > buffer.length - 4) return null;
  try {
    return {
      header: JSON.parse(buffer.subarray(4, 4 + headerLength).toString("utf8")),
      body: buffer.subarray(4 + headerLength),
    };
  } catch {
    return null;
  }
}

function normalizeBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function send(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  if (status === 204) {
    res.end();
    return;
  }
  res.end(JSON.stringify(body));
}
