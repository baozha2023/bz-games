import assert from "node:assert/strict";
import http from "node:http";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { ObjectId } from "mongodb";

import {
  createFeedbackRateLimiter,
  createFeedbackService,
} from "../src/services/feedback-service.js";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("feedback limiter commits a successful cooldown", () => {
  const limiter = createFeedbackRateLimiter(48 * 60 * 60 * 1000);
  try {
    const first = limiter.reserve("203.0.113.10", 1_000);
    assert.equal(first.ok, true);
    assert.equal(limiter.commit("203.0.113.10", first.token, 2_000), true);
    const blocked = limiter.reserve("203.0.113.10", 3_000);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterSeconds, 172_799);
  } finally {
    limiter.dispose();
  }
});

test("feedback limiter blocks concurrent requests and releases failures", () => {
  const limiter = createFeedbackRateLimiter(21_600_000);
  try {
    const first = limiter.reserve("203.0.113.11", 1_000);
    assert.equal(first.ok, true);
    assert.equal(limiter.reserve("203.0.113.11", 1_001).ok, false);
    assert.equal(limiter.reserve("203.0.113.11", 601_000).ok, false);
    limiter.release("203.0.113.11", first.token);
    assert.equal(limiter.reserve("203.0.113.11", 1_002).ok, true);
  } finally {
    limiter.dispose();
  }
});

test("feedback limiter keeps different identities independent", () => {
  const limiter = createFeedbackRateLimiter(21_600_000);
  try {
    assert.equal(limiter.reserve("203.0.113.12", 1_000).ok, true);
    assert.equal(limiter.reserve("203.0.113.13", 1_000).ok, true);
  } finally {
    limiter.dispose();
  }
});

test("feedback limiter state is cleared when the service is recreated", () => {
  const firstLimiter = createFeedbackRateLimiter(21_600_000);
  const first = firstLimiter.reserve("github-1", 1_000);
  assert.equal(firstLimiter.commit("github-1", first.token, 2_000), true);
  assert.equal(firstLimiter.reserve("github-1", 3_000).ok, false);
  firstLimiter.dispose();

  const restartedLimiter = createFeedbackRateLimiter(21_600_000);
  try {
    assert.equal(restartedLimiter.reserve("github-1", 3_000).ok, true);
  } finally {
    restartedLimiter.dispose();
  }
});

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
    forwardedFor = "",
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
    if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
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
