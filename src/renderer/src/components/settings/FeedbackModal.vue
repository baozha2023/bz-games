<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="t('feedback.title')"
    style="width: min(680px, 92vw)"
    :closable="!busy"
    :mask-closable="!busy"
  >
    <n-space vertical :size="16">
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
              :disabled="busy"
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
            <div v-for="image in images" :key="image.id" class="feedback-image">
              <img :src="image.previewUrl" :alt="image.fileName" />
              <button
                type="button"
                :aria-label="t('feedback.removeImage')"
                :disabled="busy"
                @click="removeImage(image.id)"
              >
                ×
              </button>
              <n-ellipsis class="feedback-image-name">
                {{ image.fileName }}
              </n-ellipsis>
            </div>
          </div>
        </div>

        <n-alert v-if="errorText" type="error">{{ errorText }}</n-alert>
        <n-alert v-if="cooldownText" type="warning">{{ cooldownText }}</n-alert>
      </template>

      <n-result
        v-else
        status="success"
        :title="t('feedback.successTitle')"
        :description="t('feedback.successDescription', { id: successId })"
      />
    </n-space>

    <template #action>
      <n-space justify="end">
        <n-button :disabled="busy" @click="openHistory">
          {{ t("feedback.history") }}
        </n-button>
        <n-button :disabled="busy" @click="close">
          {{ successId ? t("common.confirm") : t("common.cancel") }}
        </n-button>
        <n-button
          v-if="!successId"
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

  <n-modal
    v-model:show="historyVisible"
    preset="card"
    :title="t('feedback.historyTitle')"
    style="width: min(560px, 88vw)"
  >
    <n-spin :show="historyLoading">
      <n-empty
        v-if="!historyLoading && history.length === 0"
        :description="t('feedback.historyEmpty')"
      />
      <n-scrollbar v-else style="max-height: 420px">
        <div
          v-for="item in history"
          :key="item.id"
          class="feedback-history-item"
        >
          <n-text code>{{ item.id }}</n-text>
          <n-text depth="3">
            {{
              t("feedback.historySubmittedAt", {
                time: new Date(item.submittedAt).toLocaleString(),
              })
            }}
          </n-text>
        </div>
      </n-scrollbar>
    </n-spin>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { FeedbackHistoryItem } from "../../../../shared/types";

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
  (event: "auth-expired"): void;
}>();

const { t } = useI18n();
const content = ref("");
const selectionId = ref("");
const images = ref<FeedbackImage[]>([]);
const selecting = ref(false);
const submitting = ref(false);
const errorCode = ref("");
const resetAt = ref("");
const successId = ref("");
const historyVisible = ref(false);
const historyLoading = ref(false);
const history = ref<FeedbackHistoryItem[]>([]);

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
    const result = await window.electronAPI.settings.selectFeedbackImages();
    if (result.canceled) return;
    if (!result.success || !result.selectionId || !result.images) {
      errorCode.value = result.error || "feedback_image_failed";
      return;
    }
    if (selectionId.value) {
      await window.electronAPI.settings.releaseFeedbackImages(
        selectionId.value,
      );
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

async function openHistory() {
  if (busy.value) return;
  historyVisible.value = true;
  historyLoading.value = true;
  try {
    history.value = await window.electronAPI.settings.getFeedbackHistory();
  } catch {
    history.value = [];
  } finally {
    historyLoading.value = false;
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
      errorCode.value =
        result.error === "feedback_too_frequent" && resetAt.value
          ? ""
          : result.error || "unknown";
      if (result.error === "unauthorized") emit("auth-expired");
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
  content.value = "";
  errorCode.value = "";
  resetAt.value = "";
  successId.value = "";
  historyVisible.value = false;
}

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
.feedback-images {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
  object-fit: cover;
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
}

.feedback-history-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--n-border-color);
}

.feedback-history-item:last-child {
  border-bottom: 0;
}

@media (max-width: 560px) {
  .feedback-images {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
