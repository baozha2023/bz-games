import path from "path";
import fs from "fs";
import { roomClient } from "./RoomClient";
import { logger } from "../utils/logger";
import type { GameManifest } from "../../shared/game-manifest";
import type { AppSettings } from "../../shared/types";

export class GameEnvironment {
  static prepare(
    id: string,
    manifest: GameManifest,
    port: number,
    token: string,
    settings: AppSettings,
  ): NodeJS.ProcessEnv {
    const isHost =
      roomClient.room && roomClient.room.hostId === settings.playerId;

    return Object.assign({}, process.env, manifest.env || {}, {
      BZ_PLATFORM: "1",
      BZ_PLATFORM_VERSION: "1.0.0",
      BZ_API_PORT: port.toString(),
      BZ_API_TOKEN: token,
      BZ_PLAYER_ID: settings.playerId,
      BZ_PLAYER_NAME: settings.playerName,
      BZ_PLAYER_AVATAR: settings.avatar || "",
      BZ_GAME_ID: id,
      BZ_ROOM_ID: roomClient.room ? roomClient.room.id : "",
      BZ_IS_HOST: isHost ? "1" : "0",
    });
  }

  static writeConfig(
    versionPath: string,
    port: number,
    token: string,
    settings: AppSettings,
  ): void {
    try {
      const room = roomClient.room;
      const isHost = !!room && room.hostId === settings.playerId;
      const isMultiple = !!room;
      const configPath = path.join(versionPath, "bz-config.js");
      const configContent = `window.BZ_CONFIG = { 
        apiPort: '${port}', 
        token: '${token}',
        playerId: '${settings.playerId}',
        playerName: ${JSON.stringify(settings.playerName)},
        playerAvatar: ${JSON.stringify(settings.avatar || "")},
        roomId: ${JSON.stringify(room ? room.id : "")},
        isHost: ${JSON.stringify(isHost)},
        isMultiple: ${JSON.stringify(isMultiple)}
      };`;
      fs.writeFileSync(configPath, configContent);
    } catch (e) {
      logger.warn(`[GameEnvironment] Failed to write config file`, e);
    }
  }
}
