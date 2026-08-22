import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";
import semver from "semver";

import { requireHttpRelayToken } from "../utils/relay-auth.js";
import { sendJson } from "../utils/ws.js";
import { PORTAL_CAPABILITIES } from "./portal-authorization.js";

export const HOSTED_GAME_LOGICAL_PREFIX = "games.bzgames.top/";

const GAME_ID_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9-]+)+$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const ROLES = new Set(["package", "icon", "cover"]);
const GAME_TYPES = new Set([
  "singleplayer",
  "multiplayer",
  "singlemultiple",
  "networkgame",
]);
const VISIBILITIES = new Set(["public", "hidden", "deprecated"]);
const ZIP_SIGNATURES = new Set(["504b0304", "504b0506", "504b0708"]);
const IMAGE_TYPES = [
  {
    contentType: "image/png",
    extension: "png",
    matches: (header) =>
      header.length >= 8 &&
      header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  {
    contentType: "image/jpeg",
    extension: "jpg",
    matches: (header) =>
      header.length >= 3 && header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  },
  {
    contentType: "image/webp",
    extension: "webp",
    matches: (header) =>
      header.length >= 12 &&
      header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

class GameHostingError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, code) {
  if (!isPlainObject(value)) throw new GameHostingError(code);
  return value;
}

function assertKnownKeys(value, allowed, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new GameHostingError(code);
  }
}

function requiredString(value, min, max, code) {
  if (typeof value !== "string") throw new GameHostingError(code);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length < min || normalized.length > max) {
    throw new GameHostingError(code);
  }
  return normalized;
}

function optionalString(value, max, code) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new GameHostingError(code);
  const normalized = value.trim().normalize("NFC");
  if (!normalized || normalized.length > max) throw new GameHostingError(code);
  return normalized;
}

function optionalBoolean(value, code) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new GameHostingError(code);
  return value;
}

function optionalPositiveInteger(value, code) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new GameHostingError(code);
  return value;
}

function httpUrl(value, code) {
  const normalized = requiredString(value, 1, 2048, code);
  if (!HTTP_URL_PATTERN.test(normalized)) throw new GameHostingError(code);
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new GameHostingError(code);
  }
  return normalized;
}

function optionalHttpOrHostedUrl(value, role, code) {
  if (value === undefined) return undefined;
  const normalized = requiredString(value, 1, 2048, code);
  if (HTTP_URL_PATTERN.test(normalized)) return httpUrl(normalized, code);
  const parsed = parseLogicalUrl(normalized);
  if (!parsed || parsed.role !== role) throw new GameHostingError(code);
  return normalized;
}

function safeManifestPath(value, code) {
  const normalized = requiredString(value, 1, 500, code);
  if (
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
  ) {
    throw new GameHostingError(code);
  }
  return normalized;
}

function validatePlatformVersion(value, code, allowTuple = false) {
  if (typeof value === "string") {
    const range = requiredString(value, 1, 200, code);
    if (semver.validRange(range) === null) throw new GameHostingError(code);
    return range;
  }
  if (
    allowTuple &&
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === "string" && SEMVER_PATTERN.test(item))
  ) {
    if (semver.gt(value[0], value[1])) throw new GameHostingError(code);
    return [...value];
  }
  throw new GameHostingError(code);
}

function validateStringArray(value, maxItems, maxLength, code) {
  if (!Array.isArray(value) || value.length > maxItems) throw new GameHostingError(code);
  return value.map((item) => requiredString(item, 1, maxLength, code));
}

function validateManifest(raw) {
  if (raw === undefined) return undefined;
  const value = assertObject(raw, "invalid_game_manifest");
  assertKnownKeys(
    value,
    new Set([
      "name", "description", "author", "author_url", "platformVersion", "entry",
      "web_url", "icon", "cover", "video", "encryptLocalStorage", "type",
      "statistics", "multiplayer", "args", "env", "windowedFullscreen", "achievements",
    ]),
    "invalid_game_manifest",
  );
  const result = {};
  if (value.name !== undefined) result.name = requiredString(value.name, 1, 100, "invalid_game_manifest");
  if (value.description !== undefined) result.description = optionalString(value.description, 500, "invalid_game_manifest");
  if (value.author !== undefined) result.author = requiredString(value.author, 1, 100, "invalid_game_manifest");
  if (value.author_url !== undefined) result.author_url = httpUrl(value.author_url, "invalid_game_manifest");
  if (value.platformVersion !== undefined) result.platformVersion = validatePlatformVersion(value.platformVersion, "invalid_game_manifest", true);
  if (value.entry !== undefined) {
    result.entry = ["url", "serve"].includes(value.entry)
      ? value.entry
      : safeManifestPath(value.entry, "invalid_game_manifest");
  }
  if (value.web_url !== undefined) result.web_url = httpUrl(value.web_url, "invalid_game_manifest");
  for (const key of ["icon", "cover", "video"]) {
    if (value[key] !== undefined) result[key] = safeManifestPath(value[key], "invalid_game_manifest");
  }
  if (value.encryptLocalStorage !== undefined) result.encryptLocalStorage = optionalBoolean(value.encryptLocalStorage, "invalid_game_manifest");
  if (value.windowedFullscreen !== undefined) result.windowedFullscreen = optionalBoolean(value.windowedFullscreen, "invalid_game_manifest");
  if (value.type !== undefined) {
    if (!GAME_TYPES.has(value.type)) throw new GameHostingError("invalid_game_manifest");
    result.type = value.type;
  }
  if (value.multiplayer !== undefined) {
    const multiplayer = assertObject(value.multiplayer, "invalid_game_manifest");
    assertKnownKeys(multiplayer, new Set(["minPlayers", "maxPlayers"]), "invalid_game_manifest");
    const minPlayers = optionalPositiveInteger(multiplayer.minPlayers, "invalid_game_manifest");
    const maxPlayers = optionalPositiveInteger(multiplayer.maxPlayers, "invalid_game_manifest");
    if (!minPlayers || !maxPlayers || minPlayers > maxPlayers) throw new GameHostingError("invalid_game_manifest");
    result.multiplayer = { minPlayers, maxPlayers };
  }
  if (value.args !== undefined) result.args = validateStringArray(value.args, 256, 8192, "invalid_game_manifest");
  if (value.env !== undefined) {
    const env = assertObject(value.env, "invalid_game_manifest");
    const normalized = {};
    for (const [key, item] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.toUpperCase().startsWith("BZ_") || ["__proto__", "prototype", "constructor"].includes(key.toLowerCase())) {
        throw new GameHostingError("invalid_game_manifest");
      }
      if (typeof item !== "string" || item.length > 32768) throw new GameHostingError("invalid_game_manifest");
      normalized[key] = item;
    }
    result.env = normalized;
  }
  if (value.entry !== undefined) {
    const entry = value.entry.toLowerCase();
    const isWebEntry = entry === "serve" || entry === "url" || entry.endsWith(".html") || entry.endsWith(".htm");
    if (isWebEntry && value.args !== undefined && value.args.length > 0) throw new GameHostingError("invalid_game_manifest");
    if (isWebEntry && value.env !== undefined && Object.keys(value.env).length > 0) throw new GameHostingError("invalid_game_manifest");
    if (!isWebEntry && value.windowedFullscreen !== undefined) throw new GameHostingError("invalid_game_manifest");
  }
  if (value.statistics !== undefined) {
    if (!Array.isArray(value.statistics) || value.statistics.length > 1000) throw new GameHostingError("invalid_game_manifest");
    result.statistics = value.statistics.map((item) => {
      if (typeof item === "string") return requiredString(item, 1, 200, "invalid_game_manifest");
      const record = assertObject(item, "invalid_game_manifest");
      if (Object.keys(record).length !== 1) throw new GameHostingError("invalid_game_manifest");
      const [id, definition] = Object.entries(record)[0];
      requiredString(id, 1, 200, "invalid_game_manifest");
      if (["__proto__", "prototype", "constructor"].includes(id.toLowerCase())) throw new GameHostingError("invalid_game_manifest");
      if (typeof definition === "string") return { [id]: requiredString(definition, 1, 200, "invalid_game_manifest") };
      const details = assertObject(definition, "invalid_game_manifest");
      assertKnownKeys(details, new Set(["label", "mode"]), "invalid_game_manifest");
      const normalized = { label: requiredString(details.label, 1, 200, "invalid_game_manifest") };
      if (details.mode !== undefined) {
        if (!["increment", "full"].includes(details.mode)) throw new GameHostingError("invalid_game_manifest");
        normalized.mode = details.mode;
      }
      return { [id]: normalized };
    });
  }
  if (value.achievements !== undefined) {
    if (!Array.isArray(value.achievements) || value.achievements.length > 1000) throw new GameHostingError("invalid_game_manifest");
    const ids = new Set();
    result.achievements = value.achievements.map((item) => {
      const achievement = assertObject(item, "invalid_game_manifest");
      assertKnownKeys(achievement, new Set(["id", "title", "description", "icon"]), "invalid_game_manifest");
      const normalized = {
        id: requiredString(achievement.id, 1, 200, "invalid_game_manifest"),
        title: requiredString(achievement.title, 1, 200, "invalid_game_manifest"),
        description: typeof achievement.description === "string" && achievement.description.length <= 1000 ? achievement.description : (() => { throw new GameHostingError("invalid_game_manifest"); })(),
      };
      if (ids.has(normalized.id)) throw new GameHostingError("invalid_game_manifest");
      ids.add(normalized.id);
      if (achievement.icon !== undefined) normalized.icon = safeManifestPath(achievement.icon, "invalid_game_manifest");
      return normalized;
    });
  }
  return result;
}

function validateGameMetadata(raw, expectedId) {
  const value = assertObject(raw, "invalid_game_metadata");
  assertKnownKeys(value, new Set([
    "id", "name", "author", "author_url", "type", "summary", "tags", "iconUrl",
    "coverUrl", "screenshots", "featured", "visibility", "minPlayers", "maxPlayers",
  ]), "invalid_game_metadata");
  const id = requiredString(value.id, 3, 200, "invalid_game_id");
  if (!GAME_ID_PATTERN.test(id) || (expectedId && id !== expectedId)) throw new GameHostingError("invalid_game_id");
  if (!GAME_TYPES.has(value.type)) throw new GameHostingError("invalid_game_metadata");
  const result = {
    id,
    name: requiredString(value.name, 1, 100, "invalid_game_metadata"),
    author: requiredString(value.author, 1, 100, "invalid_game_metadata"),
    type: value.type,
    summary: requiredString(value.summary, 1, 200, "invalid_game_metadata"),
  };
  if (value.author_url !== undefined) result.author_url = httpUrl(value.author_url, "invalid_game_metadata");
  if (value.tags !== undefined) result.tags = validateStringArray(value.tags, 100, 100, "invalid_game_metadata");
  if (value.iconUrl !== undefined) result.iconUrl = optionalHttpOrHostedUrl(value.iconUrl, "icon", "invalid_game_metadata");
  if (value.coverUrl !== undefined) result.coverUrl = optionalHttpOrHostedUrl(value.coverUrl, "cover", "invalid_game_metadata");
  if (value.screenshots !== undefined) result.screenshots = validateStringArray(value.screenshots, 100, 2048, "invalid_game_metadata").map((item) => httpUrl(item, "invalid_game_metadata"));
  if (value.featured !== undefined) result.featured = optionalBoolean(value.featured, "invalid_game_metadata");
  if (value.visibility !== undefined) {
    if (!VISIBILITIES.has(value.visibility)) throw new GameHostingError("invalid_game_metadata");
    result.visibility = value.visibility;
  }
  if (value.minPlayers !== undefined) result.minPlayers = optionalPositiveInteger(value.minPlayers, "invalid_game_metadata");
  if (value.maxPlayers !== undefined) result.maxPlayers = optionalPositiveInteger(value.maxPlayers, "invalid_game_metadata");
  if (result.minPlayers && result.maxPlayers && result.minPlayers > result.maxPlayers) throw new GameHostingError("invalid_game_metadata");
  return result;
}

function validateVersionMetadata(raw) {
  const value = assertObject(raw, "invalid_game_version_metadata");
  assertKnownKeys(value, new Set([
    "version", "description", "platformVersion", "publishedAt", "releaseNotes",
    "isPrerelease", "gameManifest",
  ]), "invalid_game_version_metadata");
  const version = requiredString(value.version, 1, 100, "invalid_game_version");
  if (!SEMVER_PATTERN.test(version)) throw new GameHostingError("invalid_game_version");
  const result = {
    version,
    description: requiredString(value.description, 1, 2000, "invalid_game_version_metadata"),
    platformVersion: validatePlatformVersion(value.platformVersion, "invalid_game_version_metadata"),
  };
  if (value.publishedAt !== undefined) {
    const publishedAt = requiredString(value.publishedAt, 1, 64, "invalid_game_version_metadata");
    if (!Number.isFinite(Date.parse(publishedAt))) throw new GameHostingError("invalid_game_version_metadata");
    result.publishedAt = new Date(publishedAt).toISOString();
  }
  if (value.releaseNotes !== undefined) result.releaseNotes = optionalString(value.releaseNotes, 20000, "invalid_game_version_metadata");
  if (value.isPrerelease !== undefined) result.isPrerelease = optionalBoolean(value.isPrerelease, "invalid_game_version_metadata");
  if (value.gameManifest !== undefined) result.gameManifest = validateManifest(value.gameManifest);
  return result;
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new GameHostingError(code);
  }
}

function parseDatabaseJson(value) {
  if (isPlainObject(value)) return value;
  return JSON.parse(String(value));
}

function safeFileName(value, role) {
  if (typeof value !== "string") throw new GameHostingError("invalid_asset_name");
  const name = value.normalize("NFC").trim();
  if (
    !name ||
    name.length > 255 ||
    Buffer.byteLength(name, "utf8") > 765 ||
    name !== path.basename(name) ||
    /[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new GameHostingError("invalid_asset_name");
  }
  if (role === "package" && path.extname(name).toLowerCase() !== ".zip") {
    throw new GameHostingError("invalid_game_archive_name");
  }
  return name;
}

function detectAssetType(role, header) {
  if (role === "package") {
    if (!ZIP_SIGNATURES.has(header.subarray(0, 4).toString("hex"))) throw new GameHostingError("invalid_zip_archive");
    return { contentType: "application/zip", extension: "zip" };
  }
  const detected = IMAGE_TYPES.find((item) => item.matches(header));
  if (!detected) throw new GameHostingError("invalid_hosted_image");
  return { contentType: detected.contentType, extension: detected.extension };
}

function encodeSegment(value) {
  return encodeURIComponent(value);
}

function decodeCanonicalSegment(value) {
  try {
    const decoded = decodeURIComponent(value).normalize("NFC");
    return decoded && encodeURIComponent(decoded) === value ? decoded : "";
  } catch {
    return "";
  }
}

function toLogicalUrl(gameId, version, role, fileName) {
  return `${HOSTED_GAME_LOGICAL_PREFIX}${encodeSegment(gameId)}/${encodeSegment(version)}/${role}/${encodeSegment(fileName)}`;
}

export function parseLogicalUrl(value) {
  if (typeof value !== "string" || !value.startsWith(HOSTED_GAME_LOGICAL_PREFIX)) return null;
  const parts = value.slice(HOSTED_GAME_LOGICAL_PREFIX.length).split("/");
  if (parts.length !== 4) return null;
  const gameId = decodeCanonicalSegment(parts[0]);
  const version = decodeCanonicalSegment(parts[1]);
  const role = parts[2];
  const fileName = decodeCanonicalSegment(parts[3]);
  if (!GAME_ID_PATTERN.test(gameId) || !SEMVER_PATTERN.test(version) || !ROLES.has(role) || !fileName) return null;
  try {
    safeFileName(fileName, role);
  } catch {
    return null;
  }
  return { gameId, version, role, fileName };
}

function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return { start, end: Math.min(end, size - 1) };
}

async function directoryUsage(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directoryUsage(target);
    else if (entry.isFile()) total += (await fs.stat(target)).size;
  }
  return total;
}

function readJson(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new GameHostingError("request_too_large", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.once("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new GameHostingError("invalid_json"));
      }
    });
    req.once("error", reject);
    req.once("aborted", () => reject(new GameHostingError("request_aborted")));
  });
}

async function parseMultipartUpload(req, tempDir, limits, requireGame, requirePackage = true) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new GameHostingError("multipart_required", 415);
  const maxBody = limits.package + limits.image * 2 + 2 * 1024 * 1024;
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBody) throw new GameHostingError("request_too_large", 413);
  await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      defParamCharset: "utf8",
      // Busboy emits partsLimit when it reaches the sentinel part after the
      // configured count, so reserve one slot beyond the six accepted parts.
      limits: { fileSize: limits.package + 1, files: 3, fields: 3, parts: 7, fieldSize: 1024 * 1024 },
    });
  } catch {
    throw new GameHostingError("invalid_multipart");
  }
  const fields = {};
  const assets = new Map();
  const promises = [];
  let parseError = null;
  const fail = (error) => {
    parseError ||= error instanceof GameHostingError ? error : new GameHostingError("invalid_multipart");
  };
  busboy.on("field", (name, value, info) => {
    if (info.nameTruncated || info.valueTruncated || !["game", "version", "setLatest"].includes(name) || fields[name] !== undefined) {
      fail(new GameHostingError("invalid_upload_fields"));
      return;
    }
    fields[name] = value;
  });
  busboy.on("file", (role, stream, info) => {
    if (!ROLES.has(role) || assets.has(role)) {
      fail(new GameHostingError("invalid_asset_count"));
      stream.resume();
      return;
    }
    let originalName;
    try {
      originalName = safeFileName(info.filename, role);
    } catch (error) {
      fail(error);
      stream.resume();
      return;
    }
    const maxBytes = role === "package" ? limits.package : limits.image;
    let size = 0;
    let header = Buffer.alloc(0);
    const hash = crypto.createHash("sha256");
    const tempPath = path.join(tempDir, `${role}.upload`);
    stream.once("limit", () => fail(new GameHostingError(role === "package" ? "game_archive_too_large" : "hosted_image_too_large", 413)));
    const inspector = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) return callback(new GameHostingError(role === "package" ? "game_archive_too_large" : "hosted_image_too_large", 413));
        if (header.length < 16) header = Buffer.concat([header, chunk.subarray(0, 16 - header.length)]);
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const asset = { role, originalName, tempPath, size: 0, sha256: "", contentType: "", storageName: "" };
    assets.set(role, asset);
    promises.push(
      pipeline(stream, inspector, createWriteStream(tempPath, { flags: "wx", mode: 0o600 }))
        .then(() => {
          if (size === 0) throw new GameHostingError("empty_hosted_asset");
          const detected = detectAssetType(role, header);
          Object.assign(asset, {
            size,
            sha256: hash.digest("hex"),
            contentType: detected.contentType,
            storageName: `${role}.${detected.extension}`,
          });
        })
        .catch(fail),
    );
  });
  busboy.on("filesLimit", () => fail(new GameHostingError("invalid_asset_count")));
  busboy.on("fieldsLimit", () => fail(new GameHostingError("invalid_upload_fields")));
  busboy.on("partsLimit", () => fail(new GameHostingError("invalid_multipart")));
  await new Promise((resolve, reject) => {
    busboy.once("close", resolve);
    busboy.once("error", reject);
    req.once("aborted", () => reject(new GameHostingError("upload_aborted")));
    req.pipe(busboy);
  }).catch(fail);
  await Promise.all(promises);
  if (parseError) throw parseError;
  if (requirePackage && !assets.has("package")) throw new GameHostingError("game_archive_required");
  if (typeof fields.version !== "string") throw new GameHostingError("invalid_game_version_metadata");
  if (requireGame && typeof fields.game !== "string") throw new GameHostingError("invalid_game_metadata");
  const game = requireGame ? validateGameMetadata(parseJson(fields.game, "invalid_game_metadata")) : null;
  const version = validateVersionMetadata(parseJson(fields.version, "invalid_game_version_metadata"));
  const setLatest = fields.setLatest === undefined ? true : fields.setLatest === "true";
  if (fields.setLatest !== undefined && !["true", "false"].includes(fields.setLatest)) throw new GameHostingError("invalid_upload_fields");
  if (assets.has("icon") && game?.iconUrl) throw new GameHostingError("duplicate_icon_source");
  if (assets.has("cover") && game?.coverUrl) throw new GameHostingError("duplicate_cover_source");
  return { game, version, setLatest, assets: [...assets.values()] };
}

function compareSemverDescending(left, right) {
  const parse = (value) => {
    const match = SEMVER_PATTERN.exec(value);
    return { core: match.slice(1, 4).map(Number), pre: match[4]?.split(".") || [] };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return b.core[index] - a.core[index];
  }
  if (!a.pre.length && b.pre.length) return -1;
  if (a.pre.length && !b.pre.length) return 1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    if (a.pre[index] === undefined) return -1;
    if (b.pre[index] === undefined) return 1;
    const an = /^\d+$/.test(a.pre[index]);
    const bn = /^\d+$/.test(b.pre[index]);
    if (an && bn && Number(a.pre[index]) !== Number(b.pre[index])) return Number(b.pre[index]) - Number(a.pre[index]);
    if (an !== bn) return an ? -1 : 1;
    const result = b.pre[index].localeCompare(a.pre[index]);
    if (result) return result;
  }
  return 0;
}

function serializeAsset(row, gameId, version) {
  return {
    id: row.id,
    role: row.role,
    fileName: row.original_name,
    contentType: row.content_type,
    size: Number(row.size),
    sha256: row.sha256,
    createdAt: row.created_at,
    logicalUrl: toLogicalUrl(gameId, version, row.role, row.original_name),
  };
}

export function createGameHostingService({ config, mySqlService, accessControlService }) {
  const canManageAll = (auth) => auth.can(PORTAL_CAPABILITIES.HOSTING_ALL_MANAGE);
  const canPublishDirectly = (auth) => auth.can(PORTAL_CAPABILITIES.HOSTING_PUBLISH_DIRECT);
  const canManageOwnedResource = (auth, ownerUserId) =>
    canManageAll(auth) ||
    (auth.can(PORTAL_CAPABILITIES.HOSTING_OWN_MANAGE) &&
      String(ownerUserId) === String(auth.user.id));
  if (
    !Number.isSafeInteger(config.MAX_GAME_HOSTING_FILE_BYTES) || config.MAX_GAME_HOSTING_FILE_BYTES <= 0 ||
    !Number.isSafeInteger(config.MAX_GAME_HOSTING_IMAGE_BYTES) || config.MAX_GAME_HOSTING_IMAGE_BYTES <= 0 ||
    config.MAX_GAME_HOSTING_IMAGE_BYTES > config.MAX_GAME_HOSTING_FILE_BYTES ||
    !Number.isSafeInteger(config.MAX_GAME_HOSTING_TOTAL_BYTES) || config.MAX_GAME_HOSTING_TOTAL_BYTES < config.MAX_GAME_HOSTING_FILE_BYTES
  ) throw new Error("invalid_game_hosting_limits");

  const root = path.resolve(config.GAME_HOSTING_STORAGE_DIR);
  const filesDir = path.join(root, "files");
  const tempRoot = path.join(root, "tmp");
  let storageLock = Promise.resolve();

  function withStorageLock(callback) {
    const next = storageLock.then(callback, callback);
    storageLock = next.catch(() => {});
    return next;
  }

  async function ensureStorage() {
    await fs.mkdir(filesDir, { recursive: true, mode: 0o750 });
    await fs.mkdir(tempRoot, { recursive: true, mode: 0o700 });
  }

  function versionDirectory(gameId, version) {
    if (!GAME_ID_PATTERN.test(gameId) || !SEMVER_PATTERN.test(version)) throw new GameHostingError("invalid_storage_path", 500);
    const target = path.resolve(filesDir, gameId, version);
    if (!target.startsWith(`${filesDir}${path.sep}`)) throw new GameHostingError("invalid_storage_path", 500);
    return target;
  }

  function assertCreatorImageReferences(metadata, publishedMetadata = null) {
    for (const role of ['icon', 'cover']) {
      const value = metadata?.[`${role}Url`];
      if (!value || !parseLogicalUrl(value)) continue;
      if (value !== publishedMetadata?.[`${role}Url`]) throw new GameHostingError("invalid_game_metadata");
    }
  }

  async function installVersionFiles(parsed, gameId, version, finalDirectory) {
    for (const asset of parsed.assets) {
      await fs.rename(asset.tempPath, path.join(path.dirname(asset.tempPath), asset.storageName));
      asset.tempPath = path.join(path.dirname(asset.tempPath), asset.storageName);
    }
    await fs.mkdir(path.dirname(finalDirectory), { recursive: true, mode: 0o750 });
    await fs.rename(path.dirname(parsed.assets[0].tempPath), finalDirectory);
    await fs.chmod(finalDirectory, 0o750);
  }

  async function createVersion(req, res, gameIdFromRoute) {
    const auth = gameIdFromRoute
      ? await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VERSION_CREATE, { requireOrigin: true })
      : await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_GAME_CREATE, { requireOrigin: true });
    if (!auth) { req.resume(); return; }
    const publishDirectly = canPublishDirectly(auth);
    await ensureStorage();
    const requestId = crypto.randomUUID();
    const tempDir = path.join(tempRoot, requestId);
    let finalDirectory = "";
    try {
      const parsed = await parseMultipartUpload(req, tempDir, {
        package: config.MAX_GAME_HOSTING_FILE_BYTES,
        image: config.MAX_GAME_HOSTING_IMAGE_BYTES,
      }, !gameIdFromRoute);
      const gameId = gameIdFromRoute || parsed.game.id;
      if (gameIdFromRoute && (!GAME_ID_PATTERN.test(gameIdFromRoute) || parsed.game)) throw new GameHostingError("invalid_game_id");
      finalDirectory = versionDirectory(gameId, parsed.version.version);
      const totalBytes = parsed.assets.reduce((sum, asset) => sum + asset.size, 0);
      await withStorageLock(async () => {
        const [gameRows] = await mySqlService.query("SELECT game_id, published_metadata_json, latest_version, owner_user_id FROM hosted_games WHERE game_id = ? LIMIT 1", [gameId]);
        if (!gameIdFromRoute && gameRows[0]) throw new GameHostingError("hosted_game_exists", 409);
        if (gameIdFromRoute && !gameRows[0]) throw new GameHostingError("hosted_game_not_found", 404);
        if (gameIdFromRoute && !canManageOwnedResource(auth, gameRows[0].owner_user_id)) throw new GameHostingError("forbidden", 403);
        const [versionRows] = await mySqlService.query("SELECT id FROM hosted_game_versions WHERE game_id = ? AND version = ? LIMIT 1", [gameId, parsed.version.version]);
        if (versionRows[0]) throw new GameHostingError("hosted_game_version_exists", 409);
        const [versionCountRows] = await mySqlService.query(
          "SELECT COUNT(*) AS total FROM hosted_game_versions WHERE game_id = ?",
          [gameId],
        );
        if (
          Number(versionCountRows[0]?.total || 0) > 0 &&
          parsed.assets.some((asset) => asset.role === "icon" || asset.role === "cover")
        ) {
          throw new GameHostingError("hosted_version_images_require_unique");
        }
        if ((await directoryUsage(filesDir)) + totalBytes > config.MAX_GAME_HOSTING_TOTAL_BYTES) throw new GameHostingError("game_hosting_capacity_exceeded", 507);
        try { await fs.access(finalDirectory); throw new GameHostingError("hosted_game_version_exists", 409); } catch (error) { if (error?.code !== "ENOENT") throw error; }

        const versionId = crypto.randomUUID();
        let gameMetadata = parsed.game || (gameRows[0].published_metadata_json ? parseDatabaseJson(gameRows[0].published_metadata_json) : null);
        if (!publishDirectly && parsed.game) assertCreatorImageReferences(parsed.game);
        if (publishDirectly && gameMetadata) for (const asset of parsed.assets) {
          if (asset.role === "icon") gameMetadata = { ...gameMetadata, iconUrl: toLogicalUrl(gameId, parsed.version.version, asset.role, asset.originalName) };
          if (asset.role === "cover") gameMetadata = { ...gameMetadata, coverUrl: toLogicalUrl(gameId, parsed.version.version, asset.role, asset.originalName) };
        }
        await installVersionFiles(parsed, gameId, parsed.version.version, finalDirectory);
        const now = new Date();
        try {
          await mySqlService.transaction(async (connection) => {
            let initialRevisionId = null;
            if (!gameIdFromRoute) {
              await connection.query(
                `INSERT INTO hosted_games
                  (game_id, published_metadata_json, latest_version, owner_user_id, owner_github_login,
                   updated_by_user_id, updated_by_github_login, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [gameId, publishDirectly ? JSON.stringify(gameMetadata) : null, publishDirectly ? parsed.version.version : null,
                 auth.user.id, auth.user.login || "", auth.user.id, auth.user.login || "", now, now],
              );
              if (!publishDirectly) {
                initialRevisionId = crypto.randomUUID();
                await connection.query(
                  `INSERT INTO hosted_game_metadata_revisions
                    (id, game_id, metadata_json, status, review_reason, submitter_user_id,
                     submitter_github_login, reviewer_user_id, reviewer_github_login,
                     reviewed_at, created_at, updated_at)
                   VALUES (?, ?, ?, 'pending', '', ?, ?, NULL, '', NULL, ?, ?)`,
                  [initialRevisionId, gameId, JSON.stringify(parsed.game), auth.user.id, auth.user.login || "", now, now],
                );
              }
            } else if (publishDirectly) {
              const latestVersion = parsed.setLatest ? parsed.version.version : gameRows[0].latest_version;
              await connection.query(
                `UPDATE hosted_games SET published_metadata_json = ?, latest_version = ?, updated_by_user_id = ?,
                 updated_by_github_login = ?, updated_at = ? WHERE game_id = ?`,
                [JSON.stringify(gameMetadata), latestVersion, auth.user.id, auth.user.login || "", now, gameId],
              );
            }
            await connection.query(
              `INSERT INTO hosted_game_versions
                (id, game_id, version, metadata_json, status, initial_revision_id, review_reason,
                 uploader_user_id, uploader_github_login, reviewer_user_id,
                 reviewer_github_login, reviewed_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
              [versionId, gameId, parsed.version.version, JSON.stringify(parsed.version), publishDirectly ? "approved" : "pending",
               initialRevisionId, auth.user.id, auth.user.login || "", publishDirectly ? auth.user.id : null,
               publishDirectly ? auth.user.login || "" : "", publishDirectly ? now : null, now, now],
            );
            for (const asset of parsed.assets) {
              await connection.query(
                `INSERT INTO hosted_game_assets
                  (id, version_id, role, original_name, storage_name, content_type, size, sha256, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), versionId, asset.role, asset.originalName, asset.storageName, asset.contentType, asset.size, asset.sha256, now],
              );
            }
          });
        } catch (error) {
          await fs.rm(finalDirectory, { recursive: true, force: true });
          try { await fs.rmdir(path.dirname(finalDirectory)); } catch {}
          if (error?.code === "ER_DUP_ENTRY") throw new GameHostingError("hosted_game_version_exists", 409);
          throw error;
        }
      });
      sendJson(res, 201, {
        ok: true,
        status: publishDirectly ? "approved" : "pending",
        gameId,
        version: parsed.version.version,
        ...(publishDirectly ? { game: await buildGameConfig(gameId) } : {}),
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async function replaceVersion(req, res, gameId, version) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW, { requireOrigin: true });
    if (!auth) { req.resume(); return; }
    const publishDirectly = canPublishDirectly(auth);
    if (!GAME_ID_PATTERN.test(gameId) || !SEMVER_PATTERN.test(version)) throw new GameHostingError("hosted_game_version_not_found", 404);
    await ensureStorage();
    const tempDir = path.join(tempRoot, crypto.randomUUID());
    const finalDirectory = versionDirectory(gameId, version);
    const quarantine = path.join(tempRoot, `${crypto.randomUUID()}.replacing`);
    let moved = false;
    try {
      const parsed = await parseMultipartUpload(req, tempDir, {
        package: config.MAX_GAME_HOSTING_FILE_BYTES,
        image: config.MAX_GAME_HOSTING_IMAGE_BYTES,
      }, false, false);
      if (parsed.version.version !== version) throw new GameHostingError("invalid_game_version");
      await withStorageLock(async () => {
        const [rows] = await mySqlService.query(
          `SELECT v.id, v.status, v.initial_revision_id, g.owner_user_id, g.published_metadata_json
           FROM hosted_game_versions v JOIN hosted_games g ON g.game_id = v.game_id
           WHERE v.game_id = ? AND v.version = ? LIMIT 1`, [gameId, version],
        );
        const existing = rows[0];
        if (!existing) throw new GameHostingError("hosted_game_version_not_found", 404);
        if (!canManageOwnedResource(auth, existing.owner_user_id)) throw new GameHostingError("forbidden", 403);
        if (!canManageAll(auth)) {
          if (!['pending', 'rejected'].includes(existing.status)) throw new GameHostingError("approved_submission_read_only", 409);
        }
        const [versionCountRows] = await mySqlService.query(
          "SELECT COUNT(*) AS total FROM hosted_game_versions WHERE game_id = ?",
          [gameId],
        );
        if (
          Number(versionCountRows[0]?.total || 0) !== 1 &&
          parsed.assets.some((asset) => asset.role === "icon" || asset.role === "cover")
        ) {
          throw new GameHostingError("hosted_version_images_require_unique");
        }
        const [oldAssets] = await mySqlService.query(
          "SELECT role, size FROM hosted_game_assets WHERE version_id = ?", [existing.id],
        );
        const replacedRoles = new Set(parsed.assets.map((asset) => asset.role));
        const removedBytes = oldAssets.filter((asset) => replacedRoles.has(asset.role)).reduce((sum, asset) => sum + Number(asset.size), 0);
        const addedBytes = parsed.assets.reduce((sum, asset) => sum + asset.size, 0);
        if ((await directoryUsage(filesDir)) - removedBytes + addedBytes > config.MAX_GAME_HOSTING_TOTAL_BYTES) throw new GameHostingError("game_hosting_capacity_exceeded", 507);

        await fs.rename(finalDirectory, quarantine);
        moved = true;
        await fs.cp(quarantine, finalDirectory, { recursive: true, force: false });
        for (const asset of parsed.assets) {
          for (const fileName of await fs.readdir(finalDirectory)) {
            if (fileName.startsWith(`${asset.role}.`)) await fs.rm(path.join(finalDirectory, fileName), { force: true });
          }
          const stagedName = path.join(tempDir, asset.storageName);
          await fs.rename(asset.tempPath, stagedName);
          asset.tempPath = stagedName;
          await fs.rename(stagedName, path.join(finalDirectory, asset.storageName));
        }
        const now = new Date();
        try {
          await mySqlService.transaction(async (connection) => {
            await connection.query(
              `UPDATE hosted_game_versions SET metadata_json = ?, status = ?, review_reason = '',
                 reviewer_user_id = NULL, reviewer_github_login = '', reviewed_at = NULL, updated_at = ?
               WHERE id = ?`,
              [JSON.stringify(parsed.version), publishDirectly ? existing.status : 'pending', now, existing.id],
            );
            if (!publishDirectly && existing.initial_revision_id && !existing.published_metadata_json) {
              await connection.query(
                `UPDATE hosted_game_metadata_revisions SET status = 'pending', review_reason = '',
                   reviewer_user_id = NULL, reviewer_github_login = '', reviewed_at = NULL, updated_at = ?
                 WHERE id = ?`,
                [now, existing.initial_revision_id],
              );
            }
            for (const asset of parsed.assets) {
              await connection.query("DELETE FROM hosted_game_assets WHERE version_id = ? AND role = ?", [existing.id, asset.role]);
              await connection.query(
                `INSERT INTO hosted_game_assets
                  (id, version_id, role, original_name, storage_name, content_type, size, sha256, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), existing.id, asset.role, asset.originalName, asset.storageName,
                 asset.contentType, asset.size, asset.sha256, now],
              );
            }
            if (publishDirectly && existing.status === 'approved' && existing.published_metadata_json) {
              const metadata = parseDatabaseJson(existing.published_metadata_json);
              for (const asset of parsed.assets) if (asset.role === 'icon' || asset.role === 'cover') {
                metadata[`${asset.role}Url`] = toLogicalUrl(gameId, version, asset.role, asset.originalName);
              }
              await connection.query(
                `UPDATE hosted_games SET published_metadata_json = ?, updated_by_user_id = ?,
                   updated_by_github_login = ?, updated_at = ? WHERE game_id = ?`,
                [JSON.stringify(metadata), auth.user.id, auth.user.login || '', now, gameId],
              );
            }
          });
        } catch (error) {
          await fs.rm(finalDirectory, { recursive: true, force: true });
          await fs.rename(quarantine, finalDirectory);
          moved = false;
          throw error;
        }
        await fs.rm(quarantine, { recursive: true, force: true });
        moved = false;
      });
      sendJson(res, 200, { ok: true, status: publishDirectly ? undefined : 'pending' });
    } finally {
      if (moved) {
        await fs.rm(finalDirectory, { recursive: true, force: true }).catch(() => {});
        await fs.rename(quarantine, finalDirectory).catch(() => {});
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async function buildGameConfig(gameId) {
    const [games] = await mySqlService.query("SELECT game_id, published_metadata_json, latest_version FROM hosted_games WHERE game_id = ? LIMIT 1", [gameId]);
    if (!games[0]) throw new GameHostingError("hosted_game_not_found", 404);
    if (!games[0].published_metadata_json) throw new GameHostingError("hosted_game_has_no_approved_versions", 409);
    const [rows] = await mySqlService.query(
      `SELECT v.id, v.version, v.metadata_json, v.status,
              a.id AS asset_id, a.role, a.original_name, a.storage_name,
              a.content_type, a.size, a.sha256, a.created_at
       FROM hosted_game_versions v
       LEFT JOIN hosted_game_assets a ON a.version_id = v.id
       WHERE v.game_id = ? AND v.status = 'approved'
       ORDER BY v.created_at DESC`,
      [gameId],
    );
    const versions = new Map();
    for (const row of rows) {
      if (!versions.has(row.id)) versions.set(row.id, { metadata: parseDatabaseJson(row.metadata_json), assets: [] });
      if (row.asset_id) versions.get(row.id).assets.push(row);
    }
    const exportedVersions = [];
    for (const { metadata, assets } of versions.values()) {
      const packageAsset = assets.find((asset) => asset.role === "package");
      if (!packageAsset) continue;
      exportedVersions.push({
        ...metadata,
        downloadUrl: toLogicalUrl(gameId, metadata.version, "package", packageAsset.original_name),
        sha256: packageAsset.sha256,
        size: Number(packageAsset.size),
      });
    }
    exportedVersions.sort((a, b) => compareSemverDescending(a.version, b.version));
    if (!exportedVersions.length) throw new GameHostingError("hosted_game_has_no_approved_versions", 409);
    const configuredLatest = exportedVersions.some((item) => item.version === games[0].latest_version)
      ? games[0].latest_version
      : exportedVersions[0].version;
    return { ...parseDatabaseJson(games[0].published_metadata_json), latestVersion: configuredLatest, versions: exportedVersions };
  }

  async function handleTree(req, res, url) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW);
    if (!auth) return;
    const page = Number(url.searchParams.get("page") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 20);
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new GameHostingError("invalid_pagination");
    const query = String(url.searchParams.get("q") || "").trim().slice(0, 200);
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const clauses = [];
    const params = [];
    if (!canManageAll(auth)) { clauses.push("g.owner_user_id = ?"); params.push(auth.user.id); }
    if (query) {
      clauses.push(`(g.game_id LIKE ? ESCAPE '\\\\' OR g.owner_github_login LIKE ? ESCAPE '\\\\'
        OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(g.published_metadata_json, '$.name')), '') LIKE ? ESCAPE '\\\\'
        OR EXISTS (SELECT 1 FROM hosted_game_metadata_revisions sr WHERE sr.game_id = g.game_id
                   AND JSON_UNQUOTE(JSON_EXTRACT(sr.metadata_json, '$.name')) LIKE ? ESCAPE '\\\\')
        OR EXISTS (SELECT 1 FROM hosted_game_versions sv LEFT JOIN hosted_game_assets sa ON sa.version_id = sv.id
                   WHERE sv.game_id = g.game_id AND (sv.version LIKE ? ESCAPE '\\\\' OR sa.original_name LIKE ? ESCAPE '\\\\')))`);
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [counts] = await mySqlService.query(`SELECT COUNT(*) AS total FROM hosted_games g ${where}`, params);
    const [games] = await mySqlService.query(
      `SELECT g.* FROM hosted_games g ${where} ORDER BY g.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    let rows = [];
    if (games.length) {
      const placeholders = games.map(() => "?").join(",");
      [rows] = await mySqlService.query(
        `SELECT v.id AS version_id, v.game_id, v.version, v.metadata_json, v.status,
                v.initial_revision_id, v.review_reason, v.uploader_github_login,
                v.reviewer_github_login, v.reviewed_at,
                v.created_at AS version_created_at, v.updated_at AS version_updated_at,
                a.id AS asset_id, a.role, a.original_name, a.storage_name, a.content_type,
                a.size, a.sha256, a.created_at AS asset_created_at
         FROM hosted_game_versions v LEFT JOIN hosted_game_assets a ON a.version_id = v.id
         WHERE v.game_id IN (${placeholders}) ORDER BY v.created_at DESC`,
        games.map((game) => game.game_id),
      );
    }
    const byGame = new Map(games.map((game) => [game.game_id, []]));
    const byVersion = new Map();
    for (const row of rows) {
      let version = byVersion.get(row.version_id);
      if (!version) {
        version = {
          id: row.version_id, version: row.version, metadata: parseDatabaseJson(row.metadata_json), status: row.status,
          initialRevisionId: row.initial_revision_id || null, reviewReason: row.review_reason || "",
          uploader: row.uploader_github_login || "", reviewer: row.reviewer_github_login || "",
          reviewedAt: row.reviewed_at, createdAt: row.version_created_at, updatedAt: row.version_updated_at, assets: [],
        };
        byVersion.set(row.version_id, version);
        byGame.get(row.game_id).push(version);
      }
      if (row.asset_id) version.assets.push(serializeAsset({
        id: row.asset_id, role: row.role, original_name: row.original_name, content_type: row.content_type,
        size: row.size, sha256: row.sha256, created_at: row.asset_created_at,
      }, row.game_id, row.version));
    }
    for (const versions of byGame.values()) versions.sort((a, b) => compareSemverDescending(a.version, b.version));
    let revisions = [];
    if (games.length) {
      const placeholders = games.map(() => "?").join(",");
      [revisions] = await mySqlService.query(
        `SELECT id, game_id, metadata_json, status, review_reason, submitter_github_login,
                reviewer_github_login, reviewed_at, created_at, updated_at
         FROM hosted_game_metadata_revisions WHERE game_id IN (${placeholders}) ORDER BY created_at DESC`,
        games.map((game) => game.game_id),
      );
    }
    const revisionsByGame = new Map(games.map((game) => [game.game_id, []]));
    for (const revision of revisions) revisionsByGame.get(revision.game_id).push({
      id: revision.id, metadata: parseDatabaseJson(revision.metadata_json), status: revision.status,
      reviewReason: revision.review_reason || "", submitter: revision.submitter_github_login || "",
      reviewer: revision.reviewer_github_login || "", reviewedAt: revision.reviewed_at,
      createdAt: revision.created_at, updatedAt: revision.updated_at,
    });
    const initialRevisionIds = new Set(
      [...byVersion.values()].map((version) => version.initialRevisionId).filter(Boolean),
    );
    await ensureStorage();
    const capacity = auth.can(PORTAL_CAPABILITIES.HOSTING_CAPACITY_VIEW)
      ? {
          usedBytes: await directoryUsage(filesDir),
          maxTotalBytes: config.MAX_GAME_HOSTING_TOTAL_BYTES,
        }
      : undefined;
    sendJson(res, 200, {
      games: games.map((game) => ({
        gameId: game.game_id,
        metadata: game.published_metadata_json ? parseDatabaseJson(game.published_metadata_json)
          : revisionsByGame.get(game.game_id)?.[0]?.metadata || { id: game.game_id, name: game.game_id },
        published: Boolean(game.published_metadata_json), latestVersion: game.latest_version,
        owner: game.owner_github_login || "", updater: game.updated_by_github_login || "",
        createdAt: game.created_at, updatedAt: game.updated_at,
        revisions: revisionsByGame.get(game.game_id).filter((revision) => !initialRevisionIds.has(revision.id)),
        versions: byGame.get(game.game_id),
      })),
      total: Number(counts[0]?.total || 0), page, pageSize,
      role: auth.user.role,
      ...(capacity ? { capacity } : {}),
      maxPackageBytes: config.MAX_GAME_HOSTING_FILE_BYTES,
      maxImageBytes: config.MAX_GAME_HOSTING_IMAGE_BYTES,
    });
  }

  async function updateGame(req, res, gameId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW, { requireOrigin: true });
    if (!auth) return;
    if (!GAME_ID_PATTERN.test(gameId)) throw new GameHostingError("hosted_game_not_found", 404);
    const metadata = validateGameMetadata(await readJson(req), gameId);
    const now = new Date();
    let revisionId = null;
    await mySqlService.transaction(async (connection) => {
      const [games] = await connection.query(
        "SELECT game_id, owner_user_id, published_metadata_json FROM hosted_games WHERE game_id = ? FOR UPDATE",
        [gameId],
      );
      if (!games[0]) throw new GameHostingError("hosted_game_not_found", 404);
      if (!canManageOwnedResource(auth, games[0].owner_user_id)) throw new GameHostingError("forbidden", 403);
      if (canPublishDirectly(auth)) {
        await connection.query(
          `UPDATE hosted_games SET published_metadata_json = ?, updated_by_user_id = ?,
             updated_by_github_login = ?, updated_at = ? WHERE game_id = ?`,
          [JSON.stringify(metadata), auth.user.id, auth.user.login || "", now, gameId],
        );
        return;
      }
      if (String(games[0].owner_user_id) !== String(auth.user.id)) throw new GameHostingError("forbidden", 403);
      assertCreatorImageReferences(metadata, games[0].published_metadata_json ? parseDatabaseJson(games[0].published_metadata_json) : null);
      const [existing] = await connection.query(
        `SELECT id FROM hosted_game_metadata_revisions
         WHERE game_id = ? AND status IN ('pending', 'rejected') ORDER BY created_at DESC LIMIT 1`,
        [gameId],
      );
      revisionId = existing[0]?.id || crypto.randomUUID();
      if (existing[0]) {
        await connection.query(
          `UPDATE hosted_game_metadata_revisions SET metadata_json = ?, status = 'pending',
             review_reason = '', reviewer_user_id = NULL, reviewer_github_login = '',
             reviewed_at = NULL, updated_at = ? WHERE id = ?`,
          [JSON.stringify(metadata), now, revisionId],
        );
        if (!games[0].published_metadata_json) {
          await connection.query(
            `UPDATE hosted_game_versions SET status = 'pending', review_reason = '', reviewer_user_id = NULL,
               reviewer_github_login = '', reviewed_at = NULL, updated_at = ?
             WHERE initial_revision_id = ? AND status = 'rejected'`,
            [now, revisionId],
          );
        }
      } else {
        await connection.query(
          `INSERT INTO hosted_game_metadata_revisions
            (id, game_id, metadata_json, status, review_reason, submitter_user_id,
             submitter_github_login, reviewer_user_id, reviewer_github_login,
             reviewed_at, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', '', ?, ?, NULL, '', NULL, ?, ?)`,
          [revisionId, gameId, JSON.stringify(metadata), auth.user.id, auth.user.login || "", now, now],
        );
      }
      await connection.query(
        "UPDATE hosted_games SET updated_by_user_id = ?, updated_by_github_login = ?, updated_at = ? WHERE game_id = ?",
        [auth.user.id, auth.user.login || "", now, gameId],
      );
    });
    sendJson(res, 200, { ok: true, status: canPublishDirectly(auth) ? "approved" : "pending", revisionId });
  }

  async function updateVersion(req, res, gameId, version) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW, { requireOrigin: true });
    if (!auth) return;
    if (!GAME_ID_PATTERN.test(gameId) || !SEMVER_PATTERN.test(version)) throw new GameHostingError("hosted_game_version_not_found", 404);
    const metadata = validateVersionMetadata(await readJson(req));
    if (metadata.version !== version) throw new GameHostingError("invalid_game_version");
    await mySqlService.transaction(async (connection) => {
      const now = new Date();
      const [rows] = await connection.query(
        `SELECT v.id, v.status, v.initial_revision_id, v.reviewer_user_id, v.reviewer_github_login,
                v.reviewed_at, g.owner_user_id, g.published_metadata_json FROM hosted_game_versions v
         JOIN hosted_games g ON g.game_id = v.game_id
         WHERE v.game_id = ? AND v.version = ? FOR UPDATE`,
        [gameId, version],
      );
      if (!rows[0]) throw new GameHostingError("hosted_game_version_not_found", 404);
      if (!canManageOwnedResource(auth, rows[0].owner_user_id)) throw new GameHostingError("forbidden", 403);
      if (!canManageAll(auth)) {
        if (!['pending', 'rejected'].includes(rows[0].status)) throw new GameHostingError("approved_submission_read_only", 409);
      }
      const [result] = await connection.query(
        `UPDATE hosted_game_versions SET metadata_json = ?, status = ?, review_reason = '',
           reviewer_user_id = ?, reviewer_github_login = ?, reviewed_at = ?, updated_at = ?
         WHERE game_id = ? AND version = ?`,
        [JSON.stringify(metadata), canPublishDirectly(auth) ? rows[0].status : "pending",
         canPublishDirectly(auth) ? rows[0].reviewer_user_id || null : null,
         canPublishDirectly(auth) ? rows[0].reviewer_github_login || "" : "",
         canPublishDirectly(auth) ? rows[0].reviewed_at || null : null,
         now, gameId, version],
      );
      if (!result.affectedRows) throw new GameHostingError("hosted_game_version_not_found", 404);
      if (!canPublishDirectly(auth) && rows[0].initial_revision_id && !rows[0].published_metadata_json) {
        await connection.query(
          `UPDATE hosted_game_metadata_revisions SET status = 'pending', review_reason = '',
             reviewer_user_id = NULL, reviewer_github_login = '', reviewed_at = NULL, updated_at = ?
           WHERE id = ?`,
          [now, rows[0].initial_revision_id],
        );
      }
      await connection.query(
        `UPDATE hosted_games SET updated_by_user_id = ?, updated_by_github_login = ?, updated_at = ? WHERE game_id = ?`,
        [auth.user.id, auth.user.login || "", now, gameId],
      );
    });
    sendJson(res, 200, { ok: true, status: canPublishDirectly(auth) ? undefined : "pending" });
  }

  async function setLatestVersion(req, res, gameId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_ALL_MANAGE, { requireOrigin: true });
    if (!auth) return;
    const body = assertObject(await readJson(req, 4096), "invalid_json");
    assertKnownKeys(body, new Set(["version"]), "invalid_json");
    const version = requiredString(body.version, 1, 100, "invalid_game_version");
    if (!SEMVER_PATTERN.test(version)) throw new GameHostingError("invalid_game_version");
    const [rows] = await mySqlService.query("SELECT id FROM hosted_game_versions WHERE game_id = ? AND version = ? AND status = 'approved' LIMIT 1", [gameId, version]);
    if (!rows[0]) throw new GameHostingError("hosted_game_version_not_found", 404);
    await mySqlService.query(
      `UPDATE hosted_games SET latest_version = ?, updated_by_user_id = ?, updated_by_github_login = ?, updated_at = ? WHERE game_id = ?`,
      [version, auth.user.id, auth.user.login || "", new Date(), gameId],
    );
    sendJson(res, 200, { ok: true });
  }

  async function quarantineAndDelete(targetPath, callback) {
    const quarantine = path.join(tempRoot, `${crypto.randomUUID()}.deleting`);
    let moved = false;
    try {
      await fs.rename(targetPath, quarantine);
      moved = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      await callback();
    } catch (error) {
      if (moved) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o750 });
        await fs.rename(quarantine, targetPath);
      }
      throw error;
    }
    if (moved) await fs.rm(quarantine, { recursive: true, force: true });
  }

  async function deleteVersion(req, res, gameId, version) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW, { requireOrigin: true });
    if (!auth) return;
    if (!GAME_ID_PATTERN.test(gameId) || !SEMVER_PATTERN.test(version)) throw new GameHostingError("hosted_game_version_not_found", 404);
    await ensureStorage();
    await withStorageLock(async () => {
      const [rows] = await mySqlService.query(
        `SELECT v.id, v.status, v.initial_revision_id, g.owner_user_id
         FROM hosted_game_versions v JOIN hosted_games g ON g.game_id = v.game_id
         WHERE v.game_id = ? AND v.version = ? LIMIT 1`,
        [gameId, version],
      );
      if (!rows[0]) throw new GameHostingError("hosted_game_version_not_found", 404);
      if (!canManageOwnedResource(auth, rows[0].owner_user_id)) throw new GameHostingError("forbidden", 403);
      if (!canManageAll(auth)) {
        if (!['pending', 'rejected'].includes(rows[0].status)) throw new GameHostingError("approved_submission_read_only", 409);
      }
      const [gameRows] = await mySqlService.query("SELECT published_metadata_json, latest_version FROM hosted_games WHERE game_id = ? LIMIT 1", [gameId]);
      if (!gameRows[0]) throw new GameHostingError("hosted_game_not_found", 404);
      await quarantineAndDelete(versionDirectory(gameId, version), async () => {
        await mySqlService.transaction(async (connection) => {
          await connection.query("DELETE FROM hosted_game_versions WHERE id = ?", [rows[0].id]);
          if (rows[0].initial_revision_id) await connection.query("DELETE FROM hosted_game_metadata_revisions WHERE id = ?", [rows[0].initial_revision_id]);
          const [allRemaining] = await connection.query("SELECT version, status FROM hosted_game_versions WHERE game_id = ?", [gameId]);
          const [revisionCount] = await connection.query("SELECT COUNT(*) AS total FROM hosted_game_metadata_revisions WHERE game_id = ?", [gameId]);
          if (!allRemaining.length && Number(revisionCount[0]?.total || 0) === 0) await connection.query("DELETE FROM hosted_games WHERE game_id = ?", [gameId]);
          else {
            const approved = allRemaining.filter((item) => item.status === 'approved').sort((a, b) => compareSemverDescending(a.version, b.version));
            const currentLatestStillExists = approved.some((item) => item.version === gameRows[0].latest_version);
            const latestVersion = currentLatestStillExists ? gameRows[0].latest_version : approved[0]?.version || null;
            const metadata = gameRows[0].published_metadata_json ? parseDatabaseJson(gameRows[0].published_metadata_json) : null;
            if (metadata) {
            for (const role of ["icon", "cover"]) {
              const parsed = parseLogicalUrl(metadata[`${role}Url`]);
              if (parsed?.gameId === gameId && parsed.version === version && parsed.role === role) delete metadata[`${role}Url`];
            }
            }
            await connection.query(
              "UPDATE hosted_games SET published_metadata_json = ?, latest_version = ?, updated_at = ? WHERE game_id = ?",
              [metadata ? JSON.stringify(metadata) : null, latestVersion, new Date(), gameId],
            );
          }
        });
      });
      try { await fs.rmdir(path.join(filesDir, gameId)); } catch {}
    });
    sendJson(res, 200, { ok: true });
  }

  async function deleteGame(req, res, gameId) {
    if (!(await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_ALL_MANAGE, { requireOrigin: true }))) return;
    if (!GAME_ID_PATTERN.test(gameId)) throw new GameHostingError("hosted_game_not_found", 404);
    await ensureStorage();
    await withStorageLock(async () => {
      const [rows] = await mySqlService.query("SELECT game_id FROM hosted_games WHERE game_id = ? LIMIT 1", [gameId]);
      if (!rows[0]) throw new GameHostingError("hosted_game_not_found", 404);
      await quarantineAndDelete(path.join(filesDir, gameId), async () => {
        const [result] = await mySqlService.query("DELETE FROM hosted_games WHERE game_id = ?", [gameId]);
        if (!result.affectedRows) throw new GameHostingError("hosted_game_not_found", 404);
      });
    });
    sendJson(res, 200, { ok: true });
  }

  function parseReviewBody(body, allowSetLatest) {
    const value = assertObject(body, "invalid_review");
    assertKnownKeys(value, new Set(allowSetLatest
      ? ["decision", "reason", "setLatest", "expectedUpdatedAt"]
      : ["decision", "reason", "expectedUpdatedAt"]), "invalid_review");
    if (!['approved', 'rejected'].includes(value.decision)) throw new GameHostingError("invalid_review");
    const expectedUpdatedAt = requiredString(value.expectedUpdatedAt, 1, 64, "invalid_review");
    if (!Number.isFinite(Date.parse(expectedUpdatedAt))) throw new GameHostingError("invalid_review");
    const rawReason = value.reason === undefined ? "" : value.reason;
    if (typeof rawReason !== "string") throw new GameHostingError("invalid_review");
    const reason = rawReason.trim() ? optionalString(rawReason, 2000, "invalid_review") : "";
    if (value.decision === 'rejected' && !reason) throw new GameHostingError("review_reason_required");
    if (value.setLatest !== undefined && typeof value.setLatest !== 'boolean') throw new GameHostingError("invalid_review");
    return { decision: value.decision, reason, setLatest: Boolean(value.setLatest), expectedUpdatedAt };
  }

  function assertUnchanged(actual, expected) {
    if (new Date(actual).toISOString() !== new Date(expected).toISOString()) throw new GameHostingError("submission_changed", 409);
  }

  async function reviewVersion(req, res, versionId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_REVIEW, { requireOrigin: true });
    if (!auth) return;
    const review = parseReviewBody(await readJson(req, 16 * 1024), true);
    await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT v.*, g.published_metadata_json, g.latest_version
         FROM hosted_game_versions v JOIN hosted_games g ON g.game_id = v.game_id
         WHERE v.id = ? FOR UPDATE`, [versionId],
      );
      const version = rows[0];
      if (!version) throw new GameHostingError("hosted_game_version_not_found", 404);
      if (version.status !== 'pending') throw new GameHostingError("submission_not_pending", 409);
      assertUnchanged(version.updated_at, review.expectedUpdatedAt);
      const now = new Date();
      if (review.decision === 'rejected') {
        await connection.query(
          `UPDATE hosted_game_versions SET status = 'rejected', review_reason = ?, reviewer_user_id = ?,
             reviewer_github_login = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          [review.reason, auth.user.id, auth.user.login || "", now, now, versionId],
        );
        if (version.initial_revision_id) await connection.query(
          `UPDATE hosted_game_metadata_revisions SET status = 'rejected', review_reason = ?,
             reviewer_user_id = ?, reviewer_github_login = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          [review.reason, auth.user.id, auth.user.login || "", now, now, version.initial_revision_id],
        );
        return;
      }
      let metadata = version.published_metadata_json ? parseDatabaseJson(version.published_metadata_json) : null;
      if (version.initial_revision_id) {
        const [revisions] = await connection.query(
          "SELECT metadata_json, status FROM hosted_game_metadata_revisions WHERE id = ? FOR UPDATE",
          [version.initial_revision_id],
        );
        if (!revisions[0] || revisions[0].status !== 'pending') throw new GameHostingError("submission_not_pending", 409);
        metadata = parseDatabaseJson(revisions[0].metadata_json);
        await connection.query(
          `UPDATE hosted_game_metadata_revisions SET status = 'approved', review_reason = '',
             reviewer_user_id = ?, reviewer_github_login = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
          [auth.user.id, auth.user.login || "", now, now, version.initial_revision_id],
        );
      }
      if (!metadata) throw new GameHostingError("game_metadata_not_approved", 409);
      const [assets] = await connection.query(
        "SELECT role, original_name FROM hosted_game_assets WHERE version_id = ?", [versionId],
      );
      for (const asset of assets) if (asset.role === 'icon' || asset.role === 'cover') {
        metadata[`${asset.role}Url`] = toLogicalUrl(version.game_id, version.version, asset.role, asset.original_name);
      }
      const [approvedRows] = await connection.query(
        "SELECT COUNT(*) AS total FROM hosted_game_versions WHERE game_id = ? AND status = 'approved'", [version.game_id],
      );
      const firstApproved = Number(approvedRows[0]?.total || 0) === 0;
      const latestVersion = firstApproved || review.setLatest ? version.version : version.latest_version;
      await connection.query(
        `UPDATE hosted_game_versions SET status = 'approved', review_reason = '', reviewer_user_id = ?,
           reviewer_github_login = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
        [auth.user.id, auth.user.login || "", now, now, versionId],
      );
      await connection.query(
        `UPDATE hosted_games SET published_metadata_json = ?, latest_version = ?, updated_by_user_id = ?,
           updated_by_github_login = ?, updated_at = ? WHERE game_id = ?`,
        [JSON.stringify(metadata), latestVersion, auth.user.id, auth.user.login || "", now, version.game_id],
      );
    });
    sendJson(res, 200, { ok: true, status: review.decision });
  }

  async function reviewRevision(req, res, revisionId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_REVIEW, { requireOrigin: true });
    if (!auth) return;
    const review = parseReviewBody(await readJson(req, 16 * 1024), false);
    await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT r.*, g.published_metadata_json FROM hosted_game_metadata_revisions r
         JOIN hosted_games g ON g.game_id = r.game_id WHERE r.id = ? FOR UPDATE`, [revisionId],
      );
      const revision = rows[0];
      if (!revision) throw new GameHostingError("hosted_game_revision_not_found", 404);
      if (revision.status !== 'pending') throw new GameHostingError("submission_not_pending", 409);
      assertUnchanged(revision.updated_at, review.expectedUpdatedAt);
      const [linked] = await connection.query("SELECT id FROM hosted_game_versions WHERE initial_revision_id = ? LIMIT 1", [revisionId]);
      if (linked[0]) throw new GameHostingError("initial_revision_review_with_version", 409);
      const now = new Date();
      await connection.query(
        `UPDATE hosted_game_metadata_revisions SET status = ?, review_reason = ?, reviewer_user_id = ?,
           reviewer_github_login = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
        [review.decision, review.decision === 'rejected' ? review.reason : '', auth.user.id,
         auth.user.login || "", now, now, revisionId],
      );
      if (review.decision === 'approved') await connection.query(
        `UPDATE hosted_games SET published_metadata_json = ?, updated_by_user_id = ?,
           updated_by_github_login = ?, updated_at = ? WHERE game_id = ?`,
        [JSON.stringify(parseDatabaseJson(revision.metadata_json)), auth.user.id, auth.user.login || "", now, revision.game_id],
      );
    });
    sendJson(res, 200, { ok: true, status: review.decision });
  }

  async function deleteRevision(req, res, revisionId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW, { requireOrigin: true });
    if (!auth) return;
    await mySqlService.transaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT r.status, r.game_id, g.owner_user_id FROM hosted_game_metadata_revisions r
         JOIN hosted_games g ON g.game_id = r.game_id WHERE r.id = ? FOR UPDATE`, [revisionId],
      );
      if (!rows[0]) throw new GameHostingError("hosted_game_revision_not_found", 404);
      if (!canManageOwnedResource(auth, rows[0].owner_user_id)) throw new GameHostingError("forbidden", 403);
      if (!canManageAll(auth)) {
        if (!['pending', 'rejected'].includes(rows[0].status)) throw new GameHostingError("approved_submission_read_only", 409);
      }
      const [linked] = await connection.query("SELECT id FROM hosted_game_versions WHERE initial_revision_id = ? LIMIT 1", [revisionId]);
      if (linked[0]) throw new GameHostingError("delete_initial_version_instead", 409);
      await connection.query("DELETE FROM hosted_game_metadata_revisions WHERE id = ?", [revisionId]);
    });
    sendJson(res, 200, { ok: true });
  }

  async function handleDownload(req, res, url, rawGameId, rawVersion, role, rawName) {
    if (!requireHttpRelayToken(config, req, res, url)) return;
    const gameId = decodeCanonicalSegment(rawGameId);
    const version = decodeCanonicalSegment(rawVersion);
    const fileName = decodeCanonicalSegment(rawName);
    if (!GAME_ID_PATTERN.test(gameId) || !SEMVER_PATTERN.test(version) || !ROLES.has(role) || !fileName) throw new GameHostingError("hosted_game_asset_not_found", 404);
    const [rows] = await mySqlService.query(
      `SELECT a.original_name, a.storage_name, a.content_type, a.size, a.sha256
       FROM hosted_game_assets a JOIN hosted_game_versions v ON v.id = a.version_id
       WHERE v.game_id = ? AND v.version = ? AND v.status = 'approved' AND a.role = ? LIMIT 1`,
      [gameId, version, role],
    );
    const asset = rows[0];
    if (!asset || asset.original_name !== fileName) throw new GameHostingError("hosted_game_asset_not_found", 404);
    const filePath = path.join(versionDirectory(gameId, version), asset.storage_name);
    let stat;
    try { stat = await fs.stat(filePath); } catch (error) { if (error?.code === "ENOENT") throw new GameHostingError("hosted_game_asset_not_found", 404); throw error; }
    const size = Number(asset.size);
    if (!stat.isFile() || stat.size !== size) throw new GameHostingError("hosted_game_asset_unavailable", 503);
    if (req.headers["if-none-match"] === `"${asset.sha256}"` && !req.headers.range) {
      res.writeHead(304, { etag: `"${asset.sha256}"` }); res.end(); return;
    }
    const range = parseRange(req.headers.range, size);
    if (range === false) { res.writeHead(416, { "content-range": `bytes */${size}`, "accept-ranges": "bytes" }); res.end(); return; }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const asciiName = role === "package" ? "game.zip" : `${role}.${asset.content_type.split("/")[1].replace("jpeg", "jpg")}`;
    const headers = {
      "content-type": asset.content_type, "content-length": String(end - start + 1),
      "content-disposition": `${role === "package" ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "accept-ranges": "bytes", etag: `"${asset.sha256}"`, "x-file-sha256": asset.sha256,
      "cache-control": "private, max-age=300", "x-content-type-options": "nosniff",
    };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(filePath, { start, end }).once("error", () => res.destroy()).pipe(res);
  }

  async function handlePortalDownload(req, res, rawAssetId) {
    const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW);
    if (!auth) return;
    const assetId = decodeCanonicalSegment(rawAssetId);
    if (!UUID_PATTERN.test(assetId)) throw new GameHostingError("hosted_game_asset_not_found", 404);
    const [rows] = await mySqlService.query(
      `SELECT a.id, a.role, a.original_name, a.storage_name, a.content_type, a.size, a.sha256,
              v.game_id, v.version, g.owner_user_id
       FROM hosted_game_assets a
       JOIN hosted_game_versions v ON v.id = a.version_id
       JOIN hosted_games g ON g.game_id = v.game_id
       WHERE a.id = ? LIMIT 1`,
      [assetId],
    );
    const asset = rows[0];
    if (!asset) throw new GameHostingError("hosted_game_asset_not_found", 404);
    if (!canManageOwnedResource(auth, asset.owner_user_id)) throw new GameHostingError("forbidden", 403);

    await ensureStorage();
    const storageName = String(asset.storage_name || "");
    if (!storageName || path.basename(storageName) !== storageName) {
      throw new GameHostingError("hosted_game_asset_unavailable", 503);
    }
    const filePath = path.join(versionDirectory(asset.game_id, asset.version), storageName);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") throw new GameHostingError("hosted_game_asset_not_found", 404);
      throw error;
    }
    const size = Number(asset.size);
    if (!stat.isFile() || stat.size !== size) throw new GameHostingError("hosted_game_asset_unavailable", 503);
    const range = parseRange(req.headers.range, size);
    if (range === false) {
      res.writeHead(416, { "content-range": `bytes */${size}`, "accept-ranges": "bytes" });
      res.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const extension = String(asset.content_type || "application/octet-stream").split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const asciiName = asset.role === "package" ? "game.zip" : `${asset.role}.${extension}`;
    const headers = {
      "content-type": asset.content_type,
      "content-length": String(end - start + 1),
      "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(asset.original_name)}`,
      "accept-ranges": "bytes",
      etag: `"${asset.sha256}"`,
      "x-file-sha256": asset.sha256,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath, { start, end }).once("error", () => res.destroy()).pipe(res);
  }

  async function handleRequest(req, res, url) {
    const assetMatch = url.pathname.match(/^\/api\/v1\/game-hosting\/assets\/([^/]+)\/([^/]+)\/(package|icon|cover)\/([^/]+)$/);
    const portalAssetDownloadMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/assets\/([^/]+)\/download$/);
    const base = "/api/portal/v1/game-hosting";
    const versionMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/games\/([^/]+)\/versions\/([^/]+)$/);
    const versionsCollectionMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/games\/([^/]+)\/versions$/);
    const latestMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/games\/([^/]+)\/latest$/);
    const configMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/games\/([^/]+)\/config$/);
    const gameMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/games\/([^/]+)$/);
    const reviewVersionMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/reviews\/versions\/([^/]+)$/);
    const reviewRevisionMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/reviews\/revisions\/([^/]+)$/);
    const revisionMatch = url.pathname.match(/^\/api\/portal\/v1\/game-hosting\/revisions\/([^/]+)$/);
    const gamesCollection = url.pathname === `${base}/games`;
    const treeCollection = url.pathname === `${base}/tree`;
    if (!assetMatch && !portalAssetDownloadMatch && !versionMatch && !versionsCollectionMatch && !latestMatch && !configMatch && !gameMatch &&
        !reviewVersionMatch && !reviewRevisionMatch && !revisionMatch && !gamesCollection && !treeCollection) return false;
    if (!mySqlService.isEnabled()) { sendJson(res, 503, { error: "game_hosting_storage_not_configured" }); return true; }
    try {
      if (["GET", "HEAD"].includes(req.method) && assetMatch) await handleDownload(req, res, url, ...assetMatch.slice(1));
      else if (["GET", "HEAD"].includes(req.method) && portalAssetDownloadMatch) await handlePortalDownload(req, res, ...portalAssetDownloadMatch.slice(1));
      else if (req.method === "POST" && gamesCollection) await createVersion(req, res, null);
      else if (req.method === "POST" && versionsCollectionMatch) await createVersion(req, res, decodeCanonicalSegment(versionsCollectionMatch[1]));
      else if (req.method === "GET" && treeCollection) await handleTree(req, res, url);
      else if (req.method === "GET" && configMatch) {
        const auth = await accessControlService.requireCapability(req, res, PORTAL_CAPABILITIES.HOSTING_VIEW);
        if (!auth) return true;
        const gameId = decodeCanonicalSegment(configMatch[1]);
        const [games] = await mySqlService.query("SELECT owner_user_id FROM hosted_games WHERE game_id = ? LIMIT 1", [gameId]);
        if (!games[0]) throw new GameHostingError("hosted_game_not_found", 404);
        if (!canManageOwnedResource(auth, games[0].owner_user_id)) throw new GameHostingError("forbidden", 403);
        sendJson(res, 200, await buildGameConfig(gameId));
      }
      else if (req.method === "PUT" && gameMatch) await updateGame(req, res, decodeCanonicalSegment(gameMatch[1]));
      else if (req.method === "PUT" && versionMatch) {
        const gameId = decodeCanonicalSegment(versionMatch[1]);
        const version = decodeCanonicalSegment(versionMatch[2]);
        if (String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) await replaceVersion(req, res, gameId, version);
        else await updateVersion(req, res, gameId, version);
      }
      else if (req.method === "PUT" && latestMatch) await setLatestVersion(req, res, decodeCanonicalSegment(latestMatch[1]));
      else if (req.method === "PUT" && reviewVersionMatch) await reviewVersion(req, res, decodeCanonicalSegment(reviewVersionMatch[1]));
      else if (req.method === "PUT" && reviewRevisionMatch) await reviewRevision(req, res, decodeCanonicalSegment(reviewRevisionMatch[1]));
      else if (req.method === "DELETE" && revisionMatch) await deleteRevision(req, res, decodeCanonicalSegment(revisionMatch[1]));
      else if (req.method === "DELETE" && versionMatch) await deleteVersion(req, res, decodeCanonicalSegment(versionMatch[1]), decodeCanonicalSegment(versionMatch[2]));
      else if (req.method === "DELETE" && gameMatch) await deleteGame(req, res, decodeCanonicalSegment(gameMatch[1]));
      else sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const hostingError = error instanceof GameHostingError ? error : new GameHostingError("game_hosting_internal_error", 500);
      if (!(error instanceof GameHostingError)) console.error("[relay-server] game hosting request failed", error);
      if (!res.headersSent) sendJson(res, hostingError.status, { error: hostingError.code }); else res.destroy();
    }
    return true;
  }

  return { handleRequest };
}
