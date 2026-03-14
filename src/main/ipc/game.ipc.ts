import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import {
  GameLoader,
  type ManualManifestDraft,
} from "../services/GameLoader";
import { gameManager } from "../services/GameManager";
import { storeService } from "../services/StoreService";
import { logger } from "../utils/logger";

const VIDEO_MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
};

async function readManifestAssetDataUrl(
  id: string,
  version: string | undefined,
  field: "cover" | "icon" | "video",
): Promise<string | null> {
  const versionPath = await GameLoader.getVersionPath(id, version);
  if (!versionPath) {
    return null;
  }
  const jsonPath = path.join(versionPath, "game.json");
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const relativePath = raw[field];
  if (!relativePath) {
    return null;
  }
  const absolutePath = path.join(versionPath, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  const b64 = fs.readFileSync(absolutePath, "base64");
  const ext = path.extname(absolutePath).slice(1).toLowerCase();
  if (field === "video") {
    const mime = VIDEO_MIME_BY_EXT[ext] || "video/mp4";
    return `data:${mime};base64,${b64}`;
  }
  return `data:image/${ext};base64,${b64}`;
}

export function registerGameIpc() {
  ipcMain.handle(IPC.GAME_LOAD, async (_, sourcePath?: string) => {
    if (sourcePath) {
      return await GameLoader.loadGameFromPath(sourcePath);
    }
    return await GameLoader.loadGameFromDialog();
  });

  ipcMain.handle(IPC.GAME_PREPARE_IMPORT, async (_, sourcePath: string) => {
    return await GameLoader.prepareImportFromPath(sourcePath);
  });

  ipcMain.handle(
    IPC.GAME_LOAD_WITH_MANIFEST,
    async (_, sourcePath: string, draft: ManualManifestDraft) => {
      return await GameLoader.loadGameFromPathWithManifest(sourcePath, draft);
    },
  );

  ipcMain.handle(IPC.GAME_CHECK_ID_EXISTS, async (_, id: string) => {
    return await GameLoader.checkGameIdExists(id);
  });

  ipcMain.handle(IPC.GAME_GET_RECORDS, async () => {
    return storeService.getGames();
  });

  ipcMain.handle(
    IPC.GAME_REMOVE,
    async (_, id: string, versions?: string[]) => {
      await GameLoader.removeGame(id, versions);
    },
  );

  ipcMain.handle(IPC.GAME_TOGGLE_FAVORITE, async (_, id: string) => {
    return storeService.toggleFavorite(id);
  });

  ipcMain.handle(IPC.GAME_LAUNCH, async (_, id: string, version?: string) => {
    return gameManager.launch(id, version);
  });

  ipcMain.handle(IPC.GAME_GET_ALL, async () => {
    return await GameLoader.getAllGames();
  });

  ipcMain.handle(IPC.GAME_REORDER, async (_, gameIds: string[]) => {
    const games = await storeService.getGames();
    const sortedGames = gameIds
      .map((id) => games.find((g) => g.id === id))
      .filter((g): g is any => !!g);
    const remainingGames = games.filter((g) => !gameIds.includes(g.id));
    storeService.saveGames([...sortedGames, ...remainingGames]);
    return true;
  });

  ipcMain.handle(IPC.GAME_GET_VERSIONS, async (_, id: string) => {
    const record = await GameLoader.getGameRecord(id);
    return record ? record.versions.map((v) => v.version) : [];
  });

  ipcMain.handle(
    IPC.GAME_GET_COVER,
    async (_, id: string, version?: string) => {
      try {
        return await readManifestAssetDataUrl(id, version, "cover");
      } catch (e) {
        logger.error(
          `[GameIPC] Failed to read cover for ${id} version ${version || "latest"}`,
          e,
        );
      }
      return null;
    },
  );

  ipcMain.handle(
    IPC.GAME_GET_VIDEO,
    async (_, id: string, version?: string) => {
      try {
        return await readManifestAssetDataUrl(id, version, "video");
      } catch (e) {
        logger.error(
          `[GameIPC] Failed to read video for ${id} version ${version || "latest"}`,
          e,
        );
      }
      return null;
    },
  );

  ipcMain.handle(IPC.GAME_GET_ICON, async (_, id: string, version?: string) => {
    try {
      return await readManifestAssetDataUrl(id, version, "icon");
    } catch (e) {
      logger.error(
        `[GameIPC] Failed to read icon for ${id} version ${version || "latest"}`,
        e,
      );
    }
    return null;
  });

  ipcMain.handle(
    IPC.GAME_GET_MANIFEST,
    async (_, id: string, version?: string) => {
      try {
        const manifest = await GameLoader.getManifest(id, version);
        return manifest;
      } catch (e) {
        logger.error(
          `[GameIPC] Failed to get manifest for ${id} version ${version || "latest"}`,
          e,
        );
        return null;
      }
    },
  );
}
