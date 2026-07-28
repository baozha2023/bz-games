import assert from "node:assert/strict";
import test from "node:test";

import { resolveReturnTo } from "../src/services/auth-service.js";

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
    "bzgames://user:password@oauth-complete",
    "not-a-url",
  ];

  for (const value of rejected) {
    assert.equal(resolveReturnTo(value), "", value);
  }
});
