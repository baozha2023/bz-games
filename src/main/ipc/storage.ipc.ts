import { ipcMain, type IpcMainEvent } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { storeService } from "../services/storage/StoreService";
import { logger } from "../utils/logger";
import { readGameManifestFile } from "../services/game/GameManifestFileService";
import { GameIdSchema, GameVersionSchema } from "../../shared/game-manifest";
import { gameWindowIdentityRegistry } from "../services/game/GameWindowIdentityRegistry";

const MAX_STORAGE_FILE_BYTES = 5 * 1024 * 1024;

function authorizeStorageRequest(
  event: IpcMainEvent,
  gameId: unknown,
  version: unknown,
): { gameId: string; version: string } | null {
  const parsedGameId = GameIdSchema.safeParse(gameId);
  const parsedVersion = GameVersionSchema.safeParse(version);
  if (!parsedGameId.success || !parsedVersion.success) return null;

  if (
    !gameWindowIdentityRegistry.matches(
      event.sender.id,
      parsedGameId.data,
      parsedVersion.data,
    )
  ) {
    return null;
  }
  return { gameId: parsedGameId.data, version: parsedVersion.data };
}

function readStorageContent(filePath: string): string {
  if (fs.statSync(filePath).size > MAX_STORAGE_FILE_BYTES) {
    throw new Error("game_storage_too_large");
  }
  return fs.readFileSync(filePath, "utf-8");
}

function writeStorageContent(filePath: string, content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_STORAGE_FILE_BYTES) {
    throw new Error("game_storage_too_large");
  }
  fs.writeFileSync(filePath, content, "utf-8");
}

function getStoragePath(gameId: string, version: string): string {
  return path.join(
    storeService.getGameVersionStoragePath(gameId, version),
    "gamedata.json",
  );
}

function getManifestPath(gameId: string, version: string): string {
  return path.join(
    storeService.getGameVersionStoragePath(gameId, version),
    "game.json",
  );
}

function isEncryptedStorageEnabled(gameId: string, version: string): boolean {
  const manifestPath = getManifestPath(gameId, version);
  if (!fs.existsSync(manifestPath)) {
    return false;
  }
  const manifest = readGameManifestFile(manifestPath, {
    migratePlaintext: true,
  });
  return manifest.encryptLocalStorage === true;
}

function createCipherKey(gameId: string, version: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`bz-games-storage:${gameId}:${version || "latest"}`)
    .digest();
}

function encryptStoragePayload(
  data: Record<string, any>,
  gameId: string,
  version: string,
): string {
  const key = createCipherKey(gameId, version);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    __encrypted: true,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    payload: encrypted.toString("base64"),
  });
}

function tryDecryptStoragePayload(
  raw: any,
  gameId: string,
  version: string,
): Record<string, any> | null {
  if (!raw || raw.__encrypted !== true) {
    return null;
  }

  try {
    const key = createCipherKey(gameId, version);
    const iv = Buffer.from(raw.iv, "base64");
    const tag = Buffer.from(raw.tag, "base64");
    const payload = Buffer.from(raw.payload, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted);
    return typeof parsed === "object" && parsed && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseStorageFile(
  content: string,
  gameId: string,
  version: string,
  encryptedStorageEnabled: boolean,
): Record<string, any> {
  const parsed = JSON.parse(content);
  if (encryptedStorageEnabled) {
    const decrypted = tryDecryptStoragePayload(parsed, gameId, version);
    return decrypted || {};
  }

  if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
    return parsed;
  }
  return {};
}

export function registerStorageIpc() {
  ipcMain.on(IPC.GAME_STORAGE_INIT, (event, gameId, version) => {
    try {
      const identity = authorizeStorageRequest(event, gameId, version);
      if (!identity) {
        event.returnValue = { data: {}, encrypted: false };
        return;
      }
      ({ gameId, version } = identity);

      const encrypted = isEncryptedStorageEnabled(gameId, version);
      const filePath = getStoragePath(gameId, version);
      if (fs.existsSync(filePath)) {
        const content = readStorageContent(filePath);
        event.returnValue = {
          data: parseStorageFile(content, gameId, version, encrypted),
          encrypted,
        };
      } else {
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        const initialContent = encrypted
          ? encryptStoragePayload({}, gameId, version)
          : JSON.stringify({}, null, 2);
        writeStorageContent(filePath, initialContent);
        event.returnValue = { data: {}, encrypted };
      }
    } catch (error) {
      logger.error(
        `[Storage] Failed to load data for ${gameId} @ ${version}:`,
        error,
      );
      event.returnValue = { data: {}, encrypted: false };
    }
  });

  ipcMain.on(IPC.GAME_STORAGE_SAVE, (event, gameId, version, key, value) => {
    const identity = authorizeStorageRequest(event, gameId, version);
    if (!identity || typeof key !== "string" || typeof value !== "string")
      return;
    updateStorage(identity.gameId, identity.version, (data) => {
      Object.defineProperty(data, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    });
  });

  ipcMain.on(IPC.GAME_STORAGE_REMOVE, (event, gameId, version, key) => {
    const identity = authorizeStorageRequest(event, gameId, version);
    if (!identity || typeof key !== "string") return;
    updateStorage(identity.gameId, identity.version, (data) => {
      delete data[key];
    });
  });

  ipcMain.on(IPC.GAME_STORAGE_CLEAR, (event, gameId, version) => {
    const identity = authorizeStorageRequest(event, gameId, version);
    if (!identity) return;
    updateStorage(identity.gameId, identity.version, (data) => {
      for (const k in data) delete data[k];
    });
  });

  ipcMain.on(IPC.GAME_STORAGE_FLUSH, (event, gameId, version, data) => {
    const identity = authorizeStorageRequest(event, gameId, version);
    if (!identity) {
      event.returnValue = false;
      return;
    }
    ({ gameId, version } = identity);
    try {
      const filePath = getStoragePath(gameId, version);
      const dirPath = path.dirname(filePath);

      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const encrypted = isEncryptedStorageEnabled(gameId, version);
      const safeData =
        typeof data === "object" && data && !Array.isArray(data) ? data : {};
      const finalContent = encrypted
        ? encryptStoragePayload(
            safeData as Record<string, any>,
            gameId,
            version,
          )
        : JSON.stringify(safeData, null, 2);
      writeStorageContent(filePath, finalContent);
      event.returnValue = true;
    } catch (error) {
      logger.error(
        `[Storage] Failed to flush data for ${gameId} @ ${version}:`,
        error,
      );
      event.returnValue = false;
    }
  });
}

function updateStorage(
  gameId: string,
  version: string,
  updateFn: (data: Record<string, any>) => void,
) {
  if (!gameId) return;

  try {
    const filePath = getStoragePath(gameId, version);
    const dirPath = path.dirname(filePath);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    let data: Record<string, any> = {};
    const encrypted = isEncryptedStorageEnabled(gameId, version);

    if (fs.existsSync(filePath)) {
      try {
        const content = readStorageContent(filePath);
        data = parseStorageFile(content, gameId, version, encrypted);
      } catch {
        logger.warn(
          `[Storage] Corrupt storage file for ${gameId} @ ${version}, resetting.`,
        );
      }
    }

    updateFn(data);
    const finalContent = encrypted
      ? encryptStoragePayload(data, gameId, version)
      : JSON.stringify(data, null, 2);
    writeStorageContent(filePath, finalContent);
  } catch (error) {
    logger.error(
      `[Storage] Failed to save data for ${gameId} @ ${version}:`,
      error,
    );
  }
}
