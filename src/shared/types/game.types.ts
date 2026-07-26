export enum GameType {
  Singleplayer = "singleplayer",
  Multiplayer = "multiplayer",
  SingleMultiple = "singlemultiple",
  NetworkGame = "networkgame",
}

export interface GameLaunchFailurePayload {
  id: string;
  code: string;
  params?: Record<string, unknown>;
  detail?: string;
}

export type GameApiAction =
  | "auth"
  | "player.getInfo"
  | "room.getInfo"
  | "message.send"
  | "message.broadcast"
  | "message.publish"
  | "message.batch"
  | "message.subscribe"
  | "message.unsubscribe"
  | "game.ready"
  | "game.end"
  | "game.report"
  | "achievement.unlock"
  | "achievement.list"
  | "stats.report";

export type GameApiEventAction =
  | "event.message"
  | "event.messageAck"
  | "event.playerJoined"
  | "event.playerLeft"
  | "event.gameEnd";

export interface GameApiRequest {
  id: string;
  type: "request";
  action: GameApiAction;
  payload?: unknown;
}

export interface GameApiResponse {
  id: string;
  type: "response";
  action: GameApiAction;
  payload?: unknown;
  error?: string | GameApiError;
}

export enum GameApiErrorCode {
  UnknownAction = "UNKNOWN_ACTION",
  InvalidPayload = "INVALID_PAYLOAD",
  NotInRoom = "NOT_IN_ROOM",
  MissingTarget = "MISSING_TARGET",
  TargetSelf = "TARGET_SELF",
  TargetNotFound = "TARGET_NOT_FOUND",
  MessageTooLarge = "MESSAGE_TOO_LARGE",
  BatchTooLarge = "BATCH_TOO_LARGE",
  EmptyBatch = "EMPTY_BATCH",
}

export interface GameApiError {
  code: GameApiErrorCode;
  message: string;
  detail?: unknown;
}

export interface GameApiCapabilities {
  protocolVersion: 2;
  protocolName: "bz-game-api-v2";
  maxMessageBytes: number;
  maxBinaryBytes: number;
  maxBatchMessages: number;
  supportsPublish: boolean;
  supportsBatch: boolean;
  supportsAck: boolean;
  supportsSubscribe: boolean;
  supportsDelivery: boolean;
  supportsBinaryContentType: boolean;
  supportsBinaryFrames: boolean;
}

export interface GameApiEvent {
  id: string;
  type: "event";
  action: GameApiEventAction;
  payload: unknown;
}

export type GameApiMessage = GameApiRequest | GameApiResponse | GameApiEvent;
