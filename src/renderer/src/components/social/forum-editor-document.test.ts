import { describe, expect, it } from "vitest";
import {
  removeReferenceFromDocument,
  replaceReferenceInDocument,
  serializeEditorDocument,
  type ForumEditorSegment,
} from "./forum-editor-document";
import { parseSlashCommandDraft } from "./forum-editor-dom";

const game = {
  type: "game" as const,
  syntax: "mention" as const,
  marketId: "official",
  gameId: "com.bz.tetris",
};

describe("forum editor document", () => {
  it("serializes a selected game with an automatic separator", () => {
    const result = replaceReferenceInDocument(
      [{ type: "text", value: "推荐 @bz" }],
      { segmentIndex: 0, start: 3, end: 6 },
      "",
      game,
    );

    expect(result).not.toBeNull();
    expect(serializeEditorDocument(result!.segments)).toBe(
      "推荐 @official/com.bz.tetris ",
    );
  });

  it("removes the game and its automatic separator in one operation", () => {
    const segments: ForumEditorSegment[] = [
      { type: "text", value: "推荐 " },
      { type: "reference", reference: game, autoSeparator: true },
      { type: "text", value: " 继续讨论" },
    ];

    const result = removeReferenceFromDocument(segments, 1);

    expect(result).toEqual({
      segments: [
        { type: "text", value: "推荐 " },
        { type: "text", value: "继续讨论" },
      ],
      caretIndex: 1,
    });
  });

  it("does not remove a user-owned leading space without the marker", () => {
    const segments: ForumEditorSegment[] = [
      { type: "reference", reference: game },
      { type: "text", value: " 继续讨论" },
    ];

    const result = removeReferenceFromDocument(segments, 0);

    expect(result?.segments).toEqual([{ type: "text", value: " 继续讨论" }]);
  });

  it("preserves slash game syntax independently from game mentions", () => {
    const result = replaceReferenceInDocument(
      [{ type: "text", value: "/game" }],
      { segmentIndex: 0, start: 0, end: 5 },
      "",
      { ...game, syntax: "command" },
    );
    expect(serializeEditorDocument(result!.segments)).toBe(
      "/game<official,com.bz.tetris> ",
    );
  });

  it("recognizes command queries and resumable partial commands", () => {
    expect(parseSlashCommandDraft("/g")).toMatchObject({
      kind: "query",
      query: "g",
    });
    expect(parseSlashCommandDraft("/game")).toMatchObject({
      kind: "draft",
      command: "game",
      args: [],
    });
    expect(parseSlashCommandDraft("/game<official>")).toMatchObject({
      kind: "draft",
      command: "game",
      args: ["official"],
    });
    expect(
      parseSlashCommandDraft("/version<official,com.bz.demo>"),
    ).toMatchObject({
      kind: "draft",
      command: "version",
      args: ["official", "com.bz.demo"],
    });
    expect(parseSlashCommandDraft("/game<official> ")).toBeNull();
  });
});
