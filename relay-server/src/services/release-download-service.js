import { randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

import Busboy from "busboy";

import { PORTAL_CAPABILITIES } from "./portal-authorization.js";
import {
  clearReleaseBundle,
  openBundleFile,
  publishReleaseBundle,
  readCurrentBundle,
  releaseLimits,
  RELEASE_FEED_NAME,
} from "./release-bundle-service.js";
import { sendJson } from "../utils/ws.js";

const INSTALLER_PATH = "/api/v1/releases/latest/download";
const STABLE_UPDATE_PREFIX = "/api/v1/desktop-updates/stable/";
const TEST_UPDATE_PREFIX = "/api/v1/desktop-updates/test/";
const ADMIN_STABLE_PATH = "/api/admin/v1/desktop-release";
const ADMIN_TEST_PATH = "/api/admin/v1/desktop-release/test";
const CHUNK_BYTES = 64 * 1024;
const TEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOCK_HOLDER_CODE =
  'process.stdout.write("LOCKED\\n"); process.stdin.resume();';

class ReleaseRequestError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

export class GlobalBandwidthLimiter {
  constructor(bitsPerSecond) {
    if (!Number.isSafeInteger(bitsPerSecond) || bitsPerSecond <= 0)
      throw new Error("desktop release bandwidth must be a positive integer");
    this.bytesPerSecond = bitsPerSecond / 8;
    this.nextAvailableAt = 0;
  }

  async acquire(byteLength, signal) {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) return;
    const now = performance.now();
    const scheduledAt =
      Math.max(now, this.nextAvailableAt) +
      (byteLength / this.bytesPerSecond) * 1000;
    this.nextAvailableAt = scheduledAt;
    while (true) {
      const waitMs = scheduledAt - performance.now();
      if (waitMs <= 0) break;
      await delay(Math.ceil(waitMs), undefined, { signal });
    }
    if (signal?.aborted) throw signal.reason;
  }
}

function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= size
    )
      return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function publicRelease(current) {
  if (!current) return null;
  return {
    version: current.version,
    channel: current.channel,
    publishedAt: current.publishedAt,
    closureSha256: current.closureSha256,
    totalSize: current.totalSize,
    installer: current.installer
      ? current.files.find((file) => file.filename === current.installer)
      : null,
    feed: current.feed,
    assets: current.assets,
  };
}

function safeUploadName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 180 &&
    path.basename(name) === name &&
    !/[\\/:*?"<>|\x00-\x1f]/.test(name)
  );
}

async function parseBundleUpload(req, storageRoot, limits) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data"))
    throw new ReleaseRequestError("multipart_required", 415);
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > limits.maxBundleBytes + 4 * 1024 * 1024
  )
    throw new ReleaseRequestError("release_bundle_too_large", 413);

  const incomingRoot = path.join(storageRoot, ".incoming");
  await fs.mkdir(incomingRoot, { recursive: true, mode: 0o750 });
  const stagedDir = path.join(incomingRoot, `admin-${randomUUID()}`);
  await fs.mkdir(stagedDir, { mode: 0o700 });
  const names = new Set();
  const writes = [];
  let parseError = null;
  let totalSize = 0;
  const fail = (error) => {
    parseError ||=
      error instanceof ReleaseRequestError
        ? error
        : new ReleaseRequestError("invalid_multipart");
  };
  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      defParamCharset: "utf8",
      limits: {
        fileSize: limits.maxFileBytes + 1,
        files: limits.maxAssets + 2,
        fields: 0,
        parts: limits.maxAssets + 2,
      },
    });
  } catch {
    await fs.rm(stagedDir, { recursive: true, force: true });
    throw new ReleaseRequestError("invalid_multipart");
  }
  busboy.on("field", () =>
    fail(new ReleaseRequestError("invalid_upload_fields")),
  );
  busboy.on("file", (field, stream, info) => {
    const filename = info.filename;
    if (field !== "files" || !safeUploadName(filename) || names.has(filename)) {
      fail(new ReleaseRequestError("invalid_release_file"));
      stream.resume();
      return;
    }
    names.add(filename);
    stream.once("limit", () =>
      fail(new ReleaseRequestError("release_file_too_large", 413)),
    );
    stream.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > limits.maxBundleBytes)
        fail(new ReleaseRequestError("release_bundle_too_large", 413));
    });
    writes.push(
      pipeline(
        stream,
        createWriteStream(path.join(stagedDir, filename), {
          flags: "wx",
          mode: 0o600,
        }),
      ).catch(fail),
    );
  });
  busboy.on("filesLimit", () =>
    fail(new ReleaseRequestError("invalid_release_file_count")),
  );
  busboy.on("fieldsLimit", () =>
    fail(new ReleaseRequestError("invalid_upload_fields")),
  );
  busboy.on("partsLimit", () =>
    fail(new ReleaseRequestError("invalid_release_file_count")),
  );
  try {
    await new Promise((resolve, reject) => {
      busboy.once("close", resolve);
      busboy.once("error", reject);
      req.once("aborted", () =>
        reject(new ReleaseRequestError("upload_aborted")),
      );
      req.pipe(busboy);
    });
    await Promise.all(writes);
  } catch (error) {
    fail(error);
  }
  if (parseError || names.size === 0) {
    await fs.rm(stagedDir, { recursive: true, force: true });
    throw parseError || new ReleaseRequestError("release_files_required");
  }
  return stagedDir;
}

async function acquirePublishLock(storageRoot) {
  await fs.mkdir(storageRoot, { recursive: true, mode: 0o750 });
  const { spawn } = await import("node:child_process");
  const child = spawn(
    "/usr/bin/flock",
    [
      "-n",
      path.join(storageRoot, ".publish.lock"),
      process.execPath,
      "-e",
      LOCK_HOLDER_CODE,
    ],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  return await new Promise((resolve, reject) => {
    let acquired = false;
    let stdout = "";
    const rejectBeforeAcquire = (error) => {
      if (!acquired) reject(error);
    };
    child.once("error", () =>
      rejectBeforeAcquire(new ReleaseRequestError("release_lock_failed", 500)),
    );
    child.once("exit", (code) =>
      rejectBeforeAcquire(
        new ReleaseRequestError(
          code === 1 ? "release_upload_busy" : "release_lock_failed",
          code === 1 ? 409 : 500,
        ),
      ),
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (acquired || !stdout.includes("LOCKED\n")) return;
      acquired = true;
      resolve(async () => {
        if (child.exitCode !== null) return;
        await new Promise((done) => {
          child.once("exit", done);
          child.stdin.end();
        });
      });
    });
  });
}

function validTestToken(configured, supplied) {
  if (!configured || !supplied) return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function storageRootsOverlap(left, right) {
  if (left === right) return true;
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  const isNested = (relative) =>
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative);
  return isNested(leftToRight) || isNested(rightToLeft);
}

async function writeWithBackpressure(res, chunk) {
  if (res.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new DOMException("response closed", "AbortError"));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
  });
}

function fileHeaders(metadata, range) {
  const start = range?.start ?? 0;
  const end = range?.end ?? metadata.size - 1;
  return {
    "content-type":
      metadata.filename === RELEASE_FEED_NAME
        ? "application/json; charset=utf-8"
        : "application/octet-stream",
    "content-length": String(end - start + 1),
    "content-disposition": `attachment; filename="${metadata.filename}"`,
    "accept-ranges": "bytes",
    etag: `"${metadata.sha256}"`,
    "x-file-sha256": metadata.sha256,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "etag,x-file-sha256,accept-ranges,content-range",
    ...(range
      ? { "content-range": `bytes ${start}-${end}/${metadata.size}` }
      : {}),
  };
}

export function createReleaseDownloadService({
  config,
  accessControlService,
  publishBundle = publishReleaseBundle,
  acquireUploadLock = acquirePublishLock,
}) {
  const stableRoot = path.resolve(config.DESKTOP_RELEASE_STORAGE_DIR);
  const testRoot = path.resolve(config.TEST_DESKTOP_RELEASE_STORAGE_DIR);
  if (
    stableRoot === path.parse(stableRoot).root ||
    testRoot === path.parse(testRoot).root ||
    storageRootsOverlap(stableRoot, testRoot)
  ) {
    throw new Error(
      "desktop release storage roots must be separate directories",
    );
  }
  if (
    config.DESKTOP_UPDATE_TEST_TOKEN &&
    !TEST_TOKEN_PATTERN.test(config.DESKTOP_UPDATE_TEST_TOKEN)
  ) {
    throw new Error(
      "desktop update test token must be 32 bytes encoded as Base64URL",
    );
  }
  const limits = releaseLimits(config);
  const limiter = new GlobalBandwidthLimiter(
    config.DESKTOP_RELEASE_BANDWIDTH_BPS,
  );

  async function sendFile(req, res, storageRoot, filename) {
    let opened;
    try {
      opened = await openBundleFile(storageRoot, filename);
    } catch (error) {
      sendJson(res, error?.status || 503, {
        error: error?.message || "release_unavailable",
      });
      return;
    }
    const { handle, metadata } = opened;
    try {
      const etag = `"${metadata.sha256}"`;
      const range =
        req.headers["if-range"] && req.headers["if-range"] !== etag
          ? null
          : parseRange(req.headers.range, metadata.size);
      if (range === false) {
        res.writeHead(416, {
          "content-range": `bytes */${metadata.size}`,
          "accept-ranges": "bytes",
        });
        res.end();
        return;
      }
      if (!range && req.headers["if-none-match"] === etag) {
        res.writeHead(304, { etag, "cache-control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(range ? 206 : 200, fileHeaders(metadata, range));
      if (req.method === "HEAD") return res.end();
      const start = range?.start ?? 0;
      const end = range?.end ?? metadata.size - 1;
      const controller = new AbortController();
      const abort = () =>
        controller.abort(
          new DOMException("download disconnected", "AbortError"),
        );
      req.once("aborted", abort);
      res.once("close", abort);
      const stream = handle.createReadStream({
        start,
        end,
        highWaterMark: CHUNK_BYTES,
        autoClose: false,
      });
      try {
        for await (const chunk of stream) {
          await limiter.acquire(chunk.length, controller.signal);
          await writeWithBackpressure(res, chunk);
        }
        res.end();
      } catch (error) {
        if (!isAbortError(error))
          console.error("[release-download] stream failed", error);
        if (!res.destroyed) res.destroy(error);
      } finally {
        req.off("aborted", abort);
        res.off("close", abort);
        stream.destroy();
      }
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async function handleAdmin(req, res, channel) {
    const isTest = channel === "test";
    const capability =
      isTest || req.method !== "GET"
        ? PORTAL_CAPABILITIES.RELEASE_UPLOAD
        : PORTAL_CAPABILITIES.RELEASE_VIEW;
    const requireOrigin = req.method === "POST" || req.method === "DELETE";
    if (
      !(await accessControlService.requireCapability(
        req,
        res,
        capability,
        requireOrigin ? { requireOrigin: true } : undefined,
      ))
    ) {
      req.resume();
      return;
    }
    const storageRoot = isTest ? testRoot : stableRoot;
    if (req.method === "GET") {
      const current = await readCurrentBundle(storageRoot).catch(() => null);
      sendJson(res, 200, { release: publicRelease(current), limits });
      return;
    }
    if (req.method === "DELETE" && isTest) {
      let releaseLock;
      try {
        releaseLock = await acquireUploadLock(storageRoot);
        sendJson(res, 200, {
          ok: true,
          ...(await clearReleaseBundle(storageRoot)),
        });
      } catch (error) {
        sendJson(res, error?.status || 500, {
          error: error?.message || "release_clear_failed",
        });
      } finally {
        await releaseLock?.();
      }
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", isTest ? "GET, POST, DELETE" : "GET, POST");
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    let releaseLock;
    let stagedDir;
    try {
      releaseLock = await acquireUploadLock(storageRoot);
      stagedDir = await parseBundleUpload(req, storageRoot, limits);
      const result = await publishBundle({
        storageRoot,
        stagedDir,
        channel,
        limits,
        allowDowngrade: true,
      });
      sendJson(res, 200, {
        ok: true,
        status: result.status,
        release: publicRelease(result.release),
      });
    } catch (error) {
      if (stagedDir) await fs.rm(stagedDir, { recursive: true, force: true });
      console.error("[release-upload] request failed", error?.message || error);
      sendJson(res, error?.status || 500, {
        error: error?.message || "release_upload_failed",
      });
    } finally {
      await releaseLock?.().catch((error) =>
        console.error("[release-upload] unlock failed", error),
      );
    }
  }

  return {
    async handleRequest(req, res, url) {
      if (
        url.pathname === ADMIN_STABLE_PATH ||
        url.pathname === ADMIN_TEST_PATH
      ) {
        await handleAdmin(
          req,
          res,
          url.pathname === ADMIN_TEST_PATH ? "test" : "stable",
        );
        return true;
      }
      const isInstallerPath = url.pathname === INSTALLER_PATH;
      const isStablePath = url.pathname.startsWith(STABLE_UPDATE_PREFIX);
      const isTestPath = url.pathname.startsWith(TEST_UPDATE_PREFIX);
      if (!["GET", "HEAD"].includes(req.method)) {
        if (!isInstallerPath && !isStablePath && !isTestPath) return false;
        res.setHeader("allow", "GET, HEAD");
        sendJson(res, 405, { error: "method_not_allowed" });
        return true;
      }
      if (isInstallerPath) {
        const current = await readCurrentBundle(stableRoot).catch(() => null);
        if (!current?.installer) {
          sendJson(res, 503, { error: "release_unavailable" });
          return true;
        }
        await sendFile(req, res, stableRoot, current.installer);
        return true;
      }
      if (isStablePath) {
        let filename;
        try {
          filename = decodeURIComponent(
            url.pathname.slice(STABLE_UPDATE_PREFIX.length),
          );
        } catch {
          sendJson(res, 404, { error: "not_found" });
          return true;
        }
        await sendFile(req, res, stableRoot, filename);
        return true;
      }
      if (isTestPath) {
        const remainder = url.pathname.slice(TEST_UPDATE_PREFIX.length);
        const slash = remainder.indexOf("/");
        if (
          slash <= 0 ||
          !validTestToken(
            config.DESKTOP_UPDATE_TEST_TOKEN,
            remainder.slice(0, slash),
          )
        ) {
          sendJson(res, 404, { error: "not_found" });
          return true;
        }
        let filename;
        try {
          filename = decodeURIComponent(remainder.slice(slash + 1));
        } catch {
          sendJson(res, 404, { error: "not_found" });
          return true;
        }
        await sendFile(req, res, testRoot, filename);
        return true;
      }
      return false;
    },
  };
}
