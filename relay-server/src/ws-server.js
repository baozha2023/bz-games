import { parseJson } from "./utils/protocol.js";
import { isValidRelayToken, readRelayTokenFromWs } from "./utils/relay-auth.js";

export function registerWebSocketHandlers({ wss, config, roomService, messageRouter }) {
  wss.on("connection", (ws, req) => {
    if (!isValidRelayToken(config, readRelayTokenFromWs(req))) {
      ws.close(1008, "unauthorized");
      return;
    }
    const client = {
      ws,
      playerId: "",
      roomId: "",
      isHost: false,
      isAlive: true,
    };

    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        messageRouter.forwardBinary(client, data);
        return;
      }
      const text = data.toString("utf8");
      if (Buffer.byteLength(text, "utf8") > config.MAX_TEXT_BYTES) return;
      const message = parseJson(text);
      if (!message || typeof message.type !== "string") return;
      messageRouter.handleTextMessage(client, message, text);
    });

    ws.on("close", () => roomService.removeClient(client));
    ws.on("error", () => roomService.removeClient(client));
  });
}
