import {
  DEFAULT_RELAY_PUBLIC_HOST,
  DEFAULT_RELAY_SERVER_URL,
} from "../../../shared/AppConstants";
import type { DiscoveredRoom, RoomInfo, RoomJoinValidationResult } from "../../../shared/types";
import { storeService } from "../storage/StoreService";
import { roomServer } from "./RoomServer";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { localNetworkService } from "./LocalNetworkService";
import type { LocalDiscoverySource } from "./LocalNetworkService";

type RelayRoomListItem = Omit<DiscoveredRoom, "address"> & { roomCode: string };

export class RoomDiscoveryService {

  start(): void {
    localNetworkService.start((remoteAddress) => this.getReachableDiscoveredRoom(remoteAddress));
  }

  stop(): void {
    localNetworkService.stop();
  }

  async discoverLanRooms(timeoutMs = 1200): Promise<DiscoveredRoom[]> {
    return this.discoverLocalRoomsBySource("physical_lan", timeoutMs);
  }

  async discoverVirtualLanRooms(timeoutMs = 1200): Promise<DiscoveredRoom[]> {
    return this.discoverLocalRoomsBySource("virtual_lan", timeoutMs);
  }

  async discoverRelayRooms(): Promise<DiscoveredRoom[]> {
    const baseUrl = DEFAULT_RELAY_SERVER_URL.trim();
    if (!baseUrl) return [];
    try {
      const url = `${baseUrl.replace(/\/$/, "")}/rooms`;
      const response = await fetch(url, { headers: requestInterceptor.buildHeaders(url) });
      if (!response.ok) return [];
      const rooms = (await response.json()) as RelayRoomListItem[];
      return rooms.map((room) => this.withJoinValidation(this.withRelayAddress(room)));
    } catch {
      return [];
    }
  }

  async measureRelayLatency(): Promise<number | null> {
    const baseUrl = DEFAULT_RELAY_SERVER_URL.trim();
    if (!baseUrl) return null;
    try {
      const startedAt = Date.now();
      const url = `${baseUrl.replace(/\/$/, "")}/health`;
      const response = await fetch(url, { headers: requestInterceptor.buildHeaders(url) });
      if (!response.ok) return null;
      return Math.max(0, Date.now() - startedAt);
    } catch {
      return null;
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

  // ---- 私有方法 ---------------------------------------------------------------

  private async discoverLocalRoomsBySource(
    source: LocalDiscoverySource,
    timeoutMs = 1200,
  ): Promise<DiscoveredRoom[]> {
    const rooms = new Map<string, DiscoveredRoom>();
    for (const room of this.getSelfDiscoveredRoomsBySource(source)) {
      rooms.set(this.toDiscoveryKey(room), room);
    }

    const broadcastRooms = await localNetworkService.broadcastScan(source, timeoutMs);
    for (const room of broadcastRooms) {
      rooms.set(this.toDiscoveryKey(room), this.withJoinValidation(room));
    }

    return Array.from(rooms.values()).map((room) => this.withJoinValidation(room));
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

  private getReachableDiscoveredRoom(remoteAddress: string): DiscoveredRoom | null {
    const room = roomServer.room;
    if (!room) return null;
    const matchedInterface = localNetworkService.resolveReachableInterface(remoteAddress);
    if (!matchedInterface) return null;
    return this.buildDiscoveredRoom(
      room,
      matchedInterface.address,
      roomServer.listeningPort ?? storeService.getSettings().defaultRoomPort,
      matchedInterface.source,
    );
  }

  private getSelfDiscoveredRoomsBySource(source: LocalDiscoverySource): DiscoveredRoom[] {
    const room = roomServer.room;
    if (!room) return [];
    const port =
      roomServer.listeningPort ?? storeService.getSettings().defaultRoomPort;
    return localNetworkService.listReachableInterfaces()
      .filter((entry) => entry.source === source)
      .map((entry) =>
        this.buildDiscoveredRoom(
          room,
          entry.address,
          port,
          entry.source,
        ),
      );
  }

  private buildDiscoveredRoom(
    room: RoomInfo,
    host: string,
    port: number,
    source: LocalDiscoverySource,
  ): DiscoveredRoom {
    const hostPlayer = room.players.find((player) => player.id === room.hostId);
    return {
      id: room.id,
      source,
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
      hasPassword: room.hasPassword,
      updatedAt: Date.now(),
    };
  }

  private toDiscoveryKey(room: DiscoveredRoom): string {
    return `${room.source}:${room.id}:${room.address}`;
  }
}

export const roomDiscoveryService = new RoomDiscoveryService();
