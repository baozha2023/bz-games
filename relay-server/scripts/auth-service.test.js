import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthService,
  resolveReturnTo,
} from "../src/services/auth-service.js";

function createAuthHarness(sessionRow) {
  const cleanupCutoffs = [];
  let currentSessionRow = sessionRow;
  const mySqlService = {
    isEnabled: () => true,
    ensureReady: async () => {},
    query: async (sql, params = []) => {
      if (sql.startsWith("DELETE FROM oauth_states"))
        return [{ affectedRows: 0 }];
      if (sql.startsWith("DELETE FROM auth_sessions")) {
        cleanupCutoffs.push(params[0]);
        if (
          currentSessionRow &&
          currentSessionRow.expires_at.getTime() <= params[0].getTime()
        ) {
          currentSessionRow = null;
        }
        return [{ affectedRows: 0 }];
      }
      if (sql.includes("FROM auth_sessions s")) {
        return [[currentSessionRow].filter(Boolean)];
      }
      if (sql.startsWith("UPDATE auth_sessions")) return [{ affectedRows: 1 }];
      throw new Error(`unexpected_query:${sql}`);
    },
  };
  return {
    service: createAuthService({
      config: {
        AUTH_EXPIRED_SESSION_RETENTION_MS: 7 * 24 * 60 * 60 * 1000,
        SESSION_COOKIE_NAME: "bz_games_session",
        PORTAL_PUBLIC_URL: "https://relay.example.com/admin/",
      },
      mySqlService,
    }),
    cleanupCutoffs,
  };
}

function sessionRow(expiresAt, role = "player") {
  return {
    id: 1,
    user_id: 2,
    expires_at: expiresAt,
    user_id_value: 2,
    github_id: "42",
    login: "tester",
    name: "Test User",
    avatar_url: "",
    profile_url: "https://github.com/tester",
    email: "",
    role,
    user_created_at: new Date(),
    user_updated_at: new Date(),
    last_login_at: new Date(),
  };
}

test("accepts only configured admin, app protocol, and local loopback returns", () => {
  const adminUrl = "https://relay.example.com/admin/";

  assert.equal(resolveReturnTo(adminUrl, adminUrl), adminUrl);
  assert.equal(
    resolveReturnTo("bzgames://oauth-complete"),
    "bzgames://oauth-complete",
  );
  assert.equal(
    resolveReturnTo("http://127.0.0.1:43120/callback"),
    "http://127.0.0.1:43120/callback",
  );
  assert.equal(
    resolveReturnTo("http://localhost:43120/callback"),
    "http://localhost:43120/callback",
  );
});

test("rejects external, credential-bearing, and lookalike return URLs", () => {
  const rejected = [
    "https://example.com/callback",
    "http://localhost/callback",
    "http://localhost:43120@evil.example/callback",
    "http://127.0.0.1:43120@evil.example/callback",
    "http://localhost.evil.example:43120/callback",
    "https://relay.example.com/admin-lookalike",
    "bzgames://user:password@oauth-complete",
    "not-a-url",
  ];

  for (const value of rejected) {
    assert.equal(
      resolveReturnTo(value, "https://relay.example.com/admin/"),
      "",
      value,
    );
  }
});

test("OAuth creates players and never overwrites an existing database role", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "https://github.com/login/oauth/access_token") {
      return { ok: true, json: async () => ({ access_token: "github-token" }) };
    }
    if (url === "https://api.github.com/user") {
      return {
        ok: true,
        json: async () => ({
          id: 42,
          login: "tester",
          name: "Test User",
          avatar_url: "",
          html_url: "https://github.com/tester",
          email: "tester@example.com",
        }),
      };
    }
    throw new Error(`unexpected_fetch:${url}`);
  };

  try {
    for (const initialRole of [
      null,
      "player",
      "creator",
      "administrator",
      "super_administrator",
    ]) {
      let storedRole = initialRole;
      let insertedRole = "";
      const now = new Date();
      const mySqlService = {
        isEnabled: () => true,
        ensureReady: async () => {},
        query: async (sql, params = []) => {
          if (sql.startsWith("SELECT * FROM oauth_states")) {
            return [
              [
                {
                  id: 1,
                  return_to: "https://relay.example.com/admin/",
                  expires_at: new Date(Date.now() + 60_000),
                },
              ],
            ];
          }
          if (sql.startsWith("DELETE FROM oauth_states"))
            return [{ affectedRows: 1 }];
          if (sql.startsWith("DELETE FROM auth_sessions"))
            return [{ affectedRows: 0 }];
          if (sql.startsWith("INSERT INTO users")) {
            insertedRole = params[6];
            storedRole ||= params[6];
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("SELECT * FROM users")) {
            return [
              [
                {
                  id: 1,
                  github_id: "42",
                  login: "tester",
                  name: "Test User",
                  avatar_url: "",
                  profile_url: "https://github.com/tester",
                  email: "tester@example.com",
                  role: storedRole,
                  created_at: now,
                  updated_at: now,
                  last_login_at: now,
                },
              ],
            ];
          }
          if (sql.startsWith("INSERT INTO auth_sessions"))
            return [{ affectedRows: 1 }];
          throw new Error(`unexpected_query:${sql}`);
        },
      };
      const service = createAuthService({
        config: {
          GITHUB_CLIENT_ID: "client",
          GITHUB_CLIENT_SECRET: "secret",
          GITHUB_CALLBACK_URL: "https://relay.example.com/auth/github/callback",
          GITHUB_OAUTH_SCOPE: "read:user user:email",
          PORTAL_PUBLIC_URL: "https://relay.example.com/admin/",
          SESSION_COOKIE_NAME: "bz_games_session",
          OAUTH_SESSION_TTL_MS: 60_000,
          AUTH_EXPIRED_SESSION_RETENTION_MS: 60_000,
        },
        mySqlService,
      });
      const response = {
        status: 0,
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        },
        writeHead(status, headers = {}) {
          this.status = status;
          Object.assign(this.headers, headers);
        },
        end() {},
      };
      const handled = await service.handleRequest(
        { method: "GET", headers: {} },
        response,
        new URL(
          "https://relay.example.com/auth/github/callback?code=code&state=state",
        ),
      );
      assert.equal(handled, true);
      assert.equal(response.status, 302);
      assert.equal(insertedRole, "player");
      assert.equal(storedRole, initialRole || "player");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolves missing, invalid, expired, and authenticated sessions", async () => {
  const clientRequest = (token = "") => ({
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const portalRequest = (token = "") => ({
    headers: token ? { cookie: `bz_games_session=${token}` } : {},
  });

  assert.deepEqual(
    await createAuthHarness(null).service.getClientSessionFromRequest(clientRequest()),
    { status: "missing" },
  );
  assert.deepEqual(
    await createAuthHarness(null).service.getClientSessionFromRequest(clientRequest("bad")),
    { status: "invalid" },
  );
  assert.deepEqual(
    await createAuthHarness(
      sessionRow(new Date(Date.now() - 1000)),
    ).service.getClientSessionFromRequest(clientRequest("expired")),
    { status: "expired" },
  );
  assert.deepEqual(
    await createAuthHarness(
      sessionRow(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)),
    ).service.getClientSessionFromRequest(clientRequest("expired-and-cleaned")),
    { status: "invalid" },
  );

  const valid = await createAuthHarness(
    sessionRow(new Date(Date.now() + 60_000)),
  ).service.getClientSessionFromRequest(clientRequest("valid"));
  assert.equal(valid.status, "authenticated");
  assert.equal(valid.auth.user.login, "tester");
  const portal = await createAuthHarness(
    sessionRow(new Date(Date.now() + 60_000)),
  ).service.getPortalSessionFromRequest(portalRequest("valid"));
  assert.equal(portal.status, "authenticated");
  assert.deepEqual(
    await createAuthHarness(null).service.getPortalSessionFromRequest(clientRequest("valid")),
    { status: "invalid" },
  );
  assert.deepEqual(
    await createAuthHarness(null).service.getClientSessionFromRequest({ headers: { cookie: "bz_games_session=valid" } }),
    { status: "invalid" },
  );
});

test("retains recently expired sessions and returns stable auth errors", async () => {
  const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const harness = createAuthHarness(null);
  await harness.service.getClientSessionFromRequest({ headers: {} });
  const cutoff = harness.cleanupCutoffs[0];
  assert(cutoff instanceof Date);
  assert(Math.abs(cutoff.getTime() - before) < 2000);

  for (const [status, expectedError] of [
    ["missing", "unauthorized"],
    ["expired", "session_expired"],
    ["invalid", "session_invalid"],
  ]) {
    let responseStatus = 0;
    let responseBody = null;
    harness.service.sendAuthFailure(
      {
        writeHead(value) {
          responseStatus = value;
        },
        end(value) {
          responseBody = JSON.parse(value);
        },
      },
      status,
    );
    assert.equal(responseStatus, 401);
    assert.equal(responseBody.error, expectedError);
    assert.equal(typeof responseBody.message, "string");
    assert(responseBody.message.length > 0);
  }
});

test("portal session replaces auth/me and accepts only cookie sessions", async () => {
  const service = createAuthHarness(
    sessionRow(new Date(Date.now() + 60_000)),
  ).service;
  const response = () => ({
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(value = "") { this.body = value ? JSON.parse(value) : null; },
  });
  const removed = response();
  assert.equal(
    await service.handleRequest(
      { method: "GET", headers: {} },
      removed,
      new URL("https://relay.example.com/api/auth/me"),
    ),
    false,
  );
  const allowed = response();
  assert.equal(
    await service.handleRequest(
      { method: "GET", headers: { cookie: "bz_games_session=valid" } },
      allowed,
      new URL("https://relay.example.com/api/portal/v1/session"),
    ),
    true,
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.user.role, "player");
  assert.deepEqual(allowed.body.capabilities, []);
  const bearer = response();
  await service.handleRequest(
    { method: "GET", headers: { authorization: "Bearer valid" } },
    bearer,
    new URL("https://relay.example.com/api/portal/v1/session"),
  );
  assert.equal(bearer.status, 401);
});

test("client bearer authentication is independent of portal role", async () => {
  for (const role of [
    "player",
    "creator",
    "administrator",
    "super_administrator",
  ]) {
    const result = await createAuthHarness(
      sessionRow(new Date(Date.now() + 60_000), role),
    ).service.getClientSessionFromRequest({
      headers: { authorization: "Bearer valid" },
    });
    assert.equal(result.status, "authenticated");
    assert.equal(result.auth.user.role, role);
  }
});
