import { WebSocketServer } from "ws";

import { config } from "./config.js";
import { createHttpServer } from "./http-server.js";
import { createAuthService } from "./services/auth-service.js";
import { createAccessControlService } from "./services/access-control-service.js";
import { createRoomService } from "./services/room-service.js";
import { createMessageRouter } from "./services/message-router.js";
import { createAdminStaticService } from "./services/admin-static-service.js";
import { createMongoService } from "./services/mongo-service.js";
import { createMySqlService } from "./services/mysql-service.js";
import { createSensitiveWordService } from "./services/sensitive-word-service.js";
import { createFeedbackService } from "./services/feedback-service.js";
import { createGameHostingService } from "./services/game-hosting-service.js";
import { createReleaseDownloadService } from "./services/release-download-service.js";
import { createPortalUserService } from "./services/portal-user-service.js";
import { createSystemMonitorService } from "./services/system-monitor-service.js";
import { createUserProfileService } from "./services/user-profile-service.js";
import { createPresenceService } from "./services/presence-service.js";
import { createRateLimitService } from "./services/rate-limit-service.js";
import { createForumSearchService } from "./services/forum-search-service.js";
import { createForumService } from "./services/forum-service.js";
import { createRelayState } from "./state.js";
import { send } from "./utils/ws.js";
import { registerWebSocketHandlers } from "./ws-server.js";

const state = createRelayState();
const mongoService = createMongoService({ config });
const mySqlService = createMySqlService({ config });
const authService = createAuthService({ config, mySqlService });
const accessControlService = createAccessControlService({
  config,
  authService,
});
const rateLimitService = createRateLimitService({
  mySqlService,
  reservationTtlMs: config.RATE_LIMIT_RESERVATION_TTL_MS,
});
const feedbackService = createFeedbackService({
  config,
  mySqlService,
  mongoService,
  authService,
  accessControlService,
  rateLimitService,
});
const gameHostingService = createGameHostingService({
  config,
  mySqlService,
  accessControlService,
});
const releaseDownloadService = createReleaseDownloadService({
  config,
  accessControlService,
});
const portalUserService = createPortalUserService({
  mySqlService,
  accessControlService,
});
const userProfileService = createUserProfileService({
  config,
  authService,
  mySqlService,
});
const presenceService = createPresenceService({
  config,
  authService,
  mySqlService,
});
const systemMonitorService = createSystemMonitorService({
  config,
  state,
  accessControlService,
  mySqlService,
});
const adminStaticService = createAdminStaticService({ config });
const roomService = createRoomService({ config, state, send });
const sensitiveWordService = createSensitiveWordService();
const forumSearchService = createForumSearchService({ config });
const forumService = createForumService({
  config,
  mySqlService,
  mongoService,
  authService,
  accessControlService,
  rateLimitService,
  sensitiveWordService,
  searchService: forumSearchService,
});
const messageRouter = createMessageRouter({
  config,
  roomService,
  send,
  sensitiveWordService,
});
const server = createHttpServer({
  config,
  state,
  roomService,
  authService,
  gameHostingService,
  releaseDownloadService,
  feedbackService,
  forumService,
  portalUserService,
  userProfileService,
  presenceService,
  systemMonitorService,
  adminStaticService,
});
const wss = new WebSocketServer({
  server,
  maxPayload: config.MAX_BINARY_BYTES,
});

registerWebSocketHandlers({ wss, config, roomService, messageRouter });

if (mySqlService.isEnabled()) {
  await mySqlService.ensureReady();
}

forumService.startSearchWorker();

presenceService.start();

server.listen(config.PORT, config.HOST, () => {
  console.log(
    `BZ-Games relay server listening on ${config.HOST}:${config.PORT}`,
  );
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
