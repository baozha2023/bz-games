import { z } from "zod";

export const GameManifestOverrideSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  author: z.string().min(1).max(100).optional(),
  author_url: z.string().url().optional(),
  platformVersion: z.union([z.string(), z.tuple([z.string(), z.string()])]).optional(),
  entry: z.string().optional(),
  web_url: z.string().url().optional(),
  icon: z.string().optional(),
  cover: z.string().optional(),
  video: z.string().optional(),
  encryptLocalStorage: z.boolean().optional(),
  type: z.enum(["singleplayer", "multiplayer", "singlemultiple", "networkgame"]).optional(),
  statistics: z.array(
    z.union([
      z.string(),
      z.record(z.string()),
      z.record(
        z.object({
          label: z.string(),
          mode: z.enum(["increment", "full"]).optional(),
        }),
      ),
    ]),
  ).optional(),
  multiplayer: z.object({
    minPlayers: z.number().int().min(1),
    maxPlayers: z.number().int().min(1),
  }).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  achievements: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      icon: z.string().optional(),
    }),
  ).optional(),
});

export const MarketGameVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  platformVersion: z.string().min(1),
  downloadUrl: z.string(),
  sha256: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  publishedAt: z.string().datetime().optional(),
  releaseNotes: z.string().optional(),
  isPrerelease: z.boolean().optional(),
  gameManifest: GameManifestOverrideSchema.optional(),
});

/** 运行时校验版本载荷是否有效：downloadUrl 合法，sha256/size 可省略仅限 GitHub Releases 直链 */
export function isVersionPayloadValid(v: { downloadUrl: string; sha256?: string; size?: number }): boolean {
  if (!/^https?:\/\/.+/.test(v.downloadUrl)) return false;
  if ((!v.sha256 || v.size == null) && !isGitHubReleaseUrl(v.downloadUrl)) return false;
  if (v.sha256 && !/^[a-fA-F0-9]{64}$/.test(v.sha256)) return false;
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
  type: z.enum([
    "singleplayer",
    "multiplayer",
    "singlemultiple",
    "networkgame",
  ]),
  summary: z.string().min(1).max(200),
  tags: z.array(z.string().min(1)).optional(),
  iconUrl: z.string().url().optional(),
  coverUrl: z.string().url().optional(),
  screenshots: z.array(z.string().url()).optional(),
  featured: z.boolean().optional(),
  visibility: z.enum(["public", "hidden", "deprecated"]).optional(),
  minPlayers: z.number().int().min(1).optional(),
  maxPlayers: z.number().int().min(1).optional(),
  latestVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  versions: z.array(MarketGameVersionSchema).min(1),
});

export const MarketSourceSchema = z.object({
  marketId: z.string().min(1),
  marketName: z.string().min(1),
  coverUrl: z.string().url().optional(),
  generatedAt: z.string().datetime(),
  repository: z.string().url(),
  branch: z.string().min(1),
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

export interface DownloadTaskSnapshot {
  taskId: string;
  gameId: string;
  version: string;
  sourceIdx: number;
  downloadUrl: string;
  sha256: string;
  size: number;
  downloadPath: string;
  archiveType: "zip" | "7z";
  bytesReceived: number;
  status: "paused" | "interrupted";
  updatedAt: number;
}
