<template>
  <div ref="pageRoot" class="post-detail-page">
    <n-page-header
      :title="post?.title || t('social.postDetail')"
      @back="goBack"
    />
    <n-spin v-if="isLoadingPost" size="large" class="detail-loading" />
    <n-alert v-else-if="loadError" type="error">{{
      errorLabel(loadError)
    }}</n-alert>
    <template v-else-if="post">
      <div class="post-meta">
        <span class="post-author">{{ post.authorNickname }}</span>
        <n-text depth="3" class="post-time">{{
          formatTime(post.createdAt)
        }}</n-text>
      </div>
      <ForumPostBody
        v-if="post.body"
        :body="post.body"
        :resolved-mentions="resolvedMentions"
        :is-resolving="isResolvingMentions"
      />
      <article v-else class="post-body">{{ t("social.noBody") }}</article>
      <div v-if="post.images.length" class="post-images">
        <n-image
          v-for="image in post.images"
          :key="image.id"
          :src="image.previewUrl"
          :alt="image.fileName"
          object-fit="contain"
        />
      </div>
      <div class="post-actions">
        <n-button type="default" secondary @click="togglePostLike">
          <template #icon
            ><n-icon class="post-like-icon"
              ><Heart v-if="post.likedByMe" /><HeartOutline v-else /></n-icon
          ></template>
          {{ post.likeCount }}
        </n-button>
        <n-button
          v-if="post.ownedByMe"
          type="error"
          secondary
          :loading="isDeletingPost"
          @click="confirmDeletePost"
        >
          {{ t("social.deletePost") }}
        </n-button>
      </div>

      <section class="comments-section">
        <h2>{{ t("social.comments") }}</h2>
        <ForumPostEditor
          v-model="commentDraft"
          :placeholder="t('social.commentPlaceholder')"
          :max-length="1000"
          @update:valid="commentDraftValid = $event"
        />
        <n-space justify="end" style="margin-top: 10px">
          <n-button
            type="primary"
            :loading="isSubmittingComment"
            :disabled="!commentDraft.trim() || !commentDraftValid"
            @click="submitComment"
            >{{ t("social.comment") }}</n-button
          >
        </n-space>
        <n-divider />
        <n-skeleton
          v-if="isLoadingComments && comments.length === 0"
          text
          :repeat="3"
        />
        <n-empty
          v-else-if="!comments.length"
          :description="t('social.noComments')"
        />
        <div v-else class="comment-list">
          <div
            v-for="comment in comments"
            :key="comment.id"
            class="comment-item"
          >
            <div class="comment-head">
              <span class="comment-author">{{ comment.author.nickname }}</span>
              <span class="comment-time">{{
                formatTime(comment.createdAt)
              }}</span>
            </div>
            <div class="comment-content">
              <ForumPostBody
                :body="comment.content"
                :resolved-mentions="resolvedMentions"
                :is-resolving="isResolvingMentions"
              />
            </div>
            <n-space size="small">
              <n-button
                text
                size="small"
                type="default"
                @click="toggleCommentLike(comment)"
              >
                <template #icon
                  ><n-icon class="comment-like-icon"
                    ><Heart v-if="comment.likedByMe" /><HeartOutline
                      v-else /></n-icon
                ></template>
                {{ comment.likeCount }}
              </n-button>
              <n-button
                v-if="comment.ownedByMe"
                text
                size="small"
                type="error"
                :loading="deletingCommentId === comment.id"
                @click="confirmDeleteComment(comment)"
              >
                {{ t("social.deleteComment") }}
              </n-button>
            </n-space>
          </div>
        </div>
        <div ref="commentsSentinel" class="comments-sentinel">
          <n-spin
            v-if="isLoadingComments && comments.length > 0"
            size="small"
          />
          <n-text v-else-if="!commentsHasMore && comments.length" depth="3">{{
            t("social.noMore")
          }}</n-text>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useDialog, useMessage } from "naive-ui";
import { Heart, HeartOutline } from "@vicons/ionicons5";
import { useForumStore } from "../stores/useForumStore";
import {
  findScrollContainer,
  isElementScrollContainer,
  setScrollTop,
  type ScrollContainer,
} from "../composables/useScrollContainer";
import type { ForumComment, ForumPostDetail } from "../../../shared/types";
import {
  parseForumGameMentions,
  type ForumGameMentionToken,
} from "../../../shared/forum-game-mentions";
import ForumPostEditor from "../components/social/ForumPostEditor.vue";
import ForumPostBody from "../components/social/ForumPostBody.vue";
import type { ResolvedForumGameMention } from "../services/forum-game-mention-service";
import { resolveForumGameMentions } from "../services/forum-game-mention-service";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const message = useMessage();
const dialog = useDialog();
const forumStore = useForumStore();
const pageRoot = ref<HTMLElement | null>(null);
const post = ref<ForumPostDetail | null>(null);
const comments = ref<ForumComment[]>([]);
const commentsCursor = ref<string | null>(null);
const commentsHasMore = ref(false);
const isLoadingPost = ref(true);
const isLoadingComments = ref(false);
const loadError = ref("");
const commentDraft = ref("");
const commentDraftValid = ref(true);
const isSubmittingComment = ref(false);
const isDeletingPost = ref(false);
const deletingCommentId = ref("");
const commentsSentinel = ref<HTMLElement | null>(null);
const resolvedMentions = ref<Record<string, ResolvedForumGameMention>>({});
const isResolvingMentions = ref(false);
const attemptedMentionKeys = new Set<string>();
let mentionResolvePromise: Promise<void> | null = null;
let commentsObserver: IntersectionObserver | null = null;
let scrollContainer: ScrollContainer | null = null;

const postId = String(route.params.postId || "");

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function errorLabel(code: string) {
  const key = `social.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("social.loadFailed") : translated;
}

function goBack() {
  const previous =
    typeof history.state?.back === "string" ? history.state.back : "";
  if (previous.startsWith("#/social") || previous === "/social") router.back();
  else router.replace({ name: "Social" });
}

function mergeComments(items: ForumComment[]) {
  const map = new Map(comments.value.map((item) => [item.id, item]));
  for (const item of items) map.set(item.id, item);
  comments.value = Array.from(map.values()).sort(compareComments);
}

function collectMentionTokens(): ForumGameMentionToken[] {
  const bodies = [
    post.value?.body || "",
    ...comments.value.map((item) => item.content),
  ];
  const tokens = new Map<string, ForumGameMentionToken>();
  for (const body of bodies) {
    for (const part of parseForumGameMentions(body)) {
      if (part.type !== "game") continue;
      tokens.set(`${part.marketId}/${part.gameId}`, part);
    }
  }
  return Array.from(tokens.values());
}

async function resolveVisibleMentions(): Promise<void> {
  if (mentionResolvePromise) {
    await mentionResolvePromise;
    return resolveVisibleMentions();
  }
  const pending = collectMentionTokens().filter(
    (token) => !attemptedMentionKeys.has(`${token.marketId}/${token.gameId}`),
  );
  if (!pending.length) return;

  pending.forEach((token) =>
    attemptedMentionKeys.add(`${token.marketId}/${token.gameId}`),
  );
  isResolvingMentions.value = true;
  mentionResolvePromise = resolveForumGameMentions(
    pending,
    window.electronAPI.market,
  )
    .then((resolved) => {
      resolved.forEach((value, key) => {
        resolvedMentions.value[key] = value;
      });
    })
    .catch(() => undefined)
    .finally(() => {
      isResolvingMentions.value = false;
      mentionResolvePromise = null;
    });
  return mentionResolvePromise;
}

function compareComments(left: ForumComment, right: ForumComment) {
  if (right.likeCount !== left.likeCount)
    return right.likeCount - left.likeCount;
  const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
  const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
  if (rightTime !== leftTime) return rightTime - leftTime;
  return right.id.localeCompare(left.id);
}

async function loadComments(reset = false) {
  if (!post.value || isLoadingComments.value) return;
  if (reset) {
    comments.value = [];
    commentsCursor.value = null;
    commentsHasMore.value = true;
  }
  if (!commentsHasMore.value && !reset) return;
  isLoadingComments.value = true;
  try {
    const page = await forumStore.getComments(
      post.value.id,
      reset ? "" : commentsCursor.value || "",
    );
    mergeComments(page.items);
    void resolveVisibleMentions();
    commentsCursor.value = page.nextCursor;
    commentsHasMore.value = page.hasMore;
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
    );
  } finally {
    isLoadingComments.value = false;
  }
}

async function togglePostLike() {
  if (!post.value) return;
  try {
    const result = await forumStore.togglePostLike(
      post.value.id,
      !post.value.likedByMe,
    );
    if (!result.success) {
      message.error(errorLabel(result.error));
      return;
    }
    post.value.likedByMe = result.liked === true;
    if (typeof result.likeCount === "number")
      post.value.likeCount = result.likeCount;
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
    );
  }
}

async function toggleCommentLike(comment: ForumComment) {
  try {
    const result = await forumStore.toggleCommentLike(
      comment.id,
      !comment.likedByMe,
    );
    if (!result.success) {
      message.error(errorLabel(result.error));
      return;
    }
    comment.likedByMe = result.liked === true;
    if (typeof result.likeCount === "number")
      comment.likeCount = result.likeCount;
    comments.value.sort(compareComments);
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
    );
  }
}

async function submitComment() {
  if (!post.value || !commentDraft.value.trim() || isSubmittingComment.value)
    return;
  isSubmittingComment.value = true;
  try {
    const result = await window.electronAPI.forum.createComment(
      post.value.id,
      commentDraft.value,
    );
    if (!result.success) {
      message.error(errorLabel(result.error));
      return;
    }
    commentDraft.value = "";
    forumStore.updateCommentCount(post.value.id, 1);
    await loadComments(true);
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
    );
  } finally {
    isSubmittingComment.value = false;
  }
}

function confirmDeletePost() {
  if (!post.value || isDeletingPost.value) return;
  dialog.warning({
    title: t("social.deletePost"),
    content: t("social.deletePostConfirm"),
    positiveText: t("social.delete"),
    negativeText: t("social.cancel"),
    onPositiveClick: async () => {
      isDeletingPost.value = true;
      try {
        const result = await forumStore.deletePost(post.value!.id);
        if (!result.success) {
          message.error(errorLabel(result.error));
          return;
        }
        message.success(t("social.deleteSuccess"));
        goBack();
      } catch (error) {
        message.error(
          errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
        );
      } finally {
        isDeletingPost.value = false;
      }
    },
  });
}

function confirmDeleteComment(comment: ForumComment) {
  if (deletingCommentId.value) return;
  dialog.warning({
    title: t("social.deleteComment"),
    content: t("social.deleteCommentConfirm"),
    positiveText: t("social.delete"),
    negativeText: t("social.cancel"),
    onPositiveClick: async () => {
      deletingCommentId.value = comment.id;
      try {
        const result = await forumStore.deleteComment(comment.id);
        if (!result.success) {
          message.error(errorLabel(result.error));
          return;
        }
        comments.value = comments.value.filter((item) => item.id !== comment.id);
        if (post.value) forumStore.updateCommentCount(post.value.id, -1);
        message.success(t("social.deleteSuccess"));
      } catch (error) {
        message.error(
          errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
        );
      } finally {
        deletingCommentId.value = "";
      }
    },
  });
}

onMounted(async () => {
  scrollContainer = findScrollContainer(pageRoot.value);
  setScrollTop(scrollContainer, 0);
  try {
    post.value = await forumStore.getPost(postId);
    await loadComments(true);
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : "forum_load_failed";
  } finally {
    isLoadingPost.value = false;
  }
  await nextTick();
  const observerRoot = isElementScrollContainer(scrollContainer)
    ? scrollContainer
    : null;
  commentsObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadComments();
    },
    { root: observerRoot, rootMargin: "240px" },
  );
  if (commentsSentinel.value) commentsObserver.observe(commentsSentinel.value);
});

onUnmounted(() => commentsObserver?.disconnect());
</script>

<style scoped>
.post-detail-page {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}
.detail-loading {
  display: block;
  margin: 80px auto;
}
.post-meta {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 8px 0 24px;
}
.post-author {
  color: var(--bz-text-title);
  font-weight: 600;
}
.post-time {
  margin: 0;
}
.post-actions :deep(.post-like-icon),
.comments-section :deep(.comment-like-icon) {
  color: #e74c3c;
}
.post-body {
  min-height: 80px;
  color: var(--bz-text-title);
  white-space: pre-wrap;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.post-images {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 20px 0;
}
.post-images :deep(.n-image) {
  width: min(280px, 100%);
  max-height: 280px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bz-bg-overlay);
}
.post-images :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.post-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-start;
  margin: 24px 0 36px;
}
.comments-section {
  border-top: 1px solid var(--bz-border);
  padding-top: 24px;
}
.comments-section h2 {
  margin: 0 0 16px;
  font-size: 20px;
}
.comment-item {
  padding: 16px 0;
  border-bottom: 1px solid var(--bz-border);
}
.comment-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.comment-author {
  font-weight: 600;
}
.comment-time {
  color: var(--bz-text-secondary);
  font-size: 12px;
}
.comment-content {
  margin-bottom: 8px;
  white-space: pre-wrap;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.comment-content :deep(.forum-post-body) {
  min-height: 0;
  line-height: 1.6;
}
.comments-sentinel {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: center;
}
</style>
