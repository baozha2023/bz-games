import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { getGamesDir } from "../utils/appPath";

// 存储路径策略：games/<id>/<version>/gamedata.json
// 这样可以确保不同版本的存档是隔离的
function getStoragePath(gameId: string, version: string): string {
  // 默认版本处理
  const ver = version || "latest";
  return path.join(getGamesDir(), gameId, ver, "gamedata.json");
}

export function registerStorageIpc() {
  // 初始化：读取数据 (同步返回)
  ipcMain.on(IPC.GAME_STORAGE_INIT, (event, gameId, version) => {
    try {
      if (!gameId) {
        event.returnValue = {};
        return;
      }

      const filePath = getStoragePath(gameId, version);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        event.returnValue = JSON.parse(content);
      } else {
        event.returnValue = {};
      }
    } catch (error) {
      console.error(
        `[Storage] Failed to load data for ${gameId} @ ${version}:`,
        error,
      );
      event.returnValue = {};
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

    // 确保目录存在
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    let data: Record<string, any> = {};

    if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (e) {
        console.warn(
          `[Storage] Corrupt storage file for ${gameId} @ ${version}, resetting.`,
        );
      }
    }

    updateFn(data);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(
      `[Storage] Failed to save data for ${gameId} @ ${version}:`,
      error,
    );
  }
}
