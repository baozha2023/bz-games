import { z } from "zod";
import { GameType } from "./game.types";
import {
  GameManifestBaseSchema,
  GameVersionSchema,
  PlatformVersionRangeSchema,
} from "../game-manifest";

export const HOSTED_GAME_LOGICAL_PREFIX = "games.bzgames.top/";

const HOSTED_GAME_PATH_PATTERN =
  /^([^/?#]+)\/([^/?#]+)\/(package|icon|cover)\/([^/?#]+)$/;

export type HostedGameAssetRole = "package" | "icon" | "cover";

export interface HostedGameLogicalUrl {
  gameId: string;
  version: string;
  role: HostedGameAssetRole;
  encodedFileName: string;
}

export function parseHostedGameLogicalUrl(
  value: string,
): HostedGameLogicalUrl | null {
  if (!value.startsWith(HOSTED_GAME_LOGICAL_PREFIX)) return null;
  const match = HOSTED_GAME_PATH_PATTERN.exec(
    value.slice(HOSTED_GAME_LOGICAL_PREFIX.length),
  );
  if (!match) return null;
  try {
    const gameId = decodeURIComponent(match[1]).normalize("NFC");
    const version = decodeURIComponent(match[2]).normalize("NFC");
    const fileName = decodeURIComponent(match[4]).normalize("NFC");
    if (
      !/^[a-z0-9]+(\.[a-z0-9\-]+)+$/.test(gameId) ||
      !GameVersionSchema.safeParse(version).success ||
      !fileName ||
      fileName.length > 255 ||
      fileName.includes("/") ||
      fileName.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(fileName) ||
      (match[3] === "package" && !fileName.toLowerCase().endsWith(".zip")) ||
      encodeURIComponent(gameId) !== match[1] ||
      encodeURIComponent(version) !== match[2] ||
      encodeURIComponent(fileName) !== match[4]
    ) {
      return null;
    }
    return {
      gameId,
      version,
      role: match[3] as HostedGameAssetRole,
      encodedFileName: match[4],
    };
  } catch {
    return null;
  }
}

export const GameManifestOverrideSchema = GameManifestBaseSchema.omit({
  $schema: true,
  id: true,
  version: true,
}).partial();

export const MarketGameVersionSchema = z.object({
  version: GameVersionSchema,
  description: z.string().min(1),
  platformVersion: PlatformVersionRangeSchema,
  downloadUrl: z.string().refine(isValidDownloadUrl, "Invalid download URL"),
  sha256: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  publishedAt: z.string().datetime().optional(),
  releaseNotes: z.string().optional(),
  isPrerelease: z.boolean().optional(),
  gameManifest: GameManifestOverrideSchema.optional(),
});

/** 校验下载链接格式 */
export function isValidDownloadUrl(url: string): boolean {
  if (/^https?:\/\/.+/.test(url)) return true;
  return parseHostedGameLogicalUrl(url)?.role === "package";
}

export function isValidMarketImageUrl(
  url: string,
  role: "icon" | "cover",
): boolean {
  if (/^https?:\/\/.+/.test(url)) return true;
  return parseHostedGameLogicalUrl(url)?.role === role;
}

/** 校验 sha256 格式（64 位 hex），允许为空 */
export function isValidSha256Format(sha256: string | undefined): boolean {
  if (!sha256) return true;
  return /^[a-fA-F0-9]{64}$/.test(sha256);
}

/** 版本是否缺少 sha256 */
export function isMissingSha256(v: { sha256?: string }): boolean {
  return !v.sha256;
}

/** 版本是否缺少 size */
export function isMissingSize(v: { size?: number }): boolean {
  return v.size == null;
}

/** 运行时校验版本是否可下载：downloadUrl 合法，sha256 格式合法（若有），非 GitHub 直链时 size 必填 */
export function isVersionDownloadable(v: {
  downloadUrl: string;
  sha256?: string;
  size?: number;
}): boolean {
  if (!isValidDownloadUrl(v.downloadUrl)) return false;
  if (!isValidSha256Format(v.sha256)) return false;
  if (isMissingSize(v) && !isGitHubReleaseUrl(v.downloadUrl)) return false;
  return true;
}

/** 判断 downloadUrl 是否为 GitHub Releases 直链 */
export function isGitHubReleaseUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(url);
}

export const MarketGameSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9\-]+)+$/),
  name: z.string().min(1).max(100),
  author: z.string().min(1).max(100),
  author_url: z.string().url().optional(),
  type: z.nativeEnum(GameType),
  summary: z.string().min(1).max(200),
  tags: z.array(z.string().min(1)).optional(),
  iconUrl: z
    .string()
    .refine((url) => isValidMarketImageUrl(url, "icon"), "Invalid icon URL")
    .optional(),
  coverUrl: z
    .string()
    .refine((url) => isValidMarketImageUrl(url, "cover"), "Invalid cover URL")
    .optional(),
  screenshots: z.array(z.string().url()).optional(),
  featured: z.boolean().optional(),
  visibility: z.enum(["public", "hidden", "deprecated"]).optional(),
  minPlayers: z.number().int().min(1).optional(),
  maxPlayers: z.number().int().min(1).optional(),
  latestVersion: GameVersionSchema,
  versions: z.array(MarketGameVersionSchema).min(1),
});

export function parseGitHubRepositoryUrl(
  value: string,
): { owner: string; repository: string } | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) return null;
    const owner = segments[0];
    const repository = segments[1].replace(/\.git$/, "");
    if (
      !/^[A-Za-z0-9_.-]+$/.test(owner) ||
      !/^[A-Za-z0-9_.-]+$/.test(repository)
    ) {
      return null;
    }
    return { owner, repository };
  } catch {
    return null;
  }
}

export function isValidGitBranch(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    value !== "@" &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !/[\u0000-\u0020\u007f~^:?*[\\]/.test(value) &&
    value
      .split("/")
      .every(
        (segment) =>
          segment.length > 0 &&
          !segment.startsWith(".") &&
          !segment.endsWith(".lock"),
      )
  );
}

export const GitHubRepositoryUrlSchema = z
  .string()
  .refine(parseGitHubRepositoryUrl, "Invalid GitHub repository URL");

export const MarketSourceSchema = z.object({
  marketId: z.string().min(1),
  marketName: z.string().min(1),
  coverUrl: z.string().url().optional(),
  generatedAt: z.string().datetime(),
  repository: GitHubRepositoryUrlSchema,
  branch: z.string().refine(isValidGitBranch, "Invalid Git branch"),
  featured: z.boolean().optional(),
  visibility: z.enum(["public", "hidden"]).optional(),
});

export const MarketDirectorySchema = z.object({
  schemaVersion: z.string().min(1),
  sources: z.array(MarketSourceSchema).min(1),
});

export const MarketIndexSchema = z.object({
  schemaVersion: z.string().min(1),
  marketId: z.string().min(1),
  marketName: z.string().min(1),
  generatedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  repository: GitHubRepositoryUrlSchema.optional(),
  author: z.string().min(1).max(100).optional(),
  games: z.array(MarketGameSchema),
});

export type GameManifestOverride = z.infer<typeof GameManifestOverrideSchema>;
export type MarketSource = z.infer<typeof MarketSourceSchema>;
export type MarketDirectory = z.infer<typeof MarketDirectorySchema>;
export type MarketGameVersion = z.infer<typeof MarketGameVersionSchema>;
export type MarketGame = z.infer<typeof MarketGameSchema>;
export type MarketIndex = z.infer<typeof MarketIndexSchema>;

export type MarketTaskStatus =
  | "idle"
  | "downloading"
  | "verifying"
  | "extracting"
  | "installing"
  | "completed"
  | "error"
  | "canceled"
  | "paused"
  | "interrupted";

export type MarketErrorCode =
  | "network"
  | "download"
  | "verify"
  | "extract"
  | "install"
  | "manifest";

export interface MarketTaskState {
  taskId: string;
  gameId: string;
  version: string;
  gameName?: string;
  sourceIdx?: number;
  installStarted?: boolean;
  status: MarketTaskStatus;
  progress: number;
  bytesReceived?: number;
  totalBytes?: number;
  message?: string;
  error?: string;
  errorCode?: MarketErrorCode;
  createdAt: number;
  updatedAt: number;
}

export interface MarketTaskEvent {
  task: MarketTaskState;
}

export interface FloatBallProgress {
  totalProgress: number;
  activeTaskCount: number;
  completedTaskCount: number;
  totalTaskCount: number;
}

export interface DownloadTaskSnapshot {
  taskId: string;
  gameId: string;
  version: string;
  gameName?: string;
  sourceIdx: number;
  downloadUrl: string;
  sha256: string | undefined;
  size: number;
  downloadPath: string;
  archiveType: "zip" | "7z";
  bytesReceived: number;
  status: "paused" | "interrupted";
  updatedAt: number;
}
