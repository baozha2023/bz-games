import crypto from "node:crypto";

import { sendJson } from "./ws.js";

export const RELAY_TOKEN_HEADER = "x-relay-token";

export function isValidRelayToken(config, token) {
  const expectedToken = config.RELAY_TOKEN;
  const actualToken = typeof token === "string" ? token.trim() : "";
  if (!expectedToken || !actualToken) return false;
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(actualToken);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function readRelayTokenFromHttp(req, url) {
  const headerToken = req.headers[RELAY_TOKEN_HEADER] || req.headers["x-bz-relay-token"];
  if (Array.isArray(headerToken)) return headerToken[0] || "";
  if (headerToken) return headerToken;
  return url.searchParams.get("relayToken") || "";
}

export function requireHttpRelayToken(config, req, res, url) {
  if (isValidRelayToken(config, readRelayTokenFromHttp(req, url))) return true;
  sendJson(res, 401, { error: "unauthorized" });
  return false;
}

export function readRelayTokenFromWs(req) {
  const headerToken = req.headers[RELAY_TOKEN_HEADER] || req.headers["x-bz-relay-token"];
  if (Array.isArray(headerToken)) return headerToken[0] || "";
  if (headerToken) return headerToken;
  try {
    const url = new URL(req.url || "/", `ws://${req.headers.host || "localhost"}`);
    return url.searchParams.get("relayToken") || "";
  } catch {
    return "";
  }
}
