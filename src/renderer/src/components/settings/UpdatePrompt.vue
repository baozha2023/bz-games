<template>
  <n-modal
    :show="visible"
    preset="dialog"
    type="warning"
    :title="t('settings.updatePromptTitle')"
    :mask-closable="false"
    :closable="false"
  >
    <n-space vertical :size="14">
      <n-text>
        {{
          t("settings.updatePromptMessage", {
            version: state?.latestVersion || "",
          })
        }}
      </n-text>
      <n-progress
        v-if="state?.status === 'downloading'"
        type="line"
        :percentage="Math.round(state.progress || 0)"
        processing
      />
      <n-space v-if="state?.status === 'verifying'" align="center">
        <n-spin size="small" />
        <n-text>{{ t("settings.updateVerifying") }}</n-text>
      </n-space>
      <n-text v-if="state?.status === 'ready'" type="success">
        {{ t("settings.updateReady") }}
      </n-text>
      <n-text v-if="state?.status === 'error'" type="error">
        {{ updateErrorText }}
      </n-text>
    </n-space>
    <template #action>
      <n-space justify="end">
        <n-button secondary @click="openReleaseNotes">
          {{ t("settings.updateViewReleaseNotes") }}
        </n-button>
        <n-button
          v-if="state?.status === 'downloading'"
          @click="cancelDownload"
        >
          {{ t("common.cancel") }}
        </n-button>
        <n-button v-else @click="suppress">
          {{ t("settings.updateLater") }}
        </n-button>
        <n-button
          type="primary"
          :loading="
            state?.status === 'downloading' ||
            state?.status === 'verifying' ||
            state?.status === 'applying'
          "
          @click="primaryAction"
        >
          {{
            state?.status === "ready"
              ? t("settings.updateRestartInstall")
              : t("settings.updateNow")
          }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import {
  NButton,
  NModal,
  NProgress,
  NSpace,
  NSpin,
  NText,
  useMessage,
} from "naive-ui";
import { useI18n } from "vue-i18n";
import {
  hideUpdatePrompt,
  setUpdateState,
  useUpdatePrompt,
} from "../../composables/useUpdatePrompt";

const { t } = useI18n();
const message = useMessage();
const { visible, state } = useUpdatePrompt();
let removeListener: (() => void) | undefined;

const updateErrorText = computed(() => {
  const key = `settings.updateErrors.${state.value?.errorCode || "unknown"}`;
  const translated = t(key);
  return translated === key
    ? state.value?.message || t("settings.updateErrors.unknown")
    : translated;
});

onMounted(() => {
  removeListener = window.electronAPI.update.onEvent((next) => {
    setUpdateState(next);
    if (next.status === "error" && !next.automatic)
      message.error(updateErrorText.value);
  });
});

onUnmounted(() => removeListener?.());

async function openReleaseNotes() {
  const version = state.value?.latestVersion;
  if (!version) return;
  const opened = await window.electronAPI.settings.openUrl(
    `https://github.com/baozha2023/bz-games/releases/tag/v${encodeURIComponent(version)}`,
  );
  if (!opened) message.error(t("settings.updateReleaseOpenFailed"));
}

async function suppress() {
  await window.electronAPI.update.suppressForCurrentVersion();
  hideUpdatePrompt();
}

async function cancelDownload() {
  setUpdateState(await window.electronAPI.update.cancel());
}

async function primaryAction() {
  if (state.value?.status === "ready") {
    setUpdateState(await window.electronAPI.update.apply());
    return;
  }
  setUpdateState(await window.electronAPI.update.download());
}
</script>
