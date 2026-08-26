import type {
  MarketDirectory,
  MarketIndex,
  MarketSource,
} from "../../../shared/types";
import type { ForumGameReferenceToken } from "../../../shared/forum-references";
import type {
  ForumMarketToken,
  ForumVersionToken,
} from "../../../shared/forum-references";

export interface ForumMarketApi {
  getSources: () => Promise<MarketDirectory>;
  getIndex: (sourceIdx: number) => Promise<MarketIndex>;
}

export interface ForumMarketIndexEntry {
  sourceIdx: number;
  source: MarketSource;
  index: MarketIndex;
}

export interface ResolvedForumGameReference {
  marketId: string;
  marketName: string;
  gameId: string;
  gameName: string;
  sourceIdx: number;
}

export type ForumMarketReferenceResolution =
  | {
      status: "resolved";
      marketId: string;
      marketName: string;
      sourceIdx: number;
    }
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
  failedSourceIndexes: number[];
}

function sourceMap(
  directory: MarketDirectory,
): Map<string, { source: MarketSource; sourceIdx: number }> {
  return new Map(
    directory.sources.map((source, sourceIdx) => [
      source.marketId,
      { source, sourceIdx },
    ]),
  );
}

async function loadIndexes(
  directory: MarketDirectory,
  sourceIndexes: number[],
  api: ForumMarketApi,
  concurrency: number,
  onEntry?: (entry: ForumMarketIndexEntry) => void,
): Promise<ForumMarketLoadState> {
  const uniqueIndexes = [...new Set(sourceIndexes)].filter(
    (sourceIdx) => directory.sources[sourceIdx] !== undefined,
  );
  const entries: ForumMarketIndexEntry[] = [];
  const failedSourceIndexes: number[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < uniqueIndexes.length) {
      const current = uniqueIndexes[cursor++];
      try {
        const index = await api.getIndex(current);
        const source = directory.sources[current];
        if (!source || index.marketId !== source.marketId) {
          failedSourceIndexes.push(current);
          continue;
        }
        const entry = { sourceIdx: current, source, index };
        entries.push(entry);
        onEntry?.(entry);
      } catch {
        failedSourceIndexes.push(current);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), uniqueIndexes.length) },
      () => worker(),
    ),
  );

  entries.sort((left, right) => left.sourceIdx - right.sourceIdx);
  failedSourceIndexes.sort((left, right) => left - right);
  return { entries, failedSourceIndexes };
}

export async function loadForumMarketIndexes(
  api: ForumMarketApi,
  options: {
    directory?: MarketDirectory;
    sourceIndexes?: number[];
    concurrency?: number;
    onEntry?: (entry: ForumMarketIndexEntry) => void;
  } = {},
): Promise<ForumMarketLoadState & { directory: MarketDirectory }> {
  const directory = options.directory || (await api.getSources());
  const sourceIndexes =
    options.sourceIndexes || directory.sources.map((_, sourceIdx) => sourceIdx);
  const state = await loadIndexes(
    directory,
    sourceIndexes,
    api,
    options.concurrency ?? 3,
    options.onEntry,
  );
  return { directory, ...state };
}

export async function resolveForumMarketReferences(
  tokens: Array<ForumGameReferenceToken | ForumVersionToken | ForumMarketToken>,
  api: ForumMarketApi,
): Promise<{
  markets: Map<string, ForumMarketReferenceResolution>;
  games: Map<string, ForumGameReferenceResolution>;
  versions: Map<string, ForumVersionReferenceResolution>;
}> {
  const marketsResult = new Map<string, ForumMarketReferenceResolution>();
  const gamesResult = new Map<string, ForumGameReferenceResolution>();
  const versionsResult = new Map<string, ForumVersionReferenceResolution>();
  if (!tokens.length)
    return {
      markets: marketsResult,
      games: gamesResult,
      versions: versionsResult,
    };

  let directory: MarketDirectory;
  try {
    directory = await api.getSources();
  } catch {
    for (const token of tokens) {
      if (token.type === "market")
        marketsResult.set(token.marketId, { status: "unavailable" });
      if (token.type === "game")
        gamesResult.set(`${token.marketId}/${token.gameId}`, {
          status: "unavailable",
        });
      if (token.type === "version")
        versionsResult.set(
          `${token.marketId}/${token.gameId}/${token.version}`,
          { status: "unavailable" },
        );
    }
    return {
      markets: marketsResult,
      games: gamesResult,
      versions: versionsResult,
    };
  }

  const markets = sourceMap(directory);
  const sourceIndexes = tokens
    .map((token) => markets.get(token.marketId)?.sourceIdx)
    .filter((value): value is number => value !== undefined);
  const state = await loadIndexes(directory, sourceIndexes, api, 3);
  const entries = new Map(
    state.entries.map((entry) => [entry.source.marketId, entry]),
  );
  const failed = new Set(state.failedSourceIndexes);

  for (const token of tokens) {
    const market = markets.get(token.marketId);
    if (!market) {
      if (token.type === "market")
        marketsResult.set(token.marketId, { status: "missing" });
      if (token.type === "game")
        gamesResult.set(`${token.marketId}/${token.gameId}`, {
          status: "missing",
        });
      if (token.type === "version")
        versionsResult.set(
          `${token.marketId}/${token.gameId}/${token.version}`,
          { status: "missing" },
        );
      continue;
    }
    const entry = entries.get(token.marketId);
    if (!entry && failed.has(market.sourceIdx)) {
      if (token.type === "market")
        marketsResult.set(token.marketId, { status: "unavailable" });
      if (token.type === "game")
        gamesResult.set(`${token.marketId}/${token.gameId}`, {
          status: "unavailable",
        });
      if (token.type === "version")
        versionsResult.set(
          `${token.marketId}/${token.gameId}/${token.version}`,
          { status: "unavailable" },
        );
      continue;
    }
    if (!entry) continue;
    if (token.type === "market") {
      marketsResult.set(token.marketId, {
        status: "resolved",
        marketId: token.marketId,
        marketName: entry.index.marketName,
        sourceIdx: entry.sourceIdx,
      });
      continue;
    }
    const game = entry.index.games.find((item) => item.id === token.gameId);
    if (!game) {
      if (token.type === "game")
        gamesResult.set(`${token.marketId}/${token.gameId}`, {
          status: "missing",
        });
      else
        versionsResult.set(
          `${token.marketId}/${token.gameId}/${token.version}`,
          { status: "missing" },
        );
      continue;
    }
    const resolved = {
      marketId: token.marketId,
      marketName: entry.index.marketName,
      gameId: token.gameId,
      gameName: game.name,
      sourceIdx: entry.sourceIdx,
    };
    if (token.type === "game")
      gamesResult.set(`${token.marketId}/${token.gameId}`, {
        status: "resolved",
        ...resolved,
      });
    else if (game.versions.some((item) => item.version === token.version))
      versionsResult.set(`${token.marketId}/${token.gameId}/${token.version}`, {
        status: "resolved",
        ...resolved,
        version: token.version,
      });
    else
      versionsResult.set(`${token.marketId}/${token.gameId}/${token.version}`, {
        status: "missing",
      });
  }
  return {
    markets: marketsResult,
    games: gamesResult,
    versions: versionsResult,
  };
}
