<template>
  <div style="padding: 24px; max-width: 600px; margin: 0 auto;">
    <n-page-header :title="t('settings.title')" />
    <n-divider />
    <n-form ref="formRef" :model="formValue" :rules="rules" v-if="formValue" label-placement="left" label-width="120">
      <n-form-item :label="t('settings.playerName')" path="playerName">
        <n-input v-model:value="formValue.playerName" :placeholder="t('settings.playerNamePlaceholder')" />
      </n-form-item>

      <n-form-item :label="t('settings.avatar')">
        <n-space align="center">
          <n-avatar 
            round 
            size="large" 
            :src="formValue.avatar" 
            :key="formValue.avatar"
          >
            <template v-if="!formValue.avatar">
              {{ formValue.playerName?.charAt(0)?.toUpperCase() }}
            </template>
          </n-avatar>
          <n-button @click="handleUploadAvatar">{{ t('settings.uploadAvatar') }}</n-button>
        </n-space>
      </n-form-item>
      
      <n-form-item :label="t('settings.roomPort')" path="defaultRoomPort">
        <n-input-number v-model:value="formValue.defaultRoomPort" :min="1024" :max="65535" :placeholder="t('settings.defaultPortPlaceholder')" style="width: 100%" />
      </n-form-item>

      <n-form-item :label="t('settings.theme')" path="theme">
        <n-select v-model:value="formValue.theme" :options="themeOptions" />
      </n-form-item>

      <n-form-item :label="t('settings.language')" path="language">
        <n-select v-model:value="formValue.language" :options="languageOptions" />
      </n-form-item>
      
      <n-form-item label="Player ID">
        <n-text depth="3">{{ formValue.playerId }} {{ t('settings.idHint') }}</n-text>
      </n-form-item>

      <div style="display: flex; justify-content: flex-end;">
        <n-button type="primary" @click="handleSave">{{ t('settings.save') }}</n-button>
      </div>
    </n-form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { AppSettings } from '../../../shared/types'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const message = useMessage()

const formRef = ref(null)
const formValue = ref<AppSettings | null>(null)

const rules = {
  playerName: { required: true, message: () => t('settings.enterName'), trigger: 'blur' },
  defaultRoomPort: { required: true, type: 'number', message: () => t('settings.enterPort'), trigger: ['blur', 'change'] }
}

const themeOptions = computed(() => [
  { label: t('settings.themeDark'), value: 'dark' },
  { label: t('settings.themeLight'), value: 'light' }
])

const languageOptions = computed(() => [
  { label: t('settings.langZhCN'), value: 'zh-CN' },
  { label: t('settings.langEnUS'), value: 'en-US' }
])

onMounted(async () => {
  await settingsStore.loadSettings()
  if (settingsStore.settings) {
    formValue.value = JSON.parse(JSON.stringify(settingsStore.settings))
  }
})

const handleSave = async () => {
  if (formValue.value) {
    try {
      // Use JSON.parse(JSON.stringify()) to strip Vue reactivity and ensure a plain object for IPC
      const plainSettings = JSON.parse(JSON.stringify(formValue.value));
      console.log('Attempting to save settings:', plainSettings);
      await settingsStore.saveSettings(plainSettings);
      message.success(t('settings.saveSuccess'));
    } catch (error: any) {
      console.error('Failed to save settings:', error);
      message.error(`${t('settings.saveFail')}: ${error.message || error}`);
    }
  }
}

const handleUploadAvatar = async () => {
  const avatarUrl = await window.electronAPI.settings.uploadAvatar();
  if (avatarUrl && formValue.value) {
    formValue.value.avatar = avatarUrl;
    // Auto-save settings after avatar upload
    await handleSave();
  }
}
</script>
