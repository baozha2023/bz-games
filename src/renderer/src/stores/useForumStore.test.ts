import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  listPosts: vi.fn(),
  getPost: vi.fn(),
  getComments: vi.fn(),
}));

import { useForumStore } from "./useForumStore";

const post = (id: string) => ({
  id,
  title: `Post ${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  likeCount: 0,
  commentCount: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    scrollY: 0,
    scrollTo: vi.fn(),
    electronAPI: {
      forum: {
        listPosts: mocks.listPosts,
        getPost: mocks.getPost,
        getComments: mocks.getComments,
      },
    },
  });
  setActivePinia(createPinia());
});

describe("useForumStore forum feed state", () => {
  it("loads ten-item pages, deduplicates IDs, and keeps the cursor", async () => {
    mocks.listPosts
      .mockResolvedValueOnce({ items: [post("1"), post("2")], nextCursor: "cursor-1", hasMore: true })
      .mockResolvedValueOnce({ items: [post("2"), post("3")], nextCursor: null, hasMore: false });
    const store = useForumStore();

    await store.loadInitial();
    expect(store.posts.map((item) => item.id)).toEqual(["1", "2"]);
    expect(store.nextCursor).toBe("cursor-1");
    await store.loadMore();

    expect(store.posts.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(mocks.listPosts).toHaveBeenLastCalledWith("", "cursor-1");
    expect(store.hasMore).toBe(false);
  });

  it("resets search pages and preserves the recorded scroll position", async () => {
    mocks.listPosts.mockResolvedValue({ items: [post("search")], nextCursor: null, hasMore: false });
    const store = useForumStore();

    await store.search("  方块  ");
    expect(store.query).toBe("方块");
    expect(mocks.listPosts).toHaveBeenCalledWith("方块", undefined);
    store.saveScrollPosition(427.6);
    expect(store.scrollTop).toBe(428);
  });
});
