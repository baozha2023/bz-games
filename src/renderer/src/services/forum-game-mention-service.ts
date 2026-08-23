import type {
  MarketDirectory,
  MarketIndex,
  MarketSource,
} from "../../../shared/types";
import type { ForumGameMentionToken } from "../../../shared/forum-game-mentions";

export interface ForumMarketApi {
  getSources: () => Promise<MarketDirectory>;
  getIndex: (sourceIdx: number) => Promise<MarketIndex>;
}

export interface ForumMarketIndexEntry {
  sourceIdx: number;
  source: MarketSource;
  index: MarketIndex;
}

export interface ResolvedForumGameMention {
  marketId: string;
  marketName: string;
  gameId: string;
  gameName: string;
  sourceIdx: number;
}

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

export async function resolveForumGameMentions(
  tokens: ForumGameMentionToken[],
  api: ForumMarketApi,
): Promise<Map<string, ResolvedForumGameMention>> {
  const result = new Map<string, ResolvedForumGameMention>();
  if (tokens.length === 0) return result;

  const directory = await api.getSources();
  const markets = sourceMap(directory);
  const sourceIndexes = tokens
    .map((token) => markets.get(token.marketId)?.sourceIdx)
    .filter((sourceIdx): sourceIdx is number => sourceIdx !== undefined);
  const state = await loadIndexes(directory, sourceIndexes, api, 3);
  const indexesByMarketId = new Map(
    state.entries.map((entry) => [entry.index.marketId, entry]),
  );

  for (const token of tokens) {
    const entry = indexesByMarketId.get(token.marketId);
    const game = entry?.index.games.find((item) => item.id === token.gameId);
    if (!entry || !game) continue;
    result.set(`${token.marketId}/${token.gameId}`, {
      marketId: token.marketId,
      marketName: entry.index.marketName,
      gameId: token.gameId,
      gameName: game.name,
      sourceIdx: entry.sourceIdx,
    });
  }
  return result;
}
