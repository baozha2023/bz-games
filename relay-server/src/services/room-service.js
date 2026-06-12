import { normalizePassword } from "../utils/protocol.js";

export function createRoomService({ config, state, send }) {
  const { rooms, clients } = state;

  function verifyRelayToken(payload) {
    if (!config.RELAY_TOKEN) return true;
    return payload.token === config.RELAY_TOKEN;
  }

  function resolveRoom(value) {
    if (!value) return null;
    const normalized = String(value).trim();
    return Array.from(rooms.values()).find((room) => room.roomCode === normalized) || null;
  }

  function canAcceptRoom() {
    if (rooms.size >= config.MAX_ROOMS) return { ok: false, reason: "max_rooms" };
    if (clients.size >= config.MAX_CLIENTS) return { ok: false, reason: "max_clients" };
    if (state.getEventLoopDelayMs() >= config.MAX_EVENT_LOOP_DELAY_MS) return { ok: false, reason: "server_busy" };
    return { ok: true };
  }

  function canAcceptClient(room) {
    if (clients.size >= config.MAX_CLIENTS) return { ok: false, reason: "max_clients" };
    if (room.playerCount >= room.maxPlayers) return { ok: false, reason: "room_full" };
    if (room.clients.size >= Math.min(room.maxPlayers || config.MAX_CLIENTS_PER_ROOM, config.MAX_CLIENTS_PER_ROOM)) {
      return { ok: false, reason: "room_full" };
    }
    if (state.getEventLoopDelayMs() >= config.MAX_EVENT_LOOP_DELAY_MS) return { ok: false, reason: "server_busy" };
    return { ok: true };
  }

  function generateRoomCode() {
    for (let i = 0; i < 20; i += 1) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      if (!Array.from(rooms.values()).some((room) => room.roomCode === code)) return code;
    }
    return `${Date.now()}`.slice(-6);
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

  function removeClient(client, notifyHost = true) {
    if (!client || !client.playerId) return;
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

  function closeExistingClient(playerId, currentWs) {
    const existing = clients.get(playerId);
    if (!existing || existing.ws === currentWs) return;
    removeClient(existing, false);
    existing.ws.close();
  }

  function updateRoomState(room, statePayload) {
    if (typeof statePayload.gameId === "string") room.gameId = statePayload.gameId;
    if (typeof statePayload.gameName === "string") room.gameName = statePayload.gameName;
    if (typeof statePayload.gameVersion === "string") room.gameVersion = statePayload.gameVersion;
    if (typeof statePayload.hostId === "string") room.hostId = statePayload.hostId;
    if (typeof statePayload.maxPlayers === "number") room.maxPlayers = statePayload.maxPlayers;
    if (typeof statePayload.state === "string") room.state = statePayload.state;
    if (typeof statePayload.hasPassword === "boolean") room.hasPassword = statePayload.hasPassword;
    if (Array.isArray(statePayload.players)) {
      const hostPlayer = statePayload.players.find((player) => player?.id === room.hostId);
      room.hostName = hostPlayer?.name || room.hostName;
      room.hostStyle = hostPlayer?.nicknameStyle || room.hostStyle;
      room.name = `${room.hostName} 的房间`;
      room.playerCount = statePayload.players.length;
    }
    room.updatedAt = Date.now();
  }

  function updateRoomPassword(room, payload) {
    room.roomPassword = normalizePassword(payload.roomPassword);
    room.hasPassword = room.roomPassword.length > 0;
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
    const roomPassword = normalizePassword(payload.roomPassword);
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
      hasPassword: roomPassword.length > 0,
      roomPassword,
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
    const password = normalizePassword(payload.password);
    if (room.hasPassword && !password) {
      send(client.ws, { type: "relay:error", payload: { code: "password_required" } });
      return;
    }
    if (room.hasPassword && password !== room.roomPassword) {
      send(client.ws, { type: "relay:error", payload: { code: "password_incorrect" } });
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

  function replyRoomPasswordProbe(ws, payload) {
    if (!verifyRelayToken(payload)) {
      send(ws, { type: "relay:error", payload: { code: "unauthorized" } });
      return;
    }
    if (typeof payload.roomCode !== "string") {
      send(ws, { type: "relay:error", payload: { code: "invalid_join_payload" } });
      return;
    }
    const room = resolveRoom(payload.roomCode);
    if (!room) {
      send(ws, { type: "relay:error", payload: { code: "room_not_found" } });
      return;
    }
    send(ws, {
      type: "relay:room:password:probe:ack",
      payload: {
        hasPassword: Boolean(room.hasPassword),
      },
    });
  }

  function cleanupExpiredRooms() {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      if (now - room.updatedAt <= config.ROOM_TTL_MS) continue;
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
      hasPassword: room.hasPassword,
      updatedAt: room.updatedAt,
    };
  }

  return {
    canAcceptRoom,
    cleanupExpiredRooms,
    closeExistingClient,
    closeRoom,
    getClient(playerId) {
      return clients.get(playerId);
    },
    getClients() {
      return clients;
    },
    getRoom(roomId) {
      return rooms.get(roomId);
    },
    registerGuest,
    registerHost,
    removeClient,
    replyRoomPasswordProbe,
    resolveRoom,
    toPublicRoom,
    touchRoom,
    updateRoomPassword,
    updateRoomState,
    verifyRelayToken,
  };
}
