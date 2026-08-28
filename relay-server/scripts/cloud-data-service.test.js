import assert from "node:assert/strict";
import http from "node:http";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { ObjectId } from "mongodb";

import { createCloudDataService } from "../src/services/cloud-data-service.js";

function createHarness() {
  const objects = new Map();
  const deleted = [];
  let snapshotRef = null;
  let failNextSnapshotPublish = false;
  const limits = new Map();
  let reservationSequence = 0;

  const mySqlService = {
    isEnabled: () => true,
    ensureReady: async () => {},
    query: async (sql, params) => {
      if (sql.includes("FROM user_platform_snapshots")) {
        return [[snapshotRef].filter(Boolean)];
      }
      throw new Error(`unexpected_query:${sql}:${JSON.stringify(params)}`);
    },
    transaction: async (callback) => {
      const connection = {
        query: async (sql, params) => {
          if (sql.includes("FROM user_platform_snapshots")) {
            return [[snapshotRef].filter(Boolean)];
          }
          if (sql.includes("INSERT INTO user_platform_snapshots")) {
            if (failNextSnapshotPublish) {
              failNextSnapshotPublish = false;
              throw new Error("simulated_pointer_failure");
            }
            snapshotRef = {
              user_id: params[0],
              protocol_version: params[1],
              data_model_version: params[2],
              file_storage_id: params[3],
              snapshot_version: params[4],
              size: params[5],
              sha256: params[6],
              content_type: params[7],
              created_at: params[8],
              updated_at: params[9],
            };
            return [{ affectedRows: 1 }];
          }
          throw new Error(`unexpected_transaction_query:${sql}`);
        },
      };
      return callback(connection);
    },
  };

  const rateLimitService = {
    reserve: async ({ githubId, endpointKey, cooldownMs }) => {
      const key = `${githubId}:${endpointKey}`;
      const current = limits.get(key);
      const now = Date.now();
      if (current?.reservationToken) {
        return {
          ok: false,
          retryAfterSeconds: 60,
          resetAt: new Date(now + 60_000).toISOString(),
        };
      }
      if (current?.lastSuccessAt + cooldownMs > now) {
        const resetAt = new Date(current.lastSuccessAt + cooldownMs);
        return {
          ok: false,
          retryAfterSeconds: Math.ceil((resetAt.getTime() - now) / 1000),
          resetAt: resetAt.toISOString(),
        };
      }
      const token = `reservation-${++reservationSequence}`;
      limits.set(key, { ...current, reservationToken: token });
      return { ok: true, token };
    },
    commit: async ({ githubId, endpointKey, token }) => {
      const key = `${githubId}:${endpointKey}`;
      const current = limits.get(key);
      if (current?.reservationToken !== token) return false;
      limits.set(key, { lastSuccessAt: Date.now(), reservationToken: null });
      return true;
    },
    release: async ({ githubId, endpointKey, token }) => {
      const key = `${githubId}:${endpointKey}`;
      const current = limits.get(key);
      if (current?.reservationToken !== token) return false;
      if (current.lastSuccessAt) {
        limits.set(key, { ...current, reservationToken: null });
      } else {
        limits.delete(key);
      }
      return true;
    },
  };

  const bucket = {
    openUploadStream: () => {
      const id = new ObjectId();
      const chunks = [];
      const stream = new Writable({
        write(chunk, encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
        final(callback) {
          objects.set(String(id), Buffer.concat(chunks));
          callback();
        },
      });
      stream.id = id;
      return stream;
    },
    openDownloadStream: (id) => {
      const stream = new PassThrough();
      queueMicrotask(() => {
        const content = objects.get(String(id));
        if (!content) {
          stream.emit("error", new Error("missing_object"));
          return;
        }
        stream.end(content);
      });
      return stream;
    },
    delete: async (id) => {
      deleted.push(String(id));
      objects.delete(String(id));
    },
  };

  const service = createCloudDataService({
    config: {
      MAX_PLATFORM_CLOUD_SNAPSHOT_BYTES: 1024 * 1024,
      PLATFORM_SNAPSHOT_GC_GRACE_MS: 0,
      CLOUD_V2_MAINTENANCE: false,
    },
    authService: {
      getClientSessionFromRequest: async () => ({
        status: "authenticated",
        auth: { user: { id: 1, github_id: "github-1" } },
      }),
      sendAuthFailure: (res, status) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: status }));
      },
    },
    mongoService: {
      isEnabled: () => true,
      ensureReady: async () => {},
      getBucket: () => bucket,
    },
    mySqlService,
    rateLimitService,
  });
  return {
    service,
    getSnapshotRef: () => snapshotRef,
    resetLimits: () => limits.clear(),
    failNextSnapshotPublish: () => {
      failNextSnapshotPublish = true;
    },
    deleted,
  };
}

async function listen(service) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("cloud v2 rejects any legacy or non-canonical snapshot payload", async () => {
  const harness = createHarness();
  const server = await listen(harness.service);
  try {
    const response = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 1,
          createdAt: "2026-08-26T00:00:00.000Z",
          config: "legacy",
          databaseSql: "legacy",
        }),
      },
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "snapshot_format_invalid",
    });
    assert.equal(harness.getSnapshotRef(), null);

    const retry = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 2,
          dataModelVersion: 4,
          createdAt: "2026-08-26T00:00:00.000Z",
          config: "valid",
          databaseSql: "BEGIN; COMMIT;",
        }),
      },
    );
    assert.equal(retry.status, 200);
  } finally {
    await server.close();
  }
});

test("platform snapshot is uploaded and downloaded as one object", async () => {
  const harness = createHarness();
  const server = await listen(harness.service);
  const snapshot = {
    formatVersion: 2,
    dataModelVersion: 4,
    createdAt: "2026-07-29T00:00:00.000Z",
    config: "encrypted-config",
    databaseSql: "BEGIN; COMMIT;",
  };
  try {
    const upload = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      },
    );
    assert.equal(upload.status, 200);
    assert.equal(harness.getSnapshotRef().snapshot_version, 1);

    const meta = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot/meta`,
    );
    assert.equal(meta.status, 200);
    assert.equal((await meta.json()).snapshot.version, 1);

    harness.resetLimits();
    const download = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
    );
    assert.equal(download.status, 200);
    assert.deepEqual(await download.json(), snapshot);

  } finally {
    await server.close();
  }
});

test("publishing a replacement switches the pointer before deleting the old object", async () => {
  const harness = createHarness();
  const server = await listen(harness.service);
  try {
    const first = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 2,
          dataModelVersion: 4,
          createdAt: "2026-08-26T00:00:01.000Z",
          config: "1",
          databaseSql: "1",
        }),
      },
    );
    assert.equal(first.status, 200);
    const firstId = harness.getSnapshotRef().file_storage_id;

    harness.resetLimits();
    const second = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 2,
          dataModelVersion: 4,
          createdAt: "2026-08-26T00:00:02.000Z",
          config: "2",
          databaseSql: "2",
        }),
      },
    );
    assert.equal(second.status, 200);
    assert.equal(harness.getSnapshotRef().snapshot_version, 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(harness.deleted, [firstId]);
  } finally {
    await server.close();
  }
});

test("a failed pointer transaction preserves the current snapshot", async () => {
  const harness = createHarness();
  const server = await listen(harness.service);
  try {
    const first = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 2,
          dataModelVersion: 4,
          createdAt: "2026-08-26T00:00:01.000Z",
          config: "1",
          databaseSql: "1",
        }),
      },
    );
    assert.equal(first.status, 200);
    const current = { ...harness.getSnapshotRef() };

    harness.resetLimits();
    harness.failNextSnapshotPublish();
    const failed = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 2,
          dataModelVersion: 4,
          createdAt: "2026-08-26T00:00:02.000Z",
          config: "2",
          databaseSql: "2",
        }),
      },
    );
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "cloud_upload_failed" });
    assert.deepEqual(harness.getSnapshotRef(), current);
    assert.equal(harness.deleted.length, 1);
    assert.notEqual(harness.deleted[0], current.file_storage_id);
    const retry = await fetch(
      `${server.baseUrl}/api/v2/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 2,
          dataModelVersion: 4,
          createdAt: "2026-08-26T00:00:03.000Z",
          config: "3",
          databaseSql: "3",
        }),
      },
    );
    assert.equal(retry.status, 200);
    assert.equal(harness.getSnapshotRef().snapshot_version, 2);
  } finally {
    await server.close();
  }
});
