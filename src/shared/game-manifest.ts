import { z } from 'zod';

export const GameManifestSchema = z.object({
  $schema: z.string().optional(),
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9\-]+)+$/, {
    message: 'id 必须为反向域名格式，如 com.dev.mygame'
  }),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().max(500).optional(),
  author: z.string().min(1).max(100),
  website: z.string().url().optional(),
  platformVersion: z.string(),
  entry: z.string(),
  icon: z.string().optional(),
  cover: z.string().optional(),
  type: z.enum(['singleplayer', 'multiplayer']),
  multiplayer: z.object({
    minPlayers: z.number().int().min(1),
    maxPlayers: z.number().int().min(1),
  }).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export type GameManifest = z.infer<typeof GameManifestSchema>;
