import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthService,
  loginRoleForReturnTo,
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
      },
      mySqlService,
    }),
    cleanupCutoffs,
  };
}

function sessionRow(expiresAt) {
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

test("assigns creator only to the configured portal login flow", () => {
  const portalUrl = "https://relay.example.com/admin/";
  assert.equal(loginRoleForReturnTo(portalUrl, portalUrl), "creator");
  assert.equal(
    loginRoleForReturnTo("https://relay.example.com/admin/game-hosting", portalUrl),
    "creator",
  );
  assert.equal(
    loginRoleForReturnTo("bzgames://oauth-complete", portalUrl),
    "player",
  );
  assert.equal(
    loginRoleForReturnTo("http://127.0.0.1:43120/callback", portalUrl),
    "player",
  );
  assert.equal(loginRoleForReturnTo("", portalUrl), "player");
});

test("resolves missing, invalid, expired, and authenticated sessions", async () => {
  const request = (token = "") => ({
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  assert.deepEqual(
    await createAuthHarness(null).service.getSessionFromRequest(request()),
    { status: "missing" },
  );
  assert.deepEqual(
    await createAuthHarness(null).service.getSessionFromRequest(request("bad")),
    { status: "invalid" },
  );
  assert.deepEqual(
    await createAuthHarness(
      sessionRow(new Date(Date.now() - 1000)),
    ).service.getSessionFromRequest(request("expired")),
    { status: "expired" },
  );
  assert.deepEqual(
    await createAuthHarness(
      sessionRow(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)),
    ).service.getSessionFromRequest(request("expired-and-cleaned")),
    { status: "invalid" },
  );

  const valid = await createAuthHarness(
    sessionRow(new Date(Date.now() + 60_000)),
  ).service.getSessionFromRequest(request("valid"));
  assert.equal(valid.status, "authenticated");
  assert.equal(valid.auth.user.login, "tester");
});

test("retains recently expired sessions and returns stable auth errors", async () => {
  const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const harness = createAuthHarness(null);
  await harness.service.getSessionFromRequest({ headers: {} });
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
