import dgram from "dgram";
import os from "os";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_RELAY_PUBLIC_HOST,
  DEFAULT_RELAY_SERVER_URL,
  LAN_DISCOVERY_PORT,
  LAN_DISCOVERY_QUERY,
  LAN_DISCOVERY_RESPONSE,
} from "../../../shared/AppConstants";
import type { DiscoveredRoom, RoomDiscoverySource, RoomInfo, RoomJoinValidationResult } from "../../../shared/types";
import { storeService } from "../storage/StoreService";
import { roomServer } from "./RoomServer";

type RelayRoomListItem = Omit<DiscoveredRoom, "address"> & { roomCode: string };
type LocalDiscoverySource = Exclude<RoomDiscoverySource, "relay">;
type NetworkInterfaceEntry = NonNullable<ReturnType<typeof os.networkInterfaces>[string]>[number];

interface ReachableInterface {
  name: string;
  description?: string;
  address: string;
  netmask: string;
  source: LocalDiscoverySource;
}

interface AdapterMetadata {
  description?: string;
  status?: string;
}

export class RoomDiscoveryService {
  private udpServer: dgram.Socket | null = null;
  private adapterMetadataCache: Map<string, AdapterMetadata> | null = null;
  private adapterMetadataCacheAt = 0;

  start() {
    if (this.udpServer) return;
    this.udpServer = dgram.createSocket("udp4");
    this.udpServer.on("message", (data, rinfo) => {
      if (data.toString("utf8") !== LAN_DISCOVERY_QUERY) return;
      const discovered = this.getReachableDiscoveredRoom(rinfo.address);
      if (!discovered) return;
      const payload = Buffer.from(
        `${LAN_DISCOVERY_RESPONSE}${JSON.stringify(discovered)}`,
        "utf8",
      );
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
    return this.discoverLocalRoomsBySource("physical_lan", timeoutMs);
  }

  async discoverVirtualLanRooms(timeoutMs = 1200): Promise<DiscoveredRoom[]> {
    return this.discoverLocalRoomsBySource("virtual_lan", timeoutMs);
  }

  private async discoverLocalRoomsBySource(
    source: LocalDiscoverySource,
    timeoutMs = 1200,
  ): Promise<DiscoveredRoom[]> {
    const rooms = new Map<string, DiscoveredRoom>();
    for (const room of this.getSelfDiscoveredRoomsBySource(source)) {
      rooms.set(this.toDiscoveryKey(room), room);
    }

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
          if (room.source !== source) return;
          rooms.set(this.toDiscoveryKey(room), this.withJoinValidation(room));
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

  async measureRelayLatency(): Promise<number | null> {
    const baseUrl = DEFAULT_RELAY_SERVER_URL.trim();
    if (!baseUrl) return null;
    try {
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`);
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
    const settings = storeService.getSettings();
    const matchedInterface = this.resolveReachableInterface(remoteAddress);
    if (!matchedInterface) return null;
    return this.buildDiscoveredRoom(
      room,
      matchedInterface.address,
      settings.defaultRoomPort,
      matchedInterface.source,
    );
  }

  private getSelfDiscoveredRoomsBySource(source: LocalDiscoverySource): DiscoveredRoom[] {
    const room = roomServer.room;
    if (!room) return [];
    const settings = storeService.getSettings();
    return this.listReachableInterfaces()
      .filter((entry) => entry.source === source)
      .map((entry) =>
        this.buildDiscoveredRoom(
          room,
          entry.address,
          settings.defaultRoomPort,
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

  private resolveReachableInterface(remoteAddress: string): ReachableInterface | null {
    const interfaces = this.listReachableInterfaces();
    if (interfaces.length === 0) return null;
    if (remoteAddress === "127.0.0.1") {
      return (
        interfaces.find((entry) => entry.source === "physical_lan") ??
        interfaces[0]
      );
    }

    for (const entry of interfaces) {
      if (this.isSameSubnet(entry.address, remoteAddress, entry.netmask)) {
        return entry;
      }
    }

    return (
      interfaces.find((entry) => entry.source === "physical_lan") ??
      interfaces[0]
    );
  }

  private listReachableInterfaces(): ReachableInterface[] {
    const interfaces = os.networkInterfaces();
    const adapterMetadata = this.getAdapterMetadata();
    const results: ReachableInterface[] = [];
    for (const [name, entries] of Object.entries(interfaces)) {
      const metadata = adapterMetadata.get(name);
      for (const entry of entries || []) {
        if (!this.isUsableIpv4Entry(entry, metadata)) continue;
        results.push({
          name,
          description: metadata?.description,
          address: entry.address,
          netmask: entry.netmask,
          source: this.isVirtualInterface(name, metadata?.description) ? "virtual_lan" : "physical_lan",
        });
      }
    }
    return results;
  }

  private isUsableIpv4Entry(
    entry: NetworkInterfaceEntry | undefined,
    metadata?: AdapterMetadata,
  ): entry is NetworkInterfaceEntry {
    if (!entry || entry.family !== "IPv4" || entry.internal) return false;
    if (this.isLinkLocalIpv4(entry.address)) return false;
    if (process.platform === "win32" && metadata?.status && metadata.status !== "Up") {
      return false;
    }
    return true;
  }

  private isVirtualInterface(name: string, description?: string): boolean {
    const text = `${name} ${description || ""}`;
    return /easytier|virtual|vmware|vbox|hyper-v|vethernet|tap|tun|tunnel|vpn|wireguard|zerotier|tailscale|hamachi|^et_/i.test(
      text,
    );
  }

  private getAdapterMetadata() {
    const now = Date.now();
    if (this.adapterMetadataCache && now - this.adapterMetadataCacheAt < 5000) {
      return this.adapterMetadataCache;
    }
    const metadata = new Map<string, AdapterMetadata>();
    if (process.platform !== "win32") {
      this.adapterMetadataCache = metadata;
      this.adapterMetadataCacheAt = now;
      return metadata;
    }
    try {
      const output = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-NetAdapter | Select-Object Name,InterfaceDescription,Status | ConvertTo-Json -Compress",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 1500,
        },
      ).trim();
      if (output) {
        const parsed = JSON.parse(output) as
          | { Name?: string; InterfaceDescription?: string }
          | Array<{ Name?: string; InterfaceDescription?: string }>;
        const records = Array.isArray(parsed) ? parsed : [parsed];
        for (const record of records) {
          if (!record?.Name) continue;
          metadata.set(record.Name, {
            description: record.InterfaceDescription || undefined,
            status: typeof (record as { Status?: string }).Status === "string"
              ? (record as { Status?: string }).Status
              : undefined,
          });
        }
      }
    } catch {}
    this.adapterMetadataCache = metadata;
    this.adapterMetadataCacheAt = now;
    return metadata;
  }

  private isSameSubnet(address: string, remoteAddress: string, netmask: string): boolean {
    const addressNum = this.ipv4ToInt(address);
    const remoteNum = this.ipv4ToInt(remoteAddress);
    const maskNum = this.ipv4ToInt(netmask);
    if (addressNum === null || remoteNum === null || maskNum === null) return false;
    return (addressNum & maskNum) === (remoteNum & maskNum);
  }

  private isLinkLocalIpv4(address: string): boolean {
    return /^169\.254\./.test(address);
  }

  private ipv4ToInt(address: string): number | null {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    return (
      ((parts[0] << 24) >>> 0) +
      ((parts[1] << 16) >>> 0) +
      ((parts[2] << 8) >>> 0) +
      parts[3]
    ) >>> 0;
  }

  private toDiscoveryKey(room: DiscoveredRoom): string {
    return `${room.source}:${room.id}:${room.address}`;
  }

}

export const roomDiscoveryService = new RoomDiscoveryService();
