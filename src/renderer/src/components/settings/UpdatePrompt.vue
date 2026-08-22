<template>
  <n-modal
    :show="visible"
    preset="dialog"
    type="warning"
    :title="t('settings.updatePromptTitle')"
    :mask-closable="false"
    @update:show="handleUpdateShow"
  >
    <n-text>
      {{
        t("settings.updatePromptMessage", {
          version: updateState?.latestVersion || "",
        })
      }}
    </n-text>
    <template #action>
      <n-space justify="end">
        <n-button
          secondary
          :loading="openingReleaseNotes"
          @click="handleViewReleaseNotes"
        >
          {{ t("settings.updateViewReleaseNotes") }}
        </n-button>
        <n-button @click="handleUpdateLater">
          {{ t("settings.updateLater") }}
        </n-button>
        <n-button type="primary" @click="handleUpdateNow">
          {{ t("settings.updateNow") }}
        </n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { NButton, NModal, NSpace, NText, useMessage } from "naive-ui";
import { buildDesktopReleaseUrl } from "../../../../shared/update-release";
import { useSettingsStore } from "../../stores/useSettingsStore";
import {
  hideUpdatePrompt,
  useUpdatePrompt,
} from "../../composables/useUpdatePrompt";

const { t } = useI18n();
const message = useMessage();
const settingsStore = useSettingsStore();
const { visible, updateState } = useUpdatePrompt();
const openingReleaseNotes = ref(false);

const handleUpdateShow = (show: boolean) => {
  if (!show) hideUpdatePrompt();
};

const handleViewReleaseNotes = async () => {
  if (openingReleaseNotes.value) return;
  const version = updateState.value?.latestVersion;
  if (!version) return;

  openingReleaseNotes.value = true;
  try {
    const opened = await window.electronAPI.settings.openUrl(
      buildDesktopReleaseUrl(version),
    );
    if (!opened) {
      message.error(t("settings.updateReleaseOpenFailed"));
      return;
    }
    hideUpdatePrompt();
  } finally {
    openingReleaseNotes.value = false;
  }
};

const handleUpdateLater = () => {
  const version = updateState.value?.latestVersion;
  hideUpdatePrompt();
  if (!version) return;

  void settingsStore.ignoreUpdateVersion(version).catch((error: any) => {
    message.error(`${t("settings.saveFail")}: ${error?.message || error}`);
  });
};

const handleUpdateNow = async () => {
  hideUpdatePrompt();
  await settingsStore.checkUpdate();
};
</script>
