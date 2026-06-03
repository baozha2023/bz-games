export type RoomMessageType =
  | "room:join"
  | "room:join:ack"
  | "room:join:refused"
  | "room:player:joined"
  | "room:player:left"
  | "room:player:ready"
  | "room:player:unready"
  | "room:state:sync"
  | "room:game:start" // Server → All：游戏开始
  | "room:game:end" // Client → Server / Server → All：游戏结束
  | "room:disbanded" // Server → All：房间已解散
  | "room:disconnected"
  | "room:kicked" // Server → Target：被踢通知
  | "room:player:kicked" // Server → All：玩家被踢通知
  | "room:connection-status"
  | "room:chat" // 双向：房间内聊天消息
  | "room:chat:history:sync" // 主→聊天窗口：聊天历史同步
  | "game:message:relay"
  | "game:broadcast:relay"
  | "game:message:ack";

export interface RoomMessage<T = unknown> {
  type: RoomMessageType;
  payload: T;
}

export interface ChatPayload {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  contentType?: "text" | "audio" | "image";
  images?: string[];
  timestamp: number;
  isSystem?: boolean;
}

export type GameRelayMode = "direct" | "broadcast" | "publish" | "batch";
export type GameRelayDelivery = "reliable" | "ordered" | "latest" | "unreliable";

export interface GameRelayPayload {
  senderId: string;
  messageId: string;
  sentAt: number;
  data?: unknown;
  binary?: boolean;
  byteLength?: number;
  to?: string;
  targetPlayerId?: string;
  channel?: string;
  seq?: number;
  reliable?: boolean;
  mode?: GameRelayMode;
  delivery?: GameRelayDelivery;
  contentType?: "text" | "audio" | "binary" | "json";
  messages?: GameRelayPayload[];
  [key: string]: unknown;
}

export interface GameMessageAckPayload {
  messageId: string;
  senderId: string;
  to: string;
  sentAt: number;
}

export interface RoomInfo {
  id: string;
  gameId: string;
  gameVersion: string; // Add game version to RoomInfo
  hostId: string;
  hostPublicAddress?: string;
  players: PlayerInRoom[];
  maxPlayers: number;
  state: "waiting" | "starting" | "playing" | "ended";
  createdAt: number;
}

export interface PlayerInRoom {
  id: string;
  name: string;
  avatar?: string;
  avatarFrame?: string;
  isHost: boolean;
  isReady: boolean;
  joinedAt: number;
}

// room:join payload
export interface RoomJoinPayload {
  playerId: string;
  playerName: string;
  playerAvatar?: string;
  playerAvatarFrame?: string;
  gameId: string;
  gameVersion: string;
}

export interface RoomJoinAckPayload {
  room: RoomInfo;
  yourPlayerId: string;
}

export interface RoomJoinRefusedPayload {
  reason:
    | "room_full"
    | "game_started"
    | "game_id_mismatch"
    | "version_mismatch"
    | "room_closed"
    | "kicked"
    | "unknown";
  message: string;
}

export interface RoomKickedPayload {
  roomId: string;
  byPlayerId: string;
  reason?: string;
}

export type RoomConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "disconnected";

export interface RoomConnectionStatusPayload {
  status: RoomConnectionStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryMs?: number;
  reason?: string;
}

export interface RoomEvent {
  type: RoomMessageType;
  payload: unknown;
}
