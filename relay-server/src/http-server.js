import http from "node:http";

import { requireHttpRelayToken } from "./utils/relay-auth.js";
import { sendJson } from "./utils/ws.js";

export function createHttpServer({
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
}) {
  return http.createServer(async (req, res) => {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 204, null);
        return;
      }
      if (await authService.handleRequest(req, res, url)) {
        return;
      }
      if (await releaseDownloadService.handleRequest(req, res, url)) {
        return;
      }
      if (await gameHostingService.handleRequest(req, res, url)) {
        return;
      }
      if (await feedbackService.handleRequest(req, res, url)) {
        return;
      }
      if (await forumService.handleRequest(req, res, url)) {
        return;
      }
      if (await portalUserService.handleRequest(req, res, url)) {
        return;
      }
      if (await userProfileService.handleRequest(req, res, url)) {
        return;
      }
      if (await presenceService.handleRequest(req, res, url)) {
        return;
      }
      if (await systemMonitorService.handleRequest(req, res, url)) {
        return;
      }
      if (adminStaticService.handleRequest(req, res, url)) {
        return;
      }
      if (!requireHttpRelayToken(config, req, res, url)) {
        return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        roomService.cleanupExpiredRooms();
        sendJson(res, 200, {
          ok: true,
          acceptingRooms: roomService.canAcceptRoom().ok,
          roomCount: state.rooms.size,
          clientCount: state.clients.size,
          eventLoopDelayMs: state.getEventLoopDelayMs(),
          limits: {
            maxRooms: config.MAX_ROOMS,
            maxClients: config.MAX_CLIENTS,
            maxClientsPerRoom: config.MAX_CLIENTS_PER_ROOM,
            maxEventLoopDelayMs: config.MAX_EVENT_LOOP_DELAY_MS,
          },
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/rooms") {
        roomService.cleanupExpiredRooms();
        sendJson(
          res,
          200,
          Array.from(state.rooms.values()).map(roomService.toPublicRoom),
        );
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      console.error("[relay-server] http route failed", error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal_error" });
      } else {
        res.destroy();
      }
    }
  });
}
