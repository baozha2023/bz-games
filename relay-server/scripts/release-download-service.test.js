import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publishDesktopRelease } from "./publish-desktop-release.js";
import { createReleaseDownloadService } from "../src/services/release-download-service.js";

async function createHarness({
  bitsPerSecond = 8_000_000,
  payloadBytes = 256 * 1024,
} = {}) {
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-release-test-"),
  );
  const incoming = path.join(storageRoot, ".incoming");
  await fs.mkdir(incoming);
  const body = Buffer.alloc(payloadBytes, 7);
  body.write("MZ", 0, "ascii");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const staged = path.join(incoming, "staged.exe");
  await fs.writeFile(staged, body);
  const config = {
    DESKTOP_RELEASE_STORAGE_DIR: storageRoot,
    MAX_DESKTOP_RELEASE_FILE_BYTES: 2 * 1024 * 1024,
    DESKTOP_RELEASE_BANDWIDTH_BPS: bitsPerSecond,
  };
  await publishDesktopRelease(
    {
      staged,
      version: "3.2.0",
      size: body.length,
      sha256,
      allowDowngrade: false,
    },
    config,
  );
  const service = createReleaseDownloadService({ config });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    body,
    sha256,
    storageRoot,
    url: `http://127.0.0.1:${address.port}/api/v1/releases/latest/download`,
    legacyUrl: `http://127.0.0.1:${address.port}/bz-games/api/v1/releases/latest/download`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(storageRoot, { recursive: true, force: true });
    },
  };
}

test("release endpoint supports GET, HEAD, ranges and validators", async () => {
  const harness = await createHarness();
  try {
    const head = await fetch(harness.url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal((await fetch(harness.legacyUrl)).status, 404);
    assert.equal(
      head.headers.get("content-length"),
      String(harness.body.length),
    );
    assert.match(
      head.headers.get("content-disposition"),
      /BZ-Games-Setup-3\.2\.0\.exe/,
    );

    const partial = await fetch(harness.url, {
      headers: { range: "bytes=2-9" },
    });
    assert.equal(partial.status, 206);
    assert.equal(
      partial.headers.get("content-range"),
      `bytes 2-9/${harness.body.length}`,
    );
    assert.deepEqual(
      Buffer.from(await partial.arrayBuffer()),
      harness.body.subarray(2, 10),
    );

    const unsatisfied = await fetch(harness.url, {
      headers: { range: `bytes=${harness.body.length}-` },
    });
    assert.equal(unsatisfied.status, 416);

    const notModified = await fetch(harness.url, {
      headers: { "if-none-match": `"${harness.sha256}"` },
    });
    assert.equal(notModified.status, 304);

    const ignoredRange = await fetch(harness.url, {
      headers: { range: "bytes=2-9", "if-range": '"different"' },
    });
    assert.equal(ignoredRange.status, 200);
    assert.deepEqual(
      Buffer.from(await ignoredRange.arrayBuffer()),
      harness.body,
    );

    const rejectedMethod = await fetch(harness.url, { method: "POST" });
    assert.equal(rejectedMethod.status, 405);
    assert.equal(rejectedMethod.headers.get("allow"), "GET, HEAD");
  } finally {
    await harness.close();
  }
});

test("release endpoint reports unavailable storage without exposing paths", async () => {
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-release-empty-"),
  );
  const service = createReleaseDownloadService({
    config: {
      DESKTOP_RELEASE_STORAGE_DIR: storageRoot,
      MAX_DESKTOP_RELEASE_FILE_BYTES: 1024,
      DESKTOP_RELEASE_BANDWIDTH_BPS: 8_000_000,
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    await service.handleRequest(req, res, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/releases/latest/download`,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "release_unavailable" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

test("release endpoint enforces one aggregate bandwidth schedule", async () => {
  const bitsPerSecond = 1_048_576;
  const harness = await createHarness({
    bitsPerSecond,
    payloadBytes: 128 * 1024,
  });
  try {
    const startedAt = performance.now();
    const [first, second] = await Promise.all([
      fetch(harness.url).then((response) => response.arrayBuffer()),
      fetch(harness.url).then((response) => response.arrayBuffer()),
    ]);
    const elapsed = performance.now() - startedAt;
    assert.equal(first.byteLength + second.byteLength, 256 * 1024);
    assert.ok(
      elapsed >= 1400,
      `aggregate limiter completed too quickly: ${elapsed}ms`,
    );
  } finally {
    await harness.close();
  }
});

test("publisher rejects rollback and retains the current same-version release", async () => {
  const harness = await createHarness();
  try {
    const incoming = path.join(harness.storageRoot, ".incoming");
    const makeStaged = async (name, marker) => {
      const body = Buffer.alloc(64, marker);
      body.write("MZ", 0, "ascii");
      const staged = path.join(incoming, name);
      await fs.writeFile(staged, body);
      return {
        staged,
        size: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
      };
    };
    await assert.rejects(
      publishDesktopRelease(
        {
          ...(await makeStaged("old.exe", 1)),
          version: "3.1.9",
          allowDowngrade: false,
        },
        {
          DESKTOP_RELEASE_STORAGE_DIR: harness.storageRoot,
          MAX_DESKTOP_RELEASE_FILE_BYTES: 2 * 1024 * 1024,
        },
      ),
      /older release/,
    );
    const changed = await makeStaged("changed.exe", 2);
    const result = await publishDesktopRelease(
      {
        ...changed,
        version: "3.2.0",
        allowDowngrade: false,
      },
      {
        DESKTOP_RELEASE_STORAGE_DIR: harness.storageRoot,
        MAX_DESKTOP_RELEASE_FILE_BYTES: 2 * 1024 * 1024,
      },
    );
    assert.equal(result.status, "current_retained");
    assert.equal(
      result.message,
      "desktop_release_same_version_different_sha256",
    );
    assert.equal(result.release.sha256, harness.sha256);
    await assert.rejects(fs.access(changed.staged), { code: "ENOENT" });
  } finally {
    await harness.close();
  }
});

test(
  "publisher normalizes release ownership and permissions",
  { skip: process.platform === "win32" },
  async () => {
    const storageRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "bz-release-permissions-"),
    );
    const incomingRoot = path.join(storageRoot, ".incoming");
    await fs.mkdir(incomingRoot);
    const executable = Buffer.alloc(96, 4);
    executable.write("MZ", 0, "ascii");
    const staged = path.join(incomingRoot, "staged.exe");
    await fs.writeFile(staged, executable, { mode: 0o600 });

    try {
      await publishDesktopRelease(
        {
          staged,
          version: "3.2.2",
          size: executable.length,
          sha256: createHash("sha256").update(executable).digest("hex"),
          allowDowngrade: false,
        },
        {
          DESKTOP_RELEASE_STORAGE_DIR: storageRoot,
          MAX_DESKTOP_RELEASE_FILE_BYTES: 2 * 1024 * 1024,
        },
      );

      const storageStat = await fs.stat(storageRoot);
      for (const fileName of ["BZ-Games-Setup-3.2.2.exe", "latest.json"]) {
        const fileStat = await fs.stat(path.join(storageRoot, fileName));
        assert.equal(fileStat.uid, storageStat.uid);
        assert.equal(fileStat.gid, storageStat.gid);
        assert.equal(fileStat.mode & 0o777, 0o640);
      }
    } finally {
      await fs.rm(storageRoot, { recursive: true, force: true });
    }
  },
);

test("super administrator upload publishes an executable through the shared publisher", async () => {
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-release-admin-"),
  );
  await fs.mkdir(path.join(storageRoot, ".incoming"));
  const config = {
    DESKTOP_RELEASE_STORAGE_DIR: storageRoot,
    MAX_DESKTOP_RELEASE_FILE_BYTES: 2 * 1024 * 1024,
    DESKTOP_RELEASE_BANDWIDTH_BPS: 8_000_000,
  };
  const currentExecutable = Buffer.alloc(96, 2);
  currentExecutable.write("MZ", 0, "ascii");
  const currentStaged = path.join(storageRoot, ".incoming", "current.exe");
  await fs.writeFile(currentStaged, currentExecutable);
  await publishDesktopRelease(
    {
      staged: currentStaged,
      version: "3.3.0",
      size: currentExecutable.length,
      sha256: createHash("sha256").update(currentExecutable).digest("hex"),
      allowDowngrade: false,
    },
    config,
  );
  const publishRelease = async ({ stagedPath, version, size }) => {
    const body = await fs.readFile(stagedPath);
    return await publishDesktopRelease(
      {
        staged: stagedPath,
        version,
        size,
        sha256: createHash("sha256").update(body).digest("hex"),
        allowDowngrade: true,
      },
      config,
    );
  };
  const capabilityChecks = [];
  const service = createReleaseDownloadService({
    config,
    accessControlService: {
      requireCapability: async (req, res, capability, options) => {
        capabilityChecks.push({ method: req.method, capability, options });
        return { user: { role: "super_administrator" } };
      },
    },
    publishRelease,
    acquireUploadLock: async () => async () => {},
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    await service.handleRequest(req, res, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}/api/admin/v1/desktop-release`;
    const executable = Buffer.alloc(96, 3);
    executable.write("MZ", 0, "ascii");
    const form = new FormData();
    form.set("version", "3.2.0");
    form.set("installer", new Blob([executable]), "BZ-Games-Setup-3.2.0.exe");
    const response = await fetch(url, { method: "POST", body: form });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "published");
    assert.equal(body.message, "desktop_release_published");
    assert.equal(body.release.version, "3.2.0");
    assert.equal(body.release.size, executable.length);
    const status = await (await fetch(url)).json();
    assert.equal(status.release.sha256, body.release.sha256);
    const conflictingForm = new FormData();
    conflictingForm.set("version", "3.2.0");
    conflictingForm.set(
      "installer",
      new Blob([Buffer.concat([executable, Buffer.from([1])])]),
      "BZ-Games-Setup-3.2.0.exe",
    );
    const conflictingResponse = await fetch(url, {
      method: "POST",
      body: conflictingForm,
    });
    assert.equal(conflictingResponse.status, 409);
    assert.deepEqual(await conflictingResponse.json(), {
      error: "desktop_release_version_conflict",
    });
    assert.deepEqual(capabilityChecks, [
      {
        method: "POST",
        capability: "release.upload",
        options: { requireOrigin: true },
      },
      { method: "GET", capability: "release.view", options: undefined },
      {
        method: "POST",
        capability: "release.upload",
        options: { requireOrigin: true },
      },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

test("a concurrent release upload is rejected before publishing", async () => {
  const storageRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-release-lock-test-"),
  );
  await fs.mkdir(path.join(storageRoot, ".incoming"));
  const config = {
    DESKTOP_RELEASE_STORAGE_DIR: storageRoot,
    MAX_DESKTOP_RELEASE_FILE_BYTES: 2 * 1024 * 1024,
    DESKTOP_RELEASE_BANDWIDTH_BPS: 8_000_000,
  };
  let locked = false;
  let finishPublish;
  let markPublishStarted;
  const publishStarted = new Promise((resolve) => {
    markPublishStarted = resolve;
  });
  const publishGate = new Promise((resolve) => {
    finishPublish = resolve;
  });
  const service = createReleaseDownloadService({
    config,
    accessControlService: {
      requireCapability: async () => ({
        user: { role: "super_administrator" },
      }),
    },
    acquireUploadLock: async () => {
      if (locked) {
        throw Object.assign(new Error("desktop_release_upload_busy"), {
          status: 409,
        });
      }
      locked = true;
      return async () => {
        locked = false;
      };
    },
    publishRelease: async ({ stagedPath, version, size }) => {
      markPublishStarted();
      await publishGate;
      const body = await fs.readFile(stagedPath);
      await publishDesktopRelease(
        {
          staged: stagedPath,
          version,
          size,
          sha256: createHash("sha256").update(body).digest("hex"),
          allowDowngrade: true,
        },
        config,
      );
    },
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    await service.handleRequest(req, res, url);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/v1/desktop-release`;
  const form = (version) => {
    const executable = Buffer.alloc(96, 3);
    executable.write("MZ", 0, "ascii");
    const value = new FormData();
    value.set("version", version);
    value.set(
      "installer",
      new Blob([executable]),
      `BZ-Games-Setup-${version}.exe`,
    );
    return value;
  };
  try {
    const first = fetch(url, { method: "POST", body: form("3.3.0") });
    await publishStarted;
    const second = await fetch(url, {
      method: "POST",
      body: form("3.3.1"),
    });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, "desktop_release_upload_busy");
    finishPublish();
    assert.equal((await first).status, 200);
  } finally {
    finishPublish?.();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});
