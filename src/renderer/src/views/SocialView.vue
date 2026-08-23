<template>
  <div ref="pageRoot" class="social-page">
    <n-tabs v-model:value="activeTab" class="social-tabs" type="line" animated>
      <n-tab-pane name="forum" :tab="t('social.forum')">
        <div class="forum-toolbar">
          <n-input
            v-if="forumStore.searchAvailable === true"
            v-model:value="searchInput"
            clearable
            :placeholder="t('social.searchPlaceholder')"
            class="forum-search"
          >
            <template #prefix
              ><n-icon><SearchOutline /></n-icon
            ></template>
          </n-input>
          <n-button type="primary" @click="showCreatePost = true">
            <template #icon
              ><n-icon><AddOutline /></n-icon
            ></template>
            {{ t("social.createPost") }}
          </n-button>
          <n-button
            secondary
            :loading="isRefreshing"
            :disabled="forumStore.isLoading"
            @click="refreshPosts"
          >
            <template #icon
              ><n-icon><RefreshOutline /></n-icon
            ></template>
            {{ t("social.refresh") }}
          </n-button>
        </div>

        <n-alert
          v-if="forumStore.error"
          type="error"
          closable
          @close="forumStore.error = ''"
        >
          {{ errorLabel(forumStore.error) }}
        </n-alert>
        <n-skeleton
          v-if="forumStore.isLoading && forumStore.posts.length === 0"
          text
          :repeat="5"
          class="forum-skeleton"
        />
        <n-empty
          v-else-if="forumStore.initialized && forumStore.posts.length === 0"
          :description="t('social.empty')"
        />
        <div v-else class="forum-list">
          <button
            v-for="post in forumStore.posts"
            :key="post.id"
            class="forum-post-row"
            type="button"
            @click="openPost(post.id)"
          >
            <span class="forum-post-main">
              <span class="forum-post-title">{{ post.title }}</span>
              <span class="forum-post-author">{{ post.authorNickname }}</span>
            </span>
            <span class="forum-post-meta">
              <span>{{ formatTime(post.createdAt) }}</span>
              <span
                ><n-icon><HeartOutline /></n-icon>{{ post.likeCount }}</span
              >
              <span
                ><n-icon><ChatbubbleOutline /></n-icon
                >{{ post.commentCount }}</span
              >
            </span>
          </button>
        </div>
        <div ref="sentinel" class="forum-sentinel">
          <n-spin
            v-if="forumStore.isLoading && forumStore.posts.length > 0"
            size="small"
          />
          <n-text
            v-else-if="!forumStore.hasMore && forumStore.posts.length > 0"
            depth="3"
            >{{ t("social.noMore") }}</n-text
          >
        </div>
      </n-tab-pane>

      <n-tab-pane name="friends" :tab="t('social.friends')">
        <div class="social-tab-content">
          <n-empty :description="t('social.developing')" />
        </div>
      </n-tab-pane>
    </n-tabs>

    <n-modal
      v-model:show="showCreatePost"
      preset="card"
      :title="t('social.createPost')"
      style="width: min(680px, 92vw)"
      @after-leave="clearDraft"
    >
      <n-form label-placement="top">
        <n-form-item :label="t('social.postTitle')">
          <n-input
            v-model:value="draftTitle"
            maxlength="80"
            show-count
            :placeholder="t('social.postTitlePlaceholder')"
          />
        </n-form-item>
        <n-form-item :label="t('social.postBody')">
          <ForumPostEditor
            v-model="draftBody"
            :placeholder="t('social.postBodyPlaceholder')"
            :max-length="5000"
            @update:valid="draftBodyValid = $event"
          />
        </n-form-item>
        <n-space v-if="selectedImages.length" :size="8" class="selected-images">
          <div
            v-for="image in selectedImages"
            :key="image.id"
            class="selected-image"
          >
            <img :src="image.previewUrl" :alt="image.fileName" />
            <n-button
              size="tiny"
              circle
              type="error"
              @click="removeImage(image.id)"
              ><template #icon
                ><n-icon><CloseOutline /></n-icon></template
            ></n-button>
          </div>
        </n-space>
      </n-form>
      <template #footer>
        <n-space justify="space-between" align="center">
          <n-button secondary @click="chooseImages">{{
            t("social.addImages")
          }}</n-button>
          <n-space>
            <n-button @click="showCreatePost = false">{{
              t("common.cancel")
            }}</n-button>
            <n-button
              type="primary"
              :loading="isCreating"
              :disabled="!draftTitle.trim() || !draftBodyValid"
              @click="submitPost"
              >{{ t("social.publish") }}</n-button
            >
          </n-space>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useMessage } from "naive-ui";
import {
  AddOutline,
  ChatbubbleOutline,
  CloseOutline,
  HeartOutline,
  RefreshOutline,
  SearchOutline,
} from "@vicons/ionicons5";
import { useForumStore } from "../stores/useForumStore";
import {
  findScrollContainer,
  getScrollTop,
  isElementScrollContainer,
  setScrollTop,
  type ScrollContainer,
} from "../composables/useScrollContainer";
import type { ForumImageSelection } from "../../../shared/types";
import ForumPostEditor from "../components/social/ForumPostEditor.vue";

const { t } = useI18n();
const router = useRouter();
const message = useMessage();
const forumStore = useForumStore();
const pageRoot = ref<HTMLElement | null>(null);
const activeTab = ref<"forum" | "friends">("forum");
const searchInput = ref(forumStore.query);
const sentinel = ref<HTMLElement | null>(null);
const showCreatePost = ref(false);
const draftTitle = ref("");
const draftBody = ref("");
const draftBodyValid = ref(true);
const selectionId = ref("");
const selectedImages = ref<ForumImageSelection[]>([]);
const isCreating = ref(false);
const isRefreshing = ref(false);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;
let scrollContainer: ScrollContainer | null = null;

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

function openPost(id: string) {
  if (scrollContainer)
    forumStore.saveScrollPosition(getScrollTop(scrollContainer));
  router.push({ name: "SocialPost", params: { postId: id } });
}

async function chooseImages() {
  try {
    const result = await window.electronAPI.forum.selectImages(
      selectionId.value || undefined,
    );
    if (result.success && result.selectionId && result.images) {
      selectionId.value = result.selectionId;
      selectedImages.value = result.images;
    } else if (!result.canceled) {
      message.error(errorLabel(result.error || "image_failed"));
    }
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "image_failed"),
    );
  }
}

async function removeImage(imageId: string) {
  if (!selectionId.value) return;
  await window.electronAPI.forum.releaseImages(selectionId.value, imageId);
  selectedImages.value = selectedImages.value.filter(
    (image) => image.id !== imageId,
  );
  if (!selectedImages.value.length) selectionId.value = "";
}

function clearDraft() {
  if (selectionId.value)
    void window.electronAPI.forum.releaseImages(selectionId.value);
  draftTitle.value = "";
  draftBody.value = "";
  draftBodyValid.value = true;
  selectionId.value = "";
  selectedImages.value = [];
}

async function submitPost() {
  if (!draftTitle.value.trim() || !draftBodyValid.value || isCreating.value)
    return;
  isCreating.value = true;
  try {
    const result = await window.electronAPI.forum.createPost({
      title: draftTitle.value,
      body: draftBody.value,
      selectionId: selectionId.value || undefined,
    });
    if (!result.success) {
      message.error(errorLabel(result.error));
      return;
    }
    showCreatePost.value = false;
    await forumStore.search(forumStore.query);
    message.success(t("social.publishSuccess"));
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
    );
  } finally {
    isCreating.value = false;
  }
}

async function refreshPosts() {
  if (isRefreshing.value || forumStore.isLoading) return;
  isRefreshing.value = true;
  try {
    await forumStore.search(forumStore.query);
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
    );
  } finally {
    isRefreshing.value = false;
  }
}

watch(searchInput, (value) => {
  if (forumStore.searchAvailable !== true) return;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (value.trim() === forumStore.query && forumStore.initialized) return;
    void forumStore.search(value).catch(() => undefined);
  }, 350);
});

onMounted(async () => {
  try {
    await forumStore.refreshSearchAvailability();
    await forumStore.loadInitial();
  } catch {
    // The view renders the store error and keeps the retry path implicit in the search input.
  }
  await nextTick();
  scrollContainer = findScrollContainer(pageRoot.value);
  setScrollTop(scrollContainer, forumStore.scrollTop);
  const observerRoot = isElementScrollContainer(scrollContainer)
    ? scrollContainer
    : null;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting))
        void forumStore.loadMore();
    },
    { root: observerRoot, rootMargin: "320px" },
  );
  if (sentinel.value) observer.observe(sentinel.value);
});

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer);
  observer?.disconnect();
  if (scrollContainer)
    forumStore.saveScrollPosition(getScrollTop(scrollContainer));
});
</script>

<style scoped>
.social-page {
  padding: 24px;
}
.forum-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  gap: 12px;
  margin: -8px 0 16px;
  padding: 8px 0;
  background: var(--bz-bg);
}
.forum-search {
  flex: 1;
}
.forum-list {
  border: 1px solid var(--bz-border);
  border-radius: 8px;
  overflow: hidden;
}
.forum-post-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 18px 20px;
  border: 0;
  border-bottom: 1px solid var(--bz-border);
  background: var(--bz-bg);
  color: var(--bz-text-title);
  text-align: left;
  cursor: pointer;
}
.forum-post-row:last-child {
  border-bottom: 0;
}
.forum-post-row:hover {
  background: var(--bz-bg-hover);
}
.forum-post-main {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 10px;
}
.forum-post-title {
  min-width: 0;
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-post-author {
  max-width: 180px;
  overflow: hidden;
  color: var(--bz-text-secondary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-post-meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 14px;
  color: var(--bz-text-secondary);
  font-size: 13px;
}
.forum-post-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.forum-sentinel {
  display: flex;
  min-height: 56px;
  align-items: center;
  justify-content: center;
}
.forum-skeleton {
  margin: 20px 0;
}
.social-tab-content {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  padding-top: 12px;
}
.selected-images {
  flex-wrap: wrap;
}
.selected-image {
  position: relative;
  width: 88px;
  height: 88px;
}
.selected-image img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
}
.selected-image .n-button {
  position: absolute;
  top: -6px;
  right: -6px;
}
@media (max-width: 640px) {
  .forum-post-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
  .forum-post-main {
    width: 100%;
  }
  .forum-toolbar {
    flex-direction: column;
  }
}
</style>
