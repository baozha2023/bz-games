import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  ONLINE_TIMEOUT_MS,
  createPresenceService,
  isEffectivelyOnline,
} from "../src/services/presence-service.js";

async function harness() {
  const row = {
    id: 27,
    is_online: 0,
    last_online_at: null,
  };
  const queries = [];
  const service = createPresenceService({
    config: { RELAY_TOKEN: "relay-token" },
    mySqlService: {
      isEnabled: () => true,
      ensureReady: async () => {},
      query: async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.startsWith("UPDATE users SET is_online = 1")) {
          row.is_online = 1;
          row.last_online_at = params[0];
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("UPDATE users SET is_online = 0")) {
          row.is_online = 0;
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith("SELECT is_online, last_online_at")) {
          return [[row]];
        }
        if (sql.includes("UPDATE users") && sql.includes("DATE_SUB")) {
          row.is_online = 0;
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
    row,
    queries,
    service,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function updatePresence(app, body, headers = {}) {
  return fetch(`${app.baseUrl}/api/v1/me/presence`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-relay-token": "relay-token",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("presence updates require both relay and client bearer authentication", async () => {
  const app = await harness();
  try {
    assert.equal((await updatePresence(app, { online: true })).status, 401);
    assert.equal(
      (
        await updatePresence(
          app,
          { online: true },
          { "x-relay-token": "invalid-token", authorization: "Bearer valid-token" },
        )
      ).status,
      401,
    );
  } finally {
    await app.close();
  }
});

test("presence validates an exact boolean request body", async () => {
  const app = await harness();
  try {
    const headers = { authorization: "Bearer valid-token" };
    assert.equal((await updatePresence(app, {}, headers)).status, 400);
    assert.equal((await updatePresence(app, { online: "true" }, headers)).status, 400);
    assert.equal(
      (await updatePresence(app, { online: true, userId: 1 }, headers)).status,
      400,
    );
  } finally {
    await app.close();
  }
});

test("presence only updates the authenticated user and returns canonical state", async () => {
  const app = await harness();
  try {
    const headers = { authorization: "Bearer valid-token" };
    const onlineResponse = await updatePresence(app, { online: true }, headers);
    assert.equal(onlineResponse.status, 200);
    const onlineBody = await onlineResponse.json();
    assert.equal(onlineBody.ok, true);
    assert.equal(onlineBody.presence.isOnline, true);
    assert.equal(typeof onlineBody.presence.lastOnlineAt, "string");
    assert.equal(app.row.is_online, 1);
    assert.equal(app.queries[0].params[1], 27);

    const offlineResponse = await updatePresence(app, { online: false }, headers);
    assert.equal(offlineResponse.status, 200);
    assert.deepEqual((await offlineResponse.json()).presence, {
      isOnline: false,
      lastOnlineAt: onlineBody.presence.lastOnlineAt,
    });
    assert.equal(app.row.is_online, 0);
  } finally {
    await app.close();
  }
});

test("stale heartbeat is not effectively online", () => {
  const now = Date.now();
  assert.equal(
    isEffectivelyOnline({ is_online: 1, last_online_at: new Date(now - 1_000) }, now),
    true,
  );
  assert.equal(
    isEffectivelyOnline(
      { is_online: 1, last_online_at: new Date(now - ONLINE_TIMEOUT_MS - 1) },
      now,
    ),
    false,
  );
  assert.equal(isEffectivelyOnline({ is_online: 0, last_online_at: new Date() }, now), false);
});

test("stale-user cleanup clears expired online flags", async () => {
  const app = await harness();
  try {
    await app.service.cleanupStaleUsers();
    assert.ok(app.queries.some(({ sql }) => sql.includes("DATE_SUB")));
    assert.equal(app.row.is_online, 0);
  } finally {
    await app.close();
  }
});
