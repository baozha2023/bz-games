import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings } from '../../../shared/types';
import i18n from '../i18n';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null);

  async function loadSettings() {
    settings.value = await window.electronAPI.settings.get();
    if (settings.value?.language) {
      // @ts-ignore
      i18n.global.locale.value = settings.value.language;
    }
  }

  async function saveSettings(newSettings: AppSettings) {
    await window.electronAPI.settings.save(newSettings);
    settings.value = newSettings;
    if (newSettings.language) {
      // @ts-ignore
      i18n.global.locale.value = newSettings.language;
    }
  }

  return { settings, loadSettings, saveSettings };
});
