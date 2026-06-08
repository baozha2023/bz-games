import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { roomServer } from "../services/room/RoomServer";
import { roomClient } from "../services/room/RoomClient";
import { storeService } from "../services/storage/StoreService";
import { gameManager } from "../services/game/GameManager";
import { mainWindow } from "../window";
import { createChatWindow, closeChatWindow, sendRoomEventToChat, getCachedChatHistory } from "../chat-window";
import crypto from "crypto";
import type { RoomMessage, ChatPayload, DiscoveredRoom } from "../../shared/types";
import { roomDiscoveryService } from "../services/room/RoomDiscoveryService";
import { relayRoomService } from "../services/room/RelayRoomService";

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
      const localPlayerId = storeService.getSettings().playerId;
      if (roomServer.room?.hostId === localPlayerId) {
        return { success: false, error: "own_room", message: "Cannot join your own room" };
      }
      return await roomClient.connect(address, gameId, version);
    },
  );

  ipcMain.handle(IPC.ROOM_LEAVE, async () => {
    relayRoomService.disconnect();
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
    const localPlayerId = storeService.getSettings().playerId;
    roomClient.send({ type: "room:player:ready", payload: { playerId: localPlayerId } });
  });

  ipcMain.handle(IPC.ROOM_UNREADY, async () => {
    const localPlayerId = storeService.getSettings().playerId;
    roomClient.send({ type: "room:player:unready", payload: { playerId: localPlayerId } });
  });

  ipcMain.handle(IPC.ROOM_START, async () => {
    if (roomServer.room && roomServer.room.state === "waiting") {
      roomServer.room.state = "playing";
      roomServer.broadcast({ type: "room:game:start", payload: {} });
      roomServer.broadcastState();
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
    async (_, content: string, type: "text" | "audio" | "image" = "text", images?: string[]) => {
      const settings = storeService.getSettings();
      const msg: RoomMessage<ChatPayload> = {
        type: "room:chat",
        payload: {
          id: crypto.randomUUID(),
          senderId: settings.playerId,
          senderName: settings.playerName,
          senderStyle: settings.nicknameStyle,
          content,
          contentType: type,
          images: images && images.length > 0 ? images : undefined,
          timestamp: Date.now(),
        },
      };

      if (roomServer.room && roomServer.room.hostId === settings.playerId) {
        const hostSocket = roomServer.getSocketByPlayerId(settings.playerId);
        roomServer.broadcast(msg, hostSocket);
        mainWindow?.webContents.send(IPC.ROOM_EVENT, msg);
        sendRoomEventToChat(msg);
      } else {
        roomClient.send(msg);
      }
    },
  );

  ipcMain.handle(IPC.ROOM_KICK_PLAYER, async (_, playerId: string) => {
    const hostId = storeService.getSettings().playerId;
    return roomServer.kickPlayer(hostId, playerId);
  });

  ipcMain.handle(IPC.ROOM_RECONNECT, async () => {
    const playerId = storeService.getSettings().playerId;
    if (
      roomClient.room &&
      roomClient.room.reconnectPlayerIds.includes(playerId)
    ) {
      await gameManager.launch(
        roomClient.room.gameId,
        roomClient.room.gameVersion,
      );
    }
  });

  ipcMain.handle(IPC.ROOM_DISCOVER_LAN, async () => {
    return await roomDiscoveryService.discoverLanRooms();
  });

  ipcMain.handle(IPC.ROOM_DISCOVER_RELAY, async () => {
    return await roomDiscoveryService.discoverRelayRooms();
  });

  ipcMain.handle(IPC.ROOM_MEASURE_RELAY_LATENCY, async () => {
    return await roomDiscoveryService.measureRelayLatency();
  });

  ipcMain.handle(IPC.ROOM_VALIDATE_DISCOVERED, async (_, room: DiscoveredRoom) => {
    return roomDiscoveryService.validateDiscoveredRoom(room);
  });

  ipcMain.handle(IPC.ROOM_ENABLE_RELAY_HOST, async () => {
    roomServer.disconnectRemotePlayersForModeSwitch();
    return await relayRoomService.enableHostRoom();
  });

  ipcMain.handle(IPC.ROOM_DISABLE_RELAY_HOST, async () => {
    relayRoomService.disconnect();
    if (roomServer.room) {
      roomServer.room.hostPublicAddress = undefined;
    }
    roomServer.disconnectRemotePlayersForModeSwitch();
  });

  ipcMain.handle(
    IPC.ROOM_POP_OUT_CHAT,
    async (_, chatHistory: ChatPayload[]) => {
      createChatWindow(chatHistory);
    },
  );

  ipcMain.handle(IPC.ROOM_POP_IN_CHAT, async () => {
    closeChatWindow();
  });

  ipcMain.handle(IPC.ROOM_GET_CHAT_HISTORY, async () => {
    return getCachedChatHistory();
  });
}
