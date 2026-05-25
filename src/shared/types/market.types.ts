import { z } from "zod";

export const MarketGameVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  platformVersion: z.string().min(1),
  downloadUrl: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative(),
  publishedAt: z.string().datetime().optional(),
  releaseNotes: z.string().optional(),
  isPrerelease: z.boolean().optional(),
});

/** 运行时校验 downloadUrl 和 sha256 是否有效（不依赖 Zod，仅前端展示用） */
export function isVersionPayloadValid(v: { downloadUrl: string; sha256: string }): boolean {
  return /^https?:\/\/.+/.test(v.downloadUrl) && /^[a-fA-F0-9]{64}$/.test(v.sha256);
}

export const MarketGameSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9\-]+)+$/),
  name: z.string().min(1).max(100),
  author: z.string().min(1).max(100),
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
  | "download"
  | "verify"
  | "extract"
  | "install";

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
