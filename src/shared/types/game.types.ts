export type GameApiAction =
  | "auth"
  | "player.getInfo"
  | "room.getInfo"
  | "message.send"
  | "message.broadcast"
  | "game.ready"
  | "game.end"
  | "achievement.unlock"
  | "achievement.list"
  | "stats.report";

export type GameApiEventAction =
  | "event.message"
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
  error?: string;
}

export interface GameApiEvent {
  id: string;
  type: "event";
  action: GameApiEventAction;
  payload: unknown;
}

export type GameApiMessage = GameApiRequest | GameApiResponse | GameApiEvent;
