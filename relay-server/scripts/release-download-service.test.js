import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import yazl from "yazl";

import {
  publishReleaseBundle,
  openBundleFile,
  readCurrentBundle,
  releaseLimits,
  RELEASE_FEED_NAME,
  validateReleaseBundle,
} from "../src/services/release-bundle-service.js";
import { createReleaseDownloadService } from "../src/services/release-download-service.js";

const MIB = 1024 * 1024;
const TEST_UPDATE_TOKEN = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeNupkg(
  filePath,
  version,
  { packageId = "com.bzgames.desktop", unsafe = false } = {},
) {
  const zip = new yazl.ZipFile();
  const options = { mtime: new Date("2020-01-01T00:00:00Z"), mode: 0o100644 };
  zip.addBuffer(
    Buffer.from(
      `<?xml version="1.0"?><package><metadata><id>${packageId}</id><version>${version}</version></metadata></package>`,
    ),
    `${packageId}.nuspec`,
    options,
  );
  zip.addBuffer(
    Buffer.from("payload"),
    unsafe ? "../escape.txt" : "lib/net8.0/payload.bin",
    options,
  );
  zip.end();
  await new Promise((resolve, reject) => {
    zip.outputStream.once("error", reject);
    const output = createWriteStream(filePath, { flags: "wx" });
    output.once("error", reject);
    output.once("close", resolve);
    zip.outputStream.pipe(output);
  });
}

async function createStagedBundle(
  storageRoot,
  {
    channel = "stable",
    version = "4.0.0",
    marker = "a",
    delta = false,
    extra = false,
  } = {},
) {
  const staged = path.join(
    storageRoot,
    ".incoming",
    `bundle-${Date.now()}-${Math.random()}`,
  );
  await fs.mkdir(staged, { recursive: true });
  const assets = [];
  for (const type of delta ? ["Full", "Delta"] : ["Full"]) {
    const filename = `com.bzgames.desktop-${version}-stable-${type.toLowerCase()}.nupkg`;
    const filePath = path.join(staged, filename);
    await writeNupkg(filePath, version);
    const body = await fs.readFile(filePath);
    assets.push({
      PackageId: "com.bzgames.desktop",
      Version: version,
      Type: type,
      FileName: filename,
      SHA1: createHash("sha1").update(body).digest("hex").toUpperCase(),
      SHA256: sha256(body).toUpperCase(),
      Size: body.length,
    });
  }
  await fs.writeFile(
    path.join(staged, "releases.stable.json"),
    JSON.stringify({ Assets: assets }),
  );
  const installer = Buffer.concat([
    Buffer.from("MZ"),
    Buffer.from(marker.repeat(96)),
  ]);
  await fs.writeFile(
    path.join(staged, `BZ-Games-Setup-${version}.exe`),
    installer,
  );
  if (extra) await fs.writeFile(path.join(staged, "unexpected.txt"), "extra");
  return staged;
}

function testConfig(stableRoot, testRoot = `${stableRoot}-test`) {
  return {
    DESKTOP_RELEASE_STORAGE_DIR: stableRoot,
    TEST_DESKTOP_RELEASE_STORAGE_DIR: testRoot,
    DESKTOP_UPDATE_TEST_TOKEN: TEST_UPDATE_TOKEN,
    MAX_DESKTOP_RELEASE_FILE_BYTES: 2 * MIB,
    MAX_DESKTOP_RELEASE_BUNDLE_BYTES: 8 * MIB,
    MAX_DESKTOP_RELEASE_FEED_BYTES: MIB,
    MAX_DESKTOP_RELEASE_ASSETS: 16,
    DESKTOP_RELEASE_BANDWIDTH_BPS: 80_000_000,
  };
}

async function publish(storageRoot, options = {}) {
  const config = testConfig(storageRoot);
  return await publishReleaseBundle({
    storageRoot,
    stagedDir: await createStagedBundle(storageRoot, options),
    channel: options.channel || "stable",
    limits: releaseLimits(config),
    allowDowngrade: options.allowDowngrade || false,
  });
}

async function serverHarness() {
  const stableRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-stable-release-"),
  );
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bz-test-release-"));
  const config = testConfig(stableRoot, testRoot);
  await publish(stableRoot);
  await publish(testRoot, { channel: "test", version: "4.0.0" });
  const previousTest = await readCurrentBundle(testRoot);
  const previousTestFull = previousTest.assets.find(
    (asset) => asset.version === previousTest.version && asset.type === "Full",
  );
  const testStaged = await createStagedBundle(testRoot, {
    channel: "test",
    version: "4.0.1",
    delta: true,
  });
  const testFeedPath = path.join(testStaged, RELEASE_FEED_NAME);
  const testFeed = JSON.parse(await fs.readFile(testFeedPath, "utf8"));
  testFeed.Assets.push({
    PackageId: "com.bzgames.desktop",
    Version: previousTestFull.version,
    Type: "Full",
    FileName: previousTestFull.filename,
    SHA1: "0",
    SHA256: previousTestFull.sha256,
    Size: previousTestFull.size,
  });
  await fs.writeFile(testFeedPath, JSON.stringify(testFeed));
  await fs.copyFile(
    path.join(previousTest.bundlePath, previousTestFull.filename),
    path.join(testStaged, previousTestFull.filename),
  );
  await publishReleaseBundle({
    storageRoot: testRoot,
    stagedDir: testStaged,
    channel: "test",
    limits: releaseLimits(config),
    allowDowngrade: false,
  });
  const checks = [];
  const service = createReleaseDownloadService({
    config,
    accessControlService: {
      requireCapability: async (req, res, capability, options) => {
        checks.push({ method: req.method, capability, options });
        return { user: { role: "super_administrator" } };
      },
    },
    acquireUploadLock: async () => async () => {},
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!(await service.handleRequest(req, res, url))) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    stableRoot,
    testRoot,
    checks,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(stableRoot, { recursive: true, force: true });
      await fs.rm(testRoot, { recursive: true, force: true });
    },
  };
}

test("release configuration rejects unsafe roots, tokens, and limit relationships", () => {
  const stableRoot = path.join(os.tmpdir(), "bz-release-config-stable");
  const accessControlService = { requireCapability: async () => true };
  assert.throws(
    () =>
      createReleaseDownloadService({
        config: testConfig(stableRoot, stableRoot),
        accessControlService,
      }),
    /storage roots must be separate/,
  );
  assert.throws(
    () =>
      createReleaseDownloadService({
        config: {
          ...testConfig(stableRoot),
          DESKTOP_UPDATE_TEST_TOKEN: "short-token",
        },
        accessControlService,
      }),
    /32 bytes encoded as Base64URL/,
  );
  assert.throws(
    () =>
      releaseLimits({
        ...testConfig(stableRoot),
        MAX_DESKTOP_RELEASE_FEED_BYTES: 3 * MIB,
      }),
    /invalid desktop release limits/,
  );
});

test("stable bundle publishes atomically and exposes installer/feed/assets with HTTP validators", async () => {
  const harness = await serverHarness();
  try {
    const current = await readCurrentBundle(harness.stableRoot);
    const installerMetadata = current.files.find(
      (file) => file.filename === current.installer,
    );
    const installerUrl = `${harness.base}/api/v1/releases/latest/download`;
    const head = await fetch(installerUrl, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("x-file-sha256"), installerMetadata.sha256);
    const partial = await fetch(installerUrl, {
      headers: { range: "bytes=2-9" },
    });
    assert.equal(partial.status, 206);
    assert.equal((await partial.arrayBuffer()).byteLength, 8);
    assert.equal(
      (
        await fetch(installerUrl, {
          headers: { "if-none-match": head.headers.get("etag") },
        })
      ).status,
      304,
    );
    assert.equal(
      (await fetch(installerUrl, { headers: { range: "bytes=999999-" } }))
        .status,
      416,
    );

    const feed = await fetch(
      `${harness.base}/api/v1/desktop-updates/stable/releases.stable.json`,
    );
    assert.equal(feed.status, 200);
    assert.equal(
      feed.headers.get("content-type"),
      "application/json; charset=utf-8",
    );
    const asset = current.assets[0];
    const packageResponse = await fetch(
      `${harness.base}/api/v1/desktop-updates/stable/${asset.filename}`,
    );
    assert.equal(packageResponse.status, 200);
    assert.equal(packageResponse.headers.get("x-file-sha256"), asset.sha256);
  } finally {
    await harness.close();
  }
});

test("test release path hides invalid tokens and serves a complete closure for the valid token", async () => {
  const harness = await serverHarness();
  try {
    assert.equal(
      (
        await fetch(
          `${harness.base}/api/v1/desktop-updates/test/wrong/releases.stable.json`,
        )
      ).status,
      404,
    );
    const feedUrl = `${harness.base}/api/v1/desktop-updates/test/${TEST_UPDATE_TOKEN}/releases.stable.json`;
    const feedResponse = await fetch(feedUrl);
    assert.equal(feedResponse.status, 200);
    const feed = await feedResponse.json();
    assert.equal(feed.Assets.length, 3);
    const current = await readCurrentBundle(harness.testRoot);
    assert.equal(current.installer, "BZ-Games-Setup-4.0.1.exe");
    assert.equal(
      (
        await fetch(
          `${harness.base}/api/v1/desktop-updates/test/${TEST_UPDATE_TOKEN}/${current.installer}`,
          { method: "HEAD" },
        )
      ).status,
      200,
    );
    for (const asset of feed.Assets) {
      assert.equal(
        (
          await fetch(
            `${harness.base}/api/v1/desktop-updates/test/${TEST_UPDATE_TOKEN}/${asset.FileName}`,
            { method: "HEAD" },
          )
        ).status,
        200,
      );
    }
  } finally {
    await harness.close();
  }
});

test("bundle validation rejects extra files, mismatched package identity, and incomplete delta closures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bz-invalid-release-"));
  const limits = releaseLimits(testConfig(root));
  try {
    await assert.rejects(
      validateReleaseBundle({
        stagedDir: await createStagedBundle(root, { extra: true }),
        channel: "stable",
        limits,
      }),
      /release_bundle_file_set_mismatch/,
    );
    const wrong = await createStagedBundle(root, {
      channel: "test",
      version: "4.0.1",
    });
    const feedPath = path.join(wrong, "releases.stable.json");
    const feed = JSON.parse(await fs.readFile(feedPath, "utf8"));
    feed.Assets[0].PackageId = "wrong.package";
    await fs.writeFile(feedPath, JSON.stringify(feed));
    await assert.rejects(
      validateReleaseBundle({ stagedDir: wrong, channel: "test", limits }),
      /invalid_release_package_id/,
    );
    const incomplete = await createStagedBundle(root, {
      channel: "test",
      version: "4.0.2",
      delta: true,
    });
    const incompleteFeedPath = path.join(incomplete, "releases.stable.json");
    const incompleteFeed = JSON.parse(
      await fs.readFile(incompleteFeedPath, "utf8"),
    );
    incompleteFeed.Assets = incompleteFeed.Assets.filter(
      (asset) => asset.Type === "Delta",
    );
    await fs.writeFile(incompleteFeedPath, JSON.stringify(incompleteFeed));
    await assert.rejects(
      validateReleaseBundle({ stagedDir: incomplete, channel: "test", limits }),
      /target_release_requires_one_full/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("same version and closure is idempotent while a different closure conflicts", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-idempotent-release-"),
  );
  try {
    const first = await publish(root, { version: "4.0.0", marker: "a" });
    assert.equal(first.status, "published");
    const identical = await publish(root, { version: "4.0.0", marker: "a" });
    assert.equal(identical.status, "already_current");
    await assert.rejects(
      publish(root, { version: "4.0.0", marker: "b" }),
      /release_version_conflict/,
    );
    await assert.rejects(
      publish(root, { version: "3.9.9", marker: "a" }),
      /release_downgrade_rejected/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("management publication replaces the same version and accepts a downgrade", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-management-release-"),
  );
  try {
    await publish(root, { version: "4.0.2", marker: "a" });
    const replacement = await publish(root, {
      version: "4.0.2",
      marker: "b",
      allowDowngrade: true,
    });
    assert.equal(replacement.status, "published");
    assert.equal((await readCurrentBundle(root)).version, "4.0.2");
    const idempotent = await publish(root, {
      version: "4.0.2",
      marker: "b",
      allowDowngrade: true,
    });
    assert.equal(idempotent.status, "already_current");

    const downgrade = await publish(root, {
      version: "4.0.1",
      marker: "c",
      allowDowngrade: true,
    });
    assert.equal(downgrade.status, "published");
    assert.equal((await readCurrentBundle(root)).version, "4.0.1");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("test publication requires the previous test Full in the uploaded closure", async () => {
  const testRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "bz-test-base-release-"),
  );
  try {
    await publish(testRoot, {
      channel: "test",
      version: "4.0.1",
      marker: "previous-test",
    });
    const previousTest = await readCurrentBundle(testRoot);
    const previousTestFull = previousTest.assets.find(
      (asset) =>
        asset.version === previousTest.version && asset.type === "Full",
    );
    assert.ok(previousTestFull);
    const staged = await createStagedBundle(testRoot, {
      channel: "test",
      version: "4.0.2",
      delta: false,
    });
    const feedPath = path.join(staged, RELEASE_FEED_NAME);
    const feed = JSON.parse(await fs.readFile(feedPath, "utf8"));
    feed.Assets.push({
      PackageId: "com.bzgames.desktop",
      Version: previousTestFull.version,
      Type: "Full",
      FileName: previousTestFull.filename,
      SHA1: "0",
      SHA256: previousTestFull.sha256,
      Size: previousTestFull.size,
    });
    await fs.writeFile(feedPath, JSON.stringify(feed));

    const config = testConfig(`${testRoot}-unused-stable`, testRoot);
    await assert.rejects(
      validateReleaseBundle({
        stagedDir: staged,
        channel: "test",
        limits: releaseLimits(config),
      }),
      /release_bundle_file_set_mismatch/,
    );
    await fs.copyFile(
      path.join(previousTest.bundlePath, previousTestFull.filename),
      path.join(staged, previousTestFull.filename),
    );
    const result = await publishReleaseBundle({
      storageRoot: testRoot,
      stagedDir: staged,
      channel: "test",
      limits: releaseLimits(config),
      allowDowngrade: true,
    });
    assert.equal(result.status, "published");
    const current = await readCurrentBundle(testRoot);
    assert.ok(
      current.files.some((file) => file.filename === previousTestFull.filename),
    );
    await fs.access(path.join(current.bundlePath, previousTestFull.filename));
    const opened = await openBundleFile(testRoot, previousTestFull.filename);
    assert.equal(opened.metadata.sha256, previousTestFull.sha256);
    await opened.handle.close();

    await assert.rejects(fs.access(previousTest.bundlePath), {
      code: "ENOENT",
    });
    const reopened = await openBundleFile(testRoot, previousTestFull.filename);
    assert.equal(reopened.metadata.sha256, previousTestFull.sha256);
    assert.equal(
      sha256(await reopened.handle.readFile()),
      previousTestFull.sha256,
    );
    await reopened.handle.close();
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

test("admin stable/test endpoints apply the intended capabilities, origins, uploads, and test clear", async () => {
  const harness = await serverHarness();
  try {
    const stableStatus = await fetch(
      `${harness.base}/api/admin/v1/desktop-release`,
    );
    assert.equal(stableStatus.status, 200);
    const testStatus = await fetch(
      `${harness.base}/api/admin/v1/desktop-release/test`,
    );
    assert.equal(testStatus.status, 200);

    const staged = await createStagedBundle(harness.testRoot, {
      channel: "test",
      version: "4.0.2",
      delta: true,
    });
    const form = new FormData();
    for (const name of await fs.readdir(staged)) {
      form.append(
        "files",
        new Blob([await fs.readFile(path.join(staged, name))]),
        name,
      );
    }
    const upload = await fetch(
      `${harness.base}/api/admin/v1/desktop-release/test`,
      { method: "POST", body: form },
    );
    assert.equal(upload.status, 200);
    assert.equal((await upload.json()).release.version, "4.0.2");
    const cleared = await fetch(
      `${harness.base}/api/admin/v1/desktop-release/test`,
      { method: "DELETE" },
    );
    assert.equal(cleared.status, 200);
    assert.deepEqual(
      harness.checks.map(({ method, capability, options }) => ({
        method,
        capability,
        options,
      })),
      [
        { method: "GET", capability: "release.view", options: undefined },
        { method: "GET", capability: "release.upload", options: undefined },
        {
          method: "POST",
          capability: "release.upload",
          options: { requireOrigin: true },
        },
        {
          method: "DELETE",
          capability: "release.upload",
          options: { requireOrigin: true },
        },
      ],
    );
  } finally {
    await harness.close();
  }
});
