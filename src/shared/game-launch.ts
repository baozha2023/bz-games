import path from "path";
import type { SupportedLocale } from "./localization";

export type GameEntryMode = "url" | "serve" | "html" | "native";

const PRIVATE_ENV_PREFIXES = ["ELECTRON_", "NODE_", "NPM_", "VSCODE_"];

export interface GameLaunchContext {
  locale: SupportedLocale;
  platformVersion: string;
  apiPort: number;
  apiToken: string;
  playerId: string;
  playerName: string;
  playerAvatar: string;
  gameId: string;
  gameVersion: string;
  roomId: string;
  isHost: boolean;
  isMultiple: boolean;
}

export function resolveGameEntryMode(entry: string): GameEntryMode {
  if (entry === "url" || entry === "serve") return entry;
  const extension = path.extname(entry).toLowerCase();
  return extension === ".html" || extension === ".htm" ? "html" : "native";
}

export function buildGameProcessEnvironment(
  processEnvironment: NodeJS.ProcessEnv,
  manifestEnvironment: Record<string, string> | undefined,
  context: GameLaunchContext,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(processEnvironment)) {
    const upper = key.toUpperCase();
    if (!PRIVATE_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
      environment[key] = value;
    }
  }
  return Object.assign(environment, manifestEnvironment || {}, {
    BZ_PLATFORM: "1",
    BZ_PLATFORM_VERSION: context.platformVersion,
    BZ_LOCALE: context.locale,
    BZ_API_PORT: context.apiPort.toString(),
    BZ_API_TOKEN: context.apiToken,
    BZ_PLAYER_ID: context.playerId,
    BZ_PLAYER_NAME: context.playerName,
    BZ_PLAYER_AVATAR: context.playerAvatar,
    BZ_GAME_ID: context.gameId,
    BZ_GAME_VERSION: context.gameVersion,
    BZ_ROOM_ID: context.roomId,
    BZ_IS_HOST: context.isHost ? "1" : "0",
    BZ_IS_MULTIPLE: context.isMultiple ? "1" : "0",
  });
}

export function buildWebGameConfig(context: GameLaunchContext) {
  return {
    locale: context.locale,
    apiPort: context.apiPort.toString(),
    token: context.apiToken,
    playerId: context.playerId,
    playerName: context.playerName,
    playerAvatar: context.playerAvatar,
    gameId: context.gameId,
    gameVersion: context.gameVersion,
    platformVersion: context.platformVersion,
    roomId: context.roomId,
    isHost: context.isHost,
    isMultiple: context.isMultiple,
  };
}
