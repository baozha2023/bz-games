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
          <n-alert :type="authenticated ? 'success' : 'info'">
            {{
              authenticated
                ? t("feedback.loggedInHint")
                : t("feedback.anonymousHint")
            }}
          </n-alert>

          <template v-if="!successId">
            <n-input
              v-model:value="content"
              type="textarea"
              :placeholder="t('feedback.placeholder')"
              :maxlength="5000"
              :autosize="{ minRows: 5, maxRows: 10 }"
              show-count
              :disabled="busy"
            />

            <div>
              <n-space align="center">
                <n-button
                  secondary
                  :loading="selecting"
                  :disabled="busy || images.length >= 4"
                  @click="selectImages"
                >
                  {{ t("feedback.selectImages") }}
                </n-button>
                <n-text depth="3">{{ t("feedback.imageLimits") }}</n-text>
                <n-button
                  v-if="images.length"
                  text
                  type="error"
                  :disabled="submitting"
                  @click="clearImages"
                >
                  {{ t("feedback.clearImages") }}
                </n-button>
              </n-space>
              <div v-if="images.length" class="feedback-images">
                <div
                  v-for="image in images"
                  :key="image.id"
                  class="feedback-image"
                >
                  <img :src="image.previewUrl" :alt="image.fileName" />
                  <button
                    type="button"
                    :aria-label="t('feedback.removeImage')"
                    :disabled="busy"
                    @click="removeImage(image.id)"
                  >
                    ×
                  </button>
                  <div class="feedback-image-name" :title="image.fileName">
                    {{ image.fileName }}
                  </div>
                </div>
              </div>
            </div>

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
        <n-spin
          :show="historyLoading"
          class="feedback-tab-content feedback-history-content"
        >
          <n-empty
            v-if="!historyLoading && history.length === 0"
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
          </n-scrollbar>
        </n-spin>
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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useMessage } from "naive-ui";
import { ChevronDown, ChevronUp } from "@vicons/ionicons5";
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
  authenticated: boolean;
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
const historyLoaded = ref(false);
const history = ref<FeedbackHistoryItem[]>([]);
const expandedHistory = ref<Record<string, boolean>>({});
const historyDetails = ref<Record<string, FeedbackDetail | undefined>>({});
const historyDetailLoading = ref<Record<string, boolean>>({});
const historyDetailErrors = ref<Record<string, string>>({});
let historyRequestGeneration = 0;

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
  if (historyLoaded.value || historyLoading.value) return;
  const generation = historyRequestGeneration;
  historyLoading.value = true;
  try {
    const nextHistory = await window.electronAPI.settings.getFeedbackHistory();
    if (generation !== historyRequestGeneration) return;
    history.value = nextHistory;
    historyLoaded.value = true;
  } catch {
    if (generation !== historyRequestGeneration) return;
    history.value = [];
  } finally {
    if (generation === historyRequestGeneration) historyLoading.value = false;
  }
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
    historyLoaded.value = false;
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
  content.value = "";
  errorCode.value = "";
  resetAt.value = "";
  successId.value = "";
  activeTab.value = "submit";
  historyLoading.value = false;
  historyLoaded.value = false;
  history.value = [];
  expandedHistory.value = {};
  historyDetails.value = {};
  historyDetailLoading.value = {};
  historyDetailErrors.value = {};
}

watch(activeTab, (tab) => {
  if (tab === "history") void loadHistory();
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

.feedback-history-content {
  overflow: hidden;
}

.feedback-history-content :deep(.n-spin-content) {
  height: 100%;
}

.feedback-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, 144px);
  gap: 12px;
  margin-top: 12px;
}

.feedback-image {
  position: relative;
  min-width: 0;
}

.feedback-image img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  object-fit: contain;
  background: var(--n-color-modal);
}

.feedback-image button {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  cursor: pointer;
}

.feedback-image-name {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
  word-break: break-word;
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
