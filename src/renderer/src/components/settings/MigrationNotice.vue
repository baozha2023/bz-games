<template>
  <n-modal
    v-model:show="visibleModel"
    preset="card"
    :title="t('migration.title')"
    style="width: min(680px, calc(100vw - 32px))"
    :mask-closable="!isBusy"
    :closable="!isBusy"
  >
    <n-space vertical size="large">
      <n-alert type="warning" :title="t('migration.finalVersionTitle')">
        {{ t("migration.finalVersionBody", { version: appVersion }) }}
      </n-alert>

      <n-text>{{ t("migration.downloadBody") }}</n-text>
      <n-a :href="officialWebsite" @click.prevent="openWebsite">
        {{ officialWebsite }}
      </n-a>
      <n-text>{{ t("migration.exportBody") }}</n-text>
      <n-text>{{ t("migration.afterImport") }}</n-text>
      <n-text depth="3">{{ t("migration.localGamesOnly") }}</n-text>
      <n-alert type="info">{{ t("migration.securityNotice") }}</n-alert>

      <template v-if="state.status !== 'idle'">
        <n-divider style="margin: 4px 0" />
        <n-text>{{ statusText }}</n-text>
        <n-progress
          v-if="isBusy"
          type="line"
          :percentage="state.progress"
          indicator-placement="inside"
          processing
        />
        <n-text v-if="state.totalBytes > 0" depth="3">
          {{
            t("migration.progressDetail", {
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
        <n-button :disabled="isBusy" @click="openWebsite">
          {{ t("migration.openWebsite") }}
        </n-button>
        <n-space>
          <n-button v-if="isBusy" type="error" secondary @click="cancelExport">
            {{ t("common.cancel") }}
          </n-button>
          <n-button v-else type="primary" @click="startExport">
            {{ t("migration.exportData") }}
          </n-button>
          <n-button :disabled="isBusy" @click="acknowledgeAndClose">
            {{ t("common.close") }}
          </n-button>
        </n-space>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import {
  MIGRATION_NOTICE_VERSION,
  type MigrationExportState,
} from "../../../../shared/types";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { formatBytes } from "../../utils/format";
import {
  hideMigrationNotice,
  useMigrationNotice,
} from "../../composables/useMigrationNotice";

const officialWebsite = "http://www.bzgames.top/";
const { t } = useI18n();
const message = useMessage();
const settingsStore = useSettingsStore();
const { visible } = useMigrationNotice();
const appVersion = ref<string>(MIGRATION_NOTICE_VERSION);
const state = ref<MigrationExportState>({
  status: "idle",
  progress: 0,
  processedBytes: 0,
  totalBytes: 0,
  processedFiles: 0,
  totalFiles: 0,
});

const visibleModel = computed({
  get: () => visible.value,
  set: (show: boolean) => {
    if (!show && !isBusy.value) void acknowledgeAndClose();
  },
});
const isBusy = computed(() =>
  ["preparing", "archiving", "verifying"].includes(state.value.status),
);
const statusText = computed(() => {
  if (state.value.status === "error") {
    const code = state.value.errorCode || "unknown";
    return t(`migration.errors.${code}`);
  }
  return t(`migration.status.${state.value.status}`);
});

watch(visible, async (show) => {
  if (!show) return;
  try {
    [appVersion.value, state.value] = await Promise.all([
      window.electronAPI.settings.getAppVersion(),
      window.electronAPI.migration.getStatus(),
    ]);
  } catch {
    message.error(t("migration.errors.unknown"));
  }
});

async function acknowledge(): Promise<boolean> {
  if (
    settingsStore.settings?.migrationNoticeAcknowledgedVersion ===
    MIGRATION_NOTICE_VERSION
  ) {
    return true;
  }
  try {
    const acknowledged = await window.electronAPI.migration.acknowledgeNotice(
      MIGRATION_NOTICE_VERSION,
    );
    if (!acknowledged) return false;
    await settingsStore.loadSettings();
    return true;
  } catch {
    message.error(t("migration.errors.unknown"));
    return false;
  }
}

async function acknowledgeAndClose(): Promise<void> {
  if (isBusy.value) return;
  if (await acknowledge()) hideMigrationNotice();
}

function openWebsite(): void {
  void window.electronAPI.settings.openUrl(officialWebsite);
}

async function startExport(): Promise<void> {
  if (isBusy.value) return;
  try {
    const result = await window.electronAPI.migration.exportData();
    state.value = result.state;
    if (result.success) {
      await acknowledge();
      message.success(t("migration.exportSuccess"));
    } else if (!result.canceled) {
      const code = result.state.errorCode || "unknown";
      message.error(t(`migration.errors.${code}`));
    }
  } catch {
    message.error(t("migration.errors.unknown"));
  }
}

function cancelExport(): void {
  void window.electronAPI.migration.cancel();
}

let removeMigrationListener: (() => void) | undefined;
onMounted(() => {
  removeMigrationListener = window.electronAPI.migration.onEvent((payload) => {
    state.value = payload;
  });
});
onUnmounted(() => removeMigrationListener?.());
</script>
