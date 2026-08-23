import { describe, expect, it } from "vitest";
import {
  removeMentionFromDocument,
  replaceMentionInDocument,
  serializeEditorDocument,
  type ForumEditorSegment,
} from "./forum-editor-document";

const game = {
  marketId: "official",
  gameId: "com.bz.tetris",
  marketName: "BZ Games Market",
  gameName: "俄罗斯方块",
};

describe("forum editor document", () => {
  it("serializes a selected game with an automatic separator", () => {
    const result = replaceMentionInDocument(
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
      { type: "game", ...game, autoSeparator: true },
      { type: "text", value: " 继续讨论" },
    ];

    const result = removeMentionFromDocument(segments, 1);

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
      { type: "game", ...game },
      { type: "text", value: " 继续讨论" },
    ];

    const result = removeMentionFromDocument(segments, 0);

    expect(result?.segments).toEqual([{ type: "text", value: " 继续讨论" }]);
  });
});
