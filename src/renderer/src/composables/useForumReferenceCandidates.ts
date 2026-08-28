import { computed, ref, type Ref } from "vue";
import {
  searchMarketGames,
  searchMarketSources,
  type MarketSearchIndex,
} from "../../../shared/market-search";
import type { MarketDirectory, MarketSource } from "../../../shared/types";
import {
  loadForumMarketIndexes,
  type ForumMarketApi,
  type ForumMarketIndexEntry,
} from "../services/forum-market-reference-service";

export type MarketCandidate = {
  kind: "market";
  key: string;
  marketId: string;
  marketName: string;
};

export type GameCandidate = {
  kind: "game";
  key: string;
  marketId: string;
  marketName: string;
  gameId: string;
  gameName: string;
};

export type MentionCandidate = MarketCandidate | GameCandidate;

export function useForumReferenceCandidates(
  api: ForumMarketApi,
  query: Ref<string>,
  selectedMarketId: Ref<string>,
) {
  const directorySources = ref<MarketSource[]>([]);
  const loadedIndexes = ref<ForumMarketIndexEntry[]>([]);
  const isLoadingCandidates = ref(false);
  let directoryPromise: Promise<MarketDirectory> | null = null;
  let allIndexesPromise: Promise<void> | null = null;
  let loadingGeneration = 0;

  const selectedMarketName = computed(
    () =>
      directorySources.value.find(
        (source) => source.marketId === selectedMarketId.value,
      )?.marketName || "",
  );

  const candidates = computed<MentionCandidate[]>(() => {
    const sourceCandidates = searchMarketSources(
      directorySources.value,
      query.value,
    )
      .map((source) => ({
        kind: "market" as const,
        key: `market:${source.marketId}`,
        marketId: source.marketId,
        marketName: source.marketName,
      }))
      .filter(
        (candidate) =>
          !selectedMarketId.value ||
          candidate.marketId === selectedMarketId.value,
      );

    const indexes: MarketSearchIndex[] = loadedIndexes.value
      .filter(
        (entry) =>
          !selectedMarketId.value ||
          entry.index.marketId === selectedMarketId.value,
      )
      .map((entry) => ({ marketId: entry.marketId, index: entry.index }));
    const gameCandidates = searchMarketGames(indexes, query.value).map(
      (result): GameCandidate => ({
        kind: "game",
        key: `game:${result.marketId}/${result.game.id}`,
        marketId: result.marketId,
        marketName: result.marketName,
        gameId: result.game.id,
        gameName: result.game.name,
      }),
    );

    const combined = selectedMarketId.value
      ? gameCandidates
      : query.value
        ? [...gameCandidates, ...sourceCandidates]
        : sourceCandidates;
    const seen = new Set<string>();
    return combined
      .filter((candidate) => {
        if (seen.has(candidate.key)) return false;
        seen.add(candidate.key);
        return true;
      })
      .slice(0, 20);
  });

  async function getDirectory(): Promise<MarketDirectory> {
    if (!directoryPromise) {
      directoryPromise = api
        .getSources()
        .then((directory) => {
          directorySources.value = directory.sources;
          return directory;
        })
        .catch((error) => {
          directoryPromise = null;
          throw error;
        });
    }
    return directoryPromise;
  }

  function mergeEntry(entry: ForumMarketIndexEntry): void {
    loadedIndexes.value = [
      ...loadedIndexes.value.filter(
        (item) => item.marketId !== entry.marketId,
      ),
      entry,
    ].sort((left, right) => left.marketId.localeCompare(right.marketId));
  }

  async function loadAllIndexes(): Promise<void> {
    if (!allIndexesPromise) {
      allIndexesPromise = getDirectory()
        .then((directory) =>
          loadForumMarketIndexes(api, {
            directory,
            concurrency: 3,
            onEntry: mergeEntry,
          }),
        )
        .then((state) => {
          loadedIndexes.value = state.entries;
        })
        .catch((error) => {
          allIndexesPromise = null;
          throw error;
        });
    }
    await allIndexesPromise;
  }

  async function loadForQuery(searchQuery: string): Promise<void> {
    const generation = ++loadingGeneration;
    isLoadingCandidates.value = true;
    try {
      await getDirectory();
      if (searchQuery) await loadAllIndexes();
    } finally {
      if (generation === loadingGeneration) isLoadingCandidates.value = false;
    }
  }

  async function selectMarket(marketId: string): Promise<void> {
    const generation = ++loadingGeneration;
    isLoadingCandidates.value = true;
    try {
      const directory = await getDirectory();
      if (allIndexesPromise) {
        await allIndexesPromise.catch(() => undefined);
      }
      if (loadedIndexes.value.some((entry) => entry.marketId === marketId)) {
        return;
      }
      const state = await loadForumMarketIndexes(api, {
        directory,
        marketIds: [marketId],
        concurrency: 1,
        onEntry: mergeEntry,
      });
      loadedIndexes.value = [
        ...loadedIndexes.value.filter((entry) => entry.marketId !== marketId),
        ...state.entries,
      ].sort((left, right) => left.marketId.localeCompare(right.marketId));
    } finally {
      if (generation === loadingGeneration) isLoadingCandidates.value = false;
    }
  }

  return {
    candidates,
    directorySources,
    isLoadingCandidates,
    loadedIndexes,
    selectedMarketName,
    loadForQuery,
    selectMarket,
  };
}
