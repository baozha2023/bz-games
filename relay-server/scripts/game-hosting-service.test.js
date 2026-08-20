import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGameHostingService } from "../src/services/game-hosting-service.js";

const VALID_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const VALID_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const GAME = {
  id: "com.example.game",
  name: "示例游戏",
  author: "作者",
  type: "singleplayer",
  summary: "完整的游戏简介",
  tags: ["测试"],
  screenshots: ["https://example.com/screenshot.png"],
  visibility: "public",
};
const VERSION = {
  version: "1.0.0",
  description: "首个版本",
  platformVersion: ">=3.1.0",
  releaseNotes: "首次发布",
  gameManifest: {
    entry: "index.html",
    achievements: [{ id: "first", title: "第一次", description: "完成第一次游戏" }],
  },
};

function createDatabase({ failInsert = false } = {}) {
  const state = { games: [], versions: [], assets: [], revisions: [] };
  async function query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.startsWith("SELECT game_id, published_metadata_json, latest_version, owner_user_id FROM hosted_games")) {
      return [state.games.filter((row) => row.game_id === params[0])];
    }
    if (normalized.startsWith("SELECT game_id, published_metadata_json, latest_version FROM hosted_games") ||
        normalized.startsWith("SELECT published_metadata_json, latest_version FROM hosted_games")) {
      return [state.games.filter((row) => row.game_id === params[0])];
    }
    if (normalized.startsWith("SELECT id FROM hosted_game_versions WHERE game_id = ? AND version = ?")) {
      return [state.versions.filter((row) => row.game_id === params[0] && row.version === params[1] && (!normalized.includes("status = 'approved'") || row.status === "approved"))];
    }
    if (normalized.startsWith("INSERT INTO hosted_games")) {
      if (failInsert) throw new Error("simulated_insert_failure");
      state.games.push({
        game_id: params[0], published_metadata_json: params[1], latest_version: params[2],
        owner_user_id: params[3], owner_github_login: params[4],
        updated_by_user_id: params[5], updated_by_github_login: params[6],
        created_at: params[7], updated_at: params[8],
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("INSERT INTO hosted_game_versions")) {
      if (failInsert) throw new Error("simulated_insert_failure");
      state.versions.push({
        id: params[0], game_id: params[1], version: params[2], metadata_json: params[3], status: params[4],
        initial_revision_id: params[5], uploader_user_id: params[6], uploader_github_login: params[7],
        reviewer_user_id: params[8], reviewer_github_login: params[9], reviewed_at: params[10],
        created_at: params[11], updated_at: params[12], review_reason: "",
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("INSERT INTO hosted_game_assets")) {
      state.assets.push({
        id: params[0], version_id: params[1], role: params[2], original_name: params[3], storage_name: params[4],
        content_type: params[5], size: params[6], sha256: params[7], created_at: params[8],
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("UPDATE hosted_games SET published_metadata_json = ?, latest_version")) {
      const gameId = params.length === 6 ? params[5] : params[3];
      const row = state.games.find((item) => item.game_id === gameId);
      if (!row) return [{ affectedRows: 0 }];
      if (params.length === 6) Object.assign(row, { published_metadata_json: params[0], latest_version: params[1], updated_by_user_id: params[2], updated_by_github_login: params[3], updated_at: params[4] });
      else Object.assign(row, { published_metadata_json: params[0], latest_version: params[1], updated_at: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("UPDATE hosted_games SET published_metadata_json = ?")) {
      const row = state.games.find((item) => item.game_id === params[4]);
      if (!row) return [{ affectedRows: 0 }];
      Object.assign(row, { published_metadata_json: params[0], updated_by_user_id: params[1], updated_by_github_login: params[2], updated_at: params[3] });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("UPDATE hosted_games SET latest_version = ?")) {
      const gameId = params.at(-1);
      const row = state.games.find((item) => item.game_id === gameId);
      if (row) { row.latest_version = params[0]; row.updated_at = params.at(-2); }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (normalized.startsWith("UPDATE hosted_game_versions SET metadata_json")) {
      const row = state.versions.find((item) => item.game_id === params.at(-2) && item.version === params.at(-1));
      if (row) { row.metadata_json = params[0]; row.status = params[1]; row.updated_at = params.at(-3); }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (normalized.startsWith("SELECT v.id, v.version, v.metadata_json, v.status")) {
      const gameId = params[0];
      const rows = [];
      for (const version of state.versions.filter((item) => item.game_id === gameId && item.status === "approved")) {
        const assets = state.assets.filter((asset) => asset.version_id === version.id);
        for (const asset of assets.length ? assets : [null]) rows.push({
          id: version.id, version: version.version, metadata_json: version.metadata_json, status: version.status,
          asset_id: asset?.id, role: asset?.role, original_name: asset?.original_name, storage_name: asset?.storage_name,
          content_type: asset?.content_type, size: asset?.size, sha256: asset?.sha256, created_at: asset?.created_at,
        });
      }
      return [rows];
    }
    if (normalized.startsWith("SELECT COUNT(*) AS total FROM hosted_games")) return [[{ total: state.games.length }]];
    if (normalized.startsWith("SELECT g.* FROM hosted_games")) return [[...state.games]];
    if (normalized.startsWith("SELECT v.id AS version_id")) {
      const rows = [];
      for (const version of state.versions) {
        const game = state.games.find((item) => item.game_id === version.game_id);
        if (!game) continue;
        const assets = state.assets.filter((asset) => asset.version_id === version.id);
        for (const asset of assets.length ? assets : [null]) rows.push({
          version_id: version.id, game_id: version.game_id, version: version.version, metadata_json: version.metadata_json,
          status: version.status, initial_revision_id: version.initial_revision_id, review_reason: version.review_reason,
          uploader_github_login: version.uploader_github_login, reviewer_github_login: version.reviewer_github_login,
          reviewed_at: version.reviewed_at,
          version_created_at: version.created_at, version_updated_at: version.updated_at,
          asset_id: asset?.id, role: asset?.role, original_name: asset?.original_name, storage_name: asset?.storage_name,
          content_type: asset?.content_type, size: asset?.size, sha256: asset?.sha256, asset_created_at: asset?.created_at,
        });
      }
      return [rows];
    }
    if (normalized.startsWith("SELECT id, game_id, metadata_json, status, review_reason")) return [[...state.revisions]];
    if (normalized.startsWith("SELECT a.original_name")) {
      const version = state.versions.find((item) => item.game_id === params[0] && item.version === params[1] && item.status === "approved");
      if (!version) return [[]];
      return [state.assets.filter((asset) => asset.version_id === version.id && asset.role === params[2])];
    }
    if (normalized.startsWith("SELECT game_id FROM hosted_games")) return [state.games.filter((item) => item.game_id === params[0])];
    if (normalized.startsWith("SELECT owner_user_id FROM hosted_games")) return [state.games.filter((item) => item.game_id === params[0]).map(({ owner_user_id }) => ({ owner_user_id }))];
    if (normalized.startsWith("SELECT v.id, v.status, v.initial_revision_id, g.owner_user_id")) {
      const version = state.versions.find((item) => item.game_id === params[0] && item.version === params[1]);
      if (!version) return [[]];
      const game = state.games.find((item) => item.game_id === version.game_id);
      return [[{ ...version, owner_user_id: game.owner_user_id }]];
    }
    if (normalized.startsWith("DELETE FROM hosted_games")) {
      const index = state.games.findIndex((item) => item.game_id === params[0]);
      if (index < 0) return [{ affectedRows: 0 }];
      state.games.splice(index, 1);
      const versionIds = state.versions.filter((item) => item.game_id === params[0]).map((item) => item.id);
      state.versions = state.versions.filter((item) => item.game_id !== params[0]);
      state.assets = state.assets.filter((item) => !versionIds.includes(item.version_id));
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("DELETE FROM hosted_game_versions")) {
      const index = state.versions.findIndex((item) => item.id === params[0]);
      if (index < 0) return [{ affectedRows: 0 }];
      state.versions.splice(index, 1); state.assets = state.assets.filter((item) => item.version_id !== params[0]);
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("SELECT version, status FROM hosted_game_versions")) return [state.versions.filter((item) => item.game_id === params[0]).map(({ version, status }) => ({ version, status }))];
    if (normalized.startsWith("SELECT COUNT(*) AS total FROM hosted_game_metadata_revisions")) return [[{ total: state.revisions.filter((item) => item.game_id === params[0]).length }]];
    throw new Error(`unexpected_sql:${normalized}`);
  }
  return {
    state,
    isEnabled: () => true,
    query,
    async transaction(callback) {
      const snapshot = structuredClone(state);
      try { return await callback({ query }); }
      catch (error) { state.games = snapshot.games; state.versions = snapshot.versions; state.assets = snapshot.assets; throw error; }
    },
  };
}

async function createHarness(options = {}) {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bz-hosting-test-"));
  const database = createDatabase(options);
  const service = createGameHostingService({
    config: {
      RELAY_TOKEN: "relay-test-token", GAME_HOSTING_STORAGE_DIR: storageRoot,
      MAX_GAME_HOSTING_FILE_BYTES: options.maxFileBytes ?? 1024,
      MAX_GAME_HOSTING_IMAGE_BYTES: options.maxImageBytes ?? 512,
      MAX_GAME_HOSTING_TOTAL_BYTES: options.maxTotalBytes ?? 4096,
    },
    mySqlService: database,
    accessControlService: {
      requireCapability: async (req, res) => {
        if (["yes", "super"].includes(req.headers["x-test-admin"])) {
          const capabilities = new Set([
            "hosting.view", "hosting.game.create", "hosting.version.create",
            "hosting.all.manage", "hosting.review", "hosting.publish.direct",
          ]);
          if (req.headers["x-test-admin"] === "super") {
            capabilities.add("hosting.capacity.view");
          }
          return {
            user: {
              id: 1,
              login: "admin",
              role:
                req.headers["x-test-admin"] === "super"
                  ? "super_administrator"
                  : "administrator",
            },
            can: (capability) => capabilities.has(capability),
          };
        }
        res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "forbidden" })); return null;
      },
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`, database, storageRoot,
    close: async () => { await new Promise((resolve) => server.close(resolve)); await fs.rm(storageRoot, { recursive: true, force: true }); },
  };
}

function uploadRequest(baseUrl, { game = GAME, version = VERSION, packageName = "星轨守望.zip", packageBody = VALID_ZIP, icon = true, cover = icon, gameId } = {}) {
  const form = new FormData();
  if (!gameId) form.set("game", JSON.stringify(game));
  form.set("version", JSON.stringify(version)); form.set("setLatest", "true");
  form.set("package", new Blob([packageBody], { type: "application/zip" }), packageName);
  if (icon) form.set("icon", new Blob([VALID_PNG], { type: "image/png" }), "中文图标.png");
  if (cover) form.set("cover", new Blob([VALID_PNG], { type: "image/png" }), "中文封面.png");
  const endpoint = gameId
    ? `${baseUrl}/api/portal/v1/game-hosting/games/${encodeURIComponent(gameId)}/versions`
    : `${baseUrl}/api/portal/v1/game-hosting/games`;
  return fetch(endpoint, { method: "POST", headers: { "x-test-admin": "yes" }, body: form });
}

test("creates a full game tree, exports config, and serves UTF-8 named assets", async () => {
  const harness = await createHarness();
  try {
    assert.equal((await fetch(`${harness.baseUrl}/api/portal/v1/game-hosting/tree`)).status, 403);
    const uploaded = await uploadRequest(harness.baseUrl);
    assert.equal(uploaded.status, 201, await uploaded.text());

    const treeResponse = await fetch(`${harness.baseUrl}/api/portal/v1/game-hosting/tree?page=1&pageSize=20`, { headers: { "x-test-admin": "yes" } });
    assert.equal(treeResponse.status, 200);
    const tree = await treeResponse.json();
    assert.equal(tree.total, 1);
    assert.equal(tree.capacity, undefined);
    assert.equal(tree.games[0].versions[0].status, "approved");
    const packageAsset = tree.games[0].versions[0].assets.find((asset) => asset.role === "package");
    const iconAsset = tree.games[0].versions[0].assets.find((asset) => asset.role === "icon");
    assert.equal(packageAsset.fileName, "星轨守望.zip");
    assert.equal(iconAsset.fileName, "中文图标.png");
    assert.equal(tree.games[0].metadata.iconUrl, iconAsset.logicalUrl);

    const superTree = await (
      await fetch(`${harness.baseUrl}/api/portal/v1/game-hosting/tree`, {
        headers: { "x-test-admin": "super" },
      })
    ).json();
    assert.deepEqual(superTree.capacity, {
      usedBytes: VALID_ZIP.length + VALID_PNG.length * 2,
      maxTotalBytes: 4096,
    });

    const configResponse = await fetch(`${harness.baseUrl}/api/portal/v1/game-hosting/games/com.example.game/config`, { headers: { "x-test-admin": "yes" } });
    const exported = await configResponse.json();
    assert.equal(exported.latestVersion, "1.0.0");
    assert.equal(exported.versions[0].downloadUrl, packageAsset.logicalUrl);
    assert.equal(exported.versions[0].sha256.length, 64);

    const assetPath = packageAsset.logicalUrl.replace("games.bzgames.top/", "/api/v1/game-hosting/assets/");
    assert.equal((await fetch(`${harness.baseUrl}${assetPath}`)).status, 401);
    const full = await fetch(`${harness.baseUrl}${assetPath}`, { headers: { "x-relay-token": "relay-test-token" } });
    assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), VALID_ZIP);
    assert.match(full.headers.get("content-disposition"), /%E6%98%9F%E8%BD%A8%E5%AE%88%E6%9C%9B\.zip/);

    const range = await fetch(`${harness.baseUrl}${assetPath}`, { headers: { "x-relay-token": "relay-test-token", range: "bytes=2-5" } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), VALID_ZIP.subarray(2, 6));
    assert.equal((await fetch(`${harness.baseUrl}${assetPath}`, { method: "HEAD", headers: { "x-relay-token": "relay-test-token" } })).status, 200);
    assert.equal((await fetch(`${harness.baseUrl}${assetPath}`, { headers: { "x-relay-token": "relay-test-token", range: "bytes=100-200" } })).status, 416);

    const removed = await fetch(`${harness.baseUrl}/api/portal/v1/game-hosting/games/com.example.game`, { method: "DELETE", headers: { "x-test-admin": "yes" } });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(`${harness.baseUrl}${assetPath}`, { headers: { "x-relay-token": "relay-test-token" } })).status, 404);
  } finally { await harness.close(); }
});

test("adds versions, rejects duplicates and invalid content, and rolls back failures", async () => {
  const harness = await createHarness();
  try {
    assert.equal((await uploadRequest(harness.baseUrl)).status, 201);
    assert.equal((await uploadRequest(harness.baseUrl)).status, 409);
    const secondVersion = { ...VERSION, version: "1.1.0", description: "第二版" };
    assert.equal((await uploadRequest(harness.baseUrl, { gameId: GAME.id, version: secondVersion, icon: false })).status, 201);
    assert.equal(harness.database.state.versions.length, 2);
    assert.equal(harness.database.state.games[0].latest_version, "1.1.0");
    const invalidZip = await uploadRequest(harness.baseUrl, { game: { ...GAME, id: "com.example.invalid" }, packageBody: Buffer.from("not zip"), icon: false });
    assert.equal(invalidZip.status, 400);
  } finally { await harness.close(); }

  const failing = await createHarness({ failInsert: true });
  try {
    assert.equal((await uploadRequest(failing.baseUrl, { icon: false })).status, 500);
    assert.deepEqual(await fs.readdir(path.join(failing.storageRoot, "files")), []);
  } finally { await failing.close(); }
});

test("serializes recursive capacity checks", async () => {
  const harness = await createHarness({ maxFileBytes: 8, maxImageBytes: 8, maxTotalBytes: 8 });
  try {
    const responses = await Promise.all([
      uploadRequest(harness.baseUrl, { game: { ...GAME, id: "com.example.one" }, icon: false }),
      uploadRequest(harness.baseUrl, { game: { ...GAME, id: "com.example.two" }, icon: false }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 507]);
  } finally { await harness.close(); }
});

test("deleting a version preserves the selected latest version and removes stale image references", async () => {
  const harness = await createHarness();
  try {
    assert.equal((await uploadRequest(harness.baseUrl)).status, 201);
    const secondVersion = { ...VERSION, version: "1.1.0", description: "第二版" };
    assert.equal((await uploadRequest(harness.baseUrl, { gameId: GAME.id, version: secondVersion, icon: false })).status, 201);
    const removed = await fetch(`${harness.baseUrl}/api/portal/v1/game-hosting/games/${GAME.id}/versions/1.0.0`, {
      method: "DELETE", headers: { "x-test-admin": "yes" },
    });
    assert.equal(removed.status, 200, await removed.text());
    const config = await (await fetch(`${harness.baseUrl}/api/portal/v1/game-hosting/games/${GAME.id}/config`, {
      headers: { "x-test-admin": "yes" },
    })).json();
    assert.equal(config.latestVersion, "1.1.0");
    assert.equal(config.iconUrl, undefined);
    assert.equal(config.coverUrl, undefined);
  } finally { await harness.close(); }
});
