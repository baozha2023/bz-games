import { WebSocket } from "ws";
import { DEFAULT_RELAY_PUBLIC_HOST, DEFAULT_RELAY_SERVER_URL, DEFAULT_RELAY_TOKEN } from "../../../shared/AppConstants";

export interface RoomPasswordProbeResult {
  success: boolean;
  hasPassword: boolean;
  error?: string;
}

class RoomPasswordProbeService {
  async probe(address: string): Promise<RoomPasswordProbeResult> {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      return { success: false, hasPassword: false, error: "address_empty" };
    }
    if (this.isRelayAddress(trimmedAddress)) {
      return this.probeRelayRoom(trimmedAddress);
    }
    return this.probeDirectRoom(trimmedAddress);
  }

  private probeDirectRoom(address: string): Promise<RoomPasswordProbeResult> {
    const targetUrl = this.toWebSocketUrl(address);
    return new Promise((resolve) => {
      const ws = new WebSocket(targetUrl, { rejectUnauthorized: false });
      const timeout = setTimeout(() => {
        ws.removeAllListeners();
        ws.close();
        resolve({ success: false, hasPassword: false, error: "probe_timeout" });
      }, 5000);

      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "room:password:probe", payload: {} }));
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.concat(data as Buffer[]).toString("utf8"));
          if (message?.type !== "room:password:probe:ack") return;
          clearTimeout(timeout);
          ws.removeAllListeners();
          ws.close();
          resolve({
            success: true,
            hasPassword: Boolean(message.payload?.hasPassword),
          });
        } catch {
          clearTimeout(timeout);
          ws.removeAllListeners();
          ws.close();
          resolve({ success: false, hasPassword: false, error: "probe_failed" });
        }
      });

      ws.once("error", () => {
        clearTimeout(timeout);
        ws.removeAllListeners();
        ws.close();
        resolve({ success: false, hasPassword: false, error: "probe_failed" });
      });
    });
  }

  private probeRelayRoom(address: string): Promise<RoomPasswordProbeResult> {
    const relayUrl = this.toWebSocketUrl(DEFAULT_RELAY_SERVER_URL);
    const roomCode = address.trim().split(":").pop() || "";
    return new Promise((resolve) => {
      const ws = new WebSocket(relayUrl, { rejectUnauthorized: false });
      const timeout = setTimeout(() => {
        ws.removeAllListeners();
        ws.close();
        resolve({ success: false, hasPassword: false, error: "probe_timeout" });
      }, 5000);

      ws.once("open", () => {
        ws.send(JSON.stringify({
          type: "relay:room:password:probe",
          payload: {
            token: DEFAULT_RELAY_TOKEN,
            roomCode,
          },
        }));
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : Buffer.concat(data as Buffer[]).toString("utf8"));
          if (message?.type === "relay:room:password:probe:ack") {
            clearTimeout(timeout);
            ws.removeAllListeners();
            ws.close();
            resolve({
              success: true,
              hasPassword: Boolean(message.payload?.hasPassword),
            });
            return;
          }
          if (message?.type === "relay:error") {
            clearTimeout(timeout);
            ws.removeAllListeners();
            ws.close();
            resolve({
              success: false,
              hasPassword: false,
              error: String(message.payload?.code || "probe_failed"),
            });
          }
        } catch {
          clearTimeout(timeout);
          ws.removeAllListeners();
          ws.close();
          resolve({ success: false, hasPassword: false, error: "probe_failed" });
        }
      });

      ws.once("error", () => {
        clearTimeout(timeout);
        ws.removeAllListeners();
        ws.close();
        resolve({ success: false, hasPassword: false, error: "probe_failed" });
      });
    });
  }

  private isRelayAddress(address: string) {
    return new RegExp(`^${this.escapeRegExp(DEFAULT_RELAY_PUBLIC_HOST)}:\\d+$`, "i").test(address);
  }

  private toWebSocketUrl(address: string) {
    if (address.startsWith("ws://") || address.startsWith("wss://")) return address;
    if (address.startsWith("https://")) return `wss://${address.slice("https://".length)}`;
    if (address.startsWith("http://")) return `ws://${address.slice("http://".length)}`;
    return `ws://${address}`;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export const roomPasswordProbeService = new RoomPasswordProbeService();
