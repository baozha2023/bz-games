import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { roomServer } from "../services/RoomServer";
import { roomClient } from "../services/RoomClient";
import { storeService } from "../services/StoreService";
import { gameManager } from "../services/GameManager";
import crypto from "crypto";
import type { RoomMessage, ChatPayload } from "../../shared/types";

export function registerRoomIpc() {
  ipcMain.handle(
    IPC.ROOM_CREATE,
    async (_, gameId: string, version?: string) => {
      const port = await roomServer.start(gameId, version);
      await roomClient.connect(`127.0.0.1:${port}`, gameId, version);
      return { port };
    },
  );

  ipcMain.handle(
    IPC.ROOM_JOIN,
    async (_, gameId: string, address: string, version?: string) => {
      return await roomClient.connect(address, gameId, version);
    },
  );

  ipcMain.handle(IPC.ROOM_LEAVE, async () => {
    const localPlayerId = storeService.getSettings().playerId;
    if (roomServer.room?.hostId === localPlayerId) {
      await roomServer.stop();
      roomClient.disconnect();
      return;
    }
    roomClient.disconnect();
    if (roomServer.room) {
      await roomServer.stop();
    }
  });

  ipcMain.handle(IPC.ROOM_READY, async () => {
    roomClient.send({ type: "room:player:ready", payload: {} });
  });

  ipcMain.handle(IPC.ROOM_UNREADY, async () => {
    roomClient.send({ type: "room:player:unready", payload: {} });
  });

  ipcMain.handle(IPC.ROOM_START, async () => {
    if (roomServer.room) {
      roomServer.room.state = "playing";
      roomServer.broadcast({ type: "room:game:start", payload: {} });
      roomServer.broadcast({
        type: "room:state:sync",
        payload: roomServer.room,
      });
      await gameManager.launch(
        roomServer.room.gameId,
        roomServer.room.gameVersion,
      );
    }
  });

  ipcMain.handle(IPC.ROOM_SET_ADDRESS, async (_, address: string) => {
    if (roomServer.room) {
      roomServer.room.hostPublicAddress = address;
      roomServer.broadcast({
        type: "room:state:sync",
        payload: roomServer.room,
      });
    }
  });

  ipcMain.handle(IPC.ROOM_GET_STATE, async () => {
    if (roomServer.room) return roomServer.room;
    if (roomClient.room) return roomClient.room;
    return null;
  });

  ipcMain.handle(
    IPC.ROOM_SEND_CHAT,
    async (_, content: string, type: "text" | "audio" = "text") => {
      const settings = storeService.getSettings();
      const msg: RoomMessage<ChatPayload> = {
        type: "room:chat",
        payload: {
          id: crypto.randomUUID(),
          senderId: settings.playerId,
          senderName: settings.playerName,
          content,
          contentType: type,
          timestamp: Date.now(),
        },
      };
      roomClient.send(msg);
    },
  );

  ipcMain.handle(IPC.ROOM_KICK_PLAYER, async (_, playerId: string) => {
    const hostId = storeService.getSettings().playerId;
    return roomServer.kickPlayer(hostId, playerId);
  });
}
