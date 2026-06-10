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
          <div class="avatar-clickable" @click="handleAvatarClick">
            <AvatarWithFrame
              :src="formValue?.avatar"
              :name="formValue?.playerName || ''"
              :size="40"
              :frame-file-name="settingsFrameFileName"
            />
          </div>
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

      <n-form-item :label="t('settings.downloadFloatBall')" path="downloadFloatBall">
        <n-radio-group v-model:value="formValue.downloadFloatBall">
          <n-radio :value="true">{{ t('settings.downloadFloatBallOn') }}</n-radio>
          <n-radio :value="false">{{ t('settings.downloadFloatBallOff') }}</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-form-item :label="t('settings.sensitiveWordFilter')" path="sensitiveWordFilter">
        <n-radio-group v-model:value="formValue.sensitiveWordFilter">
          <n-radio :value="true">{{ t('settings.sensitiveWordFilterOn') }}</n-radio>
          <n-radio :value="false">{{ t('settings.sensitiveWordFilterOff') }}</n-radio>
        </n-radio-group>
      </n-form-item>

      <n-form-item :label="t('settings.githubToken')" path="githubToken">
        <n-input
          v-model:value="formValue.githubToken"
          type="password"
          :placeholder="t('settings.githubTokenPlaceholder')"
          @copy.prevent
          @cut.prevent
        />
      </n-form-item>

      <n-form-item :label="t('settings.storagePathList')">
        <n-space vertical style="width: 100%;">
          <n-empty v-if="allStoragePaths.length === 0" :description="t('settings.storagePathEmpty')" />
          <div v-for="item in allStoragePaths" :key="item" class="storage-path-item">
            <n-button
              quaternary
              style="justify-content: flex-start; flex: 1;"
              @click="handleOpenPath(item)"
            >
              {{ item }}
            </n-button>
            <n-tag v-if="isDefaultStoragePath(item)" type="success" size="small" class="storage-path-default-tag">
              {{ t('settings.defaultStoragePath') }}
            </n-tag>
            <n-button
              v-else
              tertiary
              size="small"
              @click="handleSetDefaultStoragePath(item)"
            >
              {{ t('settings.setDefaultStoragePath') }}
            </n-button>
            <n-button
              tertiary
              type="error"
              size="small"
              :loading="removingPath === item"
              @click="handleRemovePath(item)"
            >
              ×
            </n-button>
          </div>
          <n-button dashed block @click="handleAddGameStoragePath">
            {{ t('settings.addStoragePath') }}
          </n-button>
        </n-space>
      </n-form-item>

      <n-form-item :label="t('settings.dataHealth')">
        <n-space vertical style="width: 100%;">
          <n-space>
            <n-button :loading="isCheckingHealth" @click="handleDataHealthCheck">
              {{ t('settings.runDataHealthCheck') }}
            </n-button>
            <n-text v-if="dataHealthReport" depth="3">
              {{ t('settings.dataHealthSummary', dataHealthSummaryText) }}
            </n-text>
          </n-space>
          <n-alert
            v-if="dataHealthReport"
            :type="dataHealthReport.ok ? 'success' : 'warning'"
          >
            {{
              dataHealthReport.ok
                ? t('settings.dataHealthOk')
                : t('settings.dataHealthIssuesFound')
            }}
          </n-alert>
          <n-list v-if="dataHealthReport?.issues.length">
            <n-list-item v-for="issue in dataHealthReport.issues" :key="`${issue.code}-${issue.target || issue.message}`">
              <n-space vertical size="small">
                <n-tag :type="issue.level === 'error' ? 'error' : 'warning'" size="small">
                  {{ issue.level === 'error' ? t('settings.healthError') : t('settings.healthWarning') }}
                </n-tag>
                <n-text>{{ issue.message }}</n-text>
                <n-text v-if="issue.target" depth="3">{{ issue.target }}</n-text>
              </n-space>
            </n-list-item>
          </n-list>
        </n-space>
      </n-form-item>

    <n-form-item :label="t('settings.update')">
        <n-space>
        <n-button :loading="isCheckingUpdate" @click="handleCheckUpdate">
          {{ t('settings.checkUpdate') }}
        </n-button>
          <n-text depth="3">{{ t('settings.currentVersion', { version: updateState.currentVersion }) }}</n-text>
        </n-space>
      </n-form-item>

      <n-form-item :label="t('settings.officialWebsite')">
        <n-a href="http://www.bzgames.top/" @click.prevent="handleOpenWebsite">
          http://www.bzgames.top/
        </n-a>
      </n-form-item>

      <n-form-item label="Player ID">
        <n-text depth="3">{{ formValue.playerId }} {{ t('settings.idHint') }}</n-text>
      </n-form-item>

      <div style="display: flex; justify-content: space-between; align-items: center;">
        <n-space>
          <n-button type="error" secondary @click="showUninstallModal = true">
            {{ t('settings.uninstallClient') }}
          </n-button>
          <n-button secondary @click="handleClearCache">
            {{ t('settings.clearCache') }}
          </n-button>
          <n-button secondary @click="handleOpenMigrateStorageModal">
            {{ t('settings.migrateStorage') }}
          </n-button>
        </n-space>
        <n-button type="primary" :disabled="!canSave" @click="handleSave">{{ t('settings.save') }}</n-button>
      </div>
    </n-form>

    <n-modal v-model:show="showUninstallModal" preset="dialog" :title="t('settings.uninstallClient')" positive-text="" negative-text="">
      <n-space vertical :size="16" style="width: 100%;">
        <n-text>{{ t('settings.uninstallClientDescription') }}</n-text>
        <n-checkbox v-model:checked="uninstallDeleteGames">
          {{ t('settings.uninstallDeleteGames') }}
        </n-checkbox>
        <n-list v-if="uninstallDeleteGames && allStoragePaths.length > 0" bordered>
          <n-list-item v-for="item in allStoragePaths" :key="item">
            <n-text depth="3" style="word-break: break-all;">{{ item }}</n-text>
          </n-list-item>
        </n-list>
      </n-space>
      <template #action>
        <n-space>
          <n-button @click="showUninstallModal = false">{{ t('common.cancel') }}</n-button>
          <n-button type="error" @click="confirmUninstall">{{ t('settings.uninstallClient') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showClearCacheModal" preset="card" :title="t('settings.clearCache')" style="width: 400px;" :closable="!isClearingCache" :mask-closable="!isClearingCache">
      <n-space vertical :size="16" style="width: 100%;">
        <n-text v-if="!isClearingCache && !clearCacheResult">{{ t('settings.clearCacheConfirm') }}</n-text>
        <template v-if="isClearingCache">
          <n-progress type="line" :percentage="clearCacheProgress" :indicator-placement="'inside'" processing />
          <n-text depth="3">{{ t('settings.clearCacheProcessing') }}</n-text>
        </template>
        <template v-if="clearCacheResult">
          <n-text>{{ t('settings.clearCacheSuccess', { size: formatBytes(clearCacheResult.clearedSize) }) }}</n-text>
        </template>
      </n-space>
      <template #action>
        <n-space v-if="!isClearingCache" justify="end">
          <n-button @click="showClearCacheModal = false">{{ clearCacheResult ? t('common.confirm') : t('common.cancel') }}</n-button>
          <n-button v-if="!clearCacheResult" type="warning" @click="confirmClearCache">{{ t('settings.clearCache') }}</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showMigrateStorageModal" preset="card" :title="t('settings.migrateStorage')" style="width: 520px;" :closable="!isMigratingStorage" :mask-closable="!isMigratingStorage">
      <n-space vertical :size="16" style="width: 100%;">
        <n-text>{{ t('settings.migrateStorageDescription') }}</n-text>
        <n-select
          v-model:value="selectedMigrationSourcePath"
          :options="migrationStorageOptions"
          :placeholder="t('settings.selectSourceStoragePath')"
          :disabled="isMigratingStorage"
        />
        <n-input-group>
          <n-input
            v-model:value="selectedMigrationTargetPath"
            :placeholder="t('settings.selectTargetStoragePath')"
            readonly
          />
          <n-button :disabled="isMigratingStorage" @click="handlePickMigrationTargetPath">
            {{ t('settings.browsePath') }}
          </n-button>
        </n-input-group>
        <n-alert v-if="selectedMigrationSourcePath" type="warning">
          {{ t('settings.migrateStorageWarning', { path: selectedMigrationSourcePath }) }}
        </n-alert>
      </n-space>
      <template #action>
        <n-space justify="end">
          <n-button :disabled="isMigratingStorage" @click="showMigrateStorageModal = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="isMigratingStorage" @click="confirmMigrateStorage">
            {{ t('settings.migrateStorage') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showAvatarPreview" preset="card" title="" style="width: 360px;" :bordered="false">
      <div style="display: flex; justify-content: center; align-items: center; padding: 24px;">
        <AvatarWithFrame
          :src="formValue?.avatar"
          :name="formValue?.playerName || ''"
          :size="280"
          :frame-file-name="settingsFrameFileName"
        />
      </div>
    </n-modal>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/useSettingsStore'
import { useGameStore } from '../stores/useGameStore'
import AvatarWithFrame from '../components/AvatarWithFrame.vue'
import type { AppSettings } from '../../../shared/types'
import { getFrameImageFileName } from '../../../shared/avatar-frames'
import { formatBytes } from '../utils/format'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const gameStore = useGameStore()
const message = useMessage()
const dialog = useDialog()

const formRef = ref(null)
const formValue = ref<AppSettings | null>(null)
const showUninstallModal = ref(false)
const showAvatarPreview = ref(false)
const showClearCacheModal = ref(false)
const showMigrateStorageModal = ref(false)
const isClearingCache = ref(false)
const isMigratingStorage = ref(false)
const clearCacheProgress = ref(0)
const clearCacheResult = ref<{ totalSize: number; clearedSize: number } | null>(null)
const uninstallDeleteGames = ref(false)
const selectedMigrationSourcePath = ref('')
const selectedMigrationTargetPath = ref('')
const registeredStoragePaths = ref<Array<{ path: string; isDefault: boolean }>>([])
const updateState = computed(() => settingsStore.updateState)
const dataHealthReport = computed(() => settingsStore.dataHealthReport)
const isCheckingUpdate = ref(false)
const isCheckingHealth = ref(false)
const removingPath = ref('')
const allStoragePaths = computed(() => {
  const set = new Set<string>()
  registeredStoragePaths.value.forEach(item => {
    if (item.path?.trim()) set.add(item.path.trim())
  })
  return Array.from(set)
})

const migrationStorageOptions = computed(() =>
  allStoragePaths.value.map(path => ({ label: path, value: path }))
)

const settingsFrameFileName = computed(() => {
  const frameId = settingsStore.userData?.equippedFrame
  if (!frameId) return undefined
  return getFrameImageFileName(frameId)
})

const canSave = computed(() => {
  return formValue.value?.playerName?.trim() && formValue.value?.defaultRoomPort
})

const rules = {
  playerName: { required: true, message: () => t('settings.enterName'), trigger: 'blur' },
  defaultRoomPort: { required: true, type: 'number', message: () => t('settings.enterPort'), trigger: ['blur', 'change'] }
}

const themeOptions = computed(() => [
  { label: t('settings.themeDark'), value: 'dark' },
  { label: t('settings.themeLight'), value: 'light' },
  { label: t('settings.themeAuto'), value: 'auto' }
])

const languageOptions = computed(() => [
  { label: t('settings.langZhCN'), value: 'zh-CN' },
  { label: t('settings.langEnUS'), value: 'en-US' },
  { label: t('settings.langJaJP'), value: 'ja-JP' }
])

const dataHealthSummaryText = computed(() => {
  const summary = dataHealthReport.value?.summary
  return {
    errors: summary?.errors || 0,
    warnings: summary?.warnings || 0,
    games: summary?.gameCount || 0,
    versions: summary?.versionCount || 0,
    paths: summary?.storagePathCount || 0
  }
})

const updateErrorText = (errorCode?: string, rawMessage?: string) => {
  const key = errorCode ? `settings.updateErrors.${errorCode}` : 'settings.updateErrors.unknown'
  const translated = t(key)
  return translated === key ? rawMessage || t('settings.updateErrors.unknown') : translated
}

const storageErrorText = (error: any) => {
  const message = error?.error || error?.message || String(error || '')
  const key = message ? `settings.storageErrors.${message}` : 'settings.storageErrors.unknown'
  const translated = t(key)
  return translated === key ? message || t('settings.storageErrors.unknown') : translated
}

const refreshStoragePaths = async () => {
  registeredStoragePaths.value = await window.electronAPI.settings.getGameStoragePaths()
}

const isDefaultStoragePath = (targetPath: string) => {
  return registeredStoragePaths.value.some(item => item.path === targetPath && item.isDefault)
}

onMounted(async () => {
  await settingsStore.loadSettings()
  await refreshStoragePaths()
  if (settingsStore.settings) {
    formValue.value = JSON.parse(JSON.stringify(settingsStore.settings))
  }
  settingsStore.initUpdateEvents()
  await settingsStore.refreshUpdateStatus()
})


const handleSave = async () => {
  if (formValue.value) {
    try {
      await (formRef.value as any)?.validate()
    } catch {
      return
    }
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

const handleAvatarClick = () => {
  showAvatarPreview.value = true
}

const handleAddGameStoragePath = async () => {
  const result = await window.electronAPI.settings.selectGameStoragePath()
  if (!result) return
  if (result.error === "directory_not_empty") {
    dialog.warning({
      title: t('settings.storagePathNotEmptyTitle'),
      content: t('settings.storagePathNotEmptyContent'),
    })
    return
  }
  await window.electronAPI.settings.addGameStoragePath(result.path)
  await settingsStore.loadSettings()
  await refreshStoragePaths()
  if (settingsStore.settings) {
    formValue.value = JSON.parse(JSON.stringify(settingsStore.settings))
  }
  message.success(t('settings.saveSuccess'))
}

const handleSetDefaultStoragePath = async (targetPath: string) => {
  await window.electronAPI.settings.setDefaultGameStoragePath(targetPath)
  await settingsStore.loadSettings()
  await refreshStoragePaths()
  if (settingsStore.settings) {
    formValue.value = JSON.parse(JSON.stringify(settingsStore.settings))
  }
  message.success(t('settings.saveSuccess'))
}

const handleOpenPath = async (targetPath: string) => {
  const ok = await window.electronAPI.settings.openPath(targetPath)
  if (!ok) {
    message.error(t('settings.openPathFailed'))
  }
}

const handleRemovePath = async (targetPath: string) => {
  dialog.warning({
    title: t('settings.removeStoragePathTitle'),
    content: t('settings.removeStoragePathConfirm', { path: targetPath }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        removingPath.value = targetPath
        const result = await window.electronAPI.settings.removeGameStoragePath(targetPath)
        if (!result.success) {
          message.error(`${t('settings.removeStoragePathFailed')}: ${storageErrorText(result)}`)
          return
        }
        await settingsStore.loadSettings()
        await refreshStoragePaths()
        if (settingsStore.settings) {
          formValue.value = JSON.parse(JSON.stringify(settingsStore.settings))
        }
        message.success(
          t('settings.removeStoragePathSuccess', {
            gameCount: result.removedGames,
            versionCount: result.removedVersions
          })
        )
      } catch (error: any) {
        message.error(`${t('settings.removeStoragePathFailed')}: ${storageErrorText(error)}`)
      } finally {
        removingPath.value = ''
      }
    }
  })
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
        onNegativeClick: () => {
          if (!state.latestVersion) return
          void settingsStore.ignoreUpdateVersion(state.latestVersion).catch((error: any) => {
            message.error(`${t('settings.saveFail')}: ${error?.message || error}`)
          })
        }
      })
      return
    }
    if (state.status === 'up_to_date') {
      message.success(t('settings.updateLatest'))
    } else if (state.status === 'unsupported') {
      message.warning(t('settings.updateUnsupported'))
    } else if (state.status === 'error') {
      message.error(
        t('settings.updateError', {
          message: updateErrorText(state.errorCode, state.message)
        })
      )
    }
  } finally {
    isCheckingUpdate.value = false
  }
}

const handleDataHealthCheck = async () => {
  if (isCheckingHealth.value) return
  isCheckingHealth.value = true
  try {
    const report = await settingsStore.runDataHealthCheck()
    if (report.ok) {
      message.success(t('settings.dataHealthOk'))
    } else {
      message.warning(t('settings.dataHealthIssuesFound'))
    }
  } catch (error: any) {
    message.error(`${t('common.error')}: ${error?.message || error}`)
  } finally {
    isCheckingHealth.value = false
  }
}

const handleOpenWebsite = () => {
  window.electronAPI.settings.openUrl("http://www.bzgames.top/")
}

const confirmUninstall = async () => {
  showUninstallModal.value = false
  const result = await window.electronAPI.settings.uninstall({
    deleteGames: uninstallDeleteGames.value,
  })
  if (!result.success && result.error === "uninstaller_not_found") {
    message.warning(t('settings.uninstallNotAvailable'))
  }
}

const handleClearCache = () => {
  clearCacheResult.value = null
  clearCacheProgress.value = 0
  isClearingCache.value = false
  showClearCacheModal.value = true
}

const handleOpenMigrateStorageModal = () => {
  if (allStoragePaths.value.length === 0) {
    message.warning(t('settings.storagePathEmpty'))
    return
  }
  selectedMigrationSourcePath.value = allStoragePaths.value[0]
  selectedMigrationTargetPath.value = ''
  isMigratingStorage.value = false
  showMigrateStorageModal.value = true
}

const handlePickMigrationTargetPath = async () => {
  const result = await window.electronAPI.settings.selectGameStoragePath()
  if (!result) return
  if (result.error === "directory_not_empty") {
    dialog.warning({
      title: t('settings.storagePathNotEmptyTitle'),
      content: t('settings.storagePathNotEmptyContent'),
    })
    return
  }
  selectedMigrationTargetPath.value = result.path
}

const confirmMigrateStorage = async () => {
  if (!selectedMigrationSourcePath.value) {
    message.warning(t('settings.selectSourceStoragePath'))
    return
  }
  if (!selectedMigrationTargetPath.value) {
    message.warning(t('settings.selectTargetStoragePath'))
    return
  }

  isMigratingStorage.value = true
  try {
    const result = await window.electronAPI.settings.migrateGameStorageLibrary({
      sourcePath: selectedMigrationSourcePath.value,
      targetPath: selectedMigrationTargetPath.value,
    })
    if (!result.success) {
      message.error(`${t('settings.migrateStorageFailed')}: ${storageErrorText(result)}`)
      return
    }
    await settingsStore.loadSettings()
    await refreshStoragePaths()
    if (settingsStore.settings) {
      formValue.value = JSON.parse(JSON.stringify(settingsStore.settings))
    }
    await gameStore.loadGames()
    showMigrateStorageModal.value = false
    message.success(t('settings.migrateStorageSuccess', {
      gameCount: result.migratedGames || 0,
      versionCount: result.migratedVersions || 0,
    }))
  } catch (error: any) {
    message.error(`${t('settings.migrateStorageFailed')}: ${storageErrorText(error)}`)
  } finally {
    isMigratingStorage.value = false
  }
}

const confirmClearCache = async () => {
  isClearingCache.value = true
  clearCacheProgress.value = 0

  const progressInterval = setInterval(() => {
    if (clearCacheProgress.value < 90) {
      clearCacheProgress.value += Math.random() * 15 + 5
      if (clearCacheProgress.value > 90) clearCacheProgress.value = 90
    }
  }, 200)

  try {
    const result = await window.electronAPI.settings.clearCache()
    clearInterval(progressInterval)
    clearCacheProgress.value = 100
    clearCacheResult.value = result
  } catch {
    clearInterval(progressInterval)
    clearCacheProgress.value = 100
    clearCacheResult.value = { totalSize: 0, clearedSize: 0 }
  } finally {
    isClearingCache.value = false
  }
}

</script>

<style scoped>
.storage-path-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.storage-path-default-tag {
  height: 28px;
  align-items: center;
}
.avatar-clickable {
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}
.avatar-clickable:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
</style>
