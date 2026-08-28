import type {
  MarketDirectory,
  MarketIndex,
  MarketSource,
} from "../../../shared/types";
import type {
  ForumGameReferenceToken,
  ForumMarketToken,
  ForumVersionToken,
} from "../../../shared/forum-references";

export interface ForumMarketApi {
  getSources: () => Promise<MarketDirectory>;
  getIndex: (marketId: string) => Promise<MarketIndex>;
}

export interface ForumMarketIndexEntry {
  marketId: string;
  source: MarketSource;
  index: MarketIndex;
}

export interface ResolvedForumGameReference {
  marketId: string;
  marketName: string;
  gameId: string;
  gameName: string;
}

export type ForumMarketReferenceResolution =
  | { status: "resolved"; marketId: string; marketName: string }
  | { status: "missing" }
  | { status: "unavailable" };

export type ForumGameReferenceResolution =
  | ({ status: "resolved" } & ResolvedForumGameReference)
  | { status: "missing" }
  | { status: "unavailable" };

export type ForumVersionReferenceResolution =
  | ({ status: "resolved"; version: string } & ResolvedForumGameReference)
  | { status: "missing" }
  | { status: "unavailable" };

export interface ForumMarketLoadState {
  entries: ForumMarketIndexEntry[];
  failedMarketIds: string[];
}

async function loadIndexes(
  directory: MarketDirectory,
  marketIds: string[],
  api: ForumMarketApi,
  concurrency: number,
  onEntry?: (entry: ForumMarketIndexEntry) => void,
): Promise<ForumMarketLoadState> {
  const sources = new Map(
    directory.sources.map((source) => [source.marketId, source]),
  );
  const uniqueIds = [...new Set(marketIds)].filter((marketId) =>
    sources.has(marketId),
  );
  const entries: ForumMarketIndexEntry[] = [];
  const failedMarketIds: string[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < uniqueIds.length) {
      const marketId = uniqueIds[cursor++];
      try {
        const index = await api.getIndex(marketId);
        const source = sources.get(marketId);
        if (!source || index.marketId !== marketId) {
          failedMarketIds.push(marketId);
          continue;
        }
        const entry = { marketId, source, index };
        entries.push(entry);
        onEntry?.(entry);
      } catch {
        failedMarketIds.push(marketId);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), uniqueIds.length) },
      () => worker(),
    ),
  );
  entries.sort((left, right) => left.marketId.localeCompare(right.marketId));
  failedMarketIds.sort();
  return { entries, failedMarketIds };
}

export async function loadForumMarketIndexes(
  api: ForumMarketApi,
  options: {
    directory?: MarketDirectory;
    marketIds?: string[];
    concurrency?: number;
    onEntry?: (entry: ForumMarketIndexEntry) => void;
  } = {},
): Promise<ForumMarketLoadState & { directory: MarketDirectory }> {
  const directory = options.directory || (await api.getSources());
  const marketIds =
    options.marketIds || directory.sources.map(({ marketId }) => marketId);
  const state = await loadIndexes(
    directory,
    marketIds,
    api,
    options.concurrency ?? 3,
    options.onEntry,
  );
  return { directory, ...state };
}

type ResolutionMaps = {
  markets: Map<string, ForumMarketReferenceResolution>;
  games: Map<string, ForumGameReferenceResolution>;
  versions: Map<string, ForumVersionReferenceResolution>;
};

function setResolution(
  token: ForumGameReferenceToken | ForumVersionToken | ForumMarketToken,
  status: "missing" | "unavailable",
  result: ResolutionMaps,
): void {
  if (token.type === "market") result.markets.set(token.marketId, { status });
  if (token.type === "game") {
    result.games.set(`${token.marketId}/${token.gameId}`, { status });
  }
  if (token.type === "version") {
    result.versions.set(
      `${token.marketId}/${token.gameId}/${token.version}`,
      { status },
    );
  }
}

export async function resolveForumMarketReferences(
  tokens: Array<ForumGameReferenceToken | ForumVersionToken | ForumMarketToken>,
  api: ForumMarketApi,
): Promise<ResolutionMaps> {
  const result: ResolutionMaps = {
    markets: new Map(),
    games: new Map(),
    versions: new Map(),
  };
  if (!tokens.length) return result;

  let directory: MarketDirectory;
  try {
    directory = await api.getSources();
  } catch {
    for (const token of tokens) setResolution(token, "unavailable", result);
    return result;
  }

  const sources = new Map(
    directory.sources.map((source) => [source.marketId, source]),
  );
  const requestedMarketIds = tokens
    .map(({ marketId }) => marketId)
    .filter((marketId) => sources.has(marketId));
  const state = await loadIndexes(directory, requestedMarketIds, api, 3);
  const entries = new Map(state.entries.map((entry) => [entry.marketId, entry]));
  const failed = new Set(state.failedMarketIds);

  for (const token of tokens) {
    if (!sources.has(token.marketId)) {
      setResolution(token, "missing", result);
      continue;
    }
    const entry = entries.get(token.marketId);
    if (!entry && failed.has(token.marketId)) {
      setResolution(token, "unavailable", result);
      continue;
    }
    if (!entry) continue;
    if (token.type === "market") {
      result.markets.set(token.marketId, {
        status: "resolved",
        marketId: token.marketId,
        marketName: entry.index.marketName,
      });
      continue;
    }
    const game = entry.index.games.find((item) => item.id === token.gameId);
    if (!game) {
      setResolution(token, "missing", result);
      continue;
    }
    const resolved = {
      marketId: token.marketId,
      marketName: entry.index.marketName,
      gameId: token.gameId,
      gameName: game.name,
    };
    if (token.type === "game") {
      result.games.set(`${token.marketId}/${token.gameId}`, {
        status: "resolved",
        ...resolved,
      });
    } else if (game.versions.some(({ version }) => version === token.version)) {
      result.versions.set(`${token.marketId}/${token.gameId}/${token.version}`, {
        status: "resolved",
        ...resolved,
        version: token.version,
      });
    } else {
      setResolution(token, "missing", result);
    }
  }
  return result;
}
