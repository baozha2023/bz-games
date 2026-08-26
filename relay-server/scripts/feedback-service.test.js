import assert from "node:assert/strict";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { ObjectId } from "mongodb";

import { createFeedbackService } from "../src/services/feedback-service.js";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function createMockRateLimitService() {
  const records = new Map();

  function keyOf(githubId, endpointKey) {
    return `${githubId}:${endpointKey}`;
  }

  return {
    reserve: async ({
      githubId,
      endpointKey,
      cooldownMs,
      now = new Date(),
    }) => {
      const key = keyOf(githubId, endpointKey);
      const currentTime = now.getTime();
      const record = records.get(key);
      if (record?.pending) {
        return {
          ok: false,
          retryAfterSeconds: 1,
          resetAt: new Date(currentTime + 1000).toISOString(),
        };
      }
      if (record?.lastSuccessAt + cooldownMs > currentTime) {
        const resetAt = new Date(record.lastSuccessAt + cooldownMs);
        return {
          ok: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((resetAt.getTime() - currentTime) / 1000),
          ),
          resetAt: resetAt.toISOString(),
        };
      }
      const token = `${key}-${Math.random()}`;
      records.set(key, { ...record, pending: token });
      return { ok: true, token };
    },
    commit: async ({ githubId, endpointKey, token, now = new Date() }) => {
      const key = keyOf(githubId, endpointKey);
      const record = records.get(key);
      if (!record || record.pending !== token) return false;
      records.set(key, { lastSuccessAt: now.getTime(), pending: null });
      return true;
    },
    release: async ({ githubId, endpointKey, token }) => {
      const key = keyOf(githubId, endpointKey);
      const record = records.get(key);
      if (!record || record.pending !== token) return false;
      records.set(key, { ...record, pending: null });
      return true;
    },
  };
}

test("feedback endpoint requires login and applies authenticated cooldowns", async () => {
  const inserted = [];
  const insertedImages = [];
  const uploadedImages = [];
  const config = {
    RELAY_TOKEN: "test-relay-token",
    MAX_FEEDBACK_REQUEST_BYTES: 24 * 1024 * 1024,
    MAX_FEEDBACK_TEXT_LENGTH: 5000,
    MAX_FEEDBACK_IMAGES: 4,
    MAX_FEEDBACK_IMAGE_BYTES: 5 * 1024 * 1024,
    FEEDBACK_AUTHENTICATED_COOLDOWN_MS: 6 * 60 * 60 * 1000,
    SESSION_COOKIE_NAME: "bz_games_session",
  };
  const mySqlService = {
    isEnabled: () => true,
    transaction: async (callback) =>
      callback({
        query: async (sql, params) => {
          if (sql.includes("INSERT INTO feedback_images")) {
            insertedImages.push(params);
          } else if (sql.includes("INSERT INTO feedback")) {
            inserted.push(params);
          }
          return [{}];
        },
      }),
  };
  const authService = {
    getClientSessionFromRequest: async (req) => {
      const token = String(req.headers.authorization || "").replace(
        /^Bearer\s+/i,
        "",
      );
      const userNumber = /^valid-session-(\d+)$/.exec(token)?.[1];
      return userNumber
        ? {
            status: "authenticated",
            auth: {
              user: {
                id: Number(userNumber),
                github_id: `github-${userNumber}`,
                login: `test-user-${userNumber}`,
              },
            },
          }
        : { status: "invalid" };
    },
    sendAuthFailure: (res, status) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: status }));
    },
  };
  let portalRole = "player";
  const service = createFeedbackService({
    config,
    mySqlService,
    mongoService: {
      isEnabled: () => true,
      ensureReady: async () => {},
      getBucket: () => ({
        openUploadStream: (fileName, options) => {
          const stream = new Writable({
            write(chunk, _encoding, callback) {
              uploadedImages.push(Buffer.from(chunk));
              callback();
            },
          });
          stream.id = new ObjectId();
          stream.fileName = fileName;
          stream.options = options;
          return stream;
        },
        delete: async () => {},
      }),
    },
    authService,
    rateLimitService: createMockRateLimitService(),
    accessControlService: {
      requirePortalSession: async () => ({
        user: {
          id: 9,
          github_id: "github-9",
          login: "portal-user",
          role: portalRole,
        },
      }),
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (!(await service.handleRequest(req, res, url))) {
        res.writeHead(404).end();
      }
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function submit({
    authorization = "",
    cookie = "",
    imageBuffer = null,
  } = {}) {
    const form = new FormData();
    form.set("content", "test feedback");
    form.set("appVersion", "3.1.0");
    form.set("platform", "win32");
    if (imageBuffer) {
      form.append(
        "images",
        new Blob([imageBuffer], { type: "image/png" }),
        "test.png",
      );
    }
    const headers = { "x-relay-token": config.RELAY_TOKEN };
    if (authorization) headers.authorization = authorization;
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${baseUrl}/api/v1/feedback`, {
      method: "POST",
      headers,
      body: form,
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  async function submitFromPortal(content = "portal feedback") {
    const response = await fetch(`${baseUrl}/api/portal/v1/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://games.example",
      },
      body: JSON.stringify({ content }),
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }

  try {
    assert.equal((await submit()).status, 401);

    assert.equal(
      (await submit({ authorization: "Bearer invalid-session" })).status,
      401,
    );
    assert.equal(
      (await submit({ authorization: "Bearer valid-session-1" })).status,
      201,
    );
    assert.equal(
      (await submit({ cookie: "bz_games_session=valid-session-1" })).status,
      401,
    );
    assert.equal(
      (await submit({ authorization: "Bearer valid-session-1" })).status,
      429,
    );
    assert.equal(
      (await submit({ authorization: "Bearer valid-session-2" })).status,
      201,
    );
    assert.equal(
      (
        await submit({
          authorization: "Bearer valid-session-3",
          imageBuffer: VALID_PNG,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await submit({
          authorization: "Bearer valid-session-4",
          imageBuffer: Buffer.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
          ]),
        })
      ).status,
      400,
    );
    assert.equal(
      (await submit({ authorization: "Bearer valid-session-4" })).status,
      201,
    );
    portalRole = "administrator";
    assert.equal((await submitFromPortal()).status, 403);
    portalRole = "player";
    assert.equal((await submitFromPortal()).status, 201);
    const portalBlocked = await submitFromPortal();
    assert.equal(portalBlocked.status, 429);
    assert.equal(portalBlocked.body.error, "feedback_too_frequent");
    assert.equal(inserted.length, 5);
    assert.equal(inserted.at(-1)[2], "github");
    assert.equal(inserted.at(-1)[6], "portal");
    assert.equal(insertedImages.length, 1);
    assert.equal(Buffer.concat(uploadedImages).length, VALID_PNG.length);
  } finally {
    service.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("user feedback history uses a stable ten-item cursor page", async () => {
  const queryCalls = [];
  const ownerRows = Array.from({ length: 12 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(12 - index).padStart(12, "0")}`,
    created_at: new Date(Date.UTC(2026, 7, 21 - index, 10, 0, 0)),
  }));
  const rowsByUser = new Map([
    [42, ownerRows],
    [
      7,
      [
        {
          id: "77777777-7777-4777-8777-777777777777",
          created_at: new Date("2026-08-19T10:00:00.000Z"),
        },
      ],
    ],
  ]);
  const service = createFeedbackService({
    config: {
      RELAY_TOKEN: "test-relay-token",
      FEEDBACK_AUTHENTICATED_COOLDOWN_MS: 21_600_000,
    },
    mySqlService: {
      isEnabled: () => true,
      query: async (sql, params) => {
        queryCalls.push(params);
        const rows = rowsByUser.get(params[0]) || [];
        if (!sql.includes("created_at < ?")) return [rows];
        const cursorDate = params[1];
        const cursorId = params[3];
        return [
          rows.filter(
            (row) =>
              row.created_at < cursorDate ||
              (row.created_at.getTime() === cursorDate.getTime() &&
                row.id < cursorId),
          ),
        ];
      },
    },
    mongoService: { isEnabled: () => false },
    rateLimitService: createMockRateLimitService(),
    authService: {
      getClientSessionFromRequest: async (req) => {
        const token = String(req.headers.authorization || "").replace(
          /^Bearer\s+/i,
          "",
        );
        const userId =
          token === "owner-session" ? 42 : token === "other-session" ? 7 : 0;
        return userId
          ? {
              status: "authenticated",
              auth: { user: { id: userId, github_id: `github-${userId}` } },
            }
          : { status: "invalid" };
      },
      sendAuthFailure: (res, status) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: status }));
      },
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const missingToken = await fetch(`${baseUrl}/api/v1/feedback`);
    assert.equal(missingToken.status, 401);

    const unauthenticated = await fetch(`${baseUrl}/api/v1/feedback`, {
      headers: { "x-relay-token": "test-relay-token" },
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal(queryCalls.length, 0);

    const ownerResponse = await fetch(`${baseUrl}/api/v1/feedback`, {
      headers: {
        "x-relay-token": "test-relay-token",
        authorization: "Bearer owner-session",
      },
    });
    assert.equal(ownerResponse.status, 200);
    const ownerPage = await ownerResponse.json();
    assert.deepEqual(
      ownerPage.items,
      ownerRows.slice(0, 10).map((row) => ({
        id: row.id,
        submittedAt: row.created_at.getTime(),
      })),
    );
    assert.equal(ownerPage.hasMore, true);
    assert.equal(typeof ownerPage.nextCursor, "string");
    assert.deepEqual(queryCalls.at(-1), [42]);

    const nextResponse = await fetch(
      `${baseUrl}/api/v1/feedback?limit=10&cursor=${encodeURIComponent(ownerPage.nextCursor)}`,
      {
        headers: {
          "x-relay-token": "test-relay-token",
          authorization: "Bearer owner-session",
        },
      },
    );
    assert.equal(nextResponse.status, 200);
    assert.deepEqual(await nextResponse.json(), {
      items: ownerRows.slice(10).map((row) => ({
        id: row.id,
        submittedAt: row.created_at.getTime(),
      })),
      hasMore: false,
      nextCursor: null,
    });
    assert.equal(queryCalls.at(-1)[0], 42);
    assert.equal(
      queryCalls.at(-1)[1].getTime(),
      ownerRows[9].created_at.getTime(),
    );
    assert.equal(queryCalls.at(-1)[3], ownerRows[9].id);

    const otherResponse = await fetch(`${baseUrl}/api/v1/feedback`, {
      headers: {
        "x-relay-token": "test-relay-token",
        authorization: "Bearer other-session",
      },
    });
    assert.equal(otherResponse.status, 200);
    assert.deepEqual(await otherResponse.json(), {
      items: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          submittedAt: Date.parse("2026-08-19T10:00:00.000Z"),
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    assert.deepEqual(queryCalls.at(-1), [7]);

    const invalidLimit = await fetch(`${baseUrl}/api/v1/feedback?limit=20`, {
      headers: {
        "x-relay-token": "test-relay-token",
        authorization: "Bearer owner-session",
      },
    });
    assert.equal(invalidLimit.status, 400);
    assert.deepEqual(await invalidLimit.json(), {
      error: "invalid_feedback_limit",
    });

    const invalidCursor = await fetch(
      `${baseUrl}/api/v1/feedback?cursor=invalid`,
      {
        headers: {
          "x-relay-token": "test-relay-token",
          authorization: "Bearer owner-session",
        },
      },
    );
    assert.equal(invalidCursor.status, 400);
    assert.deepEqual(await invalidCursor.json(), {
      error: "invalid_feedback_cursor",
    });
  } finally {
    service.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("user feedback history reports unavailable storage", async () => {
  const service = createFeedbackService({
    config: {
      RELAY_TOKEN: "test-relay-token",
      FEEDBACK_AUTHENTICATED_COOLDOWN_MS: 21_600_000,
    },
    mySqlService: { isEnabled: () => false },
    mongoService: { isEnabled: () => false },
    rateLimitService: createMockRateLimitService(),
    authService: {
      getClientSessionFromRequest: async () => {
        throw new Error("authentication should not be checked");
      },
      sendAuthFailure: () => {
        throw new Error("authentication should not be checked");
      },
    },
  });
  const request = new Request("http://relay.test/api/v1/feedback", {
    headers: { "x-relay-token": "test-relay-token" },
  });
  const req = Readable.from([]);
  req.method = "GET";
  req.url = "/api/v1/feedback";
  req.headers = { host: "relay.test", "x-relay-token": "test-relay-token" };
  const response = await new Promise((resolve) => {
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        resolve({
          status: this.status,
          headers: this.headers,
          body: JSON.parse(body),
        });
      },
    };
    service.handleRequest(req, res, new URL(request.url));
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "feedback_storage_not_configured" });
  service.dispose();
});

test("admin endpoints validate pagination and keep response fields aligned", async () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  const storageId = new ObjectId();
  const feedbackRow = {
    id: "11111111-1111-4111-8111-111111111111",
    content: "test feedback",
    status: "new",
    admin_note: "",
    reply: "Thanks for the report",
    submitter_type: "github",
    user_id: 42,
    github_login: "test-admin",
    app_version: "3.1.1",
    platform: "win32",
    image_count: 1,
    created_at: now,
    updated_at: now,
  };
  const deletedStorageIds = [];
  let deletedFeedback = false;
  const mySqlService = {
    isEnabled: () => true,
    query: async (sql) => {
      if (sql.includes("COUNT(*)")) return [[{ total: 1 }]];
      if (sql.includes("INNER JOIN feedback")) {
        return [
          [
            {
              storage_id: storageId.toHexString(),
              file_name: "image.png",
              content_type: "image/png",
              size: VALID_PNG.length,
              user_id: feedbackRow.user_id,
            },
          ],
        ];
      }
      if (sql.includes("FROM feedback_images")) {
        return [
          [
            {
              id: "image-id",
              storage_id: storageId.toHexString(),
              file_name: "image.png",
              content_type: "image/png",
              size: VALID_PNG.length,
            },
          ],
        ];
      }
      if (sql.includes("UPDATE feedback")) return [{ affectedRows: 1 }];
      return [[feedbackRow]];
    },
    transaction: async (callback) =>
      callback({
        query: async (sql) => {
          if (sql.includes("DELETE FROM feedback WHERE")) {
            deletedFeedback = true;
          }
          return [{ affectedRows: 1 }];
        },
      }),
  };
  const service = createFeedbackService({
    config: {
      RELAY_TOKEN: "test-relay-token",
      MAX_FEEDBACK_REQUEST_BYTES: 24 * 1024 * 1024,
      MAX_FEEDBACK_TEXT_LENGTH: 5000,
      MAX_FEEDBACK_IMAGES: 4,
      MAX_FEEDBACK_IMAGE_BYTES: 5 * 1024 * 1024,
      FEEDBACK_AUTHENTICATED_COOLDOWN_MS: 21_600_000,
      SESSION_COOKIE_NAME: "bz_games_session",
    },
    mySqlService,
    mongoService: {
      isEnabled: () => true,
      ensureReady: async () => {},
      getBucket: () => ({
        openDownloadStream: (id) => {
          assert.equal(id.toHexString(), storageId.toHexString());
          return Readable.from(VALID_PNG);
        },
        delete: async (id) => deletedStorageIds.push(id.toHexString()),
      }),
    },
    rateLimitService: createMockRateLimitService(),
    authService: {
      getClientSessionFromRequest: async (req) =>
        req.headers.authorization === "Bearer owner-session"
          ? {
              status: "authenticated",
              auth: {
                user: {
                  id: 42,
                  github_id: "123456789",
                  login: "test-admin",
                  avatar_url: "",
                },
              },
            }
          : {
              status: "invalid",
            },
      sendAuthFailure: (res, status) => {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: status }));
      },
    },
    accessControlService: {
      requireCapability: async () => ({
        user: {
          id: 42,
          github_id: "123456789",
          login: "test-admin",
          avatar_url: "",
        },
      }),
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const invalidPage = await fetch(
      `${baseUrl}/api/admin/v1/feedback?page=invalid`,
    );
    assert.equal(invalidPage.status, 400);

    const listResponse = await fetch(
      `${baseUrl}/api/admin/v1/feedback?page=1&pageSize=20`,
    );
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), {
      items: [
        {
          id: feedbackRow.id,
          content: feedbackRow.content,
          status: feedbackRow.status,
          githubLogin: feedbackRow.github_login,
          imageCount: feedbackRow.image_count,
          createdAt: now.toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const detailResponse = await fetch(
      `${baseUrl}/api/admin/v1/feedback/${feedbackRow.id}`,
    );
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(await detailResponse.json(), {
      id: feedbackRow.id,
      content: feedbackRow.content,
      status: feedbackRow.status,
      githubLogin: feedbackRow.github_login,
      imageCount: feedbackRow.image_count,
      createdAt: now.toISOString(),
      adminNote: feedbackRow.admin_note,
      reply: feedbackRow.reply,
      appVersion: feedbackRow.app_version,
      platform: feedbackRow.platform,
      updatedAt: now.toISOString(),
      images: [{ id: "image-id", fileName: "image.png" }],
    });

    const missingRelayToken = await fetch(
      `${baseUrl}/api/v1/feedback/${feedbackRow.id}`,
    );
    assert.equal(missingRelayToken.status, 401);

    const userDetailResponse = await fetch(
      `${baseUrl}/api/v1/feedback/${feedbackRow.id}`,
      { headers: { "x-relay-token": "test-relay-token" } },
    );
    assert.equal(userDetailResponse.status, 401);

    const ownerDetailResponse = await fetch(
      `${baseUrl}/api/v1/feedback/${feedbackRow.id}`,
      {
        headers: {
          "x-relay-token": "test-relay-token",
          authorization: "Bearer owner-session",
        },
      },
    );
    assert.equal(ownerDetailResponse.status, 200);
    assert.deepEqual(await ownerDetailResponse.json(), {
      id: feedbackRow.id,
      content: feedbackRow.content,
      status: feedbackRow.status,
      reply: feedbackRow.reply,
      imageCount: feedbackRow.image_count,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      images: [
        {
          id: "image-id",
          fileName: "image.png",
          contentType: "image/png",
          size: VALID_PNG.length,
        },
      ],
    });

    const userImageResponse = await fetch(
      `${baseUrl}/api/v1/feedback/${feedbackRow.id}/images/image-id`,
      {
        headers: {
          "x-relay-token": "test-relay-token",
          authorization: "Bearer owner-session",
        },
      },
    );
    assert.equal(userImageResponse.status, 200);
    assert.equal(userImageResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(
      Buffer.from(await userImageResponse.arrayBuffer()),
      VALID_PNG,
    );

    const oversizedNote = await fetch(
      `${baseUrl}/api/admin/v1/feedback/${feedbackRow.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "reviewing",
          adminNote: "x".repeat(5001),
        }),
      },
    );
    assert.equal(oversizedNote.status, 400);

    const oversizedReply = await fetch(
      `${baseUrl}/api/admin/v1/feedback/${feedbackRow.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "reviewing",
          adminNote: "",
          reply: "x".repeat(5001),
        }),
      },
    );
    assert.equal(oversizedReply.status, 400);

    const updateResponse = await fetch(
      `${baseUrl}/api/admin/v1/feedback/${feedbackRow.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "reviewing",
          adminNote: "planned",
          reply: "We have scheduled a fix",
        }),
      },
    );
    assert.equal(updateResponse.status, 200);
    assert.deepEqual(await updateResponse.json(), { ok: true });

    const deleteResponse = await fetch(
      `${baseUrl}/api/admin/v1/feedback/${feedbackRow.id}`,
      { method: "DELETE" },
    );
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), { ok: true });
    assert.equal(deletedFeedback, true);
    assert.deepEqual(deletedStorageIds, [storageId.toHexString()]);
  } finally {
    service.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
});
