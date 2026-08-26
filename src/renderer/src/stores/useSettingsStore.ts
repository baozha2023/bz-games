import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  AppSettings,
  DataHealthReport,
  UserData,
} from "../../../shared/types";
import { setLocale } from "../i18n";
import type { EffectiveTheme } from "../utils/nicknameColor";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings | null>(null);
  const userData = ref<UserData | null>(null);
  const dataHealthReport = ref<DataHealthReport | null>(null);
  const prefersDark = ref(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

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
    dataHealthReport.value =
      await window.electronAPI.settings.dataHealthCheck();
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
    const currentSettings =
      settings.value || (await window.electronAPI.settings.get());
    settings.value = {
      ...currentSettings,
      ...partial,
    };
    if (partial.language) {
      setLocale(partial.language);
    }
  }

  return {
    settings,
    userData,
    dataHealthReport,
    prefersDark,
    effectiveTheme,
    setPrefersDark,
    loadSettings,
    saveSettings,
    savePartialSettings,
    loadUserData,
    checkIn,
    runDataHealthCheck,
  };
});
