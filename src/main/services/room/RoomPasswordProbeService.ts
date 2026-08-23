import { WebSocket } from "ws";
import {
  DEFAULT_RELAY_PUBLIC_HOST,
  DEFAULT_RELAY_SERVER_URL,
  DEFAULT_RELAY_TOKEN,
} from "../../../shared/AppConstants";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { mapRelayCloseError } from "../../utils/relayCloseError";
import { toRelayWebSocketUrl } from "./relayWebSocketUrl";

export interface RoomPasswordProbeResult {
  success: boolean;
  hasPassword: boolean;
  hostId?: string;
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
      let settled = false;
      const finish = (result: RoomPasswordProbeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.removeAllListeners();
        ws.close();
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({ success: false, hasPassword: false, error: "probe_timeout" });
      }, 5000);

      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "room:password:probe", payload: {} }));
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(
            Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Buffer.concat(data as Buffer[]).toString("utf8"),
          );
          if (message?.type !== "room:password:probe:ack") return;
          finish({
            success: true,
            hasPassword: Boolean(message.payload?.hasPassword),
            hostId:
              typeof message.payload?.hostId === "string"
                ? message.payload.hostId
                : undefined,
          });
        } catch {
          finish({ success: false, hasPassword: false, error: "probe_failed" });
        }
      });

      ws.once("error", () => {
        finish({ success: false, hasPassword: false, error: "probe_failed" });
      });

      ws.once("close", (code, reason) => {
        finish({
          success: false,
          hasPassword: false,
          error: mapRelayCloseError(code, reason, `probe_closed_${code}`),
        });
      });
    });
  }

  private probeRelayRoom(address: string): Promise<RoomPasswordProbeResult> {
    const relayUrl = toRelayWebSocketUrl(DEFAULT_RELAY_SERVER_URL);
    const roomCode = address.trim().split(":").pop() || "";
    return new Promise((resolve) => {
      const ws = new WebSocket(requestInterceptor.buildWebSocketUrl(relayUrl), {
        rejectUnauthorized: false,
      });
      let settled = false;
      const finish = (result: RoomPasswordProbeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.removeAllListeners();
        ws.close();
        resolve(result);
      };
      const timeout = setTimeout(() => {
        finish({ success: false, hasPassword: false, error: "probe_timeout" });
      }, 5000);

      ws.once("open", () => {
        ws.send(
          JSON.stringify({
            type: "relay:room:password:probe",
            payload: {
              token: DEFAULT_RELAY_TOKEN,
              roomCode,
            },
          }),
        );
      });

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(
            Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Buffer.concat(data as Buffer[]).toString("utf8"),
          );
          if (message?.type === "relay:room:password:probe:ack") {
            finish({
              success: true,
              hasPassword: Boolean(message.payload?.hasPassword),
              hostId:
                typeof message.payload?.hostId === "string"
                  ? message.payload.hostId
                  : undefined,
            });
            return;
          }
          if (message?.type === "relay:error") {
            finish({
              success: false,
              hasPassword: false,
              error: String(message.payload?.code || "probe_failed"),
            });
          }
        } catch {
          finish({ success: false, hasPassword: false, error: "probe_failed" });
        }
      });

      ws.once("error", () => {
        finish({ success: false, hasPassword: false, error: "probe_failed" });
      });

      ws.once("close", (code, reason) => {
        finish({
          success: false,
          hasPassword: false,
          error: mapRelayCloseError(code, reason, `probe_closed_${code}`),
        });
      });
    });
  }

  private isRelayAddress(address: string) {
    return new RegExp(
      `^${this.escapeRegExp(DEFAULT_RELAY_PUBLIC_HOST)}:\\d+$`,
      "i",
    ).test(address);
  }

  private toWebSocketUrl(address: string) {
    if (address.startsWith("ws://") || address.startsWith("wss://"))
      return address;
    if (address.startsWith("https://"))
      return `wss://${address.slice("https://".length)}`;
    if (address.startsWith("http://"))
      return `ws://${address.slice("http://".length)}`;
    return `ws://${address}`;
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export const roomPasswordProbeService = new RoomPasswordProbeService();
