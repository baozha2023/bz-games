import dgram from "dgram";
import os from "os";
import {
  DEFAULT_RELAY_PUBLIC_HOST,
  DEFAULT_RELAY_SERVER_URL,
  LAN_DISCOVERY_PORT,
  LAN_DISCOVERY_QUERY,
  LAN_DISCOVERY_RESPONSE,
} from "../../../shared/constants";
import type { DiscoveredRoom, RoomInfo, RoomJoinValidationResult } from "../../../shared/types";
import { storeService } from "../storage/StoreService";
import { roomServer } from "./RoomServer";

type RelayRoomListItem = Omit<DiscoveredRoom, "address"> & { roomCode: string };

export class RoomDiscoveryService {
  private udpServer: dgram.Socket | null = null;

  start() {
    if (this.udpServer) return;
    this.udpServer = dgram.createSocket("udp4");
    this.udpServer.on("message", (data, rinfo) => {
      if (data.toString("utf8") !== LAN_DISCOVERY_QUERY) return;
      const discovered = this.getLocalDiscoveredRoom(rinfo.address);
      if (!discovered) return;
      const payload = Buffer.from(`${LAN_DISCOVERY_RESPONSE}${JSON.stringify(discovered)}`, "utf8");
      this.udpServer?.send(payload, rinfo.port, rinfo.address);
    });
    this.udpServer.on("error", () => {
      this.stop();
    });
    this.udpServer.bind(LAN_DISCOVERY_PORT, () => {
      this.udpServer?.setBroadcast(true);
    });
  }

  stop() {
    this.udpServer?.close();
    this.udpServer = null;
  }

  async discoverLanRooms(timeoutMs = 1200): Promise<DiscoveredRoom[]> {
    const rooms = new Map<string, DiscoveredRoom>();
    const ownRoom = this.getLocalDiscoveredRoom("127.0.0.1");
    if (ownRoom) rooms.set(ownRoom.id, ownRoom);

    await new Promise<void>((resolve) => {
      const socket = dgram.createSocket("udp4");
      const timer = setTimeout(() => {
        socket.close();
        resolve();
      }, timeoutMs);

      socket.on("message", (data) => {
        const text = data.toString("utf8");
        if (!text.startsWith(LAN_DISCOVERY_RESPONSE)) return;
        try {
          const room = JSON.parse(text.slice(LAN_DISCOVERY_RESPONSE.length)) as DiscoveredRoom;
          rooms.set(room.id, this.withJoinValidation(room));
        } catch {}
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.send(Buffer.from(LAN_DISCOVERY_QUERY, "utf8"), LAN_DISCOVERY_PORT, "255.255.255.255");
      });

      socket.on("error", () => {
        clearTimeout(timer);
        socket.close();
        resolve();
      });
    });

    return Array.from(rooms.values()).map((room) => this.withJoinValidation(room));
  }

  async discoverRelayRooms(): Promise<DiscoveredRoom[]> {
    const baseUrl = DEFAULT_RELAY_SERVER_URL.trim();
    if (!baseUrl) return [];
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rooms`);
      if (!response.ok) return [];
      const rooms = (await response.json()) as RelayRoomListItem[];
      return rooms.map((room) => this.withJoinValidation(this.withRelayAddress(room)));
    } catch {
      return [];
    }
  }

  validateDiscoveredRoom(room: DiscoveredRoom): RoomJoinValidationResult {
    const settings = storeService.getSettings();
    if (room.hostId === settings.playerId) {
      return { canJoin: false, reason: "own_room", message: "Cannot join your own room" };
    }
    if (room.state !== "waiting") {
      return { canJoin: false, reason: "game_started", message: "Game already started" };
    }
    if (room.playerCount >= room.maxPlayers) {
      return { canJoin: false, reason: "room_full", message: "Room is full" };
    }
    const games = storeService.getGames();
    const record = games.find((game) => game.id === room.gameId);
    if (!record) {
      return { canJoin: false, reason: "game_missing", message: "Game is not installed" };
    }
    const hasVersion = record.versions.some((version) => version.version === room.gameVersion);
    if (!hasVersion) {
      return { canJoin: false, reason: "version_mismatch", message: "Game version mismatch" };
    }
    return { canJoin: true };
  }

  private withJoinValidation(room: DiscoveredRoom): DiscoveredRoom {
    const validation = this.validateDiscoveredRoom(room);
    return {
      ...room,
      canJoin: validation.canJoin,
      joinBlockReason: validation.reason,
    };
  }

  private withRelayAddress(room: RelayRoomListItem): DiscoveredRoom {
    return {
      ...room,
      id: room.roomCode,
      address: `${DEFAULT_RELAY_PUBLIC_HOST}:${room.roomCode}`,
    };
  }

  private getLocalDiscoveredRoom(remoteAddress: string): DiscoveredRoom | null {
    const room = roomServer.room;
    if (!room) return null;
    const settings = storeService.getSettings();
    return this.buildDiscoveredRoom(room, this.resolveLanAddress(remoteAddress), settings.defaultRoomPort);
  }

  private buildDiscoveredRoom(room: RoomInfo, host: string, port: number): DiscoveredRoom {
    const hostPlayer = room.players.find((player) => player.id === room.hostId);
    return {
      id: room.id,
      source: "lan",
      name: `${hostPlayer?.name || room.hostId} 的房间`,
      gameId: room.gameId,
      gameVersion: room.gameVersion,
      hostId: room.hostId,
      hostName: hostPlayer?.name || room.hostId,
      hostStyle: hostPlayer?.nicknameStyle,
      address: `${host}:${port}`,
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      state: room.state,
      updatedAt: Date.now(),
    };
  }

  private resolveLanAddress(remoteAddress: string): string {
    if (remoteAddress === "127.0.0.1") return remoteAddress;
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry.family === "IPv4" && !entry.internal) {
          return entry.address;
        }
      }
    }
    return "127.0.0.1";
  }

}

export const roomDiscoveryService = new RoomDiscoveryService();
