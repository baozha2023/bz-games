import { describe, expect, it } from "vitest";
import {
  parseForumGameMentions,
  serializeForumEditorSegments,
  type ForumEditorSegment,
} from "./forum-game-mentions";

describe("forum game mentions", () => {
  it("parses only the constrained market/game format", () => {
    expect(parseForumGameMentions("推荐@official/com.bz.tetris！")).toEqual([
      { type: "text", value: "推荐" },
      {
        type: "game",
        raw: "@official/com.bz.tetris",
        marketId: "official",
        gameId: "com.bz.tetris",
      },
      { type: "text", value: "！" },
    ]);
    expect(parseForumGameMentions("@player hello")).toEqual([
      { type: "text", value: "@player hello" },
    ]);
  });

  it("does not match a token embedded in an identifier", () => {
    expect(parseForumGameMentions("mail@official/com.bz.tetris")).toEqual([
      { type: "text", value: "mail@official/com.bz.tetris" },
    ]);
  });

  it("serializes editor segments to stable IDs", () => {
    const segments: ForumEditorSegment[] = [
      { type: "text", value: "推荐 " },
      {
        type: "game",
        marketId: "official",
        gameId: "com.bz.tetris",
        marketName: "官方市场",
        gameName: "俄罗斯方块",
      },
      { type: "text", value: "！" },
    ];
    expect(serializeForumEditorSegments(segments)).toBe(
      "推荐 @official/com.bz.tetris！",
    );
  });
});
