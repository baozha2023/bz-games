import dgram from "dgram";
import os from "os";
import { execFileSync } from "node:child_process";
import {
  LAN_DISCOVERY_PORT,
  LAN_DISCOVERY_QUERY,
  LAN_DISCOVERY_RESPONSE,
} from "../../../shared/AppConstants";
import type { DiscoveredRoom, RoomDiscoverySource } from "../../../shared/types";

export type LocalDiscoverySource = Exclude<RoomDiscoverySource, "relay">;
export type NetworkInterfaceEntry = NonNullable<ReturnType<typeof os.networkInterfaces>[string]>[number];

export interface ReachableInterface {
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

export class LocalNetworkService {
  private udpServer: dgram.Socket | null = null;
  private adapterMetadataCache: Map<string, AdapterMetadata> | null = null;
  private adapterMetadataCacheAt = 0;
  private onDiscoveryRequest: ((remoteAddress: string) => DiscoveredRoom | null) | null = null;

  start(onRequest: (remoteAddress: string) => DiscoveredRoom | null): void {
    if (this.udpServer) return;
    this.onDiscoveryRequest = onRequest;
    this.udpServer = dgram.createSocket("udp4");
    this.udpServer.on("message", (data, rinfo) => {
      if (data.toString("utf8") !== LAN_DISCOVERY_QUERY) return;
      const discovered = this.onDiscoveryRequest?.(rinfo.address);
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

  stop(): void {
    this.udpServer?.close();
    this.udpServer = null;
    this.onDiscoveryRequest = null;
  }

  /** 通过 UDP 广播扫描局域网房间，返回发现的房间列表（不含自身） */
  async broadcastScan(source: LocalDiscoverySource, timeoutMs = 1200): Promise<DiscoveredRoom[]> {
    const rooms: DiscoveredRoom[] = [];
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
          rooms.push(room);
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
    return rooms;
  }

  /** 列出本机所有可用于局域网联机的网卡 */
  listReachableInterfaces(): ReachableInterface[] {
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

  /** 根据远端 IP 反查匹配的本机网卡 */
  resolveReachableInterface(remoteAddress: string): ReachableInterface | null {
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

  /** 判断两个 IP 是否在同一子网 */
  isSameSubnet(address: string, remoteAddress: string, netmask: string): boolean {
    const addressNum = this.ipv4ToInt(address);
    const remoteNum = this.ipv4ToInt(remoteAddress);
    const maskNum = this.ipv4ToInt(netmask);
    if (addressNum === null || remoteNum === null || maskNum === null) return false;
    return (addressNum & maskNum) === (remoteNum & maskNum);
  }

  /** IPv4 字符串转为 32 位无符号整数 */
  ipv4ToInt(address: string): number | null {
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

  // ---- 私有工具方法 ---------------------------------------------------------

  private isUsableIpv4Entry(
    entry: NetworkInterfaceEntry | undefined,
    metadata?: AdapterMetadata,
  ): entry is NetworkInterfaceEntry {
    if (!entry || entry.family !== "IPv4" || entry.internal) return false;
    if (this.isLinkLocalIpv4(entry.address)) return false;
    if (this.isReservedIpv4(entry.address)) return false;
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

  private getAdapterMetadata(): Map<string, AdapterMetadata> {
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

  private isLinkLocalIpv4(address: string): boolean {
    return /^169\.254\./.test(address);
  }

  private isReservedIpv4(address: string): boolean {
    const value = this.ipv4ToInt(address);
    if (value === null) return true;
    return [
      ["0.0.0.0", 8],
      ["100.64.0.0", 10],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, prefix]) => this.isIpv4InCidr(value, base as string, prefix as number));
  }

  private isIpv4InCidr(value: number, base: string, prefix: number): boolean {
    const baseValue = this.ipv4ToInt(base);
    if (baseValue === null) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (baseValue & mask);
  }
}

export const localNetworkService = new LocalNetworkService();
