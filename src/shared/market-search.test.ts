import { describe, expect, it } from "vitest";
import { GameType } from "./types";
import {
  rankMarketResults,
  searchMarketGames,
  searchMarketSources,
} from "./market-search";
import type { MarketIndex, MarketSource } from "./types";

const source = (marketId: string, marketName: string): MarketSource => ({
  marketId,
  marketName,
  generatedAt: "2026-08-23T00:00:00.000Z",
  repository: "https://github.com/example/market",
  branch: "main",
});

const index = (
  marketId: string,
  marketName: string,
  name: string,
): MarketIndex => ({
  schemaVersion: 2,
  marketId,
  marketName,
  generatedAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
  games: [
    {
      id: "com.bz.tetris",
      name,
      author: "BZ-Games",
      type: GameType.Singleplayer,
      summary: "A game",
      tags: ["益智"],
      latestVersion: "1.0.0",
      versions: [
        {
          version: "1.0.0",
          description: "Initial version",
          platformVersion: ">=3.0.0",
          downloadUrl: "https://example.com/game.zip",
        },
      ],
    },
  ],
});

describe("market search helpers", () => {
  it("ranks exact matches before prefix and contains matches", () => {
    const results = rankMarketResults([
      { score: 2, marketName: "A", gameName: "contains" },
      { score: 0, marketName: "B", gameName: "exact" },
      { score: 1, marketName: "C", gameName: "prefix" },
    ]);
    expect(results.map((item) => item.gameName)).toEqual([
      "exact",
      "prefix",
      "contains",
    ]);
  });

  it("searches market names and IDs", () => {
    expect(
      searchMarketSources([source("official", "官方市场")], "官方"),
    ).toHaveLength(1);
    expect(
      searchMarketSources([source("official", "官方市场")], "official"),
    ).toHaveLength(1);
    expect(
      searchMarketSources([source("official", "官方市场")], "missing"),
    ).toHaveLength(0);
  });

  it("searches game names, IDs, authors, tags, and market names", () => {
    const result = searchMarketGames(
      [
        {
          marketId: "official",
          index: index("official", "官方市场", "俄罗斯方块"),
        },
      ],
      "俄罗斯",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      marketId: "official",
      game: { id: "com.bz.tetris", name: "俄罗斯方块" },
    });
    expect(
      searchMarketGames(
        [
          {
            marketId: "official",
            index: index("official", "官方市场", "俄罗斯方块"),
          },
        ],
        "益智",
      ),
    ).toHaveLength(1);
  });
});
