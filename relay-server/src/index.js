import { WebSocketServer } from "ws";

import { config } from "./config.js";
import { createHttpServer } from "./http-server.js";
import { createAuthService } from "./services/auth-service.js";
import { createCloudDataService } from "./services/cloud-data-service.js";
import { createRoomService } from "./services/room-service.js";
import { createMessageRouter } from "./services/message-router.js";
import { createMongoService } from "./services/mongo-service.js";
import { createMySqlService } from "./services/mysql-service.js";
import { createRelayState } from "./state.js";
import { send } from "./utils/ws.js";
import { registerWebSocketHandlers } from "./ws-server.js";

const state = createRelayState();
const mongoService = createMongoService({ config });
const mySqlService = createMySqlService({ config });
const authService = createAuthService({ config, mySqlService });
const cloudDataService = createCloudDataService({ config, authService, mongoService, mySqlService });
const roomService = createRoomService({ config, state, send });
const messageRouter = createMessageRouter({ config, roomService, send });
const server = createHttpServer({ config, state, roomService, authService, cloudDataService });
const wss = new WebSocketServer({ server, maxPayload: config.MAX_BINARY_BYTES });

registerWebSocketHandlers({ wss, config, roomService, messageRouter });

server.listen(config.PORT, () => {
  console.log(`BZ-Games relay server listening on ${config.PORT}`);
});

setInterval(() => {
  for (const client of state.clients.values()) {
    if (!client.isAlive) {
      client.ws.terminate();
      roomService.removeClient(client);
      continue;
    }
    client.isAlive = false;
    client.ws.ping();
  }
  roomService.cleanupExpiredRooms();
}, config.HEARTBEAT_INTERVAL_MS).unref();

setInterval(() => {
  state.updateEventLoopDelay();
}, 1000).unref();
