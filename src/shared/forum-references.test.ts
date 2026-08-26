import { describe, expect, it } from "vitest";
import {
  FORUM_COMMAND_NAMES,
  parseForumReferences,
  serializeForumReference,
} from "./forum-references";

describe("forum references", () => {
  it("parses only the constrained market/game mention format", () => {
    expect(parseForumReferences("推荐@official/com.bz.tetris！")).toEqual([
      { type: "text", value: "推荐" },
      {
        type: "game",
        raw: "@official/com.bz.tetris",
        marketId: "official",
        gameId: "com.bz.tetris",
        syntax: "mention",
      },
      { type: "text", value: "！" },
    ]);
    expect(parseForumReferences("@player hello")).toEqual([
      { type: "text", value: "@player hello" },
    ]);
  });

  it("does not match a mention embedded in an identifier", () => {
    expect(parseForumReferences("mail@official/com.bz.tetris")).toEqual([
      { type: "text", value: "mail@official/com.bz.tetris" },
    ]);
  });

  it("serializes both game syntaxes without an implicit default", () => {
    expect(
      serializeForumReference({
        type: "game",
        syntax: "mention",
        marketId: "official",
        gameId: "com.bz.tetris",
      }),
    ).toBe("@official/com.bz.tetris");
    expect(
      serializeForumReference({
        type: "game",
        syntax: "command",
        marketId: "official",
        gameId: "com.bz.tetris",
      }),
    ).toBe("/game<official,com.bz.tetris>");
  });

  it("parses every registered slash command from plain text", () => {
    expect(FORUM_COMMAND_NAMES).toEqual([
      "game",
      "version",
      "market",
      "post",
      "page",
    ]);
    const value = [
      "/game<official,com.bz.tetris>",
      "/version<official,com.bz.tetris,1.2.0>",
      "/market<official>",
      "/post<550e8400-e29b-41d4-a716-446655440000>",
      "/page<career.achievements>",
    ].join(" ");

    expect(
      parseForumReferences(value).filter((part) => part.type !== "text"),
    ).toMatchObject([
      {
        type: "game",
        syntax: "command",
        marketId: "official",
        gameId: "com.bz.tetris",
      },
      { type: "version", version: "1.2.0" },
      { type: "market", marketId: "official" },
      {
        type: "post",
        postId: "550e8400-e29b-41d4-a716-446655440000",
      },
      { type: "page", pageId: "career.achievements" },
    ]);
  });

  it("keeps incomplete or invalid slash commands as text", () => {
    expect(
      parseForumReferences("/post<bad> /version<official,com.bz.tetris,nope>"),
    ).toEqual([
      {
        type: "text",
        value: "/post<bad> /version<official,com.bz.tetris,nope>",
      },
    ]);
  });
});
