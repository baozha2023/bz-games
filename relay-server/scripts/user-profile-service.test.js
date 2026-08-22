import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createUserProfileService } from "../src/services/user-profile-service.js";

async function harness() {
  const updates = [];
  const service = createUserProfileService({
    config: { RELAY_TOKEN: "relay-token" },
    mySqlService: {
      isEnabled: () => true,
      ensureReady: async () => {},
      query: async (sql, params = []) => {
        if (sql.startsWith("UPDATE users SET nickname")) {
          updates.push(params);
          return [{ affectedRows: 1 }];
        }
        throw new Error(`unexpected_query:${sql}`);
      },
    },
    authService: {
      getClientSessionFromRequest: async (req) => {
        if (req.headers.authorization === "Bearer valid-token") {
          return { status: "authenticated", auth: { user: { id: 27 } } };
        }
        return { status: "missing" };
      },
      sendAuthFailure: (res, status) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: status }));
      },
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    updates,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function updateProfile(app, body, headers = {}) {
  return fetch(`${app.baseUrl}/api/v1/me/profile`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-relay-token": "relay-token",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("profile updates require a client bearer session", async () => {
  const app = await harness();
  try {
    assert.equal((await updateProfile(app, { nickname: "昵称" })).status, 401);
    assert.equal(
      (
        await updateProfile(app, { nickname: "昵称" }, {
          "x-relay-token": "invalid-token",
          authorization: "Bearer valid-token",
        })
      ).status,
      401,
    );
  } finally {
    await app.close();
  }
});

test("profile updates validate exact request shape and nickname rules", async () => {
  const app = await harness();
  try {
    const headers = { authorization: "Bearer valid-token" };
    assert.equal((await updateProfile(app, {} , headers)).status, 400);
    assert.equal(
      (await updateProfile(app, { nickname: "" }, headers)).status,
      400,
    );
    assert.equal(
      (await updateProfile(app, { nickname: "a".repeat(17) }, headers)).status,
      400,
    );
    assert.equal(
      (await updateProfile(app, { nickname: "bad/name" }, headers)).status,
      400,
    );
    assert.equal(
      (await updateProfile(app, { nickname: "昵称", userId: 1 }, headers)).status,
      400,
    );
  } finally {
    await app.close();
  }
});

test("profile updates only the authenticated user", async () => {
  const app = await harness();
  try {
    const response = await updateProfile(app, { nickname: "新的昵称" }, {
      authorization: "Bearer valid-token",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      user: { id: "27", nickname: "新的昵称" },
    });
    assert.equal(app.updates.length, 1);
    assert.equal(app.updates[0][0], "新的昵称");
    assert.equal(app.updates[0][2], 27);
  } finally {
    await app.close();
  }
});
