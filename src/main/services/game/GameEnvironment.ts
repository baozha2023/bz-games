import path from "path";
import fs from "fs";
import { app } from "electron";
import { logger } from "../../utils/logger";
import type { ResolvedGameManifest as GameManifest } from "../../../shared/game-manifest";
import type { AppSettings } from "../../../shared/types";
import {
  buildGameProcessEnvironment,
  buildWebGameConfig,
  type GameLaunchContext,
} from "../../../shared/game-launch";
import { findMatchingRoom } from "../room/RoomContext";

export class GameEnvironment {
  static prepare(
    id: string,
    manifest: GameManifest,
    port: number,
    token: string,
    settings: AppSettings,
  ): NodeJS.ProcessEnv {
    return buildGameProcessEnvironment(
      process.env,
      manifest.env,
      this.createLaunchContext(id, manifest, port, token, settings),
    );
  }

  static writeConfig(
    versionPath: string,
    id: string,
    manifest: GameManifest,
    port: number,
    token: string,
    settings: AppSettings,
  ): void {
    try {
      const configPath = path.join(versionPath, "bz-config.js");
      const config = buildWebGameConfig(
        this.createLaunchContext(id, manifest, port, token, settings),
      );
      const configContent = `window.BZ_CONFIG = ${JSON.stringify(config)};`;
      fs.writeFileSync(configPath, configContent, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch (e) {
      logger.error(`[GameEnvironment] Failed to write config file`, e);
      throw e;
    }
  }

  static removeConfig(versionPath: string): void {
    try {
      const configPath = path.join(versionPath, "bz-config.js");
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        logger.info(`[GameEnvironment] Removed config: ${configPath}`);
      }
    } catch (e) {
      logger.warn(`[GameEnvironment] Failed to remove config file`, e);
    }
  }

  private static createLaunchContext(
    id: string,
    manifest: GameManifest,
    port: number,
    token: string,
    settings: AppSettings,
  ): GameLaunchContext {
    const room = findMatchingRoom(id, manifest.version);
    return {
      locale: settings.language,
      platformVersion: app.getVersion(),
      apiPort: port,
      apiToken: token,
      playerId: settings.playerId,
      playerName: settings.playerName,
      playerAvatar: settings.avatar || "",
      gameId: id,
      gameVersion: manifest.version,
      roomId: room?.id || "",
      isHost: !!room && room.hostId === settings.playerId,
      isMultiple: !!room,
    };
  }
}
