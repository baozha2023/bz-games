import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import semver from "semver";

import { config } from "../src/config.js";
import { parseReleaseManifest } from "../src/services/release-download-service.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined)
      throw new Error("invalid arguments");
    values.set(key.slice(2), value);
  }
  const result = {
    staged: values.get("staged"),
    version: values.get("version"),
    sha256: values.get("sha256"),
    size: Number(values.get("size")),
    allowDowngrade:
      values.get("allow-downgrade") === "true"
        ? true
        : values.get("allow-downgrade") === "false"
          ? false
          : undefined,
  };
  if (
    values.size !== 5 ||
    [...values.keys()].some(
      (key) =>
        !new Set([
          "staged",
          "version",
          "sha256",
          "size",
          "allow-downgrade",
        ]).has(key),
    ) ||
    typeof result.allowDowngrade !== "boolean"
  ) {
    throw new Error(
      "expected --staged, --version, --sha256, --size and --allow-downgrade true|false",
    );
  }
  return result;
}

async function calculateSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function normalizePublishedFile(filePath, storageOwner) {
  if (typeof process.getuid === "function") {
    await fs.chown(filePath, storageOwner.uid, storageOwner.gid);
  }
  await fs.chmod(filePath, 0o640);
}

async function readCurrentManifest(storageRoot, maxFileBytes) {
  try {
    return parseReleaseManifest(
      await fs.readFile(path.join(storageRoot, "latest.json"), "utf8"),
      maxFileBytes,
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`current release manifest is invalid: ${error.message}`);
  }
}

async function cleanStorage(storageRoot, currentFilename) {
  const entries = await fs.readdir(storageRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const isOldExecutable =
      /^BZ-Games-Setup-\d+\.\d+\.\d+\.exe$/.test(entry.name) &&
      entry.name !== currentFilename;
    const isBackup = /(?:\.bak|\.backup)(?:\.|$)/i.test(entry.name);
    const isOldManifest = /^latest\..+\.json$/.test(entry.name);
    if (isOldExecutable || isBackup || isOldManifest) {
      await fs.rm(path.join(storageRoot, entry.name), { force: true });
    }
  }
  const incoming = path.join(storageRoot, ".incoming");
  for (const entry of await fs.readdir(incoming, { withFileTypes: true })) {
    if (entry.isFile() || entry.isSymbolicLink()) {
      await fs.rm(path.join(incoming, entry.name), { force: true });
    }
  }
}

export async function publishDesktopRelease(options, runtimeConfig = config) {
  const storageRoot = path.resolve(runtimeConfig.DESKTOP_RELEASE_STORAGE_DIR);
  const incomingRoot = path.join(storageRoot, ".incoming");
  const maxFileBytes = runtimeConfig.MAX_DESKTOP_RELEASE_FILE_BYTES;
  if (!semver.valid(options.version) || semver.prerelease(options.version))
    throw new Error("version must be a stable semver");
  if (typeof options.allowDowngrade !== "boolean")
    throw new Error("allowDowngrade must be a boolean");
  if (!SHA256_PATTERN.test(options.sha256))
    throw new Error("sha256 must be 64 lowercase hexadecimal characters");
  if (
    !Number.isSafeInteger(options.size) ||
    options.size <= 0 ||
    options.size > maxFileBytes
  )
    throw new Error("invalid release size");

  const stagedPath = path.resolve(options.staged);
  if (path.dirname(stagedPath) !== incomingRoot)
    throw new Error(
      "staged file must be directly inside the release .incoming directory",
    );
  const stagedStat = await fs.lstat(stagedPath);
  if (
    !stagedStat.isFile() ||
    stagedStat.isSymbolicLink() ||
    stagedStat.size !== options.size
  )
    throw new Error("staged release is not the expected regular file");
  const handle = await fs.open(stagedPath, "r");
  try {
    const signature = Buffer.alloc(2);
    const { bytesRead } = await handle.read(signature, 0, 2, 0);
    if (bytesRead !== 2 || signature.toString("ascii") !== "MZ")
      throw new Error("staged release is not a Windows executable");
  } finally {
    await handle.close();
  }
  const actualSha256 = await calculateSha256(stagedPath);
  if (actualSha256 !== options.sha256)
    throw new Error("staged release sha256 mismatch");

  await fs.mkdir(storageRoot, { recursive: true, mode: 0o750 });
  await fs.mkdir(incomingRoot, { recursive: true, mode: 0o750 });
  const storageOwner = await fs.stat(storageRoot);
  const current = await readCurrentManifest(storageRoot, maxFileBytes);
  if (
    current &&
    !options.allowDowngrade &&
    semver.lt(options.version, current.version)
  )
    throw new Error("refusing to publish an older release");
  if (current?.version === options.version) {
    await fs.rm(stagedPath, { force: true });
    await cleanStorage(storageRoot, current.filename);
    if (current.sha256 !== options.sha256) {
      return {
        status: "current_retained",
        message: "desktop_release_same_version_different_sha256",
        release: current,
      };
    }
    return {
      status: "already_current",
      message: "desktop_release_already_current",
      release: current,
    };
  }

  const filename = `BZ-Games-Setup-${options.version}.exe`;
  const targetPath = path.join(storageRoot, filename);
  await fs.rename(stagedPath, targetPath);
  await normalizePublishedFile(targetPath, storageOwner);
  const manifest = {
    version: options.version,
    filename,
    size: options.size,
    sha256: options.sha256,
  };
  const manifestTemp = path.join(
    storageRoot,
    `.latest-${process.pid}-${Date.now()}.json`,
  );
  await fs.writeFile(manifestTemp, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o640,
  });
  await normalizePublishedFile(manifestTemp, storageOwner);
  await fs.rename(manifestTemp, path.join(storageRoot, "latest.json"));
  await cleanStorage(storageRoot, filename);
  return {
    status: "published",
    message: "desktop_release_published",
    release: manifest,
  };
}

async function main() {
  const result = await publishDesktopRelease(
    parseArguments(process.argv.slice(2)),
  );
  console.log(JSON.stringify({ ok: true, ...result }));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`[desktop-release-publish] ${error.message}`);
    process.exitCode = 1;
  });
}
