import { z } from "zod";
import semver from "semver";
import { GameType } from "./types/game.types";
import {
  SUPPORTED_LOCALES,
  SupportedLocaleSchema,
  type SupportedLocale,
} from "./localization";

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
  .refine(
    isSafeGameManifestPath,
    "must be a safe relative path inside the game directory",
  );

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

export const ManifestItemIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: "ID may only contain letters, numbers, dot, underscore and hyphen",
  })
  .refine((value) => !UNSAFE_RECORD_KEYS.has(value.toLowerCase()), {
    message: "unsafe manifest item ID",
  });

const StatisticIdSchema = ManifestItemIdSchema;

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
  windowedFullscreen: z.boolean().optional(),
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

type RuntimeManifestFields = z.infer<typeof GameManifestBaseSchema>;

function validateRuntimeManifest(
  manifest: RuntimeManifestFields,
  ctx: z.RefinementCtx,
): void {
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
  if (!isWebEntry && manifest.windowedFullscreen !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["windowedFullscreen"],
      message: "windowedFullscreen is only supported by Web game entries",
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
}

/** Manifest V1 remains the existing single-language contract. */
export const GameManifestV1Schema = GameManifestBaseSchema.superRefine(
  validateRuntimeManifest,
);

export const GameManifestV2StatisticSchema = z
  .object({
    id: ManifestItemIdSchema,
    mode: z.enum(["increment", "full"]),
  })
  .strict();

export const GameManifestV2AchievementSchema = z
  .object({
    id: ManifestItemIdSchema,
    icon: OptionalManifestPathSchema,
  })
  .strict();

export const GameManifestV2LocalizationSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500),
    achievements: z.record(
      ManifestItemIdSchema,
      z
        .object({
          title: z.string().min(1).max(200),
          description: z.string().max(1000),
        })
        .strict(),
    ),
    statistics: z.record(ManifestItemIdSchema, z.string().min(1).max(200)),
  })
  .strict();

const GameManifestV2BaseSchema = GameManifestBaseSchema.omit({
  name: true,
  description: true,
  statistics: true,
  achievements: true,
})
  .extend({
    manifestVersion: z.literal(2),
    defaultLocale: SupportedLocaleSchema,
    localizations: z.record(z.string(), GameManifestV2LocalizationSchema),
    statistics: z.array(GameManifestV2StatisticSchema).max(1000).default([]),
    achievements: z
      .array(GameManifestV2AchievementSchema)
      .max(1000)
      .default([]),
  })
  .strict();

export const GameManifestV2Schema = GameManifestV2BaseSchema.superRefine(
  (manifest, ctx) => {
    validateRuntimeManifest(
      {
        ...manifest,
        name: manifest.localizations[manifest.defaultLocale]?.name ?? "",
        description:
          manifest.localizations[manifest.defaultLocale]?.description ?? "",
        statistics: undefined,
        achievements: undefined,
      },
      ctx,
    );

    const localeKeys = Object.keys(manifest.localizations);
    for (const locale of localeKeys) {
      if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["localizations", locale],
          message: `unsupported locale: ${locale}`,
        });
      }
    }
    if (!manifest.localizations[manifest.defaultLocale]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localizations", manifest.defaultLocale],
        message: "defaultLocale must have a complete localization bundle",
      });
    }

    const statisticIds = manifest.statistics.map(({ id }) => id);
    const achievementIds = manifest.achievements.map(({ id }) => id);
    if (new Set(statisticIds).size !== statisticIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["statistics"],
        message: "statistic IDs must be unique",
      });
    }
    if (new Set(achievementIds).size !== achievementIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["achievements"],
        message: "achievement IDs must be unique",
      });
    }

    const expectedStatistics = new Set(statisticIds);
    const expectedAchievements = new Set(achievementIds);
    for (const [locale, localization] of Object.entries(
      manifest.localizations,
    )) {
      const localizedStatistics = Object.keys(localization.statistics);
      const localizedAchievements = Object.keys(localization.achievements);
      if (
        localizedStatistics.length !== expectedStatistics.size ||
        localizedStatistics.some((id) => !expectedStatistics.has(id))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["localizations", locale, "statistics"],
          message: "localization must cover every statistic ID exactly once",
        });
      }
      if (
        localizedAchievements.length !== expectedAchievements.size ||
        localizedAchievements.some((id) => !expectedAchievements.has(id))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["localizations", locale, "achievements"],
          message: "localization must cover every achievement ID exactly once",
        });
      }
    }
  },
);

export type GameManifestV1 = z.infer<typeof GameManifestV1Schema>;
export type GameManifestV2 = z.infer<typeof GameManifestV2Schema>;
export type GameManifest = GameManifestV1 | GameManifestV2;

export type ResolvedGameManifest = Omit<
  GameManifestV1,
  "statistics" | "achievements"
> & {
  manifestVersion: 1 | 2;
  resolvedLocale?: SupportedLocale;
  defaultLocale?: SupportedLocale;
  statistics?: Array<
    Record<string, { label: string; mode?: "increment" | "full" }>
  >;
  achievements?: Array<{
    id: string;
    title: string;
    description: string;
    icon?: string;
  }>;
};

/**
 * The version switch deliberately lives here. Only the exact numeric value 2
 * opts into V2; every other value follows the permanent V1 contract.
 */
export function parseGameManifest(raw: unknown): GameManifest {
  if (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { manifestVersion?: unknown }).manifestVersion === 2
  ) {
    return GameManifestV2Schema.parse(raw);
  }
  return GameManifestV1Schema.parse(raw);
}

export function resolveGameManifest(
  manifest: GameManifest,
  locale: SupportedLocale,
): ResolvedGameManifest {
  if ((manifest as GameManifestV2).manifestVersion === 2) {
    const v2 = manifest as GameManifestV2;
    const resolvedLocale = v2.localizations[locale] ? locale : v2.defaultLocale;
    const localization = v2.localizations[resolvedLocale];
    return {
      $schema: v2.$schema,
      manifestVersion: 2,
      resolvedLocale,
      defaultLocale: v2.defaultLocale,
      id: v2.id,
      version: v2.version,
      name: localization.name,
      description: localization.description,
      author: v2.author,
      author_url: v2.author_url,
      platformVersion: v2.platformVersion,
      entry: v2.entry,
      web_url: v2.web_url,
      icon: v2.icon,
      cover: v2.cover,
      video: v2.video,
      encryptLocalStorage: v2.encryptLocalStorage,
      type: v2.type,
      statistics: v2.statistics.map(({ id, mode }) => ({
        [id]: { label: localization.statistics[id], mode },
      })),
      multiplayer: v2.multiplayer,
      args: v2.args,
      env: v2.env,
      windowedFullscreen: v2.windowedFullscreen,
      achievements: v2.achievements.map(({ id, icon }) => ({
        id,
        icon,
        ...localization.achievements[id],
      })),
    };
  }

  const v1 = manifest as GameManifestV1;
  return {
    ...v1,
    manifestVersion: 1,
    statistics: v1.statistics?.map((statistic) => {
      if (typeof statistic === "string") {
        return { [statistic]: { label: statistic } };
      }
      const [id, value] = Object.entries(statistic)[0] as [
        string,
        string | { label: string; mode?: "increment" | "full" },
      ];
      return {
        [id]:
          typeof value === "string"
            ? { label: value }
            : { label: value.label, mode: value.mode },
      };
    }),
  };
}

export type Achievement = NonNullable<
  ResolvedGameManifest["achievements"]
>[number];
