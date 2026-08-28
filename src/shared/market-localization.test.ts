import { describe, expect, it } from "vitest";
import { GameType } from "./types/game.types";
import { MarketIndexV2Schema, resolveMarketIndex } from "./types/market.types";

const rawIndex = {
  schemaVersion: 2,
  marketId: "community",
  marketName: "Community",
  generatedAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  games: [
    {
      id: "com.example.localized",
      defaultLocale: "zh-CN",
      localizations: {
        "zh-CN": { name: "本地化游戏", summary: "中文简介", tags: ["益智"] },
        "en-US": {
          name: "Localized Game",
          summary: "English summary",
          tags: ["Puzzle"],
        },
      },
      author: "Example",
      type: GameType.Singleplayer,
      latestVersion: "1.0.0",
      versions: [
        {
          version: "1.0.0",
          platformVersion: ">=4.0.0",
          downloadUrl: "https://example.com/game.zip",
          size: 1,
          localizations: {
            "zh-CN": { description: "首个版本", releaseNotes: "首次发布" },
            "en-US": {
              description: "Initial version",
              releaseNotes: "First release",
            },
          },
        },
      ],
    },
  ],
};

describe("Market Schema 2 localization", () => {
  it("rejects non-2 schemas and old top-level localized fields", () => {
    expect(
      MarketIndexV2Schema.safeParse({ ...rawIndex, schemaVersion: "2" })
        .success,
    ).toBe(false);
    expect(
      MarketIndexV2Schema.safeParse({
        ...rawIndex,
        games: [{ ...rawIndex.games[0], name: "legacy" }],
      }).success,
    ).toBe(false);
  });

  it("projects game, version and tag text from one requested locale", () => {
    const index = MarketIndexV2Schema.parse(rawIndex);
    const projected = resolveMarketIndex(index, "en-US");
    expect(projected.games[0]).toMatchObject({
      name: "Localized Game",
      summary: "English summary",
      tags: ["Puzzle"],
      versions: [
        { description: "Initial version", releaseNotes: "First release" },
      ],
    });
  });

  it("falls back the complete game, version and tag bundle to defaultLocale", () => {
    const index = MarketIndexV2Schema.parse(rawIndex);
    const projected = resolveMarketIndex(index, "ja-JP");
    expect(projected.games[0]).toMatchObject({
      name: "本地化游戏",
      summary: "中文简介",
      tags: ["益智"],
      versions: [{ description: "首个版本", releaseNotes: "首次发布" }],
    });
  });
});
