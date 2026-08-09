import { DEFAULT_RELAY_SERVER_URL } from "../../../shared/AppConstants";
import {
  HOSTED_GAME_LOGICAL_PREFIX,
  parseHostedGameLogicalUrl,
} from "../../../shared/types";

function normalizeHttpBase(url: string): string {
  const value = url.trim();
  if (!value) return "";
  if (value.startsWith("wss://")) {
    return `https://${value.slice("wss://".length)}`.replace(/\/+$/, "");
  }
  if (value.startsWith("ws://")) {
    return `http://${value.slice("ws://".length)}`.replace(/\/+$/, "");
  }
  return value.replace(/\/+$/, "");
}

export function resolveGameHostingPortalUrl(
  relayServerUrl = DEFAULT_RELAY_SERVER_URL,
): string {
  const relayHttpBase = normalizeHttpBase(relayServerUrl);
  if (!relayHttpBase) throw new Error("market_hosted_server_unavailable");
  return `${relayHttpBase}/admin/game-hosting`;
}

export function isHostedGameLogicalUrl(value: string): boolean {
  return parseHostedGameLogicalUrl(value) !== null;
}

export function resolveMarketDownloadUrl(
  value: string,
  relayServerUrl = DEFAULT_RELAY_SERVER_URL,
): string {
  if (!value.startsWith(HOSTED_GAME_LOGICAL_PREFIX)) return value;
  const parsed = parseHostedGameLogicalUrl(value);
  if (!parsed || parsed.role !== "package")
    throw new Error("market_hosted_url_invalid");
  const relayHttpBase = normalizeHttpBase(relayServerUrl);
  if (!relayHttpBase) throw new Error("market_hosted_server_unavailable");
  return `${relayHttpBase}/api/v1/game-hosting/assets/${encodeURIComponent(parsed.gameId)}/${encodeURIComponent(parsed.version)}/${parsed.role}/${parsed.encodedFileName}`;
}

export function resolveMarketImageUrl(
  value: string,
  relayServerUrl = DEFAULT_RELAY_SERVER_URL,
): string {
  if (!value.startsWith(HOSTED_GAME_LOGICAL_PREFIX)) return value;
  const parsed = parseHostedGameLogicalUrl(value);
  if (!parsed || !["icon", "cover"].includes(parsed.role))
    throw new Error("market_hosted_image_url_invalid");
  const relayHttpBase = normalizeHttpBase(relayServerUrl);
  if (!relayHttpBase) throw new Error("market_hosted_server_unavailable");
  return `${relayHttpBase}/api/v1/game-hosting/assets/${encodeURIComponent(parsed.gameId)}/${encodeURIComponent(parsed.version)}/${parsed.role}/${parsed.encodedFileName}`;
}
