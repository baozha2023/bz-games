import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createPortalUserService } from "../src/services/portal-user-service.js";

async function harness(initialRole = "administrator") {
  const users = [{
    id: 1, github_id: "208792845", login: "admin", name: "Admin",
    avatar_url: "https://example.com/avatar.png", profile_url: "https://github.com/admin",
    email: "admin@example.com", role: initialRole,
    created_at: new Date("2026-01-01T00:00:00Z"), updated_at: new Date("2026-01-02T00:00:00Z"),
    last_login_at: new Date("2026-01-03T00:00:00Z"),
  }];
  const service = createPortalUserService({
    mySqlService: {
      isEnabled: () => true,
      query: async (sql) => {
        if (sql.startsWith("UPDATE users SET role = 'creator'")) {
          if (users[0].role === "player") users[0].role = "creator";
          return [{ affectedRows: 1 }];
        }
        return sql.includes("COUNT(*)") ? [[{ total: users.length }]] : [users];
      },
    },
    accessControlService: {
      requireAdmin: async (req, res) => {
        if (req.headers["x-test-admin"] === "yes") return { user: users[0] };
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return null;
      },
      requirePortalOrigin: (req, res) => {
        if (req.headers.origin === "http://portal.test") return true;
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_origin" }));
        return false;
      },
      requireAuthenticated: async () => ({ user: users[0], isAdmin: users[0].role === "administrator" }),
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("user list is administrator-only, paginated and role-aware", async () => {
  const app = await harness();
  try {
    assert.equal((await fetch(`${app.baseUrl}/api/portal/v1/users`)).status, 403);
    assert.equal((await fetch(`${app.baseUrl}/api/portal/v1/users?page=bad`, { headers: { "x-test-admin": "yes" } })).status, 400);
    const response = await fetch(`${app.baseUrl}/api/portal/v1/users?page=1&pageSize=20&q=admin`, { headers: { "x-test-admin": "yes" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total, 1);
    assert.deepEqual(body.items[0], {
      id: "1", githubId: "208792845", login: "admin", name: "Admin",
      avatarUrl: "https://example.com/avatar.png", profileUrl: "https://github.com/admin",
      email: "admin@example.com", role: "administrator",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
      lastLoginAt: "2026-01-03T00:00:00.000Z",
    });
  } finally {
    await app.close();
  }
});

test("portal activation promotes players without downgrading higher roles", async () => {
  const app = await harness("player");
  try {
    assert.equal((await fetch(`${app.baseUrl}/api/portal/v1/activate`, { method: "POST" })).status, 403);
    const response = await fetch(`${app.baseUrl}/api/portal/v1/activate`, {
      method: "POST",
      headers: { origin: "http://portal.test", cookie: "bz_games_session=test" },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).role, "creator");
    const repeated = await fetch(`${app.baseUrl}/api/portal/v1/activate`, {
      method: "POST",
      headers: { origin: "http://portal.test", cookie: "bz_games_session=test" },
    });
    assert.equal((await repeated.json()).role, "creator");
  } finally {
    await app.close();
  }
});
