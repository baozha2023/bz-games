import assert from "node:assert/strict";
import test from "node:test";

import { createAccessControlService } from "../src/services/access-control-service.js";
import {
  getCapabilities,
  hasCapability,
  PORTAL_CAPABILITIES,
} from "../src/services/portal-authorization.js";

function response() {
  return {
    status: 0,
    body: "",
    writeHead(status) { this.status = status; },
    end(body = "") { this.body = body; },
  };
}

const expected = {
  player: [],
  creator: [
    "hosting.view",
    "hosting.game.create",
    "hosting.version.create",
    "hosting.own.manage",
  ],
  administrator: [
    "feedback.view",
    "feedback.manage",
    "users.view",
    "hosting.view",
    "hosting.game.create",
    "hosting.version.create",
    "hosting.all.manage",
    "hosting.review",
    "hosting.publish.direct",
    "release.view",
  ],
  super_administrator: Object.values(PORTAL_CAPABILITIES),
};

test("the server owns the complete role capability matrix", () => {
  for (const [role, capabilities] of Object.entries(expected)) {
    assert.deepEqual(getCapabilities(role), capabilities);
    for (const capability of Object.values(PORTAL_CAPABILITIES)) {
      assert.equal(hasCapability(role, capability), capabilities.includes(capability));
    }
  }
  assert.deepEqual(getCapabilities("unknown"), []);
  assert.equal(hasCapability("super_administrator", "unknown"), false);
});

test("portal capability checks fail closed", async () => {
  let role = "player";
  const service = createAccessControlService({
    config: { PORTAL_PUBLIC_URL: "https://games.example/admin/" },
    authService: {
      getPortalSessionFromRequest: async () => ({
        status: "authenticated",
        auth: { user: { id: 1, role } },
      }),
      sendAuthFailure: () => {},
    },
  });
  const denied = response();
  assert.equal(await service.requireCapability({ headers: {} }, denied, "hosting.view"), null);
  assert.equal(denied.status, 403);
  role = "creator";
  const auth = await service.requireCapability({ headers: {} }, response(), "hosting.view");
  assert.equal(auth.can("hosting.own.manage"), true);
  assert.equal(auth.can("hosting.all.manage"), false);
});

test("portal writes require the exact configured origin", async () => {
  const service = createAccessControlService({
    config: { PORTAL_PUBLIC_URL: "https://games.example/admin/" },
    authService: {
      getPortalSessionFromRequest: async () => ({
        status: "authenticated",
        auth: { user: { id: 1, role: "super_administrator" } },
      }),
      sendAuthFailure: () => {},
    },
  });
  for (const headers of [
    {},
    { origin: "https://evil.example" },
  ]) {
    const denied = response();
    assert.equal(
      await service.requireCapability(
        { headers },
        denied,
        "feedback.manage",
        { requireOrigin: true },
      ),
      null,
    );
    assert.equal(denied.status, 403);
  }
  assert.notEqual(
    await service.requireCapability(
      { headers: { origin: "https://games.example" } },
      response(),
      "feedback.manage",
      { requireOrigin: true },
    ),
    null,
  );
});
