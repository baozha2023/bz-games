import { defineStore } from "pinia";
import { ref } from "vue";
import type { AppSettings, UserData } from "../../../shared/types";
import { setLocale } from "../i18n";

type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "up_to_date"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  currentVersion: string;
  latestVersion?: string;
  progress?: number;
  message?: string;
};

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings | null>(null);
  const userData = ref<UserData | null>(null);
  const updateState = ref<UpdateState>({
    status: "idle",
    currentVersion: "0.0.0",
    progress: 0,
  });
  const showUpdateModal = ref(false);
  let cleanupUpdateEvent: (() => void) | undefined;
  let updateInited = false;
  let suppressUpdateModal = false;

  async function loadSettings() {
    settings.value = await window.electronAPI.settings.get();
    if (settings.value?.language) {
      setLocale(settings.value.language);
    }
  }

  async function loadUserData() {
    userData.value = await window.electronAPI.user.getData();
  }

  async function checkIn() {
    const result = await window.electronAPI.user.checkIn();
    if (result.success) {
      await loadUserData();
    }
    return result;
  }

  async function saveSettings(newSettings: AppSettings) {
    await window.electronAPI.settings.save(newSettings);
    settings.value = newSettings;
    if (newSettings.language) {
      setLocale(newSettings.language);
    }
  }

  async function refreshUpdateStatus() {
    updateState.value = await window.electronAPI.settings.getUpdateStatus();
    return updateState.value;
  }

  function initUpdateEvents() {
    if (updateInited) return;
    updateInited = true;
    cleanupUpdateEvent = window.electronAPI.settings.onUpdateEvent((payload) => {
      updateState.value = {
        ...updateState.value,
        ...payload,
      };
      if (
        ["checking", "available", "downloading", "downloaded", "error"].includes(
          payload.status,
        )
      ) {
        if (!suppressUpdateModal) {
          showUpdateModal.value = true;
        }
      }
    });
  }

  function cleanupUpdateEvents() {
    if (cleanupUpdateEvent) cleanupUpdateEvent();
    cleanupUpdateEvent = undefined;
    updateInited = false;
  }

  async function checkUpdate() {
    showUpdateModal.value = true;
    const state = await window.electronAPI.settings.checkUpdate();
    updateState.value = state;
    if (state.status === "available") {
      await window.electronAPI.settings.downloadUpdate();
    }
    return state;
  }

  async function checkUpdateOnly() {
    suppressUpdateModal = true;
    const state = await window.electronAPI.settings.checkUpdate();
    updateState.value = state;
    suppressUpdateModal = false;
    return state;
  }

  async function downloadUpdate() {
    return await window.electronAPI.settings.downloadUpdate();
  }

  async function installUpdate() {
    await window.electronAPI.settings.installUpdate();
  }

  function hideUpdateModal() {
    showUpdateModal.value = false;
  }

  return {
    settings,
    userData,
    updateState,
    showUpdateModal,
    loadSettings,
    saveSettings,
    loadUserData,
    checkIn,
    refreshUpdateStatus,
    initUpdateEvents,
    cleanupUpdateEvents,
    checkUpdate,
    checkUpdateOnly,
    downloadUpdate,
    installUpdate,
    hideUpdateModal,
  };
});
