import { describe, expect, it, vi } from "vitest";
import type { MarketDirectory, MarketIndex } from "../../../shared/types";
import {
  loadForumMarketIndexes,
  resolveForumMarketReferences,
} from "./forum-market-reference-service";

const directory: MarketDirectory = {
  schemaVersion: "1",
  sources: [
    {
      marketId: "official",
      marketName: "官方市场",
      generatedAt: "2026-08-23T00:00:00.000Z",
      repository: "https://github.com/example/official",
      branch: "main",
    },
    {
      marketId: "community",
      marketName: "社区市场",
      generatedAt: "2026-08-23T00:00:00.000Z",
      repository: "https://github.com/example/community",
      branch: "main",
    },
  ],
};

const indexes: MarketIndex[] = [
  {
    schemaVersion: "1",
    marketId: "official",
    marketName: "官方市场",
    generatedAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    games: [],
  },
  {
    schemaVersion: "1",
    marketId: "community",
    marketName: "社区市场",
    generatedAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    games: [],
  },
];

function createApi() {
  return {
    getSources: vi.fn(async () => directory),
    getIndex: vi.fn(async (sourceIdx: number) => indexes[sourceIdx]),
  };
}

describe("forum game mention market access", () => {
  it("loads only requested markets for post details", async () => {
    const api = createApi();
    const result = await resolveForumMarketReferences(
      [
        {
          type: "game",
          raw: "@community/com.bz.tetris",
          syntax: "mention",
          marketId: "community",
          gameId: "com.bz.tetris",
        },
      ],
      api,
    );
    expect(api.getIndex).toHaveBeenCalledTimes(1);
    expect(api.getIndex).toHaveBeenCalledWith(1);
    expect(result.games.get("community/com.bz.tetris")?.status).toBe("missing");
  });

  it("deduplicates source indexes and limits the requested set", async () => {
    const api = createApi();
    const state = await loadForumMarketIndexes(api, { sourceIndexes: [1, 1] });
    expect(api.getIndex).toHaveBeenCalledTimes(1);
    expect(state.entries).toHaveLength(1);
  });

  it("distinguishes missing references from temporarily unavailable markets", async () => {
    const api = createApi();
    api.getIndex.mockRejectedValueOnce(new Error("offline"));
    const result = await resolveForumMarketReferences(
      [
        { type: "market", raw: "/market<official>", marketId: "official" },
        {
          type: "game",
          raw: "/game<missing,com.bz.none>",
          syntax: "command",
          marketId: "missing",
          gameId: "com.bz.none",
        },
      ],
      api,
    );
    expect(result.markets.get("official")?.status).toBe("unavailable");
    expect(result.games.get("missing/com.bz.none")?.status).toBe("missing");
  });
});
