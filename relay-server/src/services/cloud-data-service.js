import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ObjectId } from "mongodb";

import { sendJson } from "../utils/ws.js";
import { validatePlatformSnapshotStream } from "./cloud-snapshot-validator.js";

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_CONTENT_TYPE = "application/json; charset=utf-8";
const SNAPSHOT_KIND = "platform-snapshot-v2";
const SNAPSHOT_PROTOCOL_VERSION = 2;
const SNAPSHOT_DATA_MODEL_VERSION = 4;

function serializeSnapshotRef(snapshotRef) {
  if (!snapshotRef) return null;
  return {
    version: snapshotRef.snapshot_version,
    protocolVersion: snapshotRef.protocol_version,
    dataModelVersion: snapshotRef.data_model_version,
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
  rateLimitService,
}) {
  function isEnabled() {
    return mongoService.isEnabled() && mySqlService.isEnabled();
  }

  async function requireAuth(req, res) {
    if (!isEnabled()) {
      sendJson(res, 503, { error: "cloud_not_configured" });
      return null;
    }
    const resolution = await authService.getClientSessionFromRequest(req);
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

  async function reserveRateLimit(res, auth, actionType) {
    const githubId = String(auth.user.github_id || "").trim();
    const endpointKey = `cloud.${actionType}`;
    try {
      const reservation = await rateLimitService.reserve({
        githubId,
        endpointKey,
        cooldownMs: RATE_LIMIT_WINDOW_MS,
      });
      if (reservation.ok) {
        return { githubId, endpointKey, token: reservation.token };
      }
      res.setHeader("Retry-After", String(reservation.retryAfterSeconds));
      res.setHeader("X-RateLimit-Reset", toHttpDate(reservation.resetAt));
      sendJson(res, 429, {
        error: "cloud_sync_rate_limited",
        actionType,
        retryAfterSeconds: reservation.retryAfterSeconds,
        resetAt: reservation.resetAt,
      });
    } catch (error) {
      console.error("[cloud-data-service] rate limit reservation failed", error);
      sendJson(res, 503, { error: "cloud_rate_limit_unavailable" });
    }
    return null;
  }

  async function commitRateLimit(reservation, connection) {
    const committed = await rateLimitService.commit({
      ...reservation,
      connection,
    });
    if (!committed) throw new Error("cloud_rate_limit_reservation_lost");
  }

  async function releaseRateLimit(reservation) {
    if (!reservation) return;
    try {
      await rateLimitService.release(reservation);
    } catch (error) {
      console.error("[cloud-data-service] rate limit release failed", error);
    }
  }

  async function handleGetMetadata(req, res) {
    if (config.CLOUD_V2_MAINTENANCE) {
      sendJson(res, 503, { error: "cloud_v2_maintenance" });
      return true;
    }
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
    if (config.CLOUD_V2_MAINTENANCE) {
      sendJson(res, 503, { error: "cloud_v2_maintenance" });
      return true;
    }
    const auth = await requireAuth(req, res);
    if (!auth) return true;
    const snapshotRef = await getSnapshotRef(auth.user.id);
    if (!snapshotRef) {
      sendJson(res, 404, { error: "snapshot_not_found" });
      return true;
    }
    const reservation = await reserveRateLimit(res, auth, "download");
    if (!reservation) return true;

    try {
      await mongoService.ensureReady();
      res.writeHead(200, {
        "content-type": snapshotRef.content_type || SNAPSHOT_CONTENT_TYPE,
        "content-length": String(snapshotRef.size),
        "cache-control": "no-store",
        "content-disposition":
          'attachment; filename="platform-snapshot-v2.json"',
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
      await pipeline(stream, res);
      await commitRateLimit(reservation);
    } catch (error) {
      await releaseRateLimit(reservation);
      if (!res.headersSent) {
        console.error("[cloud-data-service] platform snapshot download failed", error);
        sendJson(res, 500, { error: "cloud_download_failed" });
      } else if (!res.destroyed) {
        res.destroy(error);
      }
    }
    return true;
  }

  async function handleUpload(req, res) {
    if (config.CLOUD_V2_MAINTENANCE) {
      sendJson(res, 503, { error: "cloud_v2_maintenance" });
      return true;
    }
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
    const reservation = await reserveRateLimit(res, auth, "upload");
    if (!reservation) return true;

    const now = new Date();
    const hash = crypto.createHash("sha256");
    let totalBytes = 0;
    await mongoService.ensureReady();
    const bucket = mongoService.getBucket();
    const uploadStream = bucket.openUploadStream(
      `${String(auth.user.id)}/platform-snapshot-v2.json`,
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
    let publicationCommitted = false;

    try {
      await pipeline(req, counterStream, uploadStream);
      await validatePlatformSnapshotStream(
        bucket.openDownloadStream(uploadStream.id),
      );
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
             (user_id, protocol_version, data_model_version,
              file_storage_id, snapshot_version, size, sha256,
              content_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             protocol_version = VALUES(protocol_version),
             data_model_version = VALUES(data_model_version),
             file_storage_id = VALUES(file_storage_id),
             snapshot_version = VALUES(snapshot_version),
             size = VALUES(size),
             sha256 = VALUES(sha256),
             content_type = VALUES(content_type),
             updated_at = VALUES(updated_at)`,
          [
            auth.user.id,
            SNAPSHOT_PROTOCOL_VERSION,
            SNAPSHOT_DATA_MODEL_VERSION,
            String(uploadStream.id),
            nextVersion,
            totalBytes,
            sha256,
            SNAPSHOT_CONTENT_TYPE,
            current?.created_at || now,
            now,
          ],
        );
        await commitRateLimit(reservation, connection);
        return { current, nextVersion };
      });
      publicationCommitted = true;

      if (result.current?.file_storage_id) {
        try {
          const oldObjectId = new ObjectId(result.current.file_storage_id);
          setTimeout(() => {
            bucket.delete(oldObjectId).catch((error) =>
              console.error(
                "[cloud-data-service] old platform snapshot GC failed",
                error,
              ),
            );
          }, config.PLATFORM_SNAPSHOT_GC_GRACE_MS).unref();
        } catch (error) {
          console.error(
            "[cloud-data-service] invalid old platform snapshot pointer",
            error,
          );
        }
      }
      const nextRef = {
        protocol_version: SNAPSHOT_PROTOCOL_VERSION,
        data_model_version: SNAPSHOT_DATA_MODEL_VERSION,
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
      if (!publicationCommitted) {
        await releaseRateLimit(reservation);
        try {
          await bucket.delete(uploadStream.id);
        } catch {}
      } else {
        console.error(
          "[cloud-data-service] response failed after snapshot publication",
          error,
        );
        if (!res.headersSent) {
          sendJson(res, 500, { error: "cloud_upload_response_failed" });
        } else if (!res.destroyed) {
          res.destroy(error);
        }
        return true;
      }
      const errorMessage = error instanceof Error ? error.message : "";
      if (errorMessage === "snapshot_too_large") {
        sendJson(res, 413, { error: "snapshot_too_large" });
        return true;
      }
      if (errorMessage === "snapshot_format_invalid") {
        sendJson(res, 400, { error: "snapshot_format_invalid" });
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
    if (url.pathname === "/api/v2/cloud/platform-snapshot/meta") {
      if (req.method === "GET") return handleGetMetadata(req, res);
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    if (url.pathname === "/api/v2/cloud/platform-snapshot") {
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
