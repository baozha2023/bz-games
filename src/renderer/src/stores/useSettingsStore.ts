import { defineStore } from "pinia";
import { ref } from "vue";
import type { AppSettings, UserData } from "../../../shared/types";
import { setLocale } from "../i18n";

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings | null>(null);
  const userData = ref<UserData | null>(null);

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

  return {
    settings,
    userData,
    loadSettings,
    saveSettings,
    loadUserData,
    checkIn,
  };
});
