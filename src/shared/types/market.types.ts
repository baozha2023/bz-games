import { z } from "zod";

export const MarketGameVersionSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  platformVersion: z.string().min(1),
  downloadUrl: z.string().url(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  size: z.number().int().nonnegative(),
  publishedAt: z.string().datetime().optional(),
  releaseNotes: z.string().optional(),
  isPrerelease: z.boolean().optional(),
});

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

export const MarketIndexSchema = z.object({
  schemaVersion: z.string().min(1),
  marketId: z.string().min(1),
  marketName: z.string().min(1),
  generatedAt: z.string().datetime(),
  source: z
    .object({
      repository: z.string().url().optional(),
      branch: z.string().min(1).optional(),
    })
    .optional(),
  games: z.array(MarketGameSchema),
});

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
  | "canceled";

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
