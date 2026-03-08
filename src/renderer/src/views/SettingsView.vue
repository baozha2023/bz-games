<template>
  <div style="padding: 24px; max-width: 600px; margin: 0 auto;">
    <n-page-header :title="t('settings.title')" @back="$router.push({ name: 'Library' })" />
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

      <n-form-item :label="t('settings.closeBehavior')" path="closeBehavior">
        <n-radio-group v-model:value="formValue.closeBehavior">
          <n-radio value="tray">{{ t('settings.closeToTray') }}</n-radio>
          <n-radio value="exit">{{ t('settings.exitDirectly') }}</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-form-item :label="t('settings.autoLaunch')" path="autoLaunch">
        <n-radio-group v-model:value="formValue.autoLaunch">
          <n-radio :value="true">{{ t('settings.autoLaunchOn') }}</n-radio>
          <n-radio :value="false">{{ t('settings.autoLaunchOff') }}</n-radio>
        </n-radio-group>
      </n-form-item>

    <n-form-item :label="t('settings.update')">
        <n-space>
        <n-button :loading="isCheckingUpdate" @click="handleCheckUpdate">
          {{ t('settings.checkUpdate') }}
        </n-button>
          <n-text depth="3">{{ t('settings.currentVersion', { version: updateState.currentVersion }) }}</n-text>
        </n-space>
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
import { useMessage, useDialog } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { AppSettings } from '../../../shared/types'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const message = useMessage()
const dialog = useDialog()

const formRef = ref(null)
const formValue = ref<AppSettings | null>(null)
const updateState = computed(() => settingsStore.updateState)
const isCheckingUpdate = ref(false)

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
  { label: t('settings.langEnUS'), value: 'en-US' },
  { label: t('settings.langJaJP'), value: 'ja-JP' }
])

onMounted(async () => {
  await settingsStore.loadSettings()
  if (settingsStore.settings) {
    formValue.value = JSON.parse(JSON.stringify(settingsStore.settings))
  }
  settingsStore.initUpdateEvents()
  await settingsStore.refreshUpdateStatus()
})


const handleSave = async () => {
  if (formValue.value) {
    try {
      const plainSettings = JSON.parse(JSON.stringify(formValue.value));
      await settingsStore.saveSettings(plainSettings);
      message.success(t('settings.saveSuccess'));
    } catch (error: any) {
      message.error(`${t('settings.saveFail')}: ${error.message || error}`);
    }
  }
}

const handleUploadAvatar = async () => {
  const avatarUrl = await window.electronAPI.settings.uploadAvatar();
  if (avatarUrl && formValue.value) {
    formValue.value.avatar = avatarUrl;
    await handleSave();
  }
}

const handleCheckUpdate = async () => {
  if (isCheckingUpdate.value) return
  isCheckingUpdate.value = true
  try {
    const state = await settingsStore.checkUpdateOnly()
    if (state.status === 'available') {
      dialog.warning({
        title: t('settings.updatePromptTitle'),
        content: t('settings.updatePromptMessage', { version: state.latestVersion || '' }),
        positiveText: t('settings.updateNow'),
        negativeText: t('settings.updateLater'),
        onPositiveClick: async () => {
          await settingsStore.checkUpdate()
        },
        onNegativeClick: async () => {
          if (settingsStore.settings && state.latestVersion) {
            await settingsStore.saveSettings({
              ...settingsStore.settings,
              ignoredUpdateVersion: state.latestVersion
            })
          }
        }
      })
      return
    }
    if (state.status === 'up_to_date') {
      message.success(t('settings.updateLatest'))
    } else if (state.status === 'unsupported') {
      message.warning(t('settings.updateUnsupported'))
    } else if (state.status === 'error') {
      message.error(t('settings.updateFailed'))
    }
  } finally {
    isCheckingUpdate.value = false
  }
}

</script>
