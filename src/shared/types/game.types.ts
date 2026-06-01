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

export type GameApiErrorCode =
  | "UNKNOWN_ACTION"
  | "INVALID_PAYLOAD"
  | "NOT_IN_ROOM"
  | "MISSING_TARGET"
  | "TARGET_SELF"
  | "TARGET_NOT_FOUND"
  | "MESSAGE_TOO_LARGE"
  | "BATCH_TOO_LARGE"
  | "EMPTY_BATCH";

export interface GameApiError {
  code: GameApiErrorCode;
  message: string;
  detail?: unknown;
}

export interface GameApiCapabilities {
  protocolVersion: 2;
  protocolName: "bz-game-api-v2";
  maxMessageBytes: number;
  maxBatchMessages: number;
  supportsPublish: boolean;
  supportsBatch: boolean;
  supportsAck: boolean;
  supportsSubscribe: boolean;
  supportsDelivery: boolean;
  supportsBinaryContentType: boolean;
}

export interface GameApiEvent {
  id: string;
  type: "event";
  action: GameApiEventAction;
  payload: unknown;
}

export type GameApiMessage = GameApiRequest | GameApiResponse | GameApiEvent;
