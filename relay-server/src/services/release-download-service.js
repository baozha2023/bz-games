import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import Busboy from "busboy";
import semver from "semver";
import { PORTAL_CAPABILITIES } from "./portal-authorization.js";

import { sendJson } from "../utils/ws.js";

const DOWNLOAD_PATH = "/bz-games/api/v1/releases/latest/download";
const ADMIN_PATH = "/api/admin/v1/desktop-release";
const MANIFEST_KEYS = ["filename", "sha256", "size", "version"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CHUNK_BYTES = 64 * 1024;
const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH_SCRIPT = path.resolve(
  SERVICE_DIR,
  "../../scripts/publish-desktop-release.js",
);
const LOCK_HOLDER_CODE =
  'process.stdout.write("LOCKED\\n"); process.stdin.resume();';

class ReleaseUploadError extends Error {
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
    if (!Number.isSafeInteger(bitsPerSecond) || bitsPerSecond <= 0) {
      throw new Error("desktop release bandwidth must be a positive integer");
    }
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

export function parseReleaseManifest(raw, maxFileBytes) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid release manifest JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid release manifest object");
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== MANIFEST_KEYS.length ||
    keys.some((key, index) => key !== MANIFEST_KEYS[index])
  ) {
    throw new Error("invalid release manifest fields");
  }
  if (!semver.valid(value.version) || semver.prerelease(value.version)) {
    throw new Error("invalid release version");
  }
  if (value.filename !== `BZ-Games-Setup-${value.version}.exe`) {
    throw new Error("invalid release filename");
  }
  if (
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > maxFileBytes
  ) {
    throw new Error("invalid release size");
  }
  if (!SHA256_PATTERN.test(value.sha256)) {
    throw new Error("invalid release sha256");
  }
  return Object.freeze({ ...value });
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

function fileHeaders(manifest, start, end, range) {
  return {
    "content-type": "application/octet-stream",
    "content-length": String(end - start + 1),
    "content-disposition": `attachment; filename="${manifest.filename}"`,
    "accept-ranges": "bytes",
    etag: `"${manifest.sha256}"`,
    "x-file-sha256": manifest.sha256,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "etag,x-file-sha256,accept-ranges,content-range",
    ...(range
      ? { "content-range": `bytes ${start}-${end}/${manifest.size}` }
      : {}),
  };
}

async function openCurrentRelease(storageRoot, maxFileBytes) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      const manifest = parseReleaseManifest(
        await fs.readFile(path.join(storageRoot, "latest.json"), "utf8"),
        maxFileBytes,
      );
      const filePath = path.join(storageRoot, manifest.filename);
      if (path.dirname(filePath) !== storageRoot)
        throw new Error("release path escaped storage root");
      handle = await fs.open(filePath, "r");
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== manifest.size)
        throw new Error("release file size mismatch");
      const signature = Buffer.alloc(2);
      const { bytesRead } = await handle.read(signature, 0, 2, 0);
      if (bytesRead !== 2 || signature.toString("ascii") !== "MZ")
        throw new Error("invalid release executable");
      return { handle, manifest };
    } catch (error) {
      await handle?.close().catch(() => {});
      lastError = error;
      if (error?.code !== "ENOENT" || attempt === 1) break;
    }
  }
  throw lastError;
}

async function parseReleaseUpload(req, storageRoot, maxFileBytes) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new ReleaseUploadError("multipart_required", 415);
  }
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maxFileBytes + 1024 * 1024
  ) {
    throw new ReleaseUploadError("desktop_release_too_large", 413);
  }
  const incomingRoot = path.join(storageRoot, ".incoming");
  await fs.mkdir(incomingRoot, { recursive: true, mode: 0o750 });
  const stagedPath = path.join(incomingRoot, `admin-${randomUUID()}.exe`);
  let version = null;
  let fileSeen = false;
  let fileSize = 0;
  let parseError = null;
  let filePromise = Promise.resolve();
  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      defParamCharset: "utf8",
      limits: {
        fileSize: maxFileBytes + 1,
        files: 1,
        fields: 1,
        parts: 3,
        fieldSize: 128,
      },
    });
  } catch {
    throw new ReleaseUploadError("invalid_multipart");
  }
  const fail = (error) => {
    parseError ||=
      error instanceof ReleaseUploadError
        ? error
        : new ReleaseUploadError("invalid_multipart");
  };
  busboy.on("field", (name, value, info) => {
    if (
      name !== "version" ||
      version !== null ||
      info.nameTruncated ||
      info.valueTruncated
    ) {
      fail(new ReleaseUploadError("invalid_upload_fields"));
      return;
    }
    version = value.trim();
  });
  busboy.on("file", (name, stream, info) => {
    if (
      name !== "installer" ||
      fileSeen ||
      !info.filename.toLowerCase().endsWith(".exe")
    ) {
      fail(new ReleaseUploadError("invalid_desktop_release_file"));
      stream.resume();
      return;
    }
    fileSeen = true;
    stream.once("limit", () =>
      fail(new ReleaseUploadError("desktop_release_too_large", 413)),
    );
    stream.on("data", (chunk) => {
      fileSize += chunk.length;
    });
    filePromise = pipeline(
      stream,
      createWriteStream(stagedPath, { flags: "wx", mode: 0o600 }),
    ).catch(fail);
  });
  busboy.on("filesLimit", () =>
    fail(new ReleaseUploadError("invalid_desktop_release_file")),
  );
  busboy.on("fieldsLimit", () =>
    fail(new ReleaseUploadError("invalid_upload_fields")),
  );
  busboy.on("partsLimit", () =>
    fail(new ReleaseUploadError("invalid_multipart")),
  );
  await new Promise((resolve, reject) => {
    busboy.once("close", resolve);
    busboy.once("error", reject);
    req.once("aborted", () => reject(new ReleaseUploadError("upload_aborted")));
    req.pipe(busboy);
  }).catch(fail);
  await filePromise;
  if (parseError) {
    await fs.rm(stagedPath, { force: true });
    throw parseError;
  }
  if (!fileSeen || fileSize === 0)
    throw new ReleaseUploadError("desktop_release_file_required");
  if (!semver.valid(version) || semver.prerelease(version)) {
    await fs.rm(stagedPath, { force: true });
    throw new ReleaseUploadError("invalid_desktop_release_version");
  }
  return { stagedPath, version, size: fileSize };
}

async function publishUploadedRelease({
  stagedPath,
  version,
  size,
}) {
  const args = [
    PUBLISH_SCRIPT,
    "--staged",
    stagedPath,
    "--version",
    version,
    "--sha256",
    await calculateFileSha256(stagedPath),
    "--size",
    String(size),
    "--allow-downgrade",
    "true",
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: path.resolve(SERVICE_DIR, "../.."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new ReleaseUploadError(
              stderr.includes("same version")
                ? "desktop_release_version_conflict"
                : "desktop_release_publish_failed",
              stderr.includes("same version") ? 409 : 500,
            ),
          ),
    );
  });
}

async function acquireReleaseUploadLock(storageRoot) {
  await fs.mkdir(storageRoot, { recursive: true, mode: 0o750 });
  const child = spawn(
    process.platform === "win32" ? "flock" : "/usr/bin/flock",
    [
      "-n",
      path.join(storageRoot, ".publish.lock"),
      process.execPath,
      "-e",
      LOCK_HOLDER_CODE,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stderr.resume();

  return await new Promise((resolve, reject) => {
    let acquired = false;
    let stdout = "";
    const rejectBeforeAcquire = (error) => {
      if (!acquired) reject(error);
    };
    child.once("error", () =>
      rejectBeforeAcquire(
        new ReleaseUploadError("desktop_release_lock_failed", 500),
      ),
    );
    child.once("exit", (code) => {
      if (acquired) return;
      rejectBeforeAcquire(
        new ReleaseUploadError(
          code === 1
            ? "desktop_release_upload_busy"
            : "desktop_release_lock_failed",
          code === 1 ? 409 : 500,
        ),
      );
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (acquired) return;
      stdout += chunk;
      if (!stdout.includes("LOCKED\n")) return;
      acquired = true;
      let released = false;
      resolve(async () => {
        if (released) return;
        released = true;
        if (child.exitCode !== null) return;
        await new Promise((releaseResolve) => {
          child.once("exit", releaseResolve);
          child.stdin.end();
        });
      });
    });
  });
}

async function calculateFileSha256(filePath) {
  const { createHash } = await import("node:crypto");
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
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

export function createReleaseDownloadService({
  config,
  accessControlService,
  publishRelease = publishUploadedRelease,
  acquireUploadLock = acquireReleaseUploadLock,
}) {
  const storageRoot = path.resolve(config.DESKTOP_RELEASE_STORAGE_DIR);
  const maxFileBytes = config.MAX_DESKTOP_RELEASE_FILE_BYTES;
  const limiter = new GlobalBandwidthLimiter(
    config.DESKTOP_RELEASE_BANDWIDTH_BPS,
  );

  async function handleDownload(req, res) {
    let opened;
    try {
      opened = await openCurrentRelease(storageRoot, maxFileBytes);
    } catch (error) {
      console.error(
        "[release-download] current release unavailable",
        error?.message || error,
      );
      sendJson(res, 503, { error: "release_unavailable" });
      return;
    }
    const { handle, manifest } = opened;
    const etag = `"${manifest.sha256}"`;
    try {
      const requestedRange =
        req.headers["if-range"] && req.headers["if-range"] !== etag
          ? null
          : parseRange(req.headers.range, manifest.size);
      if (requestedRange === false) {
        res.writeHead(416, {
          "content-range": `bytes */${manifest.size}`,
          "accept-ranges": "bytes",
        });
        res.end();
        return;
      }
      if (!requestedRange && req.headers["if-none-match"] === etag) {
        res.writeHead(304, { etag, "cache-control": "no-store" });
        res.end();
        return;
      }
      const start = requestedRange?.start ?? 0;
      const end = requestedRange?.end ?? manifest.size - 1;
      res.writeHead(
        requestedRange ? 206 : 200,
        fileHeaders(manifest, start, end, requestedRange),
      );
      if (req.method === "HEAD") {
        res.end();
        return;
      }
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

  return {
    async handleRequest(req, res, url) {
      if (url.pathname === ADMIN_PATH) {
        if (req.method === "GET") {
          if (!(await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.RELEASE_VIEW))) return true;
          try {
            const { handle, manifest } = await openCurrentRelease(
              storageRoot,
              maxFileBytes,
            );
            await handle.close();
            sendJson(res, 200, { release: manifest, maxFileBytes });
          } catch {
            sendJson(res, 200, { release: null, maxFileBytes });
          }
          return true;
        }
        if (req.method !== "POST") {
          res.setHeader("allow", "GET, POST");
          sendJson(res, 405, { error: "method_not_allowed" });
          return true;
        }
        if (!(await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.RELEASE_UPLOAD, { requireOrigin: true }))) {
          req.resume();
          return true;
        }
        let releaseUploadLock;
        try {
          releaseUploadLock = await acquireUploadLock(storageRoot);
        } catch (error) {
          req.resume();
          sendJson(res, error?.status || 500, {
            error: error?.message || "desktop_release_lock_failed",
          });
          return true;
        }
        let upload;
        try {
          upload = await parseReleaseUpload(req, storageRoot, maxFileBytes);
          await publishRelease({ storageRoot, ...upload });
          const { handle, manifest } = await openCurrentRelease(
            storageRoot,
            maxFileBytes,
          );
          await handle.close();
          sendJson(res, 200, { ok: true, release: manifest });
        } catch (error) {
          if (upload?.stagedPath)
            await fs.rm(upload.stagedPath, { force: true });
          console.error(
            "[release-upload] request failed",
            error?.message || error,
          );
          sendJson(res, error?.status || 500, {
            error: error?.message || "desktop_release_upload_failed",
          });
        } finally {
          await releaseUploadLock().catch((error) =>
            console.error(
              "[release-upload] failed to release publish lock",
              error?.message || error,
            ),
          );
        }
        return true;
      }
      if (url.pathname !== DOWNLOAD_PATH) return false;
      if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
        sendJson(res, 503, { error: "release_unavailable" });
        return true;
      }
      if (!new Set(["GET", "HEAD"]).has(req.method)) {
        res.setHeader("allow", "GET, HEAD");
        sendJson(res, 405, { error: "method_not_allowed" });
        return true;
      }
      await handleDownload(req, res);
      return true;
    },
  };
}
