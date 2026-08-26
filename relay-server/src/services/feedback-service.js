import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";
import { ObjectId } from "mongodb";

import { requireHttpRelayToken } from "../utils/relay-auth.js";
import { sendJson } from "../utils/ws.js";
import { RateLimitError } from "./rate-limit-service.js";
import { PORTAL_CAPABILITIES } from "./portal-authorization.js";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_STATUSES = new Set([
  "new",
  "reviewing",
  "planned",
  "resolved",
  "closed",
]);
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const FEEDBACK_SUBMIT_RATE_LIMIT_KEY = "feedback.submit";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class FeedbackError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function safeFileName(value) {
  const name = path
    .basename(typeof value === "string" ? value : "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return name.slice(0, 255) || `feedback-${crypto.randomUUID()}`;
}

function detectImageType(header) {
  if (
    header.length >= 8 &&
    header
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    header.length >= 3 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function validDimensions(width, height) {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

function inspectPng(buffer) {
  if (buffer.length < 45) return null;
  let offset = 8;
  let dimensions = null;
  let sawImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) return null;
    if (!dimensions) {
      if (type !== "IHDR" || length !== 13) return null;
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      if (!validDimensions(width, height)) return null;
      dimensions = { width, height };
    } else if (type === "IHDR") {
      return null;
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      return length === 0 && sawImageData && chunkEnd === buffer.length
        ? dimensions
        : null;
    }
    offset = chunkEnd;
  }
  return null;
}

function isJpegStartOfFrame(marker) {
  return (
    marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function inspectJpeg(buffer) {
  if (
    buffer.length < 14 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) {
    return null;
  }
  let offset = 2;
  let dimensions = null;
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return null;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (!validDimensions(width, height)) return null;
      dimensions = { width, height };
    }
    if (marker === 0xda) {
      return dimensions;
    }
    offset += segmentLength;
  }
  return null;
}

function inspectWebp(buffer) {
  if (
    buffer.length < 30 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP" ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  ) {
    return null;
  }
  let offset = 12;
  let canvasDimensions = null;
  let sawAnimatedFrame = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    let width = 0;
    let height = 0;
    if (
      type === "VP8 " &&
      length >= 10 &&
      buffer
        .subarray(dataStart + 3, dataStart + 6)
        .equals(Buffer.from([0x9d, 0x01, 0x2a]))
    ) {
      width = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
      height = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
    } else if (type === "VP8L" && length >= 5 && buffer[dataStart] === 0x2f) {
      const bits = buffer.readUInt32LE(dataStart + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === "VP8X" && length >= 10) {
      width = buffer.readUIntLE(dataStart + 4, 3) + 1;
      height = buffer.readUIntLE(dataStart + 7, 3) + 1;
      if (!validDimensions(width, height)) return null;
      canvasDimensions = { width, height };
      width = 0;
      height = 0;
    } else if (type === "ANMF" && length >= 16) {
      sawAnimatedFrame = true;
    }
    if (width || height) {
      return validDimensions(width, height) ? { width, height } : null;
    }
    offset = dataEnd + (length % 2);
  }
  return canvasDimensions && sawAnimatedFrame ? canvasDimensions : null;
}

async function inspectImage(file) {
  const buffer = await fs.readFile(file.tempPath);
  if (buffer.length !== file.size) {
    throw new FeedbackError("invalid_image");
  }
  const contentType = detectImageType(buffer);
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new FeedbackError("unsupported_image_type");
  }
  if (file.declaredType && file.declaredType !== contentType) {
    throw new FeedbackError("image_type_mismatch");
  }
  const dimensions =
    contentType === "image/png"
      ? inspectPng(buffer)
      : contentType === "image/jpeg"
        ? inspectJpeg(buffer)
        : inspectWebp(buffer);
  if (!dimensions) throw new FeedbackError("invalid_image");
  return { ...file, contentType };
}

async function parseMultipart(req, config) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new FeedbackError("multipart_required", 415);
  }
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > config.MAX_FEEDBACK_REQUEST_BYTES
  ) {
    throw new FeedbackError("payload_too_large", 413);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bz-feedback-"));
  const fields = {
    content: "",
    appVersion: "",
    platform: "",
  };
  const files = [];
  const writePromises = [];
  let parseError = null;
  let receivedBytes = 0;

  try {
    const result = await new Promise((resolve, reject) => {
      let busboy;
      try {
        busboy = Busboy({
          headers: req.headers,
          limits: {
            files: config.MAX_FEEDBACK_IMAGES,
            fileSize: config.MAX_FEEDBACK_IMAGE_BYTES,
            fields: 8,
            fieldSize: Math.max(config.MAX_FEEDBACK_TEXT_LENGTH * 4, 64 * 1024),
            parts: config.MAX_FEEDBACK_IMAGES + 8,
          },
        });
      } catch {
        reject(new FeedbackError("invalid_multipart"));
        return;
      }

      const fail = (error) => {
        if (!parseError) {
          parseError =
            error instanceof FeedbackError
              ? error
              : new FeedbackError("invalid_multipart");
        }
      };

      req.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > config.MAX_FEEDBACK_REQUEST_BYTES) {
          fail(new FeedbackError("payload_too_large", 413));
          busboy.destroy(parseError);
        }
      });

      busboy.on("field", (name, value, info) => {
        if (info.valueTruncated) {
          fail(new FeedbackError("field_too_large", 413));
          return;
        }
        if (name === "content") fields.content = value;
        if (name === "appVersion") fields.appVersion = value;
        if (name === "platform") fields.platform = value;
      });

      busboy.on("file", (name, stream, info) => {
        if (name !== "images" || !info.filename) {
          stream.resume();
          if (name !== "images")
            fail(new FeedbackError("unexpected_file_field"));
          return;
        }
        const declaredType = String(info.mimeType || "").toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.has(declaredType)) {
          stream.resume();
          fail(new FeedbackError("unsupported_image_type"));
          return;
        }
        const tempPath = path.join(tempDir, crypto.randomUUID());
        const file = {
          tempPath,
          fileName: safeFileName(info.filename),
          declaredType,
          size: 0,
        };
        files.push(file);
        stream.on("data", (chunk) => {
          file.size += chunk.length;
        });
        stream.on("limit", () => {
          fail(new FeedbackError("image_too_large", 413));
        });
        const writer = createWriteStream(tempPath, { flags: "wx" });
        writePromises.push(
          pipeline(stream, writer).catch((error) => {
            fail(error);
          }),
        );
      });

      busboy.on("filesLimit", () => {
        fail(new FeedbackError("too_many_images"));
      });
      busboy.on("fieldsLimit", () => {
        fail(new FeedbackError("too_many_fields"));
      });
      busboy.on("partsLimit", () => {
        fail(new FeedbackError("too_many_parts"));
      });
      busboy.on("error", (error) => {
        reject(
          error instanceof FeedbackError
            ? error
            : parseError || new FeedbackError("invalid_multipart"),
        );
      });
      busboy.on("close", async () => {
        await Promise.all(writePromises);
        if (parseError) {
          reject(parseError);
          return;
        }
        resolve({ fields, files });
      });

      req.pipe(busboy);
    });

    const content = cleanText(
      result.fields.content,
      config.MAX_FEEDBACK_TEXT_LENGTH,
    );
    if (
      String(result.fields.content || "").trim().length >
      config.MAX_FEEDBACK_TEXT_LENGTH
    ) {
      throw new FeedbackError("feedback_text_too_long");
    }
    if (!content && result.files.length === 0) {
      throw new FeedbackError("feedback_empty");
    }
    const inspectedFiles = [];
    for (const file of result.files) {
      if (!file.size) throw new FeedbackError("invalid_image");
      inspectedFiles.push(await inspectImage(file));
    }
    return {
      tempDir,
      content,
      appVersion: cleanText(result.fields.appVersion, 64),
      platform: cleanText(result.fields.platform, 64),
      files: inspectedFiles,
    };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function uploadFile(bucket, file, feedbackId) {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(file.fileName, {
      contentType: file.contentType,
      metadata: {
        kind: "feedback-image",
        feedbackId,
        uploadedAt: new Date(),
      },
    });
    stream.once("error", reject);
    stream.once("finish", () => resolve(String(stream.id)));
    createReadStream(file.tempPath).once("error", reject).pipe(stream);
  });
}

async function deleteUploadedFiles(bucket, uploaded) {
  if (!bucket) return;
  for (const image of uploaded) {
    try {
      await bucket.delete(new ObjectId(image.storageId));
    } catch {
      // Best-effort rollback. The failure is logged by the caller.
    }
  }
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > maxBytes) {
        exceeded = true;
        reject(new FeedbackError("payload_too_large", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (exceeded) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new FeedbackError("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function serializeFeedbackSummary(row) {
  return {
    id: row.id,
    content: row.content,
    status: row.status,
    githubLogin: row.github_login || "",
    imageCount: Number(row.image_count || 0),
    createdAt: row.created_at,
  };
}

function serializeFeedbackDetail(row) {
  return {
    ...serializeFeedbackSummary(row),
    adminNote: row.admin_note || "",
    reply: row.reply || "",
    appVersion: row.app_version || "",
    platform: row.platform || "",
    updatedAt: row.updated_at,
  };
}

function serializeUserFeedbackDetail(row) {
  return {
    id: row.id,
    content: row.content,
    status: row.status,
    reply: row.reply || "",
    imageCount: Number(row.image_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeUserFeedbackHistory(row) {
  return {
    id: row.id,
    submittedAt: new Date(row.created_at).getTime(),
  };
}

function encodeUserFeedbackCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeUserFeedbackCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const createdAt = new Date(parsed?.createdAt);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.kind !== "feedback-history" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      Number.isNaN(createdAt.getTime())
    ) {
      throw new Error();
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new FeedbackError("invalid_feedback_cursor");
  }
}

export function createFeedbackService({
  config,
  mySqlService,
  mongoService,
  authService,
  accessControlService,
  rateLimitService,
}) {
  const adminAccess = accessControlService;

  async function requireClientAuth(req, res) {
    const resolution = await authService.getClientSessionFromRequest(req);
    if (resolution.status !== "authenticated") {
      authService.sendAuthFailure(res, resolution.status);
      return null;
    }
    return resolution.auth;
  }

  async function requireFeedbackOwner(req, res, userId) {
    const auth = await requireClientAuth(req, res);
    if (!auth) return false;
    if (String(auth.user.id) !== String(userId)) {
      sendJson(res, 403, {
        error: "forbidden",
        message: "This feedback belongs to another account",
      });
      return false;
    }
    return true;
  }

  async function handleSubmit(req, res, url) {
    if (!requireHttpRelayToken(config, req, res, url)) return true;
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "feedback_storage_not_configured" });
      return true;
    }

    const auth = await requireClientAuth(req, res);
    if (!auth) {
      req.resume();
      return true;
    }

    return submitFeedback(req, res, auth, () => parseMultipart(req, config));
  }

  async function handleUserHistory(req, res, url) {
    if (!requireHttpRelayToken(config, req, res, url)) return;
    const auth = await requireClientAuth(req, res);
    if (!auth) return;

    const rawLimit = url.searchParams.get("limit");
    if (rawLimit && rawLimit !== "10") {
      sendJson(res, 400, { error: "invalid_feedback_limit" });
      return;
    }

    try {
      const cursor = decodeUserFeedbackCursor(
        url.searchParams.get("cursor") || "",
      );
      const clauses = ["user_id = ?"];
      const params = [auth.user.id];
      if (cursor) {
        clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
        params.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      const [rows] = await mySqlService.query(
        `SELECT id, created_at
         FROM feedback
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT 11`,
        params,
      );
      const hasMore = rows.length > 10;
      const items = rows.slice(0, 10).map(serializeUserFeedbackHistory);
      const last = items[items.length - 1];
      sendJson(res, 200, {
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeUserFeedbackCursor({
                kind: "feedback-history",
                createdAt: new Date(last.submittedAt).toISOString(),
                id: last.id,
              })
            : null,
      });
    } catch (error) {
      const feedbackError =
        error instanceof FeedbackError
          ? error
          : new FeedbackError("feedback_history_failed", 500);
      sendJson(res, feedbackError.status, { error: feedbackError.code });
    }
  }

  async function submitFeedback(req, res, auth, parsePayload) {
    let parsed = null;
    let bucket = null;
    const uploaded = [];
    let reservation = null;
    const limiterKey = String(auth.user.github_id);
    try {
      reservation = await rateLimitService.reserve({
        githubId: limiterKey,
        endpointKey: FEEDBACK_SUBMIT_RATE_LIMIT_KEY,
        cooldownMs: config.FEEDBACK_AUTHENTICATED_COOLDOWN_MS,
      });
      if (!reservation.ok) {
        req.resume();
        sendJson(res, 429, {
          error: "feedback_too_frequent",
          retryAfterSeconds: reservation.retryAfterSeconds,
          resetAt: reservation.resetAt,
        });
        return true;
      }

      parsed = await parsePayload();

      if (parsed.files.length > 0) {
        if (!mongoService.isEnabled()) {
          throw new FeedbackError("image_storage_not_configured", 503);
        }
        await mongoService.ensureReady();
        bucket = mongoService.getBucket();
      }

      const feedbackId = crypto.randomUUID();
      for (const file of parsed.files) {
        const storageId = await uploadFile(bucket, file, feedbackId);
        uploaded.push({
          id: crypto.randomUUID(),
          storageId,
          fileName: file.fileName,
          contentType: file.contentType,
          size: file.size,
        });
      }

      const now = new Date();
      await mySqlService.transaction(async (connection) => {
        await connection.query(
          `INSERT INTO feedback
            (id, content, status, admin_note, reply, submitter_type, user_id, github_login,
             app_version, platform, image_count, created_at, updated_at)
           VALUES (?, ?, 'new', '', '', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            feedbackId,
            parsed.content,
            "github",
            auth.user.id,
            auth.user.login,
            parsed.appVersion,
            parsed.platform,
            uploaded.length,
            now,
            now,
          ],
        );
        for (const image of uploaded) {
          await connection.query(
            `INSERT INTO feedback_images
              (id, feedback_id, storage_id, file_name, content_type, size, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              image.id,
              feedbackId,
              image.storageId,
              image.fileName,
              image.contentType,
              image.size,
              now,
            ],
          );
        }
        const committed = await rateLimitService.commit({
          githubId: limiterKey,
          endpointKey: FEEDBACK_SUBMIT_RATE_LIMIT_KEY,
          token: reservation.token,
          now,
          connection,
        });
        if (!committed) {
          throw new RateLimitError("rate_limit_reservation_lost");
        }
      });

      sendJson(res, 201, {
        ok: true,
        id: feedbackId,
      });
    } catch (error) {
      await deleteUploadedFiles(bucket, uploaded);
      if (reservation?.ok) {
        try {
          await rateLimitService.release({
            githubId: limiterKey,
            endpointKey: FEEDBACK_SUBMIT_RATE_LIMIT_KEY,
            token: reservation.token,
          });
        } catch (releaseError) {
          console.error(
            "[relay-server] failed to release feedback rate limit reservation",
            releaseError,
          );
        }
      } else {
        req.resume();
      }
      const feedbackError =
        error instanceof FeedbackError
          ? error
          : error instanceof RateLimitError &&
              error.code === "rate_limit_storage_failed"
            ? new FeedbackError("rate_limit_unavailable", 503)
            : error instanceof RateLimitError &&
                error.code === "rate_limit_reservation_lost"
              ? new FeedbackError("feedback_too_frequent", 429)
              : new FeedbackError("feedback_storage_failed", 500);
      if (!(error instanceof FeedbackError)) {
        console.error("[relay-server] feedback submission failed", error);
      }
      sendJson(res, feedbackError.status, {
        error: feedbackError.code,
        ...feedbackError.details,
      });
    } finally {
      if (parsed?.tempDir) {
        await fs.rm(parsed.tempDir, { recursive: true, force: true });
      }
    }
    return true;
  }

  async function handlePortalSubmit(req, res) {
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "feedback_storage_not_configured" });
      return true;
    }
    const auth = await adminAccess.requirePortalSession(req, res, {
      requireOrigin: true,
    });
    if (!auth) {
      req.resume();
      return true;
    }
    if (auth.user.role !== "player") {
      sendJson(res, 403, { error: "forbidden" });
      req.resume();
      return true;
    }
    return submitFeedback(req, res, auth, async () => {
      const body = await readJson(req, 64 * 1024);
      const rawContent = body?.content;
      if (typeof rawContent !== "string") {
        throw new FeedbackError("invalid_feedback");
      }
      if (rawContent.trim().length > config.MAX_FEEDBACK_TEXT_LENGTH) {
        throw new FeedbackError("feedback_text_too_long");
      }
      const content = cleanText(rawContent, config.MAX_FEEDBACK_TEXT_LENGTH);
      if (!content) throw new FeedbackError("feedback_empty");
      return {
        tempDir: null,
        content,
        appVersion: "",
        platform: "portal",
        files: [],
      };
    });
  }

  async function handleList(req, res, url) {
    if (
      !(await adminAccess.requireCapability(
        req,
        res,
        PORTAL_CAPABILITIES.FEEDBACK_VIEW,
      ))
    )
      return;
    const rawPage = Number(url.searchParams.get("page") || 1);
    const rawPageSize = Number(url.searchParams.get("pageSize") || 20);
    if (
      !Number.isInteger(rawPage) ||
      rawPage < 1 ||
      rawPage > 1_000_000 ||
      !Number.isInteger(rawPageSize) ||
      rawPageSize < 1 ||
      rawPageSize > 100
    ) {
      sendJson(res, 400, { error: "invalid_pagination" });
      return;
    }
    const page = rawPage;
    const pageSize = rawPageSize;
    const status = cleanText(url.searchParams.get("status"), 32);
    const query = cleanText(url.searchParams.get("q"), 200);
    const clauses = [];
    const params = [];
    if (status) {
      if (!ALLOWED_STATUSES.has(status)) {
        sendJson(res, 400, { error: "invalid_feedback_status" });
        return;
      }
      clauses.push("status = ?");
      params.push(status);
    }
    if (query) {
      clauses.push("(id LIKE ? OR content LIKE ? OR github_login LIKE ?)");
      const like = `%${query}%`;
      params.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [countRows] = await mySqlService.query(
      `SELECT COUNT(*) AS total FROM feedback ${where}`,
      params,
    );
    const [rows] = await mySqlService.query(
      `SELECT id, content, status, github_login,
              image_count, created_at
       FROM feedback
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    sendJson(res, 200, {
      items: rows.map(serializeFeedbackSummary),
      total: Number(countRows[0]?.total || 0),
      page,
      pageSize,
    });
  }

  async function handleDetail(req, res, feedbackId) {
    if (
      !(await adminAccess.requireCapability(
        req,
        res,
        PORTAL_CAPABILITIES.FEEDBACK_VIEW,
      ))
    )
      return;
    const [rows] = await mySqlService.query(
      `SELECT id, content, status, admin_note, reply, github_login,
              app_version, platform, image_count, created_at, updated_at
       FROM feedback
       WHERE id = ?
       LIMIT 1`,
      [feedbackId],
    );
    if (!rows[0]) {
      sendJson(res, 404, { error: "feedback_not_found" });
      return;
    }
    const [images] = await mySqlService.query(
      `SELECT id, file_name
       FROM feedback_images
       WHERE feedback_id = ?
       ORDER BY created_at ASC`,
      [feedbackId],
    );
    sendJson(res, 200, {
      ...serializeFeedbackDetail(rows[0]),
      images: images.map((image) => ({
        id: image.id,
        fileName: image.file_name,
      })),
    });
  }

  async function handleImage(req, res, feedbackId, imageId) {
    if (
      !(await adminAccess.requireCapability(
        req,
        res,
        PORTAL_CAPABILITIES.FEEDBACK_VIEW,
      ))
    )
      return;
    if (!mongoService.isEnabled()) {
      sendJson(res, 503, { error: "image_storage_not_configured" });
      return;
    }
    const [rows] = await mySqlService.query(
      `SELECT storage_id, file_name, content_type, size
       FROM feedback_images
       WHERE id = ? AND feedback_id = ?
       LIMIT 1`,
      [imageId, feedbackId],
    );
    const image = rows[0];
    if (!image || !ObjectId.isValid(image.storage_id)) {
      sendJson(res, 404, { error: "image_not_found" });
      return;
    }
    await mongoService.ensureReady();
    res.writeHead(200, {
      "content-type": image.content_type,
      "content-length": String(image.size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(
        image.file_name,
      )}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    });
    mongoService
      .getBucket()
      .openDownloadStream(new ObjectId(image.storage_id))
      .once("error", () => res.destroy())
      .pipe(res);
  }

  async function handleUserDetail(req, res, url, feedbackId) {
    if (!requireHttpRelayToken(config, req, res, url)) return;
    const [rows] = await mySqlService.query(
      `SELECT id, content, status, reply, user_id, image_count, created_at, updated_at
       FROM feedback
       WHERE id = ?
       LIMIT 1`,
      [feedbackId],
    );
    const feedback = rows[0];
    if (!feedback) {
      sendJson(res, 404, { error: "feedback_not_found" });
      return;
    }
    if (!(await requireFeedbackOwner(req, res, feedback.user_id))) return;
    const [images] = await mySqlService.query(
      `SELECT id, file_name, content_type, size
       FROM feedback_images
       WHERE feedback_id = ?
       ORDER BY created_at ASC`,
      [feedbackId],
    );
    sendJson(res, 200, {
      ...serializeUserFeedbackDetail(feedback),
      images: images.map((image) => ({
        id: image.id,
        fileName: image.file_name,
        contentType: image.content_type,
        size: Number(image.size || 0),
      })),
    });
  }

  async function handleUserImage(req, res, url, feedbackId, imageId) {
    if (!requireHttpRelayToken(config, req, res, url)) return;
    if (!mongoService.isEnabled()) {
      sendJson(res, 503, { error: "image_storage_not_configured" });
      return;
    }
    const [rows] = await mySqlService.query(
      `SELECT fi.storage_id, fi.file_name, fi.content_type, fi.size, f.user_id
       FROM feedback_images fi
       INNER JOIN feedback f ON f.id = fi.feedback_id
       WHERE fi.id = ? AND fi.feedback_id = ?
       LIMIT 1`,
      [imageId, feedbackId],
    );
    const image = rows[0];
    if (!image || !ObjectId.isValid(image.storage_id)) {
      sendJson(res, 404, { error: "image_not_found" });
      return;
    }
    if (!(await requireFeedbackOwner(req, res, image.user_id))) return;
    await mongoService.ensureReady();
    res.writeHead(200, {
      "content-type": image.content_type,
      "content-length": String(image.size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(
        image.file_name,
      )}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    });
    mongoService
      .getBucket()
      .openDownloadStream(new ObjectId(image.storage_id))
      .once("error", () => res.destroy())
      .pipe(res);
  }

  async function handleUpdate(req, res, feedbackId) {
    if (
      !(await adminAccess.requireCapability(
        req,
        res,
        PORTAL_CAPABILITIES.FEEDBACK_MANAGE,
        { requireOrigin: true },
      ))
    )
      return;
    const body = await readJson(req, 64 * 1024);
    const status = cleanText(body?.status, 32);
    if (!ALLOWED_STATUSES.has(status)) {
      sendJson(res, 400, { error: "invalid_feedback_status" });
      return;
    }
    const rawAdminNote = body?.adminNote ?? "";
    if (typeof rawAdminNote !== "string" || rawAdminNote.trim().length > 5000) {
      sendJson(res, 400, { error: "invalid_admin_note" });
      return;
    }
    const rawReply = body?.reply ?? "";
    if (typeof rawReply !== "string" || rawReply.trim().length > 5000) {
      sendJson(res, 400, { error: "invalid_feedback_reply" });
      return;
    }
    const [result] = await mySqlService.query(
      `UPDATE feedback
       SET status = ?, admin_note = ?, reply = ?, updated_at = ?
       WHERE id = ?`,
      [status, rawAdminNote.trim(), rawReply.trim(), new Date(), feedbackId],
    );
    if (!result.affectedRows) {
      sendJson(res, 404, { error: "feedback_not_found" });
      return;
    }
    sendJson(res, 200, { ok: true });
  }

  async function handleDelete(req, res, feedbackId) {
    if (
      !(await adminAccess.requireCapability(
        req,
        res,
        PORTAL_CAPABILITIES.FEEDBACK_MANAGE,
        { requireOrigin: true },
      ))
    )
      return;
    const [feedbackRows] = await mySqlService.query(
      "SELECT id FROM feedback WHERE id = ? LIMIT 1",
      [feedbackId],
    );
    if (!feedbackRows[0]) {
      sendJson(res, 404, { error: "feedback_not_found" });
      return;
    }
    const [images] = await mySqlService.query(
      "SELECT storage_id FROM feedback_images WHERE feedback_id = ?",
      [feedbackId],
    );
    if (images.length && !mongoService.isEnabled()) {
      sendJson(res, 503, { error: "image_storage_not_configured" });
      return;
    }
    if (images.length) await mongoService.ensureReady();
    await mySqlService.transaction(async (connection) => {
      await connection.query(
        "DELETE FROM feedback_images WHERE feedback_id = ?",
        [feedbackId],
      );
      await connection.query("DELETE FROM feedback WHERE id = ?", [feedbackId]);
    });
    if (images.length) {
      const bucket = mongoService.getBucket();
      const results = await Promise.allSettled(
        images
          .filter((image) => ObjectId.isValid(image.storage_id))
          .map((image) => bucket.delete(new ObjectId(image.storage_id))),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(
            "[relay-server] failed to delete feedback image",
            result.reason,
          );
        }
      }
    }
    sendJson(res, 200, { ok: true });
  }

  async function handleRequest(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/v1/feedback") {
      return handleSubmit(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/feedback") {
      if (!mySqlService.isEnabled()) {
        sendJson(res, 503, { error: "feedback_storage_not_configured" });
        return true;
      }
      await handleUserHistory(req, res, url);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/portal/v1/feedback") {
      return handlePortalSubmit(req, res);
    }
    const userImageMatch = url.pathname.match(
      /^\/api\/v1\/feedback\/([^/]+)\/images\/([^/]+)$/,
    );
    const userDetailMatch = url.pathname.match(
      /^\/api\/v1\/feedback\/([^/]+)$/,
    );
    if (req.method === "GET" && (userImageMatch || userDetailMatch)) {
      if (!mySqlService.isEnabled()) {
        sendJson(res, 503, { error: "feedback_storage_not_configured" });
        return true;
      }
      if (userImageMatch) {
        await handleUserImage(
          req,
          res,
          url,
          safePathSegment(userImageMatch[1]),
          safePathSegment(userImageMatch[2]),
        );
      } else {
        await handleUserDetail(
          req,
          res,
          url,
          safePathSegment(userDetailMatch[1]),
        );
      }
      return true;
    }
    const isAdminFeedbackPath =
      url.pathname === "/api/admin/v1/feedback" ||
      /^\/api\/admin\/v1\/feedback\/[^/]+(?:\/images\/[^/]+)?$/.test(
        url.pathname,
      );
    if (!isAdminFeedbackPath) return false;
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "feedback_storage_not_configured" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/v1/feedback") {
      await handleList(req, res, url);
      return true;
    }
    const imageMatch = url.pathname.match(
      /^\/api\/admin\/v1\/feedback\/([^/]+)\/images\/([^/]+)$/,
    );
    if (req.method === "GET" && imageMatch) {
      await handleImage(
        req,
        res,
        safePathSegment(imageMatch[1]),
        safePathSegment(imageMatch[2]),
      );
      return true;
    }
    const detailMatch = url.pathname.match(
      /^\/api\/admin\/v1\/feedback\/([^/]+)$/,
    );
    if (detailMatch && req.method === "GET") {
      await handleDetail(req, res, safePathSegment(detailMatch[1]));
      return true;
    }
    if (detailMatch && req.method === "PATCH") {
      try {
        await handleUpdate(req, res, safePathSegment(detailMatch[1]));
      } catch (error) {
        const feedbackError =
          error instanceof FeedbackError
            ? error
            : new FeedbackError("invalid_request");
        sendJson(res, feedbackError.status, { error: feedbackError.code });
      }
      return true;
    }
    if (detailMatch && req.method === "DELETE") {
      await handleDelete(req, res, safePathSegment(detailMatch[1]));
      return true;
    }
    sendJson(res, 404, { error: "not_found" });
    return true;
  }

  return {
    handleRequest,
    dispose: () => {},
  };
}
