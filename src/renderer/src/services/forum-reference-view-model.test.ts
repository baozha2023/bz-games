import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForumReferenceToken } from "../../../shared/forum-references";
import { GameType } from "../../../shared/types";
import { clearForumPostReferenceCache } from "./forum-post-reference-service";
import {
  forumReferenceKey,
  resolveForumReferenceViewModels,
} from "./forum-reference-view-model";

const activePostId = "00000000-0000-4000-8000-000000000001";
const deletedPostId = "00000000-0000-4000-8000-000000000002";

describe("forum reference view models", () => {
  beforeEach(clearForumPostReferenceCache);

  it("maps all reference types to shared resolved and missing states", async () => {
    const tokens: ForumReferenceToken[] = [
      {
        type: "game",
        raw: "",
        syntax: "command",
        marketId: "official",
        gameId: "com.bz.demo",
      },
      {
        type: "version",
        raw: "",
        marketId: "official",
        gameId: "com.bz.demo",
        version: "1.0.0",
      },
      { type: "market", raw: "", marketId: "missing" },
      { type: "post", raw: "", postId: activePostId },
      { type: "post", raw: "", postId: deletedPostId },
      { type: "page", raw: "", pageId: "career.achievements" },
      { type: "page", raw: "", pageId: "future.page" },
    ];
    const result = await resolveForumReferenceViewModels(tokens, {
      translate: (key) => key,
      marketApi: {
        getSources: vi.fn(async () => ({
          schemaVersion: 2 as const,
          sources: [
            {
              marketId: "official",
              marketName: "官方市场",
              generatedAt: "2026-08-24T00:00:00.000Z",
              repository: "https://github.com/example/official",
              branch: "main",
            },
          ],
        })),
        getIndex: vi.fn(async () => ({
          schemaVersion: 2 as const,
          marketId: "official",
          marketName: "官方市场",
          generatedAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:00.000Z",
          games: [
            {
              id: "com.bz.demo",
              name: "演示游戏",
              author: "BZ",
              type: GameType.Singleplayer,
              summary: "演示游戏",
              tags: [],
              latestVersion: "1.0.0",
              versions: [
                {
                  version: "1.0.0",
                  description: "稳定版",
                  platformVersion: ">=3.0.0",
                  downloadUrl: "https://example.com/demo.zip",
                  size: 1,
                },
              ],
            },
          ],
        })),
      },
      postApi: {
        resolvePostReferences: vi.fn(async () => ({
          items: [
            {
              id: activePostId,
              status: "active" as const,
              title: "有效帖子",
              body: "a".repeat(51),
            },
            { id: deletedPostId, status: "deleted" as const },
          ],
        })),
      },
    });

    expect(result.get(forumReferenceKey(tokens[0]))).toMatchObject({
      status: "resolved",
      label: "官方市场 / 演示游戏",
    });
    expect(result.get(forumReferenceKey(tokens[1]))).toMatchObject({
      status: "resolved",
      label: "官方市场 / 演示游戏 · 1.0.0",
    });
    expect(result.get(forumReferenceKey(tokens[2]))).toMatchObject({
      status: "missing",
      label: "forumCommands.unknownMarket",
    });
    expect(result.get(forumReferenceKey(tokens[3]))).toMatchObject({
      status: "resolved",
      label: "有效帖子",
      excerpt: `${"a".repeat(50)}…`,
    });
    expect(result.get(forumReferenceKey(tokens[4]))).toMatchObject({
      status: "deleted",
      label: "forumCommands.deletedPost",
    });
    expect(result.get(forumReferenceKey(tokens[5]))?.status).toBe("resolved");
    expect(result.get(forumReferenceKey(tokens[6]))).toMatchObject({
      status: "missing",
      label: "forumCommands.unknownPage",
    });
  });
});
