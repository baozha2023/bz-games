import crypto from "crypto";
import { z } from "zod";
import { CONFIG_ENCRYPTION_SEED } from "../../../shared/AppConstants";
import {
  DEFAULT_NICKNAME_STYLE,
  NICKNAME_EFFECTS,
  type AppStore,
} from "../../../shared/types";

export const CONFIG_FORMAT = "bz-games-config" as const;
export const CONFIG_FORMAT_VERSION = 4 as const;
export const CONFIG_ALGORITHM = "aes-256-gcm" as const;
export const CONFIG_IV_BYTES = 12;
export const CONFIG_AUTH_TAG_BYTES = 16;
export const CONFIG_MAX_SERIALIZED_BYTES = 8 * 1024 * 1024;

const nicknameStyleSchema = z
  .object({
    color: z.string(),
    gradientStart: z.string().optional(),
    gradientEnd: z.string().optional(),
    font: z.enum(["system", "rounded", "serif", "mono", "fantasy"]),
    effect: z.enum(NICKNAME_EFFECTS),
    weight: z.enum(["normal", "semibold", "bold"]),
  })
  .strict();

const settingsSchema = z
  .object({
    playerName: z.string(),
    playerId: z.string(),
    avatar: z.string().optional(),
    accountSessionToken: z.string(),
    accountSessionExpiresAt: z.string(),
    accountUserLogin: z.string(),
    accountUserName: z.string(),
    accountUserProfileUrl: z.string(),
    nicknameStyle: nicknameStyleSchema,
    libraryLayout: z.enum(["card", "icon", "steam"]),
    lastJoinRoomAddress: z.string(),
    language: z.enum(["zh-CN", "en-US", "ja-JP", "zh-TW", "de-DE"]),
    theme: z.enum(["dark", "light", "auto"]),
    defaultRoomPort: z.number().int().min(1).max(65535),
    closeBehavior: z.enum(["tray", "exit"]),
    autoLaunch: z.boolean(),
    githubToken: z.string(),
    chatWindowBounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .strict()
      .optional(),
    chatInputHeight: z.number().finite().positive(),
    downloadFloatBall: z.boolean(),
    sensitiveWordFilter: z.boolean(),
    floatBallPosition: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .optional(),
    updatePromptSuppressedForAppVersion: z.string().optional(),
  })
  .strict();

const userDataSchema = z
  .object({
    bzCoins: z.number().finite().nonnegative(),
    checkIn: z
      .object({
        lastCheckInDate: z.string(),
        consecutiveDays: z.number().int().nonnegative(),
        maxConsecutiveDays: z.number().int().nonnegative(),
        totalDays: z.number().int().nonnegative(),
      })
      .strict(),
    ownedFrames: z.array(z.string()),
    equippedFrame: z.string().optional(),
    ownedGameCardProducts: z.array(z.string()),
    equippedGameCardProduct: z.string().optional(),
  })
  .strict();

export const appStoreSchema = z
  .object({
    settings: settingsSchema,
    userData: userDataSchema,
  })
  .strict();

export function createDefaultV4Store(): AppStore {
  return {
    settings: {
      playerName: "玩家",
      playerId: "",
      accountSessionToken: "",
      accountSessionExpiresAt: "",
      accountUserLogin: "",
      accountUserName: "",
      accountUserProfileUrl: "",
      nicknameStyle: { ...DEFAULT_NICKNAME_STYLE },
      libraryLayout: "card",
      lastJoinRoomAddress: "",
      language: "zh-CN",
      theme: "auto",
      defaultRoomPort: 38080,
      closeBehavior: "tray",
      autoLaunch: false,
      githubToken: "",
      chatInputHeight: 204,
      downloadFloatBall: false,
      sensitiveWordFilter: true,
    },
    userData: {
      bzCoins: 0,
      checkIn: {
        lastCheckInDate: "",
        consecutiveDays: 0,
        maxConsecutiveDays: 0,
        totalDays: 0,
      },
      ownedFrames: [],
      ownedGameCardProducts: [],
    },
  };
}

const configEnvelopeSchema = z
  .object({
    format: z.literal(CONFIG_FORMAT),
    formatVersion: z.literal(CONFIG_FORMAT_VERSION),
    algorithm: z.literal(CONFIG_ALGORITHM),
    iv: z.string().min(1),
    tag: z.string().min(1),
    payload: z.string().min(1),
  })
  .strict();

function createConfigCipherKey(): Buffer {
  return crypto.createHash("sha256").update(CONFIG_ENCRYPTION_SEED).digest();
}

function decodeCanonicalBase64(
  value: string,
  field: "iv" | "tag" | "payload",
  expectedLength?: number,
): Buffer {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64");
  } catch (error) {
    throw new Error(`config_${field}_base64_invalid`, { cause: error });
  }
  if (!value || decoded.toString("base64") !== value) {
    throw new Error(`config_${field}_base64_invalid`);
  }
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`config_${field}_length_invalid`);
  }
  return decoded;
}

function decryptEnvelope(envelope: {
  iv: string;
  tag: string;
  payload: string;
}): unknown {
  try {
    const iv = decodeCanonicalBase64(envelope.iv, "iv", CONFIG_IV_BYTES);
    const tag = decodeCanonicalBase64(
      envelope.tag,
      "tag",
      CONFIG_AUTH_TAG_BYTES,
    );
    const payload = decodeCanonicalBase64(envelope.payload, "payload");
    const decipher = crypto.createDecipheriv(
      CONFIG_ALGORITHM,
      createConfigCipherKey(),
      iv,
    );
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error("config_decrypt_failed", { cause: error });
  }
}

export function serializeV4Config(data: AppStore): string {
  const validated = appStoreSchema.parse(data);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    CONFIG_ALGORITHM,
    createConfigCipherKey(),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(validated), "utf8"),
    cipher.final(),
  ]);
  const serialized = JSON.stringify({
    format: CONFIG_FORMAT,
    formatVersion: CONFIG_FORMAT_VERSION,
    algorithm: CONFIG_ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    payload: encrypted.toString("base64"),
  });
  if (Buffer.byteLength(serialized, "utf8") > CONFIG_MAX_SERIALIZED_BYTES) {
    throw new Error("config_too_large");
  }
  return serialized;
}

export function deserializeV4Config(content: string): AppStore {
  if (typeof content !== "string") {
    throw new Error("config_content_invalid");
  }
  if (Buffer.byteLength(content, "utf8") > CONFIG_MAX_SERIALIZED_BYTES) {
    throw new Error("config_too_large");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error("config_json_invalid", { cause: error });
  }
  const envelope = configEnvelopeSchema.safeParse(raw);
  if (!envelope.success) throw new Error("config_v4_envelope_invalid");
  const result = appStoreSchema.safeParse(decryptEnvelope(envelope.data));
  if (!result.success) {
    throw new Error("config_v4_payload_invalid", { cause: result.error });
  }
  return result.data;
}
