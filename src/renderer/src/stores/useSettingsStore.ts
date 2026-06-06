import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  AppSettings,
  DataHealthReport,
  UpdateState,
  UserData,
} from "../../../shared/types";
import { setLocale } from "../i18n";
import type { EffectiveTheme } from "../utils/nicknameColor";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings | null>(null);
  const userData = ref<UserData | null>(null);
  const dataHealthReport = ref<DataHealthReport | null>(null);
  const updateState = ref<UpdateState>({
    status: "idle",
    currentVersion: "0.0.0",
    progress: 0,
  });
  const showUpdateModal = ref(false);
  const prefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
  let cleanupUpdateEvent: (() => void) | undefined;
  let updateInited = false;

  const effectiveTheme = computed<EffectiveTheme>(() => {
    const theme = settings.value?.theme;
    if (theme === "auto") return prefersDark.value ? "dark" : "light";
    return theme === "light" ? "light" : "dark";
  });

  function setPrefersDark(value: boolean) {
    prefersDark.value = value;
  }

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

  async function runDataHealthCheck() {
    dataHealthReport.value = await window.electronAPI.settings.dataHealthCheck();
    return dataHealthReport.value;
  }

  async function saveSettings(newSettings: AppSettings) {
    await window.electronAPI.settings.save(newSettings);
    settings.value = newSettings;
    if (newSettings.language) {
      setLocale(newSettings.language);
    }
  }

  async function savePartialSettings(partial: Partial<AppSettings>) {
    await window.electronAPI.settings.savePartialSettings(partial);
    const currentSettings = settings.value || (await window.electronAPI.settings.get());
    settings.value = {
      ...currentSettings,
      ...partial,
    };
    if (partial.language) {
      setLocale(partial.language);
    }
  }

  async function ignoreUpdateVersion(version: string) {
    await window.electronAPI.settings.ignoreUpdateVersion(version);
    if (settings.value) {
      settings.value = { ...settings.value, ignoredUpdateVersion: version };
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
    });
  }

  function cleanupUpdateEvents() {
    if (cleanupUpdateEvent) cleanupUpdateEvent();
    cleanupUpdateEvent = undefined;
    updateInited = false;
  }

  async function checkUpdate() {
    initUpdateEvents();
    showUpdateModal.value = true;
    const state = await window.electronAPI.settings.checkUpdate();
    updateState.value = state;
    if (state.status === "available") {
      await window.electronAPI.settings.downloadUpdate();
    }
    return state;
  }

  async function checkUpdateOnly() {
    const state = await window.electronAPI.settings.checkUpdate();
    updateState.value = state;
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
    dataHealthReport,
    updateState,
    showUpdateModal,
    prefersDark,
    effectiveTheme,
    setPrefersDark,
    loadSettings,
    saveSettings,
    savePartialSettings,
    ignoreUpdateVersion,
    loadUserData,
    checkIn,
    runDataHealthCheck,
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
