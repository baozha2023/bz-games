<template>
  <n-modal
    v-model:show="visibleModel"
    preset="card"
    :title="t('backup.title')"
    style="width: min(720px, calc(100vw - 32px))"
    :mask-closable="!isLocked"
    :closable="!isLocked"
  >
    <n-space vertical size="large">
      <n-alert type="info" :title="t('backup.versionPolicyTitle')">
        {{ t("backup.versionPolicyBody") }}
      </n-alert>
      <n-alert type="warning" :title="t('backup.replaceTitle')">
        {{ t("backup.replaceBody") }}
      </n-alert>
      <n-text depth="3">{{ t("backup.sourcePreserved") }}</n-text>

      <n-descriptions
        v-if="preview"
        bordered
        :column="2"
        size="small"
        :label-style="{ whiteSpace: 'nowrap' }"
      >
        <n-descriptions-item :label="t('backup.formatVersion')">
          V{{ preview.formatVersion }}
        </n-descriptions-item>
        <n-descriptions-item :label="t('backup.sourceVersion')">
          {{ preview.sourceAppVersion }}
        </n-descriptions-item>
        <n-descriptions-item :label="t('backup.fileCount')">
          {{ preview.totalFiles }}
        </n-descriptions-item>
        <n-descriptions-item :label="t('backup.dataSize')">
          {{ formatBytes(preview.totalBytes) }}
        </n-descriptions-item>
        <n-descriptions-item :label="t('backup.externalLibraries')">
          {{ preview.externalLibraryCount }}
        </n-descriptions-item>
      </n-descriptions>

      <template v-if="state.status !== 'idle'">
        <n-divider style="margin: 4px 0" />
        <n-text>{{ statusText }}</n-text>
        <n-progress
          v-if="isProgressVisible"
          type="line"
          :percentage="state.progress"
          indicator-placement="inside"
          processing
        />
        <n-text v-if="isProgressVisible && state.totalBytes > 0" depth="3">
          {{
            t("backup.progressDetail", {
              processed: formatBytes(state.processedBytes),
              total: formatBytes(state.totalBytes),
              files: state.totalFiles,
            })
          }}
        </n-text>
        <n-text
          v-if="state.status === 'completed' && state.outputPath"
          depth="3"
        >
          {{ state.outputPath }}
        </n-text>
      </template>
    </n-space>

    <template #footer>
      <n-space justify="space-between">
        <n-button :disabled="isLocked" @click="close">
          {{ t("common.close") }}
        </n-button>
        <n-space>
          <n-button
            v-if="isProgressVisible"
            type="error"
            secondary
            @click="cancel"
          >
            {{ t("common.cancel") }}
          </n-button>
          <n-button
            v-if="preview"
            type="error"
            :disabled="isProgressVisible"
            @click="confirmImport"
          >
            {{ t("backup.confirmReplace") }}
          </n-button>
          <template v-else>
            <n-button :disabled="isLocked" @click="selectImport">
              {{ t("backup.importData") }}
            </n-button>
            <n-button type="primary" :disabled="isLocked" @click="startExport">
              {{ t("backup.exportData") }}
            </n-button>
          </template>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import type {
  BackupImportPreview,
  BackupState,
} from "../../../../shared/types";
import { formatBytes } from "../../utils/format";
import {
  hideBackupManager,
  useBackupManager,
} from "../../composables/useBackupManager";

const { t } = useI18n();
const message = useMessage();
const { visible } = useBackupManager();
const preview = ref<BackupImportPreview | null>(null);
const state = ref<BackupState>({
  status: "idle",
  progress: 0,
  processedBytes: 0,
  totalBytes: 0,
  processedFiles: 0,
  totalFiles: 0,
});

const isProgressVisible = computed(() =>
  ["preparing", "archiving", "verifying", "importing"].includes(
    state.value.status,
  ),
);
const isLocked = computed(
  () =>
    isProgressVisible.value || state.value.status === "awaiting_confirmation",
);
const visibleModel = computed({
  get: () => visible.value,
  set: (show: boolean) => {
    if (!show && !isLocked.value) hideBackupManager();
  },
});
const statusText = computed(() => {
  if (state.value.status === "error") {
    return t(`backup.errors.${state.value.errorCode || "unknown"}`);
  }
  return t(`backup.status.${state.value.status}`);
});

watch(visible, async (show) => {
  if (!show) return;
  try {
    state.value = await window.electronAPI.backup.getStatus();
  } catch {
    message.error(t("backup.errors.unknown"));
  }
});

async function close(): Promise<void> {
  if (isLocked.value) return;
  preview.value = null;
  hideBackupManager();
}

async function startExport(): Promise<void> {
  try {
    const result = await window.electronAPI.backup.exportData();
    state.value = result.state;
    if (result.success) message.success(t("backup.exportSuccess"));
    else if (!result.canceled) {
      message.error(t(`backup.errors.${result.state.errorCode || "unknown"}`));
    }
  } catch {
    message.error(t("backup.errors.unknown"));
  }
}

async function selectImport(): Promise<void> {
  try {
    const result = await window.electronAPI.backup.selectImport();
    state.value = result.state;
    if (result.success && result.preview) preview.value = result.preview;
    else if (!result.canceled) {
      message.error(t(`backup.errors.${result.state.errorCode || "unknown"}`));
    }
  } catch {
    message.error(t("backup.errors.unknown"));
  }
}

async function confirmImport(): Promise<void> {
  if (!preview.value) return;
  const result = await window.electronAPI.backup.confirmImport(
    preview.value.token,
  );
  state.value = result.state;
  if (result.success) {
    preview.value = null;
    message.success(t("backup.importSuccessRestarting"));
  } else {
    message.error(t(`backup.errors.${result.state.errorCode || "unknown"}`));
  }
}

function cancel(): void {
  void window.electronAPI.backup.cancel().then(() => {
    preview.value = null;
  });
}

let removeListener: (() => void) | undefined;
onMounted(() => {
  removeListener = window.electronAPI.backup.onEvent((payload) => {
    state.value = payload;
  });
});
onUnmounted(() => removeListener?.());
</script>
