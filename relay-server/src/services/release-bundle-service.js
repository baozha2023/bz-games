import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { XMLParser } from "fast-xml-parser";
import semver from "semver";
import yauzl from "yauzl";

export const RELEASE_FEED_NAME = "releases.stable.json";
export const RELEASE_PACKAGE_ID = "com.bzgames.desktop";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.nupkg$/;
const INSTALLER_PATTERN =
  /^BZ-Games-Setup-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.exe$/;

export class ReleaseBundleError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.status = status;
  }
}

function stableVersion(value) {
  return (
    typeof value === "string" &&
    semver.valid(value) &&
    !semver.prerelease(value)
  );
}

function safeDirectFileName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 180 &&
    path.basename(value) === value &&
    !/[\\/:*?"<>|\x00-\x1f]/.test(value)
  );
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function parseFeed(raw, limits) {
  if (Buffer.byteLength(raw) > limits.maxFeedBytes)
    throw new ReleaseBundleError("release_feed_too_large", 413);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReleaseBundleError("invalid_release_feed");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !Array.isArray(parsed.Assets) ||
    parsed.Assets.length === 0 ||
    parsed.Assets.length > limits.maxAssets
  ) {
    throw new ReleaseBundleError("invalid_release_feed");
  }
  const names = new Set();
  const assets = parsed.Assets.map((asset) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset))
      throw new ReleaseBundleError("invalid_release_asset");
    if (asset.PackageId !== RELEASE_PACKAGE_ID)
      throw new ReleaseBundleError("invalid_release_package_id");
    if (!stableVersion(asset.Version))
      throw new ReleaseBundleError("invalid_release_version");
    if (!new Set(["Full", "Delta"]).has(asset.Type))
      throw new ReleaseBundleError("invalid_release_asset_type");
    if (
      !safeDirectFileName(asset.FileName) ||
      !ASSET_NAME_PATTERN.test(asset.FileName)
    )
      throw new ReleaseBundleError("invalid_release_asset_name");
    if (names.has(asset.FileName))
      throw new ReleaseBundleError("duplicate_release_asset");
    names.add(asset.FileName);
    if (
      !Number.isSafeInteger(asset.Size) ||
      asset.Size <= 0 ||
      asset.Size > limits.maxFileBytes ||
      !SHA256_PATTERN.test(asset.SHA256 || "")
    ) {
      throw new ReleaseBundleError("invalid_release_asset_metadata");
    }
    return Object.freeze({
      packageId: asset.PackageId,
      version: asset.Version,
      type: asset.Type,
      filename: asset.FileName,
      size: asset.Size,
      sha256: asset.SHA256.toLowerCase(),
    });
  });
  const targetVersion = assets
    .map((asset) => asset.version)
    .sort(semver.rcompare)[0];
  const targetFull = assets.filter(
    (asset) => asset.version === targetVersion && asset.type === "Full",
  );
  if (targetFull.length !== 1)
    throw new ReleaseBundleError("target_release_requires_one_full");
  for (const delta of assets.filter((asset) => asset.type === "Delta")) {
    if (
      !assets.some(
        (asset) => asset.version === delta.version && asset.type === "Full",
      )
    )
      throw new ReleaseBundleError("delta_requires_same_version_full");
  }
  return { assets, targetVersion };
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, autoClose: true },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    );
  });
}

function readZipEntry(zip, entry, maxBytes) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) stream.destroy(new Error("zip_entry_too_large"));
        else chunks.push(chunk);
      });
      stream.once("error", reject);
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

function nuspecIdentity(document) {
  const packageNode = document?.package;
  const metadata = packageNode?.metadata;
  const value = Array.isArray(metadata) ? metadata[0] : metadata;
  return { id: value?.id, version: value?.version };
}

async function validateNupkg(filePath, expected) {
  let zip;
  try {
    zip = await openZip(filePath);
  } catch {
    throw new ReleaseBundleError("invalid_release_nupkg");
  }
  let nuspec = null;
  let invalid = false;
  try {
    await new Promise((resolve, reject) => {
      zip.once("error", reject);
      zip.once("end", resolve);
      zip.on("entry", async (entry) => {
        try {
          const name = entry.fileName;
          const normalized = name.replace(/\\/g, "/");
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
          const unixType = unixMode & 0o170000;
          const segments = normalized.endsWith("/")
            ? normalized.slice(0, -1).split("/")
            : normalized.split("/");
          if (
            name.includes("\\") ||
            normalized.startsWith("/") ||
            segments.some((segment) => segment === ".." || !segment) ||
            (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000)
          ) {
            invalid = true;
            reject(new Error("invalid_zip_entry"));
            zip.close();
            return;
          }
          if (
            !normalized.includes("/") &&
            normalized.toLowerCase().endsWith(".nuspec")
          ) {
            if (nuspec !== null) {
              invalid = true;
              reject(new Error("duplicate_nuspec"));
              zip.close();
              return;
            }
            nuspec = await readZipEntry(zip, entry, 1024 * 1024);
          }
          zip.readEntry();
        } catch (error) {
          reject(error);
        }
      });
      zip.readEntry();
    });
  } catch {
    invalid = true;
  }
  if (invalid || !nuspec) throw new ReleaseBundleError("invalid_release_nupkg");
  let identity;
  try {
    identity = nuspecIdentity(
      new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(
        nuspec.toString("utf8"),
      ),
    );
  } catch {
    throw new ReleaseBundleError("invalid_release_nuspec");
  }
  if (
    identity.id !== RELEASE_PACKAGE_ID ||
    identity.version !== expected.version
  )
    throw new ReleaseBundleError("release_nuspec_identity_mismatch");
}

async function validateRegularFiles(stagedDir, limits) {
  const entries = await fs.readdir(stagedDir, { withFileTypes: true });
  if (entries.length === 0 || entries.length > limits.maxAssets + 2)
    throw new ReleaseBundleError("invalid_release_file_count");
  const files = new Map();
  let totalSize = 0;
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !safeDirectFileName(entry.name)
    )
      throw new ReleaseBundleError("invalid_release_file");
    const filePath = path.join(stagedDir, entry.name);
    const stat = await fs.lstat(filePath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      stat.size > limits.maxFileBytes
    )
      throw new ReleaseBundleError("invalid_release_file");
    totalSize += stat.size;
    if (totalSize > limits.maxBundleBytes)
      throw new ReleaseBundleError("release_bundle_too_large", 413);
    files.set(entry.name, { path: filePath, size: stat.size });
  }
  return { files, totalSize };
}

function closureHash(summary) {
  const canonical = summary.files
    .map(({ filename, size, sha256 }) => `${filename}\0${size}\0${sha256}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function validateReleaseBundle({ stagedDir, channel, limits }) {
  if (channel !== "stable" && channel !== "test")
    throw new ReleaseBundleError("invalid_release_channel");
  const resolved = path.resolve(stagedDir);
  const validated = await validateRegularFiles(resolved, limits);
  const { files, totalSize } = validated;
  const feedFile = files.get(RELEASE_FEED_NAME);
  if (!feedFile || feedFile.size > limits.maxFeedBytes)
    throw new ReleaseBundleError("release_feed_required");
  const feedRaw = await fs.readFile(feedFile.path, "utf8");
  const { assets, targetVersion } = parseFeed(feedRaw, limits);
  const expectedNames = new Set([
    RELEASE_FEED_NAME,
    ...assets.map((asset) => asset.filename),
  ]);
  const installer = `BZ-Games-Setup-${targetVersion}.exe`;
  expectedNames.add(installer);
  if (!files.has(installer))
    throw new ReleaseBundleError("release_installer_required");
  if (
    files.size !== expectedNames.size ||
    [...files.keys()].some((name) => !expectedNames.has(name))
  )
    throw new ReleaseBundleError("release_bundle_file_set_mismatch");
  const summaries = [];
  for (const [filename, file] of files) {
    const sha256 = await sha256File(file.path);
    const asset = assets.find((item) => item.filename === filename);
    if (asset && (asset.size !== file.size || asset.sha256 !== sha256))
      throw new ReleaseBundleError("release_asset_integrity_mismatch");
    if (asset) await validateNupkg(file.path, asset);
    if (filename === installer) {
      const handle = await fs.open(file.path, "r");
      try {
        const signature = Buffer.alloc(2);
        const { bytesRead } = await handle.read(signature, 0, 2, 0);
        if (bytesRead !== 2 || signature.toString("ascii") !== "MZ")
          throw new ReleaseBundleError("invalid_release_installer");
      } finally {
        await handle.close();
      }
    }
    summaries.push({ filename, size: file.size, sha256 });
  }
  summaries.sort((left, right) => left.filename.localeCompare(right.filename));
  const feed = summaries.find((file) => file.filename === RELEASE_FEED_NAME);
  const summary = {
    format: "bz-games-release-bundle-v1",
    channel,
    version: targetVersion,
    installer,
    feed: { ...feed },
    assets: assets.map((asset) => ({ ...asset })),
    files: summaries,
    totalSize,
  };
  summary.closureSha256 = closureHash(summary);
  return summary;
}

export async function readCurrentBundle(storageRoot) {
  try {
    const current = JSON.parse(
      await fs.readFile(path.join(storageRoot, "current.json"), "utf8"),
    );
    if (
      current?.format !== "bz-games-release-bundle-v1" ||
      !stableVersion(current.version) ||
      !SHA256_PATTERN.test(current.closureSha256 || "") ||
      !safeDirectFileName(current.bundleDir)
    )
      throw new Error("invalid current bundle pointer");
    const bundlePath = path.join(storageRoot, "bundles", current.bundleDir);
    const stat = await fs.lstat(bundlePath);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("invalid current bundle directory");
    return { ...current, bundlePath };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function normalizeBundle(directory, storageStat) {
  if (process.platform === "win32") return;
  await fs.chown(directory, storageStat.uid, storageStat.gid);
  await fs.chmod(directory, 0o750);
  for (const entry of await fs.readdir(directory)) {
    const filePath = path.join(directory, entry);
    await fs.chown(filePath, storageStat.uid, storageStat.gid);
    await fs.chmod(filePath, 0o640);
  }
}

export async function publishReleaseBundle({
  storageRoot,
  stagedDir,
  channel,
  limits,
  allowDowngrade,
}) {
  const root = path.resolve(storageRoot);
  const incomingRoot = path.join(root, ".incoming");
  const staged = path.resolve(stagedDir);
  if (path.dirname(staged) !== incomingRoot)
    throw new ReleaseBundleError("invalid_release_staging_path");
  const summary = await validateReleaseBundle({
    stagedDir: staged,
    channel,
    limits,
  });
  await fs.mkdir(path.join(root, "bundles"), { recursive: true, mode: 0o750 });
  const storageStat = await fs.stat(root);
  const current = await readCurrentBundle(root);
  if (current && !allowDowngrade && semver.lt(summary.version, current.version))
    throw new ReleaseBundleError("release_downgrade_rejected", 409);
  if (
    current?.version === summary.version &&
    current.closureSha256 === summary.closureSha256
  ) {
    await fs.rm(staged, { recursive: true, force: true });
    return { status: "already_current", release: current };
  }
  if (current?.version === summary.version && !allowDowngrade) {
    await fs.rm(staged, { recursive: true, force: true });
    throw new ReleaseBundleError("release_version_conflict", 409);
  }
  const bundleDir = `${summary.version}-${summary.closureSha256.slice(0, 16)}`;
  const target = path.join(root, "bundles", bundleDir);
  try {
    await fs.rename(staged, target);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(staged, target);
  }
  await normalizeBundle(target, storageStat);
  const pointer = {
    ...summary,
    bundleDir,
    publishedAt: new Date().toISOString(),
  };
  const pointerTemp = path.join(
    root,
    `.current-${process.pid}-${randomUUID()}.json`,
  );
  await fs.writeFile(pointerTemp, `${JSON.stringify(pointer, null, 2)}\n`, {
    flag: "wx",
    mode: 0o640,
  });
  if (process.platform !== "win32") {
    await fs.chown(pointerTemp, storageStat.uid, storageStat.gid);
    await fs.chmod(pointerTemp, 0o640);
  }
  await fs.rename(pointerTemp, path.join(root, "current.json"));
  for (const legacyName of await fs.readdir(root)) {
    if (legacyName === "latest.json" || INSTALLER_PATTERN.test(legacyName)) {
      await fs.rm(path.join(root, legacyName), { force: true });
    }
  }
  for (const entry of await fs.readdir(path.join(root, "bundles"), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory() && entry.name !== bundleDir)
      await fs.rm(path.join(root, "bundles", entry.name), {
        recursive: true,
        force: true,
      });
  }
  return { status: "published", release: pointer };
}

export async function clearReleaseBundle(storageRoot) {
  const root = path.resolve(storageRoot);
  const current = await readCurrentBundle(root);
  await fs.rm(path.join(root, "current.json"), { force: true });
  if (current)
    await fs.rm(current.bundlePath, { recursive: true, force: true });
  return { status: current ? "cleared" : "already_empty" };
}

export async function openBundleFile(storageRoot, filename) {
  if (!safeDirectFileName(filename))
    throw new ReleaseBundleError("release_file_not_found", 404);
  const current = await readCurrentBundle(path.resolve(storageRoot));
  if (!current) throw new ReleaseBundleError("release_unavailable", 503);
  const metadata = current.files?.find((file) => file.filename === filename);
  if (!metadata) throw new ReleaseBundleError("release_file_not_found", 404);
  const filePath = path.join(current.bundlePath, filename);
  if (path.dirname(filePath) !== current.bundlePath)
    throw new ReleaseBundleError("release_file_not_found", 404);
  const linkStat = await fs.lstat(filePath).catch(() => null);
  if (!linkStat || !linkStat.isFile() || linkStat.isSymbolicLink())
    throw new ReleaseBundleError("release_unavailable", 503);
  const handle = await fs.open(filePath, "r");
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size !== metadata.size) {
    await handle.close();
    throw new ReleaseBundleError("release_unavailable", 503);
  }
  return { handle, metadata, current };
}

export function releaseLimits(config) {
  const limits = {
    maxFileBytes: config.MAX_DESKTOP_RELEASE_FILE_BYTES,
    maxBundleBytes: config.MAX_DESKTOP_RELEASE_BUNDLE_BYTES,
    maxFeedBytes: config.MAX_DESKTOP_RELEASE_FEED_BYTES,
    maxAssets: config.MAX_DESKTOP_RELEASE_ASSETS,
  };
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    limits.maxAssets > 1024 ||
    limits.maxFeedBytes > limits.maxFileBytes ||
    limits.maxFileBytes > limits.maxBundleBytes
  ) {
    throw new Error("invalid desktop release limits");
  }
  return Object.freeze(limits);
}
