import assert from "node:assert/strict";
import test from "node:test";

import { createRoomService } from "../src/services/room-service.js";

function createHarness(maxClientsPerRoom = 10) {
  const state = {
    rooms: new Map(),
    clients: new Map(),
    getEventLoopDelayMs: () => 0,
  };
  const messages = new Map();
  const service = createRoomService({
    config: {
      RELAY_TOKEN: "test-token",
      MAX_ROOMS: 80,
      MAX_CLIENTS: 400,
      MAX_CLIENTS_PER_ROOM: maxClientsPerRoom,
      MAX_EVENT_LOOP_DELAY_MS: 250,
      ROOM_TTL_MS: 60_000,
    },
    state,
    send(ws, message) {
      messages.set(ws, message);
    },
  });
  function client() {
    return {
      ws: { close() {} },
      playerId: "",
      roomId: "",
      isHost: false,
    };
  }
  return { state, messages, service, client };
}

test("official relay admits ten clients and rejects the eleventh", () => {
  const app = createHarness();
  const host = app.client();
  app.service.registerHost(host, {
    token: "test-token",
    roomId: "room-10",
    playerId: "host",
    hostName: "Host",
    gameId: "com.example.game",
    gameVersion: "1.0.0",
    maxPlayers: 20,
  });
  const room = app.service.getRoom("room-10");
  assert.ok(room);

  for (let index = 1; index <= 9; index += 1) {
    const guest = app.client();
    app.service.registerGuest(guest, {
      token: "test-token",
      roomCode: room.roomCode,
      playerId: `guest-${index}`,
    });
    assert.equal(app.messages.get(guest.ws)?.type, "relay:join:ack");
  }
  assert.equal(room.clients.size, 10);
  assert.equal(room.playerCount, 10);

  const overflowGuest = app.client();
  app.service.registerGuest(overflowGuest, {
    token: "test-token",
    roomCode: room.roomCode,
    playerId: "guest-10",
  });
  assert.deepEqual(app.messages.get(overflowGuest.ws), {
    type: "relay:error",
    payload: { code: "capacity_full", reason: "room_full" },
  });
  assert.equal(room.clients.size, 10);
});
