import { z } from "zod";
import { GameType } from "./game.types";
import {
  GameManifestBaseSchema,
  GameManifestV2AchievementSchema,
  GameManifestV2StatisticSchema,
  ManifestItemIdSchema,
  GameVersionSchema,
  PlatformVersionRangeSchema,
} from "../game-manifest";
import {
  SUPPORTED_LOCALES,
  SupportedLocaleSchema,
  type SupportedLocale,
} from "../localization";

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

const GameManifestV1OverrideSchema = GameManifestBaseSchema.omit({
  $schema: true,
  id: true,
  version: true,
}).partial();

const GameManifestV2OverrideSchema = GameManifestBaseSchema.omit({
  $schema: true,
  id: true,
  name: true,
  version: true,
  description: true,
  statistics: true,
  achievements: true,
})
  .partial()
  .extend({
    manifestVersion: z.literal(2),
    defaultLocale: SupportedLocaleSchema.optional(),
    statistics: z.array(GameManifestV2StatisticSchema).max(1000).optional(),
    achievements: z.array(GameManifestV2AchievementSchema).max(1000).optional(),
    localizations: z
      .record(
        z.string(),
        z
          .object({
            name: z.string().min(1).max(100).optional(),
            description: z.string().max(500).optional(),
            achievements: z.record(
              ManifestItemIdSchema,
              z
                .object({
                  title: z.string().min(1).max(200),
                  description: z.string().max(1000),
                })
                .strict(),
            ),
            statistics: z.record(
              ManifestItemIdSchema,
              z.string().min(1).max(200),
            ),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

type GameManifestV1Override = z.infer<typeof GameManifestV1OverrideSchema>;
type GameManifestV2Override = z.infer<typeof GameManifestV2OverrideSchema>;
export type GameManifestOverride =
  | GameManifestV1Override
  | GameManifestV2Override;

export const GameManifestOverrideSchema = z
  .unknown()
  .transform((raw, ctx): GameManifestOverride => {
    const isV2 =
      typeof raw === "object" &&
      raw !== null &&
      (raw as { manifestVersion?: unknown }).manifestVersion === 2;
    const result = (
      isV2 ? GameManifestV2OverrideSchema : GameManifestV1OverrideSchema
    ).safeParse(raw);
    if (result.success) return result.data;
    for (const issue of result.error.issues) ctx.addIssue(issue);
    return z.NEVER;
  });

const MarketGameLocalizationSchema = z
  .object({
    name: z.string().min(1).max(100),
    summary: z.string().min(1).max(500),
    tags: z.array(z.string().min(1).max(100)).max(100),
  })
  .strict();

const MarketVersionLocalizationSchema = z
  .object({
    description: z.string().min(1),
    releaseNotes: z.string().optional(),
  })
  .strict();

const LocalizationMapSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.record(z.string(), schema).superRefine((value, ctx) => {
    for (const locale of Object.keys(value)) {
      if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [locale],
          message: `unsupported locale: ${locale}`,
        });
      }
    }
  });

export const MarketGameVersionV2Schema = z
  .object({
    version: GameVersionSchema,
    platformVersion: PlatformVersionRangeSchema,
    downloadUrl: z
      .string()
      .refine(isValidDownloadUrl, "Invalid download URL")
      .optional(),
    sha256: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    publishedAt: z.string().datetime().optional(),
    localizations: LocalizationMapSchema(MarketVersionLocalizationSchema),
    isPrerelease: z.boolean().optional(),
    gameManifest: GameManifestOverrideSchema.optional(),
  })
  .strict();

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
export function isVersionDownloadable(
  v: {
    downloadUrl?: string;
    sha256?: string;
    size?: number;
  },
  allowManifestOnly = false,
): boolean {
  if (!v.downloadUrl) return allowManifestOnly;
  if (!isValidDownloadUrl(v.downloadUrl)) return false;
  if (!isValidSha256Format(v.sha256)) return false;
  if (isMissingSize(v) && !isGitHubReleaseUrl(v.downloadUrl)) return false;
  return true;
}

/** 判断 downloadUrl 是否为 GitHub Releases 直链 */
export function isGitHubReleaseUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(url);
}

export const MarketGameV2Schema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9\-]+)+$/),
    defaultLocale: SupportedLocaleSchema,
    localizations: LocalizationMapSchema(MarketGameLocalizationSchema),
    author: z.string().min(1).max(100),
    author_url: z.string().url().optional(),
    type: z.nativeEnum(GameType),
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
    versions: z.array(MarketGameVersionV2Schema).min(1),
  })
  .strict()
  .superRefine((game, ctx) => {
    const locales = Object.keys(game.localizations).sort();
    if (!game.localizations[game.defaultLocale]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localizations", game.defaultLocale],
        message: "defaultLocale must have a complete localization bundle",
      });
    }
    for (const [index, version] of game.versions.entries()) {
      const versionLocales = Object.keys(version.localizations).sort();
      if (
        versionLocales.length !== locales.length ||
        versionLocales.some(
          (locale, localeIndex) => locale !== locales[localeIndex],
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["versions", index, "localizations"],
          message: "every version must use the game's complete language set",
        });
      }
      if (
        !version.downloadUrl &&
        !(game.type === GameType.NetworkGame && version.gameManifest)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["versions", index, "downloadUrl"],
          message:
            "downloadUrl is required unless a network game has a manifest override",
        });
      }
    }
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

export const MarketSourceSchema = z
  .object({
    marketId: z.string().min(1),
    marketName: z.string().min(1),
    coverUrl: z.string().url().optional(),
    generatedAt: z.string().datetime(),
    repository: GitHubRepositoryUrlSchema,
    branch: z.string().refine(isValidGitBranch, "Invalid Git branch"),
    featured: z.boolean().optional(),
    visibility: z.enum(["public", "hidden"]).optional(),
  })
  .strict();

export const MarketDirectorySchema = z
  .object({
    schemaVersion: z.literal(2),
    sources: z.array(MarketSourceSchema).min(1),
  })
  .strict()
  .superRefine((directory, ctx) => {
    const ids = directory.sources.map(({ marketId }) => marketId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "marketId values must be unique",
      });
    }
  });

export const MarketIndexV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    marketId: z.string().min(1),
    marketName: z.string().min(1),
    generatedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    repository: GitHubRepositoryUrlSchema.optional(),
    author: z.string().min(1).max(100).optional(),
    games: z.array(MarketGameV2Schema),
  })
  .strict();

/** The official market.json is the only document that combines the directory and index. */
export const OfficialMarketCatalogV2Schema = MarketIndexV2Schema.extend({
  sources: z.array(MarketSourceSchema).min(1),
}).superRefine((catalog, ctx) => {
  const ids = catalog.sources.map(({ marketId }) => marketId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sources"],
      message: "marketId values must be unique",
    });
  }
});

export type MarketSource = z.infer<typeof MarketSourceSchema>;
export type MarketDirectory = z.infer<typeof MarketDirectorySchema>;
export type RawMarketGameVersion = z.infer<typeof MarketGameVersionV2Schema>;
export type RawMarketGame = z.infer<typeof MarketGameV2Schema>;
export type RawMarketIndex = z.infer<typeof MarketIndexV2Schema>;

export type MarketGameVersion = Omit<
  RawMarketGameVersion,
  "downloadUrl" | "localizations"
> & {
  downloadUrl: string;
  description: string;
  releaseNotes?: string;
};

export type MarketGame = Omit<
  RawMarketGame,
  "defaultLocale" | "localizations" | "versions"
> & {
  name: string;
  summary: string;
  tags: string[];
  versions: MarketGameVersion[];
};

export type MarketIndex = Omit<RawMarketIndex, "games"> & {
  games: MarketGame[];
};

export function resolveMarketIndex(
  index: RawMarketIndex,
  locale: SupportedLocale,
): MarketIndex {
  return {
    ...index,
    games: index.games.map((game) => {
      const {
        defaultLocale,
        localizations: gameLocalizations,
        versions,
        ...gameMetadata
      } = game;
      const resolvedLocale = gameLocalizations[locale] ? locale : defaultLocale;
      const localization = gameLocalizations[resolvedLocale];
      return {
        ...gameMetadata,
        name: localization.name,
        summary: localization.summary,
        tags: localization.tags,
        versions: versions.map((version) => {
          const { localizations, ...versionMetadata } = version;
          const versionLocalization = localizations[resolvedLocale];
          return {
            ...versionMetadata,
            downloadUrl: version.downloadUrl || "",
            description: versionLocalization.description,
            releaseNotes: versionLocalization.releaseNotes,
          };
        }),
      };
    }),
  };
}

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
  marketId?: string;
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
  marketId: string;
  downloadUrl: string;
  sha256: string | undefined;
  size: number;
  downloadPath: string;
  archiveType: "zip" | "7z";
  bytesReceived: number;
  status: "paused" | "interrupted";
  updatedAt: number;
}
