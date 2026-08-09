import assert from "node:assert/strict";
import test from "node:test";

import { createAccessControlService } from "../src/services/access-control-service.js";

function response() {
  return {
    status: 0,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

test("portal access distinguishes players, creators, and administrators", async () => {
  let role = "player";
  const service = createAccessControlService({
    config: { PORTAL_PUBLIC_URL: "https://games.example/admin/" },
    authService: {
      getSessionFromRequest: async () => ({ status: "authenticated", auth: { user: { id: 1, role } } }),
      sendAuthFailure: () => {},
    },
  });
  const player = await service.requireAuthenticated({}, response());
  assert.equal(player.isAdmin, false);
  const playerDenied = response();
  assert.equal(await service.requireCreator({}, playerDenied), null);
  assert.equal(playerDenied.status, 403);
  role = "creator";
  const creator = await service.requireCreator({}, response());
  assert.equal(creator.isAdmin, false);
  const denied = response();
  assert.equal(await service.requireAdmin({}, denied), null);
  assert.equal(denied.status, 403);
  role = "administrator";
  assert.equal((await service.requireCreator({}, response())).isAdmin, true);
  assert.equal((await service.requireAdmin({}, response())).isAdmin, true);
});

test("cookie writes require the exact portal origin", () => {
  const service = createAccessControlService({
    config: { PORTAL_PUBLIC_URL: "https://games.example/admin/" },
    authService: {},
  });
  assert.equal(service.requirePortalOrigin({ headers: {} }, response()), true);
  const missing = response();
  assert.equal(service.requirePortalOrigin({ headers: { cookie: "session=x" } }, missing), false);
  assert.equal(missing.status, 403);
  const foreign = response();
  assert.equal(service.requirePortalOrigin({ headers: { cookie: "session=x", origin: "https://evil.example" } }, foreign), false);
  assert.equal(service.requirePortalOrigin({ headers: { cookie: "session=x", origin: "https://games.example" } }, response()), true);
});
