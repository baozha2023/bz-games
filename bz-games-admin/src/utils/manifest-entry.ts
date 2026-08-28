export type ManifestEntryKind = "web" | "native" | "unknown";
export type ManifestRelationError =
  | "entry_required"
  | "web_url_required"
  | "web_url_forbidden"
  | "network_entry_required"
  | "multiplayer_required"
  | "multiplayer_forbidden"
  | "encrypt_local_storage_forbidden";

export function getManifestEntryKind(entry: unknown): ManifestEntryKind {
  if (typeof entry !== "string") return "unknown";

  const normalized = entry.trim().toLowerCase();
  if (!normalized) return "unknown";
  if (
    normalized === "serve" ||
    normalized === "url" ||
    normalized.endsWith(".html") ||
    normalized.endsWith(".htm")
  ) {
    return "web";
  }
  return "native";
}

export function buildEntrySpecificManifestFields(options: {
  entry: unknown;
  windowedFullscreen?: boolean;
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
}): Record<string, unknown> {
  const kind = getManifestEntryKind(options.entry);
  if (kind === "web") {
    return { windowedFullscreen: options.windowedFullscreen === true };
  }
  if (kind !== "native") return {};

  const result: Record<string, unknown> = {};
  if (options.args && options.args.length > 0) {
    result.args = [...options.args];
  }
  if (options.env && Object.keys(options.env).length > 0) {
    result.env = { ...options.env };
  }
  return result;
}

export function validateManifestRuntimeRelations(options: {
  entry: unknown;
  webUrl: unknown;
  type: unknown;
  multiplayer?: { minPlayers?: number | null; maxPlayers?: number | null };
  encryptLocalStorage?: boolean;
}): ManifestRelationError | null {
  const entry = typeof options.entry === "string" ? options.entry.trim() : "";
  if (!entry) return "entry_required";
  const webUrl =
    typeof options.webUrl === "string" ? options.webUrl.trim() : "";
  if (entry === "url" && !webUrl) return "web_url_required";
  if (entry !== "url" && webUrl) return "web_url_forbidden";
  if (options.type === "networkgame" && entry !== "url") {
    return "network_entry_required";
  }

  const multiplayerType =
    options.type === "multiplayer" || options.type === "singlemultiple";
  const hasMin = options.multiplayer?.minPlayers != null;
  const hasMax = options.multiplayer?.maxPlayers != null;
  if (multiplayerType && (!hasMin || !hasMax)) return "multiplayer_required";
  if (!multiplayerType && (hasMin || hasMax)) return "multiplayer_forbidden";
  if (
    getManifestEntryKind(entry) === "native" &&
    options.encryptLocalStorage === true
  ) {
    return "encrypt_local_storage_forbidden";
  }
  return null;
}
