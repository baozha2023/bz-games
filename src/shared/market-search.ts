import type { MarketGame, MarketIndex, MarketSource } from "./types";

export interface MarketSearchIndex {
  marketId: string;
  index: MarketIndex;
}

export interface MarketGameSearchResult {
  marketId: string;
  marketName: string;
  game: MarketGame;
  score: number;
}

interface RankedMarketResult {
  score: number;
  featured?: boolean;
  marketName: string;
  gameName?: string;
  id?: string;
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchScore(value: string, query: string): number | null {
  const normalizedValue = value.trim().toLocaleLowerCase();
  if (!normalizedValue || !query) return null;
  if (normalizedValue === query) return 0;
  if (normalizedValue.startsWith(query)) return 1;
  if (normalizedValue.includes(query)) return 2;
  return null;
}

function bestScore(values: string[], query: string): number {
  if (!query) return 3;
  const scores = values
    .map((value) => matchScore(value, query))
    .filter((score): score is number => score !== null);
  return scores.length ? Math.min(...scores) : Number.POSITIVE_INFINITY;
}

export function rankMarketResults<T extends RankedMarketResult>(
  results: T[],
): T[] {
  return [...results].sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    if (left.featured !== right.featured) return left.featured ? -1 : 1;
    const marketOrder = left.marketName.localeCompare(
      right.marketName,
      "zh-CN",
    );
    if (marketOrder !== 0) return marketOrder;
    const gameOrder = (left.gameName || "").localeCompare(
      right.gameName || "",
      "zh-CN",
    );
    if (gameOrder !== 0) return gameOrder;
    return (left.id || "").localeCompare(right.id || "");
  });
}

export function searchMarketSources(
  sources: MarketSource[],
  query = "",
): MarketSource[] {
  const normalizedQuery = normalizeQuery(query);
  const ranked = sources
    .map((source) => ({
      source,
      score: bestScore([source.marketName, source.marketId], normalizedQuery),
    }))
    .filter(({ score }) => Number.isFinite(score));

  return rankMarketResults(
    ranked.map(({ source, score }) => ({
      ...source,
      score,
      id: source.marketId,
    })),
  );
}

export function searchMarketGames(
  indexes: MarketSearchIndex[],
  query = "",
): MarketGameSearchResult[] {
  const normalizedQuery = normalizeQuery(query);
  const ranked = indexes.flatMap(({ marketId, index }) =>
    index.games
      .map((game) => ({
        marketId,
        marketName: index.marketName,
        game,
        score: bestScore(
          [
            index.marketName,
            index.marketId,
            game.name,
            game.id,
            game.author,
            ...(game.tags || []),
          ],
          normalizedQuery,
        ),
      }))
      .filter(({ score }) => Number.isFinite(score)),
  );

  return rankMarketResults(
    ranked.map((result) => ({
      ...result,
      featured: result.game.featured,
      gameName: result.game.name,
      id: result.game.id,
    })),
  );
}
