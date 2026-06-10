import type { NicknameStyle } from "./store.types";

export type RoomMessageType =
  | "room:join"
  | "room:join:ack"
  | "room:join:refused"
  | "room:password:probe"
  | "room:password:probe:ack"
  | "room:player:joined"
  | "room:player:left"
  | "room:player:ready"
  | "room:player:unready"
  | "room:state:sync"
  | "room:game:start" // Server → All：游戏开始
  | "room:game:end" // Client → Server / Server → All：游戏结束
  | "room:disbanded" // Server → All：房间已解散
  | "room:disconnected"
  | "room:player:reconnect-needed" // Client → Server：通知服务器某玩家需要重连
  | "room:kicked" // Server → Target：被踢通知
  | "room:player:kicked" // Server → All：玩家被踢通知
  | "room:connection-status"
  | "room:relay:latency"
  | "relay:join"
  | "relay:join:ack"
  | "relay:room:password:probe"
  | "relay:room:password:probe:ack"
  | "relay:latency:ping"
  | "relay:latency:probe"
  | "relay:latency:pong"
  | "relay:closed"
  | "relay:error"
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
  senderStyle?: NicknameStyle;
  content: string;
  contentType?: "text" | "audio" | "image" | "game_report";
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
  hostConnectionMode?: "lan" | "relay";
  hostPublicAddress?: string;
  hasPassword?: boolean;
  players: PlayerInRoom[];
  maxPlayers: number;
  state: "waiting" | "starting" | "playing" | "ended";
  /** 需要重新连接游戏进程的玩家 ID 列表，由 RoomServer 管理 */
  reconnectPlayerIds: string[];
  createdAt: number;
}

export type RoomDiscoverySource = "physical_lan" | "virtual_lan" | "relay";

export interface DiscoveredRoom {
  id: string;
  source: RoomDiscoverySource;
  name: string;
  gameId: string;
  gameName?: string;
  gameVersion: string;
  hostId: string;
  hostName: string;
  hostStyle?: NicknameStyle;
  address: string;
  playerCount: number;
  maxPlayers: number;
  state: RoomInfo["state"];
  updatedAt: number;
  hasPassword?: boolean;
  canJoin?: boolean;
  joinBlockReason?: "game_missing" | "version_mismatch" | "room_full" | "game_started" | "own_room" | "unknown";
}

export interface RoomJoinValidationResult {
  canJoin: boolean;
  reason?: "game_missing" | "version_mismatch" | "room_full" | "game_started" | "own_room" | "unknown";
  message?: string;
}

export interface PlayerInRoom {
  id: string;
  name: string;
  avatar?: string;
  avatarFrame?: string;
  nicknameStyle?: NicknameStyle;
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
  playerNicknameStyle?: NicknameStyle;
  gameId: string;
  gameVersion: string;
  password?: string;
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
    | "password_required"
    | "password_incorrect"
    | "unknown";
  message: string;
}

export interface RoomPasswordProbeAckPayload {
  hasPassword: boolean;
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

export interface RoomRelayLatencyPayload {
  latencyMs: number | null;
  mode: "host" | "guest";
  measuredAt: number;
}

export interface RoomEvent {
  type: RoomMessageType;
  payload: unknown;
}
