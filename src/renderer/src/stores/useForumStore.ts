import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  ForumImageSelection,
  ForumImageSelectionResult,
  ForumMutationResult,
  ForumPage,
  ForumPostDetail,
  ForumPostSummary,
} from "../../../shared/types";

export const useForumStore = defineStore("forum", () => {
  const posts = ref<ForumPostSummary[]>([]);
  const query = ref("");
  const nextCursor = ref<string | null>(null);
  const hasMore = ref(true);
  const isLoading = ref(false);
  const error = ref("");
  const searchAvailable = ref<boolean | null>(null);
  const scrollTop = ref(0);
  const initialized = ref(false);
  const details = ref(new Map<string, ForumPostDetail>());
  let generation = 0;
  let loadingPromise: Promise<void> | null = null;

  const hasListState = computed(() => initialized.value);

  async function refreshSearchAvailability(): Promise<boolean> {
    searchAvailable.value = await window.electronAPI.forum.getSearchAvailability().catch(() => false);
    if (!searchAvailable.value && query.value) {
      query.value = "";
      posts.value = [];
      nextCursor.value = null;
      hasMore.value = true;
      initialized.value = false;
      scrollTop.value = 0;
    }
    return searchAvailable.value;
  }

  function mergePosts(items: ForumPostSummary[]) {
    const byId = new Map(posts.value.map((item) => [item.id, item]));
    for (const item of items) byId.set(item.id, item);
    posts.value = Array.from(byId.values());
  }

  async function requestPage(currentQuery: string, cursor: string | null): Promise<ForumPage<ForumPostSummary>> {
    return window.electronAPI.forum.listPosts(currentQuery, cursor || undefined);
  }

  async function loadInitial(force = false) {
    if (!force && initialized.value) return;
    const currentGeneration = ++generation;
    isLoading.value = true;
    error.value = "";
    try {
      const page = await requestPage(query.value, null);
      if (currentGeneration !== generation) return;
      posts.value = page.items;
      nextCursor.value = page.nextCursor;
      hasMore.value = page.hasMore;
      initialized.value = true;
    } catch (reason) {
      if (currentGeneration === generation) error.value = reason instanceof Error ? reason.message : "forum_load_failed";
      throw reason;
    } finally {
      if (currentGeneration === generation) isLoading.value = false;
    }
  }

  async function search(value: string) {
    query.value = value.trim();
    posts.value = [];
    nextCursor.value = null;
    hasMore.value = true;
    initialized.value = false;
    return loadInitial(true);
  }

  async function loadMore() {
    if (isLoading.value || !hasMore.value || !nextCursor.value) return;
    if (loadingPromise) return loadingPromise;
    const currentGeneration = generation;
    const cursor = nextCursor.value;
    loadingPromise = (async () => {
      isLoading.value = true;
      try {
        const page = await requestPage(query.value, cursor);
        if (currentGeneration !== generation) return;
        mergePosts(page.items);
        nextCursor.value = page.nextCursor;
        hasMore.value = page.hasMore;
      } catch (reason) {
        if (currentGeneration === generation) error.value = reason instanceof Error ? reason.message : "forum_load_failed";
      } finally {
        if (currentGeneration === generation) isLoading.value = false;
      }
    })().finally(() => {
      loadingPromise = null;
    });
    return loadingPromise;
  }

  async function getPost(postId: string, force = false): Promise<ForumPostDetail> {
    const cached = details.value.get(postId);
    if (cached && !force) return cached;
    const detail = await window.electronAPI.forum.getPost(postId);
    details.value.set(postId, detail);
    const summary = posts.value.find((item) => item.id === postId);
    if (summary) {
      summary.likeCount = detail.likeCount;
      summary.commentCount = detail.commentCount;
    }
    return detail;
  }

  async function getComments(postId: string, cursor = "") {
    return window.electronAPI.forum.getComments(postId, cursor || undefined);
  }

  function updatePostLike(postId: string, result: Extract<ForumMutationResult, { success: true }>) {
    const detail = details.value.get(postId);
    if (detail && typeof result.likeCount === "number") {
      detail.likeCount = result.likeCount;
      detail.likedByMe = result.liked === true;
    }
    const summary = posts.value.find((item) => item.id === postId);
    if (summary && typeof result.likeCount === "number") summary.likeCount = result.likeCount;
  }

  async function togglePostLike(postId: string, liked: boolean) {
    const result = liked
      ? await window.electronAPI.forum.likePost(postId)
      : await window.electronAPI.forum.unlikePost(postId);
    if (result.success) updatePostLike(postId, result);
    return result;
  }

  async function toggleCommentLike(commentId: string, liked: boolean) {
    return liked
      ? window.electronAPI.forum.likeComment(commentId)
      : window.electronAPI.forum.unlikeComment(commentId);
  }

  function removePost(postId: string) {
    posts.value = posts.value.filter((item) => item.id !== postId);
    details.value.delete(postId);
  }

  async function deletePost(postId: string) {
    const result = await window.electronAPI.forum.deletePost(postId);
    if (result.success) removePost(postId);
    return result;
  }

  async function deleteComment(commentId: string) {
    return window.electronAPI.forum.deleteComment(commentId);
  }

  function updateCommentCount(postId: string, delta: number) {
    const detail = details.value.get(postId);
    if (detail) detail.commentCount = Math.max(0, detail.commentCount + delta);
    const summary = posts.value.find((item) => item.id === postId);
    if (summary) summary.commentCount = Math.max(0, summary.commentCount + delta);
  }

  function saveScrollPosition(value = window.scrollY) {
    scrollTop.value = Math.max(0, Math.round(value));
  }

  return {
    posts,
    query,
    nextCursor,
    hasMore,
    isLoading,
    error,
    searchAvailable,
    scrollTop,
    initialized,
    hasListState,
    refreshSearchAvailability,
    loadInitial,
    search,
    loadMore,
    getPost,
    getComments,
    togglePostLike,
    toggleCommentLike,
    deletePost,
    deleteComment,
    removePost,
    updateCommentCount,
    saveScrollPosition,
  };
});

export type ForumImageSelectionState = ForumImageSelectionResult & {
  selectionId: string;
  images: ForumImageSelection[];
};
