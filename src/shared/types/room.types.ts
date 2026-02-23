export type RoomMessageType =
  | 'room:join'            
  | 'room:join:ack'        
  | 'room:join:refused'    
  | 'room:player:joined'   
  | 'room:player:left'     
  | 'room:player:ready'    
  | 'room:player:unready'  
  | 'room:state:sync'      
  | 'room:game:start'      // Server → All：游戏开始
  | 'room:game:end'        // Client → Server / Server → All：游戏结束
  | 'room:disbanded'       // Server → All：房间已解散
  | 'room:chat'            // 双向：房间内聊天消息
  | 'game:message:relay'   
  | 'game:broadcast:relay';

export interface RoomMessage<T = unknown> {
  type: RoomMessageType;
  payload: T;
}

export interface ChatPayload {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  contentType?: 'text' | 'audio';
  timestamp: number;
  isSystem?: boolean;
}

export interface RoomInfo {
  id: string;
  gameId: string;
  gameVersion: string; // Add game version to RoomInfo
  hostId: string;
  hostPublicAddress?: string;         
  players: PlayerInRoom[];
  maxPlayers: number;
  state: 'waiting' | 'starting' | 'playing' | 'ended';
  createdAt: number;
}

export interface PlayerInRoom {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
  isReady: boolean;
  joinedAt: number;
}

// room:join payload
export interface RoomJoinPayload {
  playerId: string;
  playerName: string;
  playerAvatar?: string;
  gameId: string;
  gameVersion: string;
}

export interface RoomJoinAckPayload {
  room: RoomInfo;
  yourPlayerId: string;
}

export interface RoomJoinRefusedPayload {
  reason: 'room_full' | 'game_started' | 'game_id_mismatch' | 'version_mismatch' | 'room_closed' | 'unknown';
  message: string;
}

export interface RoomEvent {
  type: RoomMessageType;
  payload: unknown;
}
