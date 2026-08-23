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
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const POST_RATE_LIMIT_KEY = "forum.post.create";
const COMMENT_RATE_LIMIT_KEY = "forum.comment.create";

export const FORUM_STATUS = Object.freeze({
  ACTIVE: 0,
  AUTHOR_DELETED: 1,
  ADMIN_DELETED: 2,
});

class ForumError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function charLength(value) {
  return Array.from(value).length;
}

function safePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function parseId(value, code = "invalid_forum_id") {
  const id = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(id)) throw new ForumError(code, 400);
  return id;
}

function parseIdOrSend(res, value, code = "invalid_forum_id") {
  try {
    return parseId(value, code);
  } catch (error) {
    sendJson(res, error instanceof ForumError ? error.status : 400, {
      error: error instanceof ForumError ? error.code : code,
    });
    return null;
  }
}

function safeFileName(value) {
  const name = path
    .basename(typeof value === "string" ? value : "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return name.slice(0, 255) || `forum-${crypto.randomUUID()}`;
}

function detectImageType(header) {
  if (
    header.length >= 8 &&
    header.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
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
  if (buffer.length < 33) return null;
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  let offset = 8;
  let dimensions = null;
  let hasImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return null;
    if (type === "IHDR") {
      if (length !== 13 || dimensions) return null;
      dimensions = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
      };
    } else if (type === "IDAT") {
      hasImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || !dimensions || !hasImageData || dataEnd + 4 !== buffer.length) return null;
      return validDimensions(dimensions.width, dimensions.height) ? dimensions : null;
    }
    offset = dataEnd + 4;
  }
  return null;
}

function isJpegStartOfFrame(marker) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function inspectJpeg(buffer) {
  if (
    buffer.length < 14 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) return null;
  let offset = 2;
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return null;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return null;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return null;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return validDimensions(width, height) ? { width, height } : null;
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
  ) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    if (type === "VP8 " && length >= 10 && buffer.subarray(dataStart + 3, dataStart + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      const width = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
      const height = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
      return validDimensions(width, height) ? { width, height } : null;
    }
    if (type === "VP8L" && length >= 5 && buffer[dataStart] === 0x2f) {
      const bits = buffer.readUInt32LE(dataStart + 1);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >>> 14) & 0x3fff) + 1;
      return validDimensions(width, height) ? { width, height } : null;
    }
    if (type === "VP8X" && length >= 10) {
      const width = buffer.readUIntLE(dataStart + 4, 3) + 1;
      const height = buffer.readUIntLE(dataStart + 7, 3) + 1;
      return validDimensions(width, height) ? { width, height } : null;
    }
    offset = dataEnd + (length % 2);
  }
  return null;
}

async function inspectImage(file) {
  const buffer = await fs.readFile(file.tempPath);
  if (buffer.length !== file.size || !buffer.length) throw new ForumError("invalid_image");
  const contentType = detectImageType(buffer);
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) throw new ForumError("unsupported_image_type");
  if (file.declaredType && file.declaredType !== contentType) throw new ForumError("image_type_mismatch");
  const dimensions = contentType === "image/png"
    ? inspectPng(buffer)
    : contentType === "image/jpeg"
      ? inspectJpeg(buffer)
      : inspectWebp(buffer);
  if (!dimensions) throw new ForumError("invalid_image");
  return { ...file, contentType, ...dimensions };
}

async function parseMultipart(req, config) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    req.resume();
    throw new ForumError("multipart_required", 415);
  }
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > config.MAX_FORUM_REQUEST_BYTES) {
    req.resume();
    throw new ForumError("payload_too_large", 413);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bz-forum-"));
  const fields = { title: "", body: "" };
  const files = [];
  const writes = [];
  let parseError = null;
  let receivedBytes = 0;
  try {
    const result = await new Promise((resolve, reject) => {
      let busboy;
      try {
        busboy = Busboy({
          headers: req.headers,
          limits: {
            files: config.MAX_FORUM_IMAGES,
            fileSize: config.MAX_FORUM_IMAGE_BYTES,
            fields: 2,
            fieldSize: Math.max(config.MAX_FORUM_BODY_LENGTH * 4, 64 * 1024),
            parts: config.MAX_FORUM_IMAGES + 2,
          },
        });
      } catch {
        reject(new ForumError("invalid_multipart"));
        return;
      }
      const fail = (error) => {
        if (!parseError) parseError = error instanceof ForumError ? error : new ForumError("invalid_multipart");
      };
      req.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > config.MAX_FORUM_REQUEST_BYTES) {
          fail(new ForumError("payload_too_large", 413));
          busboy.destroy(parseError);
        }
      });
      busboy.on("field", (name, value, info) => {
        if (info.valueTruncated) {
          fail(new ForumError("field_too_large", 413));
          return;
        }
        if (name === "title") fields.title = value;
        if (name === "body") fields.body = value;
      });
      busboy.on("file", (name, stream, info) => {
        if (name !== "images" || !info.filename) {
          stream.resume();
          if (name !== "images") fail(new ForumError("unexpected_file_field"));
          return;
        }
        const declaredType = String(info.mimeType || "").toLowerCase();
        if (!ALLOWED_IMAGE_TYPES.has(declaredType)) {
          stream.resume();
          fail(new ForumError("unsupported_image_type"));
          return;
        }
        const file = {
          tempPath: path.join(tempDir, crypto.randomUUID()),
          fileName: safeFileName(info.filename),
          declaredType,
          size: 0,
        };
        files.push(file);
        stream.on("data", (chunk) => { file.size += chunk.length; });
        stream.on("limit", () => fail(new ForumError("image_too_large", 413)));
        const writer = createWriteStream(file.tempPath, { flags: "wx" });
        writes.push(pipeline(stream, writer).catch((error) => fail(error)));
      });
      busboy.on("filesLimit", () => fail(new ForumError("too_many_images")));
      busboy.on("fieldsLimit", () => fail(new ForumError("too_many_fields")));
      busboy.on("partsLimit", () => fail(new ForumError("too_many_parts")));
      busboy.on("error", (error) => reject(error instanceof ForumError ? error : parseError || new ForumError("invalid_multipart")));
      busboy.on("close", async () => {
        await Promise.all(writes);
        if (parseError) reject(parseError);
        else resolve({ fields, files });
      });
      req.pipe(busboy);
    });

    const title = cleanText(result.fields.title);
    const body = cleanText(result.fields.body);
    if (!title || charLength(title) > config.MAX_FORUM_TITLE_LENGTH) throw new ForumError("forum_title_invalid");
    if (charLength(body) > config.MAX_FORUM_BODY_LENGTH) throw new ForumError("forum_body_too_long");
    const inspectedFiles = [];
    for (const file of result.files) inspectedFiles.push(await inspectImage(file));
    return { tempDir, title, body, files: inspectedFiles };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function uploadFile(bucket, file, postId) {
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(file.fileName, {
      contentType: file.contentType,
      metadata: { kind: "forum-image", postId, uploadedAt: new Date() },
    });
    const source = createReadStream(file.tempPath);
    let settled = false;
    const fail = async (error) => {
      if (settled) return;
      settled = true;
      source.destroy();
      stream.destroy();
      if (ObjectId.isValid(stream.id)) await bucket.delete(new ObjectId(stream.id)).catch(() => {});
      reject(error);
    };
    stream.once("error", fail);
    source.once("error", fail);
    stream.once("finish", () => {
      if (settled) return;
      settled = true;
      resolve(String(stream.id));
    });
    source.pipe(stream);
  });
}

async function deleteUploadedFiles(bucket, uploaded) {
  if (!bucket) return;
  await Promise.allSettled(
    uploaded
      .filter((item) => ObjectId.isValid(item.storageId))
      .map((item) => bucket.delete(new ObjectId(item.storageId))),
  );
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
        req.resume();
        reject(new ForumError("payload_too_large", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (exceeded) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new ForumError("invalid_json")); }
    });
    req.on("error", reject);
  });
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new ForumError("invalid_forum_cursor");
  }
}

export function isoTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializePost(row, likedByMe = false, ownedByMe = false) {
  return {
    id: String(row.id),
    title: row.title,
    authorNickname: row.author_nickname || "玩家",
    body: row.body,
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
    deletedAt: isoTime(row.deleted_at),
    deletedBy: row.deleted_by === null || row.deleted_by === undefined ? null : String(row.deleted_by),
    deletedByGithubName: row.deleted_by_login || null,
    status: Number(row.status ?? FORUM_STATUS.ACTIVE),
    likeCount: Number(row.like_count || 0),
    commentCount: Number(row.comment_count || 0),
    likedByMe: Boolean(likedByMe),
    ownedByMe: Boolean(ownedByMe),
  };
}

function serializeComment(row, likedByMe = false, ownedByMe = false) {
  return {
    id: String(row.id),
    postId: String(row.post_id),
    content: row.content,
    createdAt: isoTime(row.created_at),
    updatedAt: isoTime(row.updated_at),
    deletedAt: isoTime(row.deleted_at),
    deletedBy: row.deleted_by === null || row.deleted_by === undefined ? null : String(row.deleted_by),
    deletedByGithubName: row.deleted_by_login || null,
    status: Number(row.status ?? FORUM_STATUS.ACTIVE),
    likeCount: Number(row.like_count || 0),
    likedByMe: Boolean(likedByMe),
    ownedByMe: Boolean(ownedByMe),
    author: {
      id: String(row.author_user_id),
      nickname: row.nickname || "玩家",
      avatarUrl: row.avatar_url || "",
    },
  };
}

function roleCooldown(role, adminMs, playerMs) {
  return role === "administrator" || role === "super_administrator" ? adminMs : playerMs;
}

function isRateLimitStorageError(error) {
  return error instanceof RateLimitError && error.code === "rate_limit_storage_failed";
}

export function createForumService({
  config,
  mySqlService,
  mongoService,
  authService,
  accessControlService,
  rateLimitService,
  sensitiveWordService,
  searchService,
}) {
  let workerTimer = null;
  let workerRunning = false;
  let searchAvailable = false;

  async function requireClientAuth(req, res) {
    const resolution = await authService.getClientSessionFromRequest(req);
    if (resolution.status !== "authenticated") {
      authService.sendAuthFailure(res, resolution.status);
      return null;
    }
    return resolution.auth;
  }

  function postCooldown(auth) {
    return roleCooldown(
      auth.user.role,
      config.FORUM_ADMIN_POST_COOLDOWN_MS,
      config.FORUM_PLAYER_POST_COOLDOWN_MS,
    );
  }

  function commentCooldown(auth) {
    return roleCooldown(
      auth.user.role,
      config.FORUM_ADMIN_COMMENT_COOLDOWN_MS,
      config.FORUM_PLAYER_COMMENT_COOLDOWN_MS,
    );
  }

  async function enqueueSearch(connection, postId, operation, now) {
    await connection.query(
      `INSERT INTO forum_search_outbox
         (post_id, operation, attempts, next_attempt_at, locked_until,
          last_error, created_at, processed_at)
       VALUES (?, ?, 0, ?, NULL, '', ?, NULL)`,
      [postId, operation, now, now],
    );
  }

  async function claimOutbox() {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 60_000);
    return mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT id, post_id, operation, attempts
         FROM forum_search_outbox
         WHERE processed_at IS NULL
           AND next_attempt_at <= ?
           AND (locked_until IS NULL OR locked_until <= ?)
         ORDER BY id ASC
         LIMIT 10
         FOR UPDATE SKIP LOCKED`,
        [now, now],
      );
      for (const row of rows) {
        await connection.query(
          `UPDATE forum_search_outbox
           SET attempts = attempts + 1, locked_until = ?
           WHERE id = ?`,
          [lockedUntil, row.id],
        );
      }
      return rows.map((row) => ({ ...row, attempts: Number(row.attempts || 0) + 1 }));
    });
  }

  async function processOutboxItem(item) {
    try {
      const [rows] = await mySqlService.query(
        `SELECT id, title, body, created_at, status
         FROM forum_posts WHERE id = ? LIMIT 1`,
        [item.post_id],
      );
      const post = rows[0];
      if (item.operation === "delete" || !post || Number(post.status) !== FORUM_STATUS.ACTIVE) {
        await searchService.deletePost(item.post_id);
      } else {
        await searchService.upsertPost({
          id: String(post.id),
          title: post.title,
          body: post.body,
          createdAt: isoTime(post.created_at),
        });
      }
      await mySqlService.query(
        `UPDATE forum_search_outbox
         SET processed_at = ?, locked_until = NULL, last_error = ''
         WHERE id = ?`,
        [new Date(), item.id],
      );
      return true;
    } catch (error) {
      const now = new Date();
      const delay = Math.min(60 * 60 * 1000, 1000 * 2 ** Math.min(item.attempts, 10));
      await mySqlService.query(
        `UPDATE forum_search_outbox
         SET next_attempt_at = ?, locked_until = NULL, last_error = ?
         WHERE id = ?`,
        [new Date(now.getTime() + delay), String(error?.message || "search_sync_failed").slice(0, 2000), item.id],
      ).catch(() => {});
      searchAvailable = false;
      return false;
    }
  }

  async function refreshSearchAvailability() {
    if (!searchService.isEnabled()) {
      searchAvailable = false;
      return false;
    }
    try {
      await searchService.ensureIndex();
      searchAvailable = true;
    } catch {
      searchAvailable = false;
    }
    return searchAvailable;
  }

  async function processOutbox() {
    if (workerRunning || !searchService.isEnabled() || !mySqlService.isEnabled()) return;
    workerRunning = true;
    try {
      if (!searchAvailable && !(await refreshSearchAvailability())) return;
      const items = await claimOutbox();
      for (const item of items) {
        if (!(await processOutboxItem(item))) break;
      }
    } catch {
      searchAvailable = false;
    } finally {
      workerRunning = false;
    }
  }

  function startSearchWorker() {
    if (!searchService.isEnabled() || workerTimer) return;
    void refreshSearchAvailability();
    workerTimer = setInterval(processOutbox, config.FORUM_SEARCH_WORKER_INTERVAL_MS);
    workerTimer.unref();
  }

  async function listPosts(req, res, url) {
    if (!requireHttpRelayToken(config, req, res, url)) return true;
    const auth = await requireClientAuth(req, res);
    if (!auth) return true;
    const rawLimit = url.searchParams.get("limit");
    if (rawLimit && rawLimit !== "10") {
      sendJson(res, 400, { error: "invalid_forum_limit" });
      return true;
    }
    const query = cleanText(url.searchParams.get("q") || "");
    if (charLength(query) > 100) {
      sendJson(res, 400, { error: "forum_query_too_long" });
      return true;
    }
    try {
      const cursor = decodeCursor(url.searchParams.get("cursor") || "");
      if (query) {
        if (cursor && (cursor.kind !== "search" || cursor.query !== query)) throw new ForumError("invalid_forum_cursor");
        const result = await searchPosts(query, cursor);
        sendJson(res, 200, result);
        return true;
      }
      if (cursor && cursor.kind !== "feed") throw new ForumError("invalid_forum_cursor");
      const params = [FORUM_STATUS.ACTIVE];
      const clauses = ["p.status = ?"];
      if (cursor) {
        const date = new Date(cursor.createdAt);
        if (!UUID_PATTERN.test(cursor.id) || Number.isNaN(date.getTime())) throw new ForumError("invalid_forum_cursor");
        clauses.push("(p.created_at < ? OR (p.created_at = ? AND p.id < ?))");
        params.push(date, date, cursor.id);
      }
      const [rows] = await mySqlService.query(
        `SELECT p.id, p.title, u.nickname AS author_nickname, p.created_at, p.like_count, p.comment_count
         FROM forum_posts p
         INNER JOIN users u ON u.id = p.author_user_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY p.created_at DESC, p.id DESC LIMIT 11`,
        params,
      );
      const hasMore = rows.length > 10;
      const items = rows.slice(0, 10).map((row) => ({
        id: String(row.id),
        title: row.title,
        authorNickname: row.author_nickname || "玩家",
        createdAt: isoTime(row.created_at),
        likeCount: Number(row.like_count || 0),
        commentCount: Number(row.comment_count || 0),
      }));
      const last = items[items.length - 1];
      sendJson(res, 200, {
        items,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor({ kind: "feed", createdAt: last.createdAt, id: last.id }) : null,
      });
    } catch (error) {
      sendJson(res, error instanceof ForumError ? error.status : 500, {
        error: error instanceof ForumError ? error.code : "forum_list_failed",
      });
    }
    return true;
  }

  async function searchPosts(query, cursor) {
    if (!searchAvailable) throw new ForumError("search_unavailable", 503);
    if (cursor && (!Array.isArray(cursor.after) || cursor.after.length !== 3)) {
      throw new ForumError("invalid_forum_cursor");
    }
    let after = cursor?.after;
    let nextSort = null;
    let hasMore = false;
    const collected = [];
    try {
      for (let attempt = 0; attempt < 4 && collected.length < 10; attempt += 1) {
        const result = await searchService.search(query, after, 20);
        if (!result.hits.length) {
          hasMore = false;
          break;
        }
        const ids = result.hits.map((hit) => hit.id);
        const placeholders = ids.map(() => "?").join(",");
        const [rows] = await mySqlService.query(
          `SELECT p.id, p.title, u.nickname AS author_nickname, p.created_at, p.like_count, p.comment_count
           FROM forum_posts p
           INNER JOIN users u ON u.id = p.author_user_id
           WHERE p.status = ? AND p.id IN (${placeholders})`,
          [FORUM_STATUS.ACTIVE, ...ids],
        );
        const byId = new Map(rows.map((row) => [String(row.id), row]));
        for (const hit of result.hits) {
          const row = byId.get(hit.id);
          if (!row || collected.some((item) => item.id === hit.id)) continue;
          collected.push({
            id: hit.id,
            title: row.title,
            authorNickname: row.author_nickname || "玩家",
            createdAt: isoTime(row.created_at),
            likeCount: Number(row.like_count || 0),
            commentCount: Number(row.comment_count || 0),
            sort: hit.sort,
          });
          if (collected.length >= 10) break;
        }
        nextSort = result.hits[result.hits.length - 1].sort;
        hasMore = result.hits.length === 20;
        if (!hasMore) break;
        if (collected.length < 10) after = nextSort;
      }
    } catch (error) {
      searchAvailable = false;
      throw new ForumError("search_unavailable", 503, {
        retryable: true,
      });
    }
    const items = collected.slice(0, 10).map(({ sort, ...item }) => item);
    const last = collected[items.length - 1];
    const cursorSort = last?.sort || nextSort;
    return {
      items,
      hasMore,
      nextCursor: hasMore && cursorSort ? encodeCursor({ kind: "search", query, after: cursorSort }) : null,
    };
  }

  async function getSearchStatus(req, res, url) {
    if (!requireHttpRelayToken(config, req, res, url)) return true;
    const auth = await requireClientAuth(req, res);
    if (!auth) return true;
    sendJson(res, 200, { enabled: searchAvailable });
    return true;
  }

  async function getPost(req, res, postId, allowDeleted = false) {
    if (!allowDeleted) {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (!requireHttpRelayToken(config, req, res, url)) return true;
    }
    const auth = allowDeleted
      ? await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_VIEW)
      : await requireClientAuth(req, res);
    if (!auth) return true;
    const id = parseIdOrSend(res, postId);
    if (!id) return true;
    const [rows] = await mySqlService.query(
       `SELECT p.id, p.author_user_id, p.title, p.body, p.like_count, p.comment_count,
              p.created_at, p.updated_at, p.status, p.deleted_at, p.deleted_by,
              u.nickname AS author_nickname,
              du.login AS deleted_by_login
       FROM forum_posts p
       INNER JOIN users u ON u.id = p.author_user_id
       LEFT JOIN users du ON du.id = p.deleted_by
       WHERE p.id = ? ${allowDeleted ? "" : "AND p.status = 0"} LIMIT 1`,
      [id],
    );
    const post = rows[0];
    if (!post) {
      sendJson(res, 404, { error: "forum_post_not_found" });
      return true;
    }
    const [images] = await mySqlService.query(
      `SELECT id, file_name, content_type, size, width, height
       FROM forum_post_images WHERE post_id = ? ORDER BY created_at ASC`,
      [id],
    );
    let likedByMe = false;
    if (!allowDeleted) {
      const [likes] = await mySqlService.query(
        "SELECT 1 FROM forum_post_likes WHERE post_id = ? AND user_id = ? LIMIT 1",
        [id, auth.user.id],
      );
      likedByMe = Boolean(likes[0]);
    }
    sendJson(res, 200, {
      ...serializePost(post, likedByMe, !allowDeleted && String(post.author_user_id) === String(auth.user.id)),
      images: images.map((image) => ({
        id: String(image.id),
        fileName: image.file_name,
        contentType: image.content_type,
        size: Number(image.size),
        width: Number(image.width),
        height: Number(image.height),
      })),
    });
    return true;
  }

  async function listComments(req, res, postId, allowDeleted = false) {
    if (!allowDeleted) {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (!requireHttpRelayToken(config, req, res, url)) return true;
    }
    const auth = allowDeleted
      ? await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_VIEW)
      : await requireClientAuth(req, res);
    if (!auth) return true;
    const id = parseIdOrSend(res, postId);
    if (!id) return true;
    const [postRows] = await mySqlService.query(
      `SELECT id FROM forum_posts WHERE id = ? ${allowDeleted ? "" : "AND status = 0"} LIMIT 1`,
      [id],
    );
    if (!postRows[0]) {
      sendJson(res, 404, { error: "forum_post_not_found" });
      return true;
    }
    const rawLimit = urlLimit(req.url);
    if (rawLimit !== 10) {
      sendJson(res, 400, { error: "invalid_forum_limit" });
      return true;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const cursor = decodeCursor(url.searchParams.get("cursor") || "");
    if (cursor && cursor.kind !== "comments") {
      sendJson(res, 400, { error: "invalid_forum_cursor" });
      return true;
    }
    const params = [id];
    let rankClause = "";
    if (cursor) {
      if (!Number.isInteger(cursor.likeCount) || !UUID_PATTERN.test(cursor.id) || Number.isNaN(new Date(cursor.createdAt).getTime())) {
        sendJson(res, 400, { error: "invalid_forum_cursor" });
        return true;
      }
      const date = new Date(cursor.createdAt);
      rankClause = ` AND (c.like_count < ? OR (c.like_count = ? AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))))`;
      params.push(cursor.likeCount, cursor.likeCount, date, date, cursor.id);
    }
    const deletedClause = allowDeleted ? "" : "AND c.status = 0";
    const [rows] = await mySqlService.query(
      `SELECT c.id, c.post_id, c.author_user_id, c.content, c.like_count,
              c.created_at, c.updated_at, c.status, c.deleted_at, c.deleted_by,
              du.login AS deleted_by_login,
              u.nickname, u.avatar_url,
              EXISTS(
                SELECT 1 FROM forum_comment_likes cl
                WHERE cl.comment_id = c.id AND cl.user_id = ?
              ) AS liked_by_me
       FROM forum_comments c
       INNER JOIN users u ON u.id = c.author_user_id
       LEFT JOIN users du ON du.id = c.deleted_by
       WHERE c.post_id = ? ${deletedClause}${rankClause}
       ORDER BY c.like_count DESC, c.created_at DESC, c.id DESC
       LIMIT 11`,
      [auth.user.id, ...params],
    );
    const hasMore = rows.length > 10;
    const items = rows.slice(0, 10).map((row) => serializeComment(
      row,
      Number(row.liked_by_me) === 1,
      !allowDeleted && String(row.author_user_id) === String(auth.user.id),
    ));
    const last = rows[9];
    sendJson(res, 200, {
      items,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ kind: "comments", likeCount: Number(last.like_count), createdAt: isoTime(last.created_at), id: String(last.id) }) : null,
    });
    return true;
  }

  function urlLimit(rawUrl) {
    const url = new URL(rawUrl || "/", "http://localhost");
    const raw = url.searchParams.get("limit");
    return raw ? Number(raw) : 10;
  }

  async function reserveRate(auth, endpointKey, cooldownMs, req, res) {
    let reservation;
    try {
      reservation = await rateLimitService.reserve({
        githubId: String(auth.user.github_id),
        endpointKey,
        cooldownMs,
      });
    } catch (error) {
      req.resume();
      sendJson(res, isRateLimitStorageError(error) ? 503 : 500, {
        error: isRateLimitStorageError(error) ? "rate_limit_unavailable" : "forum_rate_limit_failed",
      });
      return null;
    }
    if (!reservation.ok) {
      req.resume();
      sendJson(res, 429, {
        error: endpointKey === POST_RATE_LIMIT_KEY ? "forum_post_too_frequent" : "forum_comment_too_frequent",
        retryAfterSeconds: reservation.retryAfterSeconds,
        resetAt: reservation.resetAt,
      });
      return null;
    }
    return reservation;
  }

  async function createPost(req, res, url) {
    if (!requireHttpRelayToken(config, req, res, url)) {
      req.resume();
      return true;
    }
    const auth = await requireClientAuth(req, res);
    if (!auth) {
      req.resume();
      return true;
    }
    const reservation = await reserveRate(auth, POST_RATE_LIMIT_KEY, postCooldown(auth), req, res);
    if (!reservation) return true;
    let parsed = null;
    let bucket = null;
    const uploaded = [];
    try {
      parsed = await parseMultipart(req, config);
      if (parsed.files.length) {
        if (!mongoService.isEnabled()) throw new ForumError("image_storage_not_configured", 503);
        await mongoService.ensureReady();
        bucket = mongoService.getBucket();
      }
      const postId = crypto.randomUUID();
      for (const file of parsed.files) {
        const storageId = await uploadFile(bucket, file, postId);
        uploaded.push({ id: crypto.randomUUID(), storageId, fileName: file.fileName, contentType: file.contentType, size: file.size, width: file.width, height: file.height });
      }
      const title = sensitiveWordService.filterText(parsed.title);
      const body = sensitiveWordService.filterText(parsed.body);
      const now = new Date();
      await mySqlService.transaction(async (connection) => {
        await connection.query(
          `INSERT INTO forum_posts
             (id, author_user_id, title, body, like_count, comment_count,
              created_at, updated_at, status, deleted_at, deleted_by)
           VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0, NULL, NULL)`,
          [postId, auth.user.id, title, body, now, now],
        );
        for (const image of uploaded) {
          await connection.query(
            `INSERT INTO forum_post_images
               (id, post_id, storage_id, file_name, content_type, size, width, height, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [image.id, postId, image.storageId, image.fileName, image.contentType, image.size, image.width, image.height, now],
          );
        }
        await enqueueSearch(connection, postId, "upsert", now);
        const committed = await rateLimitService.commit({
          githubId: String(auth.user.github_id),
          endpointKey: POST_RATE_LIMIT_KEY,
          token: reservation.token,
          now,
          connection,
        });
        if (!committed) throw new RateLimitError("rate_limit_reservation_lost");
      });
      sendJson(res, 201, { ok: true, id: postId });
    } catch (error) {
      await deleteUploadedFiles(bucket, uploaded);
      try {
        await rateLimitService.release({ githubId: String(auth.user.github_id), endpointKey: POST_RATE_LIMIT_KEY, token: reservation.token });
      } catch (releaseError) {
        console.error("[relay-server] failed to release forum post reservation", releaseError);
      }
      const responseError = error instanceof ForumError
        ? error
        : error instanceof RateLimitError && error.code === "rate_limit_reservation_lost"
          ? new ForumError("forum_post_too_frequent", 429)
          : error instanceof RateLimitError && error.code === "rate_limit_storage_failed"
            ? new ForumError("rate_limit_unavailable", 503)
            : new ForumError("forum_post_failed", 500);
      if (!(error instanceof ForumError)) console.error("[relay-server] forum post failed", error);
      sendJson(res, responseError.status, { error: responseError.code, ...responseError.details });
    } finally {
      if (parsed?.tempDir) await fs.rm(parsed.tempDir, { recursive: true, force: true });
    }
    return true;
  }

  async function createComment(req, res, postId) {
    if (!requireHttpRelayToken(config, req, res, new URL(req.url || "/", `http://${req.headers.host || "localhost"}`))) {
      req.resume();
      return true;
    }
    const auth = await requireClientAuth(req, res);
    if (!auth) {
      req.resume();
      return true;
    }
    const reservation = await reserveRate(auth, COMMENT_RATE_LIMIT_KEY, commentCooldown(auth), req, res);
    if (!reservation) return true;
    try {
      const id = parseId(postId);
      const body = await readJson(req, 128 * 1024);
      const content = cleanText(body?.content);
      if (!content) throw new ForumError("forum_comment_empty");
      if (charLength(content) > config.MAX_FORUM_COMMENT_LENGTH) throw new ForumError("forum_comment_too_long");
      const filtered = sensitiveWordService.filterText(content);
      const commentId = crypto.randomUUID();
      const now = new Date();
      await mySqlService.transaction(async (connection) => {
        const [posts] = await connection.query(
          "SELECT id FROM forum_posts WHERE id = ? AND status = 0 LIMIT 1 FOR UPDATE",
          [id],
        );
        if (!posts[0]) throw new ForumError("forum_post_not_found", 404);
        await connection.query(
          `INSERT INTO forum_comments
             (id, post_id, author_user_id, content, like_count, created_at, updated_at, status, deleted_at, deleted_by)
           VALUES (?, ?, ?, ?, 0, ?, ?, 0, NULL, NULL)`,
          [commentId, id, auth.user.id, filtered, now, now],
        );
        await connection.query("UPDATE forum_posts SET comment_count = comment_count + 1, updated_at = ? WHERE id = ?", [now, id]);
        const committed = await rateLimitService.commit({
          githubId: String(auth.user.github_id),
          endpointKey: COMMENT_RATE_LIMIT_KEY,
          token: reservation.token,
          now,
          connection,
        });
        if (!committed) throw new RateLimitError("rate_limit_reservation_lost");
      });
      sendJson(res, 201, { ok: true, id: commentId });
    } catch (error) {
      req.resume();
      try {
        await rateLimitService.release({ githubId: String(auth.user.github_id), endpointKey: COMMENT_RATE_LIMIT_KEY, token: reservation.token });
      } catch (releaseError) {
        console.error("[relay-server] failed to release forum comment reservation", releaseError);
      }
      const responseError = error instanceof ForumError
        ? error
        : error instanceof RateLimitError && error.code === "rate_limit_reservation_lost"
          ? new ForumError("forum_comment_too_frequent", 429)
          : error instanceof RateLimitError && error.code === "rate_limit_storage_failed"
            ? new ForumError("rate_limit_unavailable", 503)
            : new ForumError("forum_comment_failed", 500);
      sendJson(res, responseError.status, { error: responseError.code, ...responseError.details });
    }
    return true;
  }

  async function toggleLike(req, res, rawId, type, liked) {
    if (!requireHttpRelayToken(config, req, res, new URL(req.url || "/", `http://${req.headers.host || "localhost"}`))) return true;
    const auth = await requireClientAuth(req, res);
    if (!auth) return true;
    const id = parseIdOrSend(res, rawId);
    if (!id) return true;
    const table = type === "post" ? "forum_post_likes" : "forum_comment_likes";
    const column = type === "post" ? "post_id" : "comment_id";
    const parentTable = type === "post" ? "forum_posts" : "forum_comments";
    const countColumn = "like_count";
    const parentId = id;
    const now = new Date();
    try {
      const result = await mySqlService.transaction(async (connection) => {
        const [parents] = type === "comment"
          ? await connection.query(
            `SELECT c.id
             FROM forum_comments c
             INNER JOIN forum_posts p ON p.id = c.post_id
             WHERE c.id = ? AND c.status = 0 AND p.status = 0
             LIMIT 1 FOR UPDATE`,
            [parentId],
          )
          : await connection.query(
            `SELECT id FROM ${parentTable} WHERE id = ? AND status = 0 LIMIT 1 FOR UPDATE`,
            [parentId],
          );
        if (!parents[0]) throw new ForumError(type === "post" ? "forum_post_not_found" : "forum_comment_not_found", 404);
        let affectedRows = 0;
        if (liked) {
          const [result] = await connection.query(
            `INSERT IGNORE INTO ${table} (${column}, user_id, created_at) VALUES (?, ?, ?)`,
            [id, auth.user.id, now],
          );
          affectedRows = result.affectedRows;
        } else {
          const [result] = await connection.query(
            `DELETE FROM ${table} WHERE ${column} = ? AND user_id = ?`,
            [id, auth.user.id],
          );
          affectedRows = result.affectedRows;
        }
        if (affectedRows === 1) {
          await connection.query(
            `UPDATE ${parentTable}
             SET ${countColumn} = GREATEST(0, ${countColumn} ${liked ? "+ 1" : "- 1"}), updated_at = ?
             WHERE id = ?`,
            [now, parentId],
          );
        }
        const [counts] = await connection.query(`SELECT ${countColumn} AS like_count FROM ${parentTable} WHERE id = ? LIMIT 1`, [parentId]);
        return Number(counts[0]?.like_count || 0);
      });
      sendJson(res, 200, { ok: true, liked, likeCount: result });
    } catch (error) {
      sendJson(res, error instanceof ForumError ? error.status : 500, { error: error instanceof ForumError ? error.code : "forum_like_failed" });
    }
    return true;
  }

  async function listAdminPosts(req, res, url) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_VIEW);
    if (!auth) return true;
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 20);
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      sendJson(res, 400, { error: "invalid_pagination" });
      return true;
    }
    const query = cleanText(url.searchParams.get("q") || "").slice(0, 200);
    const status = cleanText(url.searchParams.get("status") || "active");
    const clauses = [];
    const params = [];
    if (status === "active") clauses.push("p.status = 0");
    else if (status === "author_deleted") clauses.push("p.status = 1");
    else if (status === "admin_deleted") clauses.push("p.status = 2");
    else if (status === "deleted") clauses.push("p.status IN (1, 2)");
    else if (status !== "all") {
      sendJson(res, 400, { error: "invalid_forum_status" });
      return true;
    }
    if (query) {
      clauses.push("(p.id LIKE ? OR p.title LIKE ? OR p.body LIKE ? OR u.login LIKE ?)");
      const pattern = `%${query}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    const from = "forum_posts p LEFT JOIN users u ON u.id = p.author_user_id LEFT JOIN users du ON du.id = p.deleted_by";
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [counts] = await mySqlService.query(`SELECT COUNT(*) AS total FROM ${from} ${where}`, params);
    const [rows] = await mySqlService.query(
      `SELECT p.id, p.title, p.like_count, p.comment_count, p.created_at, p.status,
              p.deleted_at, p.deleted_by, u.login AS author_login, du.login AS deleted_by_login
       FROM ${from} ${where}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    sendJson(res, 200, {
      items: rows.map((row) => ({
        id: String(row.id), title: row.title, authorGithubName: row.author_login || "", likeCount: Number(row.like_count || 0), commentCount: Number(row.comment_count || 0), createdAt: isoTime(row.created_at), status: Number(row.status ?? FORUM_STATUS.ACTIVE), deletedAt: isoTime(row.deleted_at), deletedBy: row.deleted_by === null || row.deleted_by === undefined ? null : String(row.deleted_by), deletedByGithubName: row.deleted_by_login || "",
      })),
      total: Number(counts[0]?.total || 0), page, pageSize,
    });
    return true;
  }

  async function deletePost(req, res, postId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_MANAGE, { requireOrigin: true });
    if (!auth) return true;
    const id = parseIdOrSend(res, postId);
    if (!id) return true;
    const now = new Date();
    const result = await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query("SELECT id, status FROM forum_posts WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
      if (!rows[0]) return { status: 404 };
      if (Number(rows[0].status) !== FORUM_STATUS.ACTIVE) return { status: 200 };
      await connection.query("UPDATE forum_posts SET status = 2, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND status = 0", [now, auth.user.id, now, id]);
      await connection.query(
        "UPDATE forum_comments SET status = 2, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE post_id = ? AND status = 0",
        [now, auth.user.id, now, id],
      );
      await connection.query(
        "UPDATE forum_posts SET comment_count = 0, updated_at = ? WHERE id = ?",
        [now, id],
      );
      await enqueueSearch(connection, id, "delete", now);
      return { status: 200 };
    });
    sendJson(res, result.status, result.status === 200 ? { ok: true } : { error: "forum_post_not_found" });
    return true;
  }

  async function lockCommentAndPost(connection, commentId) {
    const [references] = await connection.query(
      "SELECT post_id FROM forum_comments WHERE id = ? LIMIT 1",
      [commentId],
    );
    const postId = references[0]?.post_id;
    if (!postId) return { comment: null, post: null };
    const [postRows] = await connection.query(
      "SELECT id, status FROM forum_posts WHERE id = ? LIMIT 1 FOR UPDATE",
      [postId],
    );
    const [commentRows] = await connection.query(
      "SELECT id, post_id, author_user_id, status FROM forum_comments WHERE id = ? LIMIT 1 FOR UPDATE",
      [commentId],
    );
    return { comment: commentRows[0] || null, post: postRows[0] || null };
  }

  async function deleteComment(req, res, commentId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_MANAGE, { requireOrigin: true });
    if (!auth) return true;
    const id = parseIdOrSend(res, commentId);
    if (!id) return true;
    const now = new Date();
    const result = await mySqlService.transaction(async (connection) => {
      const { comment, post } = await lockCommentAndPost(connection, id);
      if (!comment || !post) return { status: 404 };
      if (Number(comment.status) !== FORUM_STATUS.ACTIVE) return { status: 200 };
      await connection.query("UPDATE forum_comments SET status = 2, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND status = 0", [now, auth.user.id, now, id]);
      await connection.query("UPDATE forum_posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = ? WHERE id = ?", [now, comment.post_id]);
      return { status: 200 };
    });
    sendJson(res, result.status, result.status === 200 ? { ok: true } : { error: "forum_comment_not_found" });
    return true;
  }

  async function restorePost(req, res, postId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_RESTORE, { requireOrigin: true });
    if (!auth) return true;
    const id = parseIdOrSend(res, postId);
    if (!id) return true;
    const now = new Date();
    const result = await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT id, status FROM forum_posts WHERE id = ? LIMIT 1 FOR UPDATE",
        [id],
      );
      const post = rows[0];
      if (!post) return { status: 404 };
      if (Number(post.status) === FORUM_STATUS.ACTIVE) return { status: 200 };
      await connection.query(
        "UPDATE forum_posts SET status = 0, deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND status <> 0",
        [now, id],
      );
      await enqueueSearch(connection, id, "upsert", now);
      return { status: 200 };
    });
    sendJson(res, result.status, result.status === 200 ? { ok: true } : { error: "forum_post_not_found" });
    return true;
  }

  async function restoreComment(req, res, commentId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_RESTORE, { requireOrigin: true });
    if (!auth) return true;
    const id = parseIdOrSend(res, commentId);
    if (!id) return true;
    const now = new Date();
    const result = await mySqlService.transaction(async (connection) => {
      const { comment, post } = await lockCommentAndPost(connection, id);
      if (!comment) return { status: 404 };
      if (!post) return { status: 404 };
      if (Number(post.status) !== FORUM_STATUS.ACTIVE) return { status: 409, error: "forum_post_not_active" };
      if (Number(comment.status) === FORUM_STATUS.ACTIVE) return { status: 200 };
      await connection.query(
        "UPDATE forum_comments SET status = 0, deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ? AND status <> 0",
        [now, id],
      );
      await connection.query(
        "UPDATE forum_posts SET comment_count = comment_count + 1, updated_at = ? WHERE id = ? AND status = 0",
        [now, comment.post_id],
      );
      return { status: 200 };
    });
    sendJson(res, result.status, result.status === 200 ? { ok: true } : { error: result.error || "forum_comment_not_found" });
    return true;
  }

  async function deleteOwnPost(req, res, postId) {
    if (!requireHttpRelayToken(config, req, res, new URL(req.url || "/", `http://${req.headers.host || "localhost"}`))) return true;
    const auth = await requireClientAuth(req, res);
    if (!auth) return true;
    const id = parseIdOrSend(res, postId);
    if (!id) return true;
    const now = new Date();
    const result = await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        "SELECT id, author_user_id, status FROM forum_posts WHERE id = ? LIMIT 1 FOR UPDATE",
        [id],
      );
      const post = rows[0];
      if (!post || Number(post.status) !== FORUM_STATUS.ACTIVE || String(post.author_user_id) !== String(auth.user.id)) {
        return { status: 404 };
      }
      await connection.query(
        "UPDATE forum_posts SET status = 1, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND status = 0",
        [now, auth.user.id, now, id],
      );
      await connection.query(
        "UPDATE forum_comments SET status = 1, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE post_id = ? AND status = 0",
        [now, auth.user.id, now, id],
      );
      await connection.query(
        "UPDATE forum_posts SET comment_count = 0, updated_at = ? WHERE id = ?",
        [now, id],
      );
      await enqueueSearch(connection, id, "delete", now);
      return { status: 200 };
    });
    sendJson(res, result.status, result.status === 200 ? { ok: true } : { error: "forum_post_not_found" });
    return true;
  }

  async function deleteOwnComment(req, res, commentId) {
    if (!requireHttpRelayToken(config, req, res, new URL(req.url || "/", `http://${req.headers.host || "localhost"}`))) return true;
    const auth = await requireClientAuth(req, res);
    if (!auth) return true;
    const id = parseIdOrSend(res, commentId);
    if (!id) return true;
    const now = new Date();
    const result = await mySqlService.transaction(async (connection) => {
      const { comment, post } = await lockCommentAndPost(connection, id);
      if (!comment || !post || Number(post.status) !== FORUM_STATUS.ACTIVE || Number(comment.status) !== FORUM_STATUS.ACTIVE || String(comment.author_user_id) !== String(auth.user.id)) {
        return { status: 404 };
      }
      await connection.query(
        "UPDATE forum_comments SET status = 1, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND status = 0",
        [now, auth.user.id, now, id],
      );
      await connection.query(
        "UPDATE forum_posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = ? WHERE id = ? AND status = 0",
        [now, comment.post_id],
      );
      return { status: 200 };
    });
    sendJson(res, result.status, result.status === 200 ? { ok: true } : { error: "forum_comment_not_found" });
    return true;
  }

  async function sendImage(req, res, postId, imageId, allowAdmin) {
    if (!allowAdmin) {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      if (!requireHttpRelayToken(config, req, res, url)) return true;
    }
    const auth = allowAdmin
      ? await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.FORUM_VIEW)
      : await requireClientAuth(req, res);
    if (!auth) return true;
    const id = parseIdOrSend(res, postId);
    if (!id) return true;
    const image = parseIdOrSend(res, imageId, "invalid_forum_image_id");
    if (!image) return true;
    const [rows] = await mySqlService.query(
      `SELECT i.storage_id, i.file_name, i.content_type, i.size
       FROM forum_post_images i
       INNER JOIN forum_posts p ON p.id = i.post_id
       WHERE i.id = ? AND i.post_id = ? ${allowAdmin ? "" : "AND p.status = 0"} LIMIT 1`,
      [image, id],
    );
    const row = rows[0];
    if (!row || !ObjectId.isValid(row.storage_id) || !mongoService.isEnabled()) {
      sendJson(res, 404, { error: "forum_image_not_found" });
      return true;
    }
    await mongoService.ensureReady();
    res.writeHead(200, {
      "content-type": row.content_type,
      "content-length": String(row.size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    });
    mongoService.getBucket().openDownloadStream(new ObjectId(row.storage_id)).once("error", () => res.destroy()).pipe(res);
    return true;
  }

  async function handleRequest(req, res, url) {
    if (!mySqlService.isEnabled() && url.pathname.startsWith("/api/v1/forum")) {
      if (req.method === "POST") req.resume();
      sendJson(res, 503, { error: "forum_storage_not_configured" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/v1/forum/search-status") return getSearchStatus(req, res, url);
    if (req.method === "GET" && url.pathname === "/api/v1/forum/posts") return listPosts(req, res, url);
    if (req.method === "POST" && url.pathname === "/api/v1/forum/posts") return createPost(req, res, url);

    const postImage = url.pathname.match(/^\/api\/v1\/forum\/posts\/([^/]+)\/images\/([^/]+)$/);
    if (req.method === "GET" && postImage) return sendImage(req, res, safePathSegment(postImage[1]), safePathSegment(postImage[2]), false);
    const postComments = url.pathname.match(/^\/api\/v1\/forum\/posts\/([^/]+)\/comments$/);
    if (postComments && req.method === "GET") return listComments(req, res, safePathSegment(postComments[1]), false);
    if (postComments && req.method === "POST") return createComment(req, res, safePathSegment(postComments[1]));
    const postLike = url.pathname.match(/^\/api\/v1\/forum\/posts\/([^/]+)\/like$/);
    if (postLike && req.method === "PUT") return toggleLike(req, res, safePathSegment(postLike[1]), "post", true);
    if (postLike && req.method === "DELETE") return toggleLike(req, res, safePathSegment(postLike[1]), "post", false);
    const commentLike = url.pathname.match(/^\/api\/v1\/forum\/comments\/([^/]+)\/like$/);
    if (commentLike && req.method === "PUT") return toggleLike(req, res, safePathSegment(commentLike[1]), "comment", true);
    if (commentLike && req.method === "DELETE") return toggleLike(req, res, safePathSegment(commentLike[1]), "comment", false);
    const ownComment = url.pathname.match(/^\/api\/v1\/forum\/comments\/([^/]+)$/);
    if (req.method === "DELETE" && ownComment) return deleteOwnComment(req, res, safePathSegment(ownComment[1]));
    const detail = url.pathname.match(/^\/api\/v1\/forum\/posts\/([^/]+)$/);
    if (req.method === "DELETE" && detail) return deleteOwnPost(req, res, safePathSegment(detail[1]));
    if (req.method === "GET" && detail) return getPost(req, res, safePathSegment(detail[1]), false);

    if (!url.pathname.startsWith("/api/admin/v1/forum")) return false;
    if (!mySqlService.isEnabled()) {
      sendJson(res, 503, { error: "forum_storage_not_configured" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/v1/forum/posts") return listAdminPosts(req, res, url);
    const adminPostImage = url.pathname.match(/^\/api\/admin\/v1\/forum\/posts\/([^/]+)\/images\/([^/]+)$/);
    if (req.method === "GET" && adminPostImage) return sendImage(req, res, safePathSegment(adminPostImage[1]), safePathSegment(adminPostImage[2]), true);
    const adminComments = url.pathname.match(/^\/api\/admin\/v1\/forum\/posts\/([^/]+)\/comments$/);
    if (req.method === "GET" && adminComments) return listComments(req, res, safePathSegment(adminComments[1]), true);
    const adminPost = url.pathname.match(/^\/api\/admin\/v1\/forum\/posts\/([^/]+)$/);
    const adminPostRestore = url.pathname.match(/^\/api\/admin\/v1\/forum\/posts\/([^/]+)\/restore$/);
    if (req.method === "POST" && adminPostRestore) return restorePost(req, res, safePathSegment(adminPostRestore[1]));
    if (req.method === "GET" && adminPost) return getPost(req, res, safePathSegment(adminPost[1]), true);
    if (req.method === "DELETE" && adminPost) return deletePost(req, res, safePathSegment(adminPost[1]));
    const adminComment = url.pathname.match(/^\/api\/admin\/v1\/forum\/comments\/([^/]+)$/);
    const adminCommentRestore = url.pathname.match(/^\/api\/admin\/v1\/forum\/comments\/([^/]+)\/restore$/);
    if (req.method === "POST" && adminCommentRestore) return restoreComment(req, res, safePathSegment(adminCommentRestore[1]));
    if (req.method === "DELETE" && adminComment) return deleteComment(req, res, safePathSegment(adminComment[1]));
    sendJson(res, 404, { error: "not_found" });
    return true;
  }

  return {
    handleRequest,
    startSearchWorker,
    dispose: () => {
      if (workerTimer) clearInterval(workerTimer);
      workerTimer = null;
    },
  };
}
