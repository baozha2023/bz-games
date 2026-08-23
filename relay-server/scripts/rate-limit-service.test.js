import assert from "node:assert/strict";
import test from "node:test";

import {
  createRateLimitService,
  RateLimitError,
} from "../src/services/rate-limit-service.js";

function createFakeMySqlService() {
  const records = new Map();

  function keyOf(githubId, endpointKey) {
    return `${githubId}:${endpointKey}`;
  }

  const connection = {
    query: async (sql, params = []) => {
      if (sql.includes("INSERT INTO rate_limit_records")) {
        const key = keyOf(params[0], params[1]);
        if (!records.has(key)) {
          records.set(key, {
            github_id: params[0],
            endpoint_key: params[1],
            last_success_at: null,
            reservation_token: null,
            reservation_expires_at: null,
            created_at: params[2],
            updated_at: params[3],
          });
        }
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SELECT github_id, endpoint_key")) {
        const record = records.get(keyOf(params[0], params[1]));
        return [record ? [{ ...record }] : []];
      }
      if (
        sql.includes("SET reservation_token = ?, reservation_expires_at = ?")
      ) {
        const record = records.get(keyOf(params[3], params[4]));
        record.reservation_token = params[0];
        record.reservation_expires_at = params[1];
        record.updated_at = params[2];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET last_success_at = ?")) {
        const record = records.get(keyOf(params[2], params[3]));
        if (!record || record.reservation_token !== params[4]) {
          return [{ affectedRows: 0 }];
        }
        record.last_success_at = params[0];
        record.reservation_token = null;
        record.reservation_expires_at = null;
        record.updated_at = params[1];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("SET reservation_token = NULL")) {
        const record = records.get(keyOf(params[1], params[2]));
        if (!record || record.reservation_token !== params[3]) {
          return [{ affectedRows: 0 }];
        }
        record.reservation_token = null;
        record.reservation_expires_at = null;
        record.updated_at = params[0];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };

  return {
    records,
    transaction: async (callback) => callback(connection),
  };
}

test("rate limit records survive service recreation and isolate identities/endpoints", async () => {
  const mySqlService = createFakeMySqlService();
  const firstService = createRateLimitService({
    mySqlService,
    reservationTtlMs: 5_000,
  });
  const first = await firstService.reserve({
    githubId: "github-1",
    endpointKey: "feedback.submit",
    cooldownMs: 10_000,
    now: new Date(1_000),
  });
  assert.equal(first.ok, true);
  assert.equal(
    await firstService.commit({
      githubId: "github-1",
      endpointKey: "feedback.submit",
      token: first.token,
      now: new Date(2_000),
    }),
    true,
  );

  const restartedService = createRateLimitService({
    mySqlService,
    reservationTtlMs: 5_000,
  });
  const blocked = await restartedService.reserve({
    githubId: "github-1",
    endpointKey: "feedback.submit",
    cooldownMs: 10_000,
    now: new Date(3_000),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 9);

  assert.equal(
    (
      await restartedService.reserve({
        githubId: "github-2",
        endpointKey: "feedback.submit",
        cooldownMs: 10_000,
        now: new Date(3_000),
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await restartedService.reserve({
        githubId: "github-1",
        endpointKey: "forum.post.create",
        cooldownMs: 10_000,
        now: new Date(3_000),
      })
    ).ok,
    true,
  );
});

test("rate limit reservation blocks concurrency, releases failures, and recovers expired leases", async () => {
  const mySqlService = createFakeMySqlService();
  const service = createRateLimitService({
    mySqlService,
    reservationTtlMs: 1_000,
  });
  const first = await service.reserve({
    githubId: "github-1",
    endpointKey: "forum.post.create",
    cooldownMs: 10_000,
    now: new Date(1_000),
  });
  assert.equal(
    (
      await service.reserve({
        githubId: "github-1",
        endpointKey: "forum.post.create",
        cooldownMs: 10_000,
        now: new Date(1_001),
      })
    ).ok,
    false,
  );
  assert.equal(
    await service.release({
      githubId: "github-1",
      endpointKey: "forum.post.create",
      token: first.token,
    }),
    true,
  );
  const retry = await service.reserve({
    githubId: "github-1",
    endpointKey: "forum.post.create",
    cooldownMs: 10_000,
    now: new Date(1_002),
  });
  assert.equal(retry.ok, true);

  const takeover = await service.reserve({
    githubId: "github-1",
    endpointKey: "forum.post.create",
    cooldownMs: 10_000,
    now: new Date(2_100),
  });
  assert.equal(takeover.ok, true);
});

test("rate limit service validates keys and converts storage errors", async () => {
  const service = createRateLimitService({
    mySqlService: {
      transaction: async () => {
        throw new Error("database unavailable");
      },
    },
  });
  await assert.rejects(
    service.reserve({
      githubId: "github-1",
      endpointKey: "feedback.submit",
      cooldownMs: 1_000,
    }),
    (error) =>
      error instanceof RateLimitError &&
      error.code === "rate_limit_storage_failed",
  );
  await assert.rejects(
    service.reserve({
      githubId: "github-1",
      endpointKey: "invalid endpoint",
      cooldownMs: 1_000,
    }),
    (error) =>
      error instanceof RateLimitError &&
      error.code === "invalid_rate_limit_endpoint",
  );
});
