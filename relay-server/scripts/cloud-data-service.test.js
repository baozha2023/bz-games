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
          if (sql.includes("FROM cloud_sync_limits")) {
            const value = limits.get(`${params[0]}:${params[1]}`);
            return [
              [value ? { last_action_at: value } : undefined].filter(Boolean),
            ];
          }
          if (sql.includes("INSERT INTO cloud_sync_limits")) {
            limits.set(`${params[0]}:${params[1]}`, params[2]);
            return [{ affectedRows: 1 }];
          }
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
              file_storage_id: params[1],
              snapshot_version: params[2],
              size: params[3],
              sha256: params[4],
              content_type: params[5],
              created_at: params[6],
              updated_at: params[7],
            };
            return [{ affectedRows: 1 }];
          }
          throw new Error(`unexpected_transaction_query:${sql}`);
        },
      };
      return callback(connection);
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
    },
    authService: {
      getClientSessionFromRequest: async () => ({
        status: "authenticated",
        auth: { user: { id: 1 } },
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

test("platform snapshot is uploaded and downloaded as one object", async () => {
  const harness = createHarness();
  const server = await listen(harness.service);
  const snapshot = {
    formatVersion: 1,
    createdAt: "2026-07-29T00:00:00.000Z",
    config: "encrypted-config",
    databaseSql: "BEGIN; COMMIT;",
  };
  try {
    const upload = await fetch(
      `${server.baseUrl}/api/cloud/platform-snapshot`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(snapshot),
      },
    );
    assert.equal(upload.status, 200);
    assert.equal(harness.getSnapshotRef().snapshot_version, 1);

    const meta = await fetch(
      `${server.baseUrl}/api/cloud/platform-snapshot/meta`,
    );
    assert.equal(meta.status, 200);
    assert.equal((await meta.json()).snapshot.version, 1);

    harness.resetLimits();
    const download = await fetch(
      `${server.baseUrl}/api/cloud/platform-snapshot`,
    );
    assert.equal(download.status, 200);
    assert.deepEqual(await download.json(), snapshot);

    assert.equal(
      (await fetch(`${server.baseUrl}/api/cloud/files`)).status,
      404,
    );
    assert.equal(
      (await fetch(`${server.baseUrl}/api/cloud/files/config.json`)).status,
      404,
    );
  } finally {
    await server.close();
  }
});

test("publishing a replacement switches the pointer before deleting the old object", async () => {
  const harness = createHarness();
  const server = await listen(harness.service);
  try {
    const first = await fetch(`${server.baseUrl}/api/cloud/platform-snapshot`, {
      method: "PUT",
      body: JSON.stringify({
        formatVersion: 1,
        createdAt: "1",
        config: "1",
        databaseSql: "1",
      }),
    });
    assert.equal(first.status, 200);
    const firstId = harness.getSnapshotRef().file_storage_id;

    harness.resetLimits();
    const second = await fetch(
      `${server.baseUrl}/api/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 1,
          createdAt: "2",
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
    const first = await fetch(`${server.baseUrl}/api/cloud/platform-snapshot`, {
      method: "PUT",
      body: JSON.stringify({
        formatVersion: 1,
        createdAt: "1",
        config: "1",
        databaseSql: "1",
      }),
    });
    assert.equal(first.status, 200);
    const current = { ...harness.getSnapshotRef() };

    harness.resetLimits();
    harness.failNextSnapshotPublish();
    const failed = await fetch(
      `${server.baseUrl}/api/cloud/platform-snapshot`,
      {
        method: "PUT",
        body: JSON.stringify({
          formatVersion: 1,
          createdAt: "2",
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
  } finally {
    await server.close();
  }
});
