import crypto from "node:crypto";
import {Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {ObjectId} from "mongodb";

import {sendJson} from "../utils/ws.js";

const SUPPORTED_FILES = {
    "config.json": {
        fileKey: "config.json", contentType: "application/json",
    }, "play_sessions.db": {
        fileKey: "play_sessions.db", contentType: "application/sql; charset=utf-8",
    }, "achievement_unlocks.db": {
        fileKey: "achievement_unlocks.db", contentType: "application/sql; charset=utf-8",
    }, "stats_reports.db": {
        fileKey: "stats_reports.db", contentType: "application/sql; charset=utf-8",
    },
};

const SUPPORTED_FILE_KEYS = Object.keys(SUPPORTED_FILES);

const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeVersion(value) {
    if (!value) return null;
    const normalized = String(value).replaceAll('"', "").trim();
    if (!/^\d+$/.test(normalized)) return null;
    return Number(normalized);
}

function serializeFileRef(fileRef) {
    if (!fileRef) return null;
    return {
        fileKey: fileRef.file_key,
        version: fileRef.version,
        size: fileRef.size,
        sha256: fileRef.sha256,
        contentType: fileRef.content_type,
        updatedAt: fileRef.updated_at,
    };
}

function toHttpDate(value) {
    return new Date(value).toUTCString();
}

export function createCloudDataService({config, authService, mongoService, mySqlService}) {
    function isEnabled() {
        return mongoService.isEnabled() && mySqlService.isEnabled();
    }

    async function requireAuth(req, res) {
        if (!isEnabled()) {
            sendJson(res, 503, {error: "cloud_not_configured"});
            return null;
        }
        const auth = await authService.getSessionFromRequest(req);
        if (!auth) {
            sendJson(res, 401, {error: "unauthorized"});
            return null;
        }
        return auth;
    }

    function resolveFileSpec(url) {
        const match = url.pathname.match(/^\/api\/cloud\/files\/([^/]+?)(?:\/meta)?$/);
        if (!match) return null;
        return SUPPORTED_FILES[decodeURIComponent(match[1])] || null;
    }

    async function getFileRef(userId, fileKey) {
        await mySqlService.ensureReady();
        const [rows] = await mySqlService.query("SELECT * FROM user_file_refs WHERE user_id = ? AND file_key = ? LIMIT 1", [userId, fileKey],);
        return rows[0] || null;
    }

    async function tryConsumeRateLimit(userId, actionType, operationId) {
        await mySqlService.ensureReady();
        const currentOperationId = operationId || crypto.randomUUID();
        const limit = await mySqlService.transaction(async (connection) => {
            const [resultSets] = await connection.query(`SELECT last_action_at, operation_id
                                                         FROM cloud_sync_limits
                                                         WHERE user_id = ?
                                                           AND action_type = ?
                                                             FOR
                                                         UPDATE`, [userId, actionType],);
            const now = new Date();
            const currentLimit = resultSets[0] || null;
            const lastActionAt = currentLimit?.last_action_at ? new Date(currentLimit.last_action_at) : null;
            if (lastActionAt && now.getTime() - lastActionAt.getTime() < RATE_LIMIT_WINDOW_MS) {
                if (currentLimit.operation_id && currentLimit.operation_id === currentOperationId) {
                    return {
                        allowed: true,
                        retryAfterSeconds: 0,
                        resetAt: new Date(lastActionAt.getTime() + RATE_LIMIT_WINDOW_MS),
                        operationId: currentOperationId,
                    };
                }
                return {
                    allowed: false,
                    retryAfterSeconds: Math.ceil((RATE_LIMIT_WINDOW_MS - (now.getTime() - lastActionAt.getTime())) / 1000),
                    resetAt: new Date(lastActionAt.getTime() + RATE_LIMIT_WINDOW_MS),
                    operationId: "",
                };
            }
            await connection.query(`INSERT INTO cloud_sync_limits (user_id, action_type, operation_id, last_action_at)
                                    VALUES (?, ?, ?, ?)
                                    ON DUPLICATE KEY UPDATE operation_id   = VALUES(operation_id),
                                                            last_action_at = VALUES(last_action_at)`, [userId, actionType, currentOperationId, now],);
            return {
                allowed: true,
                retryAfterSeconds: 0,
                resetAt: new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
                operationId: currentOperationId,
            };
        });
        return limit;
    }

    async function isOperationFileProcessed(userId, actionType, operationId, fileKey) {
        if (!operationId) return false;
        const [rows] = await mySqlService.query(`SELECT id
                                                 FROM cloud_sync_operation_files
                                                 WHERE user_id = ?
                                                   AND action_type = ?
                                                   AND operation_id = ?
                                                   AND file_key = ?
                                                 LIMIT 1`, [userId, actionType, operationId, fileKey],);
        return Boolean(rows[0]);
    }

    async function markOperationFileProcessed(userId, actionType, operationId, fileKey) {
        if (!operationId) return;
        await mySqlService.query(`INSERT IGNORE INTO cloud_sync_operation_files (user_id, action_type, operation_id, file_key, created_at)
                                  VALUES (?, ?, ?, ?, ?)`, [userId, actionType, operationId, fileKey, new Date()],);
    }

    async function checkRateLimit(req, res, userId, actionType, fileKey) {
        const operationId = String(req.headers["x-cloud-operation-id"] || "");
        if (await isOperationFileProcessed(userId, actionType, operationId, fileKey)) {
            sendJson(res, 429, {
                error: "cloud_sync_rate_limited",
                actionType,
                retryAfterSeconds: RATE_LIMIT_WINDOW_MS / 1000,
                resetAt: new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString(),
            });
            return null;
        }
        const limit = await tryConsumeRateLimit(userId, actionType, operationId);
        if (limit.allowed) {
            res.setHeader("X-Cloud-Operation-Id", limit.operationId);
            return limit.operationId;
        }
        res.setHeader("Retry-After", String(limit.retryAfterSeconds));
        res.setHeader("X-RateLimit-Reset", toHttpDate(limit.resetAt));
        sendJson(res, 429, {
            error: "cloud_sync_rate_limited",
            actionType,
            retryAfterSeconds: limit.retryAfterSeconds,
            resetAt: limit.resetAt.toISOString(),
        });
        return null;
    }

    async function handleListFiles(req, res) {
        const auth = await requireAuth(req, res);
        if (!auth) return true;
        const [fileRefs] = await mySqlService.query(`SELECT *
                                                     FROM user_file_refs
                                                     WHERE user_id = ?
                                                       AND file_key IN (?)`, [auth.user.id, SUPPORTED_FILE_KEYS],);
        sendJson(res, 200, {
            files: SUPPORTED_FILE_KEYS.map((fileKey) => serializeFileRef(fileRefs.find((item) => item.file_key === fileKey))),
        });
        return true;
    }

    async function handleGetMetadata(req, res, spec) {
        const auth = await requireAuth(req, res);
        if (!auth) return true;
        const fileRef = await getFileRef(auth.user.id, spec.fileKey);
        if (!fileRef) {
            sendJson(res, 404, {error: "file_not_found"});
            return true;
        }
        res.setHeader("ETag", `"${fileRef.version}"`);
        sendJson(res, 200, {
            file: serializeFileRef(fileRef),
        });
        return true;
    }

    async function handleDownload(req, res, spec) {
        const auth = await requireAuth(req, res);
        if (!auth) return true;
        const fileRef = await getFileRef(auth.user.id, spec.fileKey);
        if (!fileRef) {
            sendJson(res, 404, {error: "file_not_found"});
            return true;
        }
        const operationId = await checkRateLimit(req, res, auth.user.id, "download", spec.fileKey);
        if (!operationId) return true;
        res.writeHead(200, {
            "content-type": fileRef.content_type || spec.contentType,
            "content-length": String(fileRef.size || 0),
            "cache-control": "no-store",
            "content-disposition": `attachment; filename="${spec.fileKey}"`,
            etag: `"${fileRef.version}"`,
            "x-file-sha256": fileRef.sha256,
            "x-cloud-operation-id": operationId,
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "etag,x-file-sha256,x-cloud-operation-id,x-ratelimit-reset,retry-after",
        });
        await markOperationFileProcessed(auth.user.id, "download", operationId, spec.fileKey);
        await mongoService.ensureReady();
        const stream = mongoService.getBucket().openDownloadStream(new ObjectId(fileRef.file_storage_id));
        stream.on("error", () => {
            if (!res.headersSent) {
                sendJson(res, 500, {error: "cloud_download_failed"});
            } else {
                res.destroy();
            }
        });
        stream.pipe(res);
        return true;
    }

    async function handleUpload(req, res, spec) {
        const auth = await requireAuth(req, res);
        if (!auth) return true;

        const lengthHeader = Number(req.headers["content-length"] || 0);
        if (lengthHeader > config.MAX_CLOUD_FILE_BYTES) {
            sendJson(res, 413, {error: "file_too_large"});
            return true;
        }

        const currentFile = await getFileRef(auth.user.id, spec.fileKey);
        const expectedVersion = normalizeVersion(req.headers["if-match"]);
        if (expectedVersion !== null && expectedVersion !== (currentFile?.version || 0)) {
            sendJson(res, 409, {
                error: "version_conflict", currentVersion: currentFile?.version || 0,
            });
            return true;
        }
        const operationId = await checkRateLimit(req, res, auth.user.id, "upload", spec.fileKey);
        if (!operationId) return true;

        const now = new Date();
        const hash = crypto.createHash("sha256");
        let totalBytes = 0;
        await mongoService.ensureReady();
        const uploadStream = mongoService.getBucket().openUploadStream(`${String(auth.user.id)}/${spec.fileKey}`, {
            contentType: String(req.headers["content-type"] || spec.contentType), metadata: {
                userId: auth.user.id, fileKey: spec.fileKey, uploadedAt: now,
            },
        });
        const counterStream = new Transform({
            transform(chunk, encoding, callback) {
                totalBytes += chunk.length;
                if (totalBytes > config.MAX_CLOUD_FILE_BYTES) {
                    callback(new Error("file_too_large"));
                    return;
                }
                hash.update(chunk);
                callback(null, chunk);
            },
        });

        try {
            await pipeline(req, counterStream, uploadStream);
            const nextVersion = (currentFile?.version || 0) + 1;
            const nextRef = {
                user_id: auth.user.id,
                file_key: spec.fileKey,
                file_storage_id: String(uploadStream.id),
                version: nextVersion,
                size: totalBytes,
                sha256: hash.digest("hex"),
                content_type: String(req.headers["content-type"] || spec.contentType),
                created_at: currentFile?.created_at || now,
                updated_at: now,
            };
            await mySqlService.query(`INSERT INTO user_file_refs (user_id, file_key, file_storage_id, version, size,
                                                                  sha256, content_type,
                                                                  created_at, updated_at)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                                      ON DUPLICATE KEY UPDATE file_storage_id = VALUES(file_storage_id),
                                                              version         = VALUES(version),
                                                              size            = VALUES(size),
                                                              sha256          = VALUES(sha256),
                                                              content_type    = VALUES(content_type),
                                                              updated_at      = VALUES(updated_at)`, [nextRef.user_id, nextRef.file_key, nextRef.file_storage_id, nextRef.version, nextRef.size, nextRef.sha256, nextRef.content_type, nextRef.created_at, nextRef.updated_at,],);
            if (currentFile?.file_storage_id) {
                try {
                    await mongoService.getBucket().delete(new ObjectId(currentFile.file_storage_id));
                } catch {
                }
            }
            res.setHeader("ETag", `"${nextVersion}"`);
            res.setHeader("X-Cloud-Operation-Id", operationId);
            await markOperationFileProcessed(auth.user.id, "upload", operationId, spec.fileKey);
            sendJson(res, 200, {
                ok: true, file: serializeFileRef(nextRef),
            });
            return true;
        } catch (error) {
            try {
                await mongoService.getBucket().delete(uploadStream.id);
            } catch {
            }
            if ((error instanceof Error ? error.message : "") === "file_too_large") {
                sendJson(res, 413, {error: "file_too_large"});
                return true;
            }
            sendJson(res, 500, {
                error: "cloud_upload_failed", message: error instanceof Error ? error.message : String(error),
            });
            return true;
        }
    }

    async function handleRequest(req, res, url) {
        if (url.pathname === "/api/cloud/files" && req.method === "GET") {
            return handleListFiles(req, res);
        }

        const spec = resolveFileSpec(url);
        if (!spec) return false;

        if (url.pathname.endsWith("/meta") && req.method === "GET") {
            return handleGetMetadata(req, res, spec);
        }
        if (req.method === "GET") {
            return handleDownload(req, res, spec);
        }
        if (req.method === "PUT") {
            return handleUpload(req, res, spec);
        }
        sendJson(res, 405, {error: "method_not_allowed"});
        return true;
    }

    return {
        handleRequest, isEnabled,
    };
}
