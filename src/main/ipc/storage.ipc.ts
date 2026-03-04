import { ipcMain } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { getGamesDir } from "../utils/appPath";

function getStoragePath(gameId: string, version: string): string {
  const ver = version || "latest";
  return path.join(getGamesDir(), gameId, ver, "gamedata.json");
}

function getManifestPath(gameId: string, version: string): string {
  const ver = version || "latest";
  return path.join(getGamesDir(), gameId, ver, "game.json");
}

function isEncryptedStorageEnabled(gameId: string, version: string): boolean {
  try {
    const manifestPath = getManifestPath(gameId, version);
    if (!fs.existsSync(manifestPath)) {
      return false;
    }
    const content = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content);
    return manifest?.encryptLocalStorage === true;
  } catch {
    return false;
  }
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
    return typeof parsed === "object" && parsed ? parsed : {};
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

  if (typeof parsed === "object" && parsed) {
    return parsed;
  }
  return {};
}

export function registerStorageIpc() {
  ipcMain.on(IPC.GAME_STORAGE_INIT, (event, gameId, version) => {
    try {
      if (!gameId) {
        event.returnValue = { data: {}, encrypted: false };
        return;
      }

      const encrypted = isEncryptedStorageEnabled(gameId, version);
      const filePath = getStoragePath(gameId, version);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
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
        fs.writeFileSync(filePath, initialContent, "utf-8");
        event.returnValue = { data: {}, encrypted };
      }
    } catch (error) {
      console.error(
        `[Storage] Failed to load data for ${gameId} @ ${version}:`,
        error,
      );
      event.returnValue = { data: {}, encrypted: false };
    }
  });

  ipcMain.on(IPC.GAME_STORAGE_SAVE, (_, gameId, version, key, value) => {
    updateStorage(gameId, version, (data) => {
      data[key] = value;
    });
  });

  ipcMain.on(IPC.GAME_STORAGE_REMOVE, (_, gameId, version, key) => {
    updateStorage(gameId, version, (data) => {
      delete data[key];
    });
  });

  ipcMain.on(IPC.GAME_STORAGE_CLEAR, (_, gameId, version) => {
    updateStorage(gameId, version, (data) => {
      for (const k in data) delete data[k];
    });
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

    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const encrypted = isEncryptedStorageEnabled(gameId, version);
        data = parseStorageFile(content, gameId, version, encrypted);
      } catch {
        console.warn(
          `[Storage] Corrupt storage file for ${gameId} @ ${version}, resetting.`,
        );
      }
    }

    updateFn(data);
    const encrypted = isEncryptedStorageEnabled(gameId, version);
    const finalContent = encrypted
      ? encryptStoragePayload(data, gameId, version)
      : JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, finalContent, "utf-8");
  } catch (error) {
    console.error(
      `[Storage] Failed to save data for ${gameId} @ ${version}:`,
      error,
    );
  }
}
