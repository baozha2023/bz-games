import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import { roomServer } from '../services/RoomServer';
import { roomClient } from '../services/RoomClient';
import { gameManager } from '../services/GameManager';
import { storeService } from '../services/StoreService';
import crypto from 'crypto';
import type { RoomMessage } from '../../shared/types';

export function registerRoomIpc() {
  ipcMain.handle(IPC.ROOM_CREATE, async (_, gameId: string, version?: string) => {
    const port = await roomServer.start(gameId, version);
    
    // Connect host client to local server
    await roomClient.connect(`127.0.0.1:${port}`, gameId, version);
    
    return { port };
  });

  ipcMain.handle(IPC.ROOM_JOIN, async (_, gameId: string, address: string, version?: string) => {
    return await roomClient.connect(address, gameId, version);
  });

  ipcMain.handle(IPC.ROOM_LEAVE, async () => {
    roomClient.disconnect();
    roomServer.stop();
  });

  ipcMain.handle(IPC.ROOM_READY, async () => {
    roomClient.send({ type: 'room:player:ready', payload: {} });
  });

  ipcMain.handle(IPC.ROOM_UNREADY, async () => {
    roomClient.send({ type: 'room:player:unready', payload: {} });
  });

  ipcMain.handle(IPC.ROOM_START, async () => {
    // Only host can trigger start directly via server logic
    if (roomServer.room) {
      roomServer.room.state = 'playing';
      roomServer.broadcast({ type: 'room:game:start', payload: {} });
      roomServer.broadcast({ type: 'room:state:sync', payload: roomServer.room });
      
      // Host also starts the game using the room's version
      gameManager.launch(roomServer.room.gameId, roomServer.room.gameVersion);
    }
  });

  ipcMain.handle(IPC.ROOM_SET_ADDRESS, async (_, address: string) => {
    if (roomServer.room) {
      roomServer.room.hostPublicAddress = address;
      roomServer.broadcast({ type: 'room:state:sync', payload: roomServer.room });
    }
  });

  ipcMain.handle(IPC.ROOM_GET_STATE, async () => {
    // If host, return directly
    if (roomServer.room) return roomServer.room;
    
    // If client, we rely on event syncing.
    // Ideally we could ask server via RoomClient request/response, 
    // but protocol is async. 
    // For now return null, UI waits for sync event.
    return null;
  });

  ipcMain.handle(IPC.ROOM_SEND_CHAT, async (_, content: string) => {
    const settings = storeService.getSettings();
    const msg: RoomMessage = {
      type: 'room:chat',
      payload: {
        id: crypto.randomUUID(),
        senderId: settings.playerId,
        senderName: settings.playerName,
        content,
        timestamp: Date.now()
      }
    };
    roomClient.send(msg);
  });
}
