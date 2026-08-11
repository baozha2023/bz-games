import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPortalUserService } from "../src/services/portal-user-service.js";

function user(id, login, role) {
  return {
    id,
    github_id: String(208792844 + id),
    login,
    name: login,
    avatar_url: "https://example.com/avatar.png",
    profile_url: `https://github.com/${login}`,
    email: `${login}@example.com`,
    role,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-02T00:00:00Z"),
    last_login_at: new Date("2026-01-03T00:00:00Z"),
  };
}

async function harness(actorRole = "super_administrator") {
  const users = [
    user(1, "baozha2023", actorRole),
    user(2, "creator-user", "creator"),
    user(3, "protected-super", "super_administrator"),
  ];
  const query = async (sql, params = []) => {
    if (sql.includes("COUNT(*)")) return [[{ total: users.length }]];
    if (sql.includes("FROM users") && sql.includes("ORDER BY")) return [users];
    throw new Error(`unexpected_query:${sql}:${JSON.stringify(params)}`);
  };
  const service = createPortalUserService({
    mySqlService: {
      isEnabled: () => true,
      query,
      transaction: async (callback) =>
        callback({
          query: async (sql, params = []) => {
            if (sql.startsWith("SELECT id, role FROM users")) {
              return [
                [
                  users.find((item) => String(item.id) === String(params[0])),
                ].filter(Boolean),
              ];
            }
            if (sql.startsWith("UPDATE users SET role")) {
              const target = users.find(
                (item) => String(item.id) === String(params[2]),
              );
              target.role = params[0];
              target.updated_at = params[1];
              return [{ affectedRows: 1 }];
            }
            throw new Error(`unexpected_transaction_query:${sql}`);
          },
        }),
    },
    accessControlService: {
      requireCapability: async (req, res, capability, options = {}) => {
        const allowed = capability === "users.view"
          ? req.headers["x-test-admin"] === "yes"
          : users[0].role === "super_administrator" &&
            !req.headers.authorization &&
            (!options.requireOrigin || req.headers.origin === "http://portal.test");
        if (allowed) return { user: users[0] };
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return null;
      },
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    users,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const writeHeaders = {
  origin: "http://portal.test",
  cookie: "bz_games_session=test",
  "content-type": "application/json",
};

async function patchRole(app, id, body, headers = writeHeaders) {
  return fetch(`${app.baseUrl}/api/portal/v1/users/${id}/role`, {
    method: "PATCH",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("user list is administrator-only, paginated and exposes all roles", async () => {
  const app = await harness();
  try {
    assert.equal(
      (await fetch(`${app.baseUrl}/api/portal/v1/users`)).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${app.baseUrl}/api/portal/v1/users?page=bad`, {
          headers: { "x-test-admin": "yes" },
        })
      ).status,
      400,
    );
    const response = await fetch(
      `${app.baseUrl}/api/portal/v1/users?page=1&pageSize=20&q=admin`,
      { headers: { "x-test-admin": "yes" } },
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, 3);
    assert.equal(body.items[0].role, "super_administrator");
    assert.equal(body.items[1].role, "creator");
  } finally {
    await app.close();
  }
});

test("super administrator changes another non-super role", async () => {
  const app = await harness();
  try {
    const response = await patchRole(app, "2", { role: "administrator" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.role, "administrator");
    assert.equal(app.users[1].role, "administrator");
  } finally {
    await app.close();
  }
});

test("role updates reject non-super callers, bearer tokens, and foreign origins", async () => {
  const administrator = await harness("administrator");
  try {
    assert.equal(
      (await patchRole(administrator, "2", { role: "player" })).status,
      403,
    );
  } finally {
    await administrator.close();
  }
  const app = await harness();
  try {
    assert.equal(
      (
        await patchRole(
          app,
          "2",
          { role: "player" },
          {
            ...writeHeaders,
            authorization: "Bearer test",
          },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await patchRole(
          app,
          "2",
          { role: "player" },
          {
            ...writeHeaders,
            origin: "https://evil.example",
          },
        )
      ).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test("role updates protect self and super administrators", async () => {
  const app = await harness();
  try {
    assert.equal(
      (await patchRole(app, "1", { role: "administrator" })).status,
      403,
    );
    assert.equal(
      (await patchRole(app, "3", { role: "administrator" })).status,
      403,
    );
  } finally {
    await app.close();
  }
});

test("role updates validate IDs, exact bodies, roles, and missing users", async () => {
  const app = await harness();
  try {
    assert.equal(
      (await patchRole(app, "invalid", { role: "player" })).status,
      400,
    );
    assert.equal((await patchRole(app, "2", "{")).status, 400);
    assert.equal(
      (await patchRole(app, "2", { role: "super_administrator" })).status,
      400,
    );
    assert.equal(
      (await patchRole(app, "2", { role: "player", extra: true })).status,
      400,
    );
    assert.equal((await patchRole(app, "999", { role: "player" })).status, 404);
  } finally {
    await app.close();
  }
});

test("removed portal activation endpoint returns not found", async () => {
  const app = await harness();
  try {
    assert.equal(
      (
        await fetch(`${app.baseUrl}/api/portal/v1/activate`, {
          method: "POST",
          headers: writeHeaders,
        })
      ).status,
      404,
    );
  } finally {
    await app.close();
  }
});
