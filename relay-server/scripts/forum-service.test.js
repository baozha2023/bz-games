import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";

import { createForumService, isoTime } from "../src/services/forum-service.js";

const POST_IDS = Array.from(
  { length: 11 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

test("SQL null timestamps remain null instead of becoming the Unix epoch", () => {
  assert.equal(isoTime(null), null);
  assert.equal(isoTime(undefined), null);
  assert.equal(isoTime(""), null);
  assert.equal(
    isoTime(new Date("2026-08-23T00:00:00.000Z")),
    "2026-08-23T00:00:00.000Z",
  );
});

function response() {
  return {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

function createService({ searchEnabled = false } = {}) {
  const config = {
    RELAY_TOKEN: "relay-token",
    MAX_FORUM_REQUEST_BYTES: 24 * 1024 * 1024,
    MAX_FORUM_TITLE_LENGTH: 80,
    MAX_FORUM_BODY_LENGTH: 5000,
    MAX_FORUM_COMMENT_LENGTH: 1000,
    MAX_FORUM_IMAGES: 4,
    MAX_FORUM_IMAGE_BYTES: 5 * 1024 * 1024,
    FORUM_ADMIN_POST_COOLDOWN_MS: 60 * 60 * 1000,
    FORUM_PLAYER_POST_COOLDOWN_MS: 24 * 60 * 60 * 1000,
    FORUM_ADMIN_COMMENT_COOLDOWN_MS: 5 * 60 * 1000,
    FORUM_PLAYER_COMMENT_COOLDOWN_MS: 30 * 60 * 1000,
    FORUM_SEARCH_WORKER_INTERVAL_MS: 5000,
    PORTAL_PUBLIC_URL: "https://games.example/admin/",
  };
  const mySqlService = {
    isEnabled: () => true,
    query: async (sql) => {
      if (sql.includes("SELECT id, title, body, status FROM forum_posts")) {
        return [
          [
            { id: POST_IDS[0], title: "可用帖子", body: "可用正文", status: 0 },
            {
              id: POST_IDS[1],
              title: "已删除帖子",
              body: "不得泄露",
              status: 1,
            },
          ],
        ];
      }
      if (sql.includes("SELECT p.id, p.author_user_id")) {
        return [
          [
            {
              id: POST_IDS[0],
              author_user_id: 7,
              title: "详情帖子",
              body: "正文",
              author_nickname: "详情作者",
              author_login: "detail-author",
              created_at: new Date(Date.UTC(2026, 0, 1, 0, 11)),
              updated_at: null,
              status: 0,
              deleted_at: null,
              deleted_by: null,
              like_count: 3,
              comment_count: 2,
            },
          ],
        ];
      }
      if (sql.includes("FROM forum_posts") && sql.includes("ORDER BY")) {
        return [
          POST_IDS.map((id, index) => ({
            id,
            title: `帖子 ${index + 1}`,
            author_nickname: `玩家 ${index + 1}`,
            author_login: `github-user-${index + 1}`,
            created_at: new Date(Date.UTC(2026, 0, 1, 0, 11 - index)),
            like_count: index,
            comment_count: index + 1,
          })),
        ];
      }
      if (sql.includes("SELECT id FROM forum_posts"))
        return [[{ id: POST_IDS[0] }]];
      if (sql.includes("FROM forum_comments c")) {
        return [
          [
            {
              id: POST_IDS[1],
              post_id: POST_IDS[0],
              author_user_id: 8,
              content: "评论正文",
              like_count: 2,
              created_at: new Date(Date.UTC(2026, 0, 1, 0, 12)),
              updated_at: null,
              status: 0,
              deleted_at: null,
              deleted_by: null,
              nickname: "评论作者",
              author_login: "comment-author",
              avatar_url: "",
              liked_by_me: 0,
            },
          ],
        ];
      }
      return [[]];
    },
    transaction: async (callback) =>
      callback({
        query: async (sql) => {
          if (sql.includes("SELECT id FROM forum_posts"))
            return [[{ id: POST_IDS[0] }]];
          if (sql.startsWith("INSERT IGNORE INTO forum_post_likes"))
            return [{ affectedRows: 1 }];
          if (sql.startsWith("UPDATE forum_posts"))
            return [{ affectedRows: 1 }];
          if (sql.includes("AS like_count FROM forum_posts"))
            return [[{ like_count: 1 }]];
          return [[]];
        },
      }),
  };
  return createForumService({
    config,
    mySqlService,
    mongoService: { isEnabled: () => false },
    authService: {
      getClientSessionFromRequest: async () => ({
        status: "authenticated",
        auth: { user: { id: 7, github_id: "7", role: "player" } },
      }),
      sendAuthFailure: () => {},
    },
    accessControlService: { requireCapability: async () => null },
    rateLimitService: {},
    sensitiveWordService: { filterText: (value) => value },
    searchService: {
      isEnabled: () => searchEnabled,
      ensureIndex: async () => true,
    },
  });
}

function createDeleteService({
  userId = 7,
  post,
  comment,
  admin = false,
} = {}) {
  const calls = [];
  const config = {
    RELAY_TOKEN: "relay-token",
    FORUM_SEARCH_WORKER_INTERVAL_MS: 5000,
    PORTAL_PUBLIC_URL: "https://games.example/admin/",
  };
  const mySqlService = {
    isEnabled: () => true,
    query: async () => [[]],
    transaction: async (callback) =>
      callback({
        query: async (sql, params) => {
          calls.push({ sql, params });
          if (
            sql.includes("SELECT id, author_user_id, status FROM forum_posts")
          )
            return [[post].filter(Boolean)];
          if (sql.includes("SELECT id, status FROM forum_posts"))
            return [[post].filter(Boolean)];
          if (sql.includes("SELECT post_id FROM forum_comments"))
            return [
              [{ post_id: comment?.post_id || POST_IDS[0] }].filter(() =>
                Boolean(comment),
              ),
            ];
          if (
            sql.includes(
              "SELECT id, post_id, author_user_id, status FROM forum_comments",
            )
          )
            return [[comment].filter(Boolean)];
          return [{ affectedRows: 1 }];
        },
      }),
  };
  const service = createForumService({
    config,
    mySqlService,
    mongoService: { isEnabled: () => false },
    authService: {
      getClientSessionFromRequest: async () => ({
        status: "authenticated",
        auth: {
          user: { id: userId, github_id: String(userId), role: "player" },
        },
      }),
      sendAuthFailure: () => {},
    },
    accessControlService: {
      requireCapability: async () => (admin ? { user: { id: 99 } } : null),
    },
    rateLimitService: {},
    sensitiveWordService: { filterText: (value) => value },
    searchService: { isEnabled: () => false },
  });
  return { service, calls };
}

function createRestoreService({ post, comment, authorized = true } = {}) {
  const calls = [];
  const config = {
    RELAY_TOKEN: "relay-token",
    FORUM_SEARCH_WORKER_INTERVAL_MS: 5000,
    PORTAL_PUBLIC_URL: "https://games.example/admin/",
  };
  const mySqlService = {
    isEnabled: () => true,
    query: async () => [[]],
    transaction: async (callback) =>
      callback({
        query: async (sql, params) => {
          calls.push({ sql, params });
          if (sql.includes("SELECT post_id FROM forum_comments"))
            return [
              [{ post_id: comment?.post_id || POST_IDS[0] }].filter(() =>
                Boolean(comment),
              ),
            ];
          if (sql.includes("SELECT id, status FROM forum_posts"))
            return [[post].filter(Boolean)];
          if (
            sql.includes(
              "SELECT id, post_id, author_user_id, status FROM forum_comments",
            )
          )
            return [[comment].filter(Boolean)];
          return [{ affectedRows: 1 }];
        },
      }),
  };
  const service = createForumService({
    config,
    mySqlService,
    mongoService: { isEnabled: () => false },
    authService: {
      getClientSessionFromRequest: async () => ({
        status: "authenticated",
        auth: { user: { id: 7, github_id: "7", role: "player" } },
      }),
      sendAuthFailure: () => {},
    },
    accessControlService: {
      requireCapability: async (_req, res) => {
        if (!authorized) {
          res.writeHead(403);
          res.end(JSON.stringify({ error: "forbidden" }));
          return null;
        }
        return { user: { id: 99, role: "super_administrator" } };
      },
    },
    rateLimitService: {},
    sensitiveWordService: { filterText: (value) => value },
    searchService: { isEnabled: () => false },
  });
  return { service, calls };
}

test("forum feed uses a stable ten-item cursor page", async () => {
  const service = createService();
  const result = response();
  await service.handleRequest(
    {
      method: "GET",
      url: "/api/v1/forum/posts?limit=10",
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL("http://localhost/api/v1/forum/posts?limit=10"),
  );
  const body = JSON.parse(result.body);
  assert.equal(result.status, 200, result.body);
  assert.equal(body.items.length, 10);
  assert.equal(body.hasMore, true);
  assert.equal(typeof body.nextCursor, "string");
  assert.equal(body.items[0].title, "帖子 1");
  assert.equal(body.items[0].authorNickname, "玩家 1");
  assert.equal(body.items[0].authorGithubLogin, "github-user-1");
  assert.equal("body" in body.items[0], false);
});

test("post references resolve active, deleted and missing IDs without Elasticsearch", async () => {
  const request = Readable.from([
    Buffer.from(
      JSON.stringify({ ids: [POST_IDS[0], POST_IDS[1], POST_IDS[2]] }),
    ),
  ]);
  Object.assign(request, {
    method: "POST",
    url: "/api/v1/forum/post-references/resolve",
    headers: { "x-relay-token": "relay-token" },
  });
  const result = response();
  await createService({ searchEnabled: false }).handleRequest(
    request,
    result,
    new URL("http://localhost/api/v1/forum/post-references/resolve"),
  );
  assert.equal(result.status, 200, result.body);
  assert.deepEqual(JSON.parse(result.body), {
    items: [
      {
        id: POST_IDS[0],
        status: "active",
        title: "可用帖子",
        body: "可用正文",
      },
      { id: POST_IDS[1], status: "deleted" },
      { id: POST_IDS[2], status: "missing" },
    ],
  });
});

test("forum post details include the author's nickname and GitHub login", async () => {
  const service = createService();
  const result = response();
  await service.handleRequest(
    {
      method: "GET",
      url: `/api/v1/forum/posts/${POST_IDS[0]}`,
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL(`http://localhost/api/v1/forum/posts/${POST_IDS[0]}`),
  );
  const body = JSON.parse(result.body);
  assert.equal(result.status, 200);
  assert.equal(body.authorNickname, "详情作者");
  assert.equal(body.authorGithubLogin, "detail-author");
});

test("forum comments include the author's nickname and GitHub login", async () => {
  const service = createService();
  const result = response();
  await service.handleRequest(
    {
      method: "GET",
      url: `/api/v1/forum/posts/${POST_IDS[0]}/comments?limit=10`,
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL(
      `http://localhost/api/v1/forum/posts/${POST_IDS[0]}/comments?limit=10`,
    ),
  );
  const body = JSON.parse(result.body);
  assert.equal(result.status, 200);
  assert.equal(body.items[0].author.nickname, "评论作者");
  assert.equal(body.items[0].author.githubLogin, "comment-author");
});

test("forum client endpoints reject requests without the relay token", async () => {
  const result = response();
  await createService().handleRequest(
    { method: "GET", url: "/api/v1/forum/posts", headers: {} },
    result,
    new URL("http://localhost/api/v1/forum/posts"),
  );
  assert.equal(result.status, 401);
  assert.deepEqual(JSON.parse(result.body), { error: "unauthorized" });
});

test("forum search is explicitly unavailable when Elasticsearch is not configured", async () => {
  const result = response();
  await createService().handleRequest(
    {
      method: "GET",
      url: "/api/v1/forum/posts?limit=10&q=方块",
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL(
      "http://localhost/api/v1/forum/posts?limit=10&q=%E6%96%B9%E5%9D%97",
    ),
  );
  assert.equal(result.status, 503);
  assert.deepEqual(JSON.parse(result.body), { error: "search_unavailable" });
});

test("forum search status is authenticated and disabled without Elasticsearch", async () => {
  const result = response();
  await createService().handleRequest(
    {
      method: "GET",
      url: "/api/v1/forum/search-status",
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL("http://localhost/api/v1/forum/search-status"),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { enabled: false });
});

test("forum like endpoints return the transactionally updated count", async () => {
  const result = response();
  await createService().handleRequest(
    {
      method: "PUT",
      url: `/api/v1/forum/posts/${POST_IDS[0]}/like`,
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL(`http://localhost/api/v1/forum/posts/${POST_IDS[0]}/like`),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), {
    ok: true,
    liked: true,
    likeCount: 1,
  });
});

test("forum resource IDs fail with a client error instead of an internal error", async () => {
  const result = response();
  await createService().handleRequest(
    {
      method: "GET",
      url: "/api/v1/forum/posts/not-a-uuid",
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL("http://localhost/api/v1/forum/posts/not-a-uuid"),
  );
  assert.equal(result.status, 400);
  assert.deepEqual(JSON.parse(result.body), { error: "invalid_forum_id" });
});

test("forum authors can delete their own post and cascade active comments", async () => {
  const { service, calls } = createDeleteService({
    post: { id: POST_IDS[0], author_user_id: 7, status: 0 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "DELETE",
      url: `/api/v1/forum/posts/${POST_IDS[0]}`,
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL(`http://localhost/api/v1/forum/posts/${POST_IDS[0]}`),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  assert.ok(
    calls.some(
      ({ sql }) =>
        sql.includes("SET status = 1") && sql.includes("forum_posts"),
    ),
  );
  assert.ok(
    calls.some(
      ({ sql }) =>
        sql.includes("SET status = 1") && sql.includes("forum_comments"),
    ),
  );
  assert.ok(
    calls.some(
      ({ sql }) =>
        sql.includes("comment_count = 0") && sql.includes("forum_posts"),
    ),
  );
});

test("forum authors cannot delete another user's post", async () => {
  const { service, calls } = createDeleteService({
    post: { id: POST_IDS[0], author_user_id: 8, status: 0 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "DELETE",
      url: `/api/v1/forum/posts/${POST_IDS[0]}`,
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL(`http://localhost/api/v1/forum/posts/${POST_IDS[0]}`),
  );
  assert.equal(result.status, 404);
  assert.deepEqual(JSON.parse(result.body), { error: "forum_post_not_found" });
  assert.equal(
    calls.some(({ sql }) => sql.includes("UPDATE forum_posts")),
    false,
  );
});

test("forum authors can delete their own comment and decrement the parent count", async () => {
  const { service, calls } = createDeleteService({
    post: { id: POST_IDS[0], status: 0 },
    comment: {
      id: POST_IDS[1],
      post_id: POST_IDS[0],
      author_user_id: 7,
      status: 0,
    },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "DELETE",
      url: `/api/v1/forum/comments/${POST_IDS[1]}`,
      headers: { "x-relay-token": "relay-token" },
    },
    result,
    new URL(`http://localhost/api/v1/forum/comments/${POST_IDS[1]}`),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  assert.ok(
    calls.some(
      ({ sql }) =>
        sql.includes("SET status = 1") && sql.includes("forum_comments"),
    ),
  );
  assert.ok(
    calls.some(({ sql }) =>
      sql.includes("UPDATE forum_posts SET comment_count"),
    ),
  );
});

test("forum administrators use status 2 and preserve deleted_at audit time", async () => {
  const { service, calls } = createDeleteService({
    admin: true,
    post: { id: POST_IDS[0], status: 0 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "DELETE",
      url: `/api/admin/v1/forum/posts/${POST_IDS[0]}`,
      headers: { origin: "https://games.example/admin/" },
    },
    result,
    new URL(`https://games.example/api/admin/v1/forum/posts/${POST_IDS[0]}`),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  assert.ok(
    calls.some(
      ({ sql }) => sql.includes("SET status = 2") && sql.includes("deleted_at"),
    ),
  );
  assert.ok(
    calls.some(
      ({ sql }) =>
        sql.includes("comment_count = 0") && sql.includes("forum_posts"),
    ),
  );
});

test("only an authorized portal session can restore a post", async () => {
  const { service } = createRestoreService({
    authorized: false,
    post: { id: POST_IDS[0], status: 2 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "POST",
      url: `/api/admin/v1/forum/posts/${POST_IDS[0]}/restore`,
      headers: { origin: "https://games.example" },
    },
    result,
    new URL(
      `https://games.example/api/admin/v1/forum/posts/${POST_IDS[0]}/restore`,
    ),
  );
  assert.equal(result.status, 403);
  assert.deepEqual(JSON.parse(result.body), { error: "forbidden" });
});

test("restoring a post clears its deletion state without restoring comments and queues search upsert", async () => {
  const { service, calls } = createRestoreService({
    post: { id: POST_IDS[0], status: 2 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "POST",
      url: `/api/admin/v1/forum/posts/${POST_IDS[0]}/restore`,
      headers: { origin: "https://games.example" },
    },
    result,
    new URL(
      `https://games.example/api/admin/v1/forum/posts/${POST_IDS[0]}/restore`,
    ),
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true });
  assert.ok(
    calls.some(
      ({ sql }) =>
        sql.includes("SET status = 0") &&
        sql.includes("forum_posts") &&
        sql.includes("deleted_at = NULL") &&
        sql.includes("deleted_by = NULL"),
    ),
  );
  assert.equal(
    calls.some(({ sql }) => sql.includes("forum_comments")),
    false,
  );
  assert.ok(
    calls.some(
      ({ sql, params }) =>
        sql.includes("INSERT INTO forum_search_outbox") &&
        params[1] === "upsert",
    ),
  );
});

test("restoring an active post is idempotent", async () => {
  const { service, calls } = createRestoreService({
    post: { id: POST_IDS[0], status: 0 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "POST",
      url: `/api/admin/v1/forum/posts/${POST_IDS[0]}/restore`,
      headers: { origin: "https://games.example" },
    },
    result,
    new URL(
      `https://games.example/api/admin/v1/forum/posts/${POST_IDS[0]}/restore`,
    ),
  );
  assert.equal(result.status, 200);
  assert.equal(
    calls.some(({ sql }) => sql.startsWith("UPDATE forum_posts")),
    false,
  );
  assert.equal(
    calls.some(({ sql }) => sql.includes("forum_search_outbox")),
    false,
  );
});

test("restoring a comment makes it visible and increments the parent count", async () => {
  const { service, calls } = createRestoreService({
    post: { id: POST_IDS[0], status: 0 },
    comment: { id: POST_IDS[1], post_id: POST_IDS[0], status: 2 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "POST",
      url: `/api/admin/v1/forum/comments/${POST_IDS[1]}/restore`,
      headers: { origin: "https://games.example" },
    },
    result,
    new URL(
      `https://games.example/api/admin/v1/forum/comments/${POST_IDS[1]}/restore`,
    ),
  );
  assert.equal(result.status, 200);
  assert.ok(
    calls.some(
      ({ sql }) =>
        sql.includes("SET status = 0") &&
        sql.includes("forum_comments") &&
        sql.includes("deleted_at = NULL") &&
        sql.includes("deleted_by = NULL"),
    ),
  );
  assert.ok(
    calls.some(({ sql }) =>
      sql.includes("UPDATE forum_posts SET comment_count = comment_count + 1"),
    ),
  );
});

test("restoring an active comment does not increment the parent count", async () => {
  const { service, calls } = createRestoreService({
    post: { id: POST_IDS[0], status: 0 },
    comment: { id: POST_IDS[1], post_id: POST_IDS[0], status: 0 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "POST",
      url: `/api/admin/v1/forum/comments/${POST_IDS[1]}/restore`,
      headers: { origin: "https://games.example" },
    },
    result,
    new URL(
      `https://games.example/api/admin/v1/forum/comments/${POST_IDS[1]}/restore`,
    ),
  );
  assert.equal(result.status, 200);
  assert.equal(
    calls.some(({ sql }) => sql.startsWith("UPDATE forum_comments")),
    false,
  );
  assert.equal(
    calls.some(({ sql }) => sql.includes("comment_count = comment_count + 1")),
    false,
  );
});

test("a comment cannot be restored while its post is deleted", async () => {
  const { service, calls } = createRestoreService({
    post: { id: POST_IDS[0], status: 2 },
    comment: { id: POST_IDS[1], post_id: POST_IDS[0], status: 2 },
  });
  const result = response();
  await service.handleRequest(
    {
      method: "POST",
      url: `/api/admin/v1/forum/comments/${POST_IDS[1]}/restore`,
      headers: { origin: "https://games.example" },
    },
    result,
    new URL(
      `https://games.example/api/admin/v1/forum/comments/${POST_IDS[1]}/restore`,
    ),
  );
  assert.equal(result.status, 409);
  assert.deepEqual(JSON.parse(result.body), { error: "forum_post_not_active" });
  assert.equal(
    calls.some(({ sql }) => sql.startsWith("UPDATE forum_comments")),
    false,
  );
});
