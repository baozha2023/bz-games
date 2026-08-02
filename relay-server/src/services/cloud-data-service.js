import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ObjectId } from "mongodb";

import { sendJson } from "../utils/ws.js";

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_CONTENT_TYPE = "application/json; charset=utf-8";
const SNAPSHOT_KIND = "platform-snapshot";

function serializeSnapshotRef(snapshotRef) {
  if (!snapshotRef) return null;
  return {
    version: snapshotRef.snapshot_version,
    size: snapshotRef.size,
    sha256: snapshotRef.sha256,
    contentType: snapshotRef.content_type,
    updatedAt: snapshotRef.updated_at,
  };
}

function toHttpDate(value) {
  return new Date(value).toUTCString();
}

export function createCloudDataService({
  config,
  authService,
  mongoService,
  mySqlService,
}) {
  function isEnabled() {
    return mongoService.isEnabled() && mySqlService.isEnabled();
  }

  async function requireAuth(req, res) {
    if (!isEnabled()) {
      sendJson(res, 503, { error: "cloud_not_configured" });
      return null;
    }
    const resolution = await authService.getSessionFromRequest(req);
    if (resolution.status !== "authenticated") {
      authService.sendAuthFailure(res, resolution.status);
      return null;
    }
    return resolution.auth;
  }

  async function getSnapshotRef(userId) {
    await mySqlService.ensureReady();
    const [rows] = await mySqlService.query(
      "SELECT * FROM user_platform_snapshots WHERE user_id = ? LIMIT 1",
      [userId],
    );
    return rows[0] || null;
  }

  async function checkRateLimit(res, userId, actionType) {
    await mySqlService.ensureReady();
    const limit = await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT last_action_at
         FROM cloud_sync_limits
         WHERE user_id = ? AND action_type = ?
         FOR UPDATE`,
        [userId, actionType],
      );
      const now = new Date();
      const lastActionAt = rows[0]?.last_action_at
        ? new Date(rows[0].last_action_at)
        : null;
      if (
        lastActionAt &&
        now.getTime() - lastActionAt.getTime() < RATE_LIMIT_WINDOW_MS
      ) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(
            (RATE_LIMIT_WINDOW_MS - (now.getTime() - lastActionAt.getTime())) /
              1000,
          ),
          resetAt: new Date(lastActionAt.getTime() + RATE_LIMIT_WINDOW_MS),
        };
      }
      await connection.query(
        `INSERT INTO cloud_sync_limits
           (user_id, action_type, last_action_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_action_at = VALUES(last_action_at)`,
        [userId, actionType, now],
      );
      return {
        allowed: true,
        retryAfterSeconds: 0,
        resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
      };
    });
    if (limit.allowed) return true;
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res.setHeader("X-RateLimit-Reset", toHttpDate(limit.resetAt));
    sendJson(res, 429, {
      error: "cloud_sync_rate_limited",
      actionType,
      retryAfterSeconds: limit.retryAfterSeconds,
      resetAt: limit.resetAt.toISOString(),
    });
    return false;
  }

  async function handleGetMetadata(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const snapshotRef = await getSnapshotRef(auth.user.id);
    if (!snapshotRef) {
      sendJson(res, 404, { error: "snapshot_not_found" });
      return true;
    }
    res.setHeader("ETag", `"${snapshotRef.snapshot_version}"`);
    sendJson(res, 200, { snapshot: serializeSnapshotRef(snapshotRef) });
    return true;
  }

  async function handleDownload(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const snapshotRef = await getSnapshotRef(auth.user.id);
    if (!snapshotRef) {
      sendJson(res, 404, { error: "snapshot_not_found" });
      return true;
    }
    if (!(await checkRateLimit(res, auth.user.id, "download"))) return true;

    await mongoService.ensureReady();
    res.writeHead(200, {
      "content-type": snapshotRef.content_type || SNAPSHOT_CONTENT_TYPE,
      "content-length": String(snapshotRef.size),
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="platform-snapshot.json"',
      etag: `"${snapshotRef.snapshot_version}"`,
      "x-file-sha256": snapshotRef.sha256,
      "x-snapshot-updated-at": new Date(snapshotRef.updated_at).toISOString(),
      "access-control-allow-origin": "*",
      "access-control-expose-headers":
        "etag,x-file-sha256,x-snapshot-updated-at,x-ratelimit-reset,retry-after",
    });
    const stream = mongoService
      .getBucket()
      .openDownloadStream(new ObjectId(snapshotRef.file_storage_id));
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return true;
  }

  async function handleUpload(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;

    const lengthHeader = Number(req.headers["content-length"] || 0);
    if (
      !Number.isSafeInteger(lengthHeader) ||
      lengthHeader <= 0 ||
      lengthHeader > config.MAX_PLATFORM_CLOUD_SNAPSHOT_BYTES
    ) {
      sendJson(res, 413, { error: "snapshot_too_large" });
      return true;
    }
    if (!(await checkRateLimit(res, auth.user.id, "upload"))) return true;

    const now = new Date();
    const hash = crypto.createHash("sha256");
    let totalBytes = 0;
    await mongoService.ensureReady();
    const bucket = mongoService.getBucket();
    const uploadStream = bucket.openUploadStream(
      `${String(auth.user.id)}/platform-snapshot.json`,
      {
        contentType: SNAPSHOT_CONTENT_TYPE,
        metadata: {
          userId: auth.user.id,
          kind: SNAPSHOT_KIND,
          uploadedAt: now,
        },
      },
    );
    const counterStream = new Transform({
      transform(chunk, encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > config.MAX_PLATFORM_CLOUD_SNAPSHOT_BYTES) {
          callback(new Error("snapshot_too_large"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(req, counterStream, uploadStream);
      const sha256 = hash.digest("hex");
      const result = await mySqlService.transaction(async (connection) => {
        const [rows] = await connection.query(
          `SELECT *
           FROM user_platform_snapshots
           WHERE user_id = ?
           FOR UPDATE`,
          [auth.user.id],
        );
        const current = rows[0] || null;
        const nextVersion = Number(current?.snapshot_version || 0) + 1;
        await connection.query(
          `INSERT INTO user_platform_snapshots
             (user_id, file_storage_id, snapshot_version, size, sha256,
              content_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             file_storage_id = VALUES(file_storage_id),
             snapshot_version = VALUES(snapshot_version),
             size = VALUES(size),
             sha256 = VALUES(sha256),
             content_type = VALUES(content_type),
             updated_at = VALUES(updated_at)`,
          [
            auth.user.id,
            String(uploadStream.id),
            nextVersion,
            totalBytes,
            sha256,
            SNAPSHOT_CONTENT_TYPE,
            current?.created_at || now,
            now,
          ],
        );
        return { current, nextVersion };
      });

      if (result.current?.file_storage_id) {
        const oldObjectId = new ObjectId(result.current.file_storage_id);
        setTimeout(() => {
          bucket.delete(oldObjectId).catch(() => {});
        }, config.PLATFORM_SNAPSHOT_GC_GRACE_MS).unref();
      }
      const nextRef = {
        snapshot_version: result.nextVersion,
        size: totalBytes,
        sha256,
        content_type: SNAPSHOT_CONTENT_TYPE,
        updated_at: now,
      };
      res.setHeader("ETag", `"${result.nextVersion}"`);
      sendJson(res, 200, {
        ok: true,
        snapshot: serializeSnapshotRef(nextRef),
      });
      return true;
    } catch (error) {
      try {
        await bucket.delete(uploadStream.id);
      } catch {}
      if (
        (error instanceof Error ? error.message : "") === "snapshot_too_large"
      ) {
        sendJson(res, 413, { error: "snapshot_too_large" });
        return true;
      }
      console.error(
        "[cloud-data-service] platform snapshot upload failed",
        error,
      );
      sendJson(res, 500, { error: "cloud_upload_failed" });
      return true;
    }
  }

  async function handleRequest(req, res, url) {
    if (url.pathname === "/api/cloud/platform-snapshot/meta") {
      if (req.method === "GET") return handleGetMetadata(req, res);
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (url.pathname === "/api/cloud/platform-snapshot") {
      if (req.method === "GET") return handleDownload(req, res);
      if (req.method === "PUT") return handleUpload(req, res);
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    return false;
  }

  return {
    handleRequest,
    isEnabled,
  };
}
