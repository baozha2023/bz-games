import { WebSocket } from 'ws';
import type { RoomMessage, RoomJoinPayload, RoomJoinAckPayload, RoomJoinRefusedPayload, RoomInfo } from '../../shared/types';
import { logger } from '../utils/logger';
import { storeService } from './StoreService';
import { mainWindow } from '../window';
import { IPC } from '../../shared/ipc-channels';

type ConnectResult = { success: boolean; error?: string; message?: string };

export class RoomClient {
  private ws: WebSocket | null = null;
  public address = '';
  public room: RoomInfo | null = null;
  private gameId = '';
  private gameVersion = '';
  
  private connectionResolver: ((result: ConnectResult) => void) | null = null;
  private msgHandler: ((gameId: string, msg: RoomMessage) => void) | null = null;
  private onGameStart: ((gameId: string, version?: string) => void) | null = null;
  private onGameStop: ((gameId: string) => void) | null = null;

  async connect(address: string, gameId: string, gameVersion?: string): Promise<ConnectResult> {
    this.cleanup();
    
    let url = address.trim();
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = `ws://${url}`;
    }
    
    this.address = url;
    this.gameId = gameId;
    this.gameVersion = gameVersion || '';
    
    return new Promise((resolve) => {
      this.connectionResolver = resolve;
      
      try {
        const options = { rejectUnauthorized: false };
        this.ws = new WebSocket(this.address, options);
        
        this.setupWebSocketListeners();
        
        // Timeout
        setTimeout(() => {
          if (this.connectionResolver) {
            logger.error(`[RoomClient] Connection timed out to ${this.address}`);
            this.resolveConnection({ success: false, error: '连接超时 (15s)' });
          }
        }, 15000);

      } catch (e) {
        logger.error(`[RoomClient] Failed to connect`, e);
        this.resolveConnection({ success: false, error: '连接异常' });
      }
    });
  }

  private setupWebSocketListeners() {
    if (!this.ws) return;

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('error', (err) => this.handleError(err));
    this.ws.on('close', () => this.handleClose());
    this.ws.on('message', (data) => this.handleIncomingMessage(data));
  }

  private handleOpen() {
    logger.info(`[RoomClient] Connected to ${this.address}, sending join request...`);
    const settings = storeService.getSettings();
    const joinPayload: RoomJoinPayload = {
      playerId: settings.playerId,
      playerName: settings.playerName,
      playerAvatar: settings.avatar, // Added avatar
      gameId: this.gameId,
      gameVersion: this.gameVersion
    };
    this.send({ type: 'room:join', payload: joinPayload });
  }

  private handleError(err: Error) {
    logger.error(`[RoomClient] Error`, err);
    if (this.connectionResolver) {
      this.resolveConnection({ success: false, error: err.message || '连接错误' });
    }
  }

  private handleClose() {
    logger.info(`[RoomClient] Disconnected`);
    this.room = null;
    if (this.connectionResolver) {
      this.resolveConnection({ success: false, error: 'Closed before join' });
    }
    mainWindow?.webContents.send(IPC.ROOM_EVENT, { type: 'room:disconnected', payload: {} });
  }

  private handleIncomingMessage(data: any) {
    try {
      const msg = JSON.parse(data.toString()) as RoomMessage;
      this.processMessage(msg);
    } catch (e) {
      logger.error(`[RoomClient] Failed to parse message`, e);
    }
  }

  private processMessage(msg: RoomMessage) {
    // 1. Update local cache
    if (msg.type === 'room:state:sync') {
      this.room = msg.payload as RoomInfo;
    }

    // 2. Handle handshake
    if (this.connectionResolver) {
      this.handleHandshake(msg);
    }

    // 3. Forward to renderer
    mainWindow?.webContents.send(IPC.ROOM_EVENT, msg);

    // 4. Handle game lifecycle
    this.handleGameLifecycle(msg);
  }

  private handleHandshake(msg: RoomMessage) {
    if (msg.type === 'room:join:ack') {
      logger.info('[RoomClient] Join accepted');
      const ack = msg.payload as RoomJoinAckPayload;
      this.room = ack.room;
      this.resolveConnection({ success: true });
      // Sync initial state
      mainWindow?.webContents.send(IPC.ROOM_EVENT, { type: 'room:state:sync', payload: ack.room });
    } else if (msg.type === 'room:join:refused') {
      const payload = msg.payload as RoomJoinRefusedPayload;
      logger.warn('[RoomClient] Join refused:', payload.reason);
      this.resolveConnection({ success: false, error: payload.reason, message: payload.message });
    }
  }

  private handleGameLifecycle(msg: RoomMessage) {
    if (msg.type === 'room:game:start') {
      logger.info(`[RoomClient] Game start signal for ${this.gameId}`);
      this.onGameStart?.(this.gameId, this.room?.gameVersion);
    } else if (msg.type === 'room:game:end') {
      logger.info(`[RoomClient] Game stop signal for ${this.gameId}`);
      this.onGameStop?.(this.gameId);
    } else if (msg.type === 'game:message:relay' || msg.type === 'game:broadcast:relay') {
      this.msgHandler?.(this.gameId, msg);
    }
  }

  private resolveConnection(result: ConnectResult) {
    if (this.connectionResolver) {
      this.connectionResolver(result);
      this.connectionResolver = null;
    }
  }

  send(msg: RoomMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect() {
    this.cleanup();
    this.room = null;
  }

  private cleanup() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connectionResolver = null;
  }

  setMsgHandler(handler: (gameId: string, msg: RoomMessage) => void) {
    this.msgHandler = handler;
  }

  setStartGameHandler(handler: (gameId: string, version?: string) => void) {
    this.onGameStart = handler;
  }

  setStopGameHandler(handler: (gameId: string) => void) {
    this.onGameStop = handler;
  }
}

export const roomClient = new RoomClient();
