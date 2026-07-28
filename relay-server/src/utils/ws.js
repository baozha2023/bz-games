import { WebSocket } from "ws";

export function send(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

export function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,if-match,x-cloud-operation-id,x-relay-token,x-bz-relay-token",
    "access-control-expose-headers": "etag,x-file-sha256,x-cloud-operation-id,x-ratelimit-reset,retry-after",
  });
  if (status === 204) {
    res.end();
    return;
  }
  res.end(JSON.stringify(body));
}
