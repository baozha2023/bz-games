import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { roomServer } from "../services/room/RoomServer";
import { roomClient } from "../services/room/RoomClient";
import { storeService } from "../services/storage/StoreService";
import { gameManager } from "../services/game/GameManager";
import { mainWindow } from "../window";
import {
  createChatWindow,
  closeChatWindow,
  sendRoomEventToChat,
  getCachedChatHistory,
} from "../chat-window";
import crypto from "crypto";
import type {
  RoomMessage,
  ChatPayload,
  DiscoveredRoom,
} from "../../shared/types";
import { roomDiscoveryService } from "../services/room/RoomDiscoveryService";
import { relayRoomService } from "../services/room/RelayRoomService";
import { roomPasswordProbeService } from "../services/room/RoomPasswordProbeService";
import { GameLoader } from "../services/game/GameLoader";
import { GameType } from "../../shared/types";

async function validateLocalRoomManifest(gameId: string, version?: string) {
  const manifest = await GameLoader.getManifest(gameId, version);
  if (
    !manifest ||
    manifest.id !== gameId ||
    (version !== undefined && manifest.version !== version)
  ) {
    throw { code: "manifestInvalid" };
  }
  if (
    manifest.type !== GameType.Multiplayer &&
    manifest.type !== GameType.SingleMultiple
  ) {
    throw { code: "gameTypeNotMultiplayer" };
  }
  if (!manifest.multiplayer) {
    throw { code: "multiplayerConfigMissing" };
  }
  GameLoader.assertPlatformCompatible(manifest);
  return manifest;
}

export function registerRoomIpc() {
  ipcMain.handle(
    IPC.ROOM_CREATE,
    async (_, gameId: string, version?: string) => {
      try {
        const port = await roomServer.start(gameId, version);
        const connected = await roomClient.connect(
          `127.0.0.1:${port}`,
          gameId,
          roomServer.room?.gameVersion,
        );
        if (!connected.success) {
          await roomServer.stop();
          return {
            success: false,
            error: connected.error || "localRoomConnectFailed",
          };
        }
        return { success: true, port };
      } catch (error: any) {
        await roomServer.stop().catch(() => undefined);
        return {
          success: false,
          error: error?.code || "createFailed",
          params: error?.params,
        };
      }
    },
  );

  ipcMain.handle(
    IPC.ROOM_JOIN,
    async (
      _,
      gameId: string,
      address: string,
      version?: string,
      password?: string,
    ) => {
      try {
        const manifest = await validateLocalRoomManifest(gameId, version);
        version = manifest.version;
      } catch (error: any) {
        return {
          success: false,
          error: error?.code || "manifestInvalid",
          params: error?.params,
        };
      }
      const localPlayerId = storeService.getSettings().playerId;
      if (roomServer.room?.hostId === localPlayerId) {
        const probe = await roomPasswordProbeService.probe(address);
        if (!probe.success || !probe.hostId) {
          return {
            success: false,
            error: probe.error || "probe_failed",
          };
        }
        if (probe.hostId === localPlayerId) {
          return {
            success: false,
            error: "own_room",
            message: "Cannot join your own room",
          };
        }

        try {
          roomClient.disconnect();
          relayRoomService.disconnect();
          await roomServer.stop();
        } catch {
          return {
            success: false,
            error: "close_current_room_failed",
            message: "Failed to close the current room",
          };
        }
      }
      return await roomClient.connect(address, gameId, version, password);
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
    roomClient.send({
      type: "room:player:ready",
      payload: { playerId: localPlayerId },
    });
  });

  ipcMain.handle(IPC.ROOM_UNREADY, async () => {
    const localPlayerId = storeService.getSettings().playerId;
    roomClient.send({
      type: "room:player:unready",
      payload: { playerId: localPlayerId },
    });
  });

  ipcMain.handle(IPC.ROOM_START, async () => {
    if (!(await roomServer.canStartGame())) return false;
    const room = roomServer.room;
    if (!room) return false;

    room.state = "starting";
    roomServer.broadcastState();
    const launched = await gameManager.launch(room.gameId, room.gameVersion);
    if (
      !launched ||
      !gameManager.isRunning(room.gameId) ||
      roomServer.room !== room ||
      room.state !== "starting"
    ) {
      if (roomServer.room === room) {
        room.state = "waiting";
        roomServer.broadcastState();
      }
      return false;
    }
    room.state = "playing";
    roomServer.broadcast({ type: "room:game:start", payload: {} });
    roomServer.broadcastState();
    return true;
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

  ipcMain.handle(IPC.ROOM_SET_PASSWORD, async (_, password: string) => {
    const localPlayerId = storeService.getSettings().playerId;
    if (!roomServer.room || roomServer.room.hostId !== localPlayerId) {
      return false;
    }
    const changed = roomServer.setRoomPassword(password);
    if (changed) {
      relayRoomService.syncRoomPassword(password);
    }
    return changed;
  });

  ipcMain.handle(IPC.ROOM_PROBE_PASSWORD, async (_, address: string) => {
    return await roomPasswordProbeService.probe(address);
  });

  ipcMain.handle(IPC.ROOM_GET_STATE, async () => {
    if (roomServer.room) return roomServer.room;
    if (roomClient.room) return roomClient.room;
    return null;
  });

  ipcMain.handle(
    IPC.ROOM_SEND_CHAT,
    async (
      _,
      content: string,
      type: "text" | "audio" | "image" = "text",
      images?: string[],
    ) => {
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
      return await gameManager.launch(
        roomClient.room.gameId,
        roomClient.room.gameVersion,
      );
    }
    return false;
  });

  ipcMain.handle(IPC.ROOM_DISCOVER_LAN, async () => {
    return await roomDiscoveryService.discoverLanRooms();
  });

  ipcMain.handle(IPC.ROOM_DISCOVER_VIRTUAL_LAN, async () => {
    return await roomDiscoveryService.discoverVirtualLanRooms();
  });

  ipcMain.handle(IPC.ROOM_DISCOVER_RELAY, async () => {
    return await roomDiscoveryService.discoverRelayRooms();
  });

  ipcMain.handle(IPC.ROOM_MEASURE_RELAY_LATENCY, async () => {
    return await roomDiscoveryService.measureRelayLatency();
  });

  ipcMain.handle(
    IPC.ROOM_VALIDATE_DISCOVERED,
    async (_, room: DiscoveredRoom) => {
      return roomDiscoveryService.validateDiscoveredRoom(room);
    },
  );

  ipcMain.handle(IPC.ROOM_SET_DIRECT_HOST_MODE, async (_, mode: "lan") => {
    relayRoomService.disconnect();
    if (roomServer.room) {
      roomServer.room.hostConnectionMode = mode;
      roomServer.room.hostPublicAddress = undefined;
    }
    roomServer.disconnectRemotePlayersForModeSwitch();
  });

  ipcMain.handle(IPC.ROOM_ENABLE_RELAY_HOST, async () => {
    if (roomServer.room) {
      roomServer.room.hostConnectionMode = "relay";
    }
    roomServer.disconnectRemotePlayersForModeSwitch();
    const result = await relayRoomService.enableHostRoom();
    if (!result.success && roomServer.room) {
      roomServer.room.hostConnectionMode = "lan";
      roomServer.room.hostPublicAddress = undefined;
      roomServer.broadcastState();
    }
    return result;
  });

  ipcMain.handle(IPC.ROOM_DISABLE_RELAY_HOST, async () => {
    relayRoomService.disconnect();
    if (roomServer.room) {
      roomServer.room.hostConnectionMode = "lan";
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
