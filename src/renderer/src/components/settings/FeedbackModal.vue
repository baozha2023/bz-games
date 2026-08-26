<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="t('feedback.title')"
    class="feedback-modal"
    style="
      width: 72vw;
      height: 72vh;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
    "
    content-style="display: flex; flex: 1; min-height: 0; overflow: hidden"
    header-style="flex-shrink: 0"
    action-style="flex-shrink: 0"
    :closable="!busy"
    :mask-closable="!busy"
  >
    <n-tabs
      v-model:value="activeTab"
      type="line"
      animated
      class="feedback-tabs"
    >
      <n-tab-pane name="submit" :tab="t('feedback.title')">
        <n-space vertical :size="16" class="feedback-tab-content">
          <template v-if="!successId">
            <n-input
              v-model:value="content"
              type="textarea"
              :placeholder="t('feedback.placeholder')"
              :maxlength="5000"
              :autosize="{ minRows: 8, maxRows: 12 }"
              show-count
              :disabled="busy"
            />

            <ImageSelectionPanel
              :images="images"
              :select-label="t('feedback.selectImages')"
              :limits-label="t('feedback.imageLimits')"
              :clear-label="t('feedback.clearImages')"
              :remove-label="t('feedback.removeImage')"
              :selecting="selecting"
              :disabled="busy"
              :clear-disabled="submitting"
              @select="selectImages"
              @clear="clearImages"
              @remove="removeImage"
            />

            <n-alert v-if="errorText" type="error">{{ errorText }}</n-alert>
            <n-alert v-if="cooldownText" type="warning">{{
              cooldownText
            }}</n-alert>
          </template>

          <n-result
            v-else
            status="success"
            :title="t('feedback.successTitle')"
            :description="t('feedback.successDescription', { id: successId })"
          />
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="history" :tab="t('feedback.history')" :disabled="busy">
        <div class="feedback-tab-content feedback-history-content">
          <div v-if="historyLoading" class="feedback-history-skeleton-list">
            <div
              v-for="index in 5"
              :key="index"
              class="feedback-history-skeleton-item"
            >
              <div class="feedback-history-skeleton-copy">
                <n-skeleton text :width="220" />
                <n-skeleton text :width="150" />
              </div>
              <n-skeleton text width="24px" />
            </div>
          </div>
          <n-empty
            v-else-if="history.length === 0"
            :description="t('feedback.historyEmpty')"
          />
          <n-scrollbar v-else class="feedback-history-list">
            <n-list class="feedback-history-list-inner">
              <n-list-item
                v-for="item in history"
                :key="item.id"
                class="feedback-history-item"
              >
                <n-thing>
                  <template #header>
                    <n-text code>{{ item.id }}</n-text>
                  </template>
                  <template #description>
                    {{
                      t("feedback.historySubmittedAt", {
                        time: new Date(item.submittedAt).toLocaleString(),
                      })
                    }}
                  </template>
                  <template #header-extra>
                    <n-button
                      text
                      class="feedback-history-toggle"
                      :loading="historyDetailLoading[item.id]"
                      @click="toggleHistoryItem(item)"
                    >
                      <n-icon>
                        <ChevronUp v-if="expandedHistory[item.id]" />
                        <ChevronDown v-else />
                      </n-icon>
                    </n-button>
                  </template>
                </n-thing>

                <n-collapse-transition
                  :show="expandedHistory[item.id] === true"
                >
                  <div class="feedback-history-detail">
                    <n-spin :show="historyDetailLoading[item.id]">
                      <n-alert v-if="historyDetailErrors[item.id]" type="error">
                        {{ historyDetailErrorText(item.id) }}
                      </n-alert>
                      <template v-else-if="historyDetails[item.id]">
                        <n-descriptions bordered :column="2" size="small">
                          <n-descriptions-item
                            :label="t('feedback.historyStatus')"
                          >
                            <n-tag
                              size="small"
                              :type="
                                statusTagType(historyDetails[item.id]!.status)
                              "
                            >
                              {{
                                t(
                                  `feedback.statuses.${historyDetails[item.id]!.status}`,
                                )
                              }}
                            </n-tag>
                          </n-descriptions-item>
                          <n-descriptions-item
                            :label="t('feedback.historyUpdatedAt')"
                          >
                            {{
                              new Date(
                                historyDetails[item.id]!.updatedAt,
                              ).toLocaleString()
                            }}
                          </n-descriptions-item>
                          <n-descriptions-item
                            :label="t('feedback.historyContent')"
                            :span="2"
                          >
                            <div class="feedback-detail-text">
                              {{
                                historyDetails[item.id]!.content ||
                                t("feedback.historyNoContent")
                              }}
                            </div>
                          </n-descriptions-item>
                          <n-descriptions-item
                            :label="t('feedback.historyReply')"
                            :span="2"
                          >
                            <div class="feedback-detail-text">
                              {{
                                historyDetails[item.id]!.reply ||
                                t("feedback.historyNoReply")
                              }}
                            </div>
                          </n-descriptions-item>
                        </n-descriptions>

                        <div
                          v-if="historyDetails[item.id]!.images.length"
                          class="feedback-detail-images"
                        >
                          <div
                            v-for="image in historyDetails[item.id]!.images"
                            :key="image.id"
                            class="feedback-detail-image"
                          >
                            <n-image
                              width="144"
                              height="144"
                              object-fit="contain"
                              :src="image.previewUrl"
                              :alt="image.fileName"
                            />
                            <div class="feedback-detail-image-name">
                              {{ image.fileName }}
                            </div>
                          </div>
                        </div>
                      </template>
                    </n-spin>
                  </div>
                </n-collapse-transition>
              </n-list-item>
            </n-list>
            <div
              v-if="historyHasMore"
              ref="historySentinel"
              class="feedback-history-sentinel"
              aria-hidden="true"
            >
              <n-spin v-if="historyLoadingMore" size="small" />
            </div>
          </n-scrollbar>
        </div>
      </n-tab-pane>
    </n-tabs>

    <template #action>
      <n-space justify="end">
        <n-button :disabled="busy" @click="close">
          {{
            activeTab === "submit" && !successId
              ? t("common.cancel")
              : t("common.confirm")
          }}
        </n-button>
        <n-button
          v-if="activeTab === 'submit' && !successId"
          type="primary"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ t("feedback.submit") }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useMessage } from "naive-ui";
import { ChevronDown, ChevronUp } from "@vicons/ionicons5";
import ImageSelectionPanel from "../common/ImageSelectionPanel.vue";
import type {
  FeedbackDetail,
  FeedbackHistoryItem,
  FeedbackStatus,
} from "../../../../shared/types";

interface FeedbackImage {
  id: string;
  fileName: string;
  previewUrl: string;
}

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
}>();

const { t } = useI18n();
const message = useMessage();
const content = ref("");
const selectionId = ref("");
const images = ref<FeedbackImage[]>([]);
const selecting = ref(false);
const submitting = ref(false);
const errorCode = ref("");
const resetAt = ref("");
const successId = ref("");
const activeTab = ref<"submit" | "history">("submit");
const historyLoading = ref(false);
const historyLoadingMore = ref(false);
const history = ref<FeedbackHistoryItem[]>([]);
const historyNextCursor = ref<string | null>(null);
const historyHasMore = ref(false);
const historySentinel = ref<HTMLElement | null>(null);
const expandedHistory = ref<Record<string, boolean>>({});
const historyDetails = ref<Record<string, FeedbackDetail | undefined>>({});
const historyDetailLoading = ref<Record<string, boolean>>({});
const historyDetailErrors = ref<Record<string, string>>({});
let historyRequestGeneration = 0;
let historyObserver: IntersectionObserver | null = null;

const visible = computed({
  get: () => props.show,
  set: (value: boolean) => emit("update:show", value),
});

const busy = computed(() => selecting.value || submitting.value);

const canSubmit = computed(
  () => !busy.value && Boolean(content.value.trim() || images.value.length > 0),
);

const errorText = computed(() => {
  if (!errorCode.value) return "";
  const key = `feedback.errors.${errorCode.value}`;
  const translated = t(key);
  return translated === key ? t("feedback.errors.unknown") : translated;
});

const cooldownText = computed(() =>
  resetAt.value
    ? t("feedback.cooldownUntil", {
        time: new Date(resetAt.value).toLocaleString(),
      })
    : "",
);

async function releaseSelection() {
  if (!selectionId.value) return;
  const current = selectionId.value;
  selectionId.value = "";
  images.value = [];
  await window.electronAPI.settings.releaseFeedbackImages(current);
}

async function selectImages() {
  if (busy.value) return;
  selecting.value = true;
  errorCode.value = "";
  try {
    const result = await window.electronAPI.settings.selectFeedbackImages(
      selectionId.value || undefined,
    );
    if (result.canceled) return;
    if (!result.success || !result.selectionId || !result.images) {
      if (result.error === "duplicate_image") {
        message.warning(t("feedback.errors.duplicate_image"));
        return;
      }
      errorCode.value = result.error || "feedback_image_failed";
      if (result.error === "feedback_images_expired") {
        selectionId.value = "";
        images.value = [];
      }
      return;
    }
    selectionId.value = result.selectionId;
    images.value = result.images;
  } finally {
    selecting.value = false;
  }
}

async function removeImage(imageId: string) {
  if (!selectionId.value) return;
  await window.electronAPI.settings.releaseFeedbackImages(
    selectionId.value,
    imageId,
  );
  images.value = images.value.filter((image) => image.id !== imageId);
  if (images.value.length === 0) selectionId.value = "";
}

async function clearImages() {
  await releaseSelection();
}

async function loadHistory() {
  if (historyLoading.value) return;
  const generation = ++historyRequestGeneration;
  history.value = [];
  historyNextCursor.value = null;
  historyHasMore.value = false;
  expandedHistory.value = {};
  historyDetails.value = {};
  historyDetailErrors.value = {};
  historyLoading.value = true;
  try {
    const page = await window.electronAPI.settings.getFeedbackHistory();
    if (generation !== historyRequestGeneration) return;
    history.value = page.items;
    historyNextCursor.value = page.nextCursor;
    historyHasMore.value = page.hasMore;
  } catch {
    if (generation !== historyRequestGeneration) return;
    history.value = [];
    historyNextCursor.value = null;
    historyHasMore.value = false;
  } finally {
    if (generation === historyRequestGeneration) historyLoading.value = false;
    if (generation === historyRequestGeneration) void resetHistoryObserver();
  }
}

async function loadMoreHistory() {
  if (
    historyLoading.value ||
    historyLoadingMore.value ||
    !historyHasMore.value ||
    !historyNextCursor.value
  ) {
    return;
  }
  const generation = historyRequestGeneration;
  const cursor = historyNextCursor.value;
  let succeeded = false;
  historyLoadingMore.value = true;
  try {
    const page = await window.electronAPI.settings.getFeedbackHistory(cursor);
    if (generation !== historyRequestGeneration) return;
    const byId = new Map(history.value.map((item) => [item.id, item]));
    for (const item of page.items) byId.set(item.id, item);
    history.value = Array.from(byId.values());
    historyNextCursor.value = page.nextCursor;
    historyHasMore.value = page.hasMore;
    succeeded = true;
  } catch {
    if (generation !== historyRequestGeneration) return;
    message.error(t("feedback.errors.feedback_network_failed"));
  } finally {
    if (generation === historyRequestGeneration) {
      historyLoadingMore.value = false;
      if (succeeded) void resetHistoryObserver();
    }
  }
}

function disconnectHistoryObserver() {
  historyObserver?.disconnect();
  historyObserver = null;
}

async function resetHistoryObserver() {
  await nextTick();
  disconnectHistoryObserver();
  const target = historySentinel.value;
  if (!target || activeTab.value !== "history" || !props.show) return;
  const root = target.closest<HTMLElement>(".n-scrollbar-container");
  historyObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMoreHistory();
      }
    },
    { root, rootMargin: "320px 0px" },
  );
  historyObserver.observe(target);
}

function statusTagType(
  status: FeedbackStatus,
): "default" | "info" | "warning" | "success" | "error" {
  if (status === "new") return "info";
  if (status === "reviewing") return "warning";
  if (status === "resolved") return "success";
  if (status === "closed") return "error";
  return "default";
}

function historyDetailErrorText(feedbackId: string): string {
  const code = historyDetailErrors.value[feedbackId] || "unknown";
  const key = `feedback.errors.${code}`;
  const translated = t(key);
  return translated === key ? t("feedback.errors.unknown") : translated;
}

async function toggleHistoryItem(item: FeedbackHistoryItem) {
  const expanded = !expandedHistory.value[item.id];
  expandedHistory.value = {
    ...expandedHistory.value,
    [item.id]: expanded,
  };
  if (!expanded || historyDetailLoading.value[item.id]) return;
  const generation = historyRequestGeneration;

  historyDetailLoading.value = {
    ...historyDetailLoading.value,
    [item.id]: true,
  };
  historyDetailErrors.value = {
    ...historyDetailErrors.value,
    [item.id]: "",
  };
  try {
    const result = await window.electronAPI.settings.getFeedbackDetail(item.id);
    if (generation !== historyRequestGeneration) return;
    if (!result.success) {
      historyDetailErrors.value = {
        ...historyDetailErrors.value,
        [item.id]: result.error || "unknown",
      };
      return;
    }
    historyDetails.value = {
      ...historyDetails.value,
      [item.id]: result.detail,
    };
  } catch {
    if (generation !== historyRequestGeneration) return;
    historyDetailErrors.value = {
      ...historyDetailErrors.value,
      [item.id]: "feedback_network_failed",
    };
  } finally {
    if (generation !== historyRequestGeneration) return;
    historyDetailLoading.value = {
      ...historyDetailLoading.value,
      [item.id]: false,
    };
  }
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorCode.value = "";
  resetAt.value = "";
  try {
    const result = await window.electronAPI.settings.submitFeedback({
      content: content.value,
      selectionId: selectionId.value || undefined,
    });
    if (!result.success) {
      resetAt.value = result.resetAt || "";
      if (result.error === "feedback_images_expired") {
        selectionId.value = "";
        images.value = [];
      }
      const authInvalid =
        result.error === "session_expired" ||
        result.error === "session_invalid";
      errorCode.value =
        authInvalid ||
        (result.error === "feedback_too_frequent" && resetAt.value)
          ? ""
          : result.error || "unknown";
      return;
    }
    successId.value = result.id || "";
    content.value = "";
    selectionId.value = "";
    images.value = [];
  } finally {
    submitting.value = false;
  }
}

async function close() {
  if (busy.value) return;
  await releaseSelection();
  visible.value = false;
}

function resetState() {
  historyRequestGeneration += 1;
  disconnectHistoryObserver();
  content.value = "";
  errorCode.value = "";
  resetAt.value = "";
  successId.value = "";
  activeTab.value = "submit";
  historyLoading.value = false;
  historyLoadingMore.value = false;
  history.value = [];
  historyNextCursor.value = null;
  historyHasMore.value = false;
  expandedHistory.value = {};
  historyDetails.value = {};
  historyDetailLoading.value = {};
  historyDetailErrors.value = {};
}

watch(activeTab, (tab) => {
  if (tab === "history") {
    void loadHistory();
  } else {
    disconnectHistoryObserver();
  }
});

watch(
  () => props.show,
  async (show) => {
    if (!show) {
      await releaseSelection();
      resetState();
    }
  },
);

onBeforeUnmount(() => {
  disconnectHistoryObserver();
  void releaseSelection();
});
</script>

<style scoped>
.feedback-tabs {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.feedback-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1;
  min-height: 0;
}

.feedback-tabs :deep(.n-tab-pane) {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.feedback-tab-content {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  padding-right: 4px;
}

.feedback-history-list {
  height: 100%;
}

.feedback-history-list-inner {
  background: transparent;
}

.feedback-history-sentinel {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
}

.feedback-history-content {
  overflow: hidden;
}

.feedback-history-skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 4px;
}

.feedback-history-skeleton-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
}

.feedback-history-skeleton-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
}

.feedback-history-item {
  padding: 12px 4px;
}

.feedback-history-toggle {
  font-size: 20px;
}

.feedback-history-detail {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
  background: var(--n-color-embedded);
}

.feedback-detail-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.feedback-detail-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, 144px);
  gap: 16px;
  margin-top: 16px;
}

.feedback-detail-image {
  min-width: 0;
}

.feedback-detail-image :deep(img) {
  background: var(--n-color-modal);
}

.feedback-detail-image-name {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
</style>
