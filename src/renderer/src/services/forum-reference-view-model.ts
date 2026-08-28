import type {
  ForumGameReferenceToken,
  ForumMarketToken,
  ForumPostToken,
  ForumReferenceInput,
  ForumReferenceLike,
  ForumReferenceToken,
  ForumVersionToken,
} from "../../../shared/forum-references";
import { getForumPage, type ForumPageDefinition } from "./forum-page-registry";
import {
  resolveForumMarketReferences,
  type ForumMarketApi,
} from "./forum-market-reference-service";
import {
  resolveForumPostReferences,
  type ForumPostReferenceApi,
  type ForumPostReferenceResolution,
} from "./forum-post-reference-service";

export type ForumReferenceViewStatus =
  | "resolved"
  | "missing"
  | "deleted"
  | "unavailable";

interface ForumReferenceViewModelBase {
  key: string;
  status: ForumReferenceViewStatus;
  label: string;
}

export interface ForumGameReferenceViewModel extends ForumReferenceViewModelBase {
  type: "game";
  marketId: string;
  gameId: string;
  marketName?: string;
  gameName?: string;
}

export interface ForumVersionReferenceViewModel extends ForumReferenceViewModelBase {
  type: "version";
  marketId: string;
  gameId: string;
  version: string;
  marketName?: string;
  gameName?: string;
}

export interface ForumMarketReferenceViewModel extends ForumReferenceViewModelBase {
  type: "market";
  marketId: string;
  marketName?: string;
}

export interface ForumPostReferenceViewModel extends ForumReferenceViewModelBase {
  type: "post";
  postId: string;
  excerpt: string;
}

export interface ForumPageReferenceViewModel extends ForumReferenceViewModelBase {
  type: "page";
  pageId: string;
  page?: ForumPageDefinition;
}

export type ForumReferenceViewModel =
  | ForumGameReferenceViewModel
  | ForumVersionReferenceViewModel
  | ForumMarketReferenceViewModel
  | ForumPostReferenceViewModel
  | ForumPageReferenceViewModel;

export interface ForumReferenceViewModelDependencies {
  marketApi: ForumMarketApi;
  postApi: ForumPostReferenceApi;
  translate: (key: string) => string;
}

export function forumReferenceKey(token: ForumReferenceLike): string {
  switch (token.type) {
    case "game":
      return `game:${token.marketId}/${token.gameId}`;
    case "version":
      return `version:${token.marketId}/${token.gameId}/${token.version}`;
    case "market":
      return `market:${token.marketId}`;
    case "post":
      return `post:${token.postId}`;
    case "page":
      return `page:${token.pageId}`;
  }
}

export function forumPostExcerpt(body: string): string {
  const chars = Array.from(body.replace(/\s+/gu, " ").trim());
  return `${chars.slice(0, 50).join("")}${chars.length > 50 ? "…" : ""}`;
}

export type ForumResolvedReferenceSeed =
  | {
      reference: Extract<ForumReferenceInput, { type: "game" }>;
      marketName: string;
      gameName: string;
    }
  | {
      reference: Extract<ForumReferenceInput, { type: "version" }>;
      marketName: string;
      gameName: string;
    }
  | {
      reference: Extract<ForumReferenceInput, { type: "market" }>;
      marketName: string;
    }
  | {
      reference: Extract<ForumReferenceInput, { type: "post" }>;
      title: string;
      body?: string;
    }
  | {
      reference: Extract<ForumReferenceInput, { type: "page" }>;
    };

export function createResolvedForumReferenceViewModel(
  seed: ForumResolvedReferenceSeed,
  translate: (key: string) => string,
): ForumReferenceViewModel {
  const { reference } = seed;
  const key = forumReferenceKey(reference);
  if (reference.type === "game" && "gameName" in seed)
    return {
      type: "game",
      key,
      status: "resolved",
      label: `${seed.marketName} / ${seed.gameName}`,
      marketId: reference.marketId,
      gameId: reference.gameId,
      marketName: seed.marketName,
      gameName: seed.gameName,
    };
  if (reference.type === "version" && "gameName" in seed)
    return {
      type: "version",
      key,
      status: "resolved",
      label: `${seed.marketName} / ${seed.gameName} · ${reference.version}`,
      marketId: reference.marketId,
      gameId: reference.gameId,
      version: reference.version,
      marketName: seed.marketName,
      gameName: seed.gameName,
    };
  if (reference.type === "market" && "marketName" in seed)
    return {
      type: "market",
      key,
      status: "resolved",
      label: seed.marketName,
      marketId: reference.marketId,
      marketName: seed.marketName,
    };
  if (reference.type === "post" && "title" in seed)
    return {
      type: "post",
      key,
      status: "resolved",
      label: seed.title,
      excerpt: forumPostExcerpt(seed.body || ""),
      postId: reference.postId,
    };
  if (reference.type === "page") {
    const page = getForumPage(reference.pageId);
    if (page)
      return {
        type: "page",
        key,
        status: "resolved",
        label: translate(page.labelKey),
        pageId: reference.pageId,
        page,
      };
  }
  throw new Error("invalid_resolved_forum_reference_seed");
}

function fallbackLabel(
  status: "missing" | "unavailable",
  missingKey: string,
  translate: (key: string) => string,
): string {
  return translate(
    status === "unavailable" ? "forumCommands.unavailable" : missingKey,
  );
}

function postViewModel(
  token: ForumPostToken,
  result: ForumPostReferenceResolution | undefined,
  translate: (key: string) => string,
): ForumPostReferenceViewModel {
  const key = forumReferenceKey(token);
  if (result?.status === "active")
    return {
      type: "post",
      key,
      status: "resolved",
      label: result.title,
      excerpt: forumPostExcerpt(result.body),
      postId: token.postId,
    };
  const status = result?.status || "unavailable";
  return {
    type: "post",
    key,
    status,
    label:
      status === "deleted"
        ? translate("forumCommands.deletedPost")
        : fallbackLabel(status, "forumCommands.missingPost", translate),
    excerpt: "",
    postId: token.postId,
  };
}

export async function resolveForumReferenceViewModels(
  tokens: ForumReferenceToken[],
  dependencies: ForumReferenceViewModelDependencies,
): Promise<Map<string, ForumReferenceViewModel>> {
  const { marketApi, postApi, translate } = dependencies;
  const uniqueTokens = [
    ...new Map(
      tokens.map((token) => [forumReferenceKey(token), token]),
    ).values(),
  ];
  const marketTokens = uniqueTokens.filter(
    (
      token,
    ): token is
      | ForumGameReferenceToken
      | ForumVersionToken
      | ForumMarketToken =>
      token.type === "game" ||
      token.type === "version" ||
      token.type === "market",
  );
  const postTokens = uniqueTokens.filter(
    (token): token is ForumPostToken => token.type === "post",
  );
  const [marketResult, postResult] = await Promise.all([
    marketTokens.length
      ? resolveForumMarketReferences(marketTokens, marketApi).catch(() => null)
      : Promise.resolve(null),
    postTokens.length
      ? resolveForumPostReferences(
          postTokens.map((token) => token.postId),
          postApi,
        )
      : Promise.resolve(new Map<string, ForumPostReferenceResolution>()),
  ]);
  const result = new Map<string, ForumReferenceViewModel>();

  for (const token of uniqueTokens) {
    const key = forumReferenceKey(token);
    if (token.type === "game") {
      const resolution = marketResult?.games.get(
        `${token.marketId}/${token.gameId}`,
      );
      const status = resolution?.status || "unavailable";
      result.set(
        key,
        resolution?.status === "resolved"
          ? {
              type: "game",
              key,
              status,
              label: `${resolution.marketName} / ${resolution.gameName}`,
              marketId: token.marketId,
              gameId: token.gameId,
              marketName: resolution.marketName,
              gameName: resolution.gameName,
            }
          : {
              type: "game",
              key,
              status,
              label: fallbackLabel(
                status === "missing" ? "missing" : "unavailable",
                "forumCommands.unknownGame",
                translate,
              ),
              marketId: token.marketId,
              gameId: token.gameId,
            },
      );
      continue;
    }
    if (token.type === "version") {
      const resolution = marketResult?.versions.get(
        `${token.marketId}/${token.gameId}/${token.version}`,
      );
      const status = resolution?.status || "unavailable";
      result.set(
        key,
        resolution?.status === "resolved"
          ? {
              type: "version",
              key,
              status,
              label: `${resolution.marketName} / ${resolution.gameName} · ${resolution.version}`,
              marketId: token.marketId,
              gameId: token.gameId,
              version: token.version,
              marketName: resolution.marketName,
              gameName: resolution.gameName,
            }
          : {
              type: "version",
              key,
              status,
              label: fallbackLabel(
                status === "missing" ? "missing" : "unavailable",
                "forumCommands.unknownVersion",
                translate,
              ),
              marketId: token.marketId,
              gameId: token.gameId,
              version: token.version,
            },
      );
      continue;
    }
    if (token.type === "market") {
      const resolution = marketResult?.markets.get(token.marketId);
      const status = resolution?.status || "unavailable";
      result.set(
        key,
        resolution?.status === "resolved"
          ? {
              type: "market",
              key,
              status,
              label: resolution.marketName,
              marketId: token.marketId,
              marketName: resolution.marketName,
            }
          : {
              type: "market",
              key,
              status,
              label: fallbackLabel(
                status === "missing" ? "missing" : "unavailable",
                "forumCommands.unknownMarket",
                translate,
              ),
              marketId: token.marketId,
            },
      );
      continue;
    }
    if (token.type === "post") {
      result.set(
        key,
        postViewModel(token, postResult.get(token.postId), translate),
      );
      continue;
    }
    const page = getForumPage(token.pageId);
    result.set(key, {
      type: "page",
      key,
      status: page ? "resolved" : "missing",
      label: page
        ? translate(page.labelKey)
        : translate("forumCommands.unknownPage"),
      pageId: token.pageId,
      page,
    });
  }
  return result;
}
