<template>
  <template v-if="isNotificationWindow">
    <router-view />
  </template>
  <n-layout v-else position="absolute">
    <n-layout-header bordered style="height: 64px; padding: 16px;">
      <n-space justify="space-between" align="center">
        <h2 style="margin: 0; display: flex; align-items: center;">
          <n-avatar 
            round 
            size="small" 
            :src="settingsStore.settings?.avatar" 
            :key="settingsStore.settings?.avatar"
            style="margin-right: 8px; vertical-align: middle;" 
          >
            <template v-if="!settingsStore.settings?.avatar">
              {{ settingsStore.settings?.playerName?.charAt(0)?.toUpperCase() || '?' }}
            </template>
          </n-avatar>
          {{ settingsStore.settings?.playerName || 'BZ-Games' }}

          <div 
             style="margin-left: 16px; display: flex; align-items: center; background: rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 16px; cursor: pointer; transition: all 0.3s;" 
             @click="showCheckIn = true"
          >
             <img :src="bzCoinIcon" style="width: 18px; height: 18px; margin-right: 4px;" />
             <span style="color: #FFD700; font-weight: bold; margin-right: 8px; font-size: 14px;">{{ settingsStore.userData?.bzCoins || 0 }}</span>
             <n-icon :component="Calendar" :color="calendarIconColor" size="16" />
          </div>
        </h2>
        <n-space>
          <n-button 
            v-if="roomStore.room" 
            secondary 
            type="primary"
            @click="handleBackToRoom"
          >
            {{ t('nav.backToRoom') }}
          </n-button>
          <n-button @click="router.push('/library')">{{ t('nav.myGames') }}</n-button>
          <n-button @click="router.push('/statistics')">{{ t('statistics.title') }}</n-button>
          <n-badge :dot="gameStore.newAchievements.size > 0">
            <n-button @click="router.push('/achievements')">{{ t('achievement.title') }}</n-button>
          </n-badge>
          <n-button @click="router.push('/settings')">{{ t('nav.settings') }}</n-button>
        </n-space>
      </n-space>
    </n-layout-header>
    <n-layout position="absolute" style="top: 64px; bottom: 0;">
      <router-view />
    </n-layout>
    <CheckInModal v-model:show="showCheckIn" />
    <n-modal v-model:show="showUpdateModal" preset="card" :title="t('settings.updateTitle')" style="width: 520px;">
      <n-space vertical>
        <n-text>{{ updateStatusText }}</n-text>
        <n-progress
          v-if="showProgress"
          type="line"
          :percentage="progressPercent"
          :indicator-placement="'inside'"
        />
        <n-text v-if="updateState.message" depth="3">{{ updateState.message }}</n-text>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="hideUpdateModal">{{ t('common.cancel') }}</n-button>
          <n-button
            v-if="updateState.status === 'downloaded'"
            type="primary"
            @click="handleInstallUpdate"
          >
            {{ t('settings.installNow') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
  </n-layout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NAvatar, NSpace, NBadge, NIcon, NModal, NText, NProgress, NButton, useDialog } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/useSettingsStore'
import { useRoomStore } from './stores/useRoomStore'
import { useGameStore } from './stores/useGameStore'
import { Calendar } from '@vicons/ionicons5'
import CheckInModal from './components/CheckInModal.vue'
import { ref } from 'vue'
import { AchievementNotifier } from './utils/achievementNotifier'
import bzCoinIcon from './assets/images/bz-coin.png'
import semver from 'semver'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const settingsStore = useSettingsStore()
const roomStore = useRoomStore()
const gameStore = useGameStore()
const dialog = useDialog()
const showCheckIn = ref(false)
const calendarIconColor = computed(() => {
  return settingsStore.settings?.theme === 'light' ? '#1f2937' : '#fff'
})

const isNotificationWindow = computed(() => {
  return route.name === 'Notification' || route.path.startsWith('/notification');
})

const handleBackToRoom = () => {
  if (roomStore.room && roomStore.room.gameId) {
    router.push(`/room/${roomStore.room.gameId}`)
  }
}

let cleanup: (() => void) | undefined
let cleanupAchievements: (() => void) | undefined
const achievementNotifier = new AchievementNotifier({
  delayMs: 5200,
  onProcess: async () => {
    await gameStore.loadGames()
  }
})

const updateState = computed(() => settingsStore.updateState)
const showUpdateModal = computed({
  get: () => settingsStore.showUpdateModal,
  set: (val) => {
    if (!val) settingsStore.hideUpdateModal()
  }
})

const progressPercent = computed(() => {
  return Math.max(0, Math.min(100, Math.round(updateState.value.progress || 0)))
})

const showProgress = computed(() => {
  return ['downloading', 'downloaded', 'up_to_date'].includes(updateState.value.status)
})

const updateStatusText = computed(() => {
  const map: Record<string, string> = {
    idle: t('settings.updateIdle'),
    checking: t('settings.updateChecking'),
    available: t('settings.updateAvailable', { version: updateState.value.latestVersion || '' }),
    up_to_date: t('settings.updateLatest'),
    downloading: t('settings.updateDownloading', { progress: progressPercent.value }),
    downloaded: t('settings.updateDownloaded'),
    error: t('settings.updateError', { message: updateState.value.message || '' }),
    unsupported: t('settings.updateUnsupported')
  }
  return map[updateState.value.status] || t('settings.updateIdle')
})

const shouldPromptUpdate = (latestVersion?: string) => {
  if (!latestVersion) return false
  const ignored = settingsStore.settings?.ignoredUpdateVersion
  if (!ignored) return true
  if (ignored === latestVersion) return false
  if (semver.valid(ignored) && semver.valid(latestVersion)) {
    return semver.gt(latestVersion, ignored)
  }
  return latestVersion !== ignored
}

const handleAutoUpdateCheck = async () => {
  if (isNotificationWindow.value) return
  await settingsStore.loadSettings()
  settingsStore.initUpdateEvents()
  const state = await settingsStore.checkUpdateOnly()
  if (state.status !== 'available') return
  if (!shouldPromptUpdate(state.latestVersion)) return
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
}

const handleInstallUpdate = async () => {
  await settingsStore.installUpdate()
}

const hideUpdateModal = () => {
  settingsStore.hideUpdateModal()
}

onMounted(() => {
  if (window.electronAPI?.room?.onEvent) {
    cleanup = window.electronAPI.room.onEvent((event) => {
      roomStore.handleRoomEvent(event)
    })
  }
  
  if (window.electronAPI?.game?.onAchievementUnlocked) {
    cleanupAchievements = window.electronAPI.game.onAchievementUnlocked(
      (gameId, version, achievementId) => {
        achievementNotifier.enqueue({ gameId, version, achievementId })
      }
    )
  }

  handleAutoUpdateCheck()
})

onUnmounted(() => {
  if (cleanup) cleanup()
  if (cleanupAchievements) cleanupAchievements()
  achievementNotifier.dispose()
})
</script>
