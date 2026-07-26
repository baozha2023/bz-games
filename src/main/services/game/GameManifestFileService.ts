import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  GameManifestSchema,
  type GameManifest,
} from "../../../shared/game-manifest";
import { GAME_MANIFEST_ENCRYPTION_SEED } from "../../../shared/AppConstants";

const ENVELOPE_MARKER = "__bzGameManifestEncrypted";
const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = "aes-256-gcm";
const KEY_CONTEXT = "bz-games:game-manifest:v1:";
const AAD = Buffer.from("bz-games:game-manifest:v1", "utf8");
const MAX_MANIFEST_FILE_BYTES = 4 * 1024 * 1024;

export type GameManifestFileErrorCode =
  | "manifestEncryptionKeyMissing"
  | "manifestEncryptedFormatInvalid"
  | "manifestKeyMismatch"
  | "manifestDecryptFailed";

export interface GameManifestFileReadResult {
  manifest: GameManifest;
  encrypted: boolean;
}

export class GameManifestFileError extends Error {
  constructor(
    public readonly code: GameManifestFileErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GameManifestFileError";
  }
}

type EncryptedManifestEnvelope = {
  [ENVELOPE_MARKER]: true;
  version: number;
  algorithm: string;
  keyId: string;
  iv: string;
  tag: string;
  payload: string;
};

function getCipherKey(): Buffer {
  const seed = GAME_MANIFEST_ENCRYPTION_SEED?.trim();
  if (!seed) {
    throw new GameManifestFileError(
      "manifestEncryptionKeyMissing",
      "Game manifest encryption key is not configured",
    );
  }
  return crypto.createHash("sha256").update(`${KEY_CONTEXT}${seed}`).digest();
}

function getKeyId(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function isCanonicalBase64(
  value: unknown,
  expectedBytes?: number,
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return false;
  return expectedBytes === undefined || decoded.length === expectedBytes;
}

function parseEncryptedEnvelope(
  raw: unknown,
): EncryptedManifestEnvelope | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as Record<string, unknown>)[ENVELOPE_MARKER] !== true
  ) {
    return null;
  }

  const envelope = raw as Partial<EncryptedManifestEnvelope>;
  if (
    envelope.version !== ENVELOPE_VERSION ||
    envelope.algorithm !== ENVELOPE_ALGORITHM ||
    typeof envelope.keyId !== "string" ||
    !/^[a-f0-9]{16}$/.test(envelope.keyId) ||
    !isCanonicalBase64(envelope.iv, 12) ||
    !isCanonicalBase64(envelope.tag, 16) ||
    !isCanonicalBase64(envelope.payload)
  ) {
    throw new GameManifestFileError(
      "manifestEncryptedFormatInvalid",
      "Encrypted game manifest envelope is invalid or unsupported",
    );
  }

  return envelope as EncryptedManifestEnvelope;
}

function encryptManifest(manifest: GameManifest): string {
  const key = getCipherKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENVELOPE_ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(manifest), "utf8"),
    cipher.final(),
  ]);

  return JSON.stringify({
    [ENVELOPE_MARKER]: true,
    version: ENVELOPE_VERSION,
    algorithm: ENVELOPE_ALGORITHM,
    keyId: getKeyId(key),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: encrypted.toString("base64"),
  });
}

function decryptManifest(envelope: EncryptedManifestEnvelope): GameManifest {
  const key = getCipherKey();
  if (envelope.keyId !== getKeyId(key)) {
    throw new GameManifestFileError(
      "manifestKeyMismatch",
      "Game manifest was encrypted with a different build key",
    );
  }

  let plaintext: string;
  try {
    const decipher = crypto.createDecipheriv(
      ENVELOPE_ALGORITHM,
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.payload, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    throw new GameManifestFileError(
      "manifestDecryptFailed",
      "Game manifest authentication or decryption failed",
      { cause: error },
    );
  }
  return GameManifestSchema.parse(JSON.parse(plaintext));
}

function replaceFileSafely(filePath: string, content: string): void {
  const directory = path.dirname(filePath);
  const nonce = `${process.pid}-${crypto.randomUUID()}`;
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${nonce}.tmp`,
  );
  const backupPath = path.join(
    directory,
    `.${path.basename(filePath)}.${nonce}.backup`,
  );
  const hadOriginal = fs.existsSync(filePath);

  try {
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    if (hadOriginal) {
      fs.renameSync(filePath, backupPath);
    }
    try {
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      if (
        hadOriginal &&
        fs.existsSync(backupPath) &&
        !fs.existsSync(filePath)
      ) {
        fs.renameSync(backupPath, filePath);
      }
      throw error;
    }
    if (fs.existsSync(backupPath)) {
      try {
        fs.rmSync(backupPath, {
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch (error) {
        fs.rmSync(filePath, { force: true });
        fs.renameSync(backupPath, filePath);
        throw error;
      }
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }
}

export function writeEncryptedGameManifestFile(
  filePath: string,
  manifest: GameManifest,
): void {
  const validated = GameManifestSchema.parse(manifest);
  replaceFileSafely(filePath, encryptManifest(validated));
}

export function readGameManifestFile(
  filePath: string,
  options: { migratePlaintext?: boolean } = {},
): GameManifest {
  return readGameManifestFileWithMetadata(filePath, options).manifest;
}

export function readGameManifestFileWithMetadata(
  filePath: string,
  options: { migratePlaintext?: boolean } = {},
): GameManifestFileReadResult {
  if (fs.statSync(filePath).size > MAX_MANIFEST_FILE_BYTES) {
    throw new GameManifestFileError(
      "manifestEncryptedFormatInvalid",
      "Game manifest file exceeds the 4 MB size limit",
    );
  }
  const content = fs.readFileSync(filePath, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    if (content.includes(ENVELOPE_MARKER)) {
      throw new GameManifestFileError(
        "manifestEncryptedFormatInvalid",
        "Encrypted game manifest is not valid JSON",
        { cause: error },
      );
    }
    throw error;
  }
  const envelope = parseEncryptedEnvelope(raw);
  if (envelope) {
    return { manifest: decryptManifest(envelope), encrypted: true };
  }

  const manifest = GameManifestSchema.parse(raw);
  if (options.migratePlaintext) {
    writeEncryptedGameManifestFile(filePath, manifest);
  }
  return { manifest, encrypted: false };
}
