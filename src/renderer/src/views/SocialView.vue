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
            :disabled="forumStore.isLoading || !canRefresh"
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
          <div
            v-for="post in forumStore.posts"
            :key="post.id"
            class="forum-post-row"
            role="button"
            tabindex="0"
            @click="openPost(post.id)"
            @keydown.enter.prevent="openPost(post.id)"
            @keydown.space.prevent="openPost(post.id)"
          >
            <span class="forum-post-title">{{ post.title }}</span>
            <ForumAuthorIdentity
              class="forum-post-author"
              :nickname="post.authorNickname"
              :github-login="post.authorGithubLogin"
            />
            <span class="forum-post-meta">
              <span class="forum-post-time">{{
                formatTime(post.createdAt)
              }}</span>
              <span class="forum-post-stat"
                ><n-icon><HeartOutline /></n-icon>{{ post.likeCount }}</span
              >
              <span class="forum-post-stat"
                ><n-icon><ChatbubbleOutline /></n-icon
                >{{ post.commentCount }}</span
              >
            </span>
          </div>
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
      style="
        width: 60vw;
        height: 80vh;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 32px);
      "
      content-style="display: flex; flex: 1; min-height: 0; overflow: hidden"
      header-style="flex-shrink: 0"
      footer-style="flex-shrink: 0"
      :closable="!isCreatePostBusy"
      :mask-closable="!isCreatePostBusy"
      @after-leave="clearDraft"
    >
      <n-scrollbar class="create-post-scrollbar">
        <n-form class="create-post-form" label-placement="top">
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
          <ImageSelectionPanel
            :images="selectedImages"
            :select-label="t('feedback.selectImages')"
            :limits-label="t('feedback.imageLimits')"
            :clear-label="t('feedback.clearImages')"
            :remove-label="t('feedback.removeImage')"
            :selecting="isSelectingImages"
            :disabled="isCreatePostBusy"
            :clear-disabled="isCreating"
            @select="chooseImages"
            @clear="clearImages"
            @remove="removeImage"
          />
        </n-form>
      </n-scrollbar>
      <template #footer>
        <n-space justify="end">
          <n-button
            :disabled="isCreatePostBusy"
            @click="showCreatePost = false"
            >{{ t("common.cancel") }}</n-button
          >
          <n-button
            type="primary"
            :loading="isCreating"
            :disabled="
              isCreatePostBusy || !draftTitle.trim() || !draftBodyValid
            "
            @click="submitPost"
            >{{ t("social.publish") }}</n-button
          >
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useMessage } from "naive-ui";
import {
  AddOutline,
  ChatbubbleOutline,
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
import ForumAuthorIdentity from "../components/social/ForumAuthorIdentity.vue";
import ImageSelectionPanel from "../components/common/ImageSelectionPanel.vue";

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
const isSelectingImages = ref(false);
const isRefreshing = ref(false);
const canRefresh = ref(true);
const FORUM_REFRESH_COOLDOWN_MS = 5_000;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;
let scrollContainer: ScrollContainer | null = null;
let refreshCooldownTimer: number | null = null;

const isCreatePostBusy = computed(
  () => isCreating.value || isSelectingImages.value,
);

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
  if (isCreatePostBusy.value || selectedImages.value.length >= 4) return;
  isSelectingImages.value = true;
  try {
    const result = await window.electronAPI.forum.selectImages(
      selectionId.value || undefined,
    );
    if (result.success && result.selectionId && result.images) {
      selectionId.value = result.selectionId;
      selectedImages.value = result.images;
    } else if (!result.canceled) {
      if (result.error === "duplicate_image") {
        message.warning(errorLabel(result.error));
      } else {
        message.error(errorLabel(result.error || "image_failed"));
      }
      if (result.error === "forum_images_expired") {
        selectionId.value = "";
        selectedImages.value = [];
      }
    }
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "image_failed"),
    );
  } finally {
    isSelectingImages.value = false;
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

async function clearImages() {
  if (!selectionId.value) return;
  const currentSelectionId = selectionId.value;
  selectionId.value = "";
  selectedImages.value = [];
  await window.electronAPI.forum.releaseImages(currentSelectionId);
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
  if (isRefreshing.value || forumStore.isLoading || !canRefresh.value) return;
  isRefreshing.value = true;
  try {
    await forumStore.search(forumStore.query);
  } catch (error) {
    message.error(
      errorLabel(error instanceof Error ? error.message : "forum_load_failed"),
    );
  } finally {
    isRefreshing.value = false;
    startRefreshCooldown();
  }
}

function startRefreshCooldown() {
  if (refreshCooldownTimer) window.clearTimeout(refreshCooldownTimer);
  canRefresh.value = false;
  refreshCooldownTimer = window.setTimeout(() => {
    canRefresh.value = true;
    refreshCooldownTimer = null;
  }, FORUM_REFRESH_COOLDOWN_MS);
}

function stopRefreshCooldown() {
  if (refreshCooldownTimer) {
    window.clearTimeout(refreshCooldownTimer);
    refreshCooldownTimer = null;
  }
  canRefresh.value = true;
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
  stopRefreshCooldown();
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
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  box-sizing: border-box;
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
.forum-post-row:focus-visible {
  outline: 2px solid var(--n-primary-color);
  outline-offset: -2px;
}
.forum-post-title {
  min-width: 0;
  overflow: hidden;
  padding-right: 16px;
  font-size: 16px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-post-author {
  min-width: 0;
  overflow: hidden;
  padding-right: 16px;
  color: var(--bz-text-secondary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.forum-post-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  overflow: hidden;
  color: var(--bz-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}
.forum-post-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.forum-post-time {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.forum-post-stat {
  flex: 0 0 auto;
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
.create-post-scrollbar {
  flex: 1;
  min-height: 0;
}
.create-post-form {
  padding-right: 12px;
}
@media (max-width: 640px) {
  .forum-post-row {
    align-items: flex-start;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px 16px;
  }
  .forum-post-title {
    grid-column: 1 / -1;
    width: 100%;
    padding-right: 0;
  }
  .forum-post-author {
    padding-right: 0;
  }
  .forum-toolbar {
    flex-direction: column;
  }
}
</style>
