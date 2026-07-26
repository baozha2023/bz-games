import { z } from "zod";
import semver from "semver";
import { GameType } from "./types/game.types";

const HTTP_URL_PATTERN = /^https?:\/\//i;
const UNSAFE_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isSafeGameManifestPath(value: string): boolean {
  if (
    !value ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return false;
  }
  return value
    .split(/[\\/]/)
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

export function compareGameVersionsDescending(a: string, b: string): number {
  const validA = semver.valid(a);
  const validB = semver.valid(b);
  if (validA && validB) return semver.rcompare(validA, validB);
  if (validA) return -1;
  if (validB) return 1;
  return b.localeCompare(a, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export const GameIdSchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[a-z0-9]+(\.[a-z0-9\-]+)+$/, {
    message: "id must use reverse-domain format, such as com.dev.mygame",
  });

export const GameVersionSchema = z
  .string()
  .max(100)
  .refine((value) => semver.valid(value) !== null, {
    message: "version must be a valid semantic version",
  });

export const HttpUrlSchema = z
  .string()
  .max(2048)
  .url()
  .regex(HTTP_URL_PATTERN, {
    message: "only http/https URLs are supported",
  });

export const ManifestPathSchema = z
  .string()
  .max(500)
  .refine(isSafeGameManifestPath, "must be a safe relative path inside the game directory");

const OptionalManifestPathSchema = ManifestPathSchema.optional();

export const PlatformVersionRangeSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => semver.validRange(value) !== null, {
    message: "platformVersion must be a valid SemVer range",
  });

export const PlatformVersionSchema = z.union([
  PlatformVersionRangeSchema,
  z
    .tuple([GameVersionSchema, GameVersionSchema])
    .refine(([min, max]) => semver.lte(min, max), {
      message: "platformVersion minimum cannot exceed its maximum",
    }),
]);

export const MultiplayerSchema = z
  .object({
    minPlayers: z.number().int().min(1),
    maxPlayers: z.number().int().min(1),
  })
  .refine(({ minPlayers, maxPlayers }) => minPlayers <= maxPlayers, {
    path: ["maxPlayers"],
    message: "maxPlayers cannot be less than minPlayers",
  });

export const ManifestArgsSchema = z.array(z.string().max(8192)).max(256);

export const ManifestEnvSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, {
        message: "invalid environment variable name",
      }),
    z.string().max(32768),
  )
  .refine(
    (value) =>
      !Object.keys(value).some((key) => key.toUpperCase().startsWith("BZ_")),
    {
      message: "env cannot override reserved BZ_* launch variables",
    },
  )
  .refine(
    (value) =>
      !Object.keys(value).some((key) =>
        UNSAFE_RECORD_KEYS.has(key.toLowerCase()),
      ),
    {
      message: "env contains an unsafe environment variable name",
    },
  );

const StatisticIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !UNSAFE_RECORD_KEYS.has(value.toLowerCase()), {
    message: "unsafe statistic ID",
  });

export const GameManifestBaseSchema = z.object({
  $schema: z.string().optional(),
  id: GameIdSchema,
  name: z.string().min(1).max(100),
  version: GameVersionSchema,
  description: z.string().max(500).optional(),
  author: z.string().min(1).max(100),
  author_url: HttpUrlSchema.optional(),
  platformVersion: PlatformVersionSchema,
  entry: z.string().max(500),
  web_url: HttpUrlSchema.optional(),
  icon: OptionalManifestPathSchema,
  cover: OptionalManifestPathSchema,
  video: OptionalManifestPathSchema,
  encryptLocalStorage: z.boolean().optional(),
  type: z.nativeEnum(GameType),
  statistics: z
    .array(
      z.union([
        StatisticIdSchema,
        z.record(StatisticIdSchema, z.string().max(200)),
        z.record(
          StatisticIdSchema,
          z.object({
            label: z.string().min(1).max(200),
            mode: z.enum(["increment", "full"]).optional(),
          }),
        ),
      ]),
    )
    .optional(),
  multiplayer: MultiplayerSchema.optional(),
  args: ManifestArgsSchema.optional(),
  env: ManifestEnvSchema.optional(),
  achievements: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().min(1).max(200),
        description: z.string().max(1000),
        icon: OptionalManifestPathSchema,
      }),
    )
    .max(1000)
    .refine(
      (achievements) =>
        new Set(achievements.map((achievement) => achievement.id)).size ===
        achievements.length,
      {
        message: "achievement IDs must be unique",
      },
    )
    .optional(),
});

export const GameManifestSchema = GameManifestBaseSchema.superRefine(
  (manifest, ctx) => {
    if (
      manifest.entry !== "url" &&
      manifest.entry !== "serve" &&
      !isSafeGameManifestPath(manifest.entry)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry"],
        message: "entry must be a safe relative path inside the game directory",
      });
    }
    if (manifest.entry === "url" && !manifest.web_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["web_url"],
        message: "web_url is required and must be valid when entry=url",
      });
    }
    if (manifest.entry !== "url" && manifest.web_url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["web_url"],
        message: "web_url is only allowed when entry=url",
      });
    }
    const extension = manifest.entry
      .slice(manifest.entry.lastIndexOf("."))
      .toLowerCase();
    const isWebEntry =
      manifest.entry === "url" ||
      manifest.entry === "serve" ||
      extension === ".html" ||
      extension === ".htm";
    if (isWebEntry && manifest.args && manifest.args.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["args"],
        message: "args are only supported by native game entries",
      });
    }
    if (isWebEntry && manifest.env && Object.keys(manifest.env).length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["env"],
        message: "env is only supported by native game entries",
      });
    }
    if (!isWebEntry && manifest.encryptLocalStorage === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["encryptLocalStorage"],
        message: "encryptLocalStorage is only supported by web game entries",
      });
    }
    if (
      (manifest.type === GameType.Multiplayer ||
        manifest.type === GameType.SingleMultiple) &&
      !manifest.multiplayer
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["multiplayer"],
        message: "multiplayer games must declare a multiplayer player range",
      });
    }
    if (manifest.type === GameType.NetworkGame && manifest.entry !== "url") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entry"],
        message: "networkgame must use entry=url",
      });
    }
    if (
      manifest.type !== GameType.Multiplayer &&
      manifest.type !== GameType.SingleMultiple &&
      manifest.multiplayer
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["multiplayer"],
        message: "only multiplayer game types may declare multiplayer",
      });
    }
  },
);

export type GameManifest = z.infer<typeof GameManifestSchema>;
export type Achievement = NonNullable<GameManifest["achievements"]>[number];
