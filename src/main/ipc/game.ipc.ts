import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { IPC } from "../../shared/ipc-channels";
import { GameLoader } from "../services/GameLoader";
import { gameManager } from "../services/GameManager";
import { storeService } from "../services/StoreService";
import { logger } from "../utils/logger";

export function registerGameIpc() {
  ipcMain.handle(IPC.GAME_LOAD, async () => {
    return await GameLoader.loadGameFromDialog();
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
    // Sort games based on the provided ID list
    const sortedGames = gameIds
      .map((id) => games.find((g) => g.id === id))
      .filter((g): g is any => !!g);

    // Append any games not in the list (just in case)
    const remainingGames = games.filter((g) => !gameIds.includes(g.id));

    storeService.saveGames([...sortedGames, ...remainingGames]);
    return true;
  });

  // Not in IPC enum but used? Or maybe it should be added to IPC enum
  ipcMain.handle(IPC.GAME_GET_VERSIONS, async (_, id: string) => {
    const record = await GameLoader.getGameRecord(id);
    return record ? record.versions.map((v) => v.version) : [];
  });

  ipcMain.handle(
    IPC.GAME_GET_COVER,
    async (_, id: string, version?: string) => {
      try {
        const versionPath = await GameLoader.getVersionPath(id, version);
        if (!versionPath) return null;

        const jsonPath = path.join(versionPath, "game.json");
        if (!fs.existsSync(jsonPath)) return null;

        const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        if (!raw.cover) return null;

        const coverPath = path.join(versionPath, raw.cover);
        if (fs.existsSync(coverPath)) {
          const b64 = fs.readFileSync(coverPath, "base64");
          const ext = path.extname(coverPath).slice(1);
          return `data:image/${ext};base64,${b64}`;
        }
      } catch (e) {
        logger.error(
          `[GameIPC] Failed to read cover for ${id} version ${version || "latest"}`,
          e,
        );
      }
      return null;
    },
  );

  ipcMain.handle(IPC.GAME_GET_ICON, async (_, id: string, version?: string) => {
    try {
      const versionPath = await GameLoader.getVersionPath(id, version);
      if (!versionPath) return null;

      const jsonPath = path.join(versionPath, "game.json");
      if (!fs.existsSync(jsonPath)) return null;

      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      if (!raw.icon) return null;

      const iconPath = path.join(versionPath, raw.icon);
      if (fs.existsSync(iconPath)) {
        const b64 = fs.readFileSync(iconPath, "base64");
        const ext = path.extname(iconPath).slice(1);
        return `data:image/${ext};base64,${b64}`;
      }
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
